#!/usr/bin/env node
"use strict";
/*
 * Release gate entry point. See test/release/orchestrator.js for the
 * reusable engine and test/release/steps.js for the actual JK BMS step
 * list. This file only wires them together: the workbook fail-closed
 * gate, port allocation, the overall timeout, INT/TERM handling, the
 * non-mutation (git status before/after) guard, and the final
 * summary/exit-code policy.
 *
 * Exit codes: 0 ALL PASS, 1 FAILED (or TIMEOUT), 2 usage/config error
 * (a JK_BMS_WORKBOOK_PATH that's set but doesn't exist, bad
 * --timeout-seconds -- a missing/unset workbook path is no longer an
 * error, see validateWorkbookPath below), 3 PARTIAL PASS (something
 * was skipped — never reported as "All suites passed").
 *
 * SECURITY (Stage 1 corrective pass #2, P0-1): an earlier version of this
 * file read `JK_BMS_RELEASE_STEPS_MODULE` / `JK_BMS_RELEASE_ROOT` from the
 * environment to let test/protocol_catalog/test_release_runner.js swap in
 * a synthetic fixture step list. That made the PRODUCTION entry point
 * (the one test/run_release.sh execs, unconditionally) itself capable of
 * running a trivial fake step list and reporting "ALL PASS" — a complete,
 * silent release-gate bypass triggerable by anyone who can set two env
 * vars. Independently reproduced and confirmed. Fixed structurally, not
 * by validating the override more carefully: this file now contains NO
 * code path, anywhere, that reads a step-list module path or a repo root
 * from the environment. `main()` below hardcodes both via a static
 * `require("./steps")` and `path.join(__dirname, "..", "..")` — greppable
 * proof there is nothing to redirect. The reusable core (`runRelease`,
 * exported below) still accepts `repoRoot`/`buildSteps` as plain function
 * arguments — that's how test/release/fixtures/test_harness_cli.js (a
 * SEPARATE file, never referenced by test/run_release.sh or by anything
 * this file requires) exercises the real logic against fixtures without
 * this production file ever trusting external input for either.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { runSteps } = require("./orchestrator");
const { pickPort } = require("./port");

function usageErrorExit(message) {
  console.error(message);
  process.exit(2);
}

function gitStatusShort(cwd) {
  return execFileSync("git", ["status", "--short", "--untracked-files=all"], { cwd, encoding: "utf8" });
}

/** Pure, directly unit-testable: true iff the tree changed between two
 * `git status --short` snapshots. */
function treeMutated(before, after) {
  return before !== after;
}

function parseForceSet(envValue) {
  if (!envValue) return new Set();
  return new Set(envValue.split(",").map((s) => s.trim()).filter(Boolean));
}

/** Pure, directly unit-testable workbook validation: returns
 * { ok: true, path } or { ok: false, reasonCode, message }. `existsFn`
 * is injectable so tests don't need a real file on disk.
 *
 * Work 3 (final preparation pass): the V1 workbook is now OPTIONAL. The
 * repo-committed, SHA-256-verified V2 workbook is sufficient evidence for
 * a standard, self-contained release check on any checkout -- no personal
 * absolute path required. When JK_BMS_WORKBOOK_PATH IS set, it's still
 * used as an additional revalidation layer over the legacy V1 evidence
 * index (see steps.js); a path that's set but doesn't exist is still a
 * hard error (RELEASE_WORKBOOK_NOT_FOUND) -- a claimed-but-missing input
 * must never be silently dropped, only a genuinely absent one is fine. */
function validateWorkbookPath(workbookPath, existsFn = fs.existsSync) {
  if (!workbookPath) {
    return { ok: true, path: undefined };
  }
  if (!existsFn(workbookPath)) {
    return { ok: false, reasonCode: "RELEASE_WORKBOOK_NOT_FOUND", message: `RELEASE_WORKBOOK_NOT_FOUND: ${workbookPath}` };
  }
  return { ok: true, path: workbookPath };
}

/** Pure, directly unit-testable timeout parsing: returns
 * { ok: true, seconds } or { ok: false, reasonCode, message }. */
function parseTimeoutSeconds(raw) {
  const seconds = raw === undefined ? 1200 : Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isInteger(seconds)) {
    return {
      ok: false, reasonCode: "RELEASE_INVALID_TIMEOUT",
      message: `RELEASE_INVALID_TIMEOUT: JK_BMS_RELEASE_TIMEOUT_SECS must be a positive integer, got ${JSON.stringify(raw)}`,
    };
  }
  return { ok: true, seconds };
}

