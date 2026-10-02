// Gate D send-attempt accounting (2026-10-02): the REAL TxDevice
// (components/jk_write_tx/jk_write_tx_hub_device.h) and the REAL
// jk_write_tx::count_frame_attempt()/format_frame_attempts_json(), driven
// against a host hub that keeps the ESPHome 2026.9.1 frame lifecycle
// (test/jk_write_tx/esphome_modbus_stub/.../modbus.h). Each scenario follows
// what batterylifepo4.yaml does with a write slot's device: begin the
// transaction's accounting, queue the FC16, then the forced readback or the
// recovery probe, cancel at every phase end. The hub counts the frames it
// really transmitted; the device's counters must equal them, and no scenario
// may transmit a second FC16.
//
//   g++ -std=c++20 -O2 -I test/jk_write_tx/esphome_modbus_stub -I components/jk_write_tx \
//       test/jk_write_tx/test_tx_send_attempts.cpp

#include "jk_write_tx_hub_device.h"

#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

namespace {

int g_pass = 0, g_fail = 0;
void check(bool cond, const std::string &desc) {
  if (cond) {
    g_pass++;
    std::printf("PASS  %s\n", desc.c_str());
  } else {
    g_fail++;
    std::printf("FAIL  %s\n", desc.c_str());
  }
}

using esphome::modbus::ModbusClientHub;
using jk_write_tx::FramePurpose;
using jk_write_tx_bus::TxDevice;

constexpr uint8_t kBms = 1;

std::vector<uint8_t> fc16_echo(uint16_t start, uint16_t qty) {
  return {0x10, uint8_t(start >> 8), uint8_t(start), uint8_t(qty >> 8), uint8_t(qty)};
}
std::vector<uint8_t> fc03_reply(std::vector<uint16_t> words) {
  std::vector<uint8_t> r = {0x03, uint8_t(words.size() * 2)};
  for (uint16_t w : words) {
    r.push_back(uint8_t(w >> 8));
    r.push_back(uint8_t(w));
  }
  return r;
}

// The snapshot entry the firmware publishes for a slot (non-passcode form).
std::string snapshot_entry(uint16_t addr, uint32_t tx_id, uint8_t status, uint32_t req, uint32_t rb, uint16_t qty,
                           const jk_write_tx::FrameAttempts &a) {
  char buf[160];
  std::string out;
  std::snprintf(buf, sizeof buf, "{\"addr\":%u,\"tx_id\":%u,\"status\":%u,\"req\":%u,\"rb\":%u", unsigned(addr), unsigned(tx_id),
                unsigned(status), unsigned(req), unsigned(rb));
  out += buf;
  jk_write_tx::format_frame_attempts_json(buf, sizeof buf, jk_write_tx::kFunctionWriteMultipleRegisters, qty, a);
  out += buf;
  out += "}";
  return out;
}

struct Seen {
  int acks = 0, data = 0;
  uint32_t value = 0;
};

// The yaml's write enqueue: accounting reset, then the one FC16.
bool start_write(TxDevice &d, ModbusClientHub &hub, uint16_t addr, std::vector<uint16_t> words, Seen &seen) {
  d.begin_transaction_attempts();
  return d.write_registers(&hub, kBms, addr, words, [&seen](std::span<const uint8_t>) { seen.acks++; });
}
bool start_read(TxDevice &d, ModbusClientHub &hub, uint16_t addr, uint16_t count, FramePurpose p, Seen &seen) {
  return d.read_registers(
      &hub, kBms, addr, count,
      [&seen](std::span<const uint8_t> payload) {
        seen.data++;
        seen.value = 0;
        for (uint8_t b : payload) seen.value = (seen.value << 8) | b;
      },
      p);
}
// Drive the hub until nothing more can be sent (each frame then times out).
void drain_with_timeouts(ModbusClientHub &hub, int max_rounds = 10) {
  for (int i = 0; i < max_rounds; i++) {
    if (hub.waiting()) hub.timeout();
    if (hub.send_next().empty() && !hub.waiting()) break;
  }
}

bool attempts_are(const jk_write_tx::FrameAttempts &a, int fc16, int readback, int probe) {
  return a.fc16 == fc16 && a.readback == readback && a.probe == probe && a.other == 0;
}

}  // namespace

