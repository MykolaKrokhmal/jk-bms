#pragma once
// jk_cluster_runtime_core.h -- pure, hardware-independent runtime of the
// production clustered read path (docs/project/RS485_CLUSTERED_READ_MIGRATION_PLAN.md,
// M5). No ESPHome, no Modbus, no I/O: the generated servicer
// (protocol/generated/read_plan.yaml) and batterylifepo4.yaml drive it and
// do the actual Modbus/publish work. Desktop-tested by
// test/jk_poll_scheduler/test_jk_cluster_runtime_core.cpp.
//
//   - one read in flight at a time across clusters AND the isolated
//     setup-passcode read (bus ownership); a write in flight pauses both;
//   - a response is accepted only for the read in flight (matching cluster
//     and generation); a late one is dropped;
//   - fallback latch: kFallbackAfterFailures consecutive failed reads of a
//     cluster (timeout or wrong length) latch that cluster and its followers
//     to the legacy per-register reads for the rest of the boot session.
//     It never unlatches (no oscillation) and is always visible
//     (fallback_mask(), the diagnostics text and the freshness snapshot);
//   - RMW gate: a write merges only into bytes fresher than the strict
//     budget (jk_cluster_cache::kRmwStrictBudgetMs). Missing or stale bytes
//     trigger ONE tracked pre-read and the write waits (up to
//     kRmwPreReadDeadlineMs); credential, unknown or bad-width data refuse
//     at once. In a latched fallback group the source is the register's own
//     narrow read-plan block (plan section 10): its success time after the
//     latch, under the same strict budget, with a narrow pre-read;
//   - RmwRequest: one register write (a packed field merged into its
//     register, or a full-width 16/32-bit value) = one tracked gate. Every
//     step() is a single decision against the current raw: QUEUE with the
//     merged raw, NO_CHANGE when that raw already holds it (no write at all),
//     WAIT, or REJECT. QUEUE, NO_CHANGE and REJECT are terminal, so such a
//     request can never be queued later, and the caller queues exactly the
//     raw that decision returned (no second gate);
//   - the passcode read (0x1470 x8, not in any cluster) is strictly on
//     demand: never after boot, never periodic, only after
//     request_passcode_status(). Its bytes are never stored or returned --
//     the caller only learns whether the read had the expected length;
//   - a latched group also gets back the pre-migration bespoke readers of
//     the registers the generic per-register plan never read (cells, cell
//     wire resistance 17-32, CellConWireRes 0-31) at their old cadences,
//     under the same one-read-in-flight ownership. Their bytes go to a
//     fallback image laid out like the cluster payload, are published from
//     there and are never RMW input.

#include <array>
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <cstdio>

#include "jk_cluster_cache_core.h"
#include "jk_write_tx_core.h"
#include "jk_cluster_scheduler_core.h"
#include "read_clusters_table.h"

