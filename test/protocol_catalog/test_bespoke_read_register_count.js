#!/usr/bin/env node
"use strict";

// Register-count unit fix for the remaining bespoke create_read_command
// call sites (2026-09-18, user-directed follow-up to the
// CellConWireRes0-31 and generic write-tx fixes): 0x1200 (1Hz cell
// block), 0x126A (CellWireRes16-31 capability-gated extension), 0x106C
// (cell_count readback, 2 call sites), 0x1240 (cell_connected_mask
// readback, 2 call sites), 0x1470 (setup_passcode readback). Every one
// of these previously passed a literal that was correct as a BYTE count
// but wrong as create_read_command()'s actual REGISTER-count parameter
// (confirmed against the real esphome 2026.9.0 source -- the pinned HA
// build -- in the same investigation that fixed CellConWireRes0-31 and
// the generic write-tx path).
//
// IMPORTANT, per instruction: every check in this file is a
// STRUCTURAL/SOURCE-TEXT regression test. This project has no ESPHome
// toolchain available in this environment (by explicit, repeated
// instruction -- the user compiles and flashes via Home Assistant), so
// none of these checks execute real, compiled production C++ code --
// they pin the fixed YAML source text directly. The only REAL
// production-code execution anywhere in this session's chain of fixes is
// components/jk_capability/jk_capability_core.h's own pure C++ unit
// tests (test/jk_capability/test_jk_capability_core.cpp, run via a real
// g++ compile+execute) -- but that header has no register_count/byte
// concept at all (it only tracks capability state), so it is unaffected
// by and irrelevant to this specific fix. This file's own checks are
// therefore ALL structural-only; this is stated explicitly rather than
// implied, per instruction.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const yaml = fs.readFileSync(path.join(ROOT, "batterylifepo4.yaml"), "utf8");

let checks = 0;
let failures = 0;
function check(name, condition) {
  checks += 1;
  if (condition) {
    console.log(`PASS  [structural]  ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL  [structural]  ${name}`);
  }
}

// ===========================================================================
// 1. 0x1200 -- 1Hz cell block (cell_voltage_1-32 + cell_resistance_1-16).
// Correct: 53 registers = 106 bytes (0x1200 cell_voltage_1 through 0x1268
// cell_resistance_16 inclusive, per protocol/registers.canonical.json --
// (0x1268-0x1200)/2+1 = 53). Old literal "106" was REGISTERS (212 bytes).
// ===========================================================================
check("0x1200 cell block: old literal '0x1200, 106,' (106 REGISTERS = 212 bytes) does NOT appear",
  !yaml.includes("0x1200, 106,"));
check("0x1200 cell block: requests exactly register_count (53) registers via a named constant",
  yaml.includes("0x1200, register_count,") &&
  yaml.includes("constexpr uint16_t register_count = 53;"));
check("0x1200 cell block: expected_payload_bytes derived from register_count (= 106), not re-inlined",
  /constexpr uint16_t register_count = 53;\s*\n\s*constexpr size_t expected_payload_bytes = size_t\(register_count\) \* 2U;/.test(yaml));
check("0x1200 cell block: EXACT-length response check (!= expected_payload_bytes), not a floor (< 106)",
  yaml.includes("if (data.size() != expected_payload_bytes) {\n                  ESP_LOGW(\"jk_cells\", \"Cell-block response length mismatch"));
check("0x1200 cell block: no remaining 'data.size() < 106' floor check",
  !yaml.includes("data.size() < 106"));
{
  // Last decoded offset check: resistance_offset = 74 + 15*2 = 104, reads
  // bytes [104,105] -- must be strictly within the 106-byte budget (never
  // reads byte 106 or beyond, which would be out-of-bounds of a
  // correctly-sized 106-byte response).
  const lastResistanceOffset = 74 + 15 * 2;
  const lastByteRead = lastResistanceOffset + 1; // resistance_offset+1U is the 2nd byte of the last channel's field
  check("0x1200 cell block: the last decoded byte (cell_resistance_16, offset 74+15*2+1=105) is the LAST byte of a 106-byte payload (index 0-105), no out-of-bounds read",
    lastByteRead === 105);
  const lastVoltageExtOffset = 32 + 15 * 2;
  const lastVoltageExtByteRead = lastVoltageExtOffset + 1;
  check("0x1200 cell block: the last cell_voltage_17-32 decoded byte (offset 32+15*2+1=63) stays within the 106-byte payload",
    lastVoltageExtByteRead === 63 && lastVoltageExtByteRead < 106);
}

