// Host-side unit tests for jk_topology_core.h -- no ESP32, no ESPHome, no
// ESP-IDF, no real hardware needed. Build and run with a plain desktop
// compiler:
//
//   g++ -std=c++17 -Wall -Wextra -I ../../components/jk_topology \
//       test_jk_topology_core.cpp -o test_jk_topology_core
//   ./test_jk_topology_core
//
// Exits non-zero (and prints which check failed) on any failure, so it's
// usable as a CI gate, not just a manual smoke test. Mirrors
// test/jk_poll_scheduler/test_jk_poll_scheduler_core.cpp's own structure.
//
// User-directed rework (2026-09-17): resolve_topology's decision logic
// was extracted from an inline YAML lambda into this pure,
// hardware-independent header specifically so requests like this one --
// real behavioral coverage across 4S/8S/16S/24S/32S and the transitions
// between them -- can be answered by actually EXECUTING the decision
// logic against concrete inputs, not by grepping YAML source text for
// structural patterns (which can prove a comment exists, never that a
// scenario resolves correctly). Every test below calls the SAME resolve()
// function the real firmware wrapper (batterylifepo4.yaml) calls -- no
// reimplementation of the algorithm anywhere in this file.
//
// These are software/fixture tests. None of them constitute hardware
// verification of 24S/32S support on any real deployed unit -- see this
// project's own README/commit history for the explicit distinction
// between protocol capacity (fixture-tested here, up to 32 channels) and
// any specific deployed battery's own confirmed capability (the deployed
// 16S unit is ONE hardware test case among this range, not a special
// mode -- 4S/8S/16S/24S/32S below are all the exact same resolve() code
// path, differing only in the numbers passed in).

#include "jk_topology_core.h"

#include <cmath>
#include <cstdio>
#include <cstring>

using namespace jk_topology;

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
  if (std::isnan(actual) || std::fabs(actual - expected) > tol) {
    g_failures++;
    std::printf("FAIL: %s (expected=%f actual=%f)\n", desc, expected, actual);
  }
}

// Builds a fully plausible, mask-exact, voltage-sum-matching Inputs for a
// pack of exactly `n` cells at `cell_v` volts each -- the "everything is
// healthy" fixture every CONFIRMED-path test starts from. Channels
// n..32 are left at NAN (as a real, never-yet-blanked BMS response would
// never claim a voltage for a channel outside its own configured range --
// resolve() itself doesn't require this, it only reads voltage[i] for
// i<configured when accumulating active_sum, but keeping the rest NAN
// keeps every fixture explicit about what is and isn't "real" input,
// mirroring what the actual 1Hz cell-block decode would produce for an
// honest N-cell BMS).
Inputs healthy_pack(uint8_t n, float cell_v = 3.300f) {
  Inputs in;
  in.topology_uncertain = false;
  in.have_cell_data = true;
  in.comm_elapsed_ms = 500;
  in.configured_f = float(n);
  in.mask_valid = true;
  in.mask_raw = (n >= 32) ? 0xFFFFFFFFu : ((uint32_t(1) << n) - 1U);
  for (uint8_t i = 0; i < PROTOCOL_CHANNEL_CAPACITY; i++) {
    in.voltage[i] = (i < n) ? cell_v : NAN;
  }
  in.pack_voltage = cell_v * float(n);
  return in;
}

const char *state_name(uint8_t code) { return STATE_NAMES[code]; }
const char *reason_name(uint8_t code) { return REASON_NAMES[code]; }
}  // namespace

