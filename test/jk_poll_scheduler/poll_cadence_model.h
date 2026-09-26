#pragma once
// Deterministic model of the read-plan scheduler servicer (the generated
// 200 ms `interval:` lambda in protocol/generated/read_plan.yaml) on the one
// shared Modbus bus. Uses the REAL jk_poll_scheduler::pick_next_block() and
// the REAL generated kBlocks (cadences); only the bus and the other command
// sources are modelled:
//   - servicer: every 200 ms tick; at most ONE read outstanding; 3000 ms
//     timeout; write_in_flight suppresses every read that tick;
//   - bus: FIFO, one command at a time, turnaround 50 ms after each response
//     (modbus: turnaround_time: 50ms);
//   - bespoke cell reader: queued every 1 s (1 s interval lambda, 0x1200,
//     53 registers), unless its previous read is still pending;
//   - latencies: request -> response time per command kind (parameters).
// No I/O, no randomness except an explicit seeded LCG for jitter.

#include "read_plan_decode.h"

#include <array>
#include <cstdint>
#include <deque>
#include <vector>

namespace poll_model {

struct Params {
  uint32_t tick_ms = 200;
  uint32_t first_tick_ms = 3000;
  uint32_t read_timeout_ms = 3000;
  uint32_t turnaround_ms = 50;
  uint32_t block_latency_ms = 60;      // one-block FC03 read, request -> response
  uint32_t block_latency_jitter_ms = 40;
  uint32_t cell_latency_ms = 150;      // 53-register cell block read
  uint32_t cell_period_ms = 1000;
  uint32_t duration_ms = 20 * 60 * 1000;
  uint32_t seed = 12345;
};

// A window in which jk_write_tx (or the CellCount driver) has a slot pending.
struct WritePause { uint32_t from_ms, to_ms; };
// A block read whose response never arrives (-> servicer timeout).
struct DroppedRead { int block; uint32_t from_ms; uint32_t count; };
// Extra, forced commands queued on the bus (write ACK/readback traffic).
struct ForcedCommand { uint32_t at_ms; uint32_t latency_ms; };

struct Result {
  // successes[i] = millis() timestamps of every successful read of block i.
  std::vector<std::vector<uint32_t>> successes;
  uint32_t reads_issued = 0, reads_ok = 0, timeouts = 0, cell_reads = 0, forced = 0;
  uint32_t max_queue_depth = 0;
  uint64_t bus_busy_ms = 0;
};

inline Result run(const Params &p, const std::vector<WritePause> &pauses = {},
                  const std::vector<DroppedRead> &drops = {}, const std::vector<ForcedCommand> &forced = {}) {
  using namespace jk_poll_scheduler;
  constexpr size_t N = jk_read_plan::kBlockCount;
  Result r;
  r.successes.assign(N, {});
  std::array<BlockState, N> states{};
  uint32_t cadence[N];
  for (size_t i = 0; i < N; i++) cadence[i] = jk_read_plan::kBlocks[i].cadence_ms;

  struct Cmd { int kind; int block; uint32_t latency; bool drop; };  // kind 0 = block, 1 = cell, 2 = forced
  std::deque<Cmd> queue;
  bool bus_busy = false; Cmd on_bus{}; uint32_t bus_done_at = 0, bus_free_at = 0;
  int pending = -1; uint32_t pending_started = 0;
  bool cell_pending = false; uint32_t cell_started = 0;
  std::vector<uint32_t> drop_left(drops.size());
  for (size_t k = 0; k < drops.size(); k++) drop_left[k] = drops[k].count;
  size_t next_forced = 0;
  uint32_t lcg = p.seed;
  auto rnd = [&lcg](uint32_t span) { lcg = lcg * 1664525u + 1013904223u; return span ? (lcg >> 8) % (span + 1) : 0u; };

  for (uint32_t t = 1; t <= p.duration_ms; t++) {
    // 1. Bus completion (response callback runs on the main loop).
    if (bus_busy && t >= bus_done_at) {
      bus_busy = false;
      bus_free_at = t + p.turnaround_ms;
      if (on_bus.kind == 0 && !on_bus.drop) {
        mark_success(states[on_bus.block], t);
        r.successes[on_bus.block].push_back(t);
        r.reads_ok++;
        if (pending == on_bus.block) pending = -1;
      } else if (on_bus.kind == 1) {
        cell_pending = false;
      }
    }
    // 2. Forced commands (write ACK / readback traffic) join the same queue.
    while (next_forced < forced.size() && forced[next_forced].at_ms == t) {
      queue.push_back({2, -1, forced[next_forced].latency_ms, false});
      r.forced++;
      next_forced++;
    }
    // 3. Bespoke 1 s cell reader.
    if (t >= 2000 && (t - 2000) % p.cell_period_ms == 0) {
      if (!(cell_pending && t - cell_started < 15000)) {
        cell_pending = true; cell_started = t;
        queue.push_back({1, -1, p.cell_latency_ms, false});
        r.cell_reads++;
      }
    }
    // 4. Scheduler servicer tick.
    if (t >= p.first_tick_ms && (t - p.first_tick_ms) % p.tick_ms == 0) {
      bool write_in_flight = false;
      for (const auto &w : pauses) if (t >= w.from_ms && t < w.to_ms) write_in_flight = true;
      if (pending >= 0) {
        if (t - pending_started > p.read_timeout_ms) { mark_timeout(states[pending]); r.timeouts++; pending = -1; }
      } else if (!write_in_flight) {
        const int chosen = pick_next_block(states, cadence, false, NO_BLOCK, t);
        if (chosen >= 0) {
          mark_issued(states[chosen], t);
          pending = chosen; pending_started = t;
          bool drop = false;
          for (size_t k = 0; k < drops.size(); k++)
            if (drops[k].block == chosen && t >= drops[k].from_ms && drop_left[k] > 0) { drop = true; drop_left[k]--; }
          queue.push_back({0, chosen, p.block_latency_ms + rnd(p.block_latency_jitter_ms), drop});
          r.reads_issued++;
        }
      }
    }
    if (queue.size() > r.max_queue_depth) r.max_queue_depth = uint32_t(queue.size());
    // 5. Bus dispatch.
    if (!bus_busy && !queue.empty() && t >= bus_free_at) {
      on_bus = queue.front(); queue.pop_front();
      bus_busy = true;
      // A dropped read occupies the bus until the modbus layer gives up;
      // modelled as the full servicer timeout (worst case for the bus).
      const uint32_t occupy = on_bus.drop ? p.read_timeout_ms : on_bus.latency;
      bus_done_at = t + occupy;
      r.bus_busy_ms += occupy + p.turnaround_ms;
    }
  }
  return r;
}

// Largest interval between consecutive successes of block i after warm-up.
inline uint32_t max_interval(const Result &r, size_t i, uint32_t after_ms) {
  uint32_t worst = 0;
  const auto &s = r.successes[i];
  for (size_t k = 1; k < s.size(); k++)
    if (s[k - 1] >= after_ms && s[k] - s[k - 1] > worst) worst = s[k] - s[k - 1];
  return worst;
}

}  // namespace poll_model
