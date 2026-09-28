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
std::string fmt_terminal(const Terminal &t) { char b[400]; format_terminal(b, sizeof(b), t); return b; }

// Drives a probe with a scripted "bus": every issued request answers after
// `latency_ms` with the expected length (or a scripted override). Optional:
// boundary controls refused with exception 2 (the gate A hypothesis),
// one call number left unanswered (timeout) or answered with an exception.
// `overlaps` counts any request issued while an earlier one was unresolved.
struct Harness {
  Probe p;
  uint32_t now = 0;
  std::vector<int> issued;
  std::vector<uint32_t> issued_at;
  std::vector<Terminal> terminals;
  int answer_bytes_override = -1;  // -1: expected length
  bool answer = true;
  bool boundary_exc2 = false;
  int silent_call = -1;            // 0-based issue number that gets no answer
  int exc_call = -1;               // 0-based issue number answered with exc_code
  uint8_t exc_code = 2;
  int bytes_call = -1;             // 0-based issue number answered with bytes_value data bytes
  std::size_t bytes_value = 0;
  int second_frame_call = -1;      // 0-based issue number that goes on the wire twice (a hub retry)
  uint32_t silent_until_ms = 0;    // bus outage: nothing is answered before this time
  int overlaps = 0;
  uint32_t latency_ms = 80;
  uint8_t fill = 0x11;
  void run_until(uint32_t until_ms, uint32_t step_ms = 10) {
    int pending = -1, pending_call = -1; uint32_t pending_gen = 0; uint32_t reply_at = 0;
    while (now <= until_ms) {
      Terminal to;
      const bool was_outstanding = p.outstanding() >= 0;
      const int idx = p.poll(now, to);
      if (to.valid) { terminals.push_back(to); pending = -1; }
      if (idx >= 0) {
        if (was_outstanding && !to.valid) overlaps++;
        issued.push_back(idx); issued_at.push_back(now);
        p.on_frame_sent(now + 5, kRequests[idx].function, kRequests[idx].address);
        if (int(issued.size()) - 1 == second_frame_call) p.on_frame_sent(now + 30, kRequests[idx].function, kRequests[idx].address);
        pending = idx; pending_call = int(issued.size()) - 1; pending_gen = p.generation(); reply_at = now + latency_ms;
      }
      if (pending >= 0 && answer && now >= reply_at) {
        const Request &r = kRequests[pending];
        if (pending_call == silent_call || now < silent_until_ms) {
          // no answer: the poll() timeout resolves it
        } else if (pending_call == exc_call || (boundary_exc2 && r.kind == Kind::BOUNDARY)) {
          char line[96];
          std::snprintf(line, sizeof(line), "Modbus error function code: 0x%X register 0x%X exception: %d", r.function, r.address,
                        pending_call == exc_call ? exc_code : 2);
          uint8_t fc = 0, exc = 0; uint16_t addr = 0;
          if (parse_modbus_error_line(line, fc, addr, exc)) {
            const Terminal t = p.on_exception(now, fc, addr, exc);
            if (t.valid) terminals.push_back(t);
          }
          pending = -1;
        } else {
          const std::size_t n = pending_call == bytes_call ? bytes_value
                                : answer_bytes_override >= 0 ? std::size_t(answer_bytes_override) : r.expected_bytes;
          std::vector<uint8_t> data(n + 4, fill);
          const Terminal t = p.on_response(now, pending, pending_gen, data.data(), n, 120);
          if (t.valid) terminals.push_back(t);
          pending = -1;
        }
      }
      now += step_ms;
    }
  }
};
std::string summary_text(const Probe &p) {
  std::string all;
  char b[400];
  for (std::size_t i = 0; i < kSummaryLineCount; i++) { format_summary_line(b, sizeof(b), p, i, 0); all += b; all += "\n"; }
  return all;
}
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
Probe g_dirty_states[6];
}  // namespace

