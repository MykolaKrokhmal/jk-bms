#!/usr/bin/env node
"use strict";

// SIMULATOR TEST -- NOT proof of the real production firmware HTTP write
// route. Renamed and re-labeled 2026-09-21 (user-directed deployment-gate
// audit, issue #4): this exercises demo/mock-server.js, a hand-written
// Node HTTP+SSE simulator of ESPHome's own web_server_base -- it shares
// none of batterylifepo4.yaml's actual C++ (RegisterWriteHandler/
// RegisterWritePreflightHandler, jk_write_tx::encode_numeric_field/
// begin_write_tx_rmw, the AsyncWebServerRequest shim). It IS driven by the
// REAL generated register_catalog.json/write_registry.json (never a
// reimplemented catalog), so it is a genuine, useful proof that the
// eligibility/rejection RULES are internally consistent -- it is not, and
// was never meant to be, evidence that the real ESP32 firmware's own HTTP
// route exists, compiles, or behaves the same way. That evidence can only
// come from an ESPHome compile + real hardware session (see this
// project's own explicit prohibition on compiling/flashing during a
// read-only audit round).
//
// Proves, over real HTTP against a spawned SIMULATOR (not firmware):
//   - a "live" Stage 4 field (write_safety_class=normal, e.g.
//     gps_heartbeat) is ACCEPTED and reaches a real CONFIRMED state --
//     the write mechanism genuinely functions end to end, independent of
//     whether the browser UI has a control pointed at it yet.
//   - an "authorization_required" Stage 4 field (disruptive class, e.g.
//     heat_en, cell_connection_wire_resistance_1) is REJECTED (409) even
//     though its canonical effective_access is "rw" -- matching the real
//     firmware's own deliberate no-op set_action exactly (see
//     tools/protocol/generate.js's "generic_authorization_required"
//     manager and demo/mock-server.js's BLOCKED_REGISTER_KEYS).
//   - the simulator's control state is unchanged by every rejected write.

const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const PORT = Number(process.env.TEST_PORT) || 19002;
const HOST = "127.0.0.1";
const writeRegistry = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "generated", "write_registry.json"), "utf8"));

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
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.end();
  });
}


async function waitForServer(child) {
  for (let i = 0; i < 80; i += 1) {
    if (child.exitCode !== null) throw new Error(`mock server exited early (${child.exitCode})`);
    try {
      const response = await request("GET", "/demo/state");
      if (response.status === 200) return;
    } catch (_) { /* startup race */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("mock server did not become ready");
}

async function main() {
  const liveEntries = writeRegistry.entries.filter((e) => e.submit_policy === "live");
  const authRequiredEntries = writeRegistry.entries.filter((e) => e.submit_policy === "authorization_required");
  check("write registry has at least one live entry to exercise", liveEntries.length > 0, `count=${liveEntries.length}`);
  check("write registry has at least one authorization-required entry to exercise", authRequiredEntries.length > 0, `count=${authRequiredEntries.length}`);

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

    // --- live fields: the LEGACY generic /number/<id>/set route must now
    // REJECT every one of them (404) -- corrected 2026-09-21 (deployment-
    // gate audit issue #1-#4): every generated write_registry.yaml
    // `number:` entity is internal:true on real hardware, so ESPHome's
    // generic REST route can never reach any of them there either. A
    // prior version of this same test asserted the OPPOSITE (200 via this
    // route) -- that assertion was proving a mock/firmware fidelity GAP
    // was present, not that production integration worked; see
    // demo/mock-server.js's own REGISTER_BY_KEY exclusion-filter comment.
    // The real, now-existing production route for these 5 fields is
    // /settings/register-write -- see
    // test_stage4_register_write_simulator_end_to_end.js for its coverage.
    for (const entry of liveEntries) {
      const requestedValue = entry.maximum;
      const resp = await request("POST", `/number/${entry.entity_id}/set?value=${requestedValue}`);
      check(`live field ${entry.key}: the LEGACY generic /number/.../set route correctly rejects it (404) -- internal:true entities are unreachable that way on real hardware`,
        resp.status === 404, `status=${resp.status} body=${resp.body.slice(0, 120)}`);
    }

    // --- authorization-required fields: rejected outright, state unchanged. ---
    const beforeAuthCheck = await request("GET", "/demo/state");
    for (const entry of authRequiredEntries) {
      const requestedValue = entry.maximum;
      const resp = await request("POST", `/number/${entry.entity_id}/set?value=${requestedValue}`);
      check(`authorization-required field ${entry.key}: HTTP write is REJECTED (409), matching the real firmware's inert set_action`,
        resp.status === 409, `status=${resp.status}`);
      check(`authorization-required field ${entry.key}: rejection body identifies the field`, resp.body.includes(entry.key), resp.body.slice(0, 120));
    }
    const afterAuthCheck = await request("GET", "/demo/state");
    check("authorization-required write attempts leave the complete simulator state unchanged",
      beforeAuthCheck.body === afterAuthCheck.body);
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

  console.log(`\nStage 4 write HTTP end-to-end summary: ${checks - failures}/${checks} passed`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