namespace jk_cluster_runtime {

using jk_read_clusters::kClusterCount;
using jk_read_clusters::kClusters;

constexpr uint8_t kFallbackAfterFailures = 3;
// Same servicer timeout as the per-register servicer it replaces: the
// production Modbus hub keeps its default send_wait_time and retries (the
// write path depends on them), so a read is only given up after 3 s.
constexpr uint32_t kReadTimeoutMs = 3000;
// How long a write waits for the pre-read of its cluster before it is
// refused as stale: at most one read in flight (3 s) + the pre-read itself.
constexpr uint32_t kRmwPreReadDeadlineMs = 6500;
constexpr uint16_t kPasscodeStart = jk_read_clusters::kIsolatedReads[0].start;
constexpr uint16_t kPasscodeRegisters = jk_read_clusters::kIsolatedReads[0].register_count;
static_assert(jk_read_clusters::kIsolatedReadCount == 1 && kPasscodeStart == 0x1470 && kPasscodeRegisters == 8,
              "the only isolated read is the setup passcode 0x1470 x8");

enum class InFlight : uint8_t { NONE = 0, CLUSTER = 1, PASSCODE = 2, BESPOKE = 3 };

// The pre-migration bespoke readers (removed from the normal path by M5),
// restored only for a latched fallback group. image_start is the address
// whose byte 0 the fallback image mirrors (the owning cluster's layout);
// publish_start is the cluster whose publisher decodes the image.
struct BespokeRead {
  uint16_t start;
  uint16_t registers;
  uint16_t image_start;
  uint16_t publish_start;
  uint32_t cadence_ms;
};
constexpr std::size_t kBespokeCount = 3;
constexpr BespokeRead kBespokeReads[kBespokeCount] = {
    {0x1200, 53, 0x1200, 0x1200, 1000},    // cell_voltage_1-32, cell_resistance_1-16, native min/max index
    {0x126A, 16, 0x1200, 0x1200, 15000},   // cell_resistance_17-32, only while > 16 channels are active
    {0x1088, 64, 0x1088, 0x10F0, 300000},  // CellConWireRes 0-31 (4 bytes per channel)
};
constexpr int kBespokeCells = 0, kBespokeCellsExt = 1, kBespokeConWireRes = 2;
constexpr std::size_t kFallbackCellImageBytes = 2U * 120U;   // the A1 payload layout
constexpr std::size_t kFallbackConWireResBytes = 2U * 64U;
// JK addresses advance by 2 per register, so a byte offset is an address delta.
static_assert((0x126A - 0x1200) + 2U * 16U <= kFallbackCellImageBytes, "ext resistances fit the A1 image");
static_assert(2U * 53U == (0x126A - 0x1200), "the cell block ends where the extension starts");
static_assert(2U * 64U == kFallbackConWireResBytes, "CellConWireRes 0-31 is 32 x 4 bytes");
enum class Completion : uint8_t { OK = 0, WRONG_LENGTH = 1, TIMEOUT = 2, LATE = 3 };
enum class RmwGate : uint8_t { READY = 0, WAIT = 1, REFUSE = 2 };

struct ClusterHealth {
  uint8_t consecutive_failures = 0;
  uint32_t successes = 0, timeouts = 0, length_errors = 0;
  bool fallback = false;
};

struct RmwDecision {
  RmwGate gate = RmwGate::REFUSE;
  jk_cluster_cache::Lookup reason = jk_cluster_cache::Lookup::UNKNOWN;
  uint32_t raw = 0;
  int cluster = jk_read_clusters::kNoCluster;
  bool narrow = false;  // decided from the narrow fallback block, not the cluster
};

// The register's own narrow read-plan block, as the servicer's fallback path
// maintains it (g_rp_last_success_ms / g_rp_last_raw_word / g_rp_pending_index).
// Only consulted when the owning cluster is latched to its fallback.
struct NarrowBlockView {
  int block = -1;               // read-plan block index; -1: none
  uint16_t address = 0;
  uint16_t register_count = 0;
  bool has_success = false;
  uint32_t last_success_ms = 0;
  uint32_t raw = 0;             // the block's first (up to 4) payload bytes
  bool in_flight = false;       // this block's narrow read is outstanding
};

// Builds the view from the generated read plan and the servicer's globals.
template <typename Blocks>
inline NarrowBlockView make_narrow_view(const Blocks &blocks, std::size_t block_count, uint16_t address,
                                        const uint32_t *last_success_ms, const uint32_t *last_raw_word, int pending_index) {
  NarrowBlockView v;
  for (std::size_t i = 0; i < block_count; i++) {
    if (blocks[i].address != address) continue;
    v.block = int(i);
    v.address = blocks[i].address;
    v.register_count = blocks[i].register_count;
    v.has_success = last_success_ms[i] != 0;
    v.last_success_ms = last_success_ms[i];
    v.raw = last_raw_word[i];
    v.in_flight = pending_index == int(i);
    break;
  }
  return v;
}

class Runtime {
 public:
  void begin(uint32_t now_ms) {
    sched_.begin(now_ms);
    in_flight_ = InFlight::NONE;
    in_flight_cluster_ = -1;
    passcode_requested_ = false;  // strictly on demand: no read after boot
    narrow_request_ = -1;
    latched_ms_.fill(0);
    for (auto &h : health_) h = ClusterHealth();
    event_sequence_.fill(0);
    bespoke_issued_.fill(false);
    bespoke_errors_.fill(0);
    cells_valid_ = cells_ext_valid_ = conwireres_valid_ = false;
    begun_ = true;
  }
  bool begun() const { return begun_; }

