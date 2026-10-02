// Pre-write quiescence barrier (clustered-read plan M8.1): a millisecond
// simulation of the production write path against a model of the ESPHome
// 2026.9.1 Modbus client hub, driven by the REAL project logic:
// jk_cluster_runtime::Runtime (cluster cadences, single flight, strict RMW
// gate), RmwRequest, jk_write_tx::begin()/tick(), and the barrier itself
// (bus_owner(), hub_quiescent(), quiesce_step(), accept_write_intent(),
// recheck_write_intent(), recovery_probe_allowed()).
//
// Hub model (esphome/components/modbus/modbus.{h,cpp} at 2026.9.1): one
// frame waits for its response at a time; a new frame is sent only when no
// frame waits and the 50 ms turnaround after the last received byte has
// passed; the READY frame sent next is the WRITE-class one first, else the
// oldest. An unanswered ModbusCommandItem frame (every ordinary read, and
// before M8.2 every transaction frame too) is resent after send_wait_time
// (2000 ms) while the controller's shared non-response count is <=
// max_cmd_retries (4; reset by any answered ModbusCommandItem); past that the
// controller goes offline and every queued frame is dropped. Plan M8.2: a
// transaction frame is sent by its own TxDevice, retried only if
// jk_write_tx::transaction_frame_retry() says so (never), and cancelled at
// its phase end (a frame on the wire becomes a device-less shell). A
// response is matched to the frame now waiting; a late one is dropped, or
// counted as misattributed when another frame of its function code waits.
// The response callback runs inside the
// hub's loop() and blocks the whole main loop for its duration (A1
// publishing: up to 638 ms observed), after which the same loop() sends the
// next frame. tx_buffer_empty() = no READY frame; tx_blocked() = a frame
// waits or the turnaround is running.
//
// `legacy_transport` reproduces the M8.1 transport (transaction frames as
// ModbusCommandItems): the simulation must see the resent FC16 there.
//
// `legacy` reproduces plan M8 (write queued the instant the RMW gate says
// QUEUE, no intent, no drain): the simulation must find the M8 gap there --
// a read sent between a write's ACK and its forced readback -- or it would
// prove nothing about the barrier.
//
//   g++ -std=c++17 -O2 -I components/jk_poll_scheduler -I components/jk_write_tx -I protocol/generated \
//       test/jk_write_tx/test_write_quiesce_barrier.cpp

#include "jk_cluster_runtime_core.h"

#include <algorithm>
#include <array>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

using namespace jk_cluster_runtime;
using jk_write_tx::BusOwner;

namespace {
int g_checks = 0, g_failures = 0;
void check(bool cond, const std::string &desc) {
  g_checks++;
  if (!cond) { g_failures++; std::printf("FAIL: %s\n", desc.c_str()); }
}
int cluster_index(const char *id) {
  for (std::size_t i = 0; i < kClusterCount; i++) if (std::strcmp(kClusters[i].id, id) == 0) return int(i);
  return -1;
}

constexpr uint32_t kNever = 0xFFFFFFFFu;
constexpr uint32_t kTurnaroundMs = 50;  // modbus: turnaround_time: 50ms
constexpr int kMaxCmdRetries = 4;       // modbus_controller default max_cmd_retries (not set in batterylifepo4.yaml)
constexpr uint16_t kTarget = 0x100C;    // default write: cell_ovp, a 32-bit register inside C1
constexpr uint8_t kTargetWords = 2;

enum class Kind : uint8_t { CLUSTER, WRITE, READBACK, PROBE };
const char *kind_name(Kind k) {
  switch (k) {
    case Kind::CLUSTER: return "cluster";
    case Kind::WRITE: return "write";
    case Kind::READBACK: return "readback";
    default: return "probe";
  }
}

struct Frame {
  int id = 0;
  Kind kind = Kind::CLUSTER;
  int cluster = -1;
  uint32_t gen = 0;
  uint32_t value = 0;     // WRITE: the raw written
  uint16_t seq = 0;
  bool waiting = false;
  bool tx = false;        // a transaction frame (write / readback / probe)
  bool shell = false;     // its device was cancelled: the hub delivers nothing and never retries it
  uint32_t sent_ms = 0;
  int attempts = 0;
};

// A response on the wire: `src` is the frame (attempt) it answers.
struct Arrival {
  uint32_t at;
  int src;
  bool write_fc;
};

struct Config {
  bool legacy = false;            // plan M8: no barrier (implies legacy_transport)
  bool legacy_transport = false;  // before M8.2: transaction frames are ModbusCommandItems, retried by the hub
  uint32_t a1_callback_ms = 1;    // main-loop block of the A1 response callback
  bool lease = false;             // C1/C2 every 3 s instead of 15 s
  uint32_t request_ms = 6000;     // the write request arrives (armed) at this time
  // The write (default: full-width 32-bit cell_ovp in C1).
  uint16_t address = kTarget;
  uint8_t words = kTargetWords;
  bool full_width = true;
  uint32_t mask = 0;
  uint8_t shift = 0;
  uint32_t value = 3650;          // encoded raw to write
  uint32_t bms_initial = 3600;    // the register's value on the BMS
  // BMS behaviour.
  bool write_acked = true;
  uint32_t write_ack_delay_ms = kNever;  // kNever: normal latency; else the ACK leaves the BMS this long after the frame
  bool write_applies = true;             // the BMS stores the write (even when its ACK is lost or late)
  bool readback_answers = true;
  uint32_t readback_delay_ms = kNever;
  uint32_t silent_from = kNever;   // the BMS answers no frame sent from here on
  uint32_t bms_change_at = kNever; // the register changes on the BMS side (another writer) at this time
  uint32_t bms_change_to = 0;
  uint32_t send_wait_ms = 2000;    // hub send_wait_time (default)
  uint32_t horizon_ms = 30000;
  // HA entity path (entity_write_step): decided the instant it arrives.
  bool immediate = false;
  // An A1 frame is READY in the hub at the request instant (see main()).
  bool inject_a1 = false;
};

struct Result {
  // Outcome of the one request.
  bool queued = false;                 // a Modbus write was queued
  uint32_t write_queued_ms = kNever, write_sent_ms = kNever;
  uint8_t final_status = jk_write_tx::IDLE;
  jk_write_tx::RejectReason refused = jk_write_tx::RejectReason::NONE;
  bool decided = false;
  uint32_t accepted_ms = kNever;       // intent accepted (barrier) / QUEUE decision (legacy)
  uint32_t pause_end_ms = kNever;      // first time after acceptance with no intent, no owner and no cleanup
  uint32_t raw_age_at_queue = kNever;  // age of the raw the queued write was merged into
  bool queued_raw_current = true;      // the merged raw was the BMS register's value at queueing
  bool hub_quiescent_at_queue = true;
  uint32_t written_value = 0;
  // Invariant monitors.
  int foreign_sends_during_ownership = 0;  // any non-own frame sent while a slot owns the bus
  int reads_between_ack_and_readback = 0;  // the M8 gap itself
  int reads_queued_while_paused = 0;       // a read/probe queued while an intent, a transaction or a cleanup owns the bus
  int write_frames_sent = 0;               // FC16 frames on the wire
  int fc16_after_ownership = 0;            // FC16 frames sent after the slot left SENDING/ACK_WAIT/READBACK_WAIT
  int readback_frames_sent = 0;
  int probe_sends = 0;
  int reads_sent_during_cleanup = 0;       // ordinary reads sent while transport cleanup was pending
  int reads_queued_with_tx_in_hub = 0;     // ordinary reads queued (resumed) while the hub still held the write's FC16/readback frame
  bool probe_during_cleanup = false;       // a recovery probe sent while transport cleanup was pending
  int late_dropped = 0;                    // a response that arrived with nothing (or another function) waiting
  int misattributed = 0;                   // a late response that met another frame of the same function code
  uint32_t first_probe_sent_ms = kNever;
  uint32_t ownership_end_ms = kNever;      // the slot left SENDING/ACK_WAIT/READBACK_WAIT
  uint32_t cleanup_end_ms = kNever;        // transport cleanup released the bus
  uint32_t hub_idle_after_ownership_ms = kNever;  // first ms after ownership end with the hub quiescent and no tx frame
  // Hub state at the QUEUE decision (= intent acceptance), and recheck evidence.
  int hub_at_accept = -1;                  // HubState
  int a1_ready_ms = 0;                     // ms during the run with an A1 read queued (READY)
  bool refused_by_barrier = false;         // refused after acceptance (drain timeout / recheck)
  bool queued_from_latest_read = true;     // the merged raw was the newest cached read of the register
  bool queued_after_newer_read = false;    // a newer read landed during the drain (same raw)
  std::string first_violation;
};

enum HubState { HUB_IDLE = 0, HUB_A1_WAITING = 1, HUB_A1_QUEUED = 2, HUB_OTHER_WAITING = 3, HUB_OTHER_QUEUED = 4, HUB_STATES = 5 };
const char *hub_state_name(int s) {
  static const char *n[] = {"idle", "A1 in flight", "A1 queued (READY)", "other read in flight", "other read queued"};
  return s >= 0 && s < HUB_STATES ? n[s] : "?";
}

class Sim {
 public:
  explicit Sim(const Config &c) : cfg_(c) {
    if (cfg_.legacy) cfg_.legacy_transport = true;
    A1_ = cluster_index("A1");
    bms_reg_ = cfg_.bms_initial;
  }

