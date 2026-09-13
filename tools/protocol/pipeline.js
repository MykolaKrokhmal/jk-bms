#!/usr/bin/env node
"use strict";

// Authoritative Stage-1 pipeline:
// immutable sources + human definitions -> normalized indexes -> claim matrix
// -> validated runtime projections -> full manifest.
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const mode = process.argv[2];
if (!new Set(["build", "check"]).has(mode)) {
  console.error("USAGE: node tools/protocol/pipeline.js build|check --workbook /path/to/file.xlsx");
  process.exit(2);
}
const workbookArg = process.argv.indexOf("--workbook");
const workbook = workbookArg === -1 ? process.env.JK_BMS_WORKBOOK_PATH : process.argv[workbookArg + 1];
if (!workbook) {
  console.error("PIPELINE_WORKBOOK_REQUIRED: use --workbook or JK_BMS_WORKBOOK_PATH");
  process.exit(2);
}

const sha = (data) => crypto.createHash("sha256").update(data).digest("hex");
const hashFile = (p) => sha(fs.readFileSync(p));
const rel = (p) => path.relative(ROOT, p);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jk-bms-protocol-pipeline-"));
const lockPath = path.join(ROOT, "protocol", "generated", ".pipeline.lock");
const manifestPath = path.join(ROOT, "protocol", "generated", ".pipeline-manifest.json");
let lockFd;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: "utf8", ...options });
  if (result.status !== 0) {
    process.stderr.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    throw new Error(`PIPELINE_COMMAND_FAILED:${path.basename(command)}:${result.status}`);
  }
  return result.stdout.trim();
}

function copy(relative) {
  const target = path.join(tmp, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(ROOT, relative), target);
}

function normalizedImplementationFingerprint() {
  let js = fs.readFileSync(path.join(ROOT, "jk_bms.js"), "utf8");
  const begin = js.indexOf("  // >>> BEGIN GENERATED PROTOCOL CATALOG");
  const endMarker = js.indexOf("  // <<< END GENERATED PROTOCOL CATALOG");
  const end = js.indexOf("\n", endMarker);
  if (begin < 0 || endMarker < 0) throw new Error("PIPELINE_JS_MARKERS_MISSING");
  js = js.slice(0, begin) + "<GENERATED_PROTOCOL_CATALOG>\n" + js.slice(end + 1);
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(path.join(ROOT, "batterylifepo4.yaml")));
  hash.update(Buffer.from([0]));
  hash.update(js);
  return `sha256:${hash.digest("hex")}`;
}

function fullManifest() {
  const files = [
    "protocol/evidence/sources.json",
    "protocol/evidence/workbook_index.json",
    "protocol/evidence/upstream_index.json",
    "protocol/evidence/implementation_index.json",
    "protocol/registers.canonical.json",
    "protocol/non_register_entities.canonical.json",
    "protocol/generated/claim_matrix.json",
    "register_catalog.json",
    "protocol/generated/coverage_report.md",
    "protocol/generated/.generation-manifest.json",
    "jk_bms.js",
  ];
  const file_hashes = Object.fromEntries(files.map((file) => [file, hashFile(path.join(ROOT, file))]));
  return {
    pipeline_version: 1,
    node_version: process.version,
    python_version: run("python3", ["--version"]).replace(/^Python\s+/, ""),
    file_hashes,
    generation_id: sha(JSON.stringify(file_hashes)).slice(0, 16),
  };
}

function publish(source, target) {
  const staging = `${target}.tmp-${process.pid}`;
  fs.copyFileSync(source, staging);
  const fd = fs.openSync(staging, "r");
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(staging, target);
}

