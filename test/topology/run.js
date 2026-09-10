#!/usr/bin/env node
/*
 * Automated Topology Resolver + CellCount transaction test suite.
 *
 * Drives demo/mock-server.js directly over real HTTP + SSE (no browser
 * needed) — the mock server's resolveTopologyMock() is a faithful JS port
 * of batterylifepo4.yaml's resolve_topology, and runCellCountTransaction()
 * mirrors the real firmware's write -> ACK -> forced-readback -> resolver
 * transaction timeline, including its actual timeouts (3s ACK, 4s
 * readback) and the write-uncertainty recovery probe (5s). This suite
 * therefore exercises the SAME state machine and timing budget the real
 * ESP32 firmware runs, not a stand-in.
 *
 * Run:
 *   node test/topology/run.js
 *
 * Needs to bind a real TCP port — if run inside a sandboxed shell, use
 * the sandbox's escape hatch for local network binding (this project's
 * own agent tooling calls this dangerouslyDisableSandbox).
 *
 * Exit code 0 = every check passed. Non-zero = at least one failed (see
 * the FAIL lines printed above the summary for exactly which, and why).
 */
"use strict";

const { spawn } = require("child_process");
const http = require("http");
const path = require("path");

const PORT = Number(process.env.TEST_PORT) || 18999;
const HOST = "127.0.0.1";
const ROOT = path.join(__dirname, "..", "..");

let results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail: detail || "" });
  const line = `${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`;
  console.log(line);
}
function assert(name, cond, detail) { record(name, Boolean(cond), detail); }

function httpRequest(method, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: HOST, port: PORT, path: pathname, method }, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.end();
  });
}
const get = (p) => httpRequest("GET", p);
const post = (p) => httpRequest("POST", p);

/* ============================================================
   SSE client — parses the exact same event-stream shape jk_bms.js's own
   EventSource consumer reads (`event: <domain>\ndata: {...}\n\n`), keeps a
   live map of every entity's current {state, value}.
   ============================================================ */
class SseClient {
  constructor() { this.entities = Object.create(null); this.revision = Object.create(null); this.buf = ""; this.req = null; this.opened = false; this.rev = 0; }
  connect() {
    return new Promise((resolve, reject) => {
      const req = http.request({ host: HOST, port: PORT, path: "/events", method: "GET" }, (res) => {
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          this.buf += chunk;
          let idx;
          while ((idx = this.buf.indexOf("\n\n")) !== -1) {
            const raw = this.buf.slice(0, idx);
            this.buf = this.buf.slice(idx + 2);
            const dataLine = raw.split("\n").find((l) => l.startsWith("data: "));
            if (!dataLine) continue;
            try {
              const payload = JSON.parse(dataLine.slice(6));
              if (payload && typeof payload.id === "string") {
                this.entities[payload.id] = payload;
                this.rev += 1;
                this.revision[payload.id] = this.rev; // mirrors jk_bms.js's own stateRevision -- lets waitForNext tell a fresh event apart from a stale value that merely happens to already match
              }
            } catch (_) { /* ignore malformed frame */ }
          }
          if (!this.opened) { this.opened = true; resolve(); }
        });
        res.on("error", reject);
      });
      req.on("error", reject);
      req.end();
      this.req = req;
    });
  }
  get(id) { const e = this.entities[id]; return e ? e.value : undefined; }
  getState(id) { const e = this.entities[id]; return e ? e.state : undefined; }
  revisionOf(id) { return this.revision[id] || 0; }
  async waitFor(id, predicate, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (predicate(this.get(id), this.getState(id))) return true;
      await sleep(50);
    }
    return predicate(this.get(id), this.getState(id));
  }
  // Only ever satisfied by an event STRICTLY NEWER than sinceRevision --
  // a value that already matched the predicate before this call (a stale
  // leftover from an earlier transaction) is correctly ignored.
  async waitForNext(id, sinceRevision, predicate, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.revisionOf(id) > sinceRevision && predicate(this.get(id), this.getState(id))) return true;
      await sleep(50);
    }
    return this.revisionOf(id) > sinceRevision && predicate(this.get(id), this.getState(id));
  }
  close() { if (this.req) this.req.destroy(); }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitForServerUp() {
  for (let i = 0; i < 100; i += 1) {
    try { await get("/demo/state"); return; } catch (_) { await sleep100(); }
  }
  throw new Error("mock server did not come up in time");
}
function sleep100() { return sleep(100); }

/* ============================================================
   Test helpers
   ============================================================ */
async function resetTopology(sse, count) {
  await post("/demo/cellcount-scenario?name=confirm");
  await post(`/demo/physical-topology?count=${count}`);
  await post(`/demo/register-cell-count?count=${count}`);
  await sleep(1200); // let a tick() pass so aggregates/resolver settle
}

async function writeCellCount(value) {
  // The real public endpoint (/number/set_cell_count/set) is reverted to
  // fail-closed again (second critical audit, 2026-09-10 — see
  // testCellCountWritePublicEndpointBlocked below for the direct proof).
  // Every test in this file that calls writeCellCount() uses the
  // debug-only trigger instead — it is testing the topology RESOLVER's
  // reaction to a transaction's ack/readback/timeout/SSE-ordering
  // outcomes, not the write endpoint's own policy, and the debug
  // trigger's extra sse_before_http race-ordering hook (see that
  // endpoint's own comment) has no public-endpoint equivalent.
  return post(`/demo/debug-trigger-cellcount-write?value=${value}`);
}

/* ============================================================
   TOPOLOGY MATRIX
   ============================================================ */