  // Next read to issue now: a cluster index (>= 0), kPasscodeRead, or -1.
  static constexpr int kPasscodeRead = -2;
  static constexpr int kBespokeRead = -3;  // check_timeout() only
  int issue(uint32_t now_ms, bool write_in_flight, bool settings_lease) {
    if (!begun_ || in_flight_ != InFlight::NONE) return -1;
    sched_.set_settings_lease(settings_lease, now_ms);
    const int c = sched_.next(now_ms, write_in_flight);
    if (c >= 0) {
      in_flight_ = InFlight::CLUSTER;
      in_flight_cluster_ = c;
      started_ms_ = now_ms;
      ++generation_;
      return c;
    }
    if (passcode_requested_ && !write_in_flight) {
      passcode_requested_ = false;
      in_flight_ = InFlight::PASSCODE;
      started_ms_ = now_ms;
      ++generation_;
      return kPasscodeRead;
    }
    return -1;
  }

  // Next bespoke fallback read (kBespoke*), or -1. Only for a latched owner
  // group, only when nothing else is in flight or due; a missed cadence slot
  // is skipped, never replayed.
  int issue_bespoke(uint32_t now_ms, bool write_in_flight, bool ext_needed) {
    if (!begun_ || in_flight_ != InFlight::NONE || write_in_flight) return -1;
    for (std::size_t i = 0; i < kBespokeCount; i++) {
      const BespokeRead &b = kBespokeReads[i];
      if (!cluster_fallback(jk_read_clusters::cluster_of(b.start))) continue;
      if (int(i) == kBespokeCellsExt && !ext_needed) continue;
      if (bespoke_issued_[i] && uint32_t(now_ms - bespoke_last_issue_ms_[i]) < b.cadence_ms) continue;
      bespoke_issued_[i] = true;
      bespoke_last_issue_ms_[i] = now_ms;
      in_flight_ = InFlight::BESPOKE;
      in_flight_bespoke_ = int(i);
      started_ms_ = now_ms;
      ++generation_;
      return int(i);
    }
    return -1;
  }

  // A bespoke response: exact length only, copied into its fallback image.
  Completion on_bespoke_response(int which, uint32_t gen, const uint8_t *data, std::size_t len) {
    if (in_flight_ != InFlight::BESPOKE || which != in_flight_bespoke_ || gen != generation_) return Completion::LATE;
    in_flight_ = InFlight::NONE;
    in_flight_bespoke_ = -1;
    const BespokeRead &b = kBespokeReads[std::size_t(which)];
    if (len != std::size_t(2U * b.registers)) {
      bespoke_errors_[std::size_t(which)]++;
      return Completion::WRONG_LENGTH;
    }
    const std::size_t at = std::size_t(b.start - b.image_start);  // address delta = byte offset
    uint8_t *image = which == kBespokeConWireRes ? conwireres_image_.data() : cell_image_.data();
    for (std::size_t k = 0; k < len; k++) image[at + k] = data[k];
    if (which == kBespokeCells) cells_valid_ = true;
    else if (which == kBespokeCellsExt) cells_ext_valid_ = true;
    else conwireres_valid_ = true;
    return Completion::OK;
  }
  // The fallback cell image (A1 layout): valid once the cell block was read;
  // cell_resistance_17-32 only once the extension was read too.
  const uint8_t *fallback_cell_image() const { return cells_valid_ ? cell_image_.data() : nullptr; }
  bool fallback_cells_ext_valid() const { return cells_ext_valid_; }
  // CellConWireRes 0-31 (big-endian uint32 per channel), or nullptr.
  const uint8_t *fallback_conwireres_image() const { return conwireres_valid_ ? conwireres_image_.data() : nullptr; }
  uint32_t bespoke_errors(std::size_t i) const { return bespoke_errors_[i]; }