  Result run() {
    rt_.begin(0);
    for (t_ = 0; t_ <= cfg_.horizon_ms; t_++) {
      if (t_ == cfg_.bms_change_at) bms_reg_ = cfg_.bms_change_to;
      if (t_ < blocked_until_) continue;  // a response callback is still running
      if (resume_send_) { resume_send_ = false; hub_send(); }  // the rest of that hub loop()
      // The request is taken at the first free main-loop ms (a running
      // response callback delays it, as it delays every interval).
      if (!requested_ && t_ >= cfg_.request_ms) {
        requested_ = true;
        if (cfg_.inject_a1) {
          Frame f;
          f.kind = Kind::CLUSTER;
          f.cluster = A1_;
          f.gen = 0;  // not the runtime's read in flight: its bytes are ignored (LATE), its callback still blocks
          hub_queue(f);
        }
        req_.arm(write_spec(), t_);
        armed_ = true;
        if (cfg_.immediate) consumer();
      }
      // Phase A: scheduler (intervals).
      if (due(next_servicer_, 20)) servicer();
      if (due(next_barrier_, 20)) { transport_cleanup_step(); barrier_step(); }
      if (due(next_consumer_, 100)) consumer();
      if (due(next_wtick_, 250)) write_tick();
      // Phase B: the hub's loop().
      hub_loop();
      if (hub_state() == HUB_A1_QUEUED) res_.a1_ready_ms++;
      monitor();
      if (res_.decided && !slot_.in_use && !intent_.active && !cleanup_ && t_ > cfg_.request_ms + 14000 &&
          (cfg_.legacy_transport ? tx_frames_in_hub() == 0 : true))
        break;
    }
    res_.final_status = slot_.status;
    return res_;
  }

 private:
  bool due(uint32_t &next, uint32_t period) {
    if (t_ < next) return false;
    while (next <= t_) next += period;
    return true;
  }

  RmwWrite write_spec() const {
    RmwWrite w;
    w.address = cfg_.address;
    w.word_count = cfg_.words;
    w.encoded = cfg_.value;
    w.full_width = cfg_.full_width;
    w.mask = cfg_.mask;
    w.shift = cfg_.shift;
    return w;
  }

  BusOwner owner(bool with_intent) const {
    const uint8_t in_use[6] = {uint8_t(slot_.in_use ? 1 : 0), 0, 0, 0, 0, 0};
    const uint8_t status[6] = {slot_.status, 0, 0, 0, 0, 0};
    return jk_write_tx::bus_owner(in_use, status, 6, false, false, false, with_intent && intent_.active, cleanup_);
  }
  bool slot_owns_bus() const { return slot_.in_use && jk_write_tx::owns_bus(slot_.status); }

  // --- hub model -------------------------------------------------------------
  bool tx_buffer_empty() const {
    for (const auto &f : q_) if (!f.waiting) return false;
    return true;
  }
  bool tx_blocked() const { return waiting_ || (last_byte_ != kNever && t_ - last_byte_ < kTurnaroundMs); }
  int waiting_index() const {
    for (int i = 0; i < int(q_.size()); i++) if (q_[i].waiting) return i;
    return -1;
  }
  // The slot device (M8.2) owns a frame: queued, or on the wire and not cancelled.
  bool device_outstanding() const {
    for (const auto &f : q_) if (f.tx && !f.shell) return true;
    return false;
  }
  int tx_frames_in_hub() const {
    int n = 0;
    for (const auto &f : q_) if (f.tx) n++;
    return n;
  }
  // The write state's own frames (its FC16 and forced readback), shells included.
  int write_state_frames_in_hub() const {
    int n = 0;
    for (const auto &f : q_) if (f.kind == Kind::WRITE || f.kind == Kind::READBACK) n++;
    return n;
  }

  void hub_queue(Frame f) {
    if ((f.kind == Kind::CLUSTER || f.kind == Kind::PROBE) && (intent_.active || slot_owns_bus() || cleanup_)) {
      res_.reads_queued_while_paused++;
      note("a read was queued while a write intent, transaction or transport cleanup owned the bus");
    }
    if (f.kind == Kind::CLUSTER && res_.queued && write_state_frames_in_hub() > 0 && !slot_owns_bus()) {
      res_.reads_queued_with_tx_in_hub++;
      note("an ordinary read resumed while the hub still held the write's FC16 or readback frame");
    }
    f.id = next_id_++;
    f.seq = seq_++;
    q_.push_back(f);
  }

  uint32_t latency(const Frame &f) const {
    if (f.kind == Kind::CLUSTER) return 10 + kClusters[f.cluster].payload_bytes / 11;  // ~115200 baud
    return 15;
  }

  void hub_send() {
    if (waiting_ || tx_blocked()) return;
    int best = -1;
    for (int i = 0; i < int(q_.size()); i++) {
      if (q_[i].waiting) continue;
      const bool wc = q_[i].kind == Kind::WRITE;
      if (best < 0) { best = i; continue; }
      const bool bwc = q_[best].kind == Kind::WRITE;
      if (wc != bwc) { if (wc) best = i; continue; }
      if (uint16_t(seq_ - q_[i].seq) > uint16_t(seq_ - q_[best].seq)) best = i;  // older
    }
    if (best < 0) return;
    Frame &f = q_[best];
    f.waiting = true;
    f.sent_ms = t_;
    f.attempts++;
    waiting_ = true;
    const bool heard = t_ < cfg_.silent_from;
    uint32_t delay = latency(f);
    bool answers = heard;
    if (f.kind == Kind::WRITE) {
      if (heard && cfg_.write_applies) bms_reg_ = f.value;  // the BMS stores it on receipt
      answers = heard && cfg_.write_acked;
      if (cfg_.write_ack_delay_ms != kNever) delay = cfg_.write_ack_delay_ms;
    } else if (f.kind == Kind::READBACK) {
      answers = heard && cfg_.readback_answers;
      if (cfg_.readback_delay_ms != kNever) delay = cfg_.readback_delay_ms;
    }
    if (answers) arrivals_.push_back(Arrival{t_ + delay, f.id, f.kind == Kind::WRITE});
    on_sent(f);
  }