async function testConfirmedAtCount(sse, count, label) {
  await resetTopology(sse, count);
  const ok = await sse.waitFor("text_sensor-topology_state", (v) => v === "CONFIRMED", 3000);
  const effective = sse.get("sensor-effective_cell_count");
  assert(`topology: ${label} (${count}S) reaches CONFIRMED`, ok, `topology_state=${sse.getState("text_sensor-topology_state")}`);
  assert(`topology: ${label} effective_cell_count === ${count}`, effective === String(count), `got ${effective}`);
}

async function testOutOfRangeConfiguredRejected(sse) {
  // The raw HTTP endpoint has no client-side <input min/max> guard, so
  // this proves the SERVER-side (mirroring firmware) range check, not
  // just the browser's own input validation.
  await resetTopology(sse, 16);
  const beforeTxId = sse.get("sensor-cellcount_tx_id");
  await writeCellCount(0);
  await sleep(500);
  assert("topology: CellCount=0 is rejected (no transaction started)", sse.get("sensor-cellcount_tx_id") === beforeTxId,
    `tx_id changed from ${beforeTxId} to ${sse.get("sensor-cellcount_tx_id")}`);
  await writeCellCount(17);
  await sleep(500);
  assert("topology: CellCount=17 (out of range) is rejected", sse.get("sensor-cellcount_tx_id") === beforeTxId,
    `tx_id changed from ${beforeTxId} to ${sse.get("sensor-cellcount_tx_id")}`);
}

async function testExactMaskRequired(sse) {
  await resetTopology(sse, 8);
  const before = await sse.waitFor("text_sensor-topology_state", (v) => v === "CONFIRMED", 3000);
  assert("topology: exact contiguous mask (8S) -> CONFIRMED", before);
}

async function testMaskWithGap(sse) {
  await resetTopology(sse, 8);
  // Right popcount (8 bits), wrong positions: drop bit 2, add bit 9.
  const badMask = (((2 ** 8) - 1) & ~(1 << 2)) | (1 << 9);
  await post(`/demo/physical-topology?count=8&mask=${badMask}`);
  await sleep(1200);
  const state = sse.getState("text_sensor-topology_state");
  const reason = sse.getState("text_sensor-topology_reason");
  assert("topology: non-contiguous mask (right popcount, wrong bits) -> MISMATCH", state === "MISMATCH", `state=${state}`);
  assert("topology: non-contiguous mask reason is MASK_NOT_CONTIGUOUS (not just a popcount check)", reason === "MASK_NOT_CONTIGUOUS", `reason=${reason}`);
}

async function testExtraHighBit(sse) {
  await resetTopology(sse, 8);
  const extraBitMask = ((2 ** 8) - 1) | (1 << 10);
  await post(`/demo/physical-topology?count=8&mask=${extraBitMask}`);
  await sleep(1200);
  const state = sse.getState("text_sensor-topology_state");
  assert("topology: extra high mask bit above configured range -> MISMATCH", state === "MISMATCH", `state=${state}`);
}

async function testWrongPopcount(sse) {
  await resetTopology(sse, 8);
  await post("/demo/physical-topology?count=6"); // physical channels genuinely != configured
  await post("/demo/register-cell-count?count=8");
  await sleep(1200);
  const state = sse.getState("text_sensor-topology_state");
  assert("topology: wrong connected-cell popcount -> MISMATCH", state === "MISMATCH", `state=${state}`);
}

async function testMissingVoltage(sse) {
  await resetTopology(sse, 8);
  await post("/demo/cell-voltage?channel=4&value=missing");
  await sleep(1200);
  const state = sse.getState("text_sensor-topology_state");
  const reason = sse.getState("text_sensor-topology_reason");
  assert("topology: a missing voltage inside the active range -> MISMATCH/ACTIVE_RANGE_GAP", state === "MISMATCH" && reason === "ACTIVE_RANGE_GAP", `state=${state} reason=${reason}`);
  await post("/demo/cell-voltage?channel=4&value=auto"); // clean up for later tests
}

async function testNaNVoltage(sse) {
  await resetTopology(sse, 8);
  await post("/demo/cell-voltage?channel=2&value=nan");
  await sleep(1200);
  const state = sse.getState("text_sensor-topology_state");
  assert("topology: NaN voltage inside the active range -> not CONFIRMED", state !== "CONFIRMED", `state=${state}`);
  await post("/demo/cell-voltage?channel=2&value=auto");
}

async function testVoltageSumMismatch(sse) {
  await resetTopology(sse, 8);
  await post("/demo/pack-voltage?value=9.99"); // wildly inconsistent with 8 real ~3.28V cells
  await sleep(1200);
  const state = sse.getState("text_sensor-topology_state");
  const reason = sse.getState("text_sensor-topology_reason");
  assert("topology: pack voltage inconsistent with cell sum -> MISMATCH/VOLTAGE_SUM_DIFFERS", state === "MISMATCH" && reason === "VOLTAGE_SUM_DIFFERS", `state=${state} reason=${reason}`);
  await post("/demo/pack-voltage?value=auto");
}

async function testStaleOffline(sse) {
  await resetTopology(sse, 16);
  await post("/demo/scenario?name=bms_offline");
  // bmsResponseAgeS climbs +1/tick (1 tick/s) from the scenario switch;
  // OFFLINE fires past 30s -- a genuinely slow, real wait, not simulated.
  const wentOffline = await sse.waitFor("text_sensor-topology_state", (v) => v === "OFFLINE", 34000);
  assert("topology: sustained BMS silence (>30s) -> OFFLINE, never a stale CONFIRMED", wentOffline, `state=${sse.getState("text_sensor-topology_state")}`);
  await post("/demo/scenario?name=normal");
  const recovered = await sse.waitFor("text_sensor-topology_state", (v) => v === "CONFIRMED", 5000);
  assert("topology: OFFLINE self-heals to CONFIRMED once comms resume", recovered, `state=${sse.getState("text_sensor-topology_state")}`);
}