  uint32_t generation() const { return generation_; }
  bool busy() const { return in_flight_ != InFlight::NONE; }
  InFlight in_flight() const { return in_flight_; }
  int in_flight_cluster() const { return in_flight_cluster_; }

  // A cluster response. OK: the bytes are in cache() and the caller decodes
  // and publishes them. WRONG_LENGTH: nothing was stored. LATE: not the read
  // in flight -- ignored entirely.
  Completion on_cluster_response(int cluster, uint32_t gen, const uint8_t *data, std::size_t len, uint32_t now_ms, bool lease) {
    if (in_flight_ != InFlight::CLUSTER || cluster != in_flight_cluster_ || gen != generation_) return Completion::LATE;
    const auto st = cache_.store(cluster, data, len, now_ms, lease);
    finish_cluster(cluster, now_ms, st == jk_cluster_cache::StoreStatus::OK ? Completion::OK : Completion::WRONG_LENGTH);
    return st == jk_cluster_cache::StoreStatus::OK ? Completion::OK : Completion::WRONG_LENGTH;
  }

  // The passcode read's terminal outcome: only "had the expected length",
  // never the bytes. Returns false for a late or foreign callback.
  bool on_passcode_response(uint32_t gen, std::size_t len, bool &length_ok) {
    if (in_flight_ != InFlight::PASSCODE || gen != generation_) return false;
    length_ok = len == std::size_t(2U * kPasscodeRegisters);
    in_flight_ = InFlight::NONE;
    return true;
  }
  // The only way to read 0x1470: one isolated read per request.
  void request_passcode_status() { passcode_requested_ = true; }
  bool passcode_requested() const { return passcode_requested_; }

  // The UI-visible success sequence ('<cluster>:<revision>:<sequence>' and
  // the fallback blocks' events share one counter) of this cluster's last
  // success event, for the freshness snapshot.
  void note_event_sequence(int cluster, uint32_t sequence) {
    if (cluster >= 0 && std::size_t(cluster) < kClusterCount) event_sequence_[std::size_t(cluster)] = sequence;
  }
  uint32_t event_sequence(std::size_t c) const { return event_sequence_[c]; }

  // Called every tick: gives up the read in flight after kReadTimeoutMs.
  // Returns the cluster that timed out (or kPasscodeRead), else -1.
  int check_timeout(uint32_t now_ms) {
    if (in_flight_ == InFlight::NONE || uint32_t(now_ms - started_ms_) < kReadTimeoutMs) return -1;
    if (in_flight_ == InFlight::PASSCODE) { in_flight_ = InFlight::NONE; return kPasscodeRead; }
    if (in_flight_ == InFlight::BESPOKE) {
      bespoke_errors_[std::size_t(in_flight_bespoke_)]++;
      in_flight_ = InFlight::NONE;
      in_flight_bespoke_ = -1;
      return kBespokeRead;
    }
    const int c = in_flight_cluster_;
    finish_cluster(c, now_ms, Completion::TIMEOUT);
    return c;
  }

