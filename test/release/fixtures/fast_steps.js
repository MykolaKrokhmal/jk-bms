"use strict";
/*
 * Tiny synthetic step list for test/protocol_catalog/test_release_runner.js
 * — lets that test exercise the REAL test/release/cli.js end-to-end
 * (workbook gate, timeout handling, signal handling, non-mutation guard,
 * summary/exit-code policy) via JK_BMS_RELEASE_STEPS_MODULE, without ever
 * running the actual (slow, C++-compiling, socket-binding) JK BMS release
 * suite from test/release/steps.js — that would be both slow and exactly
 * the kind of recursive full-release-run this fixture exists to avoid.
 */
const path = require("path");

function buildSteps({ repoRoot }) {
  const node = process.execPath;
  const fixturesDir = path.join(__dirname);
  return [
    { name: "fixture: quick pass A", command: node, args: ["-e", "process.exit(0)"], cwd: repoRoot },
    { name: "fixture: quick pass B", command: node, args: ["-e", "process.exit(0)"], cwd: repoRoot },
    { name: "fixture: spawn-tree (parent/child/grandchild + port)", command: node, args: [path.join(fixturesDir, "spawn_tree.js"), process.env.JK_BMS_FIXTURE_PIDFILE || path.join(repoRoot, ".fixture-pids"), "parent", process.env.JK_BMS_FIXTURE_PORT || ""], cwd: repoRoot },
  ];
}

module.exports = { buildSteps };
