#!/usr/bin/env node
"use strict";

// Regression test for the 0x12D0 (sensor_heating_mask) metadata-only
// correction (2026-09-19, user-directed Stage 3 preflight follow-up).
//
// The pre-existing safety_notes (sourced only from the single upstream_
// syssi_esphome_jk_bms reference) claimed the absent-sensor bitmask was in
// the LOW byte, skipped BIT3, and put Heating in the HIGH byte. Direct
// review of two independent primary/verified sources this round --
// official PDF (p.11-12) and the V2 workbook (rows 13, 40, 67-72) --
// found both AGREE with each other and CONTRADICT that prior claim: the
// mask is BIT0..BIT5 consecutive (no gap) in the HIGH byte, and Heating
// is a whole-byte 1/0 value in the LOW byte. This file pins the corrected
// text and the invariants the correction must NOT violate: no new
// canonical field, no new runtime entity, no blocker closed, no bus/
// scheduler/decoder/UI change.
//
// IMPORTANT, per this project's own stated convention: every check below
// is STRUCTURAL/SOURCE-TEXT (no ESPHome toolchain in this environment).
// These checks pin canonical.json's own JSON content and protocol_
// blockers.json's own status field directly -- they do not execute any
// compiled decode logic (there is none to execute for a metadata-only
// change; the existing sensor_heating_mask entity's own decode is
// unchanged, already covered by this project's other regression suites).

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const canonical = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "registers.canonical.json"), "utf8"));
const blockers = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "evidence", "protocol_blockers.json"), "utf8"));
const yaml = fs.readFileSync(path.join(ROOT, "batterylifepo4.yaml"), "utf8");
const readPlan = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "generated", "read_plan.json"), "utf8"));

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

function findRegister(address) {
  return canonical.registers.find((r) => r.address === address);
}

const reg = findRegister("0x12D0");
const field = reg ? reg.fields.find((f) => f.key === "sensor_heating_mask") : null;

// ===========================================================================
// 1. Register-level structural facts unchanged: still one packed UINT16,
// still declared_access r, still exactly one field, still not split.
// ===========================================================================
check("reg_0x12D0 register_width_bits is still 16 (packed UINT16, not split into two 8-bit registers)",
  reg && reg.register_width_bits === 16);
check("reg_0x12D0 word_count is still 1 (one 16-bit register on the wire, unchanged)",
  reg && reg.word_count === 1);
check("reg_0x12D0 still has exactly one field (sensor_heating_mask) -- no new field added this batch",
  reg && reg.fields.length === 1 && reg.fields[0].key === "sensor_heating_mask");
check("sensor_heating_mask field_width_bits is still 16 (RAW, unsplit -- mask param 0xFFFF, shift 0)",
  field && field.field_width_bits === 16 && field.mask === "0xFFFF" && field.shift === 0);
check("sensor_heating_mask esphome_read_entity_id is still \"sensor_heating_mask\" (not renamed this batch)",
  field && field.esphome_read_entity_id === "sensor_heating_mask");

// ===========================================================================
// 2. Corrected safety_notes text: high byte = mask, bits 0-5 no gap, low
// byte = Heating -- and the RAW-vs-not-pre-split implementation note.
// ===========================================================================
check("safety_notes states the mask is in the HIGH byte, using neutral naming (not \"absent-...-mask\", which reads backward against the stated polarity)",
  /HIGH BYTE \(0xFF00\): temperature-sensor status mask/.test(reg.safety_notes) &&
  !/HIGH BYTE \(0xFF00\): absent-temperature-sensor mask/.test(reg.safety_notes));
check("safety_notes states Heating is in the LOW byte",
  /LOW BYTE \(0x00FF\): Heating status/.test(reg.safety_notes));
check("safety_notes lists BIT0..BIT5 consecutive with no gap (BIT3 explicitly present)",
  /BIT0\.\.BIT5 consecutive, no gap/.test(reg.safety_notes) &&
  /BIT3=battery temperature sensor 3|BIT3=sensor 3/.test(reg.safety_notes));
check("safety_notes explicitly documents sensor_heating_mask publishes the RAW, FULL, UNSPLIT UINT16 (not a pre-extracted high-byte mask)",
  /RAW, FULL, UNSPLIT UINT16/.test(reg.safety_notes));