  // RMW gate for a register write (strict budget + pre-read). `narrow` is
  // the register's narrow read-plan block, used only when its cluster is
  // latched to the fallback (plan section 10). allow_*_preread = false:
  // decide only, never ask for that pre-read again (RmwRequest asks at most
  // once per request and source).
  RmwDecision check_rmw(uint16_t address, uint8_t word_count, uint32_t now_ms, const NarrowBlockView &narrow = NarrowBlockView(),
                        bool allow_cluster_preread = true, bool allow_narrow_preread = true) {
    RmwDecision d;
    const auto r = cache_.register_raw(address, word_count, now_ms);
    d.reason = r.status;
    d.cluster = r.cluster;
    if (r.status == jk_cluster_cache::Lookup::OK) { d.gate = RmwGate::READY; d.raw = r.raw; return d; }
    if (r.status == jk_cluster_cache::Lookup::FALLBACK) return check_rmw_narrow(r.cluster, address, word_count, now_ms, narrow, allow_narrow_preread);
    if (r.status == jk_cluster_cache::Lookup::STALE || r.status == jk_cluster_cache::Lookup::MISSING) {
      // Not while it (or its lead's cycle) is already queued or in flight.
      const int lead = kClusters[r.cluster].sequence_after == jk_read_clusters::kNoCluster ? r.cluster : kClusters[r.cluster].sequence_after;
      const bool in_flight = in_flight_ == InFlight::CLUSTER && (in_flight_cluster_ == r.cluster || in_flight_cluster_ == lead);
      if (allow_cluster_preread && !in_flight && !sched_.read_pending(r.cluster)) sched_.request_now(r.cluster);
      d.gate = RmwGate::WAIT;
      return d;
    }
    d.gate = RmwGate::REFUSE;
    return d;
  }

  // The narrow block a fallback RMW asked to pre-read (then forgotten), or -1.
  int take_narrow_request() {
    const int b = narrow_request_;
    narrow_request_ = -1;
    return b;
  }
  int narrow_request() const { return narrow_request_; }
  uint32_t latched_ms(std::size_t c) const { return latched_ms_[c]; }

  const jk_cluster_cache::Cache &cache() const { return cache_; }
  const jk_cluster_scheduler::Scheduler &scheduler() const { return sched_; }
  const ClusterHealth &health(std::size_t c) const { return health_[c]; }
  bool cluster_fallback(int c) const { return c >= 0 && std::size_t(c) < kClusterCount && health_[std::size_t(c)].fallback; }
  uint32_t fallback_mask() const {
    uint32_t m = 0;
    for (std::size_t i = 0; i < kClusterCount; i++) if (health_[i].fallback) m |= 1U << i;
    return m;
  }

  // "clusters" or "fallback:A1,A2" -- the diagnostics text.
  int format_mode(char *buf, std::size_t n) const {
    if (fallback_mask() == 0) return std::snprintf(buf, n, "clusters");
    int w = std::snprintf(buf, n, "fallback:");
    bool first = true;
    for (std::size_t i = 0; i < kClusterCount && w >= 0 && std::size_t(w) < n; i++) {
      if (!health_[i].fallback) continue;
      w += std::snprintf(buf + w, n - std::size_t(w), "%s%s", first ? "" : ",", kClusters[i].id);
      first = false;
    }
    return w;
  }

 private:
  // Plan section 10: in a latched group the register's own narrow block is
  // the RMW source -- only a success AFTER the latch, only within the strict
  // budget, and the exact register (address and width), else refuse.
  RmwDecision check_rmw_narrow(int cluster, uint16_t address, uint8_t word_count, uint32_t now_ms, const NarrowBlockView &n,
                               bool request_preread) {
    RmwDecision d;
    d.cluster = cluster;
    d.narrow = true;
    d.reason = jk_cluster_cache::Lookup::FALLBACK;
    if (n.block < 0 || n.address != address || n.register_count != word_count) return d;  // REFUSE
    const bool after_latch = n.has_success && int32_t(n.last_success_ms - latched_ms_[std::size_t(cluster)]) > 0;
    if (after_latch && uint32_t(now_ms - n.last_success_ms) <= jk_cluster_cache::kRmwStrictBudgetMs) {
      d.gate = RmwGate::READY;
      d.reason = jk_cluster_cache::Lookup::OK;
      d.raw = word_count == 1 ? (n.raw & 0xFFFFU) : n.raw;
      return d;
    }
    d.reason = after_latch ? jk_cluster_cache::Lookup::STALE : jk_cluster_cache::Lookup::MISSING;
    if (request_preread && !n.in_flight) narrow_request_ = n.block;
    d.gate = RmwGate::WAIT;
    return d;
  }

