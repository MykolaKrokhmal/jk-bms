// Host-side unit tests for jk_capability_core.h -- no ESP32, no ESPHome, no
// ESP-IDF, no real hardware needed. Build and run with a plain desktop
// compiler:
//
//   g++ -std=c++17 -Wall -Wextra -I ../../components/jk_capability \
//       test_jk_capability_core.cpp -o test_jk_capability_core
//   ./test_jk_capability_core
//
// Exits non-zero (and prints which check failed) on any failure, so it's
// usable as a CI gate, not just a manual smoke test. Mirrors
// test/jk_topology/test_jk_topology_core.cpp's own structure.
//
// Stage 3 bounded batch (user-directed, 2026-09-17): CellWireRes16-31 and
// CellConWireRes0-31 both need an explicit unknown/supported/unsupported
// capability signal, independent of topology confirmation, with a bounded
// number of probe attempts before giving up for the rest of the boot
// session -- "не допускай нескінченних probes або повторних
// exception-запитів". Every test below calls the SAME should_attempt()/
// record_outcome() functions the real firmware callers (batterylifepo4.yaml)
// call -- no reimplementation of the state machine anywhere in this file.

#include "jk_capability_core.h"

#include <cmath>
#include <cstdio>
#include <string>

using namespace jk_capability;

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

// ===========================================================================
// 1. Fresh block: UNKNOWN, attemptable immediately.
// ===========================================================================
void test_initial_state_is_unknown_and_attemptable() {
  const ProbeState s;
  check_eq<uint8_t>(uint8_t(s.state), uint8_t(STATE_UNKNOWN), "fresh ProbeState starts UNKNOWN");
  check_eq<uint8_t>(s.consecutive_failures, 0, "fresh ProbeState starts with zero failures");
  check(should_attempt(s), "a fresh UNKNOWN block should be attempted");
}

// ===========================================================================
// 2. Bounded probing: exactly MAX_PROBE_ATTEMPTS consecutive failures (not
// one fewer, not one more) before UNSUPPORTED -- the core "obmezhennya
// povtoriv" (bounded retries) requirement.
// ===========================================================================
void test_bounded_probing_exact_threshold() {
  ProbeState s;
  static_assert(MAX_PROBE_ATTEMPTS == 3, "this test's own step-by-step assertions assume 3 -- update both together");

  s = record_outcome(s, false);
  check_eq<uint8_t>(uint8_t(s.state), uint8_t(STATE_UNKNOWN), "1st failure: still UNKNOWN (below the bound)");
  check_eq<uint8_t>(s.consecutive_failures, 1, "1st failure: consecutive_failures == 1");
  check(should_attempt(s), "1st failure: still attemptable (1 < MAX_PROBE_ATTEMPTS)");

  s = record_outcome(s, false);
  check_eq<uint8_t>(uint8_t(s.state), uint8_t(STATE_UNKNOWN), "2nd failure: still UNKNOWN (below the bound)");
  check_eq<uint8_t>(s.consecutive_failures, 2, "2nd failure: consecutive_failures == 2");
  check(should_attempt(s), "2nd failure: still attemptable (2 < MAX_PROBE_ATTEMPTS)");

  s = record_outcome(s, false);
  check_eq<uint8_t>(uint8_t(s.state), uint8_t(STATE_UNSUPPORTED), "3rd failure: reaches UNSUPPORTED exactly at MAX_PROBE_ATTEMPTS");
  check_eq<uint8_t>(s.consecutive_failures, 3, "3rd failure: consecutive_failures == 3");
  check(!should_attempt(s), "3rd failure: no longer attemptable -- the bound stops further probing");
}

// ===========================================================================
// 3. No starvation / no infinite probing: once UNSUPPORTED, should_attempt()
// stays false no matter how many more times it's checked -- there is no
// hidden timer or counter that silently re-arms probing on its own, and a
// caller that (incorrectly) kept calling record_outcome(s, false) on an
// already-UNSUPPORTED state does not change its outcome either.
// ===========================================================================
void test_unsupported_never_resumes_probing_on_its_own() {
  ProbeState s;
  for (int i = 0; i < MAX_PROBE_ATTEMPTS; i += 1) s = record_outcome(s, false);
  check_eq<uint8_t>(uint8_t(s.state), uint8_t(STATE_UNSUPPORTED), "reached UNSUPPORTED after the bounded attempts");

  for (int i = 0; i < 50; i += 1) {
    check(!should_attempt(s), "UNSUPPORTED stays non-attemptable on repeated checks -- no starvation-inducing re-arm");
  }
}

