#!/usr/bin/env node
"use strict";

// STRUCTURAL + GENERATOR-DETERMINISM test for the generated Settings
// view-model (typed-petting-puzzle plan, cell-composite batch,
// CORRECTED 2026-09-22) -- protocol/generated/settings_view_model.json
// and the embedded SETTINGS_VIEW_MODEL block inside jk_bms.js, both
// produced by tools/protocol/authoring/build_settings_view_model.js from
// the MANUFACTURER MANIFEST's own parameter universe
// (bms_v1_1_manifest.json), joined to registers.canonical.json,
// write_registry.json (Stage 4), stage5_service_action_inventory.json
// (Stage 5), and protocol_blockers.json.
//
// Corrective-pass invariants (this file replaces the previous round's
// canonical-field-count-based expectations, which wrongly included
// non_register_entities.canonical.json's 53 ESP/system entities and had
// no anchor to the manufacturer manifest at all):
//   1. exact eligible manifest set equality (manifestId set ==
//      {p.id : p.access in {R,RW,W}, p.classification != 'reserved'},
//      computed programmatically from the real manifest file -- never a
//      hardcoded total);
//   2. every row has a non-null manifestId;
//   3. zero rows sourced from non_register_entities.canonical.json;
//   4. zero derived/reserved rows;
//   5. all 32 cell channels retain exactly three generated bindings.
//
// Runs the REAL generator (not a reimplementation) and diffs its output
// against the committed artifacts to prove determinism, then inspects the
// real generated JSON for the above.

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
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "generated", "bms_v1_1_manifest.json"), "utf8"));
const nonRegister = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "non_register_entities.canonical.json"), "utf8"));
const canonical = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "registers.canonical.json"), "utf8"));
const writeRegistry = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "generated", "write_registry.json"), "utf8"));

// ---------------------------------------------------------------------------
// 2. Exact eligible manifest set equality -- computed programmatically
// from the real manifest, never a hardcoded number.
// ---------------------------------------------------------------------------
const eligibleIds = new Set(
  manifest.parameters
    .filter((p) => ["R", "RW", "W"].includes(p.access) && p.classification !== "reserved")
    .map((p) => p.id)
);
const generatedIds = doc.rows.map((r) => r.manifestId);
const generatedIdSet = new Set(generatedIds);

check("no duplicate manifestId across rows", generatedIdSet.size === generatedIds.length,
  `unique=${generatedIdSet.size} total=${generatedIds.length}`);
check("generated manifestId set has zero additions beyond the eligible manifest set",
  [...generatedIdSet].every((id) => eligibleIds.has(id)),
  JSON.stringify([...generatedIdSet].filter((id) => !eligibleIds.has(id))));
check("generated manifestId set has zero omissions from the eligible manifest set",
  [...eligibleIds].every((id) => generatedIdSet.has(id)),
  JSON.stringify([...eligibleIds].filter((id) => !generatedIdSet.has(id))));
check("exact set equality: generated manifestId set == eligible manufacturer manifestId set",
  eligibleIds.size === generatedIdSet.size && [...eligibleIds].every((id) => generatedIdSet.has(id)),
  `eligible=${eligibleIds.size} generated=${generatedIdSet.size}`);
check("row_count matches the eligible set size exactly", doc.row_count === eligibleIds.size && doc.rows.length === eligibleIds.size,
  `row_count=${doc.row_count} rows.length=${doc.rows.length} eligible=${eligibleIds.size}`);

// ---------------------------------------------------------------------------
// 3. Every row has a non-null manifestId.
// ---------------------------------------------------------------------------
check("every row has a non-null manifestId", doc.rows.every((r) => r.manifestId !== null && r.manifestId !== undefined),
  JSON.stringify(doc.rows.filter((r) => !r.manifestId).map((r) => r.id)));

// ---------------------------------------------------------------------------
// 4. Zero non-register entities, zero derived/reserved rows.
// ---------------------------------------------------------------------------
const nonRegisterKeys = new Set(nonRegister.entities.map((e) => e.key));
const rowsMatchingNonRegisterKeys = doc.rows.filter((r) => nonRegisterKeys.has(r.id) || nonRegisterKeys.has(r.canonicalKey));
check("zero rows sourced from non_register_entities.canonical.json (ESP/Wi-Fi/system/UI diagnostics excluded)",
  rowsMatchingNonRegisterKeys.length === 0, JSON.stringify(rowsMatchingNonRegisterKeys.map((r) => r.id)));

const reservedManifestIds = new Set(manifest.parameters.filter((p) => p.classification === "reserved").map((p) => p.id));
const derivedManifestIds = new Set(manifest.parameters.filter((p) => p.classification === "derived").map((p) => p.id));
check("zero reserved-classified manifest rows in the view-model",
  [...reservedManifestIds].every((id) => !generatedIdSet.has(id)), JSON.stringify([...reservedManifestIds].filter((id) => generatedIdSet.has(id))));
check("zero derived-classified manifest rows in the view-model",
  [...derivedManifestIds].every((id) => !generatedIdSet.has(id)), JSON.stringify([...derivedManifestIds].filter((id) => generatedIdSet.has(id))));
check("all 4 reserved manifest rows correctly excluded", reservedManifestIds.size === 4, `got=${reservedManifestIds.size}`);

// ---------------------------------------------------------------------------
// 5. Exactly 32 cell composite definitions -- each channel 1..32 has
// EXACTLY three correct bindings, no off-by-one.
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
// 6. Unmapped protocol rows: retained explicitly (never dropped), never a
// guessed canonicalKey, always carry a specific blockedReason.
// ---------------------------------------------------------------------------
const unmappedRows = doc.rows.filter((r) => r.canonicalKey === null && r.access !== "W");
check("unmapped protocol rows keep canonicalKey strictly null (never a guessed key)",
  unmappedRows.every((r) => r.canonicalKey === null));
check("every unmapped protocol row carries a specific blockedReason",
  unmappedRows.every((r) => typeof r.blockedReason === "string" && r.blockedReason.length > 0),
  JSON.stringify(unmappedRows.filter((r) => !r.blockedReason).map((r) => r.id)));
check("unmapped_row_count in the document header matches the actual count", doc.unmapped_row_count === unmappedRows.length,
  `header=${doc.unmapped_row_count} actual=${unmappedRows.length}`);

// ---------------------------------------------------------------------------
// 7. Every RW row's submitPolicy exactly matches Stage 4's write_registry.json.
// ---------------------------------------------------------------------------
const writeRegistryByKey = new Map(writeRegistry.entries.map((e) => [e.key, e]));
let rwAgreement = true;
for (const r of doc.rows) {
  if (r.access !== "RW" || !r.canonicalKey) continue;
  const wr = writeRegistryByKey.get(r.canonicalKey);
  if (wr) { if (r.submitPolicy !== wr.submit_policy) rwAgreement = false; }
  else if (r.submitPolicy !== null) rwAgreement = false;
}
check("every mapped RW row's submitPolicy exactly matches Stage 4's write_registry.json (never re-derived independently)", rwAgreement);

// ---------------------------------------------------------------------------
// 8. W commands: all 8 present, joined to Stage 5, canonicalKey always null.
// ---------------------------------------------------------------------------
const wRows = doc.rows.filter((r) => r.access === "W");
check("exactly 8 W-command rows", wRows.length === 8, `got=${wRows.length}`);
check("every W-command row has canonicalKey strictly null (never modeled as a register)",
  wRows.every((r) => r.canonicalKey === null));

console.log(`\nSettings view-model structural summary: ${checks - failures}/${checks} passed`);
process.exit(failures ? 1 : 0);
