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
check("reg_0x12D0 has 9 fields (RAW sensor_heating_mask, unchanged, as fields[0] + 7 projections added Stage 3 continuation pass 2026-09-20 + temperature_sensor_status_mask added 2026-09-22 unmapped-rows cleanup)",
  reg && reg.fields.length === 9 && reg.fields[0].key === "sensor_heating_mask");
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
// 4. UPDATED (unmapped-rows cleanup, 2026-09-22): all 8 individual
// manifest parameters this register maps to now have real, evidenced
// canonical PROJECTION fields -- the 7 from the Stage 3 continuation pass
// (2026-09-20) plus TempSensorAbsent's own temperature_sensor_status_mask
// (2026-09-22, corrects a stale "unevidenced aggregation formula" premise
// -- the manifest itself describes TempSensorAbsent as the RAW high byte,
// not a formula over it; see this field's own overlap_rule/evidence).
// "mos_temp_sensor_present" specifically is STILL absent -- deliberately:
// MOSTempSensorPresent's own field uses neutral naming
// (mos_temp_sensor_status_bit_raw), never asserting the "present"
// semantic its own single-source-only polarity evidence doesn't fully
// support.
// ===========================================================================
const allKeys = new Set(canonical.registers.flatMap((r) => r.fields).map((f) => f.key));
const nowImplementedKeys = [
  "heating_active", "bat_temp_sensor_1_present", "bat_temp_sensor_2_present",
  "bat_temp_sensor_3_present", "bat_temp_sensor_4_present", "bat_temp_sensor_5_present",
  "mos_temp_sensor_status_bit_raw", "temperature_sensor_status_mask",
];
for (const k of nowImplementedKeys) {
  check(`canonical projection field "${k}" now exists (Stage 3 continuation pass, 2026-09-20 / unmapped-rows cleanup, 2026-09-22)`, allKeys.has(k));
}
check("no 'mos_temp_sensor_present' key exists -- MOSTempSensorPresent deliberately uses neutral naming instead (single-source polarity)",
  !allKeys.has("mos_temp_sensor_present"));
check("no 'temp_sensor_absent_mask' aggregate key exists -- TempSensorAbsent's real field is temperature_sensor_status_mask (a plain RAW projection), never a fabricated aggregate/formula key",
  !allKeys.has("temp_sensor_absent_mask"));
check("every new projection field declares projection_of: 'sensor_heating_mask' (never its own Modbus read)",
  nowImplementedKeys.every((k) => {
    const f = canonical.registers.flatMap((r) => r.fields).find((ff) => ff.key === k);
    return f && f.projection_of === "sensor_heating_mask";
  }));

// ===========================================================================
// 5. read-plan: block for 0x12D0 now carries the RAW field + all 8
// projections, decoded from the SAME payload -- register_count/cadence
// unchanged, confirming zero new bus traffic for this specific block
// (block_count itself DID grow this round, but from wholly separate new
// registers -- 0x1118, 0x14B4, 0x14C4 -- never from 0x12D0 splitting).
// ===========================================================================
const block = readPlan.blocks.find((b) => b.address === "0x12D0");
check("0x12D0 read-plan block now has exactly 9 fields (RAW sensor_heating_mask + 8 projections), all decoded from the SAME single payload",
  block && block.fields.length === 9 && block.fields.some((f) => f.key === "sensor_heating_mask"));
check("0x12D0 block's own register_count/payload_bytes are unchanged (1 register, 2 bytes) -- projections add zero new bus traffic",
  block && block.register_count === 1 && block.payload_bytes === 2);

// ===========================================================================
// 6. All 8 manifest-level parameters at 0x12D0 are now implemented; zero
// open 0x12D0 blockers remain (TempSensorAbsent's own separate blocker,
// stale "aggregation formula" premise corrected, closed 2026-09-22).
// ===========================================================================
const blockerEntries = blockers.blockers.filter((b) => b.address === "0x12D0" && b.status === "open");
check("zero open 0x12D0 blockers remain (TempSensorAbsent's own blocker closed, 2026-09-22 unmapped-rows cleanup)",
  blockerEntries.length === 0, JSON.stringify(blockerEntries.map((b) => b.parameter_id)));
const closedBlockers = blockers.blockers.filter((b) => b.address === "0x12D0" && b.status === "closed");
check("a closed 0x12D0 blocker exists covering the 7 architecturally-resolved parameters",
  closedBlockers.some((b) => b.parameter_id.includes("Heating") && b.parameter_id.includes("BATTempSensor1Present")));
check("a closed 0x12D0 blocker exists covering TempSensorAbsent specifically, with a resolution recorded",
  closedBlockers.some((b) => b.parameter_id === "TempSensorAbsent" && typeof b.resolution === "string" && b.resolution.length > 0));

console.log(`\n${checks} checks run, ${failures} failed.`);
process.exit(failures ? 1 : 0);
