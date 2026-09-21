// Host-side unit tests for jk_write_tx_core.h's width-aware register-
// container semantics (container_mask_for_word_count, validate_field_
// geometry, format_hex_fixed_width, hex_digits_for_word_count) -- added
// 2026-09-21 after a real, live preflight against gps_heartbeat on real
// hardware found RegisterWritePreflightHandler (batterylifepo4.yaml)
// reporting preservation_mask as the unbounded 32-bit complement of a
// 16-bit field's own mask, truncated by a too-small hex buffer into the
// nonsensical "0xFFFFF". These are the SAME production functions
// RegisterWritePreflightHandler now calls -- not a reimplementation of
// the formula in the test.
//
//   g++ -std=c++17 -Wall -Wextra -I ../../components/jk_write_tx \
//       test_jk_write_tx_preflight_geometry.cpp -o test_jk_write_tx_preflight_geometry
//   ./test_jk_write_tx_preflight_geometry

#include "jk_write_tx_core.h"

#include <cstdio>
#include <cstring>

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

void check_str_eq(const char *actual, const char *expected, const char *desc) {
  g_checks++;
  if (std::strcmp(actual, expected) != 0) {
    g_failures++;
    std::printf("FAIL: %s (expected \"%s\", got \"%s\")\n", desc, expected, actual);
  }
}
}  // namespace

