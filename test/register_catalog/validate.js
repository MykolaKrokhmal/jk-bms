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

const yamlSrc = fs.readFileSync(path.join(ROOT, "batterylifepo4.yaml"), "utf8");
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

for (const prefix of ["cell_voltage_", "cell_resistance_"]) {
  const rows = allFields
    .filter((x) => x.field.key.startsWith(prefix))
    .sort((a, b) => a.field.ui_order - b.field.ui_order);
  let naturalOrder = true;
  rows.forEach((x, i) => {
    const expectedIndex = i + 1;
    if (!x.field.key.endsWith(`_${expectedIndex}`)) naturalOrder = false;
  });
  check(`"${prefix}*" fields sort into natural 01..N order by ui_order`, naturalOrder && rows.length === 16,
    `count=${rows.length}`);
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
  "Ω": { uk: "Ом", en: "Ω" }, "mΩ": { uk: "мОм", en: "mΩ" }, "µs": { uk: "мкс", en: "µs" },
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

console.log(`\n${checks} checks run, ${failures} failed.`);
process.exit(failures ? 1 : 0);
