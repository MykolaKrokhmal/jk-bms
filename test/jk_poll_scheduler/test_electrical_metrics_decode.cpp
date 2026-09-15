// Golden-vector unit tests for jk_poll_scheduler::decode_electrical_metrics
// -- the hand-ported, audited voltage/current/power/sign-convention
// computation for register 0x1290 (electrical_metrics_scan), migrated off
// its pre-Stage-1 modbus_controller lambda during Stage 1's corrective
// pass. Every expected value here was computed independently (a small
// Node script, not by re-deriving the C++ under test) and is asserted to
// float precision -- this is the one gate proving the migration did not
// alter the SIGN CONVENTION or the computation, not just that the code
// compiles. No ESP32, no ESPHome, no ESP-IDF needed.
//
//   g++ -std=c++17 -Wall -Wextra -I ../../components/jk_poll_scheduler \
//       test_electrical_metrics_decode.cpp -o test_electrical_metrics_decode
//   ./test_electrical_metrics_decode

#include "jk_poll_scheduler_core.h"

#include <cmath>
#include <cstdio>

using namespace jk_poll_scheduler;

namespace {
int g_failures = 0;
int g_checks = 0;

void check_near(float actual, float expected, float tol, const char *desc) {
  g_checks++;
  if (std::fabs(actual - expected) > tol) {
    g_failures++;
    std::printf("FAIL: %s (expected=%f actual=%f)\n", desc, expected, actual);
  }
}
}  // namespace

// Bytes 4-7 (BatWatt) are deliberately garbage/nonzero in every case below
// -- decode_electrical_metrics() must never read them (the pre-migration
// lambda never did either; every power metric is derived from V x I).

static void test_charging_positive_current() {
  // voltage_mv=52000 (52.000V), current_ma=+10000 (10.000A, charging).
  const uint8_t raw[12] = {0x00, 0x00, 0xCB, 0x20, 0xDE, 0xAD, 0xBE, 0xEF, 0x00, 0x00, 0x27, 0x10};
  const ElectricalMetrics m = decode_electrical_metrics(raw);
  check_near(m.total_voltage_v, 52.0f, 1e-4f, "charging: total_voltage_v");
  check_near(m.current_a, 10.0f, 1e-4f, "charging: current_a is POSITIVE for charging (sign convention)");
  check_near(m.power_w, 520.0f, 1e-2f, "charging: power_w = V x I");
  check_near(m.charging_power_w, 520.0f, 1e-2f, "charging: charging_power_w = power_w (power > 0)");
  check_near(m.discharging_power_w, 0.0f, 1e-6f, "charging: discharging_power_w is exactly 0 (power > 0)");
}

static void test_discharging_negative_current() {
  // voltage_mv=51500 (51.500V), current_ma=-15000 (-15.000A, discharging).
  const uint8_t raw[12] = {0x00, 0x00, 0xC9, 0x2C, 0xDE, 0xAD, 0xBE, 0xEF, 0xFF, 0xFF, 0xC5, 0x68};
  const ElectricalMetrics m = decode_electrical_metrics(raw);
  check_near(m.total_voltage_v, 51.5f, 1e-4f, "discharging: total_voltage_v");
  check_near(m.current_a, -15.0f, 1e-4f, "discharging: current_a is NEGATIVE for discharging (sign convention)");
  check_near(m.power_w, -772.5f, 1e-2f, "discharging: power_w = V x I, same sign as current");
  check_near(m.charging_power_w, 0.0f, 1e-6f, "discharging: charging_power_w is exactly 0 (power < 0)");
  check_near(m.discharging_power_w, 772.5f, 1e-2f, "discharging: discharging_power_w = -power_w (power < 0)");
}

static void test_zero_current_both_power_metrics_are_zero() {
  // voltage_mv=50000 (50.000V), current_ma=0 -- the boundary case neither
  // "power_w > 0" nor "power_w < 0" is true, so BOTH charging_power_w and
  // discharging_power_w must be exactly 0, not one of them left stale.
  const uint8_t raw[12] = {0x00, 0x00, 0xC3, 0x50, 0xDE, 0xAD, 0xBE, 0xEF, 0x00, 0x00, 0x00, 0x00};
  const ElectricalMetrics m = decode_electrical_metrics(raw);
  check_near(m.total_voltage_v, 50.0f, 1e-4f, "zero_current: total_voltage_v");
  check_near(m.current_a, 0.0f, 1e-6f, "zero_current: current_a is exactly 0");
  check_near(m.power_w, 0.0f, 1e-6f, "zero_current: power_w is exactly 0");
  check_near(m.charging_power_w, 0.0f, 1e-6f, "zero_current: charging_power_w is exactly 0");
  check_near(m.discharging_power_w, 0.0f, 1e-6f, "zero_current: discharging_power_w is exactly 0");
}

static void test_large_discharge_current_signed_boundary() {
  // voltage_mv=48000 (48.000V), current_ma=-100000 (-100.000A) -- a large
  // magnitude signed value exercising more than the low byte of the S32,
  // guarding against an accidental 8/16-bit truncation in the port.
  const uint8_t raw[12] = {0x00, 0x00, 0xBB, 0x80, 0xDE, 0xAD, 0xBE, 0xEF, 0xFF, 0xFE, 0x79, 0x60};
  const ElectricalMetrics m = decode_electrical_metrics(raw);
  check_near(m.total_voltage_v, 48.0f, 1e-4f, "large_discharge: total_voltage_v");
  check_near(m.current_a, -100.0f, 1e-3f, "large_discharge: current_a (large-magnitude signed value)");
  check_near(m.power_w, -4800.0f, 1e-1f, "large_discharge: power_w");
  check_near(m.charging_power_w, 0.0f, 1e-6f, "large_discharge: charging_power_w is exactly 0");
  check_near(m.discharging_power_w, 4800.0f, 1e-1f, "large_discharge: discharging_power_w");
}

static void test_batwatt_bytes_4_to_7_never_read() {
  // Two payloads differing ONLY in bytes 4-7 (BatWatt) must decode
  // identically -- proves decode_electrical_metrics() never reads that
  // range, exactly like the pre-migration lambda it was ported from.
  const uint8_t raw_a[12] = {0x00, 0x00, 0xCB, 0x20, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x27, 0x10};
  const uint8_t raw_b[12] = {0x00, 0x00, 0xCB, 0x20, 0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x27, 0x10};
  const ElectricalMetrics ma = decode_electrical_metrics(raw_a);
  const ElectricalMetrics mb = decode_electrical_metrics(raw_b);
  check_near(ma.total_voltage_v, mb.total_voltage_v, 1e-9f, "BatWatt bytes ignored: total_voltage_v unaffected");
  check_near(ma.current_a, mb.current_a, 1e-9f, "BatWatt bytes ignored: current_a unaffected");
  check_near(ma.power_w, mb.power_w, 1e-9f, "BatWatt bytes ignored: power_w unaffected");
}

int main() {
  test_charging_positive_current();
  test_discharging_negative_current();
  test_zero_current_both_power_metrics_are_zero();
  test_large_discharge_current_signed_boundary();
  test_batwatt_bytes_4_to_7_never_read();

  std::printf("%d checks run, %d failed.\n", g_checks, g_failures);
  return g_failures == 0 ? 0 : 1;
}
