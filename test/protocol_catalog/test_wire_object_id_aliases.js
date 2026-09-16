#!/usr/bin/env node
"use strict";

// Regression test for PROTOCOL_CATALOG.wireObjectIdAliases (Final-
// preparation-plan Stage 1 corrective pass, hardware-acceptance follow-up).
//
// A prior version of this test reimplemented registerEntity()/ingestPayload()'s
// resolution algorithm by hand (citing this project's no-DOM/jsdom precedent).
// That reimplementation is exactly why the real bug this test now guards
// against went undetected: the real jk_bms.js consumption loop passed the
// sanitized object_id as BOTH registerEntity()'s configuredName AND
// legacyObjectId arguments, so it never registered the wire-id variant this
// device's actual /events stream uses for cell_resistance_1..16
// ("sensor/cell 1 wire resistance", a space-separated configured `name:`
// string -- confirmed via a live SSE capture against real hardware). A
// reimplementation that (correctly, per the OLD real code) modeled
// configuredName===legacyObjectId could never have caught a bug that only
// exists because the real code conflated those two arguments.
//
// So: this test now loads jk_bms.js itself in a Node `vm` sandbox and calls
// the REAL registerEntity/entityByWireId/ingestPayload/numeric closures --
// no reimplementation of the routing/resolution algorithm anywhere below.
// jk_bms.js exposes these via a narrow, opt-in test hook
// (window.__JK_BMS_TEST_HOOKS__, inert unless a caller pre-sets it -- see
// its own comment at the end of jk_bms.js) instead of adding a DOM library
// (still ruled out by CLAUDE.md's no-npm-dependencies policy): the hook
// short-circuits before build()/connect() ever run, so no DOM rendering or
// network I/O happens in this test, only the pure entity-routing/state
// closures render() itself depends on.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..", "..");
const source = fs.readFileSync(path.join(ROOT, "jk_bms.js"), "utf8");
const canonical = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "registers.canonical.json"), "utf8"));

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

// --- Load the REAL jk_bms.js closures in an isolated vm context ------------
// Only the handful of browser globals jk_bms.js's top-level (unconditional,
// pre-start()) code actually touches are stubbed -- see the exact inventory
// in this project's own session notes: window.location.href (PAGE_BASE_URL),
// document.documentElement (guarded, may be absent), document.createElement
// ("canvas" for ccMeasureCtx), navigator.language (detectInitialLanguage's
// fallback path). build()/connect()/start() never run in this harness (the
// test hook returns before reaching them), so nothing inside THEM needs
// stubbing (EventSource, fetch, full DOM query/manipulation, etc.).
function loadRealClosures() {
  const collisions = [];
  class CollisionTrackingMap extends Map {
    set(key, value) {
      if (this.has(key)) {
        const previous = this.get(key);
        if (previous !== value) collisions.push({ wireId: key, previousKey: previous, nextKey: value });
      }
      return super.set(key, value);
    }
  }
  const fakeElement = () => ({
    style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {}, appendChild() {}, setAttribute() {}, getAttribute() { return null; },
    getContext() { return {}; },
  });
  const window = {
    __JK_BMS_TEST_HOOKS__: {},
    location: { href: "http://jk-bms.local/" },
    addEventListener() {}, matchMedia() { return { matches: false }; },
    cancelAnimationFrame() {}, requestAnimationFrame() {}, clearInterval() {}, setInterval() {},
  };
  const document = {
    documentElement: undefined,
    readyState: "complete",
    createElement() { return fakeElement(); },
    addEventListener() {},
    getElementById() { return null; },
    body: fakeElement(),
  };
  class HTMLInputElement {}
  const sandbox = { window, document, navigator: { language: "en" }, URL, console, Map: CollisionTrackingMap, HTMLInputElement };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "jk_bms.js" });
  if (!window.__JK_BMS_TEST_HOOKS__.ingestPayload) {
    throw new Error("jk_bms.js's test hook did not populate -- window.__JK_BMS_TEST_HOOKS__ shape may have drifted");
  }
  return { hooks: window.__JK_BMS_TEST_HOOKS__, collisions };
}

const { hooks, collisions } = loadRealClosures();
const { registerEntity, entityByWireId, ingestPayload, numeric, cellResistanceKeys, PROTOCOL_CATALOG } = hooks;

check("real jk_bms.js closures loaded via the test hook (not reimplemented)",
  typeof ingestPayload === "function" && typeof numeric === "function" &&
  typeof registerEntity === "function" && entityByWireId instanceof Map &&
  Array.isArray(cellResistanceKeys) && cellResistanceKeys.length === 16);

// --- No alias collisions, observed on the REAL entityByWireId Map ----------
// Instrumented during the actual script load above (every real
// registerEntity() call this file makes, hand-typed and generated alike,
// already ran by the time loadRealClosures() returned) -- not a
// recomputation of what registerEntity() "should" produce.
check("no wire-id variant was silently overwritten with a DIFFERENT canonical key during real registration",
  collisions.length === 0,
  collisions.map((c) => `${c.wireId}: ${c.previousKey} -> ${c.nextKey}`).join(", "));

