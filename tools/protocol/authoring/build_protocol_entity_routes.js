#!/usr/bin/env node
"use strict";

/*
 * Protocol-entity routing fix (2026-09-22): ONE deterministic, generated
 * route table covering EVERY field protocol/generated/read_plan.json
 * actually publishes -- the COMPLETE set, not just the narrower subset
 * (PROTOCOL_CATALOG.wireObjectIdAliases) whose wire object_id happens to
 * differ from its own canonical key.
 *
 * ROOT CAUSE this fixes: jk_bms.js's registerEntity() calls came from two
 * sources -- a large hand-typed list (written incrementally over many
 * prior sessions, covering whichever fields Overview/Diagnostics needed
 * at the time) and the generated wireObjectIdAliases table (which only
 * ever emits an entry when esphome_read_entity_id !== key). Many ordinary
 * protocol fields -- confirmed on real hardware, 2026-09-22:
 * native_bms_power, precharge_status, custom_alarm_1/2, recovery timers,
 * alarm bits, heating/sensor-presence bits, UART2/CAN protocol fields,
 * charger_plugged, pcl_module_sta, can_mptl_ver -- had esphome_read_
 * entity_id === key AND no hand-typed call covering them, so they had NO
 * registerEntity() call anywhere. Their real /events payloads never
 * reached entityByWireId, ingestPayload() returned before ever writing
 * state[key], and the (correctly catalog-first-rendered) Settings row
 * showed the unavailable placeholder forever, indistinguishable from a
 * field that genuinely has no runtime entity.
 *
 * SOURCE OF THE CONFIGURED NAME: read_plan.json's own `configured_name`
 * per field (added by generate_read_plan.js, computed via the EXACT SAME
 * humanize(entity_id) function that generator's own buildReadPlanYaml()
 * uses to emit each entity's real `name:` line) -- read_plan.yaml (what
 * ESPHome actually compiles) and this route table now consume the SAME
 * generated value, so they can never drift apart again.
 *
 * EXCLUSION: every synthetic `<key>__legacy_companion` field
 * generate_read_plan.js injects (Stage 3 precision-fix legacy entities)
 * is deliberately excluded here -- those stay owned EXCLUSIVELY by
 * PROTOCOL_CATALOG.legacyCompanionEntities (registered against
 * LEGACY_COMPANION_SUPPRESSED, never a real canonical key). A
 * `__legacy_companion` key is synthetic (never a real canonicalKey) and
 * its own real entity_id is a DIFFERENT wire id from its exact primary's
 * entity_id -- there is no real overlap between this table and the
 * legacy-suppression table by construction, but jk_bms.js still
 * registers this table's routes BEFORE legacyCompanionEntities as a
 * defense-in-depth ordering guarantee (see that loop's own comment).
 *
 * Run:
 *   node tools/protocol/authoring/build_protocol_entity_routes.js
 *   node tools/protocol/authoring/build_protocol_entity_routes.js --check
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const READ_PLAN_PATH = path.join(ROOT, "protocol", "generated", "read_plan.json");
const CANONICAL_PATH = path.join(ROOT, "protocol", "registers.canonical.json");
const OUT_PATH = path.join(ROOT, "protocol", "generated", "protocol_entity_routes.json");
const JS_PATH = path.join(ROOT, "jk_bms.js");
const CHECK = process.argv.includes("--check");

function loadJson(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
function sha256(p) { return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex"); }
// Same humanize() convention generate_read_plan.js's buildReadPlanYaml()
// uses for every entity's real `name:` line -- kept as a single-purpose
// fallback here ONLY for bespoke-reader fields whose canonical
// esphome_configured_name isn't populated yet (read_plan.json's own
// generated configured_name is always preferred when a field has one).
function humanize(key) { return key.replace(/_/g, " "); }

const readPlan = loadJson(READ_PLAN_PATH);
const canonical = loadJson(CANONICAL_PATH);

const routes = [];
const seenKeys = new Set();
for (const block of readPlan.blocks) {
  for (const field of block.fields) {
    if (field.key.endsWith("__legacy_companion")) continue; // owned by legacyCompanionEntities instead
    if (seenKeys.has(field.key)) {
      throw new Error(`PROTOCOL_ENTITY_ROUTES_DUPLICATE_KEY: "${field.key}" appears in more than one read_plan.json block -- refusing to generate an ambiguous route table.`);
    }
    seenKeys.add(field.key);
    routes.push({
      key: field.key,
      domain: field.domain,
      entityId: field.entity_id,
      configuredName: field.configured_name || null,
    });
  }
}

// Bespoke-reader entities (read_plan.json's own excluded_bespoke_keys --
// decoded via a hand-authored custom reader, e.g. the 0x1200/0x1290
// blocks, never the generic per-block mechanism, so read_plan.json never
// assigns them a configured_name): sourced directly from
// registers.canonical.json's own esphome_domain/esphome_read_entity_id/
// esphome_configured_name -- the SAME fields wireObjectIdAliases already
// trusts for its own narrower "differs from key" case. A field with no
// esphome_read_entity_id/esphome_domain recorded (no established runtime
// contract) is skipped entirely here, never given a fabricated route.
const excludedBespokeKeys = new Set(readPlan.excluded_bespoke_keys || []);
const canonicalFieldByKey = new Map();
for (const reg of canonical.registers) for (const f of reg.fields || []) canonicalFieldByKey.set(f.key, f);
for (const key of excludedBespokeKeys) {
  if (seenKeys.has(key)) continue;
  const field = canonicalFieldByKey.get(key);
  if (!field) continue;
  if (field.effective_access !== "r" && field.effective_access !== "rw") continue;
  if (!field.esphome_read_entity_id || !field.esphome_domain) continue;
  seenKeys.add(key);
  routes.push({
    key,
    domain: field.esphome_domain,
    entityId: field.esphome_read_entity_id,
    configuredName: field.esphome_configured_name || humanize(field.esphome_read_entity_id),
  });
}

routes.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

const contentHash = sha256(READ_PLAN_PATH) + sha256(CANONICAL_PATH);
const shortHash = crypto.createHash("sha256").update(contentHash).digest("hex").slice(0, 16);

const outDoc = {
  $schema: "protocol-entity-routes-generated-v1",
  generated_by: "tools/protocol/authoring/build_protocol_entity_routes.js",
  source_hash: shortHash,
  route_count: routes.length,
  routes,
};
const outJson = JSON.stringify(outDoc, null, 2) + "\n";

const JS_BEGIN = "  // >>> BEGIN GENERATED PROTOCOL ENTITY ROUTES (2026-09-22) — DO NOT EDIT BY HAND.";
const JS_END = "  // <<< END GENERATED PROTOCOL ENTITY ROUTES";

function jsStringLiteral(v) {
  return v === null || v === undefined ? "null" : JSON.stringify(v);
}

const jsRoutes = routes.map((r) => `    [${jsStringLiteral(r.key)}, ${jsStringLiteral(r.domain)}, ${jsStringLiteral(r.entityId)}, ${jsStringLiteral(r.configuredName)}],`).join("\n");

const jsBlock = `${JS_BEGIN}
  // Source of truth: protocol/generated/read_plan.json (itself generated by
  // tools/protocol/generate_read_plan.js from registers.canonical.json).
  // \`node tools/protocol/authoring/build_protocol_entity_routes.js --check\` fails if this block drifts.
  // Every field read_plan.json actually publishes (${routes.length}), EXCLUDING every synthetic
  // \`*__legacy_companion\` entry (those stay owned exclusively by legacyCompanionEntities,
  // above/below -- see this table's own consumer loop for why that split is load-bearing).
  // Each tuple: [canonicalKey, esphomeDomain, entityId, configuredName].
  const PROTOCOL_ENTITY_ROUTES = Object.freeze([
${jsRoutes}
  ]);
${JS_END}`;

function applyToSource(src) {
  const beginIdx = src.indexOf(JS_BEGIN);
  const endIdx = src.indexOf(JS_END);
  if (beginIdx === -1 || endIdx === -1) {
    throw new Error("PROTOCOL ENTITY ROUTES markers not found in jk_bms.js -- add them once by hand before running this generator.");
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
    console.log("DRIFT  jk_bms.js (PROTOCOL ENTITY ROUTES block out of date)");
    drift = true;
  }
  if (drift) {
    console.log("build_protocol_entity_routes.js --check: artifact(s) out of date. Run 'node tools/protocol/authoring/build_protocol_entity_routes.js' to regenerate.");
    process.exit(1);
  }
  console.log("build_protocol_entity_routes.js --check: no drift.");
  process.exit(0);
}

fs.writeFileSync(OUT_PATH, outJson, "utf8");
console.log(`wrote ${path.relative(ROOT, OUT_PATH)}`);
const jsSrc = fs.readFileSync(JS_PATH, "utf8");
const newJs = applyToSource(jsSrc);
if (newJs !== jsSrc) {
  fs.writeFileSync(JS_PATH, newJs, "utf8");
  console.log("wrote jk_bms.js (PROTOCOL ENTITY ROUTES block)");
}
console.log(`${routes.length} routes generated from read_plan.json.`);
