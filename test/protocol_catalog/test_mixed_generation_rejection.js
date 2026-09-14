#!/usr/bin/env node
"use strict";

// Work 7 (Stage 1 corrective pass) regression, in two parts.
//
// PART A (always runs, no workbook needed): unit-tests
// tools/protocol/lib/release-id.js's computeReleaseGenerationId() directly
// — determinism, and that each tracked immutable input (workbook/upstream/
// implementation fingerprint, canonical file content, schema content)
// changes the id when it changes.
//
// PART B (needs the real workbook — a genuine pipeline.js build/check
// cycle really parses it; NOT_EXECUTED and exit 0, visibly, if unset):
// proves tools/protocol/pipeline.js check rejects ANY artifact whose
// release_generation_id doesn't match the rest of the generation —
// including a hand-tampered id on an otherwise-untouched file. Note on
// HOW it's caught: because release_generation_id is embedded INSIDE each
// artifact's own generated content (by design — see release-id.js's
// header comment), tampering with just that one field also changes the
// file's overall bytes, which pipeline.js's PRE-EXISTING byte-for-byte
// freshness checks (PIPELINE_DERIVED_ARTIFACT_STALE / generate.js --check
// DRIFT) already catch, ahead of the newer explicit
// RELEASE_GENERATION_ID_MISMATCH cross-file check. Both are real,
// independently-verified safety nets — this test accepts either specific
// reason, since asserting one specific ordering would be asserting an
// implementation detail, not the property that actually matters: a
// mixed-generation artifact cannot pass `check`.
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const SOURCE_ROOT = path.join(__dirname, "..", "..");
let checks = 0;
let failures = 0;
function check(name, condition, detail = "") {
  checks += 1;
  if (condition) console.log(`PASS  ${name}${detail ? `  -- ${detail}` : ""}`);
  else { failures += 1; console.log(`FAIL  ${name}${detail ? `  -- ${detail}` : ""}`); }
}

// =========================================================================
// PART A — unit tests of computeReleaseGenerationId, no workbook needed.
// =========================================================================
{
  const unitSandbox = fs.mkdtempSync(path.join(os.tmpdir(), "jk-bms-release-id-unit-"));
  const FILES = [
    "protocol/evidence/sources.json",
    "protocol/registers.canonical.json",
    "protocol/non_register_entities.canonical.json",
    "protocol/schema/register-source.schema.json",
    "protocol/schema/non-register-source.schema.json",
    "protocol/schema/evidence-sources.schema.json",
    "tools/protocol/lib/fingerprint.js",
    "tools/protocol/lib/release-id.js",
  ];
  const copy = (rel) => {
    const dst = path.join(unitSandbox, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(SOURCE_ROOT, rel), dst);
  };
  try {
    FILES.forEach(copy);
    delete require.cache[require.resolve(path.join(unitSandbox, "tools/protocol/lib/release-id.js"))];
    const { computeReleaseGenerationId } = require(path.join(unitSandbox, "tools/protocol/lib/release-id.js"));

    const id1 = computeReleaseGenerationId(unitSandbox);
    const id2 = computeReleaseGenerationId(unitSandbox);
    check("A1. computeReleaseGenerationId is deterministic (two calls, same input, same id)", id1 === id2, `${id1} vs ${id2}`);
    check("A1b. id looks like a real hex digest, not empty/placeholder", /^[0-9a-f]{16}$/.test(id1), id1);

    const sourcesPath = path.join(unitSandbox, "protocol", "evidence", "sources.json");
    const originalSources = fs.readFileSync(sourcesPath, "utf8");

    function mutateFingerprintAndRecompute(sourceId) {
      const doc = JSON.parse(originalSources);
      const entry = doc.sources.find((s) => s.source_id === sourceId);
      const originalFp = entry.fingerprint;
      const fake = `sha256:${crypto.createHash("sha256").update(`${originalFp}-mutated-fixture`).digest("hex")}`;
      entry.fingerprint = fake;
      fs.writeFileSync(sourcesPath, JSON.stringify(doc, null, 2));
      delete require.cache[require.resolve(path.join(unitSandbox, "tools/protocol/lib/release-id.js"))];
      const mutatedId = require(path.join(unitSandbox, "tools/protocol/lib/release-id.js")).computeReleaseGenerationId(unitSandbox);
      fs.writeFileSync(sourcesPath, originalSources);
      return mutatedId;
    }

    const idAfterWorkbookFpChange = mutateFingerprintAndRecompute("workbook_lifepo4_bms_parameters_registers");
    check("A2. changing the workbook source fingerprint changes release_generation_id", idAfterWorkbookFpChange !== id1, `${idAfterWorkbookFpChange} vs ${id1}`);

    const idAfterUpstreamFpChange = mutateFingerprintAndRecompute("upstream_syssi_esphome_jk_bms");
    check("A3. changing the upstream source fingerprint changes release_generation_id", idAfterUpstreamFpChange !== id1, `${idAfterUpstreamFpChange} vs ${id1}`);

    const idAfterImplFpChange = mutateFingerprintAndRecompute("project_implementation");
    check("A4. changing the implementation fingerprint changes release_generation_id", idAfterImplFpChange !== id1, `${idAfterImplFpChange} vs ${id1}`);

    const canonicalPath = path.join(unitSandbox, "protocol", "registers.canonical.json");
    const originalCanonical = fs.readFileSync(canonicalPath, "utf8");
    fs.writeFileSync(canonicalPath, `${originalCanonical}\n`); // trivial byte-level change
    delete require.cache[require.resolve(path.join(unitSandbox, "tools/protocol/lib/release-id.js"))];
    const idAfterCanonicalChange = require(path.join(unitSandbox, "tools/protocol/lib/release-id.js")).computeReleaseGenerationId(unitSandbox);
    fs.writeFileSync(canonicalPath, originalCanonical);
    check("A5. changing registers.canonical.json's content changes release_generation_id", idAfterCanonicalChange !== id1, `${idAfterCanonicalChange} vs ${id1}`);

    const schemaPath = path.join(unitSandbox, "protocol", "schema", "register-source.schema.json");
    const originalSchema = fs.readFileSync(schemaPath, "utf8");
    fs.writeFileSync(schemaPath, `${originalSchema}\n`);
    delete require.cache[require.resolve(path.join(unitSandbox, "tools/protocol/lib/release-id.js"))];
    const idAfterSchemaChange = require(path.join(unitSandbox, "tools/protocol/lib/release-id.js")).computeReleaseGenerationId(unitSandbox);
    fs.writeFileSync(schemaPath, originalSchema);
    check("A6. changing a schema file's content changes release_generation_id", idAfterSchemaChange !== id1, `${idAfterSchemaChange} vs ${id1}`);

    delete require.cache[require.resolve(path.join(unitSandbox, "tools/protocol/lib/release-id.js"))];
    const idFinal = require(path.join(unitSandbox, "tools/protocol/lib/release-id.js")).computeReleaseGenerationId(unitSandbox);
    check("A7. after restoring every mutated input, the id returns to the original value", idFinal === id1, `${idFinal} vs ${id1}`);
  } finally {
    fs.rmSync(unitSandbox, { recursive: true, force: true });
  }
}

