#!/usr/bin/env node
/*
 * Strict protocol-catalog validator (Stage 1, IMPLEMENTATION_ROADMAP.md,
 * spec section 10). REPLACES the old string/regex-only coverage checker —
 * the schema (protocol/schema/*.schema.json, checked via the dependency-free
 * engine in tools/protocol/lib/mini-schema.js) and the semantic invariants
 * (tools/protocol/lib/semantic-checks.js — duplicate keys/addresses,
 * overlapping masks, asymmetric packed siblings, signedness/wire-type
 * mismatch, and the core Stage-1 rule that an unverified/conflicting field
 * can never carry effective write access) now do the structural proving
 * that the old regex-substring checks only approximated.
 *
 * This file adds the checks that need actual cross-file, location-aware
 * comparison rather than schema/semantic self-consistency:
 *   - generated artifacts are not stale (delegates to `generate.js --check`)
 *   - batterylifepo4.yaml / jk_bms.js / demo/mock-server.js actually agree
 *     with the canonical source on every RW register's address and entity id
 *   - UI ordering invariants (natural 01..N cell order, no duplicate
 *     ui_order within Settings)
 *   - canonical/display unit glossary consistency
 *   - the two concrete unit-drift regressions this Stage fixed (scp_delay
 *     µs, rcv_time/rfv_time hours) stay fixed
 *   - full YAML BMS-entity coverage: every modbus_controller `address:` in
 *     batterylifepo4.yaml maps to a catalog register or is not a Settings
 *     RW/R field the catalog is required to track (documented as such)
 *
 * Run: node test/register_catalog/validate.js
 * Exit code 0 = every check passed. Non-zero = at least one failed.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const mini = require("../../tools/protocol/lib/mini-schema.js");
const semantic = require("../../tools/protocol/lib/semantic-checks.js");

const ROOT = path.join(__dirname, "..", "..");
const registerDoc = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "registers.canonical.json"), "utf8"));
const nonRegisterDoc = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "non_register_entities.canonical.json"), "utf8"));
const registerSchema = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "schema", "register-source.schema.json"), "utf8"));
const nonRegisterSchema = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "schema", "non-register-source.schema.json"), "utf8"));
const evidenceSources = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "evidence", "sources.json"), "utf8"));
const evidenceSourcesSchema = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "schema", "evidence-sources.schema.json"), "utf8"));

// Final-preparation-plan Stage 1, commit boundary 3: register addresses for
// the 83 blocks migrated onto the generated scheduler no longer appear as
// `address:` properties in batterylifepo4.yaml itself -- they live in the
// generated package it now !include's (protocol/generated/read_plan.yaml,
// whose own servicer emits one `// 0xNNNN` comment per block) and in the
// generated decode table (read_plan_decode.h's own kBlocks literals). yamlSrc
// is the union of all three, so every check below still holds without
// needing to know WHICH file a given address now lives in.
const batterylifepo4Src = fs.readFileSync(path.join(ROOT, "batterylifepo4.yaml"), "utf8");
const yamlSrc = batterylifepo4Src
  + fs.readFileSync(path.join(ROOT, "protocol", "generated", "read_plan.yaml"), "utf8")
  + fs.readFileSync(path.join(ROOT, "protocol", "generated", "read_plan_decode.h"), "utf8");
const jsSrc = fs.readFileSync(path.join(ROOT, "jk_bms.js"), "utf8");
const mockSrc = fs.readFileSync(path.join(ROOT, "demo", "mock-server.js"), "utf8");
const catalogSrc = fs.readFileSync(path.join(ROOT, "register_catalog.json"), "utf8");

let failures = 0;
let checks = 0;
function check(name, cond, detail) {
  checks += 1;
  if (!cond) {
    failures += 1;
    console.log(`FAIL  ${name}${detail ? "  -- " + detail : ""}`);
  } else {
    console.log(`PASS  ${name}${detail ? "  -- " + detail : ""}`);
  }
}

// ===========================================================================
// 1. Schema validation
// ===========================================================================
const schemaErrors = mini.validate(registerSchema, registerDoc);
check("protocol/registers.canonical.json matches register-source.schema.json", schemaErrors.length === 0,
  schemaErrors.slice(0, 3).map((e) => `${e.path}: ${e.message}`).join(" | "));

const nrSchemaErrors = mini.validate(nonRegisterSchema, nonRegisterDoc);
check("protocol/non_register_entities.canonical.json matches non-register-source.schema.json", nrSchemaErrors.length === 0,
  nrSchemaErrors.slice(0, 3).map((e) => `${e.path}: ${e.message}`).join(" | "));

const sourceSchemaErrors = mini.validate(evidenceSourcesSchema, evidenceSources);
check("protocol/evidence/sources.json matches evidence-sources.schema.json", sourceSchemaErrors.length === 0,
  sourceSchemaErrors.slice(0, 3).map((e) => `${e.path}: ${e.message}`).join(" | "));

// ===========================================================================
// 2. Semantic invariants
// ===========================================================================
const semanticErrors = semantic.check(registerDoc, nonRegisterDoc, ROOT);
check("canonical source has no semantic invariant violations", semanticErrors.length === 0,
  semanticErrors.slice(0, 5).map((e) => `${e.code} ${e.path}: ${e.message}`).join(" | "));

// ===========================================================================
// 3. Generated artifacts are not stale
// ===========================================================================
let generateCheckOk = false;
let generateCheckOutput = "";
try {
  generateCheckOutput = execFileSync(process.execPath, [path.join(ROOT, "tools", "protocol", "generate.js"), "--check"], {
    cwd: ROOT, encoding: "utf8",
  });
  generateCheckOk = true;
} catch (e) {
  generateCheckOutput = (e.stdout || "") + (e.stderr || "");
}
check("generated artifacts (register_catalog.json, protocol/generated/*, jk_bms.js block) match canonical source",
  generateCheckOk, generateCheckOk ? "" : generateCheckOutput.trim().split("\n").slice(0, 5).join(" | "));

// ===========================================================================
// Flatten catalog
// ===========================================================================
const allFields = [];
for (const reg of registerDoc.registers) for (const f of reg.fields) allFields.push({ field: f, register: reg });

// ===========================================================================
// 4. Cross-file address/entity-id checks (implementation evidence)
// ===========================================================================
for (const { field: f, register: r } of allFields) {
  // source_only_unimplemented / intentionally_not_exposed fields are, BY
  // DEFINITION, not read by batterylifepo4.yaml at all (Крок E.3) — this
  // cross-file check only applies to fields this project actually implements.
  if (!["implemented", "partially_implemented"].includes(f.implementation_status)) continue;
  const inYaml = yamlSrc.includes(r.address);
  check(`yaml: register ${r.address} ("${f.key}") appears in batterylifepo4.yaml`, inYaml, r.address);

  if (f.access === "rw" && f.esphome_write_entity_id) {
    const idPattern = `id: ${f.esphome_write_entity_id}`;
    const inYamlAsId = yamlSrc.includes(idPattern);
    // bespoke-managed RW fields (cell_count, setup_passcode) use their own
    // hand-written write path, not the generic `set_<key>` template-number
    // convention checked here — only "generic" fields are held to it.
    if (f.write_safety_class !== "topology" && f.write_safety_class !== "credential") {
      check(`yaml: writable field "${f.key}" has an ESPHome entity "${idPattern}"`, inYamlAsId, r.address);
    }
  }
}

// GENERIC_TX_ADDRESS cross-check (parse the generated block, not eval it —
// same rationale as before: plain hex-literal object data, no expressions).
function extractObjectLiteral(src, marker) {
  const start = src.indexOf(marker);
  if (start === -1) return null;
  const braceStart = src.indexOf("{", start);
  let depth = 0;
  let end = -1;
  for (let i = braceStart; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") { depth -= 1; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) return null;
  return src.slice(braceStart + 1, end);
}

const genericTxLiteral = extractObjectLiteral(jsSrc, "genericTxAddress: Object.freeze({");
check("jk_bms.js: generated genericTxAddress block is present and well-formed", genericTxLiteral !== null);
if (genericTxLiteral !== null) {
  const jsGenericTx = {};
  const entryPattern = /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(0x[0-9A-Fa-f]+)/g;
  let m;
  while ((m = entryPattern.exec(genericTxLiteral)) !== null) jsGenericTx[m[1]] = parseInt(m[2], 16);

  const expectedGenericTx = {};
  for (const { field: f, register: r } of allFields) {
    if (f.effective_access !== "rw") continue;
    if (f.write_safety_class === "topology" || f.write_safety_class === "credential") continue;
    if (!f.esphome_write_entity_id) continue;
    expectedGenericTx[f.key] = parseInt(r.address, 16);
  }
  const expectedKeys = Object.keys(expectedGenericTx);
  const actualKeys = Object.keys(jsGenericTx);
  check("jk_bms.js genericTxAddress key set matches the catalog's generic-managed RW fields",
    expectedKeys.length === actualKeys.length && expectedKeys.every((k) => k in jsGenericTx),
    `catalog=${expectedKeys.length} js=${actualKeys.length}`);
  let addrMismatches = 0;
  for (const k of expectedKeys) if (jsGenericTx[k] !== expectedGenericTx[k]) addrMismatches += 1;
  check("jk_bms.js genericTxAddress addresses match the catalog exactly for every shared key", addrMismatches === 0,
    `${addrMismatches} mismatch(es)`);
}

const nonRegLiteralMatch = jsSrc.match(/nonRegisterKeys: Object\.freeze\(\[([\s\S]*?)\]\)/);
check("jk_bms.js: generated nonRegisterKeys block is present and well-formed", Boolean(nonRegLiteralMatch));
if (nonRegLiteralMatch) {
  const jsNonRegKeys = Array.from(nonRegLiteralMatch[1].matchAll(/"([a-zA-Z0-9_]+)"/g)).map((x) => x[1]);
  const catalogNonRegKeys = nonRegisterDoc.entities.map((e) => e.key);
  const jsSet = new Set(jsNonRegKeys);
  const catSet = new Set(catalogNonRegKeys);
  const missingFromJs = catalogNonRegKeys.filter((k) => !jsSet.has(k));
  const extraInJs = jsNonRegKeys.filter((k) => !catSet.has(k));
  check("jk_bms.js nonRegisterKeys is exactly the non-register catalog's key set", missingFromJs.length === 0 && extraInJs.length === 0,
    `missing=${missingFromJs.join(",")} extra=${extraInJs.join(",")}`);
}

// demo/mock-server.js still derives its generic-register map from
// register_catalog.json at require-time.
const mockUsesCatalog = mockSrc.includes("REGISTER_CATALOG") && mockSrc.includes('reg.manager === "generic"');
check("demo/mock-server.js derives its generic-register map from register_catalog.json", mockUsesCatalog);

// ===========================================================================
// 5. UI ordering invariants
// ===========================================================================
const settingsFields = allFields.filter((x) => x.field.ui_section === "settings");
const orderCounts = new Map();
for (const { field: f } of settingsFields) orderCounts.set(f.ui_order, (orderCounts.get(f.ui_order) || 0) + 1);
const dupOrders = Array.from(orderCounts.entries()).filter(([, c]) => c > 1);
check("Settings ui_order has no duplicates", dupOrders.length === 0, dupOrders.map(([o]) => o).join(","));

// Stage 3 cell-channel batch (2026-09-17): protocol capacity is 32
// channels (CellVol0-31/CellWireRes0-31, confirmed against both the
// official PDF and the V2 workbook), not the deployed 16S unit's own
// observed count -- see registers.canonical.json's own cell_count
// safety_notes for the same protocol-capacity-vs-device-capability
// distinction. cell_voltage_1..32 are ALL implemented and UI-visible this
// batch (decoded from the existing 1Hz cell-block buffer, zero new reads).
// cell_resistance_17..32 (Stage 3 bounded batch, 2026-09-17: implemented)
// are now ALSO implemented and UI-visible (ui_section "cells", ui_order
// 1217-1232, matching cell_resistance_1..16's own 1201-1216 convention) --
// read via their own isolated, capability-gated command
// (batterylifepo4.yaml, 0x126A) rather than always-on, see that command's
// own comment for the bounded-probe policy.
for (const [prefix, expectedCount] of [["cell_voltage_", 32], ["cell_resistance_", 32]]) {
  const rows = allFields
    .filter((x) => x.field.key.startsWith(prefix) && x.field.ui_section !== "none")
    .sort((a, b) => a.field.ui_order - b.field.ui_order);
  let naturalOrder = true;
  rows.forEach((x, i) => {
    const expectedIndex = i + 1;
    if (!x.field.key.endsWith(`_${expectedIndex}`)) naturalOrder = false;
  });
  check(`"${prefix}*" UI-visible fields sort into natural 01..N order by ui_order`, naturalOrder && rows.length === expectedCount,
    `count=${rows.length}, expected=${expectedCount}`);
}

// entity id / backend key uniqueness
const writeIds = allFields.map((x) => x.field.esphome_write_entity_id).filter(Boolean);
check("esphome_write_entity_id has no duplicates", new Set(writeIds).size === writeIds.length);
const backendKeys = allFields.map((x) => x.field.backend_key).filter(Boolean);
check("backend_key has no duplicates", new Set(backendKeys).size === backendKeys.length);

// enum_map duplicate-value check
for (const { field: f } of allFields) {
  if (!f.enum_map) continue;
  const values = Object.values(f.enum_map);
  check(`field "${f.key}" enum_map has no duplicate values`, new Set(values).size === values.length);
}

// ===========================================================================
// 6. Unit glossary consistency (canonical_unit -> uk/en display unit)
// ===========================================================================
const UNIT_GLOSSARY = {
  "V": { uk: "В", en: "V" }, "A": { uk: "А", en: "A" }, "Ah": { uk: "А·год", en: "Ah" },
  "Ω": { uk: "Ом", en: "Ω" }, "mΩ": { uk: "мОм", en: "mΩ" }, "µΩ": { uk: "мкОм", en: "µΩ" }, "µs": { uk: "мкс", en: "µs" },
  "s": { uk: "с", en: "s" }, "h": { uk: "год", en: "h" }, "°C": { uk: "°C", en: "°C" },
  "%": { uk: "%", en: "%" }, "W": { uk: "Вт", en: "W" }, "mV": { uk: "мВ", en: "mV" }, "dBm": { uk: "дБм", en: "dBm" },
  "": { uk: "", en: "" }, "raw": { uk: "необроблено", en: "raw" },
};
let unitDrift = 0;
for (const { field: f } of allFields) {
  const g = UNIT_GLOSSARY[f.canonical_unit];
  if (!g) { unitDrift += 1; console.log(`FAIL  unit glossary: field "${f.key}" has unlisted canonical_unit "${f.canonical_unit}"`); continue; }
  if (f.uk_display_unit !== g.uk || f.en_display_unit !== g.en) {
    unitDrift += 1;
    console.log(`FAIL  unit glossary: field "${f.key}" canonical_unit "${f.canonical_unit}" expects uk="${g.uk}" en="${g.en}", got uk="${f.uk_display_unit}" en="${f.en_display_unit}"`);
  }
}
check("every field's uk/en display unit matches its canonical_unit via the fixed glossary", unitDrift === 0, `${unitDrift} drift(s)`);

// ===========================================================================
// 7. Regression tests for the two Stage-1 unit-drift fixes (spec section 8)
// ===========================================================================
const passcodeReg = registerDoc.registers.find((r) => r.address === "0x1470");
check("REGRESSION: setup_passcode register is 128 bits / 8 Modbus words (CODEX_STAGE_1_REVIEW.md P0-1 — was wrongly word_count 2)",
  passcodeReg.register_width_bits === 128 && passcodeReg.word_count === 8);
const deviceModelReg = registerDoc.registers.find((r) => r.address === "0x1400");
check("REGRESSION: device_model register is 128 bits / 8 Modbus words (same class of bug)",
  deviceModelReg.register_width_bits === 128 && deviceModelReg.word_count === 8);

const scpDelay = allFields.find((x) => x.field.key === "scp_delay").field;
check("REGRESSION: scp_delay canonical unit is µs (was incorrectly 's' in the pre-Stage-1 catalog)", scpDelay.canonical_unit === "µs");
const rcvTime = allFields.find((x) => x.field.key === "rcv_time").field;
const rfvTime = allFields.find((x) => x.field.key === "rfv_time").field;
check("REGRESSION: rcv_time canonical unit is h with 0.1 scale (was incorrectly 's' in the pre-Stage-1 catalog)",
  rcvTime.canonical_unit === "h" && rcvTime.scale === 0.1);
check("REGRESSION: rfv_time canonical unit is h with 0.1 scale (was incorrectly 's' in the pre-Stage-1 catalog)",
  rfvTime.canonical_unit === "h" && rfvTime.scale === 0.1);
const resistanceField = allFields.find((x) => x.field.key === "cell_resistance_1").field;
check("REGRESSION: cell_resistance_* canonical unit is mΩ (was incorrectly 'Ω' in ESPHome/UI before Stage 1)",
  resistanceField.canonical_unit === "mΩ");

// ===========================================================================
// 8. device_name_override moved out of the BMS register catalog
// ===========================================================================
const catalogParsed = JSON.parse(catalogSrc);
check("register_catalog.json no longer lists device_name_override (moved to non_register_entities.canonical.json)",
  !catalogParsed.registers.some((r) => r.key === "device_name_override"));
check("non_register_entities.canonical.json lists device_name_override as local_config",
  nonRegisterDoc.entities.some((e) => e.key === "device_name_override" && e.category === "local_config"));

// ===========================================================================
// 9. Full YAML BMS-register coverage — every modbus_controller `address:`
//    line in batterylifepo4.yaml corresponds to a catalog register.
// ===========================================================================
const yamlAddresses = new Set();
{
  const addressLinePattern = /^\s{4}address:\s*(0x[0-9A-Fa-f]{4})\s*$/gm;
  let m;
  while ((m = addressLinePattern.exec(yamlSrc)) !== null) yamlAddresses.add(m[1].toUpperCase());
}
const catalogAddresses = new Set(registerDoc.registers.map((r) => r.address.toUpperCase()));
const uncoveredYamlAddresses = Array.from(yamlAddresses).filter((a) => !catalogAddresses.has(a));
check("every `address: 0xNNNN` modbus_controller declaration in batterylifepo4.yaml has a catalog register",
  uncoveredYamlAddresses.length === 0, uncoveredYamlAddresses.join(", "));

// ===========================================================================
// 10. Stage 1's own hard exit gate (Final-preparation-plan, corrective
//     pass): zero `platform: modbus_controller` READ entities remain in
//     the tracked YAML -- the scheduler (protocol/generated/read_plan.yaml,
//     !include'd) is the SOLE owner of every physical Modbus read.
//     electrical_metrics_scan (0x1290) was the last remaining one; it
//     migrated onto a hand-written custom decoder (jk_poll_scheduler_core.h's
//     decode_electrical_metrics(), see its own golden-vector tests) in this
//     corrective pass. Matches only a real list-item declaration (leading
//     "  - platform: modbus_controller"), never a comment mentioning the
//     string in prose (e.g. a historical "Converted from platform:
//     modbus_controller..." note elsewhere in this file, which is not an
//     active declaration and must not trip this gate).
// ===========================================================================
const modbusControllerDeclarations = (batterylifepo4Src.match(/^\s*-\s*platform:\s*modbus_controller\s*$/gm) || []).length;
check("zero-legacy-polling gate: batterylifepo4.yaml declares no `platform: modbus_controller` read entities",
  modbusControllerDeclarations === 0, `found ${modbusControllerDeclarations}`);

// ===========================================================================
// 11. protocol_blockers.json: schema-valid, and the 0x1504 entry stays
//     consistent with the generated read plan's actual register_count for
//     that address (Final-preparation-plan Stage 1 corrective pass §4:
//     "не вгадуй 0x1504... зафіксуй її як конкретний Stage 1 hardware
//     blocker" — this is the automated guard that a future regeneration
//     can't silently change the register_count out from under the blocker's
//     own recorded evidence_needed/closure_criterion without this failing).
//     CORRECTED 2026-09-20: hardware acceptance (second attempt, post-
//     reflash, HEAD aded697) confirmed register_count=1 on real hardware,
//     closing this blocker per its own closure_criterion — it is no longer
//     open. The register_count consistency check still applies to the
//     closed record (a future regen must still not silently change this
//     value without updating the blocker's own text, even closed).
// ===========================================================================
{
  const blockersSchema = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "schema", "protocol-blockers.schema.json"), "utf8"));
  const blockersDoc = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "evidence", "protocol_blockers.json"), "utf8"));
  const blockerSchemaErrors = mini.validate(blockersSchema, blockersDoc);
  check("protocol_blockers.json is schema-valid", blockerSchemaErrors.length === 0,
    blockerSchemaErrors.map((e) => `${e.path} ${e.message}`).join(" | "));

  const rcvBlocker = blockersDoc.blockers.find((b) => b.address === "0x1504");
  check("the 0x1504 (rcv_time/rfv_time) hardware blocker is present and CLOSED (hardware acceptance 2026-09-20 confirmed register_count=1 on real hardware)",
    !!rcvBlocker && rcvBlocker.status === "closed" && !!rcvBlocker.closed_date);

  const readPlan = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "generated", "read_plan.json"), "utf8"));
  const block1504 = readPlan.blocks.find((b) => b.address === "0x1504");
  check("0x1504 block exists in the generated read plan", !!block1504);
  check("0x1504's generated register_count (1, corrected 2026-09-19, hardware-confirmed 2026-09-20) still matches what the (now closed) blocker's own text describes -- a future regen changing this must update the blocker too",
    !!block1504 && block1504.register_count === 1, block1504 && `register_count=${block1504.register_count}`);

  // 0x1290: two blocker entries at this address (see generate_read_plan.js's
  // CUSTOM_DECODE_BLOCKS comment and Block::strict_length in
  // jk_poll_scheduler_core.h). CORRECTED 2026-09-20 (third hardware-
  // acceptance attempt): the immediate software-defect blocker is now
  // CLOSED -- a subsequent hardware-acceptance session on the fixed
  // firmware build confirmed total_voltage/current read live, non-NA
  // values repeatedly (104/104 over ~27 min) and without regression. A
  // second, narrower, explicitly non-blocking technical-debt entry stays
  // OPEN, tracking the still-unresolved exact FC03 wire response length
  // (register_count 10 vs 12) without gating Stage 3 or any later stage.
  const electricalBlockers = blockersDoc.blockers.filter((b) => b.address === "0x1290");
  check("there are exactly 2 blocker entries at 0x1290 (the closed immediate-defect one + the open non-blocking technical-debt one)",
    electricalBlockers.length === 2, `count=${electricalBlockers.length}`);
  const electricalClosed = electricalBlockers.find((b) => b.status === "closed");
  const electricalOpen = electricalBlockers.find((b) => b.status === "open");
  check("the 0x1290 immediate software-defect blocker is CLOSED (hardware acceptance 2026-09-20 confirmed live, non-NA total_voltage/current on the fixed firmware build)",
    !!electricalClosed && !!electricalClosed.closed_date);
  check("the 0x1290 non-blocking technical-debt entry stays OPEN (exact FC03 response length still hardware-unresolved) and says so explicitly",
    !!electricalOpen && /non-blocking/i.test(electricalOpen.issue));
  const block1290 = readPlan.blocks.find((b) => b.address === "0x1290");
  check("0x1290's generated block has strict_length=false, matching the closed blocker's own description of the floor-check fix",
    !!block1290 && block1290.strict_length === false, block1290 && JSON.stringify(block1290.strict_length));
}

console.log(`\n${checks} checks run, ${failures} failed.`);
process.exit(failures ? 1 : 0);
