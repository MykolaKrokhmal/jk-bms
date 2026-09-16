#!/usr/bin/env node
"use strict";

/*
 * Stage 2 (typed-petting-puzzle plan, §1's group-mapping policy):
 * assigns each of the 265 manifest parameters (protocol/generated/
 * bms_v1_1_manifest.json) to one of the workbook's own 12 curated
 * "Групи UI" design groups, writing protocol/settings_ui.mapping.json.
 *
 * The manifest's own ui_order_note (present on every parameter) already
 * documents WHY this can't be a mechanical column read: the workbook
 * carries two non-isomorphic taxonomies -- an 8-value coarse
 * "group_raw" column on the register-registry sheet, and a SEPARATE
 * 12-group curated list on the "Групи UI" sheet, with no column linking
 * a row to one of the 12. Per the plan's own anti-stall policy for
 * UI-group assignment (distinct from its "no guessing, ever" PDF-evidence
 * policy): "after one bounded review pass, an unresolved parameter gets
 * its most-plausible group, marked mapping_confidence:'low', logged, not
 * blocking." This file IS that one bounded pass -- a fixed, reviewable,
 * name_prog-keyed lookup table (never a fuzzy/NLP match), built once by
 * reading each of the 154 parameters in the two ambiguous group_raw
 * buckets against the 12 groups' own theme/access/policy text. The other
 * 111 parameters resolve unambiguously straight from group_raw (cell
 * live data -> group 10, cell wire-resistance calibration -> group 11,
 * W-commands -> group 12, reserved/unverified -> no group).
 *
 * Run:
 *   node tools/protocol/authoring/build_settings_ui_mapping.js
 *   node tools/protocol/authoring/build_settings_ui_mapping.js --check
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const MANIFEST_PATH = path.join(ROOT, "protocol", "generated", "bms_v1_1_manifest.json");
const LOCATORS_PATH = path.join(ROOT, "protocol", "generated", "pdf_locators.json");
const OUT_PATH = path.join(ROOT, "protocol", "settings_ui.mapping.json");
const CHECK = process.argv.includes("--check");

// Direct, unambiguous group_raw -> ui_group mappings (111 of 265
// parameters resolve here with no further lookup needed).
const DIRECT_GROUP_RAW = {
  "Налаштування → Комірки → Поточні дані (R)": 10,
  "Налаштування → Комірки → Калібрування (RW)": 11,
  "Сервіс → Команди (W)": 12,
  "Не відображати": null, // reserved (3 new + the pre-existing Reserved_12D2) -- never shown
  "Не відображати як окремий стан до верифікації": null, // bit_number_missing manifest ambiguity -- see protocol_blockers.json
  "Діагностика / Огляд": null, // ESPHome_Power: classification "derived", explicitly excluded from Settings by the manifest's own audit_note -- not a hardware register at all
};

// The two ambiguous buckets ("Налаштування → Моніторинг (R)", 89 rows;
// "Налаштування → Конфігурація BMS (RW)", 65 rows) -- 154 total, every
// name_prog explicitly classified once, by theme, against the 12 groups'
// own name/access/policy text (protocol/generated/bms_v1_1_manifest.json's
// own ui_groups[]). No entry here was guessed from the identifier string
// alone without reading its Ukrainian description too.
const EXPLICIT_GROUP = {
  // --- group 1: Моніторинг (battery/state/temp/alarm/timer monitoring)
  Charge: 1, Discharge: 1, Precharge: 1, ChargerPlugged: 1, PCLModuleSta: 1,
  TimeEnterSleep: 1, SOCCapRemain: 1, SOCFullChargeCap: 1, SOCCycleCap: 1,
  SOCCycleCount: 1, SOCSOH: 1, SOCStateOfcharge: 1, BatVol: 1, BatCurrent: 1,
  BatWatt: 1, ODDRunTime: 1, PWROnTimes: 1, RunTime: 1, SysRunTicks: 1, RTCTicks: 1,
  "Alarm Mask": 1, UserAlarm: 1, UserAlarm2: 1, AlarmWireRes: 1, AlarmMosOTP: 1,
  AlarmCellQuantity: 1, AlarmCurSensorErr: 1, AlarmCellOVP: 1, AlarmBatOVP: 1,
  AlarmChOCP: 1, AlarmChSCP: 1, AlarmChOTP: 1, AlarmChUTP: 1, AlarmCPUAuxCommuErr: 1,
  AlarmCellUVP: 1, AlarmBatUVP: 1, AlarmDchOCP: 1, AlarmDchSCP: 1, AlarmDchOTP: 1,
  AlarmChargeMOS: 1, AlarmDischargeMOS: 1, GPSDisconneted: 1, ModifyPWDInTime: 1,
  DischargeOnFailed: 1, BatteryOverTempAlarm: 1, TimeDcOCPR: 1, TimeDcSCPR: 1,
  TimeCOCPR: 1, TimeCSCPR: 1, TimeUVPR: 1, TimeOVPR: 1, TimeEmergency: 1,

  // --- group 2: Топологія та паспортні дані (topology/identity)
  ManufacturerDeviceID: 2, HardwareVersion: 2, SoftwareVersion: 2, CellCount: 2,
  CapBatCell: 2, CellSta: 2, MaxVolCellNbr: 2, MinVolCellNbr: 2,

  // --- group 3: Напруги, SOC-пороги та заряд (voltage/SOC thresholds, charge)
  VolCellOV: 3, VolCellRCV: 3, "VolSOC100%": 3, VolCellOVPR: 3, VolCellRFV: 3,
  VolSmartSleep: 3, VolCellUV: 3, VolCellUVPR: 3, "VolSOC0%": 3, VolSysPwrOff: 3,
  RCVTime: 3, RFVTime: 3, BatChargeEN: 3, BatDisChargeEN: 3, ChargingFloatMode: 3,
  "Special Charger": 3,

  // --- group 4: Балансування (balancing)
  CellVolAve: 4, CellVdifMax: 4, BalanSta: 4, BalanCurrent: 4, BalanEN: 4,
  VolBalanTrig: 4, VolStartBalan: 4, CurBalanMax: 4,

  // --- group 5: Струм і коротке замикання (current & short-circuit)
  BatDisCurCorrect: 5, VolChargCur: 5, VolDischargCur: 5, BatVolCorrect: 5,
  CurBatCOC: 5, TIMBatCOCPDly: 5, TIMBatCOCPRDly: 5, CurBatDcOC: 5,
  TIMBatDcOCPDly: 5, TIMBatDcOCPRDly: 5, SCPDelay: 5, TIMBatSCPRDly: 5,
  TIMProdischarge: 5,

  // --- group 6: Температура та підігрів (temperature & heating)
  TempMos: 6, "TempBat 1": 6, "TempBat 2": 6, "TempBat 3": 6, "TempBat 4": 6,
  "TempBat 5": 6, HeatCurrent: 6, Heating: 6, TempSensorAbsent: 6,
  MOSTempSensorPresent: 6, BATTempSensor1Present: 6, BATTempSensor2Present: 6,
  BATTempSensor3Present: 6, BATTempSensor4Present: 6, BATTempSensor5Present: 6,
  TMPBatDcOT: 6, TMPBatDcOTPR: 6, TMPBatCOT: 6, TMPBatCOTPR: 6, TMPBatCUT: 6,
  TMPBatCUTPR: 6, TMPMosOT: 6, TMPMosOTPR: 6, HeatStartTemp: 6, HeatStopTemp: 6,
  HeatEN: 6, "Disable temp-sensor": 6, DisablePCLModule: 6,

  // --- group 7: Системні функції (system functions)
  CellWireResSta: 7, "GPS Heartbeat": 7, "Port Switch": 7, "LCD Always On": 7,
  SmartSleep: 7, TimedStoredData: 7, TIMSmartSleep: 7, PWD_Config: 7,
  DataStoredPeriod: 7,

  // --- group 8: Комунікаційні інтерфейси (communication)
  DataDomainEnable0: 8, UARTMPTLVer: 8, CANMPTLVer: 8, UART1MPRTOLEnable: 8,
  "UARTMPRTOLEnable[0-15]": 8, "UART2MPRTOLEnable[0]": 8, DevAddr: 8,
  UART1MPRTOLNbr: 8, CANMPRTOLNbr: 8, UART2MPRTOLNbr: 8,

  // --- group 9: Зумер LCD та сухі контакти (LCD buzzer & dry contacts)
  LCDBuzzerTrigger: 9, DRY1Trigger: 9, DRY2Trigger: 9, LCDBuzzerTriggerVal: 9,
  LCDBuzzerReleaseVal: 9, DRY1TriggerVal: 9, DRY1ReleaseVal: 9, DRY2TriggerVal: 9,
  DRY2ReleaseVal: 9,
};

function classify(p) {
  const groupRaw = p.ui.group_raw;
  if (Object.prototype.hasOwnProperty.call(DIRECT_GROUP_RAW, groupRaw)) {
    return { ui_group: DIRECT_GROUP_RAW[groupRaw], confidence: "high", rule: `direct_group_raw:${groupRaw}` };
  }
  if (Object.prototype.hasOwnProperty.call(EXPLICIT_GROUP, p.name_prog)) {
    return { ui_group: EXPLICIT_GROUP[p.name_prog], confidence: "high", rule: `explicit_name_prog_lookup` };
  }
  // Should not happen -- every name_prog in the two ambiguous buckets was
  // enumerated above. If the manifest regenerates with a genuinely new
  // parameter, fail closed (low confidence, no group) rather than guess.
  return { ui_group: null, confidence: "low", rule: "unclassified_new_parameter_needs_manual_review" };
}

function loadJson(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }

function build() {
  const manifest = loadJson(MANIFEST_PATH);
  const locators = loadJson(LOCATORS_PATH);
  const locatorById = new Map(locators.locators.map((l) => [l.id, l]));

  // Stable ui_order within each group: manifest source_row (the
  // workbook's own document order) -- a real, defensible ordering
  // signal, not invented.
  const byGroup = new Map();
  const entries = manifest.parameters.map((p) => {
    const { ui_group, confidence, rule } = classify(p);
    const loc = locatorById.get(p.id);
    let evidence_status;
    if (p.classification === "reserved") evidence_status = "reserved_authored_in_canonical";
    else if (p.classification === "derived") evidence_status = "not_applicable_calculated_field";
    else if (loc && loc.pdf_locator) evidence_status = "resolved";
    else evidence_status = "blocked";
    return {
      id: p.id,
      name_ua: p.name_ua,
      base_address: p.address.base_address,
      access: p.access,
      classification: p.classification,
      ui_group,
      ui_order: null, // filled in below, per group, by source_row
      mapping_confidence: confidence,
      mapping_rule: rule,
      evidence_status,
      pdf_locator_present: Boolean(loc && loc.pdf_locator),
      source_row: p.source_row,
    };
  });

  for (const e of entries) {
    const key = e.ui_group === null ? "none" : e.ui_group;
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(e);
  }
  for (const [, list] of byGroup) {
    list.sort((a, b) => a.source_row - b.source_row);
    list.forEach((e, i) => { e.ui_order = i + 1; });
  }

  const lowConfidence = entries.filter((e) => e.mapping_confidence === "low");

  return {
    $comment: "GENERATED -- Stage 2 (typed-petting-puzzle plan §1) group-mapping policy applied once against protocol/generated/bms_v1_1_manifest.json. DO NOT EDIT BY HAND. Regenerate with tools/protocol/authoring/build_settings_ui_mapping.js.",
    manifest_source_sha256: require("crypto").createHash("sha256").update(fs.readFileSync(MANIFEST_PATH)).digest("hex"),
    parameter_count: entries.length,
    grouped_count: entries.filter((e) => e.ui_group !== null).length,
    ungrouped_count: entries.filter((e) => e.ui_group === null).length,
    low_confidence_count: lowConfidence.length,
    ui_groups: manifest.ui_groups,
    parameters: entries,
  };
}

function main() {
  const output = build();
  const serialized = JSON.stringify(output, null, 2) + "\n";
  if (CHECK) {
    if (!fs.existsSync(OUT_PATH)) {
      console.error("build_settings_ui_mapping.js --check: DRIFT -- protocol/settings_ui.mapping.json does not exist.");
      process.exit(1);
    }
    if (fs.readFileSync(OUT_PATH, "utf8") !== serialized) {
      console.error("build_settings_ui_mapping.js --check: DRIFT -- protocol/settings_ui.mapping.json does not match a fresh regeneration.");
      process.exit(1);
    }
    console.log("build_settings_ui_mapping.js --check: no drift.");
    return;
  }
  fs.writeFileSync(OUT_PATH, serialized);
  console.log(`wrote ${path.relative(ROOT, OUT_PATH)}`);
  console.log(`${output.parameter_count} parameters: ${output.grouped_count} grouped, ${output.ungrouped_count} ungrouped, ${output.low_confidence_count} low-confidence.`);
}

main();
