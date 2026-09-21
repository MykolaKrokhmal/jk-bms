#pragma once
// jk_write_tx_core.h -- pure, hardware-independent state machine for the
// generic RW-register write -> ACK -> forced-readback transaction manager
// (spec section "4.1. Єдиний backend transaction manager для всіх RW-
// регістрів"). No ESPHome, no Modbus, no I/O of any kind -- the caller
// (batterylifepo4.yaml's set_action/interval lambdas) owns issuing the
// actual Modbus write/read commands and feeds this module only
// timestamps and the resulting booleans/values. That split is what makes
// this desktop-testable without ESP-IDF or real hardware -- see
// test/jk_write_tx/test_jk_write_tx_core.cpp.
//
// This module intentionally does NOT replace the CellCount transaction
// (batterylifepo4.yaml's own jk_topology 250ms interval): CellCount's
// "readback" is "the topology resolver reaches CONFIRMED with the
// requested effective_cell_count", not a simple register echo, so it
// keeps its own bespoke, already-tested driver. Every OTHER RW register
// (numeric configuration values, packed sub-fields, the charging/
// discharging/balancing control selects, the setup passcode) uses THIS
// generic manager instead of the old fire-and-forget
// write_bms_u32/write_bms_u16 scripts, which never confirmed a write
// against anything -- component.update on a modbus_controller sensor is
// a no-op (ModbusSensor never overrides Component::update()), so the
// pre-existing UI's apparent "confirmation" was really just whatever the
// entity's own slow background poll cadence (skip_updates, up to
// several minutes) next happened to report.

#include <array>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>

