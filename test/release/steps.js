"use strict";
/*
 * The JK BMS project's actual release-gate step list — kept separate from
 * test/release/orchestrator.js (the reusable engine) so
 * test/protocol_catalog/test_release_runner.js can test the engine against
 * cheap synthetic steps without running this entire (expensive, C++-
 * compiling, socket-binding) list recursively inside itself.
 *
 * IMPORTANT (Work 4 of the Stage 1 corrective pass): this list runs
 * `pipeline.js check`, never `pipeline.js build`. Release verification
 * must prove the repository's CURRENT state is already fully consistent —
 * it must never regenerate stale artifacts and then report the
 * now-regenerated state as if it had already been green. Controlled
 * regeneration is a separate, explicitly-named, deliberately-invoked
 * action: `node tools/protocol/pipeline.js build --workbook <path>` (see
 * test/regenerate_protocol_artifacts.sh), never part of this list.
 */
const path = require("path");

function buildSteps({ repoRoot, buildDir, workbookPath, testPort }) {
  const node = process.execPath;
  const env = { ...process.env, TEST_PORT: String(testPort) };
  const p = (...parts) => path.join(repoRoot, ...parts);
  const bin = (name) => path.join(buildDir, name);

  return [
    {
      name: "jk_write_tx_core: compile",
      command: "g++",
      args: ["-std=c++17", "-Wall", "-Wextra", "-I", p("components/jk_write_tx"),
        p("test/jk_write_tx/test_jk_write_tx_core.cpp"), "-o", bin("test_jk_write_tx_core")],
      cwd: repoRoot, env,
    },
    { name: "jk_write_tx_core: run", command: bin("test_jk_write_tx_core"), args: [], cwd: repoRoot, env },
    {
      name: "jk_history_format: compile",
      command: "g++",
      args: ["-std=c++17", "-Wall", "-Wextra", "-I", p("components/jk_history"),
        p("test/jk_history/test_jk_history_format.cpp"), p("components/jk_history/jk_history_format.cpp"),
        "-o", bin("test_jk_history_format")],
      cwd: repoRoot, env,
    },
    { name: "jk_history_format: run", command: bin("test_jk_history_format"), args: [], cwd: repoRoot, env },

    { name: "protocol catalog: schema + semantic + cross-file validator", command: node, args: [p("test/register_catalog/validate.js")], cwd: repoRoot, env },
    { name: "protocol catalog: packed-register codec round-trip tests", command: node, args: [p("test/protocol_catalog/test_packed_codec.js")], cwd: repoRoot, env },
    { name: "protocol catalog: negative validator fixtures", command: node, args: [p("test/protocol_catalog/test_negative_fixtures.js")], cwd: repoRoot, env },
    { name: "protocol catalog: generator determinism (--check)", command: node, args: [p("tools/protocol/generate.js"), "--check"], cwd: repoRoot, env },
    { name: "protocol catalog: generation atomicity + simulated-failure detection", command: node, args: [p("test/protocol_catalog/test_generation_atomicity.js")], cwd: repoRoot, env },
    { name: "protocol catalog: exhaustive blocked/unlocked write surface", command: node, args: [p("test/protocol_catalog/test_blocked_write_surface.js")], cwd: repoRoot, env },
    { name: "protocol catalog: fingerprint-drift regression", command: node, args: [p("test/protocol_catalog/test_fingerprint_drift_regression.js")], cwd: repoRoot, env },

    // Non-mutating fingerprint check (Work 2): read-only, no workbook needed.
    { name: "protocol catalog: implementation fingerprint (check, non-mutating)", command: node, args: [p("tools/protocol/fingerprint.js"), "check"], cwd: repoRoot, env },

    // The evidence pipeline itself — CHECK ONLY. Never `build` here (Work 4):
    // release verification must fail on a stale repository, not silently
    // repair it and then report green. The V1 workbook is optional (Work 3
    // of the final preparation pass): the repo-committed V2 workbook is
    // sufficient for the standard, self-contained check; when
    // JK_BMS_WORKBOOK_PATH is also set, it's passed through as an
    // additional revalidation layer over the legacy V1 evidence index.
    {
      name: workbookPath
        ? "protocol catalog: single-pipeline orchestrator (check, with workbook)"
        : "protocol catalog: single-pipeline orchestrator (check, self-contained)",
      command: node,
      args: workbookPath
        ? [p("tools/protocol/pipeline.js"), "check", "--workbook", workbookPath]
        : [p("tools/protocol/pipeline.js"), "check"],
      cwd: repoRoot, env,
    },

    { name: "protocol catalog: entity/wire-ID collision regression", command: node, args: [p("test/protocol_catalog/test_entity_id_collision.js")], cwd: repoRoot, env },
    { name: "protocol catalog: secret-leakage scan", command: node, args: [p("test/protocol_catalog/test_secret_scan.js")], cwd: repoRoot, env },
    { name: "protocol catalog: claim-matrix exact-set invariant", command: node, args: [p("test/protocol_catalog/test_claim_matrix_invariant.js")], cwd: repoRoot, env },
    { name: "protocol catalog: mixed-generation artifact rejection", command: node, args: [p("test/protocol_catalog/test_mixed_generation_rejection.js")], cwd: repoRoot, env },

    { name: "JS syntax check: jk_bms.js", command: node, args: ["--check", p("jk_bms.js")], cwd: repoRoot, env },
    { name: "JS syntax check: demo/mock-server.js", command: node, args: ["--check", p("demo/mock-server.js")], cwd: repoRoot, env },
    { name: "JS syntax check: demo/panel.js", command: node, args: ["--check", p("demo/panel.js")], cwd: repoRoot, env },
    { name: "JS syntax check: test/topology/run.js", command: node, args: ["--check", p("test/topology/run.js")], cwd: repoRoot, env },

    { name: "topology + write-transaction integration suite", command: node, args: [p("test/topology/run.js")], cwd: repoRoot, env },
    { name: "release runner: ephemeral port allocation", command: node, args: [p("test/protocol_catalog/test_port_allocation.js")], cwd: repoRoot, env },
    { name: "release runner: orchestration engine regression", command: node, args: [p("test/protocol_catalog/test_release_runner.js")], cwd: repoRoot, env },
  ];
}

module.exports = { buildSteps };
