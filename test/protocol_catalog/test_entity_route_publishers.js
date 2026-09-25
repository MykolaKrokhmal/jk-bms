#!/usr/bin/env node
"use strict";

// Generated entity routes vs their real ESPHome publishers (RS485 unified
// pipeline plan, Stage 2). Proves, against the REAL generated route table,
// the REAL jk_bms.js closures and the REAL firmware YAML:
//   A. the route generator is deterministic (--check, no drift);
//   B. every route tuple matches exactly one non-internal ESPHome entity of
//      the same domain and configured `name:`, and its object id is that
//      entity's ESPHome object_id (name slug) or its YAML `id:`;
//   C. route completeness (every implemented register key and every
//      production-published non-register key is routed; nothing without a
//      production publisher is) and uniqueness (no wire form maps to two
//      keys) -- each check is also run against deliberately corrupted route
//      tables to prove it fails;
//   D. runtime resolution: no last-write-wins collision in entityByWireId, no
//      canonical key registered by hand, every wire id the real device
//      emitted in the committed hardware captures resolves, the 8 calculated
//      keys reach state through ingestPayload, read_plan_success stays
//      early-consumed, browser-only keys stay unrouted;
//   E. the Cells panel shows the backend-published voltage extremes, never a
//      browser recomputation, and shows "--" (no substitute) when missing.

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));

