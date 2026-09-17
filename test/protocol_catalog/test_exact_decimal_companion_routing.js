#!/usr/bin/env node
"use strict";

// Regression test for the Stage 3 precision-fix routing/duplication fix
// (user-directed, 2026-09-17): rtc_ticks, odd_run_time, bms_system_ticks,
// total_runtime each have an exact text_sensor primary entity plus a
// pre-existing, unchanged, approximate "legacy companion" sensor entity
// (generated only by generate_read_plan.js, purely for Home Assistant
// history/dashboard compatibility -- see registers.canonical.json's own
// legacy_companion_entity_id/_domain/_configured_name). A real hardware
// retest (2026-09-17, HEAD 8416a9b) found the legacy entity was completely
// unregistered in jk_bms.js's entityByWireId, producing a second,
// duplicate, mislabeled, unit-less row in the project's own Settings/
// Diagnostics list alongside the correctly-routed exact one.
//
// Loads the REAL jk_bms.js closures in a Node `vm` sandbox via its own
// test hook (same technique as test_wire_object_id_aliases.js, written
// after the same class of bug was found the first time) -- no
// reimplementation of registerEntity()/ingestPayload()'s resolution
// algorithm anywhere below.

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
  let rafCallCount = 0;
  const window = {
    __JK_BMS_TEST_HOOKS__: {},
    location: { href: "http://jk-bms.local/" },
    addEventListener() {}, matchMedia() { return { matches: false }; },
    cancelAnimationFrame() {},
    requestAnimationFrame() { rafCallCount += 1; return 1; },
    clearInterval() {}, setInterval() {},
  };
  const document = {
    documentElement: undefined,
    readyState: "complete",
    createElement() { return fakeElement(); },
    addEventListener() {},
    getElementById() { return null; },
    body: fakeElement(),
    activeElement: null,
  };
  class HTMLInputElement {}
  const sandbox = { window, document, navigator: { language: "en" }, URL, console, Map: CollisionTrackingMap, HTMLInputElement };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "jk_bms.js" });
  if (!window.__JK_BMS_TEST_HOOKS__.ingestPayload) {
    throw new Error("jk_bms.js's test hook did not populate -- window.__JK_BMS_TEST_HOOKS__ shape may have drifted");
  }
  return { hooks: window.__JK_BMS_TEST_HOOKS__, collisions, getRafCallCount: () => rafCallCount };
}

const { hooks, collisions, getRafCallCount } = loadRealClosures();
const { ingestPayload, entityByWireId, state, diagnosticReadouts, LEGACY_COMPANION_SUPPRESSED, PROTOCOL_CATALOG } = hooks;

check("real jk_bms.js closures loaded via the test hook (not reimplemented)",
  typeof ingestPayload === "function" && entityByWireId instanceof Map && typeof LEGACY_COMPANION_SUPPRESSED === "symbol");

// >= 4, not === 4: this file only exercises the original 4 Stage 3
// precision-fix fields (rtc_ticks/odd_run_time/bms_system_ticks/
// total_runtime) -- a later, legitimate reuse of the SAME mechanism for a
// different field (e.g. cell_connected_mask, Stage 3 cell-channel batch,
// 2026-09-17 -- a bitmask precision fix, not a decimal counter) should not
// fail this specific test file, which never claims to be exhaustive over
// every legacyCompanionEntities user.
check("PROTOCOL_CATALOG.legacyCompanionEntities carries at least the original 4 fields",
  Array.isArray(PROTOCOL_CATALOG.legacyCompanionEntities) && PROTOCOL_CATALOG.legacyCompanionEntities.length >= 4,
  `count=${PROTOCOL_CATALOG.legacyCompanionEntities.length}`);

// --- No collisions from real registration (instrumented during the actual
// script load, same technique as test_wire_object_id_aliases.js) -----------
check("no wire-id variant was silently overwritten with a DIFFERENT canonical key during real registration",
  collisions.length === 0,
  collisions.map((c) => `${c.wireId}: ${String(c.previousKey)} -> ${String(c.nextKey)}`).join(", "));

