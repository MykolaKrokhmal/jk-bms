#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const FIXTURE_ROOT = path.join(__dirname, "fixtures", "secret_scan");
const POSITIVE_FIXTURE = path.join(FIXTURE_ROOT, "synthetic_positive.fixture");
const NEGATIVE_FIXTURE = path.join(FIXTURE_ROOT, "placeholder_negative.fixture");
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const HISTORY_COMMIT_LIMIT = 25;

const EXCLUDED_DIRS = new Set([".git", "node_modules", ".pio", ".esphome", "__pycache__"]);
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

function scanText(text, fileLabel, scope, findings) {
  for (const detector of DETECTORS) {
    detector.regex.lastIndex = 0;
    for (let match = detector.regex.exec(text); match; match = detector.regex.exec(text)) {
      const value = detector.value(match);
      if (isSafeReference(value)) continue;
      findings.push({
        scope,
        file: fileLabel,
        line: lineAt(text, match.index),
        detector: detector.id,
        fingerprint: fingerprint(value),
      });
      if (match[0].length === 0) detector.regex.lastIndex += 1;
    }
  }
}

function walkFiles(directory, result = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && EXCLUDED_DIRS.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walkFiles(absolute, result);
    else if (entry.isFile()) result.push(absolute);
  }
  return result;
}

function scanWorktree(findings, statistics) {
  for (const absolute of walkFiles(REPO_ROOT)) {
    const relative = path.relative(REPO_ROOT, absolute);
    if (DEFAULT_EXCLUDED_FILES.has(relative)) continue;
    const stat = fs.statSync(absolute);
    if (stat.size > MAX_FILE_BYTES) {
      statistics.skippedLarge += 1;
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
      if (blob.status !== 0 || blob.stdout.length > MAX_FILE_BYTES || isProbablyBinary(blob.stdout)) continue;
      statistics.historyFiles += 1;
      scanText(blob.stdout.toString("utf8"), `${revision.slice(0, 12)}:${relative}`, "history", findings);
    }
  }
}

function assertFixtureBehavior() {
  const positiveFindings = [];
  const negativeFindings = [];
  scanText(fs.readFileSync(POSITIVE_FIXTURE, "utf8"), path.relative(REPO_ROOT, POSITIVE_FIXTURE), "synthetic-positive", positiveFindings);
  scanText(fs.readFileSync(NEGATIVE_FIXTURE, "utf8"), path.relative(REPO_ROOT, NEGATIVE_FIXTURE), "synthetic-negative", negativeFindings);
  if (positiveFindings.length === 0) throw new Error("synthetic positive fixture was not detected");
  if (negativeFindings.length !== 0) throw new Error("valid placeholder fixture produced a false positive");
}

function main() {
  assertFixtureBehavior();
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
    console.error(`SECRET_SCAN_LEAK scope=${finding.scope} file=${finding.file} line=${finding.line} detector=${finding.detector} fingerprint=sha256:${finding.fingerprint}`);
  }
  console.log(`secret-scan files(worktree=${statistics.worktreeFiles},index=${statistics.indexFiles},history=${statistics.historyFiles}) skipped(binary=${statistics.skippedBinary},large=${statistics.skippedLarge}) fixtures(positive=detected,negative=clean)`);
  if (unique.size > 0) process.exit(1);
  console.log("secret-scan PASS");
}

try {
  main();
} catch (error) {
  console.error(`SECRET_SCAN_ERROR ${error && error.message ? error.message : String(error)}`);
  process.exit(2);
}
