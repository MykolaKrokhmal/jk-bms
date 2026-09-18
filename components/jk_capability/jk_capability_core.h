#pragma once
// jk_capability_core.h -- pure, hardware-independent capability-tracking
// core for optional, never-before-confirmed read blocks (Stage 3 bounded
// batch, 2026-09-17: CellWireRes16-31 / cell_resistance_17..32, and
// CellConWireRes0-31 / cell_connection_wire_resistance_1..32). No ESPHome,
// no Modbus, no I/O of any kind -- same split as
// components/jk_topology/jk_topology_core.h,
// components/jk_poll_scheduler/jk_poll_scheduler_core.h and
// components/jk_write_tx/jk_write_tx_core.h: the caller
// (batterylifepo4.yaml's own interval lambdas) owns issuing the actual
// Modbus read and reports each attempt's outcome here; this module only
// tracks the resulting capability state. Desktop-testable -- see
// test/jk_capability/test_jk_capability_core.cpp.
//
// Why this exists as its own concept, separate from topology confirmation
// (user-directed requirement, 2026-09-17): CellCount / topology_state
// answer "how many channels are configured on this pack", never "does
// this connected BMS firmware answer a read at this specific,
// never-before-read address". A pack reporting CellCount=24 does not by
// itself prove the CellWireRes16-31 extension or the CellConWireRes0-31
// calibration block are actually readable on that firmware -- those are
// two independently-tracked facts, and conflating them would let a
// confirmed topology silently stand in for hardware evidence this
// project does not have.
//
// Bounded-probing policy (user-directed -- "не допускай нескінченних
// probes або повторних exception-запитів"): a block starts UNKNOWN. Each
// failed attempt (short response, no response within the caller's own
// timeout, or any other non-success outcome the caller detects) increments
// a bounded counter; once MAX_PROBE_ATTEMPTS consecutive failures have
// been recorded, the state becomes UNSUPPORTED and should_attempt()
// starts returning false -- no further reads are issued for that block
// for the rest of this boot session. A single success at any point (even
// mid-probe) sets SUPPORTED and resets the counter; SUPPORTED then keeps
// reading forever -- at that point it is ordinary polling of a
// proven-working block, not "probing" anymore, so a later transient miss
// does not demote it back into the bounded-attempt budget (see
// record_outcome's own comment on this).

#include <cmath>
#include <cstddef>
#include <cstdint>

