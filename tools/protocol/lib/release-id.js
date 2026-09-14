"use strict";
/*
 * Single reusable implementation of `release_generation_id` — a
 * deterministic id derived ONLY from immutable/hand-maintained source
 * inputs (never from any file this id is itself embedded in, so there is
 * no circular dependency):
 *   - workbook source identity (protocol/evidence/sources.json's
 *     workbook_lifepo4_bms_parameters_registers.fingerprint)
 *   - upstream evidence identity (...upstream_syssi_esphome_jk_bms.fingerprint)
 *   - the normalized implementation fingerprint (project_implementation.fingerprint —
 *     by the time this runs, tools/protocol/pipeline.js has already thrown
 *     IMPLEMENTATION_SOURCE_FINGERPRINT_MISMATCH if this doesn't match the
 *     real current jk_bms.js/batterylifepo4.yaml, so using the STORED value
 *     here is equivalent to the freshly-computed one)
 *   - protocol/registers.canonical.json's full content hash (this also
 *     covers its own catalog_version field)
 *   - protocol/non_register_entities.canonical.json's full content hash
 *   - the three protocol/schema/*.schema.json files' combined content hash
 *     (a schema change is an immutable-input change too)
 *   - PIPELINE_VERSION (kept in sync with pipeline.js's own
 *     fullManifest().pipeline_version)
 *
 * Embedded into: workbook_index.json, upstream_index.json,
 * implementation_index.json, claim_matrix.json (all four via
 * tools/protocol/pipeline.js, which post-processes the python/JS
 * generators' output before publishing/comparing), register_catalog.json,
 * coverage_report.md, .generation-manifest.json, and jk_bms.js's generated
 * PROTOCOL_CATALOG block (all four via tools/protocol/generate.js), plus
 * .pipeline-manifest.json itself. tools/protocol/pipeline.js's `check` mode
 * verifies all of these agree (RELEASE_GENERATION_ID_MISMATCH otherwise).
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { readStoredFingerprint, REASON: FINGERPRINT_REASON } = require("./fingerprint");

const PIPELINE_VERSION = 1; // must match pipeline.js's fullManifest().pipeline_version

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function sha256File(p) {
  return sha256(fs.readFileSync(p));
}

const REASON = Object.freeze({
  ...FINGERPRINT_REASON,
  RELEASE_ID_MISSING_SOURCE: "RELEASE_ID_MISSING_SOURCE",
});

const SCHEMA_FILES = ["register-source.schema.json", "non-register-source.schema.json", "evidence-sources.schema.json"];

/** Computes the 16-hex-char release_generation_id for the repo at `root`.
 * Throws { reasonCode } (never a raw exception) on missing/malformed
 * inputs, matching the fingerprint module's error convention. */
function computeReleaseGenerationId(root) {
  const { doc } = readStoredFingerprint(root); // throws SOURCES_JSON_* reasonCodes on its own
  const bySourceId = (id) => {
    const s = Array.isArray(doc.sources) ? doc.sources.find((x) => x.source_id === id) : null;
    if (!s || typeof s.fingerprint !== "string") {
      const err = new Error(`${REASON.RELEASE_ID_MISSING_SOURCE}:${id}`);
      err.reasonCode = REASON.RELEASE_ID_MISSING_SOURCE;
      err.sourceId = id;
      throw err;
    }
    return s.fingerprint;
  };

  const workbookFp = bySourceId("workbook_lifepo4_bms_parameters_registers");
  const upstreamFp = bySourceId("upstream_syssi_esphome_jk_bms");
  const implementationFp = bySourceId("project_implementation");

  const canonicalPath = path.join(root, "protocol", "registers.canonical.json");
  const nonRegisterPath = path.join(root, "protocol", "non_register_entities.canonical.json");
  for (const p of [canonicalPath, nonRegisterPath]) {
    if (!fs.existsSync(p)) {
      const err = new Error(`${FINGERPRINT_REASON.SOURCE_FILE_MISSING}:${path.relative(root, p)}`);
      err.reasonCode = FINGERPRINT_REASON.SOURCE_FILE_MISSING;
      throw err;
    }
  }
  const registersDigest = sha256File(canonicalPath);
  const nonRegisterDigest = sha256File(nonRegisterPath);

  const schemaDir = path.join(root, "protocol", "schema");
  const schemaBuffers = SCHEMA_FILES.map((f) => {
    const p = path.join(schemaDir, f);
    if (!fs.existsSync(p)) {
      const err = new Error(`${FINGERPRINT_REASON.SOURCE_FILE_MISSING}:${path.relative(root, p)}`);
      err.reasonCode = FINGERPRINT_REASON.SOURCE_FILE_MISSING;
      throw err;
    }
    return fs.readFileSync(p);
  });
  const schemaDigest = sha256(Buffer.concat(schemaBuffers));

  const material = JSON.stringify({
    workbookFp, upstreamFp, implementationFp, registersDigest, nonRegisterDigest, schemaDigest,
    pipelineVersion: PIPELINE_VERSION,
  });
  return sha256(Buffer.from(material)).slice(0, 16);
}

module.exports = { computeReleaseGenerationId, PIPELINE_VERSION, REASON };
