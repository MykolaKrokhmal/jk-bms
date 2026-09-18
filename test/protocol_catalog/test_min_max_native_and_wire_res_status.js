#!/usr/bin/env node
"use strict";

// Regression suite for the Stage 3 bounded task (2026-09-18, user-directed):
// MaxVolCellNbr/MinVolCellNbr (0x1248, packed UINT8+UINT8, decoded from the
// EXISTING 0x1200/106-byte 1Hz bespoke read -- zero new Modbus traffic) and
// CellWireResSta (0x128C, U32 alarm mask -- already read/decoded/published
// by the GENERIC read-plan/scheduler pipeline as of THIS project's own prior
// generate_read_plan.js run; this task only fixed canonical metadata that
// had gone stale, adding zero new traffic there either).
//
// IMPORTANT, per this project's own stated convention: most checks below
// are STRUCTURAL/SOURCE-TEXT (no ESPHome toolchain in this environment --
// the user compiles/flashes via Home Assistant). A few checks (marked
// [computed]) are REAL, EXECUTED arithmetic over the actual canonical.json/
// read_plan.json numbers -- not string matching -- verifying genuine
// numeric invariants (byte offsets fall within the payload, register_count
// unchanged, block counts unchanged), which is as close to "real execution"
// as this environment permits without a compiled binary.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const yaml = fs.readFileSync(path.join(ROOT, "batterylifepo4.yaml"), "utf8");
const canonical = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "registers.canonical.json"), "utf8"));
const readPlan = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "generated", "read_plan.json"), "utf8"));
const jkBms = fs.readFileSync(path.join(ROOT, "jk_bms.js"), "utf8");

let checks = 0;
let failures = 0;
function check(name, condition) {
  checks += 1;
  if (condition) {
    console.log(`PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${name}`);
  }
}

function findField(key) {
  for (const reg of canonical.registers) {
    for (const f of reg.fields) {
      if (f.key === key) return { reg, field: f };
    }
  }
  return null;
}

// ===========================================================================
// 1. [computed] Offset/length invariants for MaxVolCellNbr/MinVolCellNbr --
// real arithmetic against the actual register_count=53 constant this
// project's own 0x1200 read uses, not an assumption.
// ===========================================================================
{
  const m = yaml.match(/constexpr uint16_t register_count = (\d+);\s*\n\s*constexpr size_t expected_payload_bytes = size_t\(register_count\) \* 2U;\s*\n\s*auto command = esphome::modbus_controller::ModbusCommandItem::create_read_command\(\s*\n\s*id\(bms0\), esphome::modbus::EntityType::HOLDING,\s*\n\s*0x1200,/);
  check("[computed] 0x1200 bespoke read: register_count is still exactly 53 (unchanged by this task)",
    m && m[1] === "53");
  const registerCount = m ? parseInt(m[1], 10) : 0;
  const payloadBytes = registerCount * 2;
  check("[computed] 0x1200 payload is 106 bytes (register_count=53 * 2)", payloadBytes === 106);

  // canonical.json's field.byte_offset is relative to the field's OWN
  // 2-byte parent register (0=high byte, 1=low byte here), not to the
  // whole 106-byte 0x1200 payload -- the payload-relative offset is
  // (register address - 0x1200) + field.byte_offset, computed here, not
  // assumed.
  const maxField = findField("max_voltage_cell_index_native");
  const minField = findField("min_voltage_cell_index_native");
  const regAddr = parseInt(maxField.reg.address, 16);
  check("[computed] reg_0x1248's address parses to 0x1248 and sits 72 bytes into the 0x1200 payload",
    regAddr === 0x1248 && (regAddr - 0x1200) === 72);
  const maxPayloadOffset = (regAddr - 0x1200) + maxField.field.byte_offset;
  const minPayloadOffset = (regAddr - 0x1200) + minField.field.byte_offset;
  check("[computed] max_voltage_cell_index_native's payload-relative offset (72) is strictly within the 106-byte payload",
    maxPayloadOffset === 72 && maxPayloadOffset < payloadBytes);
  check("[computed] min_voltage_cell_index_native's payload-relative offset (73) is strictly within the 106-byte payload",
    minPayloadOffset === 73 && minPayloadOffset < payloadBytes);
}

// ===========================================================================
// 2. Decoder pin (structural, no ESPHome toolchain): the exact decode
// expressions for bytes 72/73, RAW (no +1/-1 normalization), inside the
// EXISTING bespoke 0x1200 callback -- not a new command.
// ===========================================================================
check("decode: max_voltage_cell_index_native published from data[72], no normalization (no +1U/-1U near it)",
  /id\(max_voltage_cell_index_native\)->publish_state\(float\(data\[72\]\)\);/.test(yaml));
check("decode: min_voltage_cell_index_native published from data[73], no normalization",
  /id\(min_voltage_cell_index_native\)->publish_state\(float\(data\[73\]\)\);/.test(yaml));
check("decode: both new publishes are inside the SAME callback as the existing cell-block decode (no new create_read_command for 0x1248)",
  (() => {
    const cellBlockStart = yaml.indexOf("0x1200, register_count,");
    const decodeIdx = yaml.indexOf("id(max_voltage_cell_index_native)->publish_state");
    const nextCommand = yaml.indexOf("ModbusCommandItem::create_read_command", cellBlockStart + 1);
    return cellBlockStart !== -1 && decodeIdx !== -1 &&
      decodeIdx > cellBlockStart && (nextCommand === -1 || decodeIdx < nextCommand);
  })());
check("decode: not gated by known_active_channels (this is a single BMS-internal scalar, not one of the 32 per-channel telemetry slots)",
  !/if \(i < known_active_channels\)[^}]*max_voltage_cell_index_native/.test(yaml));

