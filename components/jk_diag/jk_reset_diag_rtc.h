#pragma once
// jk_reset_diag_rtc.h -- ESP32-only glue for reset/crash observability
// (2026-09-21, post-reboot hardware-acceptance audit): the real
// esp_reset_reason() call and RTC_NOINIT_ATTR crash-stage/reset-counter
// storage. Deliberately kept separate from jk_reset_diag_core.h (pure,
// desktop-tested name/semantics logic) so that file never needs ESP-IDF
// headers, and this one never needs its own desktop test binary (there
// is nothing to unit-test here beyond what jk_reset_diag_core.h already
// covers -- this file is a thin, directly-verified-against-source glue
// layer only).
//
// esp_reset_reason() (esp_system.h) and RTC_NOINIT_ATTR (esp_attr.h,
// ".rtc_noinit" section) confirmed directly against the real, pinned
// ESP-IDF 5.5.5 source (github.com/espressif/esp-idf tag v5.5.5), not
// assumed from memory or a different IDF release.
//
// RTC (slow) memory survival, confirmed by ESP-IDF's own documented
// hardware behavior (not this project's invention): it survives every
// reset EXCEPT a genuine cold power-on and a brownout/power-glitch that
// drops the VDD_RTC power domain -- see
// jk_diag::reset_reason_preserves_rtc_memory() for the exact, single
// place this project trusts that boundary. The magic-word guard below
// additionally protects against reading stale/uninitialized RTC content
// from a DIFFERENT firmware image (e.g. right after an OTA update, or
// the very first boot ever) that happened to also reset via one of the
// "trustworthy" reset types but never wrote this project's own magic
// value into this exact RTC memory layout.
#ifdef USE_ESP32

#include <cstdint>

#include "esp_attr.h"
#include "esp_system.h"

#include "jk_reset_diag_core.h"

namespace jk_diag {

RTC_NOINIT_ATTR uint32_t g_rtc_magic;
RTC_NOINIT_ATTR uint8_t g_rtc_write_crash_stage;
// Resets-since-power-on counter, NOT a true persistent-across-power-
// cycles boot count: RTC_NOINIT_ATTR memory does not survive a genuine
// power-on/brownout (see the module comment above), so this counter
// itself resets to 1 whenever power was actually lost. Kept in RTC SRAM
// only -- zero flash writes, zero flash wear, by construction.
RTC_NOINIT_ATTR uint32_t g_rtc_reset_count;

constexpr uint32_t kRtcMagic = 0x4A4B4253u;  // ASCII "JKBS", this project's own guard value

struct BootDiagnostics {
  int reset_reason_code = 0;
  bool rtc_trustworthy = false;
  uint8_t last_write_crash_stage = STAGE_IDLE;
  uint32_t reset_count_since_power_on = 1;
};

// Called exactly once, very early in on_boot (before the write-registry
// handlers/main-loop consumer are ever reachable): reads the real reset
// reason, captures whatever crash-stage marker the PREVIOUS boot session
// left behind (only if RTC memory is confirmed trustworthy for this
// specific reset type AND the magic guard matches this project's own
// prior write, never a different image's leftover bytes), then resets
// the marker to STAGE_IDLE and re-arms the magic guard for the new
// session.
inline BootDiagnostics read_and_reset_boot_diagnostics() {
  BootDiagnostics out;
  out.reset_reason_code = static_cast<int>(esp_reset_reason());
  const bool magic_ok = g_rtc_magic == kRtcMagic;
  out.rtc_trustworthy = reset_reason_preserves_rtc_memory(out.reset_reason_code) && magic_ok;
  out.last_write_crash_stage = out.rtc_trustworthy ? g_rtc_write_crash_stage : STAGE_IDLE;
  out.reset_count_since_power_on = magic_ok ? (g_rtc_reset_count + 1) : 1;

  g_rtc_magic = kRtcMagic;
  g_rtc_write_crash_stage = STAGE_IDLE;
  g_rtc_reset_count = out.reset_count_since_power_on;
  return out;
}

// Called at each real milestone of the HTTP write handoff path (Phase 3's
// mailbox consumer). A plain SRAM store -- no flash access, negligible
// cost, safe to call from either the httpd task or the main loop (each
// call is a single aligned uint8_t store; this project accepts the
// theoretical torn-read risk of an extremely rare concurrent read during
// a future crash's own forensic dump, since the alternative -- gating
// this with the same atomic machinery as the write mailboxes -- would
// add real complexity for a value that is diagnostic-only and never
// itself gates a safety decision).
inline void mark_write_crash_stage(WriteCrashStage stage) { g_rtc_write_crash_stage = static_cast<uint8_t>(stage); }

}  // namespace jk_diag

#endif  // USE_ESP32
