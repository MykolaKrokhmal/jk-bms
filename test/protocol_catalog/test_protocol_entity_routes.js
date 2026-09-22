#!/usr/bin/env node
"use strict";

// GENERATOR/MODEL TEST -- protocol-entity routing fix (2026-09-22).
// Runs the REAL generator (tools/protocol/authoring/build_protocol_entity_routes.js,
// not a reimplementation) and diffs its output against the committed
// artifacts to prove determinism, then loads the REAL jk_bms.js closures
// (via the same vm test-hook harness this project's other DOM tests use)
// to prove the COMBINED routing coverage invariant against the real,
// live entityByWireId Map every one of registerEntity()'s many call
// sites (hand-typed list + wireObjectIdAliases + PROTOCOL_ENTITY_ROUTES +
// legacyCompanionEntities + the cell-family loops) actually populates --
// not just this one new table in isolation.
//
// Covers (§5, Required routing coverage test):
//   - zero missing readable routes (every eligible R/RW Settings row with
//     a canonicalKey and a real runtime entity is reachable in
//     entityByWireId);
//   - zero conflicting routes (no two canonical keys claim the same
//     domain+entity_id);
//   - zero routes to a different canonical key (every route's key
//     matches a real registers.canonical.json field whose own
//     esphome_read_entity_id agrees);
//   - no non-register/derived entity enters BMS Settings (PROTOCOL_ENTITY_ROUTES
//     never contains a non_register_entities.canonical.json key);
//   - unmapped/W rows need no read route;
//   - legacy companions excluded from primary-route uniqueness and
//     explicitly suppressed (zero `__legacy_companion` keys in
//     PROTOCOL_ENTITY_ROUTES; all 5 known legacy companions still map to
//     LEGACY_COMPANION_SUPPRESSED via the unchanged legacyCompanionEntities
//     mechanism).

const fs = require("fs");
const path = require("path");
const vm = require("vm");
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
const genPath = path.join(ROOT, "tools", "protocol", "authoring", "build_protocol_entity_routes.js");
const outPath = path.join(ROOT, "protocol", "generated", "protocol_entity_routes.json");
const jsPath = path.join(ROOT, "jk_bms.js");

const before = { json: fs.readFileSync(outPath, "utf8"), js: fs.readFileSync(jsPath, "utf8") };
execFileSync(process.execPath, [genPath], { cwd: ROOT });
const after = { json: fs.readFileSync(outPath, "utf8"), js: fs.readFileSync(jsPath, "utf8") };
check("regenerating is byte-identical to the committed artifacts (deterministic)", before.json === after.json && before.js === after.js);

let checkExitCode = 0;
try { execFileSync(process.execPath, [genPath, "--check"], { cwd: ROOT }); } catch (e) { checkExitCode = e.status; }
check("generator --check reports no drift (exit 0)", checkExitCode === 0);

const routesDoc = JSON.parse(fs.readFileSync(outPath, "utf8"));
const canonical = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "registers.canonical.json"), "utf8"));
const nonRegister = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "non_register_entities.canonical.json"), "utf8"));
const settingsViewModel = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "generated", "settings_view_model.json"), "utf8"));
const readPlan = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "generated", "read_plan.json"), "utf8"));

const canonicalFieldByKey = new Map();
for (const reg of canonical.registers) for (const f of reg.fields || []) canonicalFieldByKey.set(f.key, f);

// ---------------------------------------------------------------------------
// 2. Structural route-table invariants.
// ---------------------------------------------------------------------------
check("zero `__legacy_companion` synthetic keys in PROTOCOL_ENTITY_ROUTES", routesDoc.routes.every((r) => !r.key.endsWith("__legacy_companion")));
const routeKeys = routesDoc.routes.map((r) => r.key);
check("no duplicate canonical key across routes", new Set(routeKeys).size === routeKeys.length, `unique=${new Set(routeKeys).size} total=${routeKeys.length}`);
check("zero routes for a non_register_entities.canonical.json key", routesDoc.routes.every((r) => !nonRegister.entities.some((e) => e.key === r.key)));

// Zero conflicting routes: no two DIFFERENT canonical keys share the same
// (domain, entityId) wire identity.
const byWireIdentity = new Map();
const conflicts = [];
for (const r of routesDoc.routes) {
  const wireId = `${r.domain}/${r.entityId}`;
  if (byWireIdentity.has(wireId) && byWireIdentity.get(wireId) !== r.key) {
    conflicts.push({ wireId, keys: [byWireIdentity.get(wireId), r.key] });
  }
  byWireIdentity.set(wireId, r.key);
}
check("zero conflicting routes (no two canonical keys share the same domain+entityId)", conflicts.length === 0, JSON.stringify(conflicts));