// --- Per-field fixtures: real wire ids and real captured sample values
// (2026-09-17 hardware retest, HEAD 8416a9b, live device at 192.168.27.43)
// -- never minimized/guessed approximations. Each exact payload's own
// "state" never carries a unit suffix (decode_exact_decimal's own
// design); each legacy payload's "state" always does (uom applied) -- this
// textual difference is what lets a test tell which one actually won a
// state[] write, using only real captured shapes, no invented markers.
const FIELDS = [
  {
    key: "rtc_ticks",
    exactWireId: "text_sensor/rtc ticks exact",
    legacyWireId: "sensor/rtc ticks",
    exactPayload: (state_) => ({ id: "text_sensor/rtc ticks exact", domain: "text_sensor", name: "rtc ticks exact", icon: "", entity_category: 0, value: state_, state: state_ }),
    legacyPayload: (raw, state_) => ({ id: "sensor/rtc ticks", domain: "sensor", name: "rtc ticks", icon: "", entity_category: 0, value: raw, state: `${state_} s`, uom: "s" }),
    sampleA: { exact: "211792255", legacyRaw: 2.117922e8, legacyState: "211792256" },
    sampleB: { exact: "211792270", legacyRaw: 2.117923e8, legacyState: "211792272" },
    expectedLabelUk: "Лічильник RTC (з 2020-01-01)", expectedUkUnit: "с",
  },
  {
    key: "bms_system_ticks",
    exactWireId: "text_sensor/bms system ticks exact",
    legacyWireId: "sensor/bms system ticks",
    exactPayload: (state_) => ({ id: "text_sensor/bms system ticks exact", domain: "text_sensor", name: "bms system ticks exact", icon: "", entity_category: 0, value: state_, state: state_ }),
    legacyPayload: (raw, state_) => ({ id: "sensor/bms system ticks", domain: "sensor", name: "bms system ticks", icon: "", entity_category: 0, value: raw, state: `${state_} s`, uom: "s" }),
    // Real retest sample explicitly named by the user: exact=2191409.6
    // (a DECIMAL, not an integer -- bms_system_ticks' own canonical scale
    // is 0.1 -- the exact-decimal channel must never be treated as
    // integer-only; the check below asserts the fractional string
    // survives untouched, no rounding/truncation to "2191409" or "2191410").
    sampleA: { exact: "2191409.6", legacyRaw: 2191410, legacyState: "2191409.8" },
    sampleB: { exact: "2191440.1", legacyRaw: 2191440, legacyState: "2191440.0" },
    expectedLabelUk: "Системні тики BMS", expectedUkUnit: "с",
  },
  {
    key: "odd_run_time",
    exactWireId: "text_sensor/odd run time exact",
    legacyWireId: "sensor/odd run time",
    exactPayload: (state_) => ({ id: "text_sensor/odd run time exact", domain: "text_sensor", name: "odd run time exact", icon: "", entity_category: 0, value: state_, state: state_ }),
    legacyPayload: (raw, state_) => ({ id: "sensor/odd run time", domain: "sensor", name: "odd run time", icon: "", entity_category: 0, value: raw, state: `${state_} s`, uom: "s" }),
    // odd_run_time was observed STATIC across the whole ~100s retest window
    // (a real property of this specific BMS register, confirmed separately
    // -- not a reason to skip the same-sample exact/legacy comparison here:
    // the exact/legacy state STRINGS still differ textually (unit suffix),
    // which is what this test actually checks, independent of whether the
    // underlying value changes over time.
    sampleA: { exact: "57414000", legacyRaw: 5.7414e7, legacyState: "57414000" },
    sampleB: { exact: "57414000", legacyRaw: 5.7414e7, legacyState: "57414000" },
    expectedLabelUk: "Сумарний час роботи", expectedUkUnit: "с",
  },
  {
    key: "total_runtime",
    exactWireId: "text_sensor/total runtime exact",
    legacyWireId: "sensor/total runtime in seconds",
    exactPayload: (state_) => ({ id: "text_sensor/total runtime exact", domain: "text_sensor", name: "total runtime exact", icon: "", entity_category: 0, value: state_, state: state_ }),
    legacyPayload: (raw, state_) => ({ id: "sensor/total runtime in seconds", domain: "sensor", name: "total runtime in seconds", icon: "", entity_category: 0, value: raw, state: `${state_} s`, uom: "s" }),
    sampleA: { exact: "57414068", legacyRaw: 5.741407e7, legacyState: "57414068" },
    sampleB: { exact: "57414144", legacyRaw: 5.741414e7, legacyState: "57414144" },
    // total_runtime's OWN real canonical label is "Час роботи" (confirmed
    // directly against fieldMeta below) -- NOT "Загальний час роботи",
    // which was only ever shown by accident: the pre-fix broken row
    // resolved via a DIFFERENT fallback table (DIAGNOSTIC_ENTITY_LABELS,
    // keyed by the legacy wire id's own regex-derived pseudo-key
    // "total_runtime_in_seconds", a different string from the real
    // canonical key "total_runtime"). This fix correctly routes to the
    // real canonical field, which has always had its own, different,
    // equally real label -- a genuine, expected label-text CHANGE from
    // what the broken row showed, not a defect in this fix.
    expectedLabelUk: "Час роботи", expectedUkUnit: "с",
  },
];

