// Host-side unit tests for jk_write_tx_core.h -- no ESP32, no ESPHome, no
// ESP-IDF, no real Modbus needed. Build and run with a plain desktop
// compiler:
//
//   g++ -std=c++17 -Wall -Wextra -I ../../components/jk_write_tx \
//       test_jk_write_tx_core.cpp -o test_jk_write_tx_core
//   ./test_jk_write_tx_core
//
// Exits non-zero (and prints which check failed) on any failure, so it's
// usable as a CI gate, not just a manual smoke test.

#include "jk_write_tx_core.h"

#include <cstdio>

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
// compare_masked
// ---------------------------------------------------------------------
static void test_compare_masked() {
  check(compare_masked(0x1234, 0x1234, 0xFFFFFFFFu), "exact match, full mask");
  check(!compare_masked(0x1234, 0x1235, 0xFFFFFFFFu), "one-bit difference, full mask, fails");
  // Packed register: only the high byte is the field we wrote; the low
  // byte legitimately differs (someone else's sub-field) and must NOT
  // fail the comparison.
  check(compare_masked(0xAB00, 0xABFF, 0xFF00u), "packed high-byte field, low byte ignored");
  check(!compare_masked(0xAB00, 0xCD00, 0xFF00u), "packed high-byte field, high byte differs -> fails");
}

// ---------------------------------------------------------------------
// begin() -- slot allocation, single-flight-per-address, capacity
// ---------------------------------------------------------------------
static void test_begin_allocates_and_assigns_monotonic_ids() {
  std::array<Slot, 4> slots{};
  uint32_t next_id = 0;
  int idx1 = begin(slots, next_id, 0x100C, 2, 0x1234, 0xFFFFFFFFu, 1000);
  check(idx1 >= 0, "first begin() succeeds");
  check_eq<uint32_t>(slots[idx1].tx_id, 1u, "first tx_id is 1");
  check_eq<uint8_t>(slots[idx1].status, SENDING, "new slot starts SENDING");

  int idx2 = begin(slots, next_id, 0x1010, 2, 0x5678, 0xFFFFFFFFu, 1001);
  check(idx2 >= 0 && idx2 != idx1, "second begin() to a DIFFERENT address gets its own slot");
  check_eq<uint32_t>(slots[idx2].tx_id, 2u, "tx_id is monotonic across slots");
}

static void test_begin_rejects_same_address_in_flight() {
  std::array<Slot, 4> slots{};
  uint32_t next_id = 0;
  int idx1 = begin(slots, next_id, 0x100C, 2, 1, 0xFFFFFFFFu, 1000);
  check(idx1 >= 0, "first write to 0x100C accepted");
  int idx2 = begin(slots, next_id, 0x100C, 2, 2, 0xFFFFFFFFu, 1050);
  check_eq(idx2, -1, "second write to the SAME address while in flight is rejected (single-flight)");
  check_eq<uint32_t>(slots[idx1].requested_raw, 1u, "the original in-flight transaction is untouched by the rejected one");
}

static void test_begin_rejects_when_no_free_slot() {
  std::array<Slot, 2> slots{};
  uint32_t next_id = 0;
  check(begin(slots, next_id, 0x1000, 2, 1, 0xFFFFFFFFu, 0) >= 0, "slot 1/2 accepted");
  check(begin(slots, next_id, 0x1004, 2, 1, 0xFFFFFFFFu, 0) >= 0, "slot 2/2 accepted");
  check_eq(begin(slots, next_id, 0x1008, 2, 1, 0xFFFFFFFFu, 0), -1,
           "a THIRD concurrent-different-register write is rejected once every slot is busy, never silently dropped or queued unbounded");
}