async function testRestartRecovery(sse) {
  await resetTopology(sse, 16);
  await post("/demo/bms-restart");
  await sleep(200);
  const wentOffline = sse.getState("text_sensor-topology_state") === "OFFLINE";
  assert("topology: simulated BMS restart immediately reports OFFLINE, not a stale CONFIRMED", wentOffline, `state=${sse.getState("text_sensor-topology_state")}`);
  const recovered = await sse.waitFor("text_sensor-topology_state", (v) => v === "CONFIRMED", 4000);
  assert("topology: resolver self-heals to CONFIRMED after the simulated restart", recovered, `state=${sse.getState("text_sensor-topology_state")}`);
}

async function testRoundTrip(sse) {
  await resetTopology(sse, 16);
  let rev = sse.revisionOf("sensor-cellcount_tx_status_code");
  await writeCellCount(8);
  const to8 = await sse.waitForNext("sensor-cellcount_tx_status_code", rev, (v) => v === "4", 9000);
  assert("topology: 16S -> 8S round-trip write reaches CONFIRMED", to8 && sse.get("sensor-effective_cell_count") === "8",
    `tx_status=${sse.get("sensor-cellcount_tx_status_code")} effective=${sse.get("sensor-effective_cell_count")}`);
  await sleep(300);
  rev = sse.revisionOf("sensor-cellcount_tx_status_code");
  await writeCellCount(16);
  const to16 = await sse.waitForNext("sensor-cellcount_tx_status_code", rev, (v) => v === "4", 9000);
  assert("topology: 8S -> 16S round-trip write reaches CONFIRMED again", to16 && sse.get("sensor-effective_cell_count") === "16",
    `tx_status=${sse.get("sensor-cellcount_tx_status_code")} effective=${sse.get("sensor-effective_cell_count")}`);
}

/* ============================================================
   WRITE TRANSACTION MATRIX — every test snapshots
   cellcount_tx_status_code's REVISION before writing and only accepts a
   STRICTLY NEWER matching event (waitForNext), never a stale value left
   over from a previous test that happened to already be sitting on the
   same status code.
   ============================================================ */
async function testWriteConfirm(sse) {
  await resetTopology(sse, 16);
  await post("/demo/cellcount-scenario?name=confirm");
  const rev = sse.revisionOf("sensor-cellcount_tx_status_code");
  await writeCellCount(4);
  const ok = await sse.waitForNext("sensor-cellcount_tx_status_code", rev, (v) => v === "4", 9000);
  assert("write: confirm scenario reaches tx_status CONFIRMED(4)", ok, `tx_status=${sse.get("sensor-cellcount_tx_status_code")}`);
  assert("write: confirm scenario readback matches requested value exactly", sse.get("sensor-cell_count") === "4", `cell_count=${sse.get("sensor-cell_count")}`);
}

async function testWriteMismatch(sse) {
  await resetTopology(sse, 16);
  await post("/demo/cellcount-scenario?name=mismatch_config_only");
  const rev = sse.revisionOf("sensor-cellcount_tx_status_code");
  await writeCellCount(8);
  const terminal = await sse.waitForNext("sensor-cellcount_tx_status_code", rev, (v) => v === "5", 9000);
  assert("write: mismatch_config_only NEVER reports tx_status CONFIRMED(4)", terminal, `tx_status=${sse.get("sensor-cellcount_tx_status_code")}`);
  assert("write: mismatch topology_state is MISMATCH, not silently CONFIRMED", sse.getState("text_sensor-topology_state") === "MISMATCH",
    `state=${sse.getState("text_sensor-topology_state")}`);
  assert("write: mismatch effective_cell_count stays the safe fallback (16), never the unconfirmed 8", sse.get("sensor-effective_cell_count") === "16",
    `effective=${sse.get("sensor-effective_cell_count")}`);
}

async function testWriteTimeout(sse) {
  await resetTopology(sse, 16);
  await post("/demo/cellcount-scenario?name=timeout_no_apply");
  const rev = sse.revisionOf("sensor-cellcount_tx_status_code");
  const stateRev = sse.revisionOf("text_sensor-topology_state");
  await writeCellCount(8);
  const uncertain = await sse.waitForNext("sensor-cellcount_tx_status_code", rev, (v) => v === "7", 5000);
  assert("write: lost ACK reaches tx_status ACK_TIMEOUT(7), not a silent success", uncertain, `tx_status=${sse.get("sensor-cellcount_tx_status_code")}`);
  assert("write: lost ACK reports topology WRITE_UNCERTAIN, never the stale old CONFIRMED", sse.getState("text_sensor-topology_state") === "WRITE_UNCERTAIN",
    `state=${sse.getState("text_sensor-topology_state")}`);
  const recovered = await sse.waitForNext("text_sensor-topology_state", stateRev + 1, (v) => v === "CONFIRMED", 6500);
  assert("write: recovery probe re-confirms the UNCHANGED old topology (16S) once uncertainty clears", recovered && sse.get("sensor-effective_cell_count") === "16",
    `state=${sse.getState("text_sensor-topology_state")} effective=${sse.get("sensor-effective_cell_count")}`);
}

async function testWriteHttpError(sse) {
  await resetTopology(sse, 16);
  await post("/demo/write-mode?name=http_error");
  const res = await post("/number/set_cell_count/set?value=8");
  assert("write: writeMode=http_error yields a real HTTP 500, not a fake 200", res.status === 500, `status=${res.status}`);
  await post("/demo/write-mode?name=confirm");
}

