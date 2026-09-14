"use strict";
/*
 * Single reusable implementation of the "project_implementation" evidence
 * fingerprint. Previously this hash was computed independently inline in
 * tools/protocol/pipeline.js AND re-derived by hand in a one-off script
 * during the Stage 1 corrective pass — two implementations of the same
 * hash is exactly how they drift apart. This module is now the only place
 * the algorithm is defined; pipeline.js and tools/protocol/fingerprint.js
 * both require() it.
 *
 * Reason codes returned by the functions here are stable strings, matched
 * by name in test/protocol_catalog/test_fingerprint_drift_regression.js —
 * treat them as a small public API, not free text.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const REASON = Object.freeze({
  SOURCE_FILE_MISSING: "SOURCE_FILE_MISSING",
  SOURCES_JSON_MISSING: "SOURCES_JSON_MISSING",
  SOURCES_JSON_MALFORMED: "SOURCES_JSON_MALFORMED",
  SOURCES_JSON_MISSING_IMPLEMENTATION_ENTRY: "SOURCES_JSON_MISSING_IMPLEMENTATION_ENTRY",
  JS_MARKERS_MISSING: "JS_MARKERS_MISSING",
  FINGERPRINT_MATCH: "FINGERPRINT_MATCH",
  FINGERPRINT_MISMATCH: "FINGERPRINT_MISMATCH",
});

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

const YAML_RELATIVE_PATH = "batterylifepo4.yaml";
const JS_RELATIVE_PATH = "jk_bms.js";
const SOURCES_JSON_RELATIVE_PATH = path.join("protocol", "evidence", "sources.json");
const IMPLEMENTATION_SOURCE_ID = "project_implementation";

/** Masks the generated-catalog block out of jk_bms.js's content, returning
 * the exact string normalizedImplementationFingerprint() hashes. Throws a
 * tagged error (never a raw ENOENT/marker-index crash) on malformed input. */
function maskGeneratedBlock(jsText) {
  const begin = jsText.indexOf("  // >>> BEGIN GENERATED PROTOCOL CATALOG");
  const endMarker = jsText.indexOf("  // <<< END GENERATED PROTOCOL CATALOG");
  if (begin < 0 || endMarker < 0) {
    const err = new Error(REASON.JS_MARKERS_MISSING);
    err.reasonCode = REASON.JS_MARKERS_MISSING;
    throw err;
  }
  const end = jsText.indexOf("\n", endMarker);
  return jsText.slice(0, begin) + "<GENERATED_PROTOCOL_CATALOG>\n" + jsText.slice(end + 1);
}

function readRequiredFile(root, relativePath) {
  const full = path.join(root, relativePath);
  if (!fs.existsSync(full)) {
    const err = new Error(`${REASON.SOURCE_FILE_MISSING}:${relativePath}`);
    err.reasonCode = REASON.SOURCE_FILE_MISSING;
    err.path = relativePath;
    throw err;
  }
  return fs.readFileSync(full);
}

/** Computes "sha256:<hex>" from the real batterylifepo4.yaml + jk_bms.js
 * (generated block masked) under `root`. Throws { reasonCode } on any
 * missing/malformed input — never a raw fs exception. */
function computeImplementationFingerprint(root) {
  const yamlBuf = readRequiredFile(root, YAML_RELATIVE_PATH);
  const jsBuf = readRequiredFile(root, JS_RELATIVE_PATH);
  const maskedJs = maskGeneratedBlock(jsBuf.toString("utf8"));
  const hash = crypto.createHash("sha256");
  hash.update(yamlBuf);
  hash.update(Buffer.from([0]));
  hash.update(maskedJs);
  return `sha256:${hash.digest("hex")}`;
}

/** Reads protocol/evidence/sources.json and returns
 * { doc, implementationSource, storedFingerprint }. Throws { reasonCode }
 * on a missing file, malformed JSON, or a missing project_implementation
 * entry — never a raw exception. */
function readStoredFingerprint(root) {
  const full = path.join(root, SOURCES_JSON_RELATIVE_PATH);
  if (!fs.existsSync(full)) {
    const err = new Error(REASON.SOURCES_JSON_MISSING);
    err.reasonCode = REASON.SOURCES_JSON_MISSING;
    throw err;
  }
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(full, "utf8"));
  } catch (parseErr) {
    const err = new Error(REASON.SOURCES_JSON_MALFORMED);
    err.reasonCode = REASON.SOURCES_JSON_MALFORMED;
    err.cause = parseErr;
    throw err;
  }
  const implementationSource = Array.isArray(doc.sources)
    ? doc.sources.find((s) => s.source_id === IMPLEMENTATION_SOURCE_ID)
    : null;
  if (!implementationSource || typeof implementationSource.fingerprint !== "string") {
    const err = new Error(REASON.SOURCES_JSON_MISSING_IMPLEMENTATION_ENTRY);
    err.reasonCode = REASON.SOURCES_JSON_MISSING_IMPLEMENTATION_ENTRY;
    throw err;
  }
  return { doc, implementationSource, storedFingerprint: implementationSource.fingerprint };
}

/** Full check: returns { ok, actual, stored, reasonCode } and never throws
 * for the expected failure classes (missing files, malformed JSON) — those
 * come back as ok:false with a reasonCode instead, so callers get a stable
 * machine-readable result rather than having to catch exceptions. */
function checkFingerprint(root) {
  let actual;
  try {
    actual = computeImplementationFingerprint(root);
  } catch (err) {
    return { ok: false, actual: null, stored: null, reasonCode: err.reasonCode || "UNKNOWN_ERROR", detail: err.message };
  }
  let stored;
  try {
    ({ storedFingerprint: stored } = readStoredFingerprint(root));
  } catch (err) {
    return { ok: false, actual, stored: null, reasonCode: err.reasonCode || "UNKNOWN_ERROR", detail: err.message };
  }
  if (actual !== stored) {
    return { ok: false, actual, stored, reasonCode: REASON.FINGERPRINT_MISMATCH };
  }
  return { ok: true, actual, stored, reasonCode: REASON.FINGERPRINT_MATCH };
}

module.exports = {
  REASON,
  YAML_RELATIVE_PATH,
  JS_RELATIVE_PATH,
  SOURCES_JSON_RELATIVE_PATH,
  IMPLEMENTATION_SOURCE_ID,
  sha256,
  maskGeneratedBlock,
  computeImplementationFingerprint,
  readStoredFingerprint,
  checkFingerprint,
};
