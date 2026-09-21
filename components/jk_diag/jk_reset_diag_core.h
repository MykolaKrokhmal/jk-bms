#pragma once
// jk_reset_diag_core.h -- pure, hardware-independent reset-reason/crash-
// stage naming for the reset/crash observability pass (2026-09-21,
// post-reboot hardware-acceptance audit: a real ESP uptime drop from
// ~1842s to ~18s occurred immediately after a single POST to
// /settings/register-write, with the HTTP client receiving zero bytes
// before a 10s timeout -- see this project's own audit report for the
// full write-up). No ESP-IDF, no esp_system.h, no RTC memory attributes
// -- this header only maps already-read integer codes to stable,
// human-readable names, so it is desktop-testable without any ESP32
// toolchain (see test/jk_diag/test_jk_reset_diag_core.cpp). The actual
// esp_reset_reason()/RTC_NOINIT_ATTR calls live in batterylifepo4.yaml's
// own on_boot lambda and a separate, ESP32-only header
// (jk_reset_diag_rtc.h), which this file intentionally never includes.
//
// This module does NOT itself prove what caused any specific reboot --
// it only gives a future reboot honest, human-readable forensic data
// (reset reason, and -- ONLY when RTC memory genuinely survived, see
// jk_reset_diag_rtc.h's own module comment for exactly which reset
// types that covers -- the crash-stage marker of whatever HTTP write
// request was in flight at the moment of that future reset).

#include <cstdint>

namespace jk_diag {

// Mirrors ESP-IDF 5.5.5's esp_reset_reason_t (components/esp_system/
// include/esp_system.h) VALUE FOR VALUE -- confirmed directly against
// that exact pinned version's real source (github.com/espressif/esp-idf
// tag v5.5.5), not assumed from memory or an older/different IDF
// release. Declared as a plain integer-valued enum (not a `enum class`
// aliasing esp_reset_reason_t) so this header never needs to include
// esp-idf's own header to stay desktop-testable -- the ESP32-only glue
// casts the real esp_reset_reason_t to int before calling
// reset_reason_name() below.
enum ResetReasonCode : int {
  RESET_UNKNOWN = 0,
  RESET_POWERON = 1,
  RESET_EXT = 2,
  RESET_SW = 3,
  RESET_PANIC = 4,
  RESET_INT_WDT = 5,
  RESET_TASK_WDT = 6,
  RESET_WDT = 7,
  RESET_DEEPSLEEP = 8,
  RESET_BROWNOUT = 9,
  RESET_SDIO = 10,
  RESET_USB = 11,
  RESET_JTAG = 12,
  RESET_EFUSE = 13,
  RESET_PWR_GLITCH = 14,
  RESET_CPU_LOCKUP = 15,
};

// A human-readable, stable name for a reset reason code -- never throws,
// never returns nullptr, always returns a real string even for a code
// outside the known range (a future ESP-IDF upgrade adding a new reason
// must never crash or silently mislabel a genuinely new reset type as
// something else).
inline const char *reset_reason_name(int code) {
  switch (code) {
    case RESET_UNKNOWN: return "UNKNOWN";
    case RESET_POWERON: return "POWERON";
    case RESET_EXT: return "EXT";
    case RESET_SW: return "SW (esp_restart)";
    case RESET_PANIC: return "PANIC (exception/abort)";
    case RESET_INT_WDT: return "INT_WDT (interrupt watchdog)";
    case RESET_TASK_WDT: return "TASK_WDT (task watchdog)";
    case RESET_WDT: return "WDT (other watchdog)";
    case RESET_DEEPSLEEP: return "DEEPSLEEP_WAKE";
    case RESET_BROWNOUT: return "BROWNOUT";
    case RESET_SDIO: return "SDIO";
    case RESET_USB: return "USB";
    case RESET_JTAG: return "JTAG";
    case RESET_EFUSE: return "EFUSE_ERROR";
    case RESET_PWR_GLITCH: return "PWR_GLITCH";
    case RESET_CPU_LOCKUP: return "CPU_LOCKUP";
    default: return "UNRECOGNIZED_RESET_CODE";
  }
}

// True for exactly the reset reasons RTC (slow/fast) memory is
// documented to survive on the ESP32: a software reset (esp_restart), a
// panic/exception reboot, any watchdog reset, and a deep-sleep wake --
// all of these leave the RTC memory power domain (VDD_RTC) continuously
// powered, so RTC_NOINIT_ATTR content from just before the reset is
// still valid. FALSE for POWERON (a genuine cold boot -- VDD_RTC was
// off, RTC memory content is undefined/garbage), BROWNOUT and
// PWR_GLITCH (VDD_RTC itself may have dropped -- content cannot be
// trusted), and UNKNOWN/any unrecognized code (fail closed: never claim
// survival when the actual cause is not positively identified as one of
// the confirmed-safe types above). This function is the SOLE authority
// this project uses for "is the crash-stage marker trustworthy this
// boot" -- never inferred ad hoc elsewhere.
inline bool reset_reason_preserves_rtc_memory(int code) {
  switch (code) {
    case RESET_SW:
    case RESET_PANIC:
    case RESET_INT_WDT:
    case RESET_TASK_WDT:
    case RESET_WDT:
    case RESET_DEEPSLEEP:
      return true;
    default:
      return false;
  }
}

// Crash-stage marker values for the HTTP write handoff path (Phase 3's
// mailbox design). Written to RTC_NOINIT_ATTR memory (by the ESP32-only
// glue, never here) at each real milestone, so a reboot that lands mid-
// sequence leaves an honest record of the LAST stage actually reached --
// never a stage that was merely about to start. STAGE_IDLE both before
// the first request of a boot session and after every request settles
// (successfully or not) -- a marker other than STAGE_IDLE surviving into
// a NEW boot (per reset_reason_preserves_rtc_memory() above) is itself
// the forensic signal "a write request was in flight when this device
// last reset."
enum WriteCrashStage : uint8_t {
  STAGE_IDLE = 0,
  STAGE_HANDLER_ENTERED = 1,
  STAGE_VALIDATION_COMPLETE = 2,
  STAGE_HANDOFF_QUEUED = 3,
  STAGE_MAIN_LOOP_EXECUTION_STARTED = 4,
  STAGE_TRANSACTION_ALLOCATED = 5,
  STAGE_MODBUS_COMMAND_QUEUED = 6,
  STAGE_RESPONSE_SENT = 7,
};

inline const char *write_crash_stage_name(uint8_t stage) {
  switch (stage) {
    case STAGE_IDLE: return "IDLE";
    case STAGE_HANDLER_ENTERED: return "HANDLER_ENTERED";
    case STAGE_VALIDATION_COMPLETE: return "VALIDATION_COMPLETE";
    case STAGE_HANDOFF_QUEUED: return "HANDOFF_QUEUED";
    case STAGE_MAIN_LOOP_EXECUTION_STARTED: return "MAIN_LOOP_EXECUTION_STARTED";
    case STAGE_TRANSACTION_ALLOCATED: return "TRANSACTION_ALLOCATED";
    case STAGE_MODBUS_COMMAND_QUEUED: return "MODBUS_COMMAND_QUEUED";
    case STAGE_RESPONSE_SENT: return "RESPONSE_SENT";
    default: return "UNRECOGNIZED_STAGE";
  }
}

}  // namespace jk_diag
