#pragma once
// Host stand-in for esphome/components/modbus/modbus.h (ESPHome 2026.9.1),
// for test/jk_write_tx/test_tx_send_attempts.cpp only. It carries just what
// jk_write_tx_hub_device.h uses, plus a hub that keeps the 2026.9.1 frame
// lifecycle that send-attempt accounting depends on (modbus.{h,cpp} at the
// 2026.9.1 tag):
//   - queue_pdu() only queues (READY); nothing is sent and on_sent() does not
//     fire at queue time;
//   - send_next() = send_next_frame_(): picks the READY frame (WRITE class
//     before READ, then oldest), "transmits" it, then ModbusDeviceCommand::
//     sent(): WAITING and on_sent() -- unless the entry is device-less;
//   - response/exception = one terminal; the entry is requeued while pending;
//   - timeout = timed_out(): pending--, then on_no_response(); a true answer
//     re-requests (pending++), so the frame goes out again;
//   - clear_tx_queue_for_device() = silent_retire(): a READY frame is RETIRED
//     (never sent), a WAITING one becomes a device-less shell (no callback,
//     no retry, pending 0);
//   - a live duplicate (same device, same PDU) is absorbed as pending++ and
//     therefore sent again.
// The test counts real frames itself (`transmissions`) and compares.

#include <cstddef>
#include <cstdint>
#include <span>
#include <vector>

namespace esphome::modbus {

enum class ExceptionCode : uint8_t { ILLEGAL_FUNCTION = 0x01, ILLEGAL_DATA_ADDRESS = 0x02, ILLEGAL_DATA_VALUE = 0x03 };
struct CommandOptions {};

namespace helpers {
inline bool is_function_code_read(uint8_t fc) { return fc >= 0x01 && fc <= 0x04; }
inline bool is_function_code_write(uint8_t fc) { return fc == 0x05 || fc == 0x06 || fc == 0x0F || fc == 0x10; }
inline std::span<const uint8_t> server_pdu_payload(std::span<const uint8_t> pdu) {
  if (pdu.empty()) return {};
  const size_t offset = (!(pdu[0] & 0x80) && is_function_code_read(pdu[0])) ? 2 : 1;
  return pdu.size() > offset ? pdu.subspan(offset) : std::span<const uint8_t>();
}
}  // namespace helpers

class ModbusClientDevice;

enum class FrameState : uint8_t { READY, WAITING, RETIRED, DONE };

struct ModbusDeviceCommand {
  ModbusClientDevice *device;
  uint8_t address;
  std::vector<uint8_t> pdu;
  FrameState state = FrameState::READY;
  uint8_t pending = 1;
  uint32_t seq = 0;
  bool shell = false;
};

class ModbusClientHub {
 public:
  bool queue_pdu(uint8_t address, std::span<const uint8_t> pdu, ModbusClientDevice *device = nullptr, CommandOptions = {});
  void clear_tx_queue_for_device(ModbusClientDevice *device) {
    for (auto &c : this->q_) {
      if (c.device != device) continue;
      if (c.state == FrameState::WAITING) c.shell = true;
      else if (c.state == FrameState::READY) c.state = FrameState::RETIRED;
      c.pending = 0;
      c.device = nullptr;
    }
  }
  // send_next_frame_(): returns the PDU sent, or empty when nothing was sent.
  std::vector<uint8_t> send_next();
  void respond(std::span<const uint8_t> response_pdu);
  void exception(ExceptionCode code);
  void timeout();
  bool waiting() const {
    for (const auto &c : this->q_)
      if (c.state == FrameState::WAITING) return true;
    return false;
  }
  bool ready() const {
    for (const auto &c : this->q_)
      if (c.state == FrameState::READY) return true;
    return false;
  }
  int transmissions = 0;       // frames that actually left the hub
  int fc16_transmissions = 0;  // of them FC16

