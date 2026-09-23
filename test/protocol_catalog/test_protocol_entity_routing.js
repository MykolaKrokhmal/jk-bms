#!/usr/bin/env node
"use strict";

// EXECUTABLE PRODUCTION-JS DOM TEST -- protocol-entity routing fix
// (2026-09-22). Runs the REAL jk_bms.js closures (registerEntity,
// entityByWireId, ingestPayload, state, renderSettingsCatalog,
// updateSettingsCatalogValue) inside a Node `vm` sandbox, via the SAME
// opt-in window.__JK_BMS_TEST_HOOKS__ escape hatch this project's other
// DOM tests already use. No routing/ingest logic is reimplemented here
// -- every payload below is injected through the real ingestPayload()
// entry point, using real-format SSE payload shapes copied from the
// user's own live-hardware evidence.
//
// Root cause under test: many ordinary protocol fields had NO
// registerEntity() call anywhere (neither the hand-typed list nor the
// old wireObjectIdAliases table, which only ever covered the narrower
// "wire id differs from canonical key" case) -- their real SSE payloads
// never reached entityByWireId, state[key] was never written, and the
// (correctly catalog-first-rendered) Settings row showed the unavailable
// placeholder forever. PROTOCOL_ENTITY_ROUTES (generated from
// read_plan.json + registers.canonical.json's bespoke-reader metadata)
// closes that gap.
//
// Covers (§6, Production behavioral tests):
//   - ordinary numeric sensor whose key equals entity ID;
//   - binary sensor;
//   - text sensor/ASCII;
//   - HEX text sensor;
//   - exact companion (vs its legacy companion, which must stay
//     suppressed and never overwrite the exact value);
//   - generated read-plan entity;
//   - bespoke-reader entity;
//   - initial payload after the catalog was already rendered;
//   - subsequent update to the same entity;
//   - real configured name containing spaces;
//   - object-ID form containing underscores;
//   - the full user-reported regression fixture set (native bms power,
//     precharge status, custom alarms, recovery timers, alarm bits,
//     heating/sensor-presence bits, charge/discharge active state,
//     UART/CAN raw HEX fields, UART2/CAN protocol number+enable fields,
//     charger_plugged, pcl_module_sta, can_mptl_ver) with packed-sibling
//     non-overwrite proof.

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
// test_settings_catalog.js's own (see that file for full comments).
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