  int hub_state() const {
    bool a1_ready = false, other_ready = false;
    int waiting = -1;
    for (const auto &f : q_) {
      if (f.waiting) waiting = (f.kind == Kind::CLUSTER && f.cluster == A1_) ? HUB_A1_WAITING : HUB_OTHER_WAITING;
      else if (f.kind == Kind::CLUSTER && f.cluster == A1_) a1_ready = true;
      else other_ready = true;
    }
    if (a1_ready) return HUB_A1_QUEUED;
    if (other_ready) return HUB_OTHER_QUEUED;
    if (waiting >= 0) return waiting;
    return tx_blocked() ? HUB_OTHER_WAITING : HUB_IDLE;  // turnaround only: counted as busy
  }

  void on_sent(const Frame &f) {
    if (f.kind == Kind::WRITE) {
      res_.write_frames_sent++;
      if (res_.write_sent_ms == kNever) res_.write_sent_ms = t_;
      if (!slot_owns_bus()) {
        res_.fc16_after_ownership++;
        note("an FC16 frame was sent after the slot left SENDING/ACK_WAIT/READBACK_WAIT");
      }
    }
    if (f.kind == Kind::READBACK) res_.readback_frames_sent++;
    if (f.kind == Kind::PROBE) {
      res_.probe_sends++;
      if (res_.first_probe_sent_ms == kNever) res_.first_probe_sent_ms = t_;
      if (cleanup_) res_.probe_during_cleanup = true;
    }
    if (f.kind == Kind::CLUSTER && cleanup_) {
      res_.reads_sent_during_cleanup++;
      note("an ordinary read was sent while transport cleanup was pending");
    }
    const bool own = f.kind == Kind::WRITE || f.kind == Kind::READBACK;
    if (!own && slot_owns_bus()) {
      res_.foreign_sends_during_ownership++;
      note(std::string("a ") + kind_name(f.kind) + " frame was sent while the write owned the bus");
      if (slot_.acked && !slot_.readback_done) res_.reads_between_ack_and_readback++;
    }
  }

  void hub_loop() {
    // parse: a response is matched to the frame now waiting, the way the hub
    // does (address + function code); the model also knows which attempt it
    // answers and counts what the real hub could confuse.
    for (int k = 0; k < int(arrivals_.size());) {
      if (arrivals_[k].at != t_) { k++; continue; }
      const Arrival a = arrivals_[k];
      arrivals_.erase(arrivals_.begin() + k);
      const int wi = waiting_index();
      if (wi < 0) { res_.late_dropped++; continue; }  // "Received unexpected frame": dropped
      if (q_[wi].id != a.src) {
        if ((q_[wi].kind == Kind::WRITE) == a.write_fc) res_.misattributed++;
        else res_.late_dropped++;  // a wrong function code interrupts the waiting frame; modelled as dropped
        continue;
      }
      const Frame done = q_[wi];
      q_.erase(q_.begin() + wi);
      waiting_ = false;
      last_byte_ = t_;
      if (!done.tx || cfg_.legacy_transport) ctl_nonresp_ = 0;  // ModbusCommandItem::on_response -> set_online(true)
      const uint32_t cb = done.shell ? 0 : callback(done);  // a cancelled device's shell delivers nothing
      if (cb > 0) { blocked_until_ = t_ + cb; resume_send_ = true; return; }
      break;
    }
    // send-wait watchdog
    const int wi = waiting_index();
    if (wi >= 0 && t_ - q_[wi].sent_ms >= cfg_.send_wait_ms) {
      Frame &f = q_[wi];
      waiting_ = false;
      bool retry;
      bool offline = false;
      if (f.shell) {
        retry = false;  // device-less: nobody to ask
      } else if (f.tx && !cfg_.legacy_transport) {
        retry = jk_write_tx::transaction_frame_retry(uint8_t(f.attempts));  // TxDevice::on_no_response
      } else {
        ctl_nonresp_++;  // ModbusCommandItem::on_no_response -> can_send()
        retry = ctl_nonresp_ <= kMaxCmdRetries;
        offline = !retry;
      }
      if (retry) {
        f.waiting = false;
        f.seq = seq_++;
      } else {
        q_.erase(q_.begin() + wi);
        // set_online(false) -> clear_tx_queue_for_address: every queued frame is dropped
        if (offline) q_.erase(std::remove_if(q_.begin(), q_.end(), [](const Frame &x) { return !x.waiting; }), q_.end());
      }
    }
    hub_send();
  }

  // The response callback; returns how long it blocks the main loop.
  uint32_t callback(const Frame &f) {
    switch (f.kind) {
      case Kind::CLUSTER: {
        std::vector<uint8_t> data(kClusters[f.cluster].payload_bytes, 0);
        const uint32_t start = kClusters[f.cluster].start;
        if (cfg_.address >= start && cfg_.address + 2U * cfg_.words <= start + kClusters[f.cluster].payload_bytes) {
          const std::size_t off = std::size_t(cfg_.address - start);
          for (int b = 0; b < 2 * cfg_.words; b++) data[off + std::size_t(b)] = uint8_t(bms_reg_ >> (8 * (2 * cfg_.words - 1 - b)));
        }
        rt_.on_cluster_response(f.cluster, f.gen, data.data(), data.size(), t_, cfg_.lease);
        return f.cluster == A1_ ? cfg_.a1_callback_ms : 2;
      }
      case Kind::WRITE:
        slot_.acked = true;
        return 1;
      case Kind::READBACK:
        slot_.readback_raw = bms_reg_;
        slot_.readback_done = true;
        return 1;
      case Kind::PROBE:
        if (slot_.status != jk_write_tx::WRITE_UNCERTAIN) return 1;  // stale probe result: ignored, as the firmware does
        slot_.readback_raw = bms_reg_;
        slot_.status = jk_write_tx::compare_masked(slot_.requested_raw, bms_reg_, slot_.compare_mask) ? jk_write_tx::RECOVERED_CONFIRMED
                                                                                                        : jk_write_tx::RECOVERED_MISMATCH;
        slot_.finished_ms = t_;
        probe_pending_ = false;
        return 1;
    }
    return 1;
  }

  // --- the generated read servicer (20 ms) ------------------------------------
  void servicer() {
    rt_.check_timeout(t_);
    if (rt_.busy()) return;
    // M8 / M8.1 / M8.2: no read while a transaction, an accepted intent or a transport cleanup owns the bus.
    if (owner(!cfg_.legacy) != BusOwner::NONE) return;
    const int c = rt_.issue(t_, false, cfg_.lease);
    if (c < 0) return;
    Frame f;
    f.kind = Kind::CLUSTER;
    f.cluster = c;
    f.gen = rt_.generation();
    hub_queue(f);
  }

  // --- UI request consumer (100 ms): the RMW gate, then intent (M8.1) or write (M8)
  void consumer() {
    if (!armed_) return;
    const auto st = req_.step(rt_, t_);
    if (st.step == RmwStep::WAIT) return;
    armed_ = false;
    res_.decided = true;
    if (st.step != RmwStep::QUEUE) { res_.refused = jk_write_tx::RejectReason::STALE_RAW; return; }
    res_.accepted_ms = t_;
    res_.hub_at_accept = hub_state();
    if (cfg_.legacy) { queue_write(st.merged_raw, st.old_raw); return; }
    const uint8_t in_use[6] = {uint8_t(slot_.in_use ? 1 : 0), 0, 0, 0, 0, 0};
    const uint8_t status[6] = {slot_.status, 0, 0, 0, 0, 0};
    const BusOwner accept_owner = jk_write_tx::bus_owner(in_use, status, 6, false, false, false, false, false);
    if (!accept_write_intent(intent_, IntentSource::REGISTER_REQUEST, write_spec(), st, t_, accept_owner)) {
      res_.refused = jk_write_tx::RejectReason::TRANSACTION_UNAVAILABLE;
      return;
    }
    barrier_step();  // the fast path: an already idle hub queues the write now
  }

