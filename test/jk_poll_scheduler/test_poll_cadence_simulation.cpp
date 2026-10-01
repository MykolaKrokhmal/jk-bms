// Deterministic scheduler/freshness simulation (2026-09-27). Drives the REAL
// jk_poll_scheduler::pick_next_block() over the REAL generated kBlocks and
// checks every block against its REAL generated freshness contract
// (kBlockFreshnessBudgetMs = cadence + kFreshnessJitterAllowanceMs, derived
// in tools/protocol/generate_read_plan.js). See poll_cadence_model.h for
// the bus model and poll_cadence_freshness_20260927.md for the hardware
// calibration.
//
//   g++ -std=c++17 -Wall -Wextra -I ../../components/jk_poll_scheduler -I ../../protocol/generated \
//       test_poll_cadence_simulation.cpp -o test_poll_cadence_simulation && ./test_poll_cadence_simulation

#include "poll_cadence_model.h"

#include <cstdio>
#include <string>

using namespace poll_model;

namespace {
int g_failures = 0, g_checks = 0;
void check(bool cond, const std::string &desc) {
  g_checks++;
  if (!cond) { g_failures++; std::printf("FAIL: %s\n", desc.c_str()); }
}

constexpr size_t N = jk_read_plan::kBlockCount;
constexpr uint32_t kWarmupMs = 60000;  // startup sweep of all 103 blocks is over

// Hardware calibration (10 min read-only observation, 2026-09-27): these
// latencies reproduce the device's 3.62 successes/s and its largest
// healthy 15 s-group lateness (+2.97 s measured, +2.9 s modelled).
Params calibrated() {
  Params p;
  p.block_latency_ms = 60;
  p.block_latency_jitter_ms = 20;
  p.cell_latency_ms = 60;
  return p;
}

// Largest interval between consecutive successes of each block, relative to
// its own budget. Returns the worst (interval - budget); <= 0 means never stale.
int32_t worst_overrun(const Result &r, std::string *who = nullptr) {
  int32_t worst = INT32_MIN;
  for (size_t i = 0; i < N; i++) {
    const int32_t over = int32_t(max_interval(r, i, kWarmupMs)) - int32_t(jk_read_plan::kBlockFreshnessBudgetMs[i]);
    if (over > worst) { worst = over; if (who) *who = std::to_string(jk_read_plan::kBlocks[i].address); }
  }
  return worst;
}

int first_block_with_cadence(uint32_t cadence) {
  for (size_t i = 0; i < N; i++) if (jk_read_plan::kBlocks[i].cadence_ms == cadence) return int(i);
  return -1;
}
}  // namespace

