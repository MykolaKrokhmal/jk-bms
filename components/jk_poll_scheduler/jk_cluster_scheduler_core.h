#pragma once
// jk_cluster_scheduler_core.h -- pure, hardware-independent scheduler for the
// clustered read path (docs/project/RS485_CLUSTERED_READ_MIGRATION_PLAN.md,
// M3). No ESPHome, no Modbus, no I/O: the servicer (batterylifepo4.yaml's
// cluster interval, M5) asks next() which cluster to read, issues that one
// FC03 read itself, and reports the terminal outcome back with complete().
// Desktop-tested by test/jk_poll_scheduler/test_jk_cluster_scheduler_core.cpp
// and test_cluster_cadence_simulation.cpp.
//
// Rules:
//   - one outstanding request: next() returns nothing while a read is open;
//   - a write transaction in flight (jk_write_tx / the CellCount driver)
//     owns the bus: next() issues nothing (the caller passes write_in_flight);
//   - geometry and cadences come only from the generated cluster table
//     (protocol/generated/read_clusters_table.h); the isolated setup-passcode
//     read is not in that table and can never be issued from here;
//   - a cluster with sequence_after (A2 after A1, C2 after C1) is issued
//     right after its lead's terminal outcome, in the same cycle, whatever
//     that outcome was, before any other read;
//   - missed cycles are skipped, never replayed: when a lead is issued, its
//     next due time advances past `now` on its own grid (never bunched);
//   - tiers: TELEMETRY > active SETTINGS (lease) > background SETTINGS >
//     STATIC; a due cluster ages up one tier per kAgingStepMs it has waited,
//     so no due cluster starves behind a busier tier;
//   - Settings and static clusters run at phase_ms inside the telemetry
//     second (staggered from A1/A2);
//   - the active Settings lease (Settings page open) switches C1/C2 to
//     active_cadence_ms; activating it makes C1 due at the next phase slot
//     (the "immediate" read), ending it returns C1/C2 to the normal cadence
//     measured from their last issue;
//   - request_now() (plan M5: the RMW pre-read) makes a cluster -- or, for a
//     follower, its lead -- due at once, ahead of every tier (only a started
//     cycle's follower goes first); it does not bypass the one-outstanding
//     rule or a write in flight;
//   - set_enabled(false) takes a cluster and its followers out of the
//     schedule for good: the servicer latched them to the legacy fallback.

#include <cstddef>
#include <cstdint>

#include "read_clusters_table.h"

namespace jk_cluster_scheduler {

using jk_read_clusters::kClusterCount;
using jk_read_clusters::kClusters;
using jk_read_clusters::Role;

constexpr int kNone = -1;
constexpr uint32_t kTelemetryCycleMs = 1000;  // the phase grid (telemetry cadence)
constexpr uint32_t kAgingStepMs = 2000;       // one tier of priority per 2 s waited while due

enum class Tier : uint8_t { TELEMETRY = 0, ACTIVE_SETTINGS = 1, BACKGROUND_SETTINGS = 2, STATIC = 3 };

inline bool before(uint32_t now, uint32_t t) { return int32_t(now - t) < 0; }

constexpr bool telemetry_grid_is_consistent() {
  for (std::size_t i = 0; i < kClusterCount; i++) {
    if (kClusters[i].role == Role::TELEMETRY && kClusters[i].cadence_ms != kTelemetryCycleMs) return false;
    if (kClusters[i].phase_ms >= kTelemetryCycleMs) return false;
    if (kClusters[i].cadence_ms % kTelemetryCycleMs != 0) return false;
    if (kClusters[i].active_cadence_ms != jk_read_clusters::kNoCadence && kClusters[i].active_cadence_ms % kTelemetryCycleMs != 0) return false;
  }
  return true;
}
static_assert(telemetry_grid_is_consistent(), "every cadence must be a whole number of telemetry cycles and phases within one cycle");

class Scheduler {
 public:
  // All leads become due at boot: telemetry at `now`, Settings/static at
  // their phase inside the first telemetry second.
  void begin(uint32_t now_ms) {
    t0_ms_ = now_ms;
    outstanding_ = kNone;
    lease_active_ = false;
    issued_total_ = 0;
    for (std::size_t i = 0; i < kClusterCount; i++) {
      due_ms_[i] = now_ms + kClusters[i].phase_ms;
      last_issue_ms_[i] = 0;
      has_issued_[i] = false;
      follow_pending_[i] = false;
      urgent_[i] = false;
      enabled_[i] = true;
      issued_[i] = 0;
    }
    begun_ = true;
  }