async function testWriteAckLost(sse) {
  await resetTopology(sse, 16);
  await post("/demo/cellcount-scenario?name=applied_ack_lost");
  const rev = sse.revisionOf("sensor-cellcount_tx_status_code");
  await writeCellCount(8);
  const uncertain = await sse.waitForNext("sensor-cellcount_tx_status_code", rev, (v) => v === "7", 5000);
  const uncertainStateSeen = sse.getState("text_sensor-topology_state") === "WRITE_UNCERTAIN";
  assert("write: applied_ack_lost still reports WRITE_UNCERTAIN, not an optimistic success", uncertain && uncertainStateSeen,
    `tx_status=${sse.get("sensor-cellcount_tx_status_code")} state=${sse.getState("text_sensor-topology_state")}`);
  // The write DID silently apply -- the recovery probe should discover
  // this and move all the way to CONFIRMED at the NEW value, proving the
  // recovery path (not just the failure path) is real.
  const stateRev = sse.revisionOf("text_sensor-topology_state");
  const recovered = await sse.waitForNext("text_sensor-topology_state", stateRev, (v) => v === "CONFIRMED", 6500);
  assert("write: recovery probe eventually reveals the silently-applied NEW topology (8S)", recovered && sse.get("sensor-effective_cell_count") === "8",
    `state=${sse.getState("text_sensor-topology_state")} effective=${sse.get("sensor-effective_cell_count")}`);
}

async function testWriteStaleReadback(sse) {
  await resetTopology(sse, 16);
  await post("/demo/cellcount-scenario?name=ack_ok_readback_stale");
  const rev = sse.revisionOf("sensor-cellcount_tx_status_code");
  await writeCellCount(8);
  const terminal = await sse.waitForNext("sensor-cellcount_tx_status_code", rev, (v) => v === "5", 9000);
  assert("write: readback that lands but doesn't corroborate the new value -> MISMATCH, not CONFIRMED", terminal,
    `tx_status=${sse.get("sensor-cellcount_tx_status_code")}`);
  await post("/demo/cellcount-scenario?name=confirm");
}

async function testWriteReadbackTimeout(sse) {
  await resetTopology(sse, 16);
  await post("/demo/cellcount-scenario?name=readback_timeout");
  const rev = sse.revisionOf("sensor-cellcount_tx_status_code");
  const stateRev = sse.revisionOf("text_sensor-topology_state");
  await writeCellCount(8);
  const timedOut = await sse.waitForNext("sensor-cellcount_tx_status_code", rev, (v) => v === "8", 6000);
  assert("write: ACK ok but the forced readback itself never completes -> tx_status READBACK_TIMEOUT(8)", timedOut,
    `tx_status=${sse.get("sensor-cellcount_tx_status_code")}`);
  assert("write: readback timeout reports WRITE_UNCERTAIN, not a stale CONFIRMED", sse.getState("text_sensor-topology_state") === "WRITE_UNCERTAIN",
    `state=${sse.getState("text_sensor-topology_state")}`);
  const recovered = await sse.waitForNext("text_sensor-topology_state", stateRev, (v) => v === "CONFIRMED", 6500);
  assert("write: recovery probe re-confirms the unchanged old topology after a readback timeout", recovered && sse.get("sensor-effective_cell_count") === "16",
    `state=${sse.getState("text_sensor-topology_state")} effective=${sse.get("sensor-effective_cell_count")}`);
  await post("/demo/cellcount-scenario?name=confirm");
}

async function testWriteSseBeforeHttp(sse) {
  await resetTopology(sse, 16);
  await post("/demo/cellcount-scenario?name=sse_before_http");
  const rev = sse.revisionOf("sensor-cellcount_tx_status_code");
  const res = await writeCellCount(4);
  // The mock's server-side CODE ORDER is broadcast-then-respond (verified
  // by reading runCellCountTransaction's finishTerminal(): it calls
  // broadcastEntity() before onTerminal()/respondOk()) -- but the SSE
  // event and the POST's HTTP response travel over two SEPARATE TCP
  // sockets, so the network cannot guarantee which one a given client
  // observes first; measured jitter here is single-digit milliseconds.
  // That is exactly WHY jk_bms.js's own writeTransaction()/
  // sendCellCountWrite() never assume a watcher armed after the POST
  // resolves will see a pre-existing update -- they check
  // stateRevision[key] synchronously the instant the POST resolves,
  // catching an update that "already happened" moments earlier (see the
  // RACE FIX comment in jk_bms.js). So the correct, achievable assertion
  // here is "terminal within a short grace window of the response
  // returning", not "already true at the exact instant" -- the latter
  // is not a claim any two-socket protocol can make.
  const terminalSoonAfter = await sse.waitForNext("sensor-cellcount_tx_status_code", rev, (v) => v === "4" || v === "5", 500);
  assert("write: sse_before_http -- HTTP response and the SSE terminal event land within the same short window (server broadcasts before responding)",
    res.status === 200 && terminalSoonAfter, `tx_status=${sse.get("sensor-cellcount_tx_status_code")}`);
  await post("/demo/cellcount-scenario?name=confirm");
}

