// Host-side unit tests for jk_poll_scheduler_core.h -- no ESP32, no
// ESPHome, no ESP-IDF, no real Modbus needed. Build and run with a plain
// desktop compiler:
//
//   g++ -std=c++17 -Wall -Wextra -I ../../components/jk_poll_scheduler \
//       test_jk_poll_scheduler_core.cpp -o test_jk_poll_scheduler_core
//   ./test_jk_poll_scheduler_core
//
// Exits non-zero (and prints which check failed) on any failure, so it's
// usable as a CI gate, not just a manual smoke test. Mirrors
// test/jk_write_tx/test_jk_write_tx_core.cpp's own structure/conventions.

#include "jk_poll_scheduler_core.h"

#include <cmath>
#include <cstdio>
#include <cstring>

using namespace jk_poll_scheduler;

namespace {
int g_failures = 0;
int g_checks = 0;

void check(bool cond, const char *desc) {
  g_checks++;
  if (!cond) {
    g_failures++;
    std::printf("FAIL: %s\n", desc);
  }
}

template <typename T>
void check_eq(T actual, T expected, const char *desc) {
  g_checks++;
  if (actual != expected) {
    g_failures++;
    std::printf("FAIL: %s (expected != actual)\n", desc);
  }
}

void check_near(float actual, float expected, float tol, const char *desc) {
  g_checks++;
  if (std::fabs(actual - expected) > tol) {
    g_failures++;
    std::printf("FAIL: %s (expected=%f actual=%f)\n", desc, expected, actual);
  }
}
}  // namespace

// ---------------------------------------------------------------------
// decode_numeric -- one case per real wire_type this project's canonical
// source actually uses, several taken directly from real registers.
// ---------------------------------------------------------------------

static void test_decode_u32_full_register_with_scale() {
  // smart_sleep (0x1000): U32, scale 0.001, full 4-byte register.
  FieldDecode f{"smart_sleep", 0, 0xFFFFFFFFu, 0, false, WireType::U32, 0.001f, 0.0f};
  const uint8_t data[4] = {0x00, 0x00, 0x0B, 0xB8};  // 3000 raw -> 3.000 V
  check_near(decode_numeric(data, f, 4), 3.0f, 1e-6f, "smart_sleep-style U32 decodes with scale");
}

static void test_decode_s32_capacity_remaining_negative_wire_sign() {
  // capacity_remaining (0x12A8): S32, scale 0.001. Wire value -1 (all-Fs)
  // must decode to a small negative float, not wrap to a huge positive one
  // (the exact bug class capacity_remaining's real fix, this session, was
  // about -- see protocol/registers.canonical.json's safety_notes).
  FieldDecode f{"capacity_remaining", 0, 0xFFFFFFFFu, 0, true, WireType::S32, 0.001f, 0.0f};
  const uint8_t data[4] = {0xFF, 0xFF, 0xFF, 0xFF};
  check_near(decode_numeric(data, f, 4), -0.001f, 1e-6f, "S32 all-Fs decodes to -1 raw, not +4294967295");
}

static void test_decode_packed_s8_high_byte() {
  // heating_activation_temperature (0x111C high byte): S8 packed into a
  // U16 register, mask 0xFF00 shift 8. 0xF6 in the high byte = -10.
  FieldDecode f{"heating_activation_temperature", 0, 0xFF00u, 8, true, WireType::S8, 1.0f, 0.0f};
  const uint8_t data[2] = {0xF6, 0x00};
  check_near(decode_numeric(data, f, 2), -10.0f, 1e-6f, "packed S8 high byte sign-extends correctly");
}

static void test_decode_packed_s8_low_byte_unaffected_by_high_byte() {
  // heating_deactivation_temperature (0x111C low byte): mask 0x00FF shift 0.
  // The high byte carries an unrelated field's value and must not leak in.
  FieldDecode f{"heating_deactivation_temperature", 0, 0x00FFu, 0, true, WireType::S8, 1.0f, 0.0f};
  const uint8_t data[2] = {0xF6, 0x05};  // high byte -10 (unrelated), low byte +5
  check_near(decode_numeric(data, f, 2), 5.0f, 1e-6f, "packed S8 low byte ignores sibling high byte");
}

static void test_decode_u8_low_byte_of_two_byte_register_not_confused_with_one_byte_register() {
  // state_of_charge (0x12A6 low byte): mask 0x00FF within a 2-byte
  // register. Regression guard for the exact bug this header's own
  // decode_numeric comment documents: inferring register width from the
  // mask's magnitude alone would misread this as a 1-byte register and
  // read the WRONG byte (data[0] instead of data[1]).
  FieldDecode f{"state_of_charge", 0, 0x00FFu, 0, false, WireType::U8, 1.0f, 0.0f};
  const uint8_t data[2] = {0x02, 0x37};  // high byte=balancing_active(2), low byte=soc(0x37=55)
  check_near(decode_numeric(data, f, 2), 55.0f, 1e-6f, "low-byte U8 field in a 2-byte register reads the correct byte");
}

