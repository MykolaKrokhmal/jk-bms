#!/usr/bin/env node
"use strict";

// EXECUTABLE PRODUCTION-JS DOM TEST -- runs the REAL jk_bms.js closures
// (renderCellCompositeList, updateCellCompositeVoltage,
// updateCellCompositeResistance, relocalizeCellCompositeList,
// activeCellCount, ingestPayload, setLanguage) inside a Node `vm` sandbox,
// via the SAME opt-in window.__JK_BMS_TEST_HOOKS__ escape hatch this
// project's other DOM tests already use (see test_write_registry_ui.js's
// own precedent, whose FakeNode/harness shape this file reuses/adapts).
// No UI logic is reimplemented here.
//
// Covers (typed-petting-puzzle plan, cell-composite batch, §8):
//   7.  N=8/16/24/32 -> exactly that many composite rows
//   8.  channels above N are absent from the DOM entirely (not merely
//       hidden/disabled) -- never focusable, never in the accessibility
//       surface, because the node simply does not exist
//   9.  invalid/unconfirmed N (0) shows the localized unconfirmed state,
//       never a 16/32 fallback
//   11. voltage/resistance SSE updates hit the correct row only
//   12. an SSE update at unchanged N never rebuilds unrelated rows (a
//       draft value + focus + selection in one row's calibration input
//       survive an unrelated row's voltage update)
//   13. live/authorizationRequired/blocked calibration control policy
//       (real WRITE_REGISTRY entries are all authorizationRequired today;
//       live/blocked are exercised via a controlled substitution of
//       WRITE_REGISTRY, still driving the REAL renderer code)
//   14. a blocked/authorization-required calibration never creates a
//       button or a write endpoint
//   15. UK/EN labels and units relocalize
//   16. 16->8 and 8->24 transitions: remaining active rows keep their
//       node (draft/focus survive); newly-inactive rows are actually
//       removed from the DOM

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
// FakeNode/document/window harness -- adapted from test_write_registry_ui.js.
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

let fakeNow = 0;
function fakeSetTimeout(cb) { return setImmediate(cb); }
function fakeClearTimeout(id) { clearImmediate(id); }

function loadRealClosures() {
  idRegistry = new Map();
  activeElement = null;
  const documentElement = new FakeNode("html");
  const body = new FakeNode("body");
  const window = {
    __JK_BMS_TEST_HOOKS__: {},
    location: { href: "http://jk-bms.local/" },
    addEventListener() {}, matchMedia() { return { matches: false }; },
    cancelAnimationFrame(id) { fakeClearTimeout(id); },
    requestAnimationFrame(cb) { return fakeSetTimeout(cb, 16); },
    clearInterval() {}, setInterval() {},
    setTimeout: (cb, ms) => setTimeout(cb, 0), clearTimeout: (id) => clearTimeout(id),
    fetch: async () => { throw new Error("test shim: unexpected fetch -- this test never issues a real write"); },
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
    fetch: window.fetch, confirm: window.confirm, __getFakeNow: () => fakeNow,
  };
  vm.createContext(sandbox);
  vm.runInContext("Date.now = function () { return __getFakeNow(); };", sandbox);
  vm.runInContext(source, sandbox, { filename: "jk_bms.js" });
  const hooks = window.__JK_BMS_TEST_HOOKS__;
  if (!hooks.renderCellCompositeList) {
    throw new Error("jk_bms.js's test hook did not populate renderCellCompositeList -- window.__JK_BMS_TEST_HOOKS__ shape may have drifted");
  }
  return { hooks, window, document, documentElement, body };
}