int main() {
  // 1. The allowlist: exact geometry, length and expectation of all 25 reads.
  struct W { const char *id; Kind k; uint16_t a, n, b; Expect e; };
  const W top[] = {{"A1", Kind::WIDE, 0x1200, 120, 240, Expect::OK},       {"A2", Kind::WIDE, 0x12F0, 15, 30, Expect::OK},
                   {"C1", Kind::WIDE, 0x1000, 120, 240, Expect::OK},       {"C2", Kind::WIDE, 0x10F0, 23, 46, Expect::OK},
                   {"S1", Kind::WIDE, 0x1400, 20, 40, Expect::OK},         {"S2", Kind::WIDE, 0x14B2, 18, 36, Expect::OK},
                   {"S3", Kind::WIDE, 0x14E4, 18, 36, Expect::OK},
                   {"A121", Kind::BOUNDARY, 0x1200, 121, 242, Expect::EXCEPTION_2},
                   {"A121W", Kind::BOUNDARY, 0x1202, 121, 242, Expect::EXCEPTION_2},
                   {"C121", Kind::BOUNDARY, 0x1000, 121, 242, Expect::EXCEPTION_2},
                   {"C121W", Kind::BOUNDARY, 0x1024, 121, 242, Expect::EXCEPTION_2}};
  check(kWideCount == 7 && kBoundaryCount == 4 && kRequestCount == 25, "25 allowlisted reads: 7 clusters, 4 boundary controls, 14 narrow");
  for (std::size_t i = 0; i < 11; i++) {
    const Request &r = kRequests[i];
    check(std::strcmp(r.id, top[i].id) == 0 && r.kind == top[i].k && r.address == top[i].a && r.count == top[i].n &&
              r.expected_bytes == top[i].b && r.expect == top[i].e && r.function == 0x03,
          std::string(top[i].id) + " geometry, expected length and expected outcome");
    check(find_allowed(0x03, top[i].a, top[i].n) == int(i), std::string(top[i].id) + " is allowed");
  }
  check(find_allowed(0x03, 0x1200, 125) < 0 && find_allowed(0x03, 0x1000, 124) < 0 && find_allowed(0x03, 0x12FA, 10) < 0 &&
            find_allowed(0x03, 0x10F8, 19) < 0,
        "the 2026-09-28 refused geometry (A1 x125, C1 x124) and its old tails are no longer allowed");
  check(find_allowed(0x03, 0x1000, 125) < 0 && find_allowed(0x03, 0x10FA, 18) < 0, "the old C1/C2 split (cuts 0x10F8) is not allowed");
  check(0x1200 + 2 * 120 == 0x12F0 && 0x12F0 + 2 * 15 == 0x12FA + 2 * 10 && 0x1000 + 2 * 120 == 0x10F0 &&
            0x10F0 + 2 * 23 == 0x10F8 + 2 * 19 && 120 + 15 == 125 + 10 && 120 + 23 == 124 + 19,
        "A1+A2 and C1+C2 are contiguous and cover exactly the old spans (135 and 143 words)");
  check(0x1202 >= 0x1200 && 0x1202 + 2 * 121 <= 0x12F0 + 2 * 15 && 0x1024 >= 0x1000 && 0x1024 + 2 * 121 <= 0x10F0 + 2 * 23,
        "every word of A121W / C121W lies inside A1 u A2 / C1 u C2 (independently readable if the clusters are)");
  check(kMaxRegistersPerRead == 125 && kOperationalMaxRegisters == 120 && request_is_valid(kRequests[index_of("A121")]),
        "the protocol limit stays 125 (x121 controls are legal); 120 is the operational maximum, not a protocol limit");
  bool all_fc3 = true, none_credential = true, lengths = true;
  for (std::size_t i = 0; i < kRequestCount; i++) {
    all_fc3 &= kRequests[i].function == 0x03;
    none_credential &= !overlaps_credential(kRequests[i].address, kRequests[i].count);
    lengths &= kRequests[i].expected_bytes == 2 * kRequests[i].count && kRequests[i].count <= 125;
  }
  check(all_fc3 && none_credential && lengths, "every allowlisted read is FC03, <= 125 registers, 2 bytes/register, outside 0x1470-0x147F");

  // 2. Credential range and arbitrary requests are rejected.
  check(find_allowed(0x03, 0x1470, 8) < 0, "0x1470 x 8 (setup passcode) is rejected");
  check(!request_is_valid(Request{"P", Kind::WIDE, 0x03, 0x1470, 8, 16, Expect::OK}) &&
            !request_is_valid(Request{"X", Kind::WIDE, 0x03, 0x1460, 9, 18, Expect::OK}),
        "a request touching 0x1470-0x147F is never valid, even if it were listed");
  check(!request_is_valid(Request{"W", Kind::WIDE, 0x10, 0x1114, 1, 2, Expect::OK}) &&
            !request_is_valid(Request{"L", Kind::WIDE, 0x03, 0x1200, 126, 252, Expect::OK}) &&
            !request_is_valid(Request{"B", Kind::WIDE, 0x03, 0x1200, 10, 21, Expect::OK}),
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

  // 5. Mode A: the fixed 29-step gate A schedule, then FINISHED.
  {
    const char *order[] = {"N_SLEEP", "A2",      "A1",     "A121",  "N_SLEEP", "A121W",  "N_SLEEP", "C2",    "C1",     "C121",
                           "N_SLEEP", "C121W",   "N_SLEEP", "S1",   "S2",      "S3",     "N_CELLS", "N_AVGV", "N_RES17", "N_1290",
                           "N_T4",    "N_PCL",   "N_CHG",  "N_CAL29", "N_FLAGS", "N_HEAT", "N_MODEL", "N_UART1", "N_CANVER"};
    bool table = kPassACount == 29;
    for (std::size_t i = 0; table && i < kPassACount; i++) table &= std::strcmp(kRequests[kPassA[i].request].id, order[i]) == 0;
    check(table, "the gate A schedule is exactly the approved 29 steps");
    std::size_t live = 0;
    for (const Step &st : kPassA) live += st.role == Role::LIVENESS;
    check(live == 5 && kPassA[0].role == Role::LIVENESS && kPassA[4].role == Role::LIVENESS && kPassA[6].role == Role::LIVENESS &&
              kPassA[10].role == Role::LIVENESS && kPassA[12].role == Role::LIVENESS,
          "liveness at steps 1, 5, 7, 11, 13 (first, and right after every boundary control)");
    Harness h;
    h.boundary_exc2 = true;
    h.p.begin(Mode::A_COMPATIBILITY, 0, 1000, 0);
    h.run_until(10UL * 60UL * 1000UL);
    check(h.issued.size() == kPassACount, "mode A issues the 29 steps exactly once (" + std::to_string(h.issued.size()) + ")");
    bool in_order = h.issued.size() == kPassACount;
    for (std::size_t i = 0; in_order && i < h.issued.size(); i++) in_order &= h.issued[i] == kPassA[i].request;
    check(in_order, "mode A issues the steps in schedule order");
    check(h.p.finished() && !h.p.aborted() && h.p.unexpected() == 0, "the expected outcome set: FINISHED, not aborted, 0 unexpected");
    bool steps_ok = h.terminals.size() == kPassACount;
    for (std::size_t i = 0; steps_ok && i < h.terminals.size(); i++) {
      const Terminal &t = h.terminals[i];
      const bool control = kRequests[t.request].kind == Kind::BOUNDARY;
      steps_ok &= t.step == int(i) && t.match &&
                  (control ? (t.outcome == Outcome::EXCEPTION && t.exception == 2) : t.outcome == Outcome::OK);
    }
    check(steps_ok, "every terminal carries its step; controls are EXCEPTION 2 and match, everything else OK");
    check(fmt_terminal(h.terminals[3]).find("req=A121 ") != std::string::npos &&
              fmt_terminal(h.terminals[3]).find("cls=EXCEPTION exc=2") != std::string::npos &&
              fmt_terminal(h.terminals[3]).find("step=4 expect=EXC2 match=1") != std::string::npos,
          "an expected exception is logged as step=4 expect=EXC2 match=1 (" + fmt_terminal(h.terminals[3]) + ")");
    check(h.overlaps == 0, "no request is ever issued while another is unresolved");
    bool spaced = true;
    for (std::size_t i = 1; i < h.issued_at.size(); i++) spaced &= h.issued_at[i] - h.issued_at[i - 1] >= kPassSpacingMs;
    check(spaced, "mode A keeps >= 1 s between requests");
    bool cmp_ok = true;
    for (std::size_t c = 0; c < kComparisonCount; c++) cmp_ok &= h.p.comparison_equal_words(c) == int(kComparisons[c].word_count);
    check(cmp_ok, "every narrow/wide comparison is computed after a full pass (the repeated S1-S3 included)");
    int zero = 0, total = 0;
    h.p.summary_zero_words(0, zero, total);
    check(total == 16 && zero == 0, "A1 inactive-voltage summary counts 16 words (non-zero fill)");
    bool controls_once = true;
    for (const char *id : {"A121", "A121W", "C121", "C121W"}) {
      const RequestStats &st = h.p.stats(std::size_t(index_of(id)));
      controls_once &= st.issued == 1 && st.outcomes[std::size_t(Outcome::EXCEPTION)] == 1;
    }
    bool no_control_cmp = true;
    for (const Comparison &c : kComparisons) no_control_cmp &= kRequests[c.wide].kind == Kind::WIDE && kRequests[c.narrow].kind == Kind::NARROW;
    check(controls_once && no_control_cmp && h.p.stats(std::size_t(kLivenessRequest)).issued == 5,
          "each control is issued once and refused; no comparison uses a control; liveness read 5 times");
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
    for (int i : h.issued) only_telemetry &= (i == index_of("A1") || i == index_of("A2"));  // never a control
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
    bool clusters_only = true;
    for (int i : h.issued) clusters_only &= kRequests[i].kind == Kind::WIDE;
    check(clusters_only, "mode C issues clusters only: never a boundary control or a narrow read");
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
    check(!h.terminals.empty() && h.terminals[0].outcome == Outcome::TIMEOUT && h.terminals[0].request == kLivenessRequest &&
              h.terminals[0].total_ms >= kRequestTimeoutMs && h.terminals[0].total_ms < kRequestTimeoutMs + 20,
          "no reply within the 1.5 s timeout is TIMEOUT");
    check(h.p.stats(kLivenessRequest).outcomes[4] == 1, "timeouts are counted");
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
    Harness h;  // mode B issues A1 first
    h.answer_bytes_override = 238;
    h.p.begin(Mode::B_TELEMETRY_SOAK, 0, 0, 0);
    h.run_until(200);
    check(!h.terminals.empty() && h.terminals[0].outcome == Outcome::SHORT && h.terminals[0].got_bytes == 238 && !h.terminals[0].match,
          "a short A1 response is SHORT (and unexpected)");
    check(h.p.comparison_equal_words(0) == -1, "a SHORT response never becomes comparison evidence");
    Harness l;
    l.answer_bytes_override = 242;
    l.p.begin(Mode::B_TELEMETRY_SOAK, 0, 0, 0);
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
    p.on_response(kRequestTimeoutMs + 50, index_of("A2"), p.generation(), buf.data(), 30, 5);
    int again = -1;
    for (uint32_t t = kRequestTimeoutMs + 60; t < kRequestTimeoutMs + 3000 && again < 0; t += 10) again = p.poll(t, to);
    check(again == index_of("A1") && p.generation() != old_gen, "A1 is issued again under a new generation");
    const Terminal stale = p.on_response(kRequestTimeoutMs + 3100, index_of("A1"), old_gen, buf.data(), 240, 5);
    check(!stale.valid && p.outstanding() == index_of("A1") && p.stats(index_of("A1")).late == 1,
          "the old attempt's late reply is counted late and does not complete the new attempt");
  }

  // 9. Log lines are metadata only: a sentinel payload never appears.
  {
    Probe p;
    p.begin(Mode::B_TELEMETRY_SOAK, 0, 0, 0);  // A1 first
    Terminal to;
    const int idx = p.poll(0, to);
    p.on_frame_sent(4, 0x03, kRequests[idx].address);
    std::vector<uint8_t> sentinel(242, 0);
    const char *marker = "SENTINEL-PASSCODE-9";
    for (std::size_t i = 0; i < sentinel.size(); i++) sentinel[i] = uint8_t(marker[i % std::strlen(marker)]);
    const Terminal t = p.on_response(90, idx, p.generation(), sentinel.data(), 240, 42);
    const std::string all = fmt_terminal(t) + summary_text(p);
    check(all.find("SENTINEL") == std::string::npos && all.find("PASSCODE") == std::string::npos, "no payload byte reaches any log line");
    check(fmt_terminal(t).find("req=A1 fc=3 addr=0x1200 n=120 exp=240 got=240 cls=OK") != std::string::npos &&
              fmt_terminal(t).find("step=0 expect=OK match=1") != std::string::npos,
          "the result line reports identity, expected/actual length, class, step and expectation");
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

  // 12. Only a failed liveness step aborts: at each of the five positions,
  //     by timeout and by an exception, the run stops and issues nothing more.
  {
    const int live_steps[] = {0, 4, 6, 10, 12};
    bool all_ok = true;
    std::string detail;
    for (int L : live_steps) {
      for (int by_exc = 0; by_exc < 2; by_exc++) {
        Harness h;
        h.boundary_exc2 = true;
        if (by_exc) { h.exc_call = L; h.exc_code = 2; } else { h.silent_call = L; }
        h.p.begin(Mode::A_COMPATIBILITY, 0, 1000, 0);
        h.run_until(5UL * 60UL * 1000UL);
        const bool ok = h.p.aborted() && h.p.abort_step() == L && h.p.finished() && h.issued.size() == std::size_t(L + 1) &&
                        h.p.unexpected() == 1;
        char run[200];
        format_run(run, sizeof(run), h.p);
        const bool logged = std::string(run).find("aborted=liveness@step" + std::to_string(L + 1)) != std::string::npos;
        if (!ok || !logged) { all_ok = false; detail += " step" + std::to_string(L + 1) + (by_exc ? "/exc" : "/timeout"); }
      }
    }
    check(all_ok, "a failed liveness step (timeout or exception) at any of the 5 positions aborts: no further request" + detail);
  }

  // 13. Unexpected results elsewhere never abort the fixed schedule.
  {
    Harness ok_controls;  // controls answer OK (as on 2026-09-28): the 120-limit hypothesis is false
    ok_controls.p.begin(Mode::A_COMPATIBILITY, 0, 1000, 0);
    ok_controls.run_until(5UL * 60UL * 1000UL);
    std::size_t control_mismatch = 0;
    for (const Terminal &t : ok_controls.terminals)
      if (kRequests[t.request].kind == Kind::BOUNDARY && t.outcome == Outcome::OK && !t.match) control_mismatch++;
    check(ok_controls.issued.size() == 29 && !ok_controls.p.aborted() && ok_controls.p.unexpected() == 4 && control_mismatch == 4,
          "four unexpected OK controls: match=0, unexpected=4, all 29 steps still run");
    char run[200];
    format_run(run, sizeof(run), ok_controls.p);
    check(std::string(run).find("unexpected=4 aborted=no") != std::string::npos, "the run line reports unexpected=4 aborted=no");
    Harness silent_control;
    silent_control.boundary_exc2 = true;
    silent_control.silent_call = 3;  // A121 unanswered
    silent_control.p.begin(Mode::A_COMPATIBILITY, 0, 1000, 0);
    silent_control.run_until(5UL * 60UL * 1000UL);
    check(silent_control.issued.size() == 29 && !silent_control.p.aborted() && silent_control.p.unexpected() == 1 &&
              silent_control.terminals[3].outcome == Outcome::TIMEOUT && !silent_control.terminals[3].match &&
              silent_control.terminals[4].outcome == Outcome::OK,
          "a control timeout is unexpected, the next liveness read decides, and the schedule continues");
    Harness cluster_exc;
    cluster_exc.boundary_exc2 = true;
    cluster_exc.exc_call = 2;  // A1 x120 refused
    cluster_exc.p.begin(Mode::A_COMPATIBILITY, 0, 1000, 0);
    cluster_exc.run_until(5UL * 60UL * 1000UL);
    check(cluster_exc.issued.size() == 29 && !cluster_exc.p.aborted() && cluster_exc.p.unexpected() == 1,
          "a refused x120 cluster is unexpected, not an abort; no request is added (no bisection)");
    Harness exc3_control;
    exc3_control.boundary_exc2 = true;
    exc3_control.exc_call = 3;  // A121 refused, but with exception 3
    exc3_control.exc_code = 3;
    exc3_control.p.begin(Mode::A_COMPATIBILITY, 0, 1000, 0);
    exc3_control.run_until(5UL * 60UL * 1000UL);
    check(exc3_control.issued.size() == 29 && exc3_control.p.unexpected() == 1 && exc3_control.terminals[3].exception == 3 &&
              !exc3_control.terminals[3].match,
          "a control refused with any exception other than 2 is unexpected (match=0)");
    check(ok_controls.overlaps == 0 && silent_control.overlaps == 0 && cluster_exc.overlaps == 0 && exc3_control.overlaps == 0,
          "no overlapping requests in any case");
  }

  // 14. Deterministic timing and the staggered summary.
  {
    check(kHubMaxRetries == 0 && kHubSendWaitMs == 500 && kRequestTimeoutMs == 1500 &&
              kRequestTimeoutMs >= (kHubMaxRetries + 1) * kHubSendWaitMs + kTimeoutMarginMs,
          "one hub frame per request, given up at 500 ms, well inside the probe's 1.5 s timeout");
    Harness h;
    h.boundary_exc2 = true;
    h.p.begin(Mode::A_COMPATIBILITY, 0, 1000, 0);
    h.run_until(5UL * 60UL * 1000UL);
    char b[400];
    bool lines_ok = kSummaryLineCount == 1 + kRequestCount + kComparisonCount + kSummaryCount + 1 && kSummaryLineCount == 46;
    for (std::size_t i = 0; lines_ok && i < kSummaryLineCount; i++)
      lines_ok &= format_summary_line(b, sizeof(b), h.p, i, 0) > 0 && std::strchr(b, '\n') == nullptr;
    lines_ok &= format_summary_line(b, sizeof(b), h.p, kSummaryLineCount, 0) < 0;
    check(lines_ok, "the summary is 46 single lines and ends there");
    format_summary_line(b, sizeof(b), h.p, 0, 0);
    const std::string first = b;
    format_summary_line(b, sizeof(b), h.p, kSummaryLineCount - 1, 3);
    const std::string last = b;
    check(first.rfind("diag run mode=A", 0) == 0 && first.find("finished=1 unexpected=0 aborted=no") != std::string::npos &&
              last.rfind("diag done:", 0) == 0 && last.find("drops=3") != std::string::npos,
          "the summary starts with the run line and ends with diag done (" + first + ")");
  }

  // 15. Gate B (B_TELEMETRY_SOAK): A1 0x1200 x120 then A2 0x12F0 x15 once per
  //     second for the 10 min default, one frame per request, nothing else.
  {
    const int a1 = index_of("A1"), a2 = index_of("A2");
    Harness h;
    h.latency_ms = 30;  // gate A measured ~30 ms for x120
    h.fill = 0x5A;
    h.p.begin(Mode::B_TELEMETRY_SOAK, 0, 20000, 0);
    h.run_until(20000 + default_run_ms(Mode::B_TELEMETRY_SOAK) + 60000);
    bool alternating = !h.issued.empty() && h.issued.size() % 2 == 0;
    for (std::size_t i = 0; alternating && i < h.issued.size(); i++) alternating &= h.issued[i] == (i % 2 == 0 ? a1 : a2);
    check(alternating, "gate B: the exact repeating order A1, A2 (every cycle completes)");
    const RequestStats &s1 = h.p.stats(std::size_t(a1)), &s2 = h.p.stats(std::size_t(a2));
    check(s1.issued == 600 && s2.issued == 600 && h.p.total_issued() == 1200,
          "gate B: A1 and A2 each run 600 times in the 10 min default (" + std::to_string(s1.issued) + "/" + std::to_string(s2.issued) + ")");
    bool only_telemetry = true, lengths = true, one_frame = true;
    for (int i : h.issued) only_telemetry &= (i == a1 || i == a2);
    for (const Terminal &t : h.terminals) {
      lengths &= t.outcome == Outcome::OK && t.match && t.got_bytes == (t.request == a1 ? 240 : 30);
      one_frame &= t.sends == 1;
    }
    check(only_telemetry && kRequests[a1].address == 0x1200 && kRequests[a1].count == 120 && kRequests[a1].expected_bytes == 240 &&
              kRequests[a2].address == 0x12F0 && kRequests[a2].count == 15 && kRequests[a2].expected_bytes == 30,
          "gate B reads only A1 0x1200 x120 (240 B) and A2 0x12F0 x15 (30 B): no control, narrow read or Settings cluster");
    check(lengths && h.terminals.size() == 1200, "gate B: every reply is OK with the exact length (A1 240, A2 30)");
    check(one_frame && s1.resends == 0 && s2.resends == 0, "gate B: one frame per request, no resend");
    check(h.overlaps == 0, "gate B: never more than one request outstanding");
    bool one_hz = true;
    uint32_t last_a1 = 0;
    for (std::size_t i = 0; i < h.issued.size(); i += 2) {
      if (i) one_hz &= h.issued_at[i] - last_a1 == 1000;
      last_a1 = h.issued_at[i];
    }
    check(one_hz && s1.ok_interval.max <= 1010 && s1.ok_interval.missed == 0 && s1.ok_interval.over_1_5x == 0 &&
              s2.ok_interval.missed == 0,
          "gate B healthy: A1 exactly every 1000 ms; OK intervals ~1 s, no missed cycle");
    check(h.p.finished() && !h.p.aborted() && h.p.unexpected() == 0 && h.issued_at.back() < 20000 + 600000,
          "gate B stops at its 10 min deadline: finished, not aborted, 0 unexpected");
    Terminal to;
    bool none = true;
    for (uint32_t t = h.now; t < h.now + 120000; t += 10) none &= h.p.poll(t, to) < 0;
    check(none && h.p.total_issued() == 1200, "gate B: no request after FINISHED (until reboot)");
    // Progress and final summaries carry A1/A2 statistics; no payload byte reaches a log line.
    char b[400];
    format_request_stats(b, sizeof(b), h.p, std::size_t(a1));
    const std::string st1 = b;
    format_request_stats(b, sizeof(b), h.p, std::size_t(a2));
    const std::string st2 = b;
    const std::string all = summary_text(h.p);
    check(st1.rfind("diag stat req=A1 issued=600 ok=600 short=0 long=0 exc=0 timeout=0 resends=0 late=0", 0) == 0 &&
              st2.rfind("diag stat req=A2 issued=600 ok=600 short=0 long=0 exc=0 timeout=0 resends=0 late=0", 0) == 0,
          "gate B progress/final statistics lines for A1 and A2 (" + st1.substr(0, 90) + ")");
    check(all.find("diag run mode=B run_ms=600000 issued=1200 finished=1 unexpected=0 aborted=no") != std::string::npos &&
              all.find("diag stat req=A1 issued=600") != std::string::npos && all.find("diag stat req=A2 issued=600") != std::string::npos &&
              all.find("diag done:") != std::string::npos,
          "gate B final summary: run line, A1/A2 statistics, diag done");
    check(all.find("diag sum set=A1_V17_32 words=16 zero=0\n") != std::string::npos &&
              all.find("diag sum set=A1_R17_32 words=16 zero=0\n") != std::string::npos &&
              all.find("diag sum set=A2_GAPS words=5 zero=0\n") != std::string::npos,
          "gate B summaries report counts only (0x5A fill -> zero=0), never a data value");
    std::string logs = all;
    for (const Terminal &t : h.terminals) logs += fmt_terminal(t);
    check(logs.find("5A5A") == std::string::npos && logs.find("ZZ") == std::string::npos && logs.find(std::string(4, char(0x5A))) == std::string::npos,
          "gate B: no payload byte (0x5A fill) reaches any log line");
  }
  // 15b. Gate B with slow replies: a late cycle starts once, as soon as the
  //      previous one ends; missed 1 s slots are skipped, never replayed.
  //      Invariant: at most one A1 per 1 s grid slot.
  {
    const int a1 = index_of("A1");
    Harness h;
    h.latency_ms = 1300;  // A1 + A2 take 2.6 s: cycles are missed
    h.p.begin(Mode::B_TELEMETRY_SOAK, 0, 0, 60000);
    h.run_until(70000);
    bool one_per_slot = true, ordered = true;
    long last_slot = -1;
    for (std::size_t i = 0; i < h.issued.size(); i++) {
      ordered &= h.issued[i] == (i % 2 == 0 ? a1 : index_of("A2"));
      if (h.issued[i] != a1) continue;
      const long slot = long(h.issued_at[i] / 1000);
      one_per_slot &= slot > last_slot;
      last_slot = slot;
    }
    const RequestStats &s1 = h.p.stats(std::size_t(a1));
    check(ordered && one_per_slot && s1.issued <= 24 && h.overlaps == 0,
          "gate B slow replies: at most one A1 per 1 s slot, missed slots skipped, not replayed (" + std::to_string(s1.issued) + " A1 in 60 s)");
    check(s1.ok_interval.missed >= 20 && s1.ok_interval.max >= 2000, "gate B slow replies: the missed cycles are counted, not hidden");
  }
  // 15c. Gate B outage then recovery: no burst of queued cycles afterwards.
  {
    const int a1 = index_of("A1");
    Harness h;
    h.silent_until_ms = 10000;  // 10 s with no reply at all
    h.p.begin(Mode::B_TELEMETRY_SOAK, 0, 0, 30000);
    h.run_until(40000);
    bool no_burst = true;
    long last_slot = -1;
    for (std::size_t i = 0; i < h.issued.size(); i++) {
      if (h.issued[i] != a1) continue;
      const long slot = long(h.issued_at[i] / 1000);
      no_burst &= slot > last_slot;  // at most one A1 per 1 s slot, before and after the outage
      last_slot = slot;
    }
    const RequestStats &s1 = h.p.stats(std::size_t(a1));
    check(no_burst && h.overlaps == 0 && s1.outcomes[std::size_t(Outcome::TIMEOUT)] >= 3 &&
              s1.outcomes[std::size_t(Outcome::OK)] >= 15 && h.p.unexpected() >= 6,
          "gate B outage: timeouts counted as unexpected, then 1 Hz resumes without a burst");
  }
  // 15d. Gate B outcome accounting: timeout, exception, short, long, resend.
  {
    const int a1 = index_of("A1"), a2 = index_of("A2");
    Harness h;
    h.silent_call = 2;              // 2nd cycle A1: no reply
    h.exc_call = 5;                 // 3rd cycle A2: exception 4
    h.exc_code = 4;
    h.bytes_call = 6;               // 4th cycle A1: short (238 bytes)
    h.bytes_value = 238;
    h.second_frame_call = 8;        // 5th cycle A1: the frame goes out twice
    h.p.begin(Mode::B_TELEMETRY_SOAK, 0, 0, 20000);
    h.run_until(30000);
    Harness l;
    l.bytes_call = 1;               // 1st cycle A2: long (32 bytes)
    l.bytes_value = 32;
    l.p.begin(Mode::B_TELEMETRY_SOAK, 0, 0, 5000);
    l.run_until(10000);
    const RequestStats &s1 = h.p.stats(std::size_t(a1)), &s2 = h.p.stats(std::size_t(a2));
    check(s1.outcomes[std::size_t(Outcome::TIMEOUT)] == 1 && s2.outcomes[std::size_t(Outcome::EXCEPTION)] == 1 &&
              s1.outcomes[std::size_t(Outcome::SHORT)] == 1 && s1.resends == 1 &&
              l.p.stats(std::size_t(a2)).outcomes[std::size_t(Outcome::LONG)] == 1,
          "gate B: timeout, exception, short, long and resend are each counted exactly once");
    check(h.p.unexpected() == 3 && l.p.unexpected() == 1 && !h.p.aborted() && h.p.finished(),
          "gate B: each non-OK outcome is unexpected; gate B never aborts, it runs to its deadline");
    char b[400];
    format_request_stats(b, sizeof(b), h.p, std::size_t(a1));
    check(std::string(b).find("short=1 long=0 exc=0 timeout=1 resends=1") != std::string::npos,
          "gate B: the A1 statistics line reports short/timeout/resend (" + std::string(b).substr(0, 110) + ")");
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
    const char *names[6] = {"A1 issued (A2 pending)", "C1 issued (C2 pending)", "right after an exception",
                            "a finished run", "a partial gate A pass", "an aborted gate A run"};
    g_dirty_states[0].begin(Mode::C_COEXISTENCE, 0, 0, 0); drive(g_dirty_states[0], 0, 45000, true, nullptr, 1, index_of("A1"));
    g_dirty_states[1].begin(Mode::C_COEXISTENCE, 0, 0, 0); drive(g_dirty_states[1], 0, 45000, true, nullptr, 1, index_of("C1"));
    g_dirty_states[2].begin(Mode::C_COEXISTENCE, 0, 0, 0); drive(g_dirty_states[2], 0, 45000, true, nullptr, 2);
    g_dirty_states[3].begin(Mode::B_TELEMETRY_SOAK, 0, 0, 20000); drive(g_dirty_states[3], 0, 30000, true);
    g_dirty_states[4].begin(Mode::A_COMPATIBILITY, 0, 0, 0); drive(g_dirty_states[4], 0, 6000, false);
    g_dirty_states[5].begin(Mode::A_COMPATIBILITY, 0, 0, 0); drive(g_dirty_states[5], 0, 6000, true);
    check(g_dirty_states[0].outstanding() == index_of("A1") && g_dirty_states[1].outstanding() == index_of("C1") &&
          g_dirty_states[3].finished() && g_dirty_states[4].total_issued() > 0 && !g_dirty_states[4].finished() &&
              g_dirty_states[5].aborted() && g_dirty_states[5].unexpected() > 0,
          "reset: the used probes stopped in their transient states");
    g_fresh.begin(Mode::A_COMPATIBILITY, 1000, 20000, 0);
    g_dirty.begin(Mode::A_COMPATIBILITY, 1000, 20000, 0);
    check(std::memcmp(&g_fresh, &g_dirty, sizeof(Probe)) == 0, "reset: begin() on a used probe restores the exact default state (byte-equal)");
    for (int i = 0; i < 6; i++) {
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