static void test_decode_f32_reinterprets_bit_pattern() {
  // battery_voltage_correction (0x12DC): F32, IEEE-754 bit pattern, not scaled.
  FieldDecode f{"battery_voltage_correction", 0, 0xFFFFFFFFu, 0, false, WireType::F32, 1.0f, 0.0f};
  // 1.5f as IEEE-754: 0x3FC00000
  const uint8_t data[4] = {0x3F, 0xC0, 0x00, 0x00};
  check_near(decode_numeric(data, f, 4), 1.5f, 1e-6f, "F32 reinterprets raw bits, does not scale");
}

static void test_decode_u16_no_scale() {
  FieldDecode f{"custom_alarm_1", 0, 0xFFFFu, 0, false, WireType::U16, 1.0f, 0.0f};
  const uint8_t data[2] = {0x01, 0x2C};  // 0x012C = 300
  check_near(decode_numeric(data, f, 2), 300.0f, 1e-6f, "plain U16 decodes with implicit scale=1");
}

static void test_decode_s16_negative() {
  // temperature_1 (0x129C): S16, scale 0.1. -50 raw -> -5.0 degC.
  FieldDecode f{"temperature_1", 0, 0xFFFFu, 0, true, WireType::S16, 0.1f, 0.0f};
  const uint8_t data[2] = {0xFF, 0xCE};  // 0xFFCE = -50 as int16
  check_near(decode_numeric(data, f, 2), -5.0f, 1e-6f, "S16 negative decodes with scale");
}

// ---------------------------------------------------------------------
// decode_exact_decimal -- Stage 3 precision fix (2026-09-17). Every case
// below is checked against a STRING, never re-parsed through float/double
// -- the whole point of this function is that no such conversion happens
// anywhere on its path, so a test that itself parsed the result back to a
// number would hide exactly the class of bug this exists to prevent.
// ---------------------------------------------------------------------

static void check_str(const char *actual, const char *expected, const char *desc) {
  g_checks++;
  if (std::strcmp(actual, expected) != 0) {
    g_failures++;
    std::printf("FAIL: %s (expected=\"%s\" actual=\"%s\")\n", desc, expected, actual);
  }
}

static void test_decode_exact_decimal_below_float_ceiling_matches_decode_numeric() {
  // 2^24 - 1 = 16777215, the last integer float32 can ALSO still represent
  // exactly -- both decode paths must agree here (this is not yet the
  // regime decode_exact_decimal exists for; it's the boundary just below
  // it, proving the two functions read identical bits up to that point).
  FieldDecode f{"boundary_below", 0, 0xFFFFFFFFu, 0, false, WireType::U32, 1.0f, 0.0f};
  const uint8_t data[4] = {0x00, 0xFF, 0xFF, 0xFF};  // 16777215
  char buf[16];
  decode_exact_decimal(data, f, 4, 0, buf, sizeof(buf));
  check_str(buf, "16777215", "2^24-1: decode_exact_decimal produces the exact integer string");
  check_near(decode_numeric(data, f, 4), 16777215.0f, 0.5f, "2^24-1: decode_numeric still agrees exactly (below the float ceiling)");
}

static void test_decode_exact_decimal_above_float_ceiling_where_decode_numeric_would_round() {
  // 2^24 + 1 = 16777217 -- the FIRST integer float32 cannot represent
  // exactly (it rounds to 16777216.0f). decode_exact_decimal must still
  // produce the exact string; decode_numeric is expected to have ALREADY
  // lost the low bit here (documented, not silently tolerated).
  FieldDecode f{"boundary_above", 0, 0xFFFFFFFFu, 0, false, WireType::U32, 1.0f, 0.0f};
  const uint8_t data[4] = {0x01, 0x00, 0x00, 0x01};  // 16777217
  char buf[16];
  decode_exact_decimal(data, f, 4, 0, buf, sizeof(buf));
  check_str(buf, "16777217", "2^24+1: decode_exact_decimal is still exact where float32 cannot be");
  check(decode_numeric(data, f, 4) == 16777216.0f, "2^24+1: decode_numeric demonstrably rounds (confirms the bug this function fixes)");
}

static void test_decode_exact_decimal_real_rtc_ticks_value() {
  // A real value captured from live hardware this session (2026-09-17,
  // device at 192.168.27.43): rtc_ticks raw=211789500. decode_numeric on
  // this exact input was independently confirmed (this session, via the
  // live SSE capture) to quantize to a multiple of 16 near this
  // magnitude -- decode_exact_decimal must reproduce the true value.
  FieldDecode f{"rtc_ticks", 0, 0xFFFFFFFFu, 0, false, WireType::U32, 1.0f, 0.0f};
  const uint8_t data[4] = {0x0C, 0x9F, 0xA6, 0xBC};  // 211789500 big-endian
  char buf[16];
  decode_exact_decimal(data, f, 4, 0, buf, sizeof(buf));
  check_str(buf, "211789500", "real captured rtc_ticks value decodes exactly, no 16-second quantization");
}

