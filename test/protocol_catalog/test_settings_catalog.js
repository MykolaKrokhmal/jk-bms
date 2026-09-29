#!/usr/bin/env node
"use strict";

// EXECUTABLE PRODUCTION-JS DOM TEST -- runs the REAL jk_bms.js closures
// (renderSettingsCatalog, relocalizeSettingsCatalog, updateSettingsCatalogValue,
// ingestPayload, numeric, setLanguage, submitRegisterWrite via the
// catalog's own row-OK click handler) inside a
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
//   15. the 18 owner-authorized rows without a write-registry entry are
//       LOCKED (unified write contract, owner decision 2026-09-29)
//   16. every live OK path calls the one unified client
//       (submitRegisterWrite via data-wr-action="preflight-write")
//   17. authorization/blocked/W rows cannot dispatch (no button exists)
//   18. SSE updates hit only the correct row
//   19. dirty/focus/selection preservation
//   20. UK<->EN relocalization without draft loss
//   22. the three cell families are never duplicated in this generic list
//   U0-U9 (runUnifiedWriteContractScenario): drafts send nothing; only the
//       row's own OK -> one preflight + one POST with its own key/value;
//       CONFIRMED/MISMATCH/WRITE_UNCERTAIN/rejection/NO_CHANGE on that row;
//       locked rows cannot send; no /number/set_* route

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { TimerQueue, FakeEventSource, ListenerRegistry, flush } = require("./sse_test_harness");

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
// The freshness status sits beside the field shell (value | unit | lock).
function statusNote(node) {
  const shell = node.closest(".settings-field-shell");
  return (shell ? shell.parentNode : node.parentNode).querySelector(".settings-freshness-note");
}

