#!/usr/bin/env node
"use strict";

/*
 * Generated Settings view-model (typed-petting-puzzle plan, "finish the
 * Settings architecture" batch, corrected 2026-09-22): ONE deterministic,
 * machine-generated row list anchored to the MANUFACTURER MANIFEST's own
 * parameter universe (protocol/generated/bms_v1_1_manifest.json), joined
 * to:
 *   - Stage 4's stage4_rw_inventory.json for ALL 97 RW rows (the complete
 *     inventory, not just write_registry.json's 42 -- see the DECLARED VS
 *     EFFECTIVE ACCESS section below for why this matters);
 *   - Stage 4's write_registry.json for the 42 write-software-ready RW
 *     rows' live/authorization_required submit policy;
 *   - registers.canonical.json's field metadata (label/unit/editor/range),
 *     via the SAME wire-position matcher build_stage3_status_map.js
 *     already exports for R rows, and via stage4_rw_inventory.json's own
 *     already-resolved canonical_key for RW rows (all 97 matched, 0
 *     unmatched/ambiguous -- confirmed directly against the committed
 *     inventory);
 *   - Stage 5's stage5_service_action_inventory.json (W commands, joined
 *     by manifest_id);
 *   - protocol_blockers.json (open-blocker context for unmapped rows).
 *
 * DECLARED VS EFFECTIVE ACCESS (corrective fix): a manifest parameter's
 * own declared `access` ("R"/"RW"/"W") and its current canonical/
 * evidence-derived `effective_access` are two DIFFERENT facts that must
 * never collapse into one field. The previous generator used
 * field.effective_access as the row's ONLY access value, which silently
 * downgraded every blocked or not-yet-implemented RW parameter to a
 * plain "R" row -- 37 real manufacturer RW parameters (all
 * stage4_state="blocked") lost their RW identity entirely, and the 18
 * write-hardware-verified RW parameters were never joined to their real
 * write path at all (the old generator only read write_registry.json,
 * which structurally excludes the 18 -- they use a separate, older
 * write mechanism, SETTING_KEYS/SETTING_DEFS, not the Stage 4 request-id
 * client). This generator keeps `access` (manufacturer-declared, from
 * the manifest / stage4_rw_inventory.json's own declared_access field)
 * and `effectiveAccess` (canonical/evidence-derived) as two permanently
 * separate fields on every row -- `access` is never overwritten.
 *
 * ELIGIBILITY: a manifest parameter is an eligible Settings row iff its
 * own `access` is "R", "RW", or "W" AND its own `classification` is not
 * "reserved". Confirmed by direct computation against the manifest: 155
 * R + 97 RW + 8 W = 260 (never hardcoded here -- this generator simply
 * filters; the exact numbers are independently re-verified by
 * test_settings_view_model.js against the same manifest file). This
 * also, by construction, excludes every ESP/Wi-Fi/system/UI diagnostic
 * (protocol/non_register_entities.canonical.json) and every reserved/
 * derived manifest row -- none of those are ever iterated here.
 *
 * Every eligible row's `manifestId` is non-null by construction. A
 * manifest row with no resolvable canonical mapping is retained as an
 * explicit unmapped/fail-closed row, never dropped, never a guessed key.
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
const STAGE4_INVENTORY_PATH = path.join(ROOT, "protocol", "generated", "stage4_rw_inventory.json");
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
const stage4Inventory = loadJson(STAGE4_INVENTORY_PATH);
const stage5Inventory = loadJson(STAGE5_INVENTORY_PATH);
const blockersDoc = loadJson(BLOCKERS_PATH);

const writeRegistryByKey = new Map(writeRegistry.entries.map((e) => [e.key, e]));
const stage4ByManifestId = new Map(stage4Inventory.rows.map((r) => [r.manifest_id, r]));
const stage5ByManifestId = new Map(stage5Inventory.rows.map((r) => [r.manifest_id, r]));

const canonicalFieldByKey = new Map();
for (const reg of canonical.registers) {
  for (const field of reg.fields || []) canonicalFieldByKey.set(field.key, field);
}

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

// The three cell families the composite renderer needs to locate by
// (compositeGroup, topologyChannelIndex) -- a plain trailing-index regex
// against the real canonical key, never a hardcoded 1..32 loop.
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
function accessLetter(effectiveAccess) {
  if (effectiveAccess === "rw") return "RW";
  if (effectiveAccess === "r") return "R";
  if (effectiveAccess === "w") return "W";
  return null;
}

// Deterministic value-kind classification, derived ONLY from the
// canonical field's own authoritative wire_type + whether it carries a
// documented enum_map -- never from a runtime/browser value (a row with
// no live value yet must classify identically to one that does).
// Read-value-formatting correctness bug fix (2026-09-22): the previous
// renderer routed every non-enum row through numeric()/toFixed(),
// silently corrupting ASCII (hardware_version="15A" -> NaN) and HEX/raw
// fields. wireType/valueKind let the renderer pick the right formatter
// per row without guessing from the current SSE payload's own shape.
function deriveValueKind(wireType, hasEnumMap) {
  if (hasEnumMap) return "enum";
  if (wireType === "BIT") return "binary";
  if (wireType === "ASCII") return "text";
  if (wireType === "HEX") return "raw_text";
  if (["U8", "U16", "U32", "S8", "S16", "S32", "F32"].includes(wireType)) return "numeric";
  return "unknown";
}

// Resolves a manifest parameter to AT MOST ONE canonical field via the
// SAME wire-position matcher build_stage3_status_map.js's own classifier
// uses (fieldOccupiesManifestParamWirePosition) -- never a name-similarity
// guess. Used for R rows only (RW rows use stage4_rw_inventory.json's own
// already-resolved canonical_key instead -- see module comment).
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

// Base shape shared by every row -- every field below is ALWAYS present
// (never conditionally omitted), so a row's own presence proves the
// schema is complete; unknown/inapplicable values are explicit null.
function baseRow(p) {
  return {
    id: p.id,
    canonicalKey: null,
    manifestId: p.id,
    access: p.access,
    effectiveAccess: null,
    wireType: null,
    valueKind: "unknown",
    stage4State: null,
    uiSection: null,
    uiOrder: null,
    uiGroup: null,
    labelUk: null,
    labelEn: null,
    unit: null,
    ukUnit: null,
    enUnit: null,
    precision: null,
    editorKind: null,
    min: null,
    max: null,
    step: null,
    options: null,
    readEntityId: null,
    writeEntityId: null,
    readWriteState: null,
    submitPolicy: null,
    writeSafetyClass: null,
    writePathKind: null,
    currentWriteEndpoint: null,
    writeUsesReadModifyWrite: null,
    blockedReason: null,
    blockerClosureCriterion: null,
    hardwareVerificationProvenance: null,
    revalidationRequired: null,
    compositeGroup: null,
    compositeRole: null,
    topologyChannelIndex: null,
    evidenceRef: null,
    blockerAddress: null,
  };
}

const ELIGIBLE_ACCESS = new Set(["R", "RW", "W"]);
const eligibleParams = manifest.parameters.filter((p) => ELIGIBLE_ACCESS.has(p.access) && p.classification !== "reserved");

const rows = [];
for (const p of eligibleParams) {
  const blocker = openBlockerByParamId.get(p.id) || null;

  if (p.access === "W") {
    // Write-only service command -- never a register field, joined to
    // Stage 5's own inventory by manifest_id.
    const s5 = stage5ByManifestId.get(p.id) || null;
    const row = baseRow(p);
    Object.assign(row, {
      uiSection: "service_actions",
      labelUk: p.name_ua || null,
      editorKind: "service_action",
      readWriteState: s5 ? (s5.implementation_state === "service-action-software-ready" ? "service_action_software_ready" : "service_action_blocked") : "unmapped_protocol_row",
      submitPolicy: s5 ? s5.submit_policy : null,
      writeSafetyClass: s5 ? s5.safety_class : null,
      blockedReason: s5 ? (s5.blocked_reason || null) : "NO_STAGE5_INVENTORY_ENTRY",
      blockerClosureCriterion: s5 ? (s5.blocker_closure_criterion || null) : null,
      blockerAddress: blocker ? blocker.address : null,
    });
    rows.push(row);
    continue;
  }

  if (p.access === "RW") {
    // ALL 97 manufacturer RW rows are joined to the COMPLETE Stage 4
    // inventory (never just write_registry.json's 42-row subset), which
    // is the one authoritative source for declared_access/
    // effective_access/stage4_state/write path facts for every RW
    // parameter -- confirmed 97/97 matched, 0 unmatched, 0 ambiguous.
    const s4 = stage4ByManifestId.get(p.id);
    if (!s4) {
      // Should not happen against real data (asserted by
      // test_settings_view_model.js) -- fail closed rather than guess.
      const row = baseRow(p);
      Object.assign(row, {
        uiSection: "unmapped",
        labelUk: p.name_ua || null,
        labelEn: p.name_prog || null,
        readWriteState: "unmapped_protocol_row",
        blockedReason: "NOT_IN_STAGE4_INVENTORY",
        blockerAddress: blocker ? blocker.address : null,
      });
      rows.push(row);
      continue;
    }
    const field = s4.canonical_key ? canonicalFieldByKey.get(s4.canonical_key) : null;
    const membership = cellMembership(s4.canonical_key);
    let readWriteState;
    let submitPolicy = null;
    let writePathKind = null;
    let currentWriteEndpoint = null;
    let blockedReason = null;
    let blockerClosureCriterion = null;
    if (s4.stage4_state === "write-hardware-verified") {
      // The 18 pre-Stage-4, owner-authorized fields -- SETTING_KEYS/
      // SETTING_DEFS' own legacy number+OK editor in jk_bms.js, never
      // touched by this batch. Manufacturer access stays RW; this is
      // never "blocked".
      readWriteState = "live";
      submitPolicy = "live";
      writePathKind = "legacy_setting_def";
      currentWriteEndpoint = s4.current_write_endpoint;
    } else if (s4.stage4_state === "write-software-ready") {
      const wrEntry = s4.canonical_key ? writeRegistryByKey.get(s4.canonical_key) : null;
      submitPolicy = wrEntry ? wrEntry.submit_policy : null;
      readWriteState = submitPolicy === "live" ? "live" : submitPolicy === "authorization_required" ? "authorization_required" : "blocked";
      writePathKind = "stage4_write_registry";
      blockedReason = wrEntry ? (wrEntry.blocked_reason || null) : "NOT_IN_STAGE4_WRITE_REGISTRY";
    } else {
      // blocked -- manufacturer access remains RW; render state is
      // blocked; the real blocker reason/closure criterion are carried
      // through, never replaced with a generic message.
      readWriteState = "blocked";
      blockedReason = s4.blocked_reason || null;
      blockerClosureCriterion = s4.blocker_closure_criterion || null;
    }
    const row = baseRow(p);
    Object.assign(row, {
      canonicalKey: s4.canonical_key || null,
      // access is the MANUFACTURER's own declared access (p.access, "RW"
      // by definition of this branch) -- never stage4_rw_inventory.json's
      // own `declared_access` field, which for exactly one row
      // (ChargingFloatMode) is deliberately reinterpreted to "r" to
      // record a documented V2-workbook RW-claim contradiction (see that
      // generator's own header comment) -- a real, evidence-tracked fact
      // that belongs in effectiveAccess/blockedReason, never overwriting
      // what the manifest itself declares.
      access: "RW",
      effectiveAccess: accessLetter(s4.effective_access),
      wireType: field ? (field.wire_type || null) : null,
      valueKind: deriveValueKind(field ? field.wire_type : null, !!(field && field.enum_map)),
      stage4State: s4.stage4_state,
      uiSection: field ? (field.ui_section || null) : "unmapped",
      uiOrder: field && typeof field.ui_order === "number" ? field.ui_order : null,
      uiGroup: field ? (field.ui_group || null) : null,
      labelUk: field ? (field.frontend_label_uk || null) : (p.name_ua || null),
      labelEn: field ? (field.frontend_label_en || null) : (p.name_prog || null),
      unit: field ? (field.canonical_unit || null) : null,
      ukUnit: field ? (field.uk_display_unit || null) : null,
      enUnit: field ? (field.en_display_unit || null) : null,
      precision: field && typeof field.decimal_precision === "number" ? field.decimal_precision : null,
      editorKind: field ? (field.editor_kind || null) : null,
      min: (field && typeof field.minimum === "number") ? field.minimum : (typeof s4.minimum === "number" ? s4.minimum : null),
      max: (field && typeof field.maximum === "number") ? field.maximum : (typeof s4.maximum === "number" ? s4.maximum : null),
      step: field && typeof field.step === "number" ? field.step : null,
      options: field ? (field.enum_map || null) : (s4.enum_map || null),
      readEntityId: field ? (field.esphome_read_entity_id || null) : null,
      writeEntityId: field ? (field.esphome_write_entity_id || null) : null,
      readWriteState,
      submitPolicy,
      writeSafetyClass: s4.write_safety_class || null,
      writePathKind,
      currentWriteEndpoint,
      writeUsesReadModifyWrite: typeof s4.write_uses_read_modify_write === "boolean" ? s4.write_uses_read_modify_write : null,
      blockedReason,
      blockerClosureCriterion,
      hardwareVerificationProvenance: s4.hardware_verification_provenance || null,
      revalidationRequired: typeof s4.revalidation_required === "boolean" ? s4.revalidation_required : null,
      compositeGroup: membership.compositeGroup,
      compositeRole: membership.compositeRole,
      topologyChannelIndex: membership.topologyChannelIndex,
      evidenceRef: field ? firstEvidenceRef(field.evidence) : null,
      blockerAddress: blocker ? blocker.address : null,
    });
    rows.push(row);
    continue;
  }

  // access === "R"
  const resolved = resolveCanonicalField(p);
  if (!resolved) {
    const hasAddressMatches = (canonByAddr.get(p.address.base_address) || []).length > 0;
    const row = baseRow(p);
    Object.assign(row, {
      uiSection: "unmapped",
      labelUk: p.name_ua || null,
      labelEn: p.name_prog || null,
      unit: (p.unit && p.unit.raw_unit_symbol) || null,
      precision: typeof p.precision === "number" ? p.precision : null,
      min: typeof p.minimum === "number" ? p.minimum : null,
      max: typeof p.maximum === "number" ? p.maximum : null,
      step: typeof p.step === "number" ? p.step : null,
      readWriteState: "unmapped_protocol_row",
      blockedReason: hasAddressMatches ? "AMBIGUOUS_CANONICAL_WIRE_POSITION" : "NO_CANONICAL_MAPPING",
      blockerAddress: blocker ? blocker.address : null,
    });
    rows.push(row);
    continue;
  }
  const { field } = resolved;
  const membership = cellMembership(field.key);
  const row = baseRow(p);
  Object.assign(row, {
    canonicalKey: field.key,
    access: "R",
    effectiveAccess: accessLetter(field.effective_access),
    wireType: field.wire_type || null,
    valueKind: deriveValueKind(field.wire_type, !!field.enum_map),
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
    readWriteState: "read_only",
    compositeGroup: membership.compositeGroup,
    compositeRole: membership.compositeRole,
    topologyChannelIndex: membership.topologyChannelIndex,
    evidenceRef: firstEvidenceRef(field.evidence),
    blockerAddress: blocker ? blocker.address : null,
  });
  rows.push(row);
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
const countsByStage4State = {};
for (const row of rows) if (row.stage4State) countsByStage4State[row.stage4State] = (countsByStage4State[row.stage4State] || 0) + 1;
const cellCompositeCount = rows.filter((r) => r.compositeGroup === "cell").length;
const unmappedCount = rows.filter((r) => r.canonicalKey === null && r.access !== "W").length;

const contentHash = sha256(MANIFEST_PATH) + sha256(CANONICAL_PATH) + sha256(WRITE_REGISTRY_PATH) + sha256(STAGE4_INVENTORY_PATH) + sha256(STAGE5_INVENTORY_PATH) + sha256(BLOCKERS_PATH);
const shortHash = crypto.createHash("sha256").update(contentHash).digest("hex").slice(0, 16);

const outDoc = {
  $schema: "settings-view-model-generated-v3",
  generated_by: "tools/protocol/authoring/build_settings_view_model.js",
  source_hash: shortHash,
  eligibility_rule: "manifest parameter with access in {R,RW,W} and classification != 'reserved'",
  row_count: rows.length,
  counts_by_access: countsByAccess,
  counts_by_stage4_state: countsByStage4State,
  cell_composite_row_count: cellCompositeCount,
  unmapped_row_count: unmappedCount,
  rows,
};
const outJson = JSON.stringify(outDoc, null, 2) + "\n";

// jk_bms.js embed: a compact per-row tuple array (not the full verbose
// object) to keep the runtime payload small -- the renderer looks fields
// up by name, documented right above the array.
const JS_BEGIN = "  // >>> BEGIN GENERATED SETTINGS VIEW MODEL (cell-composite batch, 2026-09-22) — DO NOT EDIT BY HAND.";
const JS_END = "  // <<< END GENERATED SETTINGS VIEW MODEL";

function jsStringLiteral(v) {
  return v === null || v === undefined ? "null" : JSON.stringify(v);
}
function jsBool(v) { return v === null ? "null" : v ? "true" : "false"; }
function jsNum(v) { return v === null ? "null" : v; }

const jsRows = rows.map((r) => `    { id: ${jsStringLiteral(r.id)}, canonicalKey: ${jsStringLiteral(r.canonicalKey)}, manifestId: ${jsStringLiteral(r.manifestId)}, access: ${jsStringLiteral(r.access)}, effectiveAccess: ${jsStringLiteral(r.effectiveAccess)}, wireType: ${jsStringLiteral(r.wireType)}, valueKind: ${jsStringLiteral(r.valueKind)}, stage4State: ${jsStringLiteral(r.stage4State)}, uiSection: ${jsStringLiteral(r.uiSection)}, uiOrder: ${jsNum(r.uiOrder)}, uiGroup: ${jsStringLiteral(r.uiGroup)}, labelUk: ${jsStringLiteral(r.labelUk)}, labelEn: ${jsStringLiteral(r.labelEn)}, unit: ${jsStringLiteral(r.unit)}, ukUnit: ${jsStringLiteral(r.ukUnit)}, enUnit: ${jsStringLiteral(r.enUnit)}, precision: ${jsNum(r.precision)}, editorKind: ${jsStringLiteral(r.editorKind)}, min: ${jsNum(r.min)}, max: ${jsNum(r.max)}, step: ${jsNum(r.step)}, options: ${jsStringLiteral(r.options)}, readEntityId: ${jsStringLiteral(r.readEntityId)}, writeEntityId: ${jsStringLiteral(r.writeEntityId)}, readWriteState: ${jsStringLiteral(r.readWriteState)}, submitPolicy: ${jsStringLiteral(r.submitPolicy)}, writeSafetyClass: ${jsStringLiteral(r.writeSafetyClass)}, writePathKind: ${jsStringLiteral(r.writePathKind)}, currentWriteEndpoint: ${jsStringLiteral(r.currentWriteEndpoint)}, writeUsesReadModifyWrite: ${jsBool(r.writeUsesReadModifyWrite)}, blockedReason: ${jsStringLiteral(r.blockedReason)}, blockerClosureCriterion: ${jsStringLiteral(r.blockerClosureCriterion)}, hardwareVerificationProvenance: ${jsStringLiteral(r.hardwareVerificationProvenance)}, revalidationRequired: ${jsBool(r.revalidationRequired)}, compositeGroup: ${jsStringLiteral(r.compositeGroup)}, compositeRole: ${jsStringLiteral(r.compositeRole)}, topologyChannelIndex: ${jsNum(r.topologyChannelIndex)}, evidenceRef: ${jsStringLiteral(r.evidenceRef)} },`).join("\n");

const jsBlock = `${JS_BEGIN}
  // Source of truth: protocol/generated/bms_v1_1_manifest.json (the row universe) joined to
  // protocol/generated/stage4_rw_inventory.json (ALL 97 RW rows) + protocol/generated/write_registry.json
  // (software-ready submit policy) + protocol/registers.canonical.json (field metadata) +
  // protocol/generated/stage5_service_action_inventory.json + protocol/evidence/protocol_blockers.json.
  // \`node tools/protocol/authoring/build_settings_view_model.js --check\` fails if this block drifts.
  // Eligible manufacturer manifest rows only (${rows.length}): access in {R,RW,W}, classification != 'reserved'.
  // access is the manufacturer-DECLARED access and is NEVER overwritten by effectiveAccess (the current
  // canonical/evidence-derived access) -- the two are permanently separate fields on every row.
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
console.log(`${rows.length} rows: ${JSON.stringify(countsByAccess)}; stage4: ${JSON.stringify(countsByStage4State)}; cell composite rows: ${cellCompositeCount}; unmapped: ${unmappedCount}`);
