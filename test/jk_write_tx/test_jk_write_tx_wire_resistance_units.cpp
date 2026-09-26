// Host-side round-trip tests for the connection-wire-resistance calibration
// unit normalization (CellConWireRes0-31, 0x1088-0x1104): the raw register
// unit is 1 uOhm (official V1.1 PDF, V2 workbook), the owner-facing unit is
// mOhm (V2 workbook: "display in mOhm with multiplier 0.001"), matching the
// measured wire resistance at 0x124A.
//
// Uses the REAL firmware encoder (jk_write_tx_core.h encode_numeric_field) and
// the REAL generated write-registry rows (write_registry_table.h), and the same
// decode rule as the bespoke read lambda in batterylifepo4.yaml
// (raw * 0.001 in double, published as float).
//
//   g++ -std=c++17 -Wall -Wextra -I ../../components/jk_write_tx -I ../../protocol/generated \
//       test_jk_write_tx_wire_resistance_units.cpp -o test_wire_units && ./test_wire_units

#include "jk_write_tx_core.h"
#include "write_registry_table.h"

#include <cstdio>
#include <cstdlib>
#include <string>

using namespace jk_write_tx;

namespace {
int g_failures = 0;
int g_checks = 0;

void check(bool cond, const std::string &desc) {
  g_checks++;
  if (!cond) {
    g_failures++;
    std::printf("FAIL: %s\n", desc.c_str());
  }
}

EncodeResult encode_mohm(const jk_write_registry::Entry &e, double mohm) {
  return encode_numeric_field(mohm, e.is_signed, e.scale, e.offset, e.minimum, e.maximum, e.field_width_bits);
}

// What the owner sees and types back: the value formatted with the field's 3
// decimals, parsed again (the browser sends String(Number(input))).
double displayed_and_reentered(double mohm) {
  char buf[64];
  std::snprintf(buf, sizeof(buf), "%.3f", mohm);
  return std::strtod(buf, nullptr);
}
}  // namespace

int main() {
  // 1. All 32 generated rows carry the normalized contract.
  int rows = 0;
  for (int n = 1; n <= 32; n++) {
    const std::string key = "cell_connection_wire_resistance_" + std::to_string(n);
    const int idx = jk_write_registry::find_entry_index(key.c_str());
    check(idx >= 0, key + " exists in the generated write registry");
    if (idx < 0) continue;
    const auto &e = jk_write_registry::kEntries[idx];
    rows++;
    check(e.scale == 0.001 && e.offset == 0.0, key + ": scale 0.001 mOhm per raw uOhm, offset 0");
    check(e.minimum == 0.0 && e.maximum == 4294967.295, key + ": range [0, 4294967.295] mOhm (= full U32 raw range)");
    check(e.field_width_bits == 32 && !e.is_signed && e.word_count == 2 && !e.uses_rmw, key + ": U32, 2 words, full-width write");
    check(e.submit_policy == jk_write_registry::SubmitPolicy::AUTHORIZATION_REQUIRED,
          key + ": still authorization-required (write eligibility unchanged)");
  }
  check(rows == 32, "all 32 calibration rows checked");

  const auto &e = jk_write_registry::kEntries[jk_write_registry::find_entry_index("cell_connection_wire_resistance_1")];

  // 2. Named examples.
  struct Case { double mohm; uint32_t raw; const char *what; };
  const Case cases[] = {
    {0.0, 0u, "zero"},
    {0.001, 1u, "one raw increment (1 uOhm = 0.001 mOhm)"},
    {0.055, 55u, "55 uOhm <-> 0.055 mOhm"},
    {0.1, 100u, "the manufacturer's example value, 100 uOhm"},
    {0.051, 51u, "0.051 / 0.001 = 50.99999999999999 in double -- must round, not truncate"},
    {0.043, 43u, "0.043 / 0.001 = 42.99999999999999 in double -- must round, not truncate"},
    {1.001, 1001u, "1.001 / 0.001 = 1000.9999999999999 in double -- must round, not truncate"},
    {4294967.295, 4294967295u, "maximum: the full U32 raw range"},
  };
  for (const auto &c : cases) {
    const auto r = encode_mohm(e, c.mohm);
    check(r.status == EncodeStatus::OK && r.encoded_raw == c.raw, std::string("encode ") + c.what);
    check(double(c.raw) * e.scale == c.mohm || displayed_and_reentered(double(c.raw) * e.scale) == c.mohm,
          std::string("decode ") + c.what);
  }
  check(encode_mohm(e, 4294967.296).status == EncodeStatus::OUT_OF_RANGE, "above the maximum is rejected before any Modbus command");
  check(encode_mohm(e, -0.001).status == EncodeStatus::OUT_OF_RANGE, "negative is rejected");

  // 3. Exhaustive-style sweep: raw -> mOhm (double) -> 3-decimal display ->
  //    re-entered -> encoded raw is exactly the original raw.
  int sweep = 0;
  bool sweep_ok = true;
  for (uint32_t raw = 0; raw <= 200000u; raw++) {
    const auto r = encode_mohm(e, displayed_and_reentered(double(raw) * e.scale));
    sweep++;
    if (r.status != EncodeStatus::OK || r.encoded_raw != raw) { sweep_ok = false; std::printf("  first mismatch at raw=%u\n", raw); break; }
  }
  const uint32_t spot[] = {999999u, 1000000u, 8388607u, 16777215u, 123456789u, 4294967294u, 4294967295u};
  for (uint32_t raw : spot) {
    const auto r = encode_mohm(e, displayed_and_reentered(double(raw) * e.scale));
    sweep++;
    if (r.status != EncodeStatus::OK || r.encoded_raw != raw) { sweep_ok = false; std::printf("  spot mismatch at raw=%u\n", raw); }
  }
  check(sweep_ok, "raw 0..200000 plus large spot values survive display -> re-entry -> encode unchanged (" + std::to_string(sweep) + " values)");

  // 4. The published sensor state is a float (ESPHome sensor). Up to 2^23 uOhm
  //    (8.388607 Ohm, far above any real connection wire) the float value still
  //    displays as the exact raw value at 3 decimals.
  bool float_ok = true;
  const uint32_t float_spot[] = {0u, 1u, 55u, 100u, 1234u, 99999u, 1000000u, 8388607u};
  for (uint32_t raw : float_spot) {
    const float published = float(double(raw) * 0.001);
    const auto r = encode_mohm(e, displayed_and_reentered(double(published)));
    if (r.status != EncodeStatus::OK || r.encoded_raw != raw) { float_ok = false; std::printf("  float mismatch at raw=%u\n", raw); }
  }
  check(float_ok, "published float state re-encodes to the same raw for realistic values (<= 2^23 uOhm)");

  std::printf("wire resistance units: %d/%d checks passed\n", g_checks - g_failures, g_checks);
  return g_failures == 0 ? 0 : 1;
}