  // --- transport_cleanup_step (M8.2, every 20 ms, before the barrier) -----------
  void transport_cleanup_step() {
    if (!cleanup_) return;
    if (!jk_write_tx::transport_clean(jk_write_tx::hub_quiescent(tx_buffer_empty(), tx_blocked()), device_outstanding())) return;
    cleanup_ = false;
    if (res_.cleanup_end_ms == kNever) res_.cleanup_end_ms = t_;
  }

  // --- write_barrier_step (acceptance + every 20 ms) ----------------------------
  void barrier_step() {
    if (cfg_.legacy || !intent_.active) return;
    const bool quiet = jk_write_tx::hub_quiescent(tx_buffer_empty(), tx_blocked());
    const auto qs = jk_write_tx::quiesce_step(intent_.active, intent_.accepted_ms, t_, quiet, owner(false));
    if (qs == jk_write_tx::QuiesceStep::WAIT) return;
    const WriteIntent in = intent_;
    intent_.active = false;
    res_.refused_by_barrier = true;
    if (qs != jk_write_tx::QuiesceStep::READY) { res_.refused = jk_write_tx::RejectReason::BUS_NOT_QUIESCENT; return; }
    const auto rc = recheck_write_intent(rt_, in, t_);
    if (rc.step == RecheckStep::STALE) { res_.refused = jk_write_tx::RejectReason::STALE_RAW; return; }
    if (rc.step == RecheckStep::CHANGED) { res_.refused = jk_write_tx::RejectReason::RAW_CHANGED; return; }
    res_.refused_by_barrier = false;
    res_.hub_quiescent_at_queue = quiet;
    const auto latest = rt_.cache().register_raw(cfg_.address, cfg_.words, t_);
    res_.queued_from_latest_read = latest.raw == in.old_raw;
    res_.queued_after_newer_read = latest.revision != in.source_stamp;
    queue_write(in.merged_raw, in.old_raw);
  }

  void queue_write(uint32_t merged, uint32_t old_raw) {
    std::array<jk_write_tx::Slot, 1> local;
    uint32_t next_id = 0;
    const int idx = jk_write_tx::begin(local, next_id, cfg_.address, cfg_.words, merged, write_spec().tx_compare_mask(), t_, false);
    if (idx < 0) { res_.refused = jk_write_tx::RejectReason::TRANSACTION_UNAVAILABLE; return; }
    slot_ = local[0];
    res_.queued = true;
    res_.write_queued_ms = t_;
    res_.written_value = merged;
    if (!cfg_.legacy) {
      const auto raw = rt_.cache().register_raw(cfg_.address, cfg_.words, t_);
      res_.raw_age_at_queue = t_ - raw.success_ms;
    }
    res_.queued_raw_current = old_raw == bms_reg_;
    Frame f;
    f.kind = Kind::WRITE;
    f.tx = true;
    f.value = merged;
    hub_queue(f);
  }

  // M8.2: TxDevice::cancel() -- a queued frame is dropped, one on the wire becomes a shell.
  void cancel_device() {
    for (auto &f : q_) if (f.tx && f.waiting) f.shell = true;
    q_.erase(std::remove_if(q_.begin(), q_.end(), [](const Frame &x) { return x.tx && !x.waiting; }), q_.end());
  }

  // --- 250 ms write-tx tick (+ WRITE_UNCERTAIN probe) -------------------------
  void write_tick() {
    if (!slot_.in_use) return;
    const uint8_t prev = slot_.status;
    const auto r = jk_write_tx::tick(slot_, t_);
    if (r.terminal && (slot_.status == jk_write_tx::ACK_TIMEOUT || slot_.status == jk_write_tx::READBACK_TIMEOUT)) {
      slot_.status = jk_write_tx::WRITE_UNCERTAIN;
      probe_pending_ = true;
      probe_next_ms_ = t_;
    }
    if (!cfg_.legacy_transport && jk_write_tx::owns_bus(prev) && !jk_write_tx::owns_bus(slot_.status)) {
      cancel_device();
      cleanup_ = true;
    }
    if (slot_.status == jk_write_tx::WRITE_UNCERTAIN && probe_pending_ && t_ >= probe_next_ms_ &&
        (cfg_.legacy_transport || !device_outstanding()) && (cfg_.legacy || jk_write_tx::recovery_probe_allowed(owner(true)))) {
      probe_next_ms_ = t_ + 2000;
      Frame f;
      f.kind = Kind::PROBE;
      f.tx = true;
      hub_queue(f);
    }
    if (r.issue_readback) {
      Frame f;
      f.kind = Kind::READBACK;
      f.tx = true;
      hub_queue(f);
    }
    if (r.terminal) slot_.finished_ms = t_;
  }

  void monitor() {
    if (res_.queued && res_.ownership_end_ms == kNever && !slot_owns_bus()) res_.ownership_end_ms = t_;
    if (res_.ownership_end_ms != kNever && res_.hub_idle_after_ownership_ms == kNever &&
        jk_write_tx::hub_quiescent(tx_buffer_empty(), tx_blocked()) && !device_outstanding())
      res_.hub_idle_after_ownership_ms = t_;
    if (res_.accepted_ms == kNever || res_.pause_end_ms != kNever) return;
    if (!intent_.active && owner(true) == BusOwner::NONE) res_.pause_end_ms = t_;
  }

  void note(const std::string &what) {
    if (res_.first_violation.empty()) res_.first_violation = what + " at t=" + std::to_string(t_);
  }