static void test_decode_exact_decimal_real_odd_run_time_value() {
  // Real captured value: odd_run_time raw=57411300 (this session).
  FieldDecode f{"odd_run_time", 0, 0xFFFFFFFFu, 0, false, WireType::U32, 1.0f, 0.0f};
  const uint8_t data[4] = {0x03, 0x6C, 0x06, 0xE4};  // 57411300 big-endian
  char buf[16];
  decode_exact_decimal(data, f, 4, 0, buf, sizeof(buf));
  check_str(buf, "57411300", "real captured odd_run_time value decodes exactly, no 4-second quantization");
}

static void test_decode_exact_decimal_uint32_max() {
  FieldDecode f{"uint32_max_field", 0, 0xFFFFFFFFu, 0, false, WireType::U32, 1.0f, 0.0f};
  const uint8_t data[4] = {0xFF, 0xFF, 0xFF, 0xFF};  // 4294967295
  char buf[16];
  decode_exact_decimal(data, f, 4, 0, buf, sizeof(buf));
  check_str(buf, "4294967295", "UINT32_MAX decodes exactly (float32 would round this to 4294967296.0)");
}

static void test_decode_exact_decimal_one_decimal_place_matches_bms_system_ticks_scale() {
  // bms_system_ticks: scale 0.1, decimal_precision 1. raw=21886290 ->
  // "2188629.0" (the fixed-point string a 0.1-scaled field needs, formed
  // by pure integer/string arithmetic, never raw*0.1 in float).
  FieldDecode f{"bms_system_ticks", 0, 0xFFFFFFFFu, 0, false, WireType::U32, 0.1f, 0.0f};
  const uint8_t data[4] = {0x01, 0x4D, 0xF5, 0x52};  // 21886290 big-endian
  char buf[16];
  decode_exact_decimal(data, f, 4, 1, buf, sizeof(buf));
  check_str(buf, "2188629.0", "one-decimal-place field formats as exact fixed-point, matching its canonical scale");
}

static void test_decode_exact_decimal_small_value_zero_pads_fractional_field() {
  // A hypothetical small raw value under a 3-decimal-place field must
  // still produce a well-formed "0.00N" string, not "N" or an empty
  // integer part.
  FieldDecode f{"tiny_value", 0, 0xFFFFFFFFu, 0, false, WireType::U32, 0.001f, 0.0f};
  const uint8_t data[4] = {0x00, 0x00, 0x00, 0x05};  // 5
  char buf[16];
  decode_exact_decimal(data, f, 4, 3, buf, sizeof(buf));
  check_str(buf, "0.005", "small raw value under a fractional-place field zero-pads correctly");
}

static void test_decode_exact_decimal_zero() {
  FieldDecode f{"zero_field", 0, 0xFFFFFFFFu, 0, false, WireType::U32, 1.0f, 0.0f};
  const uint8_t data[4] = {0x00, 0x00, 0x00, 0x00};
  char buf[16];
  decode_exact_decimal(data, f, 4, 0, buf, sizeof(buf));
  check_str(buf, "0", "raw zero decodes as a plain \"0\", not an empty string");
}

static void test_decode_exact_decimal_respects_mask_and_shift_like_decode_numeric() {
  // Packed high-byte-of-a-wider-value case: mask/shift must apply
  // identically to decode_numeric's own path (this function reads the
  // SAME bits, only formats them differently) -- reuses the same fixture
  // as test_decode_packed_s8_high_byte but as an unsigned 8-bit exact
  // read, since every real user of this path today is unsigned.
  FieldDecode f{"packed_high_byte", 0, 0xFF00u, 8, false, WireType::U8, 1.0f, 0.0f};
  const uint8_t data[2] = {0xF6, 0x00};  // high byte 0xF6 = 246 unsigned
  char buf[16];
  decode_exact_decimal(data, f, 2, 0, buf, sizeof(buf));
  check_str(buf, "246", "decode_exact_decimal applies mask+shift identically to decode_numeric");
}

// ---------------------------------------------------------------------
// decode_raw_u32 -- Stage 3 cell-channel batch (2026-09-17). Added so
// cell_connected_mask's decode site can export the bit-exact raw uint32_t
// into a global for resolve_topology's own bit-testing, without ever
// reading a lossy float-cast bitmask again. Every case here targets
// exactly what a bitmask needs: high bit AND low bits preserved
// SIMULTANEOUSLY (the precision risk this batch closes -- a float cast
// with any high bit set corrupts low-bit precision too, since float's ULP
// scales with magnitude), sparse/non-contiguous bit patterns, and mask/
// shift applied identically to decode_numeric's own path (same raw bits,
// only decode_exact_decimal/decode_numeric differ in how they format
// them, never in which bits they read).
// ---------------------------------------------------------------------

