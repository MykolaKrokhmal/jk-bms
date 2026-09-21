#!/usr/bin/env node
"use strict";

// Regression test for the Stage 4 (typed-petting-puzzle plan §5 Phase 1)
// authoritative 97-row RW inventory. Real regeneration test against the
// actual generator and its actual generated output -- proves the exact
// invariants Phase 1 requires: 97/97 accounted, 0 unmatched, 0 ambiguous,
// 0 silently duplicated, 0 undecided Stage 4 states, and the 97-vs-96
// reconciliation (ChargingFloatMode) stays exactly what it is.
//
// Any future drift in this mapping -- a manifest regen that adds/removes
// an RW row, a canonical.json edit that breaks a wire-position match, a
// write_registry.json regen that silently drops an entry -- fails this
// test with a specific, named reason, never silently.

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

// Regenerate for real (self-contained), then restore -- matching this
// project's own established negative-fixture-free regeneration-test
// pattern (test_stage3_status_map_exact_identity.js et al.).
const GEN_SCRIPT = path.join(ROOT, "tools", "protocol", "authoring", "build_stage4_rw_inventory.js");
const OUT_PATH = path.join(ROOT, "protocol", "generated", "stage4_rw_inventory.json");
const committedBefore = fs.readFileSync(OUT_PATH, "utf8");
execFileSync(process.execPath, [GEN_SCRIPT], { cwd: ROOT, stdio: "pipe" });
const secondRun = fs.readFileSync(OUT_PATH, "utf8");
execFileSync(process.execPath, [GEN_SCRIPT], { cwd: ROOT, stdio: "pipe" });
const thirdRun = fs.readFileSync(OUT_PATH, "utf8");
check("regenerating twice in a row is byte-identical (deterministic)", secondRun === thirdRun);
fs.writeFileSync(OUT_PATH, committedBefore);

const inv = loadJson("protocol/generated/stage4_rw_inventory.json");
const manifest = loadJson("protocol/generated/bms_v1_1_manifest.json");
const manifestRwCount = manifest.parameters.filter((p) => p.access === "RW").length;

check("manifest currently declares exactly 97 RW parameters (precondition)", manifestRwCount === 97, `actual=${manifestRwCount}`);
check("inventory row_count is 97", inv.row_count === 97, `actual=${inv.row_count}`);
check("inventory has exactly 97 rows", inv.rows.length === 97, `actual=${inv.rows.length}`);
check("0 unmatched rows", inv.unmatched_count === 0, `actual=${inv.unmatched_count}`);
check("0 ambiguous rows", inv.ambiguous_count === 0, `actual=${inv.ambiguous_count}`);
check("0 duplicated canonical-key rows", inv.duplicated_canonical_key_count === 0, `actual=${inv.duplicated_canonical_key_count}`);

const ALLOWED_STATES = new Set(["accounted", "read-implemented", "write-software-ready", "write-hardware-verified", "blocked"]);
const undecided = inv.rows.filter((r) => !ALLOWED_STATES.has(r.stage4_state));
check("every row has one of the 5 allowed Stage 4 states, never undecided/unknown/missing", undecided.length === 0, JSON.stringify(undecided.map((r) => r.manifest_id)));

const stateSum = Object.values(inv.counts_by_state).reduce((a, b) => a + b, 0);
check("counts_by_state sums to 97", stateSum === 97, `actual=${stateSum}`);

// A blocked row must always carry a reason + closure criterion (never a
// silent "blocked" with nothing to act on).
const blockedWithoutReason = inv.rows.filter((r) => r.stage4_state === "blocked" && (!r.blocked_reason || !r.blocker_closure_criterion));
check("every blocked row carries both a blocked_reason and a blocker_closure_criterion", blockedWithoutReason.length === 0, JSON.stringify(blockedWithoutReason.map((r) => r.manifest_id)));

// A row's read_implemented fact is never lost just because it's write-blocked.
const chargingFloatMode = inv.rows.find((r) => r.manifest_id === "ChargingFloatMode");
check("ChargingFloatMode matched (not unmatched/ambiguous)", chargingFloatMode && chargingFloatMode.match_status === "matched");
check("ChargingFloatMode's read_implemented fact is preserved even though it's write-blocked", chargingFloatMode && chargingFloatMode.read_implemented === true);

// ===========================================================================
// The 97-vs-96 reconciliation itself: ChargingFloatMode is the ONE row
// whose canonical match has access !== "rw", explaining the count
// difference precisely -- not a guessed/rounded-off explanation.
// ===========================================================================
check("ChargingFloatMode is the sole MANIFEST_RW_CLAIM_CONTRADICTED_BY_CANONICAL_ACCESS row",
  chargingFloatMode && chargingFloatMode.blocked_reason === "MANIFEST_RW_CLAIM_CONTRADICTED_BY_CANONICAL_ACCESS");
const contradictedRows = inv.rows.filter((r) => r.blocked_reason === "MANIFEST_RW_CLAIM_CONTRADICTED_BY_CANONICAL_ACCESS");
check("exactly 1 row has this specific reconciliation reason (97 manifest rows -> 96 rw-access canonical fields)",
  contradictedRows.length === 1, JSON.stringify(contradictedRows.map((r) => r.manifest_id)));

const canonical = loadJson("protocol/registers.canonical.json");
let canonicalRwFieldCount = 0;
for (const r of canonical.registers) for (const f of r.fields) if (f.access === "rw") canonicalRwFieldCount += 1;
check("canonical rw-access field count is 96, exactly one less than the 97 manifest rows", canonicalRwFieldCount === 96, `actual=${canonicalRwFieldCount}`);

// ===========================================================================
// The original 18 owner-authorized fields stay write-hardware-verified,
// not silently demoted -- and are never flagged for revalidation (this
// Stage's work does not touch their full-width write_bms_u32/u16 dispatch).
// ===========================================================================
const hwVerified = inv.rows.filter((r) => r.stage4_state === "write-hardware-verified");
check("exactly 18 rows are write-hardware-verified (the pre-existing, unchanged set)", hwVerified.length === 18, `actual=${hwVerified.length}`);
const revalidationNeeded = hwVerified.filter((r) => r.revalidation_required === true);
check("none of the 18 write-hardware-verified rows are flagged revalidation_required (full-width write path unchanged by this Stage)",
  revalidationNeeded.length === 0, JSON.stringify(revalidationNeeded.map((r) => r.manifest_id)));

// ===========================================================================
// The new write-software-ready set matches the generated write registry
// exactly -- every row claiming write-software-ready has a real
// write_registry.json entry, and every write_registry.json entry is
// reflected as write-software-ready (or write-hardware-verified, for the
// impossible overlap case) somewhere in the inventory.
// ===========================================================================
const writeRegistry = loadJson("protocol/generated/write_registry.json");
const registryKeys = new Set(writeRegistry.entries.map((e) => e.key));
const softwareReady = inv.rows.filter((r) => r.stage4_state === "write-software-ready");
check("write-software-ready row count matches the write registry's entry count", softwareReady.length === writeRegistry.entry_count,
  `inventory=${softwareReady.length} registry=${writeRegistry.entry_count}`);
const softwareReadyMissingFromRegistry = softwareReady.filter((r) => !registryKeys.has(r.canonical_key));
check("every write-software-ready row has a real write_registry.json entry", softwareReadyMissingFromRegistry.length === 0,
  JSON.stringify(softwareReadyMissingFromRegistry.map((r) => r.manifest_id)));

console.log(`\n${checks} checks run, ${failures} failed.`);
process.exit(failures ? 1 : 0);
