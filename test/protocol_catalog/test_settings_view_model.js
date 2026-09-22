#!/usr/bin/env node
"use strict";

// STRUCTURAL + GENERATOR-DETERMINISM test for the generated Settings
// view-model ("finish the Settings architecture" batch, Phase A
// corrective pass, 2026-09-22) -- protocol/generated/settings_view_model.json
// and the embedded SETTINGS_VIEW_MODEL block inside jk_bms.js.
//
// Phase A fixes two real bugs the previous round's generator had:
//   1. `access` (manufacturer-DECLARED access) must never be overwritten
//      by `effectiveAccess` (current canonical/evidence-derived access)
//      -- the two are permanently separate fields on every row now.
//   2. ALL 97 manufacturer RW rows are joined to the COMPLETE Stage 4
//      inventory (stage4_rw_inventory.json), not just write_registry.json's
//      42-row software-ready subset -- the 18 write-hardware-verified
//      rows (a separate, older write mechanism, SETTING_KEYS/SETTING_DEFS)
//      are now correctly represented as live RW rows with their real
//      write path, and the 37 blocked rows keep their RW identity
//      instead of silently downgrading to a plain R row.
//
// Runs the REAL generator (not a reimplementation) and diffs its output
// against the committed artifacts to prove determinism, then inspects the
// real generated JSON.

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
// 1. Generator determinism.
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
try { execFileSync(process.execPath, [genPath, "--check"], { cwd: ROOT }); } catch (e) { checkExitCode = e.status; }
check("generator --check reports no drift (exit 0)", checkExitCode === 0);

const doc = JSON.parse(fs.readFileSync(outPath, "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "generated", "bms_v1_1_manifest.json"), "utf8"));
const nonRegister = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "non_register_entities.canonical.json"), "utf8"));
const stage4Inventory = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "generated", "stage4_rw_inventory.json"), "utf8"));
const writeRegistry = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "generated", "write_registry.json"), "utf8"));

// ---------------------------------------------------------------------------
// 2. Declared-access partition: 155 R / 97 RW / 8 W, computed
// programmatically from the real manifest -- never hardcoded as
// generator behavior (only asserted here, independently, against the
// real source file).
// ---------------------------------------------------------------------------
const eligibleParams = manifest.parameters.filter((p) => ["R", "RW", "W"].includes(p.access) && p.classification !== "reserved");
const expectedByAccess = { R: 0, RW: 0, W: 0 };
for (const p of eligibleParams) expectedByAccess[p.access] += 1;
check("independently computed manifest partition is 155 R / 97 RW / 8 W",
  expectedByAccess.R === 155 && expectedByAccess.RW === 97 && expectedByAccess.W === 8,
  JSON.stringify(expectedByAccess));

const actualByAccess = { R: 0, RW: 0, W: 0 };
for (const r of doc.rows) actualByAccess[r.access] = (actualByAccess[r.access] || 0) + 1;
check("generated declared-access (row.access) partition exactly matches the manifest's own: 155 R / 97 RW / 8 W",
  actualByAccess.R === expectedByAccess.R && actualByAccess.RW === expectedByAccess.RW && actualByAccess.W === expectedByAccess.W,
  JSON.stringify(actualByAccess));
check("row_count == 260", doc.row_count === 260 && doc.rows.length === 260);

// ---------------------------------------------------------------------------
// 3. effectiveAccess is a SEPARATE field, never collapsed into access --
// proven by a real case where they differ (CellCount: RW declared,
// blocked -> effectiveAccess R).
// ---------------------------------------------------------------------------
check("every row has both access and effectiveAccess as distinct top-level fields",
  doc.rows.every((r) => "access" in r && "effectiveAccess" in r));
const cellCountRow = doc.rows.find((r) => r.manifestId === "CellCount");
check("CellCount: access stays RW even though its effectiveAccess is R (a real divergence case)",
  !!cellCountRow && cellCountRow.access === "RW" && cellCountRow.effectiveAccess === "R",
  JSON.stringify(cellCountRow && { access: cellCountRow.access, effectiveAccess: cellCountRow.effectiveAccess }));
