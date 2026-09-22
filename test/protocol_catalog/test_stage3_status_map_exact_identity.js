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
// 1. The two originally-proven false positives have BOTH now graduated to
// genuinely implemented -- not a regression of the classifier fix, but
// the classifier working correctly against later, deliberate catalog
// changes. Special Charger (0x1114 bit5): the Stage 3 completion pass
// (2026-09-20) authored a real, evidenced canonical field for it and
// closed the stale 0x1114 blocker that used to force it to "blocked"
// regardless of field-matching (see test_0x1114_bit_cluster.js).
// AlarmBatUVP (0x12A0 bit12): the Stage 3 continuation pass (same day)
// authored the generalized projection architecture, giving it (and its
// 21 siblings) a real projection field, and closed the 0x12A0 blocker
// that used to cover it (see test_overlapping_masks_architectural_
// blocker.js and test_projection_decoder.js for that batch's own
// coverage). Both now resolve implemented_read via the exact same
// exact-identity mechanism this file's own classifier fix established.
// ===========================================================================
// CORRECTED (Stage 4, typed-petting-puzzle plan §5, 2026-09-20): Special
// Charger (canonical key special_charger) was promoted from effective_
// access "r" to "rw" this round (verification_status="confirmed" +
// write_safety_class="disruptive" triage + a real generated write path) --
// the classifier now correctly reports "implemented_write_confirmed", not
// "implemented_read". This is the SAME exact-identity classifier behaving
// correctly against updated input data, not a regression.
check("Special Charger (0x1114 bit5) is implemented_write_confirmed (now has its own real, evidenced canonical field AND a real Stage 4 write path -- the 0x1114 blocker that used to force it to 'blocked' is closed)",
  byId.get("Special Charger") && byId.get("Special Charger").status === "implemented_write_confirmed");
check("AlarmBatUVP (0x12A0 bit12) is implemented_read (now has its own real, evidenced projection field -- Stage 3 continuation pass, 2026-09-20; the 0x12A0 blocker that used to force it to 'blocked' is closed)",
  byId.get("AlarmBatUVP") && byId.get("AlarmBatUVP").status === "implemented_read");

// ===========================================================================
// 2. 0x1114 bit9 (ChargingFloatMode) itself is the ONE canonical-
// implemented field at that address this file originally exercised for
// blocker precedence. As of the Stage 3 completion pass (2026-09-20),
// the 0x1114 blocker that used to name it is closed (it was a stale,
// overbroad blocker -- ChargingFloatMode always had its own exact,
// implemented field; the blocker's real, unresolved concern was the
// OTHER 8 sibling bits, now themselves implemented too). It therefore
// now correctly resolves implemented_read, not blocked -- this is the
// SAME exact-identity classifier behaving correctly against updated
// input data, not a regression in the classifier itself.
// ===========================================================================
check("ChargingFloatMode (0x1114 bit9) resolves to implemented_read (the stale 0x1114 blocker that used to force it to 'blocked' is closed, Stage 3 completion pass 2026-09-20)",
  byId.get("ChargingFloatMode") && byId.get("ChargingFloatMode").status === "implemented_read");

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

// Delegates to the REAL production classifier function (not a
// reimplementation) -- a local reimplementation here previously drifted
// out of sync with the real matcher's compound byte_half+bit address
// handling (added 2026-09-20 for the 0x12D0 cluster), causing false
// "infection" reports for legitimate, correctly-matching projection
// fields. Requiring the real function guarantees this check can never
// silently diverge from the actual classifier's own behavior again.
const { fieldOccupiesManifestParamWirePosition } = require("../../tools/protocol/authoring/build_stage3_status_map.js");

let infectionFound = [];
for (const p of manifest.parameters) {
  if (!multiFieldAddrs.has(p.address.base_address)) continue;
  const regs = canonical.registers.filter((r) => r.address === p.address.base_address);
  const hasExactMatch = regs.some((r) => r.fields.some((f) => fieldOccupiesManifestParamWirePosition(p.address, f, r.register_width_bits)));
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
// exact-identity-matching implemented field. ChargingFloatMode, then
// "Alarm Mask", both used to be this file's real-data fixture for this
// property in turn, but each one's own blocker has since closed (Stage 3
// completion/continuation passes, 2026-09-20) -- HeatStartTemp (0x111C,
// still a genuinely open, single-source-evidence blocker, with its own
// unique implemented field heating_activation_temperature) replaces them
// as the current real fixture. See test_stage3_status_map_collision_
// hardening.js's synthetic fixtures for a version of this property that
// never depends on which real parameter happens to still be blocked.
// ===========================================================================
check("blocker precedence is checked before field-matching (HeatStartTemp fixture: exact-match implemented field + open blocker -> blocked, not implemented_read)",
  byId.get("HeatStartTemp") && byId.get("HeatStartTemp").status === "blocked");

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
  // 2026-09-22 (unmapped-rows cleanup): permanently classified
  // unsupported_bit_position_undocumented, never implemented_* via a
  // guessed bit match, and never a generic "blocked"/"missing" either --
  // this classification is deterministic and does not depend on this
  // parameter's own protocol_blockers.json entry staying open (it is now
  // closed, with a permanent-unsupported resolution recorded).
  check(`${id} (bit_unspecified) classifies as unsupported_bit_position_undocumented, never implemented_* via a guessed bit match`,
    mapped && mapped.status === "unsupported_bit_position_undocumented");
}

console.log(`\n${checks} checks run, ${failures} failed.`);
process.exit(failures ? 1 : 0);