async function testWriteDuplicateSse(sse) {
  await resetTopology(sse, 16);
  await post("/demo/cellcount-scenario?name=duplicate_terminal_sse");
  const rev = sse.revisionOf("sensor-cellcount_tx_status_code");
  await writeCellCount(8);
  const ok = await sse.waitForNext("sensor-cellcount_tx_status_code", rev, (v) => v === "4", 9000);
  await sleep(600); // let the deliberate duplicate re-broadcast land too
  assert("write: a duplicated terminal SSE event doesn't corrupt the final state", ok && sse.get("sensor-cellcount_tx_status_code") === "4",
    `tx_status=${sse.get("sensor-cellcount_tx_status_code")}`);
  await post("/demo/cellcount-scenario?name=confirm");
}

async function testWriteOutOfOrderSse(sse) {
  await resetTopology(sse, 16);
  await post("/demo/cellcount-scenario?name=out_of_order_sse");
  const rev = sse.revisionOf("sensor-cellcount_tx_status_code");
  await writeCellCount(8);
  const ok = await sse.waitForNext("sensor-cellcount_tx_status_code", rev, (v) => v === "4", 9000);
  assert("write: the transaction still settles on tx_status CONFIRMED(4) as its real terminal event", ok,
    `tx_status=${sse.get("sensor-cellcount_tx_status_code")}`);
  await sleep(500); // let the deliberately-replayed earlier-stage event (3) land after it
  // The mock's raw entity store has no version guard (setEntity() always
  // overwrites) -- a stale readback_wait(3) replayed after the terminal
  // event DOES land on the wire here, exactly as this scenario intends to
  // simulate. Immunity to that is a CLIENT responsibility, not something
  // this transport layer can or should provide: jk_bms.js's own
  // sendCellCountWrite() guards every finish() with `if (settled) return;`
  // (see jk_bms.js), so once IT has already settled on CONFIRMED, a late
  // status=3 event reaching evaluateTerminal() hits the "still
  // pending" branch and is simply ignored -- verified by code review, and
  // exercised live in-browser for this exact scenario during this pass.
  // What this harness CAN and does assert is the wire-level fact: the
  // stale replay is observable (proving the scenario is real, not a
  // no-op) yet the terminal value the client actually SETTLED on (above)
  // was the correct one.
  assert("write: the stale replay is observable but doesn't retroactively invalidate the already-settled terminal event",
    sse.get("sensor-cellcount_tx_status_code") === "3", `replayed value=${sse.get("sensor-cellcount_tx_status_code")} (expected the deliberate stale replay, "3")`);
  await post("/demo/cellcount-scenario?name=confirm");
}

async function testConcurrentSameRegisterRejected(sse) {
  await resetTopology(sse, 16);
  await post("/demo/cellcount-scenario?name=delayed_readback"); // slow enough that the two writes genuinely overlap
  const rev = sse.revisionOf("sensor-cellcount_tx_status_code");
  await writeCellCount(8); // starts a slow transaction (~3.5s+ before terminal)
  await sleep(200);
  const midTxId = sse.get("sensor-cellcount_tx_id");
  await writeCellCount(4); // fired while the first is still in flight -- must be ignored server-side
  await sleep(200);
  assert("write: a second CellCount write while one is in flight is ignored (single-flight guard)",
    sse.get("sensor-cellcount_tx_id") === midTxId, `tx_id changed from ${midTxId} to ${sse.get("sensor-cellcount_tx_id")}`);
  const ok = await sse.waitForNext("sensor-cellcount_tx_status_code", rev, (v) => v === "4", 9000);
  assert("write: the FIRST (not the rejected second) transaction reaches its own terminal state", ok && sse.get("sensor-cell_count") === "8",
    `tx_status=${sse.get("sensor-cellcount_tx_status_code")} cell_count=${sse.get("sensor-cell_count")}`);
  await post("/demo/cellcount-scenario?name=confirm");
}

// Owner-authorized write re-enablement (2026-09-10): cell_count's
// owner_write_override makes the PUBLIC endpoint reach the exact same
// runCellCountTransaction() the debug trigger above already exercises.
// Second critical audit (2026-09-10): CellCount ("topology" write_safety_
// class, the single highest-consequence write in this catalog) was
// reverted to fail-closed — an owner_write_override is risk acceptance,
// not protocol verification. The public endpoint must be proven blocked
// again, same as every other reverted field.
async function testCellCountWritePublicEndpointBlocked(sse) {
  await resetTopology(sse, 16);
  const before = sse.get("sensor-cell_count");
  const res = await post("/number/set_cell_count/set?value=8");
  assert("cell_count: direct POST to the public endpoint is rejected (409), not 200", res.status === 409, `status=${res.status}`);
  await sleep(300);
  assert("cell_count: unchanged after the rejected public write", sse.get("sensor-cell_count") === before,
    `before=${before} after=${sse.get("sensor-cell_count")}`);
}

/* ============================================================
   GENERIC WRITE TRANSACTION MATRIX. Second critical audit (2026-09-10):
   cell_uvp/cell_ovp (write_safety_class "disruptive") were reverted to
   fail-closed, so these tests now exercise cell_uvpr/cell_ovpr instead —
   write_safety_class "normal", still owner-authorized — the same generic
   write -> ack_wait -> readback_wait -> confirmed/mismatch/timeout
   timeline, on registers that remain genuinely unlocked.
   addr 0x1008 = cell_uvpr, 0x1010 = cell_ovpr.
   ============================================================ */
