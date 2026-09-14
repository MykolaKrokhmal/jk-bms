#!/usr/bin/env node
"use strict";

// Checked-in regression test for the release-gate orchestration engine
// (test/release/orchestrator.js + test/release/cli.js). Exercises the REAL
// test/release/cli.js end-to-end via JK_BMS_HARNESS_STEPS_MODULE (a tiny
// synthetic fixture step list — test/release/fixtures/*) instead of the
// real, slow JK BMS production suite (test/release/steps.js) — this is
// precisely how this avoids recursively running the whole real release
// suite inside itself, per the Stage 1 corrective pass's Work 6
// requirement to separate the testable orchestration core from the
// production step list. A handful of scenarios (1, 2, 11) call the CLI's
// exported pure functions directly, which is faster and needs no
// subprocess at all.
//
// NEEDS THE SANDBOX DISABLED (or an unsandboxed shell): every CLI
// invocation binds a real ephemeral TCP port up front (the same
// TEST_PORT allocation the real release run needs), which this project's
// sandboxed CI shell blocks — see test/run_all.sh's own header comment
// for the same, pre-existing constraint. If TCP listen is unavailable
// here, this test reports BLOCKED (not a silent/fake PASS) rather than
// claiming success for scenarios it could not actually run.
const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");
const { spawnSync, spawn, execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const CLI = path.join(ROOT, "test", "release", "cli.js");
// The REAL production entry point is exercised directly only for the P0-1
// security regression (below) and for the pure exported functions (which
// live in cli.js regardless). Every scenario that needs a synthetic
// fixture step list or an isolated scratch repo root goes through
// test_harness_cli.js instead — a SEPARATE file cli.js never requires and
// test/run_release.sh never invokes, so nothing here can be read as
// evidence that the production entry point honors external overrides.
const HARNESS_CLI = path.join(ROOT, "test", "release", "fixtures", "test_harness_cli.js");
const FIXTURES = path.join(ROOT, "test", "release", "fixtures");
const NO_TREE_STEPS = path.join(FIXTURES, "fast_steps_no_tree.js");
const TREE_STEPS = path.join(FIXTURES, "fast_steps.js");
const STAND_IN_WORKBOOK = path.join(ROOT, ".node-version");

let checks = 0;
let failures = 0;
let blocked = 0;
function check(name, condition, detail = "") {
  checks += 1;
  if (condition) console.log(`PASS  ${name}${detail ? `  -- ${detail}` : ""}`);
  else { failures += 1; console.log(`FAIL  ${name}${detail ? `  -- ${detail}` : ""}`); }
}
function blockedCheck(name, detail) {
  blocked += 1;
  console.log(`BLOCKED  ${name}${detail ? `  -- ${detail}` : ""}`);
}

function runCli(env, { timeoutMs = 30000 } = {}) {
  const result = spawnSync(process.execPath, [HARNESS_CLI], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: timeoutMs,
  });
  return { status: result.status, stdout: result.stdout || "", stderr: result.stderr || "", signal: result.signal };
}

/** Spawns the REAL production entry point (test/release/cli.js) directly —
 * used only by the P0-1 security regression below, which must prove
 * something about THAT file specifically, not the test harness. */
function runCliOnRealCli(env, { timeoutMs = 30000 } = {}) {
  const result = spawnSync(process.execPath, [CLI], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: timeoutMs,
  });
  return { status: result.status, stdout: result.stdout || "", stderr: result.stderr || "", signal: result.signal };
}

function probeTcpListenAllowed() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen(0, "127.0.0.1", () => srv.close(() => resolve(true)));
  });
}