// ---------------------------------------------------------------------
// tick() -- the full happy path: SENDING -> ACK_WAIT -> READBACK_WAIT -> CONFIRMED
// ---------------------------------------------------------------------
static void test_tick_confirm_happy_path() {
  std::array<Slot, 4> slots{};
  uint32_t next_id = 0;
  int idx = begin(slots, next_id, 0x100C, 2, 0xABCD, 0xFFFFFFFFu, 1000);
  Slot &s = slots[idx];

  TickResult r0 = tick(s, 1000);
  check_eq<uint8_t>(s.status, ACK_WAIT, "tick() advances SENDING -> ACK_WAIT immediately");
  check(!r0.issue_readback && !r0.terminal, "no readback/terminal yet, still waiting on ACK");

  TickResult r1 = tick(s, 1100); // still not acked
  check_eq<uint8_t>(s.status, ACK_WAIT, "stays ACK_WAIT while unacked and under timeout");
  check(!r1.terminal, "not terminal while ACK is merely pending");

  s.acked = true;
  TickResult r2 = tick(s, 1150);
  check_eq<uint8_t>(s.status, READBACK_WAIT, "ACK landing advances ACK_WAIT -> READBACK_WAIT");
  check(r2.issue_readback, "tick() tells the caller to issue the forced readback exactly once ACK lands");

  TickResult r3 = tick(s, 1200); // readback not landed yet
  check_eq<uint8_t>(s.status, READBACK_WAIT, "stays READBACK_WAIT while the forced re-read is still in flight");
  check(!r3.issue_readback, "does not re-issue the readback command every tick while waiting");
  check(!r3.terminal, "not terminal while readback is merely pending");

  s.readback_done = true;
  s.readback_raw = 0xABCD; // matches requested_raw exactly
  TickResult r4 = tick(s, 1300);
  check_eq<uint8_t>(s.status, CONFIRMED, "matching readback -> CONFIRMED");
  check(r4.terminal, "CONFIRMED is reported as a terminal result exactly once");
}

static void test_tick_mismatch() {
  std::array<Slot, 4> slots{};
  uint32_t next_id = 0;
  int idx = begin(slots, next_id, 0x1010, 2, 1000, 0xFFFFFFFFu, 0);
  Slot &s = slots[idx];
  tick(s, 0);
  s.acked = true;
  tick(s, 10);
  s.readback_done = true;
  s.readback_raw = 999; // BMS silently clamped/rejected the value -- readback disagrees
  TickResult r = tick(s, 20);
  check_eq<uint8_t>(s.status, MISMATCH, "a readback that does NOT match the requested value is MISMATCH, never CONFIRMED");
  check(r.terminal, "MISMATCH is terminal");
}

static void test_tick_ack_timeout_never_silently_confirms() {
  std::array<Slot, 4> slots{};
  uint32_t next_id = 0;
  int idx = begin(slots, next_id, 0x1014, 2, 1, 0xFFFFFFFFu, 0);
  Slot &s = slots[idx];
  tick(s, 0); // SENDING -> ACK_WAIT
  TickResult r = tick(s, DEFAULT_ACK_TIMEOUT_MS + 1); // never acked
  check_eq<uint8_t>(s.status, ACK_TIMEOUT, "an ACK that never lands within the timeout is ACK_TIMEOUT, not a fallback success");
  check(r.terminal, "ACK_TIMEOUT is terminal");
  check(s.status != CONFIRMED, "ACK_TIMEOUT must never be reported as CONFIRMED");
}

static void test_tick_readback_timeout_never_silently_confirms() {
  std::array<Slot, 4> slots{};
  uint32_t next_id = 0;
  int idx = begin(slots, next_id, 0x1018, 2, 1, 0xFFFFFFFFu, 0);
  Slot &s = slots[idx];
  tick(s, 0);
  s.acked = true;
  tick(s, 10); // ACK_WAIT -> READBACK_WAIT, readback issued
  TickResult r = tick(s, 10 + DEFAULT_READBACK_TIMEOUT_MS + 1); // readback never lands
  check_eq<uint8_t>(s.status, READBACK_TIMEOUT, "a readback that never completes within the timeout is READBACK_TIMEOUT");
  check(r.terminal, "READBACK_TIMEOUT is terminal");
  check(s.status != CONFIRMED, "READBACK_TIMEOUT must never be reported as CONFIRMED");
}