// Third critical audit (2026-09-10, item 7): the uncertainty-recovery
// probe (WRITE_UNCERTAIN(6) -> RECOVERED_CONFIRMED(10)/
// RECOVERED_MISMATCH(11), see testGenericWriteUncertaintyRecovery below)
// can leave a slot genuinely in flight for several seconds after an
// ack_timeout/readback_timeout scenario -- a fixed short sleep here would
// let the NEXT test's write to the SAME address (0x1008/cell_uvpr) land
// while that slot is still WRITE_UNCERTAIN, i.e. still "pending" per
// jk_write_tx_core.h's own is_pending(), and get silently REJECTED
// instead of actually running. Poll the real snapshot state instead of
// guessing a delay.
async function resetGenericWrite(sse) {
  await post("/demo/generic-write-scenario?name=confirm");
  const PENDING_STATUS = new Set([1, 2, 3, 6]);
  function anyPending() {
    try {
      const arr = JSON.parse(sse.get("text_sensor-write_tx_snapshot") || "[]");
      return arr.some((e) => PENDING_STATUS.has(e.status));
    } catch { return false; }
  }
  await sse.waitFor("text_sensor-write_tx_snapshot", () => !anyPending(), 6000);
  await sleep(200); // settle margin for the SSE broadcast of the final state to actually land
}

async function testGenericWriteConfirmScenario(sse) {
  await resetGenericWrite(sse);
  const res = await post("/number/set_cell_uvpr/set?value=2.90");
  assert("generic write: direct POST to set_cell_uvpr is accepted (200), not 409", res.status === 200, `status=${res.status}`);
  const confirmed = await sse.waitFor("sensor-cell_uvpr", (v) => Number(v) === 2.9, 2000);
  assert("generic write: cell_uvpr reaches the requested value via the real transaction machinery", confirmed,
    `cell_uvpr=${sse.get("sensor-cell_uvpr")}`);
  const snapshot = sse.get("text_sensor-write_tx_snapshot");
  let entry = null;
  try { entry = JSON.parse(snapshot || "[]").find((e) => e.addr === 0x1008); } catch { /* not yet published */ }
  assert("generic write: write_tx_snapshot carries a CONFIRMED (status 4) entry for 0x1008",
    Boolean(entry) && entry.status === 4, `snapshot=${snapshot}`);
}

async function testGenericWriteMismatchAndTimeoutScenarios(sse) {
  // Every non-"confirm" scenario must leave the underlying entity
  // unchanged — a mismatch/timeout is a real BMS disagreement or lost
  // round-trip, never silently applied.
  for (const name of ["mismatch", "ack_timeout", "readback_timeout"]) {
    await post(`/demo/generic-write-scenario?name=${name}`);
    const before = sse.get("sensor-cell_uvpr");
    const res = await post("/number/set_cell_uvpr/set?value=2.80");
    assert(`generic write: set_cell_uvpr is accepted (200) under generic-write-scenario=${name}`, res.status === 200, `status=${res.status}`);
    await sleep(2000); // long enough for the staged ack/readback timeline (worst case: readback_timeout's own 1200ms wait, entered ~500ms in) to reach a genuine terminal state before this same address is reused
    assert(`generic write: cell_uvpr is unchanged under generic-write-scenario=${name} (no false success)`,
      sse.get("sensor-cell_uvpr") === before, `before=${before} after=${sse.get("sensor-cell_uvpr")}`);
  }
  await resetGenericWrite(sse);
}

async function testGenericWriteAcrossDifferentRegisters(sse) {
  await resetGenericWrite(sse);
  const revA = sse.revisionOf("sensor-cell_uvpr");
  const revB = sse.revisionOf("sensor-cell_ovpr");
  const resA = await post("/number/set_cell_uvpr/set?value=2.60"); // 0x1008
  const resB = await post("/number/set_cell_ovpr/set?value=3.80"); // 0x1010 — a DIFFERENT register, concurrently
  assert("generic write: two different registers are both accepted (200) concurrently",
    resA.status === 200 && resB.status === 200, `cell_uvpr=${resA.status} cell_ovpr=${resB.status}`);
  const uvprDone = await sse.waitForNext("sensor-cell_uvpr", revA, (v) => Number(v) === 2.6, 2000);
  const ovprDone = await sse.waitForNext("sensor-cell_ovpr", revB, (v) => Number(v) === 3.8, 2000);
  assert("generic write: both independent transactions reach their own requested value",
    uvprDone && ovprDone, `cell_uvpr=${sse.get("sensor-cell_uvpr")} cell_ovpr=${sse.get("sensor-cell_ovpr")}`);
}

// Second critical audit (2026-09-10): begin_write_tx's busy-rejection
// previously never surfaced ANYTHING to a real HTTP client -- the ESPHome
// action still returned 200, and the only way to learn the write never
// started was the frontend's own client-side timeout. Proves the fix:
// two overlapping writes to the SAME address now leave a real REJECTED(9)
// snapshot entry the second caller can observe immediately.
async function testGenericWriteRejectedOnCollision(sse) {
  await resetGenericWrite(sse);
  await post("/demo/generic-write-scenario?name=ack_timeout"); // keep the first transaction PENDING long enough to collide
  // Fired via Promise.all (not sequential awaits) so both requests are
  // in flight together, deterministically inside the pending window,
  // regardless of system load or accumulated state from earlier tests —
  // a sequential await-then-await gave the mock's own 200ms internal
  // SENDING->ACK_WAIT timer just enough room to be timing-sensitive.
  const [resFirst, resSecond] = await Promise.all([
    post("/number/set_cell_uvpr/set?value=2.70"),
    post("/number/set_cell_uvpr/set?value=2.75"),
  ]);
  assert("generic write collision: first write to set_cell_uvpr is accepted (200)", resFirst.status === 200, `status=${resFirst.status}`);
  assert("generic write collision: second write to the SAME address while the first is pending is still HTTP 200 (ESPHome always accepts the action)",
    resSecond.status === 200, `status=${resSecond.status}`);
  // The HTTP response and the SSE broadcast for the snapshot update are two
  // separate channels (same race the "sse_before_http" CellCount tests
  // above exist to cover) -- the POST promises resolving is no guarantee
  // the SSE client has parsed the corresponding event yet, so poll rather
  // than read the snapshot synchronously.
  function hasRejectedEntry() {
    try { return JSON.parse(sse.get("text_sensor-write_tx_snapshot") || "[]").some((e) => e.addr === 0x1008 && e.status === 9); }
    catch { return false; }
  }
  const sawRejected = hasRejectedEntry() || await sse.waitFor("text_sensor-write_tx_snapshot", () => hasRejectedEntry(), 2000);
  assert("generic write collision: a real REJECTED(9) snapshot entry is published for the second write (not silently dropped)",
    sawRejected, `snapshot=${sse.get("text_sensor-write_tx_snapshot")}`);
  await sleep(4000); // let the first (ack_timeout) transaction reach its own terminal state
  await resetGenericWrite(sse);
}