  // The lease state the servicer computes from the browser's Settings hint
  // (bounded by its own expiry). A false -> true transition makes C1 due at
  // the next phase slot; true -> false re-bases C1/C2 on the normal cadence.
  void set_settings_lease(bool active, uint32_t now_ms) {
    if (active == lease_active_) return;
    lease_active_ = active;
    for (std::size_t i = 0; i < kClusterCount; i++) {
      const auto &c = kClusters[i];
      if (c.role != Role::SETTINGS || c.sequence_after != jk_read_clusters::kNoCluster) continue;
      if (active) {
        due_ms_[i] = next_phase_slot(now_ms, c.phase_ms);
      } else if (has_issued_[i]) {
        // Back on the normal cadence from the last issue; a slot that has
        // already passed moves to the next phase slot (stagger kept).
        const uint32_t normal = last_issue_ms_[i] + c.cadence_ms;
        due_ms_[i] = before(now_ms, normal) ? normal : next_phase_slot(now_ms, c.phase_ms);
      }
    }
  }

  // Read this cluster as soon as the bus is free (the RMW pre-read). A
  // follower is read through its lead so the cycle stays A1->A2 / C1->C2.
  void request_now(int cluster) {
    if (cluster < 0 || std::size_t(cluster) >= kClusterCount) return;
    const std::size_t lead = is_follower(std::size_t(cluster)) ? std::size_t(kClusters[cluster].sequence_after) : std::size_t(cluster);
    if (enabled_[lead]) urgent_[lead] = true;
  }

  // false: the cluster left the schedule for good (latched fallback). A
  // lead takes its followers with it (a follower is only ever read after
  // its lead, so it could never run alone).
  void set_enabled(int cluster, bool enabled) {
    if (cluster < 0 || std::size_t(cluster) >= kClusterCount) return;
    enabled_[std::size_t(cluster)] = enabled;
    if (!enabled) { urgent_[std::size_t(cluster)] = false; follow_pending_[std::size_t(cluster)] = false; }
    for (std::size_t i = 0; i < kClusterCount; i++)
      if (kClusters[i].sequence_after == cluster) set_enabled(int(i), enabled);
  }
  bool enabled(std::size_t i) const { return enabled_[i]; }
  // A read of this cluster is already on its way: its lead is marked
  // urgent, or it is the follower due right after its lead.
  bool read_pending(int cluster) const {
    if (cluster < 0 || std::size_t(cluster) >= kClusterCount) return false;
    const std::size_t lead = is_follower(std::size_t(cluster)) ? std::size_t(kClusters[cluster].sequence_after) : std::size_t(cluster);
    return urgent_[lead] || follow_pending_[std::size_t(cluster)];
  }

  // The one cluster to read now, or kNone. Marks it outstanding.
  int next(uint32_t now_ms, bool write_in_flight) {
    if (!begun_ || outstanding_ != kNone || write_in_flight) return kNone;
    int best = kNone;
    int best_rank = 0;
    uint32_t best_wait = 0;
    for (std::size_t i = 0; i < kClusterCount; i++) {
      uint32_t wait;
      if (!is_due(i, now_ms, wait)) continue;
      const int rank = effective_tier(i, wait);
      if (best == kNone || rank < best_rank || (rank == best_rank && wait > best_wait)) {
        best = int(i);
        best_rank = rank;
        best_wait = wait;
      }
    }
    if (best == kNone) return kNone;
    issue(std::size_t(best), now_ms);
    return best;
  }

  // The terminal outcome of the outstanding read (OK, error, exception or
  // timeout): frees the bus and releases a follower of the same cycle.
  void complete(int cluster, uint32_t now_ms) {
    (void) now_ms;
    if (cluster < 0 || std::size_t(cluster) >= kClusterCount || cluster != outstanding_) return;
    outstanding_ = kNone;
    for (std::size_t i = 0; i < kClusterCount; i++)
      if (kClusters[i].sequence_after == cluster && enabled_[i]) follow_pending_[i] = true;
  }