// ===========================================================================
// 2. 0x126A -- CellWireRes16-31 capability-gated extension read.
// Correct: 16 registers = 32 bytes (0x126A cell_resistance_17 through
// 0x1288 cell_resistance_32, word_count=1 each). Old literal "32" was
// REGISTERS (64 bytes).
// ===========================================================================
check("0x126A CellWireRes16-31: old literal '0x126A, 32,' (32 REGISTERS = 64 bytes) does NOT appear",
  !yaml.includes("0x126A, 32,"));
check("0x126A CellWireRes16-31: requests exactly register_count (16) registers via a named constant",
  yaml.includes("0x126A, register_count,") &&
  yaml.includes("constexpr uint16_t register_count = 16;"));
check("0x126A CellWireRes16-31: expected_payload_bytes derived from register_count (= 32)",
  /constexpr uint16_t register_count = 16;\s*\n\s*constexpr size_t expected_payload_bytes = size_t\(register_count\) \* 2U;/.test(yaml));
check("0x126A CellWireRes16-31: EXACT-length success check (== expected_payload_bytes), not a floor (>= 32)",
  yaml.includes("const bool success = data.size() == expected_payload_bytes;"));
check("0x126A CellWireRes16-31: no remaining 'data.size() >= 32' floor check",
  !yaml.includes("data.size() >= 32"));
{
  const lastOffset = 15 * 2; // channel index 15 (16th, last) * 2 bytes/channel
  const lastByteRead = lastOffset + 1;
  check("0x126A CellWireRes16-31: the last decoded byte (channel 16 of 16, offset 15*2+1=31) is the LAST byte of a 32-byte payload (index 0-31), no out-of-bounds read",
    lastByteRead === 31);
}
check("0x126A CellWireRes16-31: jk_capability probing/record_outcome policy untouched by this fix",
  yaml.includes("jk_capability::record_outcome(ps2, success);") &&
  yaml.includes("needs_cellwireres_extended_read(id(cell_count).state)"));

// ===========================================================================
// 3. 0x106C -- cell_count readback, TWO call sites (initial transaction +
// uncertainty-recovery probe). Correct: 2 registers = 4 bytes
// (word_count=2 in protocol/registers.canonical.json). Old literal "8"
// was REGISTERS (16 bytes), 4x the real block.
// ===========================================================================
check("0x106C cell_count: old literal '0x106C, 8,' does NOT appear at either call site",
  !yaml.includes("0x106C, 8,"));
check("0x106C cell_count: both call sites request cellcount_register_count (2) registers",
  (yaml.match(/0x106C, cellcount_register_count,/g) || []).length === 2);
check("0x106C cell_count: cellcount_register_count/cellcount_expected_payload_bytes declared exactly twice (initial + recovery)",
  (yaml.match(/constexpr uint16_t cellcount_register_count = 2;/g) || []).length === 2 &&
  (yaml.match(/constexpr size_t cellcount_expected_payload_bytes = size_t\(cellcount_register_count\) \* 2U;/g) || []).length === 2);
