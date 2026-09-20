#pragma once
// jk_poll_scheduler_core.h -- pure, hardware-independent core for the
// generic block-read scheduler (Final-preparation-plan Stage 1, commit
// boundary 2, spec section "3.2. Scheduler owns polling" / "3.5. Physical
// block cache"). No ESPHome, no Modbus, no I/O of any kind -- exactly the
// same split as components/jk_write_tx/jk_write_tx_core.h: the caller
// (batterylifepo4.yaml's interval lambda) owns issuing the actual Modbus
// read command and feeds this module only timestamps and raw response
// bytes. That split is what makes this desktop-testable without ESP-IDF or
// real hardware -- see test/jk_poll_scheduler/test_jk_poll_scheduler_core.cpp.
//
// Two independent responsibilities live in this one header, deliberately
// not split into two files: they share the same BlockState the caller must
// already be threading through every tick, and the plan's own architecture
// treats them as one scheduler concept, not two components.
//   1. Generic field decode (byte math): decode_numeric()/decode_bool()
//      apply mask/shift/sign/scale to a block's raw response bytes. This is
//      the ONE hand-written, unit-tested implementation of the byte math
//      every ad-hoc reader in this project (the 1Hz cell-block reader, the
//      CellCount topology driver) has so far duplicated by hand. Generated
//      per-field metadata (protocol/generated/read_plan_decode.h) supplies
//      only DATA (which mask/shift/scale a given field needs) -- never a
//      second copy of this logic. See CLAUDE.md: "never hand-edit a
//      generated artifact" -- the inverse holds too, a generator must never
//      re-emit hand-verifiable logic as per-field generated code.
//   2. Poll scheduling (pick_next_block): three-tier priority -- write rx
//      always wins outright (caller signals this by never calling
//      pick_next_block while a write is in flight, or by passing
//      write_in_flight=true, either is safe -- see that parameter's own
//      comment), then the browser-reported active settings group, then
//      cadence deadline order among everything else.
//
// Deliberately NOT covered here (kept on their existing, already-tested,
// bespoke drivers -- see docs/adr/0001-protocol-catalog.md and this
// header's own generation source, tools/protocol/generate_read_plan.js,
// for the full, audited reasoning): the 1Hz cell-voltage/cell-resistance
// block (its own interval: 1s reader), the electrical_metrics_scan
// voltage/current/power computation (audited sign convention, drives 7
// downstream sensors), and jk_write_tx_core.h's write-transaction slots
// (unchanged, this scheduler only PAUSES around them via write_in_flight).

#include <array>
#include <cstddef>
#include <cstdint>