  void finish_cluster(int c, uint32_t now_ms, Completion outcome) {
    ClusterHealth &h = health_[std::size_t(c)];
    if (outcome == Completion::OK) {
      h.successes++;
      h.consecutive_failures = 0;
    } else {
      if (outcome == Completion::TIMEOUT) h.timeouts++; else h.length_errors++;
      if (h.consecutive_failures < 0xFF) h.consecutive_failures++;
      if (!h.fallback && h.consecutive_failures >= kFallbackAfterFailures) latch_fallback(c, now_ms);
    }
    sched_.complete(c, now_ms);
    in_flight_ = InFlight::NONE;
    in_flight_cluster_ = -1;
  }

  // The lead's group (lead + followers) moves to the legacy readers for good.
  void latch_fallback(int c, uint32_t now_ms) {
    const int lead = kClusters[c].sequence_after == jk_read_clusters::kNoCluster ? c : kClusters[c].sequence_after;
    for (std::size_t i = 0; i < kClusterCount; i++) {
      if (int(i) == lead || kClusters[i].sequence_after == lead) {
        health_[i].fallback = true;
        latched_ms_[i] = now_ms;
        cache_.mark_fallback(int(i));
      }
    }
    sched_.set_enabled(lead, false);
  }

  jk_cluster_scheduler::Scheduler sched_;
  jk_cluster_cache::Cache cache_;
  std::array<ClusterHealth, kClusterCount> health_{};
  std::array<uint32_t, kClusterCount> event_sequence_{};
  InFlight in_flight_ = InFlight::NONE;
  int in_flight_cluster_ = -1;
  uint32_t started_ms_ = 0;
  uint32_t generation_ = 0;
  bool passcode_requested_ = false;
  bool begun_ = false;
  int narrow_request_ = -1;
  std::array<uint32_t, kClusterCount> latched_ms_{};
  int in_flight_bespoke_ = -1;
  std::array<bool, kBespokeCount> bespoke_issued_{};
  std::array<uint32_t, kBespokeCount> bespoke_last_issue_ms_{};
  std::array<uint32_t, kBespokeCount> bespoke_errors_{};
  std::array<uint8_t, kFallbackCellImageBytes> cell_image_{};
  std::array<uint8_t, kFallbackConWireResBytes> conwireres_image_{};
  bool cells_valid_ = false, cells_ext_valid_ = false, conwireres_valid_ = false;
};

// --- One tracked RMW request -------------------------------------------------
// A write request's RMW gate from arm() to its one terminal decision. Each
// step() is ONE decision against ONE lookup; the merged raw it returns is the
// raw the caller queues (never re-gated), so a request cannot pass one gate
// and fail another. QUEUE and REJECT disarm the request for good: a rejected
// request can never be queued later. WAIT asks for exactly one pre-read per
// request and source (the cluster, or the narrow block in fallback) and expires at
// kRmwPreReadDeadlineMs.
// NO_CHANGE: the register already holds exactly the value that would be
// written -- a terminal success, not a failure: no Modbus command, no write
// transaction slot, no ACK/readback, nothing later.
enum class RmwStep : uint8_t { IDLE = 0, QUEUE = 1, WAIT = 2, REJECT = 3, NO_CHANGE = 4 };

inline uint32_t register_width_mask(uint8_t word_count) { return word_count >= 2 ? 0xFFFFFFFFU : 0xFFFFU; }

struct RmwWrite {
  uint16_t address = 0;
  uint8_t word_count = 0;
  uint32_t mask = 0;        // packed field mask (ignored for a full-width write)
  uint8_t shift = 0;
  uint32_t encoded = 0;     // the field's / register's encoded raw
  bool full_width = false;  // the whole register (16 or 32 bits) is the value
  // What begin_write_tx compares on readback: the field, or the whole register.
  uint32_t tx_compare_mask() const { return full_width ? 0xFFFFFFFFU : mask; }
  bool operator==(const RmwWrite &o) const {
    return address == o.address && word_count == o.word_count && mask == o.mask && shift == o.shift && encoded == o.encoded &&
           full_width == o.full_width;
  }
};

struct RmwStepResult {
  RmwStep step = RmwStep::IDLE;
  uint32_t old_raw = 0;
  uint32_t merged_raw = 0;  // QUEUE: exactly what to write (NO_CHANGE: == old_raw)
  jk_cluster_cache::Lookup reason = jk_cluster_cache::Lookup::UNKNOWN;
  bool deadline_expired = false;
  bool narrow = false;
};

class RmwRequest {
 public:
  bool active() const { return active_; }
  const RmwWrite &write() const { return w_; }
  uint32_t deadline_ms() const { return deadline_ms_; }
  // Starts tracking one request; false while another one is active.
  bool arm(const RmwWrite &w, uint32_t now_ms) {
    if (active_) return false;
    active_ = true;
    w_ = w;
    deadline_ms_ = now_ms + kRmwPreReadDeadlineMs;
    cluster_preread_requested_ = narrow_preread_requested_ = false;
    return true;
  }
  // The caller dropped the request for another reason (terminal, too).
  void cancel() { active_ = false; }

