#!/usr/bin/env node
"use strict";

/*
 * Stage 3 (typed-petting-puzzle plan) preflight deliverable: an EXACT,
 * address-based mapping of every one of the 265 manifest parameters
 * (protocol/generated/bms_v1_1_manifest.json) against the CURRENT
 * registers.canonical.json and the CURRENT open-blocker register --
 * never a mechanical count comparison (packed fields, aliases, and
 * derived entities have a different structure between the manifest and
 * the canonical catalog; see registers.canonical.json's own field count
 * vs. the manifest's 265 rows -- they were never expected to match 1:1).
 *
 * Classification order (blocker status checked BEFORE canonical-address
 * presence -- a packed/bit-field parameter can share an address with an
 * ALREADY-implemented sibling, e.g. an individual 0x12A0 alarm bit next
 * to the already-modeled alarm register, while this parameter's own
 * specific semantic is still an open, named blocker; the register
 * existing does not make THIS parameter confirmed):
 *   1. manifest classification "reserved"  -> reserved
 *   2. manifest classification "derived"   -> derived_not_a_register
 *   3. parameter_id named in an open protocol_blockers.json entry -> blocked
 *   4. no canonical register at this address at all -> missing
 *   5. a canonical register exists; inspect its field(s):
 *        implemented + effective_access "rw" -> implemented_write_confirmed
 *        implemented + effective_access "r"  -> implemented_read
 *        implemented (other effective_access) -> implemented_other
 *        source_only_unimplemented / partially_implemented /
 *          implementation_only_unverified     -> catalog_only
 *        otherwise (e.g. only a reserved placeholder sibling, like the
 *          0x12EE half-register's OWN half not yet being this parameter's
 *          half) -> missing
 *
 * Run:
 *   node tools/protocol/authoring/build_stage3_status_map.js
 *   node tools/protocol/authoring/build_stage3_status_map.js --check
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const MANIFEST_PATH = path.join(ROOT, "protocol", "generated", "bms_v1_1_manifest.json");
const CANONICAL_PATH = path.join(ROOT, "protocol", "registers.canonical.json");
const LOCATORS_PATH = path.join(ROOT, "protocol", "generated", "pdf_locators.json");
const BLOCKERS_PATH = path.join(ROOT, "protocol", "evidence", "protocol_blockers.json");
const OUT_PATH = path.join(ROOT, "protocol", "generated", "stage3_status_map.json");
const CHECK = process.argv.includes("--check");

function loadJson(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
function sha256(p) { return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex"); }

function classifyOne(p, canonByAddr, blockedIds, locatorById) {
  const addr = p.address.base_address;

  if (p.classification === "reserved") return { status: "reserved", note: "manifest classification=reserved" };
  if (p.classification === "derived") return { status: "derived_not_a_register", note: "manifest classification=derived (not a hardware register)" };

  if (blockedIds.has(p.id)) {
    return { status: "blocked", note: "named in an open protocol_blockers.json entry" };
  }

  const canonRegs = canonByAddr.get(addr) || [];
  if (canonRegs.length === 0) {
    const loc = locatorById.get(p.id);
    const hasResolvedPdf = Boolean(loc && loc.pdf_locator);
    return { status: "missing", note: hasResolvedPdf ? "no canonical register at this address; PDF locator resolved" : "no canonical register at this address; PDF locator unresolved (unexpected -- should have an open blocker)" };
  }

  const fieldStatuses = [];
  for (const reg of canonRegs) {
    for (const f of reg.fields) {
      fieldStatuses.push({ key: f.key, implementation_status: f.implementation_status, effective_access: f.effective_access });
    }
  }

  if (fieldStatuses.some((s) => s.implementation_status === "implemented" && s.effective_access === "rw")) {
    return { status: "implemented_write_confirmed", note: "canonical field implemented, effective_access=rw" };
  }
  if (fieldStatuses.some((s) => s.implementation_status === "implemented" && s.effective_access === "r")) {
    return { status: "implemented_read", note: "canonical field implemented, effective_access=r" };
  }
  if (fieldStatuses.some((s) => s.implementation_status === "implemented")) {
    return { status: "implemented_other", note: "canonical field implemented, effective_access neither r nor rw" };
  }
  if (fieldStatuses.some((s) => ["source_only_unimplemented", "partially_implemented", "implementation_only_unverified"].includes(s.implementation_status))) {
    return { status: "catalog_only", note: "canonical field exists but not implementation_status=implemented" };
  }
  // Every field at this address is something else (typically a Stage 2
  // reserved placeholder occupying the other half of a packed register)
  // and none of them is THIS parameter's own half -- this parameter's
  // own data is not yet captured by anything at this address.
  return { status: "missing", note: "canonical register exists at this address, but only for an unrelated/reserved sibling field -- this parameter's own data is not yet modeled" };
}

function build() {
  const manifest = loadJson(MANIFEST_PATH);
  const canonical = loadJson(CANONICAL_PATH);
  const locators = loadJson(LOCATORS_PATH);
  const blockers = loadJson(BLOCKERS_PATH);

  const locatorById = new Map(locators.locators.map((l) => [l.id, l]));
  const blockedIds = new Set();
  for (const b of blockers.blockers) {
    if (b.status !== "open") continue;
    for (const id of b.parameter_id.split(",")) blockedIds.add(id.trim());
  }
  const canonByAddr = new Map();
  for (const r of canonical.registers) {
    if (!canonByAddr.has(r.address)) canonByAddr.set(r.address, []);
    canonByAddr.get(r.address).push(r);
  }

  const parameters = manifest.parameters.map((p) => {
    const { status, note } = classifyOne(p, canonByAddr, blockedIds, locatorById);
    return {
      id: p.id,
      base_address: p.address.base_address,
      access: p.access,
      classification: p.classification,
      status,
      note,
    };
  });

  const counts = {};
  for (const p of parameters) counts[p.status] = (counts[p.status] || 0) + 1;

  return {
    $comment: "GENERATED -- Stage 3 (typed-petting-puzzle plan) preflight deliverable: exact address-based status of every one of the 265 manifest parameters against the CURRENT registers.canonical.json and CURRENT open protocol_blockers.json entries. NOT a mechanical manifest-count-vs-canonical-count comparison -- packed fields, aliases, and derived entities have a different structure between the two catalogs. DO NOT EDIT BY HAND. Regenerate with tools/protocol/authoring/build_stage3_status_map.js. Because this reads the CURRENT canonical/blocker state (which Stage 3 itself will change), this file's own committed content reflects one snapshot in the stage's history -- re-run this generator (and its own --check) after each canonical/blocker change within Stage 3, exactly like every other generator in this pipeline.",
    manifest_source_sha256: sha256(MANIFEST_PATH),
    canonical_source_sha256: sha256(CANONICAL_PATH),
    blockers_source_sha256: sha256(BLOCKERS_PATH),
    parameter_count: parameters.length,
    counts,
    parameters,
  };
}

function main() {
  const output = build();
  const serialized = JSON.stringify(output, null, 2) + "\n";
  if (CHECK) {
    if (!fs.existsSync(OUT_PATH)) {
      console.error("build_stage3_status_map.js --check: DRIFT -- protocol/generated/stage3_status_map.json does not exist.");
      process.exit(1);
    }
    if (fs.readFileSync(OUT_PATH, "utf8") !== serialized) {
      console.error("build_stage3_status_map.js --check: DRIFT -- protocol/generated/stage3_status_map.json does not match a fresh regeneration.");
      process.exit(1);
    }
    console.log("build_stage3_status_map.js --check: no drift.");
    return;
  }
  fs.writeFileSync(OUT_PATH, serialized);
  console.log(`wrote ${path.relative(ROOT, OUT_PATH)}`);
  console.log(`${output.parameter_count} parameters:`);
  for (const [status, n] of Object.entries(output.counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${status}`);
  }
}

main();
