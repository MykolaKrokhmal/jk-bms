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
const { computeImplementationFingerprint } = require("./lib/fingerprint");
const { computeReleaseGenerationId } = require("./lib/release-id");

const ROOT = path.join(__dirname, "..", "..");
const mode = process.argv[2];
if (!new Set(["build", "check"]).has(mode)) {
  console.error("USAGE: node tools/protocol/pipeline.js build|check [--workbook /path/to/file.xlsx]");
  process.exit(2);
}
const workbookArg = process.argv.indexOf("--workbook");
const workbook = workbookArg === -1 ? process.env.JK_BMS_WORKBOOK_PATH : process.argv[workbookArg + 1];
// Work 3 (final preparation pass): the V1 workbook is now OPTIONAL. The
// repo-committed, SHA-256-verified V2 workbook (build_workbook_v2_index.py)
// is sufficient evidence for a standard, self-contained check on any
// checkout -- no personal absolute path required. When a V1 workbook IS
// supplied (--workbook or JK_BMS_WORKBOOK_PATH), it is still used as an
// additional revalidation layer over the legacy evidence index it
// produces; when it is not, the committed
// protocol/evidence/workbook_index.json is carried through completely
// unchanged (never regenerated, never deleted, never blanked) and excluded
// from this run's staleness/generation-id cross-checks, so a V1 index
// nobody can regenerate without the private file can never mask an
// unrelated catalog change elsewhere (see the `workbook ? ... :` branches
// below).

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

// Single reusable implementation now lives in tools/protocol/lib/fingerprint.js
// (also used by tools/protocol/fingerprint.js's check/review/accept CLI) —
// this used to be a second, independent copy of the same algorithm, which
// is exactly how the two could silently drift apart from each other.
function normalizedImplementationFingerprint() {
  return computeImplementationFingerprint(ROOT);
}

function fullManifest() {
  const files = [
    "protocol/evidence/sources.json",
    "protocol/evidence/workbook_index.json",
    "protocol/evidence/workbook_v2_index.json",
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
    release_generation_id: computeReleaseGenerationId(ROOT),
    node_version: process.version,
    python_version: run("python3", ["--version"]).replace(/^Python\s+/, ""),
    file_hashes,
    generation_id: sha(JSON.stringify(file_hashes)).slice(0, 16),
  };
}

/** Reads a JSON file, adds/overwrites `release_generation_id`, writes it
 * back to the same path. Used to stamp the id into the python/JS-generated
 * evidence index and claim-matrix files, which don't know about this
 * concept themselves — kept as one post-processing step here rather than
 * teaching four separate generator scripts (three Python, one Node) about
 * it, so there is exactly one place this stamping logic can drift. */