// ===========================================================================
// 1. CONFIRMED for 4S, 8S, 16S, 24S, 32S -- one general mechanism, not
// separate hardcoded modes: every case below calls the exact same
// resolve() with only the numbers changed.
// ===========================================================================
static void test_confirmed_various_topologies() {
  for (uint8_t n : {4, 8, 16, 24, 32}) {
    char desc[128];
    const Inputs in = healthy_pack(n);
    const Outputs out = resolve(in);
    std::snprintf(desc, sizeof(desc), "%dS: state is CONFIRMED (got %s/%s)", n, state_name(out.state_code), reason_name(out.reason_code));
    check(out.confirmed && out.state_code == STATE_CONFIRMED, desc);
    std::snprintf(desc, sizeof(desc), "%dS: effective_cell_count == %d", n, n);
    check_eq<uint8_t>(out.effective_cell_count, n, desc);
    std::snprintf(desc, sizeof(desc), "%dS: configured == %d", n, n);
    check_eq<uint8_t>(out.configured, n, desc);
    std::snprintf(desc, sizeof(desc), "%dS: connected_count == %d", n, n);
    check_near(out.connected_count, float(n), 1e-6f, desc);
    std::snprintf(desc, sizeof(desc), "%dS: blank_voltage_from == %d (channels n..32 blanked, 1..n kept)", n, n);
    check_eq<uint8_t>(out.blank_voltage_from, n, desc);
    const uint8_t expected_resistance_blank = n < RESISTANCE_CHANNEL_COUNT ? n : RESISTANCE_CHANNEL_COUNT;
    std::snprintf(desc, sizeof(desc), "%dS: blank_resistance_from == %d", n, expected_resistance_blank);
    check_eq<uint8_t>(out.blank_resistance_from, expected_resistance_blank, desc);
    std::snprintf(desc, sizeof(desc), "%dS CONFIRMED: display_cell_count == %d (the UI-facing structural count)", n, n);
    check_eq<uint8_t>(out.display_cell_count, n, desc);
  }
}

// ===========================================================================
// 1b. User-directed rework (THIRD pass, 2026-09-17): configured N and
// confirmed/trustworthy status are DIFFERENT concepts -- display_cell_count
// must equal the validly-read configured N in EVERY state (CONFIRMED,
// MISMATCH, OFFLINE with a cached last-read N), NEVER falling back to
// PROTOCOL_CHANNEL_CAPACITY (32) just because state isn't CONFIRMED. This
// is the exact defect this pass closes: effective_cell_count (a different,
// pre-existing field with its own write-confirmation consumer) DOES still
// fall back to 32 outside CONFIRMED -- display_cell_count must not.
// ===========================================================================
static void test_display_cell_count_independent_of_confirmation_8s_16s() {
  for (uint8_t n : {8, 16}) {
    char desc[256];

    // CONFIRMED: healthy fixture, as already covered above, re-asserted
    // here for direct side-by-side contrast with the MISMATCH/OFFLINE
    // cases immediately below.
    {
      const Outputs out = resolve(healthy_pack(n));
      std::snprintf(desc, sizeof(desc), "%dS CONFIRMED: display_cell_count == %d, effective_cell_count == %d (both agree when confirmed)", n, n, n);
      check(out.display_cell_count == n && out.effective_cell_count == n, desc);
    }

    // MISMATCH (pack voltage sum wildly off, but CellCount itself was
    // validly read as n): display_cell_count must STILL be n -- channels
    // n+1..32 must not appear as active elements, and channels 1..n must
    // not collapse to nothing either.
    {
      Inputs in = healthy_pack(n);
      in.pack_voltage = float(n) * 3.30f - 5.0f;  // forces VOLTAGE_SUM_DIFFERS
      const Outputs out = resolve(in);
      std::snprintf(desc, sizeof(desc), "%dS MISMATCH: state is MISMATCH (not CONFIRMED) -- sanity check for this fixture", n);
      check(out.state_code == STATE_MISMATCH, desc);
      std::snprintf(desc, sizeof(desc), "%dS MISMATCH: display_cell_count == %d, NOT 32 -- configured N still drives channel count even though data isn't confirmed", n, n);
      check_eq<uint8_t>(out.display_cell_count, n, desc);
      std::snprintf(desc, sizeof(desc), "%dS MISMATCH: effective_cell_count still falls back to 32 (its own, unrelated write-confirmation semantics) -- proves display_cell_count and effective_cell_count are genuinely decoupled", n);
      check_eq<uint8_t>(out.effective_cell_count, PROTOCOL_CHANNEL_CAPACITY, desc);
      std::snprintf(desc, sizeof(desc), "%dS MISMATCH: channels n+1..32 are still blanked (blank_voltage_from == %d) -- never appear as active elements", n, n);
      check_eq<uint8_t>(out.blank_voltage_from, n, desc);
    }

    // OFFLINE with a cached last-valid configured_f (comms went stale,
    // but the CellCount sensor itself still holds its last successfully-
    // read value, exactly as a real ESPHome sensor would -- see
    // Inputs::configured_f's own comment): display_cell_count must STILL
    // reflect the last known N, with an explicit offline/stale STATUS
    // (state_code == STATE_OFFLINE) carrying the "don't trust the values"
    // signal separately.
    {
      Inputs in = healthy_pack(n);
      in.comm_elapsed_ms = 45000;  // stale communication
      const Outputs out = resolve(in);
      std::snprintf(desc, sizeof(desc), "%dS OFFLINE: state is OFFLINE -- sanity check for this fixture", n);
      check(out.state_code == STATE_OFFLINE, desc);
      std::snprintf(desc, sizeof(desc), "%dS OFFLINE: display_cell_count == %d (last known valid N of the current connection), NOT 32 and NOT 0", n, n);
      check_eq<uint8_t>(out.display_cell_count, n, desc);
    }
  }
}