// ===========================================================================
// 2c. Evidence audit (2026-09-19): BIT1-BIT5's polarity is dual-source
// (direct PDF legend on each row + V2 workbook rows 68-72), but BIT0's
// PDF row carries no value legend at all -- only the V2 workbook (row 67)
// states BIT0's polarity. safety_notes must state this asymmetry
// precisely, not silently extend bits 1-5's stronger confirmation to
// bit0, and not claim polarity was inferred from the "Absent"/"Present"
// field names.
// ===========================================================================
check("safety_notes distinguishes BIT1-BIT5's dual-source polarity confirmation from BIT0's single-source one",
  /BIT1-BIT5.*dual-source|dual-source.*BIT1-BIT5/.test(reg.safety_notes.replace(/\n/g, " ")) &&
  /BIT0.*rests on ONE source|BIT0's polarity therefore rests on ONE source/.test(reg.safety_notes));
check("safety_notes states BIT0's PDF row carries NO value legend (not silently assumed from bits 1-5)",
  /BIT0 \(MOS\), the PDF's own row \(p\.11\) carries NO value legend/.test(reg.safety_notes));
check("safety_notes does not claim polarity was derived from the field names (Absent/Present/Normal)",
  !/derived from the (field )?name/i.test(reg.safety_notes) &&
  !/inferred from the name/i.test(reg.safety_notes.replace(/not inferred from the field name/gi, "")));
check("Heating's polarity citation states it is NOT inferred from the field name (both sources state it directly)",
  /Heating status, whole-byte value\. Both sources state the value directly \(not inferred from the field name\)/.test(reg.safety_notes));

// ===========================================================================
// 2b. Cleanup batch (2026-09-19): the full old, wrong claim text is REMOVED
// from the normative safety_notes entirely -- not even quoted for "audit
// trail" purposes inside this field. The audit trail lives in git history
// (commit 384a290) instead; safety_notes may reference that fact, but must
// not restate the specific wrong byte/bit scheme itself anywhere in the
// canonical source or any generated artifact.
// ===========================================================================
check("safety_notes does NOT contain the 'PRIOR, CORRECTED CLAIM' paragraph or its wrong claim text anymore",
  !/PRIOR, CORRECTED CLAIM/.test(reg.safety_notes) &&
  !/low byte \/ heating status in the high byte/.test(reg.safety_notes));
check("safety_notes does NOT restate the old wrong bit list \"0/1/2/4/5\"",
  !/0\/1\/2\/4\/5/.test(reg.safety_notes));
check("safety_notes does NOT contain the old wrong phrase \"mask ... in the low byte\" or \"heating ... in the high byte\"",
  !/mask[^.]*\bin the low byte/i.test(reg.safety_notes) &&
  !/heating[^.]*\bin the high byte/i.test(reg.safety_notes));

const registerCatalogPath = path.join(ROOT, "register_catalog.json");
const jkBmsPath = path.join(ROOT, "jk_bms.js");
const registerCatalogText = fs.readFileSync(registerCatalogPath, "utf8");
const jkBmsText = fs.readFileSync(jkBmsPath, "utf8");
for (const [label, text] of [["register_catalog.json", registerCatalogText], ["jk_bms.js", jkBmsText]]) {
  check(`${label} does not contain the old wrong bit list "0/1/2/4/5"`,
    !text.includes("0/1/2/4/5"));
  check(`${label} does not contain the "PRIOR, CORRECTED CLAIM" text`,
    !text.includes("PRIOR, CORRECTED CLAIM"));
}

// ===========================================================================
// 3. Evidence: both the PDF and the V2 workbook citations are present, on
// both the field and the register, citing 0x12D0 specifically.
// ===========================================================================
for (const obj of [reg, field]) {
  const sourceIds = new Set(obj.evidence.map((e) => e.source_id));
  check(`${obj === reg ? "register" : "field"}: evidence includes official_jk_documentation (PDF)`,
    sourceIds.has("official_jk_documentation"));
  check(`${obj === reg ? "register" : "field"}: evidence includes workbook_lifepo4_bms_parameters_registers_v2`,
    sourceIds.has("workbook_lifepo4_bms_parameters_registers_v2"));
  const pdfEntry = obj.evidence.find((e) => e.source_id === "official_jk_documentation");
  check(`${obj === reg ? "register" : "field"}: PDF citation locator mentions 0x12D0`,
    pdfEntry && pdfEntry.locator.includes("0x12D0"));
  const wbEntry = obj.evidence.find((e) => e.source_id === "workbook_lifepo4_bms_parameters_registers_v2");
  check(`${obj === reg ? "register" : "field"}: V2 workbook citation locator mentions 0x12D0`,
    wbEntry && wbEntry.locator.includes("0x12D0"));
}

// ===========================================================================
// 4. No new canonical field or runtime entity anywhere in the catalog for
// any of the 8 individual manifest parameters this register maps to.
// ===========================================================================
const allKeys = new Set(canonical.registers.flatMap((r) => r.fields).map((f) => f.key));
const forbiddenNewKeys = [
  "mos_temp_sensor_present", "bat_temp_sensor_1_present", "bat_temp_sensor_2_present",
  "bat_temp_sensor_3_present", "bat_temp_sensor_4_present", "bat_temp_sensor_5_present",
  "heating_status", "temp_sensor_absent_mask",
];
for (const k of forbiddenNewKeys) {
  check(`no new canonical field "${k}" was created this batch`, !allKeys.has(k));
}
check("no new sensor_heating_mask-adjacent entity id appears in batterylifepo4.yaml (e.g. no new bit-derived binary_sensor)",
  !/id: (mos_temp_sensor_present|bat_temp_sensor_[1-5]_present|heating_status)\b/.test(yaml));

// ===========================================================================
// 5. read-plan: block for 0x12D0 is unchanged (still 1 field, same
// register_count/cadence) -- confirms zero new bus traffic, not assumed.
// ===========================================================================
const block = readPlan.blocks.find((b) => b.address === "0x12D0");
check("0x12D0 read-plan block still has exactly 1 field (sensor_heating_mask) -- no split, no new field",
  block && block.fields.length === 1 && block.fields[0].key === "sensor_heating_mask");
check("read plan block_count is still 100 (unchanged -- no block added or removed by this batch)",
  readPlan.block_count === 100);

// ===========================================================================
// 6. All 8 manifest-level blockers at 0x12D0 remain OPEN -- none closed
// by this metadata-only batch.
// ===========================================================================
const expectedOpenIds = new Set([
  "BATTempSensor1Present", "BATTempSensor2Present", "BATTempSensor3Present",
  "BATTempSensor4Present", "BATTempSensor5Present", "Heating",
  "MOSTempSensorPresent", "TempSensorAbsent",
]);
const blockerEntry = blockers.blockers.find((b) => b.address === "0x12D0");
check("the 0x12D0 blocker entry still exists and is still status=open",
  blockerEntry && blockerEntry.status === "open");
check("the 0x12D0 blocker entry's parameter_id still names all 8 expected manifest parameters",
  blockerEntry && [...expectedOpenIds].every((id) => blockerEntry.parameter_id.includes(id)));

console.log(`\n${checks} checks run, ${failures} failed.`);
process.exit(failures ? 1 : 0);
