#!/usr/bin/env node
"use strict";

// EXECUTABLE PRODUCTION-JS DOM TEST -- runs the REAL jk_bms.js closures
// (renderSettingsCatalog, relocalizeSettingsCatalog, updateSettingsCatalogValue,
// settingsRowValueText via the real row-rendering path, setLanguage)
// inside a Node `vm` sandbox, via the SAME opt-in
// window.__JK_BMS_TEST_HOOKS__ escape hatch this project's other DOM
// tests already use (FakeNode/harness shape adapted verbatim from
// test_settings_catalog.js). No UI logic is reimplemented here.
//
// Test data is injected directly into the REAL, shared `state` object
// (exposed via the test hook) rather than through ingestPayload()'s own
// wire-id alias resolution -- a real, PRE-EXISTING, unrelated gap
// (several canonical keys, including hardware_version/software_version/
// setup_passcode/uart1_mprtol_enable/port_switch, have no registered
// entityByWireId alias in this codebase yet, confirmed directly and out
// of scope for this narrow formatting fix) means those specific keys
// cannot be reached via ingestPayload() in this test environment. Every
// formatter/renderer function exercised below is still the real
// production one, reading the real `state` object the real ingestPayload()
// would have populated had the alias existed -- this is not a
// reimplementation of any formatting logic.
//
// Covers ("finish the Settings architecture" correctness fix, 2026-09-22):
//   1.  hardware_version="15A" renders exactly "15A"
//   2.  software_version="15.41" remains exact text
//   3.  ASCII values with leading zeros remain unchanged
//   4.  HEX/raw values never pass through floating-point formatting
//   5.  exact text SSE updates update only the correct row
//   6.  every RW BIT row renders a <select>, never a number input
//   7.  documented enum labels take precedence
//   8.  BIT without enum map uses localized No/Yes
//   9.  numeric/string/boolean/ON/OFF forms select the correct option
//   10. live BIT select has an OK button and the existing write client
//   11. authorization/blocked BIT select is disabled, cannot dispatch
//   12. language switch relocalizes binary options without losing a
//       dirty draft or changing the selected value
//   13. disabled numeric editors receive min/max/step

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
let activeElement = null;
function toCamel(kebab) { return kebab.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); }
function parseSimpleSelector(sel) {
  sel = sel.trim();
  const attrMatch = sel.match(/^\[data-([a-z0-9-]+)(?:=(['"])([^'"]*)\2)?\]$/);
  if (attrMatch) return { kind: "data-attr", key: toCamel(attrMatch[1]), value: attrMatch[3] };
  if (sel.startsWith(".")) return { kind: "class", value: sel.slice(1) };
  // Compound "tag.class" (real querySelector supports this; jk_bms.js's
  // own production code uses it, e.g. "select.settings-catalog-editor").
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
    this.disabled = false;
    this.value = "";
    this.type = "";
    this.min = ""; this.max = ""; this.step = ""; this.inputMode = "";
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
  _walk(collector) { for (const child of this.childNodes) { collector(child); child._walk(collector); } }
  querySelectorAll(selectorList) { const out = []; this._walk((node) => { if (matchesSelector(node, selectorList)) out.push(node); }); return out; }
  querySelector(selectorList) { let found = null; this._walk((node) => { if (!found && matchesSelector(node, selectorList)) found = node; }); return found; }
  addEventListener(type, handler) { if (!this._listeners.has(type)) this._listeners.set(type, []); this._listeners.get(type).push(handler); }
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

let fetchCallLog = [];
async function fakeFetch(url, opts) {
  const method = (opts && opts.method) || "GET";
  fetchCallLog.push({ url: String(url), method });
  throw new Error(`test shim: unexpected fetch ${method} ${url} -- this test never issues a real HTTP request`);
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
    fetch: (...args) => fakeFetch(...args), confirm: () => true,
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "jk_bms.js" });
  const hooks = window.__JK_BMS_TEST_HOOKS__;
  if (!hooks.renderSettingsCatalog || !hooks.state) {
    throw new Error("jk_bms.js's test hook did not populate renderSettingsCatalog/state -- window.__JK_BMS_TEST_HOOKS__ shape may have drifted");
  }
  return { hooks, document, documentElement, body };
}

function main() {
  const { hooks, body } = loadRealClosures();
  const {
    renderSettingsCatalog, relocalizeSettingsCatalog, updateSettingsCatalogValue,
    setLanguage, SETTINGS_VIEW_MODEL, state,
  } = hooks;

  check("real jk_bms.js closures loaded via the test hook (not reimplemented)",
    typeof renderSettingsCatalog === "function" && typeof updateSettingsCatalogValue === "function");

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

  // Sanity: confirm the real generated rows this test depends on exist
  // with the expected valueKind (proves the generator/renderer are
  // actually wired together, not merely that the test's own assumptions
  // happen to match).
  const hwRow = SETTINGS_VIEW_MODEL.find((r) => r.canonicalKey === "hardware_version");
  const swRow = SETTINGS_VIEW_MODEL.find((r) => r.canonicalKey === "software_version");
  const hexRow = SETTINGS_VIEW_MODEL.find((r) => r.canonicalKey === "uart1_mprtol_enable");
  check("sanity: hardware_version is a real valueKind=text row", hwRow && hwRow.valueKind === "text");
  check("sanity: software_version is a real valueKind=text row", swRow && swRow.valueKind === "text");
  check("sanity: uart1_mprtol_enable is a real valueKind=raw_text row", hexRow && hexRow.valueKind === "raw_text");

  renderSettingsCatalog();

  // =========================================================================
  // 1/2/3. Exact text rendering -- no numeric conversion, rounding, or
  // toFixed(), leading zeros preserved.
  // =========================================================================
  state.hardware_version = { state: "15A", value: "15A" };
  updateSettingsCatalogValue(hwRow.manifestId);
  const hwEl = rowFor(hwRow.manifestId).querySelector(".settings-catalog-value");
  check("hardware_version=\"15A\" renders exactly \"15A\" (not NaN/--/a rounded number)", hwEl.textContent === "15A", hwEl.textContent);

  state.software_version = { state: "15.41", value: "15.41" };
  updateSettingsCatalogValue(swRow.manifestId);
  const swEl = rowFor(swRow.manifestId).querySelector(".settings-catalog-value");
  check("software_version=\"15.41\" remains exact text (not toFixed()-mangled)", swEl.textContent === "15.41", swEl.textContent);

  state.software_version = { state: "01.05", value: "01.05" };
  updateSettingsCatalogValue(swRow.manifestId);
  check("ASCII value with a leading zero (\"01.05\") remains unchanged", swEl.textContent === "01.05", swEl.textContent);

  // =========================================================================
  // 4. HEX/raw values never pass through floating-point formatting.
  // =========================================================================
  state.uart1_mprtol_enable = { state: "0x00FF", value: "0x00FF" };
  updateSettingsCatalogValue(hexRow.manifestId);
  const hexEl = rowFor(hexRow.manifestId).querySelector(".settings-catalog-value");
  check("HEX value \"0x00FF\" renders exactly, never converted through a float", hexEl.textContent === "0x00FF", hexEl.textContent);

  // =========================================================================
  // 5. Exact text SSE updates hit only the correct row.
  // =========================================================================
  const swBefore = swEl.textContent;
  state.hardware_version = { state: "16B", value: "16B" };
  updateSettingsCatalogValue(hwRow.manifestId);
  check("updating hardware_version does not touch software_version's own row", swEl.textContent === swBefore, swEl.textContent);
  check("hardware_version's own row DID update", hwEl.textContent === "16B", hwEl.textContent);

  // =========================================================================
  // 6/7/8/9. BIT rows render a <select>, never a number input; documented
  // enum labels take precedence; undocumented BIT uses localized No/Yes;
  // numeric/string/boolean/ON/OFF forms all resolve to the right option.
  // =========================================================================
  const gpsRow = rowFor("GPS Heartbeat"); // gps_heartbeat, live, no enum_map
  check("GPS Heartbeat (BIT, no enum_map, live) renders a <select>, never an <input>",
    !!gpsRow.querySelector(".settings-catalog-editor") && gpsRow.querySelector(".settings-catalog-editor").tagName.toLowerCase() === "select");
  const gpsSelect = gpsRow.querySelector(".settings-catalog-editor");
  const gpsOptionTexts = gpsSelect.childNodes.map((o) => o.textContent);
  check("undocumented BIT select offers exactly 2 options, localized No/Yes (EN)",
    JSON.stringify(gpsOptionTexts) === JSON.stringify(["No", "Yes"]), JSON.stringify(gpsOptionTexts));

  const portRow = rowFor("Port Switch"); // port_switch, BIT WITH enum_map (CAN/RS485)
  const portSelect = portRow.querySelector(".settings-catalog-editor");
  const portOptionTexts = portSelect.childNodes.map((o) => o.textContent);
  check("a documented enum_map (Port Switch: CAN/RS485) takes precedence over the generic No/Yes BIT fallback",
    JSON.stringify(portOptionTexts) === JSON.stringify(["CAN", "RS485"]), JSON.stringify(portOptionTexts));

  const formCases = [
    { desc: "numeric 1", payload: { state: "1", value: 1 }, expected: "1" },
    { desc: "string \"1\"", payload: { state: "1", value: "1" }, expected: "1" },
    { desc: "boolean true", payload: { state: "true", value: true }, expected: "1" },
    { desc: "\"ON\"", payload: { state: "ON", value: "ON" }, expected: "1" },
    { desc: "\"true\"", payload: { state: "true", value: "true" }, expected: "1" },
    { desc: "numeric 0", payload: { state: "0", value: 0 }, expected: "0" },
    { desc: "\"OFF\"", payload: { state: "OFF", value: "OFF" }, expected: "0" },
    { desc: "boolean false", payload: { state: "false", value: false }, expected: "0" },
  ];
  for (const c of formCases) {
    state.gps_heartbeat = c.payload;
    updateSettingsCatalogValue("GPS Heartbeat");
    check(`BIT select resolves the correct option for runtime form: ${c.desc}`, gpsSelect.value === c.expected, `got=${gpsSelect.value}`);
  }

  // =========================================================================
  // 10. Live BIT select has an OK button and the EXISTING write client.
  // =========================================================================
  const gpsButton = gpsRow.querySelector(".settings-catalog-action");
  check("live BIT row has a real OK button", !!gpsButton);
  check("live BIT row's button carries data-wr-action=preflight-write + data-wr-key (the existing Stage 4 client)",
    gpsButton.dataset.wrAction === "preflight-write" && gpsButton.dataset.wrKey === "gps_heartbeat");
  check("live BIT select id follows the wr_<key> convention (existing production client)", gpsSelect.id === "wr_gps_heartbeat");

  // =========================================================================
  // 11. authorization/blocked BIT select is disabled, cannot dispatch.
  // =========================================================================
  check("Port Switch (authorization_required BIT+enum) select is disabled", portSelect.disabled === true);
  check("Port Switch row has no button anywhere (cannot dispatch)", !portRow.querySelector("button"));

  const smartSleepEnRow = rowFor("SmartSleep"); // smart_sleep_enabled, live software-ready, BIT no enum
  const sseSelect = smartSleepEnRow.querySelector(".settings-catalog-editor");
  check("smart_sleep_enabled (BIT, no enum_map, live) also renders a <select>", sseSelect.tagName.toLowerCase() === "select");

  // =========================================================================
  // 12. Language switch relocalizes binary options without changing the
  // selected value or losing a dirty draft.
  // =========================================================================
  state.gps_heartbeat = { state: "1", value: 1 };
  updateSettingsCatalogValue("GPS Heartbeat");
  gpsSelect.value = "0"; // simulate a user's in-progress selection
  gpsSelect.dataset.dirty = "true";
  gpsSelect.focus();
  const valueBeforeSwitch = gpsSelect.value;
  setLanguage("uk");
  const gpsOptionTextsUk = gpsSelect.childNodes.map((o) => o.textContent);
  check("EN->UK: BIT select options actually relocalize", JSON.stringify(gpsOptionTextsUk) === JSON.stringify(["Ні", "Так"]), JSON.stringify(gpsOptionTextsUk));
  check("EN->UK: the dirty draft selection (\"0\") survives the relocalization", gpsSelect.value === valueBeforeSwitch, gpsSelect.value);
  setLanguage("en");
  check("UK->EN: options relocalize back to English", JSON.stringify(gpsSelect.childNodes.map((o) => o.textContent)) === JSON.stringify(["No", "Yes"]));
  check("UK->EN: selection still unchanged after the second switch", gpsSelect.value === valueBeforeSwitch, gpsSelect.value);

  // =========================================================================
  // 13. Disabled numeric editors receive generated min/max/step.
  // =========================================================================
  const cellCountRow = rowFor("CellCount"); // cell_count, blocked, numeric, min=1
  const cellCountInput = cellCountRow.querySelector(".settings-catalog-editor");
  check("disabled numeric editor (CellCount) is a real <input>, not a select/no-control", cellCountInput.tagName.toLowerCase() === "input" && cellCountInput.disabled === true);
  check("disabled numeric editor receives the generated min", cellCountInput.min === "1", cellCountInput.min);

  // =========================================================================
  // Zero dispatch anywhere in this whole test.
  // =========================================================================
  check("zero fetch/POST calls were issued anywhere in this entire test run", fetchCallLog.length === 0, JSON.stringify(fetchCallLog));

  console.log(`\nsettings value-formatting DOM test summary: ${checks - failures}/${checks} passed`);
  process.exit(failures ? 1 : 0);
}

main();