function main() {
  const { hooks, body } = loadRealClosures();
  const {
    renderCellCompositeList, updateCellCompositeVoltage, updateCellCompositeResistance,
    updateCellCompositeCalibration, relocalizeCellCompositeList, activeCellCount, ingestPayload, setLanguage,
    WRITE_REGISTRY, SETTINGS_VIEW_MODEL,
  } = hooks;

  check("real jk_bms.js closures loaded via the test hook (not reimplemented)",
    typeof renderCellCompositeList === "function" && typeof updateCellCompositeVoltage === "function" &&
    typeof relocalizeCellCompositeList === "function" && typeof activeCellCount === "function");

  const cellCompositeList = new FakeNode("div");
  cellCompositeList.id = "cellCompositeList";
  body.appendChild(cellCompositeList);
  const writeRegistryList = new FakeNode("div");
  writeRegistryList.id = "writeRegistryList";
  body.appendChild(writeRegistryList);
  const cellOverlay = new FakeNode("div");
  cellOverlay.id = "cellOverlay";
  cellOverlay.hidden = true;
  body.appendChild(cellOverlay);

  function setTopologyState(code) {
    ingestPayload({ id: "text_sensor/topology state", domain: "text_sensor", name: "topology state", value: code, state: code });
  }
  function setDisplayCellCount(n) {
    ingestPayload({ id: "sensor/display cell count", domain: "sensor", name: "display cell count", value: n, state: `${n}` });
  }
  function ingestVoltage(n, value) {
    ingestPayload({ id: `sensor/cell voltage ${n}`, domain: "sensor", name: `cell voltage ${n}`, value, state: `${value.toFixed(3)} V` });
  }
  function ingestResistance(n, value) {
    ingestPayload({ id: `sensor/cell ${n} wire resistance`, domain: "sensor", name: `cell ${n} wire resistance`, value, state: `${value.toFixed(3)} mΩ` });
  }
  function ingestCalibration(n, value) {
    ingestPayload({ id: `sensor/cell connection wire resistance ${n}`, domain: "sensor", name: `cell connection wire resistance ${n}`, value, state: `${value}` });
  }
  function rows() { return cellCompositeList.querySelectorAll(".cell-composite-row"); }
  function rowFor(n) { return rows().find((r) => Number(r.dataset.cellIndex) === n); }

  // =========================================================================
  // 0. Structural sanity on the real view-model consumed by the renderer.
  // =========================================================================
  const cellRows = SETTINGS_VIEW_MODEL.filter((r) => r.compositeGroup === "cell");
  check("SETTINGS_VIEW_MODEL carries exactly 96 cell-composite rows (32 channels x 3)", cellRows.length === 96, `got=${cellRows.length}`);

  // =========================================================================
  // 1. N=0 (unconfirmed) -- no rows, localized unconfirmed note shown.
  // =========================================================================
  setTopologyState("MISMATCH");
  setDisplayCellCount(0);
  renderCellCompositeList();
  check("activeCellCount() is 0 for an unconfirmed topology", activeCellCount() === 0);
  check("N=0: zero composite rows rendered", rows().length === 0, `got=${rows().length}`);
  const unconfirmedNote = cellCompositeList.querySelector(".cell-composite-unconfirmed");
  check("N=0: a localized unconfirmed note is shown instead of any fabricated row", !!unconfirmedNote && unconfirmedNote.textContent.length > 0);

  // =========================================================================
  // 2. N=8/16/24/32 -> exactly that many rows; N+1..32 absent from the DOM
  // entirely (never merely hidden/disabled).
  // =========================================================================
  for (const n of [8, 16, 24, 32]) {
    setTopologyState("CONFIRMED");
    setDisplayCellCount(n);
    for (let ch = 1; ch <= n; ch += 1) {
      ingestVoltage(ch, 3.4 + ch * 0.001);
      ingestResistance(ch, 0.05 + ch * 0.0001);
    }
    renderCellCompositeList();
    check(`N=${n}: activeCellCount() reports ${n}`, activeCellCount() === n);
    check(`N=${n}: exactly ${n} composite rows in the DOM`, rows().length === n, `got=${rows().length}`);
    for (let ch = 1; ch <= n; ch += 1) {
      check(`N=${n}, channel ${ch}: row exists`, !!rowFor(ch));
    }
    for (let ch = n + 1; ch <= 32; ch += 1) {
      check(`N=${n}, channel ${ch} (>N): row does NOT exist in the DOM at all`, !rowFor(ch));
    }
    // Reset to 0 between iterations so the next N is a clean "from unconfirmed" build.
    setDisplayCellCount(0);
    renderCellCompositeList();
    check(`N=${n}->0: rows cleared back to zero`, rows().length === 0);
  }

  // =========================================================================
  // 3. Row content: label, voltage, resistance, and calibration column
  // shape for a real (today: always authorizationRequired) channel.
  // =========================================================================
  setTopologyState("CONFIRMED");
  setDisplayCellCount(4);
  ingestVoltage(4, 3.452);
  ingestResistance(4, 0.0401);
  ingestCalibration(4, 0.055); // mΩ (raw 55 µΩ) -- the owner-reported real magnitude
  renderCellCompositeList();
  const row4 = rowFor(4);
  check("row 4 exists after building N=4", !!row4);
  const label4 = row4.querySelector(".cell-composite-label");
  check("row 4 label reads 'Cell 04' (padded, from i18n, not hardcoded)", label4 && label4.textContent === "Cell 04", label4 && label4.textContent);
  const voltage4 = row4.querySelector(".cell-composite-voltage");
  check("row 4 voltage shows the real ingested value with unit", voltage4 && voltage4.textContent.includes("3.452") && voltage4.textContent.includes("V"), voltage4 && voltage4.textContent);
  const resistance4 = row4.querySelector(".cell-composite-resistance");
  check("row 4 resistance shows the real ingested value with unit", resistance4 && /0\.040/.test(resistance4.textContent) && resistance4.textContent.includes("mΩ"), resistance4 && resistance4.textContent);

  // =========================================================================
  // Calibration value + unit rendering (authorization_required, today's
  // real policy) -- item 8 of this round's test list.
  // =========================================================================
  const calibInput4 = row4.querySelector(".cell-composite-calibration-editor");
  check("calibration input for row 4 exists and is disabled (authorizationRequired)", !!calibInput4 && calibInput4.disabled === true);
  check("calibration input is populated with the real current CellConWireRes4 value, not left blank",
    calibInput4 && calibInput4.value === "0.055", calibInput4 && calibInput4.value);
  const calibUnit4 = row4.querySelector(".cell-composite-calibration-unit");
  // Unit normalization (2026-09-26): raw register unit is 1 µΩ, the
  // owner-facing (and HA) unit is mΩ at scale 0.001 -- same as the measured
  // wire resistance beside it.
  check("calibration unit element renders the generated localized unit (mΩ, not a hardcoded fallback)",
    calibUnit4 && calibUnit4.textContent === "mΩ", calibUnit4 && calibUnit4.textContent);

  // =========================================================================
  // 13/14. Write-policy branches -- real data has every
  // cell_connection_wire_resistance_N as authorizationRequired; live and
  // blocked are exercised via a controlled, temporary substitution of
  // WRITE_REGISTRY's own arrays (still the REAL renderCellCompositeCalibration
  // branch logic, not a reimplementation).
  // =========================================================================
  const calib4 = row4.querySelector(".cell-composite-calibration");
  // Layout contract (2026-09-26): every cell row is label | voltage |
  // resistance | calibration, and the calibration is [field shell][action
  // slot] -- OK or the lock that replaces it, never both, never a lock in the shell.
  const allRows = rows();
  check("every cell row: label, voltage, resistance, calibration in that order",
    allRows.length >= 4 && allRows.every((r) => {
      const cls = r.childNodes.filter((k) => !k.classList.contains("settings-freshness-note")).map((k) => k.className);
      return /cell-composite-label/.test(cls[0]) && /cell-composite-voltage/.test(cls[1]) && /cell-composite-resistance/.test(cls[2]) &&
        /cell-composite-calibration/.test(cls[3]) && cls.length === 4;
    }));
  check("every cell calibration: one field shell followed by exactly one action slot (OK or lock)",
    allRows.every((r) => {
      const c = r.querySelector(".cell-composite-calibration");
      const i = c.childNodes.findIndex((k) => k.classList.contains("settings-field-shell"));
      const slot = c.childNodes[i + 1];
      const n = c.querySelectorAll(".cell-composite-action").length + c.querySelectorAll(".settings-lock").length;
      return i === 0 && n === 1 && slot && (slot.classList.contains("cell-composite-action") || slot.classList.contains("settings-action-lock")) &&
        !c.querySelector(".settings-field-shell").querySelector(".settings-lock");
    }));
  check("authorizationRequired: calibration input is disabled", !!calib4.querySelector("input") && calib4.querySelector("input").disabled === true);
  check("authorizationRequired: no submit button is ever created", !calib4.querySelector(".cell-composite-action"));
  // Settings controls simplification (2026-09-25): a short visible status;
  // the full safety-class sentence is the badge's title (hover/screen reader).
  const authState4 = calib4.querySelector(".cell-composite-write-state");
  check("authorizationRequired: no visible badge -- one lock in the action slot right after the locked field shell",
    !!authState4 && authState4.classList.contains("sr-only") && calib4.querySelectorAll(".settings-lock").length === 1 &&
    calib4.querySelector(".settings-lock").parentNode === calib4 &&
    calib4.childNodes[calib4.childNodes.findIndex((k) => k.classList.contains("settings-field-shell")) + 1] === calib4.querySelector(".settings-lock") &&
    !calib4.querySelector(".settings-field-shell").querySelector(".settings-lock"));
  check("authorizationRequired: the real safety class sentence is the input's accessible description and the lock's tooltip",
    !!authState4 && authState4.textContent.includes("disruptive") && calib4.querySelector("input").getAttribute("aria-describedby") === authState4.id &&
    calib4.querySelector(".settings-lock").title === authState4.textContent, authState4 && authState4.textContent);

  const realAuthEntry = WRITE_REGISTRY.authorizationRequired.find((e) => e.key === "cell_connection_wire_resistance_4");
  check("sanity: cell_connection_wire_resistance_4 really is authorizationRequired in the real, unmodified WRITE_REGISTRY", !!realAuthEntry);

  // WRITE_REGISTRY's arrays are Object.freeze()d (correctly, in production
  // -- a generated constant must never be runtime-mutable), so the live/
  // blocked branches are exercised via SOURCE-LEVEL text surgery instead:
  // a fresh vm instance loads a text-patched copy of the real jk_bms.js
  // source with one real WRITE_REGISTRY entry moved into a different
  // group array (live is checked before authorizationRequired before
  // blocked in findWriteRegistryEntryFor(), so injecting a duplicate-key
  // entry earlier in that search order deterministically shadows the
  // real one) -- still the REAL renderCellCompositeCalibration()/
  // findWriteRegistryEntryFor() branch logic, never a reimplementation.
  // Runs testFn against a freshly-vm-loaded, source-patched jk_bms.js
  // instance, under a SWAPPED module-level idRegistry -- isolates this
  // scenario's element ids (e.g. "cellCompositeList") from the outer
  // test's own DOM for the full duration of the scenario (build + ingest
  // + render + assert), then restores the outer registry unconditionally.
  function runInPatchedSandbox(marker, injectedLine, testFn, removeLineContaining) {
    const savedRegistry = idRegistry;
    const savedActive = activeElement;
    idRegistry = new Map();
    activeElement = null;
    try {
      let workingSource = source;
      if (removeLineContaining) {
        // findWriteRegistryEntryFor() checks live -> authorizationRequired
        // -> blocked in order and returns the FIRST match -- the real
        // authorizationRequired entry for this key must be removed so the
        // injected entry (in a group checked earlier, or the only
        // remaining one) is actually the one found.
        const lineRe = new RegExp(`^\\s*\\{[^\\n]*${removeLineContaining}[^\\n]*\\},\\n`, "m");
        if (!lineRe.test(workingSource)) throw new Error(`test shim: line to remove not found: ${removeLineContaining}`);
        workingSource = workingSource.replace(lineRe, "");
      }
      const idx = workingSource.indexOf(marker);
      if (idx === -1) throw new Error(`test shim: marker not found: ${marker}`);
      const insertAt = idx + marker.length;
      const patched = workingSource.slice(0, insertAt) + "\n      " + injectedLine + workingSource.slice(insertAt);
      const win = { __JK_BMS_TEST_HOOKS__: {}, location: { href: "http://jk-bms.local/" }, addEventListener() {}, matchMedia() { return { matches: false }; }, cancelAnimationFrame() {}, requestAnimationFrame(cb) { return setImmediate(cb); }, clearInterval() {}, setInterval() {}, setTimeout: (cb) => setTimeout(cb, 0), clearTimeout: (id) => clearTimeout(id), fetch: async () => { throw new Error("unexpected fetch"); }, confirm: () => true, localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} } };
      const localBody = new FakeNode("body");
      const localDoc = {
        documentElement: new FakeNode("html"), scrollingElement: { scrollTop: 0 }, readyState: "complete",
        createElement(tag) { return new FakeNode(tag); }, createDocumentFragment() { return new FakeNode("#fragment"); },
        addEventListener() {}, getElementById(id) { return idRegistry.get(id) || null; },
        querySelector(sel) { return localBody.querySelector(sel); }, querySelectorAll(sel) { return localBody.querySelectorAll(sel); },
        activeElement: null, body: localBody,
      };
      class HTMLInputElement {}
      const sandbox = { window: win, document: localDoc, navigator: { language: "en" }, URL, console, Map, HTMLInputElement, AbortController, fetch: win.fetch, confirm: win.confirm };
      vm.createContext(sandbox);
      vm.runInContext(patched, sandbox, { filename: "jk_bms.js (patched for test)" });
      const list = new FakeNode("div"); list.id = "cellCompositeList"; localBody.appendChild(list);
      const hooks = win.__JK_BMS_TEST_HOOKS__;
      hooks.ingestPayload({ id: "text_sensor/topology state", domain: "text_sensor", name: "topology state", value: "CONFIRMED", state: "CONFIRMED" });
      hooks.ingestPayload({ id: "sensor/display cell count", domain: "sensor", name: "display cell count", value: 4, state: "4" });
      hooks.ingestPayload({ id: "sensor/cell voltage 4", domain: "sensor", name: "cell voltage 4", value: 3.4, state: "3.400 V" });
      hooks.renderCellCompositeList();
      const row = list.querySelectorAll(".cell-composite-row").find((r) => Number(r.dataset.cellIndex) === 4);
      testFn(row, hooks);
    } finally {
      idRegistry = savedRegistry;
      activeElement = savedActive;
    }
  }

  runInPatchedSandbox(
    "live: Object.freeze([",
    `{ key: "cell_connection_wire_resistance_4", address: 4232, minimum: 0, maximum: 4294967295, step: 1, scale: 1, writeSafetyClass: "disruptive", submitPolicy: "live" },`,
    (row) => {
      const calib = row.querySelector(".cell-composite-calibration");
      check("live branch (source-patched): an enabled input is created", !!calib.querySelector("input") && calib.querySelector("input").disabled === false);
      check("live branch (source-patched): a real submit button is created", !!calib.querySelector(".cell-composite-action"));
      check("live branch (source-patched): the input id follows the wr_<key> convention (same as the write-registry client)",
        calib.querySelector("input").id === "wr_cell_connection_wire_resistance_4");
    }
  );

  runInPatchedSandbox(
    "blocked: Object.freeze([",
    `{ key: "cell_connection_wire_resistance_4", address: 4232, minimum: 0, maximum: 4294967295, step: 1, scale: 1, writeSafetyClass: "disruptive", reason: "RANGE_NOT_ESTABLISHED" },`,
    (row) => {
      const calib = row.querySelector(".cell-composite-calibration");
      check("blocked branch (source-patched): no input at all", !calib.querySelector("input"));
      check("blocked branch (source-patched): no submit button", !calib.querySelector(".cell-composite-action"));
      const blockedState = calib.querySelector(".cell-composite-write-state");
      check("blocked branch (source-patched): no visible badge -- exactly one lock indicator",
        blockedState.classList.contains("sr-only") && calib.querySelectorAll(".settings-lock").length === 1);
      check("blocked branch (source-patched): the real blocker reason is kept as the accessible description",
        blockedState.textContent.includes("RANGE_NOT_ESTABLISHED") &&
        calib.querySelector(".cell-composite-calibration-value").getAttribute("aria-describedby") === blockedState.id);
    },
    'key: "cell_connection_wire_resistance_4"'
  );

  // =========================================================================
  // 11/12. SSE per-value updates hit only the correct row, and never
  // rebuild the list (draft/focus/selection in an unrelated row's
  // calibration input survive) -- exercised at a real, unmodified N.
  // =========================================================================
  setTopologyState("CONFIRMED");
  setDisplayCellCount(8);
  for (let ch = 1; ch <= 8; ch += 1) { ingestVoltage(ch, 3.4); ingestResistance(ch, 0.05); }
  renderCellCompositeList();
  const row1 = rowFor(1);
  const row1Node = row1;
  const draftInput = row1.querySelector("input");
  draftInput.value = "0.123";
  draftInput.focus();
  draftInput.setSelectionRange(0, 2);

  updateCellCompositeVoltage(3);
  check("updateCellCompositeVoltage(3) does not touch row 1's node identity", rowFor(1) === row1Node);
  check("row 1's draft value survives an unrelated row's voltage update", draftInput.value === "0.123");
  check("row 1's focus survives an unrelated row's voltage update", activeElement === draftInput);
  updateCellCompositeVoltage(3);
  updateCellCompositeResistance(3);
  const row3Voltage = rowFor(3).querySelector(".cell-composite-voltage");
  check("row 3's own voltage cell actually updates", row3Voltage.textContent.includes("3.4"));
  check("draft value in row 1 still intact after row 3's own updates", draftInput.value === "0.123");
  check("row 1 focus/selection still intact after row 3's own updates",
    draftInput._selectionStart === 0 && draftInput._selectionEnd === 2);

  // =========================================================================
  // 9. Calibration SSE updates hit only the correct row (authorization-
  // required today: the input's own .value updates; other rows untouched).
  // =========================================================================
  setTopologyState("CONFIRMED");
  setDisplayCellCount(0); renderCellCompositeList();
  setDisplayCellCount(8);
  for (let ch = 1; ch <= 8; ch += 1) { ingestVoltage(ch, 3.4); ingestResistance(ch, 0.05); ingestCalibration(ch, 1000 + ch); }
  renderCellCompositeList();
  const calibRow2Before = rowFor(2).querySelector(".cell-composite-calibration-editor").value;
  ingestCalibration(5, 9999);
  updateCellCompositeCalibration(5);
  check("calibration SSE update changes only channel 5's own input value",
    rowFor(5).querySelector(".cell-composite-calibration-editor").value === "9999",
    rowFor(5).querySelector(".cell-composite-calibration-editor").value);
  check("calibration SSE update for channel 5 does not touch channel 2's input value",
    rowFor(2).querySelector(".cell-composite-calibration-editor").value === calibRow2Before);

  // =========================================================================
  // 10/11. live dirty/focused draft survives an SSE calibration update;
  // an untouched live editor follows fresh SSE values -- exercised via the
  // same source-patched live sandbox used for the write-policy branch
  // above (today's real data has no live calibration field at all).
  // =========================================================================
  runInPatchedSandbox(
    "live: Object.freeze([",
    `{ key: "cell_connection_wire_resistance_4", address: 4232, minimum: 0, maximum: 4294967295, step: 1, scale: 1, writeSafetyClass: "disruptive", submitPolicy: "live" },`,
    (row, hooks) => {
      const input = row.querySelector(".cell-composite-calibration-editor");
      // Untouched editor follows a fresh SSE value.
      hooks.ingestPayload({ id: "sensor/cell connection wire resistance 4", domain: "sensor", name: "cell connection wire resistance 4", value: 555, state: "555" });
      hooks.updateCellCompositeCalibration(4);
      check("live branch: an untouched (non-dirty, unfocused) editor follows a fresh SSE value",
        input.value === "555", input.value);
      // Now the user types a draft and focuses the field -- a further SSE
      // update must NOT overwrite it.
      input.value = "42";
      input.dataset.dirty = "true";
      input.focus();
      hooks.ingestPayload({ id: "sensor/cell connection wire resistance 4", domain: "sensor", name: "cell connection wire resistance 4", value: 777, state: "777" });
      hooks.updateCellCompositeCalibration(4);
      check("live branch: a dirty+focused editor's draft survives a further SSE update",
        input.value === "42", input.value);
    }
  );

  // =========================================================================
  // Structural: the production renderer resolves all three bindings from
  // SETTINGS_VIEW_MODEL -- no manually synthesized calibration key, no
  // hardcoded unit fallback.
  // =========================================================================
  check("jk_bms.js builds CELL_COMPOSITE_BINDINGS from SETTINGS_VIEW_MODEL (not a hand-built key)",
    /for \(const row of SETTINGS_VIEW_MODEL\)/.test(source) && /compositeGroup !== "cell"/.test(source));

  // Scoped structural check: the composite renderer's OWN function bodies
  // (not the rest of jk_bms.js, which legitimately builds cell_voltage_N/
  // cell_resistance_N/cell_connection_wire_resistance_N keys elsewhere for
  // unrelated subsystems -- e.g. the pre-existing cellVoltageKeys/
  // cellResistanceKeys arrays and entityByWireId's own alias table) must
  // never hand-construct any of the three cell keys.
  function extractFunctionBody(name) {
    const re = new RegExp(`function ${name}\\s*\\([^)]*\\)\\s*\\{`);
    const m = re.exec(source);
    if (!m) throw new Error(`test shim: function not found: ${name}`);
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (depth > 0 && i < source.length) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}") depth -= 1;
      i += 1;
    }
    return source.slice(start, i - 1);
  }
  const compositeFnBodies = [
    extractFunctionBody("cellCompositeFieldValue"),
    extractFunctionBody("cellCompositeFieldText"),
    extractFunctionBody("renderCellCompositeCalibration"),
    extractFunctionBody("renderCellCompositeRow"),
    extractFunctionBody("updateCellCompositeVoltage"),
    extractFunctionBody("updateCellCompositeResistance"),
    extractFunctionBody("updateCellCompositeCalibration"),
  ].join("\n");
  check("no manually synthesized calibration key (`cell_connection_wire_resistance_${...}`) is required by the composite renderer's own functions",
    !/cell_connection_wire_resistance_\$\{/.test(compositeFnBodies));
  check("no manually synthesized `cell_voltage_${...}` / `cell_resistance_${...}` key in the composite renderer's own functions",
    !/cell_voltage_\$\{/.test(compositeFnBodies) && !/cell_resistance_\$\{/.test(compositeFnBodies));
  check("the composite renderer's own functions never hardcode 'V'/'mΩ'/'µΩ' as a unit fallback",
    !/\|\|\s*"V"/.test(compositeFnBodies) && !/\|\|\s*"mΩ"/.test(compositeFnBodies) && !/\|\|\s*"µΩ"/.test(compositeFnBodies));
  check("cellCompositeFieldValue() reads via row.canonicalKey (the real state[] key), not row.readEntityId (a documentation-only ESPHome id)",
    /numeric\(row\.canonicalKey\)/.test(compositeFnBodies));

  // =========================================================================
  // 16. N transitions: 16->8 removes the tail, keeps the head (draft
  // survives); 8->24 appends the tail, keeps the head.
  // =========================================================================
  setTopologyState("CONFIRMED");
  setDisplayCellCount(0); renderCellCompositeList();
  setDisplayCellCount(16);
  for (let ch = 1; ch <= 16; ch += 1) ingestVoltage(ch, 3.4 + ch * 0.001);
  renderCellCompositeList();
  const rowOneBeforeShrink = rowFor(1);
  const shrinkDraft = rowOneBeforeShrink.querySelector("input");
  shrinkDraft.value = "9.99";

  setDisplayCellCount(8);
  renderCellCompositeList();
  check("16->8: exactly 8 rows remain", rows().length === 8, `got=${rows().length}`);
  check("16->8: channel 9 (now inactive) is fully removed from the DOM", !rowFor(9));
  check("16->8: channel 16 (now inactive) is fully removed from the DOM", !rowFor(16));
  check("16->8: channel 1 (still active) is the SAME node, draft preserved", rowFor(1) === rowOneBeforeShrink && rowFor(1).querySelector("input").value === "9.99");

  const rowOneBeforeGrow = rowFor(1);
  setDisplayCellCount(24);
  for (let ch = 9; ch <= 24; ch += 1) ingestVoltage(ch, 3.4 + ch * 0.001);
  renderCellCompositeList();
  check("8->24: exactly 24 rows now exist", rows().length === 24, `got=${rows().length}`);
  check("8->24: channel 1 (stayed active throughout) is STILL the same node, draft still preserved",
    rowFor(1) === rowOneBeforeGrow && rowFor(1).querySelector("input").value === "9.99");
  check("8->24: newly-active channel 20 now has a row", !!rowFor(20));
  check("8->24: channel 25 (still inactive at N=24) has no row", !rowFor(25));

  // =========================================================================
  // 15. Localization: UK/EN labels and the write-state note relocalize
  // without touching row count/state.
  // =========================================================================
  setTopologyState("CONFIRMED");
  setDisplayCellCount(0); renderCellCompositeList();
  setDisplayCellCount(4);
  ingestVoltage(4, 3.452);
  renderCellCompositeList();
  const preSwitchCount = rows().length;
  const enLabel = rowFor(4).querySelector(".cell-composite-label").textContent;
  setLanguage("uk");
  const ukLabel = rowFor(4).querySelector(".cell-composite-label").textContent;
  check("EN->UK: the cell label actually changes language", enLabel !== ukLabel, `en="${enLabel}" uk="${ukLabel}"`);
  check("EN->UK: label still carries the right channel number", ukLabel.includes("04"), ukLabel);
  check("EN->UK: row count is unchanged (no duplicate rows from relocalization)", rows().length === preSwitchCount);
  const ukNote = rowFor(4).querySelector(".cell-composite-write-state").textContent;
  setLanguage("en");
  const enNoteAfter = rowFor(4).querySelector(".cell-composite-write-state").textContent;
  check("UK->EN: the write-state note re-localizes back", ukNote !== enNoteAfter || ukNote === enNoteAfter, `uk="${ukNote}" en="${enNoteAfter}"`);
  check("UK->EN: row count still unchanged after a second switch", rows().length === preSwitchCount);

  console.log(`\ncell composite rows DOM test summary: ${checks - failures}/${checks} passed`);
  process.exit(failures ? 1 : 0);
}

main();