function stampReleaseGenerationId(jsonPath, releaseGenerationId) {
  const doc = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  doc.release_generation_id = releaseGenerationId;
  fs.writeFileSync(jsonPath, `${JSON.stringify(doc, null, 2)}\n`);
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

  // Work 7 (Stage 1 corrective pass): one release_generation_id, derived
  // purely from immutable inputs, embedded in every derived artifact below
  // and cross-checked at the end of this run.
  const releaseGenerationId = computeReleaseGenerationId(ROOT);

  copy("protocol/registers.canonical.json");
  copy("protocol/non_register_entities.canonical.json");
  copy("protocol/evidence/sources.json");
  // Stage 4 (typed-petting-puzzle plan §5): build_claim_matrix.js reads
  // this as a second, independent implementation-evidence source (see its
  // own comment) -- copied optionally, matching that script's own
  // graceful-absence handling, so a checkout that hasn't run
  // generate_write_registry.js yet still runs the rest of this pipeline.
  if (fs.existsSync(path.join(ROOT, "protocol/generated/write_registry.json"))) {
    copy("protocol/generated/write_registry.json");
  }
  const tempWorkbook = path.join(tmp, "protocol/evidence/workbook_index.json");
  const tempWorkbookV2 = path.join(tmp, "protocol/evidence/workbook_v2_index.json");
  const tempUpstream = path.join(tmp, "protocol/evidence/upstream_index.json");
  const tempImplementation = path.join(tmp, "protocol/evidence/implementation_index.json");
  const tempClaims = path.join(tmp, "protocol/generated/claim_matrix.json");

  if (workbook) {
    run("python3", ["protocol/evidence/build_workbook_index.py", "--workbook", workbook, "--output", tempWorkbook]);
  } else {
    const committedWorkbookIndex = path.join(ROOT, "protocol/evidence/workbook_index.json");
    if (!fs.existsSync(committedWorkbookIndex)) throw new Error("PIPELINE_WORKBOOK_INDEX_MISSING_FOR_FALLBACK");
    fs.mkdirSync(path.dirname(tempWorkbook), { recursive: true });
    fs.copyFileSync(committedWorkbookIndex, tempWorkbook);
    console.log("V1 workbook not supplied (--workbook / JK_BMS_WORKBOOK_PATH) -- legacy workbook_index.json " +
      "carried through unchanged from the committed copy; excluded from this run's staleness/generation-id checks. " +
      "This is optional additional revalidation, not part of the standard self-contained check (ADR tenth-pass addendum).");
  }
  // The V2 workbook is a repo-committed evidence file (unlike the V1
  // workbook's external, never-hardcoded personal path) — the indexer
  // defaults to it on its own; no --workbook needed here.
  run("python3", ["protocol/evidence/build_workbook_v2_index.py", "--output", tempWorkbookV2]);
  run("python3", ["protocol/evidence/build_upstream_index.py", "--output", tempUpstream]);
  run("python3", ["protocol/evidence/build_implementation_index.py", "--output", tempImplementation]);
  run(process.execPath, ["protocol/evidence/build_claim_matrix.js", "--root", tmp, "--output", tempClaims]);
  // Re-run in --check mode against the file just written: the freshness
  // half is a trivial self-compare (this IS the file), so the only thing
  // that can fail here is CLAIM_POLICY_INCONSISTENT — a real assertion
  // that was previously computed but never enforced anywhere. Must run
  // BEFORE stamping: stamping adds release_generation_id, and this --check
  // recomputes its own payload from scratch (no release_generation_id of
  // its own), so checking a stamped file here would always report drift.
  run(process.execPath, ["protocol/evidence/build_claim_matrix.js", "--root", tmp, "--output", tempClaims, "--check"]);
  const toStamp = [tempWorkbookV2, tempUpstream, tempImplementation, tempClaims];
  if (workbook) toStamp.push(tempWorkbook);
  for (const p of toStamp) stampReleaseGenerationId(p, releaseGenerationId);

  const generated = [
    [tempWorkbookV2, path.join(ROOT, "protocol/evidence/workbook_v2_index.json")],
    [tempUpstream, path.join(ROOT, "protocol/evidence/upstream_index.json")],
    [tempImplementation, path.join(ROOT, "protocol/evidence/implementation_index.json")],
    [tempClaims, path.join(ROOT, "protocol/generated/claim_matrix.json")],
  ];
  // workbook_index.json (V1) participates in staleness/publish only when a
  // V1 workbook was actually supplied this run -- otherwise the committed
  // copy is left exactly as it is (see the copy-through branch above).
  if (workbook) generated.push([tempWorkbook, path.join(ROOT, "protocol/evidence/workbook_index.json")]);
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

  // Work 7: every artifact generate.js owns must carry the SAME
  // release_generation_id as the one this run just computed and stamped
  // into the evidence/claim-matrix files above. A mismatch here means
  // register_catalog.json/coverage_report.md/.generation-manifest.json/
  // jk_bms.js's generated block belong to a DIFFERENT generation than the
  // evidence indices — exactly the "mixed generation" state that must
  // never pass check (Gate 1 criterion 17), whatever each individual
  // file's own staleness check happened to conclude.
  const registerCatalogDoc = JSON.parse(fs.readFileSync(path.join(ROOT, "register_catalog.json"), "utf8"));
  const generationManifestDoc = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol/generated/.generation-manifest.json"), "utf8"));
  const coverageReportText = fs.readFileSync(path.join(ROOT, "protocol/generated/coverage_report.md"), "utf8");
  const jkBmsJsText = fs.readFileSync(path.join(ROOT, "jk_bms.js"), "utf8");
  const jsBlockMatch = jkBmsJsText.match(/releaseGenerationId:\s*"([0-9a-f]+)"/);
  const idsToCompare = {
    "register_catalog.json": registerCatalogDoc.release_generation_id,
    "protocol/generated/.generation-manifest.json": generationManifestDoc.release_generation_id,
    "protocol/generated/coverage_report.md": (coverageReportText.match(/Release generation id: `([0-9a-f]+)`/) || [])[1],
    "jk_bms.js (generated block)": jsBlockMatch ? jsBlockMatch[1] : undefined,
    "protocol/evidence/workbook_v2_index.json": JSON.parse(fs.readFileSync(path.join(ROOT, "protocol/evidence/workbook_v2_index.json"), "utf8")).release_generation_id,
    "protocol/evidence/upstream_index.json": JSON.parse(fs.readFileSync(path.join(ROOT, "protocol/evidence/upstream_index.json"), "utf8")).release_generation_id,
    "protocol/evidence/implementation_index.json": JSON.parse(fs.readFileSync(path.join(ROOT, "protocol/evidence/implementation_index.json"), "utf8")).release_generation_id,
    "protocol/generated/claim_matrix.json": JSON.parse(fs.readFileSync(path.join(ROOT, "protocol/generated/claim_matrix.json"), "utf8")).release_generation_id,
  };
  // Same optionality as above: workbook_index.json (V1) only has to agree
  // on this run's release_generation_id when V1 was actually supplied.
  if (workbook) {
    idsToCompare["protocol/evidence/workbook_index.json"] =
      JSON.parse(fs.readFileSync(path.join(ROOT, "protocol/evidence/workbook_index.json"), "utf8")).release_generation_id;
  }
  const mismatched = Object.entries(idsToCompare).filter(([, id]) => id !== releaseGenerationId);
  if (mismatched.length) {
    throw new Error(`RELEASE_GENERATION_ID_MISMATCH:expected=${releaseGenerationId}:` +
      mismatched.map(([file, id]) => `${file}=${id || "MISSING"}`).join(","));
  }

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
