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

  test_decode_bool_bit_set();
  test_decode_bool_bit_clear();
  test_decode_bool_ignores_other_bits();

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
