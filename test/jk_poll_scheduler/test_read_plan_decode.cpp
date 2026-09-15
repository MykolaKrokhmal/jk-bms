// Integration test for the GENERATED protocol/generated/read_plan_decode.h
// -- spot-checks that generate_read_plan.js correctly translated a sample
// of real canonical.json fields into the kFields/kBlocks data table, and
// that jk_poll_scheduler's decode functions applied to that generated data
// (not hand-constructed FieldDecode structs, as in
// test_jk_poll_scheduler_core.cpp) produce the right answer end to end.
// Also proves the generated header is valid, compilable C++ (a real gate
// generate_read_plan.js --check cannot provide on its own -- it only
// diffs text content, never compiles it).
//
//   g++ -std=c++17 -Wall -Wextra -I ../.. \
//       test_read_plan_decode.cpp -o test_read_plan_decode
//   ./test_read_plan_decode
//
// Run from test/jk_poll_scheduler/ with -I pointing at the repo root, so
// `#include "protocol/generated/read_plan_decode.h"` resolves the same way
// it will from batterylifepo4.yaml's own includes: list.

#include "protocol/generated/read_plan_decode.h"

#include <cmath>
#include <cstdio>
#include <cstring>

using namespace jk_poll_scheduler;

namespace {
int g_failures = 0;
int g_checks = 0;

void check(bool cond, const char *desc) {
  g_checks++;
  if (!cond) {
    g_failures++;
    std::printf("FAIL: %s\n", desc);
  }
}

const jk_poll_scheduler::Block *find_block(uint16_t address) {
  for (size_t i = 0; i < jk_read_plan::kBlockCount; i++) {
    if (jk_read_plan::kBlocks[i].address == address) return &jk_read_plan::kBlocks[i];
  }
  return nullptr;
}

const FieldDecode *find_field(const jk_poll_scheduler::Block &b, const char *key) {
  for (size_t i = 0; i < b.fields_count; i++) {
    const FieldDecode &f = jk_read_plan::kFields[b.fields_offset + i];
    if (std::strcmp(f.key, key) == 0) return &f;
  }
  return nullptr;
}
}  // namespace

static void test_every_block_field_range_is_in_bounds() {
  for (size_t i = 0; i < jk_read_plan::kBlockCount; i++) {
    const auto &b = jk_read_plan::kBlocks[i];
    check(b.fields_offset + b.fields_count <= jk_read_plan::kFieldCount, "block field range stays within kFields bounds");
    check(b.fields_count >= 1, "every block has at least one field");
    check(b.payload_bytes >= 1 && b.payload_bytes <= 16, "payload_bytes is a plausible register width (1-16 bytes)");
  }
}

static void test_no_duplicate_addresses() {
  for (size_t i = 0; i < jk_read_plan::kBlockCount; i++) {
    for (size_t j = i + 1; j < jk_read_plan::kBlockCount; j++) {
      check(jk_read_plan::kBlocks[i].address != jk_read_plan::kBlocks[j].address, "no two blocks share an address");
    }
  }
}

static void test_no_duplicate_entity_ids() {
  for (size_t i = 0; i < jk_read_plan::kFieldCount; i++) {
    for (size_t j = i + 1; j < jk_read_plan::kFieldCount; j++) {
      check(std::strcmp(jk_read_plan::kFields[i].key, jk_read_plan::kFields[j].key) != 0,
            "no two generated fields publish under the same entity id");
    }
  }
}

static void test_smart_sleep_decodes_correctly() {
  const auto *b = find_block(0x1000);
  check(b != nullptr, "0x1000 (smart_sleep) block exists in the generated plan");
  if (!b) return;
  const auto *f = find_field(*b, "smart_sleep");
  check(f != nullptr, "smart_sleep field exists in its block");
  if (!f) return;
  const uint8_t data[4] = {0x00, 0x00, 0x0B, 0xB8};  // 3000 raw -> 3.000 V
  check(std::fabs(decode_numeric(data, *f, b->payload_bytes) - 3.0f) < 1e-6f,
        "generated smart_sleep field decodes 3000 raw to 3.0 V");
}