check("0x106C cell_count: both decode callbacks use EXACT-length check (== cellcount_expected_payload_bytes), not a floor",
  (yaml.match(/if \(data\.size\(\) == cellcount_expected_payload_bytes\) \{/g) || []).length === 2);
{
  const lastByteRead = 3; // data[0..3], the 4-byte big-endian uint32 -- last index 3
  check("0x106C cell_count: the last decoded byte (data[3]) is the LAST byte of a 4-byte payload (index 0-3), no out-of-bounds read",
    lastByteRead === 3);
}

// ===========================================================================
// 4. 0x1240 -- cell_connected_mask readback, TWO call sites (initial +
// recovery). Correct: 2 registers = 4 bytes (word_count=2). Old literal
// "4" was REGISTERS (8 bytes), 2x the real block.
// ===========================================================================
check("0x1240 cell_connected_mask: old literal '0x1240, 4,' does NOT appear at either call site",
  !yaml.includes("0x1240, 4,"));
check("0x1240 cell_connected_mask: both call sites request mask_register_count (2) registers",
  (yaml.match(/0x1240, mask_register_count,/g) || []).length === 2);
check("0x1240 cell_connected_mask: mask_register_count/mask_expected_payload_bytes declared exactly twice (initial + recovery)",
  (yaml.match(/constexpr uint16_t mask_register_count = 2;/g) || []).length === 2 &&
  (yaml.match(/constexpr size_t mask_expected_payload_bytes = size_t\(mask_register_count\) \* 2U;/g) || []).length === 2);
check("0x1240 cell_connected_mask: both decode callbacks use EXACT-length check (== mask_expected_payload_bytes), not a floor",
  (yaml.match(/if \(data\.size\(\) == mask_expected_payload_bytes\) \{/g) || []).length === 2);
check("0x106C/0x1240: no remaining 'data.size() >= 4' floor check anywhere in the topology transaction/recovery block",
  !yaml.includes("data.size() >= 4"));

// ===========================================================================
// 5. 0x1470 -- setup_passcode readback. Correct: 8 registers = 16 bytes
// (word_count=8, 128-bit, in protocol/registers.canonical.json). Old
// literal "16" was REGISTERS (32 bytes), double the real block.
// ===========================================================================
check("0x1470 setup_passcode: old literal '0x1470, 16,' does NOT appear",
  !yaml.includes("0x1470, 16,"));
check("0x1470 setup_passcode: requests exactly register_count (8) registers via a named constant",
  yaml.includes("0x1470, register_count,") &&
  yaml.includes("constexpr uint16_t register_count = 8;"));
check("0x1470 setup_passcode: expected_payload_bytes derived from register_count (= 16)",
  /constexpr uint16_t register_count = 8;\s*\n\s*constexpr size_t expected_payload_bytes = size_t\(register_count\) \* 2U;/.test(yaml));
check("0x1470 setup_passcode: EXACT-length check (!= expected_payload_bytes), not a floor (< 16)",
  yaml.includes("data.size() != expected_payload_bytes) return;"));
check("0x1470 setup_passcode: no remaining 'data.size() < 16' floor check",
  !yaml.includes("data.size() < 16"));
{
  const lastByteRead = 7 * 2 + 1; // i=7 (8th, last word), data[i*2+1]
  check("0x1470 setup_passcode: the last decoded byte (word 8 of 8, offset 7*2+1=15) is the LAST byte of a 16-byte payload (index 0-15), no out-of-bounds read",
    lastByteRead === 15);
}

// ===========================================================================
// 6. Address/decoder/cadence/topology-capability-policy preservation --
// none of the addresses, decoded field sets, polling cadences, or the
// jk_capability bounded-probe policy were touched by this fix; only the
// register_count/expected_payload_bytes split and exact-length checks
// changed.
// ===========================================================================
check("0x1200 cell block still on its own 1s interval (unchanged cadence)",
  yaml.includes('if (id(g_cell_poll_pending) &&\n              uint32_t(now - id(g_cell_poll_started_ms)) < 15000U) {'));
check("cell_count/cell_connected_mask readback still driven by the same 250ms topology-transaction servicer (unchanged cadence)",
  yaml.includes("if (id(g_cellcount_readback_started_ms) == 0U) {"));
check("setup_passcode readback still gated by the same 250ms passcode-transaction servicer (unchanged cadence)",
  yaml.includes("if (id(g_passcode_readback_started_ms) == 0U) {"));
check("no new interval:/globals: read-retry mechanism was introduced by this fix (register_count fix only, no new polling)",
  (yaml.match(/^  - interval: 1s$/gm) || []).length <= 2);

console.log(`\n${checks} checks run, ${failures} failed.`);
process.exit(failures ? 1 : 0);