namespace jk_write_tx {

enum Status : uint8_t {
  IDLE = 0,
  SENDING = 1,
  ACK_WAIT = 2,
  READBACK_WAIT = 3,
  CONFIRMED = 4,
  MISMATCH = 5,
  // Not emitted by tick() itself -- reserved so a caller that layers
  // extra semantics on top (the way resolve_topology folds CellCount's
  // ACK_TIMEOUT/READBACK_TIMEOUT into topology WRITE_UNCERTAIN) can reuse
  // the same numeric status-code space the frontend already understands.
  WRITE_UNCERTAIN = 6,
  ACK_TIMEOUT = 7,
  READBACK_TIMEOUT = 8,
  REJECTED = 9,
  // Third critical audit (2026-09-10, item 7): also not emitted by tick()
  // itself. The generic write manager's caller (batterylifepo4.yaml's
  // 250ms servicer) reclassifies a slot that just hit ACK_TIMEOUT/
  // READBACK_TIMEOUT into WRITE_UNCERTAIN, then launches an independent
  // recovery readback (mirroring CellCount's own bespoke uncertainty-
  // recovery probe) instead of just reporting a plain completed error --
  // the write may have silently taken effect even though its ACK or
  // forced readback never arrived. These two codes are the ONLY way such
  // a slot may leave WRITE_UNCERTAIN: RECOVERED_CONFIRMED means the
  // recovery read matched what was requested (the write DID apply,
  // just unconfirmed at the time); RECOVERED_MISMATCH means it read back
  // something else (the write did not apply, or applied differently).
  RECOVERED_CONFIRMED = 10,
  RECOVERED_MISMATCH = 11,
};

constexpr uint32_t DEFAULT_ACK_TIMEOUT_MS = 3000;
constexpr uint32_t DEFAULT_READBACK_TIMEOUT_MS = 4000;

struct Slot {
  bool in_use = false;
  uint32_t tx_id = 0;
  uint16_t address = 0;
  // How many 16-bit holding registers this write/readback spans (1 or 2 in
  // this project -- every RW register here is either a u16 or a packed/u32
  // pair). The caller uses this to size the forced re-read command.
  uint8_t word_count = 1;
  uint32_t requested_raw = 0;
  uint32_t readback_raw = 0;
  // Only the bits set in compare_mask are checked on readback -- a packed
  // register (two logical sub-fields sharing one 16-bit word, e.g.
  // lcd_buzzer_trigger_source and dry_contact_1_trigger_source both at
  // 0x14E4) must not be declared MISMATCH just because its OTHER half
  // changed between write and readback.
  uint32_t compare_mask = 0xFFFFFFFFu;
  uint8_t status = IDLE;
  uint32_t started_ms = 0;
  bool acked = false;
  uint32_t readback_started_ms = 0;
  bool readback_done = false;
  // Set by the caller (not by tick()) the moment a slot reaches a
  // terminal status, so the caller can free/reuse the slot after a short
  // grace period (long enough for a client that fetches the JSON
  // snapshot via a plain HTTP request, not just SSE, to still observe
  // the terminal result) instead of either freeing it instantly (racing
  // a slow client) or never freeing it (starving future writes).
  uint32_t finished_ms = 0;
  // The setup passcode must never surface its written/readback raw value
  // to a client (the read lambda already always returns a masked
  // "****************"); the transaction still tracks ACK/readback
  // internally so a genuine failure is still reported, it just never
  // exposes requested_raw/readback_raw in the published JSON snapshot.
  bool suppress_value = false;
  // Third critical audit (2026-09-10, item 6): bumped by begin() every
  // time this slot index is (re)used for a NEW transaction. The Modbus
  // ACK/readback callbacks the caller registers close over a slot INDEX,
  // not a C++ reference (see jk_write_tx_core.h's own module comment —
  // storage lives in parallel arrays, not a real Slot object) — a late
  // callback belonging to an OLD transaction at that same index must
  // never mutate a NEWER one that has since reused it. The caller
  // captures {idx, tx_id, address, generation} at command-issue time and
  // verifies ALL FOUR still match before writing anything back (tx_id and
  // address are redundant with generation in the current caller, kept
  // because the raw wire callback already has them cheaply available and
  // an explicit belt-and-suspenders check is cheap insurance against a
  // future refactor that loosens the generation check alone).
  uint32_t generation = 0;
};

inline bool compare_masked(uint32_t requested, uint32_t readback, uint32_t mask) {
  return (requested & mask) == (readback & mask);
}

inline bool is_pending(uint8_t status) {
  // Third critical audit (2026-09-10, item 7): WRITE_UNCERTAIN counts as
  // pending too -- a slot the caller has reclassified into recovery must
  // keep blocking a new write to the SAME address (begin()'s single-
  // flight guard, below) exactly like a genuinely in-flight transaction,
  // until the recovery probe resolves it to RECOVERED_CONFIRMED/
  // RECOVERED_MISMATCH (neither of which is "pending" -- the address
  // becomes writable again the instant recovery finishes, same as any
  // other terminal status).
  return status == SENDING || status == ACK_WAIT || status == READBACK_WAIT || status == WRITE_UNCERTAIN;
}

// Starts a new transaction in a free slot. Enforces the single-flight-
// per-register-address policy (spec: "одночасно для одного register key
// дозволено лише одну транзакцію") -- a second write to an address
// already tracked by a PENDING slot is rejected outright (returns -1),
// exactly like set_cell_count's own g_cellcount_tx_pending guard, rather
// than silently interleaving with or overwriting the in-flight one. A
// slot that already reached a TERMINAL status (CONFIRMED/MISMATCH/
// ACK_TIMEOUT/READBACK_TIMEOUT) but is still `in_use` -- kept alive
// briefly only so a client reading the snapshot can still observe the
// result, see the caller's own grace-period comment -- does NOT block a
// new write to that same address; single-flight guards against two
// writes racing each other, not against writing again after the first
// one has already finished. Such a lingering terminal slot for the SAME
// address is immediately reused/superseded by the new transaction
// (rather than requiring a separate free slot) -- a client watching the
// snapshot simply sees that address's entry move from the old tx_id's
// terminal status to the new tx_id's SENDING, exactly as if a fresh slot
// had been used.
template <size_t N>
int begin(std::array<Slot, N> &slots, uint32_t &next_tx_id, uint16_t address,
          uint8_t word_count, uint32_t requested_raw, uint32_t compare_mask, uint32_t now_ms,
          bool suppress_value = false) {
  for (size_t i = 0; i < N; i++) {
    if (slots[i].in_use && slots[i].address == address) {
      if (is_pending(slots[i].status)) return -1;
      // Terminal slot for this same address -- fall through and let the
      // second loop below pick THIS exact index back up (it is the only
      // slot allowed to be reused while still `in_use`).
      slots[i].in_use = false;
    }
  }
  for (size_t i = 0; i < N; i++) {
    if (!slots[i].in_use) {
      const uint32_t prior_generation = slots[i].generation; // preserved across reuse -- see Slot::generation's own comment
      Slot fresh;
      fresh.in_use = true;
      fresh.tx_id = ++next_tx_id;
      fresh.address = address;
      fresh.word_count = word_count;
      fresh.requested_raw = requested_raw;
      fresh.compare_mask = compare_mask;
      fresh.status = SENDING;
      fresh.started_ms = now_ms;
      fresh.suppress_value = suppress_value;
      fresh.generation = prior_generation + 1;
      slots[i] = fresh;
      return int(i);
    }
  }
  return -1; // every slot busy -- caller should log and the write is REJECTED, not queued silently
}

struct TickResult {
  bool issue_readback = false; // caller must now send the forced Modbus re-read for this slot
  bool terminal = false;       // slot reached CONFIRMED/MISMATCH/ACK_TIMEOUT/READBACK_TIMEOUT this tick
};

// Advances one slot by one tick. Pure decision logic: never touches
// hardware. The caller supplies acked/readback_done/readback_raw via the
// Slot fields (set from the Modbus command's on_data_func) BEFORE calling
// tick() each interval pass.
inline TickResult tick(Slot &s, uint32_t now_ms,
                        uint32_t ack_timeout_ms = DEFAULT_ACK_TIMEOUT_MS,
                        uint32_t readback_timeout_ms = DEFAULT_READBACK_TIMEOUT_MS) {
  TickResult r;
  if (!s.in_use) return r;

  if (s.status == SENDING) s.status = ACK_WAIT;

  if (s.status == ACK_WAIT) {
    if (s.acked) {
      s.status = READBACK_WAIT;
      s.readback_started_ms = now_ms;
      r.issue_readback = true;
      return r;
    }
    if (now_ms - s.started_ms > ack_timeout_ms) {
      s.status = ACK_TIMEOUT;
      r.terminal = true;
    }
    return r;
  }

  if (s.status == READBACK_WAIT) {
    if (s.readback_done) {
      const bool matches = compare_masked(s.requested_raw, s.readback_raw, s.compare_mask);
      s.status = matches ? CONFIRMED : MISMATCH;
      r.terminal = true;
      return r;
    }
    if (now_ms - s.readback_started_ms > readback_timeout_ms) {
      s.status = READBACK_TIMEOUT;
      r.terminal = true;
    }
    return r;
  }

  return r; // already terminal -- caller frees the slot explicitly once consumed
}

// ---------------------------------------------------------------------------
// Stage 4 (typed-petting-puzzle plan §5 Phase 4): real packed read-modify-
// write encode/merge core. Pure, hardware-independent, unit-tested (see
// test/jk_write_tx/test_jk_write_tx_rmw_core.cpp) -- exactly the same split
// as the rest of this file: this module never touches hardware or globals,
// the generated write-registry YAML servicer (batterylifepo4.yaml) owns
// fetching the fresh raw snapshot, calling these functions, and issuing the
// actual FC06/FC16 write with the result.
//
// The mandatory sequence this module supports (spec steps 1-13):
//   1-2 (authorization/state/freshness) -- see raw_is_fresh() below; the
//       caller itself checks authorization/safety-policy/single-flight
//       (jk_write_tx::begin()'s own single-flight guard) before ever
//       reaching this module.
//   3   (reject stale/unavailable/wrong-generation RAW) -- raw_is_fresh().
//   4-5 (validate + encode the user value) -- encode_numeric_field().
//   6   (merged_raw = (old_raw & ~mask) | ((encoded << shift) & mask)) --
//       merge_field_into_raw().
//   7   (snapshot old_raw/mask/siblings/generation before write) -- the
//       caller's own responsibility (capture BEFORE calling begin()), same
//       pattern as the existing {idx, tx_id, address, generation} capture
//       jk_write_tx::begin()'s own caller already uses for ACK/readback.
//   12  (siblings/reserved bits preserved) -- verify_sibling_bits_preserved()
//       (a readback-time check, mirrors compare_masked() for the TARGET
//       bits, mirrored here for the COMPLEMENT of mask).
// ---------------------------------------------------------------------------

// Step 3: a cached raw snapshot is usable for RMW only if it is fresh
// (updated within freshness_budget_ms of now), belongs to a real successful
// read (last_success_ms != 0 -- a block that has NEVER once succeeded since
// boot must never be treated as "just stale", it is genuinely unavailable),
// and was not captured while some OTHER transaction already owns this
// physical register (checked by the caller via jk_write_tx::is_pending() on
// any existing slot for the same address, before ever calling begin()).
inline bool raw_is_fresh(uint32_t last_success_ms, uint32_t now_ms, uint32_t freshness_budget_ms) {
  if (last_success_ms == 0) return false; // never once succeeded -- unavailable, not stale
  if (now_ms < last_success_ms) return false; // clock rolled over/inconsistent -- fail closed, never trust
  return (now_ms - last_success_ms) <= freshness_budget_ms;
}

enum class EncodeStatus : uint8_t {
  OK = 0,
  NOT_FINITE = 1,       // NaN/Infinity
  OUT_OF_RANGE = 2,     // outside [minimum, maximum]
  OVERFLOWS_FIELD = 3,  // encoded integer does not fit in field_width_bits (signed or unsigned)
};

struct EncodeResult {
  EncodeStatus status = EncodeStatus::NOT_FINITE;
  uint32_t encoded_raw = 0; // the field's own bit pattern, right-aligned at bit 0 (NOT yet shifted into place)
};

// Step 4-5: validate a user-supplied decoded value against this field's own
// range/scale/signedness, then encode it to its raw integer bit pattern.
// scale/offset follow this project's existing convention throughout
// jk_poll_scheduler_core.h's own decode path: decoded = raw * scale +
// offset, so encoding inverts it: raw = round((decoded - offset) / scale).
// field_width_bits bounds the overflow check (a 1-bit field's encoded_raw
// must be 0 or 1, an 8-bit field's [0,255] unsigned or [-128,127] signed,
// etc.) -- checked AFTER the scale/offset inversion, independent of
// minimum/maximum (which are this field's own PROTOCOL-level domain bound,
// a separate, typically tighter check than "does it fit in the wire type").
inline EncodeResult encode_numeric_field(double decoded_value, bool is_signed, double scale, double offset,
                                          double minimum, double maximum, uint8_t field_width_bits) {
  EncodeResult r;
  if (!std::isfinite(decoded_value)) {
    r.status = EncodeStatus::NOT_FINITE;
    return r;
  }
  if (decoded_value < minimum || decoded_value > maximum) {
    r.status = EncodeStatus::OUT_OF_RANGE;
    return r;
  }
  const double raw_d = scale != 0.0 ? std::round((decoded_value - offset) / scale) : 0.0;
  if (!std::isfinite(raw_d)) {
    r.status = EncodeStatus::NOT_FINITE;
    return r;
  }
  if (is_signed) {
    const int64_t raw_i = static_cast<int64_t>(raw_d);
    const int64_t lo = field_width_bits >= 64 ? INT64_MIN : -(int64_t(1) << (field_width_bits - 1));
    const int64_t hi = field_width_bits >= 64 ? INT64_MAX : (int64_t(1) << (field_width_bits - 1)) - 1;
    if (raw_i < lo || raw_i > hi) {
      r.status = EncodeStatus::OVERFLOWS_FIELD;
      return r;
    }
    // Right-aligned two's-complement bit pattern, masked to field_width_bits.
    const uint64_t mask = field_width_bits >= 64 ? ~uint64_t(0) : ((uint64_t(1) << field_width_bits) - 1);
    r.encoded_raw = uint32_t(uint64_t(raw_i) & mask);
  } else {
    if (raw_d < 0.0) {
      r.status = EncodeStatus::OVERFLOWS_FIELD;
      return r;
    }
    const uint64_t raw_u = static_cast<uint64_t>(raw_d);
    const uint64_t maxu = field_width_bits >= 64 ? ~uint64_t(0) : ((uint64_t(1) << field_width_bits) - 1);
    if (raw_u > maxu) {
      r.status = EncodeStatus::OVERFLOWS_FIELD;
      return r;
    }
    r.encoded_raw = uint32_t(raw_u);
  }
  r.status = EncodeStatus::OK;
  return r;
}

// Step 6: encoded_bits = (encoded_raw << shift) & mask; merged_raw =
// (old_raw & ~mask) | encoded_bits. For a full-width field (mask ==
// 0xFFFFFFFF, e.g. every write_uses_read_modify_write=false field), this
// degenerates to merged_raw == encoded_bits -- the "no unnecessary merge"
// case the spec calls out for direct full-width writes, produced by the
// SAME function rather than a separate code path, so both kinds of write
// share one tested implementation.
inline uint32_t merge_field_into_raw(uint32_t old_raw, uint32_t mask, uint8_t shift, uint32_t encoded_raw) {
  const uint32_t encoded_bits = (encoded_raw << shift) & mask;
  return (old_raw & ~mask) | encoded_bits;
}

// Step 12 (readback verification, sibling half): the bits OUTSIDE mask in
// the readback must equal the bits OUTSIDE mask that were present in the
// pre-write old_raw snapshot -- proof that this write did not disturb any
// packed sibling or reserved bit. (The bits INSIDE mask matching what was
// requested is already jk_write_tx::compare_masked()'s own job, called with
// the SAME mask -- this function is its deliberate complement, not a
// replacement.)
inline bool verify_sibling_bits_preserved(uint32_t old_raw, uint32_t readback_raw, uint32_t mask) {
  return (old_raw & ~mask) == (readback_raw & ~mask);
}

// ---------------------------------------------------------------------------
// Width-aware register-container semantics (2026-09-21, hardware-acceptance
// corrective pass): a real, LIVE preflight against gps_heartbeat found
// RegisterWritePreflightHandler (batterylifepo4.yaml) reporting
// preservation_mask as the UNBOUNDED 32-bit complement of a 16-bit field's
// own mask ("0xFFFFFFFB" truncated by a too-small hex buffer down to the
// nonsensical "0xFFFFF") -- this project's every generic write-registry
// entry with word_count=1 is a REAL 16-bit Modbus holding register; a raw
// `~mask` computed over the full 32-bit uint32_t silently claims bits 16-31
// exist and are "preserved siblings" of a register that is physically only
// 16 bits wide. This isn't only a display bug: sibling_bits_expected_after
// was also being copied directly from sibling_bits_before instead of ever
// being derived from merged_raw, so the preflight could never actually
// prove sibling preservation from the SAME arithmetic a real write performs
// (it only asserted the input was unchanged, trivially true).
//
// This module fixes both, fail-closed, and pure/hardware-independent like
// everything else in this file -- see
// test/jk_write_tx/test_jk_write_tx_preflight_geometry.cpp. It intentionally
// does NOT change begin_write_tx_rmw/merge_field_into_raw/the real write
// execution path at all: for every currently-eligible RMW field, mask
// itself already never sets a bit outside the register's own real width
// (the generator only ever emits masks derived from real
// field_width_bits/shift within a real 16- or 32-bit register), so the
// ACTUAL merge arithmetic a write performs was never wrong -- only this
// diagnostic endpoint's OWN preservation_mask/sibling_bits_expected_after
// fields, and their hex string formatting, were.

// Only word_count 1 (a single 16-bit Modbus holding register) and 2 (a
// 32-bit register pair, big-endian high-word-first per this project's own
// byte_order/word_order convention) are real container widths this
// project's generated write registry has ever produced. Any other
// word_count reaching this function is a genuine data/generation
// inconsistency -- fail closed (UNSUPPORTED_WORD_COUNT) rather than
// silently defaulting to a 32-bit container that may not physically exist.
enum class ContainerWidthStatus : uint8_t { OK = 0, UNSUPPORTED_WORD_COUNT = 1 };

struct ContainerWidthResult {
  ContainerWidthStatus status = ContainerWidthStatus::UNSUPPORTED_WORD_COUNT;
  uint32_t container_mask = 0;  // all bits the register PHYSICALLY has, e.g. 0x0000FFFF for word_count=1
};

inline ContainerWidthResult container_mask_for_word_count(uint8_t word_count) {
  ContainerWidthResult r;
  if (word_count == 1) {
    r.status = ContainerWidthStatus::OK;
    r.container_mask = 0x0000FFFFu;
  } else if (word_count == 2) {
    r.status = ContainerWidthStatus::OK;
    r.container_mask = 0xFFFFFFFFu;
  }
  return r;
}

// Validates a field's own declared mask/shift against its container's real
// physical width, fail-closed on any of: a zero mask (nothing to write),
// a mask claiming a bit outside the container (the exact class of bug this
// pass fixes -- the caller must never silently narrow raw_mask to fit, that
// would hide a real authoring error), or a shift that does not actually
// land on a set bit of the mask (this project's generator always derives
// shift and mask from the SAME field_width_bits/byte_offset, so a mismatch
// here means real corruption upstream, not a normal/expected case).
enum class FieldGeometryStatus : uint8_t {
  OK = 0,
  ZERO_MASK = 1,
  MASK_EXCEEDS_CONTAINER = 2,
  SHIFT_MASK_MISMATCH = 3,
};

struct FieldGeometryResult {
  FieldGeometryStatus status = FieldGeometryStatus::ZERO_MASK;
  uint32_t field_mask = 0;         // == raw_mask, once validated -- never silently narrowed
  uint32_t preservation_mask = 0;  // container_mask & ~field_mask -- every OTHER real, physical bit
};

inline FieldGeometryResult validate_field_geometry(uint32_t raw_mask, uint8_t shift, uint32_t container_mask) {
  FieldGeometryResult r;
  if (raw_mask == 0) {
    r.status = FieldGeometryStatus::ZERO_MASK;
    return r;
  }
  if ((raw_mask & ~container_mask) != 0) {
    r.status = FieldGeometryStatus::MASK_EXCEEDS_CONTAINER;
    return r;
  }
  if (shift >= 32 || ((uint64_t(1) << shift) & raw_mask) == 0) {
    r.status = FieldGeometryStatus::SHIFT_MASK_MISMATCH;
    return r;
  }
  r.status = FieldGeometryStatus::OK;
  r.field_mask = raw_mask;
  r.preservation_mask = container_mask & ~raw_mask;
  return r;
}

// Formats `value` as "0x" followed by EXACTLY `hex_digits` hex digits
// (never fewer -- zero-padded -- and never silently truncated: `buf_size`
// must be at least hex_digits+3; this is asserted by the caller always
// passing a real, sized buffer, never re-derived here). Replaces the
// previous fixed `char hexbuf[8]` + literal "0x%04X" pattern, which
// silently truncated any value needing more than 4 hex digits (exactly
// the bug this pass fixes) -- callers must size their buffer for the
// widest field they will ever format with it (a word_count=2 entry needs
// 8 digits: "0xFFFFFFFF" + NUL = 11 bytes minimum).
inline void format_hex_fixed_width(char *buf, size_t buf_size, uint32_t value, int hex_digits) {
  std::snprintf(buf, buf_size, "0x%0*X", hex_digits, unsigned(value));
}

// hex_digits for a value that is itself bounded by container_mask (mask,
// preservation_mask, encoded_target_bits, merged_raw-as-hex if ever
// needed): 4 digits for a 16-bit container (word_count=1), 8 for a 32-bit
// one (word_count=2) -- the exact "0xFFFB not 0xFFFFFFFB for a 16-bit
// register" contract this pass establishes.
inline int hex_digits_for_word_count(uint8_t word_count) { return word_count == 2 ? 8 : 4; }

// ---------------------------------------------------------------------------
// HTTP-task-to-main-loop handoff mailboxes (2026-09-21, post-reboot
// hardware-acceptance audit). Real, direct source evidence (this
// project's own audit report -- fetched and grepped against ESPHome
// 2026.8.2 / ESP-IDF 5.5.5's actual pinned source, not assumed) confirms
// two facts together make the PREVIOUS production path unsafe:
//   1. AsyncWebServer's HTTP handlers (esphome/components/web_server_idf/
//      web_server_idf.cpp: AsyncWebServer::request_handler_() calls
//      handler->handleRequest(request) directly) execute on the ESP-IDF
//      httpd server's OWN FreeRTOS task, registered via
//      httpd_register_uri_handler() -- never on ESPHome's main loop task.
//   2. modbus_controller::queue_command() (esphome/components/
//      modbus_controller/modbus_controller.cpp) mutates a plain,
//      unsynchronized std::vector (one_shot_command_items_) that the
//      main loop's own update()/sweep cycle ALSO mutates -- no mutex
//      anywhere in that class.
// Calling begin_write_tx_rmw/begin_write_tx (which reaches queue_command)
// directly from a handleRequest() therefore mutates that vector from two
// different FreeRTOS tasks with no synchronization at all -- a real,
// evidenced data race on a non-atomic STL container, a well-established
// crash mechanism (heap/vector corruption -> hard fault/abort -> ESP-IDF
// panic handler -> esp_restart()) consistent with (though, absent a
// captured crash log, not provably THE exclusive cause of) this
// project's own observed reboot.
//
// ESPHome's own codebase already establishes the framework-sanctioned
// fix for exactly this class of problem: esphome/core/scheduler.cpp's
// set_timer_common_() always takes a real mutex (LockGuard{this->lock_})
// before touching shared state, and esphome/core/component.h's
// enable_loop_soon_any_context() is explicitly documented "Thread and
// ISR-safe... defers the actual [mutation] to the main loop, making it
// safe to call from ISR handlers, timer callbacks, other threads" --
// ESPHome's own AsyncEventSource (SSE) implementation uses the identical
// pattern for its own cross-task problem ("Httpd task: set up the live
// httpd_req_t and park the session [under pending_mutex_]; main loop
// does the rest.").
//
// These two single-slot mailboxes are this project's own version of
// that same pattern: the HTTP handler (any task) only ever does safe,
// task-local work (constexpr table lookup, pure encode/validate
// functions, and a lock-free atomic publish into the REQUEST mailbox);
// only the main loop (a normal interval:, the one place ESPHome's own
// component/Modbus APIs are safe to call) ever reads a staged request,
// re-validates it fully, and actually dispatches the write -- publishing
// its outcome into the RESULT mailbox, which the HTTP status-poll
// handler (any task) reads back, lock-free, for the client. Pure
// std::atomic<uint8_t> state machines, no FreeRTOS/ESP-IDF dependency --
// desktop-testable, see test/jk_write_tx/test_jk_write_tx_mailbox.cpp.
// ---------------------------------------------------------------------------

constexpr std::size_t kRegisterWriteKeyMaxLen = 40;
constexpr std::size_t kRegisterWriteReasonMaxLen = 64;

inline void copy_bounded_cstr(char *dst, std::size_t dst_size, const char *src) {
  std::size_t n = 0;
  while (src != nullptr && src[n] != '\0' && n + 1 < dst_size) {
    dst[n] = src[n];
    n++;
  }
  dst[n] = '\0';
}

// Request mailbox: HTTP task (producer, any number of callers, though
// this project only ever has one) -> main loop (sole consumer).
struct RegisterWriteRequestMailbox {
  // 0 = EMPTY (free for a new request), 1 = STAGED (a producer published
  // a request, not yet consumed), 2 = BUSY (a producer or the consumer
  // currently holds exclusive field access -- never externally visible
  // for more than the few instructions it takes to copy fields).
  std::atomic<uint8_t> state{0};
  uint32_t request_id = 0;
  char key[kRegisterWriteKeyMaxLen] = {0};
  double value = 0.0;
  uint32_t submitted_at_ms = 0;
};

// Producer side (safe from ANY task/context, including concurrent
// producers on different tasks -- this project's own real deployment is
// single-producer, but the counter itself is a real std::atomic so this
// never relies on that as a hidden safety assumption). Returns 0
// (rejected -- a request's FULL lifecycle, staged through published, is
// already in flight; single-flight, the caller must report this to its
// own client rather than overwrite or queue a second one) or the newly
// assigned request_id (always > 0) on success.
//
// Second corrective pass (Blocker 2, 2026-09-21): `pending_id` is now the
// SOLE, authoritative single-flight gate, reserved via a real CAS(0 ->
// new_id) BEFORE anything else -- not merely set as a side effect after
// the mailbox's own state CAS succeeded. The previous version relied on
// the request MAILBOX's own EMPTY/STAGED/BUSY state as the single-flight
// guard and only unconditionally stored the new id into `pending_id`
// afterward; that is a real, exploitable gap: try_take_write_request()
// (below) frees the mailbox back to EMPTY the instant the main loop takes
// a request, WELL BEFORE that request's own publish_write_result() ever
// runs. In that window (taken, not yet published) the mailbox looks free
// again, so a SECOND POST could stage a brand-new request B -- and the
// old code's unconditional `pending_id.store(id_b, ...)` would silently
// overwrite request A's still-outstanding pending marker. A status poll
// for A landing in that exact window would then find A in neither the
// result table (not published yet) nor as the current `pending_id`
// (clobbered by B) -- a false UNKNOWN for a request that was genuinely,
// still being processed. Reserving `pending_id` itself via CAS, and
// gating staging on that CAS succeeding, closes this: as long as
// `pending_id` still holds A's id (true from A's own successful CAS
// reservation until publish_write_result(A) clears it via ITS OWN CAS for
// exactly that id -- see that function's own comment), no other
// request_id can ever win the reservation CAS below, so B's stage attempt
// is rejected outright, request_id/tx_id are never allocated for it, and
// the mailbox is never even touched for B. `pending_id` stays SOLELY
// owned by A across the take()-to-publish() gap; the mailbox's own state
// machine is now purely a producer->consumer data channel, not a
// lifecycle guard.
//
// Every payload byte the mailbox carries (key/value/submitted_at_ms) is
// still only ever written by the single reservation-holding producer, so
// no new synchronization is needed there beyond the mailbox's own
// existing state CAS.
inline uint32_t try_stage_write_request(RegisterWriteRequestMailbox &mbox, const char *key, double value,
                                         uint32_t now_ms, std::atomic<uint32_t> &next_id_counter,
                                         std::atomic<uint32_t> &pending_id) {
  // Ids are allowed to have gaps (this project's own wraparound-tolerant
  // design already documents this, see lookup_write_result()'s own
  // module comment) -- allocating one here, before we know whether the
  // reservation below will actually succeed, can occasionally "waste" an
  // id under real concurrent contention (this project's own real
  // deployment has exactly one producer task, so in practice this never
  // happens); that is a strictly acceptable, already-anticipated
  // tradeoff for keeping this reservation a single, simple CAS instead of
  // a two-phase sentinel-then-real-id scheme.
  const uint32_t id = next_id_counter.fetch_add(1, std::memory_order_relaxed) + 1;

  uint32_t expected_pending = 0;
  if (!pending_id.compare_exchange_strong(expected_pending, id, std::memory_order_seq_cst, std::memory_order_seq_cst)) {
    return 0;  // another request's full lifecycle is still in flight -- reject, nothing else touched
  }

  uint8_t expected_mbox = 0;  // EMPTY
  if (!mbox.state.compare_exchange_strong(expected_mbox, 2, std::memory_order_acquire)) {
    // Should be unreachable under the invariant above -- `pending_id`'s
    // own CAS is now the sole single-flight gate, so at most one producer
    // can ever reach this point at a time, and the mailbox is always
    // freed (by try_take_write_request(), below) strictly before
    // `pending_id` is ever cleared (by publish_write_result()), so a
    // fresh reservation should always find the mailbox genuinely EMPTY.
    // Kept as fail-closed defense-in-depth, never assumed impossible:
    // roll back the reservation so a mailbox stuck for any other reason
    // can never wedge single-flight permanently.
    uint32_t expected_rollback = id;
    pending_id.compare_exchange_strong(expected_rollback, 0, std::memory_order_seq_cst, std::memory_order_seq_cst);
    return 0;
  }
  mbox.request_id = id;
  copy_bounded_cstr(mbox.key, sizeof(mbox.key), key);
  mbox.value = value;
  mbox.submitted_at_ms = now_ms;
  mbox.state.store(1, std::memory_order_release);  // STAGED -- publish to the consumer
  return id;
}

// Consumer side (main loop ONLY): if a request is staged, atomically
// claims and copies it out, leaving the slot empty for the next
// producer. Returns false (out left untouched) if nothing is staged.
inline bool try_take_write_request(RegisterWriteRequestMailbox &mbox, RegisterWriteRequestMailbox &out) {
  uint8_t expected = 1;  // STAGED
  if (!mbox.state.compare_exchange_strong(expected, 2, std::memory_order_acquire)) {
    return false;
  }
  out.request_id = mbox.request_id;
  copy_bounded_cstr(out.key, sizeof(out.key), mbox.key);
  out.value = mbox.value;
  out.submitted_at_ms = mbox.submitted_at_ms;
  mbox.state.store(0, std::memory_order_release);  // EMPTY -- free for the next producer
  return true;
}

// ---------------------------------------------------------------------------
// Result mailbox REPLACEMENT (2026-09-21, second corrective pass): a code
// review of the mailbox above (RegisterWriteResultMailbox / publish_write_
// result / try_read_write_result) found it is NOT a valid C++ seqlock,
// despite the "before/after state re-check" comment claiming otherwise.
// [intro.races] makes concurrent read+write of a NON-atomic object (here:
// request_id, accepted, tx_id, reason[]) undefined behavior REGARDLESS of
// whether the reader later discards the value on a state mismatch -- the
// UB happens at the moment of the racing access itself, not at the point
// the (possibly torn) result is used. A single atomic `state` guard around
// non-atomic payload fields does not make those fields' accesses atomic.
//
// Fix: every payload field the reader touches is now itself a REAL
// std::atomic, so every individual access is well-defined regardless of
// interleaving (no UB is possible, full stop) -- the `version` recheck
// below is then only a LOGICAL consistency check (catching a reader that
// straddled the writer publishing a NEWER, different result), never a
// memory-safety requirement. This is the same proof technique C++'s own
// std::seq_lock proposals (P0290/P1478) use: atomic payload + generation
// recheck = defined behavior; non-atomic payload + generation recheck =
// UB no matter how careful the recheck is.
//
// Third corrective pass (2026-09-21): memory order tightened to
// memory_order_seq_cst for `version` AND every payload field's stores and
// loads, in both publish_write_result() and lookup_write_result(). The
// previous version used relaxed payload operations plus release/acquire
// on `version` alone -- individually well-defined (no UB), but NOT a
// simple, self-contained cross-object proof of consistency: with plain
// release/acquire, the only guarantee is a per-variable happens-before
// edge through whichever single atomic carries it; nothing in the C++
// memory model then forbids a reader's relaxed loads of the OTHER
// (payload) atomics from being reordered, by the compiler or the
// hardware, relative to its own acquire-load of `version` in a way that
// a change to a payload field becomes visible to a reader before that
// reader's own re-check of `version` reflects it. This is a genuinely
// low-frequency control path (a handful of publishes per second at
// most), so raw throughput is irrelevant here -- the correct choice is
// the simplest, most directly provable one: seq_cst forces a single
// global total order over every one of these operations, so "the
// payload reads happened, and the version recheck afterward still saw
// the same value" is now a straightforward, whole-program sequencing
// argument, not a per-variable happens-before chain that still needs a
// separate reordering argument stitched on top. Do not "optimize" this
// back down to acquire/release without an equally simple, equally
// convincing replacement proof -- see this project's own working-style
// policy on premature optimization.
//
// `reason` changes from a free-form char[64] to a small, bounded
// RejectReason enum (one std::atomic<uint8_t>, trivially race-free) plus a
// static lookup table for display text -- this project's own rejection
// reasons are already a small, fixed, enumerable set (see every call site
// in batterylifepo4.yaml's main-loop write consumer), so this is a strict
// simplification, not a loss of information, and it sidesteps the
// "can a char array ever be made atomic" question entirely.
//
// Design: a bounded table of N independent slots, keyed by
// `request_id % N` (a real ring, not a single shared slot -- multiple
// requests resolved in quick succession no longer fight over one slot
// before a client gets to poll each). Production has exactly ONE writer
// (the main loop's 100ms consumer) and any number of concurrent,
// non-blocking readers (HTTP status-poll handler, any task) -- this
// module's stress test (test/jk_write_tx/test_jk_write_tx_mailbox.cpp)
// exercises both a single writer with many concurrent reader threads AND
// (for defense in depth) verifies the per-field atomics remain race-free
// even if that single-writer assumption were ever relaxed.
//
// "Pending vs unknown" (a genuinely NEW request_id that hasn't reached the
// result table yet, vs one that never existed or was evicted) is resolved
// via the existing single-flight design: this project's request mailbox
// only ever has ONE request staged-or-being-processed at a time, so a
// single atomic "which request_id is currently in flight" value
// (g_register_write_pending_request_id) is sufficient -- set the instant a
// request is staged, cleared the instant its result is published. No
// separate "was this id ever issued" bookkeeping is needed.
// ---------------------------------------------------------------------------

// Small, fixed, enumerable rejection reasons -- every one of these already
// exists verbatim as a string literal at a publish_write_result() call site
// in batterylifepo4.yaml's main-loop write consumer; this enum simply gives
// each one a race-free, atomically-representable identity. Add a new value
// here (never repurpose an existing one -- old firmware/clients may still
// be polling an in-flight request_id across an OTA) if a new rejection
// case is ever introduced.
enum class RejectReason : uint8_t {
  NONE = 0,  // accepted -- no rejection
  UNKNOWN_KEY = 1,
  AUTHORIZATION_REQUIRED = 2,
  BMS_NOT_LIVE = 3,
  TOPOLOGY_NOT_CONFIRMED = 4,
  VALUE_REJECTED = 5,
  NO_READ_PLAN_BLOCK = 6,
  STALE_RAW = 7,
  WRITE_NOT_QUEUED = 8,
  TRANSACTION_UNAVAILABLE = 9,  // in-flight for this address already, or every slot busy
};

inline const char *reject_reason_text(RejectReason reason) {
  switch (reason) {
    case RejectReason::NONE: return "";
    case RejectReason::UNKNOWN_KEY: return "unknown key";
    case RejectReason::AUTHORIZATION_REQUIRED: return "authorization_required";
    case RejectReason::BMS_NOT_LIVE: return "bms not live";
    case RejectReason::TOPOLOGY_NOT_CONFIRMED: return "topology not confirmed";
    case RejectReason::VALUE_REJECTED: return "value rejected by encode/range check";
    case RejectReason::NO_READ_PLAN_BLOCK: return "no read-plan block for this register";
    case RejectReason::STALE_RAW: return "stale";
    case RejectReason::WRITE_NOT_QUEUED: return "write not queued";
    case RejectReason::TRANSACTION_UNAVAILABLE:
      return "a transaction for this register is already in flight, or every transaction slot is busy";
    default: return "unknown reason";
  }
}

constexpr std::size_t kRegisterWriteResultTableSize = 8;  // power of two -- cheap modulo via bitmask
constexpr uint32_t kRegisterWriteResultTtlMs = 30000;     // fail-closed reclamation, see lookup_write_result()

// One slot of the bounded result table. EVERY field a reader touches is a
// real std::atomic -- see this section's module comment for why that is
// the actual, load-bearing fix (not a recheck alone).
//
// `version` is a MONOTONIC counter, not a binary ready/busy flag -- this
// is deliberate and closes a real ABA gap a binary flag cannot: with only
// a 2-state flag, a reader could observe READY, get preempted, and then
// observe READY again after the writer completed one or more ENTIRE
// publish cycles in between (state went READY -> EMPTY -> ... -> READY
// again) -- the reader's "still READY" recheck cannot distinguish "no
// write happened" from "a write happened and finished" in that window,
// which is exactly how a reader could assemble a torn mix of two
// different generations' fields while every individual field access
// stays technically well-defined. A counter that increments by exactly 1
// at write-start (odd = writer active) and by exactly 1 again at
// write-end (even = stable) makes ANY interleaved cycle -- partial or
// complete -- visible as a changed numeric value, not just a changed
// bit, so comparing the exact before/after value (not just its parity)
// is what actually proves the read window was clean.
//
// Every field below is accessed with memory_order_seq_cst, both here and
// in publish_write_result()/lookup_write_result() -- see this section's
// own module comment (third corrective pass) for why: this is a rare,
// low-frequency control path, so the simplest provable ordering wins over
// a marginally cheaper but harder-to-verify acquire/release scheme.
struct RegisterWriteResultSlot {
  std::atomic<uint32_t> version{0};  // even = stable (or never written), odd = writer mid-publish
  std::atomic<uint32_t> request_id{0};  // 0 = slot never published (0 is never a real request_id)
  std::atomic<uint8_t> accepted{0};  // 0/1 -- std::atomic<bool> is valid too, uint8_t keeps ABI explicit
  std::atomic<uint32_t> tx_id{0};
  std::atomic<uint8_t> reason{0};  // RejectReason, stored as its underlying type for atomic storage
  std::atomic<uint32_t> published_at_ms{0};
};

using RegisterWriteResultTable = std::array<RegisterWriteResultSlot, kRegisterWriteResultTableSize>;

// Writer side (main loop ONLY). No CAS/exclusion needed for a single
// writer -- overwriting whatever a slot previously held (a superseded
// result, or one for a completely different, older request_id that
// collided on this slot index) is exactly the intended, bounded-storage
// eviction behavior: a reader for that stale id will find `request_id`
// mismatched (see lookup_write_result()) and correctly report UNKNOWN,
// never a false eternal PENDING.
//
// Third corrective pass: every store below (version AND every payload
// field) is memory_order_seq_cst -- a single global total order across
// all of them, together with lookup_write_result()'s equally seq_cst
// loads, is what makes "the payload reads happened and version's own
// recheck still matched" a direct, whole-program sequencing fact rather
// than a per-variable happens-before argument that still has to be
// stitched together across several independent atomics.
inline void publish_write_result(RegisterWriteResultTable &table, std::atomic<uint32_t> &pending_request_id,
                                  uint32_t request_id, bool accepted, uint32_t tx_id, RejectReason reason,
                                  uint32_t now_ms) {
  RegisterWriteResultSlot &slot = table[request_id % kRegisterWriteResultTableSize];
  slot.version.fetch_add(1, std::memory_order_seq_cst);  // now odd -- tell any concurrent reader to back off
  slot.request_id.store(request_id, std::memory_order_seq_cst);
  slot.accepted.store(accepted ? 1 : 0, std::memory_order_seq_cst);
  slot.tx_id.store(tx_id, std::memory_order_seq_cst);
  slot.reason.store(static_cast<uint8_t>(reason), std::memory_order_seq_cst);
  slot.published_at_ms.store(now_ms, std::memory_order_seq_cst);
  slot.version.fetch_add(1, std::memory_order_seq_cst);  // now even again -- publish every field above
  // The request this result belongs to is no longer in flight -- clear the
  // pending marker LAST (after the result is fully visible), so a reader
  // can never observe "not pending, not in the table yet" for a request
  // that was JUST resolved (that window would wrongly read as UNKNOWN
  // instead of RESOLVED). See try_stage_write_request()'s own module
  // comment (Blocker 2 corrective pass) for the CAS-reservation this
  // pairs with -- this is the ONLY place pending_request_id is ever
  // cleared, and only ever via CAS for the EXACT request_id it currently
  // holds, never an unconditional store.
  uint32_t expected = request_id;
  pending_request_id.compare_exchange_strong(expected, 0, std::memory_order_seq_cst, std::memory_order_seq_cst);
}

enum class ResultLookupStatus : uint8_t {
  PENDING = 0,   // still staged or being processed by the main loop
  RESOLVED = 1,  // accepted/tx_id or a RejectReason is valid
  EXPIRED = 2,   // was resolved, but the TTL elapsed before this poll
  UNKNOWN = 3,   // never issued, or evicted by a newer request reusing this slot
};

struct RegisterWriteResultLookup {
  ResultLookupStatus status = ResultLookupStatus::UNKNOWN;
  bool accepted = false;
  uint32_t tx_id = 0;
  RejectReason reason = RejectReason::NONE;
};

// Reader side (safe from ANY task/context, any number of concurrent
// readers, read-only, never blocks, bounded retry -- never spins
// unboundedly). A straddled OR fully-completed-during-our-read publish
// cycle is detected by comparing the EXACT version value before and after
// the field reads (not merely whether it is "still ready") -- see this
// struct's own comment for why a monotonic counter, not a binary flag, is
// required to close this. Each individual field access remains
// well-defined C++ throughout regardless (see module comment above), so a
// version mismatch is a logic-correctness retry, never a memory-safety
// one. Every load below (version AND every payload field) is
// memory_order_seq_cst, matching publish_write_result()'s own seq_cst
// stores -- see the third-corrective-pass module comment for why this
// single global total order is the simplest available proof for this
// low-frequency control path.
inline RegisterWriteResultLookup lookup_write_result(const RegisterWriteResultTable &table,
                                                       const std::atomic<uint32_t> &pending_request_id,
                                                       uint32_t request_id, uint32_t now_ms,
                                                       uint32_t ttl_ms = kRegisterWriteResultTtlMs) {
  RegisterWriteResultLookup out;
  if (request_id == 0) return out;  // 0 is never a real request_id (see try_stage_write_request)

  const RegisterWriteResultSlot &slot = table[request_id % kRegisterWriteResultTableSize];
  // Third corrective pass: bumped from 5 to 16. publish_write_result()
  // clears pending_request_id strictly AFTER its own version flips back
  // to even (by design -- see that function's own comment); if EVERY one
  // of a reader's retry attempts lands while `version` is still odd (the
  // writer's own handful of stores mid-publish), the reader falls through
  // to the pending_request_id fallback below, which could by then already
  // be cleared -- a transient, spurious UNKNOWN for a request that in
  // fact resolved moments earlier. A slightly larger bound is cheap
  // (still a handful of atomic loads, still strictly bounded, never an
  // unbounded spin) insurance against this for any REAL poller, which
  // never calls this in a zero-delay busy loop (an HTTP status-poll
  // client is always seconds apart in wall-clock terms from the write it
  // is polling). This is not chased further than that: a genuinely
  // adversarial, unthrottled busy-loop reader can still theoretically
  // observe this exact transition instant regardless of how large a
  // BOUNDED retry count is -- that is a fundamental property of any
  // wait-free reader racing a bounded number of times against an
  // in-progress writer, not something this module can or should try to
  // defeat with an ever-larger constant. See that same test's own poller
  // loop for the realistic pacing (a real client, or this test's own
  // yield()-paced poller) this bound is actually sized for.
  constexpr int kMaxRetries = 16;
  for (int attempt = 0; attempt < kMaxRetries; attempt++) {
    const uint32_t v0 = slot.version.load(std::memory_order_seq_cst);
    if (v0 & 1u) continue;  // writer is mid-publish right now -- retry rather than read a torn slot
    if (v0 == 0) break;     // slot has never been published to -- definitely not this (or any) request

    const uint32_t seen_id = slot.request_id.load(std::memory_order_seq_cst);
    const bool seen_accepted = slot.accepted.load(std::memory_order_seq_cst) != 0;
    const uint32_t seen_tx_id = slot.tx_id.load(std::memory_order_seq_cst);
    const uint8_t seen_reason = slot.reason.load(std::memory_order_seq_cst);
    const uint32_t seen_published_at = slot.published_at_ms.load(std::memory_order_seq_cst);

    const uint32_t v1 = slot.version.load(std::memory_order_seq_cst);
    if (v1 != v0) continue;  // version changed (mid-write OR a full cycle completed) during our read -- retry

    // v0 == v1, both even: no publish (partial or complete) touched this
    // slot anywhere between our two version reads, so every field above
    // belongs to the SAME, single generation -- a fully consistent,
    // non-torn snapshot, proven by value equality, not by parity alone.
    if (seen_id != request_id) break;  // this slot holds a different id -- ours was evicted or never landed here
    if (now_ms - seen_published_at > ttl_ms) {
      out.status = ResultLookupStatus::EXPIRED;
      return out;
    }
    out.status = ResultLookupStatus::RESOLVED;
    out.accepted = seen_accepted;
    out.tx_id = seen_tx_id;
    out.reason = static_cast<RejectReason>(seen_reason);
    return out;
  }

  // Not found (or evicted) in the result table. Still PENDING only if it
  // is the one request currently staged/in-flight; otherwise it is
  // genuinely UNKNOWN (never issued this session, or resolved so long ago
  // its slot has since been reused by other requests without this reader
  // ever having observed the result -- fail-closed, never an eternal
  // false PENDING).
  if (pending_request_id.load(std::memory_order_seq_cst) == request_id) {
    out.status = ResultLookupStatus::PENDING;
    return out;
  }
  return out;  // UNKNOWN (default-constructed)
}

// This project's own single instances of the mailbox/table above. C++17
// `inline` variables (not merely `inline` functions) so this header can
// define real, single-definition-across-the-program storage safely even
// if ever included from more than one translation unit -- ESPHome's own
// generated build currently bundles everything into one, but this makes
// that an implementation detail this header does not depend on. The
// production HTTP handlers (batterylifepo4.yaml) reference these
// directly as jk_write_tx::g_register_write_request_mailbox /
// g_register_write_result_table / g_register_write_pending_request_id /
// g_register_write_next_request_id -- deliberately NOT declared via
// ESPHome's own `globals:` YAML component, since that component's codegen
// instantiates every entry before this header's own custom struct types
// are ever #included (see this project's established precedent for
// jk_write_tx::Slot's own storage, noted earlier in this file).
inline RegisterWriteRequestMailbox g_register_write_request_mailbox;
inline RegisterWriteResultTable g_register_write_result_table;
inline std::atomic<uint32_t> g_register_write_pending_request_id{0};
inline std::atomic<uint32_t> g_register_write_next_request_id{0};

}  // namespace jk_write_tx
