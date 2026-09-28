// Firmware-stack harness for components/jk_diag_probe/jk_diag_probe_core.h.
//
// Mirrors every YAML-facing entry point of jk_bms_probe.yaml as one
// non-inlined function, so the compiler's per-function stack usage
// (-fstack-usage) and -Wframe-larger-than measure what the ESP32 loopTask
// (8 KB stack) actually has to hold. It is compiled only, never run.
//
// Background (2026-09-27): Probe::begin() used `*this = Probe();`, a ~32 KB
// temporary on the loopTask stack as the first statement of on_boot; the
// image crashed on every boot and ESPHome rolled the OTA back. Host unit
// tests run on an 8 MB stack and could not see it.
//
// The ESPHome-side modbus/logger types are not available on the host; the
// wrappers take the same plain arguments the YAML lambdas pass.

#include "jk_diag_probe_core.h"

using namespace jk_diag_probe;

#define ENTRY extern "C" __attribute__((noinline))

// esphome: on_boot lambda.
ENTRY void yaml_on_boot(uint32_t now_ms) {
  g_probe.begin(Mode::A_COMPATIBILITY, now_ms, 20000UL, 0UL);
  char line[160];
  format_run(line, sizeof(line), g_probe);
  __asm__ volatile("" : : "r"(line) : "memory");
}

// esphome: on_boot lambda's add_on_command_sent_callback body.
ENTRY void yaml_command_sent(uint32_t now_ms, int function_code, int address) {
  g_probe.on_frame_sent(now_ms, uint8_t(function_code), uint16_t(address));
}

// logger: on_message lambda (WARN).
ENTRY void yaml_logger_on_message(uint32_t now_ms, const char *message) {
  uint8_t fc = 0, exc = 0;
  uint16_t addr = 0;
  if (!parse_modbus_error_line(message, fc, addr, exc)) return;
  const Terminal t = g_probe.on_exception(now_ms, fc, addr, exc);
  if (t.valid) g_log_queue.push(t);
}

// create_read_command data callback.
ENTRY void yaml_response(uint32_t now_ms, int idx, uint32_t gen, const uint8_t *data, std::size_t size, uint32_t callback_us) {
  const Terminal t = g_probe.on_response(now_ms, idx, gen, data, size, 0);
  g_probe.note_callback_us(idx, callback_us);
  if (!t.valid) return;
  if (g_probe.mode() == Mode::A_COMPATIBILITY || t.outcome != Outcome::OK) g_log_queue.push(t);
}

// interval: 10ms lambda, without the ESPHome queue_command call (its
// frame belongs to ESPHome; the probe side is find_allowed + generation).
ENTRY int yaml_interval(uint32_t now) {
  static std::size_t summary_line = 0;
  char line[400];
  int written = 0;
  Terminal queued;
  while (g_log_queue.pop(queued)) written += format_terminal(line, sizeof(line), queued);
  Terminal timed_out;
  const int idx = g_probe.poll(now, timed_out);
  if (timed_out.valid) written += format_terminal(line, sizeof(line), timed_out);
  if (idx >= 0) {
    const Request &r = kRequests[idx];
    if (find_allowed(r.function, r.address, r.count) != idx) return -1;
    written += int(g_probe.generation());
  }
  if (!g_probe.finished() && g_probe.mode() != Mode::A_COMPATIBILITY) {
    for (std::size_t i = 0; i < kWideCount; i++) written += format_request_stats(line, sizeof(line), g_probe, i);
  }
  if (g_probe.finished() && g_log_queue.empty() && summary_line < kSummaryLineCount) {
    written += format_summary_line(line, sizeof(line), g_probe, summary_line, g_log_queue.dropped());
    summary_line++;
  }
  __asm__ volatile("" : : "r"(line) : "memory");
  return written;
}

// The final-summary cursor on its own (each of its 46 lines, any order).
ENTRY int yaml_summary_line(std::size_t n) {
  char line[400];
  const int w = format_summary_line(line, sizeof(line), g_probe, n, g_log_queue.dropped());
  __asm__ volatile("" : : "r"(line) : "memory");
  return w;
}
