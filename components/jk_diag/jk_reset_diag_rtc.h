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

#include <atomic>
#include <cstdint>

#include "esp_attr.h"
#include "esp_system.h"

#include "jk_reset_diag_core.h"

namespace jk_diag {

RTC_NOINIT_ATTR uint32_t g_rtc_magic;
// Second corrective pass (2026-09-21): a plain, non-atomic uint8_t here
// was flagged as a genuine cross-task data race -- mark_write_crash_stage()
// is called from BOTH the httpd task (RegisterWriteHandler) and the main
// loop, so two different FreeRTOS tasks really can write this concurrently
// (e.g. a NEW request's HANDLER_ENTERED landing on the httpd task at the
// same instant the main loop is still finishing a PRIOR request's own
// terminal marker write) -- "an aligned uint8_t store" is not a
// synchronization argument in C++, it merely happens to not tear on this
// specific architecture, which is not the same thing as being race-free
// or free of UB under [intro.races]. std::atomic<uint8_t> is trivially
// copyable/standard-layout and lock-free on every ESP32 target this
// project builds for (Xtensa and RISC-V single-byte loads/stores are
// natively atomic), so placing it in RTC_NOINIT_ATTR storage is exactly
// as valid as the plain uint8_t it replaces -- same section, same size,
// now with real atomicity instead of an implicit, unstated assumption.
RTC_NOINIT_ATTR std::atomic<uint8_t> g_rtc_write_crash_stage;
// Resets-since-power-on counter, NOT a true persistent-across-power-
// cycles boot count: RTC_NOINIT_ATTR memory does not survive a genuine
// power-on/brownout (see the module comment above), so this counter
// itself resets to 1 whenever power was actually lost. Kept in RTC SRAM
// only -- zero flash writes, zero flash wear, by construction. Written
// only once per boot, from a single task (on_boot, priority -100, before
// the write-registry handlers/main-loop consumer are ever reachable) --
// genuinely single-threaded at every access, so plain uint32_t (not
// atomic) remains correct here, unlike the crash-stage marker above.
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
  out.last_write_crash_stage = out.rtc_trustworthy ? g_rtc_write_crash_stage.load(std::memory_order_relaxed) : STAGE_IDLE;
  // Second corrective pass (2026-09-21): previously gated ONLY on
  // magic_ok, which wrongly incremented the counter for a reset type RTC
  // memory does NOT actually survive (POWERON/BROWNOUT/PWR_GLITCH) if the
  // magic word merely happened to still read back correctly by chance
  // (uninitialized RTC SRAM after certain glitch conditions can retain
  // its previous contents even though the hardware gives no guarantee it
  // will) -- see test/jk_diag/test_jk_reset_diag_core.cpp's new
  // POWERON/BROWNOUT/PWR_GLITCH-with-accidentally-preserved-magic cases.
  // Fail closed: the counter only ever continues a genuine prior session
  // when BOTH the magic matches AND this exact reset reason is one RTC
  // memory is documented to survive -- i.e. exactly `rtc_trustworthy`,
  // never `magic_ok` alone.
  out.reset_count_since_power_on = compute_reset_count_since_power_on(out.rtc_trustworthy, g_rtc_reset_count);

  g_rtc_magic = kRtcMagic;
  g_rtc_write_crash_stage.store(STAGE_IDLE, std::memory_order_relaxed);
  g_rtc_reset_count = out.reset_count_since_power_on;
  return out;
}

// Called at each real milestone of the HTTP write handoff path (Phase 3's
// mailbox consumer). Genuinely called from two different FreeRTOS tasks
// (the httpd task via RegisterWriteHandler, and the main loop via the
// 100ms write consumer) -- a real std::atomic store (not merely "an
// aligned uint8_t", see g_rtc_write_crash_stage's own declaration comment
// above) is what actually makes this race-free under the C++ memory
// model, not an informal argument about torn reads.
inline void mark_write_crash_stage(WriteCrashStage stage) {
  g_rtc_write_crash_stage.store(static_cast<uint8_t>(stage), std::memory_order_relaxed);
}

}  // namespace jk_diag

#endif  // USE_ESP32