  RmwStepResult step(Runtime &rt, uint32_t now_ms, const NarrowBlockView &narrow = NarrowBlockView()) {
    RmwStepResult r;
    if (!active_) return r;  // IDLE: nothing tracked, nothing to write
    const RmwDecision d = rt.check_rmw(w_.address, w_.word_count, now_ms, narrow, !cluster_preread_requested_, !narrow_preread_requested_);
    r.reason = d.reason;
    r.narrow = d.narrow;
    if (d.gate == RmwGate::READY) {
      active_ = false;
      r.old_raw = d.raw;
      r.merged_raw = w_.full_width ? (w_.encoded & register_width_mask(w_.word_count))
                                   : jk_write_tx::merge_field_into_raw(d.raw, w_.mask, w_.shift, w_.encoded);
      // Write only when the register value actually changes.
      r.step = r.merged_raw == r.old_raw ? RmwStep::NO_CHANGE : RmwStep::QUEUE;
      return r;
    }
    if (d.gate == RmwGate::REFUSE) {
      active_ = false;
      r.step = RmwStep::REJECT;
      return r;
    }
    if (int32_t(now_ms - deadline_ms_) >= 0) {
      active_ = false;
      r.step = RmwStep::REJECT;
      r.deadline_expired = true;
      return r;
    }
    (d.narrow ? narrow_preread_requested_ : cluster_preread_requested_) = true;
    r.step = RmwStep::WAIT;
    return r;
  }

