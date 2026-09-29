// Host tests for components/jk_poll_scheduler/jk_cluster_runtime_core.h
// (clustered-read plan M5): single flight across clusters and the passcode
// read, late responses, the latched fallback (visible, never oscillating),
// the strict RMW gate with its automatic pre-read, and the cross-task
// cluster snapshot.
//
//   g++ -std=c++17 -Wall -Wextra -I components/jk_poll_scheduler -I protocol/generated \
//       test/jk_poll_scheduler/test_jk_cluster_runtime_core.cpp

#include "jk_cluster_runtime_core.h"

#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

using namespace jk_cluster_runtime;

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
// A fallback image byte, or -1 when there is no image (never a null deref).
int image_at(const uint8_t *image, std::size_t i) { return image == nullptr ? -1 : int(image[i]); }
std::vector<uint8_t> bytes_for(int c, uint8_t fill) { return std::vector<uint8_t>(kClusters[c].payload_bytes, fill); }

// Serve every read the runtime issues until `until`, answering clusters with
// `fill` (or failing the ones in `fail_mask`), 30 ms per read.
struct Driver {
  Runtime rt;
  uint32_t now = 0;
  uint32_t fail_mask = 0;  // bit i: cluster i never answers
  bool lease = false;
  std::vector<int> issued;
  int passcode_reads = 0;
  void run(uint32_t until) {
    for (; now <= until; now += 20) {
      rt.check_timeout(now);
      const int c = rt.issue(now, false, lease);
      if (c == Runtime::kPasscodeRead) {
        passcode_reads++;
        bool ok = false;
        rt.on_passcode_response(rt.generation(), 16, ok);
        continue;
      }
      if (c < 0) continue;
      issued.push_back(c);
      if (fail_mask & (1U << c)) continue;  // the servicer times it out later
      const auto data = bytes_for(c, uint8_t(0x40 + c));
      rt.on_cluster_response(c, rt.generation(), data.data(), data.size(), now + 30, lease);
    }
  }
};
}  // namespace