// Zero routes to a different canonical key: every route's own key must
// name a real canonical field whose own esphome_read_entity_id agrees.
let noMisroute = true;
const misroutes = [];
// Ordinary (generic-block) routes: cross-checked against read_plan.json's
// own field entry for the same key -- the authoritative, ACTUAL-wire-
// behavior source (it applies read-plan-level overrides, e.g.
// DERIVED_BOOLEAN_OVERRIDE's separate "_raw" read entities, and the
// read-side domain for a write-capable field, that legitimately differ
// from canonical.json's own raw declared esphome_domain/
// esphome_read_entity_id -- comparing against canonical.json directly
// for these would be the WRONG invariant).
const readPlanFieldByKey = new Map();
for (const block of readPlan.blocks) for (const f of block.fields) if (!f.key.endsWith("__legacy_companion")) readPlanFieldByKey.set(f.key, f);
const excludedBespokeKeys = new Set(readPlan.excluded_bespoke_keys || []);

for (const r of routesDoc.routes) {
  if (excludedBespokeKeys.has(r.key)) {
    // Bespoke-reader route: sourced directly from registers.canonical.json
    // (read_plan.json deliberately excludes these -- no generic block).
    const field = canonicalFieldByKey.get(r.key);
    const expectedConfiguredName = field && (field.esphome_configured_name || r.entityId.replace(/_/g, " "));
    if (!field || field.esphome_read_entity_id !== r.entityId || field.esphome_domain !== r.domain || expectedConfiguredName !== r.configuredName) {
      noMisroute = false;
      misroutes.push({ key: r.key, source: "bespoke", route: r, canonical: field ? { domain: field.esphome_domain, entityId: field.esphome_read_entity_id, expectedConfiguredName } : "NO_CANONICAL_FIELD" });
    }
    continue;
  }
  const f = readPlanFieldByKey.get(r.key);
  if (!f) {
    noMisroute = false;
    misroutes.push({ key: r.key, source: "read_plan", route: r, readPlan: "NOT_IN_READ_PLAN" });
    continue;
  }
  // Internal-entity preference rule (Settings read-value fix, 2026-09-22):
  // a read-plan field marked internal:true routes to its OWN canonical
  // field's public esphome_domain/esphome_read_entity_id instead, when
  // populated -- the read-plan entity is structurally unobservable over
  // /events (ESPHome internal:true), so routing there could never work.
  const canonicalField = canonicalFieldByKey.get(r.key);
  const preferCanonical = f.internal && canonicalField && canonicalField.esphome_domain && canonicalField.esphome_read_entity_id;
  if (preferCanonical) {
    const expectedConfiguredName = canonicalField.esphome_configured_name || canonicalField.esphome_read_entity_id.replace(/_/g, " ");
    if (canonicalField.esphome_domain !== r.domain || canonicalField.esphome_read_entity_id !== r.entityId || expectedConfiguredName !== r.configuredName) {
      noMisroute = false;
      misroutes.push({ key: r.key, source: "read_plan_internal_override", route: r, canonical: { domain: canonicalField.esphome_domain, entityId: canonicalField.esphome_read_entity_id, expectedConfiguredName } });
    }
    continue;
  }
  if (f.entity_id !== r.entityId || f.domain !== r.domain || f.configured_name !== r.configuredName) {
    noMisroute = false;
    misroutes.push({ key: r.key, source: "read_plan", route: r, readPlan: { domain: f.domain, entityId: f.entity_id, configuredName: f.configured_name } });
  }
}
check("every route's domain/entityId/configuredName exactly matches its own authoritative source (read_plan.json for generic-block fields, registers.canonical.json for bespoke-reader fields)",
  noMisroute, JSON.stringify(misroutes.slice(0, 5)));

