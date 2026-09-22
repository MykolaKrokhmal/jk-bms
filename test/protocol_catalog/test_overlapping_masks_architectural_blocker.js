#!/usr/bin/env node
"use strict";

// History + resolution pin for the OVERLAPPING_MASKS architectural finding
// from the Stage 3 completion pass (2026-09-20, user-directed). Original
// finding: registers.canonical.json's OVERLAPPING_MASKS invariant
// unconditionally forbade individual bit/byte projections (Heating,
// BATTempSensor1-5Present, MOSTempSensorPresent at 0x12D0; 22 individual
// alarm bits at 0x12A0) from coexisting with their registers' own RAW
// whole-register entities (sensor_heating_mask, alarms_bitmask) --
// reproduced as a real 7-error generator rejection, not a hypothetical.
//
// RESOLUTION (Stage 3 continuation pass, 2026-09-20, same day): a
// generalized read-only projection architecture (registers.canonical.
// json's new projection_of field + tools/protocol/lib/semantic-checks.
// js's PROJECTION_* invariants) makes RAW-field-plus-projection overlap
// an explicit, schema-validated relationship instead of a blanket
// prohibition. Both 0x12D0 (7 fields) and 0x12A0 (22 fields) now have
// real projection fields; their blockers are closed. This file now pins
// that the resolution landed correctly and left the RAW fields untouched
// -- see test_projection_architecture.js for the schema-level invariant
// coverage (valid/invalid projection shapes, synthetic fixtures) and
// test_projection_decoder.js for the executable, real-payload decode
// coverage.

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
const blockers = loadJson("protocol/evidence/protocol_blockers.json");

// ===========================================================================
// 1. RAW whole-register fields are completely unchanged: still the FIRST
// field on their register, still full-width, still no projection_of of
// their own (a RAW field is never itself a projection).
// ===========================================================================
const reg12D0 = canonical.registers.find((r) => r.address === "0x12D0");
const reg12A0 = canonical.registers.find((r) => r.address === "0x12A0");
check("sensor_heating_mask (0x12D0) is still fields[0], full 16-bit width, not itself a projection",
  reg12D0 && reg12D0.fields[0].key === "sensor_heating_mask" &&
  reg12D0.fields[0].field_width_bits === 16 && reg12D0.fields[0].projection_of === null);
check("alarms_bitmask (0x12A0) is still fields[0], full 32-bit width, not itself a projection",
  reg12A0 && reg12A0.fields[0].key === "alarms_bitmask" &&
  reg12A0.fields[0].field_width_bits === 32 && reg12A0.fields[0].projection_of === null);

// ===========================================================================
// 2. 0x12D0 now has 7 real projections, 0x12A0 has 22 -- every one
// declares projection_of pointing at the correct RAW parent.
// ===========================================================================
const d12D0Projections = reg12D0.fields.filter((f) => f.projection_of !== null);
const d12A0Projections = reg12A0.fields.filter((f) => f.projection_of !== null);
check("0x12D0 has exactly 8 projection fields (7 from 2026-09-20 + temperature_sensor_status_mask, 2026-09-22), all projection_of: 'sensor_heating_mask'",
  d12D0Projections.length === 8 && d12D0Projections.every((f) => f.projection_of === "sensor_heating_mask"));
check("0x12A0 has exactly 22 projection fields, all projection_of: 'alarms_bitmask'",
  d12A0Projections.length === 22 && d12A0Projections.every((f) => f.projection_of === "alarms_bitmask"));

// ===========================================================================
// 3. Both original architectural blockers are CLOSED (the architectural
// gap they named is resolved). TempSensorAbsent's own separate blocker
// (unrelated stale-premise issue) is ALSO closed (2026-09-22, unmapped-
// rows cleanup -- the "aggregation formula" premise was corrected, not
// the architectural gap this file otherwise covers). TemperatureSensor
// Anomaly/PCLModuleAnomaly's own blocker is closed too, via this
// project's own explicit "permanently unsupported" resolution path --
// see test_stage3_status_map_exact_identity.js for the classifier-level
// coverage of that permanent classification.
// ===========================================================================
const blocker12D0Closed = blockers.blockers.find((b) => b.address === "0x12D0" && b.status === "closed" && b.parameter_id.includes("Heating"));
const blocker12A0Closed = blockers.blockers.find((b) => b.address === "0x12A0" && b.status === "closed" && b.parameter_id.includes("Alarm Mask"));
check("the original 0x12D0 architectural blocker (7 params) is closed", !!blocker12D0Closed);
check("the original 0x12A0 architectural blocker (22 params + AlarmBatUVP) is closed", !!blocker12A0Closed);

const tempSensorAbsentClosed = blockers.blockers.find((b) => b.address === "0x12D0" && b.parameter_id === "TempSensorAbsent" && b.status === "closed");
const anomaliesClosed = blockers.blockers.find((b) => b.address === "0x12A0" && b.parameter_id.includes("TemperatureSensorAnomaly") && b.status === "closed");
check("TempSensorAbsent's own separate blocker is now closed (stale aggregation-formula premise corrected -- it is a plain RAW projection, 2026-09-22)", !!tempSensorAbsentClosed);
check("TemperatureSensorAnomaly/PCLModuleAnomaly's own blocker is now closed (permanently classified unsupported, 2026-09-22 -- no bit guessed)", !!anomaliesClosed);

// ===========================================================================
// 4. No bit was guessed for TemperatureSensorAnomaly/PCLModuleAnomaly --
// they still have no canonical field anywhere, and 0x12A0's 22 real
// projections cover only bits 0-21 (never claiming the unspecified bits).
// ===========================================================================
const allFieldKeys = new Set(canonical.registers.flatMap((r) => r.fields).map((f) => f.key));
check("no canonical field exists for TemperatureSensorAnomaly or PCLModuleAnomaly (no guessed bit)",
  !allFieldKeys.has("temperature_sensor_anomaly") && !allFieldKeys.has("pcl_module_anomaly"));
const shifts = d12A0Projections.map((f) => f.shift).sort((a, b) => a - b);
check("0x12A0's 22 projection shifts are exactly 0-21, no duplicates, nothing beyond bit21",
  JSON.stringify(shifts) === JSON.stringify(Array.from({ length: 22 }, (_, i) => i)));

console.log(`\n${checks} checks run, ${failures} failed.`);
process.exit(failures ? 1 : 0);
