// Write-transaction bus-pause timing model (clustered-read plan M8).
//
// Drives the REAL jk_write_tx::tick() on a 250 ms tick (the production write
// servicer's interval) at every tick phase 0..249 ms, with ACK / readback
// arrival times from immediate up to the timeout edges and "never". It
// derives, rather than assumes, how long a generic write owns the bus, and
// it reproduces the servicer's ACK_TIMEOUT/READBACK_TIMEOUT -> WRITE_UNCERTAIN
// reclassification to show whether that state may hold the read pause.
//
//   g++ -std=c++17 -I components/jk_write_tx test/jk_write_tx/test_jk_write_tx_bus_pause.cpp

#include "jk_write_tx_core.h"

#include <cstdio>
#include <string>

using namespace jk_write_tx;

namespace {
int g_checks = 0, g_failures = 0;
void check(bool cond, const std::string &desc) {
  g_checks++;
  if (!cond) { g_failures++; std::printf("FAIL: %s\n", desc.c_str()); }
}

constexpr uint32_t kTickMs = 250;  // the production write servicer interval
constexpr uint32_t kNever = 0xFFFFFFFFu;
constexpr uint32_t kHorizonMs = 600000;  // 10 min

struct Outcome {
  uint32_t pause_end_ms = kNever;  // first time the slot no longer owns the bus
  uint8_t final_status = IDLE;
  uint32_t readback_issued_ms = kNever;
};

// One transaction that begins at t = 0 (begin() -> SENDING). The servicer
// ticks at phase + k * 250. `ack_at` / `readback_after` are arrival times
// (absolute / relative to the readback issue); kNever = no response.
// `uncertain_holds_bus` reproduces the servicer's reclassification of a
// timeout into WRITE_UNCERTAIN under a bus-ownership predicate that does or
// does not include WRITE_UNCERTAIN; the recovery probe is never answered.
Outcome run(uint32_t phase, uint32_t ack_at, uint32_t readback_after, bool readback_matches, bool uncertain_holds_bus) {
  Slot s;
  s.in_use = true;
  s.status = SENDING;
  s.started_ms = 0;
  s.requested_raw = 5;
  Outcome o;
  for (uint32_t t = 0; t <= kHorizonMs; t++) {
    if (ack_at != kNever && t == ack_at) s.acked = true;
    if (o.readback_issued_ms != kNever && readback_after != kNever && t == o.readback_issued_ms + readback_after) {
      s.readback_raw = readback_matches ? 5 : 6;
      s.readback_done = true;
    }
    if (t >= phase && (t - phase) % kTickMs == 0) {
      const TickResult r = tick(s, t);
      if (r.issue_readback) o.readback_issued_ms = t;
      if (r.terminal && (s.status == ACK_TIMEOUT || s.status == READBACK_TIMEOUT)) s.status = WRITE_UNCERTAIN;
    }
    const bool owns = uncertain_holds_bus ? is_pending(s.status) : owns_bus(s.status);
    if (!owns) { o.pause_end_ms = t; break; }
  }
  o.final_status = s.status;
  return o;
}
}  // namespace