  Config cfg_;
  Runtime rt_;
  RmwRequest req_;
  bool armed_ = false, requested_ = false;
  WriteIntent intent_;
  jk_write_tx::Slot slot_;
  bool cleanup_ = false;
  bool probe_pending_ = false;
  uint32_t probe_next_ms_ = 0;
  std::vector<Frame> q_;
  std::vector<Arrival> arrivals_;
  bool waiting_ = false;
  uint32_t last_byte_ = kNever;
  uint16_t seq_ = 0;
  int next_id_ = 1;
  int ctl_nonresp_ = 0;
  uint32_t t_ = 0;
  uint32_t blocked_until_ = 0;
  bool resume_send_ = false;
  uint32_t next_servicer_ = 0, next_barrier_ = 7, next_consumer_ = 13, next_wtick_ = 3;
  uint32_t bms_reg_ = 0;
  int A1_ = -1;
  Result res_;
};

struct Sweep {
  int runs = 0, confirmed = 0, refused = 0, gap_runs = 0, foreign = 0, paused_reads = 0, not_quiet = 0, stale_queued = 0;
  int by_state[HUB_STATES] = {0, 0, 0, 0, 0}, gap_by_state[HUB_STATES] = {0, 0, 0, 0, 0};
  int barrier_stale = 0, barrier_changed = 0, barrier_timeout = 0, not_latest = 0, newer_same = 0, writes_after_refusal = 0;
  uint32_t max_drain = 0, max_pause = 0, max_age = 0, max_ownership = 0, max_timeout_pause = 0;
  std::string first;
};

Sweep sweep(Config base, uint32_t from, uint32_t to) {
  Sweep s;
  for (uint32_t req = from; req < to; req++) {
    Config c = base;
    c.request_ms = req;
    const Result r = Sim(c).run();
    s.runs++;
    if (r.final_status == jk_write_tx::CONFIRMED) s.confirmed++;
    if (r.refused != jk_write_tx::RejectReason::NONE) s.refused++;
    if (r.reads_between_ack_and_readback > 0) s.gap_runs++;
    if (r.hub_at_accept >= 0) {
      s.by_state[r.hub_at_accept]++;
      if (r.reads_between_ack_and_readback > 0) s.gap_by_state[r.hub_at_accept]++;
    }
    if (r.refused_by_barrier) {
      if (r.refused == jk_write_tx::RejectReason::STALE_RAW) s.barrier_stale++;
      if (r.refused == jk_write_tx::RejectReason::RAW_CHANGED) s.barrier_changed++;
      if (r.refused == jk_write_tx::RejectReason::BUS_NOT_QUIESCENT) {
        s.barrier_timeout++;
        if (r.pause_end_ms != kNever) s.max_timeout_pause = std::max(s.max_timeout_pause, r.pause_end_ms - r.accepted_ms);
      }
      if (r.write_frames_sent != 0 || r.queued) s.writes_after_refusal++;
    }
    if (r.queued && !r.queued_from_latest_read) s.not_latest++;
    if (r.queued && r.queued_after_newer_read) s.newer_same++;
    if (r.queued && r.ownership_end_ms != kNever) s.max_ownership = std::max(s.max_ownership, r.ownership_end_ms - r.write_queued_ms);
    s.foreign += r.foreign_sends_during_ownership;
    s.paused_reads += r.reads_queued_while_paused;
    if (r.queued && !r.hub_quiescent_at_queue) s.not_quiet++;
    if (r.queued && !base.legacy && r.raw_age_at_queue > jk_cluster_cache::kRmwStrictBudgetMs) s.stale_queued++;
    if (r.queued && r.accepted_ms != kNever) s.max_drain = std::max(s.max_drain, r.write_queued_ms - r.accepted_ms);
    if (r.pause_end_ms != kNever && r.accepted_ms != kNever) s.max_pause = std::max(s.max_pause, r.pause_end_ms - r.accepted_ms);
    if (r.queued && r.raw_age_at_queue != kNever) s.max_age = std::max(s.max_age, r.raw_age_at_queue);
    if (s.first.empty() && !r.first_violation.empty()) s.first = "request at " + std::to_string(req) + ": " + r.first_violation;
  }
  return s;
}
// Plan M8.2: transport accounting over a sweep of request arrival times.
struct TransportSweep {
  int runs = 0, min_fc16 = 1 << 30, max_fc16 = 0, fc16_after = 0, max_readbacks = 0, reads_during_cleanup = 0, probe_during_cleanup = 0;
  int reads_resumed_early = 0;
  int confirmed = 0, recovered_confirmed = 0, uncertain_left = 0, probes_after_idle = 0, runs_with_probe = 0, late_dropped = 0, misattributed = 0;
  int bound_violations = 0, queued = 0;
  uint32_t max_pause = 0, max_cleanup_after_ownership = 0, max_write_value = 0, min_write_value = 0xFFFFFFFFu;
  std::string first;
};

TransportSweep transport_sweep(Config base, uint32_t from, uint32_t to) {
  TransportSweep s;
  for (uint32_t req = from; req < to; req++) {
    Config c = base;
    c.request_ms = req;
    const Result r = Sim(c).run();
    s.runs++;
    if (!r.queued) continue;
    s.queued++;
    s.min_fc16 = std::min(s.min_fc16, r.write_frames_sent);
    s.max_fc16 = std::max(s.max_fc16, r.write_frames_sent);
    s.fc16_after += r.fc16_after_ownership;
    s.max_readbacks = std::max(s.max_readbacks, r.readback_frames_sent);
    s.reads_during_cleanup += r.reads_sent_during_cleanup;
    s.reads_resumed_early += r.reads_queued_with_tx_in_hub;
    if (r.probe_during_cleanup) s.probe_during_cleanup++;
    if (r.final_status == jk_write_tx::CONFIRMED) s.confirmed++;
    if (r.final_status == jk_write_tx::RECOVERED_CONFIRMED) s.recovered_confirmed++;
    if (r.final_status == jk_write_tx::WRITE_UNCERTAIN) s.uncertain_left++;
    if (r.probe_sends > 0) {
      s.runs_with_probe++;
      if (r.hub_idle_after_ownership_ms != kNever && r.first_probe_sent_ms >= r.hub_idle_after_ownership_ms) s.probes_after_idle++;
    }
    s.late_dropped += r.late_dropped;
    s.misattributed += r.misattributed;
    s.max_write_value = std::max(s.max_write_value, r.written_value);
    s.min_write_value = std::min(s.min_write_value, r.written_value);
    if (r.pause_end_ms != kNever && r.accepted_ms != kNever) {
      const uint32_t pause = r.pause_end_ms - r.accepted_ms;
      s.max_pause = std::max(s.max_pause, pause);
      // Derived bound (loop time): drain <= kQuiesceTimeoutMs + one 20 ms barrier tick; then ownership
      // <= 7500 ms or, if later, the last transaction frame's send + send-wait + turnaround; then one
      // 20 ms cleanup tick and the 1 ms model step.
      const uint32_t drain = r.write_queued_ms - r.accepted_ms;
      const uint32_t after = std::max<uint32_t>(7500, (r.write_sent_ms - r.write_queued_ms) + c.send_wait_ms + kTurnaroundMs);
      if (drain > jk_write_tx::kQuiesceTimeoutMs + 20 || pause > drain + after + 21) s.bound_violations++;
    }
    if (r.ownership_end_ms != kNever && r.cleanup_end_ms != kNever)
      s.max_cleanup_after_ownership = std::max(s.max_cleanup_after_ownership, r.cleanup_end_ms - r.ownership_end_ms);
    if (s.first.empty() && !r.first_violation.empty()) s.first = "request at " + std::to_string(req) + ": " + r.first_violation;
  }
  return s;
}

void report_transport(const char *name, const TransportSweep &s) {
  std::printf("%-46s runs %d queued %d | FC16 per write %d..%d, after ownership %d | readbacks/write <= %d | reads resumed early %d, reads during cleanup %d, "
              "probes during cleanup %d | CONFIRMED %d, RECOVERED_CONFIRMED %d, still uncertain %d | late dropped %d, misattributed %d | "
              "max pause %u ms, max cleanup after ownership %u ms, bound violations %d\n",
              name, s.runs, s.queued, s.queued ? s.min_fc16 : 0, s.max_fc16, s.fc16_after, s.max_readbacks, s.reads_resumed_early, s.reads_during_cleanup,
              s.probe_during_cleanup, s.confirmed, s.recovered_confirmed, s.uncertain_left, s.late_dropped, s.misattributed,
              unsigned(s.max_pause), unsigned(s.max_cleanup_after_ownership), s.bound_violations);
  if (!s.first.empty()) std::printf("%-46s first violation: %s\n", "", s.first.c_str());
}

void report(const char *name, const Sweep &s) {
  std::printf("%-44s runs %d confirmed %d refused %d | gap runs %d foreign sends %d reads queued while paused %d | "
              "max drain %u ms, max ownership %u ms, max pause %u ms, max raw age at queue %u ms\n",
              name, s.runs, s.confirmed, s.refused, s.gap_runs, s.foreign, s.paused_reads, unsigned(s.max_drain),
              unsigned(s.max_ownership), unsigned(s.max_pause), unsigned(s.max_age));
  std::printf("%-44s hub at acceptance:", "");
  for (int i = 0; i < HUB_STATES; i++) std::printf(" %s %d (gap %d);", hub_state_name(i), s.by_state[i], s.gap_by_state[i]);
  std::printf("\n");
  if (!s.first.empty()) std::printf("%-44s first violation: %s\n", "", s.first.c_str());
}

// When the C1 cluster is read (no request, so the schedule is the request-free one).
std::vector<uint32_t> c1_read_times(Config c) {
  c.request_ms = kNever;
  c.horizon_ms = 40000;
  std::vector<uint32_t> out;
  Runtime rt;
  rt.begin(0);
  // Replay the servicer's cadence on a runtime of its own (the Sim keeps its
  // runtime private), noting when C1's revision changes.
  const int C1 = cluster_index("C1");
  uint32_t last_rev = 0;
  for (uint32_t t = 0, busy_until = 0; t < c.horizon_ms; t++) {
    if (t >= busy_until && !rt.busy()) {
      const int k = rt.issue(t, false, c.lease);
      if (k >= 0) {
        std::vector<uint8_t> data(kClusters[k].payload_bytes, 0);
        busy_until = t + 10 + kClusters[k].payload_bytes / 11 + kTurnaroundMs;
        rt.on_cluster_response(k, rt.generation(), data.data(), data.size(), t + 10 + kClusters[k].payload_bytes / 11, c.lease);
      }
    }
    const uint32_t rev = rt.cache().entry(std::size_t(C1)).revision;
    if (rev != last_rev) { out.push_back(t); last_rev = rev; }
  }
  return out;
}
}  // namespace

