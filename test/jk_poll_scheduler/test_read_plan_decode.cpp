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
    // fields_count == 0 is valid for exactly the one hand-authored
    // custom-decode block (0x1290, electrical_metrics_scan) -- see
    // test_electrical_metrics_scan_custom_block below for its own,
    // specific coverage.
    check(b.fields_count >= 1 || b.address == 0x1290, "every block has at least one field, except the one known custom-decode block");
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

// protocol/evidence/protocol_blockers.json's open 0x1504 hardware blocker
// (Final-preparation-plan Stage 1 corrective pass §4): the real,
// hardware-tested pre-migration YAML requested TWO SEPARATE register_count=1
// reads for rcv_time/rfv_time; this generator's uniform rule instead issues
// ONE combined register_count=2 read. This test proves the thing that
// actually matters for correctness is unaffected by which wire strategy is
// used: IF the device responds normally to either strategy, both yield the
// IDENTICAL 2-byte value at 0x1504 (there is only one real byte layout for
// this register's contents -- rcv_time low byte / rfv_time high byte,
// unrelated to how many Modbus commands fetched them) -- decode_numeric()
// is fed the SAME 2 bytes in the "two separate reads, now combined into one
// local buffer" case, proving decode correctness does not depend on the
// still-open wire-request question the blocker actually tracks. This is
// NOT a claim that register_count=2 itself is confirmed safe on real
// hardware -- see the blocker's own evidence_needed for what remains open.
static void test_rcv_rfv_decode_invariant_to_which_wire_strategy_produced_the_bytes() {
  const auto *b = find_block(0x1504);
  if (!b) return;
  const auto *rcv = find_field(*b, "rcv_time");
  const auto *rfv = find_field(*b, "rfv_time");
  if (!rcv || !rfv) return;

  // Simulates "two separate register_count=1 reads, assembled into one
  // 2-byte local buffer by the caller" -- byte-for-byte identical to what
  // ONE register_count=2 read of the same register would also return
  // (this register's real content is 2 bytes either way; register_count
  // only changes how many Modbus commands ask for it, confirmed against
  // this project's own JK-gap-convention analysis, see
  // generate_read_plan.js's own module comment).
  uint8_t assembled[2];
  assembled[0] = 0x1E;  // rfv_time high byte = 30 (3.0h at scale 0.1)
  assembled[1] = 0x08;  // rcv_time low byte = 8 (0.8h at scale 0.1)

  check(std::fabs(decode_numeric(assembled, *rcv, b->payload_bytes) - 0.8f) < 1e-6f,
        "rcv_time decodes identically regardless of which wire strategy (1 vs 2 requests) produced this exact byte pair");
  check(std::fabs(decode_numeric(assembled, *rfv, b->payload_bytes) - 3.0f) < 1e-6f,
        "rfv_time decodes identically regardless of which wire strategy (1 vs 2 requests) produced this exact byte pair");
}