int main() {
  // 1. The contract itself, per block.
  bool contract_ok = true;
  for (size_t i = 0; i < N; i++) {
    const uint32_t c = jk_read_plan::kBlocks[i].cadence_ms, b = jk_read_plan::kBlockFreshnessBudgetMs[i];
    if (c == 0) continue;
    if (!(b == c + jk_read_plan::kFreshnessJitterAllowanceMs && b > c && b < 2 * c)) contract_ok = false;
  }
  check(contract_ok, "every scheduled block: budget = cadence + allowance, cadence < budget < 2 x cadence");
  check(jk_read_plan::kFreshnessJitterAllowanceMs == 7500, "allowance = half the shortest scheduler cadence (15 s / 2)");

  // 2. Nominal cadence for every block (calibrated model, 20 min).
  const Result nominal = run(calibrated());
  bool cadence_ok = true;
  for (size_t i = 0; i < N; i++) {
    const auto &s = nominal.successes[i];
    const uint32_t c = jk_read_plan::kBlocks[i].cadence_ms;
    uint64_t sum = 0; uint32_t n = 0, shortest = UINT32_MAX;
    for (size_t k = 1; k < s.size(); k++) if (s[k - 1] >= kWarmupMs) { sum += s[k] - s[k - 1]; n++; if (s[k] - s[k - 1] < shortest) shortest = s[k] - s[k - 1]; }
    // A success can follow a late one by less than the cadence (the next
    // read is due one cadence after the late read was ISSUED), bounded by
    // the same scheduling lateness; the device showed -1.9 s at most.
    // Mean lateness: the 48 slow blocks are read as one burst every 300 s and
    // queue behind each other (device: +0.36 s median, +0.82 s max; the
    // model is more pessimistic, up to +2.9 s); 3 s is the largest healthy
    // lateness measured on hardware.
    if (n == 0 || sum / n > c + 3000 || shortest + jk_read_plan::kFreshnessJitterAllowanceMs < c) cadence_ok = false;
  }
  check(cadence_ok, "nominal: every block is read at its canonical cadence (mean lateness <= 3 s, never early by more than the allowance)");
  std::string who;
  const int32_t nominal_over = worst_overrun(nominal, &who);
  check(nominal_over < 0, "nominal: no block ever exceeds its budget (no stale flicker) -- worst margin " + std::to_string(-nominal_over) + " ms at " + who);
  check(nominal.timeouts == 0 && nominal.max_queue_depth <= 2, "nominal: no timeouts, bus queue depth <= 2");
  const double rate = nominal.reads_ok / 1200.0;
  check(rate > 3.55 && rate < 3.70, "nominal: success rate matches the declared demand 52/15 + 3/75 + 48/300 = 3.67/s (" + std::to_string(rate) + ")");

  // 3. Worst normal jitter: routine writes, forced readback traffic, another
  //    block's timeout holding the bus, slower responses.
  {
    std::vector<WritePause> writes;
    for (uint32_t t = 120000; t < 1100000; t += 60000) writes.push_back({t, t + 1000});
    const Result r = run(calibrated(), writes);
    check(worst_overrun(r) < 0, "1 s write transaction every minute (reads paused): no block exceeds its budget");
  }
  {
    std::vector<ForcedCommand> forced;
    for (uint32_t t = 100000; t < 1100000; t += 5000) forced.push_back({t, 200});
    const Result r = run(calibrated(), {}, {}, forced);
    check(worst_overrun(r) < 0 && r.max_queue_depth <= 3, "forced readback traffic (200 ms every 5 s): no stale, queue depth <= 3");
  }
  {
    const int other = first_block_with_cadence(300000);
    const Result r = run(calibrated(), {}, {{other, 400000, 1}});
    bool others_ok = true;
    for (size_t i = 0; i < N; i++)
      if (int(i) != other && max_interval(r, i, kWarmupMs) > jk_read_plan::kBlockFreshnessBudgetMs[i]) others_ok = false;
    check(others_ok && r.timeouts == 1, "another block's 3 s timeout (bus held): every other block stays within budget");
  }
  {
    Params p = calibrated(); p.block_latency_ms = 80;  // +33 % slower responses
    check(worst_overrun(run(p)) < 0, "queue pressure: 80 ms responses (+33 %) still within budget");
  }

  // 4. One genuinely missed expected read still produces stale, for every
  //    scheduler group, and the next success recovers it.
  for (uint32_t cadence : {15000u, 75000u, 300000u}) {
    const int blk = first_block_with_cadence(cadence);
    Params p = calibrated(); p.duration_ms = 500000 + 4 * cadence + 60000;
    const Result r = run(p, {}, {{blk, 500000, 1}});
    const auto &s = r.successes[blk];
    uint32_t gap = 0, after = 0;
    for (size_t k = 1; k < s.size(); k++) {
      if (s[k - 1] < 500000 - cadence) continue;
      const uint32_t g = s[k] - s[k - 1];
      if (gap == 0 && g > cadence + 5000) { gap = g; if (k + 1 < s.size()) after = s[k + 1] - s[k]; }
    }
    const uint32_t budget = jk_read_plan::kBlockFreshnessBudgetMs[blk];
    check(gap > budget, "one missed read at cadence " + std::to_string(cadence) + " ms: gap " + std::to_string(gap) + " ms > budget " + std::to_string(budget) + " (stale shown)");
    check(gap >= budget + 5000, "  ... and stale lasts >= 5 s (" + std::to_string(gap - budget) + " ms), not a flicker");
    check(after != 0 && after <= budget, "  ... the next successful read recovers it (" + std::to_string(after) + " ms)");
    // The previous budget (2 x cadence for the 15 s group) sat on this edge.
    if (cadence == 15000) check(gap < 2 * cadence + 1500, "  ... a 2 x cadence budget would show it for < 1.5 s only (" + std::to_string(gap - 2 * cadence) + " ms)");
  }

  // 5. A failed write is a genuine delay, never a missed cycle: no block
  //    reaches 2 x cadence. The pause is the proven worst-case bus ownership
  //    of one write on the 250 ms servicer: 3250 ms (ACK edge) + 4250 ms
  //    (readback edge) = 7500 ms (test/jk_write_tx/test_jk_write_tx_bus_pause.cpp).
  {
    const Result r = run(calibrated(), {{300000, 307500}});
    bool below_two = true;
    for (size_t i = 0; i < N; i++)
      if (jk_read_plan::kBlocks[i].cadence_ms && max_interval(r, i, kWarmupMs) >= 2 * jk_read_plan::kBlocks[i].cadence_ms) below_two = false;
    check(below_two, "failed write (7.5 s worst-case pause): data older than budget may show stale, but no block misses a whole cycle");
  }

  std::printf("poll cadence simulation: %d/%d checks passed (nominal rate %.3f/s, bus %.1f%%, worst nominal margin %d ms)\n",
              g_checks - g_failures, g_checks, rate, 100.0 * nominal.bus_busy_ms / 1200000.0, -nominal_over);
  return g_failures == 0 ? 0 : 1;
}