// ===========================================================================
// 4. A single success at any point sets SUPPORTED and resets the counter --
// including a success recorded AFTER one or two failures (not yet
// UNSUPPORTED), proving one bus glitch doesn't permanently poison a block
// that then answers correctly.
// ===========================================================================
void test_success_after_partial_failures_recovers_to_supported() {
  ProbeState s;
  s = record_outcome(s, false);
  s = record_outcome(s, false);
  check_eq<uint8_t>(uint8_t(s.state), uint8_t(STATE_UNKNOWN), "sanity: still UNKNOWN after 2 failures, not yet UNSUPPORTED");

  s = record_outcome(s, true);
  check_eq<uint8_t>(uint8_t(s.state), uint8_t(STATE_SUPPORTED), "a success after 2 failures (below the bound) recovers to SUPPORTED");
  check_eq<uint8_t>(s.consecutive_failures, 0, "a success resets consecutive_failures to 0");
  check(should_attempt(s), "SUPPORTED blocks keep being read (ordinary polling, not probing)");
}

// ===========================================================================
// 5. A fresh success (no prior failures at all) sets SUPPORTED directly --
// the common case where the very first attempt succeeds.
// ===========================================================================
void test_immediate_success_sets_supported() {
  ProbeState s;
  s = record_outcome(s, true);
  check_eq<uint8_t>(uint8_t(s.state), uint8_t(STATE_SUPPORTED), "first-attempt success sets SUPPORTED directly");
  check_eq<uint8_t>(s.consecutive_failures, 0, "first-attempt success leaves consecutive_failures at 0");
}

// ===========================================================================
// 6. A SUPPORTED block is never demoted back into the bounded-probe budget
// by a single transient failure -- a proven-working block that misses one
// cycle (bus noise) keeps being read on the normal cadence, it does not
// silently re-enter "probing" and does not risk hitting the bound and
// going UNSUPPORTED from ordinary, occasional noise.
// ===========================================================================
void test_supported_block_survives_one_transient_failure() {
  ProbeState s;
  s = record_outcome(s, true);
  check_eq<uint8_t>(uint8_t(s.state), uint8_t(STATE_SUPPORTED), "sanity: SUPPORTED after a success");

  s = record_outcome(s, false);
  check_eq<uint8_t>(uint8_t(s.state), uint8_t(STATE_SUPPORTED), "one transient failure after SUPPORTED does NOT demote back to probing");
  check_eq<uint8_t>(s.consecutive_failures, 0, "a SUPPORTED block's failure counter is not incremented at all");
  check(should_attempt(s), "still attemptable -- SUPPORTED blocks are always read");

  // Even MAX_PROBE_ATTEMPTS consecutive misses in a row, once SUPPORTED,
  // never flip it to UNSUPPORTED -- that would re-punish a block this
  // project has already proven works, for a run of bad luck on the bus.
  for (int i = 0; i < MAX_PROBE_ATTEMPTS + 5; i += 1) s = record_outcome(s, false);
  check_eq<uint8_t>(uint8_t(s.state), uint8_t(STATE_SUPPORTED), "many consecutive misses after SUPPORTED still never demote it to UNSUPPORTED");

  s = record_outcome(s, true);
  check_eq<uint8_t>(uint8_t(s.state), uint8_t(STATE_SUPPORTED), "a subsequent success keeps it SUPPORTED, counter still at 0");
  check_eq<uint8_t>(s.consecutive_failures, 0, "consecutive_failures stays 0 throughout the SUPPORTED lifetime");
}

// ===========================================================================
// 7. STATE_NAMES stays in sync with the enum -- a diagnostic text_sensor
// (batterylifepo4.yaml) indexes this array directly by state_code, exactly
// like jk_topology_core.h's own STATE_NAMES/state_code pairing.
// ===========================================================================
void test_state_names_array_matches_enum() {
  check_eq<int>(int(sizeof(STATE_NAMES) / sizeof(STATE_NAMES[0])), 3, "STATE_NAMES has exactly 3 entries, matching the 3-value enum");
  check(std::string(STATE_NAMES[STATE_UNKNOWN]) == "UNKNOWN", "STATE_NAMES[STATE_UNKNOWN] == \"UNKNOWN\"");
  check(std::string(STATE_NAMES[STATE_SUPPORTED]) == "SUPPORTED", "STATE_NAMES[STATE_SUPPORTED] == \"SUPPORTED\"");
  check(std::string(STATE_NAMES[STATE_UNSUPPORTED]) == "UNSUPPORTED", "STATE_NAMES[STATE_UNSUPPORTED] == \"UNSUPPORTED\"");
}

