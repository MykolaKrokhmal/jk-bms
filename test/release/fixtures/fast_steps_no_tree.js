"use strict";
// Like fast_steps.js but without the never-exiting spawn-tree step — for
// scenarios that don't need process-tree-kill (nominal pass, force-skip,
// force-fail), so they complete in well under a second instead of relying
// on a timeout to end the run.
const path = require("path");

function buildSteps({ repoRoot }) {
  const node = process.execPath;
  return [
    { name: "fixture: quick pass A", command: node, args: ["-e", "process.exit(0)"], cwd: repoRoot },
    { name: "fixture: quick pass B", command: node, args: ["-e", "process.exit(0)"], cwd: repoRoot },
    { name: "fixture: quick pass C", command: node, args: ["-e", "process.exit(0)"], cwd: repoRoot },
  ];
}

module.exports = { buildSteps };
