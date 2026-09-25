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
 * NON-REGISTER ROUTES (RS485 unified pipeline plan, Stage 2, 2026-09-25):
 * protocol/non_register_entities.canonical.json entries whose
 * esphome_configured_name is non-null -- i.e. a proven, non-internal
 * production publisher -- are routed from canonical data too, replacing
 * the hand registerEntity() calls in jk_bms.js. Entries with no production
 * publisher (browser-only, unpublished) and mock_backend_only entries get
 * NO route. Object ids: ESPHome's own object_id (slug of the configured
 * name) plus, where different, the YAML `id:` the browser already accepted
 * -- one tuple per object id, sharing domain and configured name.
 *
 * UNIQUENESS: the generator refuses to write if any (domain, configured
 * name) or (domain, object id) would resolve to two different keys --
 * registerEntity() fills a plain Map, so such a pair would otherwise be a
 * silent last-write-wins collision.
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
const NON_REGISTER_PATH = path.join(ROOT, "protocol", "non_register_entities.canonical.json");
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

const canonicalFieldByKey = new Map();
for (const reg of canonical.registers) for (const f of reg.fields || []) canonicalFieldByKey.set(f.key, f);

const routes = [];
const seenKeys = new Set();
for (const block of readPlan.blocks) {
  for (const field of block.fields) {
    if (field.key.endsWith("__legacy_companion")) continue; // owned by legacyCompanionEntities instead
    if (seenKeys.has(field.key)) {
      throw new Error(`PROTOCOL_ENTITY_ROUTES_DUPLICATE_KEY: "${field.key}" appears in more than one read_plan.json block -- refusing to generate an ambiguous route table.`);
    }
    seenKeys.add(field.key);
    // Internal-entity preference rule (2026-09-22 Settings read-value
    // correction): a read-plan field marked `internal: true` (e.g. the
    // DERIVED_BOOLEAN_OVERRIDE raw registers `charging_raw`/
    // `discharging_raw`/`balancing_raw`/`charging_control_raw`/etc.) is,
    // by ESPHome's own semantics, structurally never published over
    // `/events` -- routing a Settings row to it can never work, no matter
    // how correct the route mechanics are. When the SAME canonical field
    // already has its own populated, REAL public entity
    // (esphome_domain/esphome_read_entity_id -- e.g. canonical key
    // "charging_active" already declares esphome_domain: "binary_sensor",
    // esphome_read_entity_id: "charging", matching the real, already-
    // published `charging` binary_sensor that reads this same raw
    // register through a hand-written derived-boolean lambda in
    // batterylifepo4.yaml), that public entity is the real observable
    // production value path and is used instead. Never fabricated: if
    // canonical.json has no populated public entity for an internal
    // field, this falls through to the existing read-plan-derived
    // (internal) route unchanged, exactly as before this fix.
    const canonicalField = canonicalFieldByKey.get(field.key);
    if (field.internal && canonicalField && canonicalField.esphome_domain && canonicalField.esphome_read_entity_id) {
      routes.push({
        key: field.key,
        domain: canonicalField.esphome_domain,
        entityId: canonicalField.esphome_read_entity_id,
        configuredName: canonicalField.esphome_configured_name || humanize(canonicalField.esphome_read_entity_id),
      });
      continue;
    }
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
for (const key of excludedBespokeKeys) {
  if (seenKeys.has(key)) continue;
  const field = canonicalFieldByKey.get(key);
  if (!field) continue;
  if (field.effective_access !== "r" && field.effective_access !== "rw") continue;
  if (!field.esphome_read_entity_id || !field.esphome_domain) continue;
  seenKeys.add(key);
  routes.push({
    key,
    // esphome_read_domain (when stated) is the readback publisher's domain;
    // esphome_domain may be the write entity's (e.g. `number` for an RW field).
    domain: field.esphome_read_domain || field.esphome_domain,
    entityId: field.esphome_read_entity_id,
    configuredName: field.esphome_configured_name || humanize(field.esphome_read_entity_id),
  });
}

// ESPHome's object_id rule: lowercase, whitespace -> "_", drop anything
// outside [a-z0-9_-].
function esphomeObjectId(name) { return name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_-]/g, ""); }

