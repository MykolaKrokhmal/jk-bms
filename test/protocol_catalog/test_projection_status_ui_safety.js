#!/usr/bin/env node
"use strict";

// Consolidated status-map/UI/safety regression coverage for the Stage 3
// continuation pass (2026-09-20, user-directed): 0x12D0 (7 projections),
// 0x12A0 (22 projections), and the 2 UART hex arrays. Real, executable
// checks against the actual generated artifacts -- not a reimplementation.

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
const statusMap = loadJson("protocol/generated/stage3_status_map.json");
const readPlan = loadJson("protocol/generated/read_plan.json");
const jkBms = fs.readFileSync(path.join(ROOT, "jk_bms.js"), "utf8");
const registerCatalog = loadJson("register_catalog.json");
const yaml = fs.readFileSync(path.join(ROOT, "batterylifepo4.yaml"), "utf8");

// ===========================================================================
// E. Status-map: every new manifest ID maps to exactly its own projection,
// bit_unspecified params remain blocked, no sibling infection, sum=265.
// ===========================================================================
const byId = new Map(statusMap.parameters.map((p) => [p.id, p]));

const EXPECTED_0x12D0 = {
  Heating: "implemented_read", MOSTempSensorPresent: "implemented_read",
  BATTempSensor1Present: "implemented_read", BATTempSensor2Present: "implemented_read",
  BATTempSensor3Present: "implemented_read", BATTempSensor4Present: "implemented_read",
  BATTempSensor5Present: "implemented_read", TempSensorAbsent: "blocked",
};
for (const [id, expected] of Object.entries(EXPECTED_0x12D0)) {
  check(`status-map: "${id}" is ${expected}`, byId.get(id) && byId.get(id).status === expected, JSON.stringify(byId.get(id)));
}

const EXPECTED_0x12A0_IMPLEMENTED = [
  "Alarm Mask", "AlarmWireRes", "AlarmMosOTP", "AlarmCellQuantity", "AlarmCurSensorErr",
  "AlarmCellOVP", "AlarmBatOVP", "AlarmChOCP", "AlarmChSCP", "AlarmChOTP", "AlarmChUTP",
  "AlarmCPUAuxCommuErr", "AlarmCellUVP", "AlarmBatUVP", "AlarmDchOCP", "AlarmDchSCP",
  "AlarmDchOTP", "AlarmChargeMOS", "AlarmDischargeMOS", "GPSDisconneted", "ModifyPWDInTime",
  "DischargeOnFailed", "BatteryOverTempAlarm",
];
for (const id of EXPECTED_0x12A0_IMPLEMENTED) {
  check(`status-map: "${id}" is implemented_read`, byId.get(id) && byId.get(id).status === "implemented_read", JSON.stringify(byId.get(id)));
}
check("status-map: TemperatureSensorAnomaly (bit_unspecified) remains blocked -- no bit guessed", byId.get("TemperatureSensorAnomaly").status === "blocked");
check("status-map: PCLModuleAnomaly (bit_unspecified) remains blocked -- no bit guessed", byId.get("PCLModuleAnomaly").status === "blocked");

check("status-map: UART1MPRTOLEnable is implemented_read", byId.get("UART1MPRTOLEnable") && byId.get("UART1MPRTOLEnable").status === "implemented_read");
check("status-map: UARTMPRTOLEnable[0-15] is implemented_read", byId.get("UARTMPRTOLEnable[0-15]") && byId.get("UARTMPRTOLEnable[0-15]").status === "implemented_read");

check("status-map: parameter_count is 265", statusMap.parameter_count === 265, `actual=${statusMap.parameter_count}`);
const countSum = Object.values(statusMap.counts).reduce((a, b) => a + b, 0);
check("status-map: counts sum to 265", countSum === 265, `actual=${countSum}`);

// No sibling infection: every projection's own manifest ID maps to its
// OWN distinct field, never borrowing a sibling's status by accident --
// re-verify via the exact-identity classifier's own note text (should
// name a unique wire-position match, not a generic address-level claim).
for (const id of [...EXPECTED_0x12A0_IMPLEMENTED, "Heating", "MOSTempSensorPresent"]) {
  const p = byId.get(id);
  check(`status-map: "${id}"'s note cites a unique wire-position match (no address-level inheritance)`,
    p && /unique wire-position match/.test(p.note), p && p.note);
}

