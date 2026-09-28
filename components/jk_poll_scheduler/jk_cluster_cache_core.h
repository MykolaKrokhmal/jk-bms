#pragma once
// jk_cluster_cache_core.h -- pure, hardware-independent raw cluster cache and
// cluster decode helpers (docs/project/RS485_CLUSTERED_READ_MIGRATION_PLAN.md,
// M4). No ESPHome, no Modbus, no I/O. Desktop-tested by
// test/jk_poll_scheduler/test_jk_cluster_cache_core.cpp.
//
// Cache rules (fail closed):
//   - one entry per cluster of the generated table
//     (protocol/generated/read_clusters_table.h); the isolated setup-passcode
//     read has NO entry, and a register lookup inside 0x1470-0x147F is
//     refused before anything else -- passcode bytes can never enter the
//     cache, and nothing here can return them;
//   - store() accepts only an exact-length response (payload_bytes); a short
//     or long response changes nothing (no partial update);
//   - every accepted store bumps the cluster's revision and a global success
//     sequence (the `cluster:revision:sequence` success event of M5) and
//     records the time and whether the Settings lease was active;
//   - bytes from a legacy fallback reader may be published as entities by
//     the caller but never stored here: mark_fallback() invalidates the
//     entry, so an RMW merge can never use fallback data;
//   - register_raw() returns a register's raw big-endian value for an RMW
//     merge only when the entry is valid, cluster-sourced and fresh within
//     the STRICT budget (kRmwStrictBudgetMs, the active Settings budget) --
//     never the 300 s background budget. Anything else is a named refusal.

#include <array>
#include <cstddef>
#include <cstdint>
#include <cstring>

#include "read_clusters_table.h"

namespace jk_cluster_cache {

using jk_read_clusters::kClusterCount;
using jk_read_clusters::kClusters;
using jk_read_clusters::kMaxClusterPayloadBytes;

constexpr uint16_t kCredentialStart = 0x1470;
constexpr uint16_t kCredentialEndExclusive = 0x1480;

// The strict RMW freshness gate: the shortest active Settings budget in the
// table (3.5 s = 3 s active cadence + J). A write must merge into bytes this
// fresh, whatever cluster holds the register; the servicer reads the owning
// cluster first when they are older (M5).
constexpr uint32_t strict_budget_from_table() {
  uint32_t best = 0;
  for (std::size_t i = 0; i < kClusterCount; i++) {
    const uint32_t b = kClusters[i].active_freshness_budget_ms;
    if (b != jk_read_clusters::kNoCadence && (best == 0 || b < best)) best = b;
  }
  return best;
}
constexpr uint32_t kRmwStrictBudgetMs = strict_budget_from_table();
static_assert(kRmwStrictBudgetMs > 0 && kRmwStrictBudgetMs <= 5000, "the strict RMW budget is the active Settings budget, never a background budget");

constexpr bool touches_credential(uint16_t address, uint8_t word_count) {
  return uint32_t(address) < kCredentialEndExclusive && uint32_t(address) + 2U * word_count > kCredentialStart;
}
constexpr bool no_cluster_holds_credentials() {
  for (std::size_t i = 0; i < kClusterCount; i++)
    if (uint32_t(kClusters[i].start) < kCredentialEndExclusive && uint32_t(kClusters[i].start) + kClusters[i].payload_bytes > kCredentialStart) return false;
  return true;
}
static_assert(no_cluster_holds_credentials(), "no cluster may cover the setup passcode 0x1470-0x147F");

enum class Source : uint8_t { NONE = 0, CLUSTER = 1, FALLBACK = 2 };

struct Entry {
  std::array<uint8_t, kMaxClusterPayloadBytes> bytes{};
  Source source = Source::NONE;
  uint32_t success_ms = 0;
  uint32_t revision = 0;   // successful cluster reads of this cluster
  uint32_t sequence = 0;   // global success sequence at the last store
  bool active_mode = false;  // the Settings lease was active for that read
};

enum class StoreStatus : uint8_t { OK = 0, BAD_CLUSTER = 1, WRONG_LENGTH = 2 };

enum class Lookup : uint8_t { OK = 0, CREDENTIAL = 1, UNKNOWN = 2, MISSING = 3, FALLBACK = 4, STALE = 5, BAD_WIDTH = 6 };
inline const char *lookup_name(Lookup l) {
  switch (l) {
    case Lookup::OK: return "ok";
    case Lookup::CREDENTIAL: return "credential";
    case Lookup::UNKNOWN: return "unknown";
    case Lookup::MISSING: return "missing";
    case Lookup::FALLBACK: return "fallback";
    case Lookup::STALE: return "stale";
    case Lookup::BAD_WIDTH: return "bad_width";
  }
  return "?";
}

struct RawResult {
  Lookup status = Lookup::UNKNOWN;
  uint32_t raw = 0;          // big-endian register value (word_count 1 or 2)
  int cluster = jk_read_clusters::kNoCluster;
  uint32_t revision = 0;
  uint32_t success_ms = 0;
};

inline bool before(uint32_t now, uint32_t t) { return int32_t(now - t) < 0; }

class Cache {
 public:
  StoreStatus store(int cluster, const uint8_t *data, std::size_t len, uint32_t now_ms, bool active_mode) {
    if (cluster < 0 || std::size_t(cluster) >= kClusterCount || data == nullptr) return StoreStatus::BAD_CLUSTER;
    if (len != kClusters[cluster].payload_bytes) return StoreStatus::WRONG_LENGTH;
    Entry &e = entries_[std::size_t(cluster)];
    std::memcpy(e.bytes.data(), data, len);
    e.source = Source::CLUSTER;
    e.success_ms = now_ms;
    e.revision++;
    e.sequence = ++sequence_;
    e.active_mode = active_mode;
    return StoreStatus::OK;
  }