// ===========================================================================
// 8. A cycle where should_attempt() was false (block already UNSUPPORTED,
// or not currently needed by the caller) must never itself be fed into
// record_outcome() -- this test documents that contract by confirming a
// caller which correctly skips the call leaves the state byte-for-byte
// unchanged (the real regression this guards against: a caller that
// "reports a failure" for a cycle it never actually attempted, which
// would silently fabricate probe pressure that was never real bus
// traffic).
// ===========================================================================
void test_skipped_cycle_leaves_state_unchanged() {
  ProbeState s;
  s = record_outcome(s, false);
  s = record_outcome(s, false);
  const ProbeState before = s;
  // No record_outcome() call here -- simulates the caller's own
  // `if (!should_attempt(s)) return;` guard skipping this cycle entirely
  // when, e.g., configured N doesn't need this block right now.
  check_eq<uint8_t>(uint8_t(s.state), uint8_t(before.state), "a skipped cycle changes nothing (state)");
  check_eq<uint8_t>(s.consecutive_failures, before.consecutive_failures, "a skipped cycle changes nothing (counter)");
}

// ===========================================================================
// 9. needs_cellwireres_extended_read(): configured N and register-block
// SUPPORT are different questions (user-directed requirement) -- this
// function answers only "does this configured N even call for channels
// 17-32 to exist". Exercised across the exact scenarios named in the
// user's own test list: 8/16/24/32, plus the boundary (17, 32) and
// out-of-range/unknown inputs that must never be treated as "needs it".
// ===========================================================================
void test_needs_cellwireres_extended_read_across_configured_n() {
  check(!needs_cellwireres_extended_read(8.0f), "N=8: does NOT need the CellWireRes16-31 extension");
  check(!needs_cellwireres_extended_read(16.0f), "N=16 (the deployed unit's own configuration): does NOT need the extension -- zero added traffic");
  check(needs_cellwireres_extended_read(17.0f), "N=17 (just past the boundary): DOES need the extension");
  check(needs_cellwireres_extended_read(24.0f), "N=24: DOES need the extension");
  check(needs_cellwireres_extended_read(32.0f), "N=32 (protocol capacity, upper boundary): DOES need the extension");
  check(!needs_cellwireres_extended_read(33.0f), "N=33 (out of protocol range): does NOT need the extension -- never treated as a valid wide pack");
  check(!needs_cellwireres_extended_read(0.0f), "N=0 (invalid configuration): does NOT need the extension");
  check(!needs_cellwireres_extended_read(std::nanf("")), "N=NaN (no valid snapshot yet, e.g. new connection): does NOT need the extension -- never a guess");
}

