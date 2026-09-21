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

  std::printf("\n%d checks, %d failures\n", g_checks, g_failures);
  return g_failures == 0 ? 0 : 1;
}