static void test_decode_raw_u32_bit31_and_low_bits_together() {
  // The exact scenario decode_numeric's float cast cannot represent
  // exactly: bit31 set (0x80000000) together with low bits (0x1) set.
  // float32's ULP at this magnitude is 256 -- decode_numeric would round
  // this to 2147483648.0f or 2147483904.0f, losing the low bit entirely.
  // decode_raw_u32 must reproduce it bit-for-bit.
  FieldDecode f{"cell_connected_mask", 0, 0xFFFFFFFFu, 0, false, WireType::U32, 1.0f, 0.0f};
  const uint8_t data[4] = {0x80, 0x00, 0x00, 0x01};  // 0x80000001
  check_eq<uint32_t>(decode_raw_u32(data, f, 4), 0x80000001u,
    "bit31 set together with bit0 set: both survive simultaneously, unlike a float round-trip");
  // Cross-check against decode_numeric's own OWN lossy behavior on the
  // exact same bytes -- proves this isn't a redundant test: the float
  // path genuinely disagrees with the true value here.
  // The true value (2147483649, i.e. 0x80000001) is itself not exactly
  // representable as float32 -- even the LITERAL "2147483649.0f" in this
  // source file would already be rounded by the compiler to the same
  // float32 value decode_numeric produces, so comparing against it would
  // prove nothing. 2147483648.0f (2^31, a power of two) IS exactly
  // representable and IS the value float32 rounds 0x80000001 down to --
  // asserting equality to it is the precise, stable way to show the low
  // bit is gone.
  const float lossy = decode_numeric(data, f, 4);
  check(lossy == 2147483648.0f,
    "decode_numeric's float cast genuinely loses precision on this same input (rounds 0x80000001 down to 2147483648.0f -- the low bit is gone)");
}

static void test_decode_raw_u32_sparse_mask() {
  // A scattered, non-contiguous bit pattern (e.g. an implausible/faulty
  // connected-cell mask a real resolver must still decode correctly even
  // though it will go on to reject it as MISMATCH) -- proves no bit
  // silently gets dropped or merged.
  FieldDecode f{"cell_connected_mask", 0, 0xFFFFFFFFu, 0, false, WireType::U32, 1.0f, 0.0f};
  const uint8_t data[4] = {0x00, 0x01, 0x00, 0x05};  // bits 0, 2, 16 set -- 0x00010005
  check_eq<uint32_t>(decode_raw_u32(data, f, 4), 0x00010005u, "sparse/non-contiguous bit pattern decodes exactly");
}

static void test_decode_raw_u32_16s_deployed_mask() {
  // The exact, real 16S deployed-unit shape: bits 0-15 set (all 16
  // channels connected), bits 16-31 clear -- confirmed on real hardware
  // this session as the plausible/expected mask for the deployed unit.
  FieldDecode f{"cell_connected_mask", 0, 0xFFFFFFFFu, 0, false, WireType::U32, 1.0f, 0.0f};
  const uint8_t data[4] = {0x00, 0x00, 0xFF, 0xFF};  // 0x0000FFFF
  check_eq<uint32_t>(decode_raw_u32(data, f, 4), 0x0000FFFFu, "16S deployed-unit mask (bits 0-15 set) decodes exactly");
}

static void test_decode_raw_u32_all_32_channels() {
  // The full 32-channel protocol-capacity case (never claimed as verified
  // hardware behavior for the deployed 16S unit -- exercises the decode
  // path's own correctness at the protocol's documented ceiling, not a
  // hardware capability claim).
  FieldDecode f{"cell_connected_mask", 0, 0xFFFFFFFFu, 0, false, WireType::U32, 1.0f, 0.0f};
  const uint8_t data[4] = {0xFF, 0xFF, 0xFF, 0xFF};
  check_eq<uint32_t>(decode_raw_u32(data, f, 4), 0xFFFFFFFFu, "all 32 channels connected (protocol capacity ceiling) decodes exactly");
}

static void test_decode_raw_u32_zero() {
  FieldDecode f{"cell_connected_mask", 0, 0xFFFFFFFFu, 0, false, WireType::U32, 1.0f, 0.0f};
  const uint8_t data[4] = {0x00, 0x00, 0x00, 0x00};
  check_eq<uint32_t>(decode_raw_u32(data, f, 4), 0u, "all-zero mask decodes exactly as 0 (a real value, distinguished by the caller's own valid flag from 'never decoded')");
}

static void test_decode_raw_u32_respects_mask_and_shift_like_decode_numeric() {
  // Same fixture as test_decode_exact_decimal_respects_mask_and_shift_like_decode_numeric
  // -- proves decode_raw_u32 reads the identical bits decode_numeric and
  // decode_exact_decimal already agree on, for a packed sub-field.
  FieldDecode f{"packed_high_byte", 0, 0xFF00u, 8, false, WireType::U8, 1.0f, 0.0f};
  const uint8_t data[2] = {0xF6, 0x00};
  check_eq<uint32_t>(decode_raw_u32(data, f, 2), 246u, "decode_raw_u32 applies mask+shift identically to decode_numeric/decode_exact_decimal");
}

// ---------------------------------------------------------------------
// decode_bool
// ---------------------------------------------------------------------

