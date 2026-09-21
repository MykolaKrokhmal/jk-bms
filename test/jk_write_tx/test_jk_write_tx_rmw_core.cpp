// Host-side unit tests for jk_write_tx_core.h's Stage 4 (typed-petting-
// puzzle plan §5 Phase 4) real read-modify-write encode/merge core:
// raw_is_fresh(), encode_numeric_field(), merge_field_into_raw(),
// verify_sibling_bits_preserved(). No ESP32, no ESPHome, no ESP-IDF, no
// real Modbus needed.
//
//   g++ -std=c++17 -Wall -Wextra -I ../../components/jk_write_tx \
//       test_jk_write_tx_rmw_core.cpp -o test_jk_write_tx_rmw_core
//   ./test_jk_write_tx_rmw_core

#include "jk_write_tx_core.h"

#include <cstdio>
#include <limits>

using namespace jk_write_tx;

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
}  // namespace

// ---------------------------------------------------------------------
// raw_is_fresh
// ---------------------------------------------------------------------
static void test_raw_is_fresh_never_succeeded() {
  check(!raw_is_fresh(0, 100000, 320000), "last_success_ms==0 (never once succeeded) is never fresh");
}
static void test_raw_is_fresh_within_budget() {
  check(raw_is_fresh(100000, 100500, 320000), "500ms old, 320s budget -- fresh");
}
static void test_raw_is_fresh_exactly_at_budget() {
  check(raw_is_fresh(100000, 100000 + 320000, 320000), "exactly at the budget boundary -- still fresh (<=)");
}
static void test_raw_is_fresh_past_budget() {
  check(!raw_is_fresh(100000, 100000 + 320001, 320000), "1ms past the budget -- stale");
}
static void test_raw_is_fresh_clock_inconsistent() {
  check(!raw_is_fresh(500000, 100000, 320000), "now < last_success_ms (clock rollover/inconsistency) fails closed");
}