  // A legacy fallback reader took over for this cluster: its data never
  // becomes RMW input, so the entry is invalidated.
  void mark_fallback(int cluster) {
    if (cluster < 0 || std::size_t(cluster) >= kClusterCount) return;
    entries_[std::size_t(cluster)].source = Source::FALLBACK;
  }

  const Entry &entry(std::size_t cluster) const { return entries_[cluster]; }
  uint32_t sequence() const { return sequence_; }

  bool fresh(int cluster, uint32_t now_ms, uint32_t budget_ms) const {
    if (cluster < 0 || std::size_t(cluster) >= kClusterCount) return false;
    const Entry &e = entries_[std::size_t(cluster)];
    return e.source == Source::CLUSTER && uint32_t(now_ms - e.success_ms) <= budget_ms;
  }

  // Raw register value for an RMW merge, fail closed.
  RawResult register_raw(uint16_t address, uint8_t word_count, uint32_t now_ms) const {
    RawResult r;
    if (touches_credential(address, word_count)) { r.status = Lookup::CREDENTIAL; return r; }
    if (word_count != 1 && word_count != 2) { r.status = Lookup::BAD_WIDTH; return r; }
    const int c = jk_read_clusters::cluster_of(address);
    if (c == jk_read_clusters::kNoCluster || jk_read_clusters::cluster_of(uint16_t(address + 2U * (word_count - 1))) != c) {
      r.status = Lookup::UNKNOWN;
      return r;
    }
    r.cluster = c;
    const Entry &e = entries_[std::size_t(c)];
    if (e.source == Source::NONE) { r.status = Lookup::MISSING; return r; }
    if (e.source == Source::FALLBACK) { r.status = Lookup::FALLBACK; return r; }
    if (uint32_t(now_ms - e.success_ms) > kRmwStrictBudgetMs) { r.status = Lookup::STALE; return r; }
    const std::size_t off = std::size_t(address - kClusters[c].start);
    uint32_t v = 0;
    for (std::size_t i = 0; i < 2U * word_count; i++) v = (v << 8) | e.bytes[off + i];
    r.status = Lookup::OK;
    r.raw = v;
    r.revision = e.revision;
    r.success_ms = e.success_ms;
    return r;
  }

 private:
  std::array<Entry, kClusterCount> entries_{};
  uint32_t sequence_ = 0;
};

// --- Cell decode from A1 (0x1200 x120) -----------------------------------------
// Byte layout inside A1 (address delta = byte offset), the same layout the
// legacy 1 Hz reader (0x1200 x53) and the 17-32 resistance reader (0x126A x16)
// decode: voltage i at 2i (0x1200 + 2i, i < 32), resistance i at 74 + 2i
// (0x124A + 2i, i < 32), native max/min cell index bytes at 72/73 (0x1248).
constexpr std::size_t kCellChannels = 32;
constexpr std::size_t kA1VoltageOffset = 0;
constexpr std::size_t kA1ResistanceOffset = 74;
constexpr std::size_t kA1MaxIndexByte = 72;
constexpr std::size_t kA1MinIndexByte = 73;
constexpr std::size_t kA1ElectricalOffset = 0x1290 - 0x1200;  // 12 bytes: BatVol, BatWatt, BatCurrent
static_assert(kA1ResistanceOffset + 2 * kCellChannels <= 240 && kA1ElectricalOffset + 12 <= 240, "cell and electrical data lie inside A1");

struct CellFrame {
  uint16_t millivolts[kCellChannels];
  uint16_t milliohms[kCellChannels];
  bool publish[kCellChannels];  // true only for active channels (i < active_channels)
  uint8_t native_max_index;
  uint8_t native_min_index;
  uint16_t min_mv, max_mv;     // over active channels with >= 500 mV (the legacy rule)
  uint8_t min_index, max_index;  // 1-based; 0 = none
};

inline uint16_t be16(const uint8_t *p) { return uint16_t((uint16_t(p[0]) << 8) | p[1]); }

// `a1` must hold the full, exact-length A1 payload. Inactive channels are
// decoded but never marked for publication.
inline CellFrame decode_cells_from_a1(const uint8_t *a1, uint8_t active_channels) {
  CellFrame f{};
  if (active_channels > kCellChannels) active_channels = kCellChannels;
  f.min_mv = 0xFFFF;
  for (std::size_t i = 0; i < kCellChannels; i++) {
    f.millivolts[i] = be16(a1 + kA1VoltageOffset + 2 * i);
    f.milliohms[i] = be16(a1 + kA1ResistanceOffset + 2 * i);
    f.publish[i] = i < active_channels;
    if (!f.publish[i] || f.millivolts[i] < 500U) continue;
    if (f.millivolts[i] < f.min_mv) { f.min_mv = f.millivolts[i]; f.min_index = uint8_t(i + 1); }
    if (f.millivolts[i] > f.max_mv) { f.max_mv = f.millivolts[i]; f.max_index = uint8_t(i + 1); }
  }
  f.native_max_index = a1[kA1MaxIndexByte];
  f.native_min_index = a1[kA1MinIndexByte];
  return f;
}

}  // namespace jk_cluster_cache