for (const f of FIELDS) {
  // --- routing: exact wire id resolves to the real canonical key ---------
  const resolvedKey = entityByWireId.get(f.exactWireId);
  check(`${f.key}: real exact wire id "${f.exactWireId}" resolves to canonical key "${f.key}"`,
    resolvedKey === f.key, `resolved=${String(resolvedKey)}`);

  // --- legacy wire id resolves to the suppression sentinel, not a key ----
  const legacyResolved = entityByWireId.get(f.legacyWireId);
  check(`${f.key}: real legacy wire id "${f.legacyWireId}" resolves to LEGACY_COMPANION_SUPPRESSED, not a canonical key`,
    legacyResolved === LEGACY_COMPANION_SUPPRESSED, `resolved=${String(legacyResolved)}`);
}

// --- order A: exact arrives, then legacy (rtc_ticks, bms_system_ticks) ----
// rafBefore is snapshotted immediately before EACH individual ingestPayload
// call under test, never shared across two calls -- window.requestAnimationFrame
// scheduling is internally guarded (a single pending-rebuild flag shared
// across every field, never reset in this sandbox since the stubbed rAF
// never actually invokes its callback), so a snapshot taken before an
// EARLIER call would conflate that call's own legitimate new-row scheduling
// with the specific call actually under test.
for (const f of [FIELDS[0], FIELDS[1]]) {
  let rafBefore = getRafCallCount();
  ingestPayload(f.exactPayload(f.sampleA.exact));
  check(`${f.key} (exact->legacy): canonical state[] gets the EXACT value after the exact payload`,
    state[f.key] && state[f.key].state === f.sampleA.exact, `state=${state[f.key] && state[f.key].state}`);

  const diagCountBeforeLegacy = diagnosticReadouts.size;
  rafBefore = getRafCallCount();
  ingestPayload(f.legacyPayload(f.sampleA.legacyRaw, f.sampleA.legacyState));
  check(`${f.key} (exact->legacy): legacy update does NOT downgrade the already-resolved exact state`,
    state[f.key] && state[f.key].state === f.sampleA.exact, `state=${state[f.key] && state[f.key].state}`);
  check(`${f.key} (exact->legacy): legacy payload creates NO diagnosticReadouts entry (no duplicate row)`,
    diagnosticReadouts.size === diagCountBeforeLegacy && !diagnosticReadouts.has(f.legacyWireId));
  check(`${f.key} (exact->legacy): legacy payload never schedules a diagnostic rebuild (requestAnimationFrame)`,
    getRafCallCount() === rafBefore, `rafCalls delta=${getRafCallCount() - rafBefore}`);
}