const rwRows = doc.rows.filter((r) => r.access === "RW");
check("no RW row's access was silently downgraded to R (a real regression this Phase A pass fixes)",
  rwRows.length === 97, `got=${rwRows.length}`);

// ---------------------------------------------------------------------------
// 4. All 97 RW rows exactly match Stage 4's inventory (manifest-id set
// equality), and the 18/42/37 stage4State partition is exact.
// ---------------------------------------------------------------------------
const stage4ManifestIds = new Set(stage4Inventory.rows.map((r) => r.manifest_id));
const rwManifestIds = new Set(rwRows.map((r) => r.manifestId));
check("RW manifestId set has zero additions beyond Stage 4's inventory",
  [...rwManifestIds].every((id) => stage4ManifestIds.has(id)), JSON.stringify([...rwManifestIds].filter((id) => !stage4ManifestIds.has(id))));
check("RW manifestId set has zero omissions from Stage 4's inventory",
  [...stage4ManifestIds].every((id) => rwManifestIds.has(id)), JSON.stringify([...stage4ManifestIds].filter((id) => !rwManifestIds.has(id))));
check("exact set equality: generated RW manifestId set == Stage 4 inventory manifestId set",
  rwManifestIds.size === stage4ManifestIds.size && rwManifestIds.size === 97);

const canonicalKeySetGenerated = new Set(rwRows.filter((r) => r.canonicalKey).map((r) => r.canonicalKey));
const canonicalKeySetStage4 = new Set(stage4Inventory.rows.filter((r) => r.canonical_key).map((r) => r.canonical_key));
check("exact set equality: generated RW canonicalKey set == Stage 4 inventory canonical_key set",
  canonicalKeySetGenerated.size === canonicalKeySetStage4.size &&
  [...canonicalKeySetGenerated].every((k) => canonicalKeySetStage4.has(k)) &&
  [...canonicalKeySetStage4].every((k) => canonicalKeySetGenerated.has(k)));

const byStage4State = { "write-hardware-verified": 0, "write-software-ready": 0, "blocked": 0 };
for (const r of rwRows) if (byStage4State[r.stage4State] !== undefined) byStage4State[r.stage4State] += 1;
check("exact Stage 4 partition: 18 write-hardware-verified / 42 write-software-ready / 37 blocked",
  byStage4State["write-hardware-verified"] === 18 && byStage4State["write-software-ready"] === 42 && byStage4State["blocked"] === 37,
  JSON.stringify(byStage4State));

// ---------------------------------------------------------------------------
// 5. Hardware-verified rows: access stays RW, never blocked, retain
// their real currentWriteEndpoint (the legacy set_<key> production path).
// ---------------------------------------------------------------------------
const hwVerified = rwRows.filter((r) => r.stage4State === "write-hardware-verified");
check("every hardware-verified row's access is RW", hwVerified.every((r) => r.access === "RW"));
check("every hardware-verified row's readWriteState is live, never blocked", hwVerified.every((r) => r.readWriteState === "live"));
check("every hardware-verified row carries its real currentWriteEndpoint (e.g. set_smart_sleep)",
  hwVerified.every((r) => typeof r.currentWriteEndpoint === "string" && r.currentWriteEndpoint.startsWith("set_")),
  JSON.stringify(hwVerified.filter((r) => !r.currentWriteEndpoint).map((r) => r.id)));
check("every hardware-verified row's writePathKind is legacy_setting_def",
  hwVerified.every((r) => r.writePathKind === "legacy_setting_def"));

