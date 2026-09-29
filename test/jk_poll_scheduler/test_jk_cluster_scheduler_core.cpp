// Host tests + deterministic bus simulation for
// components/jk_poll_scheduler/jk_cluster_scheduler_core.h (clustered-read
// plan M3). The bus model: the servicer ticks every 20 ms and issues at most
// one read; the hub answers after the per-cluster latency measured on
// hardware by gate A (2026-09-28, total_ms: A1 31, A2 12, C1 30, C2 12,
// S1 17, S2 16, S3 18 ms), and the next frame waits for the 50 ms bus
// turnaround (modbus: turnaround_time); an unanswered read is timed out by
// the servicer after 1.5 s (the hub gave up at send_wait_time 500 ms).
//
//   g++ -std=c++17 -Wall -Wextra -I components/jk_poll_scheduler -I protocol/generated \
//       test/jk_poll_scheduler/test_jk_cluster_scheduler_core.cpp -o t && ./t

#include "jk_cluster_scheduler_core.h"

#include <algorithm>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

using namespace jk_cluster_scheduler;

namespace {
int g_checks = 0, g_failures = 0;
void check(bool cond, const std::string &desc) {
  g_checks++;
  if (!cond) { g_failures++; std::printf("FAIL: %s\n", desc.c_str()); }
}
int idx(const char *id) {
  for (std::size_t i = 0; i < kClusterCount; i++) if (std::strcmp(kClusters[i].id, id) == 0) return int(i);
  return -1;
}

struct Event { int cluster; uint32_t issued_ms; uint32_t done_ms; bool ok; };
struct Window { uint32_t from, to; };

struct Sim {
  uint32_t tick_ms = 20, turnaround_ms = 50, timeout_ms = 1500, hub_wait_ms = 500;
  uint32_t latency[kClusterCount] = {};
  uint32_t extra_latency_ms = 0;          // added to every read (slow bus)
  std::vector<Window> write_pauses;       // write_in_flight windows
  std::vector<Window> silences;           // no reply to reads issued inside
  std::vector<Window> leases;             // active Settings lease windows
  std::vector<Event> events;
  int max_outstanding = 0;
  uint32_t busy_ms = 0;
  Scheduler s;
  Sim() {
    const uint32_t measured[] = {31, 12, 30, 12, 17, 16, 18};  // kClusters order: A1 A2 C1 C2 S1 S2 S3
    static_assert(sizeof(measured) / sizeof(measured[0]) == kClusterCount, "one latency per cluster");
    for (std::size_t i = 0; i < kClusterCount; i++) latency[i] = measured[i];
  }
  static bool in(const std::vector<Window> &w, uint32_t t) {
    for (const auto &x : w) if (t >= x.from && t < x.to) return true;
    return false;
  }
  void run(uint32_t until_ms) {
    s.begin(0);
    int pending = -1;
    uint32_t done_at = 0, bus_free = 0;
    bool reply = false;
    for (uint32_t now = 0; now <= until_ms; now += tick_ms) {
      s.set_settings_lease(in(leases, now), now);
      if (pending >= 0 && now >= done_at) {
        events.back().done_ms = done_at;
        events.back().ok = reply;
        s.complete(pending, done_at);
        pending = -1;
      }
      const int c = s.next(now, in(write_pauses, now));
      if (c >= 0) {
        if (pending >= 0) max_outstanding = 2;
        const uint32_t start = std::max(now, bus_free);
        reply = !in(silences, now);
        const uint32_t lat = latency[c] + extra_latency_ms;
        done_at = reply ? start + lat : now + timeout_ms;
        bus_free = (reply ? start + lat : start + hub_wait_ms) + turnaround_ms;
        busy_ms += reply ? lat : hub_wait_ms;
        pending = c;
        events.push_back({c, now, 0, false});
        max_outstanding = std::max(max_outstanding, 1);
      }
    }
  }
  std::vector<uint32_t> issues(int c) const {
    std::vector<uint32_t> v;
    for (const auto &e : events) if (e.cluster == c) v.push_back(e.issued_ms);
    return v;
  }
};

uint32_t pct(std::vector<uint32_t> v, double q) {
  if (v.empty()) return 0;
  std::sort(v.begin(), v.end());
  return v[std::min<std::size_t>(v.size() - 1, std::size_t(q * double(v.size() - 1) + 0.5))];
}
std::vector<uint32_t> intervals(const std::vector<uint32_t> &t) {
  std::vector<uint32_t> d;
  for (std::size_t i = 1; i < t.size(); i++) d.push_back(t[i] - t[i - 1]);
  return d;
}
bool one_per_slot(const std::vector<uint32_t> &t, uint32_t slot_ms) {
  long last = -1;
  for (uint32_t x : t) { const long s = long(x / slot_ms); if (s <= last) return false; last = s; }
  return true;
}
}  // namespace

