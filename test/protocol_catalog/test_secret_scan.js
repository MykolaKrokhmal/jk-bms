#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const FIXTURE_ROOT = path.join(__dirname, "fixtures", "secret_scan");
const POSITIVE_FIXTURE = path.join(FIXTURE_ROOT, "synthetic_positive.fixture");
const NEGATIVE_FIXTURE = path.join(FIXTURE_ROOT, "placeholder_negative.fixture");
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const HISTORY_COMMIT_LIMIT = 25;

// The synthetic positive fixture is DELIBERATELY detectable (assertFixtureBehavior()
// below requires it) -- it must be excluded from every scan that could report
// it as a real leak, not just scanWorktree(). Once this file is committed
// (it lives under version control, same as any other test fixture),
// scanIndex() and scanRecentHistory() would otherwise "find" it too and
// fail the whole suite on a fixture that is working exactly as intended.
const DEFAULT_EXCLUDED_FILES = new Set([path.relative(REPO_ROOT, POSITIVE_FIXTURE)]);

const DETECTORS = [
  {
    id: "PRIVATE_KEY_BLOCK",
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g,
    value: (match) => match[0],
  },
  {
    id: "AUTHORIZATION_HEADER",
    regex: /\bAuthorization\s*:\s*(?:Basic|Bearer)\s+([^\s"']+)/gi,
    value: (match) => match[1],
  },
  {
    id: "CREDENTIAL_ASSIGNMENT",
    regex: /\b(?:password|passwd|pwd|token|api[_-]?key|ota[_-]?password|web[_-]?password|wifi[_-]?password|secret)\b\s*(?:=|:)\s*(?:["']?(!(?:secret|env_var)\s+[A-Za-z_][A-Za-z0-9_]*)|["']?([^\s,"'`;#}]+))/gi,
    value: (match) => match[1] || match[2],
  },
  {
    id: "URL_EMBEDDED_CREDENTIAL",
    regex: /\b(?:https?|mqtts?):\/\/([^\s:@/]+):([^\s@/]+)@/gi,
    value: (match) => `${match[1]}:${match[2]}`,
  },
];

// Security remediation (2026-09-25): the device's setup-passcode readback
// entity published the decoded credential as a generic JSON `"state"` /
// `"value"` field in /events captures, which no key=value detector matches.
// This detector finds such records structurally; only an empty value or a
// `<...>` redaction marker is safe. Its findings never carry a fingerprint.
const CREDENTIAL_RECORD = /^[^\n]*"id":"text_sensor(?:\/[^"\/]*)?[\/-]setup[ _]passcode[ _]readback"[^\n]*$/gm;
const CREDENTIAL_FIELD = /"(?:value|state)":"((?:[^"\\]|\\.)*)"/g;
function credentialRecordValue(match) {
  for (const field of match[0].matchAll(CREDENTIAL_FIELD)) {
    if (field[1] !== "" && !/^<[^>]+>$/.test(field[1])) return field[1];
  }
  return "<none>";
}
const CREDENTIAL_DETECTOR = { id: "CREDENTIAL_READBACK_STATE", regex: CREDENTIAL_RECORD, value: credentialRecordValue, withholdFingerprint: true };

const SAFE_VALUE_PATTERNS = [
  /^!secret\s+[A-Za-z_][A-Za-z0-9_]*$/,
  /^!env_var\s+[A-Za-z_][A-Za-z0-9_]*$/,
  /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/,
  /^\$[A-Za-z_][A-Za-z0-9_]*$/,
  /^(?:redacted|placeholder|example|dummy|changeme|not-a-secret|test-only)$/i,
  /^<[^>]+>$/,
  // Self-describing example placeholders used in this repo's own
  // secrets.yaml.example (and its git history) — never real credentials,
  // always literal text telling the reader to replace the value. Narrow
  // on purpose: only whole-value matches, not a general "contains a
  // capital letter" carve-out, so a real password that merely resembles
  // one of these words is still caught.
  /^Your[A-Z][A-Za-z0-9]*$/,
  /^REPLACE_WITH_[A-Z0-9_]+=?$/,
];

function git(args, options = {}) {
  return spawnSync("git", args, {
    cwd: REPO_ROOT,
    encoding: options.encoding === undefined ? "utf8" : options.encoding,
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
}

function isProbablyBinary(buffer) {
  if (!buffer.length) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 0) return true;
    if (byte < 7 || (byte > 13 && byte < 32)) suspicious += 1;
  }
  return suspicious / sample.length > 0.1;
}

function fingerprint(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
}

function isSafeReference(value) {
  const normalized = String(value).trim();
  return SAFE_VALUE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function lineAt(text, offset) {
  let line = 1;
  for (let index = 0; index < offset; index += 1) if (text.charCodeAt(index) === 10) line += 1;
  return line;
}

function scanText(text, fileLabel, scope, findings, detectors = DETECTORS.concat([CREDENTIAL_DETECTOR])) {
  for (const detector of detectors) {
    detector.regex.lastIndex = 0;
    for (let match = detector.regex.exec(text); match; match = detector.regex.exec(text)) {
      const value = detector.value(match);
      if (isSafeReference(value)) continue;
      findings.push({
        scope,
        file: fileLabel,
        line: lineAt(text, match.index),
        detector: detector.id,
        fingerprint: detector.withholdFingerprint ? "withheld" : `sha256:${fingerprint(value)}`,
      });
      if (match[0].length === 0) detector.regex.lastIndex += 1;
    }
  }
}

/** Git-aware project file list: every TRACKED file, plus every UNTRACKED
 * file git itself would NOT ignore. This is what "this project's files"
 * actually means -- unlike a raw filesystem walk keyed on a hardcoded
 * directory-name blacklist (the previous approach here), it automatically
 * follows .gitignore, so an ignored nested path (a sibling git worktree
 * under .claude/worktrees/, .esphome/ build output, or anything else this
 * repo's .gitignore names) can never leak into a scan just because it
 * happens to exist on disk -- while a real, not-yet-committed new file
 * with a real secret in it is still caught, because it's untracked but
 * NOT ignored. `git ls-files` never descends into an ignored directory in
 * the first place (not even to list what's inside it), so this is a
 * structural exclusion, not a convenience blacklist of file names. */
function listProjectFiles() {
  const tracked = git(["ls-files", "-z"], { encoding: "buffer" });
  if (tracked.status !== 0) throw new Error("git ls-files failed");
  const untracked = git(["ls-files", "--others", "--exclude-standard", "-z"], { encoding: "buffer" });
  if (untracked.status !== 0) throw new Error("git ls-files --others --exclude-standard failed");
  const files = new Set([
    ...tracked.stdout.toString("utf8").split("\0").filter(Boolean),
    ...untracked.stdout.toString("utf8").split("\0").filter(Boolean),
  ]);
  return [...files].sort();
}

function scanWorktree(findings, statistics) {
  for (const relative of listProjectFiles()) {
    if (DEFAULT_EXCLUDED_FILES.has(relative)) continue;
    const absolute = path.join(REPO_ROOT, relative);
    let stat;
    try { stat = fs.statSync(absolute); } catch (_) { continue; } // listed then deleted/renamed mid-scan
    if (!stat.isFile()) continue; // e.g. a broken symlink git still tracks
    if (stat.size > MAX_FILE_BYTES) {
      statistics.skippedLarge += 1;
      scanLargeForCredentials(fs.readFileSync(absolute), relative, "worktree", findings, statistics);
      continue;
    }
    const buffer = fs.readFileSync(absolute);
    if (isProbablyBinary(buffer)) {
      statistics.skippedBinary += 1;
      continue;
    }
    statistics.worktreeFiles += 1;
    scanText(buffer.toString("utf8"), relative, "worktree", findings);
  }
}

function scanIndex(findings, statistics) {
  const listed = git(["ls-files", "-z"], { encoding: "buffer" });
  if (listed.status !== 0) throw new Error("git ls-files failed");
  const files = listed.stdout.toString("utf8").split("\0").filter(Boolean);
  for (const relative of files) {
    if (DEFAULT_EXCLUDED_FILES.has(relative)) continue;
    const blob = git(["show", `:${relative}`], { encoding: "buffer" });
    if (blob.status !== 0) continue;
    if (blob.stdout.length > MAX_FILE_BYTES) {
      statistics.skippedLarge += 1;
      scanLargeForCredentials(blob.stdout, relative, "index", findings, statistics);
      continue;
    }
    if (isProbablyBinary(blob.stdout)) {
      statistics.skippedBinary += 1;
      continue;
    }
    statistics.indexFiles += 1;
    scanText(blob.stdout.toString("utf8"), relative, "index", findings);
  }
}

function scanRecentHistory(findings, statistics) {
  const revisions = git(["rev-list", `--max-count=${HISTORY_COMMIT_LIMIT}`, "--all"]);
  if (revisions.status !== 0) throw new Error("git rev-list failed");
  for (const revision of revisions.stdout.split(/\r?\n/).filter(Boolean)) {
    const files = git(["ls-tree", "-r", "--name-only", "-z", revision], { encoding: "buffer" });
    if (files.status !== 0) continue;
    for (const relative of files.stdout.toString("utf8").split("\0").filter(Boolean)) {
      if (DEFAULT_EXCLUDED_FILES.has(relative)) continue;
      const blob = git(["show", `${revision}:${relative}`], { encoding: "buffer" });
      if (blob.status !== 0) continue;
      if (blob.stdout.length > MAX_FILE_BYTES) {
        scanLargeForCredentials(blob.stdout, `${revision.slice(0, 12)}:${relative}`, "history", findings, statistics);
        continue;
      }
      if (isProbablyBinary(blob.stdout)) continue;
      statistics.historyFiles += 1;
      scanText(blob.stdout.toString("utf8"), `${revision.slice(0, 12)}:${relative}`, "history", findings);
    }
  }
}

// Files above MAX_FILE_BYTES skip the general detectors, but NOT the
// credential-record detector: the leaking captures were large SSE logs.
function scanLargeForCredentials(buffer, fileLabel, scope, findings, statistics) {
  if (isProbablyBinary(buffer)) return;
  if (statistics) statistics.largeCredentialScanned = (statistics.largeCredentialScanned || 0) + 1;
  scanText(buffer.toString("utf8"), fileLabel, scope, findings, [CREDENTIAL_DETECTOR]);
}

function assertFixtureBehavior() {
  const positiveFindings = [];
  const negativeFindings = [];
  scanText(fs.readFileSync(POSITIVE_FIXTURE, "utf8"), path.relative(REPO_ROOT, POSITIVE_FIXTURE), "synthetic-positive", positiveFindings);
  scanText(fs.readFileSync(NEGATIVE_FIXTURE, "utf8"), path.relative(REPO_ROOT, NEGATIVE_FIXTURE), "synthetic-negative", negativeFindings);
  if (positiveFindings.length === 0) throw new Error("synthetic positive fixture was not detected");
  if (negativeFindings.length !== 0) throw new Error("valid placeholder fixture produced a false positive");
  const credentialFindings = positiveFindings.filter((f) => f.detector === CREDENTIAL_DETECTOR.id);
  if (credentialFindings.length === 0) throw new Error("synthetic setup-passcode-readback record was not detected");
  if (credentialFindings.some((f) => f.fingerprint !== "withheld")) throw new Error("credential finding exposed a fingerprint");
  // A record deep inside a >MAX_FILE_BYTES capture must still be found.
  // Assembled from parts so this scanner's own source never contains a
  // matching record line.
  const entity = ["text_sensor/setup passcode", "readback"].join(" ");
  const large = Buffer.from("x".repeat(MAX_FILE_BYTES + 1024) + "\n" +
    `data: {"id":"${entity}","value":"synthetic-fixture-passcode-0000","state":"synthetic-fixture-passcode-0000"}\n`);
  const largeFindings = [];
  scanLargeForCredentials(large, "synthetic-large-capture", "synthetic-positive", largeFindings);
  if (largeFindings.length === 0) throw new Error("a credential record inside a large capture was not detected");
}

/** Regression for Work 4 (final preparation pass): scanWorktree() must be
 * git-aware (tracked + untracked-non-ignored), not a raw filesystem walk,
 * so an ignored nested path -- a sibling git worktree living under
 * .claude/worktrees/, exactly like this repo's own corrective worktree --
 * can never leak a false positive into the scan just by existing on disk,
 * while a real untracked-but-not-ignored file is still caught. Uses a
 * temporary probe under .claude/ (already blanket-ignored by this repo's
 * own .gitignore) rather than depending on whether a real sibling worktree
 * happens to exist right now. */
function assertGitAwareScopeBehavior() {
  const ignoredProbeDir = path.join(REPO_ROOT, ".claude", "secret-scan-self-test");
  const ignoredProbeFile = path.join(ignoredProbeDir, "nested-worktree-simulation.fixture");
  const untrackedProbeFile = path.join(FIXTURE_ROOT, ".secret-scan-self-test-untracked.fixture");
  try {
    fs.mkdirSync(ignoredProbeDir, { recursive: true });
    fs.writeFileSync(ignoredProbeFile, fs.readFileSync(POSITIVE_FIXTURE));
    fs.writeFileSync(untrackedProbeFile, "placeholder_probe_value = changeme\n");

    const listed = new Set(listProjectFiles());
    const ignoredRelative = path.relative(REPO_ROOT, ignoredProbeFile);
    const untrackedRelative = path.relative(REPO_ROOT, untrackedProbeFile);

    if (listed.has(ignoredRelative) || [...listed].some((f) => f.startsWith(".claude/"))) {
      throw new Error(`git-aware file list leaked an ignored path (expected .claude/ to be structurally excluded): ${ignoredRelative}`);
    }
    if (!listed.has(untrackedRelative)) {
      throw new Error(`git-aware file list dropped a real untracked-but-not-ignored file: ${untrackedRelative}`);
    }

    // The probe secret lives under an ignored directory -- a full scan run
    // must therefore never report it, proving the exclusion holds on the
    // actual detection path, not just the raw file listing.
    const findings = [];
    const statistics = { worktreeFiles: 0, indexFiles: 0, historyFiles: 0, skippedBinary: 0, skippedLarge: 0 };
    scanWorktree(findings, statistics);
    if (findings.some((f) => f.file === ignoredRelative)) {
      throw new Error("scanWorktree() reported a finding inside an ignored nested path");
    }
  } finally {
    try { fs.rmSync(ignoredProbeDir, { recursive: true, force: true }); } catch (_) { /* best effort */ }
    try { fs.rmSync(untrackedProbeFile, { force: true }); } catch (_) { /* best effort */ }
  }
}

/** Regression: a secret that's staged (git add'ed) but not yet committed
 * must still be caught -- scanIndex() reads blob content via `git show
 * :path`, which is exactly the staging area, not HEAD. Proven here against
 * an isolated scratch repo (never this project's own repo/index), so this
 * test can never leave a secret-shaped string staged in the real project's
 * git state, even if it crashed mid-way. */
function assertStagedSecretDetected() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "jk-bms-secret-scan-staged-test-"));
  try {
    const run = (args) => spawnSync("git", args, { cwd: scratch, encoding: "utf8" });
    run(["init", "-q"]);
    run(["config", "user.email", "test@example.invalid"]);
    run(["config", "user.name", "test"]);
    // Built from pieces at runtime, never written as one contiguous
    // "word: value" substring in THIS file's own source text -- otherwise
    // this test file itself (a real tracked file in this repo) would trip
    // its own detector when the real scan later runs against the repo.
    const secretFieldName = "ota_pass" + "word";
    const secretFieldValue = "hunter2-not-a-real-secret-abc123";
    fs.writeFileSync(path.join(scratch, "manifest.yaml"), `${secretFieldName}: "${secretFieldValue}"\n`);
    const added = run(["add", "manifest.yaml"]);
    if (added.status !== 0) throw new Error(`scratch repo: git add failed: ${added.stderr}`);

    const blob = run(["show", ":manifest.yaml"]);
    if (blob.status !== 0) throw new Error(`scratch repo: git show :manifest.yaml failed: ${blob.stderr}`);

    const findings = [];
    scanText(blob.stdout, "manifest.yaml", "index", findings);
    if (findings.length === 0) throw new Error("a staged (git-added, uncommitted) secret-shaped value was not detected via `git show :path`");
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

function main() {
  assertFixtureBehavior();
  assertGitAwareScopeBehavior();
  assertStagedSecretDetected();
  const findings = [];
  const statistics = { worktreeFiles: 0, indexFiles: 0, historyFiles: 0, skippedBinary: 0, skippedLarge: 0 };
  scanWorktree(findings, statistics);
  scanIndex(findings, statistics);
  scanRecentHistory(findings, statistics);

  const unique = new Map();
  for (const finding of findings) {
    const key = `${finding.scope}\0${finding.file}\0${finding.line}\0${finding.detector}\0${finding.fingerprint}`;
    unique.set(key, finding);
  }

  for (const finding of unique.values()) {
    console.error(`SECRET_SCAN_LEAK scope=${finding.scope} file=${finding.file} line=${finding.line} detector=${finding.detector} fingerprint=${finding.fingerprint}`);
  }
  console.log(`secret-scan files(worktree=${statistics.worktreeFiles},index=${statistics.indexFiles},history=${statistics.historyFiles}) skipped(binary=${statistics.skippedBinary},large=${statistics.skippedLarge}; large files credential-scanned=${statistics.largeCredentialScanned || 0}) fixtures(positive=detected,negative=clean)`);
  if (unique.size > 0) process.exit(1);
  console.log("secret-scan PASS");
}

try {
  main();
} catch (error) {
  console.error(`SECRET_SCAN_ERROR ${error && error.message ? error.message : String(error)}`);
  process.exit(2);
}