 private:
  ModbusDeviceCommand *waiting_cmd_() {
    for (auto &c : this->q_)
      if (c.state == FrameState::WAITING) return &c;
    return nullptr;
  }
  void finish_(ModbusDeviceCommand &c) {
    if (c.pending > 0) {
      c.state = FrameState::READY;
      c.seq = this->seq_++;
    } else {
      c.state = FrameState::DONE;
    }
  }
  std::vector<ModbusDeviceCommand> q_;
  uint32_t seq_ = 0;
};

class ModbusClientDevice {
 public:
  ModbusClientDevice() = default;
  virtual ~ModbusClientDevice() = default;
  ModbusClientDevice(const ModbusClientDevice &) = delete;
  ModbusClientDevice &operator=(const ModbusClientDevice &) = delete;
  void set_parent(ModbusClientHub *parent) { this->parent_ = parent; }
  void set_address(uint8_t address) { this->address_ = address; }
  virtual void on_response(std::span<const uint8_t>, std::span<const uint8_t>) {}
  virtual void on_error(std::span<const uint8_t>, ExceptionCode) {}
  virtual void on_not_sent(std::span<const uint8_t>) {}
  virtual void on_sent(std::span<const uint8_t>) {}
  virtual bool on_no_response(std::span<const uint8_t>) { return false; }
  bool queue_pdu(std::span<const uint8_t> pdu, CommandOptions options = {}) {
    return this->parent_->queue_pdu(this->address_, pdu, this, options);
  }
  bool read_holding_registers(uint16_t start, uint16_t count, CommandOptions options = {}) {
    const uint8_t pdu[] = {0x03, uint8_t(start >> 8), uint8_t(start), uint8_t(count >> 8), uint8_t(count)};
    return this->queue_pdu(pdu, options);
  }
  bool write_multiple_registers(uint16_t start, std::span<const uint16_t> values, CommandOptions options = {}) {
    if (values.empty()) return false;
    std::vector<uint8_t> pdu = {0x10, uint8_t(start >> 8), uint8_t(start), uint8_t(values.size() >> 8), uint8_t(values.size()),
                                uint8_t(values.size() * 2)};
    for (uint16_t v : values) {
      pdu.push_back(uint8_t(v >> 8));
      pdu.push_back(uint8_t(v));
    }
    return this->queue_pdu(pdu, options);
  }
  void clear_tx_queue_for_device() { this->parent_->clear_tx_queue_for_device(this); }

 protected:
  ModbusClientHub *parent_{nullptr};
  uint8_t address_{0};
};

inline bool ModbusClientHub::queue_pdu(uint8_t address, std::span<const uint8_t> pdu, ModbusClientDevice *device, CommandOptions) {
  if (pdu.empty()) return false;
  for (auto &c : this->q_) {
    if (c.state == FrameState::RETIRED || c.state == FrameState::DONE || c.shell) continue;
    if (c.device == device && c.address == address && std::vector<uint8_t>(pdu.begin(), pdu.end()) == c.pdu) {
      c.pending++;  // absorbed duplicate: one more request, sent again after this one resolves
      return true;
    }
  }
  ModbusDeviceCommand c{device, address, std::vector<uint8_t>(pdu.begin(), pdu.end())};
  c.seq = this->seq_++;
  this->q_.push_back(std::move(c));
  return true;
}

inline std::vector<uint8_t> ModbusClientHub::send_next() {
  if (this->waiting()) return {};
  ModbusDeviceCommand *best = nullptr;
  for (auto &c : this->q_) {
    if (c.state != FrameState::READY) continue;
    const bool w = helpers::is_function_code_write(c.pdu[0]);
    if (best == nullptr) { best = &c; continue; }
    const bool bw = helpers::is_function_code_write(best->pdu[0]);
    if (w != bw) { if (w) best = &c; continue; }
    if (c.seq < best->seq) best = &c;
  }
  if (best == nullptr) return {};
  // send_frame_(): the frame goes to the UART here.
  this->transmissions++;
  if (best->pdu[0] == 0x10) this->fc16_transmissions++;
  // ModbusDeviceCommand::sent()
  best->state = FrameState::WAITING;
  const std::vector<uint8_t> sent = best->pdu;
  if (best->device != nullptr) best->device->on_sent(best->pdu);
  return sent;
}

inline void ModbusClientHub::respond(std::span<const uint8_t> response_pdu) {
  ModbusDeviceCommand *c = this->waiting_cmd_();
  if (c == nullptr) return;
  if (c->pending > 0) c->pending--;
  ModbusClientDevice *d = c->device;
  const std::vector<uint8_t> req = c->pdu;
  c->shell = false;
  this->finish_(*c);
  if (d != nullptr) d->on_response(req, response_pdu);
}

inline void ModbusClientHub::exception(ExceptionCode code) {
  ModbusDeviceCommand *c = this->waiting_cmd_();
  if (c == nullptr) return;
  if (c->pending > 0) c->pending--;
  ModbusClientDevice *d = c->device;
  const std::vector<uint8_t> req = c->pdu;
  c->shell = false;
  this->finish_(*c);
  if (d != nullptr) d->on_error(req, code);
}

inline void ModbusClientHub::timeout() {
  ModbusDeviceCommand *c = this->waiting_cmd_();
  if (c == nullptr) return;
  if (c->pending > 0) c->pending--;  // timed_out(): resolve this request
  c->shell = false;
  if (c->device != nullptr && c->device->on_no_response(c->pdu)) c->pending++;  // granted retry = re-request
  this->finish_(*c);
}

}  // namespace esphome::modbus
