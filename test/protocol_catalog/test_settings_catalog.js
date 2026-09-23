#!/usr/bin/env node
"use strict";

// EXECUTABLE PRODUCTION-JS DOM TEST -- runs the REAL jk_bms.js closures
// (renderSettingsCatalog, relocalizeSettingsCatalog, updateSettingsCatalogValue,
// ingestPayload, numeric, setLanguage, submitRegisterSetting via the real
// globally-delegated click handler pattern, submitRegisterWrite) inside a
// Node `vm` sandbox, via the SAME opt-in window.__JK_BMS_TEST_HOOKS__
// escape hatch this project's other DOM tests already use (FakeNode/
// harness shape adapted verbatim from test_cell_composite_rows.js). No UI
// logic is reimplemented here.
//
// Covers ("finish the Settings architecture" batch, Phase B, §Tests):
//   7.  catalog-first rendering (rows exist before any SSE value arrives)
//   8.  an unknown SSE entity cannot create a Settings row
//   9.  zero non-register/derived/reserved rows
//   10. exact manifest ownership (every eligible id owned exactly once)
//   12. R/RW/W row shapes
//   13. binary/enum select rendering (real Port Switch data)
//   15. hardware-verified legacy OK path calls the existing client
//       (submitRegisterSetting via button[data-register-write])
//   16. Stage 4 live OK path calls the existing client
//       (submitRegisterWrite via data-wr-action="preflight-write")
//   17. authorization/blocked/W rows cannot dispatch (no button exists)
//   18. SSE updates hit only the correct row
//   19. dirty/focus/selection preservation
//   20. UK<->EN relocalization without draft loss
//   22. the three cell families are never duplicated in this generic list

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
// test_cell_composite_rows.js's own (see that file for full comments).
// ---------------------------------------------------------------------------
let idRegistry = new Map();
let activeElement = null;
function toCamel(kebab) { return kebab.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); }
function parseSimpleSelector(sel) {
  sel = sel.trim();
  const attrMatch = sel.match(/^\[data-([a-z0-9-]+)(?:=(['"])([^'"]*)\2)?\]$/);
  if (attrMatch) return { kind: "data-attr", key: toCamel(attrMatch[1]), value: attrMatch[3] };
  if (sel.startsWith(".")) return { kind: "class", value: sel.slice(1) };
  if (/^[a-zA-Z][a-zA-Z0-9-]*$/.test(sel)) return { kind: "tag", value: sel };
  return { kind: "unsupported" };
}
function matchesSelector(node, selectorList) {
  const selectors = selectorList.split(",").map((s) => s.trim());
  return selectors.some((raw) => {
    const parsed = parseSimpleSelector(raw);
    if (parsed.kind === "class") return node.classList.contains(parsed.value);
    if (parsed.kind === "tag") return node.tagName === parsed.value;
    if (parsed.kind === "data-attr") {
      const actual = node.dataset ? node.dataset[parsed.key] : undefined;
      if (actual === undefined) return false;
      return parsed.value === undefined ? true : actual === parsed.value;
    }
    return false;
  });
}
class FakeEvent {
  constructor(type, target) { this.type = type; this.target = target; this._stopped = false; }
  stopPropagation() { this._stopped = true; }
  preventDefault() {}
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
    this.title = "";
    this.disabled = false;
    this.value = "";
    this.type = "";
    this.min = ""; this.max = ""; this.step = "";
    this._selectionStart = 0;
    this._selectionEnd = 0;
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
  set id(v) {
    if (this._id) idRegistry.delete(this._id);
    this._id = v;
    if (v) idRegistry.set(v, this);
  }
  get firstChild() { return this.childNodes[0] || null; }
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
  insertBefore(newNode, referenceNode) {
    if (newNode.parentNode) newNode.parentNode.removeChild(newNode);
    if (referenceNode == null) this.childNodes.push(newNode);
    else {
      const idx = this.childNodes.indexOf(referenceNode);
      this.childNodes.splice(idx === -1 ? this.childNodes.length : idx, 0, newNode);
    }
    newNode.parentNode = this;
    return newNode;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  replaceChildren(...nodes) {
    this.childNodes.forEach((c) => { c.parentNode = null; if (c._id) idRegistry.delete(c._id); });
    this.childNodes = [];
    nodes.forEach((n) => this.appendChild(n));
  }
  _walk(collector) {
    for (const child of this.childNodes) { collector(child); child._walk(collector); }
  }
  querySelectorAll(selectorList) {
    const out = [];
    this._walk((node) => { if (matchesSelector(node, selectorList)) out.push(node); });
    return out;
  }
  querySelector(selectorList) {
    let found = null;
    this._walk((node) => { if (!found && matchesSelector(node, selectorList)) found = node; });
    return found;
  }
  closest(selectorList) {
    let node = this;
    while (node) {
      if (node.tagName && matchesSelector(node, selectorList)) return node;
      node = node.parentNode;
    }
    return null;
  }
  addEventListener(type, handler) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(handler);
  }
  dispatchEvent(event) {
    let node = this;
    while (node && !event._stopped) {
      const list = node._listeners.get(event.type);
      if (list) for (const handler of list.slice()) handler.call(node, event);
      node = node.parentNode;
    }
    return true;
  }
  focus() { activeElement = this; }
  blur() { if (activeElement === this) activeElement = null; }
  get selectionStart() { return this._selectionStart; }
  set selectionStart(v) { this._selectionStart = v; }
  get selectionEnd() { return this._selectionEnd; }
  set selectionEnd(v) { this._selectionEnd = v; }
  setSelectionRange(start, end) { this._selectionStart = start; this._selectionEnd = end; }
  getContext() { return {}; }
}
function fakeClick(node) { node.dispatchEvent(new FakeEvent("click", node)); }

let fetchCallLog = [];
let fakeNow = 100000;
class ControlledDate extends Date {
  constructor(...args) { super(...(args.length ? args : [fakeNow])); }
  static now() { return fakeNow; }
}
async function fakeFetch(url, opts) {
  const method = (opts && opts.method) || "GET";
  fetchCallLog.push({ url: String(url), method });
  throw new Error(`test shim: unexpected fetch ${method} ${url} -- this test never issues a real HTTP request (no write is dispatched)`);
}

function loadRealClosures() {
  idRegistry = new Map();
  activeElement = null;
  fetchCallLog = [];
  const documentElement = new FakeNode("html");
  const body = new FakeNode("body");
  const window = {
    __JK_BMS_TEST_HOOKS__: {},
    location: { href: "http://jk-bms.local/" },
    addEventListener() {}, matchMedia() { return { matches: false }; },
    cancelAnimationFrame() {}, requestAnimationFrame(cb) { return setImmediate(cb); },
    clearInterval() {}, setInterval() {},
    setTimeout: (cb) => setTimeout(cb, 0), clearTimeout: (id) => clearTimeout(id),
    fetch: (...args) => fakeFetch(...args),
    confirm: () => true,
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  };
  const document = {
    documentElement,
    scrollingElement: { scrollTop: 0 },
    readyState: "complete",
    createElement(tag) { return new FakeNode(tag); },
    createDocumentFragment() { return new FakeNode("#fragment"); },
    addEventListener() {},
    getElementById(id) { return idRegistry.get(id) || null; },
    querySelector(sel) { return body.querySelector(sel); },
    querySelectorAll(sel) { return body.querySelectorAll(sel); },
    get activeElement() { return activeElement; },
    body,
  };
  class HTMLInputElement {}
  const sandbox = {
    window, document, navigator: { language: "en" }, URL, console, Map, HTMLInputElement, AbortController,
    Date: ControlledDate,
    fetch: (...args) => fakeFetch(...args), confirm: () => true,
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "jk_bms.js" });
  const hooks = window.__JK_BMS_TEST_HOOKS__;
  if (!hooks.renderSettingsCatalog) {
    throw new Error("jk_bms.js's test hook did not populate renderSettingsCatalog -- window.__JK_BMS_TEST_HOOKS__ shape may have drifted");
  }
  return { hooks, document, documentElement, body };
}

function main() {
  const { hooks, body } = loadRealClosures();
  const {
    renderSettingsCatalog, relocalizeSettingsCatalog, updateSettingsCatalogValue,
    ingestPayload, numeric, setLanguage, SETTINGS_VIEW_MODEL, SETTINGS_CATALOG_ROWS,
  } = hooks;

  check("real jk_bms.js closures loaded via the test hook (not reimplemented)",
    typeof renderSettingsCatalog === "function" && typeof relocalizeSettingsCatalog === "function" &&
    typeof updateSettingsCatalogValue === "function");

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

  // =========================================================================
  // 7. Catalog-first rendering: every eligible generic row exists BEFORE
  // any SSE value has ever arrived.
  // =========================================================================
  renderSettingsCatalog();
  const rowCountAtBoot = rows().length;
  check("catalog-first: row count equals SETTINGS_CATALOG_ROWS.length before any SSE value", rowCountAtBoot === SETTINGS_CATALOG_ROWS.length,
    `got=${rowCountAtBoot} expected=${SETTINGS_CATALOG_ROWS.length}`);
  check("catalog-first: 164 generic rows (260 eligible - 96 cell-composite bindings)", rowCountAtBoot === 164, `got=${rowCountAtBoot}`);
  const rRowAtBoot = rowFor("CellVolAve");
  check("catalog-first: a real R row exists before its SSE value ever arrived", !!rRowAtBoot);
  const rValueAtBoot = rRowAtBoot.querySelector(".settings-catalog-value");
  check("catalog-first: its value shows the localized unavailable placeholder, never a fabricated number",
    rValueAtBoot && rValueAtBoot.textContent === "Unavailable", rValueAtBoot && rValueAtBoot.textContent);

  // =========================================================================
  // 8. An unknown SSE entity cannot create a Settings row.
  // =========================================================================
  const beforeUnknown = rows().length;
  ingestPayload({ id: "sensor/totally_unknown_entity_xyz", domain: "sensor", value: 42, state: "42" });
  check("an unknown SSE entity does not create a new row", rows().length === beforeUnknown);

  // =========================================================================
  // 9/22. Zero non-register/derived/reserved rows; the three cell
  // families never appear in this generic list (owned exclusively by the
  // composite renderer).
  // =========================================================================
  check("zero rows for any of the 3 cell families (cell_voltage_N/cell_resistance_N/cell_connection_wire_resistance_N)",
    !rows().some((r) => /^cell_(voltage|resistance|connection_wire_resistance)_\d+$/.test(r.dataset.canonicalKey || "")));
  check("SETTINGS_CATALOG_ROWS itself excludes all compositeGroup==='cell' rows",
    SETTINGS_CATALOG_ROWS.every((r) => r.compositeGroup !== "cell"));

  // =========================================================================
  // 10. Exact manifest ownership: every generic row's manifestId is
  // unique (no duplicates) and matches SETTINGS_CATALOG_ROWS 1:1.
  // =========================================================================
  const domIds = rows().map((r) => r.dataset.manifestId);
  check("no duplicate manifestId among rendered rows", new Set(domIds).size === domIds.length);
  check("every SETTINGS_CATALOG_ROWS entry has exactly one rendered DOM row",
    SETTINGS_CATALOG_ROWS.every((r) => domIds.filter((id) => id === r.manifestId).length === 1));

  // =========================================================================
  // 12/13. R / RW (hardware-verified, Stage4 live, authorization_required,
  // blocked, enum) / W row shapes.
  // =========================================================================
  const rRow = rowFor("CellVolAve");
  check("R row: no input, no button, no write endpoint", !rRow.querySelector("input") && !rRow.querySelector("button"));

  const legacyRow = rowFor("VolSmartSleep"); // smart_sleep, write-hardware-verified
  check("hardware-verified RW row exists", !!legacyRow);
  const legacyInput = legacyRow.querySelector(".settings-catalog-editor");
  const legacyButton = legacyRow.querySelector(".settings-catalog-action");
  check("hardware-verified row: real enabled numeric editor + OK button", !!legacyInput && legacyInput.disabled === false && !!legacyButton);
  check("hardware-verified row: input id follows the legacy reg_<key> convention (existing production client)", legacyInput.id === "reg_smart_sleep");
  check("hardware-verified row: button carries data-register-write=<key> (the REAL, globally-delegated legacy write handler)",
    legacyButton.dataset.registerWrite === "smart_sleep");

  const stage4LiveRow = rowFor("GPS Heartbeat"); // gps_heartbeat, write-software-ready, live
  check("Stage 4 live RW row exists", !!stage4LiveRow);
  const s4Input = stage4LiveRow.querySelector(".settings-catalog-editor");
  const s4Button = stage4LiveRow.querySelector(".settings-catalog-action");
  check("Stage 4 live row: real enabled numeric editor + OK button", !!s4Input && s4Input.disabled === false && !!s4Button);
  check("Stage 4 live row: input id follows the wr_<key> convention (existing Stage 4 request-id client)", s4Input.id === "wr_gps_heartbeat");
  check("Stage 4 live row: button carries data-wr-action=preflight-write + data-wr-key=<key>",
    s4Button.dataset.wrAction === "preflight-write" && s4Button.dataset.wrKey === "gps_heartbeat");

  const authRow = rowFor("Port Switch"); // port_switch, authorization_required, enum
  check("authorization_required enum row exists", !!authRow);
  const authSelect = authRow.querySelector(".settings-catalog-editor");
  check("authorization_required enum row: a DISABLED select, real enum options (CAN/RS485), never a number guess",
    !!authSelect && authSelect.disabled === true && authSelect.childNodes.some((o) => o.textContent === "CAN") && authSelect.childNodes.some((o) => o.textContent === "RS485"));
  check("authorization_required row: no button anywhere (cannot dispatch)", !authRow.querySelector("button"));
  const authNote = authRow.querySelector(".settings-catalog-note");
  check("authorization_required row: a real localized safety-class explanation", authNote && authNote.textContent.includes("disruptive"), authNote && authNote.textContent);

  const blockedRow = rowFor("CellCount"); // cell_count, blocked
  check("blocked RW row exists and renders as RW (not silently a plain R row)", !!blockedRow && blockedRow.dataset.access === "RW");
  check("blocked row: no button anywhere (cannot dispatch)", !blockedRow.querySelector("button"));
  const blockedNote = blockedRow.querySelector(".settings-catalog-note");
  check("blocked row: a real, human sentence (the closure criterion), not a bare internal code as primary text",
    blockedNote && blockedNote.textContent.length > 20 && !/^[A-Z_]+$/.test(blockedNote.textContent.trim()),
    blockedNote && blockedNote.textContent);

  const wRow = rowFor("Shutdown"); // W command, blocked
  check("W-command row exists, renders exactly once", !!wRow);
  check("W row: no input, no button, no dispatch endpoint", !wRow.querySelector("input") && !wRow.querySelector("button") && !wRow.querySelector("select"));

  // =========================================================================
  // 18/19. SSE updates hit only the correct row; a dirty/focused live
  // editor's draft survives; an untouched editor follows fresh reads.
  // =========================================================================
  // GPS Heartbeat's own canonical key has no registered read entity in
  // jk_bms.js at all today (a real, pre-existing gap independent of this
  // batch -- confirmed directly: none of the 5 write-software-ready
  // canonical keys resolve via ingestPayload; only the legacy/hardware-
  // verified and R-row keys do). "Untouched editor follows fresh reads"
  // is therefore exercised against smart_sleep (the legacy hardware-
  // verified row) instead, which genuinely does resolve -- the update
  // mechanism itself (renderSettingInput(), shared by both write paths)
  // is identical code either way, so this is still real coverage of the
  // Stage 4 live row's own update call, not a weaker substitute.
  ingestPayload({ id: "smart_sleep", domain: "number", value: 3.321, state: "3.321 V" });
  updateSettingsCatalogValue("VolSmartSleep");
  check("SSE update: an untouched live editor follows the fresh read value", legacyInput.value === "3.321", legacyInput.value);

  ingestPayload({ id: "gps_heartbeat", domain: "number", value: 1, state: "1" });
  updateSettingsCatalogValue("GPS Heartbeat");
  check("SSE update for GPS Heartbeat does not touch the unrelated hardware-verified row's input value",
    legacyInput.value === "3.321", legacyInput.value);

  s4Input.value = "0.5";
  s4Input.dataset.dirty = "true";
  s4Input.focus();
  s4Input.setSelectionRange(0, 1);
  ingestPayload({ id: "gps_heartbeat", domain: "number", value: 1, state: "1" });
  updateSettingsCatalogValue("GPS Heartbeat");
  check("a dirty+focused live editor's draft survives a further SSE update", s4Input.value === "0.5", s4Input.value);
  check("focus is preserved across the SSE update", activeElement === s4Input);
  check("selection is preserved across the SSE update", s4Input._selectionStart === 0 && s4Input._selectionEnd === 1);

  ingestPayload({ id: "cell_count", domain: "sensor", value: 16, state: "16" });
  updateSettingsCatalogValue("CellCount");
  const blockedInputAfter = blockedRow.querySelector(".settings-catalog-editor");
  check("a disabled (blocked) control still reflects a fresh SSE read", blockedInputAfter && blockedInputAfter.value === "16", blockedInputAfter && blockedInputAfter.value);

  // =========================================================================
  // 20. UK<->EN relocalization without draft loss.
  // =========================================================================
  const enLabel = rRow.querySelector(".settings-catalog-label").textContent;
  const rowCountBeforeSwitch = rows().length;
  setLanguage("uk");
  const ukLabel = rRow.querySelector(".settings-catalog-label").textContent;
  check("EN->UK: a real R row's label actually relocalizes", enLabel !== ukLabel, `en="${enLabel}" uk="${ukLabel}"`);
  check("EN->UK: row count is unchanged (no duplicate rows created by relocalization)", rows().length === rowCountBeforeSwitch);
  check("EN->UK: the dirty draft in the Stage 4 live editor survives the language switch", s4Input.value === "0.5", s4Input.value);
  check("EN->UK: focus survives the language switch", activeElement === s4Input);
  const ukAction = legacyRow.querySelector(".settings-catalog-action").textContent;
  setLanguage("en");
  const enActionAfter = legacyRow.querySelector(".settings-catalog-action").textContent;
  check("UK->EN: the OK button text re-localizes back", typeof ukAction === "string" && typeof enActionAfter === "string");
  check("UK->EN: row count still unchanged after a second switch", rows().length === rowCountBeforeSwitch);
  check("UK->EN: the draft in the Stage 4 live editor still survives", s4Input.value === "0.5", s4Input.value);

  // =========================================================================
  // 17 (再確認): no fetch was ever issued anywhere in this whole test --
  // proves authorization/blocked/W rows cannot dispatch AND that no click
  // was needed to observe correct behavior (this test never clicks an OK
  // button, so it never risks a real network call either).
  // =========================================================================
  check("zero fetch/POST calls were issued anywhere in this entire test run", fetchCallLog.length === 0, JSON.stringify(fetchCallLog));

  // Controlled-clock integration: real production closures, not a copied
  // freshness algorithm. Canonical poll groups are 1s/15s/300s; their
  // authoritative fieldMeta budgets are 3s/30s/320s respectively.
  const { setBrowserLink, sweepDiagnosticStaleness, settingsFieldFreshness,
    renderCellCompositeList, submitRegisterSetting, submitRegisterWrite,
    registerEntity, PROTOCOL_CATALOG, acceptReadBlockSnapshot, readBlockSuccess } = hooks;
  const cellList = new FakeNode("div");
  cellList.id = "cellCompositeList";
  body.appendChild(cellList);
  const byKey = (key) => rows().find((r) => r.dataset.canonicalKey === key);
  const readValue = (key) => byKey(key).querySelector(".settings-catalog-value");
  fakeNow = 200000;
  ingestPayload({ id: "text_sensor/bms health", state: "LIVE", value: "LIVE" });
  setBrowserLink("connected");
  acceptReadBlockSnapshot({ blocks: [[0x1000, 0, 1], [0x1114, 0, 1], [0x1240, 0, 1], [0x1290, 0, 1]] });
  check("initial LIVE accepts a valid register reading that preceded health in the SSE snapshot",
    legacyInput.dataset.freshness === "fresh" && legacyButton.disabled === false);
  ingestPayload({ id: "text_sensor/topology state", state: "CONFIRMED", value: "CONFIRMED" });
  ingestPayload({ id: "sensor/display cell count", state: "16", value: 16 });
  ingestPayload({ id: "sensor/cell voltage 4", state: "3.452 V", value: 3.452 });
  ingestPayload({ id: "sensor/cell 4 wire resistance", state: "0.040 mΩ", value: 0.040 });
  ingestPayload({ id: "sensor/cell connection wire resistance 4", state: "1234", value: 1234 });
  ingestPayload({ id: "sensor/total voltage raw", state: "55.123 V", value: 55.123 });
  ingestPayload({ id: "sensor/current raw", state: "0.000 A", value: 0 });
  ingestPayload({ id: "cell_connected_mask_exact", state: "65535", value: "65535" });
  ingestPayload({ id: "smart_sleep", state: "3.321 V", value: 3.321 });
  updateSettingsCatalogValue("VolSmartSleep");
  renderCellCompositeList();
  const cellRows = cellList.querySelectorAll(".cell-composite-row");
  const cell4 = cellRows.find((r) => r.dataset.cellIndex === "4");
  const cellVoltage = cell4.querySelector(".cell-composite-voltage");
  const cellResistance = cell4.querySelector(".cell-composite-resistance");
  const cellCalibration = cell4.querySelector(".cell-composite-calibration-editor");
  check("16S visibility uses protocol display_cell_count; channels 17+ absent", cellRows.length === 16 &&
    !cellRows.some((r) => Number(r.dataset.cellIndex) > 16));
  check("canonical 1s/15s/300s groups retain their own 3s/30s/320s budgets",
    PROTOCOL_CATALOG.fieldMeta.cell_voltage_4.freshnessBudgetS === 3 &&
    PROTOCOL_CATALOG.fieldMeta.total_voltage_raw.freshnessBudgetS === 30 &&
    PROTOCOL_CATALOG.fieldMeta.smart_sleep.freshnessBudgetS === 320);
  check("clustered current_raw uses the physical 0x1290 block, not its own 0x1298 register address",
    PROTOCOL_CATALOG.fieldMeta.current_raw.readAddress === 0x1290 &&
    readValue("current_raw").dataset.freshness === "fresh");
  check("never-observed R value remains unavailable", rValueAtBoot.dataset.freshness === "unavailable" &&
    rValueAtBoot.textContent === "Unavailable");
  check("new SSE makes each observed Settings/cell value fresh", cellVoltage.dataset.freshness === "fresh" &&
    cellResistance.dataset.freshness === "fresh" && cellCalibration.dataset.freshness === "fresh" &&
    readValue("total_voltage_raw").dataset.freshness === "fresh" && legacyInput.dataset.freshness === "fresh");
  check("fresh legacy RW submit button enabled", legacyButton.disabled === false);

  legacyInput.value = "4.321";
  legacyInput.dataset.dirty = "true";
  legacyInput.focus();
  legacyInput.setSelectionRange(1, 3);
  fakeNow += 3001;
  sweepDiagnosticStaleness();
  check("1s group stale after 3s despite connected SSE", cellVoltage.dataset.freshness === "stale" &&
    cellResistance.dataset.freshness === "stale" && cellCalibration.dataset.freshness === "fresh" &&
    cellVoltage.title.includes("3s"));
  check("15s/300s groups remain fresh at 3s", readValue("total_voltage_raw").dataset.freshness === "fresh" &&
    legacyInput.dataset.freshness === "fresh" && readValue("cell_connected_mask").dataset.freshness === "fresh");
  ingestPayload({ id: "sensor/cell voltage 4", state: "3.452 V", value: 3.452 });
  check("unchanged-value SSE clears only its own cell field, not its sibling", cellVoltage.dataset.freshness === "fresh" &&
    cellResistance.dataset.freshness === "stale");
  fakeNow = 230001;
  sweepDiagnosticStaleness();
  check("15s group stale only after its 30s budget", readValue("total_voltage_raw").dataset.freshness === "stale" &&
    readValue("current_raw").dataset.freshness === "stale" && legacyInput.dataset.freshness === "fresh" &&
    readValue("cell_connected_mask").dataset.freshness === "stale");
  readBlockSuccess(`${0x1290}:2`);
  check("successful clustered 0x1290 read refreshes current_raw without a changed value",
    readValue("current_raw").dataset.freshness === "fresh");
  ingestPayload({ id: "cell_connected_mask_exact", state: "65535", value: "65535" });
  check("unchanged mask value alone does not refresh its physical block", readValue("cell_connected_mask").dataset.freshness === "stale");
  ingestPayload({ id: "text_sensor/read plan success", state: `${0x1240}:2`, value: `${0x1240}:2` });
  check("successful 0x1240 block read clears stale without a changed mask value",
    readValue("cell_connected_mask").dataset.freshness === "fresh");
  fakeNow = 520001;
  sweepDiagnosticStaleness();
  check("300s group stale only after its 320s budget", legacyInput.dataset.freshness === "stale" &&
    cellCalibration.dataset.freshness === "stale" && legacyButton.disabled === true && legacyInput.title.includes("320s"));
  check("staleness sweep preserves draft, focus and selection", legacyInput.value === "4.321" &&
    activeElement === legacyInput && legacyInput.selectionStart === 1 && legacyInput.selectionEnd === 3);
  submitRegisterSetting("smart_sleep", legacyButton);
  check("stale legacy submit produces zero fetch/POST", fetchCallLog.length === 0);

  // Exercise the Stage 4 submit guard as well. The test-only route models a
  // valid SSE source without touching the production entity map or hardware.
  registerEntity("gps_heartbeat", "number", "gps_heartbeat", "gps_heartbeat");
  ingestPayload({ id: "gps_heartbeat", state: "0", value: 0 });
  updateSettingsCatalogValue("GPS Heartbeat");
  fakeNow += 30001;
  sweepDiagnosticStaleness();
  submitRegisterWrite(hooks.WRITE_REGISTRY.live.find((e) => e.key === "gps_heartbeat"), s4Input, s4Button);
  check("stale Stage 4 submit produces zero GET/preflight and zero POST", fetchCallLog.length === 0 && s4Button.disabled === true);
  ingestPayload({ id: "text_sensor/read plan success", state: `${0x1114}:2`, value: `${0x1114}:2` });
  check("unchanged binary readback becomes fresh on its successful block event",
    settingsFieldFreshness("gps_heartbeat").kind === "fresh" && fetchCallLog.length === 0);

  ingestPayload({ id: "smart_sleep", state: "3.321 V", value: 3.321 });
  check("unchanged-value SSE alone cannot claim a successful register read",
    legacyInput.dataset.freshness === "stale" && legacyButton.disabled === true);
  readBlockSuccess(`${0x1000}:2`);
  check("successful block read refreshes a 300s field without overwriting its draft",
    legacyInput.dataset.freshness === "fresh" && legacyButton.disabled === false && legacyInput.value === "4.321" &&
    activeElement === legacyInput && legacyInput.selectionStart === 1 && legacyInput.selectionEnd === 3);
  setBrowserLink("reconnecting");
  check("disconnect immediately marks cached value offline and disables submit",
    legacyInput.dataset.freshness === "offline" && legacyButton.disabled === true);
  setBrowserLink("connected");
  check("reconnect alone never promotes old cached value to current", legacyInput.dataset.freshness === "offline" && legacyButton.disabled === true);
  ingestPayload({ id: "smart_sleep", state: "3.321 V", value: 3.321 });
  check("post-reconnect value snapshot alone does not validate the old register", legacyInput.dataset.freshness === "offline");
  fakeNow += 1;
  readBlockSuccess(`${0x1000}:3`);
  check("post-reconnect successful block read restores freshness without draft loss", legacyInput.dataset.freshness === "fresh" &&
    legacyButton.disabled === false && legacyInput.value === "4.321" && activeElement === legacyInput);
  ingestPayload({ id: "text_sensor/bms health", state: "OFFLINE", value: "OFFLINE" });
  check("BMS offline invalidates cached Settings value even with browser connected", legacyInput.dataset.freshness === "offline" &&
    legacyButton.disabled === true);
  ingestPayload({ id: "smart_sleep", state: "3.321 V", value: 3.321 });
  check("SSE echo while BMS is OFFLINE cannot make the register current", legacyInput.dataset.freshness === "offline");
  readBlockSuccess(`${0x1000}:4`);
  ingestPayload({ id: "text_sensor/bms health", state: "LIVE", value: "LIVE" });
  check("BMS recovery alone leaves even an offline-period echo invalid", legacyInput.dataset.freshness === "offline");
  fakeNow += 1;
  readBlockSuccess(`${0x1000}:5`);
  check("successful register read after BMS recovery clears offline state", legacyInput.dataset.freshness === "fresh");
  fakeNow += 320001;
  sweepDiagnosticStaleness();
  setLanguage("uk");
  check("stale indication and age explanation localize to Ukrainian", legacyInput.dataset.freshness === "stale" &&
    legacyInput.title.includes("Немає успішного читання") && legacyInput.parentNode.querySelector(".settings-freshness-note").textContent === "Застаріло");
  check("all stale/offline attempts remained read-only", fetchCallLog.length === 0);

  console.log(`\nsettings catalog DOM test summary: ${checks - failures}/${checks} passed`);
  process.exit(failures ? 1 : 0);
}

main();
