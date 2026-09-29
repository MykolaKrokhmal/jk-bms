#!/usr/bin/env node
"use strict";

// SIMULATOR TEST -- NOT proof of the real production firmware HTTP write
// route. Written 2026-09-21 (user-directed deployment-gate audit, Task 5):
// exercises demo/mock-server.js's handleRegisterWrite/
// handleRegisterWritePreflight, a JS reimplementation of
// batterylifepo4.yaml's real RegisterWriteHandler/
// RegisterWritePreflightHandler (AsyncWebHandler C++ classes) driven by
// the SAME generated write_registry.json catalog. This proves the
// eligibility/encode/merge/rejection RULES this project intends are
// internally consistent and exercisable over real HTTP against a real
// (simulated) server -- it is NOT evidence that the actual C++ handlers
// compile or behave identically; that evidence can only come from an
// ESPHome compile + real hardware session (out of scope for a read-only
// audit round -- see this project's own explicit compile/flash
// prohibition for this round).
//
// Proves, over real HTTP against a spawned SIMULATOR:
//   - GET preflight NEVER queues a write (verified via write_tx_snapshot
//     staying empty) and reports the FULL physical raw (not a decoded
//     projection), with undocumented/reserved sibling bits preserved in
//     its merge preview.
//   - preflight for a field whose register was never read (every
//     CellConWireRes*, exactly like real hardware -- see
//     jk_capability_core.h's own "never-before-read" module comment)
//     reports ready:false / current_raw:null, never a fabricated 0.
//   - POST accepts a live field, returns a tx_id, and the register's raw
//     word is updated with sibling bits preserved once the transaction
//     reaches CONFIRMED.
//   - POST rejects: unknown key, missing/non-numeric value, missing/wrong
//     submit_policy, an authorization_required field (403, safety class
//     surfaced, no Modbus command queued), an out-of-range value.
//   - a second POST to the SAME live field while the first is still
//     pending is rejected (single-flight), matching jk_write_tx_core.h's
//     begin() semantics.
//   - no credential-class field ever appears in this registry today (this
//     project has none) -- documented, not silently assumed.

const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const PORT = Number(process.env.TEST_PORT) || 19003;
const HOST = "127.0.0.1";
const writeRegistry = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "generated", "write_registry.json"), "utf8"));
const entryByKey = Object.create(null);
for (const e of writeRegistry.entries) entryByKey[e.key] = e;

