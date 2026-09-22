#!/usr/bin/env node
"use strict";

/*
 * Generated Settings view-model (typed-petting-puzzle plan, cell-composite
 * batch, corrected 2026-09-22): ONE deterministic, machine-generated row
 * list anchored to the MANUFACTURER MANIFEST's own parameter universe
 * (protocol/generated/bms_v1_1_manifest.json), joined to:
 *   - registers.canonical.json's field metadata, via the SAME wire-position
 *     matcher build_stage3_status_map.js already exports (never a
 *     reimplementation of that matching rule);
 *   - Stage 4's write_registry.json (RW submit policy);
 *   - Stage 5's stage5_service_action_inventory.json (W commands, joined
 *     by manifest_id -- Stage 5's own canonical id for each W command IS
 *     a manifest id, e.g. "VoltageCalibration");
 *   - protocol_blockers.json (open-blocker context for unmapped/blocked
 *     rows).
 *
 * ELIGIBILITY (corrected): a manifest parameter is an eligible Settings
 * row iff its own `access` is "R", "RW", or "W" AND its own
 * `classification` is not "reserved". This excludes the 4 reserved
 * fields and the 1 "derived" (calculated, access="Розрахункове", not a
 * real R/RW/W register) row automatically (its access is neither R nor
 * RW nor W). It also, by construction, excludes every ESP/Wi-Fi/system/
 * UI diagnostic and every protocol/non_register_entities.canonical.json
 * entry -- none of those are manufacturer manifest rows at all, so they
 * are never iterated in the first place (a BMS Settings view-model must
 * not contain the ESPHome-side entities non_register_entities.canonical.json
 * catalogs -- correctly a completely separate concern, left for
 * Diagnostics, never fed into this file).
 *
 * Every eligible row's `manifestId` is therefore non-null by
 * construction -- the manifest row IS the row, not an optional join.
 * A manifest row with no matching canonical field (no register at its
 * address, or more than one field occupying its exact wire position --
 * both via the SAME matcher build_stage3_status_map.js already uses) is
 * retained as an explicit blocked/unmapped row (`canonicalKey: null`,
 * `readWriteState: "unmapped_protocol_row"`, a specific `blockedReason`)
 * -- never silently dropped, never a guessed canonical key.
 *
 * Run:
 *   node tools/protocol/authoring/build_settings_view_model.js
 *   node tools/protocol/authoring/build_settings_view_model.js --check
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const MANIFEST_PATH = path.join(ROOT, "protocol", "generated", "bms_v1_1_manifest.json");
const CANONICAL_PATH = path.join(ROOT, "protocol", "registers.canonical.json");
const WRITE_REGISTRY_PATH = path.join(ROOT, "protocol", "generated", "write_registry.json");
const STAGE5_INVENTORY_PATH = path.join(ROOT, "protocol", "generated", "stage5_service_action_inventory.json");
const BLOCKERS_PATH = path.join(ROOT, "protocol", "evidence", "protocol_blockers.json");
const OUT_PATH = path.join(ROOT, "protocol", "generated", "settings_view_model.json");
const JS_PATH = path.join(ROOT, "jk_bms.js");
const CHECK = process.argv.includes("--check");

const { fieldOccupiesManifestParamWirePosition } = require("./build_stage3_status_map.js");

function loadJson(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
function sha256(p) { return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex"); }

const manifest = loadJson(MANIFEST_PATH);
const canonical = loadJson(CANONICAL_PATH);
const writeRegistry = loadJson(WRITE_REGISTRY_PATH);
const stage5Inventory = loadJson(STAGE5_INVENTORY_PATH);
const blockersDoc = loadJson(BLOCKERS_PATH);

const writeRegistryByKey = new Map(writeRegistry.entries.map((e) => [e.key, e]));
const stage5ByManifestId = new Map(stage5Inventory.rows.map((r) => [r.manifest_id, r]));

const openBlockerByParamId = new Map();
for (const b of blockersDoc.blockers) {
  if (b.status !== "open") continue;
  for (const name of b.parameter_id.split(",")) openBlockerByParamId.set(name.trim(), b);
}

const canonByAddr = new Map();
for (const reg of canonical.registers) {
  if (!canonByAddr.has(reg.address)) canonByAddr.set(reg.address, []);
  canonByAddr.get(reg.address).push(reg);
}

// The three cell families this batch's composite renderer needs to locate
// by (compositeGroup, topologyChannelIndex) -- a plain trailing-index
// regex against the real canonical key, never a hardcoded 1..32 loop that
// could silently diverge from what canonical actually enumerates.
const CELL_KEY_PATTERNS = [
  { re: /^cell_voltage_(\d+)$/, role: "voltage" },
  { re: /^cell_resistance_(\d+)$/, role: "wireResistance" },
  { re: /^cell_connection_wire_resistance_(\d+)$/, role: "wireResistanceCalibration" },
];
function cellMembership(key) {
  if (!key) return { compositeGroup: null, compositeRole: null, topologyChannelIndex: null };
  for (const { re, role } of CELL_KEY_PATTERNS) {
    const m = re.exec(key);
    if (m) return { compositeGroup: "cell", compositeRole: role, topologyChannelIndex: Number(m[1]) };
  }
  return { compositeGroup: null, compositeRole: null, topologyChannelIndex: null };
}
function firstEvidenceRef(evidence) {
  if (!Array.isArray(evidence) || evidence.length === 0) return null;
  return evidence[0].locator_id || null;
}

// Resolves a manifest parameter to AT MOST ONE canonical field via the
// SAME wire-position matcher build_stage3_status_map.js's own classifier
// uses (fieldOccupiesManifestParamWirePosition) -- never a name-similarity
// guess. Returns { field, register } or null (no match / ambiguous).
function resolveCanonicalField(p) {
  const regsAtAddr = canonByAddr.get(p.address.base_address) || [];
  const matches = [];
  for (const reg of regsAtAddr) {
    for (const field of reg.fields || []) {
      if (fieldOccupiesManifestParamWirePosition(p.address, field, reg.register_width_bits)) {
        matches.push({ field, register: reg });
      }
    }
  }
  if (matches.length === 1) return matches[0];
  return null;
}

const ELIGIBLE_ACCESS = new Set(["R", "RW", "W"]);
const eligibleParams = manifest.parameters.filter((p) => ELIGIBLE_ACCESS.has(p.access) && p.classification !== "reserved");

const rows = [];
for (const p of eligibleParams) {
  const membership0 = {}; // placeholder, filled per-branch below
  const blocker = openBlockerByParamId.get(p.id) || null;

  if (p.access === "W") {
    // Write-only service command -- never a register field, joined to
    // Stage 5's own inventory by manifest_id (Stage 5's canonical id for
    // each of the 8 commands IS the manifest id).
    const s5 = stage5ByManifestId.get(p.id) || null;
    rows.push({
      id: p.id,
      canonicalKey: null,
      manifestId: p.id,
      access: "W",
      uiSection: "service_actions",
      uiOrder: null,
      uiGroup: null,
      labelUk: p.name_ua || null,
      labelEn: null,
      unit: null,
      ukUnit: null,
      enUnit: null,
      precision: null,
      editorKind: "service_action",
      min: null,
      max: null,
      step: null,
      options: null,
      readEntityId: null,
      writeEntityId: null,
      readWriteState: s5 ? (s5.implementation_state === "service-action-software-ready" ? "service_action_software_ready" : "service_action_blocked") : "unmapped_protocol_row",
      submitPolicy: s5 ? s5.submit_policy : null,
      blockedReason: s5 ? (s5.blocked_reason || null) : "NO_STAGE5_INVENTORY_ENTRY",
      compositeGroup: null,
      compositeRole: null,
      topologyChannelIndex: null,
      evidenceRef: null,
      blockerAddress: blocker ? blocker.address : null,
    });
    continue;
  }

  const resolved = resolveCanonicalField(p);
  if (!resolved) {
    // No canonical mapping -- retained explicitly, never dropped, never
    // a guessed canonical key. Metadata falls back to the manifest's own
    // real, sourced fields (never fabricated): its own unit/min/max/step
    // where the workbook actually states one, its own name_ua/name_prog
    // for a label.
    const hasAddressMatches = (canonByAddr.get(p.address.base_address) || []).length > 0;
    rows.push({
      id: p.id,
      canonicalKey: null,
      manifestId: p.id,
      access: p.access,
      uiSection: "unmapped",
      uiOrder: null,
      uiGroup: null,
      labelUk: p.name_ua || null,
      labelEn: p.name_prog || null,
      unit: (p.unit && p.unit.raw_unit_symbol) || null,
      ukUnit: null,
      enUnit: null,
      precision: typeof p.precision === "number" ? p.precision : null,
      editorKind: null,
      min: typeof p.minimum === "number" ? p.minimum : null,
      max: typeof p.maximum === "number" ? p.maximum : null,
      step: typeof p.step === "number" ? p.step : null,
      options: null,
      readEntityId: null,
      writeEntityId: null,
      readWriteState: "unmapped_protocol_row",
      submitPolicy: null,
      blockedReason: hasAddressMatches ? "AMBIGUOUS_CANONICAL_WIRE_POSITION" : "NO_CANONICAL_MAPPING",
      compositeGroup: null,
      compositeRole: null,
      topologyChannelIndex: null,
      evidenceRef: null,
      blockerAddress: blocker ? blocker.address : null,
    });
    continue;
  }

  const { field } = resolved;
  const access = field.effective_access === "rw" ? "RW" : field.effective_access === "r" ? "R" : field.effective_access === "w" ? "W" : p.access;
  const wrEntry = writeRegistryByKey.get(field.key) || null;
  const membership = cellMembership(field.key);
  let readWriteState;
  let submitPolicy = null;
  let blockedReason = null;
  if (access === "R") {
    readWriteState = "read_only";
  } else if (access === "RW") {
    if (wrEntry) {
      submitPolicy = wrEntry.submit_policy;
      blockedReason = wrEntry.blocked_reason || null;
      readWriteState = wrEntry.submit_policy === "live" ? "live"
        : wrEntry.submit_policy === "authorization_required" ? "authorization_required"
        : "blocked";
    } else {
      readWriteState = "blocked";
      blockedReason = "NOT_IN_STAGE4_WRITE_REGISTRY";
    }
  } else {
    readWriteState = "unknown";
  }

  rows.push({
    id: p.id,
    canonicalKey: field.key,
    manifestId: p.id,
    access,
    uiSection: field.ui_section || null,
    uiOrder: typeof field.ui_order === "number" ? field.ui_order : null,
    uiGroup: field.ui_group || null,
    labelUk: field.frontend_label_uk || null,
    labelEn: field.frontend_label_en || null,
    unit: field.canonical_unit || null,
    ukUnit: field.uk_display_unit || null,
    enUnit: field.en_display_unit || null,
    precision: typeof field.decimal_precision === "number" ? field.decimal_precision : null,
    editorKind: field.editor_kind || null,
    min: typeof field.minimum === "number" ? field.minimum : null,
    max: typeof field.maximum === "number" ? field.maximum : null,
    step: typeof field.step === "number" ? field.step : null,
    options: field.enum_map || null,
    readEntityId: field.esphome_read_entity_id || null,
    writeEntityId: field.esphome_write_entity_id || null,
    readWriteState,
    submitPolicy,
    blockedReason,
    compositeGroup: membership.compositeGroup,
    compositeRole: membership.compositeRole,
    topologyChannelIndex: membership.topologyChannelIndex,
    evidenceRef: firstEvidenceRef(field.evidence),
    blockerAddress: blocker ? blocker.address : null,
  });
}

rows.sort((a, b) => {
  const sa = a.uiSection || "";
  const sb = b.uiSection || "";
  if (sa !== sb) return sa < sb ? -1 : 1;
  const oa = a.uiOrder === null ? Number.MAX_SAFE_INTEGER : a.uiOrder;
  const ob = b.uiOrder === null ? Number.MAX_SAFE_INTEGER : b.uiOrder;
  if (oa !== ob) return oa - ob;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
});

const countsByAccess = {};
for (const row of rows) countsByAccess[row.access] = (countsByAccess[row.access] || 0) + 1;
const cellCompositeCount = rows.filter((r) => r.compositeGroup === "cell").length;
const unmappedCount = rows.filter((r) => r.canonicalKey === null && r.access !== "W").length;

const contentHash = sha256(MANIFEST_PATH) + sha256(CANONICAL_PATH) + sha256(WRITE_REGISTRY_PATH) + sha256(STAGE5_INVENTORY_PATH) + sha256(BLOCKERS_PATH);
const shortHash = crypto.createHash("sha256").update(contentHash).digest("hex").slice(0, 16);

const outDoc = {
  $schema: "settings-view-model-generated-v2",
  generated_by: "tools/protocol/authoring/build_settings_view_model.js",
  source_hash: shortHash,
  eligibility_rule: "manifest parameter with access in {R,RW,W} and classification != 'reserved'",
  row_count: rows.length,
  counts_by_access: countsByAccess,
  cell_composite_row_count: cellCompositeCount,
  unmapped_row_count: unmappedCount,
  rows,
};
const outJson = JSON.stringify(outDoc, null, 2) + "\n";

// jk_bms.js embed: a compact per-row tuple array (not the full verbose
// object) to keep the runtime payload small -- the renderer looks fields
// up by fixed index, documented right above the array.
const JS_BEGIN = "  // >>> BEGIN GENERATED SETTINGS VIEW MODEL (cell-composite batch, 2026-09-22) — DO NOT EDIT BY HAND.";
const JS_END = "  // <<< END GENERATED SETTINGS VIEW MODEL";

function jsStringLiteral(v) {
  return v === null || v === undefined ? "null" : JSON.stringify(v);
}

const jsRows = rows.map((r) => `    { id: ${jsStringLiteral(r.id)}, canonicalKey: ${jsStringLiteral(r.canonicalKey)}, manifestId: ${jsStringLiteral(r.manifestId)}, access: ${jsStringLiteral(r.access)}, uiSection: ${jsStringLiteral(r.uiSection)}, uiOrder: ${r.uiOrder === null ? "null" : r.uiOrder}, uiGroup: ${jsStringLiteral(r.uiGroup)}, labelUk: ${jsStringLiteral(r.labelUk)}, labelEn: ${jsStringLiteral(r.labelEn)}, unit: ${jsStringLiteral(r.unit)}, ukUnit: ${jsStringLiteral(r.ukUnit)}, enUnit: ${jsStringLiteral(r.enUnit)}, precision: ${r.precision === null ? "null" : r.precision}, editorKind: ${jsStringLiteral(r.editorKind)}, min: ${r.min === null ? "null" : r.min}, max: ${r.max === null ? "null" : r.max}, step: ${r.step === null ? "null" : r.step}, options: ${jsStringLiteral(r.options)}, readEntityId: ${jsStringLiteral(r.readEntityId)}, writeEntityId: ${jsStringLiteral(r.writeEntityId)}, readWriteState: ${jsStringLiteral(r.readWriteState)}, submitPolicy: ${jsStringLiteral(r.submitPolicy)}, blockedReason: ${jsStringLiteral(r.blockedReason)}, compositeGroup: ${jsStringLiteral(r.compositeGroup)}, compositeRole: ${jsStringLiteral(r.compositeRole)}, topologyChannelIndex: ${r.topologyChannelIndex === null ? "null" : r.topologyChannelIndex}, evidenceRef: ${jsStringLiteral(r.evidenceRef)} },`).join("\n");

const jsBlock = `${JS_BEGIN}
  // Source of truth: protocol/generated/bms_v1_1_manifest.json (the row universe) joined to
  // protocol/registers.canonical.json + protocol/generated/write_registry.json +
  // protocol/generated/stage5_service_action_inventory.json + protocol/evidence/protocol_blockers.json.
  // \`node tools/protocol/authoring/build_settings_view_model.js --check\` fails if this block drifts.
  // Eligible manufacturer manifest rows only (${rows.length}): access in {R,RW,W}, classification != 'reserved'.
  // Never includes non_register_entities.canonical.json (ESP/Wi-Fi/system/UI diagnostics) or reserved/derived rows.
  // Every row's manifestId is non-null. A manifest row with no canonical mapping (or an ambiguous wire-position
  // match) is retained as an explicit unmapped_protocol_row, never dropped, never a guessed canonicalKey.
  const SETTINGS_VIEW_MODEL = Object.freeze([
${jsRows}
  ]);
${JS_END}`;

function applyToSource(src) {
  const beginIdx = src.indexOf(JS_BEGIN);
  const endIdx = src.indexOf(JS_END);
  if (beginIdx === -1 || endIdx === -1) {
    throw new Error("SETTINGS VIEW MODEL markers not found in jk_bms.js -- add them once by hand before running this generator.");
  }
  const endOfEndLine = src.indexOf("\n", endIdx);
  return src.slice(0, beginIdx) + jsBlock + src.slice(endOfEndLine);
}

if (CHECK) {
  let drift = false;
  if (!fs.existsSync(OUT_PATH) || fs.readFileSync(OUT_PATH, "utf8") !== outJson) {
    console.log(`DRIFT  ${path.relative(ROOT, OUT_PATH)}`);
    drift = true;
  }
  const jsSrc = fs.readFileSync(JS_PATH, "utf8");
  const expectedJs = applyToSource(jsSrc);
  if (expectedJs !== jsSrc) {
    console.log(`DRIFT  jk_bms.js (SETTINGS VIEW MODEL block out of date)`);
    drift = true;
  }
  if (drift) {
    console.log("build_settings_view_model.js --check: artifact(s) out of date. Run 'node tools/protocol/authoring/build_settings_view_model.js' to regenerate.");
    process.exit(1);
  }
  console.log("build_settings_view_model.js --check: no drift.");
  process.exit(0);
}

fs.writeFileSync(OUT_PATH, outJson, "utf8");
console.log(`wrote ${path.relative(ROOT, OUT_PATH)}`);
const jsSrc = fs.readFileSync(JS_PATH, "utf8");
const newJs = applyToSource(jsSrc);
if (newJs !== jsSrc) {
  fs.writeFileSync(JS_PATH, newJs, "utf8");
  console.log("wrote jk_bms.js (SETTINGS VIEW MODEL block)");
}
console.log(`${rows.length} rows: ${JSON.stringify(countsByAccess)}; cell composite rows: ${cellCompositeCount}; unmapped: ${unmappedCount}`);
