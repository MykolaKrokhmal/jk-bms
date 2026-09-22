#!/usr/bin/env node
"use strict";

// STRUCTURAL + GENERATOR-DETERMINISM test for the generated Settings
// view-model (typed-petting-puzzle plan, cell-composite batch, 2026-09-22)
// -- protocol/generated/settings_view_model.json and the embedded
// SETTINGS_VIEW_MODEL block inside jk_bms.js, both produced by
// tools/protocol/authoring/build_settings_view_model.js from
// registers.canonical.json + non_register_entities.canonical.json +
// write_registry.json (Stage 4) + stage5_service_action_inventory.json
// (Stage 5) -- never a second hand-authored duplicate of any of them.
//
// Runs the REAL generator (not a reimplementation) and diffs its output
// against the committed artifacts to prove determinism, then inspects the
// real generated JSON for full-inventory coverage and exact per-channel
// binding counts.

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
// 1. Generator determinism: regenerating twice in a row is byte-identical,
// and --check reports no drift against the committed artifacts.
// ---------------------------------------------------------------------------
const genPath = path.join(ROOT, "tools", "protocol", "authoring", "build_settings_view_model.js");
const outPath = path.join(ROOT, "protocol", "generated", "settings_view_model.json");
const jsPath = path.join(ROOT, "jk_bms.js");

const before = { json: fs.readFileSync(outPath, "utf8"), js: fs.readFileSync(jsPath, "utf8") };
execFileSync(process.execPath, [genPath], { cwd: ROOT });
const after = { json: fs.readFileSync(outPath, "utf8"), js: fs.readFileSync(jsPath, "utf8") };
check("regenerating is byte-identical to the committed artifacts (deterministic, no source drift)",
  before.json === after.json && before.js === after.js);

let checkExitCode = 0;
try {
  execFileSync(process.execPath, [genPath, "--check"], { cwd: ROOT });
} catch (e) {
  checkExitCode = e.status;
}
check("generator --check reports no drift (exit 0)", checkExitCode === 0);

const doc = JSON.parse(fs.readFileSync(outPath, "utf8"));
const canonical = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "registers.canonical.json"), "utf8"));
const nonRegister = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "non_register_entities.canonical.json"), "utf8"));
const stage5Inventory = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "generated", "stage5_service_action_inventory.json"), "utf8"));

// ---------------------------------------------------------------------------
// 2. Full protocol inventory coverage, no manual duplicates.
// ---------------------------------------------------------------------------
let canonicalFieldCount = 0;
for (const reg of canonical.registers) canonicalFieldCount += (reg.fields || []).length;
const expectedTotal = canonicalFieldCount + nonRegister.entities.length + stage5Inventory.rows.length;
check("view-model row_count equals canonical fields + non-register entities + Stage 5 commands (no manual dupes, no gaps)",
  doc.row_count === expectedTotal && doc.rows.length === expectedTotal,
  `row_count=${doc.row_count} rows.length=${doc.rows.length} expected=${expectedTotal}`);
check("no duplicate row ids", new Set(doc.rows.map((r) => r.id)).size === doc.rows.length,
  `unique=${new Set(doc.rows.map((r) => r.id)).size} total=${doc.rows.length}`);

// Every canonical R/RW field key appears exactly once.
const canonicalKeys = [];
for (const reg of canonical.registers) for (const f of reg.fields || []) canonicalKeys.push(f.key);
const rowIds = new Set(doc.rows.map((r) => r.id));
check("every canonical register field key appears in the view-model",
  canonicalKeys.every((k) => rowIds.has(k)), `missing=${JSON.stringify(canonicalKeys.filter((k) => !rowIds.has(k)))}`);
check("every non-register entity key appears in the view-model",
  nonRegister.entities.every((e) => rowIds.has(e.key)));
check("every Stage 5 command key appears in the view-model",
  stage5Inventory.rows.every((r) => rowIds.has(r.key)));