  int outstanding() const { return outstanding_; }
  bool lease_active() const { return lease_active_; }
  uint32_t issued(std::size_t i) const { return issued_[i]; }
  uint32_t issued_total() const { return issued_total_; }
  uint32_t due_ms(std::size_t i) const { return due_ms_[i]; }

  Tier base_tier(std::size_t i) const {
    switch (kClusters[i].role) {
      case Role::TELEMETRY: return Tier::TELEMETRY;
      case Role::SETTINGS: return lease_active_ ? Tier::ACTIVE_SETTINGS : Tier::BACKGROUND_SETTINGS;
      case Role::STATIC: return Tier::STATIC;
    }
    return Tier::STATIC;
  }

 private:
  bool is_follower(std::size_t i) const { return kClusters[i].sequence_after != jk_read_clusters::kNoCluster; }

  uint32_t cadence_of(std::size_t i) const {
    const auto &c = kClusters[i];
    return lease_active_ && c.active_cadence_ms != jk_read_clusters::kNoCadence ? c.active_cadence_ms : c.cadence_ms;
  }

  bool is_due(std::size_t i, uint32_t now_ms, uint32_t &wait) const {
    if (!enabled_[i]) return false;
    if (urgent_[i]) { wait = 0; return true; }
    if (is_follower(i)) {
      wait = 0;
      return follow_pending_[i];
    }
    if (before(now_ms, due_ms_[i])) return false;
    wait = now_ms - due_ms_[i];
    return true;
  }

  // Lower rank = higher priority. A pending follower completes its cycle
  // before anything else (rank -1): otherwise, after a slow or timed-out
  // lead, the lead's next (already overdue) slot would win the tie-break
  // and repeat without its follower. Leads rank by tier, aged one tier per
  // kAgingStepMs waited.
  int effective_tier(std::size_t i, uint32_t wait) const {
    if (is_follower(i)) return -2;  // a started cycle completes first (A2 right after A1)
    if (urgent_[i]) return -1;      // then an RMW pre-read, before every tier
    const int aged = int(base_tier(i)) - int(wait / kAgingStepMs);
    return aged < 0 ? 0 : aged;
  }

  void issue(std::size_t i, uint32_t now_ms) {
    outstanding_ = int(i);
    issued_[i]++;
    issued_total_++;
    // An early (pre-read) issue replaces the next scheduled read of the
    // cycle, so the cluster is not read twice in quick succession.
    const bool early = urgent_[i] && !is_follower(i) && before(now_ms, due_ms_[i]);
    urgent_[i] = false;
    if (is_follower(i)) {
      follow_pending_[i] = false;
      return;
    }
    last_issue_ms_[i] = now_ms;
    has_issued_[i] = true;
    // Skip every missed slot: the next due time is the first one after now.
    const uint32_t cadence = cadence_of(i);
    while (!before(now_ms, due_ms_[i])) due_ms_[i] += cadence;
    if (early) due_ms_[i] += cadence;
  }

  uint32_t next_phase_slot(uint32_t now_ms, uint32_t phase_ms) const {
    const uint32_t since = now_ms - t0_ms_;
    uint32_t slot = t0_ms_ + (since / kTelemetryCycleMs) * kTelemetryCycleMs + phase_ms;
    if (before(slot, now_ms)) slot += kTelemetryCycleMs;
    return slot;
  }

  bool begun_ = false;
  bool lease_active_ = false;
  int outstanding_ = kNone;
  uint32_t t0_ms_ = 0;
  uint32_t issued_total_ = 0;
  uint32_t due_ms_[kClusterCount] = {};
  uint32_t last_issue_ms_[kClusterCount] = {};
  bool has_issued_[kClusterCount] = {};
  bool follow_pending_[kClusterCount] = {};
  bool urgent_[kClusterCount] = {};
  bool enabled_[kClusterCount] = {};
  uint32_t issued_[kClusterCount] = {};
};

}  // namespace jk_cluster_scheduler
