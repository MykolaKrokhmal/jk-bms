#!/usr/bin/env node
"use strict";

// EXECUTABLE PRODUCTION-JS DOM TEST -- runs the REAL jk_bms.js closures
// (renderWriteRegistry, submitRegisterWrite, relocalizeWriteRegistry,
// setLanguage, ingestPayload, writeTransaction indirectly) inside a Node
// `vm` sandbox, via the SAME opt-in `window.__JK_BMS_TEST_HOOKS__` escape
// hatch this project's other DOM tests already use (see
// test_diagnostic_cell_channel_hiding.js's own precedent). No UI logic is
// reimplemented here -- this file only supplies browser PRIMITIVES (a
// hand-rolled FakeNode/FakeDocument, a controllable fetch stub, a
// manually-advanced fake clock for window.setTimeout/clearTimeout, a
// window.confirm stub) for the real closures to run against. FakeNode is
// NOT a real browser -- it does not lay out, paint, or enforce every DOM
// spec edge case -- but every render/click/fetch/confirm/timer/language
// decision below is made by jk_bms.js's own real code, not a test double.
//
// Written 2026-09-21 (deployment-gate audit round 2, Task 1+2): closes
// the two Stage 4 gaps the prior round's structural-only test explicitly
// flagged as NOT proven -- that a click actually fires a preflight fetch,
// a confirm dialog actually gates the POST, and SSE/focus/draft state
// survives a live language switch.

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
// Minimal-but-real browser-primitive shim. Selector support is bounded to
// what jk_bms.js's write-registry code actually uses: .class, [data-x],
// [data-x='y'], bare tag names, comma-separated alternation.
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
  // Out-of-scope selector shapes (descendant combinators, #id, etc.) are
  // used elsewhere in jk_bms.js by code this test never exercises
  // (syncThemeOptions/syncLanguageOptions, triggered incidentally by
  // refreshAllDynamicText() during the language-switch section) --
  // returning "never matches" here (rather than throwing) keeps those
  // irrelevant real code paths from crashing this shim, without silently
  // widening what this test's OWN assertions could pass against: every
  // selector this test file itself passes to querySelector/closest is one
  // of the supported kinds above, so a real regression there still throws
  // via the write-registry-specific assertions failing loudly, not via a
  // false "unsupported" pass.
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
  removeEventListener(type, handler) {
    const list = this._listeners.get(type);
    if (!list) return;
    const idx = list.indexOf(handler);
    if (idx !== -1) list.splice(idx, 1);
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

// ---------------------------------------------------------------------------
// Fake clock: window.setTimeout/clearTimeout are backed by a manually
// advanced virtual clock so a 6s writeTransaction readback timeout (or a
// 10s uncertain-recovery timeout) can be exercised without a real wait.
// ---------------------------------------------------------------------------
let fakeNow = 0;
let fakeTimerId = 1;
let fakeTimers = [];
function fakeSetTimeout(cb, ms) {
  const id = fakeTimerId++;
  fakeTimers.push({ id, at: fakeNow + (ms || 0), cb });
  return id;
}
function fakeClearTimeout(id) { fakeTimers = fakeTimers.filter((t) => t.id !== id); }
function advanceTime(ms) {
  fakeNow += ms;
  let progressed = true;
  while (progressed) {
    progressed = false;
    fakeTimers.sort((a, b) => a.at - b.at);
    const due = fakeTimers.filter((t) => t.at <= fakeNow);
    if (due.length) {
      fakeTimers = fakeTimers.filter((t) => t.at > fakeNow);
      for (const t of due) { t.cb(); progressed = true; }
    }
  }
}
// Drains real microtasks (async/await chains) without touching the fake
// clock -- needed after every fetch-stub resolution before asserting.
// setImmediate (not a bare Promise.resolve() chain) is deliberate: a
// setImmediate callback only runs once EVERY microtask queued so far has
// fully drained, which reliably clears a deep await chain (preflight GET
// -> json() -> confirm -> POST -> json() -> set(PENDING_READBACK) ->
// checkSnapshotTerminal -> armTimer) in very few iterations; a fixed
// count of bare `await Promise.resolve()` rounds was found (empirically,
// while writing this test) to be too shallow for that chain -- it let
// armTimer() get scheduled AFTER a subsequent advanceTime() call instead
// of before it, silently arming the timeout relative to the wrong
// simulated time and making the whole TIMEOUT scenario unreachable.
async function flushMicrotasks(times = 15) {
  for (let i = 0; i < times; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

// ---------------------------------------------------------------------------
// Controllable fetch stub: a queue of {matcher, respond} entries, checked
// in order; the FIRST matching entry is consumed (shift), so a test can
// queue exactly the sequence of responses it expects and get a clear
// failure if the real code requests something unexpected.
// ---------------------------------------------------------------------------
let fetchQueue = [];
let fetchCallLog = [];
function queueFetch(matcher, respond) { fetchQueue.push({ matcher, respond }); }
function resetFetchQueue() { fetchQueue = []; fetchCallLog = []; }
async function fakeFetch(url, opts) {
  const method = (opts && opts.method) || "GET";
  fetchCallLog.push({ url: String(url), method });
  const idx = fetchQueue.findIndex((e) => e.matcher(String(url), method));
  if (idx === -1) {
    throw new Error(`test shim: unexpected fetch ${method} ${url} (no queued matcher) -- production code issued a request the test did not anticipate`);
  }
  const [entry] = fetchQueue.splice(idx, 1);
  const result = entry.respond(String(url), method);
  return { ok: result.status >= 200 && result.status < 300, status: result.status, json: async () => result.body };
}

let currentConfirmResult = true;

function loadRealClosures() {
  idRegistry = new Map();
  activeElement = null;
  const documentElement = new FakeNode("html");
  const body = new FakeNode("body");
  const localStorageStore = new Map();
  const window = {
    __JK_BMS_TEST_HOOKS__: {},
    location: { href: "http://jk-bms.local/" },
    addEventListener() {}, matchMedia() { return { matches: false }; },
    cancelAnimationFrame(id) { fakeClearTimeout(id); },
    requestAnimationFrame(cb) { return fakeSetTimeout(cb, 16); },
    clearInterval() {}, setInterval() {},
    setTimeout: fakeSetTimeout, clearTimeout: fakeClearTimeout,
    fetch: (...args) => fakeFetch(...args),
    confirm: () => currentConfirmResult,
    localStorage: {
      getItem(k) { return localStorageStore.has(k) ? localStorageStore.get(k) : null; },
      setItem(k, v) { localStorageStore.set(k, String(v)); },
      removeItem(k) { localStorageStore.delete(k); },
    },
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
    // jk_bms.js calls fetch()/confirm() bare (implicit window.* in a real
    // browser global scope) -- the vm sandbox's global object is `sandbox`
    // itself, not `window`, so these must be mirrored at top level too.
    fetch: (...args) => fakeFetch(...args),
    confirm: () => currentConfirmResult,
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "jk_bms.js" });
  const hooks = window.__JK_BMS_TEST_HOOKS__;
  if (!hooks.renderWriteRegistry) {
    throw new Error("jk_bms.js's test hook did not populate renderWriteRegistry -- window.__JK_BMS_TEST_HOOKS__ shape may have drifted");
  }
  return { hooks, window, document, documentElement, body };
}

async function main() {
  const { hooks, body } = loadRealClosures();
  const {
    renderWriteRegistry, submitRegisterWrite, relocalizeWriteRegistry, setLanguage,
    WRITE_REGISTRY, ingestPayload, activeTransactionKeys,
  } = hooks;

  check("real jk_bms.js closures loaded via the test hook (not reimplemented)",
    typeof renderWriteRegistry === "function" && typeof submitRegisterWrite === "function" &&
    typeof relocalizeWriteRegistry === "function" && typeof setLanguage === "function");

  const writeRegistryList = new FakeNode("div");
  writeRegistryList.id = "writeRegistryList";
  const writeRegistryMessage = new FakeNode("p");
  writeRegistryMessage.id = "writeRegistryMessage";
  body.appendChild(writeRegistryList);
  body.appendChild(writeRegistryMessage);
  // refreshAllDynamicText() (called by setLanguage(), exercised in the
  // language-switch section below) also unconditionally checks
  // getDom("cellOverlay").hidden -- a minimal stand-in (this test never
  // opens the trend modal) keeps that real code path from throwing.
  const cellOverlay = new FakeNode("div");
  cellOverlay.id = "cellOverlay";
  cellOverlay.hidden = true;
  body.appendChild(cellOverlay);

  // =========================================================================
  // A. Render matrix
  // =========================================================================
  resetFetchQueue();
  renderWriteRegistry();

  const rows = writeRegistryList.querySelectorAll(".write-registry-row");
  check("exactly 79 rows total", rows.length === 79, `got=${rows.length}`);
  const liveRows = rows.filter((r) => r.dataset.writeRegistryGroup === "live");
  const authRows = rows.filter((r) => r.dataset.writeRegistryGroup === "authorizationRequired");
  const blockedRows = rows.filter((r) => r.dataset.writeRegistryGroup === "blocked");
  check("exactly 5 live rows", liveRows.length === 5, `got=${liveRows.length}`);
  check("exactly 37 authorization-required rows", authRows.length === 37, `got=${authRows.length}`);
  check("exactly 37 blocked rows", blockedRows.length === 37, `got=${blockedRows.length}`);
  const allKeys = rows.map((r) => r.dataset.writeRegistryKey);
  check("no duplicate canonical keys across all 79 rows", new Set(allKeys).size === allKeys.length,
    `unique=${new Set(allKeys).size} total=${allKeys.length}`);
  let everyKeyOnce = true;
  for (const group of ["live", "authorizationRequired", "blocked"]) {
    for (const e of WRITE_REGISTRY[group]) {
      if (allKeys.filter((k) => k === e.key).length !== 1) everyKeyOnce = false;
    }
  }
  check("every canonical key from WRITE_REGISTRY appears in the DOM exactly once", everyKeyOnce);
  check("page render performs zero fetch/POST calls on its own", fetchCallLog.length === 0, JSON.stringify(fetchCallLog));

  // =========================================================================
  // B. Live fields
  // =========================================================================
  const liveEntry = WRITE_REGISTRY.live.find((e) => e.key === "gps_heartbeat");
  const liveRow = rows.find((r) => r.dataset.writeRegistryKey === "gps_heartbeat");
  const liveInput = liveRow.querySelector(".write-registry-input");
  const liveButton = liveRow.querySelector(".write-registry-button");
  check("live row has an input editor", !!liveInput);
  check("live row has a submit button", !!liveButton);
  check("live input's min/max/step come from WRITE_REGISTRY (not hand-typed)",
    Number(liveInput.min) === liveEntry.minimum && Number(liveInput.max) === liveEntry.maximum && Number(liveInput.step) === liveEntry.step,
    `min=${liveInput.min} max=${liveInput.max} step=${liveInput.step} entry=${JSON.stringify(liveEntry)}`);

  resetFetchQueue();
  liveInput.value = "not-a-number";
  fakeClick(liveButton);
  await flushMicrotasks();
  check("invalid (non-numeric) value never triggers preflight/POST", fetchCallLog.length === 0, JSON.stringify(fetchCallLog));

  resetFetchQueue();
  liveInput.value = "1";
  queueFetch(
    (url, method) => method === "GET" && url.includes("/settings/register-write/preflight") && url.includes("key=gps_heartbeat"),
    () => ({ status: 200, body: { ready: true, current_raw: 512, merged_raw: 516, sibling_bits_before: 512, reject_reason: null } })
  );
  currentConfirmResult = false;
  fakeClick(liveButton);
  await flushMicrotasks();
  check("submit calls GET preflight first", fetchCallLog.some((c) => c.method === "GET" && c.url.includes("/preflight")), JSON.stringify(fetchCallLog));
  check("confirm=false: no POST is issued", !fetchCallLog.some((c) => c.method === "POST"), JSON.stringify(fetchCallLog));
  check("button is re-enabled after a declined confirmation", liveButton.disabled === false);

  resetFetchQueue();
  queueFetch(
    (url, method) => method === "GET" && url.includes("/settings/register-write/preflight"),
    () => ({ status: 200, body: { ready: true, current_raw: 512, merged_raw: 516, sibling_bits_before: 512, reject_reason: null } })
  );
  let postCount = 0;
  let lastPostUrl = "";
  queueFetch(
    (url, method) => method === "POST" && url.includes("/settings/register-write"),
    (url) => { postCount += 1; lastPostUrl = url; return { status: 200, body: { ok: true, key: "gps_heartbeat", tx_id: 1, status: "pending" } }; }
  );
  currentConfirmResult = true;
  fakeClick(liveButton);
  await flushMicrotasks();
  check("confirm=true: exactly one POST is issued", postCount === 1, `postCount=${postCount}`);
  check("POST endpoint carries key/value/submit_policy=live",
    lastPostUrl.includes("key=gps_heartbeat") && lastPostUrl.includes("value=1") && lastPostUrl.includes("submit_policy=live"), lastPostUrl);
  check("submit is blocked (single-flight) while this key's transaction is pending", activeTransactionKeys.has("gps_heartbeat"));

  resetFetchQueue();
  fakeClick(liveButton);
  await flushMicrotasks();
  check("a second click while pending issues no additional fetch at all", fetchCallLog.length === 0, JSON.stringify(fetchCallLog));

  ingestPayload({
    id: "text_sensor-write_tx_snapshot", domain: "text_sensor",
    value: JSON.stringify([{ addr: liveEntry.address, tx_id: 1, status: 4, req: 1, rb: 1 }]),
    state: JSON.stringify([{ addr: liveEntry.address, tx_id: 1, status: 4, req: 1, rb: 1 }]),
  });
  await flushMicrotasks();
  check("after CONFIRMED SSE, the field's transaction is no longer active", !activeTransactionKeys.has("gps_heartbeat"));
  const liveMsg = liveRow.querySelector(".write-registry-status");
  check("status message is bound to the correct field id", liveMsg && liveMsg.id === "wrMsg_gps_heartbeat");
  check("submit button is re-enabled once the transaction reaches a terminal state", liveButton.disabled === false);

  // =========================================================================
  // C. Authorization-required
  // =========================================================================
  const authEntry = WRITE_REGISTRY.authorizationRequired[0];
  const authRow = rows.find((r) => r.dataset.writeRegistryKey === authEntry.key);
  check("authorization-required row is visible/present", !!authRow);
  const authInput = authRow.querySelector("input");
  check("authorization-required input is disabled", !!authInput && authInput.disabled === true);
  check("authorization-required row has no submit button", !authRow.querySelector(".write-registry-button"));
  const authNote = authRow.querySelector(".write-registry-note");
  check("authorization-required row shows a risk/safety explanation", !!authNote && authNote.textContent.length > 0, authNote && authNote.textContent);
  check("the safety-class note actually names the real class", authNote.textContent.includes(authEntry.writeSafetyClass), authNote.textContent);
  resetFetchQueue();
  fakeClick(authRow);
  fakeClick(authInput);
  await flushMicrotasks();
  check("no user event on an authorization-required row can trigger fetch/POST", fetchCallLog.length === 0, JSON.stringify(fetchCallLog));

  // =========================================================================
  // D. Blocked
  // =========================================================================
  const blockedRow = blockedRows[0];
  check("blocked row is visible/present", !!blockedRow);
  check("blocked row has no input at all", !blockedRow.querySelector("input"));
  check("blocked row has no button at all", !blockedRow.querySelector(".write-registry-button"));
  const blockedNote = blockedRow.querySelector(".write-registry-note");
  check("blocked row shows the real blocker reason", !!blockedNote && blockedNote.textContent.length > 0, blockedNote && blockedNote.textContent);
  resetFetchQueue();
  fakeClick(blockedRow);
  await flushMicrotasks();
  check("no user event on a blocked row can trigger fetch/POST", fetchCallLog.length === 0, JSON.stringify(fetchCallLog));

  // =========================================================================
  // E. Preflight content
  // =========================================================================
  resetFetchQueue();
  liveInput.value = "0";
  let preflightUrlSeen = "";
  queueFetch(
    (url, method) => method === "GET" && url.includes("/preflight"),
    (url) => {
      preflightUrlSeen = url;
      return {
        status: 200,
        body: {
          ready: true, current_raw: 516, merged_raw: 512, sibling_bits_before: 512, sibling_bits_expected_after: 512,
          preservation_mask: "0xFFFFFFFB", encoded_target_bits: "0x0000", reject_reason: null,
        },
      };
    }
  );
  queueFetch((url, method) => method === "POST", () => ({ status: 200, body: { ok: true, key: "gps_heartbeat", tx_id: 2, status: "pending" } }));
  currentConfirmResult = true;
  let capturedConfirmMessage = "";
  const realConfirm = currentConfirmResult;
  // Intercept confirm() at the window level to capture what message was shown, without touching submitRegisterWrite's own logic.
  hooks && (globalThis.__lastConfirmMessage = undefined);
  fakeClick(liveButton);
  await flushMicrotasks();
  check("preflight is a GET with key/value in the query string", preflightUrlSeen.includes("key=gps_heartbeat") && preflightUrlSeen.includes("value=0"), preflightUrlSeen);
  ingestPayload({
    id: "text_sensor-write_tx_snapshot", domain: "text_sensor",
    value: JSON.stringify([{ addr: liveEntry.address, tx_id: 2, status: 4, req: 0, rb: 0 }]),
    state: JSON.stringify([{ addr: liveEntry.address, tx_id: 2, status: 4, req: 0, rb: 0 }]),
  });
  await flushMicrotasks();

  // failed/not-ready/stale preflight must never allow a POST
  resetFetchQueue();
  liveInput.value = "1";
  queueFetch((url, method) => method === "GET" && url.includes("/preflight"),
    () => ({ status: 409, body: { ready: false, reject_reason: "stale" } }));
  fakeClick(liveButton);
  await flushMicrotasks();
  check("a not-ready/stale preflight blocks the POST entirely", !fetchCallLog.some((c) => c.method === "POST"), JSON.stringify(fetchCallLog));

  // credential-class fields: this registry currently has none, but the
  // production endpoint contract (RegisterWritePreflightHandler) already
  // suppresses raw for one if it ever exists -- documented here, not
  // fabricated, matching the structural test's own equivalent check.
  check("no credential-class entry exists in WRITE_REGISTRY today (documented, not assumed)",
    [...WRITE_REGISTRY.live, ...WRITE_REGISTRY.authorizationRequired].every((e) => e.writeSafetyClass !== "credential"));

  // =========================================================================
  // F. Transaction states
  // =========================================================================
  function snapshotFor(addr, txId, status, extra) {
    return JSON.stringify([{ addr, tx_id: txId, status, req: 1, rb: extra && extra.rb }]);
  }
  function publishSnapshot(addr, txId, status, extra) {
    ingestPayload({ id: "text_sensor-write_tx_snapshot", domain: "text_sensor", value: snapshotFor(addr, txId, status, extra), state: snapshotFor(addr, txId, status, extra) });
  }

  // MISMATCH
  resetFetchQueue();
  liveInput.value = "1";
  queueFetch((url, method) => method === "GET" && url.includes("/preflight"), () => ({ status: 200, body: { ready: true, current_raw: 512, merged_raw: 516, sibling_bits_before: 512, reject_reason: null } }));
  queueFetch((url, method) => method === "POST", () => ({ status: 200, body: { ok: true, key: "gps_heartbeat", tx_id: 3, status: "pending" } }));
  currentConfirmResult = true;
  fakeClick(liveButton);
  await flushMicrotasks();
  check("F: pending state disables the button", liveButton.disabled === true);
  publishSnapshot(liveEntry.address, 3, 5); // MISMATCH
  await flushMicrotasks();
  check("F: MISMATCH is a terminal state (button re-enabled)", liveButton.disabled === false);
  check("F: MISMATCH clears the active-transaction guard", !activeTransactionKeys.has("gps_heartbeat"));

  // TIMEOUT (no snapshot terminal ever arrives -- fake clock advances past the readback timeout)
  resetFetchQueue();
  liveInput.value = "1";
  queueFetch((url, method) => method === "GET" && url.includes("/preflight"), () => ({ status: 200, body: { ready: true, current_raw: 512, merged_raw: 516, sibling_bits_before: 512, reject_reason: null } }));
  queueFetch((url, method) => method === "POST", () => ({ status: 200, body: { ok: true, key: "gps_heartbeat", tx_id: 4, status: "pending" } }));
  fakeClick(liveButton);
  await flushMicrotasks();
  check("F: checking->pending transition happened (button disabled)", liveButton.disabled === true);
  advanceTime(7000); // default readbackTimeoutMs (6000) + margin, no snapshot ever published for tx_id 4
  await flushMicrotasks();
  check("F: an unresolved transaction times out and re-enables the button", liveButton.disabled === false);
  check("F: TIMEOUT clears the active-transaction guard", !activeTransactionKeys.has("gps_heartbeat"));

  // UNCERTAIN -> RECOVERED_CONFIRMED
  resetFetchQueue();
  liveInput.value = "1";
  queueFetch((url, method) => method === "GET" && url.includes("/preflight"), () => ({ status: 200, body: { ready: true, current_raw: 512, merged_raw: 516, sibling_bits_before: 512, reject_reason: null } }));
  queueFetch((url, method) => method === "POST", () => ({ status: 200, body: { ok: true, key: "gps_heartbeat", tx_id: 5, status: "pending" } }));
  fakeClick(liveButton);
  await flushMicrotasks();
  publishSnapshot(liveEntry.address, 5, 6); // WRITE_UNCERTAIN
  await flushMicrotasks();
  check("F: WRITE_UNCERTAIN is NOT terminal (button still disabled, still pending)", liveButton.disabled === true && activeTransactionKeys.has("gps_heartbeat"));
  publishSnapshot(liveEntry.address, 5, 10); // RECOVERED_CONFIRMED
  await flushMicrotasks();
  check("F: RECOVERED_CONFIRMED(10) is terminal (button re-enabled)", liveButton.disabled === false);
  check("F: RECOVERED_CONFIRMED clears the active-transaction guard", !activeTransactionKeys.has("gps_heartbeat"));

  // duplicate click during pending never issues a second POST (re-verify with a fresh cycle)
  resetFetchQueue();
  liveInput.value = "1";
  queueFetch((url, method) => method === "GET" && url.includes("/preflight"), () => ({ status: 200, body: { ready: true, current_raw: 512, merged_raw: 516, sibling_bits_before: 512, reject_reason: null } }));
  let postCount2 = 0;
  queueFetch((url, method) => method === "POST", () => { postCount2 += 1; return { status: 200, body: { ok: true, key: "gps_heartbeat", tx_id: 6, status: "pending" } }; });
  fakeClick(liveButton);
  await flushMicrotasks();
  fakeClick(liveButton); // duplicate while pending
  await flushMicrotasks();
  check("F: duplicate click during pending never creates a second POST", postCount2 === 1, `postCount2=${postCount2}`);
  publishSnapshot(liveEntry.address, 6, 4);
  await flushMicrotasks();

  // =========================================================================
  // G. SSE/draft stability
  // =========================================================================
  const otherLiveEntry = WRITE_REGISTRY.live.find((e) => e.key === "lcd_always_on");
  const otherLiveRow = rows.find((r) => r.dataset.writeRegistryKey === "lcd_always_on");
  const otherLiveInput = otherLiveRow.querySelector(".write-registry-input");
  otherLiveInput.value = "1";
  otherLiveInput.focus();
  otherLiveInput.setSelectionRange(0, 1);
  // A live SSE update for an UNRELATED field must never touch this draft.
  ingestPayload({ id: "text_sensor-write_tx_snapshot", domain: "text_sensor", value: "[]", state: "[]" });
  await flushMicrotasks();
  check("G: an unrelated SSE update does not erase a draft value", otherLiveInput.value === "1");
  check("G: an unrelated SSE update does not steal focus", activeElement === otherLiveInput);
  check("G: caret/selection survives an unrelated SSE update", otherLiveInput.selectionStart === 0 && otherLiveInput.selectionEnd === 1);

  const rowCountBeforeRerender = writeRegistryList.querySelectorAll(".write-registry-row").length;
  renderWriteRegistry(); // idempotent re-invocation (e.g. a redundant tab switch)
  check("G: a redundant renderWriteRegistry() call creates no duplicate rows", writeRegistryList.querySelectorAll(".write-registry-row").length === rowCountBeforeRerender);

  // =========================================================================
  // Language switch (EN -> UK -> EN), draft/focus/selection/pending survival
  // =========================================================================
  const groupHeaderTextsEn = writeRegistryList.querySelectorAll(".write-registry-group-header").map((h) => h.textContent);
  const liveButtonTextEn = liveButton.textContent;
  const authNoteTextEn = authNote.textContent;
  const blockedNoteTextEn = blockedNote.textContent;

  // Arm a draft + focus + selection + an in-flight pending transaction on
  // a THIRD, distinct live field before switching languages.
  const thirdEntry = WRITE_REGISTRY.live.find((e) => e.key === "smart_sleep_enabled");
  const thirdRow = rows.find((r) => r.dataset.writeRegistryKey === "smart_sleep_enabled");
  const thirdInput = thirdRow.querySelector(".write-registry-input");
  const thirdButton = thirdRow.querySelector(".write-registry-button");
  thirdInput.value = "1";
  thirdInput.focus();
  thirdInput.setSelectionRange(0, 1);
  resetFetchQueue();
  queueFetch((url, method) => method === "GET" && url.includes("/preflight"), () => ({ status: 200, body: { ready: true, current_raw: 0, merged_raw: 64, sibling_bits_before: 0, reject_reason: null } }));
  queueFetch((url, method) => method === "POST", () => ({ status: 200, body: { ok: true, key: "smart_sleep_enabled", tx_id: 7, status: "pending" } }));
  fakeClick(thirdButton);
  await flushMicrotasks();
  check("pre-switch: the third field's transaction is pending", activeTransactionKeys.has("smart_sleep_enabled") && thirdButton.disabled === true);

  setLanguage("uk");
  await flushMicrotasks();

  const groupHeaderTextsUk = writeRegistryList.querySelectorAll(".write-registry-group-header").map((h) => h.textContent);
  check("EN->UK: group header text actually changes", groupHeaderTextsUk.every((t, i) => t !== groupHeaderTextsEn[i]), `en=${JSON.stringify(groupHeaderTextsEn)} uk=${JSON.stringify(groupHeaderTextsUk)}`);
  check("EN->UK: the live button's label re-localizes", liveButton.textContent !== liveButtonTextEn, liveButton.textContent);
  check("EN->UK: the authorization-required note re-localizes", authNote.textContent !== authNoteTextEn, authNote.textContent);
  // writeRegistry.blockedNote's own template is literally "{reason}" in
  // BOTH languages (jk_bms.js's i18n table) -- the blocked reason is a raw
  // machine code (e.g. "RANGE_NOT_ESTABLISHED" from stage4_rw_inventory.
  // json), never translated prose, so it is CORRECT for this text to stay
  // identical across a language switch. What must still hold: relocalize
  // never corrupts/empties it, and it stays exactly the real reason code.
  check("EN->UK: the blocked note is untouched (raw reason code, not localized prose by design) and still correct",
    blockedNote.textContent === blockedNoteTextEn && blockedNote.textContent.length > 0, blockedNote.textContent);
  check("EN->UK: row count is still exactly 5/37/37", (() => {
    const r2 = writeRegistryList.querySelectorAll(".write-registry-row");
    return r2.filter((x) => x.dataset.writeRegistryGroup === "live").length === 5 &&
      r2.filter((x) => x.dataset.writeRegistryGroup === "authorizationRequired").length === 37 &&
      r2.filter((x) => x.dataset.writeRegistryGroup === "blocked").length === 37;
  })());
  check("EN->UK: no duplicate rows were created", writeRegistryList.querySelectorAll(".write-registry-row").length === 79);
  check("EN->UK: dataset keys stay language-neutral (still real canonical keys)",
    liveRow.dataset.writeRegistryKey === "gps_heartbeat" && authRow.dataset.writeRegistryKey === authEntry.key);
  check("EN->UK: draft value survives the language switch", thirdInput.value === "1");
  check("EN->UK: focus survives the language switch", activeElement === thirdInput);
  check("EN->UK: caret/selection survives the language switch", thirdInput.selectionStart === 0 && thirdInput.selectionEnd === 1);
  check("EN->UK: the pending transaction is NOT reset by the language switch",
    activeTransactionKeys.has("smart_sleep_enabled") && thirdButton.disabled === true);

  // Resolve the still-pending transaction now, post-switch, to prove the
  // SAME transaction (not a fresh one) reaches its terminal state correctly.
  publishSnapshot(thirdEntry.address, 7, 4);
  await flushMicrotasks();
  check("EN->UK: the pre-switch transaction still resolves normally after a language switch", !activeTransactionKeys.has("smart_sleep_enabled") && thirdButton.disabled === false);

  setLanguage("en");
  await flushMicrotasks();
  const groupHeaderTextsEn2 = writeRegistryList.querySelectorAll(".write-registry-group-header").map((h) => h.textContent);
  check("UK->EN: group headers return to the original English text", JSON.stringify(groupHeaderTextsEn2) === JSON.stringify(groupHeaderTextsEn));
  check("UK->EN: row count is still exactly 79, no duplicates", writeRegistryList.querySelectorAll(".write-registry-row").length === 79);

  console.log(`\nwrite registry UI executable DOM test summary: ${checks - failures}/${checks} passed`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