// ---------------------------------------------------------------------------
// 3. Combined coverage invariant, checked against the REAL live
// entityByWireId Map (every registration mechanism combined -- hand-typed
// calls, wireObjectIdAliases, PROTOCOL_ENTITY_ROUTES, legacyCompanionEntities,
// and the cell-family loops), not this generator's table in isolation.
// ---------------------------------------------------------------------------
const source = fs.readFileSync(jsPath, "utf8");
class FakeNode {
  constructor(t) { this.tagName = t; this.childNodes = []; this.dataset = {}; this._classSet = new Set(); this.disabled = false; this.value = ""; this.classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } }; this.attributes = {}; this._id = ""; }
  get id() { return this._id; } set id(v) { this._id = v; }
  set textContent(v) { this._t = v; } get textContent() { return this._t || ""; }
  setAttribute() {} getAttribute() { return null; }
  appendChild(c) { this.childNodes.push(c); return c; } append(...c) { c.forEach((x) => this.appendChild(x)); }
  querySelectorAll() { return []; } querySelector() { return null; } addEventListener() {} getContext() { return {}; }
}
const window = {
  __JK_BMS_TEST_HOOKS__: {}, location: { href: "http://x/" }, addEventListener() {}, matchMedia() { return { matches: false }; },
  cancelAnimationFrame() {}, requestAnimationFrame(cb) { return setImmediate(cb); }, clearInterval() {}, setInterval() {},
  setTimeout: (cb) => setTimeout(cb, 0), clearTimeout: (id) => clearTimeout(id),
  fetch: async () => { throw new Error("unexpected fetch"); }, confirm: () => true,
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
};
const document = {
  documentElement: new FakeNode("html"), scrollingElement: { scrollTop: 0 }, readyState: "complete",
  createElement(t) { return new FakeNode(t); }, createDocumentFragment() { return new FakeNode("#fragment"); },
  addEventListener() {}, getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; },
  activeElement: null, body: new FakeNode("body"),
};
class HTMLInputElement {}
const sandbox = { window, document, navigator: { language: "en" }, URL, console, Map, HTMLInputElement, AbortController, fetch: window.fetch, confirm: window.confirm };
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: "jk_bms.js" });
const hooks = window.__JK_BMS_TEST_HOOKS__;
if (!hooks.entityByWireId) throw new Error("test hook shape drifted -- entityByWireId not exposed");

const reachableKeys = new Set([...hooks.entityByWireId.values()].filter((v) => v !== hooks.LEGACY_COMPANION_SUPPRESSED));

const eligibleNonCellRows = settingsViewModel.rows.filter((r) => r.canonicalKey && ["R", "RW"].includes(r.access) && r.compositeGroup !== "cell");
const missingRoutes = eligibleNonCellRows.filter((r) => !reachableKeys.has(r.canonicalKey));
check("zero missing readable routes: every eligible non-cell R/RW Settings row's canonicalKey is reachable in the REAL, live entityByWireId Map",
  missingRoutes.length === 0, JSON.stringify(missingRoutes.map((r) => r.manifestId).slice(0, 10)));

// unmapped/W rows need no read route (sanity: they simply aren't asserted
// above at all, since the filter requires a real canonicalKey).
const unmappedOrW = settingsViewModel.rows.filter((r) => !r.canonicalKey || r.access === "W");
check("unmapped/W rows are correctly excluded from the route-coverage requirement (no canonicalKey to route)",
  unmappedOrW.every((r) => !r.canonicalKey));

// ---------------------------------------------------------------------------
// 4. Legacy-companion suppression, unchanged.
// ---------------------------------------------------------------------------
const KNOWN_LEGACY_COMPANIONS = ["rtc_ticks", "odd_run_time", "bms_system_ticks", "total_runtime", "cell_connected_mask"];
let legacySuppressionIntact = true;
for (const key of KNOWN_LEGACY_COMPANIONS) {
  const field = canonicalFieldByKey.get(key);
  if (!field || !field.legacy_companion_entity_id) { legacySuppressionIntact = false; continue; }
  const wireId = field.legacy_companion_entity_id;
  if (hooks.entityByWireId.get(wireId) !== hooks.LEGACY_COMPANION_SUPPRESSED) legacySuppressionIntact = false;
}
check("all 5 known legacy companions (rtc_ticks/odd_run_time/bms_system_ticks/total_runtime/cell_connected_mask) still map to LEGACY_COMPANION_SUPPRESSED",
  legacySuppressionIntact);
check("each legacy companion's REAL exact primary key still resolves to itself, not the suppression sentinel",
  KNOWN_LEGACY_COMPANIONS.every((key) => reachableKeys.has(key)));