// ===========================================================================
// 3. Sensor declarations exist, read-only, distinct entity_category, and
// distinctly labeled from the already-existing COMPUTED min_voltage_cell/
// max_voltage_cell entities (never blended into one derived fact).
// ===========================================================================
check("sensor: max_voltage_cell_index_native declared as platform: template, entity_category: diagnostic",
  /- platform: template\s*\n\s*id: max_voltage_cell_index_native\s*\n\s*name: "max voltage cell index \(native\)"\s*\n\s*update_interval: never\s*\n\s*accuracy_decimals: 0\s*\n\s*entity_category: diagnostic/.test(yaml));
check("sensor: min_voltage_cell_index_native declared as platform: template, entity_category: diagnostic",
  /- platform: template\s*\n\s*id: min_voltage_cell_index_native\s*\n\s*name: "min voltage cell index \(native\)"\s*\n\s*update_interval: never\s*\n\s*accuracy_decimals: 0\s*\n\s*entity_category: diagnostic/.test(yaml));
check("no OK/input control exists for either new sensor (grep for a companion number:/select: platform sharing the id)",
  !new RegExp(`(platform: number|platform: select)[^-]*id:\\s*(max|min)_voltage_cell_index_native`).test(yaml));

// ===========================================================================
// 4. [computed] Routing: canonical.json's esphome_read_entity_id for all 3
// fields matches a REAL `id:` declared in batterylifepo4.yaml (for the two
// bespoke ones) or in the generated read_plan.yaml (for the generic one) --
// cross-file consistency, not just presence of a string.
// ===========================================================================
{
  const maxField = findField("max_voltage_cell_index_native").field;
  const minField = findField("min_voltage_cell_index_native").field;
  const maskField = findField("cell_wire_resistance_status_mask").field;

  check("[computed] canonical max_voltage_cell_index_native.esphome_read_entity_id matches its own key",
    maxField.esphome_read_entity_id === "max_voltage_cell_index_native");
  check("[computed] canonical min_voltage_cell_index_native.esphome_read_entity_id matches its own key",
    minField.esphome_read_entity_id === "min_voltage_cell_index_native");
  check("[computed] canonical cell_wire_resistance_status_mask.esphome_read_entity_id matches its own key",
    maskField.esphome_read_entity_id === "cell_wire_resistance_status_mask");

  check("[computed] batterylifepo4.yaml declares id: max_voltage_cell_index_native exactly once",
    (yaml.match(/^\s*id: max_voltage_cell_index_native\s*$/gm) || []).length === 1);
  check("[computed] batterylifepo4.yaml declares id: min_voltage_cell_index_native exactly once",
    (yaml.match(/^\s*id: min_voltage_cell_index_native\s*$/gm) || []).length === 1);

  const readPlanEntityIds = new Set();
  for (const block of readPlan.blocks) {
    for (const f of block.fields || []) readPlanEntityIds.add(f.entity_id);
  }
  check("[computed] read_plan.json's generic scheduler block set includes cell_wire_resistance_status_mask's real entity_id",
    readPlanEntityIds.has("cell_wire_resistance_status_mask"));
  check("[computed] cell_wire_resistance_status_mask is NOT bespoke-excluded (confirms it's the generic-pipeline path, not a hand-written command)",
    !readPlan.excluded_bespoke_keys.includes("cell_wire_resistance_status_mask"));
  check("[computed] max/min_voltage_cell_index_native ARE bespoke-excluded (confirms they're decoded by the existing 0x1200 callback, not double-read by the generic pipeline)",
    readPlan.excluded_bespoke_keys.includes("max_voltage_cell_index_native") &&
    readPlan.excluded_bespoke_keys.includes("min_voltage_cell_index_native"));
}