// ===========================================================================
// 1c. Invalid CellCount (out of 1..32) must NEVER become display_cell_count
// == 32 -- an explicit configuration-error signal instead (state INVALID,
// reason COUNT_OUT_OF_RANGE), distinguishable from LOADING's "no snapshot
// yet" by state_code even though both share display_cell_count == 0.
// ===========================================================================
static void test_invalid_cellcount_shows_config_error_not_32() {
  for (float bad : {0.0f, 33.0f, 99.0f}) {
    Inputs in = healthy_pack(16);
    in.configured_f = bad;
    const Outputs out = resolve(in);
    char desc[160];
    std::snprintf(desc, sizeof(desc), "configured=%.0f: display_cell_count == 0 (explicit config error), never 32", bad);
    check_eq<uint8_t>(out.display_cell_count, 0, desc);
    std::snprintf(desc, sizeof(desc), "configured=%.0f: state is INVALID/COUNT_OUT_OF_RANGE, distinguishable from LOADING", bad);
    check(out.state_code == STATE_INVALID && out.reason_code == REASON_COUNT_OUT_OF_RANGE, desc);
  }
}

// ===========================================================================
// 1d. New connection without N yet: no valid snapshot at all (mirrors
// boot/reconnect before the first successful CellCount read) must show
// display_cell_count == 0, state LOADING -- never the previous device's
// configuration (there IS no previous configured_f to read: this Inputs
// fixture is the true "nothing known yet" default).
// ===========================================================================
static void test_new_connection_without_n_shows_zero_not_previous_config() {
  const Inputs in;  // all defaults: have_cell_data=false, configured_f=NAN
  const Outputs out = resolve(in);
  check_eq<uint8_t>(out.display_cell_count, 0, "new connection, no N read yet: display_cell_count == 0");
  check_eq<uint8_t>(out.state_code, uint8_t(STATE_LOADING), "new connection, no N read yet: state is LOADING");
}

// ===========================================================================
// 2. Hiding: for every topology size, channels 1..N must NOT be in the
// blanked range, and channels N+1..32 MUST be -- this is the exact
// invariant the frontend's own card-hide/show logic depends on
// (blank_voltage_from is what the UI treats as "N", via effective_cell_count).
// ===========================================================================
static void test_hiding_boundary_exact_per_topology() {
  for (uint8_t n : {1, 4, 8, 15, 16, 17, 24, 31, 32}) {
    const Inputs in = healthy_pack(n);
    const Outputs out = resolve(in);
    char desc[160];
    std::snprintf(desc, sizeof(desc), "%dS CONFIRMED: channel N (index N-1) is NOT blanked (still shown)", n);
    check(uint8_t(n - 1) < out.blank_voltage_from, desc);
    if (n < PROTOCOL_CHANNEL_CAPACITY) {
      std::snprintf(desc, sizeof(desc), "%dS CONFIRMED: channel N+1 (index N) IS blanked (hidden)", n);
      check(uint8_t(n) >= out.blank_voltage_from, desc);
    }
  }
}