namespace jk_poll_scheduler {

// ---------------------------------------------------------------------
// 1. Generic field decode.
// ---------------------------------------------------------------------

enum class WireType : uint8_t { U8, S8, U16, S16, U32, S32, F32, ASCII, BIT, HEX };

// Bit width of the VALUE itself (not the register it's packed into) --
// used only to know how many bits to sign-extend from after mask+shift.
inline uint8_t wire_type_bits(WireType t) {
  switch (t) {
    case WireType::U8:
    case WireType::S8:
      return 8;
    case WireType::U16:
    case WireType::S16:
      return 16;
    case WireType::BIT:
      return 1;
    default:
      return 32;  // U32, S32, F32
  }
}

struct FieldDecode {
  const char *key;       // canonical field key == published entity object_id
  // canonical.json's own byte_offset is carried through verbatim for
  // documentary/audit purposes ONLY -- NOT used to address the read.
  // Confirmed by direct inspection: for a packed pair sharing one
  // single_word register (e.g. rcv_time byte_offset=1 / rfv_time
  // byte_offset=0, both packed into the SAME 2-byte register at 0x1504),
  // byte_offset is redundant with -- and in this project's real data
  // never adds information beyond -- mask+shift, which alone fully and
  // correctly localizes every sub-field within the register (see this
  // project's real generated data: mask+shift already distinguish "high
  // byte" from "low byte" without needing a separate start-of-read
  // offset). Treating byte_offset as a real read-start position was tried
  // and caused a genuine out-of-bounds read for rcv_time (byte_offset=1
  // into a 2-byte register, i.e. reading past the register's own end) --
  // caught by test_read_plan_decode.cpp before ever reaching hardware.
  uint8_t byte_offset;
  uint32_t mask;         // applied before shifting (0 for ASCII fields, unused)
  uint8_t shift;
  bool is_signed;
  WireType wire_type;
  float scale;
  float offset;
};

// Reads `width_bytes` bytes big-endian starting at data[0] -- always the
// start of the block's own payload (one block == one physical register
// read, see jk_poll_scheduler::Block's own comment; a field's position
// WITHIN that register is mask+shift's job, never a byte-level start
// offset -- see FieldDecode::byte_offset's own comment for why). The
// caller guarantees data has at least width_bytes bytes (every generated
// Block's payload_bytes already accounts for this -- see
// read_plan_decode.h's own kBlocks table); this function does not
// re-check bounds itself so it stays a pure, branch-minimal byte-math
// primitive mirroring the manual big-endian assembly already used by the
// existing cell-block/CellCount readers (jk_cells/jk_topology in
// batterylifepo4.yaml).
inline uint32_t read_be(const uint8_t *data, uint8_t width_bytes) {
  uint32_t v = 0;
  for (uint8_t i = 0; i < width_bytes; i++) v = (v << 8) | data[i];
  return v;
}

// Decodes one numeric (non-ASCII, non-BIT) field: read the OWNING
// REGISTER's full raw width (register_bytes -- e.g. 2 for a single_word
// register even when this field's own mask only covers its low byte, such
// as state_of_charge's 0x00FF within a 2-byte register also carrying
// balancing_active's 0xFF00 -- deliberately NOT inferred from the mask's
// own magnitude, which cannot distinguish "the low byte of a 2-byte
// register" from "a genuinely 1-byte register"), mask+shift to isolate the
// sub-field, sign-extend per its OWN wire_type width (which may be
// narrower than the register it's packed into -- e.g. a S8 field packed
// into a U16 register), then apply scale+offset. F32 fields reinterpret
// the raw 32-bit pattern as IEEE-754 rather than scaling (scale/offset are
// 1/0 for these by construction -- the generator never emits a nonzero
// scale alongside WireType::F32).
inline float decode_numeric(const uint8_t *data, const FieldDecode &f, uint8_t register_bytes) {
  uint32_t raw = read_be(data, register_bytes);
  if (f.mask != 0) raw &= f.mask;
  raw >>= f.shift;

  if (f.wire_type == WireType::F32) {
    float out;
    static_assert(sizeof(out) == sizeof(raw), "float must be 32 bits");
    __builtin_memcpy(&out, &raw, sizeof(out));
    return out;
  }

  const uint8_t bits = wire_type_bits(f.wire_type);
  if (f.is_signed && bits < 32) {
    const uint32_t sign_bit = 1u << (bits - 1);
    if (raw & sign_bit) raw |= ~((sign_bit << 1) - 1);  // sign-extend into the full 32 bits
  }
  // Cast through int32_t only when signed -- an unsigned raw value with its
  // high bit set (e.g. a full-range U32) must NOT round-trip through
  // int32_t, which would reinterpret it as negative.
  const float numeric = f.is_signed ? float(int32_t(raw)) : float(raw);
  return numeric * f.scale + f.offset;
}

// Stage 3 cell-channel batch (user-directed, 2026-09-17): the SAME raw-bits
// extraction decode_numeric() and decode_exact_decimal() both already do
// internally (read_be + mask + shift), exposed as its own tiny primitive
// for a caller that needs the bit-exact uint32_t itself -- never a float
// cast (decode_numeric) and never a formatted string (decode_exact_decimal).
// Added specifically so cell_connected_mask's decode site can ALSO feed a
// raw uint32_t global for resolve_topology's own bit-testing (batterylifepo4.yaml)
// without that safety-critical function ever reading a lossy float-cast
// bitmask again -- a value with any high bit (bit31 etc.) set corrupts
// float's precision for the LOW bits too (ULP scales with magnitude), which
// is exactly the "high AND low bits together" precision risk this batch
// closes. Unsigned only, same rationale as decode_exact_decimal's own.
inline uint32_t decode_raw_u32(const uint8_t *data, const FieldDecode &f, uint8_t register_bytes) {
  uint32_t raw = read_be(data, register_bytes);
  if (f.mask != 0) raw &= f.mask;
  raw >>= f.shift;
  return raw;
}

// Decodes a numeric field's raw integer EXACTLY as a fixed-point decimal
// string -- no float/double conversion anywhere in this path. Added for
// the Stage 3 precision fix (user-directed, 2026-09-17): decode_numeric()
// above casts through `float`, which only exactly represents integers up
// to 2^24 (16,777,216) -- confirmed on real hardware that several wide
// UINT32 counters (rtc_ticks, odd_run_time, bms_system_ticks,
// total_runtime) already exceed this in normal operation, and that
// ESPHome's own `sensor::state` is ALSO hard-typed `float` (checked the
// real esphome/components/sensor/sensor.h), so returning `double` from
// decode_numeric() would not have fixed anything -- the precision loss
// happens again the moment publish_state(float) is called. The only way
// to keep an exact wide integer through ESPHome's own entity system is a
// text_sensor's std::string state, which this function produces directly
// via pure integer/string arithmetic.
//
// Reads the SAME raw integer via the SAME mask/shift path as
// decode_numeric() (so the two can never disagree on WHICH bits they're
// reading, only on how they publish them), then formats it as a
// fixed-point decimal with `decimal_places` digits after the decimal
// point (0 for a whole-number field). decimal_places mirrors the field's
// own canonical decimal_precision -- always a small, fixed, compile-time-
// known constant per field (the generator supplies it as a literal,
// never inferred from `scale` here); every field routed through this
// path uses a power-of-ten scale, so fixed-point formatting is always
// exact for it. Unsigned only -- every current user of this path is a
// monotonic UINT32 counter; add a signed variant the same way (mirroring
// decode_numeric's own is_signed branch) if a future signed field needs
// this treatment, never by silently reusing this one on signed data.
//
// out_capacity must be at least 12 (10 digits for UINT32_MAX + '.' + at
// least 1 fractional digit + NUL); callers in this project use buf[16]
// for margin, matching decode_ascii's own buffer-sizing convention.
inline void decode_exact_decimal(const uint8_t *data, const FieldDecode &f, uint8_t register_bytes,
                                  uint8_t decimal_places, char *out, size_t out_capacity) {
  uint32_t raw = read_be(data, register_bytes);
  if (f.mask != 0) raw &= f.mask;
  raw >>= f.shift;

  // uint32_t max (4294967295) is 10 decimal digits.
  char digits[10];
  uint8_t n = 0;
  uint32_t v = raw;
  do {
    digits[n++] = char('0' + (v % 10));
    v /= 10;
  } while (v > 0 && n < sizeof(digits));
  // digits[] is now least-significant-digit-first (digits[0] is the ones
  // place); reading it back most-significant-first (digits[n-1-i]) below
  // reconstructs the original decimal representation.

  size_t pos = 0;
  const uint8_t int_digits = n > decimal_places ? n - decimal_places : 0;
  if (int_digits == 0 && decimal_places > 0) {
    // The raw value has fewer digits than decimal_places demands -- the
    // integer part is "0" (e.g. raw=5, decimal_places=3 -> "0.005").
    if (pos < out_capacity - 1) out[pos++] = '0';
  }
  for (uint8_t i = 0; i < int_digits && pos < out_capacity - 1; i++) {
    out[pos++] = digits[n - 1 - i];
  }
  if (decimal_places > 0) {
    if (pos < out_capacity - 1) out[pos++] = '.';
    for (uint8_t i = 0; i < decimal_places && pos < out_capacity - 1; i++) {
      const uint8_t digit_index = decimal_places - 1 - i;
      out[pos++] = digit_index < n ? digits[digit_index] : '0';
    }
  }
  out[pos] = '\0';
}

// Decodes a WireType::BIT field to a plain boolean (bit set -> true). Only
// meaningful for fields the generator marked as a real single-bit wire
// value (e.g. charging_float_mode) -- the several OTHER "boolean-ish"
// entities in this project (charging/discharging/balancing/*_allowed) are
// a numeric-nonzero THRESHOLD over a whole byte, not a bit test, and their
// exact comparison operator differs per field in ways not mechanically
// derivable from canonical.json alone (confirmed by direct inspection --
// see generate_read_plan.js's own EXCLUDE_DERIVED_BOOLEAN table) -- those
// stay on their existing hand-written template lambdas, unchanged.
inline bool decode_bool(const uint8_t *data, const FieldDecode &f, uint8_t register_bytes) {
  const uint32_t raw = read_be(data, register_bytes);
  return (raw & f.mask) != 0;
}

// Decodes a WireType::ASCII field: a plain raw-byte copy of the block's
// full response into a fixed-size buffer, NUL-terminated within
// `out_capacity` (the caller's buffer size, e.g. sizeof(char[17]) for a
// 16-byte field + terminator). mask/shift/scale/offset do not apply to
// ASCII fields (the generator emits mask=0x0 as an unused placeholder for
// them) -- this function ignores FieldDecode entirely and instead takes
// the owning block's own payload_bytes directly, since (unlike every
// numeric/BIT field) an ASCII field is never packed alongside a sibling
// within the same register -- it always consumes the whole block.
inline void decode_ascii(const uint8_t *data, uint8_t payload_bytes, char *out, size_t out_capacity) {
  const size_t n = payload_bytes < out_capacity - 1 ? payload_bytes : out_capacity - 1;
  for (size_t i = 0; i < n; i++) out[i] = char(data[i]);
  out[n] = '\0';
}

// Decodes a WireType::HEX field (2026-09-20, UART raw-bitmask arrays --
// UART1MPRTOLEnable/UARTMPRTOLEnable[0-15]): a SAFE, deterministic
// byte-to-hex-string projection of arbitrary binary data. Unlike
// decode_ascii() above, this makes NO assumption that the bytes are
// printable text: every byte (including 0x00 and 0xFF) is rendered as
// exactly two uppercase hex digits, space-separated, for a fixed,
// predictable output length -- never truncated at an embedded NUL byte
// (decode_ascii() would silently stop there; that is exactly why a
// genuine raw bitmask array must NOT go through decode_ascii()). Canonical
// format: uppercase hex, space-separated, e.g. "00 FF 01 02 ...". The
// caller's buffer must be large enough for payload_bytes*3 characters
// (2 hex digits + 1 separator per byte, no separator after the last byte,
// so a slight over-allocation) plus a NUL terminator; this function never
// writes past out_capacity, silently truncating (never overrunning) if
// the buffer is too small for the full payload -- bounds-checked, no
// out-of-bounds write under any input.
inline void decode_hex_string(const uint8_t *data, uint8_t payload_bytes, char *out, size_t out_capacity) {
  static const char kHexDigits[] = "0123456789ABCDEF";
  size_t pos = 0;
  for (uint8_t i = 0; i < payload_bytes; i++) {
    if (pos + 2 >= out_capacity) break;  // leave room for at least the NUL terminator
    out[pos++] = kHexDigits[(data[i] >> 4) & 0x0F];
    out[pos++] = kHexDigits[data[i] & 0x0F];
    if (i + 1 < payload_bytes && pos + 1 < out_capacity) out[pos++] = ' ';
  }
  out[pos < out_capacity ? pos : out_capacity - 1] = '\0';
}

// ---------------------------------------------------------------------
// One hand-authored, non-generic custom decoder: electrical_metrics_scan
// (0x1290 -- BatVol/BatWatt/BatCurrent, migrated from the pre-Stage-1
// modbus_controller lambda). Ported VERBATIM (Final-preparation-plan
// Stage 1 corrective pass): the generic FieldDecode pipeline cannot
// express "read two non-adjacent sub-ranges of one 12-byte block and
// compute a product," so this stays its own real, unit-tested function
// (test/jk_poll_scheduler/test_electrical_metrics_decode.cpp) rather than
// an untestable string embedded in the generator. `raw` must point at
// this block's own 12-byte payload (byte 0 = start of THIS block's
// response, matching every other decode function in this header -- see
// read_be()'s own comment for why byte_offset is otherwise unused).
// Byte range 4-7 (BatWatt) is deliberately never read: every power metric
// is derived from voltage x current instead, exactly as the original
// comment explains (avoids a stale cross-sensor dependency and BatWatt's
// own rounding).
// ---------------------------------------------------------------------

struct ElectricalMetrics {
  float total_voltage_v;
  float current_a;
  float power_w;
  float charging_power_w;
  float discharging_power_w;
};

// SIGN CONVENTION (audited from this exact register -- ported verbatim
// from the pre-migration modbus_controller lambda, never re-derived):
// BatCurrent (0x1298, INT32) is read with no sign inversion -- POSITIVE
// current = charging (into the pack), NEGATIVE = discharging (out of the
// pack). charging_power is power>0, discharging_power is -power when
// power<0; every other current/power consumer in this project follows
// this same rule (see this project's own SIGN CONVENTION comment,
// preserved in git history at the pre-migration modbus_controller lambda).
inline ElectricalMetrics decode_electrical_metrics(const uint8_t *raw) {
  const uint32_t voltage_mv =
      (uint32_t(raw[0]) << 24) | (uint32_t(raw[1]) << 16) |
      (uint32_t(raw[2]) << 8) | uint32_t(raw[3]);
  const int32_t current_ma = int32_t(
      (uint32_t(raw[8]) << 24) | (uint32_t(raw[9]) << 16) |
      (uint32_t(raw[10]) << 8) | uint32_t(raw[11]));

  ElectricalMetrics m;
  m.total_voltage_v = voltage_mv * 0.001f;
  m.current_a = current_ma * 0.001f;
  m.power_w = m.total_voltage_v * m.current_a;
  m.charging_power_w = m.power_w > 0.0f ? m.power_w : 0.0f;
  m.discharging_power_w = m.power_w < 0.0f ? -m.power_w : 0.0f;
  return m;
}

// One physical Modbus read command (one register, per Stage 1's
// deliberately conservative "one block per canonical register" clustering
// choice -- see generate_read_plan.js's own module comment for why: it
// sidesteps the JK protocol's documented declared-address-vs-wire-byte gap
// quirk entirely, at the cost of not preserving a couple of today's
// hand-tuned multi-register batched reads, which Stage 1 does not need to
// preserve, only Stage 3/6's bus-budget work might revisit later).
// fields_offset/fields_count index into read_plan_decode.h's flat kFields
// array (generated alongside kBlocks in the same file, sharing these
// types) -- kept as a flat array + range pair rather than a fixed-size
// per-block array so a register with only one field costs one slot, not a
// wasted fixed capacity.
struct Block {
  uint16_t address;
  uint8_t register_count;  // the wire request's actual register_count (see module comment on why this is NOT payload_bytes/2)
  uint8_t payload_bytes;  // exact byte length of this block's read response
  uint32_t cadence_ms;    // 0 = on-demand only, never auto-issued by pick_next_block()
  uint16_t fields_offset;
  uint16_t fields_count;
  // The one Settings UI group (1-12) every field this block covers agrees
  // on; -1 if none do, or if they disagree -- never guessed. Populated from
  // registers.canonical.json's own per-field ui_group via
  // generate_read_plan.js's aggregateUiGroup(); see
  // resolve_active_group_block_index()'s own comment for how this is
  // consumed. As of Stage 1 (ui_group population is Stage 2's own
  // deliverable), every real block's ui_group is -1 -- see this project's
  // Stage 1 hardware acceptance corrective pass report for that documented
  // dependency.
  int8_t ui_group;
};

// ---------------------------------------------------------------------
// 2. Physical block cache (spec section 3.5).
// ---------------------------------------------------------------------

enum TransportState : uint8_t { IDLE = 0, PENDING = 1 };

struct BlockState {
  uint32_t last_attempt_ms = 0;
  uint32_t last_success_ms = 0;
  uint16_t error_count = 0;
  uint16_t timeout_count = 0;
  uint8_t transport_state = IDLE;
  // Bumped exactly once per successful decode, covering every field this
  // block feeds atomically -- see mark_success()'s own comment. A reader
  // that wants to know "did this block's fields just change" polls this,
  // never per-field state (there is none -- decode is applied directly to
  // the raw payload at read time by the caller, this header does not
  // retain last_valid_raw_payload itself; the caller's own storage keeps
  // that, exactly like jk_write_tx_core.h keeps non-POD/array storage in
  // the caller's ESPHome globals rather than inside the header's Slot).
  uint32_t revision = 0;
};

inline void mark_issued(BlockState &s, uint32_t now_ms) {
  s.transport_state = PENDING;
  s.last_attempt_ms = now_ms;
}

inline void mark_success(BlockState &s, uint32_t now_ms) {
  s.transport_state = IDLE;
  s.last_success_ms = now_ms;
  s.revision++;
}

inline void mark_error(BlockState &s) {
  s.transport_state = IDLE;
  s.error_count++;
}

inline void mark_timeout(BlockState &s) {
  s.transport_state = IDLE;
  s.timeout_count++;
}

// ---------------------------------------------------------------------
// 3. Poll scheduling -- three-tier priority (spec section 3.2):
//      1. write in flight            -- issue nothing this tick
//      2. active-settings-group hint -- boost one specific due block
//      3. cadence deadline order     -- most-overdue due block wins
// ---------------------------------------------------------------------

constexpr int NO_BLOCK = -1;

// `cadence_ms[i] == 0` marks block i as on-demand-only (never auto-issued
// by this function -- e.g. the setup-passcode readback's poll_group is
// on_demand_passcode in the canonical source, though Stage 1 preserves its
// CURRENT real cadence rather than retroactively changing it -- see the
// generator's own documented exception for that one field).
//
// `write_in_flight`: the caller must pass true for every tick where
// jk_write_tx (or the CellCount topology driver) has any slot pending --
// this is the caller's responsibility to compute (mirrors how
// jk_write_tx::is_pending() is already the caller's own single-flight
// check, not something this header could see on its own since it never
// touches those modules' storage).
//
// `active_group_block_index`: -1 if no group hint is active or it names no
// real block; otherwise the index of the one block to prefer WHEN due.
// This can only ever reorder tier-3 candidates that are already due (a
// non-due block is never issued early just because it's the active
// group's) -- exactly the plan's "structurally cannot preempt tier-1, and
// cannot invent a read the scheduler wasn't already going to perform"
// guarantee. Computed by resolve_active_group_block_index() below, not by
// the caller re-deriving it -- see that function's own comment.

// Stage 1 hardware acceptance corrective pass: maps a browser-reported
// Settings group hint (1-12, or "no hint active") to the one block index
// pick_next_block's tier-2 should prefer. Pure and separately unit-tested
// from pick_next_block itself (which already had its own tier-2 tests
// before this function existed -- this only fixes what fed it, which used
// to be hardcoded to -1). Returns NO_BLOCK when hint_active is false, when
// hint_group is out of the valid 1-12 range, or when no block's ui_group
// matches it (this project's real data: EVERY block's ui_group is -1 as of
// Stage 1, since per-field ui_group population is Stage 2's own
// deliverable -- this function is real and tested, not a stub, but is
// currently a guaranteed no-op against production data until Stage 2 fills
// that in; see the caller's own comment in generate_read_plan.js). Returns
// the FIRST matching block's index if more than one block somehow shares a
// ui_group (never expected in practice -- ui_group is meant to identify a
// single settings section -- but a stable, deterministic choice beats an
// unspecified one either way).
template <size_t N>
int resolve_active_group_block_index(const Block (&blocks)[N], int hint_group, bool hint_active) {
  if (!hint_active || hint_group < 1 || hint_group > 12) return NO_BLOCK;
  for (size_t i = 0; i < N; i++) {
    if (blocks[i].ui_group == hint_group) return int(i);
  }
  return NO_BLOCK;
}
//
// Elapsed-time math uses subtraction-then-compare throughout (`now_ms -
// last_attempt_ms`), never `last_attempt_ms + cadence_ms` then compared
// against now_ms -- the latter can overflow uint32_t near a millis()
// wraparound (~49.7 days uptime) and silently invert the comparison. This
// mirrors jk_write_tx_core.h's own established, audited pattern.
template <size_t N>
int pick_next_block(const std::array<BlockState, N> &states, const uint32_t (&cadence_ms)[N],
                     bool write_in_flight, int active_group_block_index, uint32_t now_ms) {
  if (write_in_flight) return NO_BLOCK;

  int best = NO_BLOCK;
  uint32_t best_overdue_by = 0;
  for (size_t i = 0; i < N; i++) {
    if (cadence_ms[i] == 0) continue;  // on-demand only, never auto-scheduled
    const bool never_attempted = states[i].last_attempt_ms == 0 && states[i].last_success_ms == 0;
    uint32_t overdue_by;
    if (never_attempted) {
      overdue_by = 0xFFFFFFFFu;  // maximally overdue -- always wins its first read
    } else {
      const uint32_t elapsed = now_ms - states[i].last_attempt_ms;
      if (elapsed < cadence_ms[i]) continue;  // not due yet
      overdue_by = elapsed - cadence_ms[i];
    }
    if (int(i) == active_group_block_index) return int(i);  // tier-2: due and group-preferred, wins immediately
    if (best == NO_BLOCK || overdue_by > best_overdue_by) {
      best = int(i);
      best_overdue_by = overdue_by;
    }
  }
  return best;
}

}  // namespace jk_poll_scheduler
