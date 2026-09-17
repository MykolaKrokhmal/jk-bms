#!/usr/bin/env node
"use strict";

// Frontend regression test for the cell-channel batch's user-directed
// rework (THIRD pass, 2026-09-17): configured channel count and confirmed/
// trustworthy status are DIFFERENT CONCEPTS. activeCellCount() -- the
// exact closure renderCells()/the bar chart/the cell-selector buttons/the
// history-modal invalidation all call to decide how many of the 32-slot
// card pool are shown vs hidden -- now reads resolve_topology's own
// display_cell_count sensor, which reflects a validly-read CellCount in
// EVERY state (CONFIRMED, MISMATCH, OFFLINE with a cached last-read
// value), never falling back to the full 32-channel pool just because
// topology isn't confirmed. This file exercises the REAL closures via the
// same vm test-hook technique as test_exact_decimal_companion_routing.js/
// test_cell_channel_batch.js, no reimplementation of the logic anywhere
// below.
//
// This corrects a real defect in the prior pass (7780ca5 series):
// activeCellCount() used to fall back to the full protocol pool (32) for
// MISMATCH/INVALID/OFFLINE/WRITE_UNCERTAIN, silently showing N+1..32 as
// if they were active elements whenever topology wasn't CONFIRMED, even
// for an 8S pack. The checks below specifically target that scenario for
// 8S and 16S, per instruction.
//
// Does not exercise DOM rendering itself (button.hidden etc.) -- the
// project's own no-DOM-library test convention (see
// test_diagnostic_software_variables_scroll.js's own precedent) means
// renderCells()'s actual card show/hide is verified by inspection against
// this same activeCellCount() contract, not re-simulated here; see
// test/jk_topology/test_jk_topology_core.cpp for the backend decision
// logic (display_cell_count) these frontend values ultimately come from,
// including its own direct hiding-boundary and MISMATCH/OFFLINE-with-
// valid-N assertions.

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
    cancelAnimationFrame() {}, requestAnimationFrame() { return 1; },
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
  const sandbox = { window, document, navigator: { language: "en" }, URL, console, Map, HTMLInputElement };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "jk_bms.js" });
  if (!window.__JK_BMS_TEST_HOOKS__.ingestPayload) {
    throw new Error("jk_bms.js's test hook did not populate -- window.__JK_BMS_TEST_HOOKS__ shape may have drifted");
  }
  return window.__JK_BMS_TEST_HOOKS__;
}

const hooks = loadRealClosures();
const { ingestPayload, activeCellCount, topologyState, MAX_CELL_COUNT } = hooks;

check("real jk_bms.js closures loaded via the test hook (not reimplemented)",
  typeof activeCellCount === "function" && typeof topologyState === "function");
check("MAX_CELL_COUNT reflects protocol capacity (32), not the old 16S-only pool",
  MAX_CELL_COUNT === 32, `MAX_CELL_COUNT=${MAX_CELL_COUNT}`);

function setTopologyState(code) {
  ingestPayload({ id: "text_sensor/topology state", domain: "text_sensor", name: "topology state", icon: "", entity_category: 0, value: code, state: code });
}
function setDisplayCellCount(n) {
  ingestPayload({ id: "sensor/display cell count", domain: "sensor", name: "display cell count", icon: "", entity_category: 0, value: n, state: `${n}` });
}

// ===========================================================================
// 1. LOADING / no valid N yet (new connection): activeCellCount() must
// return 0 (render nothing), never MAX_CELL_COUNT and never a previous
// device's residual value -- proves the frontend never draws a made-up
// configuration before the device has said anything real.
// ===========================================================================
{
  // A field genuinely never touched by ingestPayload reads as null via
  // numeric() -- the real "brand new connection, nothing read yet" shape.
  check("brand new connection, display_cell_count never published: activeCellCount() == 0",
    activeCellCount() === 0);

  setTopologyState("LOADING");
  check("topologyState() reports LOADING for a real 'LOADING' SSE payload", topologyState() === "LOADING");
  check("activeCellCount() still 0 while state is LOADING and display_cell_count is unset",
    activeCellCount() === 0);
}