static void test_tick_packed_field_mask_ignores_sibling_field() {
  // e.g. lcd_buzzer_trigger_source (high byte) and
  // dry_contact_1_trigger_source (low byte) share the physical word at
  // 0x14E4. Writing the high byte, the readback's low byte may differ
  // (a concurrent, unrelated change, or simply whatever the OTHER field
  // already held) without that being a MISMATCH for THIS transaction.
  std::array<Slot, 4> slots{};
  uint32_t next_id = 0;
  const uint32_t requested_high_byte_AB = 0xAB00; // wrote 0xAB into the high byte, low byte don't-care
  int idx = begin(slots, next_id, 0x14E4, 2, requested_high_byte_AB, 0xFF00u, 0);
  Slot &s = slots[idx];
  tick(s, 0);
  s.acked = true;
  tick(s, 10);
  s.readback_done = true;
  s.readback_raw = 0xAB42; // high byte matches, low byte is whatever the sibling field holds
  TickResult r = tick(s, 20);
  check_eq<uint8_t>(s.status, CONFIRMED, "masked comparison confirms even though the untouched sibling byte differs");
  check(r.terminal, "terminal");
}

static void test_suppress_value_flag_is_tracked_not_ignored() {
  // The setup passcode must never surface requested/readback raw bytes in
  // any published snapshot -- begin() must still faithfully record the
  // flag so the caller (the YAML lambda building the JSON snapshot) can
  // honor it; this test guards against silently dropping the flag.
  std::array<Slot, 4> slots{};
  uint32_t next_id = 0;
  int idx = begin(slots, next_id, 0x1470, 2, 0x4142, 0xFFFFFFFFu, 0, /*suppress_value=*/true);
  check(slots[idx].suppress_value, "suppress_value flag is preserved on the slot begin() created");
}

static void test_begin_reuses_a_freed_slot() {
  std::array<Slot, 2> slots{};
  uint32_t next_id = 0;
  int idx1 = begin(slots, next_id, 0x1000, 2, 1, 0xFFFFFFFFu, 0);
  check(idx1 >= 0, "first write accepted");
  slots[idx1].in_use = false; // caller frees the slot after consuming its terminal result
  int idx2 = begin(slots, next_id, 0x2000, 2, 1, 0xFFFFFFFFu, 100);
  check_eq(idx2, idx1, "a freed slot is reused for a later, unrelated write");
  check_eq<uint32_t>(slots[idx2].tx_id, 2u, "tx_id still keeps incrementing monotonically after slot reuse");
}

// Regression test: a real bug found via the mock-server end-to-end test
// suite (test/topology/run.js) -- two back-to-back writes to the SAME
// register, the second arriving only moments after the first's terminal
// result (well within the ~3s grace period the caller keeps a terminal
// slot `in_use` for snapshot visibility), were incorrectly rejected by
// begin()'s original address-match check, which didn't distinguish a
// PENDING in-flight transaction from an already-finished one that simply
// hadn't been freed yet.
static void test_begin_immediately_reuses_own_terminal_slot_same_address() {
  std::array<Slot, 4> slots{};
  uint32_t next_id = 0;
  int idx1 = begin(slots, next_id, 0x1004, 2, 100, 0xFFFFFFFFu, 0);
  check(idx1 >= 0, "first write to 0x1004 accepted");
  Slot &s = slots[idx1];
  tick(s, 0);
  s.acked = true;
  tick(s, 10);
  s.readback_done = true;
  s.readback_raw = 100;
  tick(s, 20); // -> CONFIRMED; slot.in_use is still true (only the CALLER frees it, after its own grace period)
  check_eq<uint8_t>(slots[idx1].status, CONFIRMED, "first transaction reached CONFIRMED");
  check(slots[idx1].in_use, "slot is still in_use immediately after CONFIRMED (not yet freed by the caller)");

  int idx2 = begin(slots, next_id, 0x1004, 2, 200, 0xFFFFFFFFu, 30);
  check(idx2 >= 0, "a second write to the SAME address, arriving right after the first's CONFIRMED, is accepted -- not rejected as \"still busy\"");
  check_eq<uint32_t>(slots[idx2].requested_raw, 200u, "the second transaction's own requested value is tracked correctly");
  check_eq<uint8_t>(slots[idx2].status, SENDING, "the reused slot starts a genuinely fresh transaction (SENDING), not a leftover CONFIRMED");
}

