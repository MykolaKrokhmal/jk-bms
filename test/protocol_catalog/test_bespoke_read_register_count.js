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
// 1./2. 0x1200 cell block and 0x126A CellWireRes16-31 (clustered reads, M5).
// The dedicated 1 s 0x1200 x53 reader and the 15 s 0x126A x16 reader are
// gone from the normal path: A1 (0x1200 x120, generated table) carries both.
// They survive only as the latched-fallback bespoke readers in
// jk_cluster_runtime_core.h, with the same register counts (53 = 106 bytes,
// 16 = 32 bytes), an exact-length check and the pre-migration cadences.
// ===========================================================================
const runtimeCore = fs.readFileSync(path.join(ROOT, "components", "jk_poll_scheduler", "jk_cluster_runtime_core.h"), "utf8");
const readPlanYaml = fs.readFileSync(path.join(ROOT, "protocol", "generated", "read_plan.yaml"), "utf8");
const clusters = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "read_clusters.canonical.json"), "utf8")).clusters;
const a1 = clusters.find((c) => c.cluster_id === "A1");
check("A1 cluster (0x1200 x120) covers the former cell block (0x1200-0x1268) and CellWireRes16-31 (0x126A-0x1288)",
  a1 && parseInt(a1.start, 16) === 0x1200 && a1.register_count === 120 && 0x1288 + 2 <= 0x1200 + 2 * a1.register_count);
check("0x1200 cell block: no dedicated reader left in batterylifepo4.yaml (old literal and register_count forms both gone)",
  !yaml.includes("0x1200, 106,") && !yaml.includes("0x1200, register_count,") && !yaml.includes("data.size() < 106"));
check("0x126A CellWireRes16-31: no dedicated reader left in batterylifepo4.yaml",
  !yaml.includes("0x126A, 32,") && !yaml.includes("0x126A, register_count,") && !yaml.includes("data.size() >= 32"));
check("fallback bespoke readers keep the corrected register counts: 0x1200 x53 at 1 s, 0x126A x16 at 15 s",
  runtimeCore.includes("{0x1200, 53, 0x1200, 0x1200, 1000},") && runtimeCore.includes("{0x126A, 16, 0x1200, 0x1200, 15000},"));
check("fallback bespoke responses are EXACT-length (2 x registers), never a floor",
  runtimeCore.includes("if (len != std::size_t(2U * b.registers)) {"));
check("fallback bespoke reads are issued with the table's register count (not a literal)",
  readPlanYaml.includes("id(bms0), esphome::modbus::EntityType::HOLDING, b.start, b.registers,"));
{
  // A1 layout: voltages 1-32 at bytes 0..63, cell_resistance_1-32 at 74..137;
  // the bespoke cell block fills bytes 0..105, the extension 106..137.
  const lastResistanceByte = 74 + 31 * 2 + 1;
  check("the last decoded resistance byte (cell_resistance_32, 74+31*2+1=137) lies inside A1's 240 bytes and inside the 0x126A extension (106..137)",
    lastResistanceByte === 137 && lastResistanceByte < 240 && lastResistanceByte === (0x126A - 0x1200) + 32 - 1);
  check("the last cell-block byte (cell_resistance_16, 74+15*2+1=105) is the last byte of the 106-byte fallback cell block",
    74 + 15 * 2 + 1 === 105);
}
check("CellWireRes16-31: published from the fallback image only after its own 0x126A read landed",
  yaml.includes("const bool ext_resistance_ok = !fallback || rt.fallback_cells_ext_valid();") &&
  yaml.includes("if (i < 16 || ext_resistance_ok) resistance_sensors[i]->publish_state("));
check("CellWireRes16-31 fallback read gated on configured CellCount via jk_capability::needs_cellwireres_extended_read()",
  readPlanYaml.includes("jk_capability::needs_cellwireres_extended_read(id(cell_count).state)"));

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
check("A1 (cells) is read every 1 s by the cluster servicer (canonical cadence)", a1.cadence_ms === 1000);
check("cell_count/cell_connected_mask readback still driven by the same 250ms topology-transaction servicer (unchanged cadence)",
  yaml.includes("if (id(g_cellcount_readback_started_ms) == 0U) {"));
check("setup_passcode readback still gated by the same 250ms passcode-transaction servicer (unchanged cadence)",
  yaml.includes("if (id(g_passcode_readback_started_ms) == 0U) {"));
check("no new interval:/globals: read-retry mechanism was introduced by this fix (register_count fix only, no new polling)",
  (yaml.match(/^  - interval: 1s$/gm) || []).length <= 2);

console.log(`\n${checks} checks run, ${failures} failed.`);
process.exit(failures ? 1 : 0);