// ===========================================================================
// 2. Configured N drives channel count in EVERY state -- CONFIRMED,
// MISMATCH, and OFFLINE all show the SAME N once display_cell_count
// reports it, for both 8S and 16S. This is the exact defect this pass
// fixes: for N=8, channels 9-32 must NEVER appear active in ANY of these
// three states.
// ===========================================================================
for (const n of [8, 16]) {
  for (const stateCode of ["CONFIRMED", "MISMATCH", "OFFLINE"]) {
    setTopologyState(stateCode);
    setDisplayCellCount(n);
    check(`${stateCode} ${n}S: activeCellCount() returns exactly ${n} (channels ${n + 1}-32 do NOT appear as active elements)`,
      activeCellCount() === n, `got=${activeCellCount()}`);
    check(`${stateCode} ${n}S: activeCellCount() is NOT the full pool (32) just because state isn't CONFIRMED`,
      n === MAX_CELL_COUNT || activeCellCount() !== MAX_CELL_COUNT);
  }
}

// Also exercise 4S/24S/32S in CONFIRMED for the "one general mechanism,
// not hardcoded modes" property, mirroring the backend's own coverage.
for (const n of [4, 24, 32]) {
  setTopologyState("CONFIRMED");
  setDisplayCellCount(n);
  check(`CONFIRMED ${n}S: activeCellCount() returns exactly ${n}`, activeCellCount() === n, `got=${activeCellCount()}`);
}

// ===========================================================================
// 3. Invalid CellCount (backend already reports display_cell_count=0 for
// this case, state INVALID/reason COUNT_OUT_OF_RANGE) must never show as
// activeCellCount()==32 -- an explicit configuration error, not a silent
// fallback to the full pool.
// ===========================================================================
{
  setTopologyState("INVALID");
  setDisplayCellCount(0);
  check("INVALID/config-error: activeCellCount() == 0 (explicit error), never 32",
    activeCellCount() === 0);
}

// ===========================================================================
// 4. WRITE_UNCERTAIN with a cached valid N (a CellCount write was in
// flight when comms hiccuped) still shows that N -- the resolver itself
// always recomputes display_cell_count from whatever CellCount reading is
// currently available, even mid-uncertainty.
// ===========================================================================
{
  setTopologyState("WRITE_UNCERTAIN");
  setDisplayCellCount(16);
  check("WRITE_UNCERTAIN with a cached N=16: activeCellCount() == 16, not 32",
    activeCellCount() === 16);
}

// ===========================================================================
// 5. Out-of-range display_cell_count defensively clamps to 0 (the backend
// itself should never emit this -- jk_topology_core.h's own resolve()
// only ever sets it to 0 or a value already validated 1..32 -- but the
// frontend must not silently render a bogus pool if it somehow did).
// ===========================================================================
{
  setDisplayCellCount(99);
  check("display_cell_count=99 (out of 1..32, defensive): activeCellCount() == 0, not 99 and not 32",
    activeCellCount() === 0);
}

// ===========================================================================
// 6. Transition 16 -> 8: no stale value leaks through, in either
// direction -- covers the exact transition named in the instructions.
// ===========================================================================
{
  setTopologyState("CONFIRMED");
  setDisplayCellCount(16);
  check("16->8 transition: before, activeCellCount() == 16", activeCellCount() === 16);

  setDisplayCellCount(8);
  check("16->8 transition: after, activeCellCount() == 8, not stale 16 -- channels 9-32 no longer active",
    activeCellCount() === 8);

  // And immediately into MISMATCH at the new N=8 -- still 8, not 32 and
  // not stale 16.
  setTopologyState("MISMATCH");
  check("16->8 transition, then MISMATCH at the new N: activeCellCount() == 8, neither stale 16 nor fallback 32",
    activeCellCount() === 8);
}

console.log(`\n${checks} checks run, ${failures} failed.`);
process.exit(failures ? 1 : 0);