static void test_decode_bool_bit_set() {
  // charging_float_mode (0x1114): BIT, mask 0x0200.
  FieldDecode f{"charging_float_mode", 0, 0x0200u, 9, false, WireType::BIT, 1.0f, 0.0f};
  const uint8_t data[2] = {0x02, 0x00};  // bit 9 set (0x0200)
  check(decode_bool(data, f, 2), "BIT field decodes true when the bit is set");
}

static void test_decode_bool_bit_clear() {
  FieldDecode f{"charging_float_mode", 0, 0x0200u, 9, false, WireType::BIT, 1.0f, 0.0f};
  const uint8_t data[2] = {0x00, 0x00};
  check(!decode_bool(data, f, 2), "BIT field decodes false when the bit is clear");
}

static void test_decode_bool_ignores_other_bits() {
  FieldDecode f{"charging_float_mode", 0, 0x0200u, 9, false, WireType::BIT, 1.0f, 0.0f};
  const uint8_t data[2] = {0xFD, 0xFF};  // every bit set except 0x0200
  check(!decode_bool(data, f, 2), "BIT field ignores every bit outside its own mask");
}

// ---------------------------------------------------------------------
// decode_hex_string (2026-09-20, UART raw-bitmask arrays -- UART1MPRTOLEnable/
// UARTMPRTOLEnable[0-15]): safe, deterministic byte-to-hex projection,
// no ASCII assumption, bounds-checked, exactly 16 bytes.
// ---------------------------------------------------------------------

static void test_decode_hex_string_00_and_ff() {
  const uint8_t data[16] = {0x00, 0xFF, 0x00, 0xFF, 0x00, 0xFF, 0x00, 0xFF,
                             0x00, 0xFF, 0x00, 0xFF, 0x00, 0xFF, 0x00, 0xFF};
  char out[64];
  decode_hex_string(data, 16, out, sizeof(out));
  check(std::strcmp(out, "00 FF 00 FF 00 FF 00 FF 00 FF 00 FF 00 FF 00 FF") == 0,
        "decode_hex_string renders alternating 0x00/0xFF bytes correctly, uppercase, space-separated");
}

static void test_decode_hex_string_embedded_nul_not_truncated() {
  // The whole point of decode_hex_string over decode_ascii: an embedded
  // 0x00 byte in the MIDDLE of the array must NOT stop output early --
  // decode_ascii() would silently truncate here; this must not.
  const uint8_t data[16] = {0x41, 0x42, 0x00, 0x43, 0x44, 0x00, 0x00, 0x45,
                             0x46, 0x47, 0x48, 0x49, 0x4A, 0x4B, 0x4C, 0x4D};
  char out[64];
  decode_hex_string(data, 16, out, sizeof(out));
  check(std::strcmp(out, "41 42 00 43 44 00 00 45 46 47 48 49 4A 4B 4C 4D") == 0,
        "decode_hex_string does not truncate at an embedded 0x00 byte (unlike decode_ascii)");
  check(std::strlen(out) == 47, "decode_hex_string's output for 16 bytes is exactly 47 chars (16*2 hex digits + 15 separators), proving no early stop");
}

static void test_decode_hex_string_exactly_16_bytes() {
  const uint8_t data[16] = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16};
  char out[64];
  decode_hex_string(data, 16, out, sizeof(out));
  // Count space-separated tokens -- must be exactly 16, not more, not fewer.
  int tokenCount = 1;
  for (const char *p = out; *p; p++) if (*p == ' ') tokenCount++;
  check_eq(tokenCount, 16, "decode_hex_string produces exactly 16 hex tokens for a 16-byte input");
}

static void test_decode_hex_string_bounds_checked_small_buffer() {
  // A buffer too small for the full 47-char+NUL output must never be
  // overrun -- decode_hex_string must truncate safely, not write past
  // out_capacity.
  const uint8_t data[16] = {0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF, 0x11, 0x22,
                             0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0x00};
  char out[8];  // far too small for the full output
  decode_hex_string(data, 16, out, sizeof(out));
  check(std::strlen(out) < sizeof(out), "decode_hex_string never writes past a too-small out_capacity (output length stays under the buffer size)");
  bool nulFound = false;
  for (size_t i = 0; i < sizeof(out); i++) if (out[i] == '\0') { nulFound = true; break; }
  check(nulFound, "decode_hex_string's small-buffer output is still NUL-terminated within the buffer bounds");
}

static void test_decode_hex_string_deterministic() {
  const uint8_t data[16] = {0x01, 0x23, 0x45, 0x67, 0x89, 0xAB, 0xCD, 0xEF,
                             0xFE, 0xDC, 0xBA, 0x98, 0x76, 0x54, 0x32, 0x10};
  char out1[64];
  char out2[64];
  decode_hex_string(data, 16, out1, sizeof(out1));
  decode_hex_string(data, 16, out2, sizeof(out2));
  check(std::strcmp(out1, out2) == 0, "decode_hex_string is deterministic -- identical input always produces identical output");
  check(std::strcmp(out1, "01 23 45 67 89 AB CD EF FE DC BA 98 76 54 32 10") == 0,
        "decode_hex_string's exact expected string matches for a known 16-byte input");
}

