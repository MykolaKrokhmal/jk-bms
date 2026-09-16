#!/usr/bin/env node
"use strict";

// Stage 2 (typed-petting-puzzle plan) exit-criterion test: "evidence-pair
// completeness (workbook+PDF evidence or an explicit blocker -- never a
// silent third option)". Reads the REAL generated artifacts --
// protocol/generated/bms_v1_1_manifest.json, protocol/generated/
// pdf_locators.json, protocol/settings_ui.mapping.json, and
// protocol/evidence/protocol_blockers.json -- not a reimplementation.
//
// Every one of the 265 manifest parameters must land in EXACTLY one of
// three honest buckets, with nothing falling through the cracks:
//   1. reserved_authored_in_canonical  -- the 4 reserved rows (3 newly
//      authored this stage + the pre-existing Reserved_12D2), each with
//      a real canonical.json entry citing both workbook and PDF evidence.
//   2. not_applicable_calculated_field -- the 1 "derived" parameter
//      (ESPHome_Power), which is not a hardware register at all (its
//      own manifest audit_note says so) and so has no register-address
//      evidence to gather.
//   3. everything else (260 parameters): workbook evidence always
//      exists (they're IN the workbook-derived manifest by definition);
//      PDF evidence is either (a) resolved -- pdf_locators.json found an
//      unambiguous match -- or (b) an open protocol_blockers.json entry
//      names that exact parameter_id, explaining why not, per the plan's
//      explicit "no guessing, ever" policy for PDF evidence.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
function loadJson(p) { return JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8")); }

const manifest = loadJson("protocol/generated/bms_v1_1_manifest.json");
const locators = loadJson("protocol/generated/pdf_locators.json");
const mapping = loadJson("protocol/settings_ui.mapping.json");
const blockers = loadJson("protocol/evidence/protocol_blockers.json");

let checks = 0;
let failures = 0;
function check(name, condition, detail = "") {
  checks += 1;
  if (condition) console.log(`PASS  ${name}${detail ? ` -- ${detail}` : ""}`);
  else {
    failures += 1;
    console.log(`FAIL  ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

const locatorById = new Map(locators.locators.map((l) => [l.id, l]));
// A parameter is covered by an open blocker if its id appears in that
// blocker's comma-separated parameter_id list (the same convention the
// pre-existing rcv_time,rfv_time blocker already established).
const blockedIds = new Set();
for (const b of blockers.blockers) {
  if (b.status !== "open") continue;
  for (const id of b.parameter_id.split(",")) blockedIds.add(id.trim());
}

const reservedIds = new Set(manifest.parameters.filter((p) => p.classification === "reserved").map((p) => p.id));
const calculatedIds = new Set(manifest.parameters.filter((p) => p.classification === "derived").map((p) => p.id));

check("exactly 4 parameters are classified reserved (3 newly authored + Reserved_12D2 pre-existing)",
  reservedIds.size === 4, [...reservedIds].join(","));
check("exactly 1 parameter is classified derived/calculated (not a hardware register)",
  calculatedIds.size === 1, [...calculatedIds].join(","));

const uncategorized = [];
let resolvedCount = 0;
let blockedCount = 0;
for (const p of manifest.parameters) {
  if (reservedIds.has(p.id) || calculatedIds.has(p.id)) continue; // handled by their own dedicated checks above
  const loc = locatorById.get(p.id);
  const hasResolvedPdf = Boolean(loc && loc.pdf_locator);
  const hasBlocker = blockedIds.has(p.id);
  if (hasResolvedPdf) resolvedCount += 1;
  else if (hasBlocker) blockedCount += 1;
  else uncategorized.push(p.id);
}
check("every non-reserved, non-calculated parameter (260 of 265) is either PDF-resolved or covered by an open blocker -- never silently uncovered",
  uncategorized.length === 0, `uncategorized=${uncategorized.length}: ${uncategorized.slice(0, 10).join(",")}${uncategorized.length > 10 ? "..." : ""}`);
check("resolved + blocked accounts for all 260 non-reserved/non-calculated parameters",
  resolvedCount + blockedCount === 260, `resolved=${resolvedCount} blocked=${blockedCount} total=${resolvedCount + blockedCount}`);

// The 3 newly-authored reserved rows must each have a REAL canonical.json
// entry (not just a manifest classification) -- cross-checked against the
// actual tracked catalog, not just this test's own bookkeeping.
const canonical = loadJson("protocol/registers.canonical.json");
const canonicalKeys = new Set(canonical.registers.flatMap((r) => r.fields).map((f) => f.key));
for (const key of ["rvd_12ee_h", "rvd_130c_l", "rvd_1506_l"]) {
  check(`newly-authored reserved field "${key}" exists in registers.canonical.json`, canonicalKeys.has(key));
}
check("registers.canonical.json is at exactly 122 registers / 130 fields (Stage 2 exit criterion)",
  canonical.registers.length === 122 && canonical.registers.flatMap((r) => r.fields).length === 130,
  `registers=${canonical.registers.length} fields=${canonical.registers.flatMap((r) => r.fields).length}`);

// mapping.json's own evidence_status field must agree with this test's
// independently-computed classification -- proves the mapping generator
// isn't silently drifting from the real locator/blocker data.
let mappingMismatches = 0;
const mappingById = new Map(mapping.parameters.map((p) => [p.id, p]));
for (const p of manifest.parameters) {
  const mapEntry = mappingById.get(p.id);
  if (!mapEntry) continue;
  let expected;
  if (reservedIds.has(p.id)) expected = "reserved_authored_in_canonical";
  else if (calculatedIds.has(p.id)) expected = "not_applicable_calculated_field";
  else {
    const loc = locatorById.get(p.id);
    expected = (loc && loc.pdf_locator) ? "resolved" : "blocked";
  }
  if (mapEntry.evidence_status !== expected) mappingMismatches += 1;
}
check("settings_ui.mapping.json's evidence_status field matches this test's independent computation for every parameter",
  mappingMismatches === 0, `mismatches=${mappingMismatches}`);

// The 4 already-known manifest ambiguities (2 bit_number_missing @
// 0x12A0, 2 type_length_mismatch @ 0x1600/0x1606) must each have their
// own open blocker -- proves they weren't silently dropped when the
// broader PDF-locator blockers were seeded.
for (const id of ["TemperatureSensorAnomaly", "PCLModuleAnomaly", "VoltageCalibration", "CurrentCalibration"]) {
  check(`known manifest ambiguity "${id}" has its own open blocker entry`, blockedIds.has(id));
}

console.log(`\n${checks} checks run, ${failures} failed.`);
process.exit(failures ? 1 : 0);