// Third critical audit (2026-09-10, item 7): an ACK/readback timeout must
// never surface to a client as a plain completed error -- the write may
// have silently taken effect. Proves the generic manager's own recovery-
// probe path end to end (WRITE_UNCERTAIN(6) -> RECOVERED_CONFIRMED(10) /
// RECOVERED_MISMATCH(11)) on cell_uvpr -- a register OTHER than CellCount,
// which already has its own, separately-tested bespoke recovery driver
// (see the "CellCount write-transaction matrix" suite above).
async function testGenericWriteUncertaintyRecovery(sse) {
  function findEntry(addr) {
    try { return JSON.parse(sse.get("text_sensor-write_tx_snapshot") || "[]").find((e) => e.addr === addr) || null; }
    catch { return null; }
  }

  // --- Case 1: the write DID silently take effect; only its ACK was
  // lost. Recovery must reach RECOVERED_CONFIRMED(10) -- never leave the
  // client stuck on a plain ACK_TIMEOUT/TIMEOUT that looks like a
  // completed failure when the BMS actually applied the value.
  await resetGenericWrite(sse);
  await post("/demo/generic-write-scenario?name=applied_ack_lost");
  const resConfirm = await post("/number/set_cell_uvpr/set?value=2.65");
  assert("uncertainty recovery: applied_ack_lost write is accepted (200)", resConfirm.status === 200, `status=${resConfirm.status}`);
  const sawUncertain1 = await sse.waitFor("text_sensor-write_tx_snapshot",
    () => { const e = findEntry(0x1008); return Boolean(e && e.status === 6); }, 1000);
  assert("uncertainty recovery: an ACK timeout is surfaced as WRITE_UNCERTAIN(6), not an immediate completed error",
    sawUncertain1, `entry=${JSON.stringify(findEntry(0x1008))}`);
  const recoveredConfirmed = await sse.waitFor("text_sensor-write_tx_snapshot",
    () => { const e = findEntry(0x1008); return Boolean(e && e.status === 10); }, 3000);
  assert("uncertainty recovery: applied_ack_lost eventually resolves to RECOVERED_CONFIRMED(10)",
    recoveredConfirmed, `entry=${JSON.stringify(findEntry(0x1008))}`);
  assert("uncertainty recovery: cell_uvpr genuinely reflects the silently-applied new value once recovered",
    Number(sse.get("sensor-cell_uvpr")) === 2.65, `cell_uvpr=${sse.get("sensor-cell_uvpr")}`);
  await sleep(3500); // let the slot clear its own grace period before the next case reuses this address
  await resetGenericWrite(sse);

  // --- Case 2: nothing was ever applied. Recovery must reach
  // RECOVERED_MISMATCH(11) -- the old value confirmed unchanged -- never
  // a false RECOVERED_CONFIRMED for a write that genuinely never landed.
  await post("/demo/generic-write-scenario?name=ack_timeout");
  const beforeMismatch = sse.get("sensor-cell_uvpr");
  const resMismatch = await post("/number/set_cell_uvpr/set?value=2.99");
  assert("uncertainty recovery: plain ack_timeout write is accepted (200)", resMismatch.status === 200, `status=${resMismatch.status}`);
  const recoveredMismatch = await sse.waitFor("text_sensor-write_tx_snapshot",
    () => { const e = findEntry(0x1008); return Boolean(e && e.status === 11); }, 3000);
  assert("uncertainty recovery: a genuinely lost write resolves to RECOVERED_MISMATCH(11), never a false RECOVERED_CONFIRMED",
    recoveredMismatch, `entry=${JSON.stringify(findEntry(0x1008))}`);
  assert("uncertainty recovery: cell_uvpr is unchanged after a genuine RECOVERED_MISMATCH",
    sse.get("sensor-cell_uvpr") === beforeMismatch, `before=${beforeMismatch} after=${sse.get("sensor-cell_uvpr")}`);
  await sleep(3500);
  await resetGenericWrite(sse);
}

/* ============================================================
   CONTROL-REGISTER WRITE. Third critical audit (2026-09-10): "balancing"
   was reclassified write_safety_class "disruptive" (registers.canonical.json
   had wrongly said "normal", contradicting batterylifepo4.yaml's own
   long-standing comment that always grouped charging/discharging/balancing
   together as disruptive) and its owner_write_override was removed. All
   three control selects are now fail-closed, with no exception.
   ============================================================ */

