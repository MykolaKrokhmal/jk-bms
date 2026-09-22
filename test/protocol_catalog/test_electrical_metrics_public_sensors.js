#!/usr/bin/env node
"use strict";

// GENERATED-ARTIFACTS TEST -- Settings read-value fix (2026-09-22), §4A.
// Proves, against the REAL committed files (never a reimplementation):
//   - total_voltage_raw/current_raw public sensor declarations exist
//     exactly once each, with the exact spec (id/name/unit/precision/
//     update_interval: never, sourced from the SAME globals as
//     total_voltage/current);
//   - the 0x1290 production decode callback (generated, not hand-typed)
//     updates both new sensors, in the SAME atomic fan-out as the 7
//     pre-existing downstream entities -- none of those 7 calls removed
//     or altered;
//   - no additional read block, command, cadence, retry, or address was
//     added anywhere in this migration: the 0x1290 block's own
//     registerCount/payloadBytes/cadenceMs stay exactly what they were,
//     and the total block count in read_plan.json is unchanged.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
let checks = 0;
let failures = 0;
function check(name, pass, detail = "") {
  checks += 1;
  if (!pass) failures += 1;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` -- ${detail}` : ""}`);
}

// ---------------------------------------------------------------------------
// Determinism: the real generator, re-run, is byte-identical.
// ---------------------------------------------------------------------------
const genPath = path.join(ROOT, "tools", "protocol", "generate_read_plan.js");
const readPlanYamlPath = path.join(ROOT, "protocol", "generated", "read_plan.yaml");
const readPlanJsonPath = path.join(ROOT, "protocol", "generated", "read_plan.json");
const readPlanDecodePath = path.join(ROOT, "protocol", "generated", "read_plan_decode.h");

const before = {
  yaml: fs.readFileSync(readPlanYamlPath, "utf8"),
  json: fs.readFileSync(readPlanJsonPath, "utf8"),
  decode: fs.readFileSync(readPlanDecodePath, "utf8"),
};
execFileSync(process.execPath, [genPath], { cwd: ROOT });
const after = {
  yaml: fs.readFileSync(readPlanYamlPath, "utf8"),
  json: fs.readFileSync(readPlanJsonPath, "utf8"),
  decode: fs.readFileSync(readPlanDecodePath, "utf8"),
};
check("regenerating generate_read_plan.js is byte-identical to the committed artifacts (deterministic)",
  before.yaml === after.yaml && before.json === after.json && before.decode === after.decode);

let checkExit = 0;
try { execFileSync(process.execPath, [genPath, "--check"], { cwd: ROOT }); } catch (e) { checkExit = e.status; }
check("generate_read_plan.js --check reports no drift (exit 0)", checkExit === 0);

// ---------------------------------------------------------------------------
// batterylifepo4.yaml: the two new hand-authored public sensors.
// ---------------------------------------------------------------------------
const yamlSrc = fs.readFileSync(path.join(ROOT, "batterylifepo4.yaml"), "utf8");

function countOccurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}
check("id: total_voltage_raw declared exactly once in batterylifepo4.yaml", countOccurrences(yamlSrc, "id: total_voltage_raw") === 1);
check("id: current_raw declared exactly once in batterylifepo4.yaml", countOccurrences(yamlSrc, "id: current_raw") === 1);

function extractBlock(src, idLine) {
  const idx = src.indexOf(idLine);
  if (idx === -1) return null;
  // Walk back to the start of this list item ("  - platform: template").
  const itemStart = src.lastIndexOf("  - platform: template", idx);
  // Walk forward to the next blank line (end of this YAML list item).
  const blankIdx = src.indexOf("\n\n", idx);
  return src.slice(itemStart, blankIdx === -1 ? undefined : blankIdx);
}

const totalVoltageRawBlock = extractBlock(yamlSrc, "id: total_voltage_raw");
check("total_voltage_raw block exists and is well-formed", !!totalVoltageRawBlock);
if (totalVoltageRawBlock) {
  check("total_voltage_raw: name is exactly \"total voltage raw\"", /name:\s*"total voltage raw"/.test(totalVoltageRawBlock));
  check("total_voltage_raw: unit_of_measurement is exactly \"V\"", /unit_of_measurement:\s*"V"/.test(totalVoltageRawBlock));
  check("total_voltage_raw: accuracy_decimals is 3", /accuracy_decimals:\s*3\b/.test(totalVoltageRawBlock));
  check("total_voltage_raw: update_interval is never", /update_interval:\s*never/.test(totalVoltageRawBlock));
  check("total_voltage_raw: lambda publishes the SAME global as total_voltage (g_total_voltage_v)", /lambda:\s*return id\(g_total_voltage_v\);/.test(totalVoltageRawBlock));
}

const currentRawBlock = extractBlock(yamlSrc, "id: current_raw");
check("current_raw block exists and is well-formed", !!currentRawBlock);
if (currentRawBlock) {
  check("current_raw: name is exactly \"current raw\"", /name:\s*"current raw"/.test(currentRawBlock));
  check("current_raw: unit_of_measurement is exactly \"A\"", /unit_of_measurement:\s*"A"/.test(currentRawBlock));
  check("current_raw: accuracy_decimals is 3", /accuracy_decimals:\s*3\b/.test(currentRawBlock));
  check("current_raw: update_interval is never", /update_interval:\s*never/.test(currentRawBlock));
  check("current_raw: lambda publishes the SAME global as current (g_current_a)", /lambda:\s*return id\(g_current_a\);/.test(currentRawBlock));
}

// Pre-existing entities untouched: total_voltage/current still exist and
// still publish the same globals as before.
check("total_voltage still declared exactly once, still publishes g_total_voltage_v",
  countOccurrences(yamlSrc, "id: total_voltage\n") === 1 && /id: total_voltage\n\s*name: "total voltage"[\s\S]{0,200}?lambda:\s*return id\(g_total_voltage_v\);/.test(yamlSrc));
check("current still declared exactly once, still publishes g_current_a",
  countOccurrences(yamlSrc, "id: current\n") === 1 && /id: current\n\s*name: "current"[\s\S]{0,200}?lambda:\s*return id\(g_current_a\);/.test(yamlSrc));

// ---------------------------------------------------------------------------
// Generated 0x1290 decode callback: extend, not replace.
// ---------------------------------------------------------------------------
const readPlanYaml = fs.readFileSync(readPlanYamlPath, "utf8");
const caseIdx = readPlanYaml.indexOf("case 44: {  // 0x1290");
check("the 0x1290 generated decode callback (case 44) exists", caseIdx !== -1);
const caseEnd = readPlanYaml.indexOf("break;", caseIdx);
const caseBody = readPlanYaml.slice(caseIdx, caseEnd);

const EXISTING_SEVEN = [
  "id(total_voltage)->update();",
  "id(current)->update();",
  "id(power)->update();",
  "id(charging_power)->update();",
  "id(discharging_power)->update();",
  "id(charging_current)->update();",
  "id(discharging_current)->update();",
];
check("all 7 pre-existing electrical-metric ->update() calls are still present in the same callback",
  EXISTING_SEVEN.every((line) => caseBody.includes(line)), JSON.stringify(EXISTING_SEVEN.filter((l) => !caseBody.includes(l))));
check("the 2 new ->update() calls are present in the SAME callback",
  caseBody.includes("id(total_voltage_raw)->update();") && caseBody.includes("id(current_raw)->update();"));
check("exactly 9 ->update() calls total in this callback (7 existing + 2 new, no extra)",
  (caseBody.match(/->update\(\);/g) || []).length === 9, JSON.stringify(caseBody.match(/->update\(\);/g)));
check("the decode math call itself is unchanged (decode_electrical_metrics, one call)",
  (caseBody.match(/decode_electrical_metrics\(raw\)/g) || []).length === 1);

// ---------------------------------------------------------------------------
// No new read block, command, cadence, retry, or address: the 0x1290
// block's own registerCount/payloadBytes/cadenceMs are byte-for-byte
// unchanged, and read_plan.json's total block count is unchanged.
// ---------------------------------------------------------------------------
const readPlanDoc = JSON.parse(fs.readFileSync(readPlanJsonPath, "utf8"));
const block1290 = readPlanDoc.blocks.find((b) => b.address === "0x1290");
check("0x1290 block still exists exactly once", !!block1290);
if (block1290) {
  check("0x1290 register_count unchanged at 12 (no new read added)", block1290.register_count === 12, String(block1290.register_count));
  check("0x1290 payload_bytes unchanged at 12", block1290.payload_bytes === 12, String(block1290.payload_bytes));
  check("0x1290 cadence_ms unchanged at 15000 (telemetry_15s)", block1290.cadence_ms === 15000, String(block1290.cadence_ms));
  check("0x1290 strict_length policy unchanged (false, the hardware-pending floor-validation fix stays in force)", block1290.strict_length === false, String(block1290.strict_length));
  check("0x1290 block still covers exactly the 2 canonical keys (total_voltage_raw, current_raw) -- no new canonical field added to this block",
    Array.isArray(block1290.covers_keys) && block1290.covers_keys.length === 2 &&
    ["total_voltage_raw", "current_raw"].every((k) => block1290.covers_keys.includes(k)));
}
check("total block count in read_plan.json is unchanged at 103 (no new block added anywhere)",
  readPlanDoc.blocks.length === 103, String(readPlanDoc.blocks.length));

console.log(`\nelectrical-metrics public-sensor generated-artifacts summary: ${checks - failures}/${checks} passed`);
process.exit(failures ? 1 : 0);
