// Host tests for components/jk_diag_probe/jk_diag_probe_core.h -- the
// read-only clustered-read measurement build (migration plan step M0).
//
//   g++ -std=c++17 -Wall -Wextra -I ../../components/jk_diag_probe -I ../../components/jk_capability \
//       test_jk_diag_probe_core.cpp -o t && ./t

#include "jk_diag_probe_core.h"

#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

using namespace jk_diag_probe;

namespace {
int g_checks = 0, g_failures = 0;
void check(bool cond, const std::string &desc) {
  g_checks++;
  if (!cond) { g_failures++; std::printf("FAIL: %s\n", desc.c_str()); }
}
std::string fmt_terminal(const Terminal &t) { char b[256]; format_terminal(b, sizeof(b), t); return b; }

// Drives a probe with a scripted "bus": every issued request answers after
// `latency_ms` with the expected length (or a scripted override).
struct Harness {
  Probe p;
  uint32_t now = 0;
  std::vector<int> issued;
  std::vector<uint32_t> issued_at;
  std::vector<Terminal> terminals;
  int answer_bytes_override = -1;  // -1: expected length
  bool answer = true;
  uint32_t latency_ms = 80;
  uint8_t fill = 0x11;
  void run_until(uint32_t until_ms, uint32_t step_ms = 10) {
    int pending = -1; uint32_t pending_gen = 0; uint32_t reply_at = 0;
    while (now <= until_ms) {
      Terminal to;
      const int idx = p.poll(now, to);
      if (to.valid) { terminals.push_back(to); pending = -1; }
      if (idx >= 0) {
        issued.push_back(idx); issued_at.push_back(now);
        p.on_frame_sent(now + 5, kRequests[idx].function, kRequests[idx].address);
        pending = idx; pending_gen = p.generation(); reply_at = now + latency_ms;
      }
      if (pending >= 0 && answer && now >= reply_at) {
        const std::size_t n = answer_bytes_override >= 0 ? std::size_t(answer_bytes_override) : kRequests[pending].expected_bytes;
        std::vector<uint8_t> data(n + 4, fill);
        const Terminal t = p.on_response(now, pending, pending_gen, data.data(), n, 120);
        if (t.valid) terminals.push_back(t);
        pending = -1;
      }
      now += step_ms;
    }
  }
};
// Drives any probe (including the static ones below) through a scripted bus
// that exercises every state field: retries (resends), exceptions, timeouts,
// late responses from an older generation, payloads and callback timing.
// `rough` = mixed outcomes; otherwise every request is answered on time.
// `stop`: 0 = run to until_ms; 1 = stop right after request `stop_index` is
// issued (its follow-up still pending); 2 = stop right after an exception.
void drive(Probe &p, uint32_t from_ms, uint32_t until_ms, bool rough, std::string *log = nullptr, int stop = 0, int stop_index = -1) {
  int pending = -1; uint32_t pending_gen = 0, reply_at = 0, n_issued = 0;
  int stale = -1; uint32_t stale_gen = 0;
  char b[512];
  for (uint32_t now = from_ms; now <= until_ms; now += 10) {
    Terminal to;
    const int idx = p.poll(now, to);
    if (to.valid) { pending = -1; if (log) { format_terminal(b, sizeof(b), to); *log += b; } }
    if (idx >= 0) {
      const Request &r = kRequests[idx];
      p.on_frame_sent(now + 2, r.function, r.address);
      if (rough && n_issued % 3 == 0) p.on_frame_sent(now + 40, r.function, r.address);  // a hub retry
      if (stale >= 0) p.on_response(now, stale, stale_gen, nullptr, 0, 5);  // late answer, older generation
      stale = idx; stale_gen = p.generation();
      pending = idx; pending_gen = p.generation(); reply_at = now + 60;
      n_issued++;
      if (stop == 1 && idx == stop_index) return;
    }
    if (pending >= 0 && now >= reply_at) {
      const Request &r = kRequests[pending];
      const uint32_t kind = rough ? (n_issued % 5) : 2;
      Terminal t;
      if (kind == 0) {
        char line[96];
        std::snprintf(line, sizeof(line), "Modbus error function code: 0x%X register 0x%X exception: %d", r.function, r.address, 2);
        uint8_t fc = 0, exc = 0; uint16_t addr = 0;
        if (parse_modbus_error_line(line, fc, addr, exc)) t = p.on_exception(now, fc, addr, exc);
        if (stop == 2 && t.valid) return;
      } else if (kind == 1) {
        continue;  // no answer: the poll() timeout resolves it
      } else {
        std::vector<uint8_t> data(r.expected_bytes, uint8_t(0x30 + pending));
        t = p.on_response(now, pending, pending_gen, data.data(), kind == 3 ? r.expected_bytes - 2 : r.expected_bytes, 0);
        p.note_callback_us(pending, 40 + pending);
      }
      if (t.valid && log) { format_terminal(b, sizeof(b), t); *log += b; }
      pending = -1;
    }
  }
}
std::string render(const Probe &p) {
  std::string all;
  char b[512];
  format_run(b, sizeof(b), p); all += b;
  for (std::size_t i = 0; i < kRequestCount; i++) { format_request_stats(b, sizeof(b), p, i); all += b; }
  for (std::size_t c = 0; c < kComparisonCount; c++) { format_comparison(b, sizeof(b), p, c); all += b; }
  for (std::size_t s = 0; s < kSummaryCount; s++) { format_summary(b, sizeof(b), p, s); all += b; }
  return all;
}

// Static storage, like g_probe on the device (and far too large for a
// firmware stack -- which is the point of this section).
Probe g_fresh, g_dirty;
Probe g_dirty_states[5];
}  // namespace