// ---------------------------------------------------------------------
// encode_numeric_field
// ---------------------------------------------------------------------
static void test_encode_unsigned_basic() {
  // smart_sleep: scale=0.001, offset=0, field_width_bits=32, range [0,6].
  const auto r = encode_numeric_field(3.5, false, 0.001, 0.0, 0.0, 6.0, 32);
  check(r.status == EncodeStatus::OK, "unsigned basic encode OK");
  check_eq<uint32_t>(r.encoded_raw, 3500u, "3.5V / 0.001 scale -> raw 3500");
}
static void test_encode_signed_basic() {
  // rfv_time-style: scale=0.1, offset=0, 8-bit signed-capable field, value -5.0
  const auto r = encode_numeric_field(-5.0, true, 0.1, 0.0, -12.8, 12.7, 8);
  check(r.status == EncodeStatus::OK, "signed basic encode OK");
  // -5.0/0.1 = -50 = 0xCE in 8-bit two's complement
  check_eq<uint32_t>(r.encoded_raw, 0xCEu, "-5.0 at scale 0.1 -> raw 0xCE (two's complement, 8-bit)");
}
static void test_encode_signed_negative_one() {
  const auto r = encode_numeric_field(-1.0, true, 1.0, 0.0, -128.0, 127.0, 8);
  check(r.status == EncodeStatus::OK, "signed -1 encode OK");
  check_eq<uint32_t>(r.encoded_raw, 0xFFu, "-1 (scale 1) -> raw 0xFF (8-bit two's complement)");
}
static void test_encode_rejects_nan() {
  const auto r = encode_numeric_field(std::nan(""), false, 1.0, 0.0, 0.0, 100.0, 8);
  check(r.status == EncodeStatus::NOT_FINITE, "NaN rejected as NOT_FINITE");
}
static void test_encode_rejects_infinity() {
  const auto r = encode_numeric_field(std::numeric_limits<double>::infinity(), false, 1.0, 0.0, 0.0, 100.0, 8);
  check(r.status == EncodeStatus::NOT_FINITE, "+Infinity rejected as NOT_FINITE");
}
static void test_encode_rejects_below_minimum() {
  const auto r = encode_numeric_field(-1.0, false, 1.0, 0.0, 0.0, 100.0, 8);
  check(r.status == EncodeStatus::OUT_OF_RANGE, "below minimum rejected as OUT_OF_RANGE");
}
static void test_encode_rejects_above_maximum() {
  const auto r = encode_numeric_field(101.0, false, 1.0, 0.0, 0.0, 100.0, 8);
  check(r.status == EncodeStatus::OUT_OF_RANGE, "above maximum rejected as OUT_OF_RANGE");
}
static void test_encode_accepts_exact_minimum() {
  const auto r = encode_numeric_field(0.0, false, 1.0, 0.0, 0.0, 100.0, 8);
  check(r.status == EncodeStatus::OK, "exact minimum boundary accepted");
  check_eq<uint32_t>(r.encoded_raw, 0u, "minimum boundary encodes to 0");
}
static void test_encode_accepts_exact_maximum() {
  const auto r = encode_numeric_field(100.0, false, 1.0, 0.0, 0.0, 100.0, 8);
  check(r.status == EncodeStatus::OK, "exact maximum boundary accepted");
  check_eq<uint32_t>(r.encoded_raw, 100u, "maximum boundary encodes to 100");
}
static void test_encode_rejects_unsigned_overflow_beyond_field_width() {
  // maximum is deliberately set wider than the 8-bit field can hold, to
  // isolate the field-width overflow check from the domain range check.
  const auto r = encode_numeric_field(300.0, false, 1.0, 0.0, 0.0, 1000.0, 8);
  check(r.status == EncodeStatus::OVERFLOWS_FIELD, "300 does not fit an 8-bit unsigned field (max 255) -- OVERFLOWS_FIELD");
}
static void test_encode_rejects_signed_overflow_beyond_field_width() {
  const auto r = encode_numeric_field(200.0, true, 1.0, 0.0, -1000.0, 1000.0, 8);
  check(r.status == EncodeStatus::OVERFLOWS_FIELD, "200 does not fit an 8-bit signed field (max 127) -- OVERFLOWS_FIELD");
}
static void test_encode_rejects_negative_for_unsigned_field() {
  // Domain range permits it (minimum deliberately wide) but the field
  // itself is unsigned -- a negative raw value can never be represented.
  const auto r = encode_numeric_field(-5.0, false, 1.0, 0.0, -1000.0, 1000.0, 8);
  check(r.status == EncodeStatus::OVERFLOWS_FIELD, "negative value for an unsigned field -- OVERFLOWS_FIELD");
}
static void test_encode_one_bit_field_boundary() {
  const auto rOk = encode_numeric_field(1.0, false, 1.0, 0.0, 0.0, 1.0, 1);
  check(rOk.status == EncodeStatus::OK, "1-bit field value=1 OK");
  check_eq<uint32_t>(rOk.encoded_raw, 1u, "1-bit field value=1 encodes to 1");
  const auto rOverflow = encode_numeric_field(2.0, false, 1.0, 0.0, 0.0, 3.0, 1);
  check(rOverflow.status == EncodeStatus::OVERFLOWS_FIELD, "1-bit field value=2 (fits domain but not the bit) -- OVERFLOWS_FIELD");
}
static void test_encode_rounds_to_nearest() {
  const auto r = encode_numeric_field(3.4999, false, 0.001, 0.0, 0.0, 6.0, 32);
  check(r.status == EncodeStatus::OK, "rounding case OK");
  check_eq<uint32_t>(r.encoded_raw, 3500u, "3.4999 rounds to 3500 raw units (nearest-integer rounding)");
}

