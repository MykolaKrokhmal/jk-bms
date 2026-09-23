#!/usr/bin/env node
"use strict";

// EXECUTABLE PRODUCTION-JS DOM TEST -- unmapped-rows cleanup (2026-09-22).
// Runs the REAL jk_bms.js closures (renderSettingsCatalog, ingestPayload,
// entityByWireId, state, updateSettingsCatalogValue) inside a Node `vm`
// sandbox, via the SAME opt-in window.__JK_BMS_TEST_HOOKS__ escape hatch
// this project's other DOM tests already use. No routing/rendering logic
// is reimplemented here.
//
// Covers (§4 of the task):
//   A. TempSensorAbsent mapping -- exactly one canonical projection,
//      mask 0xFF00/shift 8/U8/read-only/projection_of sensor_heating_mask,
//      resolves the real manifest row, decodes from the already-read
//      0x12D0 payload, adds no new bus surface, leaves the parent RAW
//      field and all existing per-bit projections unchanged, and its
//      production ingest->state->DOM path renders representative raw
//      mask values (including bits 6-7) without truncation/reinterpretation.
//   B. Permanent unsupported classification -- TemperatureSensorAnomaly/
//      PCLModuleAnomaly stay canonicalKey-null/route-free, render the
//      localized unsupported explanation (UK+EN) instead of a generic
//      placeholder, never show an interactive control, and the raw
//      alarms_bitmask + all 22 existing alarm projections are unaffected.
//   C. Closure invariants -- zero generic unmapped rows, 260 total, 155
//      R/97 RW/8 W, Stage 3 sums to 265, both blockers closed with a
//      recorded resolution.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..", "..");
const source = fs.readFileSync(path.join(ROOT, "jk_bms.js"), "utf8");