int main() {
  // --- pure accounting ---------------------------------------------------
  {
    jk_write_tx::FrameAttempts a;
    jk_write_tx::count_frame_attempt(a, FramePurpose::WRITE, 0x10);
    jk_write_tx::count_frame_attempt(a, FramePurpose::READBACK, 0x03);
    jk_write_tx::count_frame_attempt(a, FramePurpose::PROBE, 0x03);
    jk_write_tx::count_frame_attempt(a, FramePurpose::PROBE, 0x03);
    check(attempts_are(a, 1, 1, 2), "count_frame_attempt: one FC16, one readback, two probe frames are told apart");
    jk_write_tx::FrameAttempts b;
    jk_write_tx::count_frame_attempt(b, FramePurpose::READBACK, 0x10);
    check(attempts_are(b, 1, 0, 0), "count_frame_attempt: an FC16 counts as FC16 whatever the caller meant (the sent PDU decides)");
    jk_write_tx::FrameAttempts c;
    for (int i = 0; i < 300; i++) jk_write_tx::count_frame_attempt(c, FramePurpose::WRITE, 0x10);
    check(c.fc16 == 255, "count_frame_attempt: saturates at 255 (never wraps back to a small count)");
  }

  // --- 1. NO_CHANGE: no transaction, no frame --------------------------------
  {
    ModbusClientHub hub;
    const uint32_t total0 = jk_write_tx_bus::g_fc16_sent_total;
    // NO_CHANGE returns before any slot or device is touched (the yaml's
    // register-write path); the hub keeps running.
    for (int i = 0; i < 5; i++) hub.send_next();
    check(hub.transmissions == 0 && jk_write_tx_bus::g_fc16_sent_total == total0,
          "NO_CHANGE: no frame transmitted and fc16_sent_total unchanged (no snapshot entry: no tx_id)");
  }

  // --- 2. queued, never transmitted: cancel before the send -------------------
  {
    ModbusClientHub hub;
    TxDevice d;
    Seen s;
    const uint32_t total0 = jk_write_tx_bus::g_fc16_sent_total;
    check(start_write(d, hub, 0x1014, {0x0000, 0x000A}, s), "queued-only: the FC16 is accepted by the hub");
    check(attempts_are(d.transaction_attempts(), 0, 0, 0), "queued-only: queueing alone counts nothing (not an enqueue counter)");
    d.cancel();  // phase end before the hub reached it (silent_retire of a READY frame)
    drain_with_timeouts(hub);
    check(hub.transmissions == 0 && attempts_are(d.transaction_attempts(), 0, 0, 0) && jk_write_tx_bus::g_fc16_sent_total == total0,
          "queued-only: a frame cancelled before transmission is never sent and never counted (fc16_send_attempts=0)");
  }

  // --- 3. successful change: one FC16, one readback, CONFIRMED -----------------
  {
    ModbusClientHub hub;
    TxDevice d;
    Seen s;
    const uint32_t total0 = jk_write_tx_bus::g_fc16_sent_total;
    start_write(d, hub, 0x1014, {0x0000, 0x000B}, s);
    const auto sent = hub.send_next();
    check(sent.size() == 10 && sent[0] == 0x10 && sent[1] == 0x10 && sent[2] == 0x14 && sent[4] == 2,
          "success: the frame on the wire is FC16 0x1014 qty 2");
    check(d.transaction_attempts().fc16 == 1, "success: counted when the hub transmitted it (on_sent), not before");
    hub.respond(fc16_echo(0x1014, 2));
    check(s.acks == 1 && !d.outstanding(), "success: the ACK ends the frame");
    d.cancel();
    start_read(d, hub, 0x1014, 2, FramePurpose::READBACK, s);
    hub.send_next();
    hub.respond(fc03_reply({0x0000, 0x000B}));
    d.cancel();
    drain_with_timeouts(hub);
    check(s.data == 1 && s.value == 0x000B, "success: the forced readback returns the written value");
    check(attempts_are(d.transaction_attempts(), 1, 1, 0) && hub.fc16_transmissions == 1 && hub.transmissions == 2,
          "success: fc16_send_attempts=1, readback_send_attempts=1, probe_send_attempts=0 = the hub's own frame count");
    check(jk_write_tx_bus::g_fc16_sent_total == total0 + 1, "success: fc16_sent_total grew by exactly one (FC03 frames do not count)");
    const std::string snap = snapshot_entry(0x1014, 7, jk_write_tx::CONFIRMED, 11, 11, 2, d.transaction_attempts());
    std::printf("      example CONFIRMED: %s\n", snap.c_str());
    check(snap == "{\"addr\":4116,\"tx_id\":7,\"status\":4,\"req\":11,\"rb\":11,\"fn\":16,\"qty\":2,\"fc16_send_attempts\":1,"
                  "\"readback_send_attempts\":1,\"probe_send_attempts\":0}",
          "success: the snapshot entry carries fn/qty and the three send-attempt counts");

    // The next transaction on the same slot device starts from zero.
    Seen s2;
    start_write(d, hub, 0x1014, {0x0000, 0x000A}, s2);
    check(attempts_are(d.transaction_attempts(), 0, 0, 0), "next transaction on the slot: accounting restarts at 0");
    d.cancel();
  }

  // --- 4. ACK timeout: the hub's send-wait expires; never a second FC16 -------
  {
    ModbusClientHub hub;
    TxDevice d;
    Seen s;
    start_write(d, hub, 0x1114, {0x3204}, s);  // gps_heartbeat=1: bit 2 merged into 0x1114
    hub.send_next();
    hub.timeout();  // no ACK within send_wait_time: on_no_response -> transaction_frame_retry(): never
    check(!d.outstanding() && !hub.ready(), "ACK timeout: the device lets go and the hub holds no frame to resend");
    for (int i = 0; i < 5; i++) hub.send_next();
    check(hub.fc16_transmissions == 1 && d.transaction_attempts().fc16 == 1,
          "ACK timeout (gps_heartbeat=1): the FC16 went out once and is never resent");
    {
      const std::string snap = snapshot_entry(0x1114, 8, jk_write_tx::ACK_TIMEOUT, 0x3204, 0, 1, d.transaction_attempts());
      std::printf("      example ACK timeout (terminal): %s\n", snap.c_str());
      check(snap.find("\"status\":7") != std::string::npos &&
                snap.find("\"fc16_send_attempts\":1,\"readback_send_attempts\":0,\"probe_send_attempts\":0}") != std::string::npos,
            "ACK timeout: the terminal snapshot shows ACK_TIMEOUT after exactly one FC16 and nothing else");
    }
    d.cancel();  // ACK timeout phase end -> WRITE_UNCERTAIN; then the recovery probe
    start_read(d, hub, 0x1114, 1, FramePurpose::PROBE, s);
    hub.send_next();
    hub.respond(fc03_reply({0x3204}));
    d.cancel();
    drain_with_timeouts(hub);
    check(attempts_are(d.transaction_attempts(), 1, 0, 1) && hub.fc16_transmissions == 1,
          "ACK timeout: fc16_send_attempts=1, readback_send_attempts=0, probe_send_attempts=1");
    const std::string snap = snapshot_entry(0x1114, 8, jk_write_tx::RECOVERED_CONFIRMED, 0x3204, 0x3204, 1, d.transaction_attempts());
    std::printf("      example ACK timeout -> recovered: %s\n", snap.c_str());
    check(snap.find("\"status\":10") != std::string::npos && snap.find("\"fc16_send_attempts\":1,") != std::string::npos &&
              snap.find("\"probe_send_attempts\":1}") != std::string::npos,
          "ACK timeout: the snapshot shows RECOVERED_CONFIRMED after one FC16 and one probe");
  }

  // --- 5. transaction timeout while the FC16 still waits on the hub -----------
  {
    ModbusClientHub hub;
    TxDevice d;
    Seen s;
    start_write(d, hub, 0x1114, {0x3204}, s);
    hub.send_next();
    d.cancel();  // phase ends first: the frame on the wire becomes a device-less shell
    check(!d.outstanding(), "cancel on the wire: the device holds nothing");
    hub.timeout();  // the shell's send-wait: no callback, no retry
    for (int i = 0; i < 5; i++) hub.send_next();
    check(hub.fc16_transmissions == 1 && d.transaction_attempts().fc16 == 1,
          "cancel on the wire: the shell resolves silently, no second FC16");
    hub.respond(fc16_echo(0x1114, 1));  // a very late ACK has nothing to match
    check(s.acks == 0, "cancel on the wire: a late ACK is not delivered to the cancelled device");
  }

  // --- 6. device exception to the FC16 ----------------------------------------
  {
    ModbusClientHub hub;
    TxDevice d;
    Seen s;
    start_write(d, hub, 0x1014, {0x0000, 0x000B}, s);
    hub.send_next();
    hub.exception(esphome::modbus::ExceptionCode::ILLEGAL_DATA_VALUE);
    for (int i = 0; i < 5; i++) hub.send_next();
    check(s.acks == 0 && hub.fc16_transmissions == 1 && d.transaction_attempts().fc16 == 1,
          "exception reply: no ACK, no resend, fc16_send_attempts=1");
  }

  // --- 7. readback timeout and readback mismatch -------------------------------
  {
    ModbusClientHub hub;
    TxDevice d;
    Seen s;
    start_write(d, hub, 0x1014, {0x0000, 0x000B}, s);
    hub.send_next();
    hub.respond(fc16_echo(0x1014, 2));
    d.cancel();
    start_read(d, hub, 0x1014, 2, FramePurpose::READBACK, s);
    hub.send_next();
    hub.timeout();  // readback unanswered: never resent either
    for (int i = 0; i < 5; i++) hub.send_next();
    check(attempts_are(d.transaction_attempts(), 1, 1, 0) && hub.transmissions == 2,
          "readback timeout: fc16_send_attempts=1, readback_send_attempts=1 (not resent)");
    d.cancel();
    start_read(d, hub, 0x1014, 2, FramePurpose::PROBE, s);
    hub.send_next();
    hub.respond(fc03_reply({0x0000, 0x000B}));
    d.cancel();
    check(attempts_are(d.transaction_attempts(), 1, 1, 1) && hub.fc16_transmissions == 1,
          "readback timeout -> probe: the recovery read is counted apart; still one FC16");
    const std::string snap = snapshot_entry(0x1014, 9, jk_write_tx::RECOVERED_CONFIRMED, 11, 11, 2, d.transaction_attempts());
    std::printf("      example readback timeout -> recovered: %s\n", snap.c_str());

    ModbusClientHub hub2;
    TxDevice m;
    Seen s2;
    start_write(m, hub2, 0x1014, {0x0000, 0x000B}, s2);
    hub2.send_next();
    hub2.respond(fc16_echo(0x1014, 2));
    m.cancel();
    start_read(m, hub2, 0x1014, 2, FramePurpose::READBACK, s2);
    hub2.send_next();
    hub2.respond(fc03_reply({0x0000, 0x000A}));  // the BMS kept another value
    m.cancel();
    drain_with_timeouts(hub2);
    check(s2.value == 0x000A && attempts_are(m.transaction_attempts(), 1, 1, 0) && hub2.fc16_transmissions == 1,
          "readback mismatch: the MISMATCH is reported after one FC16 and one readback; no rewrite");
  }

  // --- 8. the counter counts transmissions, not calls ---------------------------
  {
    ModbusClientHub hub;
    TxDevice d;
    Seen s;
    start_write(d, hub, 0x1014, {0x0000, 0x000B}, s);
    check(!d.write_registers(&hub, kBms, 0x1014, std::vector<uint16_t>{0x0000, 0x000B}, nullptr),
          "single frame: the device refuses a second FC16 while its first is outstanding");
    // Bypassing the device's guard: a duplicate the hub absorbs is sent twice,
    // and the counter must say so (it counts frames that left the hub).
    const uint16_t words[] = {0x0000, 0x000B};
    d.write_multiple_registers(0x1014, words);
    hub.send_next();
    hub.respond(fc16_echo(0x1014, 2));
    hub.send_next();
    check(hub.fc16_transmissions == 2 && d.transaction_attempts().fc16 == 2,
          "sensitivity: an absorbed duplicate that really goes out twice is counted twice (fc16_send_attempts=2)");
    hub.respond(fc16_echo(0x1014, 2));
    d.cancel();
  }

  std::printf("tx send attempts: %d/%d checks passed\n", g_pass, g_pass + g_fail);
  return g_fail == 0 ? 0 : 1;
}
