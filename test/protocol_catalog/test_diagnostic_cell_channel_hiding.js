#!/usr/bin/env node
"use strict";

// Regression test for the user-reported defect (2026-09-17, live-hardware
// retest against the firmware installed BEFORE commit 553169e): with
// configured CellCount=16, the Settings/Diagnostics register list
// ("Регістри BMS") kept showing "Напруга комірки 17..32 = NA" forever --
// the Cells tab has always hidden channels beyond configured N
// (activeCellCount()), but the raw register list had no such filter at
// all. Fixed by filtering renderDiagnosticReadouts()'s own entries list
// by a channel index read from entry.key (metadata, via
// diagnosticObjectId() -- the SAME resolved key diagnosticEntityLabel()/
// diagnosticNumberedSeries() already trust for these exact 3 families),
// never from the localized display label text.
//
// Exercises the REAL renderDiagnosticReadouts()/ingestPayload() closures
// via jk_bms.js's own opt-in test hook (same vm technique as
// test_diagnostic_software_variables_scroll.js, whose own small DOM node
// shim this file reuses/adapts) -- no reimplementation of the filter
// logic anywhere below.
//
// Covers: 8/16/24/32 for all three affected families (cell_voltage_N,
// cell_resistance_N, cell_connection_wire_resistance_N); the 16->8
// transition (rows must actually be REMOVED from the DOM, not merely
// covered by CSS); late SSE arrival for an already-hidden channel (must
// not resurrect a row); active channels 1..N with unavailable data stay
// visible; topology/capability/non-numbered entities and temperature_N
// (physical sensor count, independent of cell channel count) are never
// touched by this filter; the full protocol catalog itself is untouched
// (this is a render-time filter only, never a canonical.json/
// register_catalog.json change).

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
    // Real DOM auto-unwraps a DocumentFragment on append (its children
    // move into the target, the fragment itself is left empty) --
    // renderDiagnosticReadouts() relies on exactly this behavior
    // (`fragment.appendChild(row)` in a loop, then one
    // `list.appendChild(fragment)`), so this shim must replicate it,
    // unlike test_diagnostic_software_variables_scroll.js's own FakeNode
    // (that render path never uses a fragment, so it never needed this).
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
  // Every row's <span> label carries the raw wire id as its title
  // attribute (renderDiagnosticReadouts(): `id.title = entry.id;`) -- read
  // directly off the real rendered nodes, not tracked separately.
  return regList.childNodes.map((row) => row.childNodes[0].getAttribute("title") || row.childNodes[0].title);
}
function hasRowFor(wireId) {
  return registeredRowIds().includes(wireId);
}

// ===========================================================================
// 1. Publish ALL 32 protocol-capacity channels for all 3 families (the REAL
// wire behavior: cell_voltage_1-32 are always decoded/republished every
// cycle regardless of configured N -- resolve_topology blanks the unused
// ones to NaN/"NA", it never simply stops publishing them). For each of
// 8/16/24/32, exactly channels 1..N must have a rendered row; N+1..32 must
// not.
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
    const shouldShow = ch <= n;
    check(`N=${n}, cell_voltage_${ch}: row ${shouldShow ? "visible" : "hidden"}`,
      hasRowFor(`sensor/cell voltage ${ch}`) === shouldShow);
    check(`N=${n}, cell_resistance_${ch}: row ${shouldShow ? "visible" : "hidden"}`,
      hasRowFor(`sensor/cell ${ch} wire resistance`) === shouldShow);
    check(`N=${n}, cell_connection_wire_resistance_${ch}: row ${shouldShow ? "visible" : "hidden"}`,
      hasRowFor(`sensor/cell connection wire resistance ${ch}`) === shouldShow);
  }
}

// ===========================================================================
// 2. Transition 16 -> 8: rows for channels 9-16 must be ACTUALLY REMOVED
// from the DOM (not merely styled hidden) on the very next rebuild.
// ===========================================================================
{
  setTopologyState("CONFIRMED");
  setDisplayCellCount(16);
  for (let ch = 1; ch <= 32; ch += 1) {
    ingestVoltage(ch, ch <= 16 ? 3.4 + ch * 0.001 : null);
  }
  renderDiagnosticReadouts();
  check("16->8 transition: before, cell_voltage_16 row is present", hasRowFor("sensor/cell voltage 16"));
  check("16->8 transition: before, cell_voltage_9 row is present", hasRowFor("sensor/cell voltage 9"));

  setDisplayCellCount(8);
  renderDiagnosticReadouts();
  check("16->8 transition: after, cell_voltage_16 row is REMOVED from the DOM", !hasRowFor("sensor/cell voltage 16"));
  check("16->8 transition: after, cell_voltage_9 row is REMOVED from the DOM", !hasRowFor("sensor/cell voltage 9"));
  check("16->8 transition: after, cell_voltage_8 row is still present (last active channel)", hasRowFor("sensor/cell voltage 8"));
  check("16->8 transition: after, cell_voltage_1 row is still present", hasRowFor("sensor/cell voltage 1"));
}