static void test_decode_hex_string_uppercase_only() {
  const uint8_t data[16] = {0xab, 0xcd, 0xef, 0x01, 0x02, 0x03, 0x04, 0x05,
                             0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d};
  char out[64];
  decode_hex_string(data, 16, out, sizeof(out));
  bool hasLowercase = false;
  for (const char *p = out; *p; p++) {
    if (*p >= 'a' && *p <= 'f') hasLowercase = true;
  }
  check(!hasLowercase, "decode_hex_string's canonical format is uppercase hex only, never lowercase");
}

// ---------------------------------------------------------------------
// BlockState transitions
// ---------------------------------------------------------------------

static void test_mark_issued_sets_pending_and_timestamp() {
  BlockState s{};
  mark_issued(s, 1000);
  check_eq<uint8_t>(s.transport_state, PENDING, "mark_issued sets PENDING");
  check_eq<uint32_t>(s.last_attempt_ms, 1000u, "mark_issued records last_attempt_ms");
}

static void test_mark_success_bumps_revision_and_clears_pending() {
  BlockState s{};
  mark_issued(s, 1000);
  mark_success(s, 1050);
  check_eq<uint8_t>(s.transport_state, IDLE, "mark_success clears PENDING back to IDLE");
  check_eq<uint32_t>(s.last_success_ms, 1050u, "mark_success records last_success_ms");
  check_eq<uint32_t>(s.revision, 1u, "mark_success bumps revision");
  mark_issued(s, 2000);
  mark_success(s, 2050);
  check_eq<uint32_t>(s.revision, 2u, "mark_success bumps revision again on a second success");
}

static void test_mark_error_and_timeout_do_not_bump_revision() {
  BlockState s{};
  mark_issued(s, 1000);
  mark_error(s);
  check_eq<uint32_t>(s.revision, 0u, "mark_error does not bump revision (no new valid data)");
  check_eq<uint16_t>(s.error_count, 1u, "mark_error increments error_count");
  mark_issued(s, 2000);
  mark_timeout(s);
  check_eq<uint32_t>(s.revision, 0u, "mark_timeout does not bump revision");
  check_eq<uint16_t>(s.timeout_count, 1u, "mark_timeout increments timeout_count");
}

// ---------------------------------------------------------------------
// pick_next_block -- three-tier priority
// ---------------------------------------------------------------------

static void test_pick_next_block_write_in_flight_blocks_everything() {
  std::array<BlockState, 2> states{};
  uint32_t cadence[2] = {1000, 1000};
  const int idx = pick_next_block(states, cadence, /*write_in_flight=*/true, -1, 100000);
  check_eq(idx, NO_BLOCK, "write_in_flight suppresses every read, even a maximally-overdue one");
}

static void test_pick_next_block_never_attempted_wins_first() {
  std::array<BlockState, 3> states{};
  uint32_t cadence[3] = {1000, 5000, 15000};
  const int idx = pick_next_block(states, cadence, false, -1, 500);
  check(idx != NO_BLOCK, "a never-attempted block is immediately due");
}

static void test_pick_next_block_respects_cadence_not_yet_due() {
  std::array<BlockState, 1> states{};
  states[0].last_attempt_ms = 1000;
  states[0].last_success_ms = 1000;
  uint32_t cadence[1] = {5000};
  const int idx = pick_next_block(states, cadence, false, -1, 3000);  // only 2000ms elapsed
  check_eq(idx, NO_BLOCK, "a block not yet at its cadence deadline is not picked");
}

static void test_pick_next_block_due_after_cadence_elapses() {
  std::array<BlockState, 1> states{};
  states[0].last_attempt_ms = 1000;
  states[0].last_success_ms = 1000;
  uint32_t cadence[1] = {5000};
  const int idx = pick_next_block(states, cadence, false, -1, 6001);  // 5001ms elapsed
  check_eq(idx, 0, "a block becomes due exactly once its cadence has elapsed");
}

static void test_pick_next_block_on_demand_never_auto_picked() {
  std::array<BlockState, 1> states{};
  uint32_t cadence[1] = {0};  // on-demand only
  const int idx = pick_next_block(states, cadence, false, -1, 1000000);
  check_eq(idx, NO_BLOCK, "cadence_ms=0 (on-demand) is never auto-scheduled, no matter how much time passes");
}

static void test_pick_next_block_prefers_most_overdue() {
  std::array<BlockState, 2> states{};
  states[0].last_attempt_ms = 9000;
  states[0].last_success_ms = 9000;  // due at 10000, 1000ms overdue by now=11000
  states[1].last_attempt_ms = 10500;
  states[1].last_success_ms = 10500;  // due at 11500, NOT yet due by now=11000
  uint32_t cadence[2] = {1000, 1000};
  const int idx = pick_next_block(states, cadence, false, -1, 11000);
  check_eq(idx, 0, "the only currently-due block is picked over one not yet due");
}

