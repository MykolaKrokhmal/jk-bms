#!/usr/bin/env node
"use strict";

// Work 9 (Stage 1 corrective pass): test/release/port.js's pickPort().
// See that file's own header comment for the honest scope boundary — this
// proves retry-on-collision and safe concurrent/repeated use of the
// picker itself; it does NOT prove full TOCTOU elimination for
// demo/mock-server.js's own port binding, which is out of scope here (see
// IMPLEMENTATION_EXECUTION_LOG.md, Stage 1 Corrective Pass, Work 9).
const net = require("net");
const path = require("path");
const { pickPort, verifyPortFree } = require(path.join(__dirname, "..", "release", "port.js"));

let checks = 0;
let failures = 0;
function check(name, condition, detail = "") {
  checks += 1;
  if (condition) console.log(`PASS  ${name}${detail ? `  -- ${detail}` : ""}`);
  else { failures += 1; console.log(`FAIL  ${name}${detail ? `  -- ${detail}` : ""}`); }
}

async function main() {
  // --- parallel runs: N concurrent pickPort() calls never collide -----------
  const N = 8;
  const ports = await Promise.all(Array.from({ length: N }, () => pickPort()));
  check(`parallel runs: ${N} concurrent pickPort() calls all succeed`, ports.every((p) => Number.isInteger(p) && p > 0));
  check(`parallel runs: all ${N} picked ports are distinct (no collision)`, new Set(ports).size === N, JSON.stringify(ports));

  // --- repeat runs: picking, using, releasing, then picking again works -----
  for (let i = 0; i < 5; i += 1) {
    const port = await pickPort();
    const srv = net.createServer();
    await new Promise((resolve, reject) => {
      srv.once("error", reject);
      srv.listen(port, "127.0.0.1", resolve);
    });
    await new Promise((resolve) => srv.close(resolve));
    check(`repeat run ${i + 1}/5: pick -> bind -> release succeeds cleanly`, true);
  }

  // --- cleanup after "failure": a port bound then abruptly left (not closed
  // via the graceful srv.close()) is still reusable once the process holding
  // it actually exits (verified here via a genuinely closed socket, since a
  // single Node process can't easily simulate its own crash) -------------
  {
    const port = await pickPort();
    const srv = net.createServer();
    await new Promise((resolve, reject) => { srv.once("error", reject); srv.listen(port, "127.0.0.1", resolve); });
    srv.unref();
    await new Promise((resolve) => srv.close(resolve));
    const freeAfter = await verifyPortFree(port);
    check("cleanup after use: the same port is verifiably free once released", freeAfter);
  }

  // --- requestedPort path: verifies free rather than blindly trusting it ----
  {
    const port = await pickPort();
    const srv = net.createServer();
    await new Promise((resolve, reject) => { srv.once("error", reject); srv.listen(port, "127.0.0.1", resolve); });
    let threw = null;
    try { await pickPort({ requestedPort: port }); } catch (err) { threw = err; }
    check("requestedPort collision: pickPort refuses a port that's actually busy, not a silent success", threw && /PORT_NOT_FREE/.test(threw.message), threw && threw.message);
    await new Promise((resolve) => srv.close(resolve));
    const nowFree = await pickPort({ requestedPort: port });
    check("requestedPort after release: the same requested port is accepted once free", nowFree === port);
  }

  // --- no hardcoded fallback collision: two independent pickPort() calls with
  // NO requestedPort never both resolve to a literal hardcoded default -------
  {
    const a = await pickPort();
    const b = await pickPort();
    check("no hardcoded fallback: two default picks are two different real ephemeral ports, not a shared constant", a !== b, `${a} vs ${b}`);
  }

  console.log(`\n${checks} checks run, ${failures} failed.`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(`TEST_HARNESS_ERROR: ${err.stack || err.message}`);
  process.exit(1);
});