try {
  if (mode === "build") {
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    try { lockFd = fs.openSync(lockPath, "wx", 0o600); }
    catch (_) { throw new Error("PIPELINE_LOCKED"); }
  }

  const lockedNode = fs.readFileSync(path.join(ROOT, ".node-version"), "utf8").trim();
  if (process.version.replace(/^v/, "") !== lockedNode) throw new Error(`PIPELINE_NODE_VERSION_MISMATCH:${process.version}:${lockedNode}`);
  const yaml = fs.readFileSync(path.join(ROOT, "batterylifepo4.yaml"), "utf8");
  if (/external_components_source:\s*\S+@(main|master|latest)\b/.test(yaml)) throw new Error("MUTABLE_EXTERNAL_COMPONENT_REVISION");

  const sourceDoc = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol/evidence/sources.json"), "utf8"));
  const implementationSource = sourceDoc.sources.find((s) => s.source_id === "project_implementation");
  if (implementationSource.fingerprint !== normalizedImplementationFingerprint()) throw new Error("IMPLEMENTATION_SOURCE_FINGERPRINT_MISMATCH");

  copy("protocol/registers.canonical.json");
  copy("protocol/non_register_entities.canonical.json");
  copy("protocol/evidence/sources.json");
  const tempWorkbook = path.join(tmp, "protocol/evidence/workbook_index.json");
  const tempUpstream = path.join(tmp, "protocol/evidence/upstream_index.json");
  const tempImplementation = path.join(tmp, "protocol/evidence/implementation_index.json");
  const tempClaims = path.join(tmp, "protocol/generated/claim_matrix.json");

  run("python3", ["protocol/evidence/build_workbook_index.py", "--workbook", workbook, "--output", tempWorkbook]);
  run("python3", ["protocol/evidence/build_upstream_index.py", "--output", tempUpstream]);
  run("python3", ["protocol/evidence/build_implementation_index.py", "--output", tempImplementation]);
  run(process.execPath, ["protocol/evidence/build_claim_matrix.js", "--root", tmp, "--output", tempClaims]);
  // Re-run in --check mode against the file just written: the freshness
  // half is a trivial self-compare (this IS the file), so the only thing
  // that can fail here is CLAIM_POLICY_INCONSISTENT — a real assertion
  // that was previously computed but never enforced anywhere.
  run(process.execPath, ["protocol/evidence/build_claim_matrix.js", "--root", tmp, "--output", tempClaims, "--check"]);

  const generated = [
    [tempWorkbook, path.join(ROOT, "protocol/evidence/workbook_index.json")],
    [tempUpstream, path.join(ROOT, "protocol/evidence/upstream_index.json")],
    [tempImplementation, path.join(ROOT, "protocol/evidence/implementation_index.json")],
    [tempClaims, path.join(ROOT, "protocol/generated/claim_matrix.json")],
  ];
  if (mode === "check") {
    const stale = generated.filter(([a, b]) => !fs.existsSync(b) || !fs.readFileSync(a).equals(fs.readFileSync(b)));
    if (stale.length) throw new Error(`PIPELINE_DERIVED_ARTIFACT_STALE:${stale.map(([, p]) => rel(p)).join(",")}`);
  } else {
    for (const [source, target] of generated) publish(source, target);
    console.log("pipeline indexes/claim matrix published");
  }

  run(process.execPath, ["test/register_catalog/validate.js"]);
  if (mode === "build") run(process.execPath, ["tools/protocol/generate.js"]);
  run(process.execPath, ["tools/protocol/generate.js", "--check"]);

  const expectedManifest = JSON.stringify(fullManifest(), null, 2) + "\n";
  if (mode === "check") {
    const current = fs.existsSync(manifestPath) ? fs.readFileSync(manifestPath, "utf8") : null;
    if (current !== expectedManifest) throw new Error("PIPELINE_MANIFEST_STALE");
  } else {
    const staged = `${manifestPath}.tmp-${process.pid}`;
    fs.writeFileSync(staged, expectedManifest);
    fs.renameSync(staged, manifestPath);
  }
  console.log(`protocol-pipeline ${mode} PASS`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
  try { if (lockFd !== undefined) fs.closeSync(lockFd); } catch (_) { /* best effort */ }
  if (mode === "build") { try { fs.unlinkSync(lockPath); } catch (_) { /* best effort */ } }
}