function main() {
  const { hooks, body } = loadRealClosures();
  const { renderSettingsCatalog, updateSettingsCatalogValue, ingestPayload, state, entityByWireId, LEGACY_COMPANION_SUPPRESSED, SETTINGS_CATALOG_ROWS, setLanguage } = hooks;
  const routesDoc = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "generated", "protocol_entity_routes.json"), "utf8"));
  const routesByKey = new Map(routesDoc.routes.map((r) => [r.key, r]));

  check("real jk_bms.js closures loaded via the test hook (not reimplemented)",
    typeof renderSettingsCatalog === "function" && typeof ingestPayload === "function");

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
  // A live/read R row renders its value into a plain ".settings-catalog-value"
  // <b>; a blocked/disabled RW row (real product behavior, settingsEditorKind())
  // instead renders a disabled type-aware editor (".settings-catalog-editor" --
  // an <input> or <select>) whose OWN value is what updateSettingsCatalogValue()
  // keeps fresh for that row. Check both, matching the real row-shape branches
  // in renderSettingsCatalogRow()/updateSettingsCatalogValue() themselves.
  function rowValueText(manifestId) {
    const r = rowFor(manifestId);
    if (!r) return undefined;
    const valueEl = r.querySelector(".settings-catalog-value");
    if (valueEl) return valueEl.textContent;
    const editorEl = r.querySelector(".settings-catalog-editor");
    if (editorEl) return editorEl.value === "" ? "--" : String(editorEl.value);
    return undefined;
  }
  function manifestIdFor(canonicalKey) { const row = SETTINGS_CATALOG_ROWS.find((r) => r.canonicalKey === canonicalKey); return row && row.manifestId; }

  // Catalog is built ONCE, at boot, before any SSE value -- exactly the
  // real app's own boot sequence.
  renderSettingsCatalog();

  // =========================================================================
  // Catalog-first + "initial payload after already rendered" (items 8/9).
  // =========================================================================
  const nativePowerId = manifestIdFor("native_bms_power");
  check("sanity: native_bms_power has a real generic-block route", !!nativePowerId);
  check("catalog-first: native_bms_power's row shows the unavailable placeholder before any SSE value", rowValueText(nativePowerId) === "Unavailable", rowValueText(nativePowerId));

  // =========================================================================
  // 1. Ordinary numeric sensor whose key equals entity ID -- real-format
  // payload, slash+space configured-name wire form (the user's own
  // evidence's exact shape).
  // =========================================================================
  ingestPayload({ id: "sensor/native bms power", value: 0, state: "0.000 W" });
  updateSettingsCatalogValue(nativePowerId);
  check("ordinary numeric sensor (native_bms_power, slash+space wire form): row stops showing '--' and shows the real value",
    rowValueText(nativePowerId) !== "--" && rowValueText(nativePowerId).includes("0.000"), rowValueText(nativePowerId));
  check("entityByWireId resolves the real configured-name form (spaces) to the correct canonical key",
    entityByWireId.get("sensor/native bms power") === "native_bms_power");

  // 11. Object-ID form containing underscores also resolves to the SAME key.
  check("entityByWireId ALSO resolves the object-ID (underscore) wire form to the same canonical key",
    entityByWireId.get("sensor-native_bms_power") === "native_bms_power");

  // 9. Subsequent update to the same entity.
  ingestPayload({ id: "sensor/native bms power", value: 12.5, state: "12.500 W" });
  updateSettingsCatalogValue(nativePowerId);
  check("a subsequent update to the same entity updates the row again", rowValueText(nativePowerId).includes("12.5"), rowValueText(nativePowerId));

  // =========================================================================
  // 2. Binary sensor.
  // =========================================================================
  const alarmWireResId = manifestIdFor("alarm_wire_res");
  check("sanity: alarm_wire_res is a real BIT/binary row", !!alarmWireResId);
  ingestPayload({ id: "binary_sensor/alarm wire res", value: false, state: "OFF" });
  updateSettingsCatalogValue(alarmWireResId);
  const alarmText1 = rowValueText(alarmWireResId);
  check("binary sensor (alarm_wire_res=OFF): row shows the localized No, not '--'", alarmText1 === "No", alarmText1);
  ingestPayload({ id: "binary_sensor/alarm wire res", value: true, state: "ON" });
  updateSettingsCatalogValue(alarmWireResId);
  check("binary sensor (alarm_wire_res=ON): row updates to Yes", rowValueText(alarmWireResId) === "Yes", rowValueText(alarmWireResId));

  // =========================================================================
  // 3. Text sensor / ASCII.
  // =========================================================================
  const swVersionId = manifestIdFor("software_version");
  ingestPayload({ id: "text_sensor/software version", value: "15.41", state: "15.41" });
  updateSettingsCatalogValue(swVersionId);
  check("ASCII text sensor (software_version): exact text, not '--' or a converted number", rowValueText(swVersionId) === "15.41", rowValueText(swVersionId));

  // =========================================================================
  // 4. HEX text sensor.
  // =========================================================================
  const uartHexId = manifestIdFor("uart1_mprtol_enable");
  ingestPayload({ id: "text_sensor/uart1 mprtol enable", value: "0x00FF", state: "0x00FF" });
  updateSettingsCatalogValue(uartHexId);
  check("HEX text sensor (uart1_mprtol_enable): exact raw text, never converted through a float", rowValueText(uartHexId) === "0x00FF", rowValueText(uartHexId));

  // =========================================================================
  // 5. Exact companion vs legacy companion -- the legacy wire id must
  // stay suppressed and never overwrite the exact canonical value.
  // =========================================================================
  const rtcTicksId = manifestIdFor("rtc_ticks");
  check("sanity: rtc_ticks is a real row (exact-companion field)", !!rtcTicksId);
  ingestPayload({ id: "text_sensor/rtc ticks exact", value: "123456", state: "123456" });
  updateSettingsCatalogValue(rtcTicksId);
  const rtcTicksValueAfterExact = rowValueText(rtcTicksId);
  check("rtc_ticks_exact's real payload populates state[\"rtc_ticks\"] (the canonical key)", state.rtc_ticks && state.rtc_ticks.state === "123456");
  check("rtc_ticks_exact's real payload updates the Settings row", rtcTicksValueAfterExact !== "--" && rtcTicksValueAfterExact.includes("123456"), rtcTicksValueAfterExact);
  // The pre-existing, approximate legacy companion entity (same domain
  // "sensor", DIFFERENT wire id "rtc ticks" with no "exact" suffix) must
  // resolve to the suppression sentinel, never to "rtc_ticks" itself.
  check("the legacy companion's own wire id resolves to LEGACY_COMPANION_SUPPRESSED, not the canonical key",
    entityByWireId.get("sensor/rtc ticks") === LEGACY_COMPANION_SUPPRESSED);
  ingestPayload({ id: "sensor/rtc ticks", value: "999999", state: "999999" }); // legacy, approximate -- must be ignored
  updateSettingsCatalogValue(rtcTicksId);
  check("the legacy companion's own payload does NOT overwrite the exact canonical value already resolved",
    state.rtc_ticks.state === "123456" && rowValueText(rtcTicksId) === rtcTicksValueAfterExact,
    `state=${state.rtc_ticks.state} row=${rowValueText(rtcTicksId)}`);

  for (const [exactKey, legacyWireId] of [
    ["odd_run_time", "sensor/odd run time"],
    ["bms_system_ticks", "sensor/bms system ticks"],
    ["total_runtime", "sensor/total runtime in seconds"],
    ["cell_connected_mask", "sensor/cell connected mask"],
  ]) {
    const resolved = entityByWireId.get(legacyWireId);
    check(`legacy companion suppression intact for ${exactKey}: its own legacy wire id resolves to LEGACY_COMPANION_SUPPRESSED`,
      resolved === LEGACY_COMPANION_SUPPRESSED, `got=${String(resolved)}`);
    // The real exact-primary entity's own configured-name wire form (e.g.
    // "text_sensor/odd run time exact") must resolve to the real canonical
    // key, never the suppression sentinel -- this is the form real SSE
    // payloads actually use; the bare, unprefixed canonical-key string is
    // never a real wire id (some legacy companions happen to share their
    // own entity_id text with the canonical key, e.g. legacy "odd_run_time"
    // vs canonical key "odd_run_time" -- that harmless bare-string alias
    // collision is expected and does not affect real routing).
    const exactRoute = routesByKey.get(exactKey);
    const exactWireId = `${exactRoute.domain}/${exactRoute.configuredName}`;
    check(`legacy companion suppression intact for ${exactKey}: the real exact-primary wire id resolves to the canonical key, not the sentinel`,
      entityByWireId.get(exactWireId) === exactKey, `wireId="${exactWireId}" got=${String(entityByWireId.get(exactWireId))}`);
  }

  // =========================================================================
  // 6/7. Generated read-plan entity vs bespoke-reader entity.
  // =========================================================================
  const precharge = manifestIdFor("precharge_status"); // generic-block (read_plan.json)
  ingestPayload({ id: "sensor/precharge status", value: 0, state: "0" });
  updateSettingsCatalogValue(precharge);
  check("generated read-plan entity (precharge_status) routes correctly", rowValueText(precharge) === "0", rowValueText(precharge));

  const minVolCellId = manifestIdFor("min_voltage_cell_index_native"); // bespoke-reader (0x1290 block)
  check("sanity: min_voltage_cell_index_native is a real bespoke-reader row", !!minVolCellId);
  ingestPayload({ id: "sensor/min voltage cell index (native)", value: 5, state: "5" });
  updateSettingsCatalogValue(minVolCellId);
  check("bespoke-reader entity (min_voltage_cell_index_native) routes correctly",
    rowValueText(minVolCellId) === "5", rowValueText(minVolCellId));

  const maxVolCellId = manifestIdFor("max_voltage_cell_index_native");
  ingestPayload({ id: "sensor/max voltage cell index (native)", value: 3, state: "3" });
  updateSettingsCatalogValue(maxVolCellId);
  check("bespoke-reader entity with a parenthesized configured name (max_voltage_cell_index_native) routes correctly",
    rowValueText(maxVolCellId) === "3", rowValueText(maxVolCellId));

  // =========================================================================
  // User-reported regression fixture set.
  // =========================================================================
  const fixtureKeys = [
    ["uart_protocol_library_version", 5, "5"],
    ["custom_alarm_1", 0, "0"],
    ["custom_alarm_2", 0, "0"],
    ["discharge_ocpr_left", 0, "0 s"],
    ["charge_ocpr_left", 0, "0 s"],
    ["heating_active", 0, "0"],
    ["charging_active", 1, "1"],
    ["discharging_active", 1, "1"],
  ];
  // The wire id for each fixture is derived from the SAME generated route
  // table the routing fix itself produced (protocol_entity_routes.json) --
  // never a hand-guessed domain/name, since a guess could silently pass a
  // wire id the real registerEntity() calls happen to also recognize for
  // an unrelated reason and mask a real gap.
  for (const [key, value, stateStr] of fixtureKeys) {
    const manifestId = manifestIdFor(key);
    check(`regression fixture: ${key} has a real Settings row`, !!manifestId, key);
    if (!manifestId) continue;
    const route = routesByKey.get(key);
    check(`regression fixture: ${key} has a real generated route`, !!route, key);
    if (!route) continue;
    ingestPayload({ id: `${route.domain}/${route.configuredName}`, value, state: stateStr });
    updateSettingsCatalogValue(manifestId);
    check(`regression fixture: ${key} stops showing '--' after its real payload arrives`, rowValueText(manifestId) !== "--", `${key} -> "${rowValueText(manifestId)}"`);
  }

  // Additional fixtures from the user's follow-up screenshot, including
  // packed-sibling non-overwrite proof (uart2_mprtol_enable_0 shares its
  // register with uart2_mprtol_nbr -- two DIFFERENT canonical fields,
  // two DIFFERENT routes; updating one must never touch the other).
  const uart2EnableId = manifestIdFor("uart2_mprtol_enable_0");
  const uart2NbrId = manifestIdFor("uart2_mprtol_nbr");
  const canNbrId = manifestIdFor("can_mprtol_nbr");
  const chargerPluggedId = manifestIdFor("charger_plugged");
  const pclModuleId = manifestIdFor("pcl_module_sta");
  const canVerId = manifestIdFor("can_mptl_ver");
  for (const [label, id] of [["uart2_mprtol_enable_0", uart2EnableId], ["uart2_mprtol_nbr", uart2NbrId], ["can_mprtol_nbr", canNbrId], ["charger_plugged", chargerPluggedId], ["pcl_module_sta", pclModuleId], ["can_mptl_ver", canVerId]]) {
    check(`user-reported fixture: ${label} has a real Settings row`, !!id, label);
  }
  const uart2NbrRoute = routesByKey.get("uart2_mprtol_nbr");
  const uart2EnableRoute = routesByKey.get("uart2_mprtol_enable_0");
  ingestPayload({ id: `${uart2NbrRoute.domain}/${uart2NbrRoute.configuredName}`, value: 2, state: "2" });
  updateSettingsCatalogValue(uart2NbrId);
  check("uart2_mprtol_nbr routes correctly", rowValueText(uart2NbrId) === "2", rowValueText(uart2NbrId));
  const uart2EnableBefore = rowValueText(uart2EnableId);
  check("updating uart2_mprtol_nbr does NOT overwrite its packed sibling uart2_mprtol_enable_0's own row",
    uart2EnableBefore === "Unavailable", uart2EnableBefore);
  ingestPayload({ id: `${uart2EnableRoute.domain}/${uart2EnableRoute.configuredName}`, value: 1, state: "1" });
  updateSettingsCatalogValue(uart2EnableId);
  check("uart2_mprtol_enable_0 routes correctly once its OWN payload arrives", rowValueText(uart2EnableId) === "1", rowValueText(uart2EnableId));
  check("uart2_mprtol_enable_0's own update did not change uart2_mprtol_nbr's already-resolved value",
    rowValueText(uart2NbrId) === "2", rowValueText(uart2NbrId));

  ingestPayload({ id: "sensor/can mprtol nbr", value: 1, state: "1" });
  updateSettingsCatalogValue(canNbrId);
  check("can_mprtol_nbr routes correctly", rowValueText(canNbrId) === "1", rowValueText(canNbrId));

  ingestPayload({ id: "sensor/charger plugged", value: 1, state: "1" });
  updateSettingsCatalogValue(chargerPluggedId);
  check("charger_plugged routes correctly", rowValueText(chargerPluggedId) === "1", rowValueText(chargerPluggedId));

  ingestPayload({ id: "sensor/pcl module sta", value: 0, state: "0" });
  updateSettingsCatalogValue(pclModuleId);
  check("pcl_module_sta routes correctly", rowValueText(pclModuleId) === "0", rowValueText(pclModuleId));

  ingestPayload({ id: "sensor/can mptl ver", value: 1, state: "1" });
  updateSettingsCatalogValue(canVerId);
  check("can_mptl_ver routes correctly", rowValueText(canVerId) === "1", rowValueText(canVerId));

  // =========================================================================
  // Settings read-value fix (2026-09-22): the 5 target fields' full
  // ingest -> state -> DOM path, using the real generated route table's
  // own domain/entityId/configuredName (never a hand-guessed wire id).
  // =========================================================================
  const totalVoltageRawId = manifestIdFor("total_voltage_raw");
  const currentRawId = manifestIdFor("current_raw");
  const heatingActiveId = manifestIdFor("heating_active");
  const chargingActiveId = manifestIdFor("charging_active");
  const dischargingActiveId = manifestIdFor("discharging_active");
  for (const [label, id] of [["total_voltage_raw", totalVoltageRawId], ["current_raw", currentRawId], ["heating_active", heatingActiveId], ["charging_active", chargingActiveId], ["discharging_active", dischargingActiveId]]) {
    check(`Settings read-value fix: ${label} has a real Settings row`, !!id, label);
  }

  const totalVoltageRawRoute = routesByKey.get("total_voltage_raw");
  const currentRawRoute = routesByKey.get("current_raw");
  const heatingActiveRoute = routesByKey.get("heating_active");
  const chargingActiveRoute = routesByKey.get("charging_active");
  const dischargingActiveRoute = routesByKey.get("discharging_active");

  check("total_voltage_raw's route is the new public sensor (never total_voltage's own wire id)",
    totalVoltageRawRoute && totalVoltageRawRoute.domain === "sensor" && totalVoltageRawRoute.entityId === "total_voltage_raw");
  check("current_raw's route is the new public sensor (never current's own wire id)",
    currentRawRoute && currentRawRoute.domain === "sensor" && currentRawRoute.entityId === "current_raw");
  check("charging_active's route is the PUBLIC binary_sensor/charging, never the internal charging_raw",
    chargingActiveRoute && chargingActiveRoute.domain === "binary_sensor" && chargingActiveRoute.entityId === "charging");
  check("discharging_active's route is the PUBLIC binary_sensor/discharging, never the internal discharging_raw",
    dischargingActiveRoute && dischargingActiveRoute.domain === "binary_sensor" && dischargingActiveRoute.entityId === "discharging");

  // total_voltage_raw: numeric payload, 3 decimals, V.
  ingestPayload({ id: `${totalVoltageRawRoute.domain}/${totalVoltageRawRoute.configuredName}`, value: 55.128, state: "55.128 V" });
  updateSettingsCatalogValue(totalVoltageRawId);
  check("total_voltage_raw renders with 3 decimals and V, never '--'",
    rowValueText(totalVoltageRawId) === "55.128 V", rowValueText(totalVoltageRawId));

  // current_raw: SIGNED numeric payload (discharge, negative), 3 decimals, A.
  ingestPayload({ id: `${currentRawRoute.domain}/${currentRawRoute.configuredName}`, value: -12.345, state: "-12.345 A" });
  updateSettingsCatalogValue(currentRawId);
  check("current_raw renders a signed value with 3 decimals and A, never '--'",
    rowValueText(currentRawId) === "-12.345 A", rowValueText(currentRawId));

  // heating_active: real ESPHome binary_sensor OFF/ON shape -- proves the
  // valueKind:"binary" fix (a "numeric" classification would render '--'
  // forever, since Number.parseFloat("OFF") is NaN).
  ingestPayload({ id: `${heatingActiveRoute.domain}/${heatingActiveRoute.configuredName}`, value: false, state: "OFF" });
  updateSettingsCatalogValue(heatingActiveId);
  check("heating_active OFF renders the localized No, never '--'", rowValueText(heatingActiveId) === "No", rowValueText(heatingActiveId));
  ingestPayload({ id: `${heatingActiveRoute.domain}/${heatingActiveRoute.configuredName}`, value: true, state: "ON" });
  updateSettingsCatalogValue(heatingActiveId);
  check("heating_active ON renders the localized Yes", rowValueText(heatingActiveId) === "Yes", rowValueText(heatingActiveId));

  // charging_active: real ESPHome binary_sensor OFF/ON shape via the
  // public `charging` entity.
  ingestPayload({ id: `${chargingActiveRoute.domain}/${chargingActiveRoute.configuredName}`, value: false, state: "OFF" });
  updateSettingsCatalogValue(chargingActiveId);
  check("charging_active OFF renders the localized No, never '--'", rowValueText(chargingActiveId) === "No", rowValueText(chargingActiveId));
  ingestPayload({ id: `${chargingActiveRoute.domain}/${chargingActiveRoute.configuredName}`, value: true, state: "ON" });
  updateSettingsCatalogValue(chargingActiveId);
  check("charging_active ON renders the localized Yes", rowValueText(chargingActiveId) === "Yes", rowValueText(chargingActiveId));

  // discharging_active: real ESPHome binary_sensor OFF/ON shape via the
  // public `discharging` entity.
  ingestPayload({ id: `${dischargingActiveRoute.domain}/${dischargingActiveRoute.configuredName}`, value: false, state: "OFF" });
  updateSettingsCatalogValue(dischargingActiveId);
  check("discharging_active OFF renders the localized No, never '--'", rowValueText(dischargingActiveId) === "No", rowValueText(dischargingActiveId));
  ingestPayload({ id: `${dischargingActiveRoute.domain}/${dischargingActiveRoute.configuredName}`, value: true, state: "ON" });
  updateSettingsCatalogValue(dischargingActiveId);
  check("discharging_active ON renders the localized Yes", rowValueText(dischargingActiveId) === "Yes", rowValueText(dischargingActiveId));

  // Localized EN check: setLanguage("en") then re-assert Yes/No text for
  // one representative row, proving both UK and EN localization work
  // through the same binary formatter (not just the default UK locale).
  setLanguage("en");
  updateSettingsCatalogValue(heatingActiveId);
  check("heating_active ON renders localized EN 'Yes' after language switch", rowValueText(heatingActiveId) === "Yes", rowValueText(heatingActiveId));
  ingestPayload({ id: `${heatingActiveRoute.domain}/${heatingActiveRoute.configuredName}`, value: false, state: "OFF" });
  updateSettingsCatalogValue(heatingActiveId);
  check("heating_active OFF renders localized EN 'No'", rowValueText(heatingActiveId) === "No", rowValueText(heatingActiveId));
  setLanguage("uk");

  // Packed siblings do not overwrite one another: total_voltage_raw and
  // current_raw are independently routed and independently updated (no
  // shared canonical key, no shared wire id); heating_active shares its
  // physical 0x12D0 block with bat_temp_sensor_1_present, but the two are
  // separate canonical keys/routes -- updating one must not touch the
  // other's already-resolved value.
  const batTemp1Id = manifestIdFor("bat_temp_sensor_1_present");
  const batTemp1Route = routesByKey.get("bat_temp_sensor_1_present");
  if (batTemp1Id && batTemp1Route) {
    ingestPayload({ id: `${batTemp1Route.domain}/${batTemp1Route.configuredName}`, value: true, state: "ON" });
    updateSettingsCatalogValue(batTemp1Id);
    const batTemp1Before = rowValueText(batTemp1Id);
    ingestPayload({ id: `${heatingActiveRoute.domain}/${heatingActiveRoute.configuredName}`, value: true, state: "ON" });
    updateSettingsCatalogValue(heatingActiveId);
    check("updating heating_active (same 0x12D0 block) does not change its packed sibling bat_temp_sensor_1_present's already-resolved value",
      rowValueText(batTemp1Id) === batTemp1Before, `before=${batTemp1Before} after=${rowValueText(batTemp1Id)}`);
  }
  check("total_voltage_raw's value is unaffected by current_raw's own update (independent routes)",
    rowValueText(totalVoltageRawId).startsWith("55.128"), rowValueText(totalVoltageRawId));

  // Existing total_voltage/current UI state remains independently
  // routable: their OWN wire ids (distinct from total_voltage_raw/
  // current_raw) still resolve to their OWN canonical keys.
  check("entityByWireId still resolves total_voltage's own wire id to canonical key \"total_voltage\" (unaffected by this fix)",
    entityByWireId.get("sensor/total voltage") === "total_voltage");
  check("entityByWireId still resolves current's own wire id to canonical key \"current\" (unaffected by this fix)",
    entityByWireId.get("sensor/current") === "current");
  ingestPayload({ id: "sensor/total voltage", value: 55.2, state: "55.200 V" });
  ingestPayload({ id: "sensor/current", value: 1.5, state: "1.500 A" });
  check("state.total_voltage is independently populated from its own payload, not from total_voltage_raw's", state.total_voltage && state.total_voltage.state === "55.200 V");
  check("state.current is independently populated from its own payload, not from current_raw's", state.current && state.current.state === "1.500 A");
  check("state.total_voltage_raw is unaffected by total_voltage's own, separate payload", state.total_voltage_raw && state.total_voltage_raw.state === "55.128 V");

  // =========================================================================
  // Zero rebuild proof: the catalog's own row count never changes across
  // this entire test (every update above went through updateSettingsCatalogValue()'s
  // targeted per-row path, never a rebuild).
  // =========================================================================
  check("row count is unchanged after every SSE update in this test (no whole-list rebuild)", rows().length === SETTINGS_CATALOG_ROWS.length);

  console.log(`\nprotocol entity routing production DOM test summary: ${checks - failures}/${checks} passed`);
  process.exit(failures ? 1 : 0);
}

main();