namespace jk_capability {

enum State : uint8_t {
  STATE_UNKNOWN = 0,
  STATE_SUPPORTED = 1,
  STATE_UNSUPPORTED = 2,
};

// Configured N (structural channel count) and register-block SUPPORT are
// different questions (user-directed requirement, Stage 3 bounded batch,
// 2026-09-17: "Розділяй configured N і підтримку конкретного register
// block") -- this function answers only the first one, for the
// CellWireRes16-31 extension specifically: does the currently configured
// CellCount even call for channels 17-32 to exist at all? A NaN or
// out-of-protocol-range reading (never a valid channel count) answers
// false, same fail-safe direction jk_topology_core.h's own
// blank_from/display_cell_count clamps use -- never a guess. Whether the
// block is actually SUPPORTED by the connected firmware once it IS
// needed is the separate, independently-tracked ProbeState below; this
// function is never asked to answer that.
inline bool needs_cellwireres_extended_read(float configured_cell_count) {
  if (std::isnan(configured_cell_count)) return false;
  return configured_cell_count >= 17.0f && configured_cell_count <= 32.0f;
}

inline constexpr const char *const STATE_NAMES[3] = {
  "UNKNOWN", "SUPPORTED", "UNSUPPORTED"
};

// Deliberately small: both consumers of this header are a genuinely
// never-before-verified read on real hardware (an address-range
// extension never requested before, and a wholly separate never-before-
// read address block) -- 3 gives the connected device a few chances to
// answer past ordinary bus noise without ever approaching "infinite
// probing" or a tight exception-retry loop.
constexpr uint8_t MAX_PROBE_ATTEMPTS = 3;

struct ProbeState {
  State state = STATE_UNKNOWN;
  uint8_t consecutive_failures = 0;
};

// Should the caller issue another read attempt for this block right now?
//   SUPPORTED   -- yes, forever (ordinary polling, no longer "probing").
//   UNSUPPORTED -- no, never again this boot session.
//   UNKNOWN     -- yes, until MAX_PROBE_ATTEMPTS consecutive failures.
inline bool should_attempt(const ProbeState &s) {
  if (s.state == STATE_UNSUPPORTED) return false;
  if (s.state == STATE_SUPPORTED) return true;
  return s.consecutive_failures < MAX_PROBE_ATTEMPTS;
}

// Pure state transition, called once per COMPLETED attempt -- never for a
// cycle where should_attempt() was false and no read was issued at all
// (that is not a failure, it is "we already gave up" or "not needed
// right now", and must not perturb the counter either way). `success`
// means the caller received and decoded a full, expected-length response
// this attempt; anything else (short response, timeout, exception) is a
// failure.
inline ProbeState record_outcome(ProbeState s, bool success) {
  if (success) {
    s.state = STATE_SUPPORTED;
    s.consecutive_failures = 0;
    return s;
  }
  if (s.state == STATE_SUPPORTED) {
    // A block already proven working can see one transient miss (bus
    // noise) without being demoted back into the bounded-probe budget --
    // demoting a PROVEN block on a single miss would just relocate the
    // starvation risk the bounded-probe policy exists to close for the
    // UNKNOWN phase, not remove it. Stays SUPPORTED; the caller's own
    // short-response guard already handles not decoding garbage this one
    // cycle, and the very next successful read (record_outcome(s, true))
    // resets consecutive_failures to 0 again anyway.
    return s;
  }
  s.consecutive_failures += 1;
  s.state = (s.consecutive_failures >= MAX_PROBE_ATTEMPTS) ? STATE_UNSUPPORTED : STATE_UNKNOWN;
  return s;
}

// ---------------------------------------------------------------------------
// Per-attempt diagnostic instrumentation (2026-09-18, user-directed): the
// ProbeState above answers "is this block supported", aggregated across
// attempts -- it cannot show WHICH failure mode a single attempt hit, or
// prove a request was genuinely issued (queue_command() only enqueues; it
// is not evidence of actual UART transmission). This section exists to
// give the CellConWireRes0-31 read (batterylifepo4.yaml) a per-attempt
// outcome trail, entirely independent of, and never feeding back into,
// the bounded-retry policy above.
//
// Framework research this pass (esphome/components/modbus_controller/
// modbus_controller.h + .cpp, esphome/dev branch -- "2026.8.2" as pinned
// in toolchain.lock.json does not exist as a real tag; verified against
// the real, current dev-branch source instead, stated as a limitation):
// ModbusCommandItem has THREE response-handling virtuals, not one --
//   on_response(...)  -- success: calls on_data_func(register_type,
//     start_address, data), where `data` is already
//     modbus::helpers::server_pdu_payload(response_pdu) -- the framework
//     has ALREADY stripped address/function-code/CRC before this project's
//     callback ever sees it. Safe to treat as this register's own raw
//     payload bytes directly; never a raw Modbus frame.
//   on_error(...)     -- a genuine Modbus EXCEPTION response: logs via
//     ESP_LOGW and unqueues the command. Does NOT call on_data_func.
//   on_no_response(...) -- timeout: increments the controller's own
//     non-response counter and may return true to have the hub silently
//     RE-QUEUE the same frame for a retry (gated on the hub's own
//     can_send()) before ever giving up -- one call to queue_command() on
//     this project's side can correspond to more than one wire-level
//     attempt underneath, invisible to this project's own code.
// Both on_error and a fully-exhausted on_no_response leave on_data_func
// uncalled -- from this project's own on_data_func-only callback style,
// a genuine Modbus exception and a plain no-response timeout are
// currently indistinguishable; both surface only as "no callback arrived
// within our own deadline". Reaching on_error/on_no_response directly
// would require subclassing ModbusCommandItem (they are fixed virtual
// overrides, not settable std::function fields on the object
// create_read_command() returns) -- a larger, compiler-unverifiable
// change this pass deliberately does not attempt; vendor files are not
// patched either way.
enum AttemptOutcome : uint8_t {
  ATTEMPT_NOT_ATTEMPTED = 0,
  ATTEMPT_QUEUED_WAITING = 1,
  ATTEMPT_RESPONSE_OK = 2,
  ATTEMPT_RESPONSE_LENGTH_MISMATCH = 3,
  ATTEMPT_DEADLINE_EXPIRED_NO_DATA_CALLBACK = 4,
};

inline constexpr const char *const ATTEMPT_OUTCOME_NAMES[5] = {
  "NOT_ATTEMPTED", "QUEUED_WAITING", "RESPONSE_OK", "RESPONSE_LENGTH_MISMATCH",
  "DEADLINE_EXPIRED_NO_DATA_CALLBACK"
};

// Pure classification for an ACTUAL callback firing (never called for the
// deadline-expired/no-callback case -- that is a direct, unclassified
// assignment at the call site, nothing to classify since no data exists).
// EXACT match, not a floor (2026-09-18, user-directed corrective pass --
// "не приймай зайві байти мовчки"): for a fixed-register_count FC03 read,
// the framework's own contract (modbus_controller.cpp's on_response calls
// on_data_func with modbus::helpers::server_pdu_payload(response_pdu),
// sized by the response the device actually sent for the requested
// register_count) makes any byte count other than exactly bytes_expected
// a real anomaly worth surfacing as RESPONSE_LENGTH_MISMATCH, not silently
// accepted as success -- this previously masked the CellConWireRes0-31
// register-count bug (a response long enough to clear a ">=" floor would
// have read as success even while carrying the wrong quantity of data).
inline AttemptOutcome classify_response(size_t bytes_received, size_t bytes_expected) {
  return bytes_received == bytes_expected ? ATTEMPT_RESPONSE_OK : ATTEMPT_RESPONSE_LENGTH_MISMATCH;
}

// Does a callback belonging to `callback_generation` still correspond to
// the attempt this project is CURRENTLY tracking (`pending_generation`)?
// A late callback for an attempt already recorded as deadline-expired
// must never be misattributed to a newer attempt's own bookkeeping. The
// caller captures its own generation id BY VALUE into the (otherwise
// captureless-by-this-project's-own-convention) response lambda -- an
// ordinary, safe std::function capture (the id is copied into the
// closure, no dangling reference), not a framework hook.
inline bool callback_matches_pending_attempt(uint32_t callback_generation, uint32_t pending_generation) {
  return callback_generation == pending_generation;
}

}  // namespace jk_capability