// ---------------------------------------------------------------------
// generation -- third critical audit (2026-09-10, item 6): a late ACK or
// readback callback for a transaction a slot has since moved past must
// never mutate the NEW transaction's state. The caller (batterylifepo4.
// yaml) achieves this by capturing {idx, tx_id, address, generation} at
// command-issue time and verifying all four before writing anything back
// — these tests guard the one invariant that safety net depends on:
// begin() must bump generation EVERY time a slot index is reused, and
// never reset it back to 0.
// ---------------------------------------------------------------------
static void test_begin_bumps_generation_on_first_use() {
  std::array<Slot, 4> slots{};
  uint32_t next_id = 0;
  int idx = begin(slots, next_id, 0x100C, 2, 1, 0xFFFFFFFFu, 0);
  check_eq<uint32_t>(slots[idx].generation, 1u, "a slot's very first use is generation 1, not 0 (0 is reserved as \"never used\")");
}

static void test_begin_bumps_generation_on_each_reuse() {
  std::array<Slot, 1> slots{}; // force reuse of the SAME index every time
  uint32_t next_id = 0;
  int idx1 = begin(slots, next_id, 0x1000, 2, 1, 0xFFFFFFFFu, 0);
  check_eq<uint32_t>(slots[idx1].generation, 1u, "first use: generation 1");
  slots[idx1].in_use = false; // caller frees after consuming the terminal result
  int idx2 = begin(slots, next_id, 0x1004, 2, 1, 0xFFFFFFFFu, 100);
  check_eq(idx2, idx1, "only one slot exists -- must be reused");
  check_eq<uint32_t>(slots[idx2].generation, 2u, "reuse bumps generation to 2, not reset to 0 or 1 again");
  slots[idx2].in_use = false;
  int idx3 = begin(slots, next_id, 0x1008, 2, 1, 0xFFFFFFFFu, 200);
  check_eq<uint32_t>(slots[idx3].generation, 3u, "a THIRD use of the same index keeps incrementing (never wraps back)");
}

static void test_begin_bumps_generation_on_same_address_supersede() {
  // The "immediately reuse own terminal slot, same address" path (see
  // test_begin_immediately_reuses_own_terminal_slot_same_address above)
  // goes through a DIFFERENT code path inside begin() (the first loop's
  // own `slots[i].in_use = false` before falling through) -- must ALSO
  // bump generation, or a late callback from the superseded transaction
  // could still be mistaken for belonging to the new one.
  std::array<Slot, 4> slots{};
  uint32_t next_id = 0;
  int idx1 = begin(slots, next_id, 0x1004, 2, 100, 0xFFFFFFFFu, 0);
  const uint32_t gen1 = slots[idx1].generation;
  Slot &s = slots[idx1];
  tick(s, 0);
  s.acked = true;
  tick(s, 10);
  s.readback_done = true;
  s.readback_raw = 100;
  tick(s, 20); // -> CONFIRMED, still in_use
  int idx2 = begin(slots, next_id, 0x1004, 2, 200, 0xFFFFFFFFu, 30);
  check_eq(idx2, idx1, "same-address supersede reuses the SAME slot index");
  check(slots[idx2].generation != gen1, "supersede via the same-address fast path still bumps generation");
  check_eq<uint32_t>(slots[idx2].generation, gen1 + 1, "generation increments by exactly 1 on supersede");
}

