#!/usr/bin/env node
"use strict";

// Exhaustive runtime key-space invariant (RS485 unified pipeline plan,
// Stage 1). Every key the browser can route an ESPHome entity to -- read
// from the REAL jk_bms.js entityByWireId map, which is filled by the hand
// registerEntity() calls, the generated PROTOCOL_ENTITY_ROUTES and the
// generated wireObjectIdAliases -- must belong to exactly one canonical
// class:
//   - register field        protocol/registers.canonical.json
//   - non-register entity   protocol/non_register_entities.canonical.json
//                           (any category except protocol_infrastructure)
//   - protocol infrastructure  the same file, category protocol_infrastructure
//   - service action        protocol/service_actions.canonical.json
//   - legacy companion      the LEGACY_COMPANION_SUPPRESSED sentinel, driven
//                           by the generated legacyCompanionEntities table
// The classes must be pairwise disjoint. Nothing here lists runtime keys
// by hand: a newly registered key that is missing from the canonical
// sources fails this test. (Rendering of infrastructure keys is proven
// with the real DOM in test_diagnostic_software_variables_scroll.js.)

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..", "..");
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));

let checks = 0;
let failures = 0;
function check(name, condition, detail = "") {
  checks += 1;
  if (!condition) failures += 1;
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` -- ${detail}` : ""}`);
}

// jk_bms.js returns right after populating the test hook, before building
// any DOM, so an inert document/window is enough to read its closures.
function loadRealClosures() {
  const inert = () => null;
  const window = {
    __JK_BMS_TEST_HOOKS__: {}, location: { href: "http://jk-bms.local/" },
    addEventListener() {}, matchMedia() { return { matches: false }; },
    requestAnimationFrame() { return 0; }, cancelAnimationFrame() {},
    setInterval() { return 0; }, clearInterval() {}, setTimeout() { return 0; }, clearTimeout() {},
  };
  const document = {
    readyState: "complete", addEventListener() {}, getElementById: inert, querySelector: inert,
    querySelectorAll() { return []; }, scrollingElement: { scrollTop: 0 },
    createElement() { return { getContext() { return { measureText() { return { width: 0 }; } }; } }; },
  };
  const sandbox = { window, document, navigator: { language: "en" }, URL, console, Map, HTMLInputElement: class {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "jk_bms.js"), "utf8"), sandbox, { filename: "jk_bms.js" });
  const hooks = window.__JK_BMS_TEST_HOOKS__;
  if (!hooks.entityByWireId) throw new Error("jk_bms.js test hook did not expose entityByWireId");
  return hooks;
}

const hooks = loadRealClosures();
const { entityByWireId, PROTOCOL_CATALOG, LEGACY_COMPANION_SUPPRESSED } = hooks;

const registerKeys = new Set(readJson("protocol/registers.canonical.json").registers.flatMap((r) => r.fields.map((f) => f.key)));
const nonRegisterEntities = readJson("protocol/non_register_entities.canonical.json").entities;
const infrastructureKeys = new Set(nonRegisterEntities.filter((e) => e.category === "protocol_infrastructure").map((e) => e.key));
const nonRegisterKeys = new Set(nonRegisterEntities.filter((e) => e.category !== "protocol_infrastructure").map((e) => e.key));
const serviceActionKeys = new Set(readJson("protocol/service_actions.canonical.json").commands.map((c) => c.key));

const classes = { register: registerKeys, non_register: nonRegisterKeys, infrastructure: infrastructureKeys, service_action: serviceActionKeys };
const classOf = (key) => Object.entries(classes).filter(([, set]) => set.has(key)).map(([name]) => name);

// 1. The canonical classes are pairwise disjoint.
const names = Object.keys(classes);
for (let i = 0; i < names.length; i += 1) {
  for (let j = i + 1; j < names.length; j += 1) {
    const overlap = [...classes[names[i]]].filter((k) => classes[names[j]].has(k));
    check(`canonical classes ${names[i]} and ${names[j]} are disjoint`, overlap.length === 0, JSON.stringify(overlap));
  }
}

// 2. Every routed runtime key is in exactly one class.
const runtimeKeys = new Set();
let legacyWireIds = 0;
for (const value of entityByWireId.values()) {
  if (value === LEGACY_COMPANION_SUPPRESSED) legacyWireIds += 1;
  else runtimeKeys.add(value);
}
const unclassified = [...runtimeKeys].filter((k) => classOf(k).length === 0).sort();
const multiClassified = [...runtimeKeys].filter((k) => classOf(k).length > 1).sort();
check(`every routed runtime key (${runtimeKeys.size}) belongs to a canonical class`, unclassified.length === 0,
  `unclassified=${JSON.stringify(unclassified)}`);
check("no routed runtime key belongs to more than one canonical class", multiClassified.length === 0, JSON.stringify(multiClassified));
check("no runtime key is a service action (write-only commands have no read route)",
  ![...runtimeKeys].some((k) => serviceActionKeys.has(k)));

// 3. Legacy-companion suppression is the generated table, and nothing else.
const legacy = PROTOCOL_CATALOG.legacyCompanionEntities;
check("legacy companions are suppressed only via the generated legacyCompanionEntities table",
  legacy.length > 0 && legacyWireIds > 0 &&
  legacy.every(([, domain, entityId]) => entityByWireId.get(`${domain}-${entityId}`) === LEGACY_COMPANION_SUPPRESSED),
  `entries=${legacy.length} suppressedWireIds=${legacyWireIds}`);

// 4. The generated catalog agrees with the canonical source.
const generatedNonRegister = new Set(PROTOCOL_CATALOG.nonRegisterKeys);
const canonicalNonRegisterAll = new Set([...nonRegisterKeys, ...infrastructureKeys]);
check("generated nonRegisterKeys equals the canonical non-register + infrastructure key set",
  generatedNonRegister.size === canonicalNonRegisterAll.size && [...canonicalNonRegisterAll].every((k) => generatedNonRegister.has(k)));

// 5. Infrastructure keys are internal plumbing: no write route, no write
// registry entry, no Settings row.
const writeRegistryKeys = new Set(["live", "authorizationRequired", "blocked"].flatMap((g) => (hooks.WRITE_REGISTRY[g] || []).map((e) => e.key)));
const settingsKeys = new Set(hooks.SETTINGS_CATALOG_ROWS.map((r) => r.canonicalKey).filter(Boolean));
for (const key of infrastructureKeys) {
  check(`infrastructure key ${key}: no write route, write-registry entry or Settings row`,
    !runtimeKeys.has(`set_${key}`) && !writeRegistryKeys.has(key) && !settingsKeys.has(key));
}

console.log(`\nruntime key-space invariant: ${checks - failures}/${checks} passed`);
process.exit(failures ? 1 : 0);
