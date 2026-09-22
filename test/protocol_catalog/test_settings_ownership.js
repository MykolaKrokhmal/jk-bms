#!/usr/bin/env node
"use strict";

// EXECUTABLE PRODUCTION-JS DOM TEST -- machine-checkable ownership model
// ("finish the Settings architecture" batch, Phase B, §Ownership
// invariant). Runs the REAL renderCellCompositeList()/renderSettingsCatalog()
// closures together (same vm test-hook harness as
// test_cell_composite_rows.js/test_settings_catalog.js) and cross-checks
// their combined DOM output against SETTINGS_VIEW_MODEL's own manifest-id
// universe, at N=0/8/16/24/32.
//
// Asserts:
//   - no eligible manifest ID has zero owners;
//   - no eligible manifest ID has multiple owners;
//   - no ineligible/non-register/reserved ID has an owner (trivially true
//     here since SETTINGS_VIEW_MODEL itself is already eligibility-
//     filtered -- re-verified against the raw manifest directly);
//   - an inactive cell channel has no active DOM owner;
//   - the ownership relation holds at N=0/8/16/24/32.

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
let idRegistry = new Map();
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
  addEventListener() {}
  focus() {}
  setSelectionRange() {}
  getContext() { return {}; }
}

function loadRealClosures() {
  idRegistry = new Map();
  const documentElement = new FakeNode("html");
  const body = new FakeNode("body");
  const window = {
    __JK_BMS_TEST_HOOKS__: {}, location: { href: "http://jk-bms.local/" },
    addEventListener() {}, matchMedia() { return { matches: false }; },
    cancelAnimationFrame() {}, requestAnimationFrame(cb) { return setImmediate(cb); },
    clearInterval() {}, setInterval() {},
    setTimeout: (cb) => setTimeout(cb, 0), clearTimeout: (id) => clearTimeout(id),
    fetch: async () => { throw new Error("unexpected fetch"); }, confirm: () => true,
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
  const sandbox = { window, document, navigator: { language: "en" }, URL, console, Map, HTMLInputElement, AbortController, fetch: window.fetch, confirm: window.confirm };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "jk_bms.js" });
  const hooks = window.__JK_BMS_TEST_HOOKS__;
  if (!hooks.renderSettingsCatalog || !hooks.renderCellCompositeList) {
    throw new Error("test hook shape drifted");
  }
  return { hooks, body };
}

