#!/usr/bin/env node
"use strict";

// Regression test, UPDATED for the cell-composite batch (2026-09-22).
//
// ORIGINAL SCOPE (2026-09-17, preserved below in sections 5-7): the
// Settings/Diagnostics register list ("Регістри BMS") used to render
// cell_voltage_N/cell_resistance_N/cell_connection_wire_resistance_N as
// individual rows, filtered by activeCellCount() so only channels 1..N
// were visible.
//
// CHANGED SCOPE (this batch): all three families are now rendered
// EXCLUSIVELY by the new composite cell-row list
// (renderCellCompositeList(), covered by test_cell_composite_rows.js) --
// this generic register list must never show any of them AT ALL, at ANY
// N, live or hidden (isCellCompositeOwnedRow(), which replaced the old
// N-gated isHiddenCellChannelRow()). Sections 1-4 below were rewritten to
// assert exactly that (a flat "never present" check replacing the old
// "present iff ch<=N" check); sections 5-7 (non-cell entities,
// temperature_N, the display_cell_count bind wiring) are unchanged --
// those concerns are untouched by this batch.
//
// Exercises the REAL renderDiagnosticReadouts()/ingestPayload() closures
// via jk_bms.js's own opt-in test hook -- no reimplementation of the
// filter logic anywhere below.

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
  else {
    failures += 1;
    console.log(`FAIL  ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

// --- Minimal, real (not mocked-return-value) DOM node shim, adapted from
// test_diagnostic_software_variables_scroll.js's own precedent -------------
class FakeNode {
  constructor(tagName) {
    this.tagName = tagName;
    this.childNodes = [];
    this.parentNode = null;
    this._text = "";
    this._classSet = new Set();
    this.attributes = {};
    this.dataset = {};
    this.title = "";
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
  get firstChild() { return this.childNodes[0] || null; }
  set className(v) { this._className = v; }
  get className() { return this._className || ""; }
  set textContent(v) { this._text = String(v); this.childNodes.forEach((c) => { c.parentNode = null; }); this.childNodes = []; }
  get textContent() { return this._text; }
  setAttribute(name, value) { this.attributes[name] = value; }
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
    return child;
  }
  insertBefore(newNode, referenceNode) {
    if (newNode.parentNode) newNode.parentNode.removeChild(newNode);
    if (referenceNode == null) {
      this.childNodes.push(newNode);
    } else {
      const idx = this.childNodes.indexOf(referenceNode);
      this.childNodes.splice(idx === -1 ? this.childNodes.length : idx, 0, newNode);
    }
    newNode.parentNode = this;
    return newNode;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  replaceChildren(...nodes) {
    this.childNodes.forEach((c) => { c.parentNode = null; });
    this.childNodes = [];
    nodes.forEach((n) => this.appendChild(n));
  }
  querySelectorAll() { return []; }
  querySelector(selectorList) {
    const selectors = selectorList.split(",").map((s) => s.trim());
    const matches = (node) => selectors.some((sel) =>
      sel.startsWith(".") ? node.classList.contains(sel.slice(1)) : node.tagName === sel);
    const search = (node) => {
      for (const child of node.childNodes) {
        if (matches(child)) return child;
        const found = search(child);
        if (found) return found;
      }
      return null;
    };
    return search(this);
  }
  addEventListener() {}
  getContext() { return {}; }
}

function loadRealClosures() {
  const window = {
    __JK_BMS_TEST_HOOKS__: {},
    location: { href: "http://jk-bms.local/" },
    addEventListener() {}, matchMedia() { return { matches: false }; },
    cancelAnimationFrame() {},
    requestAnimationFrame(cb) { setTimeout(cb, 0); return 1; },
    clearInterval() {}, setInterval() {},
  };
  const elementsById = {
    diagSoftwareVarList: new FakeNode("div"),
    configRegisterList: new FakeNode("div"),
    cellCompositeList: new FakeNode("div"),
    writeRegistryList: new FakeNode("div"),
  };
  const document = {
    documentElement: undefined,
    scrollingElement: { scrollTop: 0 },
    readyState: "complete",
    createElement(tag) { return new FakeNode(tag); },
    createDocumentFragment() { return new FakeNode("#fragment"); },
    addEventListener() {},
    getElementById(id) { return elementsById[id] || null; },
    activeElement: null,
    body: new FakeNode("body"),
  };
  class HTMLInputElement {}
  const sandbox = { window, document, navigator: { language: "en" }, URL, console, Map, HTMLInputElement };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "jk_bms.js" });
  if (!window.__JK_BMS_TEST_HOOKS__.ingestPayload) {
    throw new Error("jk_bms.js's test hook did not populate -- window.__JK_BMS_TEST_HOOKS__ shape may have drifted");
  }
  return { hooks: window.__JK_BMS_TEST_HOOKS__, elementsById };
}

const { hooks, elementsById } = loadRealClosures();
const { ingestPayload, renderDiagnosticReadouts, activeCellCount } = hooks;
const regList = elementsById.configRegisterList;

check("real jk_bms.js closures loaded via the test hook (not reimplemented)",
  typeof ingestPayload === "function" && typeof renderDiagnosticReadouts === "function");

function setTopologyState(code) {
  ingestPayload({ id: "text_sensor/topology state", domain: "text_sensor", name: "topology state", value: code, state: code });
}
function setDisplayCellCount(n) {
  ingestPayload({ id: "sensor/display cell count", domain: "sensor", name: "display cell count", value: n, state: `${n}` });
}
function ingestVoltage(n, value) {
  ingestPayload({ id: `sensor/cell voltage ${n}`, domain: "sensor", name: `cell voltage ${n}`, value, state: value === null ? "NA" : `${value.toFixed(3)} V` });
}
function ingestResistance(n, value) {
  ingestPayload({ id: `sensor/cell ${n} wire resistance`, domain: "sensor", name: `cell ${n} wire resistance`, value, state: value === null ? "NA" : `${value.toFixed(3)} mΩ` });
}
function ingestCalibration(n, value) {
  ingestPayload({ id: `sensor/cell connection wire resistance ${n}`, domain: "sensor", name: `cell connection wire resistance ${n}`, value, state: `${value}` });
}

function registeredRowIds() {
  return regList.childNodes.map((row) => row.childNodes[0].getAttribute("title") || row.childNodes[0].title);
}
function hasRowFor(wireId) {
  return registeredRowIds().includes(wireId);
}

// ===========================================================================
// 1. Publish ALL 32 protocol-capacity channels for all 3 families. Unlike
// before this batch, NONE of the 96 resulting rows may ever appear in this
// generic list -- they are owned exclusively by the composite cell-row
// list now, regardless of N.
// ===========================================================================
for (const n of [8, 16, 24, 32]) {
  setTopologyState("CONFIRMED");
  setDisplayCellCount(n);
  renderDiagnosticReadouts();
  for (let ch = 1; ch <= 32; ch += 1) {
    ingestVoltage(ch, ch <= n ? 3.4 + ch * 0.001 : null);
    ingestResistance(ch, ch <= n ? 0.05 + ch * 0.0001 : null);
    ingestCalibration(ch, 1000 + ch);
  }
  renderDiagnosticReadouts();
  check(`N=${n}: activeCellCount() reports ${n}`, activeCellCount() === n);
  for (let ch = 1; ch <= 32; ch += 1) {
    check(`N=${n}, cell_voltage_${ch}: never a row in the generic list (owned by the composite renderer)`,
      !hasRowFor(`sensor/cell voltage ${ch}`));
    check(`N=${n}, cell_resistance_${ch}: never a row in the generic list (owned by the composite renderer)`,
      !hasRowFor(`sensor/cell ${ch} wire resistance`));
    check(`N=${n}, cell_connection_wire_resistance_${ch}: never a row in the generic list (owned by the composite renderer)`,
      !hasRowFor(`sensor/cell connection wire resistance ${ch}`));
  }
}

// ===========================================================================
// 2. A 16->8 transition must not somehow resurrect a cell row in this list
// either (the composite ownership filter does not consult N at all, so
// this is a trivial but real regression guard against a future accidental
// re-introduction of N-conditional visibility here).
// ===========================================================================
{
  setTopologyState("CONFIRMED");
  setDisplayCellCount(16);
  for (let ch = 1; ch <= 32; ch += 1) ingestVoltage(ch, ch <= 16 ? 3.4 + ch * 0.001 : null);
  renderDiagnosticReadouts();
  check("16->8 transition: before, no cell_voltage row exists in the generic list", !hasRowFor("sensor/cell voltage 16") && !hasRowFor("sensor/cell voltage 8"));

  setDisplayCellCount(8);
  renderDiagnosticReadouts();
  check("16->8 transition: after, still no cell_voltage row exists in the generic list", !hasRowFor("sensor/cell voltage 16") && !hasRowFor("sensor/cell voltage 8") && !hasRowFor("sensor/cell voltage 1"));
}

// ===========================================================================
// 3. Late SSE arrival for any channel (hidden or active) must not create a
// row in this list -- the composite renderer is the only consumer now.
// ===========================================================================
{
  setTopologyState("CONFIRMED");
  setDisplayCellCount(8);
  renderDiagnosticReadouts();
  check("before late arrival: cell_voltage_20 has no row", !hasRowFor("sensor/cell voltage 20"));

  ingestVoltage(20, 3.5);
  renderDiagnosticReadouts();
  check("late SSE arrival for channel 20 does NOT create a row in the generic list",
    !hasRowFor("sensor/cell voltage 20"));

  ingestResistance(20, 0.06);
  ingestCalibration(20, 1234);
  renderDiagnosticReadouts();
  check("late SSE arrival: cell_resistance_20 also creates no row here", !hasRowFor("sensor/cell 20 wire resistance"));
  check("late SSE arrival: cell_connection_wire_resistance_20 also creates no row here", !hasRowFor("sensor/cell connection wire resistance 20"));

  // Active channel (1 <= 8) with unavailable data: also never a row here
  // any more -- that "active but unavailable" display responsibility now
  // belongs entirely to the composite renderer (test_cell_composite_rows.js).
  ingestResistance(5, null);
  renderDiagnosticReadouts();
  check("active channel 5 (<=N=8) with unavailable resistance data: still no row in the generic list", !hasRowFor("sensor/cell 5 wire resistance"));
}

// ===========================================================================
// 4. Topology/capability/non-numbered entities are NEVER filtered by this
// cell-row logic, at any N -- including the smallest tested N (8), where
// the filter is most aggressive.
// ===========================================================================
{
  setTopologyState("CONFIRMED");
  setDisplayCellCount(8);
  ingestPayload({ id: "sensor/cell count", domain: "sensor", name: "cell count", value: 8, state: "8" });
  ingestPayload({ id: "text_sensor/cell wire resistance extension capability", domain: "text_sensor", name: "cell wire resistance extension capability", value: "UNKNOWN", state: "UNKNOWN" });
  ingestPayload({ id: "text_sensor/cell connection wire resistance capability", domain: "text_sensor", name: "cell connection wire resistance capability", value: "UNKNOWN", state: "UNKNOWN" });
  renderDiagnosticReadouts();
  check("cell_count's own row is never touched by the composite-ownership filter", hasRowFor("sensor/cell count"));
  check("cell_wire_resistance_ext_capability's row is never touched by the composite-ownership filter",
    hasRowFor("text_sensor/cell wire resistance extension capability"));
  check("cell_connection_wire_resistance_capability's row is never touched by the composite-ownership filter",
    hasRowFor("text_sensor/cell connection wire resistance capability"));
}

// ===========================================================================
// 5. temperature_N is explicitly NOT part of the cell-channel pattern set:
// physical temperature sensor count is fixed, independent of configured
// cell channel count -- all 5 stay visible even at the smallest tested N.
// ===========================================================================
{
  setTopologyState("CONFIRMED");
  setDisplayCellCount(8);
  for (let t = 1; t <= 5; t += 1) {
    ingestPayload({ id: `sensor/temperature ${t}`, domain: "sensor", name: `temperature ${t}`, value: 25.0, state: "25.0 °C" });
  }
  renderDiagnosticReadouts();
  for (let t = 1; t <= 5; t += 1) {
    check(`temperature_${t} row stays visible at N=8 (never cell-count-gated)`, hasRowFor(`sensor/temperature ${t}`));
  }
}

// ===========================================================================
// 6. Structural check: the real bind() wiring that drives this filter in
// production (display_cell_count -> renderDiagnosticReadouts) actually
// exists in jk_bms.js's source.
// ===========================================================================
{
  const bindIdx = source.indexOf('bind("display_cell_count", renderDiagnosticReadouts)');
  check('jk_bms.js wires bind("display_cell_count", renderDiagnosticReadouts) so a real N change re-filters the list',
    bindIdx !== -1);
}

// ===========================================================================
// 7. Structural check: the composite-ownership filter itself is real and
// unconditional (not merely a rename of the old N-gated function).
// ===========================================================================
{
  check("jk_bms.js defines isCellCompositeOwnedRow() (the replacement for the old N-gated isHiddenCellChannelRow())",
    /function isCellCompositeOwnedRow\s*\(/.test(source));
  check("the generic register-list filter now uses isCellCompositeOwnedRow(), not the old isHiddenCellChannelRow()",
    /\.filter\(\(e\) => !isCellCompositeOwnedRow\(e\)\)/.test(source) && !/isHiddenCellChannelRow/.test(source));
}

console.log(`\n${checks} checks run, ${failures} failed.`);
process.exit(failures ? 1 : 0);