// --- order B: legacy arrives, then exact (odd_run_time, total_runtime) ----
for (const f of [FIELDS[2], FIELDS[3]]) {
  const rafBefore = getRafCallCount();
  const diagCountBeforeLegacy = diagnosticReadouts.size;
  ingestPayload(f.legacyPayload(f.sampleB.legacyRaw, f.sampleB.legacyState));
  check(`${f.key} (legacy->exact): legacy-first payload writes NOTHING into canonical state[] (still unset)`,
    state[f.key] === undefined, `state=${JSON.stringify(state[f.key])}`);
  check(`${f.key} (legacy->exact): legacy-first payload creates NO diagnosticReadouts entry`,
    diagnosticReadouts.size === diagCountBeforeLegacy && !diagnosticReadouts.has(f.legacyWireId));
  check(`${f.key} (legacy->exact): legacy-first payload never schedules a diagnostic rebuild`,
    getRafCallCount() === rafBefore);

  ingestPayload(f.exactPayload(f.sampleB.exact));
  check(`${f.key} (legacy->exact): canonical state[] gets the EXACT value once the exact payload arrives`,
    state[f.key] && state[f.key].state === f.sampleB.exact, `state=${state[f.key] && state[f.key].state}`);
}

// --- "one canonical row": for every field, exactly one diagnosticReadouts
// entry exists (keyed by the exact wire id) and the legacy wire id never
// appears there at all, checked across the WHOLE run above, not just the
// last sample -----------------------------------------------------------
for (const f of FIELDS) {
  check(`${f.key}: exactly one diagnostic row exists (the exact wire id), legacy wire id absent`,
    diagnosticReadouts.has(f.exactWireId) && !diagnosticReadouts.has(f.legacyWireId));
}

// --- correct labels/units survive (fieldMeta unaffected by this fix, but
// asserted here since "one canonical row with a correct label/unit" is
// exactly this fix's own stated goal) -------------------------------------
for (const f of FIELDS) {
  const meta = PROTOCOL_CATALOG.fieldMeta[f.key];
  check(`${f.key}: fieldMeta carries its real Ukrainian label`, meta && meta.labelUk === f.expectedLabelUk, meta && meta.labelUk);
  check(`${f.key}: fieldMeta carries its real Ukrainian unit`, meta && meta.ukUnit === f.expectedUkUnit, meta && meta.ukUnit);
}

// --- bms_system_ticks exact channel is explicitly NOT integer-only:
// scale 0.1 means its exact decimal string legitimately carries a
// fractional digit, and nothing in the routing path may coerce/round it. -
{
  const raw = "2191409.6";
  ingestPayload({ id: "text_sensor/bms system ticks exact", domain: "text_sensor", name: "bms system ticks exact", icon: "", entity_category: 0, value: raw, state: raw });
  check("bms_system_ticks exact channel preserves its fractional digit verbatim (2191409.6, not rounded/truncated)",
    state.bms_system_ticks.state === "2191409.6", `state=${state.bms_system_ticks.state}`);
  check("bms_system_ticks exact channel's stored value is the untouched STRING, not a coerced Number",
    typeof state.bms_system_ticks.value === "string" && state.bms_system_ticks.value === "2191409.6");
}

// --- static-field same-sample comparison (odd_run_time): the field's own
// dynamics being flat this session is not a reason to skip the exact/
// legacy comparison itself -- re-run BOTH payloads with an IDENTICAL
// numeric magnitude and confirm state[] still ends up holding the EXACT
// payload's own string, distinguished only by the real textual
// difference (no "s" suffix) between the two real captured shapes. -------
{
  ingestPayload(FIELDS[2].legacyPayload(5.7414e7, "57414000"));
  ingestPayload(FIELDS[2].exactPayload("57414000"));
  check("odd_run_time same-sample comparison: canonical state holds the exact payload's own string form (no unit suffix)",
    state.odd_run_time.state === "57414000" && !state.odd_run_time.state.includes(" "));
}

// --- negative control: an unrelated wire id still resolves to neither a
// real key nor the suppression sentinel -- proves LEGACY_COMPANION_SUPPRESSED
// is a narrow, targeted registration, not an over-broad default. ---------
check("an unrelated, never-registered wire id resolves to neither a canonical key nor the suppression sentinel",
  entityByWireId.get("sensor/totally made up field") === undefined);

console.log(`\n${checks} checks run, ${failures} failed.`);
process.exit(failures ? 1 : 0);
