#!/usr/bin/env node
"use strict";

// Regression test for the Діагностика scroll-reset defect (hardware retest,
// post-HEAD 1926c1c). Real device symptom: scrolled down on Діагностика,
// the page repeatedly jumped back to the top on its own.
//
// Root cause, confirmed by reading the real render path (not assumed):
// renderDiagnosticSoftwareVariables() -- the "Значення параметрів BMS"
// list on Діагностика -- called list.replaceChildren(fragment)
// unconditionally on every invocation, AND never registered its own value
// nodes into diagnosticReadoutRows, so recordDiagnosticReadout()'s
// in-place fast path could never find them. Every single update to ANY
// software-variable value (several tick at least once a second --
// current_sample_age, bms_last_update_age, etc.) therefore fell through
// to a full rAF-scheduled renderDiagnosticPanels() rebuild, wiping and
// recreating the entire visible list roughly once a second. Its sibling,
// renderDiagnosticReadouts() (Налаштування's register list), already had
// both fixes -- this is why the defect reproduced only on Діагностика.
//
// Fix verified here, executing the REAL render/ingest closures (not a
// reimplementation) via jk_bms.js's existing opt-in test hook:
//   1. A row's DOM node identity is stable across two renders that only
//      change its value (proves no replaceChildren wipe in the steady
//      state -- the actual mechanism that was yanking the page to the
//      top, not just a symptom of it).
//   2. After a row is first rendered, feeding another update through the
//      REAL ingestPayload() takes the in-place fast path and does NOT
//      invoke renderDiagnosticSoftwareVariables() again at all.
//   3. Scroll position is preserved around a genuinely new entity's first
//      insertion (the one remaining case that does touch the DOM).
//   4. No <input> or other focusable control exists anywhere in this
//      list (confirmed structurally): there is no focus/draft/selection
//      state this list could ever lose.
//   5. Renders under a language switch (existing refreshAllDynamicText()
//      path) update label text in place too, not just value text.
//
// Explicit limitation: this project has no jsdom/browser-DOM dependency
// (CLAUDE.md's no-npm-dependencies policy), so this test drives jk_bms.js
// against a small, purpose-built DOM-node shim (real parent/child/sibling
// linked-list semantics for appendChild/insertBefore/remove/firstChild/
// nextSibling -- enough to prove node-identity and ordering behavior
// correctly) rather than a real browser layout engine. It cannot observe
// an actual visible scroll jump the way a live device/browser retest can
// -- it proves the DOM-mutation behavior that CAUSED the jump is gone,
// not the pixel-level rendering itself. requestAnimationFrame is stubbed
// to run its callback synchronously (deterministic host testing), not on
// the browser's real per-frame schedule.

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

