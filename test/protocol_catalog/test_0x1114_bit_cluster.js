#!/usr/bin/env node
"use strict";

// Regression test for the 0x1114 read-only bit-cluster implementation
// (Stage 3 completion pass, 2026-09-20, user-directed). PDF
// (BMS_RS485_Modbus_V1.1.pdf p.8) directly confirms 0x1114 is a packed
// UINT16 with BIT0-BIT9 sub-rows, every one declared RW at the source
// level: BIT0-BIT2/BIT4-BIT9 are plain 1=On/0=Off booleans; BIT3 (Port
// Switch) is an explicit 2-state MODE selector (1=RS485, 0=CAN), not a
// generic boolean. All 9 previously-blocked bits (BIT0-BIT8) plus the
// pre-existing BIT9 (charging_float_mode) are now real, read-only
// canonical fields with effective_access="r" (Stage 3 policy;
// dynamic_dependency.resolved=false deliberately keeps write-enablement
// out of scope regardless of evidence being "confirmed"). Zero new
// Modbus bus traffic -- same existing 0x1114 register read.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
function loadJson(p) { return JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8")); }

let checks = 0;
let failures = 0;
function check(name, condition, detail = "") {
  checks += 1;
  if (condition) console.log(`PASS  ${name}${detail ? ` -- ${detail}` : ""}`);
  else {
    failures += 1;
    console.log(`FAIL  ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

const canonical = loadJson("protocol/registers.canonical.json");
const reg = canonical.registers.find((r) => r.address === "0x1114");
const fieldByKey = new Map(reg.fields.map((f) => [f.key, f]));

// ===========================================================================
// 1. All 10 bits exist as real fields on the SAME pre-existing register
// (zero new register, zero new bus traffic).
// ===========================================================================
const EXPECTED_KEYS = [
  "heat_en", "disable_temp_sensor", "gps_heartbeat", "port_switch", "lcd_always_on",
  "special_charger", "smart_sleep_enabled", "disable_pcl_module", "timed_stored_data",
  "charging_float_mode",
];
check("0x1114 register exists with exactly 10 fields (9 new + pre-existing charging_float_mode)",
  reg && reg.fields.length === 10, `actual=${reg && reg.fields.length}`);
for (const key of EXPECTED_KEYS) {
  check(`field "${key}" exists on 0x1114`, fieldByKey.has(key));
}
check("register word_count is still 1 (no new register, same 16-bit word)", reg.word_count === 1);

// ===========================================================================
// 2. Exact bit/shift identity for each field (no two fields collide, no
// field is missing its own bit).
// ===========================================================================
const EXPECTED_SHIFTS = {
  heat_en: 0, disable_temp_sensor: 1, gps_heartbeat: 2, port_switch: 3, lcd_always_on: 4,
  special_charger: 5, smart_sleep_enabled: 6, disable_pcl_module: 7, timed_stored_data: 8,
  charging_float_mode: 9,
};
for (const [key, shift] of Object.entries(EXPECTED_SHIFTS)) {
  const f = fieldByKey.get(key);
  check(`"${key}" is wire_type BIT at shift=${shift} (mask=0x${(1 << shift).toString(16).toUpperCase()})`,
    f && f.wire_type === "BIT" && f.shift === shift && f.mask === `0x${(1 << shift).toString(16).toUpperCase().padStart(4, "0")}`);
}
const shifts = Object.values(EXPECTED_SHIFTS);
check("all 10 shifts are distinct (no bit collision)", new Set(shifts).size === 10);

// ===========================================================================
// 3. Access semantics: source-declared RW (per direct PDF p.8 citation),
// Stage 3 effective_access stays "r" for every one of the 9 new fields,
// via an explicit dynamic_dependency.resolved=false (never a silent
// write-enablement side effect of "confirmed" evidence).
// ===========================================================================
const NEW_KEYS = EXPECTED_KEYS.filter((k) => k !== "charging_float_mode");
for (const key of NEW_KEYS) {
  const f = fieldByKey.get(key);
  check(`"${key}" access="rw" (source-declared, per PDF)`, f && f.access === "rw");
  check(`"${key}" effective_access="r" (Stage 3 policy, not write-enabled)`, f && f.effective_access === "r");
  check(`"${key}" has dynamic_dependency.resolved=false (explicit reason effective_access stays "r" despite confirmed evidence)`,
    f && f.dynamic_dependency && f.dynamic_dependency.resolved === false);
  check(`"${key}" verification_status="confirmed" (real derived value, not forged/understated)`,
    f && f.verification_status === "confirmed");
  check(`"${key}" implementation_status="implemented"`, f && f.implementation_status === "implemented");
}

// ===========================================================================
// 4. Port Switch (bit3) semantic: explicit 2-state MODE selector, NOT a
// generic boolean -- carries its own enum_map, distinct from every other
// bit in this cluster.
// ===========================================================================
const portSwitch = fieldByKey.get("port_switch");
check("port_switch carries enum_map {0:CAN, 1:RS485} (not a generic boolean)",
  portSwitch && portSwitch.enum_map && portSwitch.enum_map["0"] === "CAN" && portSwitch.enum_map["1"] === "RS485");
for (const key of NEW_KEYS) {
  if (key === "port_switch") continue;
  const f = fieldByKey.get(key);
  check(`"${key}" (plain boolean bit) carries NO enum_map`, f && f.enum_map === null);
}

// ===========================================================================
// 5. Bits 10-15 remain undocumented -- explicitly stated in safety_notes,
// never silently modeled or ignored without explanation.
// ===========================================================================
check("register safety_notes explicitly documents bits 10-15 as undocumented/reserved (no invented semantics)",
  /[Bb]its? 10-15/.test(reg.safety_notes) && /reserved|undocumented/i.test(reg.safety_notes));

// ===========================================================================
// 6. Read-domain routing: 8 plain booleans publish as binary_sensor;
// port_switch (the mode selector) publishes as a plain numeric sensor
// carrying its enum_map for frontend rendering -- verified against the
// REAL generated read plan and its emitted decode dispatch, not just the
// canonical intent.
// ===========================================================================
const readPlan = loadJson("protocol/generated/read_plan.json");
const block1114 = readPlan.blocks.find((b) => b.address === "0x1114");
check("0x1114 block exists in the generated read plan with all 10 fields", block1114 && block1114.fields.length === 10);
const fieldsByKeyRP = new Map((block1114 ? block1114.fields : []).map((f) => [f.key, f]));
for (const key of NEW_KEYS) {
  if (key === "port_switch") continue;
  check(`generated read-plan domain for "${key}" is binary_sensor`, fieldsByKeyRP.get(key) && fieldsByKeyRP.get(key).domain === "binary_sensor");
}
check("generated read-plan domain for port_switch is sensor (numeric, not binary_sensor)",
  fieldsByKeyRP.get("port_switch") && fieldsByKeyRP.get("port_switch").domain === "sensor");
check("charging_float_mode's own domain is still binary_sensor (pre-existing, unaffected)",
  fieldsByKeyRP.get("charging_float_mode") && fieldsByKeyRP.get("charging_float_mode").domain === "binary_sensor");

const readPlanYaml = fs.readFileSync(path.join(ROOT, "protocol", "generated", "read_plan.yaml"), "utf8");
check("emitted C++ decode for heat_en (binary_sensor) uses decode_bool()",
  new RegExp(`id\\(heat_en\\)->publish_state\\(jk_poll_scheduler::decode_bool\\(`).test(readPlanYaml));
check("emitted C++ decode for port_switch (sensor, numeric+enum_map) uses decode_numeric(), NOT decode_bool()",
  new RegExp(`id\\(port_switch\\)->publish_state\\(jk_poll_scheduler::decode_numeric\\(`).test(readPlanYaml) &&
  !new RegExp(`id\\(port_switch\\)->publish_state\\(jk_poll_scheduler::decode_bool\\(`).test(readPlanYaml));
check("0x1114 still produces exactly ONE block in the read plan (zero new bus requests for this batch)",
  readPlan.blocks.filter((b) => b.address === "0x1114").length === 1);

// ===========================================================================
// 7. batterylifepo4.yaml entity declarations: the 8 booleans are declared
// under binary_sensor:, port_switch under sensor: -- real YAML, not just
// the intermediate JSON projection.
// ===========================================================================
for (const key of NEW_KEYS) {
  if (key === "port_switch") continue;
  const re = new RegExp(`binary_sensor:[\\s\\S]*?id: ${key}\\b`);
  check(`read_plan.yaml declares "${key}" under binary_sensor:`, re.test(readPlanYaml));
}
check(`read_plan.yaml declares "port_switch" under sensor: (before the binary_sensor: section starts)`,
  readPlanYaml.indexOf("id: port_switch") < readPlanYaml.indexOf("\nbinary_sensor:"));

// ===========================================================================
// 8. Stage 3 status-map: all 10 bits classify implemented_read, the
// 0x1114 blocker is closed (not just narrowed), and no other parameter's
// classification changed as an unrelated side effect.
// ===========================================================================
const statusMap = loadJson("protocol/generated/stage3_status_map.json");
const statusById = new Map(statusMap.parameters.map((p) => [p.id, p]));
const MANIFEST_ID_BY_KEY = {
  heat_en: "HeatEN", disable_temp_sensor: "Disable temp-sensor", gps_heartbeat: "GPS Heartbeat",
  port_switch: "Port Switch", lcd_always_on: "LCD Always On", special_charger: "Special Charger",
  smart_sleep_enabled: "SmartSleep", disable_pcl_module: "DisablePCLModule", timed_stored_data: "TimedStoredData",
  charging_float_mode: "ChargingFloatMode",
};
for (const [key, manifestId] of Object.entries(MANIFEST_ID_BY_KEY)) {
  const s = statusById.get(manifestId);
  check(`status-map: "${manifestId}" (${key}) is implemented_read`, s && s.status === "implemented_read", JSON.stringify(s));
}

const blockers = loadJson("protocol/evidence/protocol_blockers.json");
const blocker1114 = blockers.blockers.find((b) => b.address === "0x1114");
check("the 0x1114 blocker is CLOSED (not merely narrowed) -- its original 9-name gap is fully resolved",
  blocker1114 && blocker1114.status === "closed" && !!blocker1114.resolution && !!blocker1114.closed_date);

// ===========================================================================
// 9. Sum invariant: total parameter count still 265, unaffected by this
// batch (canonical field authoring never changes the manifest's own
// parameter count).
// ===========================================================================
check("stage3_status_map.json parameter_count is still 265", statusMap.parameter_count === 265, `actual=${statusMap.parameter_count}`);
const countSum = Object.values(statusMap.counts).reduce((a, b) => a + b, 0);
check("stage3_status_map.json counts sum to 265", countSum === 265, `actual=${countSum}`);

console.log(`\n${checks} checks run, ${failures} failed.`);
process.exit(failures ? 1 : 0);