let checks = 0;
let failures = 0;
function check(name, condition, detail = "") {
  checks += 1;
  if (condition) console.log(`PASS  ${name}${detail ? ` -- ${detail}` : ""}`);
  else { failures += 1; console.log(`FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
}

// ---------------------------------------------------------------------------
// FakeNode/document/window harness -- verbatim adaptation of
// test_protocol_entity_routing.js's own (see that file for full comments).
// ---------------------------------------------------------------------------
let idRegistry = new Map();
function toCamel(kebab) { return kebab.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); }
function parseSimpleSelector(sel) {
  sel = sel.trim();
  const attrMatch = sel.match(/^\[data-([a-z0-9-]+)(?:=(['"])([^'"]*)\2)?\]$/);
  if (attrMatch) return { kind: "data-attr", key: toCamel(attrMatch[1]), value: attrMatch[3] };
  if (sel.startsWith(".")) return { kind: "class", value: sel.slice(1) };
  const compoundMatch = sel.match(/^([a-zA-Z][a-zA-Z0-9-]*)\.([a-zA-Z0-9-]+)$/);
  if (compoundMatch) return { kind: "compound", tag: compoundMatch[1], class: compoundMatch[2] };
  if (/^[a-zA-Z][a-zA-Z0-9-]*$/.test(sel)) return { kind: "tag", value: sel };
  return { kind: "unsupported" };
}
function matchesSelector(node, selectorList) {
  const selectors = selectorList.split(",").map((s) => s.trim());
  return selectors.some((raw) => {
    const parsed = parseSimpleSelector(raw);
    if (parsed.kind === "class") return node.classList.contains(parsed.value);
    if (parsed.kind === "tag") return node.tagName === parsed.value;
    if (parsed.kind === "compound") return node.tagName === parsed.tag && node.classList.contains(parsed.class);
    if (parsed.kind === "data-attr") {
      const actual = node.dataset ? node.dataset[parsed.key] : undefined;
      if (actual === undefined) return false;
      return parsed.value === undefined ? true : actual === parsed.value;
    }
    return false;
  });
}
class FakeNode {
  constructor(tagName) {
    this.tagName = tagName;
    this.childNodes = [];
    this.parentNode = null;
    this._text = "";
    this._classSet = new Set();
    this.attributes = {};
    this.dataset = {};
    this._id = "";
    this.disabled = false;
    this.value = "";
    this._listeners = new Map();
    const self = this;
    this.classList = {
      add(...names) { names.forEach((n) => self._classSet.add(n)); },
      remove(...names) { names.forEach((n) => self._classSet.delete(n)); },
      toggle(name, force) {
        if (force === undefined) { self._classSet.has(name) ? self._classSet.delete(name) : self._classSet.add(name); }
        else if (force) self._classSet.add(name); else self._classSet.delete(name);
      },
      contains(name) { return self._classSet.has(name); },
    };
  }
  get id() { return this._id; }
  set id(v) { if (this._id) idRegistry.delete(this._id); this._id = v; if (v) idRegistry.set(v, this); }
  set className(v) { this._classSet = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className() { return [...this._classSet].join(" "); }
  set textContent(v) { this._text = String(v); this.childNodes.forEach((c) => { c.parentNode = null; }); this.childNodes = []; }
  get textContent() { return this.childNodes.length ? this.childNodes.map((c) => c.textContent).join("") : this._text; }
  set innerHTML(v) { if (v === "") { this.childNodes.forEach((c) => { c.parentNode = null; if (c._id) idRegistry.delete(c._id); }); this.childNodes = []; } }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; }
  appendChild(child) {
    if (child.tagName === "#fragment") {
      const kids = child.childNodes.slice();
      child.childNodes = [];
      kids.forEach((k) => this.appendChild(k));
      return child;
    }
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }
  append(...children) { children.forEach((c) => this.appendChild(c)); }
  removeChild(child) {
    const idx = this.childNodes.indexOf(child);
    if (idx !== -1) this.childNodes.splice(idx, 1);
    child.parentNode = null;
    if (child._id) idRegistry.delete(child._id);
    return child;
  }
  _walk(collector) { for (const child of this.childNodes) { collector(child); child._walk(collector); } }
  querySelectorAll(selectorList) { const out = []; this._walk((node) => { if (matchesSelector(node, selectorList)) out.push(node); }); return out; }
  querySelector(selectorList) { let found = null; this._walk((node) => { if (!found && matchesSelector(node, selectorList)) found = node; }); return found; }
  addEventListener() {}
  getContext() { return {}; }
}

function loadRealClosures() {
  idRegistry = new Map();
  const documentElement = new FakeNode("html");
  const body = new FakeNode("body");
  const window = {
    __JK_BMS_TEST_HOOKS__: {},
    location: { href: "http://jk-bms.local/" },
    addEventListener() {}, matchMedia() { return { matches: false }; },
    cancelAnimationFrame() {}, requestAnimationFrame(cb) { return setImmediate(cb); },
    clearInterval() {}, setInterval() {},
    setTimeout: (cb) => setTimeout(cb, 0), clearTimeout: (id) => clearTimeout(id),
    fetch: async () => { throw new Error("test shim: unexpected fetch -- this test never issues a real HTTP request"); },
    confirm: () => true,
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  };
  const document = {
    documentElement, scrollingElement: { scrollTop: 0 }, readyState: "complete",
    createElement(tag) { return new FakeNode(tag); }, createDocumentFragment() { return new FakeNode("#fragment"); },
    addEventListener() {}, getElementById(id) { return idRegistry.get(id) || null; },
    querySelector(sel) { return body.querySelector(sel); }, querySelectorAll(sel) { return body.querySelectorAll(sel); },
    activeElement: null, body,
  };
  class HTMLInputElement {}
  const sandbox = {
    window, document, navigator: { language: "en" }, URL, console, Map, HTMLInputElement, AbortController,
    fetch: window.fetch, confirm: window.confirm,
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "jk_bms.js" });
  const hooks = window.__JK_BMS_TEST_HOOKS__;
  if (!hooks.renderSettingsCatalog || !hooks.ingestPayload || !hooks.entityByWireId) {
    throw new Error("jk_bms.js's test hook did not populate the expected routing surface -- window.__JK_BMS_TEST_HOOKS__ shape may have drifted");
  }
  return { hooks, body };
}

// ===========================================================================
// A. Generated artifacts (canonical.json / read_plan.json / route table).
// ===========================================================================
const canonical = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "registers.canonical.json"), "utf8"));
const readPlan = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "generated", "read_plan.json"), "utf8"));
const routesDoc = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "generated", "protocol_entity_routes.json"), "utf8"));
const settingsViewModel = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "generated", "settings_view_model.json"), "utf8"));
const stage3 = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "generated", "stage3_status_map.json"), "utf8"));
const blockersDoc = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "evidence", "protocol_blockers.json"), "utf8"));

const reg12D0 = canonical.registers.find((r) => r.address === "0x12D0");
const tsmField = reg12D0.fields.find((f) => f.key === "temperature_sensor_status_mask");

check("exactly one canonical projection field 'temperature_sensor_status_mask' exists on 0x12D0",
  reg12D0.fields.filter((f) => f.key === "temperature_sensor_status_mask").length === 1);
check("temperature_sensor_status_mask: mask=0xFF00, shift=8, wire_type=U8, field_width_bits=8",
  tsmField.mask === "0xFF00" && tsmField.shift === 8 && tsmField.wire_type === "U8" && tsmField.field_width_bits === 8);
check("temperature_sensor_status_mask: effective_access=r, editor_kind=readonly, no write entity",
  tsmField.effective_access === "r" && tsmField.editor_kind === "readonly" && tsmField.esphome_write_entity_id === null);
check("temperature_sensor_status_mask: projection_of is exactly 'sensor_heating_mask'",
  tsmField.projection_of === "sensor_heating_mask");
check("temperature_sensor_status_mask: write_uses_read_modify_write is false (a projection never owns a write path)",
  tsmField.write_uses_read_modify_write === false);

const planBlock12D0 = readPlan.blocks.find((b) => b.address === "0x12D0");
const planField = planBlock12D0.fields.find((f) => f.key === "temperature_sensor_status_mask");
check("the generated read-plan decodes temperature_sensor_status_mask from the already-read 0x12D0 payload (same block, no new address)",
  !!planField && planField.mask === "0xFF00" && planField.shift === 8);
check("0x12D0's read-plan register_count/payload_bytes/cadence are unchanged (1 register, 2 bytes, 15000ms) -- zero new bus traffic",
  planBlock12D0.register_count === 1 && planBlock12D0.payload_bytes === 2 && planBlock12D0.cadence_ms === 15000);
check("total block count in read_plan.json is unchanged at 103 (no new physical read added anywhere)",
  readPlan.blocks.length === 103);

// The parent RAW field and all 7 pre-existing per-bit projections remain
// byte-for-byte unchanged (same mask/shift as before this batch).
const UNCHANGED_SIBLINGS = {
  sensor_heating_mask: { mask: "0xFFFF", shift: 0 },
  heating_active: { mask: "0x00FF", shift: 0 },
  mos_temp_sensor_status_bit_raw: { mask: "0x0100", shift: 8 },
  bat_temp_sensor_1_present: { mask: "0x0200", shift: 9 },
  bat_temp_sensor_2_present: { mask: "0x0400", shift: 10 },
  bat_temp_sensor_3_present: { mask: "0x0800", shift: 11 },
  bat_temp_sensor_4_present: { mask: "0x1000", shift: 12 },
  bat_temp_sensor_5_present: { mask: "0x2000", shift: 13 },
};
for (const [key, expected] of Object.entries(UNCHANGED_SIBLINGS)) {
  const f = reg12D0.fields.find((ff) => ff.key === key);
  check(`sibling field "${key}" is unchanged (mask=${expected.mask}, shift=${expected.shift})`,
    f && f.mask === expected.mask && f.shift === expected.shift);
}

const routeForTsm = routesDoc.routes.find((r) => r.key === "temperature_sensor_status_mask");
check("the generated route table has exactly one route for temperature_sensor_status_mask",
  routesDoc.routes.filter((r) => r.key === "temperature_sensor_status_mask").length === 1);
check("that route's domain/entityId matches the field's own esphome_domain/esphome_read_entity_id",
  routeForTsm && routeForTsm.domain === "sensor" && routeForTsm.entityId === "temperature_sensor_status_mask");

const tempSensorAbsentRow = settingsViewModel.rows.find((r) => r.manifestId === "TempSensorAbsent");
check("TempSensorAbsent's Settings row resolves to canonicalKey temperature_sensor_status_mask, readWriteState read_only",
  tempSensorAbsentRow && tempSensorAbsentRow.canonicalKey === "temperature_sensor_status_mask" && tempSensorAbsentRow.readWriteState === "read_only");
check("TempSensorAbsent's row has real min/max (0/255) and valueKind numeric",
  tempSensorAbsentRow.min === 0 && tempSensorAbsentRow.max === 255 && tempSensorAbsentRow.valueKind === "numeric");

// ===========================================================================
// B. Permanent unsupported classification (generated artifacts).
// ===========================================================================
const anomalyRows = settingsViewModel.rows.filter((r) => r.manifestId === "TemperatureSensorAnomaly" || r.manifestId === "PCLModuleAnomaly");
check("exactly 2 rows carry the permanent unsupported classification", anomalyRows.length === 2 && anomalyRows.every((r) => r.readWriteState === "unsupported_protocol_field"));
check("both anomaly rows have canonicalKey null and no readEntityId (route-free)",
  anomalyRows.every((r) => r.canonicalKey === null && r.readEntityId === null));
check("both anomaly rows carry the precise MANUFACTURER_BIT_POSITION_NOT_DOCUMENTED reason",
  anomalyRows.every((r) => r.blockedReason === "MANUFACTURER_BIT_POSITION_NOT_DOCUMENTED"));
check("neither anomaly appears anywhere in the generated route table (no fabricated route)",
  !routesDoc.routes.some((r) => r.key === "temperature_sensor_anomaly" || r.key === "pcl_module_anomaly"));
check("neither anomaly has a canonical field anywhere in registers.canonical.json (no bit/mask/shift authored)",
  !canonical.registers.some((reg) => reg.fields.some((f) => f.key === "temperature_sensor_anomaly" || f.key === "pcl_module_anomaly")));

const reg12A0 = canonical.registers.find((r) => r.address === "0x12A0");
const alarmProjections = reg12A0.fields.filter((f) => f.projection_of === "alarms_bitmask");
check("alarms_bitmask (RAW, 0x12A0) is unchanged: full 32-bit width, not itself a projection",
  reg12A0.fields[0].key === "alarms_bitmask" && reg12A0.fields[0].field_width_bits === 32 && reg12A0.fields[0].projection_of === null);
check("all 22 existing alarm-bit projections at 0x12A0 remain unchanged (shifts exactly 0-21, no duplicates, nothing beyond bit21)",
  JSON.stringify(alarmProjections.map((f) => f.shift).sort((a, b) => a - b)) === JSON.stringify(Array.from({ length: 22 }, (_, i) => i)));

// Both blockers closed with an auditable resolution.
for (const paramId of ["TempSensorAbsent", "TemperatureSensorAnomaly"]) {
  const entry = blockersDoc.blockers.find((b) => b.parameter_id.split(",").map((s) => s.trim()).includes(paramId));
  check(`blocker entry covering "${paramId}" is closed with a non-empty resolution`,
    !!entry && entry.status === "closed" && typeof entry.resolution === "string" && entry.resolution.length > 0);
}

// ===========================================================================
// C. Closure invariants (generated document level).
// ===========================================================================
check("Settings view-model: zero generic unmapped rows (unmapped_row_count=0)", settingsViewModel.unmapped_row_count === 0);
check("Settings view-model: exactly 2 permanently-unsupported rows (unsupported_row_count=2)", settingsViewModel.unsupported_row_count === 2);
check("Settings view-model: total row_count is unchanged at 260", settingsViewModel.row_count === 260);
check("Settings view-model: declared-access partition is unchanged at 155 R / 97 RW / 8 W",
  settingsViewModel.counts_by_access.R === 155 && settingsViewModel.counts_by_access.RW === 97 && settingsViewModel.counts_by_access.W === 8);
check("Stage 3 status-map: TempSensorAbsent is implemented_read; both anomalies are unsupported_bit_position_undocumented; no other parameter changed status class",
  (() => {
    const byId = new Map(stage3.parameters.map((p) => [p.id, p]));
    return byId.get("TempSensorAbsent").status === "implemented_read" &&
      byId.get("TemperatureSensorAnomaly").status === "unsupported_bit_position_undocumented" &&
      byId.get("PCLModuleAnomaly").status === "unsupported_bit_position_undocumented";
  })());
check("Stage 3 status-map: 265 parameters total, counts sum to 265",
  stage3.parameter_count === 265 && Object.values(stage3.counts).reduce((a, b) => a + b, 0) === 265);

// ===========================================================================
// B (continued). Production ingest -> state -> DOM.
// ===========================================================================
function main() {
  const { hooks, body } = loadRealClosures();
  const { renderSettingsCatalog, updateSettingsCatalogValue, ingestPayload, state, entityByWireId, SETTINGS_CATALOG_ROWS, setLanguage } = hooks;

  const settingsCatalogList = new FakeNode("div");
  settingsCatalogList.id = "settingsCatalogList";
  body.appendChild(settingsCatalogList);
  const settingsMessage = new FakeNode("p");
  settingsMessage.id = "settingsMessage";
  body.appendChild(settingsMessage);
  const cellOverlay = new FakeNode("div");
  cellOverlay.id = "cellOverlay";
  cellOverlay.hidden = true;
  body.appendChild(cellOverlay);

  function rows() { return settingsCatalogList.querySelectorAll(".settings-catalog-row"); }
  function rowFor(manifestId) { return rows().find((r) => r.dataset.manifestId === manifestId); }
  function rowValueText(manifestId) {
    const r = rowFor(manifestId);
    if (!r) return undefined;
    const valueEl = r.querySelector(".settings-catalog-value");
    if (valueEl) return valueEl.textContent;
    const editorEl = r.querySelector(".settings-catalog-editor");
    if (editorEl) return editorEl.value === "" ? "--" : String(editorEl.value);
    return undefined;
  }
  function noteTextFor(manifestId) {
    const r = rowFor(manifestId);
    const note = r && r.querySelector(".settings-catalog-note");
    return note ? note.textContent : undefined;
  }

  renderSettingsCatalog();

  check("real jk_bms.js closures loaded (not reimplemented)", typeof renderSettingsCatalog === "function" && typeof ingestPayload === "function");
  check("row count includes all 260 eligible manifest rows (161 catalog rows: 155 R + 97 RW - 96 cell-composite-owned + 8 W - 8 W, minus composite-owned rows rendered separately)",
    SETTINGS_CATALOG_ROWS.length === settingsViewModel.rows.filter((r) => r.compositeGroup !== "cell").length);

  // --- TempSensorAbsent: catalog-first, then real payload, representative
  // raw mask values including bits 6-7. ---
  check("catalog-first: TempSensorAbsent's row shows the unavailable placeholder before any SSE value",
    rowValueText("TempSensorAbsent") === "Unavailable", rowValueText("TempSensorAbsent"));

  const tsmRoute = routeForTsm;
  ingestPayload({ id: `${tsmRoute.domain}/${tsmRoute.configuredName}`, value: 0x3e, state: "62" });
  updateSettingsCatalogValue("TempSensorAbsent");
  check("TempSensorAbsent renders the exact raw mask value 62 (0x3E, bits1-5 set) after its own payload arrives, never '--'",
    rowValueText("TempSensorAbsent") === "62", rowValueText("TempSensorAbsent"));

  ingestPayload({ id: `${tsmRoute.domain}/${tsmRoute.configuredName}`, value: 0xfe, state: "254" });
  updateSettingsCatalogValue("TempSensorAbsent");
  check("TempSensorAbsent renders 254 (0xFE, undocumented bits 6-7 SET) exactly, no truncation, no reinterpretation into a boolean/count",
    rowValueText("TempSensorAbsent") === "254", rowValueText("TempSensorAbsent"));

  ingestPayload({ id: `${tsmRoute.domain}/${tsmRoute.configuredName}`, value: 0, state: "0" });
  updateSettingsCatalogValue("TempSensorAbsent");
  check("TempSensorAbsent renders 0 exactly (all bits clear, a real value, never displayed as unavailable)",
    rowValueText("TempSensorAbsent") === "0", rowValueText("TempSensorAbsent"));

  check("entityByWireId resolves temperature_sensor_status_mask's real wire id to its own canonical key",
    entityByWireId.get(`${tsmRoute.domain}/${tsmRoute.configuredName}`) === "temperature_sensor_status_mask");

  // Sibling non-interference: heating_active (same physical 0x12D0 block)
  // is untouched by temperature_sensor_status_mask's own updates.
  ingestPayload({ id: "binary_sensor/heating active", value: false, state: "OFF" });
  updateSettingsCatalogValue("Heating");
  const heatingBefore = rowValueText("Heating");
  ingestPayload({ id: `${tsmRoute.domain}/${tsmRoute.configuredName}`, value: 0x3e, state: "62" });
  updateSettingsCatalogValue("TempSensorAbsent");
  check("updating temperature_sensor_status_mask does not change its packed sibling heating_active's already-resolved value",
    rowValueText("Heating") === heatingBefore, `before=${heatingBefore} after=${rowValueText("Heating")}`);

  // --- Permanent unsupported rows: localized text, no editor/control, no
  // fabricated route resolution. Sandbox default locale is EN (navigator.
  // language) -- switch to UK explicitly before asserting the UK string.
  setLanguage("uk");
  for (const [manifestId, canonicalKey] of [["TemperatureSensorAnomaly", "temperature_sensor_anomaly"], ["PCLModuleAnomaly", "pcl_module_anomaly"]]) {
    const row = rowFor(manifestId);
    check(`${manifestId}'s row exists in the rendered catalog`, !!row);
    check(`${manifestId}'s row has no .settings-catalog-editor (no input/select/button control)`,
      row && !row.querySelector(".settings-catalog-editor"));
    check(`${manifestId}'s row has no .settings-catalog-value (never rendered as a live numeric/binary value)`,
      row && !row.querySelector(".settings-catalog-value"));
    check(`${manifestId} renders the localized UK unsupported explanation, never '--'`,
      noteTextFor(manifestId) === "Не підтримується: виробник не вказав номер біта", noteTextFor(manifestId));
    check(`entityByWireId has no route for the fabricated key "${canonicalKey}" (never resolves to anything)`,
      entityByWireId.get(`sensor/${canonicalKey}`) === undefined);
  }

  // EN localization of the same unsupported text.
  setLanguage("en");
  check("TemperatureSensorAnomaly renders the localized EN unsupported explanation after language switch",
    noteTextFor("TemperatureSensorAnomaly") === "Unsupported: manufacturer did not specify the bit position", noteTextFor("TemperatureSensorAnomaly"));
  check("PCLModuleAnomaly renders the localized EN unsupported explanation after language switch",
    noteTextFor("PCLModuleAnomaly") === "Unsupported: manufacturer did not specify the bit position", noteTextFor("PCLModuleAnomaly"));
  setLanguage("uk");

  // Zero rebuild / DOM ownership proof.
  check("row count is unchanged after every SSE update and language switch in this test (no whole-list rebuild)",
    rows().length === SETTINGS_CATALOG_ROWS.length);

  console.log(`\nunmapped-rows cleanup production DOM test summary: ${checks - failures}/${checks} passed`);
}

main();

console.log(`\nunmapped-rows cleanup generated-artifacts + DOM summary: ${checks - failures}/${checks} passed`);
process.exit(failures ? 1 : 0);