// ---------------------------------------------------------------------------
// 6. Blocked RW rows keep their RW identity (never downgrade to R) and
// carry the real blocker reason/closure criterion.
// ---------------------------------------------------------------------------
const blockedRw = rwRows.filter((r) => r.stage4State === "blocked");
check("every blocked RW row's access is RW (never downgraded to R)", blockedRw.every((r) => r.access === "RW"));
check("every blocked RW row's readWriteState is blocked", blockedRw.every((r) => r.readWriteState === "blocked"));
check("every blocked RW row carries a non-null blockedReason", blockedRw.every((r) => !!r.blockedReason));

// ---------------------------------------------------------------------------
// 7. Software-ready rows: submit policy joined from write_registry.json.
// ---------------------------------------------------------------------------
const writeRegistryByKey = new Map(writeRegistry.entries.map((e) => [e.key, e]));
const softwareReady = rwRows.filter((r) => r.stage4State === "write-software-ready");
check("exactly 42 write-software-ready RW rows, all with a real canonicalKey", softwareReady.length === 42 && softwareReady.every((r) => r.canonicalKey));
let submitPolicyAgreement = true;
for (const r of softwareReady) {
  const wr = writeRegistryByKey.get(r.canonicalKey);
  if (!wr || r.submitPolicy !== wr.submit_policy) submitPolicyAgreement = false;
}
check("every write-software-ready row's submitPolicy exactly matches write_registry.json", submitPolicyAgreement);

// ---------------------------------------------------------------------------
// 8. Non-null manifestId, zero non-register/derived/reserved rows.
// ---------------------------------------------------------------------------
check("every row has a non-null manifestId", doc.rows.every((r) => r.manifestId !== null && r.manifestId !== undefined));
const nonRegisterKeys = new Set(nonRegister.entities.map((e) => e.key));
check("zero rows sourced from non_register_entities.canonical.json",
  doc.rows.every((r) => !nonRegisterKeys.has(r.id) && !nonRegisterKeys.has(r.canonicalKey)));
const reservedIds = new Set(manifest.parameters.filter((p) => p.classification === "reserved").map((p) => p.id));
const derivedIds = new Set(manifest.parameters.filter((p) => p.classification === "derived").map((p) => p.id));
const generatedIds = new Set(doc.rows.map((r) => r.manifestId));
check("zero reserved-classified manifest rows in the view-model", [...reservedIds].every((id) => !generatedIds.has(id)));
check("zero derived-classified manifest rows in the view-model", [...derivedIds].every((id) => !generatedIds.has(id)));

// ---------------------------------------------------------------------------
// 9. Cell composite: exactly 96 rows, 32 channels x 3 bindings (unaffected
// by Phase A -- re-verified as a regression guard).
// ---------------------------------------------------------------------------
const cellRows = doc.rows.filter((r) => r.compositeGroup === "cell");
check("exactly 96 cell-composite rows (32 channels x 3 bindings)", cellRows.length === 96);
const byChannel = new Map();
for (const r of cellRows) {
  if (!byChannel.has(r.topologyChannelIndex)) byChannel.set(r.topologyChannelIndex, new Set());
  byChannel.get(r.topologyChannelIndex).add(r.compositeRole);
}
check("exactly 32 channels, each with exactly 3 correct bindings",
  byChannel.size === 32 && [...byChannel.values()].every((s) => s.size === 3 && s.has("voltage") && s.has("wireResistance") && s.has("wireResistanceCalibration")));

// ---------------------------------------------------------------------------
// 10. W commands and unmapped rows, unaffected by Phase A.
// ---------------------------------------------------------------------------
const wRows = doc.rows.filter((r) => r.access === "W");
check("exactly 8 W-command rows, canonicalKey always null", wRows.length === 8 && wRows.every((r) => r.canonicalKey === null));
const unmappedRows = doc.rows.filter((r) => r.canonicalKey === null && r.access !== "W");
check("exactly 3 unmapped protocol rows", unmappedRows.length === 3, JSON.stringify(unmappedRows.map((r) => r.id)));
check("every unmapped row carries a specific blockedReason", unmappedRows.every((r) => !!r.blockedReason));