// ===========================================================================
// 5. [computed] Zero new bus traffic for 0x128C: the generic read plan's
// block_count/field_count and this specific block's own address/
// register_count/cadence are UNCHANGED by this task -- this field was
// already being read before any edit this round; only canonical metadata
// (implementation_status, evidence, ui_section) changed.
// ===========================================================================
{
  const block = readPlan.blocks.find((b) => b.address === "0x128C");
  check("[computed] 0x128C block exists in the generated read plan (already did before this task -- proves zero NEW traffic was added)",
    !!block);
  check("[computed] 0x128C block still has exactly 1 field (cell_wire_resistance_status_mask), no new fields merged in",
    block && block.fields.length === 1 && block.fields[0].key === "cell_wire_resistance_status_mask");
  check("[computed] 0x128C cadence is still 15000ms (telemetry_15s poll_group, unchanged)",
    block && block.cadence_ms === 15000);
  check("[computed] read plan block_count is 100 (unchanged -- no block added or removed by this task)",
    readPlan.block_count === 100);
}

// ===========================================================================
// 6. Canonical metadata: implementation_status=implemented, no stale
// exclusion_reason, evidence includes both the PDF and the V2 workbook
// (two independent primary sources, not just the single-source upstream
// comment these fields previously relied on).
// ===========================================================================
for (const key of ["max_voltage_cell_index_native", "min_voltage_cell_index_native", "cell_wire_resistance_status_mask"]) {
  const f = findField(key).field;
  check(`canonical ${key}: implementation_status is "implemented"`, f.implementation_status === "implemented");
  check(`canonical ${key}: exclusion_reason is null (no longer excluded)`, f.exclusion_reason === null);
  check(`canonical ${key}: ui_section is "diagnostics" (not "none")`, f.ui_section === "diagnostics");
  const sourceIds = new Set(f.evidence.map((e) => e.source_id));
  check(`canonical ${key}: evidence includes official_jk_documentation (PDF)`, sourceIds.has("official_jk_documentation"));
  check(`canonical ${key}: evidence includes workbook_lifepo4_bms_parameters_registers_v2`, sourceIds.has("workbook_lifepo4_bms_parameters_registers_v2"));
}

// ===========================================================================
// 7. The unresolved 0-vs-1-based ambiguity for 0x1248 is DOCUMENTED, not
// silently normalized away -- minimum/maximum widened to the true raw
// UINT8 range (0-255), never asserting the unconfirmed 1-16 convention.
// ===========================================================================
{
  const maxField = findField("max_voltage_cell_index_native").field;
  const minField = findField("min_voltage_cell_index_native").field;
  check("max_voltage_cell_index_native: minimum/maximum widened to raw UINT8 range (0/255), not asserting unconfirmed 1-16",
    maxField.minimum === 0 && maxField.maximum === 255);
  check("min_voltage_cell_index_native: minimum/maximum widened to raw UINT8 range (0/255), not asserting unconfirmed 1-16",
    minField.minimum === 0 && minField.maximum === 255);
  const reg1248 = findField("max_voltage_cell_index_native").reg;
  check("reg_0x1248 safety_notes explicitly documents the unresolved 0- vs 1-based indexing ambiguity",
    /0-based|1-based/.test(reg1248.safety_notes) && /not independently confirmed|UNRESOLVED/i.test(reg1248.safety_notes));
}

// ===========================================================================
// 8. No write-enablement: neither new sensor, nor the mask, has any write
// path -- absent from SETTING_KEYS (the generic-write allowlist), absent
// from any `number:`/`select:` platform, effective_access stays "r".
// ===========================================================================
{
  const m = jkBms.match(/const SETTING_KEYS = Object\.freeze\(\[([\s\S]*?)\]\);/);
  const settingKeys = m ? (m[1].match(/"[a-z0-9_]+"/g) || []).map((s) => s.slice(1, -1)) : [];
  check("jk_bms.js: SETTING_KEYS still has exactly 18 entries (write allowlist untouched by this task)",
    settingKeys.length === 18);
  for (const key of ["max_voltage_cell_index_native", "min_voltage_cell_index_native", "cell_wire_resistance_status_mask"]) {
    check(`jk_bms.js: SETTING_KEYS does NOT include "${key}" (no write-enablement)`, !settingKeys.includes(key));
    const f = findField(key).field;
    check(`canonical ${key}: effective_access is still "r" (read-only, unchanged)`, f.effective_access === "r");
    check(`canonical ${key}: esphome_write_entity_id is still null`, f.esphome_write_entity_id === null);
  }
}

console.log(`\n${checks} checks run, ${failures} failed.`);
process.exit(failures ? 1 : 0);