// --- Minimal, real (not mocked-return-value) DOM node shim ------------------
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
  get nextSibling() {
    if (!this.parentNode) return null;
    const idx = this.parentNode.childNodes.indexOf(this);
    return this.parentNode.childNodes[idx + 1] || null;
  }
  set className(v) { this._className = v; }
  get className() { return this._className || ""; }
  set textContent(v) { this._text = String(v); this.childNodes.forEach((c) => { c.parentNode = null; }); this.childNodes = []; }
  get textContent() { return this._text; }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; }
  appendChild(child) {
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
  // Minimal support for the one real call site this test exercises
  // (renderDiagnosticReadouts()'s `row.querySelector("input, .register-toggle")`):
  // comma-separated simple selectors, each either a bare tag name or a
  // single ".class", matched via recursive descendant search.
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
  let rafCallCount = 0;
  const window = {
    __JK_BMS_TEST_HOOKS__: {},
    location: { href: "http://jk-bms.local/" },
    addEventListener() {},
    matchMedia() { return { matches: false }; },
    cancelAnimationFrame() {},
    // Deferred via setTimeout(0), not a real per-frame schedule -- see
    // module comment's stated limitation. Must NOT run synchronously: the
    // real code path assigns `diagnosticReadoutRebuild = requestAnimationFrame(cb)`
    // AFTER calling requestAnimationFrame, and cb() itself resets that same
    // variable to 0 at its very start -- a synchronous stub would invert
    // that ordering and leave the guard permanently (wrongly) non-zero.
    requestAnimationFrame(cb) { rafCallCount += 1; setTimeout(cb, 0); return rafCallCount; },
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
  return { hooks: window.__JK_BMS_TEST_HOOKS__, document, elementsById, getRafCallCount: () => rafCallCount };
}

function flush() { return new Promise((resolve) => setTimeout(resolve, 0)); }

async function main() {
  const { hooks, document: doc, elementsById } = loadRealClosures();
  const { ingestPayload, renderDiagnosticSoftwareVariables, diagnosticReadoutRows } = hooks;

  check("real jk_bms.js closures loaded via the test hook (not reimplemented)",
    typeof ingestPayload === "function" && typeof renderDiagnosticSoftwareVariables === "function");

  // --- 1/2. First reading of two non-register (software) entities, real SSE
  // payload shape, through the REAL ingestPayload() -- each is a genuinely
  // new wireId, so each schedules (and this awaits) its own real rAF-deferred
  // rebuild, exactly like a real browser tick. ------------------------------
  ingestPayload({ id: "sensor/current sample age", domain: "sensor", name: "current sample age", value: 7.2, state: "7 s", uom: "s" });
  await flush();
  ingestPayload({ id: "sensor/bms last update age", domain: "sensor", name: "bms last update age", value: 0.5, state: "1 s", uom: "s" });
  await flush();

  const list = elementsById.diagSoftwareVarList;
  check("both entries produced exactly one row each in the real list (no duplicates)",
    list.childNodes.length === 2, `rows=${list.childNodes.length}`);

  const rowNodesBefore = list.childNodes.slice();
  const valueNodesBefore = rowNodesBefore.map((row) => row.childNodes[1]);

  // A structural guarantee, not an incidental observation: no <input> or
  // button control anywhere in this list -- confirmed directly against the
  // real built rows, not assumed from the source comment alone.
  check("no focusable/editable control exists in any rendered row (plain label+value only)",
    rowNodesBefore.every((row) => row.childNodes.length === 2 && row.childNodes.every((n) => n.tagName === "span" || n.tagName === "b")));

  // --- Steady-state update: same two entities, new values, via the REAL
  // ingestPayload() -- must NOT rebuild the list (in-place fast path, no
  // rAF scheduled at all -- nothing to flush/await here). -------------------
  ingestPayload({ id: "sensor/current sample age", domain: "sensor", name: "current sample age", value: 8.2, state: "8 s", uom: "s" });

  check("row count unchanged after a steady-state value update", list.childNodes.length === 2, `rows=${list.childNodes.length}`);
  const rowNodesAfter = list.childNodes.slice();
  check("row DOM node identity is stable across the update (no replaceChildren wipe -- the actual fix)",
    rowNodesBefore[0] === rowNodesAfter[0] && rowNodesBefore[1] === rowNodesAfter[1]);
  // diagnosticReadoutValue() reconstructs numeric text from entry.value (raw)
  // + its canonical unit, not from the payload's own `state` string verbatim
  // -- checking for the raw number substring rather than a hand-guessed
  // exact unit string keeps this assertion honest about what it's proving.
  check("the updated value's text actually changed on the SAME node (not a silently-stale display)",
    valueNodesBefore[0].textContent.includes("8.2") || valueNodesBefore[1].textContent.includes("8.2"));

  // --- The steady-state update must have taken the in-place fast path, not
  // gone through another full renderDiagnosticSoftwareVariables() call ------
  let rebuildCount = 0;
  const originalReplaceChildren = list.replaceChildren.bind(list);
  list.replaceChildren = (...args) => { rebuildCount += 1; return originalReplaceChildren(...args); };
  ingestPayload({ id: "sensor/bms last update age", domain: "sensor", name: "bms last update age", value: 0.8, state: "1 s", uom: "s" });
  await flush();
  check("a steady-state update to an already-rendered entry never calls list.replaceChildren() at all",
    rebuildCount === 0, `replaceChildren calls=${rebuildCount}`);
  list.replaceChildren = originalReplaceChildren;

  // --- 3. Scroll position preserved around a genuinely NEW entity's first
  // insertion (the one remaining case that does mutate the list) ----------
  doc.scrollingElement.scrollTop = 4321;
  ingestPayload({ id: "text_sensor/bms display name", domain: "text_sensor", name: "bms display name", value: "Pack A", state: "Pack A" });
  await flush();
  check("a brand-new entity's first insertion still preserves the page scroll position",
    doc.scrollingElement.scrollTop === 4321, `scrollTop=${doc.scrollingElement.scrollTop}`);
  check("the new entity's row was actually inserted (list grew)", list.childNodes.length === 3, `rows=${list.childNodes.length}`);

  // --- 5. Language-switch-style direct call still updates label text in
  // place on existing rows (refreshAllDynamicText()'s own call pattern) ---
  renderDiagnosticSoftwareVariables();
  check("a direct re-render call (language switch path) does not duplicate rows",
    list.childNodes.length === 3, `rows=${list.childNodes.length}`);
  check("a direct re-render call preserves row identity too",
    list.childNodes.includes(rowNodesAfter[0]) && list.childNodes.includes(rowNodesAfter[1]));

  // --- Item 2: confirm Налаштування's register list (configRegisterList,
  // renderDiagnosticReadouts()) is NOT affected -- it already had both the
  // scroll-preservation and diagnosticReadoutRows fast-path registration
  // before this fix, and this fix must not have regressed it. Verified
  // empirically here (same real harness), not just re-asserted from reading
  // the source comment. ------------------------------------------------
  const regList = elementsById.configRegisterList;
  ingestPayload({ id: "sensor/battery capacity", domain: "sensor", name: "battery capacity", value: 280, state: "280 Ah", uom: "Ah" });
  await flush();
  // configRegisterList's own row set includes placeholder rows for
  // not-yet-reporting OPTIONAL_REGISTER_ROWS entries independent of this
  // fix, so an exact "+1" row-count delta isn't a meaningful assertion
  // here (that complexity belongs to renderDiagnosticReadouts(), untouched
  // by this fix) -- what actually matters for "no regression" is that the
  // shared fast-path registry picked it up, proven directly below.
  check("a genuinely new REGISTER entity (Налаштування) is registered into the shared fast-path map",
    diagnosticReadoutRows.has("sensor/battery capacity"));
  const regRowsAfterFirst = regList.childNodes.slice();
  let regRebuildCount = 0;
  const originalRegReplaceChildren = regList.replaceChildren.bind(regList);
  regList.replaceChildren = (...args) => { regRebuildCount += 1; return originalRegReplaceChildren(...args); };
  ingestPayload({ id: "sensor/battery capacity", domain: "sensor", name: "battery capacity", value: 281, state: "281 Ah", uom: "Ah" });
  check("Налаштування: a steady-state update to an already-rendered register entry never calls configRegisterList.replaceChildren()",
    regRebuildCount === 0, `replaceChildren calls=${regRebuildCount}`);
  regList.replaceChildren = originalRegReplaceChildren;
  check("Налаштування: row DOM node identity stable across that update (no regression from this fix)",
    regList.childNodes.length === regRowsAfterFirst.length &&
    regRowsAfterFirst.every((node, i) => regList.childNodes[i] === node));

  // --- control_override_reason classification (IMPLEMENTATION_DRIFT_REVIEW.md
  // item 2.1). A registered, mock-only text_sensor that was missing from
  // protocol/non_register_entities.canonical.json, so isBmsRegisterEntry()
  // treated it as a BMS register and it rendered in Налаштування's register
  // list instead of Діагностика's software-variable list. The fix must
  // flow from the canonical non-register source, not a second list. -------
  const { PROTOCOL_CATALOG, entityByWireId, diagSoftwareVarRows } = hooks;
  const overrideWireId = "text_sensor/control override reason";
  const owningList = (node) => { let n = node; while (n && n !== regList && n !== list) n = n.parentNode; return n; };
  check("control_override_reason is routed by the real registerEntity() map",
    entityByWireId.get(overrideWireId) === "control_override_reason");
  check("control_override_reason is in the generated canonical non-register key set",
    PROTOCOL_CATALOG.nonRegisterKeys.includes("control_override_reason"));
  ingestPayload({ id: overrideWireId, domain: "text_sensor", name: "control override reason",
    value: "active_alarm_protection_trip", state: "active_alarm_protection_trip" });
  await flush();
  const overrideValueNode = diagnosticReadoutRows.get(overrideWireId);
  check("a received control_override_reason payload renders in Діагностика's software-variable list",
    !!overrideValueNode && owningList(overrideValueNode) === list && diagSoftwareVarRows.has(overrideWireId));
  // (This shim's querySelectorAll() always returns [] -- ownership is proven
  // by walking the value node's real parent chain instead.)
  check("control_override_reason is NOT rendered in Налаштування's BMS register list",
    !!overrideValueNode && owningList(overrideValueNode) !== regList);
  const overrideRow = overrideValueNode && overrideValueNode.parentNode;
  check("its row is read-only: no input/select/button, only label + value",
    !!overrideRow && overrideRow.querySelector("input, select, button, .register-toggle") === null &&
    overrideRow.childNodes.length === 2 && overrideRow.childNodes.every((n) => n.tagName === "span" || n.tagName === "b"));
  check("no write path: no set_ endpoint route, no Stage 4 registry entry",
    !Array.from(entityByWireId.values()).includes("set_control_override_reason") &&
    !hooks.WRITE_REGISTRY.live.concat(hooks.WRITE_REGISTRY.authorizationRequired || [], hooks.WRITE_REGISTRY.blocked || [])
      .some((e) => e.key === "control_override_reason"));
  // Authoritative register field keys (fieldMeta alone can't tell: derived
  // non-register entities inherit a readAddress via derived_from_register_key).
  const registerKeys = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "registers.canonical.json"), "utf8"))
    .registers.flatMap((r) => r.fields.map((f) => f.key));
  check("no real BMS register field is hidden: canonical non-register keys and register-backed keys are disjoint",
    registerKeys.length > 0 && !registerKeys.some((k) => PROTOCOL_CATALOG.nonRegisterKeys.includes(k)), `registerKeys=${registerKeys.length}`);
  check("a real BMS register (battery capacity) still renders in Налаштування's register list",
    owningList(diagnosticReadoutRows.get("sensor/battery capacity")) === regList);

  // --- Stage 1 (RS485 unified pipeline plan): production runtime
  // diagnostics and protocol infrastructure classified in the canonical
  // non-register source. Real ingest -> rAF -> render path. -----------------
  const nonRegisterCanon = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "non_register_entities.canonical.json"), "utf8")).entities;
  const renderedIn = (wireId) => owningList(diagnosticReadoutRows.get(wireId));
  const scoped = [
    ["sensor/display cell count", "sensor", "display cell count", 16, "16"],
    ["text_sensor/cell connection wire resistance capability", "text_sensor", "cell connection wire resistance capability", "SUPPORTED", "SUPPORTED"],
    ["sensor/cell connection wire resistance callback count", "sensor", "cell connection wire resistance callback count", 3, "3"],
  ];
  for (const [wireId, domain, name, value, stateText] of scoped) {
    ingestPayload({ id: wireId, domain, name, value, state: stateText });
    await flush();
    const key = entityByWireId.get(wireId);
    check(`${key}: canonical non-register key renders in Діагностика's software list, not the BMS register list`,
      PROTOCOL_CATALOG.nonRegisterKeys.includes(key) && renderedIn(wireId) === list,
      `rendered in: ${renderedIn(wireId) === list ? "software list" : renderedIn(wireId) === regList ? "BMS register list" : "neither"}`);
  }

  // Protocol infrastructure (derived from the canonical category, not a
  // hand list): consumed by the pipeline, rendered in neither list.
  const infraKeys = nonRegisterCanon.filter((e) => e.category === "protocol_infrastructure").map((e) => e.key);
  check("the canonical source models at least one protocol-infrastructure key", infraKeys.length > 0, JSON.stringify(infraKeys));
  // (Row registries, not childNodes counts: the register list nests rows
  // inside group containers.)
  for (const key of infraKeys) {
    const wireId = [...entityByWireId.entries()].find(([w, k]) => k === key && w.includes("/"))[0];
    ingestPayload({ id: wireId, value: `${0x1000}:1`, state: `${0x1000}:1` });
    await flush();
    check(`infrastructure key ${key} renders in neither the register list nor the Diagnostics value list`,
      !diagnosticReadoutRows.has(wireId) && !diagSoftwareVarRows.has(wireId), wireId);
  }

  // read_plan_success is still the physical-read freshness marker.
  const { setBrowserLink, acceptReadBlockSnapshot, settingsFieldFreshness, activeCellCount } = hooks;
  ingestPayload({ id: "text_sensor/bms health", value: "LIVE", state: "LIVE" });
  setBrowserLink("connected");
  acceptReadBlockSnapshot({ blocks: [[0x1000, 10000000, 5]] });
  ingestPayload({ id: "smart_sleep", value: 3.321, state: "3.321 V" });
  const staleBefore = settingsFieldFreshness("smart_sleep").kind;
  ingestPayload({ id: "text_sensor/read plan success", value: `${0x1000}:6`, state: `${0x1000}:6` });
  check("read_plan_success still refreshes its physical block (stale -> fresh)",
    staleBefore === "stale" && settingsFieldFreshness("smart_sleep").kind === "fresh", `${staleBefore} -> ${settingsFieldFreshness("smart_sleep").kind}`);

  // display_cell_count still drives active-cell visibility.
  const visible = [1, 4, 8, 16].map((n) => {
    ingestPayload({ id: "sensor/display cell count", domain: "sensor", name: "display cell count", value: n, state: String(n) });
    return activeCellCount();
  });
  check("display_cell_count still controls 1S/4S/8S/16S active-cell visibility", JSON.stringify(visible) === "[1,4,8,16]", JSON.stringify(visible));

  // No writable surface for any canonical non-register or infrastructure key.
  const writeKeys = new Set(["live", "authorizationRequired", "blocked"].flatMap((g) => (hooks.WRITE_REGISTRY[g] || []).map((e) => e.key)));
  const settingsKeys = new Set(hooks.SETTINGS_CATALOG_ROWS.map((r) => r.canonicalKey).filter(Boolean));
  const routedKeys = new Set(entityByWireId.values());
  const writable = nonRegisterCanon.map((e) => e.key).filter((k) => writeKeys.has(k) || settingsKeys.has(k) || routedKeys.has(`set_${k}`));
  check("no canonical non-register/infrastructure key has a write-registry entry, Settings row or set_ route", writable.length === 0, JSON.stringify(writable));
  const scopedRows = scoped.map(([wireId]) => diagnosticReadoutRows.get(wireId).parentNode);
  check("every rendered scoped diagnostic row is read-only (label + value, no input/select/button)",
    scopedRows.every((row) => row.querySelector("input, select, button, .register-toggle") === null && row.childNodes.length === 2));

  // --- Security remediation (2026-09-25): the rendered Diagnostics lists never
  // show a credential value, from the routed status entity or the retired
  // secret publisher. Artificial sentinel only; failures name the channel.
  const SENTINEL = "ARTIFICIAL-SENTINEL-PASSCODE-0000";
  ingestPayload({ id: "text_sensor/setup passcode status", domain: "text_sensor", value: SENTINEL, state: SENTINEL });
  ingestPayload({ id: "text_sensor/setup passcode readback", domain: "text_sensor", value: SENTINEL, state: SENTINEL });
  await flush();
  const credValueNode = diagnosticReadoutRows.get("text_sensor/setup passcode status");
  const credRow = credValueNode && credValueNode.parentNode;
  const rowText = (row) => (row ? row.childNodes.map((n) => `${n.textContent} ${n.title || ""}`).join(" ") : "");
  check("credential status renders one Diagnostics row, showing the hidden marker",
    !!credRow && /hidden/i.test(rowText(credRow)) && !rowText(credRow).includes(SENTINEL), rowText(credRow).includes(SENTINEL) ? "channel: Diagnostics row" : "");
  check("the retired secret publisher renders no Diagnostics row at all",
    !diagnosticReadoutRows.has("text_sensor/setup passcode readback") && !diagSoftwareVarRows.has("text_sensor/setup passcode readback"));
  // Walk every descendant (the register list nests rows inside group
  // containers; this shim's textContent does not recurse).
  const deepText = (node) => `${node._text || ""} ${node.title || ""} ` + node.childNodes.map(deepText).join(" ");
  const allRendered = deepText(regList) + deepText(list);
  check("no rendered Diagnostics row (register list or software list) contains a credential value", !allRendered.includes(SENTINEL),
    allRendered.includes(SENTINEL) ? "channel: Diagnostics lists" : "");

  console.log("\nNOTE: this test drives jk_bms.js against a small purpose-built DOM-node shim (real");
  console.log("parent/child/sibling semantics), not a full browser layout engine -- it proves the DOM-");
  console.log("mutation behavior that caused the scroll jump is gone, not the pixel-level rendering");
  console.log("itself. requestAnimationFrame is deferred via setTimeout(0), not the browser's real schedule.");
  console.log(`\n${checks} checks run, ${failures} failed.`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
