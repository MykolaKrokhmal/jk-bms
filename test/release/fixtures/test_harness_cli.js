#!/usr/bin/env node
"use strict";
/*
 * TEST-ONLY driver for test/protocol_catalog/test_release_runner.js.
 *
 * NEVER referenced by test/run_release.sh, test/release/cli.js, or any
 * production path. Lives under test/release/fixtures/ specifically so
 * that is obvious on sight. This is what makes the fix for P0-1 (Stage 1
 * corrective pass #2) real rather than cosmetic: test/release/cli.js (the
 * file test/run_release.sh execs) contains no code, anywhere, that reads
 * a step-list module path or a repo root from the environment — there is
 * nothing in that file to redirect. This harness calls the exact same
 * `runRelease()` core cli.js's own `main()` calls (so the engine under
 * test is the real one, not a reimplementation), but takes the step-list
 * module and repo root from ITS OWN env vars, which cli.js's source does
 * not reference at all.
 */
const path = require("path");
const { runRelease, validateWorkbookPath, parseTimeoutSeconds, parseForceSet } = require("../cli");

async function main() {
  const workbookCheck = validateWorkbookPath(process.env.JK_BMS_WORKBOOK_PATH);
  if (!workbookCheck.ok) {
    console.error(workbookCheck.message);
    process.exit(2);
  }

  const timeoutCheck = parseTimeoutSeconds(process.env.JK_BMS_RELEASE_TIMEOUT_SECS);
  if (!timeoutCheck.ok) {
    console.error(timeoutCheck.message);
    process.exit(2);
  }

  const repoRoot = process.env.JK_BMS_HARNESS_ROOT
    ? path.resolve(process.env.JK_BMS_HARNESS_ROOT)
    : path.join(__dirname, "..", "..", "..");
  const stepsModulePath = process.env.JK_BMS_HARNESS_STEPS_MODULE
    ? path.resolve(process.env.JK_BMS_HARNESS_STEPS_MODULE)
    : path.join(__dirname, "..", "steps.js");
  const { buildSteps } = require(stepsModulePath);

  const requestedPort = process.env.TEST_PORT ? Number(process.env.TEST_PORT) : 0;
  const hooks = {
    forceSkip: parseForceSet(process.env.JK_BMS_RELEASE_FORCE_SKIP),
    forceFail: parseForceSet(process.env.JK_BMS_RELEASE_FORCE_FAIL),
  };

  await runRelease({ repoRoot, buildSteps, workbookPath: workbookCheck.path, timeoutSeconds: timeoutCheck.seconds, requestedPort, hooks });
}

main().catch((err) => {
  console.error(`TEST_HARNESS_INTERNAL_ERROR: ${err.stack || err.message}`);
  process.exit(1);
});