// ---------------------------------------------------------------------------
// 5. Settings read-value fix (2026-09-22): the 5 target keys' route table
// contract, and the generic internal-entity-avoidance invariant.
// ---------------------------------------------------------------------------
const routeByKey = new Map(routesDoc.routes.map((r) => [r.key, r]));
const TARGET_KEYS = ["total_voltage_raw", "current_raw", "heating_active", "charging_active", "discharging_active"];
check("exactly one unambiguous route exists for each of the 5 target keys",
  TARGET_KEYS.every((k) => routeByKey.has(k)), JSON.stringify(TARGET_KEYS.filter((k) => !routeByKey.has(k))));

check("total_voltage_raw routes to sensor/total_voltage_raw (its own canonical public entity, never total_voltage's wire id)",
  (() => { const r = routeByKey.get("total_voltage_raw"); return r && r.domain === "sensor" && r.entityId === "total_voltage_raw"; })());
check("current_raw routes to sensor/current_raw (its own canonical public entity, never current's wire id)",
  (() => { const r = routeByKey.get("current_raw"); return r && r.domain === "sensor" && r.entityId === "current_raw"; })());
check("heating_active routes to its real binary_sensor entity",
  (() => { const r = routeByKey.get("heating_active"); return r && r.domain === "binary_sensor" && r.entityId === "heating_active"; })());
check("charging_active routes to the PUBLIC binary_sensor/charging, never the internal charging_raw",
  (() => { const r = routeByKey.get("charging_active"); return r && r.domain === "binary_sensor" && r.entityId === "charging"; })());
check("discharging_active routes to the PUBLIC binary_sensor/discharging, never the internal discharging_raw",
  (() => { const r = routeByKey.get("discharging_active"); return r && r.domain === "binary_sensor" && r.entityId === "discharging"; })());
check("balancing_active (not individually required, but covered by the generic rule) routes to the PUBLIC binary_sensor/balancing",
  (() => { const r = routeByKey.get("balancing_active"); return r && r.domain === "binary_sensor" && r.entityId === "balancing"; })());

// Generic invariant: no route in the ENTIRE table points at an
// internal:true read-plan entity when the same canonical field has a
// populated public alternative -- proves the rule was applied generically
// (§3's "apply the rule generically", not just hand-patched for 5 keys).
const wronglyInternal = [];
for (const [key, field] of readPlanFieldByKey) {
  if (!field.internal) continue;
  const canonicalField = canonicalFieldByKey.get(key);
  if (!canonicalField || !canonicalField.esphome_domain || !canonicalField.esphome_read_entity_id) continue;
  const route = routeByKey.get(key);
  if (!route) continue;
  if (route.domain === field.domain && route.entityId === field.entity_id) {
    wronglyInternal.push({ key, route, internalEntity: { domain: field.domain, entityId: field.entity_id } });
  }
}
check("no route points only to an internal:true entity when a canonical public entity exists (applied generically)",
  wronglyInternal.length === 0, JSON.stringify(wronglyInternal));

// total_voltage_raw/current_raw must never reuse total_voltage/current's
// own wire identity (distinct canonical entities, distinct wire routes).
check("total_voltage_raw/current_raw do not steal total_voltage/current's own wire route",
  (() => {
    const tvr = routeByKey.get("total_voltage_raw");
    const cr = routeByKey.get("current_raw");
    const tv = readPlanFieldByKey.get("total_voltage");
    const cu = readPlanFieldByKey.get("current");
    if (!tvr || !cr) return false;
    const tvClash = tv && tv.domain === tvr.domain && tv.entity_id === tvr.entityId;
    const cuClash = cu && cu.domain === cr.domain && cu.entity_id === cr.entityId;
    return !tvClash && !cuClash;
  })());

// ---------------------------------------------------------------------------
// 6. Production entityByWireId proof: the two new sensors and the three
// internal-avoidance rows are ALL reachable in the real, live Map (not
// just present in the generated table) -- reuses the same hooks/
// reachableKeys computed above (§3).
// ---------------------------------------------------------------------------
check("total_voltage_raw/current_raw/heating_active/charging_active/discharging_active are all reachable in the real, live entityByWireId Map",
  TARGET_KEYS.every((k) => reachableKeys.has(k)), JSON.stringify(TARGET_KEYS.filter((k) => !reachableKeys.has(k))));
check("balancing_active is also reachable (generic rule, not a target key but covered)",
  reachableKeys.has("balancing_active"));

console.log(`\nprotocol entity routes generator/model summary: ${checks - failures}/${checks} passed`);
process.exit(failures ? 1 : 0);