int main() {
  // The predicate under test: a slot owns the bus only while its own write or
  // forced readback can still be on the wire.
  check(owns_bus(SENDING) && owns_bus(ACK_WAIT) && owns_bus(READBACK_WAIT), "SENDING/ACK_WAIT/READBACK_WAIT own the bus");
  check(!owns_bus(WRITE_UNCERTAIN) && !owns_bus(IDLE) && !owns_bus(CONFIRMED) && !owns_bus(MISMATCH) && !owns_bus(ACK_TIMEOUT) &&
            !owns_bus(READBACK_TIMEOUT) && !owns_bus(REJECTED) && !owns_bus(RECOVERED_CONFIRMED) && !owns_bus(RECOVERED_MISMATCH),
        "WRITE_UNCERTAIN and every terminal status release the bus");
  check(is_pending(WRITE_UNCERTAIN), "WRITE_UNCERTAIN still blocks a new write to the same address (is_pending unchanged)");

  // 1. Typical successful write (ACK and readback each ~30-62 ms on the bus,
  //    Gate C total_ms max 62): pause = latency + tick quantization.
  uint32_t typical_max = 0, typical_min = kNever;
  for (uint32_t ph = 0; ph < kTickMs; ph++) {
    const Outcome o = run(ph, 62, 62, true, false);
    check(o.final_status == CONFIRMED, "typical write confirms");
    if (o.pause_end_ms > typical_max) typical_max = o.pause_end_ms;
    if (o.pause_end_ms < typical_min) typical_min = o.pause_end_ms;
  }
  std::printf("typical write (ACK 62 ms, readback 62 ms): pause %u..%u ms over all tick phases\n", unsigned(typical_min), unsigned(typical_max));
  check(typical_max <= 2 * kTickMs + 62 + 62 + kTickMs, "typical successful write pause stays within latencies + three tick quanta");

  // 2. Worst cases over every tick phase and the timeout edges.
  const uint32_t ack_cases[] = {1, 62, 2999, 3000, 3001, 3249, kNever};
  const uint32_t rb_cases[] = {1, 62, 3999, 4000, 4001, 4249, kNever};
  uint32_t worst = 0;
  uint32_t worst_ok = 0;
  for (uint32_t ph = 0; ph < kTickMs; ph++) {
    for (uint32_t a : ack_cases) {
      for (uint32_t rb : rb_cases) {
        for (bool match : {true, false}) {
          const Outcome o = run(ph, a, rb, match, false);
          check(o.pause_end_ms != kNever, "every write releases the bus under owns_bus (phase " + std::to_string(ph) + ")");
          if (o.pause_end_ms != kNever && o.pause_end_ms > worst) worst = o.pause_end_ms;
          if (o.final_status == CONFIRMED && o.pause_end_ms > worst_ok) worst_ok = o.pause_end_ms;
          if (a == kNever) check(o.final_status == WRITE_UNCERTAIN && o.readback_issued_ms == kNever, "no ACK -> uncertain, readback never issued");
          if (a != kNever && o.readback_issued_ms != kNever) check(o.readback_issued_ms >= a, "the readback is issued only after the ACK");
        }
      }
    }
  }
  std::printf("proven maximum pause (owns_bus, ideal 250 ms ticks): %u ms; slowest CONFIRMED: %u ms\n", unsigned(worst), unsigned(worst_ok));
  check(worst == 7500, "maximum bus ownership of one write is exactly 3250 (ACK edge) + 4250 (readback edge) = 7500 ms");
  check(worst_ok <= 7500, "even the slowest confirmed write releases the bus by 7500 ms");

  // ACK-timeout path alone: released at the first tick strictly after 3000 ms.
  uint32_t ack_timeout_worst = 0;
  for (uint32_t ph = 0; ph < kTickMs; ph++) {
    const Outcome o = run(ph, kNever, kNever, true, false);
    if (o.pause_end_ms > ack_timeout_worst) ack_timeout_worst = o.pause_end_ms;
    check(o.pause_end_ms > 3000 && o.pause_end_ms <= 3250, "ACK timeout releases the bus in (3000, 3250] ms");
  }
  std::printf("ACK-timeout release: worst %u ms\n", unsigned(ack_timeout_worst));

  // 3. The pre-M8 predicate (is_pending): WRITE_UNCERTAIN keeps the read
  //    pause until a recovery probe answers. With no answer it never ends.
  const Outcome legacy = run(0, kNever, kNever, true, true);
  check(legacy.pause_end_ms == kNever && legacy.final_status == WRITE_UNCERTAIN,
        "pre-M8 predicate: an unanswered recovery keeps the read pause for the whole 10-minute horizon (unbounded)");

  // 4. bus_owner(): the one predicate the read servicer pauses on and the
  //    firmware publishes as read_pause_reason.
  {
    uint8_t in_use[6] = {0, 0, 0, 0, 0, 0};
    uint8_t status[6] = {IDLE, IDLE, IDLE, IDLE, IDLE, IDLE};
    check(bus_owner(in_use, status, 6, false, false, false, false) == BusOwner::NONE, "nothing pending -> no owner, reads run");
    for (uint8_t st : {uint8_t(SENDING), uint8_t(ACK_WAIT), uint8_t(READBACK_WAIT)}) {
      in_use[3] = 1; status[3] = st;
      check(bus_owner(in_use, status, 6, false, false, false, false) == BusOwner::REGISTER_WRITE, "a slot in its write/readback owns the bus (status " + std::to_string(st) + ")");
    }
    status[3] = WRITE_UNCERTAIN;
    check(bus_owner(in_use, status, 6, false, false, false, false) == BusOwner::NONE, "a WRITE_UNCERTAIN slot does not hold the read pause");
    status[3] = ACK_WAIT; in_use[3] = 0;
    check(bus_owner(in_use, status, 6, false, false, false, false) == BusOwner::NONE, "a free slot never owns the bus, whatever its stale status");
    in_use[3] = 1;
    check(bus_owner(in_use, status, 6, true, false, false, false) == BusOwner::CELLCOUNT, "CellCount keeps full ownership");
    check(bus_owner(in_use, status, 6, false, true, false, false) == BusOwner::TOPOLOGY_RECOVERY, "topology recovery keeps full ownership");
    check(bus_owner(in_use, status, 6, false, false, true, false) == BusOwner::PASSCODE, "the setup-passcode transaction keeps full ownership");
    in_use[3] = 0;
    check(bus_owner(in_use, status, 6, true, false, false, false) == BusOwner::CELLCOUNT, "CellCount owns the bus with no generic slot active");
    check(std::string(bus_owner_name(BusOwner::NONE)) == "none" && std::string(bus_owner_name(BusOwner::REGISTER_WRITE)) == "register_write" &&
              std::string(bus_owner_name(BusOwner::CELLCOUNT)) == "cellcount" && std::string(bus_owner_name(BusOwner::TOPOLOGY_RECOVERY)) == "topology_recovery" &&
              std::string(bus_owner_name(BusOwner::PASSCODE)) == "passcode",
          "published reason names are the documented values");
  }

  std::printf("write bus pause model: %d/%d checks passed\n", g_checks - g_failures, g_checks);
  return g_failures == 0 ? 0 : 1;
}