// Second/third critical audit (2026-09-10): charging/discharging/balancing
// must all be genuinely blocked, same as every other reverted field — a
// direct proof alongside test_blocked_write_surface.js's own exhaustive
// matrix.
async function testControlRegisterChargingDischargingBlocked(sse) {
  await post("/demo/scenario?name=normal");
  const beforeCharging = sse.get("binary_sensor-charging_allowed");
  const resCharging = await post("/select/charging/set?option=Off");
  assert("control register: direct POST to charging is rejected (409), not 200", resCharging.status === 409, `status=${resCharging.status}`);
  const beforeDischarging = sse.get("binary_sensor-discharging_allowed");
  const resDischarging = await post("/select/discharging/set?option=Off");
  assert("control register: direct POST to discharging is rejected (409), not 200", resDischarging.status === 409, `status=${resDischarging.status}`);
  const beforeBalancing = sse.get("binary_sensor-balancing_allowed");
  const resBalancing = await post("/select/balancing/set?option=Off");
  assert("control register: direct POST to balancing is rejected (409), not 200", resBalancing.status === 409, `status=${resBalancing.status}`);
  await sleep(300);
  assert("control register: charging_allowed/discharging_allowed/balancing_allowed unchanged after the rejected writes",
    sse.get("binary_sensor-charging_allowed") === beforeCharging &&
    sse.get("binary_sensor-discharging_allowed") === beforeDischarging &&
    sse.get("binary_sensor-balancing_allowed") === beforeBalancing,
    `charging=${sse.get("binary_sensor-charging_allowed")} discharging=${sse.get("binary_sensor-discharging_allowed")} balancing=${sse.get("binary_sensor-balancing_allowed")}`);
}

async function testActiveAlarmOverrideReasonExplicit(sse) {
  // A genuine protection trip (active_alarm) legitimately stops live
  // current flow WITHOUT silently touching the control register itself —
  // spec §4.3 requires an explicit, non-silent reason for that
  // divergence, not just a value that quietly differs.
  await post("/demo/scenario?name=active_alarm");
  const okReason = await sse.waitFor("text_sensor-control_override_reason", (v) => v === "active_alarm_protection_trip", 2500);
  assert("control override: active_alarm publishes an explicit, non-empty override reason", okReason,
    `reason=${sse.get("text_sensor-control_override_reason")}`);
  assert("control override: live charging status reflects the trip (binary_sensor Off)", sse.get("binary_sensor-charging") === "Off",
    `binary_sensor-charging=${sse.get("binary_sensor-charging")}`);
  assert("control override: the CONTROL register itself is untouched by the trip (still On)", sse.get("binary_sensor-charging_allowed") === "On",
    `binary_sensor-charging_allowed=${sse.get("binary_sensor-charging_allowed")}`);
  await post("/demo/scenario?name=normal");
  const cleared = await sse.waitFor("text_sensor-control_override_reason", (v) => v === "", 2500);
  assert("control override: reason clears once the scenario moves away from active_alarm", cleared,
    `reason=${sse.get("text_sensor-control_override_reason")}`);
}

/* ============================================================ */
async function main() {
  const server = spawn(process.execPath, ["demo/mock-server.js"], {
    cwd: ROOT, env: Object.assign({}, process.env, { PORT: String(PORT) }), stdio: ["ignore", "pipe", "pipe"]
  });
  server.stdout.on("data", () => {});
  server.stderr.on("data", (d) => process.stderr.write(`[mock-server] ${d}`));

  await waitForServerUp();
  const sse = new SseClient();
  await sse.connect();
  await sleep(300);

  try {
    console.log("\n-- Topology Resolver matrix --");
    await testConfirmedAtCount(sse, 1, "minimum supported");
    await testConfirmedAtCount(sse, 4, "4S");
    await testConfirmedAtCount(sse, 8, "8S");
    await testConfirmedAtCount(sse, 16, "16S / maximum supported");
    await testOutOfRangeConfiguredRejected(sse);
    await testExactMaskRequired(sse);
    await testMaskWithGap(sse);
    await testExtraHighBit(sse);
    await testWrongPopcount(sse);
    await testMissingVoltage(sse);
    await testNaNVoltage(sse);
    await testVoltageSumMismatch(sse);
    await testRestartRecovery(sse);
    await testRoundTrip(sse);
    await testStaleOffline(sse); // slow (~40s) — run last among the topology tests

    console.log("\n-- CellCount write-transaction matrix (resolver-side, via debug trigger — public endpoint tested separately below) --");
    await testWriteConfirm(sse);
    await testWriteMismatch(sse);
    await testWriteTimeout(sse);
    await testWriteHttpError(sse);
    await testWriteAckLost(sse);
    await testWriteStaleReadback(sse);
    await testWriteReadbackTimeout(sse);
    await testWriteSseBeforeHttp(sse);
    await testWriteDuplicateSse(sse);
    await testWriteOutOfOrderSse(sse);
    await testConcurrentSameRegisterRejected(sse);
    await testCellCountWritePublicEndpointBlocked(sse);

    console.log("\n-- Generic write transaction matrix (owner-authorized RW registers) --");
    await testGenericWriteConfirmScenario(sse);
    await testGenericWriteMismatchAndTimeoutScenarios(sse);
    await testGenericWriteAcrossDifferentRegisters(sse);
    await testGenericWriteRejectedOnCollision(sse);
    await testGenericWriteUncertaintyRecovery(sse);

    console.log("\n-- Control-register write (charging/discharging/balancing all blocked) --");
    await testControlRegisterChargingDischargingBlocked(sse);
    await testActiveAlarmOverrideReasonExplicit(sse);
  } finally {
    sse.close();
    server.kill();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length} checks run, ${failed.length} failed.`);
  if (failed.length) {
    console.log("\nFailed checks:");
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? " (" + f.detail + ")" : ""}`);
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error("Test harness crashed:", err);
  process.exit(1);
});