// ===========================================================================
// 3. Transitions 16->8 and 8->24 -- sequential resolve() calls, each a
// fresh, independent call (exactly how the real firmware invokes it every
// 1Hz cycle) -- proving no stale value from the PREVIOUS topology leaks
// into the new one's blanking bounds or effective count.
// ===========================================================================
static void test_transition_16_to_8() {
  const Outputs before = resolve(healthy_pack(16));
  check(before.confirmed, "16->8 transition: initial 16S resolves CONFIRMED");
  check_eq<uint8_t>(before.effective_cell_count, 16, "16->8 transition: initial effective_cell_count == 16");
  check_eq<uint8_t>(before.display_cell_count, 16, "16->8 transition: initial display_cell_count == 16");
  check_eq<uint8_t>(before.blank_voltage_from, 16, "16->8 transition: initial blank_voltage_from == 16 (17-32 hidden, 1-16 shown)");

  const Outputs after = resolve(healthy_pack(8));
  check(after.confirmed, "16->8 transition: new 8S resolves CONFIRMED");
  check_eq<uint8_t>(after.effective_cell_count, 8, "16->8 transition: NEW effective_cell_count == 8, not stale 16");
  check_eq<uint8_t>(after.display_cell_count, 8, "16->8 transition: NEW display_cell_count == 8, not stale 16 -- channels 9-32 must not appear as active elements after this transition");
  check_eq<uint8_t>(after.blank_voltage_from, 8, "16->8 transition: NEW blank_voltage_from == 8 -- channels 9-16 now correctly hidden, not left showing as if still part of a 16S pack");
  check_eq<uint8_t>(after.blank_resistance_from, 8, "16->8 transition: resistance channels 9-16 also blanked (no longer active)");
}

static void test_transition_8_to_24() {
  const Outputs before = resolve(healthy_pack(8));
  check(before.confirmed, "8->24 transition: initial 8S resolves CONFIRMED");
  check_eq<uint8_t>(before.blank_voltage_from, 8, "8->24 transition: initial blank_voltage_from == 8");

  const Outputs after = resolve(healthy_pack(24));
  check(after.confirmed, "8->24 transition: new 24S resolves CONFIRMED");
  check_eq<uint8_t>(after.effective_cell_count, 24, "8->24 transition: NEW effective_cell_count == 24, not stale 8");
  check_eq<uint8_t>(after.blank_voltage_from, 24, "8->24 transition: NEW blank_voltage_from == 24 -- channels 9-24 now correctly shown (were hidden as an 8S pack a moment ago), 25-32 still hidden");
  // Resistance: only channels 1-16 ever have real sensors -- at 24S,
  // channels 9-16 (within the resistance sensor pool AND within the new
  // 24-cell active range) must NOT be blanked; 17-24 have no resistance
  // sensors to blank at all (RESISTANCE_CHANNEL_COUNT caps this at 16).
  check_eq<uint8_t>(after.blank_resistance_from, uint8_t(16), "8->24 transition: blank_resistance_from clamped to RESISTANCE_CHANNEL_COUNT (16) -- channels 9-16 no longer blanked now that they're within the 24-cell active range");
}

// ===========================================================================
// 4. No stale values after a topology change: connected_count/measured_count/
// active_sum must reflect ONLY the current call's inputs, never a previous
// call's -- resolve() is pure (no internal state carried between calls),
// so this is really a proof that the function has no hidden statics, but
// worth asserting explicitly since it's exactly the property the user
// asked to verify.
// ===========================================================================
static void test_no_stale_values_across_calls() {
  const Outputs a = resolve(healthy_pack(16, 3.30f));
  const Outputs b = resolve(healthy_pack(4, 3.30f));
  check_near(a.active_sum, 16.0f * 3.30f, 1e-3f, "no-stale: first call's active_sum matches its own 16S input");
  check_near(b.active_sum, 4.0f * 3.30f, 1e-3f, "no-stale: second call's active_sum matches its own 4S input, not carried over from the first");
  check_near(a.connected_count, 16.0f, 1e-6f, "no-stale: first call's connected_count is 16");
  check_near(b.connected_count, 4.0f, 1e-6f, "no-stale: second call's connected_count is 4, not stale 16");
  check_eq<uint8_t>(a.blank_voltage_from, 16, "no-stale: first call blanks from 16");
  check_eq<uint8_t>(b.blank_voltage_from, 4, "no-stale: second call blanks from 4, not stale 16");
}