const nonRegister = loadJson(NON_REGISTER_PATH);
for (const entity of nonRegister.entities) {
  if (entity.esphome_configured_name === null) continue; // no production publisher -> no route
  if (entity.category === "mock_backend_only") {
    throw new Error(`PROTOCOL_ENTITY_ROUTES_MOCK_PUBLISHER: "${entity.key}" is mock_backend_only but declares a production esphome_configured_name.`);
  }
  if (!entity.esphome_domain) {
    throw new Error(`PROTOCOL_ENTITY_ROUTES_NO_DOMAIN: "${entity.key}" has a configured name but no esphome_domain.`);
  }
  if (seenKeys.has(entity.key)) {
    throw new Error(`PROTOCOL_ENTITY_ROUTES_DUPLICATE_KEY: non-register "${entity.key}" is also a register route.`);
  }
  seenKeys.add(entity.key);
  const objectIds = [...new Set([esphomeObjectId(entity.esphome_configured_name), entity.esphome_yaml_id].filter(Boolean))];
  for (const objectId of objectIds) {
    routes.push({ key: entity.key, domain: entity.esphome_domain, entityId: objectId, configuredName: entity.esphome_configured_name });
  }
}

routes.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0));

const owner = new Map();
function claim(wire, key) {
  const prior = owner.get(wire);
  if (prior !== undefined && prior !== key) {
    throw new Error(`PROTOCOL_ENTITY_ROUTES_COLLISION: "${wire}" would resolve to both "${prior}" and "${key}".`);
  }
  owner.set(wire, key);
}
for (const r of routes) {
  claim(`${r.domain}/${r.configuredName || r.entityId}`, r.key);
  claim(`${r.domain}-${r.entityId}`, r.key);
}

// Retired secret publishers (security remediation 2026-09-25): entities that
// older firmware used to publish a credential field's raw value through
// (canonical retired_secret_read_entities). They get NO route; jk_bms.js
// registers their wire forms only to drop such payloads unrecorded.
const retiredSecretRoutes = [];
for (const reg of canonical.registers) {
  for (const f of reg.fields || []) {
    for (const e of f.retired_secret_read_entities || []) {
      if (f.write_safety_class !== "credential") {
        throw new Error(`PROTOCOL_ENTITY_ROUTES_RETIRED_SECRET_NOT_CREDENTIAL: "${f.key}" lists retired secret entities but is not credential-class.`);
      }
      retiredSecretRoutes.push({ field: f.key, domain: e.domain, entityId: e.entity_id, configuredName: e.configured_name });
      claim(`${e.domain}/${e.configured_name}`, `retired-credential-publisher/${f.key}`);
      claim(`${e.domain}-${e.entity_id}`, `retired-credential-publisher/${f.key}`);
    }
  }
}
retiredSecretRoutes.sort((a, b) => (a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0));

const contentHash = sha256(READ_PLAN_PATH) + sha256(CANONICAL_PATH) + sha256(NON_REGISTER_PATH);
const shortHash = crypto.createHash("sha256").update(contentHash).digest("hex").slice(0, 16);

const outDoc = {
  $schema: "protocol-entity-routes-generated-v1",
  generated_by: "tools/protocol/authoring/build_protocol_entity_routes.js",
  source_hash: shortHash,
  route_count: routes.length,
  routes,
  retired_secret_routes: retiredSecretRoutes,
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
  // tools/protocol/generate_read_plan.js from registers.canonical.json) and the
  // production-published entries of protocol/non_register_entities.canonical.json.
  // \`node tools/protocol/authoring/build_protocol_entity_routes.js --check\` fails if this block drifts.
  // ${routes.length} route tuples (a key may have one tuple per accepted object id), EXCLUDING every synthetic
  // \`*__legacy_companion\` entry (those stay owned exclusively by legacyCompanionEntities,
  // above/below -- see this table's own consumer loop for why that split is load-bearing).
  // Each tuple: [canonicalKey, esphomeDomain, entityId, configuredName].
  const PROTOCOL_ENTITY_ROUTES = Object.freeze([
${jsRoutes}
  ]);
  // Retired credential publishers (canonical retired_secret_read_entities):
  // wire forms registered ONLY so ingestPayload() drops the payload unrecorded.
  // Each tuple: [credentialFieldKey, esphomeDomain, entityId, configuredName].
  const RETIRED_SECRET_ENTITY_ROUTES = Object.freeze([
${retiredSecretRoutes.map((r) => `    [${jsStringLiteral(r.field)}, ${jsStringLiteral(r.domain)}, ${jsStringLiteral(r.entityId)}, ${jsStringLiteral(r.configuredName)}],`).join("\n")}
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
console.log(`${routes.length} route tuples (${new Set(routes.map((r) => r.key)).size} keys) generated from read_plan.json + non-register canonical.`);