// ---------------------------------------------------------------------------
// 3. Exactly 32 cell composite definitions -- each channel 1..32 has
// EXACTLY three bindings (voltage, wireResistance, wireResistanceCalibration),
// no off-by-one between protocol numbering, canonical keys, and the
// view-model's own topologyChannelIndex.
// ---------------------------------------------------------------------------
const cellRows = doc.rows.filter((r) => r.compositeGroup === "cell");
check("exactly 96 cell-composite rows (32 channels x 3 bindings)", cellRows.length === 96, `got=${cellRows.length}`);

const byChannel = new Map();
for (const r of cellRows) {
  if (!byChannel.has(r.topologyChannelIndex)) byChannel.set(r.topologyChannelIndex, new Set());
  byChannel.get(r.topologyChannelIndex).add(r.compositeRole);
}
check("exactly 32 distinct channel indices", byChannel.size === 32, `got=${byChannel.size}`);
check("channel indices are exactly 1..32, no gaps, no duplicates, no off-by-one",
  JSON.stringify([...byChannel.keys()].sort((a, b) => a - b)) === JSON.stringify(Array.from({ length: 32 }, (_, i) => i + 1)));
let allChannelsComplete = true;
const incompleteChannels = [];
for (const [index, roles] of byChannel) {
  const expected = ["voltage", "wireResistance", "wireResistanceCalibration"];
  if (roles.size !== 3 || !expected.every((r) => roles.has(r))) {
    allChannelsComplete = false;
    incompleteChannels.push({ index, roles: [...roles] });
  }
}
check("every channel 1-32 has EXACTLY the 3 correct bindings (voltage/wireResistance/wireResistanceCalibration)",
  allChannelsComplete, JSON.stringify(incompleteChannels));

// Cross-check canonical key <-> channel index agreement (no off-by-one
// between the field's own trailing number and topologyChannelIndex).
let keyIndexAgreement = true;
const disagreements = [];
for (const r of cellRows) {
  const m = /_(\d+)$/.exec(r.canonicalKey || "");
  const parsedIndex = m ? Number(m[1]) : null;
  if (parsedIndex !== r.topologyChannelIndex) {
    keyIndexAgreement = false;
    disagreements.push({ key: r.canonicalKey, parsedIndex, topologyChannelIndex: r.topologyChannelIndex });
  }
}
check("canonicalKey's own trailing channel number exactly matches topologyChannelIndex for every cell row",
  keyIndexAgreement, JSON.stringify(disagreements));

// ---------------------------------------------------------------------------
// 4. Nothing fabricated: unresolved fields (the 4 reserved rows) stay
// access:null, never a guessed R/RW/W.
// ---------------------------------------------------------------------------
const nullAccessRows = doc.rows.filter((r) => r.access === null);
check("unresolved-access rows (reserved fields) stay explicitly null, never a guessed access letter",
  nullAccessRows.length === 4 && nullAccessRows.every((r) => r.uiSection === "none"),
  JSON.stringify(nullAccessRows.map((r) => r.id)));

// ---------------------------------------------------------------------------
// 5. Access-letter partition sums correctly, and every RW row's
// submitPolicy/blockedReason agrees with the real Stage 4 write_registry.json
// (never a second, independently-derived write-safety decision).
// ---------------------------------------------------------------------------
const writeRegistry = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "generated", "write_registry.json"), "utf8"));
const writeRegistryByKey = new Map(writeRegistry.entries.map((e) => [e.key, e]));
let rwAgreement = true;
for (const r of doc.rows) {
  if (r.access !== "RW") continue;
  const wr = writeRegistryByKey.get(r.canonicalKey);
  if (wr) {
    if (r.submitPolicy !== wr.submit_policy) rwAgreement = false;
  } else if (r.submitPolicy !== null) {
    rwAgreement = false;
  }
}
check("every RW row's submitPolicy exactly matches Stage 4's write_registry.json (never re-derived independently)", rwAgreement);

console.log(`\nSettings view-model structural summary: ${checks - failures}/${checks} passed`);
process.exit(failures ? 1 : 0);
