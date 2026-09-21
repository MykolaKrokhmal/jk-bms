#pragma once
// jk_preflight_snapshot_core.h -- pure, hardware-independent, main-loop-
// published atomic snapshots for RegisterWritePreflightHandler (2026-09-21,
// second corrective pass). A code review found that handler reading
// id(g_rp_last_raw_word)[block_idx] / id(g_rp_last_success_ms)[block_idx] /
// id(g_rp_revision)[block_idx] and id(g_wtx_in_use)[i] / id(g_wtx_address)[i]
// / id(g_wtx_tx_id)[i] / id(g_wtx_status)[i] DIRECTLY is a genuine C++ data
// race: those are plain, non-atomic globals mutated by the main loop (the
// read-plan scheduler's own decode callbacks, and the 250ms write-tx tick
// loop), while RegisterWritePreflightHandler::handleRequest() runs on the
// ESP-IDF httpd task -- exactly the same class of cross-task hazard as the
// write-registry mailboxes, see jk_write_tx_core.h's own module comment for
// the full root-cause writeup and the real-source evidence this project's
// own audit already established for that hazard class.
//
// Fix, option (b) from the review's own explicit menu ("a main-loop-
// published immutable/atomic snapshot with a proven consistency model"):
// two small, bounded, fully-atomic-field snapshot tables, refreshed by the
// main loop every tick from the EXISTING plain globals (that copy is safe
// -- it happens entirely within the main loop, the same task that already
// owns those globals) using the identical monotonic-version seqlock
// technique jk_write_tx_core.h's RegisterWriteResultTable already
// establishes and proves correct (see that header's own module comment for
// why a monotonic counter, not a binary flag, is required to close the ABA
// gap a naive recheck would miss). RegisterWritePreflightHandler reads
// ONLY these snapshots from now on -- it NEVER again reads g_rp_*/g_wtx_*
// globals directly.
//
// Deliberately does NOT touch the existing g_rp_last_success_ms/
// g_rp_last_raw_word/g_rp_revision/g_wtx_* globals or their generated
// writers at all (those remain exactly as generated, main-loop-only,
// unchanged) -- this is a strictly additive publish step the main loop
// performs on top of its existing, already-correct single-writer usage of
// those globals, never a rewrite of the generated read-plan/write-tx
// machinery itself.

#include <array>
#include <atomic>
#include <cstddef>
#include <cstdint>