int main() {
  // 1. The allowlist: every wide read, exact geometry and length.
  struct W { const char *id; uint16_t a, n, b; };
  const W wide[] = {{"A1", 0x1200, 125, 250}, {"A2", 0x12FA, 10, 20}, {"C1", 0x1000, 124, 248}, {"C2", 0x10F8, 19, 38},
                    {"S1", 0x1400, 20, 40}, {"S2", 0x14B2, 18, 36}, {"S3", 0x14E4, 18, 36}};
  check(kWideCount == 7, "exactly 7 wide reads");
  for (std::size_t i = 0; i < 7; i++) {
    const Request &r = kRequests[i];
    check(std::strcmp(r.id, wide[i].id) == 0 && r.address == wide[i].a && r.count == wide[i].n && r.expected_bytes == wide[i].b &&
              r.function == 0x03 && r.kind == Kind::WIDE,
          std::string("wide ") + wide[i].id + " geometry and expected length");
    check(find_allowed(0x03, wide[i].a, wide[i].n) == int(i), std::string("wide ") + wide[i].id + " is allowed");
  }
  check(find_allowed(0x03, 0x1000, 125) < 0 && find_allowed(0x03, 0x10FA, 18) < 0, "the old C1/C2 split (cuts 0x10F8) is not allowed");
  bool all_fc3 = true, none_credential = true, lengths = true;
  for (std::size_t i = 0; i < kRequestCount; i++) {
    all_fc3 &= kRequests[i].function == 0x03;
    none_credential &= !overlaps_credential(kRequests[i].address, kRequests[i].count);
    lengths &= kRequests[i].expected_bytes == 2 * kRequests[i].count && kRequests[i].count <= 125;
  }
  check(all_fc3 && none_credential && lengths, "every allowlisted read is FC03, <= 125 registers, 2 bytes/register, outside 0x1470-0x147F");

  // 2. Credential range and arbitrary requests are rejected.
  check(find_allowed(0x03, 0x1470, 8) < 0, "0x1470 x 8 (setup passcode) is rejected");
  check(!request_is_valid(Request{"P", Kind::WIDE, 0x03, 0x1470, 8, 16}) && !request_is_valid(Request{"X", Kind::WIDE, 0x03, 0x1460, 9, 18}),
        "a request touching 0x1470-0x147F is never valid, even if it were listed");
  check(!request_is_valid(Request{"W", Kind::WIDE, 0x10, 0x1114, 1, 2}) && !request_is_valid(Request{"L", Kind::WIDE, 0x03, 0x1200, 126, 252}) &&
            !request_is_valid(Request{"B", Kind::WIDE, 0x03, 0x1200, 10, 21}),
        "a write function, > 125 registers or a wrong expected length is never valid");
  check(overlaps_credential(0x1470, 8) && overlaps_credential(0x1460, 9) && overlaps_credential(0x147E, 1) &&
            !overlaps_credential(0x1460, 8) && !overlaps_credential(0x1480, 1),
        "credential overlap uses byte-address ranges (0x1470-0x147F)");
  bool non_fc3_rejected = true;
  for (uint8_t fc : {0x01, 0x02, 0x04, 0x05, 0x06, 0x0F, 0x10, 0x17, 0x2B}) non_fc3_rejected &= find_allowed(fc, 0x1200, 125) < 0;
  check(non_fc3_rejected, "any non-FC03 function (incl. writes 0x05/0x06/0x0F/0x10) is rejected");
  check(find_allowed(0x03, 0x1200, 124) < 0 && find_allowed(0x03, 0x1201, 125) < 0 && find_allowed(0x03, 0x2000, 1) < 0 &&
            find_allowed(0x03, 0x1200, 126) < 0 && find_allowed(0x03, 0x0000, 0) < 0,
        "arbitrary address/count combinations are rejected");

  // 3. Length classification.
  check(classify_length(250, 250) == Outcome::OK, "exact length is OK");
  check(classify_length(250, 249) == Outcome::SHORT && classify_length(250, 0) == Outcome::SHORT, "short responses are SHORT");
  check(classify_length(250, 251) == Outcome::LONG && classify_length(20, 250) == Outcome::LONG, "oversized responses are LONG");

  // 4. Exception log parsing (ModbusCommandItem::on_error text).
  uint8_t fc = 0, exc = 0; uint16_t addr = 0;
  check(parse_modbus_error_line("Modbus error function code: 0x3 register 0x1200 exception: 2", fc, addr, exc) && fc == 3 && addr == 0x1200 &&
            exc == 2,
        "the modbus_controller exception line is parsed");
  check(!parse_modbus_error_line("Modbus error function code: 0x3 register 0x1200", fc, addr, exc) &&
            !parse_modbus_error_line("something else", fc, addr, exc) && !parse_modbus_error_line(nullptr, fc, addr, exc),
        "anything else is not an exception");

  // 5. Mode A: one bounded pass over every request, in order, then FINISHED.
  {
    Harness h;
    h.p.begin(Mode::A_COMPATIBILITY, 0, 1000, 0);
    h.run_until(10UL * 60UL * 1000UL);
    check(h.issued.size() == kRequestCount, "mode A issues every allowlisted read exactly once (" + std::to_string(h.issued.size()) + ")");
    bool in_order = true;
    for (std::size_t i = 0; i < h.issued.size(); i++) in_order &= h.issued[i] == int(i);
    check(in_order, "mode A order: wide reads first, then narrow");
    check(h.p.finished(), "mode A latches FINISHED after the pass");
    bool spaced = true;
    for (std::size_t i = 1; i < h.issued_at.size(); i++) spaced &= h.issued_at[i] - h.issued_at[i - 1] >= kPassSpacingMs;
    check(spaced, "mode A keeps >= 1 s between requests");
    // Evidence: comparisons (identical fill => all equal) and summaries.
    bool cmp_ok = true;
    for (std::size_t c = 0; c < kComparisonCount; c++) cmp_ok &= h.p.comparison_equal_words(c) == int(kComparisons[c].word_count);
    check(cmp_ok, "every narrow/wide comparison is computed after a full pass");
    int zero = 0, total = 0;
    h.p.summary_zero_words(0, zero, total);
    check(total == 16 && zero == 0, "A1 inactive-voltage summary counts 16 words (non-zero fill)");
    Terminal to;
    const uint32_t before = h.p.total_issued();
    bool none = true;
    for (uint32_t t = h.now; t < h.now + 60000; t += 10) none &= h.p.poll(t, to) < 0;
    check(none && h.p.total_issued() == before, "no request is ever issued after FINISHED");
  }

  // 6. Mode B: A1 then A2 at 1 Hz, bounded to the mode default.
  {
    Harness h;
    h.p.begin(Mode::B_TELEMETRY_SOAK, 0, 0, 0);
    h.run_until(default_run_ms(Mode::B_TELEMETRY_SOAK) + 30000);
    check(h.p.run_ms() == 600000, "mode B default run is 10 min");
    bool only_telemetry = true;
    for (int i : h.issued) only_telemetry &= (i == index_of("A1") || i == index_of("A2"));
    check(only_telemetry, "mode B reads only A1/A2");
    const auto &a1 = h.p.stats(index_of("A1"));
    check(a1.issued >= 598 && a1.issued <= 601, "mode B reads A1 once per second (" + std::to_string(a1.issued) + ")");
    check(a1.outcomes[0] == a1.issued && a1.bms_ms.n == a1.issued && a1.bms_ms.percentile(0.99) <= 90,
          "mode B latency statistics aggregate every OK read");
    check(a1.ok_interval.missed == 0 && a1.ok_interval.max <= 1010, "mode B healthy run: no missed telemetry cycle");
    check(h.p.finished() && h.issued_at.back() < 600000, "mode B stops at its deadline");
  }

  // 7. Mode C: telemetry 1 Hz + Settings every 3 s, staggered; 30 min hard cap.
  {
    Harness h;
    h.p.begin(Mode::C_COEXISTENCE, 0, 0, 25UL * 60UL * 1000UL);
    h.run_until(26UL * 60UL * 1000UL);
    const auto &c1 = h.p.stats(index_of("C1"));
    const auto &a1 = h.p.stats(index_of("A1"));
    check(h.p.run_ms() == 1500000, "mode C honours a 25 min request");
    check(c1.issued >= 498 && c1.issued <= 501 && a1.issued >= 1498, "mode C: C1 every 3 s, A1 every 1 s");
    bool staggered = true;
    for (std::size_t i = 0; i < h.issued.size(); i++)
      if (h.issued[i] == index_of("C1")) staggered &= (h.issued_at[i] % 1000) >= kSettingsPhaseMs;
    check(staggered, "mode C releases Settings mid-cycle, not with telemetry");
    check(a1.ok_interval.missed == 0, "mode C: Settings never makes telemetry miss a cycle at 80 ms latency");
    check(effective_run_ms(Mode::C_COEXISTENCE, 90UL * 60UL * 1000UL) == kHardMaxRunMs && effective_run_ms(Mode::B_TELEMETRY_SOAK, 0) == 600000 &&
              effective_run_ms(Mode::A_COMPATIBILITY, 0) == 300000,
          "run length: 0 = mode default; anything above 30 min is clamped to 30 min");
    Harness big;
    big.p.begin(Mode::C_COEXISTENCE, 0, 0, 0xFFFFFFFFu);
    big.run_until(31UL * 60UL * 1000UL, 50);
    check(big.p.finished() && !big.issued_at.empty() && big.issued_at.back() < kHardMaxRunMs && big.issued_at.back() > 29UL * 60UL * 1000UL,
          "an over-long request runs to, and ends by, the 30 min hard maximum");
  }

  // 8. Timeout, exception, short/long responses and late replies.
  {
    Harness h;
    h.answer = false;
    h.p.begin(Mode::A_COMPATIBILITY, 0, 0, 0);
    h.run_until(4000);
    check(!h.terminals.empty() && h.terminals[0].outcome == Outcome::TIMEOUT && h.terminals[0].request == 0,
          "no reply within 3 s is TIMEOUT");
    check(h.p.stats(0).outcomes[4] == 1, "timeouts are counted");
  }
  {
    Probe p;
    p.begin(Mode::A_COMPATIBILITY, 0, 0, 0);
    Terminal to;
    const int idx = p.poll(0, to);
    p.on_frame_sent(3, 0x03, kRequests[idx].address);
    const Terminal t = p.on_exception(90, 0x03, kRequests[idx].address, 2);
    check(t.valid && t.outcome == Outcome::EXCEPTION && t.exception == 2 && p.outstanding() < 0, "an exception line ends the request as EXCEPTION");
    check(!p.on_exception(95, 0x03, 0x1234, 2).valid, "an exception for another address is ignored");
    const Terminal late = p.on_response(100, idx, p.generation(), nullptr, 250, 10);
    check(!late.valid && p.stats(idx).late == 1, "a response after the terminal is counted late and ignored");
  }
  {
    Harness h;
    h.answer_bytes_override = 248;
    h.p.begin(Mode::A_COMPATIBILITY, 0, 0, 0);
    h.run_until(200);
    check(!h.terminals.empty() && h.terminals[0].outcome == Outcome::SHORT && h.terminals[0].got_bytes == 248, "a short A1 response is SHORT");
    check(h.p.comparison_equal_words(0) == -1, "a SHORT response never becomes comparison evidence");
    Harness l;
    l.answer_bytes_override = 252;
    l.p.begin(Mode::A_COMPATIBILITY, 0, 0, 0);
    l.run_until(200);
    check(!l.terminals.empty() && l.terminals[0].outcome == Outcome::LONG, "an oversized A1 response is LONG");
  }

  // 8b. A late reply from a timed-out earlier attempt of the SAME request is
  //     never credited to the newer attempt (generation check).
  {
    Probe p;
    p.begin(Mode::B_TELEMETRY_SOAK, 0, 0, 0);
    Terminal to;
    const int a1 = p.poll(0, to);
    const uint32_t old_gen = p.generation();
    const int none = p.poll(kRequestTimeoutMs + 1, to);  // A1 times out
    check(a1 == index_of("A1") && none == index_of("A2") && to.valid && to.outcome == Outcome::TIMEOUT, "first A1 attempt times out");
    // Finish A2, then the next cycle issues A1 again.
    std::vector<uint8_t> buf(250, 0);
    p.on_response(kRequestTimeoutMs + 50, index_of("A2"), p.generation(), buf.data(), 20, 5);
    int again = -1;
    for (uint32_t t = kRequestTimeoutMs + 60; t < kRequestTimeoutMs + 3000 && again < 0; t += 10) again = p.poll(t, to);
    check(again == index_of("A1") && p.generation() != old_gen, "A1 is issued again under a new generation");
    const Terminal stale = p.on_response(kRequestTimeoutMs + 3100, index_of("A1"), old_gen, buf.data(), 250, 5);
    check(!stale.valid && p.outstanding() == index_of("A1") && p.stats(index_of("A1")).late == 1,
          "the old attempt's late reply is counted late and does not complete the new attempt");
  }

  // 9. Log lines are metadata only: a sentinel payload never appears.
  {
    Probe p;
    p.begin(Mode::A_COMPATIBILITY, 0, 0, 0);
    Terminal to;
    const int idx = p.poll(0, to);
    p.on_frame_sent(4, 0x03, kRequests[idx].address);
    std::vector<uint8_t> sentinel(250, 0);
    const char *marker = "SENTINEL-PASSCODE-9";
    for (std::size_t i = 0; i < sentinel.size(); i++) sentinel[i] = uint8_t(marker[i % std::strlen(marker)]);
    const Terminal t = p.on_response(90, idx, p.generation(), sentinel.data(), 250, 42);
    std::string all = fmt_terminal(t);
    char b[512];
    for (std::size_t i = 0; i < kRequestCount; i++) { format_request_stats(b, sizeof(b), p, i); all += b; }
    for (std::size_t c = 0; c < kComparisonCount; c++) { format_comparison(b, sizeof(b), p, c); all += b; }
    for (std::size_t s = 0; s < kSummaryCount; s++) { format_summary(b, sizeof(b), p, s); all += b; }
    format_run(b, sizeof(b), p); all += b;
    check(all.find("SENTINEL") == std::string::npos && all.find("PASSCODE") == std::string::npos, "no payload byte reaches any log line");
    check(fmt_terminal(t).find("req=A1 fc=3 addr=0x1200 n=125 exp=250 got=250 cls=OK") != std::string::npos,
          "the result line reports request identity, expected/actual length and class");
  }

  // 10. Log queue (exception records from the logger callback) and callback timing.
  {
    LogQueue q;
    Terminal t; t.valid = true; t.request = 0;
    bool pushed = true;
    for (std::size_t i = 0; i < LogQueue::kCapacity; i++) pushed &= q.push(t);
    check(pushed && !q.push(t) && q.dropped() == 1, "the log queue is bounded and counts drops");
    Terminal out; std::size_t popped = 0;
    while (q.pop(out)) popped++;
    check(popped == LogQueue::kCapacity && !q.pop(out), "the log queue drains in order and then is empty");
    Probe p;
    p.note_callback_us(0, 250);
    p.note_callback_us(0, 90);
    check(p.stats(0).callback_us_max == 250, "the callback processing time keeps its maximum");
    check(sizeof(Probe) < 40 * 1024, "probe state fits the ESP32 static-RAM budget (" + std::to_string(sizeof(Probe)) + " bytes)");
  }

  // 11. begin() resets in place (2026-09-27: `*this = Probe();` put a ~32 KB
  // temporary on the 8 KB ESP32 loopTask stack; the image crashed on every
  // boot). The in-place reset must restore exactly the default state: a
  // probe dirtied by a mode-C run with retries, exceptions, timeouts, late
  // answers and payloads, then begun, must equal a never-used probe begun
  // the same way -- byte for byte (both are static objects whose padding was
  // zero-initialised and is never written by the run; any difference is a
  // field reset() forgot) and in every rendered line of a later run.
  {
    g_dirty.begin(Mode::C_COEXISTENCE, 0, 0, 0);
    drive(g_dirty, 0, 45000, true);
    const Probe &d = g_dirty;
    bool dirty = d.total_issued() > 30 && d.stats(0).issued > 0 && d.stats(0).resends > 0 &&
                 d.comparison_equal_words(0) != 0;
    std::size_t exc = 0, to = 0, late = 0, ok = 0;
    for (std::size_t i = 0; i < kRequestCount; i++) {
      exc += d.stats(i).outcomes[std::size_t(Outcome::EXCEPTION)];
      to += d.stats(i).outcomes[std::size_t(Outcome::TIMEOUT)];
      late += d.stats(i).late;
      ok += d.stats(i).ok_interval.n;
    }
    check(dirty && exc > 0 && to > 0 && late > 0 && ok > 0,
          "reset: the dirty run touched retries, exceptions, timeouts, late answers, intervals and payloads");
    // Transient fields are only non-default at particular moments: stop other
    // used probes exactly there (pending A2 / C2 follow-up, a just-recorded
    // exception, a finished run, a partial gate A pass).
    const char *names[5] = {"A1 issued (A2 pending)", "C1 issued (C2 pending)", "right after an exception",
                            "a finished run", "a partial gate A pass"};
    g_dirty_states[0].begin(Mode::C_COEXISTENCE, 0, 0, 0); drive(g_dirty_states[0], 0, 45000, true, nullptr, 1, index_of("A1"));
    g_dirty_states[1].begin(Mode::C_COEXISTENCE, 0, 0, 0); drive(g_dirty_states[1], 0, 45000, true, nullptr, 1, index_of("C1"));
    g_dirty_states[2].begin(Mode::C_COEXISTENCE, 0, 0, 0); drive(g_dirty_states[2], 0, 45000, true, nullptr, 2);
    g_dirty_states[3].begin(Mode::B_TELEMETRY_SOAK, 0, 0, 20000); drive(g_dirty_states[3], 0, 30000, true);
    g_dirty_states[4].begin(Mode::A_COMPATIBILITY, 0, 0, 0); drive(g_dirty_states[4], 0, 6000, true);
    check(g_dirty_states[0].outstanding() == index_of("A1") && g_dirty_states[1].outstanding() == index_of("C1") &&
          g_dirty_states[3].finished() && g_dirty_states[4].total_issued() > 0 && !g_dirty_states[4].finished(),
          "reset: the used probes stopped in their transient states");
    g_fresh.begin(Mode::A_COMPATIBILITY, 1000, 20000, 0);
    g_dirty.begin(Mode::A_COMPATIBILITY, 1000, 20000, 0);
    check(std::memcmp(&g_fresh, &g_dirty, sizeof(Probe)) == 0, "reset: begin() on a used probe restores the exact default state (byte-equal)");
    for (int i = 0; i < 5; i++) {
      g_dirty_states[i].begin(Mode::A_COMPATIBILITY, 1000, 20000, 0);
      check(std::memcmp(&g_fresh, &g_dirty_states[i], sizeof(Probe)) == 0, std::string("reset: byte-equal default state after ") + names[i]);
    }
    std::string log_fresh, log_dirty;
    drive(g_fresh, 1000, 90000, false, &log_fresh);
    drive(g_dirty, 1000, 90000, false, &log_dirty);
    check(g_fresh.finished() && g_dirty.finished() && log_fresh == log_dirty && render(g_fresh) == render(g_dirty) &&
          render(g_dirty).find("finished=1") != std::string::npos,
          "reset: a gate A run after the reset logs exactly what a never-used probe logs");
  }

  std::printf("diag probe core: %d/%d checks passed\n", g_checks - g_failures, g_checks);
  return g_failures == 0 ? 0 : 1;
}
