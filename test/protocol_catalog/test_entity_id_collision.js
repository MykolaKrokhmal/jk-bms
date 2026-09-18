#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const source = fs.readFileSync(path.join(ROOT, "jk_bms.js"), "utf8");
const canonical = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "registers.canonical.json"), "utf8"));

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

function extractCalls(src) {
  const calls = [];
  const literal = /registerEntity\("([a-zA-Z0-9_]+)",\s*"([a-zA-Z0-9_]+)",\s*"([^"]*)",\s*"([^"]*)"\)/g;
  for (let match = literal.exec(src); match; match = literal.exec(src)) {
    calls.push({ key: match[1], domain: match[2], configuredName: match[3], legacyObjectId: match[4] });
  }
  const loop = src.match(/for \(const name of \[(.*?)\]\)\s*registerEntity\(name,\s*"sensor",\s*name\.replaceAll\("_",\s*" "\),\s*name\)/s);
  if (loop) {
    for (const match of loop[1].matchAll(/"([a-zA-Z0-9_]+)"/g)) {
      const key = match[1];
      calls.push({ key, domain: "sensor", configuredName: key.replaceAll("_", " "), legacyObjectId: key });
    }
  }
  return calls;
}

const calls = extractCalls(source);
check("entity registrations extracted", calls.length > 100, `count=${calls.length}`);

for (const [wireObjectId, expectedKey] of [["cell_rcv", "cell_rcv"], ["cell_rfv", "cell_rfv"]]) {
  const owners = calls.filter((call) => call.domain === "sensor" && (
    call.legacyObjectId === wireObjectId || call.configuredName.toLowerCase().replaceAll(" ", "_") === wireObjectId
  ));
  check(`${wireObjectId} has one wire owner`, owners.length === 1, `owners=${owners.map((item) => item.key).join(",")}`);
  check(`${wireObjectId} owner is canonical`, owners.length === 1 && owners[0].key === expectedKey);
}

check("charge target consumers use canonical keys",
  source.includes('numeric("cell_rcv")') && source.includes('numeric("cell_rfv")') &&
  source.includes('bind("cell_rcv", drawTimeline)') && source.includes('bind("cell_rfv", drawTimeline)'));
check("obsolete alias keys are absent from live state consumers",
  !source.includes('registerEntity("cell_request_charge_voltage"') &&
  !source.includes('registerEntity("cell_request_float_voltage"') &&
  !source.includes('numeric("cell_request_charge_voltage")') &&
  !source.includes('numeric("cell_request_float_voltage")'));

// P1-13 (2026-09-10): protocol/registers.canonical.json's esphome_read_entity_id
// is documentation metadata (never consumed by any generated jk_bms.js artifact --
// PROTOCOL_CATALOG only ever embeds genericTxAddress/nonRegisterKeys/blockedWriteKeys,
// confirmed by direct inspection), but a wrong claim there is still a real defect:
// two were found by hand this pass (balancing_active claimed its own key instead of
// the real wire id "balancing"; temperature_5 claimed the YAML's internal `id:`
// "jkbms_bat_temp4" instead of the real, `name:`-derived wire id
// "temperature_sensor_5") after an earlier, WRONG guess that cell_rcv/cell_rfv were
// also wrong (they are not -- registerEntity() has no call for either key at all,
// so diagnosticObjectId() falls back to the regex-derived id, which already equals
// the key by this codebase's own no-remap convention; this exact check above already
// proves cell_rcv/cell_rfv resolve correctly). This check is the permanent guard:
// for every canonical field whose key has an explicit registerEntity() remap (a
// literal 4-arg call, not the cell-voltage/cell-resistance loop, which only ever
// remaps to itself), the claimed esphome_read_entity_id must equal the REAL
// legacyObjectId that call registers -- the same ground truth jk_bms.js's own
// diagnosticObjectId()/entityByWireId resolution actually runs on, not the YAML's
// internal `id:` (a C++ config-reference name, never sent over the wire) and not
// assumed to equal the field's own key.
const callsByKey = new Map(calls.filter((c) => c.legacyObjectId).map((c) => [c.key, c]));
const canonicalFields = canonical.registers.flatMap((r) => r.fields);
let readEntityMismatches = 0;
for (const field of canonicalFields) {
  if (!field.esphome_read_entity_id) continue;
  const call = callsByKey.get(field.key);
  if (!call) continue; // no explicit remap for this key -- nothing to cross-check here
  if (call.legacyObjectId !== field.esphome_read_entity_id) readEntityMismatches += 1;
}
check("every canonical esphome_read_entity_id with a registerEntity() remap matches the REAL wire id it registers",
  readEntityMismatches === 0, `mismatches=${readEntityMismatches}`);