// ---------------------------------------------------------------------
// WRITE_UNCERTAIN / recovery -- third critical audit (2026-09-10, item 7).
// tick() itself never emits WRITE_UNCERTAIN/RECOVERED_CONFIRMED/
// RECOVERED_MISMATCH (the caller, batterylifepo4.yaml, reclassifies a
// slot into these after ACK_TIMEOUT/READBACK_TIMEOUT); these tests guard
// the one invariant begin()'s single-flight guard depends on for that
// scheme to actually block re-writes during recovery.
// ---------------------------------------------------------------------
static void test_is_pending_includes_write_uncertain() {
  check(is_pending(WRITE_UNCERTAIN), "WRITE_UNCERTAIN is pending -- blocks a new write to the same address");
  check(!is_pending(RECOVERED_CONFIRMED), "RECOVERED_CONFIRMED is terminal, not pending -- address is writable again");
  check(!is_pending(RECOVERED_MISMATCH), "RECOVERED_MISMATCH is terminal, not pending -- address is writable again");
  check(!is_pending(ACK_TIMEOUT), "plain ACK_TIMEOUT itself is not pending (the caller reclassifies it to WRITE_UNCERTAIN before begin() ever sees it again)");
}

static void test_begin_rejects_write_to_address_with_uncertain_status() {
  std::array<Slot, 4> slots{};
  uint32_t next_id = 0;
  int idx1 = begin(slots, next_id, 0x1008, 2, 1, 0xFFFFFFFFu, 0);
  check(idx1 >= 0, "first write to 0x1008 accepted");
  // Simulate the caller reclassifying an ACK/readback timeout into
  // WRITE_UNCERTAIN while a recovery probe is in flight.
  slots[idx1].status = WRITE_UNCERTAIN;
  int idx2 = begin(slots, next_id, 0x1008, 2, 2, 0xFFFFFFFFu, 5000);
  check_eq(idx2, -1, "a new write to an address whose recovery is still pending (WRITE_UNCERTAIN) is rejected, not allowed to race the recovery probe");
}

static void test_begin_allows_write_to_address_after_recovered_confirmed() {
  std::array<Slot, 4> slots{};
  uint32_t next_id = 0;
  int idx1 = begin(slots, next_id, 0x100C, 2, 1, 0xFFFFFFFFu, 0);
  slots[idx1].status = RECOVERED_CONFIRMED;
  int idx2 = begin(slots, next_id, 0x100C, 2, 2, 0xFFFFFFFFu, 5000);
  check(idx2 >= 0, "once recovery resolves to RECOVERED_CONFIRMED, the address is writable again -- not stuck blocked forever");
  check_eq<uint8_t>(slots[idx2].status, SENDING, "the reused slot starts a genuinely fresh transaction");
}

static void test_begin_allows_write_to_address_after_recovered_mismatch() {
  std::array<Slot, 4> slots{};
  uint32_t next_id = 0;
  int idx1 = begin(slots, next_id, 0x1010, 2, 1, 0xFFFFFFFFu, 0);
  slots[idx1].status = RECOVERED_MISMATCH;
  int idx2 = begin(slots, next_id, 0x1010, 2, 2, 0xFFFFFFFFu, 5000);
  check(idx2 >= 0, "once recovery resolves to RECOVERED_MISMATCH, the address is writable again");
}

int main() {
  test_compare_masked();
  test_begin_allocates_and_assigns_monotonic_ids();
  test_begin_rejects_same_address_in_flight();
  test_begin_rejects_when_no_free_slot();
  test_tick_confirm_happy_path();
  test_tick_mismatch();
  test_tick_ack_timeout_never_silently_confirms();
  test_tick_readback_timeout_never_silently_confirms();
  test_tick_packed_field_mask_ignores_sibling_field();
  test_suppress_value_flag_is_tracked_not_ignored();
  test_begin_reuses_a_freed_slot();
  test_begin_immediately_reuses_own_terminal_slot_same_address();
  test_begin_bumps_generation_on_first_use();
  test_begin_bumps_generation_on_each_reuse();
  test_begin_bumps_generation_on_same_address_supersede();
  test_is_pending_includes_write_uncertain();
  test_begin_rejects_write_to_address_with_uncertain_status();
  test_begin_allows_write_to_address_after_recovered_confirmed();
  test_begin_allows_write_to_address_after_recovered_mismatch();

  std::printf("\n%d checks run, %d failed.\n", g_checks, g_failures);
  return g_failures == 0 ? 0 : 1;
}