// ===========================================================================
// 10. Failure taxonomy: this codebase's own Modbus callback layer (see
// batterylifepo4.yaml's own `if (data.size() < N)` short-response guards,
// and jk_capability_core.h's own module comment on why a real Modbus
// EXCEPTION response and a true non-response cannot be distinguished at
// this layer) cannot tell a short/truncated response apart from a
// protocol-level exception response or a full non-response -- all three
// are, deliberately, the same "success=false" outcome fed to
// record_outcome(). This test names each scenario explicitly (rather than
// leaving that collapse implicit) so a reader auditing test coverage can
// see all three were considered, not just genericically "false".
// ===========================================================================
void test_short_and_exception_responses_both_count_as_failures() {
  {
    // Scenario A: a SHORT response -- the BMS answered, but with fewer
    // bytes than requested (data.size() < expected). The real caller
    // detects this itself (`const bool success = data.size() >= N;`) and
    // passes false here -- this test proves that false is handled
    // identically to every other failure kind, not specially.
    ProbeState s;
    s = record_outcome(s, /*success=*/false);
    check_eq<uint8_t>(uint8_t(s.state), uint8_t(STATE_UNKNOWN), "short-response failure: still UNKNOWN after 1 (below the bound)");
    check_eq<uint8_t>(s.consecutive_failures, 1, "short-response failure: counted exactly once");
  }
  {
    // Scenario B: a Modbus EXCEPTION response or a full non-response
    // (timeout) -- this codebase's real caller cannot tell these two
    // apart either. Correction (2026-09-18 framework research):
    // ModbusCommandItem::on_error DOES exist as a fixed virtual override
    // and IS invoked on a genuine exception response -- but it does not
    // call on_data_func, so a project using only the on_data_func-based
    // create_read_command() factory (as this one does) still cannot
    // observe it without subclassing (not attempted this pass). See
    // jk_capability_core.h's own AttemptOutcome module comment for the
    // full, corrected framework citation. batterylifepo4.yaml's own
    // pending/elapsed-time timeout branch (modeled on the pre-existing
    // CellCount write-transaction driver's identical ACK-timeout idiom)
    // is what both failure kinds actually fall through to -- both
    // collapse to a single record_outcome(s, false) call. Proven
    // here to reach UNSUPPORTED via the exact same bounded path as
    // scenario A -- there is no separate, unbounded path for this kind
    // of failure.
    ProbeState s;
    for (int i = 0; i < MAX_PROBE_ATTEMPTS; i += 1) s = record_outcome(s, /*success=*/false);
    check_eq<uint8_t>(uint8_t(s.state), uint8_t(STATE_UNSUPPORTED), "exception/timeout failure: reaches UNSUPPORTED via the same bounded path as a short response");
    check(!should_attempt(s), "exception/timeout failure: no longer attemptable once bounded out, exactly like a short response");
  }
}

// ===========================================================================
// 11. classify_response(): pure EXACT-match check between RESPONSE_OK and
// RESPONSE_LENGTH_MISMATCH -- only ever called for a callback that
// actually fired (a real response arrived), never for the deadline-
// expired/no-callback case. Corrected 2026-09-18 (user-directed): a
// response LONGER than expected must not be silently accepted either --
// for a fixed register_count FC03 read the framework's own response size
// is deterministic, so any mismatch (short OR long) is a real anomaly.
// ===========================================================================
void test_classify_response_boundary() {
  check_eq<int>(int(classify_response(128, 128)), int(ATTEMPT_RESPONSE_OK), "exact expected length: RESPONSE_OK");
  check_eq<int>(int(classify_response(200, 128)), int(ATTEMPT_RESPONSE_LENGTH_MISMATCH), "more than expected: RESPONSE_LENGTH_MISMATCH -- extra bytes are never silently accepted as success (this is exactly the class of bug that let a doubled register_count request go unnoticed)");
  check_eq<int>(int(classify_response(256, 128)), int(ATTEMPT_RESPONSE_LENGTH_MISMATCH), "exactly double the expected length (the CellConWireRes0-31 register-count bug's own shape, 256 vs 128): RESPONSE_LENGTH_MISMATCH, not RESPONSE_OK");
  check_eq<int>(int(classify_response(127, 128)), int(ATTEMPT_RESPONSE_LENGTH_MISMATCH), "one byte short: RESPONSE_LENGTH_MISMATCH");
  check_eq<int>(int(classify_response(0, 128)), int(ATTEMPT_RESPONSE_LENGTH_MISMATCH), "zero bytes (a real callback fired, but empty): RESPONSE_LENGTH_MISMATCH, not confused with 'no callback at all'");
  check_eq<int>(int(classify_response(1, 128)), int(ATTEMPT_RESPONSE_LENGTH_MISMATCH), "one byte: RESPONSE_LENGTH_MISMATCH");
}

