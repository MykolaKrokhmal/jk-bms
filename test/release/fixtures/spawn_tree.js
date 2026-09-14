#!/usr/bin/env node
"use strict";
/*
 * Test fixture for process-tree-kill verification
 * (test/protocol_catalog/test_release_runner.js). Spawns a 3-level tree —
 * this process (parent) -> child -> grandchild — where the grandchild also
 * binds a TCP port and never exits on its own, so a test can prove that
 * killing the orchestrator's step-level process (this one, the parent)
 * actually reaches the whole tree, INCLUDING that the port stops being
 * listened on — not just the direct child.
 *
 * Usage: node spawn_tree.js <pidfile> <level> [port]
 *   level: "parent" | "child" | "grandchild"
 * Each level appends "<level>:<pid>\n" to <pidfile> as soon as it's ready
 * (grandchild: only after its listen() callback fires, so the test never
 * observes a false "ready" before the port is actually bound), then just
 * waits (via an unref'd-nothing long interval, so it stays alive
 * indefinitely until killed).
 */
const fs = require("fs");
const net = require("net");
const path = require("path");
const { spawn } = require("child_process");

const [, , pidfile, level, portArg] = process.argv;
if (!pidfile || !level) {
  console.error("usage: spawn_tree.js <pidfile> <parent|child|grandchild> [port]");
  process.exit(2);
}

function announce() {
  fs.appendFileSync(pidfile, `${level}:${process.pid}\n`);
}

function idleForever() {
  setInterval(() => {}, 1 << 30);
}

if (level === "parent") {
  const child = spawn(process.execPath, [__filename, pidfile, "child", portArg || ""], {
    stdio: "inherit",
    // Deliberately NOT detached — this is the same-process-group case a
    // real production step's own subprocesses would be in, which is
    // exactly the case the orchestrator's group-kill needs to reach.
  });
  announce();
  child.on("exit", () => process.exit(0));
  idleForever();
} else if (level === "child") {
  const grandchild = spawn(process.execPath, [__filename, pidfile, "grandchild", portArg || ""], { stdio: "inherit" });
  announce();
  grandchild.on("exit", () => process.exit(0));
  idleForever();
} else if (level === "grandchild") {
  const port = Number(portArg) || 0;
  if (port) {
    const srv = net.createServer();
    srv.listen(port, "127.0.0.1", () => {
      announce();
      idleForever();
    });
    srv.on("error", (err) => {
      console.error(`grandchild failed to bind port ${port}: ${err.message}`);
      process.exit(1);
    });
  } else {
    announce();
    idleForever();
  }
} else {
  console.error(`unknown level: ${level}`);
  process.exit(2);
}