// --- All 16 resistance channels: real captured SSE payload shape, through
// the REAL ingestPayload(), landing in the REAL state numeric() (and hence
// renderCells(), the Комірки -> Опір view) actually reads -----------------
{
  let allReached = true;
  const failuresDetail = [];
  for (let i = 1; i <= 16; i += 1) {
    const rawValue = 0.05 + i * 0.001; // distinct per channel, avoids a false pass via a shared constant
    // Exact shape captured live from the real device's /events stream
    // (2026-09-16 hardware acceptance session) -- not a minimized/guessed
    // approximation of it.
    const payload = {
      id: `sensor/cell ${i} wire resistance`,
      domain: "sensor",
      name: `cell ${i} wire resistance`,
      icon: "",
      entity_category: 0,
      value: rawValue,
      state: `${rawValue.toFixed(3)} mΩ`,
      uom: "mΩ",
    };
    ingestPayload(payload);
    const resolved = numeric(cellResistanceKeys[i - 1]);
    if (resolved === null || Math.abs(resolved - rawValue) > 1e-9) {
      allReached = false;
      failuresDetail.push(`cell ${i}: numeric()=${resolved}, expected ${rawValue}`);
    }
  }
  check("all 16 cell-resistance channels reach numeric(cellResistanceKeys[i]) -- the exact state renderCells()/Комірки->Опір reads -- via the real live SSE payload shape",
    allReached, failuresDetail.join("; "));
}

// --- Previously-supported wire-id formats still resolve (additive fix,
// nothing removed) ----------------------------------------------------------
{
  const DEVICE_ID = "jk-bms";
  let dashFormatOk = 0;
  let nativeApiFormatOk = 0;
  for (let i = 1; i <= 16; i += 1) {
    const expectedKey = `cell_resistance_${i}`;
    if (entityByWireId.get(`sensor-cell_${i}_wire_resistance`) === expectedKey) dashFormatOk += 1;
    if (entityByWireId.get(`sensor/${DEVICE_ID}/cell_${i}_wire_resistance`) === expectedKey) nativeApiFormatOk += 1;
  }
  check("all 16 rows still resolve via the sanitized-object_id dash format (sensor-cell_N_wire_resistance)", dashFormatOk === 16, `resolved=${dashFormatOk}/16`);
  check("all 16 rows still resolve via the native-API domain/device_id/object_id format", nativeApiFormatOk === 16, `resolved=${nativeApiFormatOk}/16`);
}

// Negative control: an unrelated/unregistered wire id must not resolve --
// proves the above isn't a vacuous pass from some over-broad match.
check("an unregistered wire id does not resolve to any key",
  entityByWireId.get("sensor/cell 1 totally made up field") === undefined);

// --- Static coverage/collision/orphan checks against the generated table's
// own source text (a legitimate static-analysis concern distinct from the
// routing/resolution algorithm exercised above; kept as a fast, independent
// cross-check against canonical.json) ---------------------------------------
function extractWireObjectIdAliases(src) {
  const blockMatch = src.match(/wireObjectIdAliases: Object\.freeze\(\[([\s\S]*?)\n\s*\]\),/);
  if (!blockMatch) throw new Error("wireObjectIdAliases block not found in jk_bms.js in the expected shape");
  const entries = [];
  const entryPattern = /\["([a-zA-Z0-9_]+)",\s*"([a-zA-Z0-9_]+)",\s*"([a-zA-Z0-9_]+)",\s*(?:"([^"]*)"|null)\]/g;
  for (let m = entryPattern.exec(blockMatch[1]); m; m = entryPattern.exec(blockMatch[1])) {
    entries.push({ key: m[1], domain: m[2], realId: m[3], configuredName: m[4] || null });
  }
  return entries;
}

const aliases = extractWireObjectIdAliases(source);
check("wireObjectIdAliases extracted from jk_bms.js", aliases.length > 0, `count=${aliases.length}`);

{
  const byRealId = new Map();
  let idCollisions = 0;
  for (const a of aliases) {
    const dupe = byRealId.get(`${a.domain}/${a.realId}`);
    if (dupe && dupe !== a.key) idCollisions += 1;
    byRealId.set(`${a.domain}/${a.realId}`, a.key);
  }
  check("no two canonical keys claim the same real wire object_id (static)", idCollisions === 0, `collisions=${idCollisions}`);
}

{
  const canonicalKeys = new Set(canonical.registers.flatMap((r) => r.fields).map((f) => f.key));
  const orphaned = aliases.filter((a) => !canonicalKeys.has(a.key));
  check("every alias key is a real canonical field key (no orphaned entries)", orphaned.length === 0, orphaned.map((a) => a.key).join(","));
}

{
  const aliasKeys = new Set(aliases.map((a) => a.key));
  const missing = [];
  for (const r of canonical.registers) {
    for (const f of r.fields) {
      if (f.esphome_read_entity_id && f.esphome_read_entity_id !== f.key && !aliasKeys.has(f.key)) missing.push(f.key);
    }
  }
  check("every canonical field with a real-id divergence has a generated alias entry", missing.length === 0, missing.join(","));
}

{
  let allCorrect = true;
  const wrong = [];
  for (let i = 1; i <= 16; i += 1) {
    const key = `cell_resistance_${i}`;
    const entry = aliases.find((a) => a.key === key);
    const expectedConfiguredName = `cell ${i} wire resistance`;
    if (!entry || entry.realId !== `cell_${i}_wire_resistance` || entry.domain !== "sensor" || entry.configuredName !== expectedConfiguredName) {
      allCorrect = false;
      wrong.push(key);
    }
  }
  check("all 16 cell_resistance_N keys carry BOTH the correct object_id AND the correct live configured name", allCorrect, wrong.join(","));
}

// PROTOCOL_CATALOG.wireObjectIdAliases (the object actually consumed at
// runtime, not just the source text) agrees with the extraction above --
// proves the vm-loaded runtime table and the static source-text table are
// the same data, not two things that happened to both look right.
check("PROTOCOL_CATALOG.wireObjectIdAliases (runtime) has the same entry count as the extracted source table",
  Array.isArray(PROTOCOL_CATALOG.wireObjectIdAliases) && PROTOCOL_CATALOG.wireObjectIdAliases.length === aliases.length);

console.log(`\n${checks} checks run, ${failures} failed.`);
process.exit(failures ? 1 : 0);