// ---------------------------------------------------------------------------
// 11. wireType/valueKind correctness fix (2026-09-22): deterministic,
// derived ONLY from the canonical field's own wire_type + enum_map
// presence -- never from a runtime value. Re-runs the REAL classifier
// (deriveValueKind, re-implemented here ONLY as an independent oracle to
// cross-check the generator's real output against, not to replace it --
// the generator itself is the thing under test, run above via --check).
// ---------------------------------------------------------------------------
function expectedValueKind(wireType, hasEnumMap) {
  if (hasEnumMap) return "enum";
  if (wireType === "BIT") return "binary";
  if (wireType === "ASCII") return "text";
  if (wireType === "HEX") return "raw_text";
  if (["U8", "U16", "U32", "S8", "S16", "S32", "F32"].includes(wireType)) return "numeric";
  return "unknown";
}
const canonicalFieldByKey = new Map();
for (const reg of JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "registers.canonical.json"), "utf8")).registers) {
  for (const field of reg.fields || []) canonicalFieldByKey.set(field.key, field);
}
let valueKindAgreement = true;
const valueKindDisagreements = [];
for (const r of doc.rows) {
  if (!r.canonicalKey) {
    if (r.valueKind !== "unknown" || r.wireType !== null) { valueKindAgreement = false; valueKindDisagreements.push({ id: r.id, reason: "unmapped/W row must be wireType:null valueKind:unknown", got: { wireType: r.wireType, valueKind: r.valueKind } }); }
    continue;
  }
  const field = canonicalFieldByKey.get(r.canonicalKey);
  const expectedWireType = field ? (field.wire_type || null) : null;
  const expectedKind = expectedValueKind(expectedWireType, !!(field && field.enum_map));
  if (r.wireType !== expectedWireType || r.valueKind !== expectedKind) {
    valueKindAgreement = false;
    valueKindDisagreements.push({ id: r.id, key: r.canonicalKey, expected: { wireType: expectedWireType, valueKind: expectedKind }, got: { wireType: r.wireType, valueKind: r.valueKind } });
  }
}
check("every row's wireType/valueKind exactly matches an independent re-derivation from registers.canonical.json",
  valueKindAgreement, JSON.stringify(valueKindDisagreements.slice(0, 5)));

check("real ASCII fields (hardware_version/software_version/setup_passcode) classify as valueKind=text",
  ["hardware_version", "software_version", "setup_passcode"].every((k) => {
    const row = doc.rows.find((r) => r.canonicalKey === k);
    return row && row.wireType === "ASCII" && row.valueKind === "text";
  }));
check("real HEX fields classify as valueKind=raw_text",
  ["uart1_mprtol_enable", "uart_mprtol_enable_0_15"].every((k) => {
    const row = doc.rows.find((r) => r.canonicalKey === k);
    return row && row.wireType === "HEX" && row.valueKind === "raw_text";
  }));
check("real BIT fields with NO documented enum_map classify as valueKind=binary (gps_heartbeat/lcd_always_on/smart_sleep_enabled/timed_stored_data)",
  ["gps_heartbeat", "lcd_always_on", "smart_sleep_enabled", "timed_stored_data"].every((k) => {
    const row = doc.rows.find((r) => r.canonicalKey === k);
    return row && row.wireType === "BIT" && row.valueKind === "binary" && row.options === null;
  }));
check("a real BIT field WITH a documented enum_map (port_switch) classifies as valueKind=enum, not binary",
  (() => { const row = doc.rows.find((r) => r.canonicalKey === "port_switch"); return row && row.wireType === "BIT" && row.valueKind === "enum" && !!row.options; })());
check("valueKind is never inferred from an unmapped row's own manifest metadata -- always exactly 'unknown'",
  doc.rows.filter((r) => r.canonicalKey === null).every((r) => r.valueKind === "unknown"));

console.log(`\nSettings view-model structural summary: ${checks - failures}/${checks} passed`);
process.exit(failures ? 1 : 0);