namespace jk_write_tx {

// Generous fixed cap, decoupled from the generated jk_read_plan::kBlockCount
// (currently 103) so this header never needs to be regenerated -- a
// publish/read call for a block_idx at or beyond this cap is a fail-closed
// no-op/invalid-snapshot, never an out-of-bounds access. If the real block
// count ever grows past this, raise the constant (a `static_assert` at the
// single real call site in batterylifepo4.yaml, comparing this constant
// against jk_read_plan::kBlockCount, is expected to catch that before it
// ever silently under-covers a real block).
constexpr std::size_t kMaxReadPlanBlocksForPreflightSnapshot = 160;
constexpr std::size_t kMaxWriteTxSlotsForPreflightSnapshot = 6;

// One read-plan block's freshness/raw/generation triple, fully atomic per
// field, guarded by a monotonic version counter (even = stable, odd =
// writer mid-publish) -- see jk_write_tx_core.h's RegisterWriteResultSlot
// for the exact proof this pattern relies on; it applies identically here.
struct ReadPlanBlockSnapshotSlot {
  std::atomic<uint32_t> version{0};
  std::atomic<uint32_t> last_success_ms{0};
  std::atomic<uint32_t> last_raw_word{0};
  std::atomic<uint32_t> revision{0};
};

using ReadPlanBlockSnapshotTable =
    std::array<ReadPlanBlockSnapshotSlot, kMaxReadPlanBlocksForPreflightSnapshot>;

// Writer side (main loop ONLY, single writer -- called once per block per
// tick from a dedicated interval that simply copies the existing plain
// globals, which the main loop already owns exclusively).
inline void publish_read_plan_block_snapshot(ReadPlanBlockSnapshotTable &table, std::size_t block_idx,
                                              uint32_t last_success_ms, uint32_t last_raw_word, uint32_t revision) {
  if (block_idx >= table.size()) return;  // fail closed -- never write out of bounds
  ReadPlanBlockSnapshotSlot &slot = table[block_idx];
  slot.version.fetch_add(1, std::memory_order_release);  // odd -- in progress
  slot.last_success_ms.store(last_success_ms, std::memory_order_relaxed);
  slot.last_raw_word.store(last_raw_word, std::memory_order_relaxed);
  slot.revision.store(revision, std::memory_order_relaxed);
  slot.version.fetch_add(1, std::memory_order_release);  // even -- published
}

struct ReadPlanBlockSnapshot {
  bool valid = false;  // false = out of bounds, or the read window never observed a clean snapshot (fail closed)
  uint32_t last_success_ms = 0;
  uint32_t last_raw_word = 0;
  uint32_t revision = 0;
};

// Reader side (any task, read-only, never blocks, bounded retry).
inline ReadPlanBlockSnapshot read_read_plan_block_snapshot(const ReadPlanBlockSnapshotTable &table,
                                                            std::size_t block_idx) {
  ReadPlanBlockSnapshot out;
  if (block_idx >= table.size()) return out;
  const ReadPlanBlockSnapshotSlot &slot = table[block_idx];
  constexpr int kMaxRetries = 5;
  for (int attempt = 0; attempt < kMaxRetries; attempt++) {
    const uint32_t v0 = slot.version.load(std::memory_order_acquire);
    if (v0 & 1u) continue;  // writer mid-publish -- retry
    const uint32_t ls = slot.last_success_ms.load(std::memory_order_relaxed);
    const uint32_t lw = slot.last_raw_word.load(std::memory_order_relaxed);
    const uint32_t rev = slot.revision.load(std::memory_order_relaxed);
    const uint32_t v1 = slot.version.load(std::memory_order_acquire);
    if (v1 != v0) continue;  // a publish (partial or complete) happened during our read -- retry
    out.valid = true;
    out.last_success_ms = ls;
    out.last_raw_word = lw;
    out.revision = rev;
    return out;
  }
  return out;  // exhausted retries under extreme contention -- fail closed (never a torn/stale snapshot)
}

// One write-tx slot's preflight-relevant fields (active-transaction
// lookup), same atomic-fields-plus-version-recheck pattern.
struct WriteTxSnapshotSlot {
  std::atomic<uint32_t> version{0};
  std::atomic<uint8_t> in_use{0};
  std::atomic<uint16_t> address{0};
  std::atomic<uint32_t> tx_id{0};
  std::atomic<uint8_t> status{0};
};

using WriteTxSnapshotTable = std::array<WriteTxSnapshotSlot, kMaxWriteTxSlotsForPreflightSnapshot>;

// Writer side (main loop ONLY -- called from the SAME 250ms write-tx tick
// loop that already iterates every slot once per tick).
inline void publish_write_tx_snapshot_slot(WriteTxSnapshotTable &table, std::size_t slot_idx, bool in_use,
                                            uint16_t address, uint32_t tx_id, uint8_t status) {
  if (slot_idx >= table.size()) return;
  WriteTxSnapshotSlot &slot = table[slot_idx];
  slot.version.fetch_add(1, std::memory_order_release);
  slot.in_use.store(in_use ? 1 : 0, std::memory_order_relaxed);
  slot.address.store(address, std::memory_order_relaxed);
  slot.tx_id.store(tx_id, std::memory_order_relaxed);
  slot.status.store(status, std::memory_order_relaxed);
  slot.version.fetch_add(1, std::memory_order_release);
}

struct WriteTxSnapshot {
  bool valid = false;
  bool in_use = false;
  uint16_t address = 0;
  uint32_t tx_id = 0;
  uint8_t status = 0;
};

// Reader side (any task, read-only, never blocks, bounded retry).
inline WriteTxSnapshot read_write_tx_snapshot_slot(const WriteTxSnapshotTable &table, std::size_t slot_idx) {
  WriteTxSnapshot out;
  if (slot_idx >= table.size()) return out;
  const WriteTxSnapshotSlot &slot = table[slot_idx];
  constexpr int kMaxRetries = 5;
  for (int attempt = 0; attempt < kMaxRetries; attempt++) {
    const uint32_t v0 = slot.version.load(std::memory_order_acquire);
    if (v0 & 1u) continue;
    const uint8_t iu = slot.in_use.load(std::memory_order_relaxed);
    const uint16_t addr = slot.address.load(std::memory_order_relaxed);
    const uint32_t tx = slot.tx_id.load(std::memory_order_relaxed);
    const uint8_t st = slot.status.load(std::memory_order_relaxed);
    const uint32_t v1 = slot.version.load(std::memory_order_acquire);
    if (v1 != v0) continue;
    out.valid = true;
    out.in_use = iu != 0;
    out.address = addr;
    out.tx_id = tx;
    out.status = st;
    return out;
  }
  return out;
}

// Finds the first in-use snapshot slot for a given address -- the atomic-
// snapshot equivalent of the preflight handler's previous direct scan over
// id(g_wtx_in_use)/id(g_wtx_address). Returns -1 if none is in use for that
// address (or if any slot's read failed closed under extreme contention --
// treated identically to "no active transaction found", never a crash or a
// stale positive).
inline int find_active_write_tx_snapshot_for_address(const WriteTxSnapshotTable &table, uint16_t address) {
  for (std::size_t i = 0; i < table.size(); i++) {
    const auto snap = read_write_tx_snapshot_slot(table, i);
    if (snap.valid && snap.in_use && snap.address == address) return int(i);
  }
  return -1;
}

// This project's own single instances. See jk_write_tx_core.h's own
// storage-declaration comment for why these are C++17 `inline` variables
// rather than declared through ESPHome's own `globals:` YAML component.
inline ReadPlanBlockSnapshotTable g_read_plan_block_snapshot_table;
inline WriteTxSnapshotTable g_write_tx_snapshot_table;

}  // namespace jk_write_tx
