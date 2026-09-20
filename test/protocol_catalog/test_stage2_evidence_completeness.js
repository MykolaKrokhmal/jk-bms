#!/usr/bin/env node
"use strict";

// Stage 2 (typed-petting-puzzle plan) exit-criterion test: "evidence-pair
// completeness (workbook+PDF evidence or an explicit blocker -- never a
// silent third option)". Reads the REAL generated artifacts --
// protocol/generated/bms_v1_1_manifest.json, protocol/generated/
// pdf_locators.json, protocol/settings_ui.mapping.json, and
// protocol/evidence/protocol_blockers.json -- not a reimplementation.
//
// Every one of the 265 manifest parameters must land in EXACTLY one of
// three honest buckets, with nothing falling through the cracks:
//   1. reserved_authored_in_canonical  -- the 4 reserved rows (3 newly
//      authored this stage + the pre-existing Reserved_12D2), each with
//      a real canonical.json entry citing both workbook and PDF evidence.
//   2. not_applicable_calculated_field -- the 1 "derived" parameter
//      (ESPHome_Power), which is not a hardware register at all (its
//      own manifest audit_note says so) and so has no register-address
//      evidence to gather.
//   3. everything else (260 parameters): workbook evidence always
//      exists (they're IN the workbook-derived manifest by definition);
//      PDF evidence is either (a) resolved -- pdf_locators.json found an
//      unambiguous match -- or (b) an open protocol_blockers.json entry
//      names that exact parameter_id, explaining why not, per the plan's
//      explicit "no guessing, ever" policy for PDF evidence.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
function loadJson(p) { return JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8")); }

const manifest = loadJson("protocol/generated/bms_v1_1_manifest.json");
const locators = loadJson("protocol/generated/pdf_locators.json");
const mapping = loadJson("protocol/settings_ui.mapping.json");
const blockers = loadJson("protocol/evidence/protocol_blockers.json");
const canonical = loadJson("protocol/registers.canonical.json");

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

const locatorById = new Map(locators.locators.map((l) => [l.id, l]));
// A parameter is covered by an open blocker if its id appears in that
// blocker's comma-separated parameter_id list (the same convention the
// pre-existing rcv_time,rfv_time blocker already established).
const blockedIds = new Set();
for (const b of blockers.blockers) {
  if (b.status !== "open") continue;
  for (const id of b.parameter_id.split(",")) blockedIds.add(id.trim());
}

const reservedIds = new Set(manifest.parameters.filter((p) => p.classification === "reserved").map((p) => p.id));
const calculatedIds = new Set(manifest.parameters.filter((p) => p.classification === "derived").map((p) => p.id));

check("exactly 4 parameters are classified reserved (3 newly authored + Reserved_12D2 pre-existing)",
  reservedIds.size === 4, [...reservedIds].join(","));
check("exactly 1 parameter is classified derived/calculated (not a hardware register)",
  calculatedIds.size === 1, [...calculatedIds].join(","));

// Stage 3 (typed-petting-puzzle plan) batch 1 introduced a THIRD terminal
// state beyond Stage 2's original resolved/blocked dichotomy:
// manually-implemented-with-hand-verified-evidence. PCLModuleSta,
// UART1MPRTOLNbr and UART2MPRTOLNbr were never resolved by the mechanical
// PDF-locator matcher (a backward-only lookback that cannot resolve a
// packed sibling whose own mnemonic line precedes the shared offset-marker
// line -- a matcher limitation, not a protocol contradiction), but their
// byte layout WAS resolved this session by direct manual review of the raw
// pdftotext extraction, with the same dual-source evidence rigor as every
// other imported field, and they are now real, implemented canonical
// fields (pcl_module_sta, uart1_mprtol_nbr, uart2_mprtol_nbr). Their
// blockers were correspondingly closed (status "closed", not "open"), so
// they legitimately fall out of BOTH the "resolved locator" and "open
// blocker" buckets -- a 3rd bucket accounts for them honestly instead of
// mis-flagging closed, implemented work as "uncovered".
//
// MaxVolCellNbr (2026-09-18, Stage 3 bounded task: MinVolCellNbr/
// CellWireResSta read-only implementation) joins this bucket for the
// EXACT same reason: its own PDF row ("UINT8 R MaxVolCellNbr") precedes
// the shared "0x0048 72 2" offset-marker line, so the matcher's backward
// lookback cannot resolve it -- MinVolCellNbr's own mnemonic line comes
// AFTER that marker, so the matcher resolves it automatically and it
// never needed this bucket at all (confirmed: MinVolCellNbr has a real
// pdf_locator entry). Manually resolved via direct PDF (p.9) + V2
// workbook (row 83) review this session; blocker closed accordingly.
const canonicalKeysForEvidence = new Set(canonical.registers.flatMap((r) => r.fields).map((f) => f.key));
const MANUALLY_RESOLVED_ID_TO_KEY = {
  PCLModuleSta: "pcl_module_sta",
  UART1MPRTOLNbr: "uart1_mprtol_nbr",
  UART2MPRTOLNbr: "uart2_mprtol_nbr",
  MaxVolCellNbr: "max_voltage_cell_index_native",
  // 0x12A6/0x12B8/0x12C0 metadata batch (2026-09-19): BalanSta, SOCSOH,
  // Charge each have their own mnemonic line BEFORE the shared offset-
  // marker line (same matcher limitation as MaxVolCellNbr above) -- their
  // packed low-byte siblings (SOCStateOfcharge, Precharge, Discharge)
  // come AFTER the marker and were already matcher-resolved, never
  // needing this bucket. All three fields were ALREADY implemented
  // (real, hardware-observed entities) before this batch -- it only
  // added the PDF (p.11) citation and closed the blocker.
  BalanSta: "balancing_active",
  SOCSOH: "state_of_health",
  Charge: "charging_active",
  // 0x1114 bit cluster (Stage 3 completion pass, 2026-09-20): all 10
  // bits share one PDF row (p.8, offset 0x0114) whose own mnemonic-
  // bearing sub-rows are un-anchored to a distinct per-row offset marker
  // the mechanical matcher can key on (only "Special Charger" happened to
  // resolve automatically -- see pdf_locators.json). The other 9,
  // including the pre-existing ChargingFloatMode (whose own field
  // predates this batch but never had a resolved locator either), were
  // manually confirmed against the same PDF page + the V2 workbook
  // (source rows 87, 123-131) this round; the stale/overbroad 0x1114
  // blocker that used to cover the other 8 (not ChargingFloatMode, which
  // was never in that blocker's own text -- a DIFFERENT, now-fixed
  // matcher bug) is closed accordingly.
  ChargingFloatMode: "charging_float_mode",
  HeatEN: "heat_en",
  "Disable temp-sensor": "disable_temp_sensor",
  "GPS Heartbeat": "gps_heartbeat",
  "Port Switch": "port_switch",
  "LCD Always On": "lcd_always_on",
  SmartSleep: "smart_sleep_enabled",
  DisablePCLModule: "disable_pcl_module",
  TimedStoredData: "timed_stored_data",
  // 0x1118 (Stage 3 completion pass, 2026-09-20): new register, same
  // matcher-lookback limitation as the 0x1114 cluster (one shared PDF
  // row spanning a packed pair). Manually confirmed against PDF p.8 +
  // V2 workbook rows 132-133.
  TIMSmartSleep: "smart_sleep_timeout_hours",
  DataDomainEnable0: "data_domain_enable_0",
  // LCDBuzzerTrigger/DRY2Trigger (Stage 3 completion pass, 2026-09-20):
  // already-implemented fields (lcd_buzzer_trigger, dry_contact_2_
  // trigger_source) whose own blockers were stale matcher-only locator
  // gaps -- manually confirmed against PDF p.12 this round, closed.
  LCDBuzzerTrigger: "lcd_buzzer_trigger",
  DRY2Trigger: "dry_contact_2_trigger_source",
  // 0x12D0/0x12A0 generalized projection architecture (Stage 3
  // continuation pass, 2026-09-20): same matcher-lookback limitation
  // (each shares one PDF row/table region with siblings) -- manually
  // confirmed against PDF p.11-12 (0x12D0) and p.10-11 (0x12A0) + the V2
  // workbook this round.
  Heating: "heating_active",
  "Alarm Mask": "alarms_bitmask",
  AlarmWireRes: "alarm_wire_res",
  AlarmMosOTP: "alarm_mos_otp",
  AlarmCellQuantity: "alarm_cell_quantity",
  AlarmCurSensorErr: "alarm_cur_sensor_err",
  AlarmCellOVP: "alarm_cell_ovp",
  AlarmBatOVP: "alarm_bat_ovp",
  AlarmChOCP: "alarm_ch_ocp",
  AlarmChSCP: "alarm_ch_scp",
  AlarmChOTP: "alarm_ch_otp",
  AlarmChUTP: "alarm_ch_utp",
  AlarmCPUAuxCommuErr: "alarm_cpu_aux_commu_err",
  AlarmCellUVP: "alarm_cell_uvp",
  AlarmDchOCP: "alarm_dch_ocp",
  AlarmDchSCP: "alarm_dch_scp",
  AlarmDchOTP: "alarm_dch_otp",
  AlarmChargeMOS: "alarm_charge_mos",
  AlarmDischargeMOS: "alarm_discharge_mos",
  GPSDisconneted: "gps_disconnected",
  ModifyPWDInTime: "modify_pwd_in_time",
  DischargeOnFailed: "discharge_on_failed",
  BatteryOverTempAlarm: "battery_over_temp_alarm",
  MOSTempSensorPresent: "mos_temp_sensor_status_bit_raw",
  BATTempSensor1Present: "bat_temp_sensor_1_present",
  BATTempSensor2Present: "bat_temp_sensor_2_present",
  BATTempSensor3Present: "bat_temp_sensor_3_present",
  BATTempSensor4Present: "bat_temp_sensor_4_present",
  BATTempSensor5Present: "bat_temp_sensor_5_present",
};

const uncategorized = [];
let resolvedCount = 0;
let blockedCount = 0;
let manuallyResolvedCount = 0;
for (const p of manifest.parameters) {
  if (reservedIds.has(p.id) || calculatedIds.has(p.id)) continue; // handled by their own dedicated checks above
  const loc = locatorById.get(p.id);
  const hasResolvedPdf = Boolean(loc && loc.pdf_locator);
  const hasBlocker = blockedIds.has(p.id);
  const manualKey = MANUALLY_RESOLVED_ID_TO_KEY[p.id];
  const hasManualImplementation = Boolean(manualKey && canonicalKeysForEvidence.has(manualKey));
  if (hasResolvedPdf) resolvedCount += 1;
  else if (hasBlocker) blockedCount += 1;
  else if (hasManualImplementation) manuallyResolvedCount += 1;
  else uncategorized.push(p.id);
}
check("every non-reserved, non-calculated parameter (260 of 265) is either PDF-resolved, covered by an open blocker, or manually-resolved-and-implemented -- never silently uncovered",
  uncategorized.length === 0, `uncategorized=${uncategorized.length}: ${uncategorized.slice(0, 10).join(",")}${uncategorized.length > 10 ? "..." : ""}`);
check("resolved + blocked + manually-resolved accounts for all 260 non-reserved/non-calculated parameters",
  resolvedCount + blockedCount + manuallyResolvedCount === 260,
  `resolved=${resolvedCount} blocked=${blockedCount} manually-resolved=${manuallyResolvedCount} total=${resolvedCount + blockedCount + manuallyResolvedCount}`);
check("exactly 49 parameters are in the manually-resolved-and-implemented bucket (20 from earlier this round [0x1114 cluster, 0x1118, LCDBuzzerTrigger/DRY2Trigger, and pre-existing entries] + 29 new: 0x12D0's 7 projections + 0x12A0's 22 alarm-bit projections, Stage 3 continuation pass 2026-09-20)",
  manuallyResolvedCount === 49, `actual=${manuallyResolvedCount}`);

// The 3 newly-authored reserved rows must each have a REAL canonical.json
// entry (not just a manifest classification) -- cross-checked against the
// actual tracked catalog, not just this test's own bookkeeping.
const canonicalKeys = canonicalKeysForEvidence;
for (const key of ["rvd_12ee_h", "rvd_130c_l", "rvd_1506_l"]) {
  check(`newly-authored reserved field "${key}" exists in registers.canonical.json`, canonicalKeys.has(key));
}
check("registers.canonical.json is at least 122 registers / 130 fields (Stage 2 exit criterion, monotonic floor -- Stage 3 batch 1, typed-petting-puzzle plan, grew this to 135 registers / 148 fields by importing 18 independently-verified parameters; a later stage may grow it further, but it must never shrink below the Stage 2 floor)",
  canonical.registers.length >= 122 && canonical.registers.flatMap((r) => r.fields).length >= 130,
  `registers=${canonical.registers.length} fields=${canonical.registers.flatMap((r) => r.fields).length}`);

// mapping.json's own evidence_status field must agree with this test's
// independently-computed classification -- proves the mapping generator
// isn't silently drifting from the real locator/blocker data.
let mappingMismatches = 0;
const mappingById = new Map(mapping.parameters.map((p) => [p.id, p]));
for (const p of manifest.parameters) {
  const mapEntry = mappingById.get(p.id);
  if (!mapEntry) continue;
  let expected;
  if (reservedIds.has(p.id)) expected = "reserved_authored_in_canonical";
  else if (calculatedIds.has(p.id)) expected = "not_applicable_calculated_field";
  else {
    const loc = locatorById.get(p.id);
    expected = (loc && loc.pdf_locator) ? "resolved" : "blocked";
  }
  if (mapEntry.evidence_status !== expected) mappingMismatches += 1;
}
check("settings_ui.mapping.json's evidence_status field matches this test's independent computation for every parameter",
  mappingMismatches === 0, `mismatches=${mappingMismatches}`);

// The 4 already-known manifest ambiguities (2 bit_number_missing @
// 0x12A0, 2 type_length_mismatch @ 0x1600/0x1606) must each have their
// own open blocker -- proves they weren't silently dropped when the
// broader PDF-locator blockers were seeded.
for (const id of ["TemperatureSensorAnomaly", "PCLModuleAnomaly", "VoltageCalibration", "CurrentCalibration"]) {
  check(`known manifest ambiguity "${id}" has its own open blocker entry`, blockedIds.has(id));
}

console.log(`\n${checks} checks run, ${failures} failed.`);
process.exit(failures ? 1 : 0);