// The generic short-response guard (protocol/generated/read_plan.yaml's own
// servicer, `if (data.size() < payload_bytes) { ...error...; return; }` --
// see that generated file's own case-0x1504 comment) is this project's
// actual fail-closed protection for the open blocker's real risk: if
// register_count=2 turns out to make the real device return something
// OTHER than a clean payload_bytes-length response (an error frame, a
// short response, or an unexpectedly-shaped one), that guard fires and
// this field is marked error/stale, never silently published with wrong
// data. This test proves the DECODE side of that contract: exactly
// payload_bytes (2) valid bytes are required; decode_numeric() itself has
// no independent bounds check (by design, see jk_poll_scheduler_core.h's
// own read_be() comment -- the caller, i.e. the generic guard, is the
// single place responsible for this), so the servicer's guard is the
// ONLY thing standing between a malformed response and a bad publish --
// confirming it is load-bearing, not redundant.
static void test_rcv_rfv_block_payload_bytes_is_exactly_two() {
  const auto *b = find_block(0x1504);
  check(b != nullptr, "0x1504 block exists");
  if (!b) return;
  check(b->payload_bytes == 2, "0x1504's payload_bytes is exactly 2 -- the generic short-response guard in the "
                                "generated servicer (data.size() < payload_bytes) is what fail-closes this blocker's "
                                "real risk, not a per-field bounds check here");
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

static void test_uart_arrays_decode_as_hex() {
  // UART1MPRTOLEnable (0x14B4) and UARTMPRTOLEnable[0-15] (0x14C4)
  // (2026-09-20, UART raw-bitmask arrays): two genuinely separate
  // registers, each UINT8[16], decoded via decode_hex_string() (never
  // decode_ascii() -- these are raw bitmasks, not text).
  const auto *b1 = find_block(0x14B4);
  check(b1 != nullptr, "0x14B4 (uart1_mprtol_enable) block exists");
  const auto *b2 = find_block(0x14C4);
  check(b2 != nullptr, "0x14C4 (uart_mprtol_enable_0_15) block exists -- a SEPARATE block/address from 0x14B4, not an alias");
  if (!b1 || !b2) return;
  check(b1->payload_bytes == 16, "0x14B4 block is the full 16-byte payload");
  check(b2->payload_bytes == 16, "0x14C4 block is the full 16-byte payload");

  const auto *f1 = find_field(*b1, "uart1_mprtol_enable");
  const auto *f2 = find_field(*b2, "uart_mprtol_enable_0_15");
  check(f1 != nullptr, "uart1_mprtol_enable field exists");
  check(f2 != nullptr, "uart_mprtol_enable_0_15 field exists");
  if (!f1 || !f2) return;
  check(f1->wire_type == WireType::HEX, "uart1_mprtol_enable decodes as HEX, not ASCII");
  check(f2->wire_type == WireType::HEX, "uart_mprtol_enable_0_15 decodes as HEX, not ASCII");

  const uint8_t data[16] = {0x00, 0xFF, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06,
                             0x07, 0x08, 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x0E};
  char out[64];
  decode_hex_string(data, b1->payload_bytes, out, sizeof(out));
  check(std::strcmp(out, "00 FF 01 02 03 04 05 06 07 08 09 0A 0B 0C 0D 0E") == 0,
        "generated uart1_mprtol_enable field decodes raw bytes as hex correctly, including 0x00/0xFF");
}

static void test_bespoke_excluded_keys_absent_from_generated_table() {
  check(find_block(0x1200) == nullptr, "no block exists at 0x1200 (cell_voltage_1 stays on the bespoke 1Hz reader)");
  for (size_t i = 0; i < jk_read_plan::kFieldCount; i++) {
    check(std::strcmp(jk_read_plan::kFields[i].key, "cell_voltage_1") != 0, "cell_voltage_1 is not in the generated field table");
    check(std::strcmp(jk_read_plan::kFields[i].key, "reserved_0x12d2") != 0, "reserved_0x12d2 is not in the generated field table");
  }
}

static void test_electrical_metrics_scan_custom_block() {
  const auto *b = find_block(0x1290);
  check(b != nullptr, "0x1290 (electrical_metrics_scan) block exists in the generated plan (migrated, Stage 1 corrective pass)");
  if (!b) return;
  check(b->fields_count == 0, "0x1290 has zero FieldDecode entries -- its decode is the hand-written custom function, not the generic dispatch");
  check(b->payload_bytes == 12, "0x1290 block is the full 12-byte gapless voltage+current response");
  check(b->register_count == 12, "0x1290 requests register_count=12 (unchanged from the pre-migration modbus_controller declaration)");
  check(b->cadence_ms == 15000, "0x1290 polls at telemetry_15s cadence, matching total_voltage_raw's canonical poll_group");
}

int main() {
  test_every_block_field_range_is_in_bounds();
  test_no_duplicate_addresses();
  test_no_duplicate_entity_ids();
  test_smart_sleep_decodes_correctly();
  test_capacity_remaining_negative_sign();
  test_rcv_rfv_packed_in_one_block();
  test_rcv_rfv_decode_invariant_to_which_wire_strategy_produced_the_bytes();
  test_rcv_rfv_block_payload_bytes_is_exactly_two();
  test_charging_float_mode_is_bit_type();
  test_derived_boolean_raw_entities_use_raw_id_not_active_key();
  test_manufacturer_device_id_is_ascii();
  test_uart_arrays_decode_as_hex();
  test_bespoke_excluded_keys_absent_from_generated_table();
  test_electrical_metrics_scan_custom_block();

  std::printf("%d checks run, %d failed.\n", g_checks, g_failures);
  return g_failures == 0 ? 0 : 1;
}