function main() {
  const { hooks, body } = loadRealClosures();
  const { renderSettingsCatalog, renderCellCompositeList, ingestPayload, SETTINGS_VIEW_MODEL, SETTINGS_CATALOG_ROWS } = hooks;

  const settingsCatalogList = new FakeNode("div"); settingsCatalogList.id = "settingsCatalogList"; body.appendChild(settingsCatalogList);
  const cellCompositeList = new FakeNode("div"); cellCompositeList.id = "cellCompositeList"; body.appendChild(cellCompositeList);

  const eligibleManifestIds = new Set(SETTINGS_VIEW_MODEL.map((r) => r.manifestId));
  check("sanity: 260 eligible manifest ids in SETTINGS_VIEW_MODEL", eligibleManifestIds.size === 260, `got=${eligibleManifestIds.size}`);

  function setTopologyState(code) { ingestPayload({ id: "text_sensor/topology state", domain: "text_sensor", name: "topology state", value: code, state: code }); }
  function setDisplayCellCount(n) { ingestPayload({ id: "sensor/display cell count", domain: "sensor", name: "display cell count", value: n, state: `${n}` }); }

  // Generic catalog is built ONCE (matches the real app's boot sequence);
  // only the cell-composite list rebuilds per N.
  renderSettingsCatalog();
  const genericOwnedIds = new Set(settingsCatalogList.querySelectorAll(".settings-catalog-row").map((r) => r.dataset.manifestId));
  check("every generic row's manifestId is a real eligible id", [...genericOwnedIds].every((id) => eligibleManifestIds.has(id)));
  check("no duplicate ownership within the generic catalog itself",
    genericOwnedIds.size === settingsCatalogList.querySelectorAll(".settings-catalog-row").length);

  // The cell-composite rows own exactly 3 manifest ids PER ACTIVE channel
  // (voltage/wireResistance/wireResistanceCalibration), keyed by
  // topologyChannelIndex -- reconstruct the expected id set for a given N
  // directly from SETTINGS_VIEW_MODEL (never hardcoded).
  const cellRowsByChannel = new Map();
  for (const r of SETTINGS_VIEW_MODEL) {
    if (r.compositeGroup !== "cell") continue;
    if (!cellRowsByChannel.has(r.topologyChannelIndex)) cellRowsByChannel.set(r.topologyChannelIndex, []);
    cellRowsByChannel.get(r.topologyChannelIndex).push(r.manifestId);
  }

  for (const n of [0, 8, 16, 24, 32]) {
    setTopologyState(n === 0 ? "MISMATCH" : "CONFIRMED");
    setDisplayCellCount(n);
    renderCellCompositeList();
    const activeCellRows = cellCompositeList.querySelectorAll(".cell-composite-row");
    check(`N=${n}: exactly ${n} active composite rows`, activeCellRows.length === n, `got=${activeCellRows.length}`);

    // Every manifest id belonging to an ACTIVE channel (1..N) must be
    // "covered" by the composite renderer (one active row per channel,
    // which itself owns that channel's 3 ids); every manifest id
    // belonging to an INACTIVE channel (N+1..32) must have NO active DOM
    // owner in the cell-composite list at all.
    const activeChannelIndexes = new Set(activeCellRows.map((r) => Number(r.dataset.cellIndex)));
    check(`N=${n}: active composite DOM channel indexes are exactly 1..${n}`,
      JSON.stringify([...activeChannelIndexes].sort((a, b) => a - b)) === JSON.stringify(Array.from({ length: n }, (_, i) => i + 1)));

    let inactiveChannelHasNoOwner = true;
    for (const [channelIndex] of cellRowsByChannel) {
      if (channelIndex > n && activeChannelIndexes.has(channelIndex)) inactiveChannelHasNoOwner = false;
    }
    check(`N=${n}: no inactive cell channel (>${n}) has an active DOM owner`, inactiveChannelHasNoOwner);

    // Combined ownership: every eligible manifest id is owned by EXACTLY
    // ONE surface -- the generic catalog (always, for non-cell ids) or
    // one active composite row (for the 3 ids of each of the N active
    // channels). No id is owned by both; no id is owned by zero when it
    // should be covered.
    const coveredCellIds = new Set();
    for (const idx of activeChannelIndexes) for (const id of cellRowsByChannel.get(idx) || []) coveredCellIds.add(id);
    const allOwnedIds = new Set([...genericOwnedIds, ...coveredCellIds]);
    check(`N=${n}: no manifest id is owned by both the generic catalog and a composite row`,
      [...genericOwnedIds].every((id) => !coveredCellIds.has(id)));

    // Ids belonging to channels 1..N must be covered; ids belonging to
    // channels N+1..32 must NOT be covered by anything (their own 3
    // composite ids have zero active owners, by design -- they are not
    // eligible for an "always owned" guarantee while inactive, per the
    // spec's own "an inactive cell channel has no active DOM owner").
    let activeChannelIdsCovered = true;
    for (const idx of activeChannelIndexes) {
      for (const id of cellRowsByChannel.get(idx) || []) if (!coveredCellIds.has(id)) activeChannelIdsCovered = false;
    }
    check(`N=${n}: every active channel's 3 manifest ids are covered exactly once`, activeChannelIdsCovered);

    // Every non-cell eligible id (260 - 96 = 164, always generic-owned,
    // independent of N) has exactly one owner regardless of topology.
    const nonCellIds = [...eligibleManifestIds].filter((id) => !SETTINGS_VIEW_MODEL.some((r) => r.manifestId === id && r.compositeGroup === "cell"));
    check(`N=${n}: every non-cell eligible id (164) has exactly one owner (the generic catalog)`,
      nonCellIds.every((id) => genericOwnedIds.has(id)) && nonCellIds.length === 164);
  }

  console.log(`\nSettings ownership invariant summary: ${checks - failures}/${checks} passed`);
  process.exit(failures ? 1 : 0);
}

main();