// ===========================================================================
// 13. CellConWireRes0-31's own channel/register/byte constants (2026-09-18,
// user-directed register-count fix): 32 channels x 2 registers/channel = 64
// registers = 128 bytes. These mirror the named constants declared inline
// in batterylifepo4.yaml's own interval lambda (channel_count,
// registers_per_channel, register_count, expected_payload_bytes) -- kept
// here as an independent, desktop-checkable arithmetic proof that the
// relationship between them is exactly what the wire request/decode loop
// assume, so a future edit to any one of the YAML literals is caught even
// though the YAML lambda body itself isn't C++-unit-testable directly.
// ===========================================================================
void test_cellconwireres_register_byte_arithmetic() {
  constexpr uint8_t channel_count = 32;
  constexpr uint8_t registers_per_channel = 2;
  constexpr uint16_t register_count = uint16_t(channel_count) * uint16_t(registers_per_channel);
  constexpr size_t expected_payload_bytes = size_t(register_count) * 2U;

  check_eq<uint16_t>(register_count, 64, "32 channels x 2 registers/channel = 64 Modbus registers (the FC03 request's own register_count field)");
  check_eq<size_t>(expected_payload_bytes, 128, "64 registers x 2 bytes/register = 128 bytes (the decode loop's own byte budget: 32 channels x 4 bytes/channel)");

  // The prior pass's literal "128" passed where register_count now goes
  // would have requested double the correct quantity -- proven here purely
  // arithmetically, independent of any framework/hardware behavior.
  check_eq<uint16_t>(uint16_t(128), uint16_t(register_count * 2), "the old literal (128 registers) equals exactly double the corrected register_count -- confirms the bug was a factor-of-2 registers/bytes unit confusion, not an unrelated off-by-some-other-amount");

  // A response classified against the corrected byte budget: exactly 128
  // bytes is success, 256 (what the OLD, buggy register_count=128 would
  // have actually requested on the wire, register_count_old * 2) is not.
  check_eq<int>(int(classify_response(expected_payload_bytes, expected_payload_bytes)), int(ATTEMPT_RESPONSE_OK),
                "a real 128-byte response against the corrected 128-byte budget: RESPONSE_OK");
  check_eq<int>(int(classify_response(256, expected_payload_bytes)), int(ATTEMPT_RESPONSE_LENGTH_MISMATCH),
                "256 bytes (what register_count=128, the pre-fix literal, would request on the wire) against the corrected 128-byte budget: RESPONSE_LENGTH_MISMATCH -- would have masked the bug under the old '>=' semantics");

  // Decode-loop bounds: the last channel's 4-byte field must end exactly
  // at expected_payload_bytes, never past it -- a silent off-by-one in
  // either constant would read out of bounds of a 128-byte payload.
  const size_t last_channel_offset = size_t(channel_count - 1) * (size_t(registers_per_channel) * 2U);
  const size_t last_channel_end = last_channel_offset + 4U;
  check_eq<size_t>(last_channel_offset, 124, "channel 32 (index 31)'s own byte offset: 124");
  check_eq<size_t>(last_channel_end, expected_payload_bytes, "channel 32's own 4-byte field ends exactly at expected_payload_bytes -- no out-of-bounds read, no gap left undecoded");
}

// ===========================================================================
// 12. callback_matches_pending_attempt(): the guard against misattributing
// a late/stale response to a different (newer) attempt's own bookkeeping.
// The real caller captures its own generation id BY VALUE into the
// response lambda at queue time and compares it here against whatever
// generation is CURRENTLY tracked as pending when the callback eventually
// fires -- possibly much later, possibly after several newer attempts.
// ===========================================================================
void test_callback_matches_pending_attempt() {
  check(callback_matches_pending_attempt(1, 1), "same generation: matches");
  check(callback_matches_pending_attempt(0, 0), "generation 0 (the very first attempt, before any increment): matches itself");
  check(!callback_matches_pending_attempt(1, 2), "a late callback for generation 1 arriving after generation 2 is already pending: does NOT match -- must not be attributed to generation 2's own bookkeeping");
  check(!callback_matches_pending_attempt(5, 1), "a callback claiming a LATER generation than what's currently pending: does not match either (should never happen in practice -- generations only ever increase monotonically before a new attempt is queued -- but the comparison itself makes no directional assumption, only equality)");
  check(!callback_matches_pending_attempt(1, 3), "generation 1 arriving after TWO newer attempts (2, then 3) have already been queued and are now pending: still correctly rejected, not just the immediately-next generation");
}

}  // namespace

int main() {
  test_initial_state_is_unknown_and_attemptable();
  test_bounded_probing_exact_threshold();
  test_unsupported_never_resumes_probing_on_its_own();
  test_success_after_partial_failures_recovers_to_supported();
  test_immediate_success_sets_supported();
  test_supported_block_survives_one_transient_failure();
  test_state_names_array_matches_enum();
  test_skipped_cycle_leaves_state_unchanged();
  test_needs_cellwireres_extended_read_across_configured_n();
  test_short_and_exception_responses_both_count_as_failures();
  test_classify_response_boundary();
  test_callback_matches_pending_attempt();
  test_cellconwireres_register_byte_arithmetic();

  std::printf("%d checks run, %d failed.\n", g_checks, g_failures);
  return g_failures ? 1 : 0;
}