// =========================================================================
// PART B — integration: pipeline.js check rejects a mixed generation.
// =========================================================================
const workbook = process.env.JK_BMS_WORKBOOK_PATH;
if (!workbook || !fs.existsSync(workbook)) {
  console.log(`NOT_EXECUTED (Part B): JK_BMS_WORKBOOK_PATH ${workbook ? "does not exist" : "not set"} — Part B needs a real pipeline build/check cycle.`);
  console.log(`\n${checks} checks run, ${failures} failed. (Part B skipped, visibly, not counted as passed.)`);
  process.exit(failures ? 1 : 0);
}

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "jk-bms-mixed-generation-test-"));
function copyTree(relative) {
  fs.cpSync(path.join(SOURCE_ROOT, relative), path.join(sandbox, relative), { recursive: true });
}
function copyFile(relative) {
  const dst = path.join(sandbox, relative);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(SOURCE_ROOT, relative), dst);
}
function runPipeline(mode) {
  return spawnSync(process.execPath, [path.join(sandbox, "tools", "protocol", "pipeline.js"), mode, "--workbook", workbook], {
    cwd: sandbox, encoding: "utf8",
  });
}

try {
  for (const entry of fs.readdirSync(SOURCE_ROOT)) {
    if ([".git", "node_modules", ".esphome"].includes(entry)) continue;
    const full = path.join(SOURCE_ROOT, entry);
    if (fs.statSync(full).isDirectory()) copyTree(entry); else copyFile(entry);
  }

  let r = runPipeline("build");
  check("B1. sandbox baseline: pipeline build succeeds", r.status === 0, (r.stdout + r.stderr).trim().split("\n").slice(-3).join(" | "));
  r = runPipeline("check");
  check("B2. sandbox baseline: pipeline check passes on a freshly built, consistent generation", r.status === 0, (r.stdout + r.stderr).trim().split("\n").slice(-3).join(" | "));

  for (const [label, relPath] of [["claim_matrix.json", "protocol/generated/claim_matrix.json"], ["register_catalog.json", "register_catalog.json"]]) {
    const full = path.join(sandbox, relPath);
    const original = fs.readFileSync(full, "utf8");
    const doc = JSON.parse(original);
    check(`B3. fixture sanity (${label}): carries a real release_generation_id`, /^[0-9a-f]{16}$/.test(doc.release_generation_id), doc.release_generation_id);
    doc.release_generation_id = "deadbeefdeadbeef";
    fs.writeFileSync(full, `${JSON.stringify(doc, null, 2)}\n`);

    r = runPipeline("check");
    const output = `${r.stdout}${r.stderr}`;
    check(`B4. mixed generation (${label}): pipeline check exits non-zero`, r.status !== 0, `status=${r.status}`);
    check(`B5. mixed generation (${label}): rejected by a real, named mechanism (RELEASE_GENERATION_ID_MISMATCH, PIPELINE_DERIVED_ARTIFACT_STALE, or a generate.js DRIFT failure) mentioning the tampered file`,
      (output.includes("RELEASE_GENERATION_ID_MISMATCH") || output.includes("PIPELINE_DERIVED_ARTIFACT_STALE") || output.includes("DRIFT") || output.includes("PIPELINE_COMMAND_FAILED"))
        && output.includes(label),
      output.trim().split("\n").slice(-4).join(" | "));

    fs.writeFileSync(full, original);
    r = runPipeline("check");
    check(`B6. restored (${label}): pipeline check passes again`, r.status === 0, (r.stdout + r.stderr).trim().split("\n").slice(-3).join(" | "));
  }
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}

console.log(`\n${checks} checks run, ${failures} failed.`);
process.exit(failures ? 1 : 0);
