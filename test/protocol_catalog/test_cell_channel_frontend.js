#!/usr/bin/env node
"use strict";

// Frontend regression test for the cell-channel batch's user-directed
// rework (2026-09-17): activeCellCount()/topologyState() are the exact
// closures renderCells() calls to decide how many card slots (out of the
// full 32-channel pool, MAX_CELL_COUNT) get shown vs hidden -- this file
// exercises the REAL closures via the same vm test-hook technique as
// test_exact_decimal_companion_routing.js/test_cell_channel_batch.js, no
// reimplementation of the logic anywhere below.
//
// Covers: LOADING (no valid N yet -> render nothing, never a made-up
// configuration or a previous battery's residual value), CONFIRMED for
// 4S/8S/16S/24S/32S (one general mechanism, not separate hardcoded
// modes), PENDING (last confirmed count, never a guessed intermediate),
// and MISMATCH/INVALID/OFFLINE/WRITE_UNCERTAIN (full protocol pool, so
// nothing real is hidden while state is uncertain).
//
// Does not exercise DOM rendering itself (button.hidden etc.) -- the
// project's own no-DOM-library test convention (see
// test_diagnostic_software_variables_scroll.js's own precedent) means
// renderCells()'s actual card show/hide is verified by inspection against
// this same activeCellCount() contract, not re-simulated here; see
// test/jk_topology/test_jk_topology_core.cpp for the backend decision
// logic these frontend values ultimately come from, including its own
// direct hiding-boundary assertions.

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
function setEffectiveCellCount(n) {
  ingestPayload({ id: "sensor/effective cell count", domain: "sensor", name: "effective cell count", icon: "", entity_category: 0, value: n, state: `${n}` });
}
function setLastConfirmedCellCount(n) {
  ingestPayload({ id: "sensor/last confirmed cell count", domain: "sensor", name: "last confirmed cell count", icon: "", entity_category: 0, value: n, state: `${n}` });
}

// ===========================================================================
// 1. LOADING: no valid N has ever been obtained -- activeCellCount() must
// return 0 (render nothing), never MAX_CELL_COUNT or any guessed value --
// proves the frontend never draws a made-up configuration or a previous
// battery's residual values before the device has said anything real.
// ===========================================================================
{
  // A field genuinely never touched by ingestPayload reads as undefined in
  // state[], which topologyState() itself already treats as "LOADING"
  // (its own fallback for an unrecognized/absent code) -- exercised here
  // via a literal state string too, for an explicit, real SSE shape.
  setTopologyState("LOADING");
  check("topologyState() reports LOADING for a real 'LOADING' SSE payload", topologyState() === "LOADING");
  check("activeCellCount() returns 0 during LOADING (render nothing, no made-up configuration)", activeCellCount() === 0);
}

// ===========================================================================
// 2. CONFIRMED for 4S/8S/16S/24S/32S -- one general mechanism: every case
// below drives the SAME two real SSE payloads (topology state + effective
// count) through the SAME activeCellCount(), differing only in the number.
// ===========================================================================
for (const n of [4, 8, 16, 24, 32]) {
  setTopologyState("CONFIRMED");
  setEffectiveCellCount(n);
  check(`CONFIRMED ${n}S: activeCellCount() returns exactly ${n} (drives card 1..${n} shown, ${n + 1}..32 hidden)`,
    activeCellCount() === n, `got=${activeCellCount()}`);
}

// ===========================================================================
// 3. CONFIRMED with an out-of-range reported count falls back to
// MAX_CELL_COUNT (defensive clamp -- the backend itself should never emit
// this, but the frontend must not silently render a bogus tiny/huge pool
// if it somehow did).
// ===========================================================================
{
  setTopologyState("CONFIRMED");
  setEffectiveCellCount(0);
  check("CONFIRMED with effective_cell_count=0 (out of 1..32): falls back to MAX_CELL_COUNT, not 0 or a crash",
    activeCellCount() === MAX_CELL_COUNT);
  setEffectiveCellCount(99);
  check("CONFIRMED with effective_cell_count=99 (out of 1..32): falls back to MAX_CELL_COUNT",
    activeCellCount() === MAX_CELL_COUNT);
}

// ===========================================================================
// 4. PENDING: a write is in flight -- renders the LAST CONFIRMED count,
// never a guessed intermediate toward the requested-but-unverified value.
// ===========================================================================
{
  setLastConfirmedCellCount(16);
  setTopologyState("PENDING");
  check("PENDING: activeCellCount() returns the last CONFIRMED count (16), not a guess",
    activeCellCount() === 16);

  setLastConfirmedCellCount(8);
  setTopologyState("PENDING");
  check("PENDING after a different last-confirmed value (8): activeCellCount() tracks it, not stale 16",
    activeCellCount() === 8);
}

// ===========================================================================
// 5. MISMATCH/INVALID/OFFLINE/WRITE_UNCERTAIN: the full protocol pool, so
// nothing that might be a real physical channel is hidden while state is
// uncertain -- distinct from LOADING (0), which only applies before the
// very first valid snapshot.
// ===========================================================================
for (const code of ["MISMATCH", "INVALID", "OFFLINE", "WRITE_UNCERTAIN"]) {
  setTopologyState(code);
  check(`${code}: activeCellCount() returns the full protocol pool (${MAX_CELL_COUNT}), not 0 and not a guessed count`,
    activeCellCount() === MAX_CELL_COUNT, `got=${activeCellCount()}`);
}

// ===========================================================================
// 6. Transition MISMATCH -> LOADING is impossible in real firmware
// (LOADING only ever precedes a first snapshot), but proves LOADING's 0
// wins whenever topologyState() reports it, regardless of what
// effective_cell_count last held -- no leftover value survives.
// ===========================================================================
{
  setTopologyState("CONFIRMED");
  setEffectiveCellCount(24);
  check("sanity: CONFIRMED 24S reads 24 before the LOADING re-check below", activeCellCount() === 24);
  setTopologyState("LOADING");
  check("LOADING always returns 0, even immediately after a CONFIRMED 24S reading -- no stale value leaks through",
    activeCellCount() === 0);
}

console.log(`\n${checks} checks run, ${failures} failed.`);
process.exit(failures ? 1 : 0);