int main() {
  const int A1 = idx("A1"), A2 = idx("A2"), C1 = idx("C1"), C2 = idx("C2"), S1 = idx("S1"), S2 = idx("S2"), S3 = idx("S3");
  check(A1 == 0 && A2 == 1 && C1 == 2 && C2 == 3 && S1 == 4 && S2 == 5 && S3 == 6, "the generated table order is A1 A2 C1 C2 S1 S2 S3");

  // 1. Healthy 20 min at the measured latencies: cadences, order, stagger.
  {
    Sim sim;
    sim.run(20UL * 60UL * 1000UL);
    const auto a1 = sim.issues(A1), a2 = sim.issues(A2), c1 = sim.issues(C1), s1 = sim.issues(S1);
    check(a1.size() == 1201 && (a2.size() == 1201 || a2.size() == 1200), "healthy: A1 and A2 once per second (the last A2 may fall after the end) (" + std::to_string(a1.size()) + "/" + std::to_string(a2.size()) + ")");
    bool a2_follows = true;
    for (std::size_t i = 0; i + 1 < sim.events.size(); i++)
      if (sim.events[i].cluster == A1) a2_follows &= sim.events[i + 1].cluster == A2 && sim.events[i + 1].issued_ms - sim.events[i].done_ms <= 20 + 50;
    check(a2_follows, "healthy: every A1 is immediately followed by A2 (within one tick + turnaround)");
    const auto d = intervals(a1);
    check(pct(d, 0.5) == 1000 && pct(d, 0.99) == 1000 && *std::max_element(d.begin(), d.end()) == 1000,
          "healthy: A1 exactly every 1000 ms (p50/p99/max = " + std::to_string(pct(d, 0.5)) + "/" + std::to_string(pct(d, 0.99)) + ")");
    check(c1.size() == 80 && s1.size() == 80 && sim.issues(C2).size() == 80 && sim.issues(S2).size() == 80 && sim.issues(S3).size() == 80,
          "healthy: C1/C2 and S1-S3 at startup and every 15 s (80 in 20 min: " + std::to_string(c1.size()) + ")");
    const auto dc = intervals(c1), ds = intervals(s1);
    check(c1[0] < 1000 && s1[0] < 1000 && *std::min_element(dc.begin(), dc.end()) == 15000 && *std::max_element(dc.begin(), dc.end()) == 15000 &&
              *std::max_element(ds.begin(), ds.end()) == 15000,
          "healthy: Settings and static read in the first second, then exactly every 15 s (no field slower than before)");
    bool staggered = true;
    for (const auto &e : sim.events)
      if (kClusters[e.cluster].role != jk_read_clusters::Role::TELEMETRY) staggered &= (e.issued_ms % 1000) >= 500;
    check(staggered, "healthy: every Settings/static read starts at or after the 500 ms phase (never with A1/A2)");
    check(sim.max_outstanding == 1, "healthy: never more than one outstanding request");
    const double busy = 100.0 * sim.busy_ms / (20.0 * 60.0 * 1000.0);
    check(busy > 4.0 && busy < 6.0, "healthy: modelled bus occupancy " + std::to_string(busy) + " % (A1+A2 ~43 ms/s + C/S ~93 ms per 15 s)");
  }

  // 2. Active Settings lease: immediate, then every 3 s; back to 300 s after.
  {
    Sim sim;
    sim.leases.push_back({63000, 123000});  // off the 15 s background grid, so "immediate" is observable
    sim.run(200000);
    const auto c1 = sim.issues(C1);
    std::vector<uint32_t> in_lease;
    for (uint32_t t : c1) if (t >= 63000 && t < 123000) in_lease.push_back(t);
    check(!in_lease.empty() && in_lease[0] - 63000 <= 1000, "lease: C1 is read within one second of the lease starting (background would wait until 75.5 s)");
    const auto d = intervals(in_lease);
    check(in_lease.size() == 20 && !d.empty() && pct(d, 0.99) == 3000 && *std::max_element(d.begin(), d.end()) == 3000,
          "lease: C1 every 3000 ms while active (" + std::to_string(in_lease.size()) + " reads)");
    check(sim.issues(C2).size() == c1.size(), "lease: C2 follows every C1");
    std::vector<uint32_t> after;
    for (uint32_t t : c1) if (t >= 123000) after.push_back(t);
    const auto da = intervals(after);
    check(after.size() >= 5 && after[0] - in_lease.back() >= 15000 && after[0] - in_lease.back() < 16000 && !da.empty() &&
              *std::min_element(da.begin(), da.end()) == 15000 && *std::max_element(da.begin(), da.end()) == 15000,
          "lease end: C1/C2 return to the 15 s background cadence, measured from the last lease read");
    bool staggered = true;
    for (uint32_t t : in_lease) staggered &= (t % 1000) >= 500;
    check(staggered, "lease: active Settings reads stay on the 500 ms phase");
  }

  // 3. Slow replies: missed slots are skipped, never replayed in a burst.
  {
    Sim sim;
    sim.extra_latency_ms = 1100;  // A1 + A2 > 2 s per cycle
    sim.run(120000);
    const auto a1 = sim.issues(A1);
    bool paired = true;
    for (std::size_t i = 0; i + 1 < sim.events.size(); i++) if (sim.events[i].cluster == A1) paired &= sim.events[i + 1].cluster == A2;
    check(one_per_slot(a1, 1000) && a1.size() <= 60 && paired,
          "slow bus: every A1 still followed by its A2, at most one A1 per 1 s slot, missed slots skipped (" + std::to_string(a1.size()) + " A1 in 120 s)");
    check(sim.max_outstanding == 1, "slow bus: still one outstanding request");
  }

  // 4. Starvation: telemetry alone would saturate the bus; aging still serves Settings/static.
  {
    Sim sim;
    sim.extra_latency_ms = 900;
    sim.leases.push_back({30000, 90000});
    sim.run(120000);
    const auto c1 = sim.issues(C1), s1 = sim.issues(S1), s3 = sim.issues(S3);
    std::vector<uint32_t> in_lease;
    for (uint32_t t : c1) if (t >= 30000 && t < 90000) in_lease.push_back(t);
    const auto d = intervals(in_lease);
    check(!s1.empty() && !s3.empty() && s3[0] < 15000, "saturated bus: static clusters are still read at startup (aging)");
    const uint32_t bound = 3000 + 2 * kAgingStepMs + 2000;  // cadence + two aging steps + one saturated cycle
    check(in_lease.size() >= 60000 / bound && !d.empty() && *std::max_element(d.begin(), d.end()) <= bound,
          "saturated bus: active Settings still served with a bounded delay (" + std::to_string(in_lease.size()) + " reads, max gap " +
              std::to_string(d.empty() ? 0 : *std::max_element(d.begin(), d.end())) + " ms)");
  }

  // 5. Write pause: nothing issued while a write owns the bus; no burst after.
  {
    Sim sim;
    sim.write_pauses.push_back({10000, 15000});
    sim.run(30000);
    bool quiet = true;
    for (const auto &e : sim.events) quiet &= !(e.issued_ms >= 10000 && e.issued_ms < 15000);
    check(quiet, "write pause: no read is issued while a write transaction is in flight");
    const auto a1 = sim.issues(A1);
    check(one_per_slot(a1, 1000) && std::count_if(a1.begin(), a1.end(), [](uint32_t t) { return t >= 15000 && t < 16000; }) == 1,
          "write pause: telemetry resumes with one A1, no replay of the missed seconds");
  }

  // 6. Timeouts: the cycle still completes; no overlap.
  {
    Sim sim;
    sim.silences.push_back({5000, 5100});  // the A1 at 5 s gets no reply
    sim.run(12000);
    bool found = false;
    for (std::size_t i = 0; i + 1 < sim.events.size(); i++) {
      if (sim.events[i].cluster == A1 && sim.events[i].issued_ms == 5000) {
        found = !sim.events[i].ok && sim.events[i].done_ms == 6500 && sim.events[i + 1].cluster == A2 && sim.events[i + 1].issued_ms >= 6500;
      }
    }
    check(found, "timeout: an unanswered A1 is closed at 1.5 s and A2 still follows");
    check(sim.max_outstanding == 1 && one_per_slot(sim.issues(A1), 1000), "timeout: no overlap and no burst afterwards");
  }

  // 7. Credential isolation and table invariants.
  {
    bool no_passcode = true;
    for (std::size_t i = 0; i < kClusterCount; i++)
      no_passcode &= !jk_read_clusters::overlaps(kClusters[i].start, kClusters[i].register_count, 0x1470, 8);
    check(no_passcode && jk_read_clusters::kIsolatedReadCount == 1 && jk_read_clusters::kIsolatedReads[0].start == 0x1470,
          "no cluster the scheduler can issue touches the setup passcode 0x1470-0x147F (it is only an isolated read)");
    Sim sim;
    sim.leases.push_back({0, 60000});
    sim.run(60000);
    bool all_in_table = true;
    for (const auto &e : sim.events) all_in_table &= e.cluster >= 0 && std::size_t(e.cluster) < kClusterCount;
    check(all_in_table, "the scheduler only ever returns an index of the generated cluster table");
    Scheduler s;
    check(s.next(0, false) == kNone, "nothing is issued before begin()");
    s.begin(0);
    check(s.next(0, true) == kNone && s.next(0, false) == A1 && s.next(0, false) == kNone, "write_in_flight blocks; then one read, never a second while outstanding");
    s.complete(C1, 10);
    check(s.outstanding() == A1, "complete() for a cluster that is not outstanding changes nothing");
  }

  // 8. Priority: tiers and aging.
  {
    Scheduler s;
    s.begin(0);
    check(s.base_tier(A1) == Tier::TELEMETRY && s.base_tier(C1) == Tier::BACKGROUND_SETTINGS && s.base_tier(S1) == Tier::STATIC, "base tiers");
    s.set_settings_lease(true, 0);
    check(s.base_tier(C1) == Tier::ACTIVE_SETTINGS && s.lease_active(), "the lease raises Settings to the active tier");
    // At 600 ms: A1/A2 done; C1 and S1 are both due at 500 -> Settings first.
    int first = s.next(0, false); s.complete(first, 30);
    int second = s.next(40, false); s.complete(second, 60);
    const int third = s.next(600, false);
    check(first == A1 && second == A2 && third == C1, "priority: telemetry, its follower, then active Settings before static");
  }

  std::printf("cluster scheduler: %d/%d checks passed\n", g_checks - g_failures, g_checks);
  return g_failures == 0 ? 0 : 1;
}