// P1-05 (2026-09-10): cellResistanceKeys[i] is "cell_resistance_${index}"
// (jk_bms.js's own registerEntity() call site and registers.canonical.json's
// field keys already agree on this). Four separate consumers --
// diagnosticUnit(), DIAGNOSTIC_ENTITY_ORDER, diagnosticNumberedSeries(), and
// diagnosticEntityLabel() -- each independently pattern-matched against
// "cell_N_wire_resistance" instead (the WIRE name, a registerEntity()
// legacyObjectId, never a diagnosticObjectId() result), so none of them
// ever fired for a real cell-resistance row: it fell through to alphabetic
// sort (observed live: "Cell resistance 1, 10, 11...16, 2...9") with no
// unit and no Ukrainian label. There is no DOM/jsdom harness in this repo
// to execute these functions directly (see docs/adr/0001-protocol-
// catalog.md's own disclosed browser-E2E gap, P1-09) -- this is a static
// consistency guard on the source, not a behavioral test; the live fix was
// additionally verified once by hand in the Browser pane against
// demo/mock-server.js.
//
// Stage 5 self-audit (2026-09-11): diagnosticUnit()'s hand-typed
// objectId->unit table (the literal this check used to grep for) was
// removed -- PROTOCOL_CATALOG.fieldMeta (generated from
// protocol/registers.canonical.json's own field.key values, which the
// "every canonical esphome_read_entity_id..." check above already proves
// agree with the real wire ids) is now diagnosticUnit()'s first, primary
// lookup, so a wrong key spelling can no longer silently resolve to no
// unit the way the original P1-05 bug did. The guard below moved to check
// the new mechanism -- the generated fieldMeta block itself -- instead of
// grepping for the now-deleted hardcoded branch.
check("PROTOCOL_CATALOG.fieldMeta carries the real key format (cell_resistance_N) with unit mΩ",
  /cell_resistance_1: \{ unit: "m/.test(source) && !source.includes('cell_1_wire_resistance:'));
check("DIAGNOSTIC_ENTITY_ORDER's cell-resistance entries use the real key format (cell_resistance_N)",
  source.includes("`cell_resistance_${index + 1}`") && !source.includes("`cell_${index + 1}_wire_resistance`"));
// Settings/Diagnostics channel-hiding fix (2026-09-17) added a THIRD
// legitimate use of this exact regex pattern -- cellChannelRowIndex(),
// the metadata-driven channel-index extractor the new hiding filter
// uses -- alongside diagnosticNumberedSeries()'s and
// diagnosticEntityLabel()'s own pre-existing two. Count raised 2 -> 3
// accordingly; the negative assertion (never the legacy
// cell_(\d+)_wire_resistance wire-id form) still applies to all of them.
check("diagnosticNumberedSeries()/diagnosticEntityLabel()/cellChannelRowIndex()'s cell-resistance regexes use the real key format (cell_resistance_N)",
  (source.match(/objectId\.match\(\/\^cell_resistance_\(\\d\+\)\$\/\)/g) || []).length === 3 &&
  !source.includes("cell_(\\d+)_wire_resistance"));

// Same bug class, same fix, for the four discrete temperature sensors
// (registerEntity() keys are "temperature_1"/"temperature_2"/"temperature_4"/
// "temperature_5" -- note no "temperature_3", the BMS doesn't expose one --
// not "temperature_sensor_N", which is only ever the WIRE legacyObjectId).
check("DIAGNOSTIC_ENTITY_ORDER's temperature entries use the real key format (temperature_N)",
  source.includes('["temperature_1"], ["temperature_2"], ["temperature_4"], ["temperature_5"]') &&
  !source.includes('["temperature_sensor_1"]'));
check("diagnosticNumberedSeries()/diagnosticEntityLabel()'s temperature regexes use the real key format (temperature_N)",
  (source.match(/objectId\.match\(\/\^temperature_\(\\d\+\)\$\/\)/g) || []).length === 2 &&
  !source.includes("temperature_sensor_(\\d+)"));
// Stage 5 self-audit (2026-09-11): same relocation as the cell-resistance
// check above -- diagnosticUnit()'s hardcoded ["...", "cycle_capacity"]
// branch is gone; the guard now checks that PROTOCOL_CATALOG.fieldMeta
// (built from the registerEntity() key, never the wire id) carries the
// correct key/unit pairing instead.
check("PROTOCOL_CATALOG.fieldMeta uses cycle_capacity (registerEntity() key), not its wire id total_charging_cycle_capacity",
  /cycle_capacity: \{ unit: "Ah"/.test(source) &&
  !source.includes('total_charging_cycle_capacity: {'));

// P1-05 full closure (2026-09-10): every key reachable as a real
// diagnosticObjectId() result (a literal registerEntity() call, excluding
// the numbered-series/special-cased keys diagnosticEntityLabel() already
// handles before ever consulting the dictionary) must have BOTH an en and
// a uk entry in DIAGNOSTIC_ENTITY_LABELS -- a key present in neither falls
// through to the raw humanize fallback, which is only ever correct-looking
// English, never Ukrainian. This is the permanent guard for the whole
// class of "dictionary key doesn't match the real registerEntity() key"
// bugs found this pass (device_model was keyed "manufacturer_device_id",
// runtime was keyed "total_runtime_formatted", device_name was keyed
// "bms_display_name", charge_status_time/charge_phase_time/battery_state_time
// were keyed with a stale "_elapsed"/wire-id suffix, cycle_capacity was
// keyed "total_charging_cycle_capacity", and charging_active/
// discharging_active/balancing_active/13 topology+tx-bookkeeping keys were
// simply missing outright) as well as genuinely new drift going forward.
const labelsBlockStart = source.indexOf("const DIAGNOSTIC_ENTITY_LABELS = {");
const labelsBlockEnd = source.indexOf("\n  };\n", labelsBlockStart);
const labelsBlock = source.slice(labelsBlockStart, labelsBlockEnd);
const enSubStart = labelsBlock.indexOf("en: {");
const ukSubStart = labelsBlock.indexOf("uk: {");
const enKeys = new Set([...labelsBlock.slice(enSubStart, ukSubStart).matchAll(/\b([a-zA-Z0-9_]+):\s*"/g)].map((m) => m[1]));
const ukKeys = new Set([...labelsBlock.slice(ukSubStart).matchAll(/\b([a-zA-Z0-9_]+):\s*"/g)].map((m) => m[1]));
const NUMBERED_OR_SPECIAL_CASED = /^(cell_voltage_\d+|cell_resistance_\d+|temperature_\d+)$/;
const SPECIAL_SELECT = new Set(["charging", "discharging", "balancing"]);
const SPECIAL_BINARY = new Set(["charging", "discharging"]);
function dictionaryGaps(keys) {
  return calls.filter(({ key, domain, legacyObjectId }) => {
    if (!legacyObjectId) return false; // skip the loop-generated cell-voltage/resistance rows already covered above
    if (NUMBERED_OR_SPECIAL_CASED.test(key)) return false;
    if (domain === "select" && SPECIAL_SELECT.has(key)) return false;
    if (domain === "binary_sensor" && SPECIAL_BINARY.has(key)) return false;
    return !keys.has(key);
  });
}
const enGaps = dictionaryGaps(enKeys);
const ukGaps = dictionaryGaps(ukKeys);
check("every reachable registerEntity() key has an EN DIAGNOSTIC_ENTITY_LABELS entry",
  enGaps.length === 0, `missing=${enGaps.map((g) => g.key).join(",")}`);
check("every reachable registerEntity() key has a UK DIAGNOSTIC_ENTITY_LABELS entry",
  ukGaps.length === 0, `missing=${ukGaps.map((g) => g.key).join(",")}`);

console.log(`\n${checks} checks run, ${failures} failed.`);
process.exit(failures ? 1 : 0);
