"use strict";
/*
 * Reusable release-gate orchestration core — separated from the JK BMS
 * production step list (test/release/steps.js) precisely so
 * test/protocol_catalog/test_release_runner.js can exercise the engine
 * (timeout/process-tree kill, skip/fail summary, exit-code policy) against
 * cheap synthetic steps, instead of either re-running the entire expensive
 * real release suite recursively or leaving this logic untested.
 *
 * Process-tree kill: each step's command is spawned with
 * `detached: true`, which on POSIX makes it the leader of a brand-new
 * process group (pgid === child.pid). Any further processes it forks
 * (grandchildren) inherit that same group unless they explicitly detach
 * themselves — which none of this project's real steps or test fixtures
 * do — so `process.kill(-child.pid, signal)` reaches the whole tree in one
 * call. This needs no bash job control (`set -m`) and no external
 * `timeout`/`gtimeout`/`setsid` binary — see test/run_release.sh's own
 * history for why `set -m` was tried and rejected (it broke command
 * substitution under this project's sandboxed CI shell).
 */
const { spawn } = require("child_process");

const STATUS = Object.freeze({
  EXECUTED: "EXECUTED",
  SKIPPED: "SKIPPED",
  FAILED: "FAILED",
  TIMEOUT: "TIMEOUT",
});

const GRACE_PERIOD_MS = 5000;

/** Runs one step's command as the leader of its own process group, killing
 * the WHOLE group (not just the direct child) if `remainingMs` elapses
 * before it exits on its own: SIGTERM first, then SIGKILL after
 * GRACE_PERIOD_MS if it's still alive. No temp marker file is used to
 * detect a timeout (avoiding any create-then-check race) — `timedOut` is a
 * plain in-process boolean flipped synchronously by the same timer that
 * issues the kill, read back by the `exit` handler that always fires
 * after it in the event loop. Resolves; never rejects. */
function runStepProcess({ command, args = [], cwd, env, remainingMs, activeChildRef, graceMs = GRACE_PERIOD_MS }) {
  return new Promise((resolve) => {
    if (remainingMs <= 0) {
      return resolve({ status: STATUS.TIMEOUT, code: null, signal: null, timedOut: true, detail: "budget already exhausted before this step could start" });
    }

    let child;
    try {
      child = spawn(command, args, { cwd, env, stdio: "inherit", detached: true });
    } catch (err) {
      return resolve({ status: STATUS.FAILED, code: null, signal: null, timedOut: false, detail: err.message });
    }
    if (activeChildRef) activeChildRef.child = child;

    let timedOut = false;
    let settled = false;
    let killTimer = null;
    let forceTimer = null;

    const clearTimers = () => {
      if (killTimer) clearTimeout(killTimer);
      if (forceTimer) clearTimeout(forceTimer);
    };
    const killGroup = (signal) => {
      try { process.kill(-child.pid, signal); } catch (_) { /* group already gone */ }
    };

    killTimer = setTimeout(() => {
      timedOut = true;
      killGroup("SIGTERM");
      forceTimer = setTimeout(() => killGroup("SIGKILL"), graceMs);
    }, remainingMs);
    // Don't let this timer alone keep the event loop (and thus the whole
    // release run) alive past a step that exits well within budget.
    if (killTimer.unref) killTimer.unref();

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimers();
      if (activeChildRef) activeChildRef.child = null;
      resolve({ status: STATUS.FAILED, code: null, signal: null, timedOut, detail: err.message });
    });
    child.on("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimers();
      if (activeChildRef) activeChildRef.child = null;
      if (timedOut) return resolve({ status: STATUS.TIMEOUT, code, signal, timedOut: true, detail: `exceeded the remaining release budget (~${remainingMs}ms allotted)` });
      if (code === 0 && !signal) return resolve({ status: STATUS.EXECUTED, code, signal, timedOut: false });
      return resolve({ status: STATUS.FAILED, code, signal, timedOut: false, detail: signal ? `terminated by signal ${signal}` : `exit code ${code}` });
    });
  });
}

/**
 * Runs `steps` (array of { name, command, args, cwd, env }) in order
 * against one shared wall-clock deadline (`timeoutSeconds` from the start
 * of this call — each step gets whatever is left of the budget).
 * `hooks.forceSkip`/`hooks.forceFail` (step name -> true) are test-only
 * overrides so the summary/exit-code policy can be exercised without a
 * real failure or a real timeout. `activeChildRef` (a plain `{child}`
 * object) is updated with the in-flight child for the CLI's own
 * INT/TERM handlers to kill on an external interrupt.
 */
async function runSteps({ steps, timeoutSeconds, hooks = {}, activeChildRef = {}, log = () => {} }) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  const results = [];
  let interrupted = false;
  const stop = () => { interrupted = true; };

  for (const step of steps) {
    if (interrupted) break;
    log(`\n=== ${step.name} ===`);
    if (hooks.forceSkip && hooks.forceSkip.has(step.name)) {
      log("SKIPPED (forced by a test-only hook)");
      results.push({ name: step.name, status: STATUS.SKIPPED });
      continue;
    }
    if (hooks.forceFail && hooks.forceFail.has(step.name)) {
      log("FAILED (forced by a test-only hook)");
      results.push({ name: step.name, status: STATUS.FAILED, detail: "forced by a test-only hook" });
      continue;
    }
    const remainingMs = deadline - Date.now();
    // eslint-disable-next-line no-await-in-loop -- steps are intentionally sequential
    const result = await runStepProcess({
      command: step.command, args: step.args, cwd: step.cwd, env: step.env,
      remainingMs, activeChildRef,
    });
    if (result.status !== STATUS.EXECUTED) log(`${result.status}: ${step.name}${result.detail ? ` (${result.detail})` : ""}`);
    results.push({ name: step.name, status: result.status, detail: result.detail });
  }

  const anyFailed = results.some((r) => r.status === STATUS.FAILED || r.status === STATUS.TIMEOUT);
  const anySkipped = results.some((r) => r.status === STATUS.SKIPPED);
  let verdict;
  if (interrupted) verdict = "INTERRUPTED";
  else if (anyFailed) verdict = "FAILED";
  else if (anySkipped) verdict = "PARTIAL PASS";
  else verdict = "ALL PASS";

  return { results, anyFailed, anySkipped, interrupted, verdict, stopSignal: stop };
}

module.exports = { STATUS, runStepProcess, runSteps, GRACE_PERIOD_MS };