// ---------------------------------------------------------------------
// merge_field_into_raw
// ---------------------------------------------------------------------
static void test_merge_full_width_no_siblings() {
  // mask=0xFFFFFFFF, shift=0 -- direct full-width write degenerates to
  // "just the encoded value", exactly the "no unnecessary merge" case.
  const uint32_t merged = merge_field_into_raw(0xDEADBEEFu, 0xFFFFFFFFu, 0, 0x00003500u);
  check_eq<uint32_t>(merged, 0x00003500u, "full-width mask -- merged == encoded, old_raw fully replaced");
}
static void test_merge_packed_low_byte() {
  // rfv_time: low byte (mask 0x00FF, shift 0), old_raw has rcv_time=0x05 in
  // the high byte -- writing rfv_time=0x01 must preserve the high byte.
  const uint32_t old_raw = 0x0500u; // high byte 0x05 (rcv_time), low byte 0x00 (rfv_time)
  const uint32_t merged = merge_field_into_raw(old_raw, 0x00FFu, 0, 0x01u);
  check_eq<uint32_t>(merged, 0x0501u, "packed low byte write preserves the untouched high byte");
}
static void test_merge_packed_high_byte() {
  const uint32_t old_raw = 0x0001u; // high byte 0x00 (rcv_time), low byte 0x01 (rfv_time)
  const uint32_t merged = merge_field_into_raw(old_raw, 0xFF00u, 8, 0x05u);
  check_eq<uint32_t>(merged, 0x0501u, "packed high byte write preserves the untouched low byte");
}
static void test_merge_single_bit() {
  // heat_en: bit 0 of a 9-bit-plus-sibling packed register.
  const uint32_t old_raw = 0x03FEu; // bit0=0, bits1-9 various siblings set
  const uint32_t merged = merge_field_into_raw(old_raw, 0x0001u, 0, 1u);
  check_eq<uint32_t>(merged, 0x03FFu, "setting bit0 preserves every other bit in a 10-sibling packed register");
}
static void test_merge_single_bit_clear() {
  const uint32_t old_raw = 0x03FFu;
  const uint32_t merged = merge_field_into_raw(old_raw, 0x0001u, 0, 0u);
  check_eq<uint32_t>(merged, 0x03FEu, "clearing bit0 preserves every other bit");
}
static void test_merge_multiword_32bit_no_truncation() {
  // A 32-bit packed field is still safe in plain uint32_t arithmetic (no
  // BigInt/64-bit widening needed anywhere in this project -- every real
  // RW field's own field_width_bits is <=32 except setup_passcode, which
  // is a full-width, non-packed 128-bit field with mask==null, never
  // routed through merge_field_into_raw() at all).
  const uint32_t old_raw = 0xFFFFFFFFu;
  const uint32_t merged = merge_field_into_raw(old_raw, 0xFFFFFFFFu, 0, 0x12345678u);
  check_eq<uint32_t>(merged, 0x12345678u, "32-bit full-width merge, no truncation");
}
static void test_merge_high_shift_does_not_overflow() {
  // Confirms the (encoded << shift) step itself does not silently drop
  // bits for the widest legitimate packed shift in this project (shift=24,
  // a hypothetical top byte of a 32-bit register).
  const uint32_t old_raw = 0x00FFFFFFu;
  const uint32_t merged = merge_field_into_raw(old_raw, 0xFF000000u, 24, 0xABu);
  check_eq<uint32_t>(merged, 0xABFFFFFFu, "shift=24 byte merge does not overflow/truncate");
}

// ---------------------------------------------------------------------
// verify_sibling_bits_preserved
// ---------------------------------------------------------------------
static void test_sibling_bits_preserved_true() {
  check(verify_sibling_bits_preserved(0x0501u, 0x0502u, 0x00FFu),
        "target byte changed (0x01->0x02), sibling high byte (0x05) unchanged -- preserved");
}
static void test_sibling_bits_preserved_false_when_sibling_changed() {
  check(!verify_sibling_bits_preserved(0x0501u, 0x0602u, 0x00FFu),
        "sibling high byte ALSO changed (0x05->0x06) -- NOT preserved, must be flagged");
}
static void test_sibling_bits_preserved_full_width_always_true() {
  // mask covers every bit -- there is no sibling to preserve, vacuously true.
  check(verify_sibling_bits_preserved(0x11111111u, 0x99999999u, 0xFFFFFFFFu),
        "full-width mask -- no siblings exist, always preserved");
}