// ===========================================================================
// 5. Sparse / non-contiguous masks -- a scattered bit pattern with the
// RIGHT popcount but WRONG positions must still MISMATCH (popcount alone
// is not sufficient), across multiple topology sizes.
// ===========================================================================
static void test_sparse_mask_wrong_positions_mismatches() {
  for (uint8_t n : {4, 16, 24}) {
    Inputs in = healthy_pack(n);
    // Scatter: clear bit 0, set a bit far outside the configured range
    // instead -- same popcount as the exact mask, wrong positions.
    in.mask_raw = (in.mask_raw & ~uint32_t(1)) | (uint32_t(1) << 30);
    const Outputs out = resolve(in);
    char desc[160];
    std::snprintf(desc, sizeof(desc), "%dS sparse mask (right popcount, wrong positions): resolves MISMATCH, not CONFIRMED", n);
    check(out.state_code == STATE_MISMATCH, desc);
    std::snprintf(desc, sizeof(desc), "%dS sparse mask: reason is MASK_NOT_CONTIGUOUS (connected_count still == configured)", n);
    check_eq<uint8_t>(out.reason_code, REASON_MASK_NOT_CONTIGUOUS, desc);
  }
}

// ===========================================================================
// 6. High-bit mask: bit31 set together with low bits, for a 32S pack --
// proves the mask comparison handles the full 32-bit range (the
// precision-fix batch's own concern, exercised here at the topology
// decision level, not just the raw decode level already covered by
// test_jk_poll_scheduler_core.cpp's decode_raw_u32 tests).
// ===========================================================================
static void test_high_bit_mask_32s_exact() {
  const Inputs in = healthy_pack(32);
  check_eq<uint32_t>(in.mask_raw, 0xFFFFFFFFu, "32S healthy fixture mask is the full 32-bit range (bit31 included)");
  const Outputs out = resolve(in);
  check(out.confirmed, "32S with bit31 set (full mask): resolves CONFIRMED");
  check_eq<uint8_t>(out.effective_cell_count, 32, "32S with bit31 set: effective_cell_count == 32");
}

static void test_high_bit_mask_missing_high_bit_mismatches() {
  // 32S configured, but bit31 (channel 32) never actually reports
  // connected -- a real "one channel short" scenario at the top of the
  // range, exactly where a naive low-16-bit-only mask check (the
  // pre-rework behavior) would have been unable to even represent this.
  Inputs in = healthy_pack(32);
  in.mask_raw = 0x7FFFFFFFu;  // bits 0-30 set, bit31 clear
  const Outputs out = resolve(in);
  check(out.state_code == STATE_MISMATCH, "32S missing bit31: resolves MISMATCH, not CONFIRMED");
  check_eq<uint8_t>(out.reason_code, REASON_MASK_COUNT_DIFFERS, "32S missing bit31: reason is MASK_COUNT_DIFFERS (connected_count=31 != configured=32)");
}

// ===========================================================================
// 7. UNKNOWN/MISMATCH states never claim a specific count is trustworthy,
// and always blank consistently with whatever candidate CellCount was
// readable (never silently substituting a guess).
// ===========================================================================
static void test_loading_no_valid_n_yet() {
  Inputs in;  // default: have_cell_data=false, configured_f=NAN, mask_valid=false
  const Outputs out = resolve(in);
  check_eq<uint8_t>(out.state_code, STATE_LOADING, "no data since boot: state is LOADING");
  check(!out.confirmed, "LOADING: never confirmed");
  check_eq<uint8_t>(out.blank_voltage_from, 0, "LOADING: blank_voltage_from == 0 -- nothing shown, no made-up configuration or residual value from a previous battery");
  check_eq<uint8_t>(out.blank_resistance_from, 0, "LOADING: blank_resistance_from == 0");
  check(!out.has_connected_count && !out.has_measured_count && !out.has_active_sum, "LOADING: no diagnostic numbers published (none were ever computed)");
}

static void test_mismatch_voltage_sum_differs() {
  Inputs in = healthy_pack(16);
  in.pack_voltage = 16.0f * 3.30f - 5.0f;  // way outside tolerance
  const Outputs out = resolve(in);
  check_eq<uint8_t>(out.state_code, STATE_MISMATCH, "pack voltage mismatch: state is MISMATCH");
  check_eq<uint8_t>(out.reason_code, REASON_VOLTAGE_SUM_DIFFERS, "pack voltage mismatch: reason is VOLTAGE_SUM_DIFFERS");
  check(!out.confirmed, "pack voltage mismatch: not confirmed");
  // MISMATCH still blanks exactly like CONFIRMED would (blank_voltage_from
  // depends only on the candidate CellCount, not on whether it was
  // ultimately confirmed) -- channels beyond it must not show residual
  // bytes as trustworthy just because state isn't CONFIRMED.
  check_eq<uint8_t>(out.blank_voltage_from, 16, "pack voltage mismatch: still blanks from 16 (the candidate count), not from 0 or 32");
  check(out.has_connected_count && out.has_measured_count && out.has_active_sum, "pack voltage mismatch: diagnostic numbers ARE still published (mismatch never hides physical data)");
}

