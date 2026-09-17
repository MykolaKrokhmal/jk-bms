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

}  // namespace jk_capability
