#!/usr/bin/env node
"use strict";

/*
 * Generated Settings view-model (typed-petting-puzzle plan, cell-composite
 * batch): ONE deterministic, machine-generated row list covering the whole
 * protocol inventory -- registers.canonical.json's fields,
 * non_register_entities.canonical.json's calculated entities, Stage 4's
 * write_registry.json (RW submit policy), and Stage 5's
 * stage5_service_action_inventory.json (W commands) -- joined by their own
 * existing keys, never a second hand-authored duplicate of any of them.
 *
 * This is the single source of truth the new cell-composite renderer reads
 * for label/unit/editor/access/submit-policy metadata (jk_bms.js never
 * hand-duplicates a range, unit, or write-safety fact this generator
 * already carries). It also covers every non-cell row today (full protocol
 * inventory, per the plan's own "foundation for the next batch" framing)
 * even though this batch's renderer only consumes the cell rows -- a later
 * batch migrates the rest of the generic Settings list onto it.
 *
 * Run:
 *   node tools/protocol/authoring/build_settings_view_model.js
 *   node tools/protocol/authoring/build_settings_view_model.js --check
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const CANONICAL_PATH = path.join(ROOT, "protocol", "registers.canonical.json");
const NON_REGISTER_PATH = path.join(ROOT, "protocol", "non_register_entities.canonical.json");
const WRITE_REGISTRY_PATH = path.join(ROOT, "protocol", "generated", "write_registry.json");
const STAGE5_INVENTORY_PATH = path.join(ROOT, "protocol", "generated", "stage5_service_action_inventory.json");
const OUT_PATH = path.join(ROOT, "protocol", "generated", "settings_view_model.json");
const JS_PATH = path.join(ROOT, "jk_bms.js");
const CHECK = process.argv.includes("--check");

function loadJson(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
function sha256(p) { return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex"); }

const canonical = loadJson(CANONICAL_PATH);
const nonRegister = loadJson(NON_REGISTER_PATH);
const writeRegistry = loadJson(WRITE_REGISTRY_PATH);
const stage5Inventory = loadJson(STAGE5_INVENTORY_PATH);

const writeRegistryByKey = new Map(writeRegistry.entries.map((e) => [e.key, e]));

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
  for (const { re, role } of CELL_KEY_PATTERNS) {
    const m = re.exec(key);
    if (m) return { compositeGroup: "cell", compositeRole: role, topologyChannelIndex: Number(m[1]) };
  }
  return { compositeGroup: null, compositeRole: null, topologyChannelIndex: null };
}

function accessLetter(effectiveAccess) {
  if (effectiveAccess === "rw") return "RW";
  if (effectiveAccess === "r") return "R";
  if (effectiveAccess === "w") return "W";
  return null;
}

function firstEvidenceRef(evidence) {
  if (!Array.isArray(evidence) || evidence.length === 0) return null;
  return evidence[0].locator_id || null;
}

// One row per canonical register field (R/RW).
const rows = [];
for (const reg of canonical.registers) {
  for (const field of reg.fields || []) {
    const access = accessLetter(field.effective_access);
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
      id: field.key,
      canonicalKey: field.key,
      manifestId: null,
      access,
      uiSection: field.ui_section || null,
      uiOrder: typeof field.ui_order === "number" ? field.ui_order : null,
      uiGroup: field.ui_group || null,
      labelUk: field.frontend_label_uk || null,
      labelEn: field.frontend_label_en || null,
      unit: field.canonical_unit || null,
      ukUnit: field.uk_display_unit || null,
      enUnit: field.en_display_unit || null,
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
    });
  }
}

// One row per calculated/derived non-register entity (always read-only).
for (const entity of nonRegister.entities) {
  rows.push({
    id: entity.key,
    canonicalKey: null,
    manifestId: null,
    access: "R",
    uiSection: entity.ui_section || null,
    uiOrder: typeof entity.ui_order === "number" ? entity.ui_order : null,
    uiGroup: entity.ui_group || null,
    labelUk: entity.frontend_label_uk || null,
    labelEn: entity.frontend_label_en || null,
    unit: entity.unit || null,
    ukUnit: entity.uk_display_unit || null,
    enUnit: entity.en_display_unit || null,
    editorKind: "readonly",
    min: null,
    max: null,
    step: null,
    options: null,
    readEntityId: entity.esphome_entity_id || null,
    writeEntityId: null,
    readWriteState: "read_only",
    submitPolicy: null,
    blockedReason: null,
    compositeGroup: null,
    compositeRole: null,
    topologyChannelIndex: null,
    evidenceRef: null,
  });
}

// One row per Stage 5 write-only service command (never a register field).
for (const r of stage5Inventory.rows) {
  rows.push({
    id: r.key,
    canonicalKey: null,
    manifestId: r.manifest_id,
    access: "W",
    uiSection: "service_actions",
    uiOrder: null,
    uiGroup: null,
    labelUk: null,
    labelEn: null,
    unit: null,
    ukUnit: null,
    enUnit: null,
    editorKind: "service_action",
    min: null,
    max: null,
    step: null,
    options: null,
    readEntityId: null,
    writeEntityId: null,
    readWriteState: r.implementation_state === "service-action-software-ready" ? "service_action_software_ready" : "service_action_blocked",
    submitPolicy: r.submit_policy,
    blockedReason: r.blocked_reason || null,
    compositeGroup: null,
    compositeRole: null,
    topologyChannelIndex: null,
    evidenceRef: null,
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

const contentHash = sha256(CANONICAL_PATH) + sha256(NON_REGISTER_PATH) + sha256(WRITE_REGISTRY_PATH) + sha256(STAGE5_INVENTORY_PATH);
const shortHash = crypto.createHash("sha256").update(contentHash).digest("hex").slice(0, 16);

const outDoc = {
  $schema: "settings-view-model-generated-v1",
  generated_by: "tools/protocol/authoring/build_settings_view_model.js",
  source_hash: shortHash,
  row_count: rows.length,
  counts_by_access: countsByAccess,
  cell_composite_row_count: cellCompositeCount,
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

const jsRows = rows.map((r) => `    { id: ${jsStringLiteral(r.id)}, canonicalKey: ${jsStringLiteral(r.canonicalKey)}, manifestId: ${jsStringLiteral(r.manifestId)}, access: ${jsStringLiteral(r.access)}, uiSection: ${jsStringLiteral(r.uiSection)}, uiOrder: ${r.uiOrder === null ? "null" : r.uiOrder}, uiGroup: ${jsStringLiteral(r.uiGroup)}, labelUk: ${jsStringLiteral(r.labelUk)}, labelEn: ${jsStringLiteral(r.labelEn)}, unit: ${jsStringLiteral(r.unit)}, ukUnit: ${jsStringLiteral(r.ukUnit)}, enUnit: ${jsStringLiteral(r.enUnit)}, editorKind: ${jsStringLiteral(r.editorKind)}, min: ${r.min === null ? "null" : r.min}, max: ${r.max === null ? "null" : r.max}, step: ${r.step === null ? "null" : r.step}, options: ${jsStringLiteral(r.options)}, readEntityId: ${jsStringLiteral(r.readEntityId)}, writeEntityId: ${jsStringLiteral(r.writeEntityId)}, readWriteState: ${jsStringLiteral(r.readWriteState)}, submitPolicy: ${jsStringLiteral(r.submitPolicy)}, blockedReason: ${jsStringLiteral(r.blockedReason)}, compositeGroup: ${jsStringLiteral(r.compositeGroup)}, compositeRole: ${jsStringLiteral(r.compositeRole)}, topologyChannelIndex: ${r.topologyChannelIndex === null ? "null" : r.topologyChannelIndex}, evidenceRef: ${jsStringLiteral(r.evidenceRef)} },`).join("\n");

const jsBlock = `${JS_BEGIN}
  // Source of truth: protocol/registers.canonical.json + protocol/non_register_entities.canonical.json
  // + protocol/generated/write_registry.json + protocol/generated/stage5_service_action_inventory.json.
  // \`node tools/protocol/authoring/build_settings_view_model.js --check\` fails if this block drifts.
  // Full protocol inventory (${rows.length} rows): every canonical register field (R/RW), every
  // calculated non-register entity (R), and every Stage 5 write-only service command (W). This
  // batch's cell-composite renderer only reads the compositeGroup==="cell" rows; a later batch
  // migrates the rest of the generic Settings list onto this same view-model.
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
console.log(`${rows.length} rows: ${JSON.stringify(countsByAccess)}; cell composite rows: ${cellCompositeCount}`);
