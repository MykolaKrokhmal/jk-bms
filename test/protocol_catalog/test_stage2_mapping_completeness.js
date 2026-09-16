#!/usr/bin/env node
"use strict";

// Stage 2 (typed-petting-puzzle plan) exit-criterion test: "mapping
// completeness (265/265, unique+sparse ui_order)". Reads the REAL
// generated artifacts -- protocol/settings_ui.mapping.json and
// protocol/generated/bms_v1_1_manifest.json -- not a reimplementation
// of the mapping logic itself.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const mapping = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "settings_ui.mapping.json"), "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "generated", "bms_v1_1_manifest.json"), "utf8"));

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

check("mapping.json covers all 265 manifest parameters, none missing",
  mapping.parameters.length === 265 && manifest.parameters.length === 265,
  `mapping=${mapping.parameters.length} manifest=${manifest.parameters.length}`);

const manifestIds = new Set(manifest.parameters.map((p) => p.id));
const mappingIds = new Set(mapping.parameters.map((p) => p.id));
const missingFromMapping = [...manifestIds].filter((id) => !mappingIds.has(id));
const extraInMapping = [...mappingIds].filter((id) => !manifestIds.has(id));
check("every manifest parameter id has exactly one mapping.json entry, no extras",
  missingFromMapping.length === 0 && extraInMapping.length === 0,
  `missing=${missingFromMapping.join(",")} extra=${extraInMapping.join(",")}`);

const dupIds = mapping.parameters.map((p) => p.id).filter((id, i, arr) => arr.indexOf(id) !== i);
check("no duplicate parameter ids in mapping.json", dupIds.length === 0, dupIds.join(","));

// Every one of the 12 curated groups exists (sourced from the manifest's
// own "Групи UI" sheet, not invented) and every grouped parameter's
// ui_group is one of those 12 real numbers.
const validGroupNumbers = new Set(manifest.ui_groups.map((g) => g.order));
check("manifest defines exactly 12 UI groups", validGroupNumbers.size === 12, [...validGroupNumbers].sort((a, b) => a - b).join(","));
const badGroupRefs = mapping.parameters.filter((p) => p.ui_group !== null && !validGroupNumbers.has(p.ui_group));
check("every non-null ui_group references one of the 12 real defined groups", badGroupRefs.length === 0,
  badGroupRefs.map((p) => `${p.id}:${p.ui_group}`).join(","));

// ui_order: unique within each group (sparse gaps are fine -- the
// project's own established policy, see CLAUDE.md's
// ui_order_gap_policy: "sparse_allowed_stable_manual_slots" -- but two
// parameters in the SAME group must never collide on the same slot).
const byGroup = new Map();
for (const p of mapping.parameters) {
  if (p.ui_group === null) continue;
  if (!byGroup.has(p.ui_group)) byGroup.set(p.ui_group, []);
  byGroup.get(p.ui_group).push(p.ui_order);
}
let orderCollisions = 0;
const collisionDetail = [];
for (const [group, orders] of byGroup) {
  const dupes = orders.filter((o, i, arr) => arr.indexOf(o) !== i);
  if (dupes.length) { orderCollisions += dupes.length; collisionDetail.push(`group ${group}: ${dupes.join(",")}`); }
}
check("ui_order has no duplicate within any single group", orderCollisions === 0, collisionDetail.join(" | "));

// Every grouped parameter has a positive, defined ui_order (no null
// slipping through for something that WAS assigned a group).
const groupedWithoutOrder = mapping.parameters.filter((p) => p.ui_group !== null && (!Number.isInteger(p.ui_order) || p.ui_order < 1));
check("every grouped parameter has a valid positive ui_order", groupedWithoutOrder.length === 0,
  groupedWithoutOrder.map((p) => p.id).join(","));

// Every ungrouped (ui_group: null) parameter has an honest, specific
// reason recorded via mapping_rule / evidence_status -- never a silent
// null with no explanation (matches CLAUDE.md's "never fabricate a
// derivation... record as null with an explanatory note" precedent).
const ungrouped = mapping.parameters.filter((p) => p.ui_group === null);
const ungroupedWithoutReason = ungrouped.filter((p) => !p.mapping_rule || !p.evidence_status);
check("every ungrouped parameter carries an explicit reason (mapping_rule + evidence_status), never a bare null",
  ungroupedWithoutReason.length === 0, ungroupedWithoutReason.map((p) => p.id).join(","));

// mapping_confidence must be "low" only when the parameter fell through
// to the unclassified-fallback rule -- proves the classification wasn't
// silently downgraded/upgraded inconsistently with its own rule.
const inconsistentConfidence = mapping.parameters.filter((p) =>
  (p.mapping_confidence === "low") !== (p.mapping_rule === "unclassified_new_parameter_needs_manual_review"));
check("mapping_confidence:'low' occurs exactly when (and only when) the unclassified fallback rule fired",
  inconsistentConfidence.length === 0, inconsistentConfidence.map((p) => p.id).join(","));

console.log(`\n${checks} checks run, ${failures} failed.`);
process.exit(failures ? 1 : 0);