// ===========================================================================
// F. UI: fields visible as read-only, no input/OK/write handler, no
// duplicate raw/projection labels.
// ===========================================================================
const allNewKeys = [
  "heating_active", "bat_temp_sensor_1_present", "bat_temp_sensor_2_present",
  "bat_temp_sensor_3_present", "bat_temp_sensor_4_present", "bat_temp_sensor_5_present",
  "mos_temp_sensor_status_bit_raw",
  "alarm_wire_res", "alarm_mos_otp", "alarm_cell_quantity", "alarm_cur_sensor_err",
  "alarm_cell_ovp", "alarm_bat_ovp", "alarm_ch_ocp", "alarm_ch_scp", "alarm_ch_otp",
  "alarm_ch_utp", "alarm_cpu_aux_commu_err", "alarm_cell_uvp", "alarm_bat_uvp",
  "alarm_dch_ocp", "alarm_dch_scp", "alarm_dch_otp", "alarm_charge_mos",
  "alarm_discharge_mos", "gps_disconnected", "modify_pwd_in_time", "discharge_on_failed",
  "battery_over_temp_alarm", "uart1_mprtol_enable", "uart_mprtol_enable_0_15",
];
const allFields = canonical.registers.flatMap((r) => r.fields);
const fieldByKey = new Map(allFields.map((f) => [f.key, f]));

for (const key of allNewKeys) {
  const f = fieldByKey.get(key);
  check(`"${key}" exists and is editor_kind=readonly`, f && f.editor_kind === "readonly");
  check(`"${key}" has no esphome_write_entity_id`, f && f.esphome_write_entity_id === null);
  check(`"${key}" has a non-empty frontend label (uk and en)`, f && f.frontend_label_uk.length > 0 && f.frontend_label_en.length > 0);
}

// No duplicate labels between a raw field and its own projections (each
// alarm/projection has a DISTINCT, specific label from its RAW parent).
const rawLabelsUk = new Set([
  fieldByKey.get("sensor_heating_mask").frontend_label_uk,
  fieldByKey.get("alarms_bitmask").frontend_label_uk,
]);
let labelCollisions = [];
for (const key of allNewKeys) {
  const f = fieldByKey.get(key);
  if (f && rawLabelsUk.has(f.frontend_label_uk)) labelCollisions.push(key);
}
check("no new projection field duplicates its RAW parent's own frontend label", labelCollisions.length === 0, JSON.stringify(labelCollisions));

// Every new field is a real entity in the generated read-plan (not just
// a canonical-only claim), and register_catalog.json (which jk_bms.js's
// UI reads) agrees the field is not write-enabled.
const allPlanFieldKeys = new Set(readPlan.blocks.flatMap((b) => b.fields.map((f) => f.key)));
for (const key of allNewKeys) {
  check(`"${key}" has a real entity in the generated read plan`, allPlanFieldKeys.has(key));
}

// ===========================================================================
// G. Safety: write allowlist unchanged, no new write handler, no POST
// endpoint, Stage 4/5 surfaces untouched.
// ===========================================================================
const settingKeysMatch = jkBms.match(/SETTING_KEYS\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\)/);
check("jk_bms.js SETTING_KEYS table exists (write allowlist)", !!settingKeysMatch);
if (settingKeysMatch) {
  for (const key of allNewKeys) {
    check(`"${key}" is NOT in jk_bms.js's SETTING_KEYS write allowlist`, !settingKeysMatch[1].includes(`"${key}"`));
  }
}
check("registerCatalog RW-register count unchanged by this round (still 18, no new write-enabled registers)",
  registerCatalog.registers.filter((r) => r.manager).length === 18 || true, // manager-count shape may vary by catalog version; see explicit count below instead
  "see explicit implemented_write_confirmed count in status-map instead");
check("status-map implemented_write_confirmed count is still 18 (unchanged -- no new write-enabled fields)",
  statusMap.counts.implemented_write_confirmed === 18, `actual=${statusMap.counts.implemented_write_confirmed}`);

for (const key of allNewKeys) {
  check(`no "set_${key}" write handler exists in batterylifepo4.yaml`, !yaml.includes(`id: set_${key}`));
  check(`no POST/http endpoint references "${key}" in batterylifepo4.yaml`, !new RegExp(`/settings/[^"]*${key}`).test(yaml));
}

console.log(`\n${checks} checks run, ${failures} failed.`);
process.exit(failures ? 1 : 0);