static void test_capacity_remaining_negative_sign() {
  const auto *b = find_block(0x12A8);
  check(b != nullptr, "0x12A8 (capacity_remaining) block exists");
  if (!b) return;
  const auto *f = find_field(*b, "capacity_remaining");
  check(f != nullptr, "capacity_remaining field exists in its block");
  if (!f) return;
  check(f->is_signed, "capacity_remaining is generated as signed (the real fix this session's earlier commit made)");
  const uint8_t data[4] = {0xFF, 0xFF, 0xFF, 0xFF};
  check(decode_numeric(data, *f, b->payload_bytes) < 0.0f, "generated capacity_remaining decodes all-Fs as negative, not a huge positive");
}

static void test_rcv_rfv_packed_in_one_block() {
  const auto *b = find_block(0x1504);
  check(b != nullptr, "0x1504 block exists");
  if (!b) return;
  check(b->fields_count == 2, "0x1504 block packs exactly rcv_time + rfv_time (2 fields)");
  const auto *rcv = find_field(*b, "rcv_time");
  const auto *rfv = find_field(*b, "rfv_time");
  check(rcv != nullptr && rfv != nullptr, "both rcv_time and rfv_time are present");
  if (!rcv || !rfv) return;
  const uint8_t data[2] = {0x00, 0x64};  // rfv high byte=0x00, rcv low byte=0x64 (100)
  check(std::fabs(decode_numeric(data, *rcv, b->payload_bytes) - 10.0f) < 1e-6f, "rcv_time (low byte, scale 0.1) decodes correctly from the packed block");
}

static void test_charging_float_mode_is_bit_type() {
  const auto *b = find_block(0x1114);
  check(b != nullptr, "0x1114 (charging_float_mode) block exists");
  if (!b) return;
  const auto *f = find_field(*b, "charging_float_mode");
  check(f != nullptr, "charging_float_mode field exists");
  if (!f) return;
  check(f->wire_type == WireType::BIT, "charging_float_mode is generated as a true WireType::BIT field");
}

static void test_derived_boolean_raw_entities_use_raw_id_not_active_key() {
  // charging_active's real canonical field key is "charging_active", but
  // the generator must publish it under the RAW entity id "charging_raw"
  // (DERIVED_BOOLEAN_OVERRIDE) so the existing hand-written "charging"
  // binary_sensor lambda (unchanged) keeps reading a real, live entity.
  const auto *b = find_block(0x12C0);
  check(b != nullptr, "0x12C0 block exists");
  if (!b) return;
  const auto *raw = find_field(*b, "charging_raw");
  check(raw != nullptr, "0x12C0 publishes under entity id charging_raw, not charging_active");
}

static void test_manufacturer_device_id_is_ascii() {
  const auto *b = find_block(0x1400);
  check(b != nullptr, "0x1400 (device_model) block exists");
  if (!b) return;
  check(b->payload_bytes == 16, "device_model block is the full 16-byte ASCII payload");
  const auto *f = find_field(*b, "manufacturer_device_id");
  check(f != nullptr, "manufacturer_device_id field exists");
  if (!f) return;
  check(f->wire_type == WireType::ASCII, "device_model decodes as ASCII");
  const uint8_t data[16] = {'J', 'K', '-', 'P', 'B', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0};
  char out[17];
  decode_ascii(data, b->payload_bytes, out, sizeof(out));
  check(std::strncmp(out, "JK-PB", 5) == 0, "generated device_model field decodes ASCII bytes correctly");
}

static void test_bespoke_excluded_keys_absent_from_generated_table() {
  check(find_block(0x1200) == nullptr, "no block exists at 0x1200 (cell_voltage_1 stays on the bespoke 1Hz reader)");
  for (size_t i = 0; i < jk_read_plan::kFieldCount; i++) {
    check(std::strcmp(jk_read_plan::kFields[i].key, "cell_voltage_1") != 0, "cell_voltage_1 is not in the generated field table");
    check(std::strcmp(jk_read_plan::kFields[i].key, "reserved_0x12d2") != 0, "reserved_0x12d2 is not in the generated field table");
  }
}

int main() {
  test_every_block_field_range_is_in_bounds();
  test_no_duplicate_addresses();
  test_no_duplicate_entity_ids();
  test_smart_sleep_decodes_correctly();
  test_capacity_remaining_negative_sign();
  test_rcv_rfv_packed_in_one_block();
  test_charging_float_mode_is_bit_type();
  test_derived_boolean_raw_entities_use_raw_id_not_active_key();
  test_manufacturer_device_id_is_ascii();
  test_bespoke_excluded_keys_absent_from_generated_table();

  std::printf("%d checks run, %d failed.\n", g_checks, g_failures);
  return g_failures == 0 ? 0 : 1;
}