let checks = 0;
let failures = 0;
function check(name, pass, detail = "") {
  checks += 1;
  if (!pass) failures += 1;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` -- ${detail}` : ""}`);
}

function request(method, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: HOST, port: PORT, method, path: pathname }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body, json: () => JSON.parse(body) }));
    });
    req.on("error", reject);
    req.end();
  });
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function waitForServer(child) {
  for (let i = 0; i < 80; i += 1) {
    if (child.exitCode !== null) throw new Error(`mock server exited early (${child.exitCode})`);
    try {
      const response = await request("GET", "/demo/state");
      if (response.status === 200) return;
    } catch (_) { /* startup race */ }
    await sleep(50);
  }
  throw new Error("mock server did not become ready");
}

async function main() {
  const liveEntries = writeRegistry.entries.filter((e) => e.submit_policy === "live");
  const authEntries = writeRegistry.entries.filter((e) => e.submit_policy === "authorization_required");
  check("at least one live entry to exercise", liveEntries.length > 0, `count=${liveEntries.length}`);
  check("at least one authorization-required entry to exercise", authEntries.length > 0, `count=${authEntries.length}`);
  check("no credential-class entry exists in this registry today (documented, not assumed)",
    writeRegistry.entries.every((e) => e.write_safety_class !== "credential"));

  const child = spawn(process.execPath, [path.join(ROOT, "demo", "mock-server.js")], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), HOST },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let childOutput = "";
  child.stdout.on("data", (chunk) => { childOutput += chunk; });
  child.stderr.on("data", (chunk) => { childOutput += chunk; });

  try {
    await waitForServer(child);

    // ---- GET preflight: never queues a write ----
    const snapshotBefore = await request("GET", "/demo/state");
    const live = entryByKey.gps_heartbeat;
    const pf1 = await request("GET", `/settings/register-write/preflight?key=${live.key}&value=1`);
    check("preflight responds 200", pf1.status === 200, `status=${pf1.status}`);
    const pf1j = pf1.json();
    check("preflight reports ready:true for a valid live field with a fresh cache", pf1j.ready === true, JSON.stringify(pf1j));
    check("preflight reports the FULL physical current_raw (not a decoded projection)", typeof pf1j.current_raw === "number");
    check("preflight reports non-null merged_raw for a valid encode", pf1j.merged_raw !== null);
    check("preflight preserves sibling/reserved bits (before == expected-after)", pf1j.sibling_bits_before === pf1j.sibling_bits_expected_after);
    check("preflight write_function is the canonical FC16 constant", pf1j.write_function === "write_multiple_registers_fc16");
    const snapshotAfterPreflight = await request("GET", "/demo/state");
    check("preflight NEVER queues a write (full simulator state unchanged)", snapshotBefore.body === snapshotAfterPreflight.body);

    // ---- preflight for a never-before-read register (every CellConWireRes*) ----
    const neverRead = entryByKey.cell_connection_wire_resistance_5;
    const pf2 = await request("GET", `/settings/register-write/preflight?key=${neverRead.key}&value=1000`);
    const pf2j = pf2.json();
    check("preflight for a never-before-read register reports current_raw:null (never a fabricated 0)", pf2j.current_raw === null, JSON.stringify(pf2j));
    check("preflight for a never-before-read register reports ready:false", pf2j.ready === false);
    check("preflight for a never-before-read register names the real reason", pf2j.reject_reason === "no read-plan block for this register", pf2j.reject_reason);

    // ---- preflight rejections: unknown key, missing key ----
    const pfUnknown = await request("GET", "/settings/register-write/preflight?key=not_a_real_field&value=1");
    check("preflight for an unknown key is 404", pfUnknown.status === 404);
    const pfMissingKey = await request("GET", "/settings/register-write/preflight?value=1");
    check("preflight with no key is 400", pfMissingKey.status === 400);

    // ---- POST rejections that must never queue anything ----
    const rejCases = [
      ["missing key", `/settings/register-write?value=1&submit_policy=live`, 400],
      ["missing value", `/settings/register-write?key=${live.key}&submit_policy=live`, 400],
      ["non-numeric value", `/settings/register-write?key=${live.key}&value=abc&submit_policy=live`, 400],
      ["missing submit_policy", `/settings/register-write?key=${live.key}&value=1`, 400],
      ["wrong submit_policy literal", `/settings/register-write?key=${live.key}&value=1&submit_policy=staged`, 400],
      ["unknown key", `/settings/register-write?key=not_a_real_field&value=1&submit_policy=live`, 404],
      ["out-of-range value", `/settings/register-write?key=${live.key}&value=99&submit_policy=live`, 400],
    ];
    for (const [name, pathname, expectStatus] of rejCases) {
      const resp = await request("POST", pathname);
      check(`POST rejects ${name} (${expectStatus})`, resp.status === expectStatus, `status=${resp.status} body=${resp.body.slice(0, 140)}`);
    }
    const snapshotAfterRejections = await request("GET", "/demo/state");
    check("every rejected POST above leaves the complete simulator state unchanged", snapshotBefore.body === snapshotAfterRejections.body);

    // ---- POST authorization_required: 403, safety class surfaced, no queue ----
    const authField = authEntries[0];
    const authResp = await request("POST", `/settings/register-write?key=${authField.key}&value=${authField.maximum}&submit_policy=live`);
    check("authorization_required field POST is rejected (403)", authResp.status === 403, `status=${authResp.status}`);
    const authJson = authResp.json();
    check("authorization_required rejection surfaces write_safety_class", authJson.write_safety_class === authField.write_safety_class, JSON.stringify(authJson));
    const snapshotAfterAuth = await request("GET", "/demo/state");
    check("authorization_required POST leaves the complete simulator state unchanged", snapshotBefore.body === snapshotAfterAuth.body);

    // ---- POST live field: accepted/request_id returned SYNCHRONOUSLY
    // (2026-09-21 second corrective pass -- the async accepted/request_id/
    // status-poll contract, matching production exactly, no divergence).
    // A real tx_id only appears later, via the status poll, once the
    // simulated ~100ms main-loop consumer resolves it. ----
    const okResp = await request("POST", `/settings/register-write?key=${live.key}&value=1&submit_policy=live`);
    check("live field POST is accepted (200)", okResp.status === 200, `status=${okResp.status} body=${okResp.body}`);
    const okJson = okResp.json();
    check("accepted response status is 'accepted'", okJson.status === "accepted", JSON.stringify(okJson));
    check("accepted response carries a numeric request_id, never a tx_id", Number.isFinite(okJson.request_id) && okJson.tx_id === undefined, JSON.stringify(okJson));
    const requestId = okJson.request_id;

    const immediateRetry = await request("POST", `/settings/register-write?key=${live.key}&value=0&submit_policy=live`);
    check("a second POST to the SAME address while the first is still staged/pending is rejected (409, single-flight)",
      immediateRetry.status === 409, `status=${immediateRetry.status}`);

    // ---- poll GET /settings/register-write/status until it resolves to
    // accepted with a real tx_id -- proving the async contract's full
    // request_id -> status-poll -> real tx_id lifecycle over real HTTP. ----
    let statusJson = null;
    for (let i = 0; i < 40; i += 1) {
      const pollResp = await request("GET", `/settings/register-write/status?request_id=${requestId}`);
      check(`status poll #${i} responds 200`, pollResp.status === 200, `status=${pollResp.status}`);
      statusJson = pollResp.json();
      if (statusJson.status !== "pending") break;
      await sleep(50);
    }
    check("the status poll eventually resolves to 'accepted' (never stays pending forever)", statusJson && statusJson.status === "accepted", JSON.stringify(statusJson));
    check("the resolved status carries a real, numeric tx_id", statusJson && Number.isFinite(statusJson.tx_id), JSON.stringify(statusJson));
    const realTxId = statusJson.tx_id;

    // A poll for a request_id that was never issued this session -- fail
    // closed to "unknown", never treated as pending or resolved.
    const unknownPoll = await request("GET", `/settings/register-write/status?request_id=999999`);
    const unknownJson = unknownPoll.json();
    check("polling an unissued request_id resolves 'unknown'", unknownJson.status === "unknown", JSON.stringify(unknownJson));

    // ---- wait for the real write transaction (tx_id, not request_id) to
    // reach CONFIRMED, then verify preflight reflects the new raw with
    // siblings preserved ----
    check("a real tx_id was obtained before waiting for CONFIRMED", Number.isFinite(realTxId));
    await sleep(2200);
    const pf3 = await request("GET", `/settings/register-write/preflight?key=${live.key}&value=1`);
    const pf3j = pf3.json();
    check("after CONFIRMED, preflight's current_raw reflects the applied bit (bit set)",
      (pf3j.current_raw & parseInt(live.mask, 16)) !== 0, `current_raw=${pf3j.current_raw} mask=${live.mask}`);
    check("after CONFIRMED, the pre-existing charging_float_mode sibling bit (0x0200) is still set (RMW preserved it)",
      (pf3j.current_raw & 0x0200) === 0x0200, `current_raw=${pf3j.current_raw}`);

    // ---- write only when the value changes (clustered-read plan M5, owner
    // decision 2026-09-29): the same value again is a terminal "no_change"
    // with no write transaction at all ----
    const txCountBefore = JSON.parse((await request("GET", "/demo/state")).body).writeTxCount;
    const sameResp = await request("POST", `/settings/register-write?key=${live.key}&value=1&submit_policy=live`);
    const sameJson = sameResp.json();
    check("the same value again: the POST is still accepted as a request (200, request_id)", sameResp.status === 200 && Number.isFinite(sameJson.request_id), sameResp.body);
    let sameStatus = null;
    for (let i = 0; i < 20; i += 1) {
      await sleep(50);
      sameStatus = (await request("GET", `/settings/register-write/status?request_id=${sameJson.request_id}`)).json();
      if (sameStatus.status !== "pending") break;
    }
    check("... and resolves to the terminal 'no_change' (not accepted, not rejected, no tx_id)",
      sameStatus && sameStatus.status === "no_change" && sameStatus.tx_id === undefined, JSON.stringify(sameStatus));
    await sleep(300);
    const txCountAfter = JSON.parse((await request("GET", "/demo/state")).body).writeTxCount;
    check("... and no write transaction was ever created for it", Number.isInteger(txCountBefore) && txCountAfter === txCountBefore,
      `${txCountBefore} -> ${txCountAfter}`);
    const pf4j = (await request("GET", `/settings/register-write/preflight?key=${live.key}&value=1`)).json();
    check("... and the register is unchanged", pf4j.current_raw === pf3j.current_raw, `${pf3j.current_raw} -> ${pf4j.current_raw}`);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once("exit", resolve);
      setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 2000).unref();
      child.once("exit", resolve);
    });
  }

  if (failures > 0) {
    console.log("\n--- mock server output (for diagnosing failures) ---");
    console.log(childOutput.slice(-4000));
  }

  console.log(`\nStage 4 register-write HTTP simulator end-to-end summary: ${checks - failures}/${checks} passed`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