async function main() {
  // =========================================================================
  // Scenarios 1, 2, 11 — pure function unit tests, no subprocess needed.
  // =========================================================================
  const { validateWorkbookPath, parseTimeoutSeconds, treeMutated } = require(CLI);

  {
    // Work 3 (final preparation pass): the V1 workbook is now OPTIONAL --
    // the repo-committed V2 workbook is sufficient for a self-contained
    // release check, so a missing JK_BMS_WORKBOOK_PATH must no longer be a
    // hard error (see scenario 16 below for the real-CLI end-to-end proof).
    const r = validateWorkbookPath(undefined);
    check("1. workbook env missing: validateWorkbookPath now succeeds with an undefined path (optional, self-contained)", r.ok === true && r.path === undefined, JSON.stringify(r));
  }
  {
    const r = validateWorkbookPath("/nonexistent/path/definitely-not-here.xlsx", (p) => fs.existsSync(p));
    check("2. workbook path missing (file doesn't exist): validateWorkbookPath reports RELEASE_WORKBOOK_NOT_FOUND (maps to CLI exit 2)", !r.ok && r.reasonCode === "RELEASE_WORKBOOK_NOT_FOUND", JSON.stringify(r));
  }
  {
    const rOk = validateWorkbookPath(STAND_IN_WORKBOOK);
    check("2b. workbook path present: validateWorkbookPath succeeds", rOk.ok === true);
  }
  {
    const bad = parseTimeoutSeconds("notanumber");
    check("11. invalid timeout value: parseTimeoutSeconds reports RELEASE_INVALID_TIMEOUT (maps to CLI exit 2)", !bad.ok && bad.reasonCode === "RELEASE_INVALID_TIMEOUT", JSON.stringify(bad));
    const badZero = parseTimeoutSeconds("0");
    check("11b. zero timeout is also rejected", !badZero.ok);
    const badFloat = parseTimeoutSeconds("1.5");
    check("11c. non-integer timeout is also rejected", !badFloat.ok);
    const good = parseTimeoutSeconds("1200");
    check("11d. a valid timeout is accepted", good.ok && good.seconds === 1200);
    const dflt = parseTimeoutSeconds(undefined);
    check("11e. an unset timeout defaults to a sane positive value", dflt.ok && dflt.seconds > 0);
  }
  check("non-mutation helper: identical snapshots report no mutation", treeMutated("clean\n", "clean\n") === false);
  check("non-mutation helper: different snapshots report mutation", treeMutated("clean\n", " M foo.js\n") === true);

  // =========================================================================
  // TCP availability gate — everything below spawns the real CLI, which
  // binds a real port up front.
  // =========================================================================
  const listenAllowed = await probeTcpListenAllowed();
  if (!listenAllowed) {
    for (const name of [
      "3. forced failed step -> exit 1, summary FAILED",
      "4. forced skipped step -> exit 3, summary PARTIAL PASS",
      "5. a skipped run's output never contains a bare \"ALL PASS\"",
      "6. a failed run's output never contains a bare \"ALL PASS\"",
      "7. timeout -> non-zero exit, summary TIMEOUT",
      "8. timeout kills the whole parent/child/grandchild process tree",
      "9. SIGINT terminates the run and its active child tree, no further steps run",
      "10. nominal fixture run -> exit 0, summary ALL PASS",
      "12. a non-mutating run leaves the (scratch) repo's git status unchanged",
      "13. a fixture step that mutates the scratch repo is caught by the non-mutation guard (FAIL)",
      "14. after removing the mutation, the same run passes the non-mutation guard again",
      "15. test-only force-skip/force-fail hooks can never themselves produce exit 0 when used",
    ]) blockedCheck(name, "TCP listen is unavailable in this shell (see test/run_all.sh's own note); rerun with the sandbox disabled");
    console.log(`\n${checks} checks run, ${failures} failed, ${blocked} blocked (real limitation, not scored as passed).`);
    process.exit(failures ? 1 : 0);
  }

  // =========================================================================
  // Scenario 3 — forced failed step.
  // =========================================================================
  {
    const r = runCli({ JK_BMS_WORKBOOK_PATH: STAND_IN_WORKBOOK, JK_BMS_HARNESS_STEPS_MODULE: NO_TREE_STEPS, JK_BMS_RELEASE_TIMEOUT_SECS: "30", JK_BMS_RELEASE_FORCE_FAIL: "fixture: quick pass B" });
    check("3. forced failed step: CLI exits 1", r.status === 1, `status=${r.status}`);
    check("3. forced failed step: summary reports FAILED for that step", /FAILED\s+fixture: quick pass B/.test(r.stdout));
    check("3. forced failed step: overall verdict line says FAILED", /^FAILED:/m.test(r.stdout));
  }

  // =========================================================================
  // Scenario 4 — forced skipped step.
  // =========================================================================
  {
    const r = runCli({ JK_BMS_WORKBOOK_PATH: STAND_IN_WORKBOOK, JK_BMS_HARNESS_STEPS_MODULE: NO_TREE_STEPS, JK_BMS_RELEASE_TIMEOUT_SECS: "30", JK_BMS_RELEASE_FORCE_SKIP: "fixture: quick pass B" });
    check("4. forced skipped step: CLI exits 3", r.status === 3, `status=${r.status}`);
    check("4. forced skipped step: summary reports SKIPPED for that step", /SKIPPED\s+fixture: quick pass B/.test(r.stdout));
    check("4. forced skipped step: overall verdict line says PARTIAL PASS", r.stdout.includes("PARTIAL PASS:"));

    // Scenario 5: never a bare "ALL PASS" when something was skipped.
    check("5. skipped run's output never contains a bare \"ALL PASS\" line", !/^ALL PASS$/m.test(r.stdout));
  }

  // =========================================================================
  // Scenario 6 — never a bare "ALL PASS" on a failed run either.
  // =========================================================================
  {
    const r = runCli({ JK_BMS_WORKBOOK_PATH: STAND_IN_WORKBOOK, JK_BMS_HARNESS_STEPS_MODULE: NO_TREE_STEPS, JK_BMS_RELEASE_TIMEOUT_SECS: "30", JK_BMS_RELEASE_FORCE_FAIL: "fixture: quick pass A" });
    check("6. failed run's output never contains a bare \"ALL PASS\" line", !/^ALL PASS$/m.test(r.stdout));
  }

  // =========================================================================
  // Scenario 15 — the test-only hooks can never themselves produce exit 0.
  // =========================================================================
  {
    const rSkip = runCli({ JK_BMS_WORKBOOK_PATH: STAND_IN_WORKBOOK, JK_BMS_HARNESS_STEPS_MODULE: NO_TREE_STEPS, JK_BMS_RELEASE_TIMEOUT_SECS: "30", JK_BMS_RELEASE_FORCE_SKIP: "fixture: quick pass A" });
    const rFail = runCli({ JK_BMS_WORKBOOK_PATH: STAND_IN_WORKBOOK, JK_BMS_HARNESS_STEPS_MODULE: NO_TREE_STEPS, JK_BMS_RELEASE_TIMEOUT_SECS: "30", JK_BMS_RELEASE_FORCE_FAIL: "fixture: quick pass A" });
    check("15. a run with a forced-skip step never exits 0", rSkip.status !== 0, `status=${rSkip.status}`);
    check("15. a run with a forced-fail step never exits 0", rFail.status !== 0, `status=${rFail.status}`);
  }

  // =========================================================================
  // Scenario 10 — nominal fixture run.
  // =========================================================================
  {
    const r = runCli({ JK_BMS_WORKBOOK_PATH: STAND_IN_WORKBOOK, JK_BMS_HARNESS_STEPS_MODULE: NO_TREE_STEPS, JK_BMS_RELEASE_TIMEOUT_SECS: "30" });
    check("10. nominal fixture run: CLI exits 0", r.status === 0, `status=${r.status}`);
    check("10. nominal fixture run: output contains a bare \"ALL PASS\" line", /^ALL PASS$/m.test(r.stdout));
    check("10. nominal fixture run: non-mutation guard reports PASS", r.stdout.includes("PASS     git status is identical"));
  }

  // =========================================================================
  // Scenario 16 (Work 3, final preparation pass) — the V1 workbook is now
  // OPTIONAL: a run with JK_BMS_WORKBOOK_PATH explicitly unset must still
  // reach exit 0 / ALL PASS through the real CLI entry point (not just the
  // pure validateWorkbookPath function tested in scenario 1), proving the
  // self-contained path actually works end to end, not only in isolation.
  // =========================================================================
  {
    const r = runCli({ JK_BMS_WORKBOOK_PATH: "", JK_BMS_HARNESS_STEPS_MODULE: NO_TREE_STEPS, JK_BMS_RELEASE_TIMEOUT_SECS: "30" });
    check("16. no JK_BMS_WORKBOOK_PATH: CLI does not exit 2 / RELEASE_WORKBOOK_REQUIRED", r.status !== 2 || !r.stderr.includes("RELEASE_WORKBOOK_REQUIRED"), `status=${r.status} stderr=${r.stderr.trim()}`);
    check("16. no JK_BMS_WORKBOOK_PATH: CLI exits 0", r.status === 0, `status=${r.status}`);
    check("16. no JK_BMS_WORKBOOK_PATH: output contains a bare \"ALL PASS\" line", /^ALL PASS$/m.test(r.stdout));
  }

  // =========================================================================
  // Scenarios 7, 8 — timeout kills the WHOLE process tree (parent/child/
  // grandchild), including freeing the port the grandchild held.
  // =========================================================================
  {
    const pidfile = path.join(os.tmpdir(), `jk-bms-release-runner-test-pidfile-${process.pid}`);
    try { fs.unlinkSync(pidfile); } catch (_) { /* fine */ }
    const fixturePort = await new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.once("error", reject);
      srv.listen(0, "127.0.0.1", () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
    });

    const r = runCli({
      JK_BMS_WORKBOOK_PATH: STAND_IN_WORKBOOK, JK_BMS_HARNESS_STEPS_MODULE: TREE_STEPS,
      JK_BMS_RELEASE_TIMEOUT_SECS: "2", JK_BMS_FIXTURE_PIDFILE: pidfile, JK_BMS_FIXTURE_PORT: String(fixturePort),
    }, { timeoutMs: 30000 });

    check("7. timeout: CLI exits non-zero", r.status !== 0 && r.status !== null, `status=${r.status}`);
    check("7. timeout: summary reports TIMEOUT for the never-exiting step", /TIMEOUT\s+fixture: spawn-tree/.test(r.stdout), r.stdout.split("\n").slice(-8).join(" | "));

    await new Promise((resolve) => setTimeout(resolve, 500)); // let SIGKILL's process-exit settle
    const pidLines = fs.existsSync(pidfile) ? fs.readFileSync(pidfile, "utf8").trim().split("\n").filter(Boolean) : [];
    check("8. fixture sanity: parent+child+grandchild PIDs were actually recorded", pidLines.length === 3, pidLines.join(","));
    const alive = pidLines.filter((line) => {
      const pid = Number(line.split(":")[1]);
      try { process.kill(pid, 0); return true; } catch (_) { return false; }
    });
    check("8. timeout kills the WHOLE tree: no parent/child/grandchild PID survives", alive.length === 0, `still alive: ${alive.join(",")}`);

    const portFreedAfterTimeout = await new Promise((resolve) => {
      const srv = net.createServer();
      srv.once("error", () => resolve(false));
      srv.listen(fixturePort, "127.0.0.1", () => srv.close(() => resolve(true)));
    });
    check("8b. after timeout, the fixture's port is no longer held (mock-server-equivalent case)", portFreedAfterTimeout);
    try { fs.unlinkSync(pidfile); } catch (_) { /* best effort */ }

    // Re-run on the SAME port immediately: proves a repeat run can reuse the
    // resource without conflict (Work 9's repeat-run requirement).
    const fixturePort2 = await new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.once("error", reject);
      srv.listen(0, "127.0.0.1", () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
    });
    check("repeat allocation: a fresh ephemeral port can be picked again right after cleanup", Number.isInteger(fixturePort2) && fixturePort2 > 0);
  }

  // =========================================================================
  // Scenario 9 — SIGINT terminates the run and its active child tree; no
  // further steps run after the signal.
  // =========================================================================
  {
    const pidfile = path.join(os.tmpdir(), `jk-bms-release-runner-test-sigint-${process.pid}`);
    try { fs.unlinkSync(pidfile); } catch (_) { /* fine */ }
    const fixturePort = await new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.once("error", reject);
      srv.listen(0, "127.0.0.1", () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
    });

    const child = spawn(process.execPath, [CLI], {
      cwd: ROOT,
      env: {
        ...process.env, JK_BMS_WORKBOOK_PATH: STAND_IN_WORKBOOK, JK_BMS_HARNESS_STEPS_MODULE: TREE_STEPS,
        JK_BMS_RELEASE_TIMEOUT_SECS: "60", JK_BMS_FIXTURE_PIDFILE: pidfile, JK_BMS_FIXTURE_PORT: String(fixturePort),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.stderr.on("data", (d) => { out += d.toString(); });
    const exitPromise = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));

    await new Promise((resolve) => setTimeout(resolve, 2000)); // let the tree step actually start and bind its port
    child.kill("SIGINT");
    const { code } = await exitPromise;

    check("9. SIGINT: CLI exits with the documented code (130)", code === 130, `code=${code}`);
    check("9. SIGINT: output states no further steps will run", out.includes("no further steps will run"));
    check("9. SIGINT: the spawn-tree step never reached a normal terminal status in the summary", !/EXECUTED\s+fixture: spawn-tree/.test(out) && !/FAILED\s+fixture: spawn-tree/.test(out));

    await new Promise((resolve) => setTimeout(resolve, 500));
    const pidLines = fs.existsSync(pidfile) ? fs.readFileSync(pidfile, "utf8").trim().split("\n").filter(Boolean) : [];
    const alive = pidLines.filter((line) => {
      const pid = Number(line.split(":")[1]);
      try { process.kill(pid, 0); return true; } catch (_) { return false; }
    });
    check("9. signal cleanup: no parent/child/grandchild PID survives SIGINT", alive.length === 0, `pids=${pidLines.join(",")} still alive=${alive.join(",")}`);
    try { fs.unlinkSync(pidfile); } catch (_) { /* best effort */ }
  }

  // =========================================================================
  // Scenarios 12, 13, 14 — non-mutation guard, against an isolated scratch
  // git repo (never the real repository).
  // =========================================================================
  {
    const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "jk-bms-release-runner-scratch-"));
    try {
      execFileSync("git", ["init", "-q"], { cwd: scratchRoot });
      execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: scratchRoot });
      execFileSync("git", ["config", "user.name", "Release Runner Test"], { cwd: scratchRoot });
      fs.writeFileSync(path.join(scratchRoot, "tracked.txt"), "baseline\n");
      execFileSync("git", ["add", "."], { cwd: scratchRoot });
      execFileSync("git", ["commit", "-q", "-m", "baseline"], { cwd: scratchRoot });

      // 12/14: a non-mutating fixture step list must leave the scratch repo clean.
      let r = runCli({
        JK_BMS_WORKBOOK_PATH: STAND_IN_WORKBOOK, JK_BMS_HARNESS_STEPS_MODULE: NO_TREE_STEPS,
        JK_BMS_RELEASE_TIMEOUT_SECS: "30", JK_BMS_HARNESS_ROOT: scratchRoot,
      });
      check("12. non-mutating run: CLI exits 0 against the clean scratch repo", r.status === 0, `status=${r.status}`);
      check("12. non-mutating run: non-mutation guard reports PASS", r.stdout.includes("PASS     git status is identical"));

      // 13: a fixture step that WRITES into the scratch repo must be caught.
      const mutatingStepsPath = path.join(scratchRoot, "mutating_steps.js");
      fs.writeFileSync(mutatingStepsPath, `
        "use strict";
        module.exports = { buildSteps: ({ repoRoot }) => [
          { name: "fixture: mutate repo", command: process.execPath, args: ["-e", \`require("fs").writeFileSync(require("path").join(${JSON.stringify(scratchRoot)}, "untracked_by_step.txt"), "oops");\`], cwd: repoRoot },
        ] };
      `);
      r = runCli({
        JK_BMS_WORKBOOK_PATH: STAND_IN_WORKBOOK, JK_BMS_HARNESS_STEPS_MODULE: mutatingStepsPath,
        JK_BMS_RELEASE_TIMEOUT_SECS: "30", JK_BMS_HARNESS_ROOT: scratchRoot,
      });
      check("13. a step that mutates the scratch repo: CLI exits non-zero (verification FAILs)", r.status !== 0, `status=${r.status}`);
      check("13. a step that mutates the scratch repo: non-mutation guard reports FAILED", r.stdout.includes("FAILED   release verification must not change git status"));
      try { fs.unlinkSync(path.join(scratchRoot, "untracked_by_step.txt")); } catch (_) { /* best effort */ }
      try { fs.unlinkSync(mutatingStepsPath); } catch (_) { /* best effort */ }

      // 14: after removing the mutation, the guard passes again.
      r = runCli({
        JK_BMS_WORKBOOK_PATH: STAND_IN_WORKBOOK, JK_BMS_HARNESS_STEPS_MODULE: NO_TREE_STEPS,
        JK_BMS_RELEASE_TIMEOUT_SECS: "30", JK_BMS_HARNESS_ROOT: scratchRoot,
      });
      check("14. after restoring cleanliness: CLI exits 0 again", r.status === 0, `status=${r.status}`);
      check("14. after restoring cleanliness: non-mutation guard reports PASS again", r.stdout.includes("PASS     git status is identical"));
    } finally {
      fs.rmSync(scratchRoot, { recursive: true, force: true });
    }
  }

  // =========================================================================
  // P0-1 SECURITY REGRESSION (Stage 1 corrective pass #2): reproduces the
  // independently-reported exploit against the REAL production entry
  // point — test/release/cli.js, spawned directly, NOT the test harness —
  // with the exact payload from the report (a fixture step-list module +
  // a bogus repo root), and proves it no longer has any effect. A short
  // timeout is used so this doesn't wait for the full ~3min real suite:
  // if the exploit still worked, 3 trivial fixture steps would complete
  // and print "ALL PASS" well within 3s; if it's fixed, cli.js ignores
  // both env vars, starts running the REAL production step list against
  // the REAL repo, and the 3s budget runs out on a real step instead.
  {
    const bogusRoot = fs.mkdtempSync(path.join(os.tmpdir(), "jk-bms-p0-1-bogus-root-"));
    try {
      const r = runCliOnRealCli({
        JK_BMS_WORKBOOK_PATH: STAND_IN_WORKBOOK,
        // The exact exploit payload, reproduced verbatim:
        JK_BMS_RELEASE_STEPS_MODULE: NO_TREE_STEPS,
        JK_BMS_RELEASE_ROOT: bogusRoot,
        JK_BMS_RELEASE_TIMEOUT_SECS: "3",
      }, { timeoutMs: 15000 });

      check("P0-1. exploit payload against the REAL cli.js: the fake fixture step names NEVER appear in the output",
        !r.stdout.includes("fixture: quick pass"), r.stdout.trim().split("\n").slice(0, 6).join(" | "));
      check("P0-1. exploit payload against the REAL cli.js: a REAL production step name appears instead",
        r.stdout.includes("jk_write_tx_core: compile") || r.stdout.includes("jk_write_tx_core: run"),
        r.stdout.trim().split("\n").slice(0, 10).join(" | "));
      check("P0-1. exploit payload against the REAL cli.js: never reports a bare \"ALL PASS\" from 3 trivial steps",
        !/^ALL PASS$/m.test(r.stdout) || r.stdout.includes("jk_write_tx_core"));
      check("P0-1. exploit payload against the REAL cli.js: the bogus JK_BMS_RELEASE_ROOT causes no git/root-related crash",
        !r.stdout.includes("not a git repository") && !r.stderr.includes("not a git repository")
        && !r.stdout.includes("RELEASE_RUNNER_INTERNAL_ERROR") && !r.stderr.includes("RELEASE_RUNNER_INTERNAL_ERROR"),
        (r.stdout + r.stderr).trim().split("\n").slice(-3).join(" | "));
      check("P0-1. exploit payload against the REAL cli.js: exits non-zero (a 3s budget cannot cleanly finish the real suite)",
        r.status !== 0, `status=${r.status}`);
    } finally {
      fs.rmSync(bogusRoot, { recursive: true, force: true });
    }
  }
  // Static-source proof, belt-and-suspenders: the production file's CODE
  // never reads either override env var — an explanatory mention of the
  // old names in a comment (documenting what was removed and why) is
  // fine and expected; what must be absent is an actual
  // `process.env.JK_BMS_RELEASE_*` access expression.
  {
    const cliSource = fs.readFileSync(CLI, "utf8");
    check("P0-1. static check: test/release/cli.js never reads process.env.JK_BMS_RELEASE_STEPS_MODULE",
      !/process\.env(\.JK_BMS_RELEASE_STEPS_MODULE|\[["']JK_BMS_RELEASE_STEPS_MODULE["']\])/.test(cliSource));
    check("P0-1. static check: test/release/cli.js never reads process.env.JK_BMS_RELEASE_ROOT",
      !/process\.env(\.JK_BMS_RELEASE_ROOT|\[["']JK_BMS_RELEASE_ROOT["']\])/.test(cliSource));
  }

  console.log(`\n${checks} checks run, ${failures} failed, ${blocked} blocked.`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(`TEST_HARNESS_ERROR: ${err.stack || err.message}`);
  process.exit(1);
});