let checks = 0;
let failures = 0;
function check(name, condition, detail = "") {
  checks += 1;
  if (!condition) failures += 1;
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` -- ${detail}` : ""}`);
}

// ---------------------------------------------------------------------------
// Minimal YAML entity reader: for every `- platform:` item under an ESPHome
// entity domain, each `name:` line (at any depth -- e.g. wifi_info's nested
// ip_address) with its sibling `id:` / `internal:` lines at the same indent.
// ---------------------------------------------------------------------------
const ENTITY_DOMAINS = new Set(["sensor", "binary_sensor", "text_sensor", "number", "select", "switch", "text", "button"]);
function readYamlEntities(rel) {
  const lines = fs.readFileSync(path.join(ROOT, rel), "utf8").split("\n");
  const indentOf = (l) => l.search(/\S/);
  const out = [];
  let domain = null;
  for (let i = 0; i < lines.length; i += 1) {
    const top = /^([a-z_]+):\s*$/.exec(lines[i]);
    if (top) { domain = top[1]; continue; }
    const nm = /^(\s+)name:\s*"?([^"#]*?)"?\s*$/.exec(lines[i]);
    if (!nm || !ENTITY_DOMAINS.has(domain)) continue;
    const ind = nm[1].length;
    const sibling = (re) => {
      for (const dir of [-1, 1]) {
        for (let j = i + dir; j >= 0 && j < lines.length; j += dir) {
          const l = lines[j];
          if (!l.trim() || /^\s*#/.test(l)) continue;
          const li = indentOf(l);
          if (li < ind || (li === ind - 2 && /^\s*-/.test(l) && dir === 1)) break;
          if (li === ind && re.test(l)) return re.exec(l);
          if (li === ind - 2 && /^\s*- /.test(l)) break;
        }
      }
      return null;
    };
    const id = sibling(/^\s*-?\s*id:\s*(\S+)/);
    out.push({ file: rel, line: i + 1, domain, name: nm[2], id: id ? id[1] : null, internal: !!sibling(/^\s*internal:\s*true/) });
  }
  return out;
}
const yamlEntities = ["batterylifepo4.yaml", "protocol/generated/read_plan.yaml", "protocol/generated/write_registry.yaml"]
  .flatMap(readYamlEntities);
const esphomeObjectId = (name) => name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_-]/g, "");

// ---------------------------------------------------------------------------
// A. Determinism
// ---------------------------------------------------------------------------
const gen = spawnSync(process.execPath, [path.join(ROOT, "tools/protocol/authoring/build_protocol_entity_routes.js"), "--check"], { encoding: "utf8" });
check("A. build_protocol_entity_routes.js --check: generated routes have no drift", gen.status === 0, (gen.stdout || "").trim().split("\n").pop());

// ---------------------------------------------------------------------------
// B/C. Route table checks (pure functions, also run on corrupted copies)
// ---------------------------------------------------------------------------
const routeDoc = readJson("protocol/generated/protocol_entity_routes.json");
const routes = routeDoc.routes;
const registerFields = readJson("protocol/registers.canonical.json").registers.flatMap((r) => r.fields);
const nonRegister = readJson("protocol/non_register_entities.canonical.json").entities;

function publisherErrors(table) {
  const errors = [];
  for (const r of table) {
    const name = r.configuredName;
    const matches = yamlEntities.filter((e) => e.domain === r.domain && e.name === name && !e.internal);
    if (matches.length !== 1) { errors.push(`${r.key}: ${r.domain}/"${name}" has ${matches.length} non-internal publishers`); continue; }
    const e = matches[0];
    if (r.entityId !== esphomeObjectId(name) && r.entityId !== e.id) errors.push(`${r.key}: object id "${r.entityId}" is neither the name slug nor YAML id "${e.id}"`);
  }
  return errors;
}
function completenessErrors(table) {
  const routed = new Set(table.map((r) => r.key));
  const errors = [];
  for (const f of registerFields) {
    if (f.implementation_status === "implemented" && !routed.has(f.key)) errors.push(`register ${f.key} unrouted`);
  }
  for (const e of nonRegister) {
    const tuples = table.filter((r) => r.key === e.key);
    if (e.esphome_configured_name === null && tuples.length) errors.push(`${e.key} routed without a production publisher`);
    if (e.esphome_configured_name !== null && !tuples.some((t) => t.domain === e.esphome_domain && t.configuredName === e.esphome_configured_name)) {
      errors.push(`${e.key} (published as ${e.esphome_domain}/"${e.esphome_configured_name}") has no matching route`);
    }
  }
  return errors;
}
function uniquenessErrors(table) {
  const owner = new Map();
  const errors = [];
  for (const r of table) {
    for (const wire of [`${r.domain}/${r.configuredName}`, `${r.domain}-${r.entityId}`]) {
      const prior = owner.get(wire);
      if (prior !== undefined && prior !== r.key) errors.push(`${wire}: ${prior} vs ${r.key}`);
      owner.set(wire, r.key);
    }
  }
  return errors;
}

check("B. every route tuple has a configured name", routes.every((r) => typeof r.configuredName === "string" && r.configuredName.length > 0));
const pubErrors = publisherErrors(routes);
check(`B. every route (${routes.length} tuples) matches exactly one non-internal ESPHome publisher of the same domain and name`, pubErrors.length === 0, JSON.stringify(pubErrors.slice(0, 5)));
const compErrors = completenessErrors(routes);
check("C. route completeness: every implemented register key and every production-published non-register key is routed; nothing unpublished is",
  compErrors.length === 0, JSON.stringify(compErrors.slice(0, 5)));
check("C. route uniqueness: no domain/name or domain-object-id form maps to two keys", uniquenessErrors(routes).length === 0);
const noRoute = nonRegister.filter((e) => e.esphome_configured_name === null).map((e) => `${e.key}:${e.category}`);
check("C. keys without a production publisher (mock-only, browser-only, unpublished) have no generated route",
  noRoute.length > 0 && noRoute.every((k) => !routes.some((r) => r.key === k.split(":")[0])), JSON.stringify(noRoute));

// Corruption must be detected.
const without = routes.filter((r) => r.key !== "charging_power");
check("C. corruption: removing the charging_power route is detected as incomplete", completenessErrors(without).some((e) => e.startsWith("charging_power")));
const wrongDomain = routes.map((r) => (r.key === "min_cell_voltage" ? { ...r, domain: "number" } : r));
check("C. corruption: a wrong domain on min_cell_voltage is detected against the real publisher", publisherErrors(wrongDomain).some((e) => e.startsWith("min_cell_voltage")));
const conflicting = routes.concat([{ key: "max_cell_voltage", domain: "sensor", entityId: "min_cell_voltage", configuredName: "min cell voltage" }]);
check("C. corruption: a second key claiming an existing wire form is detected", uniquenessErrors(conflicting).length > 0);

// ---------------------------------------------------------------------------
// D. Runtime resolution through the real closures
// ---------------------------------------------------------------------------
const overwriteLog = [];
class RecordingMap extends Map {
  set(k, v) { if (this.has(k) && this.get(k) !== v) overwriteLog.push([k, this.get(k), v]); return super.set(k, v); }
}
function loadClosures(extra = {}) {
  const window = {
    __JK_BMS_TEST_HOOKS__: {}, location: { href: "http://jk-bms.local/" }, addEventListener() {}, matchMedia() { return { matches: false }; },
    requestAnimationFrame() { return 0; }, cancelAnimationFrame() {}, setInterval() { return 0; }, clearInterval() {}, setTimeout() { return 0; }, clearTimeout() {},
  };
  const document = Object.assign({
    readyState: "complete", addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll() { return []; },
    scrollingElement: { scrollTop: 0 }, createElement() { return { getContext() { return { measureText() { return { width: 0 }; } }; } }; },
  }, extra.document || {});
  const sandbox = { window, document, navigator: { language: "en" }, URL, console, Map: extra.Map || Map, HTMLInputElement: class {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "jk_bms.js"), "utf8"), sandbox, { filename: "jk_bms.js" });
  return window.__JK_BMS_TEST_HOOKS__;
}
const hooks = loadClosures({ Map: RecordingMap });
const { entityByWireId, ingestPayload, numeric, state } = hooks;

check("D. entityByWireId has no last-write-wins collision (no wire id re-assigned to a different key)", overwriteLog.length === 0, JSON.stringify(overwriteLog.slice(0, 3)));
const unresolvedRoutes = routes.filter((r) => entityByWireId.get(`${r.domain}/${r.configuredName}`) !== r.key || entityByWireId.get(`${r.domain}-${r.entityId}`) !== r.key);
check("D. every generated route's wire forms resolve to exactly its own key at runtime", unresolvedRoutes.length === 0, JSON.stringify(unresolvedRoutes.slice(0, 3)));

// Hand registrations (outside generated blocks) are only for canonical keys
// without a production publisher (mock_backend_only).
const src = fs.readFileSync(path.join(ROOT, "jk_bms.js"), "utf8");
const handKeys = [...src.matchAll(/\n\s*registerEntity\("([a-z0-9_]+)"/g)].map((m) => m[1]);
const mockOnly = new Set(nonRegister.filter((e) => e.category === "mock_backend_only").map((e) => e.key));
const routedKeys = new Set(routes.map((r) => r.key));
check("D. no canonical routed key is registered by hand; hand registration is limited to mock_backend_only keys",
  handKeys.length > 0 && handKeys.every((k) => mockOnly.has(k) && !routedKeys.has(k)), JSON.stringify(handKeys));

// Every wire id the real device emitted (committed hardware captures).
const captured = new Set();
for (const f of ["hw_retest_c56a052_smoke_20260918.log", "hw_retest_260cbba_smoke_20260918.log", "hw_retest_c56a052_sse_6min_20260918.log"]) {
  const text = fs.readFileSync(path.join(ROOT, "protocol/evidence/stage1_corrective_evidence", f), "utf8");
  for (const m of text.matchAll(/"id":"([^"]+)"/g)) captured.add(m[1]);
}
const unresolvedHw = [...captured].filter((id) => !entityByWireId.has(id));
check(`D. all ${captured.size} entity ids emitted by the real device (committed hardware captures) resolve`, captured.size > 200 && unresolvedHw.length === 0, JSON.stringify(unresolvedHw));

const CALCULATED = [
  ["charging_power", "sensor/charging power", 12.5, "12.50 W"], ["discharging_power", "sensor/discharging power", 0, "0.00 W"],
  ["charging_current", "sensor/charging current", 0.25, "0.250 A"], ["discharging_current", "sensor/discharging current", 0, "0.000 A"],
  ["min_cell_voltage", "sensor/min cell voltage", 3.301, "3.301 V"], ["max_cell_voltage", "sensor/max cell voltage", 3.342, "3.342 V"],
  ["min_voltage_cell", "sensor/min voltage cell", 7, "7"], ["max_voltage_cell", "sensor/max voltage cell", 12, "12"],
];
for (const [key, wireId, value, stateText] of CALCULATED) {
  ingestPayload({ id: wireId, domain: "sensor", name: wireId.slice(7), value, state: stateText });
  const routeOk = routes.some((r) => r.key === key && r.domain === "sensor" && `sensor/${r.configuredName}` === wireId);
  check(`D. ${key}: HA-facing publisher wire id "${wireId}" -> real ingestPayload -> canonical browser state`,
    routeOk && entityByWireId.get(wireId) === key && numeric(key) === value && !!state[key]);
}

ingestPayload({ id: "text_sensor/read plan success", value: "4096:1", state: "4096:1" });
check("D. read_plan_success is routed but consumed early (never written to state)", entityByWireId.get("text_sensor/read plan success") === "read_plan_success" && !state.read_plan_success);
const browserOnly = nonRegister.filter((e) => e.category === "esp32_browser_ui" && e.esphome_configured_name === null).map((e) => e.key);
check("D. browser-only keys have no wire route", browserOnly.length > 0 && browserOnly.every((k) => ![...entityByWireId.values()].includes(k)), JSON.stringify(browserOnly));
check("D. the mock-only control_override_reason still resolves for the demo backend", entityByWireId.get("text_sensor-control_override_reason") === "control_override_reason");

// ---------------------------------------------------------------------------
// E. Cells panel: backend-published voltage extremes win
// ---------------------------------------------------------------------------
class Node {
  constructor(tag) { this.tagName = tag; this.childNodes = []; this.textContent = ""; this.className = ""; this.style = { setProperty() {} }; this._html = ""; }
  set innerHTML(v) { this._html = v; if (v === "") this.childNodes = []; }
  get innerHTML() { return this._html; }
  appendChild(c) { this.childNodes.push(c); return c; }
  setAttribute() {}
  getContext() { return { measureText() { return { width: 0 }; } }; }
}
const dom = new Map(["statMinCells", "statMaxCells", "statDeltaCells", "statAvgCells", "synthCellsValue", "barColsCells", "barLabelsCells"].map((id) => [id, new Node("div")]));
const cellHooks = loadClosures({ document: { getElementById: (id) => dom.get(id) || null, createElement: (tag) => new Node(tag) } });
const feed = (id, value, stateText) => cellHooks.ingestPayload({ id, value, state: stateText === undefined ? String(value) : stateText });
feed("text_sensor/topology state", "CONFIRMED");
feed("sensor/display cell count", 4);
[3.30, 3.25, 3.40, 3.35].forEach((v, i) => feed(`sensor/cell voltage ${i + 1}`, v, `${v.toFixed(3)} V`));
const text = (id) => dom.get(id).textContent;
const barClasses = () => dom.get("barColsCells").childNodes.map((c) => c.className);
cellHooks.renderCells();
check("E. with no backend extremes, Min/Max/spread show \"--\" -- no browser-computed substitute",
  text("statMinCells") === "--" && text("statMaxCells") === "--" && text("synthCellsValue") === "--" && text("statDeltaCells") === "--",
  `${text("statMinCells")} ${text("statMaxCells")} ${text("synthCellsValue")}`);
check("E. with no backend extreme cells, no bar is highlighted as min/max", barClasses().every((c) => c === "bar-col"), JSON.stringify(barClasses()));
// Backend values deliberately differ from what the browser would compute
// (browser: min 3.25 @ cell 2, max 3.40 @ cell 3).
feed("sensor/min cell voltage", 3.2, "3.200 V");
feed("sensor/max cell voltage", 3.45, "3.450 V");
feed("sensor/min voltage cell", 1, "1");
feed("sensor/max voltage cell", 4, "4");
cellHooks.renderCells();
check("E. Min/Max show the backend-published values, not the browser recomputation", text("statMinCells") === "3.200 V" && text("statMaxCells") === "3.450 V",
  `${text("statMinCells")} / ${text("statMaxCells")}`);
check("E. spread (Cells tile and delta) derives from the backend extremes", text("synthCellsValue") === "250 mV" && text("statDeltaCells") === "250 mV",
  `${text("synthCellsValue")} / ${text("statDeltaCells")}`);
check("E. highlighted min/max cells are the backend-reported cells 1 and 4", JSON.stringify(barClasses()) === JSON.stringify(["bar-col min", "bar-col", "bar-col", "bar-col max"]),
  JSON.stringify(barClasses()));
feed("sensor/min voltage cell", NaN, "nan");
cellHooks.renderCells();
check("E. a backend 'no plausible cell' (NaN) index clears that highlight instead of substituting the browser's cell 2",
  JSON.stringify(barClasses()) === JSON.stringify(["bar-col", "bar-col", "bar-col", "bar-col max"]), JSON.stringify(barClasses()));

console.log(`\nentity route publishers: ${checks - failures}/${checks} passed`);
process.exit(failures ? 1 : 0);