// ---------------------------------------------------------------------
// End-to-end RMW composition: encode -> merge -> verify, for real
// candidate fields (rcv_time/rfv_time at 0x1504, packed low/high byte).
// ---------------------------------------------------------------------
static void test_end_to_end_rcv_rfv_independent_writes() {
  // Real geometry from registers.canonical.json: rcv_time byte_offset=1
  // mask=0x00FF shift=0 scale=0.1; rfv_time byte_offset=0 mask=0xFF00
  // shift=8 scale=0.1. Both unsigned, field_width_bits=8.
  uint32_t raw = 0x0000u; // rcv_time=0.0h, rfv_time=0.0h

  // Write rfv_time = 1.0h (encoded raw = 10 = 0x0A) into the high byte.
  const auto encRfv = encode_numeric_field(1.0, false, 0.1, 0.0, 0.0, 25.5, 8);
  check(encRfv.status == EncodeStatus::OK, "rfv_time=1.0h encodes OK");
  raw = merge_field_into_raw(raw, 0xFF00u, 8, encRfv.encoded_raw);
  check_eq<uint32_t>(raw, 0x0A00u, "rfv_time write alone: high byte 0x0A, low byte untouched");

  // Now write rcv_time = 5.0h (encoded raw = 50 = 0x32) into the low byte
  // -- must NOT disturb rfv_time's already-written high byte.
  const auto encRcv = encode_numeric_field(5.0, false, 0.1, 0.0, 0.0, 25.5, 8);
  check(encRcv.status == EncodeStatus::OK, "rcv_time=5.0h encodes OK");
  raw = merge_field_into_raw(raw, 0x00FFu, 0, encRcv.encoded_raw);
  check_eq<uint32_t>(raw, 0x0A32u, "rcv_time write preserves the previously-written rfv_time high byte");

  check(verify_sibling_bits_preserved(0x0A00u, raw, 0x00FFu),
        "final raw preserves the rfv_time sibling bits relative to the post-rfv-write snapshot");
}

int main() {
  test_raw_is_fresh_never_succeeded();
  test_raw_is_fresh_within_budget();
  test_raw_is_fresh_exactly_at_budget();
  test_raw_is_fresh_past_budget();
  test_raw_is_fresh_clock_inconsistent();

  test_encode_unsigned_basic();
  test_encode_signed_basic();
  test_encode_signed_negative_one();
  test_encode_rejects_nan();
  test_encode_rejects_infinity();
  test_encode_rejects_below_minimum();
  test_encode_rejects_above_maximum();
  test_encode_accepts_exact_minimum();
  test_encode_accepts_exact_maximum();
  test_encode_rejects_unsigned_overflow_beyond_field_width();
  test_encode_rejects_signed_overflow_beyond_field_width();
  test_encode_rejects_negative_for_unsigned_field();
  test_encode_one_bit_field_boundary();
  test_encode_rounds_to_nearest();

  test_merge_full_width_no_siblings();
  test_merge_packed_low_byte();
  test_merge_packed_high_byte();
  test_merge_single_bit();
  test_merge_single_bit_clear();
  test_merge_multiword_32bit_no_truncation();
  test_merge_high_shift_does_not_overflow();

  test_sibling_bits_preserved_true();
  test_sibling_bits_preserved_false_when_sibling_changed();
  test_sibling_bits_preserved_full_width_always_true();

  test_end_to_end_rcv_rfv_independent_writes();

  std::printf("\n%d checks run, %d failed.\n", g_checks, g_failures);
  return g_failures == 0 ? 0 : 1;
}