let fetchCallLog = [];
let fakeNow = 100000;
class ControlledDate extends Date {
  constructor(...args) { super(...(args.length ? args : [fakeNow])); }
  static now() { return fakeNow; }
}
// Real-connection-manager scenarios only (runRealReconnectScenario): the
// controlled timer queue/listeners, and the read-only GET
// /settings/read-freshness snapshot the real onopen fetches. Kept apart from
// fetchCallLog, which must stay empty (no write is ever dispatched).
let harness = null;
// Unified-write-contract scenario only: answers the /settings/register-write
// preflight/POST/status calls (every call is still recorded in fetchCallLog).
let fetchResponder = null;
async function fakeFetch(url, opts) {
  const method = (opts && opts.method) || "GET";
  if (fetchResponder) {
    fetchCallLog.push({ url: String(url), method });
    const r = fetchResponder(String(url), method);
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
  }
  if (harness && method === "GET" && String(url).endsWith("/settings/read-freshness")) {
    harness.snapshotGets += 1;
    return { ok: true, status: 200, json: async () => harness.snapshot };
  }
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
    addEventListener: (type, fn) => { if (harness) harness.win.add(type, fn); },
    matchMedia() { return { matches: false }; },
    cancelAnimationFrame() {}, requestAnimationFrame(cb) { return setImmediate(cb); },
    clearInterval: (id) => { if (harness) harness.timers.clear(id); },
    setInterval: (cb, ms) => (harness ? harness.timers.setInterval(cb, ms) : undefined),
    setTimeout: (cb, ms) => (harness ? harness.timers.setTimeout(cb, ms) : setTimeout(cb, 0)),
    clearTimeout: (id) => (harness ? harness.timers.clear(id) : clearTimeout(id)),
    fetch: (...args) => fakeFetch(...args),
    confirm: () => true,
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  };
  const document = {
    documentElement,
    scrollingElement: { scrollTop: 0 },
    readyState: "complete",
    visibilityState: "visible",
    createElement(tag) { return new FakeNode(tag); },
    createDocumentFragment() { return new FakeNode("#fragment"); },
    addEventListener: (type, fn) => { if (harness) harness.doc.add(type, fn); },
    getElementById(id) { return idRegistry.get(id) || null; },
    querySelector(sel) { return body.querySelector(sel); },
    querySelectorAll(sel) { return body.querySelectorAll(sel); },
    get activeElement() { return activeElement; },
    body,
  };
  class HTMLInputElement {}
  const sandbox = {
    window, document, navigator: { language: "en", onLine: true }, URL, console, Map, HTMLInputElement, AbortController,
    Date: ControlledDate, EventSource: FakeEventSource,
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

  // Settings write migration (clustered-read plan M5, owner decision
  // 2026-09-29): smart_sleep is a migrated owner-authorized field -> live
  // through the write registry (wr_<key> + its own OK), never reg_<key>.
  const migratedRow = rowFor("VolSmartSleep");
  check("migrated Settings field (smart_sleep): one enabled editor + exactly one OK on the unified pipeline, no lock",
    !!migratedRow && migratedRow.querySelectorAll("button").length === 1 && !migratedRow.querySelector(".settings-lock") &&
    migratedRow.querySelector(".settings-catalog-editor").id === "wr_smart_sleep" &&
    migratedRow.querySelector(".settings-catalog-action").dataset.wrAction === "preflight-write" &&
    migratedRow.querySelector(".settings-catalog-action").dataset.wrKey === "smart_sleep");
  // charge_otpr (signed S32 temperature recovery) is migrated too.
  const tempRow = rowFor("TMPBatCOTPR");
  check("signed temperature field (charge_otpr): one enabled editor + exactly one OK on the unified pipeline, no lock",
    !!tempRow && tempRow.querySelectorAll("button").length === 1 && !tempRow.querySelector(".settings-lock") &&
    tempRow.querySelector(".settings-catalog-editor").id === "wr_charge_otpr" &&
    tempRow.querySelector(".settings-catalog-action").dataset.wrKey === "charge_otpr");
  // The live numeric row every draft/freshness scenario below runs on: a
  // write-registry row (0x1118, 15 s group, 22.5 s budget).
  const legacyRow = rowFor("TIMSmartSleep"); // smart_sleep_timeout_hours, write-hardware-verified, write registry
  check("hardware-verified RW row exists", !!legacyRow);
  const legacyInput = legacyRow.querySelector(".settings-catalog-editor");
  const legacyButton = legacyRow.querySelector(".settings-catalog-action");
  check("hardware-verified row: real enabled numeric editor + OK button", !!legacyInput && legacyInput.disabled === false && !!legacyButton);
  check("hardware-verified row: input id follows the write-registry wr_<key> convention", legacyInput.id === "wr_smart_sleep_timeout_hours");
  check("hardware-verified row: its OK carries data-wr-action=preflight-write + its own key (the unified pipeline)",
    legacyButton.dataset.wrAction === "preflight-write" && legacyButton.dataset.wrKey === "smart_sleep_timeout_hours");

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
  check("authorization_required row: no visible badge -- exactly one lock, in the action slot beside the locked shell",
    authNote && authNote.classList.contains("sr-only") && authRow.querySelectorAll(".settings-lock").length === 1 &&
    authRow.querySelector(".settings-lock").classList.contains("settings-action-lock") &&
    authRow.querySelector(".settings-lock").parentNode.classList.contains("settings-catalog-editor-group") &&
    !authRow.querySelector(".settings-field-shell").querySelector(".settings-lock"));
  check("authorization_required row: the full safety-class reason is the select's accessible description",
    authNote && authNote.textContent.startsWith("Authorization required. ") && authNote.textContent.includes("disruptive") &&
    authSelect.getAttribute("aria-describedby").split(" ").includes(authNote.id), authNote && authNote.textContent);

  const blockedRow = rowFor("CellCount"); // cell_count, blocked
  check("blocked RW row exists and renders as RW (not silently a plain R row)", !!blockedRow && blockedRow.dataset.access === "RW");
  check("blocked row: no button anywhere (cannot dispatch)", !blockedRow.querySelector("button"));
  const blockedNote = blockedRow.querySelector(".settings-catalog-note");
  check("blocked row: no visible 'Write blocked' badge -- exactly one lock indicator",
    blockedNote && blockedNote.classList.contains("sr-only") && blockedRow.querySelectorAll(".settings-lock").length === 1);
  check("blocked row: the closure criterion (a real human sentence, not a bare code) is the accessible description",
    blockedNote && blockedNote.textContent.startsWith("Write blocked. ") && blockedNote.textContent.length > 40 &&
    blockedRow.querySelector(".settings-lock").title === blockedNote.textContent, blockedNote && blockedNote.textContent);

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
  ingestPayload({ id: "sensor/smart sleep timeout hours", value: 24, state: "24" });
  updateSettingsCatalogValue("TIMSmartSleep");
  check("SSE update: an untouched live editor follows the fresh read value", legacyInput.value === "24", legacyInput.value);

  ingestPayload({ id: "gps_heartbeat", domain: "number", value: 1, state: "1" });
  updateSettingsCatalogValue("GPS Heartbeat");
  check("SSE update for GPS Heartbeat does not touch the unrelated hardware-verified row's input value",
    legacyInput.value === "24", legacyInput.value);

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
  // authoritative fieldMeta budgets are 3s (bespoke cell reader) and
  // cadence + 7.5 s for the scheduler groups (22.5 s / 307.5 s; derived in
  // generate_read_plan.js, poll_cadence_freshness_20260927.md).
  const { setBrowserLink, sweepDiagnosticStaleness, settingsFieldFreshness,
    renderCellCompositeList, submitRegisterWrite,
    registerEntity, PROTOCOL_CATALOG, acceptReadBlockSnapshot, readBlockSuccess } = hooks;
  const cellList = new FakeNode("div");
  cellList.id = "cellCompositeList";
  body.appendChild(cellList);
  const byKey = (key) => rows().find((r) => r.dataset.canonicalKey === key);
  const readValue = (key) => byKey(key).querySelector(".settings-catalog-value");
  fakeNow = 200000;
  ingestPayload({ id: "text_sensor/bms health", state: "LIVE", value: "LIVE" });
  setBrowserLink("connected");
  acceptReadBlockSnapshot({ blocks: [[0x1118, 0, 1], [0x1114, 0, 1], [0x1240, 0, 1], [0x1290, 0, 1]] });
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
  ingestPayload({ id: "sensor/smart sleep timeout hours", state: "24", value: 24 });
  updateSettingsCatalogValue("TIMSmartSleep");
  renderCellCompositeList();
  const cellRows = cellList.querySelectorAll(".cell-composite-row");
  const cell4 = cellRows.find((r) => r.dataset.cellIndex === "4");
  const cellVoltage = cell4.querySelector(".cell-composite-voltage");
  const cellResistance = cell4.querySelector(".cell-composite-resistance");
  const cellCalibration = cell4.querySelector(".cell-composite-calibration-editor");
  check("16S visibility uses protocol display_cell_count; channels 17+ absent", cellRows.length === 16 &&
    !cellRows.some((r) => Number(r.dataset.cellIndex) > 16));
  check("canonical budgets: 3 s for the 1 s cell reader, cadence + 7.5 s for the 15 s/300 s scheduler groups",
    PROTOCOL_CATALOG.fieldMeta.cell_voltage_4.freshnessBudgetS === 3 &&
    PROTOCOL_CATALOG.fieldMeta.total_voltage_raw.freshnessBudgetS === 22.5 &&
    PROTOCOL_CATALOG.fieldMeta.smart_sleep.freshnessBudgetS === 307.5);
  check("clustered current_raw uses the physical 0x1290 block, not its own 0x1298 register address",
    PROTOCOL_CATALOG.fieldMeta.current_raw.readAddress === 0x1290 &&
    readValue("current_raw").dataset.freshness === "fresh");
  check("never-observed R value remains unavailable", rValueAtBoot.dataset.freshness === "unavailable" &&
    rValueAtBoot.textContent === "Unavailable");
  check("new SSE makes each observed Settings/cell value fresh", cellVoltage.dataset.freshness === "fresh" &&
    cellResistance.dataset.freshness === "fresh" && cellCalibration.dataset.freshness === "fresh" &&
    readValue("total_voltage_raw").dataset.freshness === "fresh" && legacyInput.dataset.freshness === "fresh");
  check("fresh legacy RW submit button enabled", legacyButton.disabled === false);

  legacyInput.value = "48";
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
  fakeNow = 222500;
  sweepDiagnosticStaleness();
  check("15s group still fresh exactly at its 22.5 s budget", readValue("total_voltage_raw").dataset.freshness === "fresh" &&
    readValue("current_raw").dataset.freshness === "fresh");
  fakeNow = 222501;
  sweepDiagnosticStaleness();
  check("15s group stale only after its 22.5 s budget (the live 0x1118 row too, and its OK closes)", readValue("total_voltage_raw").dataset.freshness === "stale" &&
    readValue("current_raw").dataset.freshness === "stale" && legacyInput.dataset.freshness === "stale" && legacyButton.disabled === true &&
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
  check("staleness sweep preserves draft, focus and selection", legacyInput.value === "48" &&
    activeElement === legacyInput && legacyInput.selectionStart === 1 && legacyInput.selectionEnd === 3);
  submitRegisterWrite(hooks.WRITE_REGISTRY.live.find((e) => e.key === "smart_sleep_timeout_hours"), legacyInput, legacyButton);
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

  ingestPayload({ id: "sensor/smart sleep timeout hours", state: "24", value: 24 });
  check("unchanged-value SSE alone cannot claim a successful register read",
    legacyInput.dataset.freshness === "stale" && legacyButton.disabled === true);
  readBlockSuccess(`${0x1118}:2`);
  check("successful block read refreshes a 300s field without overwriting its draft",
    legacyInput.dataset.freshness === "fresh" && legacyButton.disabled === false && legacyInput.value === "48" &&
    activeElement === legacyInput && legacyInput.selectionStart === 1 && legacyInput.selectionEnd === 3);
  setBrowserLink("reconnecting");
  check("disconnect immediately marks cached value offline and disables submit",
    legacyInput.dataset.freshness === "offline" && legacyButton.disabled === true);
  setBrowserLink("connected");
  check("reconnect alone never promotes old cached value to current", legacyInput.dataset.freshness === "offline" && legacyButton.disabled === true);
  ingestPayload({ id: "sensor/smart sleep timeout hours", state: "24", value: 24 });
  check("post-reconnect value snapshot alone does not validate the old register", legacyInput.dataset.freshness === "offline");
  fakeNow += 1;
  readBlockSuccess(`${0x1118}:3`);
  check("post-reconnect block read without this connection's own bms_health stays blocked (fail closed)",
    legacyInput.dataset.freshness === "offline" && legacyButton.disabled === true);
  ingestPayload({ id: "text_sensor/bms health", state: "LIVE", value: "LIVE" });
  check("post-reconnect successful block read restores freshness without draft loss", legacyInput.dataset.freshness === "fresh" &&
    legacyButton.disabled === false && legacyInput.value === "48" && activeElement === legacyInput);
  ingestPayload({ id: "text_sensor/bms health", state: "OFFLINE", value: "OFFLINE" });
  check("BMS offline invalidates cached Settings value even with browser connected", legacyInput.dataset.freshness === "offline" &&
    legacyButton.disabled === true);
  ingestPayload({ id: "sensor/smart sleep timeout hours", state: "24", value: 24 });
  check("SSE echo while BMS is OFFLINE cannot make the register current", legacyInput.dataset.freshness === "offline");
  readBlockSuccess(`${0x1118}:4`);
  ingestPayload({ id: "text_sensor/bms health", state: "LIVE", value: "LIVE" });
  check("BMS recovery alone leaves even an offline-period echo invalid", legacyInput.dataset.freshness === "offline");
  fakeNow += 1;
  readBlockSuccess(`${0x1118}:5`);
  check("successful register read after BMS recovery clears offline state", legacyInput.dataset.freshness === "fresh");
  fakeNow += 320001;
  sweepDiagnosticStaleness();
  setLanguage("uk");
  check("stale indication and age explanation localize to Ukrainian", legacyInput.dataset.freshness === "stale" &&
    legacyInput.title.includes("Немає успішного читання") && statusNote(legacyInput).textContent === "Застаріло");
  check("all stale/offline attempts remained read-only", fetchCallLog.length === 0);

  runStartupOrderingScenarios();
  runGlobalFreshnessScenarios();
  runCredentialRenderScenario();
  runControlsSimplificationScenario();
  runFalseStaleScenario();

  runRealReconnectScenario("visible").then(() => runRealReconnectScenario("ping")).then(() => runUnifiedWriteContractScenario()).then(() => {
    console.log(`\nsettings catalog DOM test summary: ${checks - failures}/${checks} passed`);
    process.exit(failures ? 1 : 0);
  }, (error) => { console.error(error); process.exit(1); });
}

// Transient yellow (owner report 2026-09-26: the 0x1114 fields briefly
// turned yellow). Stale yellow must mean exactly one thing -- a missed read
// budget. Pending/offline keep their own muted look, the dirty draft marker
// comes only from a real user input event, and a successful read clears the
// warning in the same synchronous step that records it (no timer race, no
// grace period, write gate unchanged).
// Unified write contract (clustered-read plan M5, owner decision 2026-09-29):
// every Settings write is a draft until that row's own OK, then exactly one
// preflight + one POST to /settings/register-write with that row's key and
// value, and the terminal result lands on that row. Locked rows cannot send.
const SETTINGS_CATALOG_ROWS_OF = (page) => page.hooks.SETTINGS_CATALOG_ROWS;
async function runUnifiedWriteContractScenario() {
  const settle = async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setImmediate(r)); };
  fakeNow = 1500000;
  // Controlled timers: without a harness the page's window.setTimeout runs
  // every callback at once (setTimeout(cb, 0)), which would fire the
  // readback/poll timeouts in the middle of these checks. Nothing here
  // advances this queue, so only real events decide each outcome.
  const clock = { now: () => fakeNow, get value() { return fakeNow; }, set value(v) { fakeNow = v; } };
  harness = { timers: new TimerQueue(clock), win: new ListenerRegistry(), doc: new ListenerRegistry(), snapshotGets: 0,
    snapshot: { blocks: [[0x1114, 0, 1], [0x1118, 0, 1]] } };
  const p = bootStartupPage();
  const { ingestPayload, acceptReadBlockSnapshot, updateSettingsCatalogValue, WRITE_REGISTRY, registerEntity } = p.hooks;
  const list = idRegistry.get("settingsCatalogList");
  const rowEl = (manifestId) => list.querySelectorAll(".settings-catalog-row").find((r) => r.dataset.manifestId === manifestId);
  health(p, "LIVE");
  registerEntity("gps_heartbeat", "number", "gps_heartbeat", "gps_heartbeat");
  ingestPayload({ id: "sensor/smart sleep timeout hours", state: "24", value: 24 });
  ingestPayload({ id: "binary_sensor/lcd always on", state: "ON", value: true });
  ingestPayload({ id: "gps_heartbeat", state: "0", value: 0 });
  ingestPayload({ id: "binary_sensor/smart sleep enabled", state: "OFF", value: false });
  acceptReadBlockSnapshot({ blocks: [[0x1114, 0, 1], [0x1118, 0, 1]] });
  for (const id of ["TIMSmartSleep", "LCD Always On", "GPS Heartbeat", "SmartSleep"]) updateSettingsCatalogValue(id);
  const tim = rowEl("TIMSmartSleep");
  const lcd = rowEl("LCD Always On");
  const timInput = tim.querySelector(".settings-catalog-editor");
  const timOk = tim.querySelector(".settings-catalog-action");
  const lcdSelect = lcd.querySelector(".settings-catalog-editor");
  const lcdOk = lcd.querySelector(".settings-catalog-action");
  const timMsg = () => idRegistry.get("wrMsg_smart_sleep_timeout_hours");
  const lcdMsg = () => idRegistry.get("wrMsg_lcd_always_on");
  check("U0: the numeric and the select live rows are fresh with an enabled OK", timOk && lcdOk && timOk.disabled === false && lcdOk.disabled === false,
    `${timOk && timOk.disabled} ${lcdOk && lcdOk.disabled}`);

  // 1/2. Editing every active input/select (input + change events) sends nothing.
  fetchCallLog = [];
  const liveRows = SETTINGS_CATALOG_ROWS_OF(p).filter((r) => r.readWriteState === "live").map((r) => rowEl(r.manifestId)).filter(Boolean);
  for (const el of liveRows) {
    const ed = el.querySelector(".settings-catalog-editor");
    if (!ed) continue;
    ed.value = ed.tagName === "select" ? "0" : "7";
    ed.dispatchEvent(new FakeEvent("input", ed));
    ed.dispatchEvent(new FakeEvent("change", ed));
  }
  await settle();
  check("U1: editing every active input sends no request (all 23 live rows, incl. the 18 migrated Settings fields)", liveRows.length === 23 && fetchCallLog.length === 0, JSON.stringify(fetchCallLog));
  lcdSelect.value = "0";
  lcdSelect.dispatchEvent(new FakeEvent("change", lcdSelect));
  await settle();
  check("U2: changing a select sends no request", fetchCallLog.length === 0);

  // 3/4/9. Only that row's OK: one preflight + one POST, its own key and value,
  // never another row's draft.
  let requestId = 40;
  let statusBody = null;
  fetchResponder = (url, method) => {
    if (method === "GET" && url.includes("/settings/register-write/preflight")) {
      return { status: 200, body: { ready: true, current_raw: 0x1800, merged_raw: 0x3000, sibling_bits_before: 0, reject_reason: null } };
    }
    if (method === "POST" && url.includes("/settings/register-write?")) {
      requestId += 1;
      return { status: 200, body: { ok: true, status: "accepted", key: "x", request_id: requestId } };
    }
    if (method === "GET" && url.includes("/settings/register-write/status")) return { status: 200, body: statusBody(requestId) };
    return { status: 404, body: null };
  };
  timInput.value = "48";
  lcdSelect.value = "0";  // a draft in ANOTHER row
  statusBody = (id) => ({ status: "accepted", request_id: id, tx_id: 101 });
  fetchCallLog = [];
  fakeClick(timOk);
  await settle();
  const pre = fetchCallLog.filter((f) => f.url.includes("/preflight"));
  const posts = fetchCallLog.filter((f) => f.method === "POST");
  check("U3: pressing the row's OK starts exactly one preflight and one POST",
    pre.length === 1 && posts.length === 1, JSON.stringify(fetchCallLog));
  check("U4: the POST carries that row's exact canonical key and value, submit_policy=live",
    /key=smart_sleep_timeout_hours(&|$)/.test(posts[0].url) && /[?&]value=48(&|$)/.test(posts[0].url) && /submit_policy=live/.test(posts[0].url), posts[0] && posts[0].url);
  check("U9: the OK of one row never includes another row's draft", !fetchCallLog.some((f) => /lcd_always_on/.test(f.url)));
  check("U5: no Settings write uses a legacy /number/set_* route", !fetchCallLog.some((f) => /\/number\/|\/select\/|\/switch\//.test(f.url)));

  // 7. CONFIRMED on the same row (and nowhere else).
  const snap = (status) => ingestPayload({ id: "text_sensor-write_tx_snapshot", domain: "text_sensor",
    value: JSON.stringify([{ addr: 0x1118, tx_id: 101, status, req: 0x3000, rb: 0x3000 }]),
    state: JSON.stringify([{ addr: 0x1118, tx_id: 101, status, req: 0x3000, rb: 0x3000 }]) });
  snap(4);
  await settle();
  check("U7: CONFIRMED is shown on the same row", timMsg().dataset.kind === "success" && /Saved/.test(timMsg().textContent) && lcdMsg().textContent === "",
    `${timMsg().textContent} | ${lcdMsg().textContent}`);

  // 7. MISMATCH on the same row.
  const again = async (status, tx) => {
    timInput.value = "48";
    statusBody = (id) => ({ status: "accepted", request_id: id, tx_id: tx });
    fakeClick(timOk);
    await settle();
    ingestPayload({ id: "text_sensor-write_tx_snapshot", domain: "text_sensor",
      value: JSON.stringify([{ addr: 0x1118, tx_id: tx, status, req: 0x3000, rb: 0x1800 }]),
      state: JSON.stringify([{ addr: 0x1118, tx_id: tx, status, req: 0x3000, rb: 0x1800 }]) });
    await settle();
  };
  await again(5, 102);
  check("U7: MISMATCH is shown on the same row as an error", timMsg().dataset.kind === "error" && lcdMsg().textContent === "", timMsg().textContent);
  // 7. WRITE_UNCERTAIN is not terminal on the row; recovery confirms it.
  await again(6, 103);
  check("U7: WRITE_UNCERTAIN keeps the row pending (OK disabled, no final message)", timOk.disabled === true, timMsg().textContent);
  ingestPayload({ id: "text_sensor-write_tx_snapshot", domain: "text_sensor",
    value: JSON.stringify([{ addr: 0x1118, tx_id: 103, status: 10, req: 0x3000, rb: 0x3000 }]),
    state: JSON.stringify([{ addr: 0x1118, tx_id: 103, status: 10, req: 0x3000, rb: 0x3000 }]) });
  await settle();
  check("U7: ... then RECOVERED_CONFIRMED is shown on the same row", timMsg().dataset.kind === "success" && timOk.disabled === false, timMsg().textContent);
  // 7. Rejection on the same row.
  timInput.value = "48";
  statusBody = (id) => ({ status: "rejected", request_id: id, reason: "bms not live" });
  fakeClick(timOk);
  await settle();
  check("U7: a rejection is shown on the same row with the backend reason", timMsg().dataset.kind === "error" && /bms not live/.test(timMsg().textContent),
    timMsg().textContent);
  // 6. NO_CHANGE as success on the same row, nothing else to watch.
  timInput.value = "24";
  statusBody = (id) => ({ status: "no_change", request_id: id });
  fakeClick(timOk);
  await settle();
  check("U6: NO_CHANGE is shown as success on the same row", timMsg().dataset.kind === "success" && /nothing was written/.test(timMsg().textContent) &&
    timOk.disabled === false && lcdMsg().textContent === "", timMsg().textContent);

  // 3/4/9 on a migrated Settings field (U32, 0x1000): its own OK sends only
  // key=smart_sleep with the bare value, never another row's draft.
  ingestPayload({ id: "smart_sleep", state: "3.321 V", value: 3.321 });
  acceptReadBlockSnapshot({ blocks: [[0x1000, 0, 1], [0x1114, 0, 1], [0x1118, 0, 1]] });
  updateSettingsCatalogValue("VolSmartSleep");
  const sleep = rowEl("VolSmartSleep");
  const sleepInput = sleep.querySelector(".settings-catalog-editor");
  const sleepOk = sleep.querySelector(".settings-catalog-action");
  timInput.value = "99";  // a draft in another row
  sleepInput.value = "3,300";  // decimal comma accepted
  statusBody = (id) => ({ status: "no_change", request_id: id });
  fetchCallLog = [];
  fakeClick(sleepOk);
  await settle();
  const sleepPosts = fetchCallLog.filter((f) => f.method === "POST");
  check("U3m: a migrated field's own OK: one preflight + one POST with key=smart_sleep&value=3.3, nothing for any other row",
    fetchCallLog.filter((f) => f.url.includes("/preflight")).length === 1 && sleepPosts.length === 1 &&
    /key=smart_sleep(&|$)/.test(sleepPosts[0].url) && /[?&]value=3\.3(&|$)/.test(sleepPosts[0].url) &&
    !fetchCallLog.some((f) => /smart_sleep_timeout_hours|\/number\//.test(f.url)), JSON.stringify(fetchCallLog));
  check("U6m: its NO_CHANGE lands on its own row as success",
    /nothing was written/.test(idRegistry.get("wrMsg_smart_sleep").textContent) && idRegistry.get("wrMsg_smart_sleep").dataset.kind === "success");
  // Every migrated field has exactly one OK in its own row.
  const migratedRowsOk = SETTINGS_CATALOG_ROWS_OF(p).filter((r) => (p.hooks.WRITE_REGISTRY.live || []).some((e) => e.key === r.canonicalKey) &&
    ["smart_sleep", "cell_uvpr", "cell_ovpr", "start_balance_trigger", "soc_100", "soc_0", "cell_rcv", "cell_rfv", "charge_ocpr_time",
      "discharge_ocpr_time", "scpr_time", "max_balance_current", "charge_otpr", "discharge_otpr", "charge_utpr", "mos_otpr",
      "battery_capacity", "start_balance"].includes(r.canonicalKey))
    .map((r) => rowEl(r.manifestId));
  check("U10: all 18 migrated fields render one editor and exactly one OK (data-wr-key = its own key)",
    migratedRowsOk.length === 18 && migratedRowsOk.every((el) => el && el.querySelectorAll("button").length === 1 &&
      el.querySelector(".settings-catalog-action").dataset.wrKey === el.dataset.canonicalKey), `rows=${migratedRowsOk.length}`);

  // A signed temperature: a negative value (decimal comma) goes out as the
  // bare signed number through the same pipeline; an out-of-range one never
  // leaves the page.
  ingestPayload({ id: "sensor/charge OTPR", state: "50.0 °C", value: 50 });
  ingestPayload({ id: "charge_otpr", state: "50.0 °C", value: 50 });
  acceptReadBlockSnapshot({ blocks: [[0x1000, 0, 1], [0x1050, 0, 1], [0x1114, 0, 1], [0x1118, 0, 1]] });
  updateSettingsCatalogValue("TMPBatCOTPR");
  const temp = rowEl("TMPBatCOTPR");
  const tempInput = temp.querySelector(".settings-catalog-editor");
  const tempOk = temp.querySelector(".settings-catalog-action");
  statusBody = (id) => ({ status: "accepted", request_id: id, tx_id: 777 });
  tempInput.value = "-12,5";
  fetchCallLog = [];
  fakeClick(tempOk);
  await settle();
  const tempPosts = fetchCallLog.filter((f) => f.method === "POST");
  check("U11: a negative temperature (-12,5) is submitted as key=charge_otpr&value=-12.5 through /settings/register-write only",
    tempPosts.length === 1 && /key=charge_otpr(&|$)/.test(tempPosts[0].url) && /[?&]value=-12\.5(&|$)/.test(tempPosts[0].url) &&
    !fetchCallLog.some((f) => /\/number\//.test(f.url)), JSON.stringify(fetchCallLog));
  ingestPayload({ id: "text_sensor-write_tx_snapshot", domain: "text_sensor",
    value: JSON.stringify([{ addr: 0x1050, tx_id: 777, status: 4, req: 0xFFFFFF83, rb: 0xFFFFFF83 }]),
    state: JSON.stringify([{ addr: 0x1050, tx_id: 777, status: 4, req: 0xFFFFFF83, rb: 0xFFFFFF83 }]) });
  await settle();
  check("U11: its CONFIRMED lands on the same row", idRegistry.get("wrMsg_charge_otpr").dataset.kind === "success");
  tempInput.value = "-100.1";
  fetchCallLog = [];
  fakeClick(tempOk);
  await settle();
  check("U11: -100.1 (below -100) is marked invalid and never sent", fetchCallLog.length === 0 && tempInput.getAttribute("aria-invalid") === "true");

  // 8. Locked rows (no write-registry entry, or authorization required) cannot send.
  fetchCallLog = [];
  const locked = SETTINGS_CATALOG_ROWS_OF(p).filter((r) => r.access === "RW" && r.readWriteState !== "live" && r.canonicalKey)
    .map((r) => rowEl(r.manifestId)).filter(Boolean);
  for (const el of locked) {
    fakeClick(el);
    for (const node of el.querySelectorAll(".settings-catalog-editor")) { node.dispatchEvent(new FakeEvent("input", node)); fakeClick(node); }
  }
  await settle();
  check("U8: every unauthorized/unmapped RW row shows a lock, has no OK, and cannot issue any request",
    locked.length === 42 && locked.every((el) => el.querySelectorAll(".settings-lock").length === 1 && !el.querySelector("button")) &&
    fetchCallLog.length === 0, `locked=${locked.length} calls=${fetchCallLog.length}`);
  check("U8: none of the 18 migrated Settings fields is among them (e.g. smart_sleep, charge_otpr)",
    ["VolSmartSleep", "TMPBatCOTPR", "TMPBatDcOTPR", "TMPBatCUTPR", "TMPMosOTPR"].every((id) => !locked.includes(rowEl(id))));
  fetchResponder = null;
  fetchCallLog = [];
  harness = null;
}

function runFalseStaleScenario() {
  fakeNow = 900000;
  const p = bootStartupPage();
  const { ingestPayload, acceptReadBlockSnapshot, readBlockSuccess, sweepDiagnosticStaleness, setBrowserLink,
    setLanguage, renderSettingsCatalog, settingsFieldFreshness } = p.hooks;
  ingestStartupValues(p);
  ingestPayload({ id: "sensor/cell 4 wire resistance", state: "0.040 mΩ", value: 0.040 });
  acceptReadBlockSnapshot(STARTUP_SNAPSHOT);
  health(p, "LIVE");
  const allEditors = () => [...idRegistry.get("settingsCatalogList").querySelectorAll(".settings-catalog-editor"),
    ...p.cellList.querySelectorAll(".cell-composite-calibration-editor")];
  const dirtyEditors = () => allEditors().filter((ed) => ed.dataset.dirty === "true");
  const lcd = () => idRegistry.get("settingsCatalogList").querySelectorAll(".settings-catalog-row")
    .find((r) => r.dataset.manifestId === "LCD Always On");
  const lcdSelect = () => lcd().querySelector(".settings-catalog-editor");
  const lcdButton = () => lcd().querySelector(".settings-catalog-action");
  p.cell4();
  check("F1: SSE population marks no editor dirty", allEditors().length > 0 && dirtyEditors().length === 0,
    dirtyEditors().map((e) => e.dataset.canonicalKey || e.id).join(","));
  setLanguage("uk");
  setLanguage("en");
  check("F1: relocalization marks no editor dirty", dirtyEditors().length === 0);
  renderSettingsCatalog();
  p.cell4();
  check("F1: rerender marks no editor dirty", dirtyEditors().length === 0);
  setBrowserLink("reconnecting");
  setBrowserLink("connected");
  ingestStartupValues(p);
  health(p, "LIVE");
  check("F1: reconnect + value snapshot marks no editor dirty", dirtyEditors().length === 0);
  // Only the user's input event sets the draft marker (delegated handler).
  const dirtyWrites = source.match(/\.dataset\.dirty = "true"/g) || [];
  check("F1: exactly two code paths set dirty: the user 'input' handler and the rebuild that re-applies an existing draft",
    dirtyWrites.length === 2 &&
    /addEventListener\("input", \(event\) => \{\n\s+const input = event\.target;\n\s+if \(input instanceof HTMLInputElement \|\| input instanceof HTMLSelectElement\) \{ input\.dataset\.dirty = "true";/.test(source) &&
    /for \(const \[wireId, pending\] of preservedDirty\) \{[\s\S]{0,200}node\.dataset\.dirty = "true";/.test(source));

  // Fresh baseline for 0x1114 (budget 22.5 s): record the read at T0.
  const B = p.hooks.PROTOCOL_CATALOG.fieldMeta.lcd_always_on.freshnessBudgetS * 1000;
  check("F2: the 0x1114 budget is the derived 15 s + 7.5 s", B === 22500);
  fakeNow += 1;
  readBlockSuccess(`${0x1114}:2`);
  const t0 = fakeNow;
  check("F2: 0x1114 field fresh after its read", lcdSelect().dataset.freshness === "fresh" &&
    !lcdSelect().classList.contains("is-stale") && lcdButton().disabled === false);
  fakeNow = t0 + B;
  sweepDiagnosticStaleness();
  check("F2: exactly at the budget the field is still fresh (strictly-greater rule)",
    lcdSelect().dataset.freshness === "fresh" && lcdButton().disabled === false);
  // Read success lands between two sweep ticks just after the budget: the
  // next tick must never show a stale frame.
  fakeNow = t0 + B + 1;
  readBlockSuccess(`${0x1114}:3`);
  sweepDiagnosticStaleness();
  check("F3: a read recorded before the sweep tick never produces a stale frame",
    lcdSelect().dataset.freshness === "fresh" && !lcdSelect().classList.contains("is-stale"));
  // Genuine stale: no read for more than the budget.
  const t1 = fakeNow;
  fakeNow = t1 + B + 1;
  sweepDiagnosticStaleness();
  check("F4: genuine missed budget is stale (yellow kept) and the write gate closes",
    lcdSelect().dataset.freshness === "stale" && lcdSelect().classList.contains("is-stale") && lcdButton().disabled === true &&
    settingsFieldFreshness("lcd_always_on").kind === "stale");
  const before = fetchCallLog.length;
  attemptAllSubmits(p);
  check("F4: stale submit attempts produce zero GET/POST", fetchCallLog.length === before);
  readBlockSuccess(`${0x1114}:4`);
  check("F5: the successful read clears stale synchronously, in the same step (no sweep needed, no delay)",
    lcdSelect().dataset.freshness === "fresh" && !lcdSelect().classList.contains("is-stale") && lcdButton().disabled === false);
  readBlockSuccess(`${0x1114}:4`);
  fakeNow += B + 1;
  sweepDiagnosticStaleness();
  check("F5: a replayed (non-increasing) read revision cannot refresh the block",
    lcdSelect().dataset.freshness === "stale");
  fakeNow += 1;
  readBlockSuccess(`${0x1114}:5`);

  // Offline: muted, never the stale yellow; gate closed.
  setBrowserLink("reconnecting");
  const cell = p.cell4();
  check("F6: offline Settings editor/select are not yellow",
    p.legacyInput.dataset.freshness === "offline" && !p.legacyInput.classList.contains("is-stale") &&
    lcdSelect().dataset.freshness === "offline" && !lcdSelect().classList.contains("is-stale"),
    `${p.legacyInput.className} / ${lcdSelect().className}`);
  check("F6: offline read-only cell values are not yellow",
    cell.voltage.dataset.freshness === "offline" && !cell.voltage.classList.contains("is-stale"), cell.voltage.className);
  check("F6: offline keeps the write gate closed", p.legacyButton.disabled === true && lcdButton().disabled === true);
  const beforeOffline = fetchCallLog.length;
  attemptAllSubmits(p);
  check("F6: offline submit attempts produce zero GET/POST", fetchCallLog.length === beforeOffline);
  setBrowserLink("connected");
  health(p, "OFFLINE");
  check("F7: BMS-offline (browser connected) is offline, not yellow",
    lcdSelect().dataset.freshness === "offline" && !lcdSelect().classList.contains("is-stale") && lcdButton().disabled === true);
}

// Startup ordering (owner report 2026-09-25: Settings/cell values briefly
// showed "Offline" right after opening the page). Each scenario is a fresh
// page lifetime -- a new vm instance of the real jk_bms.js -- because the
// defect only exists before the FIRST bms_health observation, which the
// single-lifetime test above can reach only once. The SSE value snapshot,
// the async /settings/read-freshness snapshot and the first bms_health
// event have no guaranteed relative order.
function bootStartupPage({ connect = true } = {}) {
  const { hooks, body } = loadRealClosures();
  const list = new FakeNode("div");
  list.id = "settingsCatalogList";
  body.appendChild(list);
  const message = new FakeNode("p");
  message.id = "settingsMessage";
  body.appendChild(message);
  const overlay = new FakeNode("div");
  overlay.id = "cellOverlay";
  overlay.hidden = true;
  body.appendChild(overlay);
  const cellList = new FakeNode("div");
  cellList.id = "cellCompositeList";
  body.appendChild(cellList);
  // Global freshness panel nodes (ids from the real build() markup).
  const panel = {};
  for (const [id, tag, cls] of [["cluster", "div", "cluster"], ["systemLine", "div", "identity-sub"], ["connDot", "span", "dot"],
    ["bmsHealthText", "span", ""], ["freshnessBanner", "div", "freshness-banner"], ["diagBmsHealth", "span", ""],
    ["diagBmsAge", "span", ""], ["diagBrowserLink", "span", ""]]) {
    const node = new FakeNode(tag);
    node.id = id;
    if (cls) node.className = cls;
    body.appendChild(node);
    panel[id] = node;
  }
  hooks.renderSettingsCatalog();
  const row = (manifestId) => list.querySelectorAll(".settings-catalog-row").find((r) => r.dataset.manifestId === manifestId);
  const legacyRow = row("TIMSmartSleep");
  const binaryRow = row("LCD Always On");
  const page = {
    hooks, cellList, panel,
    legacyInput: legacyRow.querySelector(".settings-catalog-editor"),
    legacyButton: legacyRow.querySelector(".settings-catalog-action"),
    binarySelect: binaryRow.querySelector(".settings-catalog-editor"),
    binaryButton: binaryRow.querySelector(".settings-catalog-action"),
    marker: (node) => statusNote(node),
    cell4() {
      hooks.renderCellCompositeList();
      const rows = cellList.querySelectorAll(".cell-composite-row");
      const cell = rows.find((r) => r.dataset.cellIndex === "4");
      return { count: rows.length, maxIndex: Math.max(...rows.map((r) => Number(r.dataset.cellIndex))),
        voltage: cell && cell.querySelector(".cell-composite-voltage") };
    },
  };
  if (connect) hooks.setBrowserLink("connected"); // EventSource onopen precedes every SSE message
  hooks.renderFreshness();
  return page;
}

function ingestStartupValues(page) {
  const { ingestPayload, updateSettingsCatalogValue } = page.hooks;
  ingestPayload({ id: "text_sensor/topology state", state: "CONFIRMED", value: "CONFIRMED" });
  ingestPayload({ id: "sensor/display cell count", state: "16", value: 16 });
  ingestPayload({ id: "sensor/cell voltage 4", state: "3.452 V", value: 3.452 });
  ingestPayload({ id: "sensor/smart sleep timeout hours", state: "24", value: 24 });
  ingestPayload({ id: "binary_sensor/lcd always on", state: "ON", value: true });
  updateSettingsCatalogValue("TIMSmartSleep");
  updateSettingsCatalogValue("LCD Always On");
}

const STARTUP_SNAPSHOT = { blocks: [[0x1118, 0, 1], [0x1114, 0, 1], [0x1200, 0, 1], [0x1240, 0, 1], [0x1290, 0, 1]] };
// ingestPayload() schedules the bound bms_health renderer (renderFreshness,
// via bind()) on the next animation frame; the harness's rAF is async, so
// run that same real renderer here to observe the frame synchronously.
const health = (page, value) => {
  page.hooks.ingestPayload({ id: "text_sensor/bms health", state: value, value });
  page.hooks.renderFreshness();
};

// Every submit path a user can reach from a non-fresh Settings/cell field.
function attemptAllSubmits(page) {
  const { submitRegisterWrite, WRITE_REGISTRY } = page.hooks;
  submitRegisterWrite(WRITE_REGISTRY.live.find((e) => e.key === "smart_sleep_timeout_hours"), page.legacyInput, page.legacyButton);
  submitRegisterWrite(WRITE_REGISTRY.live.find((e) => e.key === "lcd_always_on"), page.binarySelect, page.binaryButton);
  return fetchCallLog.length;
}

function assertPending(page, label) {
  const { settingsFieldFreshness } = page.hooks;
  const cell = page.cell4();
  check(`${label}: cached Settings value is pending, never offline`,
    page.legacyInput.dataset.freshness === "pending" && settingsFieldFreshness("smart_sleep_timeout_hours").kind === "pending",
    page.legacyInput.dataset.freshness);
  check(`${label}: cached binary dropdown value is pending`, page.binarySelect.dataset.freshness === "pending",
    page.binarySelect.dataset.freshness);
  check(`${label}: cached composite cell value is pending`, cell.voltage && cell.voltage.dataset.freshness === "pending",
    cell.voltage && cell.voltage.dataset.freshness);
  check(`${label}: pending marker says "Not yet confirmed" with its explanation, not "Offline"`,
    page.marker(page.legacyInput).textContent === "Not yet confirmed" && !page.marker(page.legacyInput).hidden &&
    page.legacyInput.title === "Not yet confirmed — waiting for the first BMS link status" &&
    !page.legacyInput.classList.contains("is-stale"), `${page.marker(page.legacyInput).textContent} / ${page.legacyInput.title}`);
  check(`${label}: every RW submit button is disabled while pending`,
    page.legacyButton.disabled === true && page.binaryButton.disabled === true);
  check(`${label}: pending submit attempts produce zero GET/POST`, attemptAllSubmits(page) === 0, JSON.stringify(fetchCallLog));
}

function runStartupOrderingScenarios() {
  // 1. values -> freshness snapshot -> BMS LIVE (the reported ordering).
  fakeNow = 600000;
  let p = bootStartupPage();
  ingestStartupValues(p);
  p.legacyInput.value = "31";
  p.legacyInput.dataset.dirty = "true";
  p.legacyInput.focus();
  p.legacyInput.setSelectionRange(1, 3);
  assertPending(p, "S1 values before snapshot");
  p.hooks.acceptReadBlockSnapshot(STARTUP_SNAPSHOT);
  assertPending(p, "S1 snapshot ready, no health yet");
  let cell = p.cell4();
  check("S1: 16S active-cell visibility holds while pending", cell.count === 16 && cell.maxIndex === 16);
  health(p, "LIVE");
  cell = p.cell4();
  check("S1: first LIVE makes the cached Settings, dropdown and cell values fresh",
    p.legacyInput.dataset.freshness === "fresh" && p.binarySelect.dataset.freshness === "fresh" &&
    cell.voltage.dataset.freshness === "fresh" && p.legacyButton.disabled === false && p.binaryButton.disabled === false);
  check("S1: draft, focus and selection survive pending -> fresh", p.legacyInput.value === "31" &&
    activeElement === p.legacyInput && p.legacyInput.selectionStart === 1 && p.legacyInput.selectionEnd === 3);
  check("S1: binary dropdown keeps its observed selection", p.binarySelect.value === "1", p.binarySelect.value);
  check("S1: zero GET/POST overall", fetchCallLog.length === 0);

  // 1b. An unrecognised bms_health payload is not a health observation, but
  // (pre-existing fail-closed rule) it still counts as "BMS not healthy" for
  // the recovery boundary, so the next LIVE needs a new block read.
  fakeNow = 650000;
  p = bootStartupPage();
  ingestStartupValues(p);
  p.hooks.acceptReadBlockSnapshot(STARTUP_SNAPSHOT);
  health(p, "");
  check("S1b: empty bms_health payload leaves values pending, not offline",
    p.legacyInput.dataset.freshness === "pending" && p.legacyButton.disabled === true && attemptAllSubmits(p) === 0);
  fakeNow += 1;
  health(p, "LIVE");
  check("S1b: LIVE after a non-healthy payload still requires a post-boundary block read",
    p.legacyInput.dataset.freshness === "offline" && p.legacyButton.disabled === true);
  fakeNow += 1;
  p.hooks.readBlockSuccess(`${0x1118}:2`);
  check("S1b: post-boundary block read restores freshness", p.legacyInput.dataset.freshness === "fresh");

  // 2. BMS LIVE -> freshness snapshot -> values.
  fakeNow = 700000;
  p = bootStartupPage();
  health(p, "LIVE");
  p.hooks.acceptReadBlockSnapshot(STARTUP_SNAPSHOT);
  check("S2: before any value arrives a field is unavailable, not pending/offline",
    p.legacyInput.dataset.freshness === "unavailable" && p.legacyButton.disabled === true);
  ingestStartupValues(p);
  cell = p.cell4();
  check("S2: values after LIVE+snapshot are immediately fresh", p.legacyInput.dataset.freshness === "fresh" &&
    p.binarySelect.dataset.freshness === "fresh" && cell.voltage.dataset.freshness === "fresh" && p.legacyButton.disabled === false);
  check("S2: zero GET/POST", fetchCallLog.length === 0);

  // 3. Explicit BMS OFFLINE as the first health observation.
  fakeNow = 800000;
  p = bootStartupPage();
  ingestStartupValues(p);
  p.hooks.acceptReadBlockSnapshot(STARTUP_SNAPSHOT);
  health(p, "OFFLINE");
  cell = p.cell4();
  check("S3: explicit OFFLINE is reported as offline, not pending", p.legacyInput.dataset.freshness === "offline" &&
    p.binarySelect.dataset.freshness === "offline" && cell.voltage.dataset.freshness === "offline" &&
    p.marker(p.legacyInput).textContent === "Offline");
  check("S3: offline submit attempts produce zero GET/POST", p.legacyButton.disabled === true &&
    p.binaryButton.disabled === true && attemptAllSubmits(p) === 0);
  health(p, "LIVE");
  check("S3: recovery to LIVE alone keeps the pre-outage values offline", p.legacyInput.dataset.freshness === "offline");
  fakeNow += 1;
  p.hooks.readBlockSuccess(`${0x1118}:2`);
  check("S3: a post-recovery block read restores freshness", p.legacyInput.dataset.freshness === "fresh" && p.legacyButton.disabled === false);

  // 4. Established browser connection lost -> reconnect -> successful
  // post-boundary block read.
  fakeNow = 900000;
  p = bootStartupPage();
  health(p, "LIVE");
  p.hooks.acceptReadBlockSnapshot(STARTUP_SNAPSHOT);
  ingestStartupValues(p);
  p.legacyInput.value = "3.200";
  p.legacyInput.dataset.dirty = "true";
  p.legacyInput.focus();
  p.legacyInput.setSelectionRange(0, 2);
  fakeNow += 1000;
  p.hooks.setBrowserLink("reconnecting");
  check("S4: established-link loss marks cached values offline", p.legacyInput.dataset.freshness === "offline" &&
    p.cell4().voltage.dataset.freshness === "offline" && p.legacyButton.disabled === true);
  fakeNow += 1000;
  p.hooks.setBrowserLink("connected");
  // The real onopen re-fetches the snapshot; the BMS last read the block
  // 1.5 s ago, i.e. BEFORE the disconnect boundary.
  p.hooks.acceptReadBlockSnapshot({ blocks: [[0x1118, 1500, 1], [0x1114, 1500, 1], [0x1200, 1500, 1], [0x1240, 1500, 1], [0x1290, 1500, 1]] });
  check("S4: reconnect never falls back to the initial pending state", p.legacyInput.dataset.freshness === "offline" &&
    p.binarySelect.dataset.freshness === "offline" && p.cell4().voltage.dataset.freshness === "offline");
  check("S4: offline-after-reconnect submit attempts produce zero GET/POST", attemptAllSubmits(p) === 0);
  fakeNow += 1;
  p.hooks.readBlockSuccess(`${0x1118}:2`);
  check("S4: freshness before this connection's health still blocks writes", p.legacyInput.dataset.freshness === "offline" &&
    p.legacyButton.disabled === true && attemptAllSubmits(p) === 0);
  health(p, "LIVE");
  check("S4: a post-boundary block read restores only its own block", p.legacyInput.dataset.freshness === "fresh" &&
    p.binarySelect.dataset.freshness === "offline");
  p.hooks.readBlockSuccess(`${0x1114}:2`);
  check("S4: recovery keeps draft, focus and selection", p.legacyInput.value === "3.200" && activeElement === p.legacyInput &&
    p.legacyInput.selectionStart === 0 && p.legacyInput.selectionEnd === 2 && p.binarySelect.dataset.freshness === "fresh");

  // 5. values -> BMS LIVE -> freshness snapshot (+ Ukrainian pending text).
  fakeNow = 1000000;
  p = bootStartupPage();
  ingestStartupValues(p);
  p.hooks.setLanguage("uk");
  check("S5: pending marker and explanation localize to Ukrainian",
    p.legacyInput.dataset.freshness === "pending" && p.marker(p.legacyInput).textContent === "Ще не підтверджено" &&
    p.legacyInput.title === "Ще не підтверджено — очікування першого стану зв'язку з BMS",
    `${p.marker(p.legacyInput).textContent} / ${p.legacyInput.title}`);
  p.hooks.setLanguage("en");
  health(p, "LIVE");
  check("S5: after LIVE but before the snapshot, values are unavailable (awaiting source freshness), never offline",
    p.legacyInput.dataset.freshness === "unavailable" && p.legacyButton.disabled === true && attemptAllSubmits(p) === 0);
  p.hooks.acceptReadBlockSnapshot(STARTUP_SNAPSHOT);
  check("S5: snapshot completes health + source freshness -> fresh", p.legacyInput.dataset.freshness === "fresh" &&
    p.cell4().voltage.dataset.freshness === "fresh" && p.legacyButton.disabled === false);

  // 6. BMS LIVE -> BMS STALE -> BMS LIVE.
  fakeNow = 1100000;
  p = bootStartupPage();
  health(p, "LIVE");
  p.hooks.acceptReadBlockSnapshot(STARTUP_SNAPSHOT);
  ingestStartupValues(p);
  check("S6: fresh while LIVE", p.legacyInput.dataset.freshness === "fresh");
  fakeNow += 1000;
  health(p, "STALE");
  check("S6: explicit STALE still invalidates cached values (offline), never pending",
    p.legacyInput.dataset.freshness === "offline" && p.binarySelect.dataset.freshness === "offline" &&
    p.cell4().voltage.dataset.freshness === "offline" && p.legacyButton.disabled === true && attemptAllSubmits(p) === 0);
  fakeNow += 1000;
  health(p, "LIVE");
  check("S6: LIVE after STALE alone keeps the old values offline", p.legacyInput.dataset.freshness === "offline");
  fakeNow += 1;
  p.hooks.readBlockSuccess(`${0x1118}:2`);
  check("S6: post-recovery block read restores freshness", p.legacyInput.dataset.freshness === "fresh" && p.legacyButton.disabled === false);
  check("S6: zero GET/POST in the whole scenario", fetchCallLog.length === 0);
}

// Global (top) freshness panel: same startup race as the Settings fields --
// before the first valid bms_health, bmsHealthState() reports OFFLINE, so
// combinedFreshness()/renderFreshness() used to show "Offline" globally.
function globalPanel(page) {
  const p = page.panel;
  return {
    tier: page.hooks.combinedFreshness(), dataTier: p.systemLine.dataset.tier, clusterTier: p.cluster.dataset.freshness,
    text: p.bmsHealthText.textContent, dotOffline: p.connDot.classList.contains("offline"),
    dotPending: p.connDot.classList.contains("pending"), bannerHidden: p.freshnessBanner.hidden,
    bannerClass: p.freshnessBanner.className, bannerText: p.freshnessBanner.textContent, diag: p.diagBmsHealth.textContent,
  };
}
function assertGlobalPending(page, label, lang = "en") {
  const g = globalPanel(page);
  const word = lang === "uk" ? "Ще не підтверджено" : "Not yet confirmed";
  check(`${label}: global tier is pending, never offline/live`, g.tier === "pending" && g.dataTier === "pending" &&
    g.clusterTier === "pending", JSON.stringify(g));
  check(`${label}: status text is the localized pending wording (${lang})`, g.text === word && g.diag === word, `${g.text} / ${g.diag}`);
  check(`${label}: connection dot is neutral pending -- neither red offline nor plain live`, g.dotPending && !g.dotOffline);
  check(`${label}: neutral pending banner, not the offline/stale banner`, !g.bannerHidden &&
    g.bannerClass === "freshness-banner tier-pending" && !/offline|офлайн/i.test(g.bannerText), `${g.bannerClass} / ${g.bannerText}`);
  check(`${label}: live-only activity is disabled while pending`, page.hooks.freshnessAllowsLiveActivity(g.tier) === false);
}
const liveDot = (g) => !g.dotOffline && !g.dotPending;

function runGlobalFreshnessScenarios() {
  // G1. Initial page state, before EventSource opens.
  fakeNow = 1200000;
  let p = bootStartupPage({ connect: false });
  assertGlobalPending(p, "G1 before EventSource opens");
  p.hooks.setLanguage("uk");
  assertGlobalPending(p, "G1 uk", "uk");
  p.hooks.setLanguage("en");

  // G2. EventSource connected, no bms_health yet (+ cached values).
  p.hooks.setBrowserLink("connected");
  ingestStartupValues(p);
  p.hooks.acceptReadBlockSnapshot(STARTUP_SNAPSHOT);
  assertGlobalPending(p, "G2 connected, no health");
  check("G2: Settings fields stay pending alongside the global pending tier",
    p.legacyInput.dataset.freshness === "pending" && p.legacyButton.disabled === true && attemptAllSubmits(p) === 0);

  // G3. Malformed / unknown health values are not observations.
  health(p, "");
  assertGlobalPending(p, "G3 empty health");
  health(p, "BOGUS");
  assertGlobalPending(p, "G3 unknown health");

  // G4. First valid LIVE.
  health(p, "LIVE");
  let g = globalPanel(p);
  check("G4: first LIVE -> live tier, live dot, banner hidden", g.tier === "live" && g.dataTier === "live" &&
    g.text === "Live" && liveDot(g) && g.bannerHidden && p.hooks.freshnessAllowsLiveActivity(g.tier) === true, JSON.stringify(g));

  // G5-G7. First valid DELAYED / STALE / OFFLINE on fresh pages.
  fakeNow = 1300000;
  p = bootStartupPage();
  health(p, "DELAYED");
  g = globalPanel(p);
  check("G5: first DELAYED -> delayed tier, live-class dot, banner hidden", g.tier === "delayed" && liveDot(g) && g.bannerHidden &&
    p.hooks.freshnessAllowsLiveActivity(g.tier) === true, JSON.stringify(g));
  fakeNow = 1400000;
  p = bootStartupPage();
  ingestStartupValues(p);
  p.hooks.acceptReadBlockSnapshot(STARTUP_SNAPSHOT);
  health(p, "STALE");
  g = globalPanel(p);
  check("G6: first STALE -> stale tier and stale banner, distinct from pending/offline", g.tier === "stale" &&
    g.bannerClass === "freshness-banner tier-stale" && g.dotOffline && !g.dotPending && g.text.startsWith("Stale") &&
    p.hooks.freshnessAllowsLiveActivity(g.tier) === false, JSON.stringify(g));
  check("G6: STALE Settings field is offline and blocked, zero POST", p.legacyInput.dataset.freshness === "offline" && attemptAllSubmits(p) === 0);
  fakeNow = 1500000;
  p = bootStartupPage();
  health(p, "OFFLINE");
  g = globalPanel(p);
  check("G7: first OFFLINE -> offline tier, red dot, BMS-offline banner", g.tier === "offline" && g.dotOffline && !g.dotPending &&
    g.bannerClass === "freshness-banner tier-offline" && g.bannerText.startsWith("BMS offline") && g.diag === "OFFLINE", JSON.stringify(g));

  // G8. Valid health observed -> browser reconnect never returns to pending.
  fakeNow = 1600000;
  p = bootStartupPage();
  health(p, "LIVE");
  p.hooks.acceptReadBlockSnapshot(STARTUP_SNAPSHOT);
  ingestStartupValues(p);
  p.legacyInput.value = "3.300";
  p.legacyInput.dataset.dirty = "true";
  p.legacyInput.focus();
  p.legacyInput.setSelectionRange(1, 2);
  fakeNow += 1000;
  p.hooks.setBrowserLink("reconnecting");
  g = globalPanel(p);
  check("G8: reconnect after a valid health -> reconnecting, never pending", g.tier === "reconnecting" && !g.dotPending &&
    g.bannerClass === "freshness-banner tier-reconnecting", JSON.stringify(g));

  // G9. -> 8 s disconnect escalation.
  p.hooks.setBrowserLink("disconnected");
  g = globalPanel(p);
  check("G9: disconnect escalation -> offline with the browser-disconnected banner, never pending", g.tier === "offline" &&
    g.dotOffline && !g.dotPending && g.bannerText.startsWith("Browser disconnected"), JSON.stringify(g));
  check("G9: disconnected Settings field is offline, blocked, zero POST", p.legacyInput.dataset.freshness === "offline" &&
    p.legacyButton.disabled === true && attemptAllSubmits(p) === 0);

  // G10. Reconnect followed by health recovery.
  fakeNow += 1000;
  p.hooks.setBrowserLink("connected");
  check("G10: reconnect with only the previous connection's LIVE health -> reconnecting, never live or pending",
    globalPanel(p).tier === "reconnecting");
  health(p, "LIVE");
  check("G10: this connection's own LIVE health -> live again", globalPanel(p).tier === "live");
  health(p, "STALE");
  check("G10: STALE after reconnect is stale, never pending", globalPanel(p).tier === "stale");
  fakeNow += 1000;
  health(p, "LIVE");
  g = globalPanel(p);
  check("G10: health recovery -> live, never pending", g.tier === "live" && liveDot(g) && g.bannerHidden);
  check("G10: Settings still needs a post-boundary block read after recovery", p.legacyInput.dataset.freshness === "offline");
  fakeNow += 1;
  p.hooks.readBlockSuccess(`${0x1118}:2`);
  check("G10: post-boundary read restores freshness; draft, focus, selection and cells intact",
    p.legacyInput.dataset.freshness === "fresh" && p.legacyInput.value === "3.300" && activeElement === p.legacyInput &&
    p.legacyInput.selectionStart === 1 && p.legacyInput.selectionEnd === 2 && p.cell4().count === 16 && p.binarySelect.value === "1");

  // Pre-health browser reconnect/escalation keeps the existing semantics.
  fakeNow = 1700000;
  p = bootStartupPage();
  p.hooks.setBrowserLink("reconnecting");
  check("G11: link lost before any health -> reconnecting (a real browser-link observation), not offline",
    globalPanel(p).tier === "reconnecting");
  p.hooks.setBrowserLink("disconnected");
  check("G11: existing disconnect escalation still reports offline before any health", globalPanel(p).tier === "offline");
  check("G: zero GET/POST across the global scenarios", fetchCallLog.length === 0);
}

// Security remediation (2026-09-25): a credential row never renders a
// credential value, whether it arrives on the routed status entity or on the
// retired secret publisher. Artificial sentinel only; failures name the channel.
function runCredentialRenderScenario() {
  const SENTINEL = "ARTIFICIAL-SENTINEL-PASSCODE-0000";
  fakeNow = 1800000;
  const p = bootStartupPage();
  const credentialRows = p.hooks.SETTINGS_CATALOG_ROWS.filter((r) => r.writeSafetyClass === "credential");
  check("C1: the catalog has credential-class rows", credentialRows.length > 0);
  const list = p.cellList.parentNode.querySelectorAll(".settings-catalog-row");
  for (const row of credentialRows) {
    const dom = list.find((r) => r.dataset.manifestId === row.manifestId);
    for (const wireId of ["text_sensor/setup passcode status", "text_sensor/setup passcode readback", "text_sensor-setup_passcode_readback"]) {
      p.hooks.ingestPayload({ id: wireId, domain: "text_sensor", value: SENTINEL, state: SENTINEL });
    }
    p.hooks.updateSettingsCatalogValue(row.manifestId);
    const text = dom ? dom.textContent : "";
    check(`C1: ${row.manifestId} rendered Settings row never contains a credential value`, !!dom && !text.includes(SENTINEL),
      text.includes(SENTINEL) ? "channel: rendered Settings row" : "");
    check(`C1: ${row.manifestId} shows the localized hidden marker and has no editor or submit control`,
      !!dom && text.includes("Hidden") && !dom.querySelector("input") && !dom.querySelector("button"));
  }
  check("C1: zero GET/POST during the credential render scenario", fetchCallLog.length === 0);
}

// Settings controls simplification (owner request 2026-09-25): rows show a
// label, the value/editor, unit, a short write status and the freshness
// status -- never the evidence prose, which becomes the status badge's
// description. Every control keeps a programmatic label and description.
function runControlsSimplificationScenario() {
  fakeNow = 2000000;
  const p = bootStartupPage();
  const { SETTINGS_CATALOG_ROWS, setLanguage, updateSettingsCatalogValue, relocalizeSettingsCatalog } = p.hooks;
  const list = document_list();
  const rows = list.querySelectorAll(".settings-catalog-row");
  // Visible text = textContent minus visually hidden (sr-only) descriptions.
  const visibleText = (node) => (node.classList && node.classList.contains("sr-only")) ? "" :
    (node.childNodes.length ? node.childNodes.map(visibleText).join("") : node.textContent);
  const prose = SETTINGS_CATALOG_ROWS.map((r) => r.blockerClosureCriterion).filter((x) => typeof x === "string" && x.length > 40);
  const leaking = rows.filter((row) => prose.some((text) => visibleText(row).includes(text)));
  check("X1: no row shows a blocker closure-criterion paragraph as visible text", prose.length > 20 && leaking.length === 0,
    `${prose.length} criteria, leaking rows: ${leaking.slice(0, 3).map((r) => r.dataset.manifestId).join(",")}`);
  const badgeWords = ["Write blocked", "Authorization required", "Unavailable"];
  const locked = rows.filter((r) => r.querySelector(".settings-lock"));
  check("X1: no locked row shows a visible 'Write blocked' / 'Authorization required' / 'Unavailable' text",
    locked.length > 40 && locked.every((r) => badgeWords.every((w) => !visibleText(r).includes(w))),
    locked.filter((r) => badgeWords.some((w) => visibleText(r).includes(w))).slice(0, 3).map((r) => r.dataset.manifestId).join(","));

  const byState = (state) => SETTINGS_CATALOG_ROWS.filter((r) => r.readWriteState === state && r.canonicalKey)
    .map((r) => rows.find((el) => el.dataset.manifestId === r.manifestId)).filter(Boolean);
  const blocked = byState("blocked");
  const authorization = byState("authorization_required");
  const lockedFieldOk = (el, prefix) => {
    const note = el.querySelector(".settings-catalog-note");
    const locks = el.querySelectorAll(".settings-lock");
    const target = el.querySelector(".settings-catalog-editor") || el.querySelector(".settings-catalog-value");
    return note && note.classList.contains("sr-only") && note.textContent.startsWith(prefix) && note.textContent.length > prefix.length + 10 &&
      locks.length === 1 && locks[0].getAttribute("aria-hidden") === "true" && locks[0].title === note.textContent &&
      target && (target.getAttribute("aria-describedby") || "").split(" ").includes(note.id);
  };
  check("X2: every blocked RW row: exactly one lock, full reason as the field's accessible description and the lock's tooltip",
    blocked.length > 20 && blocked.every((el) => lockedFieldOk(el, "Write blocked. ")),
    blocked.filter((el) => !lockedFieldOk(el, "Write blocked. ")).slice(0, 3).map((el) => el.dataset.manifestId).join(","));
  check("X2: every authorization-required row: exactly one lock, safety-class reason as the accessible description",
    authorization.length > 0 && authorization.every((el) => lockedFieldOk(el, "Authorization required. ") &&
      /safety class/.test(el.querySelector(".settings-catalog-note").textContent)));
  check("X2: locked controls are disabled, and blocked/authorization rows have no submit button (fail closed)",
    [...blocked, ...authorization].every((el) => !el.querySelector("button") &&
      el.querySelectorAll(".settings-catalog-editor").every((ed) => ed.disabled === true)));
  const live = SETTINGS_CATALOG_ROWS.filter((r) => r.readWriteState === "live" && settingsEditorKindOf(r))
    .map((r) => rows.find((el) => el.dataset.manifestId === r.manifestId)).filter(Boolean);
  check("X2: active controls are enabled, unlocked and carry no lock (exactly the 23 live write-registry rows)", live.length === 23 &&
    live.every((el) => !el.querySelector(".settings-lock") && el.querySelector(".settings-catalog-editor").disabled !== true &&
      !el.querySelector(".settings-field-shell").classList.contains("is-locked")));
  const liveStage4 = SETTINGS_CATALOG_ROWS.filter((r) => r.readWriteState === "live" && r.writePathKind === "stage4_write_registry")
    .map((r) => rows.find((el) => el.dataset.manifestId === r.manifestId)).filter(Boolean);
  check("X2: Stage 4 rows keep their write-result status region (role=status, aria-live)",
    liveStage4.length > 0 && liveStage4.every((el) => {
      const m = el.querySelector(".settings-catalog-message");
      return m && m.getAttribute("role") === "status" && m.getAttribute("aria-live") === "polite" && m.id.startsWith("wrMsg_");
    }));
  const wRows = SETTINGS_CATALOG_ROWS.filter((r) => r.access === "W").map((r) => rows.find((el) => el.dataset.manifestId === r.manifestId));
  check("X2: service commands show only their label -- no lock, no action placeholder -- and keep the reason as the row description",
    wRows.length > 0 && wRows.every((el) => el.querySelectorAll(".settings-lock").length === 0 &&
      !el.querySelector(".settings-catalog-editor-group") && !el.querySelector("button") &&
      visibleText(el) === visibleText(el.querySelector(".settings-catalog-label")) &&
      idRegistry.get(el.getAttribute("aria-describedby")) === el.querySelector(".settings-catalog-note") &&
      el.querySelector(".settings-catalog-note").textContent.length > 20));
  // One action slot per writable row: OK when writable, the lock otherwise,
  // always the element right after the field shell; never a lock in a shell.
  const writableRows = rows.filter((el) => el.dataset.access === "RW" && el.querySelector(".settings-field-shell"));
  const slotOf = (el) => { const g = el.querySelector(".settings-catalog-editor-group"); const i = g.childNodes.findIndex((k) => k.classList.contains("settings-field-shell")); return g.childNodes[i + 1]; };
  check("X2: every RW row has exactly one action slot right after its field: OK when writable, lock otherwise",
    writableRows.length > 60 && writableRows.every((el) => {
      const slot = slotOf(el);
      const ok = el.querySelectorAll(".settings-catalog-action").length;
      const locks = el.querySelectorAll(".settings-lock").length;
      return slot && ok + locks === 1 && (slot.classList.contains("settings-catalog-action") || slot.classList.contains("settings-action-lock"));
    }));
  check("X2: no lock is ever inside a field shell", list.querySelectorAll(".settings-field-shell").every((sh) => !sh.querySelector(".settings-lock")));
  const allLocks = list.querySelectorAll(".settings-lock");
  check("X2: the framed lock is a non-interactive indicator -- not a button, not focusable, hidden from the accessibility tree",
    allLocks.length > 40 && allLocks.every((l) => l.tagName === "span" && l.getAttribute("role") === null &&
      l.getAttribute("tabindex") === null && l.getAttribute("aria-hidden") === "true"));
  // Raw values: compact visible suffix, full meaning in the accessibility tree.
  const rawRows = SETTINGS_CATALOG_ROWS.filter((r) => r.unit === "raw")
    .map((r) => rows.find((el) => el.dataset.manifestId === r.manifestId)).filter(Boolean);
  const rawOk = (lang) => rawRows.length === 4 && rawRows.every((el) => {
    const ed = el.querySelector(".settings-catalog-editor");
    const unit = el.querySelector(".settings-catalog-unit");
    const note = el.querySelector(".settings-raw-unit-note");
    const ids = (ed.getAttribute("aria-describedby") || "").split(" ");
    return unit.textContent === "raw" && note && note.classList.contains("sr-only") && ids.includes(note.id) &&
      idRegistry.get(note.id) === note && unit.title === note.textContent &&
      (lang === "uk" ? note.textContent.startsWith("необроблене значення") : note.textContent.startsWith("raw register value")) &&
      !visibleText(el).includes("необроблено");
  });
  check("X2: raw-value fields show the compact 'raw' suffix (EN), with the full meaning as a resolved hidden description", rawOk("en"));
  setLanguage("uk");
  relocalizeSettingsCatalog();
  check("X2: ...and the same 'raw' suffix in Ukrainian, with the Ukrainian explanation only in the accessibility tree", rawOk("uk"));
  setLanguage("en");
  relocalizeSettingsCatalog();
  check("X2: no row is marked for a special wide width any more", rows.every((el) => el.dataset.valueUnit === undefined));
  check("X2: read-only rows have no action slot and no field shell (plain values)",
    rows.filter((el) => el.dataset.access === "R").every((el) => !el.querySelector(".settings-field-shell") &&
      !el.querySelector(".settings-lock") && !el.querySelector("button")));

  // Units: inside the shell, outside the editable value; selects get none.
  const shells = list.querySelectorAll(".settings-field-shell");
  const unitShells = shells.filter((sh) => sh.querySelector(".settings-catalog-unit"));
  check("X3: numeric units are suffixes inside the field shell, after the editor and before the lock",
    unitShells.length > 30 && unitShells.every((sh) => {
      const kids = sh.childNodes;
      const unitIdx = kids.findIndex((k) => k.classList.contains("settings-catalog-unit"));
      const lockIdx = kids.findIndex((k) => k.classList.contains("settings-lock"));
      return kids[0].classList.contains("settings-catalog-editor") && kids[0].tagName === "input" && unitIdx === 1 &&
        (lockIdx === -1 || lockIdx === 2) && kids[0].childNodes.length === 0;
    }));
  check("X3: selects never get a unit suffix; rows without a unit get no unit slot",
    shells.filter((sh) => sh.querySelector("select")).every((sh) => !sh.querySelector(".settings-catalog-unit")) &&
    shells.every((sh) => sh.querySelectorAll(".settings-catalog-unit").every((u) => u.textContent.trim() !== "")));
  check("X3: every numeric input value is a bare number (no unit text)",
    list.querySelectorAll(".settings-catalog-editor").filter((ed) => ed.tagName === "input" && ed.value !== "")
      .every((ed) => /^-?\d+(\.\d+)?$/.test(ed.value)));

  // Accessibility wiring.
  const allIds = [];
  list._walk((n) => { if (n.id) allIds.push(n.id); });
  check("X4: no duplicate DOM ids in the Settings list", allIds.length > 300 && new Set(allIds).size === allIds.length,
    `${allIds.length} ids`);
  const idLists = [...list.querySelectorAll(".settings-catalog-editor"), ...list.querySelectorAll(".settings-catalog-action"),
    ...list.querySelectorAll(".settings-catalog-value"), ...rows].flatMap((n) => [n.getAttribute("aria-labelledby"), n.getAttribute("aria-describedby")])
    .filter(Boolean);
  check("X4: every aria-labelledby/-describedby id resolves to exactly one element",
    idLists.length > 150 && idLists.every((v) => v.split(" ").every((id) => /^[A-Za-z0-9_-]+$/.test(id) && allIds.filter((x) => x === id).length === 1)));
  const editors = list.querySelectorAll(".settings-catalog-editor");
  check("X4: every Settings control has a programmatic label with text",
    editors.length > 50 && editors.every((ed) => { const l = idRegistry.get(ed.getAttribute("aria-labelledby")); return l && l.textContent.trim(); }));
  check("X4: every control is described by its freshness status element",
    editors.every((ed) => (ed.getAttribute("aria-describedby") || "").split(" ").some((id) => idRegistry.get(id).classList.contains("settings-freshness-note"))));
  check("X4: controls are native INPUT/SELECT and actions native type=button buttons (keyboard-operable)",
    editors.every((ed) => ed.tagName === "input" || ed.tagName === "select") && editors.every((ed) => ed.getAttribute("tabindex") === null) &&
    list.querySelectorAll(".settings-catalog-action").every((b) => b.tagName === "button" && b.type === "button"));

  // "Unavailable" is never said twice.
  const lockedEmpty = [...blocked, ...authorization].filter((el) => !p.hooks.state[el.dataset.canonicalKey]);
  check("X5: a locked field without a reading shows a dash and no 'Unavailable' status beside it",
    lockedEmpty.length > 10 && lockedEmpty.every((el) => {
      const ed = el.querySelector(".settings-catalog-editor");
      const val = el.querySelector(".settings-catalog-value");
      const dash = ed ? (ed.tagName !== "input" || (ed.value === "" && ed.placeholder === "—")) : val.textContent === "—";
      const m = el.querySelector(".settings-freshness-note");
      return dash && m.hidden && m.textContent === "";
    }));
  const emptyR = SETTINGS_CATALOG_ROWS.filter((r) => r.access === "R" && r.canonicalKey)
    .map((r) => rows.find((el) => el.dataset.manifestId === r.manifestId)).filter(Boolean)
    .filter((el) => el.querySelector(".settings-catalog-value").textContent === "Unavailable");
  check("X5: an unread R value never shows 'Unavailable' twice", emptyR.length > 10 &&
    emptyR.every((el) => { const m = el.querySelector(".settings-freshness-note"); return m.hidden && m.textContent === ""; }));

  // Status kinds remain distinct and spelled out (never color-only).
  ingestStartupValues(p);
  const kindOf = () => p.legacyInput.dataset.freshness;
  const textOf = () => p.marker(p.legacyInput).textContent;
  const seen = {};
  seen[kindOf()] = textOf();
  health(p, "LIVE");
  p.hooks.acceptReadBlockSnapshot(STARTUP_SNAPSHOT);
  seen[kindOf()] = textOf();
  fakeNow += 400000;
  p.hooks.sweepDiagnosticStaleness();
  seen[kindOf()] = textOf();
  p.hooks.setBrowserLink("reconnecting");
  seen[kindOf()] = textOf();
  check("X6: pending/fresh/stale/offline are distinct states, each non-fresh one with its own status text",
    Object.keys(seen).sort().join(",") === "fresh,offline,pending,stale" && seen.fresh === "" &&
    new Set([seen.pending, seen.stale, seen.offline]).size === 3 && [seen.pending, seen.stale, seen.offline].every(Boolean), JSON.stringify(seen));

  // The submitted value is the bare number, never the unit suffix.
  p.hooks.setBrowserLink("connected");
  health(p, "LIVE");
  fakeNow += 1;
  p.hooks.readBlockSuccess(`${0x1118}:9`);
  p.legacyInput.value = "999";
  p.legacyInput.dataset.dirty = "true";
  fetchCallLog = [];
  try { p.hooks.submitRegisterWrite(p.hooks.WRITE_REGISTRY.live.find((e) => e.key === "smart_sleep_timeout_hours"), p.legacyInput, p.legacyButton); } catch (_) { /* never reaches fetch */ }
  check("X7: an out-of-range value is marked invalid for sight AND for screen readers (aria-invalid), with no request",
    p.legacyInput.classList.contains("invalid") && p.legacyInput.getAttribute("aria-invalid") === "true" && fetchCallLog.length === 0);
  p.legacyInput.value = "30";
  try { p.hooks.submitRegisterWrite(p.hooks.WRITE_REGISTRY.live.find((e) => e.key === "smart_sleep_timeout_hours"), p.legacyInput, p.legacyButton); } catch (_) { /* fetch shim throws by design */ }
  check("X7: a valid value clears both the invalid class and aria-invalid",
    !p.legacyInput.classList.contains("invalid") && p.legacyInput.getAttribute("aria-invalid") !== "true");
  const sent = fetchCallLog.map((f) => f.url).join(" ");
  check("X7: a submit sends the bare number (value=30), never the unit", /[?&]value=30(&|$)/.test(sent) && !/value=[^&]*[A-Za-zВ]/.test(sent), sent);
  fetchCallLog = [];

  // Draft preservation across re-render (relocalization + value refresh).
  p.legacyInput.value = "3.111";
  p.legacyInput.dataset.dirty = "true";
  p.legacyInput.focus();
  p.legacyInput.setSelectionRange(1, 3);
  p.binarySelect.value = "0";
  p.binarySelect.dataset.dirty = "true";
  setLanguage("uk");
  relocalizeSettingsCatalog();
  updateSettingsCatalogValue("TIMSmartSleep");
  updateSettingsCatalogValue("LCD Always On");
  const ukNote = blocked[0].querySelector(".settings-catalog-note");
  check("X8: relocalization keeps drafts, dirty flags, focus, selection and dropdown choice",
    p.legacyInput.value === "3.111" && p.legacyInput.dataset.dirty === "true" && activeElement === p.legacyInput &&
    p.legacyInput.selectionStart === 1 && p.legacyInput.selectionEnd === 3 && p.binarySelect.value === "0");
  check("X8: the lock reason relocalizes (UK description and tooltip, still no visible badge)",
    ukNote.textContent.startsWith("Запис заблоковано. ") && blocked[0].querySelector(".settings-lock").title === ukNote.textContent &&
    !visibleText(blocked[0]).includes("Запис заблоковано"), ukNote.textContent.slice(0, 40));
  const unsupported = rows.filter((el) => el.dataset.readWriteState === "unsupported_protocol_field");
  check("X8: unmapped read fields keep their dash (not 'Unavailable') after relocalization",
    unsupported.length > 0 && unsupported.every((el) => el.querySelector(".settings-catalog-dash").textContent === "—"));
  setLanguage("en");
  check("X: no GET/POST during the controls scenario (outside the explicit X7 submit)", fetchCallLog.length === 0);
}

function settingsEditorKindOf(row) {
  return row.valueKind === "enum" || row.valueKind === "binary" || row.valueKind === "numeric";
}

function document_list() {
  return idRegistry.get("settingsCatalogList");
}

// Browser resume fix (2026-09-25): the REAL connection manager (connect(),
// its lifecycle listeners and its timers) reconnects after a simulated Mac
// sleep while the open Settings page keeps every piece of user state:
// draft values, focus + selection, dropdown choice, dirty flags, the 16S
// active-cell rows -- and nothing is re-rendered from scratch. Writes stay
// blocked until the new connection's health and post-boundary block reads.
// wake: "visible" -- the page's visibilitychange runs first after the sleep;
// "ping" -- the old socket's ESPHome ping runs first, before any timer or
// lifecycle event (owner report 2026-09-27: header LIVE, Settings stale).
async function runRealReconnectScenario(wake) {
  const tag = wake === "ping" ? "R[ping-first]" : "R";
  fakeNow = 1900000;
  const clock = { now: () => fakeNow, get value() { return fakeNow; }, set value(v) { fakeNow = v; } };
  harness = { timers: new TimerQueue(clock), win: new ListenerRegistry(), doc: new ListenerRegistry(), snapshotGets: 0,
    snapshot: { blocks: [[0x1118, 0, 1], [0x1114, 0, 1], [0x1200, 0, 1], [0x1240, 0, 1], [0x1290, 0, 1]] } };
  FakeEventSource.reset();
  const p = bootStartupPage({ connect: false });
  p.hooks.connect();
  const first = FakeEventSource.instances[0];
  first.open();
  await flush();
  ingestStartupValues(p);
  health(p, "LIVE");
  fakeNow += 1;
  p.hooks.readBlockSuccess(`${0x1118}:2`);
  p.hooks.readBlockSuccess(`${0x1114}:2`);
  check(`${tag}: real connect() -> LIVE and writable`, p.legacyInput.dataset.freshness === "fresh" && p.legacyButton.disabled === false &&
    p.binarySelect.dataset.freshness === "fresh");
  // The user is mid-edit in the open Settings page.
  p.legacyInput.value = "3.250";
  p.legacyInput.dataset.dirty = "true";
  p.legacyInput.focus();
  p.legacyInput.setSelectionRange(2, 4);
  p.binarySelect.value = "0";
  p.binarySelect.dataset.dirty = "true";
  const legacyNode = p.legacyInput;
  const selectNode = p.binarySelect;
  const rowCount = p.cell4().count;
  // Mac sleeps for an hour; the socket is half-open (no error, no data).
  harness.timers.suspend(60 * 60 * 1000);
  if (wake === "ping") first.emit("ping", JSON.stringify({ uptime: 1 }));
  else document_visible(p);
  const second = FakeEventSource.instances[FakeEventSource.instances.length - 1];
  check(`${tag}: wake reconnects by itself (no reload): exactly one new EventSource`, FakeEventSource.instances.length === 2 &&
    FakeEventSource.live().length === 1 && first.readyState === 2);
  check(`${tag}: while unconfirmed every submit is blocked and zero GET/POST`, p.legacyInput.dataset.freshness === "offline" &&
    p.legacyButton.disabled === true && attemptAllSubmits(p) === 0);
  // The new connection's snapshot is the device's truth: revision 2 of both
  // blocks, read an hour ago, before the loss boundary.
  harness.snapshot = { blocks: [[0x1118, 3600000, 2], [0x1114, 3600000, 2], [0x1200, 3600000, 1], [0x1240, 3600000, 1], [0x1290, 3600000, 1]] };
  second.open();
  await flush();
  check(`${tag}: the reconnect snapshot's pre-loss reads (an hour old) do not unlock anything`, p.legacyInput.dataset.freshness === "offline" &&
    p.legacyButton.disabled === true);
  fakeNow += 1;
  p.hooks.readBlockSuccess(`${0x1118}:3`);
  check(`${tag}: reconnect + block read but no health on this connection -> still blocked`, p.legacyButton.disabled === true);
  health(p, "LIVE");
  p.hooks.readBlockSuccess(`${0x1114}:3`);
  p.hooks.updateSettingsCatalogValue("TIMSmartSleep");
  p.hooks.updateSettingsCatalogValue("LCD Always On");
  const cell = p.cell4();
  check(`${tag}: after health + post-boundary reads the fields are writable again`, p.legacyInput.dataset.freshness === "fresh" &&
    p.legacyButton.disabled === false && p.binarySelect.dataset.freshness === "fresh");
  check(`${tag}: the same DOM nodes survive (no rebuild), with draft, dirty flag, focus and selection intact`,
    p.legacyInput === legacyNode && p.binarySelect === selectNode && p.legacyInput.value === "3.250" &&
    p.legacyInput.dataset.dirty === "true" && activeElement === legacyNode &&
    p.legacyInput.selectionStart === 2 && p.legacyInput.selectionEnd === 4);
  check(`${tag}: the dropdown draft selection survives`, p.binarySelect.value === "0" && p.binarySelect.dataset.dirty === "true");
  check(`${tag}: 16S active-cell rows unchanged`, cell.count === rowCount && cell.count === 16 && cell.maxIndex === 16);
  check(`${tag}: only the read-only freshness snapshot was fetched (twice), never a write`, harness.snapshotGets === 2 && fetchCallLog.length === 0);
  harness = null;
}

function document_visible(page) {
  harness.doc.dispatch("visibilitychange");
  return page;
}

main();