static void test_pick_next_block_tie_break_prefers_more_overdue() {
  std::array<BlockState, 2> states{};
  states[0].last_attempt_ms = 5000;
  states[0].last_success_ms = 5000;  // due at 6000, overdue by 4000 at now=10000
  states[1].last_attempt_ms = 8000;
  states[1].last_success_ms = 8000;  // due at 9000, overdue by 1000 at now=10000
  uint32_t cadence[2] = {1000, 1000};
  const int idx = pick_next_block(states, cadence, false, -1, 10000);
  check_eq(idx, 0, "among several due blocks, the most overdue one wins");
}

static void test_pick_next_block_active_group_wins_when_due() {
  std::array<BlockState, 2> states{};
  states[0].last_attempt_ms = 5000;
  states[0].last_success_ms = 5000;  // most overdue -- would normally win
  states[1].last_attempt_ms = 9500;
  states[1].last_success_ms = 9500;  // less overdue, but is the active-group block
  uint32_t cadence[2] = {1000, 1000};
  const int idx = pick_next_block(states, cadence, false, /*active_group_block_index=*/1, 10600);
  check_eq(idx, 1, "the active-group block wins over a more-overdue block, once due itself");
}

static void test_pick_next_block_active_group_cannot_preempt_when_not_due() {
  std::array<BlockState, 2> states{};
  states[0].last_attempt_ms = 5000;
  states[0].last_success_ms = 5000;  // due, overdue
  states[1].last_attempt_ms = 9999;
  states[1].last_success_ms = 9999;  // active group, but NOT yet due
  uint32_t cadence[2] = {1000, 1000};
  const int idx = pick_next_block(states, cadence, false, /*active_group_block_index=*/1, 10500);
  check_eq(idx, 0, "the active-group hint never pulls in a block that isn't due yet -- tier-3 fallback wins instead");
}

static void test_pick_next_block_active_group_cannot_preempt_write_in_flight() {
  std::array<BlockState, 1> states{};
  uint32_t cadence[1] = {1000};
  const int idx = pick_next_block(states, cadence, /*write_in_flight=*/true, /*active_group_block_index=*/0, 100000);
  check_eq(idx, NO_BLOCK, "the active-group hint cannot override a write in flight (tier-1 always wins)");
}

// ---------------------------------------------------------------------
// resolve_active_group_block_index (Stage 1 hardware acceptance corrective
// pass -- real active-group scheduler consumption, replacing the previously
// hardcoded active_group_block_index=-1). Blocks constructed with only the
// fields these tests exercise -- ui_group is the ONLY one resolve_active_group_
// block_index reads.
// ---------------------------------------------------------------------

static Block make_block(int8_t ui_group) {
  Block b{};
  b.ui_group = ui_group;
  return b;
}

static void test_resolve_active_group_finds_matching_block() {
  Block blocks[3] = {make_block(-1), make_block(5), make_block(-1)};
  const int idx = resolve_active_group_block_index(blocks, /*hint_group=*/5, /*hint_active=*/true);
  check_eq(idx, 1, "resolves to the block whose ui_group matches the hinted group");
}

static void test_resolve_active_group_no_match_returns_no_block() {
  Block blocks[3] = {make_block(-1), make_block(3), make_block(-1)};
  const int idx = resolve_active_group_block_index(blocks, /*hint_group=*/5, /*hint_active=*/true);
  check_eq(idx, NO_BLOCK, "no block carries the hinted group -- resolves to NO_BLOCK, never a guess");
}

static void test_resolve_active_group_inactive_hint_returns_no_block_even_with_a_match() {
  Block blocks[1] = {make_block(5)};
  const int idx = resolve_active_group_block_index(blocks, /*hint_group=*/5, /*hint_active=*/false);
  check_eq(idx, NO_BLOCK, "an expired/absent hint (hint_active=false) never resolves, even if some block would match");
}

static void test_resolve_active_group_rejects_out_of_range_group() {
  Block blocks[1] = {make_block(0)};
  check_eq(resolve_active_group_block_index(blocks, /*hint_group=*/0, /*hint_active=*/true), NO_BLOCK,
    "group 0 is out of the valid 1-12 range -- never resolves, even if a block's (default-initialized) ui_group is 0");
  Block blocks2[1] = {make_block(13)};
  check_eq(resolve_active_group_block_index(blocks2, /*hint_group=*/13, /*hint_active=*/true), NO_BLOCK,
    "group 13 is out of the valid 1-12 range -- never resolves");
}

static void test_resolve_active_group_matches_todays_real_data_all_unset() {
  // The real, generated jk_read_plan::kBlocks table has ui_group=-1 for
  // every block today (per-field ui_group population is Stage 2's own
  // deliverable -- see generate_read_plan.js's aggregateUiGroup() comment).
  // This is the guaranteed-no-op-against-production-data case, proven here
  // rather than just asserted in a comment.
  Block blocks[4] = {make_block(-1), make_block(-1), make_block(-1), make_block(-1)};
  for (int g = 1; g <= 12; g++) {
    check_eq(resolve_active_group_block_index(blocks, g, true), NO_BLOCK,
      "against today's real all-unset block data, every valid group hint still resolves to NO_BLOCK");
  }
}