static void test_mismatch_active_range_gap() {
  Inputs in = healthy_pack(16);
  in.voltage[7] = NAN;  // channel 8 (index 7), inside the configured range, implausible
  const Outputs out = resolve(in);
  check_eq<uint8_t>(out.state_code, STATE_MISMATCH, "gap inside configured range: state is MISMATCH");
  check_eq<uint8_t>(out.reason_code, REASON_ACTIVE_RANGE_GAP, "gap inside configured range: reason is ACTIVE_RANGE_GAP");
}

static void test_invalid_count_out_of_range() {
  for (float bad : {0.0f, 33.0f, -1.0f, 99.0f}) {
    Inputs in = healthy_pack(16);
    in.configured_f = bad;
    in.mask_raw = 0x0000FFFFu;  // arbitrary, doesn't matter -- rejected before mask is examined
    const Outputs out = resolve(in);
    char desc[128];
    std::snprintf(desc, sizeof(desc), "configured=%.0f (outside 1..32): state is INVALID/COUNT_OUT_OF_RANGE", bad);
    check(out.state_code == STATE_INVALID && out.reason_code == REASON_COUNT_OUT_OF_RANGE, desc);
  }
}

static void test_write_uncertain_overrides_everything() {
  Inputs in = healthy_pack(16);
  in.topology_uncertain = true;
  const Outputs out = resolve(in);
  check_eq<uint8_t>(out.state_code, STATE_WRITE_UNCERTAIN, "topology_uncertain set: state is WRITE_UNCERTAIN even with an otherwise-healthy 16S snapshot");
  check(!out.confirmed, "WRITE_UNCERTAIN: never confirmed");
}

static void test_offline_stale_communication() {
  Inputs in = healthy_pack(16);
  in.comm_elapsed_ms = 30001;
  const Outputs out = resolve(in);
  check_eq<uint8_t>(out.state_code, STATE_OFFLINE, "comm_elapsed_ms > 30000: state is OFFLINE");
  check(!out.confirmed, "OFFLINE: never confirmed");
}

// ===========================================================================
// 8. Explicit non-claim: this file never asserts anything about a REAL
// deployed unit's hardware capability -- it only proves the pure decision
// function is internally correct for these fixtures. Recorded here as an
// executable statement of that boundary, not just a comment.
// ===========================================================================
static void test_32s_fixture_is_not_a_hardware_claim() {
  // The only thing being asserted is that resolve() -- pure software --
  // treats 32S the same way it treats 16S: no special-cased hardware
  // gate, no hidden "is this a real device" check. Whether any actual
  // deployed BMS reports a genuinely confirmable 32-cell snapshot is an
  // orthogonal, hardware-dependent question this test cannot and does not
  // answer.
  const Outputs out16 = resolve(healthy_pack(16));
  const Outputs out32 = resolve(healthy_pack(32));
  check(out16.confirmed && out32.confirmed, "16S and 32S both resolve CONFIRMED via the identical code path -- no separate hardcoded mode for either");
}

int main() {
  test_confirmed_various_topologies();
  test_display_cell_count_independent_of_confirmation_8s_16s();
  test_invalid_cellcount_shows_config_error_not_32();
  test_new_connection_without_n_shows_zero_not_previous_config();
  test_hiding_boundary_exact_per_topology();
  test_transition_16_to_8();
  test_transition_8_to_24();
  test_no_stale_values_across_calls();
  test_sparse_mask_wrong_positions_mismatches();
  test_high_bit_mask_32s_exact();
  test_high_bit_mask_missing_high_bit_mismatches();
  test_loading_no_valid_n_yet();
  test_mismatch_voltage_sum_differs();
  test_mismatch_active_range_gap();
  test_invalid_count_out_of_range();
  test_write_uncertain_overrides_everything();
  test_offline_stale_communication();
  test_32s_fixture_is_not_a_hardware_claim();

  std::printf("%d checks run, %d failed.\n", g_checks, g_failures);
  return g_failures ? 1 : 0;
}