int main() {
  const int A1 = idx("A1"), A2 = idx("A2"), C1 = idx("C1"), C2 = idx("C2"), S3 = idx("S3");

  // 1. Single flight across clusters and the passcode read.
  {
    Runtime rt;
    check(rt.issue(0, false, false) == -1, "nothing before begin()");
    rt.begin(0);
    check(rt.issue(0, true, false) == -1, "a write in flight blocks every read, the passcode read included");
    const int first = rt.issue(0, false, false);
    check(first == A1 && rt.busy() && rt.issue(10, false, false) == -1, "one read in flight: A1, then nothing until it completes");
    const auto a1 = bytes_for(A1, 1);
    check(rt.on_cluster_response(A2, rt.generation(), a1.data(), a1.size(), 30, false) == Completion::LATE &&
              rt.on_cluster_response(A1, rt.generation() - 1, a1.data(), a1.size(), 30, false) == Completion::LATE && rt.busy(),
          "a response for another cluster or an older generation is LATE and ignored");
    check(rt.on_cluster_response(A1, rt.generation(), a1.data(), a1.size(), 30, false) == Completion::OK && !rt.busy() &&
              rt.cache().entry(std::size_t(A1)).revision == 1,
          "the in-flight response is stored (revision 1) and frees the bus");
    // The setup passcode is strictly on demand (owner decision 2026-09-29).
    Driver d;
    d.rt.begin(0);
    d.run(2000);
    check(d.passcode_reads == 0 && !d.rt.passcode_requested(), "no setup-passcode read after boot");
    d.run(10 * 60 * 1000);
    check(d.passcode_reads == 0, "... and none periodically (10 min of normal operation)");
    d.rt.request_passcode_status();
    d.run(d.now + 2000);
    check(d.passcode_reads == 1 && !d.rt.passcode_requested(), "an explicit request causes exactly one isolated read");
    d.run(d.now + 60000);
    check(d.passcode_reads == 1, "... and only one: nothing more without a new request");
  }

  // 2. Fallback latch: 3 consecutive failures of a lead latch its group for good.
  {
    Driver d;
    d.rt.begin(0);
    d.fail_mask = 1U << A1;
    d.run(20000);
    check(d.rt.cluster_fallback(A1) && d.rt.cluster_fallback(A2) && d.rt.health(std::size_t(A1)).timeouts == 3,
          "A1 timing out 3 times in a row latches A1 and its follower A2 to the legacy readers");
    char buf[64];
    d.rt.format_mode(buf, sizeof(buf));
    check(std::string(buf) == "fallback:A1,A2" && d.rt.fallback_mask() == ((1U << A1) | (1U << A2)), "the fallback is visible: " + std::string(buf));
    std::size_t a1_after = 0;
    const std::size_t before = d.issued.size();
    d.fail_mask = 0;  // the bus recovers
    d.run(80000);
    for (std::size_t i = before; i < d.issued.size(); i++) a1_after += d.issued[i] == A1 || d.issued[i] == A2;
    check(a1_after == 0 && d.rt.cluster_fallback(A1), "latched for good: A1/A2 are never issued again, even after the bus recovers (no oscillation)");
    check(d.rt.health(std::size_t(C1)).successes > 0 && !d.rt.cluster_fallback(C1), "other clusters keep running");
    check(d.rt.check_rmw(0x1240, 2, d.now).gate == RmwGate::REFUSE && d.rt.check_rmw(0x1240, 2, d.now).reason == jk_cluster_cache::Lookup::FALLBACK,
          "no RMW merge ever uses a fallback-latched cluster");
  }
  {
    Runtime rt;
    rt.begin(0);
    uint32_t now = 0;
    const auto fail_once = [&](int c) {
      while (rt.issue(now, false, false) != c) { rt.check_timeout(now); if (rt.busy() && rt.in_flight_cluster() != c) { auto b = bytes_for(rt.in_flight_cluster(), 0); rt.on_cluster_response(rt.in_flight_cluster(), rt.generation(), b.data(), b.size(), now, false); } now += 20; }
      now += kReadTimeoutMs;
      rt.check_timeout(now);
    };
    fail_once(A1); fail_once(A1);
    // One success in between resets the count.
    while (rt.issue(now, false, false) != A1) { if (rt.busy()) { auto b = bytes_for(rt.in_flight_cluster(), 0); rt.on_cluster_response(rt.in_flight_cluster(), rt.generation(), b.data(), b.size(), now, false); } now += 20; }
    auto ok = bytes_for(A1, 3);
    rt.on_cluster_response(A1, rt.generation(), ok.data(), ok.size(), now, false);
    fail_once(A1); fail_once(A1);
    check(!rt.cluster_fallback(A1) && rt.health(std::size_t(A1)).consecutive_failures == 2, "failures must be consecutive: a success resets the count");
    // Wrong length counts as a failure and stores nothing.
    while (rt.issue(now, false, false) != A1) { if (rt.busy()) { auto b = bytes_for(rt.in_flight_cluster(), 0); rt.on_cluster_response(rt.in_flight_cluster(), rt.generation(), b.data(), b.size(), now, false); } now += 20; }
    const uint32_t rev = rt.cache().entry(std::size_t(A1)).revision;
    check(rt.on_cluster_response(A1, rt.generation(), ok.data(), ok.size() - 2, now, false) == Completion::WRONG_LENGTH &&
              rt.cache().entry(std::size_t(A1)).revision == rev && rt.cluster_fallback(A1),
          "a wrong-length response stores nothing and, as the third consecutive failure, latches the fallback");
  }

  // 3. RMW gate: strict budget with the automatic pre-read.
  {
    Driver d;
    d.rt.begin(0);
    d.run(1000);  // A1, A2, C1, C2, S1-S3 read once
    const uint32_t t = d.now;
    const RmwDecision fresh = d.rt.check_rmw(0x1114, 1, t);
    check(fresh.gate == RmwGate::READY && fresh.cluster == C2, "RMW on a freshly read register: READY from the cluster bytes");
    const uint32_t later = t + 10000;  // 10 s later, background cadence 15 s: C2 is older than 3.5 s
    d.now = later;
    const RmwDecision stale = d.rt.check_rmw(0x1114, 1, later);
    check(stale.gate == RmwGate::WAIT && stale.reason == jk_cluster_cache::Lookup::STALE, "RMW on bytes older than 3.5 s waits (pre-read requested)");
    int n = d.rt.issue(later, false, false);
    if (n == A2) {  // a cycle already started (A1 at 1000 ms) completes first
      auto a2 = bytes_for(A2, 2);
      d.rt.on_cluster_response(A2, d.rt.generation(), a2.data(), a2.size(), later + 10, false);
      n = d.rt.issue(later + 20, false, false);
    }
    check(n == C1, "the pre-read goes out next: C1 (the lead of C2's cycle), ahead of every tier (only a started cycle's follower goes first)");
    // The waiting write re-checks every tick: no second pre-read is queued.
    check(d.rt.check_rmw(0x1114, 1, later + 25).gate == RmwGate::WAIT, "while C1 is in flight the write still waits");
    auto c1 = bytes_for(C1, 7);
    d.rt.on_cluster_response(C1, d.rt.generation(), c1.data(), c1.size(), later + 30, false);
    check(d.rt.check_rmw(0x1114, 1, later + 35).gate == RmwGate::WAIT, "... and while C2 is due right after C1");
    check(d.rt.issue(later + 40, false, false) == C2, "... then C2");
    check(d.rt.check_rmw(0x1114, 1, later + 45).gate == RmwGate::WAIT, "... and while C2 is in flight");
    auto c2 = bytes_for(C2, 8);
    d.rt.on_cluster_response(C2, d.rt.generation(), c2.data(), c2.size(), later + 60, false);
    check(d.rt.issue(later + 65, false, false) != C1, "re-checking while waiting queued no duplicate C1/C2 pre-read");
    if (d.rt.busy()) { const int b = d.rt.in_flight_cluster(); auto x = bytes_for(b, 0); d.rt.on_cluster_response(b, d.rt.generation(), x.data(), x.size(), later + 66, false); }
    const RmwDecision again = d.rt.check_rmw(0x1114, 1, later + 70);
    check(again.gate == RmwGate::READY && again.raw == 0x0808, "after the pre-read the write merges into the new bytes");
    // S3 (no 3 s lease cadence) is handled the same way.
    const RmwDecision s3 = d.rt.check_rmw(0x14E4, 1, later + 70);
    int s3n = d.rt.issue(later + 80, false, false);
    if (s3n == A2) {  // the A1 read above started a cycle: its follower goes first
      auto a2 = bytes_for(A2, 2);
      d.rt.on_cluster_response(A2, d.rt.generation(), a2.data(), a2.size(), later + 90, false);
      s3n = d.rt.issue(later + 100, false, false);
    }
    check(s3.gate == RmwGate::WAIT && s3n == S3, "an S3 register: pre-read of S3, then READY");
    check(d.rt.check_rmw(0x1470, 8, later).gate == RmwGate::REFUSE && d.rt.check_rmw(0x1470, 8, later).reason == jk_cluster_cache::Lookup::CREDENTIAL,
          "the setup passcode is never an RMW source (CREDENTIAL)");
    check(d.rt.check_rmw(0x1440, 1, later).gate == RmwGate::REFUSE && d.rt.check_rmw(0x1114, 3, later).gate == RmwGate::REFUSE,
          "unknown addresses and bad widths are refused at once");
  }

  // 4. The passcode read never exposes bytes.
  {
    Runtime rt;
    rt.begin(0);
    rt.request_passcode_status();
    int c;
    uint32_t now = 0;
    do {
      c = rt.issue(now, false, false);
      if (c >= 0) { auto b = bytes_for(c, 1); rt.on_cluster_response(c, rt.generation(), b.data(), b.size(), now, false); }
      now += 20;
    } while (c != Runtime::kPasscodeRead && now < 5000);
    bool ok = true;
    check(c == Runtime::kPasscodeRead && rt.in_flight() == InFlight::PASSCODE && rt.issue(now, false, false) == -1,
          "the passcode read is part of the single flight (nothing else meanwhile)");
    check(!rt.on_passcode_response(rt.generation() + 1, 16, ok) && rt.on_passcode_response(rt.generation(), 14, ok) && !ok,
          "a late passcode callback is ignored; a short one reports only length_ok=false");
    check(jk_read_clusters::cluster_of(0x1470) == jk_read_clusters::kNoCluster, "no cluster, and so no cache entry, holds the passcode");
    // A full-length response with sentinel bytes: nothing of it lands anywhere.
    rt.request_passcode_status();
    int p = -1;
    for (uint32_t t = now; t < now + 3000 && p != Runtime::kPasscodeRead; t += 20) {
      p = rt.issue(t, false, false);
      if (p >= 0) { auto b = bytes_for(p, 0x11); rt.on_cluster_response(p, rt.generation(), b.data(), b.size(), t, false); }
    }
    const std::vector<uint8_t> sentinel(16, 0xA5);
    check(p == Runtime::kPasscodeRead && rt.on_passcode_response(rt.generation(), sentinel.size(), ok) && ok, "a full-length passcode response reports length_ok");
    bool leaked = false;
    for (std::size_t c2 = 0; c2 < kClusterCount; c2++)
      for (uint8_t b : rt.cache().entry(c2).bytes) leaked |= b == 0xA5;
    check(!leaked && rt.cache().register_raw(0x1470, 8, now).status == jk_cluster_cache::Lookup::CREDENTIAL,
          "the passcode bytes (sentinel 0xA5) are in no cluster cache entry; the cache refuses 0x1470 as CREDENTIAL");
  }

  // 5. Cross-task snapshot.
  {
    Driver d;
    d.rt.begin(0);
    ClusterSnapshotTable table;
    check(!read_cluster_snapshot(table, std::size_t(A1)).valid, "the snapshot is invalid (fail closed) until the main loop publishes it");
    d.lease = true;
    d.run(1000);
    d.rt.note_event_sequence(C1, 4242);  // the servicer's UI-visible success sequence
    publish_cluster_snapshot(table, d.rt, true);
    const auto s = read_cluster_snapshot(table, std::size_t(C1));
    check(s.valid && s.revision == d.rt.cache().entry(std::size_t(C1)).revision && s.sequence == 4242 &&
              s.active && !s.fallback && !read_cluster_snapshot(table, std::size_t(A1)).active,
          "published snapshot: revision, sequence, lease mode per cluster");
    check(!read_cluster_snapshot(table, kClusterCount).valid, "an out-of-range index is invalid, never out of bounds");
  }

  // 7. Bespoke fallback readers: only for a latched group, at their old
  // cadences, one read in flight, exact length, never RMW input.
  {
    Driver d;
    d.rt.begin(0);
    check(d.rt.issue_bespoke(0, false, true) == -1, "no bespoke read while every cluster runs normally");
    d.fail_mask = 1U << A1;
    d.run(20000);
    check(d.rt.cluster_fallback(A1) && !d.rt.cluster_fallback(C1), "A1 latched, C1 not");
    Runtime &rt = d.rt;
    uint32_t now = d.now;
    while (rt.busy()) { now += 20; rt.check_timeout(now); }
    check(rt.fallback_cell_image() == nullptr, "no fallback cell image before the cell block was read");
    check(rt.issue_bespoke(now, true, true) == -1, "a write in flight blocks the bespoke readers");
    const int cells = rt.issue_bespoke(now, false, false);
    check(cells == kBespokeCells && rt.busy() && rt.issue(now, false, false) == -1 && rt.issue_bespoke(now, false, false) == -1,
          "the cell block (0x1200 x53) is issued and owns the bus");
    std::vector<uint8_t> cell_block(106);
    for (std::size_t k = 0; k < cell_block.size(); k++) cell_block[k] = uint8_t(k);
    check(rt.on_bespoke_response(kBespokeCellsExt, rt.generation(), cell_block.data(), 32) == Completion::LATE && rt.busy(),
          "a response for another bespoke read is LATE");
    check(rt.on_bespoke_response(kBespokeCells, rt.generation(), cell_block.data(), 105) == Completion::WRONG_LENGTH && !rt.busy() &&
              rt.fallback_cell_image() == nullptr && rt.bespoke_errors(0) == 1,
          "exact length only: 105/106 bytes stores nothing");
    check(rt.issue_bespoke(now + 500, false, false) == -1, "the 1 s cadence holds after a failed read too");
    now += 1000;
    check(rt.issue_bespoke(now, false, false) == kBespokeCells, "the cell block is due again 1 s later");
    std::vector<uint8_t> too_long(107, 1);
    check(rt.on_bespoke_response(kBespokeCells, rt.generation(), too_long.data(), too_long.size()) == Completion::WRONG_LENGTH &&
              rt.fallback_cell_image() == nullptr && rt.bespoke_errors(0) == 2,
          "exact length only: 107/106 bytes (a longer response) stores nothing either");
    now += 1000;
    check(rt.issue_bespoke(now, false, false) == kBespokeCells, "... and the cell block is due again 1 s later");
    check(rt.on_bespoke_response(kBespokeCells, rt.generation(), cell_block.data(), 106) == Completion::OK, "a 106-byte cell block is accepted");
    const uint8_t *img = rt.fallback_cell_image();
    static const uint8_t kZeros[jk_cluster_runtime::kFallbackCellImageBytes] = {};
    const auto f = jk_cluster_cache::decode_cells_from_a1(img != nullptr ? img : kZeros, 16);
    check(img != nullptr && img[0] == 0 && img[105] == 105 && f.millivolts[1] == 0x0203 && f.milliohms[0] == uint16_t((74 << 8) | 75) &&
              f.native_max_index == 72 && f.native_min_index == 73 && !rt.fallback_cells_ext_valid(),
          "the image mirrors the A1 layout (voltages, resistances 1-16, native indexes 72/73)");
    check(rt.issue_bespoke(now, false, false) == -1, "without > 16 active channels the extension is never read");
    const int ext = rt.issue_bespoke(now, false, true);
    check(ext == kBespokeCellsExt, "with > 16 active channels the extension (0x126A x16) is read");
    std::vector<uint8_t> ext_block(32, 0xEE);
    check(rt.on_bespoke_response(ext, rt.generation(), ext_block.data(), 32) == Completion::OK && rt.fallback_cells_ext_valid() &&
              image_at(rt.fallback_cell_image(), 106) == 0xEE && image_at(rt.fallback_cell_image(), 137) == 0xEE && image_at(rt.fallback_cell_image(), 105) == 105,
          "the extension lands at byte 106 (0x126A - 0x1200) without touching the cell block");
    check(rt.issue_bespoke(now + 1000, false, true) == kBespokeCells, "next second: the cell block again, not the 15 s extension");
    rt.check_timeout(now + 1000 + kReadTimeoutMs);
    check(!rt.busy() && rt.bespoke_errors(0) == 3, "a bespoke read that never answers times out and frees the bus");
    check(rt.fallback_conwireres_image() == nullptr, "CellConWireRes is not read while C1/C2 run normally");
    check(rt.check_rmw(0x1240, 2, now).gate == RmwGate::REFUSE, "fallback bytes never feed an RMW merge");
  }
  {
    Driver d;
    d.rt.begin(0);
    d.fail_mask = 1U << C1;
    d.run(120000);
    check(d.rt.cluster_fallback(C1) && d.rt.cluster_fallback(C2) && !d.rt.cluster_fallback(A1), "C1 latched with its follower C2");
    Runtime &rt = d.rt;
    uint32_t now = d.now;
    while (rt.busy()) { now += 20; rt.check_timeout(now); }
    const int con = rt.issue_bespoke(now, false, false);
    check(con == kBespokeConWireRes, "a latched C group reads CellConWireRes 0-31 (0x1088 x64)");
    std::vector<uint8_t> con_block(128, 0x11);
    check(rt.on_bespoke_response(con, rt.generation(), con_block.data(), 128) == Completion::OK && rt.fallback_conwireres_image() != nullptr &&
              image_at(rt.fallback_conwireres_image(), 127) == 0x11,
          "... into its own 128-byte image");
    check(rt.issue_bespoke(now + 299000, false, false) == -1 && rt.issue_bespoke(now + 300000, false, false) == kBespokeConWireRes,
          "at the pre-migration 300 s cadence");
  }

  // 8. One tracked RMW request per write: one decision per step, exact 3.5 s
  // boundary, terminal QUEUE/REJECT (owner decision 2026-09-29).
  {
    const RmwWrite w{0x1114, 1, 0x0030, 4, 0x2};  // a 2-bit field at bits 4-5 of 0x1114 (C2)
    // Fresh C2 bytes stored at t0 (C1 then C2 read by the driver).
    Driver d;
    d.rt.begin(0);
    d.run(1000);
    const uint32_t t0 = d.rt.cache().entry(std::size_t(C2)).success_ms;
    const uint32_t raw = d.rt.check_rmw(0x1114, 1, t0).raw;
    RmwRequest q;
    check(q.step(d.rt, t0).step == RmwStep::IDLE, "an unarmed request never decides anything");
    check(q.arm(w, t0 + 3499) && !q.arm(w, t0 + 3499), "one request at a time");
    const RmwStepResult at = q.step(d.rt, t0 + 3500);
    check(at.step == RmwStep::QUEUE && at.old_raw == raw && at.merged_raw == ((raw & ~0x0030U) | (0x2U << 4)),
          "age exactly 3500 ms: QUEUE, with the merged raw of that very lookup");
    check(!q.active() && q.step(d.rt, t0 + 3500).step == RmwStep::IDLE, "QUEUE is terminal: no second decision for the request");
    RmwRequest late;
    late.arm(w, t0 + 3499);
    const RmwStepResult over = late.step(d.rt, t0 + 3501);
    check(over.step == RmwStep::WAIT && over.reason == jk_cluster_cache::Lookup::STALE && late.active(),
          "age 3501 ms: WAIT for a tracked pre-read -- never a rejection, never a write");
    // The race the old double gate had: decided READY at 3500, re-gated at
    // 3501. Now the one decision carries its raw; nothing is parked.
    RmwRequest one;
    one.arm(w, t0);
    const RmwStepResult d1 = one.step(d.rt, t0 + 3500);
    check(d1.step == RmwStep::QUEUE && !one.active() && one.step(d.rt, t0 + 3501).step == RmwStep::IDLE,
          "crossing the deadline after the decision changes nothing: queued once, nothing left to re-gate or park");
  }
  {
    // A request that ends rejected (deadline) can never write later, even
    // when fresh bytes land afterwards.
    Driver d;
    d.rt.begin(0);
    d.run(1000);
    const uint32_t t = d.now + 20000;  // C2 is 20 s old
    RmwRequest q;
    q.arm({0x1114, 1, 0x0030, 4, 0x1}, t);
    int queued = 0, rejected = 0, c1_issued = 0;
    for (uint32_t now = t; now < t + kRmwPreReadDeadlineMs + 5000; now += 20) {
      d.rt.check_timeout(now);
      const int c = d.rt.issue(now, false, false);
      if (c == C1) c1_issued++;  // the pre-read goes out ... and never answers (timeout)
      if (c == C2) {             // its follower fails fast (wrong length): the bus is free again at once
        auto shortc2 = bytes_for(C2, 4);
        d.rt.on_cluster_response(C2, d.rt.generation(), shortc2.data(), shortc2.size() - 2, now, false);
      }
      const auto r = q.step(d.rt, now);
      queued += r.step == RmwStep::QUEUE;
      rejected += r.step == RmwStep::REJECT;
      if (r.step == RmwStep::REJECT) check(r.deadline_expired && now >= t + kRmwPreReadDeadlineMs, "rejected exactly at the deadline");
    }
    check(c1_issued == 1, "exactly one pre-read per request, even when it fails");
    check(rejected == 1 && queued == 0, "a failed pre-read ends in one REJECT and no write");
    // Fresh bytes after the rejection:
    auto c1 = bytes_for(C1, 3), c2 = bytes_for(C2, 4);
    uint32_t now = t + kRmwPreReadDeadlineMs + 6000;
    while (d.rt.busy()) { now += 20; d.rt.check_timeout(now); }
    d.rt.check_rmw(0x1114, 1, now);  // an unrelated caller asks for a C1 read
    bool got_c2 = false;
    for (int k = 0; k < 100 && !got_c2; k++, now += 20) {
      const int c = d.rt.issue(now, false, false);
      if (c < 0) continue;
      const auto &b = c == C1 ? c1 : c == C2 ? c2 : bytes_for(c, 4);
      d.rt.on_cluster_response(c, d.rt.generation(), b.data(), b.size(), now, false);
      got_c2 |= c == C2;
    }
    check(got_c2 && d.rt.check_rmw(0x1114, 1, now).gate == RmwGate::READY, "(fresh C1/C2 bytes land after the rejection)");
    check(q.step(d.rt, now).step == RmwStep::IDLE && !q.active(),
          "REGRESSION: a request reported rejected / not queued never writes later");
  }
  // 9. Fallback RMW from the narrow block (plan section 10).
  {
    Driver d;
    d.rt.begin(0);
    d.fail_mask = 1U << C1;
    uint32_t observed_latch = 0;
    while (d.now < 120000 && observed_latch == 0) {
      d.run(d.now);  // one tick
      if (d.rt.cluster_fallback(C1)) observed_latch = d.now;
    }
    d.run(120000);
    check(d.rt.cluster_fallback(C2), "C1/C2 latched to the fallback");
    const uint32_t latched = d.rt.latched_ms(std::size_t(C2));
    check(latched != 0 && latched + 40 >= observed_latch && latched <= observed_latch, "the latch time is the real moment of the latch");
    uint32_t now = d.now;
    while (d.rt.busy()) { now += 20; d.rt.check_timeout(now); }
    const RmwWrite w{0x1114, 1, 0x0030, 4, 0x3};
    NarrowBlockView v;
    v.block = 42; v.address = 0x1114; v.register_count = 1;
    // No narrow success yet: one tracked narrow pre-read.
    RmwRequest q;
    q.arm(w, now);
    auto r = q.step(d.rt, now, v);
    check(r.step == RmwStep::WAIT && r.narrow && d.rt.narrow_request() == 42, "no narrow read yet: WAIT and one narrow pre-read of the register's block");
    check(d.rt.take_narrow_request() == 42 && d.rt.take_narrow_request() == -1, "the servicer takes the narrow request once");
    v.in_flight = true;
    check(q.step(d.rt, now + 20, v).step == RmwStep::WAIT && d.rt.narrow_request() == -1, "while it is in flight: no second request");
    v.in_flight = false;
    check(q.step(d.rt, now + 3100, v).step == RmwStep::WAIT && d.rt.narrow_request() == -1,
          "after a failed narrow pre-read: still one request per request, no retry storm");
    // The narrow read succeeds (after the latch) within the deadline.
    v.has_success = true; v.last_success_ms = now + 3200; v.raw = 0xABCD;
    r = q.step(d.rt, now + 3300, v);
    check(r.step == RmwStep::QUEUE && r.narrow && r.old_raw == 0xABCD && r.merged_raw == ((0xABCDU & ~0x0030U) | (0x3U << 4)),
          "fresh narrow data: QUEUE with the merge into the narrow raw");
    // Fresh narrow data at once / exact boundary / stale.
    RmwRequest f;
    f.arm(w, now + 3200);
    check(f.step(d.rt, now + 3200 + 3500, v).step == RmwStep::QUEUE, "narrow age exactly 3500 ms: QUEUE");
    RmwRequest g;
    g.arm(w, now + 3200);
    check(g.step(d.rt, now + 3200 + 3501, v).step == RmwStep::WAIT && d.rt.take_narrow_request() == 42, "narrow age 3501 ms: WAIT + narrow pre-read");
    // A narrow success from before the latch never counts.
    NarrowBlockView old = v;
    old.last_success_ms = latched - 100;  // 100 ms before the latch, well within the budget below
    RmwRequest h;
    h.arm(w, latched + 100);
    check(h.step(d.rt, latched + 100, old).step == RmwStep::WAIT, "a narrow success from before the latch is never an RMW source");
    // Failed narrow pre-read: deadline REJECT, no write, nothing later.
    RmwRequest k;
    NarrowBlockView none = v;
    none.has_success = false;
    k.arm(w, now);
    int queued = 0, rejected = 0;
    for (uint32_t t = now; t <= now + kRmwPreReadDeadlineMs + 2000; t += 20) {
      const auto s = k.step(d.rt, t, none);
      queued += s.step == RmwStep::QUEUE;
      rejected += s.step == RmwStep::REJECT;
    }
    check(queued == 0 && rejected == 1 && k.step(d.rt, now + 20000, v).step == RmwStep::IDLE,
          "a narrow pre-read that never succeeds rejects once at the deadline; fresh data later writes nothing");
    // The wrong block (address or width) is refused at once.
    RmwRequest m;
    NarrowBlockView wrong = v;
    wrong.register_count = 2;
    m.arm(w, now);
    check(m.step(d.rt, now, wrong).step == RmwStep::REJECT, "a narrow block that is not exactly the register is refused");
    NarrowBlockView fresh_ok = v;
    fresh_ok.last_success_ms = now + 50;
    check(m.step(d.rt, now + 60, fresh_ok).step == RmwStep::IDLE && !m.active(),
          "REJECT is terminal: the refused request never queues, even when a valid fresh view shows up");
    // The register's narrow block is already being read (its own cadence):
    // that read is the pre-read, no second one is asked for.
    RmwRequest inflight;
    NarrowBlockView busy = v;
    busy.has_success = false;
    busy.in_flight = true;
    d.rt.take_narrow_request();
    inflight.arm(w, now);
    check(inflight.step(d.rt, now, busy).step == RmwStep::WAIT && d.rt.narrow_request() == -1,
          "a narrow read already in flight serves as the pre-read (no extra request)");
    RmwRequest n;
    n.arm(w, now);
    check(n.step(d.rt, now).step == RmwStep::REJECT, "fallback without any narrow block view: refused, never guessed");
  }
  {
    // A request waiting on its cluster pre-read when the group latches: it
    // moves to the narrow source, asks for that pre-read once, queues once.
    Runtime rt;
    rt.begin(0);
    uint32_t now = 0;
    // Read everything once, then let C1 fail twice (not yet latched).
    for (; now < 1000; now += 20) {
      const int c = rt.issue(now, false, false);
      if (c >= 0) { auto b = bytes_for(c, 5); rt.on_cluster_response(c, rt.generation(), b.data(), b.size(), now, false); }
    }
    for (int fails = 0; fails < 2;) {
      rt.check_timeout(now);
      const int c = rt.issue(now, false, false);
      if (c == C1) fails++;
      else if (c == C2) {}  // its follower does not answer either, so C2's bytes go stale
      else if (c >= 0) { auto b = bytes_for(c, 5); rt.on_cluster_response(c, rt.generation(), b.data(), b.size(), now, false); }
      now += 20;
    }
    // Let the follower C2 queued after the failed C1 run out (it never answers).
    for (const uint32_t end = now + 4000; now < end; now += 20) {
      rt.check_timeout(now);
      const int c = rt.issue(now, false, false);
      if (c >= 0 && c != C1 && c != C2) { auto b = bytes_for(c, 5); rt.on_cluster_response(c, rt.generation(), b.data(), b.size(), now, false); }
    }
    while (rt.busy()) { now += 20; rt.check_timeout(now); }
    check(!rt.cluster_fallback(C1) && rt.health(std::size_t(C1)).consecutive_failures == 2 && !rt.scheduler().read_pending(C2),
          "(C1 has failed twice; nothing of C1/C2 is queued)");
    RmwRequest q;
    const RmwWrite w{0x1114, 1, 0x0030, 4, 0x1};
    const uint32_t t = now + 5000;
    q.arm(w, t);
    NarrowBlockView v;
    v.block = 42; v.address = 0x1114; v.register_count = 1;
    int queued = 0, rejected = 0, narrow_reads = 0, c1_reads = 0;
    for (now = t; now < t + 20000; now += 20) {
      rt.check_timeout(now);
      const int c = rt.issue(now, false, false);
      if (c == C1) c1_reads++;  // never answers: the third failure latches C1/C2
      else if (c == C2) {}
      else if (c >= 0) { auto b = bytes_for(c, 5); rt.on_cluster_response(c, rt.generation(), b.data(), b.size(), now, false); }
      if (rt.take_narrow_request() == 42) { narrow_reads++; v.has_success = true; v.last_success_ms = now + 10; v.raw = 0x0100; }
      const auto r = q.step(rt, now, v);
      queued += r.step == RmwStep::QUEUE;
      rejected += r.step == RmwStep::REJECT;
    }
    check(rt.cluster_fallback(C1) && c1_reads == 1, "the cluster pre-read failed and latched the group");
    check(narrow_reads == 1 && queued == 1 && rejected == 0, "then exactly one narrow pre-read and exactly one QUEUE -- no duplicate");
  }

  // 10. Write only when the register value changes (owner decision
  // 2026-09-29): NO_CHANGE is terminal -- no Modbus command, no slot, never later.
  {
    // C1 holds 0x1000 (U32 smart_sleep-like) at byte 0; C2 holds 0x1114 at
    // byte 36 and 0x1118 at byte 40 (address delta = byte offset).
    std::vector<uint8_t> c1b(kClusters[C1].payload_bytes, 0x00), c2b(kClusters[C2].payload_bytes, 0x00);
    c1b[0] = 0x00; c1b[1] = 0x00; c1b[2] = 0x0C; c1b[3] = 0xFD;  // 0x1000 = 3325
    c2b[36] = 0x12; c2b[37] = 0x34;                              // 0x1114 = 0x1234
    c2b[40] = 0xFF; c2b[41] = 0xFB;                              // 0x1118 = 0xFFFB (-5 as int16)
    Runtime rt;
    rt.begin(0);
    uint32_t now = 0;
    bool got_c1 = false, got_c2 = false;
    for (; now < 3000 && !(got_c1 && got_c2); now += 20) {
      const int c = rt.issue(now, false, false);
      if (c < 0) continue;
      const auto &b = c == C1 ? c1b : c == C2 ? c2b : bytes_for(c, 1);
      rt.on_cluster_response(c, rt.generation(), b.data(), b.size(), now, false);
      got_c1 |= c == C1; got_c2 |= c == C2;
    }
    check(got_c1 && got_c2, "(C1/C2 stored with known register values)");
    auto one = [&](const RmwWrite &w, uint32_t t, const NarrowBlockView &v = NarrowBlockView()) {
      RmwRequest q;
      q.arm(w, t);
      const RmwStepResult r = q.step(rt, t, v);
      const bool terminal_ok = r.step == RmwStep::WAIT || !q.active();
      return std::make_pair(r, terminal_ok && q.step(rt, t + 10, v).step != RmwStep::QUEUE);
    };
    // 1. RMW: the requested field value is already present.
    RmwWrite rmw{0x1114, 1, 0x0030, 4, 0x3};  // bits 4-5 of 0x1234 = 0b11
    auto [r1, never1] = one(rmw, now);
    check(r1.step == RmwStep::NO_CHANGE && r1.old_raw == 0x1234 && r1.merged_raw == 0x1234 && never1,
          "RMW, field already at the requested value: NO_CHANGE (terminal, nothing to queue)");
    // 4/5. Changed field: exactly one minimal write, siblings preserved.
    RmwWrite rmw2{0x1114, 1, 0x0030, 4, 0x1};
    auto [r2, never2] = one(rmw2, now);
    check(r2.step == RmwStep::QUEUE && r2.merged_raw == 0x1214 && (r2.merged_raw & ~0x0030U) == (0x1234U & ~0x0030U),
          "RMW, changed field: QUEUE the one register 0x1114 with every sibling bit preserved (0x1234 -> 0x1214)");
    // 2. Full-width 16-bit (signed: -5 encodes as 0xFFFFFFFB, compared at 16 bits).
    RmwWrite u16same; u16same.address = 0x1118; u16same.word_count = 1; u16same.full_width = true; u16same.encoded = uint32_t(int32_t(-5));
    check(one(u16same, now).first.step == RmwStep::NO_CHANGE, "16-bit full-width value already present (signed -5 == 0xFFFB): NO_CHANGE");
    RmwWrite u16diff = u16same; u16diff.encoded = 0x0010;
    const auto r16 = one(u16diff, now).first;
    check(r16.step == RmwStep::QUEUE && r16.merged_raw == 0x0010 && u16diff.tx_compare_mask() == 0xFFFFFFFFU,
          "16-bit changed: QUEUE exactly the encoded register value, full readback compare");
    // 3. Full-width 32-bit.
    RmwWrite u32same; u32same.address = 0x1000; u32same.word_count = 2; u32same.full_width = true; u32same.encoded = 3325;
    check(one(u32same, now).first.step == RmwStep::NO_CHANGE, "32-bit full-width value already present: NO_CHANGE");
    RmwWrite u32diff = u32same; u32diff.encoded = 3326;
    const auto r32 = one(u32diff, now).first;
    check(r32.step == RmwStep::QUEUE && r32.old_raw == 3325 && r32.merged_raw == 3326, "32-bit changed (one LSB): QUEUE the 2-register value");
    // 8. NO_CHANGE never executes later, even after the value changes.
    RmwRequest q;
    q.arm(u32same, now);
    check(q.step(rt, now).step == RmwStep::NO_CHANGE && !q.active(), "(NO_CHANGE disarms)");
    c1b[3] = 0xFE;  // the register changes afterwards
    for (uint32_t t = now; t < now + 20000; t += 20) {
      rt.check_timeout(t);
      const int c = rt.issue(t, false, false);
      if (c >= 0) { const auto &b = c == C1 ? c1b : c == C2 ? c2b : bytes_for(c, 1); rt.on_cluster_response(c, rt.generation(), b.data(), b.size(), t, false); }
      if (q.step(rt, t).step != RmwStep::IDLE) { check(false, "a NO_CHANGE request decided again"); break; }
    }
    check(!q.active(), "NO_CHANGE is terminal: 20 s later, with a changed register, still nothing to queue");
    // 7. Stale value: one pre-read, never a NO_CHANGE or write from stale bytes.
    const uint32_t stale_t = now + 60000;
    RmwRequest st;
    st.arm(u32same, stale_t);
    const auto sr = st.step(rt, stale_t);
    check(sr.step == RmwStep::WAIT, "stale current value: WAIT for a pre-read -- no NO_CHANGE decided from stale bytes");
  }
  // 6. Cluster mode and the latched fallback's narrow source decide identically.
  {
    Driver d;
    d.rt.begin(0);
    d.fail_mask = 1U << C1;
    d.run(120000);
    uint32_t now = d.now;
    while (d.rt.busy()) { now += 20; d.rt.check_timeout(now); }
    NarrowBlockView v;
    v.block = 7; v.address = 0x1114; v.register_count = 1; v.has_success = true; v.last_success_ms = now; v.raw = 0x1234;
    RmwRequest same, diff;
    same.arm({0x1114, 1, 0x0030, 4, 0x3}, now);
    diff.arm({0x1114, 1, 0x0030, 4, 0x1}, now);
    const auto a = same.step(d.rt, now, v), b = diff.step(d.rt, now, v);
    check(a.step == RmwStep::NO_CHANGE && a.narrow && b.step == RmwStep::QUEUE && b.merged_raw == 0x1214,
          "fallback narrow source: the same NO_CHANGE / QUEUE(0x1214) decisions as cluster mode");
    NarrowBlockView v32;
    v32.block = 3; v32.address = 0x1000; v32.register_count = 2; v32.has_success = true; v32.last_success_ms = now; v32.raw = 3325;
    RmwWrite u32; u32.address = 0x1000; u32.word_count = 2; u32.full_width = true; u32.encoded = 3325;
    RmwRequest n32;
    n32.arm(u32, now);
    check(n32.step(d.rt, now, v32).step == RmwStep::NO_CHANGE, "fallback narrow source, 32-bit value already present: NO_CHANGE");
    // A failed narrow pre-read: REJECT, never NO_CHANGE, never a write.
    NarrowBlockView none = v32; none.has_success = false;
    RmwRequest f;
    f.arm(u32, now);
    int writes = 0, nochange = 0, rejects = 0;
    for (uint32_t t = now; t <= now + kRmwPreReadDeadlineMs + 1000; t += 20) {
      const auto r = f.step(d.rt, t, none);
      writes += r.step == RmwStep::QUEUE; nochange += r.step == RmwStep::NO_CHANGE; rejects += r.step == RmwStep::REJECT;
    }
    check(writes == 0 && nochange == 0 && rejects == 1, "failed narrow pre-read: one REJECT, zero writes, no NO_CHANGE guess");
  }
  // HA entity pool: at most one tracked request per register.
  {
    std::array<RmwRequest, 2> pool;
    RmwWrite a{0x1114, 1, 0x0030, 4, 0x1}, a2{0x1114, 1, 0x0003, 0, 0x1}, b{0x1118, 1, 0xFF00, 8, 0x5}, c{0x1000, 2, 0, 0, 7, true};
    check(arm_write(pool, a, 0) == ArmResult::ARMED && arm_write(pool, a, 1) == ArmResult::ALREADY_WAITING &&
              arm_write(pool, a2, 2) == ArmResult::REGISTER_BUSY && arm_write(pool, b, 3) == ArmResult::ARMED &&
              arm_write(pool, c, 4) == ArmResult::POOL_FULL,
          "entity pool: armed / same write already waiting / another write to that register refused / pool full refused");
  }

  std::printf("cluster runtime: %d/%d checks passed\n", g_checks - g_failures, g_checks);
  return g_failures == 0 ? 0 : 1;
}
