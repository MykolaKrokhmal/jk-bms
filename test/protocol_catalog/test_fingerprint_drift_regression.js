#!/usr/bin/env node
"use strict";

// Regression for the fingerprint-drift class of bug, exercised entirely
// against the real tools/protocol/fingerprint.js CLI (check/review/accept)
// in an isolated temporary copy of the repo — the real source tree is
// never mutated by this test. Needs no private workbook: the fingerprint
// check/review/accept path never opens it.
//
// Every assertion here checks exit code + stdout reasonCode + (where
// relevant) actual file content — never "the string X did not appear",
// which is not evidence a command actually succeeded for the reason
// intended (a crash, a missing file, or an unrelated error would just as
// easily produce output missing that one string).
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const SOURCE_ROOT = path.join(__dirname, "..", "..");
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "jk-bms-fingerprint-drift-test-"));
let checks = 0;
let failures = 0;

function check(name, condition, detail = "") {
  checks += 1;
  if (condition) console.log(`PASS  ${name}${detail ? `  -- ${detail}` : ""}`);
  else { failures += 1; console.log(`FAIL  ${name}${detail ? `  -- ${detail}` : ""}`); }
}

function copy(relative) {
  const src = path.join(SOURCE_ROOT, relative);
  const dst = path.join(sandbox, relative);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

const REVIEW_PATH = path.join(sandbox, "protocol", "generated", ".fingerprint-review.json");

function runCli(mode, extraArgs = []) {
  const result = spawnSync(process.execPath, [
    path.join(sandbox, "tools", "protocol", "fingerprint.js"), mode,
    "--root", sandbox, "--review-path", REVIEW_PATH, ...extraArgs,
  ], { cwd: sandbox, encoding: "utf8" });
  let parsed = null;
  const firstLine = (result.stdout || "").split("\n")[0];
  try { parsed = JSON.parse(firstLine); } catch (_) { /* not every failure mode emits JSON on stdout */ }
  return { status: result.status, stdout: result.stdout || "", stderr: result.stderr || "", parsed };
}

const FILES_TO_COPY = [
  ".node-version",
  "batterylifepo4.yaml",
  "jk_bms.js",
  "demo/mock-server.js",
  "register_catalog.json",
  "protocol/registers.canonical.json",
  "protocol/non_register_entities.canonical.json",
  "protocol/schema/register-source.schema.json",
  "protocol/schema/non-register-source.schema.json",
  "protocol/schema/evidence-sources.schema.json",
  "protocol/evidence/sources.json",
  "protocol/evidence/upstream_esp32-jk-pb-modbus-example.yaml",
  "protocol/evidence/BMS_RS485_Modbus_V1.1.pdf",
  "protocol/evidence/LiFePO4_BMS_Parameters_registers-V2_verified.xlsx",
  "toolchain.lock.json",
  "HARDWARE_AUDIT_2026-09-09.md",
  "tools/protocol/fingerprint.js",
  "tools/protocol/lib/fingerprint.js",
  "tools/protocol/lib/release-id.js",
  "tools/protocol/lib/mini-schema.js",
  "tools/protocol/lib/semantic-checks.js",
  "tools/protocol/generate.js",
  "protocol/generated/coverage_report.md",
  "protocol/generated/.generation-manifest.json",
  "test/register_catalog/validate.js",
];

try {
  FILES_TO_COPY.forEach(copy);

  const jkBmsPath = path.join(sandbox, "jk_bms.js");
  const yamlPath = path.join(sandbox, "batterylifepo4.yaml");
  const sourcesJsonPath = path.join(sandbox, "protocol", "evidence", "sources.json");
  const canonicalPath = path.join(sandbox, "protocol", "registers.canonical.json");
  const originalJs = fs.readFileSync(jkBmsPath, "utf8");
  const originalYaml = fs.readFileSync(yamlPath, "utf8");
  const originalSourcesJson = fs.readFileSync(sourcesJsonPath, "utf8");
  const originalCanonical = fs.readFileSync(canonicalPath, "utf8");

  // --- 1. Clean source: exit 0, no mismatch, no ENOENT, no hidden error ---
  let r = runCli("check");
  check("1. clean source: check exits 0", r.status === 0, `status=${r.status}`);
  check("1. clean source: reasonCode is FINGERPRINT_MATCH", r.parsed && r.parsed.reasonCode === "FINGERPRINT_MATCH", JSON.stringify(r.parsed));
  check("1. clean source: no ENOENT anywhere in output", !r.stdout.includes("ENOENT") && !r.stderr.includes("ENOENT"));
  check("1. clean source: no unrelated stderr noise", r.stderr.trim() === "", r.stderr.trim());

  // --- 2. Change jk_bms.js OUTSIDE the generated markers ---
  check("fixture sanity: jk_bms.js carries the generated-catalog markers",
    originalJs.includes("// >>> BEGIN GENERATED PROTOCOL CATALOG") && originalJs.includes("// <<< END GENERATED PROTOCOL CATALOG"));
  fs.writeFileSync(jkBmsPath, `${originalJs}\n// drift-regression-fixture: unreviewed hand edit\n`);
  r = runCli("check");
  check("2. jk_bms.js drift: check exits non-zero", r.status !== 0, `status=${r.status}`);
  check("2. jk_bms.js drift: reasonCode is exactly FINGERPRINT_MISMATCH", r.parsed && r.parsed.reasonCode === "FINGERPRINT_MISMATCH", JSON.stringify(r.parsed));

  // --- 3. Restore jk_bms.js: exit 0 ---
  fs.writeFileSync(jkBmsPath, originalJs);
  r = runCli("check");
  check("3. jk_bms.js restored: check exits 0", r.status === 0, `status=${r.status}`);
  check("3. jk_bms.js restored: reasonCode is FINGERPRINT_MATCH", r.parsed && r.parsed.reasonCode === "FINGERPRINT_MATCH");

  // --- 4. Change batterylifepo4.yaml ---
  fs.writeFileSync(yamlPath, `${originalYaml}\n# drift-regression-fixture: unreviewed hand edit\n`);
  r = runCli("check");
  check("4. yaml drift: check exits non-zero", r.status !== 0, `status=${r.status}`);
  check("4. yaml drift: reasonCode is exactly FINGERPRINT_MISMATCH", r.parsed && r.parsed.reasonCode === "FINGERPRINT_MISMATCH", JSON.stringify(r.parsed));

  // --- 5. Restore yaml: exit 0 ---
  fs.writeFileSync(yamlPath, originalYaml);
  r = runCli("check");
  check("5. yaml restored: check exits 0", r.status === 0, `status=${r.status}`);

  // --- 6. Missing required source: must fail, ENOENT is not PASS ---
  fs.unlinkSync(jkBmsPath);
  r = runCli("check");
  check("6. missing jk_bms.js: check exits non-zero (not silently 0)", r.status !== 0, `status=${r.status}`);
  check("6. missing jk_bms.js: reasonCode is SOURCE_FILE_MISSING (not a raw crash)",
    r.parsed && r.parsed.reasonCode === "SOURCE_FILE_MISSING", JSON.stringify(r.parsed) || r.stderr);
  check("6. missing jk_bms.js: no unhandled-exception stack trace on stderr",
    !r.stderr.includes("at Object.<anonymous>") && !r.stderr.includes("TypeError") && !r.stderr.includes("throw err;"));
  fs.writeFileSync(jkBmsPath, originalJs);
  r = runCli("check");
  check("6b. jk_bms.js restored after missing-file test: check exits 0", r.status === 0);

  // --- 7. Corrupted sources.json: controlled non-zero, stable reason code ---
  fs.writeFileSync(sourcesJsonPath, "{ this is not valid json");
  r = runCli("check");
  check("7. corrupted sources.json: check exits non-zero", r.status !== 0, `status=${r.status}`);
  check("7. corrupted sources.json: reasonCode is SOURCES_JSON_MALFORMED",
    r.parsed && r.parsed.reasonCode === "SOURCES_JSON_MALFORMED", JSON.stringify(r.parsed) || r.stderr);
  fs.writeFileSync(sourcesJsonPath, originalSourcesJson);
  r = runCli("check");
  check("7b. sources.json restored: check exits 0", r.status === 0);

  // --- 8. Stale review: accept rejected ---
  r = runCli("review", ["--ttl-seconds", "1"]);
  check("8. review (1s ttl) succeeds", r.status === 0 && r.parsed && r.parsed.reasonCode === "REVIEW_OK", JSON.stringify(r.parsed));
  const staleReview = JSON.parse(fs.readFileSync(REVIEW_PATH, "utf8"));
  staleReview.expires_at_iso = new Date(Date.now() - 60_000).toISOString(); // force-expire without a real sleep
  fs.writeFileSync(REVIEW_PATH, JSON.stringify(staleReview, null, 2));
  r = runCli("accept");
  check("8. stale review: accept exits non-zero", r.status !== 0, `status=${r.status}`);
  check("8. stale review: reasonCode is REVIEW_STALE", r.parsed && r.parsed.reasonCode === "REVIEW_STALE", JSON.stringify(r.parsed) || r.stderr);
  check("8. stale review: citation files untouched", fs.readFileSync(sourcesJsonPath, "utf8") === originalSourcesJson
    && fs.readFileSync(canonicalPath, "utf8") === originalCanonical);

  // --- 9. Source changed after review: accept rejected ---
  r = runCli("review");
  check("9. fresh review succeeds", r.status === 0 && r.parsed && r.parsed.reasonCode === "REVIEW_OK");
  fs.writeFileSync(jkBmsPath, `${originalJs}\n// drift-regression-fixture: edited after review, before accept\n`);
  r = runCli("accept");
  check("9. source changed after review: accept exits non-zero", r.status !== 0, `status=${r.status}`);
  check("9. source changed after review: reasonCode is REVIEW_SOURCE_CHANGED", r.parsed && r.parsed.reasonCode === "REVIEW_SOURCE_CHANGED", JSON.stringify(r.parsed) || r.stderr);
  check("9. source changed after review: citation files untouched", fs.readFileSync(sourcesJsonPath, "utf8") === originalSourcesJson
    && fs.readFileSync(canonicalPath, "utf8") === originalCanonical);
  fs.writeFileSync(jkBmsPath, originalJs); // restore for the next scenario

  // --- 10. Successful reviewed accept: updates only allowed fields; repeat accept produces no further diff ---
  // Introduce a real, reviewable drift: hand-edit jk_bms.js (simulating an
  // unreviewed implementation change) WITHOUT restamping sources.json.
  fs.writeFileSync(jkBmsPath, `${originalJs}\n// drift-regression-fixture: real change to be reviewed and accepted\n`);
  r = runCli("check");
  check("10. pre-accept: check reports drift", r.status !== 0 && r.parsed && r.parsed.reasonCode === "FINGERPRINT_MISMATCH");

  r = runCli("review");
  check("10. review of the real drift succeeds", r.status === 0 && r.parsed && r.parsed.reasonCode === "REVIEW_OK" && r.parsed.review.drift_present === true, JSON.stringify(r.parsed));
  const expectedNewFingerprint = r.parsed.review.actual_fingerprint;

  r = runCli("accept");
  check("10. accept succeeds", r.status === 0 && r.parsed && r.parsed.reasonCode === "ACCEPT_OK", JSON.stringify(r.parsed) || r.stderr);

  const afterAcceptSourcesJson = fs.readFileSync(sourcesJsonPath, "utf8");
  const afterAcceptCanonical = fs.readFileSync(canonicalPath, "utf8");
  const sourcesDoc = JSON.parse(afterAcceptSourcesJson);
  const implEntry = sourcesDoc.sources.find((s) => s.source_id === "project_implementation");
  check("10. accept updated sources.json's fingerprint to the new value",
    implEntry.fingerprint === expectedNewFingerprint, `${implEntry.fingerprint} vs ${expectedNewFingerprint}`);
  check("10. accept updated ONLY the fingerprint field in sources.json (rest of the document unchanged)", (() => {
    const before = JSON.parse(originalSourcesJson);
    const beforeImpl = before.sources.find((s) => s.source_id === "project_implementation");
    beforeImpl.fingerprint = implEntry.fingerprint;
    return JSON.stringify(before) === JSON.stringify(sourcesDoc);
  })());
  check("10. accept updated registers.canonical.json's source_fingerprint citations to the new value, nothing else", (() => {
    const before = originalCanonical.split(staleReview.stored_fingerprint).join(implEntry.fingerprint);
    return before === afterAcceptCanonical;
  })());
  r = runCli("check");
  check("10. post-accept: check exits 0 (drift resolved)", r.status === 0 && r.parsed && r.parsed.reasonCode === "FINGERPRINT_MATCH", JSON.stringify(r.parsed));

  // Repeat accept using the SAME (now-consumed) review: must not silently
  // succeed and must not produce any further file changes.
  const beforeRepeatSourcesJson = fs.readFileSync(sourcesJsonPath, "utf8");
  const beforeRepeatCanonical = fs.readFileSync(canonicalPath, "utf8");
  r = runCli("accept");
  check("10. repeat accept with the same (now-stale) review is refused, not silently re-applied",
    r.status !== 0 && r.parsed && ["REPLACEMENT_COUNT_MISMATCH", "REVIEW_SOURCES_JSON_CHANGED"].includes(r.parsed.reasonCode),
    JSON.stringify(r.parsed) || r.stderr);
  check("10. repeat accept produced NO further diff to either citation file",
    fs.readFileSync(sourcesJsonPath, "utf8") === beforeRepeatSourcesJson && fs.readFileSync(canonicalPath, "utf8") === beforeRepeatCanonical);
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}

console.log(`\n${checks} checks run, ${failures} failed.`);
process.exit(failures ? 1 : 0);
