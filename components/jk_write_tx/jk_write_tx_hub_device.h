#pragma once
// jk_write_tx_hub_device.h -- the Modbus client device every frame of a write
// transaction is sent by (clustered-read plan M8.2). ESPHome-dependent: the
// one place the transaction talks to the ESPHome 2026.9.1 Modbus hub. The
// policy it applies is pure and host-tested in jk_write_tx_core.h
// (transaction_frame_retry, transport_clean) by
// test/jk_write_tx/test_write_quiesce_barrier.cpp.
//
// Why not ModbusCommandItem: its on_no_response() asks the hub to resend an
// unanswered frame while the controller's shared cmd_non_responses_ <=
// max_cmd_retries (4) -- an FC16 write included, so one write could go out
// five times, the last ones after the slot had already become
// WRITE_UNCERTAIN. This device answers on_no_response() with
// transaction_frame_retry(): never. Each accepted frame ends in exactly one
// hub callback (response, exception, no response, or not sent), which ends
// the device's one outstanding frame; cancel() ends a phase early.
//
// Hub contract relied on (esphome/components/modbus/modbus.{h,cpp}):
//   - ModbusClientDevice::write_multiple_registers()/read_holding_registers()
//     queue through ModbusClientHub::queue_pdu(); false = refused, no callback;
//   - on_response()/on_error() fire at parse time, on_no_response() at the
//     send-wait watchdog, on_not_sent() from the sweep -- all in the hub's
//     loop() on the main loop;
//   - clear_tx_queue_for_device() silently retires this device's frames: a
//     queued one never goes out; one on the wire keeps waiting as a
//     device-less shell (device = nullptr: no callback, no retry) until its
//     response or send-wait timeout. transport_clean() waits that out.
//   - The same PDU queued again by the same device while live would be
//     absorbed as a second request (sent again): a device therefore queues
//     only when it has nothing outstanding.

#include <cstddef>
#include <cstdint>
#include <functional>
#include <span>
#include <utility>

#if __has_include("esphome/components/modbus/modbus.h")
#include "esphome/components/modbus/modbus.h"
#endif

#include "jk_write_tx_core.h"

namespace jk_write_tx_bus {

class TxDevice final : public esphome::modbus::ModbusClientDevice {
 public:
  // The response payload (FC03: the register bytes; FC16: the echoed
  // address/quantity), valid only during the call -- exactly what the old
  // ModbusCommandItem on_data_func received.
  using Handler = std::function<void(std::span<const uint8_t> payload)>;

  // One FC16 frame. False when refused or this device still owns a frame.
  bool write_registers(esphome::modbus::ModbusClientHub *hub, uint8_t address, uint16_t start, std::span<const uint16_t> values,
                       Handler on_ack) {
    if (!this->arm_(hub, address, std::move(on_ack))) return false;
    if (this->write_multiple_registers(start, values)) return true;
    this->disarm_();
    return false;
  }

  // One FC03 frame. False when refused or this device still owns a frame.
  bool read_registers(esphome::modbus::ModbusClientHub *hub, uint8_t address, uint16_t start, uint16_t count, Handler on_data) {
    if (!this->arm_(hub, address, std::move(on_data))) return false;
    if (this->read_holding_registers(start, count)) return true;
    this->disarm_();
    return false;
  }

  // End of the phase this device's frame belonged to: nothing of it can be
  // delivered, resent or sent any more.
  void cancel() {
    if (this->parent_ != nullptr) this->clear_tx_queue_for_device();
    this->disarm_();
  }

  bool outstanding() const { return this->outstanding_; }
  uint32_t frames_sent() const { return this->frames_sent_; }

  void on_response(std::span<const uint8_t> request_pdu, std::span<const uint8_t> response_pdu) override {
    (void) request_pdu;
    if (!this->outstanding_) return;
    Handler h = std::move(this->handler_);
    this->disarm_();
    if (h) h(esphome::modbus::helpers::server_pdu_payload(response_pdu));
  }
  // An exception is no ACK and no readback, exactly as before: the
  // transaction's own timeout decides.
  void on_error(std::span<const uint8_t> request_pdu, esphome::modbus::ExceptionCode exception_code) override {
    (void) request_pdu;
    (void) exception_code;
    this->disarm_();
  }
  void on_not_sent(std::span<const uint8_t> request_pdu) override {
    (void) request_pdu;
    this->disarm_();
  }
  void on_sent(std::span<const uint8_t> request_pdu) override {
    (void) request_pdu;
    this->frames_sent_++;
    if (this->attempts_ < 0xFF) this->attempts_++;
  }
  // Never a transport retry (plan M8.2): one write = one FC16 frame.
  bool on_no_response(std::span<const uint8_t> request_pdu) override {
    (void) request_pdu;
    const bool retry = jk_write_tx::transaction_frame_retry(this->attempts_);
    if (!retry) this->disarm_();
    return retry;
  }

 private:
  bool arm_(esphome::modbus::ModbusClientHub *hub, uint8_t address, Handler h) {
    if (this->outstanding_ || hub == nullptr) return false;
    this->set_parent(hub);
    this->set_address(address);
    this->handler_ = std::move(h);
    this->attempts_ = 0;
    this->outstanding_ = true;
    return true;
  }
  void disarm_() {
    this->outstanding_ = false;
    this->handler_ = nullptr;
  }

  Handler handler_;
  bool outstanding_ = false;
  uint8_t attempts_ = 0;
  uint32_t frames_sent_ = 0;
};

// One device per generic write slot (its write, then its forced readback,
// then its recovery probes -- one frame at a time), and one per read of the
// CellCount, topology-recovery and passcode transactions.
inline TxDevice g_slot_devices[6];
inline TxDevice g_cellcount_cc_device, g_cellcount_mask_device;
inline TxDevice g_topology_cc_device, g_topology_mask_device;
inline TxDevice g_passcode_device;

inline bool any_outstanding() {
  for (const auto &d : g_slot_devices)
    if (d.outstanding()) return true;
  return g_cellcount_cc_device.outstanding() || g_cellcount_mask_device.outstanding() || g_topology_cc_device.outstanding() ||
         g_topology_mask_device.outstanding() || g_passcode_device.outstanding();
}

}  // namespace jk_write_tx_bus