int main() {
  // ---------------------------------------------------------------------
  // container_mask_for_word_count
  // ---------------------------------------------------------------------
  {
    const auto r1 = container_mask_for_word_count(1);
    check(r1.status == ContainerWidthStatus::OK, "word_count=1 is a supported container width");
    check_eq<uint32_t>(r1.container_mask, 0x0000FFFFu, "word_count=1 container_mask is 0x0000FFFF");

    const auto r2 = container_mask_for_word_count(2);
    check(r2.status == ContainerWidthStatus::OK, "word_count=2 is a supported container width");
    check_eq<uint32_t>(r2.container_mask, 0xFFFFFFFFu, "word_count=2 container_mask is 0xFFFFFFFF");

    for (uint8_t wc : {uint8_t(0), uint8_t(3), uint8_t(4), uint8_t(255)}) {
      const auto r = container_mask_for_word_count(wc);
      check(r.status == ContainerWidthStatus::UNSUPPORTED_WORD_COUNT,
            "an unsupported word_count fails closed instead of silently defaulting to 32 bits");
    }
  }

  // ---------------------------------------------------------------------
  // The real, live gps_heartbeat case (2026-09-21 hardware acceptance):
  // old_raw=0x3210 (12816), mask=0x0004, shift=2, requested target=1.
  // ---------------------------------------------------------------------
  {
    const uint32_t container_mask = container_mask_for_word_count(1).container_mask;
    const auto geom = validate_field_geometry(0x0004, 2, container_mask);
    check(geom.status == FieldGeometryStatus::OK, "gps_heartbeat's real mask/shift validate OK against a 16-bit container");
    check_eq<uint32_t>(geom.field_mask, 0x0004u, "gps_heartbeat field_mask is unchanged (never silently narrowed)");
    check_eq<uint32_t>(geom.preservation_mask, 0xFFFBu,
                        "gps_heartbeat preservation_mask is the 16-bit-bounded 0xFFFB, NOT the unbounded 0xFFFFFFFB");

    const uint32_t old_raw = 12816;  // 0x3210
    const EncodeResult enc = encode_numeric_field(1.0, false, 1.0, 0.0, 0.0, 1.0, 1);
    check(enc.status == EncodeStatus::OK, "encoding target value 1 for a 1-bit field succeeds");
    const uint32_t merged_raw = merge_field_into_raw(old_raw, geom.field_mask, 2, enc.encoded_raw) & container_mask;
    check_eq<uint32_t>(merged_raw, 12820u, "merged_raw for gps_heartbeat=1 is 12820 (0x3214), matching the real device's own response");

    const uint32_t sibling_before = old_raw & geom.preservation_mask;
    const uint32_t sibling_after = merged_raw & geom.preservation_mask;
    check_eq<uint32_t>(sibling_before, 12816u, "sibling_bits_before == old_raw with the target bit masked off (12816, since bit2 was already 0)");
    check_eq<uint32_t>(sibling_after, 12816u,
                        "sibling_bits_expected_after, computed FROM merged_raw (never copied from sibling_before), still equals 12816 here -- proves the formula, not just the coincidence");
    check(sibling_before == sibling_after, "for gps_heartbeat specifically, before==after is a real arithmetic consequence, not a hardcoded assumption");

    char buf[12];
    format_hex_fixed_width(buf, sizeof(buf), 0x0004, hex_digits_for_word_count(1));
    check_str_eq(buf, "0x0004", "mask formats as exactly 4 hex digits for word_count=1");
    format_hex_fixed_width(buf, sizeof(buf), (enc.encoded_raw << 2) & geom.field_mask, hex_digits_for_word_count(1));
    check_str_eq(buf, "0x0004", "encoded_target_bits formats as exactly 4 hex digits for word_count=1");
    format_hex_fixed_width(buf, sizeof(buf), geom.preservation_mask, hex_digits_for_word_count(1));
    check_str_eq(buf, "0xFFFB", "preservation_mask formats as exactly 4 hex digits (0xFFFB), NEVER 0xFFFFFFFB, for a 16-bit register");
  }

  // ---------------------------------------------------------------------
  // 16-bit clear operation: old=0x3214 (bit already set), target=0 -> merged=0x3210.
  // ---------------------------------------------------------------------
  {
    const uint32_t container_mask = container_mask_for_word_count(1).container_mask;
    const auto geom = validate_field_geometry(0x0004, 2, container_mask);
    const uint32_t old_raw = 0x3214;
    const EncodeResult enc = encode_numeric_field(0.0, false, 1.0, 0.0, 0.0, 1.0, 1);
    check(enc.status == EncodeStatus::OK, "encoding target value 0 for a 1-bit field succeeds");
    const uint32_t merged_raw = merge_field_into_raw(old_raw, geom.field_mask, 2, enc.encoded_raw) & container_mask;
    check_eq<uint32_t>(merged_raw, 0x3210u, "clearing gps_heartbeat from an already-set 0x3214 produces 0x3210");
    check_eq<uint32_t>(old_raw & geom.preservation_mask, merged_raw & geom.preservation_mask,
                        "sibling bits are identical before/after a clear operation too (bit2 is the only bit that changed)");
  }

  // ---------------------------------------------------------------------
  // A 32-bit (word_count=2) entry: full 8-digit strings, never truncated.
  // ---------------------------------------------------------------------
  {
    const auto width = container_mask_for_word_count(2);
    check(width.status == ContainerWidthStatus::OK, "word_count=2 is supported");
    // A full-width (non-packed) 32-bit field: mask covers the whole register.
    const auto geom = validate_field_geometry(0xFFFFFFFFu, 0, width.container_mask);
    check(geom.status == FieldGeometryStatus::OK, "a full-width 32-bit mask validates OK against a 32-bit container");
    check_eq<uint32_t>(geom.preservation_mask, 0x00000000u, "a full-width 32-bit field has no sibling bits at all (preservation_mask is 0)");

    char buf[12];
    format_hex_fixed_width(buf, sizeof(buf), 0xFFFFFFFFu, hex_digits_for_word_count(2));
    check_str_eq(buf, "0xFFFFFFFF", "a 32-bit mask formats as the FULL, untruncated 8-digit string");

    // A packed 32-bit-container field (hypothetical: e.g. a 4-bit field at
    // shift 8 inside a real 32-bit register) still reports the full
    // 8-digit preservation_mask, not a truncated one.
    const auto geom2 = validate_field_geometry(0x00000F00u, 8, width.container_mask);
    check(geom2.status == FieldGeometryStatus::OK, "a packed 32-bit field's mask/shift validate OK");
    check_eq<uint32_t>(geom2.preservation_mask, 0xFFFFF0FFu, "a packed 32-bit field's preservation_mask covers every OTHER real bit of the full 32-bit register");
    format_hex_fixed_width(buf, sizeof(buf), geom2.preservation_mask, hex_digits_for_word_count(2));
    check_str_eq(buf, "0xFFFFF0FF", "the packed 32-bit field's preservation_mask formats as a full, untruncated 8-digit string");
  }

  // ---------------------------------------------------------------------
  // Fail-closed geometry rejections.
  // ---------------------------------------------------------------------
  {
    const uint32_t container16 = container_mask_for_word_count(1).container_mask;
    const auto zero = validate_field_geometry(0x0000, 0, container16);
    check(zero.status == FieldGeometryStatus::ZERO_MASK, "mask=0 fails closed as ZERO_MASK");

    const auto outside = validate_field_geometry(0x00010000u, 16, container16);
    check(outside.status == FieldGeometryStatus::MASK_EXCEEDS_CONTAINER,
          "a mask bit outside a 16-bit container's own width (word_count=1) fails closed as MASK_EXCEEDS_CONTAINER");

    const auto mismatched_shift = validate_field_geometry(0x0004, 5, container16);
    check(mismatched_shift.status == FieldGeometryStatus::SHIFT_MASK_MISMATCH,
          "a shift that does not land on a set bit of mask fails closed as SHIFT_MASK_MISMATCH");
  }

  // ---------------------------------------------------------------------
  // No truncated hex strings like "0xFFFFF" (the exact live-device bug)
  // can be produced by the new helper for any value up to a 32-bit
  // container's full width.
  // ---------------------------------------------------------------------
  {
    char buf[12];
    format_hex_fixed_width(buf, sizeof(buf), 0xFFFFFFFBu, 8);
    check(std::strlen(buf) == 10, "a full 32-bit value formats to exactly 10 characters (\"0x\" + 8 digits), never fewer");
    check_str_eq(buf, "0xFFFFFFFB", "a full 32-bit value never silently truncates");
  }

  std::printf("\n%d checks, %d failures\n", g_checks, g_failures);
  return g_failures == 0 ? 0 : 1;
}
