// Host-side unit tests for jk_reset_diag_core.h -- pure reset-reason/
// crash-stage naming, no ESP-IDF/RTC memory involved.
//
//   g++ -std=c++17 -Wall -Wextra -I ../../components/jk_diag \
//       test_jk_reset_diag_core.cpp -o test_jk_reset_diag_core
//   ./test_jk_reset_diag_core

#include "jk_reset_diag_core.h"

#include <cstdio>
#include <cstring>

using namespace jk_diag;

namespace {
int g_failures = 0;
int g_checks = 0;
void check(bool cond, const char *desc) {
  g_checks++;
  if (!cond) { g_failures++; std::printf("FAIL: %s\n", desc); }
}
}  // namespace

int main() {
  // Every real ESP-IDF 5.5.5 esp_reset_reason_t value (confirmed against
  // the real pinned source) maps to a distinct, non-generic name.
  check(std::strcmp(reset_reason_name(RESET_POWERON), "UNRECOGNIZED_RESET_CODE") != 0, "POWERON has a real name");
  check(std::strcmp(reset_reason_name(RESET_SW), "UNRECOGNIZED_RESET_CODE") != 0, "SW has a real name");
  check(std::strcmp(reset_reason_name(RESET_PANIC), "UNRECOGNIZED_RESET_CODE") != 0, "PANIC has a real name");
  check(std::strcmp(reset_reason_name(RESET_TASK_WDT), "UNRECOGNIZED_RESET_CODE") != 0, "TASK_WDT has a real name");
  check(std::strcmp(reset_reason_name(RESET_BROWNOUT), "UNRECOGNIZED_RESET_CODE") != 0, "BROWNOUT has a real name");
  check(std::strcmp(reset_reason_name(RESET_CPU_LOCKUP), "UNRECOGNIZED_RESET_CODE") != 0, "CPU_LOCKUP has a real name (last enumerator)");

  // A code outside the known 0-15 range never crashes and is never
  // silently mislabeled as a real reason.
  check(std::strcmp(reset_reason_name(999), "UNRECOGNIZED_RESET_CODE") == 0, "an unknown code fails closed to UNRECOGNIZED_RESET_CODE");
  check(std::strcmp(reset_reason_name(-1), "UNRECOGNIZED_RESET_CODE") == 0, "a negative code fails closed too");

  // The RTC-memory-trustworthy set is EXACTLY {SW, PANIC, INT_WDT,
  // TASK_WDT, WDT, DEEPSLEEP} -- every other real reason, and any
  // unrecognized one, must be false. This is the one function this
  // project trusts to gate "is the crash-stage marker meaningful this
  // boot" -- getting this wrong either hides a real crash marker or
  // (worse) claims a marker survived a power-loss/brownout it could not
  // have.
  check(reset_reason_preserves_rtc_memory(RESET_SW), "SW preserves RTC memory");
  check(reset_reason_preserves_rtc_memory(RESET_PANIC), "PANIC preserves RTC memory");
  check(reset_reason_preserves_rtc_memory(RESET_INT_WDT), "INT_WDT preserves RTC memory");
  check(reset_reason_preserves_rtc_memory(RESET_TASK_WDT), "TASK_WDT preserves RTC memory");
  check(reset_reason_preserves_rtc_memory(RESET_WDT), "WDT preserves RTC memory");
  check(reset_reason_preserves_rtc_memory(RESET_DEEPSLEEP), "DEEPSLEEP preserves RTC memory");

  check(!reset_reason_preserves_rtc_memory(RESET_POWERON), "POWERON (cold boot) must NEVER claim RTC memory survived");
  check(!reset_reason_preserves_rtc_memory(RESET_BROWNOUT), "BROWNOUT must NEVER claim RTC memory survived");
  check(!reset_reason_preserves_rtc_memory(RESET_PWR_GLITCH), "PWR_GLITCH must NEVER claim RTC memory survived");
  check(!reset_reason_preserves_rtc_memory(RESET_UNKNOWN), "UNKNOWN fails closed (never assumed safe)");
  check(!reset_reason_preserves_rtc_memory(999), "an unrecognized code fails closed (never assumed safe)");

  // Crash-stage names: every declared stage has a real, distinct name,
  // and an unrecognized stage value fails closed rather than aliasing a
  // real stage.
  check(std::strcmp(write_crash_stage_name(STAGE_IDLE), "IDLE") == 0, "STAGE_IDLE name");
  check(std::strcmp(write_crash_stage_name(STAGE_HANDLER_ENTERED), "HANDLER_ENTERED") == 0, "STAGE_HANDLER_ENTERED name");
  check(std::strcmp(write_crash_stage_name(STAGE_VALIDATION_COMPLETE), "VALIDATION_COMPLETE") == 0, "STAGE_VALIDATION_COMPLETE name");
  check(std::strcmp(write_crash_stage_name(STAGE_HANDOFF_QUEUED), "HANDOFF_QUEUED") == 0, "STAGE_HANDOFF_QUEUED name");
  check(std::strcmp(write_crash_stage_name(STAGE_MAIN_LOOP_EXECUTION_STARTED), "MAIN_LOOP_EXECUTION_STARTED") == 0, "STAGE_MAIN_LOOP_EXECUTION_STARTED name");
  check(std::strcmp(write_crash_stage_name(STAGE_TRANSACTION_ALLOCATED), "TRANSACTION_ALLOCATED") == 0, "STAGE_TRANSACTION_ALLOCATED name");
  check(std::strcmp(write_crash_stage_name(STAGE_MODBUS_COMMAND_QUEUED), "MODBUS_COMMAND_QUEUED") == 0, "STAGE_MODBUS_COMMAND_QUEUED name");
  check(std::strcmp(write_crash_stage_name(STAGE_RESPONSE_SENT), "RESPONSE_SENT") == 0, "STAGE_RESPONSE_SENT name");
  check(std::strcmp(write_crash_stage_name(200), "UNRECOGNIZED_STAGE") == 0, "an unrecognized stage value fails closed");

  // The exact hypothesis this pass exists to distinguish: a reboot that
  // lands with the marker at STAGE_HANDOFF_QUEUED or
  // STAGE_MODBUS_COMMAND_QUEUED (this project's own most-evidenced
  // hazard -- see the audit's own root-cause writeup) is a genuinely
  // different, more actionable finding than one that never advanced past
  // STAGE_HANDLER_ENTERED (e.g. a bad request never even reaching
  // validation).
  check(STAGE_HANDOFF_QUEUED != STAGE_MODBUS_COMMAND_QUEUED, "the two most safety-relevant stages are genuinely distinct values");
  check(std::strcmp(write_crash_stage_name(STAGE_TRANSACTION_PENDING), "TRANSACTION_PENDING") == 0,
        "STAGE_TRANSACTION_PENDING name (2026-09-21 second corrective pass: the write-tx tick loop's own aggregate pending marker)");

  // ---------------------------------------------------------------------
  // Second corrective pass (2026-09-21): compute_reset_count_since_power_on()
  // fail-closed gating. The PREVIOUS version of this project's
  // read_and_reset_boot_diagnostics() gated the counter increment on
  // `magic_ok` ALONE, which is wrong: a reset type RTC memory is not
  // documented to survive (POWERON/BROWNOUT/PWR_GLITCH) can still, by
  // chance/hardware quirk, leave the magic word reading back correctly
  // even though the rest of RTC memory's content is not actually
  // guaranteed trustworthy. The counter must ALWAYS restart at 1 for such
  // a reset, regardless of what the magic word reads as.
  // ---------------------------------------------------------------------
  {
    // A genuinely trustworthy continuation: SW reset, magic matched.
    const bool sw_trustworthy = reset_reason_preserves_rtc_memory(RESET_SW) && /*magic_ok=*/true;
    check(compute_reset_count_since_power_on(sw_trustworthy, 5) == 6,
          "SW reset with matching magic genuinely continues the counter (5 -> 6)");

    // POWERON with an ACCIDENTALLY-preserved magic value: magic_ok=true,
    // but reset_reason_preserves_rtc_memory(POWERON) is false -- the
    // counter must still fail closed to 1, never continue as if this were
    // a real continuation.
    const bool poweron_trustworthy = reset_reason_preserves_rtc_memory(RESET_POWERON) && /*magic_ok=*/true;
    check(!poweron_trustworthy, "POWERON is never trustworthy even with a matching magic value");
    check(compute_reset_count_since_power_on(poweron_trustworthy, 5) == 1,
          "POWERON with an accidentally-preserved magic value still fails closed to 1, never continues from 5");

    // BROWNOUT with an accidentally-preserved magic value: same fail-
    // closed requirement -- VDD_RTC itself may have dropped, so RTC
    // content (including a coincidentally-matching magic) cannot be
    // trusted for this reset type at all.
    const bool brownout_trustworthy = reset_reason_preserves_rtc_memory(RESET_BROWNOUT) && /*magic_ok=*/true;
    check(!brownout_trustworthy, "BROWNOUT is never trustworthy even with a matching magic value");
    check(compute_reset_count_since_power_on(brownout_trustworthy, 42) == 1,
          "BROWNOUT with an accidentally-preserved magic value still fails closed to 1, never continues from 42");

    // PWR_GLITCH with an accidentally-preserved magic value: identical
    // reasoning to BROWNOUT -- VDD_RTC may have glitched.
    const bool pwrglitch_trustworthy = reset_reason_preserves_rtc_memory(RESET_PWR_GLITCH) && /*magic_ok=*/true;
    check(!pwrglitch_trustworthy, "PWR_GLITCH is never trustworthy even with a matching magic value");
    check(compute_reset_count_since_power_on(pwrglitch_trustworthy, 7) == 1,
          "PWR_GLITCH with an accidentally-preserved magic value still fails closed to 1, never continues from 7");

    // A trustworthy reset type but a magic MISMATCH (first boot of a new
    // image, or genuinely fresh RTC content) must also fail closed to 1.
    const bool sw_wrong_magic = reset_reason_preserves_rtc_memory(RESET_SW) && /*magic_ok=*/false;
    check(compute_reset_count_since_power_on(sw_wrong_magic, 99) == 1,
          "SW reset with a magic MISMATCH fails closed to 1, never continues from 99 (different/first image)");
  }

  std::printf("\n%d checks, %d failures\n", g_checks, g_failures);
  return g_failures == 0 ? 0 : 1;
}
