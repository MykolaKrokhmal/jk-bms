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
    Driver d;
    d.rt.begin(0);
    d.run(2000);
    check(d.passcode_reads == 1, "the setup-passcode status read runs exactly once after boot");
    d.rt.request_passcode_status();
    d.run(4000);
    check(d.passcode_reads == 2, "... and again only on request");
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
    DeferredRmw w;
    w.start(1000);
    check(w.active && !w.expired(1000 + kRmwPreReadDeadlineMs - 1) && w.expired(1000 + kRmwPreReadDeadlineMs),
          "a deferred write waits at most kRmwPreReadDeadlineMs, then is refused as stale");
  }

  // 4. The passcode read never exposes bytes.
  {
    Runtime rt;
    rt.begin(0);
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

  std::printf("cluster runtime: %d/%d checks passed\n", g_checks - g_failures, g_checks);
  return g_failures == 0 ? 0 : 1;
}