int main() {
  using QS = jk_write_tx::QuiesceStep;
  // 0. The barrier's pure decisions.
  {
    check(jk_write_tx::hub_quiescent(true, false), "hub quiescent: nothing READY and nothing waiting / in turnaround");
    check(!jk_write_tx::hub_quiescent(false, false) && !jk_write_tx::hub_quiescent(true, true) && !jk_write_tx::hub_quiescent(false, true),
          "hub not quiescent while a frame is queued or a frame waits / the turnaround runs");
    check(jk_write_tx::quiesce_step(false, 0, 5000, true, BusOwner::NONE) == QS::IDLE, "no intent: IDLE");
    check(jk_write_tx::quiesce_step(true, 100, 100, true, BusOwner::NONE) == QS::READY, "quiescent hub, no owner: READY at once");
    check(jk_write_tx::quiesce_step(true, 100, 3099, false, BusOwner::NONE) == QS::WAIT, "busy hub: WAIT inside the bound");
    check(jk_write_tx::quiesce_step(true, 100, 3100, false, BusOwner::NONE) == QS::TIMEOUT, "busy hub: TIMEOUT at exactly kQuiesceTimeoutMs");
    check(jk_write_tx::kQuiesceTimeoutMs == kReadTimeoutMs, "the drain bound is the servicer's own one-read budget (3000 ms)");
    for (BusOwner o : {BusOwner::REGISTER_WRITE, BusOwner::CELLCOUNT, BusOwner::TOPOLOGY_RECOVERY, BusOwner::PASSCODE}) {
      const std::string n = jk_write_tx::bus_owner_name(o);
      check(jk_write_tx::quiesce_step(true, 0, 10, true, o) == QS::WAIT && jk_write_tx::quiesce_step(true, 0, 3000, true, o) == QS::TIMEOUT,
            "another owner (" + n + ") keeps the write out even on a quiescent hub, then times out");
      check(!jk_write_tx::recovery_probe_allowed(o), "no recovery probe while " + n + " owns the bus");
      WriteIntent in;
      RmwStepResult q;
      q.step = RmwStep::QUEUE;
      RmwWrite w;
      w.address = kTarget;
      w.word_count = 2;
      w.full_width = true;
      check(!accept_write_intent(in, IntentSource::REGISTER_REQUEST, w, q, 0, o) && !in.active,
            "no write intent is accepted while " + n + " owns the bus (CellCount / topology / passcode / another write)");
    }
    check(jk_write_tx::recovery_probe_allowed(BusOwner::NONE), "a recovery probe may run once nothing owns the bus");
    check(jk_write_tx::quiesce_step(true, 0xFFFFFF00u, 0x00000B00u, false, BusOwner::NONE) == QS::TIMEOUT, "the bound survives the millis() wrap");
    uint8_t in_use[6] = {0, 0, 0, 0, 0, 0}, status[6] = {0, 0, 0, 0, 0, 0};
    check(jk_write_tx::bus_owner(in_use, status, 6, false, false, false, true, false) == BusOwner::REGISTER_WRITE,
          "an accepted write intent owns the bus as a register write (reads pause, read_pause_reason 'register_write')");
    check(jk_write_tx::bus_owner(in_use, status, 6, true, false, false, true, false) == BusOwner::CELLCOUNT &&
              jk_write_tx::bus_owner(in_use, status, 6, false, true, false, true, false) == BusOwner::TOPOLOGY_RECOVERY &&
              jk_write_tx::bus_owner(in_use, status, 6, false, false, true, true, false) == BusOwner::PASSCODE,
          "CellCount / topology recovery / passcode keep their own names over an intent");
    check(jk_write_tx::bus_owner(in_use, status, 6, false, false, false, false, true) == BusOwner::REGISTER_WRITE,
          "M8.2: a pending transport cleanup owns the bus as a register write (no read, probe or write until the hub let go)");
    check(jk_write_tx::kTransactionFrameAttempts == 1, "M8.2: one transmission per transaction frame");
    check(!jk_write_tx::transaction_frame_retry(1) && !jk_write_tx::transaction_frame_retry(4),
          "M8.2: a transaction frame is never resent by the hub after it went out once");
    check(jk_write_tx::transport_clean(true, false) && !jk_write_tx::transport_clean(false, false) && !jk_write_tx::transport_clean(true, true),
          "M8.2: transport is clean only with a quiescent hub and no transaction frame outstanding");
    WriteIntent in;
    RmwStepResult q;
    q.step = RmwStep::QUEUE;
    RmwWrite w;
    check(accept_write_intent(in, IntentSource::ENTITY, w, q, 7, BusOwner::NONE) && in.active && in.accepted_ms == 7,
          "a QUEUE decision is accepted as the intent when nothing owns the bus");
    check(!accept_write_intent(in, IntentSource::REGISTER_REQUEST, w, q, 8, BusOwner::NONE) && in.source == IntentSource::ENTITY,
          "one intent at a time: a second one is refused and the first is untouched");
    WriteIntent fresh;
    q.step = RmwStep::NO_CHANGE;
    check(!accept_write_intent(fresh, IntentSource::ENTITY, w, q, 9, BusOwner::NONE), "only a QUEUE decision becomes an intent");
  }

  // 1-2. The M8 gap and the barrier, over every request arrival ms of a 2 s
  //      window (every phase of A1/A2/C reads, the 20/100/250 ms intervals and
  //      the 50 ms turnaround), with a 1 ms and a 640 ms A1 response callback.
  for (uint32_t cb : {1u, 640u}) {
    Config c;
    c.a1_callback_ms = cb;
    Config l = c;
    l.legacy = true;
    const Sweep sl = sweep(l, 5000, 7000);
    const Sweep sb = sweep(c, 5000, 7000);
    const std::string tag = " (A1 callback " + std::to_string(cb) + " ms)";
    report(("M8 legacy" + tag).c_str(), sl);
    report(("M8.1 barrier" + tag).c_str(), sb);
    check(sl.gap_runs > 0, "the simulation reproduces the M8 gap: a read sent between a write's ACK and its readback" + tag);
    check(sl.gap_by_state[HUB_A1_QUEUED] + sl.gap_by_state[HUB_OTHER_QUEUED] == sl.gap_runs,
          "every M8 gap comes from a read that was already queued (READY) when the write was queued" + tag);
    check(sb.gap_runs == 0 && sb.foreign == 0, "barrier: no frame but the write's own is sent while it owns the bus -- no read between ACK and readback" + tag);
    check(sb.paused_reads == 0, "barrier: no read or probe is queued after the intent is accepted" + tag);
    check(sb.not_quiet == 0, "barrier: every write was queued on a quiescent hub" + tag);
    check(sb.confirmed == sb.runs && sb.refused == 0, "barrier on a healthy bus: every request confirms" + tag);
    check(sb.stale_queued == 0 && sb.not_latest == 0, "barrier: every write was merged into the latest read, within the strict budget" + tag);
    check(sb.max_drain <= jk_write_tx::kQuiesceTimeoutMs, "barrier: the drain stays inside kQuiesceTimeoutMs" + tag);
    check(sb.max_ownership <= 7500, "barrier: write ownership keeps its proven 7500 ms bound" + tag);
    check(sb.max_pause <= jk_write_tx::kQuiesceTimeoutMs + 20 + 7500, "barrier: the whole read pause is bounded by drain + 20 ms + 7500 ms" + tag);
  }

  // 1-2b. The same on the HA entity path with the Settings lease: the
  //       decision lands on any ms, so acceptance meets an A1 in flight, an
  //       A1 queued inside the turnaround, the A2 that follows it, or an idle
  //       hub -- each state is covered explicitly.
  for (uint32_t cb : {1u, 640u}) {
    Config c;
    c.a1_callback_ms = cb;
    c.lease = true;
    c.immediate = true;
    Config l = c;
    l.legacy = true;
    const Sweep sl = sweep(l, 5000, 11000);
    const Sweep sb = sweep(c, 5000, 11000);
    const std::string tag = " (entity path, lease, A1 callback " + std::to_string(cb) + " ms)";
    report(("M8 legacy" + tag).c_str(), sl);
    report(("M8.1 barrier" + tag).c_str(), sb);
    check(sb.by_state[HUB_A1_WAITING] > 0 && sb.by_state[HUB_IDLE] > 0 && sb.by_state[HUB_OTHER_QUEUED] > 0,
          "acceptance meets an A1 in flight, another read queued (A2/C2) and an idle hub" + tag);
    check(sl.gap_by_state[HUB_OTHER_QUEUED] > 0, "M8: a queued A2/C2 lands between the ACK and the readback" + tag);
    check(sl.gap_by_state[HUB_A1_WAITING] == 0 && sl.gap_by_state[HUB_IDLE] == 0,
          "M8: an A1 already in flight finishes before the write frame (it delays the write, never splits it)" + tag);
    check(sb.gap_runs == 0 && sb.foreign == 0 && sb.paused_reads == 0 && sb.not_quiet == 0,
          "barrier: no read between ACK and readback, none queued after acceptance, every write queued on a quiescent hub" + tag);
    check(sb.confirmed == sb.runs && sb.stale_queued == 0 && sb.not_latest == 0, "barrier: every request confirms from the latest fresh read" + tag);
    check(sb.max_drain <= jk_write_tx::kQuiesceTimeoutMs && sb.max_ownership <= 7500 && sb.max_pause <= jk_write_tx::kQuiesceTimeoutMs + 20 + 7500,
          "barrier: drain, ownership and whole pause stay inside their bounds" + tag);
  }

  // 1-2c. A1 queued (READY) when the write is decided -- the case M8 let
  //       through between the ACK and the readback.
  for (uint32_t cb : {1u, 640u}) {
    Config c;
    c.a1_callback_ms = cb;
    c.lease = true;
    c.immediate = true;
    c.inject_a1 = true;
    Config l = c;
    l.legacy = true;
    const Sweep sl = sweep(l, 5000, 8000);
    const Sweep sb = sweep(c, 5000, 8000);
    const std::string tag = " (A1 queued at the decision, A1 callback " + std::to_string(cb) + " ms)";
    report(("M8 legacy" + tag).c_str(), sl);
    report(("M8.1 barrier" + tag).c_str(), sb);
    check(sb.by_state[HUB_A1_QUEUED] == sb.runs, "every decision meets the queued A1" + tag);
    check(sl.gap_by_state[HUB_A1_QUEUED] > 0, "M8: the queued A1 is sent between the write's ACK and its forced readback" + tag);
    check(sb.gap_runs == 0 && sb.foreign == 0 && sb.paused_reads == 0 && sb.not_quiet == 0,
          "barrier: the write waits for the queued A1 (and its callback), then nothing interleaves" + tag);
    // A long drain (the queued A1 plus its callback) can age a raw that was
    // already near the strict budget past it: the recheck then refuses the
    // write (STALE_RAW) -- fail closed, never written. Reported, not hidden.
    std::printf("%-44s refused stale after the drain: %d of %d (%.1f %%)\n", "", sb.barrier_stale, sb.runs, 100.0 * sb.barrier_stale / sb.runs);
    check(sb.confirmed + sb.refused == sb.runs && sb.refused == sb.barrier_stale && sb.writes_after_refusal == 0 && sb.stale_queued == 0,
          "barrier: every request confirms, or is refused STALE_RAW by the recheck with nothing written" + tag);
    check(sb.max_drain <= jk_write_tx::kQuiesceTimeoutMs && sb.max_ownership <= 7500, "barrier: inside the drain and ownership bounds" + tag);
  }

  // 3. Drain timeout: the BMS goes silent while a read is on the wire. The
  //    hub keeps retrying it (2000 ms x 5): the intent is refused at
  //    kQuiesceTimeoutMs and no write is ever queued or sent.
  {
    Config c;
    c.silent_from = 6600;
    const Sweep s = sweep(c, 6000, 6600);
    report("drain timeout (BMS silent from 6600 ms)", s);
    std::printf("%-44s refused BUS_NOT_QUIESCENT: %d, read pause ended at most %u ms after acceptance\n", "", s.barrier_timeout,
                unsigned(s.max_timeout_pause));
    check(s.barrier_timeout > 0, "a drain that cannot finish is refused with BUS_NOT_QUIESCENT");
    check(s.max_timeout_pause >= jk_write_tx::kQuiesceTimeoutMs && s.max_timeout_pause <= jk_write_tx::kQuiesceTimeoutMs + 20,
          "the refusal and the end of the read pause come at kQuiesceTimeoutMs (+ one 20 ms barrier tick), never later");
    check(s.writes_after_refusal == 0, "a refused intent never queues or sends a write");
    check(s.paused_reads == 0 && s.foreign == 0, "and no read was queued while it drained");
  }

  // 4a. Stale after the drain: the raw was fresh at acceptance but the drain
  //     (a 640 ms A1 callback) pushed it past the strict budget.
  {
    Config c;
    c.a1_callback_ms = 640;
    const auto c1 = c1_read_times(c);
    check(c1.size() >= 2, "C1 is read on its cadence");
    const uint32_t base = c1.size() >= 2 ? c1[1] : 15000;
    const Sweep s = sweep(c, base + 2800, base + 3500);
    report("stale after drain (A1 callback 640 ms)", s);
    check(s.barrier_stale > 0, "recheck after the drain refuses a raw that went stale while draining (STALE_RAW), with no write");
    check(s.stale_queued == 0 && s.writes_after_refusal == 0, "no write is ever queued from a raw older than the strict budget");
  }

  // 4b-c. A newer read during the drain (Settings lease: C1 every 3 s):
  //       another writer changed the register -> RAW_CHANGED, nothing written;
  //       same value -> written from the newer read.
  {
    Config c;
    c.lease = true;
    c.a1_callback_ms = 640;
    Sweep changed;
    for (uint32_t req = 5000; req < 8000; req += 1) {
      Config k = c;
      k.request_ms = req;
      k.bms_change_at = req + 1;
      k.bms_change_to = 3700;
      const Result r = Sim(k).run();
      changed.runs++;
      if (r.refused_by_barrier && r.refused == jk_write_tx::RejectReason::RAW_CHANGED) changed.barrier_changed++;
      if (r.refused_by_barrier && (r.queued || r.write_frames_sent)) changed.writes_after_refusal++;
      if (r.queued && !r.queued_from_latest_read) changed.not_latest++;
    }
    std::printf("register changed by another writer during the drain: runs %d, RAW_CHANGED %d, queued from an outdated read %d\n",
                changed.runs, changed.barrier_changed, changed.not_latest);
    check(changed.barrier_changed > 0, "a newer read with a different raw during the drain refuses the write (RAW_CHANGED)");
    check(changed.writes_after_refusal == 0 && changed.not_latest == 0, "no write is ever merged into a raw older than the newest read");
    const Sweep same = sweep(c, 5000, 8000);
    report("newer read, same value (lease)", same);
    check(same.newer_same > 0 && same.confirmed == same.runs, "a newer read with the same raw lets the write go, merged into that read");
    check(same.foreign == 0 && same.paused_reads == 0, "with the lease too, nothing interleaves with the write");
  }

  // 6. WRITE_UNCERTAIN: the write is never acknowledged. Its recovery probe is
  //    issued only after the write released the bus, never inside it.
  {
    Config c;
    c.write_acked = false;
    const Sweep s = sweep(c, 5000, 5400);
    report("no ACK -> WRITE_UNCERTAIN -> recovery probe", s);
    int probes_after = 0, runs_with_probe = 0;
    for (uint32_t req = 5000; req < 5400; req++) {
      Config k = c;
      k.request_ms = req;
      const Result r = Sim(k).run();
      if (r.probe_sends > 0) {
        runs_with_probe++;
        if (r.ownership_end_ms != kNever && r.first_probe_sent_ms >= r.ownership_end_ms) probes_after++;
      }
    }
    check(runs_with_probe == s.runs && probes_after == runs_with_probe, "the recovery probe is sent, and only after the write's ownership ended");
    check(s.foreign == 0 && s.paused_reads == 0, "no probe or read is queued or sent while the write owns the bus");
  }

  // ---------------------------------------------------------------------------
  // Plan M8.2: no transport retry of a transaction frame. Each scenario runs
  // the M8.2 firmware and, for contrast, the M8.1 transport (transaction
  // frames as ModbusCommandItems, retried by the hub up to 4 more times).
  {
    auto both = [](const char *name, Config c, uint32_t from, uint32_t to) {
      Config old = c;
      old.legacy_transport = true;
      const TransportSweep n = transport_sweep(c, from, to);
      const TransportSweep o = transport_sweep(old, from, to);
      report_transport((std::string("M8.2 ") + name).c_str(), n);
      report_transport((std::string("M8.1 transport ") + name).c_str(), o);
      return std::make_pair(n, o);
    };
    auto common = [](const TransportSweep &n, const std::string &tag) {
      check(n.queued == n.runs && n.queued > 0, "M8.2 " + tag + ": every request reached its write");
      check(n.min_fc16 == 1 && n.max_fc16 == 1, "M8.2 " + tag + ": exactly one FC16 frame per confirmed request");
      check(n.fc16_after == 0, "M8.2 " + tag + ": no FC16 frame after the slot left SENDING/ACK_WAIT/READBACK_WAIT");
      check(n.max_readbacks <= 1, "M8.2 " + tag + ": at most one forced-readback frame");
      check(n.reads_during_cleanup == 0 && n.probe_during_cleanup == 0,
            "M8.2 " + tag + ": no ordinary read and no probe goes out before transport cleanup ends");
      check(n.probes_after_idle == n.runs_with_probe, "M8.2 " + tag + ": every recovery FC03 goes out only after the hub let go of the write");
      check(n.reads_resumed_early == 0, "M8.2 " + tag + ": ordinary reads resume only once the hub holds neither the write's FC16 nor its readback");
      check(n.bound_violations == 0, "M8.2 " + tag + ": the read pause stays inside its derived bound");
    };

    // 1. Write without ACK: one FC16, then only recovery FC03.
    Config noack;
    noack.write_acked = false;
    const auto a = both("no ACK", noack, 5000, 5400);
    common(a.first, "no ACK");
    check(a.first.recovered_confirmed == a.first.queued, "M8.2 no ACK: the recovery probe reads the stored value (RECOVERED_CONFIRMED)");
    check(a.second.max_fc16 >= 2 && a.second.fc16_after > 0,
          "M8.1 transport: the simulation reproduces the transport retry (FC16 resent, also after WRITE_UNCERTAIN)");

    // 2. Late ACK: after the hub's send-wait (2000 ms) but before the 3 s ACK timeout.
    Config late = noack;
    late.write_acked = true;
    late.write_ack_delay_ms = 2500;
    const auto b = both("late ACK 2500 ms", late, 5000, 5400);
    common(b.first, "late ACK");
    check(b.first.late_dropped >= b.first.queued && b.first.recovered_confirmed == b.first.queued,
          "M8.2 late ACK: the late ACK is dropped by the hub, never resent for; the probe confirms the stored value");
    check(b.second.max_fc16 >= 2, "M8.1 transport: a late ACK met a resent FC16");
    Config inwin = late;
    inwin.write_ack_delay_ms = 1900;
    const auto b2 = both("ACK 1900 ms", inwin, 5000, 5400);
    common(b2.first, "ACK 1900 ms");
    check(b2.first.confirmed == b2.first.queued, "M8.2: an ACK inside the hub's send-wait confirms normally");

    // 3. Readback timeout and a late readback.
    Config rbto;
    rbto.readback_answers = false;
    const auto c3 = both("readback never answered", rbto, 5000, 5400);
    common(c3.first, "readback timeout");
    check(c3.first.max_readbacks == 1 && c3.first.recovered_confirmed == c3.first.queued,
          "M8.2 readback timeout: one readback frame, then recovery confirms");
    check(c3.second.max_readbacks >= 2, "M8.1 transport: the readback was resent");
    Config rblate;
    rblate.readback_delay_ms = 2500;
    const auto c4 = both("late readback 2500 ms", rblate, 5000, 5400);
    common(c4.first, "late readback");
    check(c4.first.max_readbacks == 1 && c4.first.late_dropped >= c4.first.queued,
          "M8.2 late readback: dropped by the hub, one readback frame only");

    // 4. gps_heartbeat = 1 (0x1114 bit 2, packed RMW in C2): one frame, zero repeats.
    Config gps;
    gps.address = 0x1114;
    gps.words = 1;
    gps.full_width = false;
    gps.mask = 0x0004;
    gps.shift = 2;
    gps.value = 1;
    gps.bms_initial = 0;
    gps.write_acked = false;
    const auto e = both("gps_heartbeat=1, no ACK", gps, 5000, 5400);
    common(e.first, "gps_heartbeat=1 no ACK");
    check(e.first.min_write_value == 0x0004 && e.first.max_write_value == 0x0004, "gps_heartbeat=1 writes the merged raw 0x0004");
    check(e.second.max_fc16 >= 2, "M8.1 transport: gps_heartbeat=1 was resent");
    Config gpsok = gps;
    gpsok.write_acked = true;
    const auto e2 = both("gps_heartbeat=1, ACK", gpsok, 5000, 5400);
    common(e2.first, "gps_heartbeat=1 ACK");
    check(e2.first.confirmed == e2.first.queued, "gps_heartbeat=1 with its ACK: one frame, CONFIRMED");

    // 5. The hub still holds the write after the state machine's timeout
    //    (send_wait_time 5000 ms > the 3 s ACK timeout): no ordinary read and
    //    no probe until the hub let go; then only recovery FC03.
    Config slow = noack;
    slow.send_wait_ms = 5000;
    const auto f = both("hub busy past ACK timeout (send-wait 5 s)", slow, 5000, 5400);
    common(f.first, "hub busy past ACK timeout");
    check(f.first.max_cleanup_after_ownership >= 1500, "the cleanup really waited for the hub (the write frame outlived the ACK timeout)");
    check(f.second.fc16_after > 0, "M8.1 transport: the write was resent after the slot was already WRITE_UNCERTAIN");

    std::printf("M8.2 derived read-pause bound (default send-wait 2000 ms): drain <= %u + 20 ms, ownership <= 7500 ms, cleanup <= 20 ms "
                "-> pause <= %u ms; observed max %u ms\n",
                unsigned(jk_write_tx::kQuiesceTimeoutMs), unsigned(jk_write_tx::kQuiesceTimeoutMs + 20 + 7500 + 20),
                unsigned(std::max({a.first.max_pause, b.first.max_pause, c3.first.max_pause, c4.first.max_pause, e.first.max_pause})));
  }

  std::printf("pre-write quiescence barrier: %d/%d checks passed\n", g_checks - g_failures, g_checks);
  return g_failures == 0 ? 0 : 1;
}