/**
 * The reusable release-run core. Takes `repoRoot` and `buildSteps`
 * explicitly as function arguments — NOT read from the environment here
 * or anywhere this function calls. `main()` below is the only caller in
 * this file, and it always passes the hardcoded production values. Ends
 * the process itself (matching the previous behavior); does not return
 * for the caller to inspect, since a real SIGINT/SIGTERM mid-run must
 * terminate the process regardless of caller.
 */
async function runRelease({ repoRoot, buildSteps, workbookPath, timeoutSeconds, requestedPort = 0, hooks = {} }) {
  let testPort;
  try {
    testPort = await pickPort({ requestedPort });
  } catch (err) {
    console.error(`RELEASE_PORT_ALLOCATION_FAILED: ${err.message}`);
    process.exit(2);
  }
  console.log(`Using TEST_PORT=${testPort}`);

  const buildDir = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "jk-bms-release-build."));
  const cleanup = () => { try { fs.rmSync(buildDir, { recursive: true, force: true }); } catch (_) { /* best effort */ } };

  const statusBefore = gitStatusShort(repoRoot);

  const steps = buildSteps({ repoRoot, buildDir, workbookPath, testPort });
  const activeChildRef = {};

  let interruptedBySignal = null;
  const onSignal = (sig) => {
    interruptedBySignal = sig;
    if (activeChildRef.child) {
      try { process.kill(-activeChildRef.child.pid, "SIGTERM"); } catch (_) { /* already gone */ }
    }
    cleanup();
    console.error(`\nRELEASE_INTERRUPTED: received ${sig}, terminating (no further steps will run)`);
    process.exit(sig === "SIGINT" ? 130 : 143);
  };
  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));

  const { results, verdict } = await runSteps({ steps, timeoutSeconds, hooks, activeChildRef, log: (line) => console.log(line) });

  cleanup();

  const statusAfter = gitStatusShort(repoRoot);
  const wasMutated = treeMutated(statusBefore, statusAfter);

  console.log("\n=== release summary ===");
  for (const r of results) {
    console.log(`${r.status.padEnd(8)} ${r.name}${r.detail ? ` -- ${r.detail}` : ""}`);
  }

  console.log("\n=== non-mutation guard ===");
  if (wasMutated) {
    console.log("FAILED   release verification must not change git status; it did.");
    console.log(`--- before ---\n${statusBefore || "(clean)"}`);
    console.log(`--- after ---\n${statusAfter || "(clean)"}`);
  } else {
    console.log("PASS     git status is identical before and after this release run.");
  }

  console.log();
  if (interruptedBySignal) {
    console.log(`RELEASE ABORTED: terminated by ${interruptedBySignal}`);
    process.exit(interruptedBySignal === "SIGINT" ? 130 : 143);
  }
  if (verdict === "FAILED" || wasMutated) {
    console.log("FAILED: one or more release steps did not pass, or the working tree was mutated. See the summary above.");
    process.exit(1);
  }
  if (verdict === "PARTIAL PASS") {
    console.log("PARTIAL PASS: every step either passed or was explicitly skipped — a release must not be cut on PARTIAL PASS.");
    process.exit(3);
  }
  console.log("ALL PASS");
  process.exit(0);
}

async function main() {
  const workbookCheck = validateWorkbookPath(process.env.JK_BMS_WORKBOOK_PATH);
  if (!workbookCheck.ok) {
    console.error(workbookCheck.message);
    process.exit(2);
  }

  const timeoutCheck = parseTimeoutSeconds(process.env.JK_BMS_RELEASE_TIMEOUT_SECS);
  if (!timeoutCheck.ok) return usageErrorExit(timeoutCheck.message);

  const requestedPort = process.env.TEST_PORT ? Number(process.env.TEST_PORT) : 0;
  const hooks = {
    forceSkip: parseForceSet(process.env.JK_BMS_RELEASE_FORCE_SKIP),
    forceFail: parseForceSet(process.env.JK_BMS_RELEASE_FORCE_FAIL),
  };

  // Hardcoded, static, non-overridable. Grep this file for
  // "process.env" if you need to re-audit what production ever reads —
  // there is nothing here that names a step-list module or a repo root.
  await runRelease({
    repoRoot: path.join(__dirname, "..", ".."),
    buildSteps: require("./steps").buildSteps,
    workbookPath: workbookCheck.path,
    timeoutSeconds: timeoutCheck.seconds,
    requestedPort,
    hooks,
  });
}

module.exports = { validateWorkbookPath, parseTimeoutSeconds, parseForceSet, treeMutated, runRelease };

if (require.main === module) {
  main().catch((err) => {
    console.error(`RELEASE_RUNNER_INTERNAL_ERROR: ${err.stack || err.message}`);
    process.exit(1);
  });
}