// End-to-end: resolve_active_group_block_index's output, fed straight into
// pick_next_block, actually changes which block is chosen -- proves the two
// real functions compose correctly together, not just individually.
static void test_active_group_end_to_end_boosts_the_hinted_block_once_due() {
  Block blocks[2] = {make_block(-1), make_block(7)};
  std::array<BlockState, 2> states{};
  states[0].last_attempt_ms = 5000;
  states[0].last_success_ms = 5000;  // most overdue by cadence alone -- would normally win
  states[1].last_attempt_ms = 9500;
  states[1].last_success_ms = 9500;  // less overdue, but carries the hinted group and is due
  uint32_t cadence[2] = {1000, 1000};

  const int resolved = resolve_active_group_block_index(blocks, /*hint_group=*/7, /*hint_active=*/true);
  check_eq(resolved, 1, "end-to-end: resolve finds block 1 (ui_group 7)");
  const int chosen = pick_next_block(states, cadence, /*write_in_flight=*/false, resolved, 10600);
  check_eq(chosen, 1, "end-to-end: pick_next_block then prefers block 1 over the more-overdue block 0");

  // No starvation: the SAME two blocks, one tick later, with no hint at all
  // (or the hint now pointing elsewhere) -- block 0 still gets its turn on
  // cadence, proving the boost never permanently locks other blocks out.
  states[1].last_attempt_ms = 10600;  // block 1 was just issued
  states[1].last_success_ms = 10600;
  const int chosen_next = pick_next_block(states, cadence, /*write_in_flight=*/false, NO_BLOCK, 11700);
  check_eq(chosen_next, 0, "no starvation: with the boost gone, the other block is still picked on its own cadence");
}

int main() {
  test_decode_u32_full_register_with_scale();
  test_decode_s32_capacity_remaining_negative_wire_sign();
  test_decode_packed_s8_high_byte();
  test_decode_packed_s8_low_byte_unaffected_by_high_byte();
  test_decode_u8_low_byte_of_two_byte_register_not_confused_with_one_byte_register();
  test_decode_f32_reinterprets_bit_pattern();
  test_decode_u16_no_scale();
  test_decode_s16_negative();

  test_decode_exact_decimal_below_float_ceiling_matches_decode_numeric();
  test_decode_exact_decimal_above_float_ceiling_where_decode_numeric_would_round();
  test_decode_exact_decimal_real_rtc_ticks_value();
  test_decode_exact_decimal_real_odd_run_time_value();
  test_decode_exact_decimal_uint32_max();
  test_decode_exact_decimal_one_decimal_place_matches_bms_system_ticks_scale();
  test_decode_exact_decimal_small_value_zero_pads_fractional_field();
  test_decode_exact_decimal_zero();
  test_decode_exact_decimal_respects_mask_and_shift_like_decode_numeric();

  test_decode_raw_u32_bit31_and_low_bits_together();
  test_decode_raw_u32_sparse_mask();
  test_decode_raw_u32_16s_deployed_mask();
  test_decode_raw_u32_all_32_channels();
  test_decode_raw_u32_zero();
  test_decode_raw_u32_respects_mask_and_shift_like_decode_numeric();

  test_decode_bool_bit_set();
  test_decode_bool_bit_clear();
  test_decode_bool_ignores_other_bits();

  test_decode_hex_string_00_and_ff();
  test_decode_hex_string_embedded_nul_not_truncated();
  test_decode_hex_string_exactly_16_bytes();
  test_decode_hex_string_bounds_checked_small_buffer();
  test_decode_hex_string_deterministic();
  test_decode_hex_string_uppercase_only();

  test_mark_issued_sets_pending_and_timestamp();
  test_mark_success_bumps_revision_and_clears_pending();
  test_mark_error_and_timeout_do_not_bump_revision();

  test_pick_next_block_write_in_flight_blocks_everything();
  test_pick_next_block_never_attempted_wins_first();
  test_pick_next_block_respects_cadence_not_yet_due();
  test_pick_next_block_due_after_cadence_elapses();
  test_pick_next_block_on_demand_never_auto_picked();
  test_pick_next_block_prefers_most_overdue();
  test_pick_next_block_tie_break_prefers_more_overdue();
  test_pick_next_block_active_group_wins_when_due();
  test_pick_next_block_active_group_cannot_preempt_when_not_due();
  test_pick_next_block_active_group_cannot_preempt_write_in_flight();

  test_resolve_active_group_finds_matching_block();
  test_resolve_active_group_no_match_returns_no_block();
  test_resolve_active_group_inactive_hint_returns_no_block_even_with_a_match();
  test_resolve_active_group_rejects_out_of_range_group();
  test_resolve_active_group_matches_todays_real_data_all_unset();
  test_active_group_end_to_end_boosts_the_hinted_block_once_due();

  std::printf("%d checks run, %d failed.\n", g_checks, g_failures);
  return g_failures == 0 ? 0 : 1;
}