// ===========================================================================
// 3. Late SSE arrival for an already-hidden channel must not resurrect its
// row. At N=8, channel 20 has never been ingested before this point --
// exactly the "a register's first-ever reading arrives well after the tab
// is open" scenario recordDiagnosticReadout()'s own rAF-rebuild path
// exists for, now happening for a channel this batch's filter must keep
// hidden regardless.
// ===========================================================================
{
  setTopologyState("CONFIRMED");
  setDisplayCellCount(8);
  renderDiagnosticReadouts();
  check("before late arrival: cell_voltage_20 has no row yet", !hasRowFor("sensor/cell voltage 20"));

  ingestVoltage(20, 3.5);  // first-ever payload for this wireId -- schedules a real rAF rebuild
  renderDiagnosticReadouts();  // drive the same rebuild synchronously for a deterministic assertion
  check("late SSE arrival for a hidden channel (20 > N=8) does NOT create a visible row",
    !hasRowFor("sensor/cell voltage 20"));

  ingestResistance(20, 0.06);
  ingestCalibration(20, 1234);
  renderDiagnosticReadouts();
  check("late SSE arrival: cell_resistance_20 also stays hidden", !hasRowFor("sensor/cell 20 wire resistance"));
  check("late SSE arrival: cell_connection_wire_resistance_20 also stays hidden", !hasRowFor("sensor/cell connection wire resistance 20"));
}

// ===========================================================================
// 4. Active channels 1..N with unavailable data stay VISIBLE with an
// explicit status (never silently dropped, never a fabricated number).
// ===========================================================================
{
  setTopologyState("CONFIRMED");
  setDisplayCellCount(8);
  ingestResistance(5, null);  // channel 5 is active (5 <= 8) but its resistance is "NA"
  renderDiagnosticReadouts();
  const row = regList.childNodes.find((r) => (r.childNodes[0].getAttribute("title") || r.childNodes[0].title) === "sensor/cell 5 wire resistance");
  check("active channel 5 (<=N=8) with unavailable resistance data: row IS present", !!row);
  if (row) {
    const valueText = row.childNodes[1].textContent;
    check("active channel 5 with unavailable data shows an explicit status text, not silently blank",
      typeof valueText === "string" && valueText.length > 0, `value="${valueText}"`);
  }
}

// ===========================================================================
// 5. Topology/capability/non-numbered entities are NEVER filtered by this
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
  check("cell_count's own row is never touched by the cell-channel-row filter", hasRowFor("sensor/cell count"));
  check("cell_wire_resistance_ext_capability's row is never touched by the cell-channel-row filter",
    hasRowFor("text_sensor/cell wire resistance extension capability"));
  check("cell_connection_wire_resistance_capability's row is never touched by the cell-channel-row filter",
    hasRowFor("text_sensor/cell connection wire resistance capability"));
}

// ===========================================================================
// 6. temperature_N is explicitly NOT part of the cell-channel pattern set:
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
// 7. Structural check: the real bind() wiring that drives this filter in
// production (display_cell_count -> renderDiagnosticReadouts) actually
// exists in jk_bms.js's source -- this test harness cannot exercise
// installBindings()/bind() itself (that only runs from build(), which the
// test-hook branch deliberately skips, same as every other frontend test
// in this project), so the functional coverage above (direct
// renderDiagnosticReadouts() calls) is paired with this source-level proof
// that the SAME function is really wired to fire on the real trigger.
// ===========================================================================
{
  const bindIdx = source.indexOf('bind("display_cell_count", renderDiagnosticReadouts)');
  check('jk_bms.js wires bind("display_cell_count", renderDiagnosticReadouts) so a real N change re-filters the list',
    bindIdx !== -1);
}

console.log(`\n${checks} checks run, ${failures} failed.`);
process.exit(failures ? 1 : 0);