 private:
  bool active_ = false;
  RmwWrite w_;
  uint32_t deadline_ms_ = 0;
  bool cluster_preread_requested_ = false, narrow_preread_requested_ = false;
};

// --- Cross-task cluster snapshot for GET /settings/read-freshness -----------
// The httpd task must never read the runtime directly (non-atomic, main-loop
// owned). The main loop publishes this table; the handler reads it with the
// same monotonic-version seqlock as jk_preflight_snapshot_core.h.
struct ClusterSnapshotSlot {
  std::atomic<uint32_t> version{0};
  std::atomic<uint32_t> last_success_ms{0};
  std::atomic<uint32_t> revision{0};
  std::atomic<uint32_t> sequence{0};
  std::atomic<uint8_t> fallback{0};
  std::atomic<uint8_t> active{0};
};
struct ClusterSnapshot {
  bool valid = false;
  uint32_t last_success_ms = 0, revision = 0, sequence = 0;
  bool fallback = false, active = false;
};
using ClusterSnapshotTable = std::array<ClusterSnapshotSlot, kClusterCount>;

inline void publish_cluster_snapshot(ClusterSnapshotTable &t, const Runtime &rt, bool lease) {
  for (std::size_t i = 0; i < kClusterCount; i++) {
    ClusterSnapshotSlot &s = t[i];
    const auto &e = rt.cache().entry(i);
    s.version.fetch_add(1, std::memory_order_acq_rel);  // odd: writing
    s.last_success_ms.store(e.source == jk_cluster_cache::Source::NONE ? 0 : e.success_ms, std::memory_order_relaxed);
    s.revision.store(e.revision, std::memory_order_relaxed);
    s.sequence.store(rt.event_sequence(i), std::memory_order_relaxed);
    s.fallback.store(rt.health(i).fallback ? 1 : 0, std::memory_order_relaxed);
    s.active.store(lease && kClusters[i].active_cadence_ms != jk_read_clusters::kNoCadence ? 1 : 0, std::memory_order_relaxed);
    s.version.fetch_add(1, std::memory_order_acq_rel);  // even: stable
  }
}

inline ClusterSnapshot read_cluster_snapshot(const ClusterSnapshotTable &t, std::size_t i) {
  ClusterSnapshot out;
  if (i >= kClusterCount) return out;
  const ClusterSnapshotSlot &s = t[i];
  for (int attempt = 0; attempt < 4; attempt++) {
    const uint32_t v1 = s.version.load(std::memory_order_acquire);
    if (v1 & 1U) continue;
    ClusterSnapshot c;
    c.last_success_ms = s.last_success_ms.load(std::memory_order_relaxed);
    c.revision = s.revision.load(std::memory_order_relaxed);
    c.sequence = s.sequence.load(std::memory_order_relaxed);
    c.fallback = s.fallback.load(std::memory_order_relaxed) != 0;
    c.active = s.active.load(std::memory_order_relaxed) != 0;
    if (s.version.load(std::memory_order_acquire) == v1) { c.valid = v1 != 0; return c; }
  }
  return out;  // fail closed: not valid
}

// The one runtime and snapshot table of the production firmware (C++17 inline
// variables, like the diagnostic probe's globals).
inline Runtime g_runtime;
inline ClusterSnapshotTable g_cluster_snapshot_table;
// The web UI's register-write request (main-loop consumer) and the HA entity
// writes (begin_write_tx_rmw): one tracked RMW request each.
inline RmwRequest g_register_write_rmw;

// HA entity writes (begin_write_tx_rmw, write_bms_u16, write_bms_u32): a
// small, visible pool of tracked requests, at most one per register. The
// same write again while it waits is a no-op; a different write to a
// register that already has one waiting, or a full pool, is refused.
enum class ArmResult : uint8_t { ARMED = 0, ALREADY_WAITING = 1, REGISTER_BUSY = 2, POOL_FULL = 3 };
template <std::size_t N>
inline ArmResult arm_write(std::array<RmwRequest, N> &pool, const RmwWrite &w, uint32_t now_ms) {
  for (auto &q : pool) {
    if (q.active() && q.write().address == w.address) return q.write() == w ? ArmResult::ALREADY_WAITING : ArmResult::REGISTER_BUSY;
  }
  for (auto &q : pool) {
    if (!q.active()) {
      q.arm(w, now_ms);
      return ArmResult::ARMED;
    }
  }
  return ArmResult::POOL_FULL;
}
constexpr std::size_t kEntityWriteRequests = 4;
inline std::array<RmwRequest, kEntityWriteRequests> g_entity_write_requests;

}  // namespace jk_cluster_runtime
