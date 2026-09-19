#!/usr/bin/env node
"use strict";

// Regression test for the build_stage3_status_map.js fail-open classifier
// fix (2026-09-19, user-directed). Root cause: classifyOne() previously
// checked implementation_status across EVERY canonical field sharing a
// manifest parameter's base_address, with no bit/byte-offset identity
// check at all -- so a manifest parameter whose OWN data is not modeled
// anywhere could still classify as implemented_read purely because some
// unrelated sibling field at the same address happened to be implemented.
// Two real, algorithmically-proven instances existed in the committed
// manifest: "Special Charger" (0x1114 bit5) borrowing the implemented
// status of its sibling ChargingFloatMode (0x1114 bit9), and AlarmBatUVP
// (0x12A0 bit12) borrowing the implemented status of the whole-register
// "Alarm Mask" entry at the same address. Both are fixed by requiring
// EXACT field identity (bit match for BIT fields, byte_offset+mask match
// for byte-half fields, full-width match for whole-register fields)
// before a canonical field's status may drive a manifest parameter's
// classification at all.
//
// This is a real regeneration test, not a reimplementation: it runs the
// actual generator against the actual committed source files and inspects
// the actual generated protocol/generated/stage3_status_map.json.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
function loadJson(p) { return JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8")); }

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

// Regenerate for real (not --check) so this test is self-contained even if
// run before anyone else has regenerated the committed artifact -- then
// restore the committed content afterward so this test has no side effect
// on the working tree beyond what a normal `git diff` would already show
// from the classifier fix itself.
const GEN_SCRIPT = path.join(ROOT, "tools", "protocol", "authoring", "build_stage3_status_map.js");
const OUT_PATH = path.join(ROOT, "protocol", "generated", "stage3_status_map.json");
const committedBefore = fs.readFileSync(OUT_PATH, "utf8");
execFileSync(process.execPath, [GEN_SCRIPT], { cwd: ROOT, stdio: "pipe" });
const statusMap = loadJson("protocol/generated/stage3_status_map.json");
// Determinism: regenerating twice in a row must be byte-identical.
const secondRun = fs.readFileSync(OUT_PATH, "utf8");
execFileSync(process.execPath, [GEN_SCRIPT], { cwd: ROOT, stdio: "pipe" });
const thirdRun = fs.readFileSync(OUT_PATH, "utf8");
check("regenerating twice in a row is byte-identical (deterministic)", secondRun === thirdRun);
// Restore whatever was committed so this test file has zero side effect
// when run standalone against an already-fixed tree.
fs.writeFileSync(OUT_PATH, committedBefore);

const byId = new Map(statusMap.parameters.map((p) => [p.id, p]));

// ===========================================================================
// 1. The two proven false positives: exact bit-identity now correctly
// fails for the un-modeled sibling bit, and does NOT silently promote it
// to "blocked" or "implemented_read" -- it must be the fail-closed
// "missing" state, since neither parameter is named in an open blocker.
// ===========================================================================
check("Special Charger (0x1114 bit5) is NOT implemented_read (was the confirmed false positive)",
  byId.get("Special Charger") && byId.get("Special Charger").status !== "implemented_read");
check("Special Charger (0x1114 bit5) classifies as missing (fail-closed: no exact-identity field, no open blocker names it)",
  byId.get("Special Charger") && byId.get("Special Charger").status === "missing");
check("AlarmBatUVP (0x12A0 bit12) is NOT implemented_read (was the confirmed false positive)",
  byId.get("AlarmBatUVP") && byId.get("AlarmBatUVP").status !== "implemented_read");
check("AlarmBatUVP (0x12A0 bit12) classifies as missing (fail-closed: no exact-identity field, no open blocker names it)",
  byId.get("AlarmBatUVP") && byId.get("AlarmBatUVP").status === "missing");

// ===========================================================================
// 2. 0x1114 bit9 (ChargingFloatMode) itself is the ONE genuinely
// canonical-implemented field at that address -- it must still resolve
// correctly. It is ALSO separately named in the open 0x1114 blocker
// (pre-existing, unrelated to this fix), so blocker precedence (checked
// before field-matching, per this generator's own stated priority order)
// correctly yields "blocked", not "implemented_read" -- this is the
// existing, unchanged precedence behavior, confirmed still intact.
// ===========================================================================
check("ChargingFloatMode (0x1114 bit9) resolves to blocked (blocker precedence over field-matching, pre-existing and unaffected by this fix)",
  byId.get("ChargingFloatMode") && byId.get("ChargingFloatMode").status === "blocked");

// ===========================================================================
// 3. An implemented sibling field does not "infect" other bits/bytes at
// the same address, generally -- not just for the two known false
// positives. For every canonical register with 2+ fields, every manifest
// parameter mapped to a NON-matching field at that address must not
// inherit "implemented_read"/"implemented_write_confirmed"/
// "implemented_other" purely from a sibling's status.
// ===========================================================================
const canonical = loadJson("protocol/registers.canonical.json");
const manifest = loadJson("protocol/generated/bms_v1_1_manifest.json");
const multiFieldAddrs = new Set(canonical.registers.filter((r) => r.fields.length > 1).map((r) => r.address));
check("registers.canonical.json has multi-field (packed) registers to test against", multiFieldAddrs.size > 0, `count=${multiFieldAddrs.size}`);

function fieldMatches(pAddr, field, registerWidthBits) {
  if (pAddr.bit_unspecified) return false;
  if (pAddr.bit !== null && pAddr.bit !== undefined) return field.wire_type === "BIT" && field.shift === pAddr.bit;
  if (pAddr.byte_half === "high") return field.field_width_bits === 8 && field.wire_type !== "BIT" && field.byte_offset === 0 && field.mask === "0xFF00";
  if (pAddr.byte_half === "low") return field.field_width_bits === 8 && field.wire_type !== "BIT" && field.byte_offset === 1 && field.mask === "0x00FF";
  return field.field_width_bits === registerWidthBits;
}

let infectionFound = [];
for (const p of manifest.parameters) {
  if (!multiFieldAddrs.has(p.address.base_address)) continue;
  const regs = canonical.registers.filter((r) => r.address === p.address.base_address);
  const hasExactMatch = regs.some((r) => r.fields.some((f) => fieldMatches(p.address, f, r.register_width_bits)));
  if (hasExactMatch) continue; // legitimate own-field match, not infection
  const mapped = byId.get(p.id);
  if (mapped && ["implemented_read", "implemented_write_confirmed", "implemented_other"].includes(mapped.status)) {
    infectionFound.push({ id: p.id, address: p.address.base_address, status: mapped.status });
  }
}
check("no manifest parameter without an exact-identity field match at a multi-field address is classified as any 'implemented_*' status (generic no-infection property, all multi-field addresses)",
  infectionFound.length === 0, JSON.stringify(infectionFound));

// ===========================================================================
// 4. Genuinely exact packed matches remain correctly implemented -- the
// fix must not regress previously-correct classifications. Covers several
// OTHER multi-field addresses beyond 0x1114/0x12A0.
// ===========================================================================
const exactMatchFixtures = [
  ["MaxVolCellNbr", "0x1248"],
  ["MinVolCellNbr", "0x1248"],
  ["SOCStateOfcharge", "0x12A6"],
  ["BalanSta", "0x12A6"],
  ["Precharge", "0x12B8"],
  ["SOCSOH", "0x12B8"],
  ["Charge", "0x12C0"],
  ["Discharge", "0x12C0"],
];
for (const [id, addr] of exactMatchFixtures) {
  const p = byId.get(id);
  check(`${id} (${addr}, exact packed-byte match) still classifies as implemented_read`,
    p && p.base_address === addr && p.status === "implemented_read");
}

// ===========================================================================
// 5. Blocker precedence: a parameter named in an open blocker classifies
// as "blocked" regardless of whether it also happens to have an
// exact-identity-matching implemented field (ChargingFloatMode, above, is
// exactly this scenario -- re-asserted here as its own named check since
// it is the one real fixture that exercises this precedence rule).
// ===========================================================================
check("blocker precedence is checked before field-matching (ChargingFloatMode fixture: exact-match implemented field + open blocker -> blocked, not implemented_read)",
  byId.get("ChargingFloatMode") && byId.get("ChargingFloatMode").status === "blocked");

// ===========================================================================
// 6. Absence of any canonical field for a manifest parameter can never
// yield implemented_read (sanity check on the pre-existing "missing"
// branch for addresses with zero canonical registers at all).
// ===========================================================================
const canonAddrs = new Set(canonical.registers.map((r) => r.address));
let noCanonicalButImplemented = [];
for (const p of manifest.parameters) {
  if (p.classification === "reserved" || p.classification === "derived") continue;
  if (canonAddrs.has(p.address.base_address)) continue;
  const mapped = byId.get(p.id);
  if (mapped && ["implemented_read", "implemented_write_confirmed", "implemented_other"].includes(mapped.status)) {
    noCanonicalButImplemented.push(p.id);
  }
}
check("no manifest parameter with zero canonical registers at its address is ever classified implemented_*",
  noCanonicalButImplemented.length === 0, JSON.stringify(noCanonicalButImplemented));

// ===========================================================================
// 7. Total always sums to 265 (the fix reshuffles counts, never drops or
// duplicates a parameter).
// ===========================================================================
check("parameter_count is 265", statusMap.parameter_count === 265, `actual=${statusMap.parameter_count}`);
const countSum = Object.values(statusMap.counts).reduce((a, b) => a + b, 0);
check("counts object sums to 265", countSum === 265, `actual=${countSum}`);
check("parameters array has exactly 265 entries", statusMap.parameters.length === 265, `actual=${statusMap.parameters.length}`);

// ===========================================================================
// 8. bit_unspecified parameters (TemperatureSensorAnomaly, PCLModuleAnomaly)
// must never match any canonical field via this identity logic -- they stay
// governed entirely by their own open blocker, never by field inspection.
// ===========================================================================
for (const id of ["TemperatureSensorAnomaly", "PCLModuleAnomaly"]) {
  const p = manifest.parameters.find((mp) => mp.id === id);
  check(`${id} has bit_unspecified=true in the manifest (precondition for this check)`,
    p && p.address.bit_unspecified === true);
  const mapped = byId.get(id);
  check(`${id} (bit_unspecified) classifies as blocked, never implemented_* via a guessed bit match`,
    mapped && mapped.status === "blocked");
}

console.log(`\n${checks} checks run, ${failures} failed.`);
process.exit(failures ? 1 : 0);
