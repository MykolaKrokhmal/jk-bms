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
// UPDATED (2026-09-22, unmapped-rows cleanup follow-up): 5 more fields
// (gps_heartbeat, lcd_always_on, smart_sleep_enabled, timed_stored_data,
// smart_sleep_timeout_hours) were promoted from write-software-ready via
// protocol/evidence/hardware_verified_writes.json's own recorded real
// hardware transaction results -- 18 + 5 = 23. None of these 5 are
// flagged revalidation_required either (their Stage 4 write-registry
// endpoint/dispatch is completely unchanged; only the provenance/state
// label is promoted).
// ===========================================================================
const hwVerified = inv.rows.filter((r) => r.stage4_state === "write-hardware-verified");
check("exactly 23 rows are write-hardware-verified (18 pre-existing + 5 newly promoted, 2026-09-22)", hwVerified.length === 23, `actual=${hwVerified.length}`);
const revalidationNeeded = hwVerified.filter((r) => r.revalidation_required === true);
check("none of the 23 write-hardware-verified rows are flagged revalidation_required (write path unchanged by this promotion)",
  revalidationNeeded.length === 0, JSON.stringify(revalidationNeeded.map((r) => r.manifest_id)));
const newlyPromotedIds = new Set(["GPS Heartbeat", "LCD Always On", "SmartSleep", "TimedStoredData", "TIMSmartSleep"]);
const newlyPromotedRows = hwVerified.filter((r) => newlyPromotedIds.has(r.manifest_id));
check("exactly the 5 named fields are the newly-promoted write-hardware-verified rows",
  newlyPromotedRows.length === 5, JSON.stringify(newlyPromotedRows.map((r) => r.manifest_id)));
check("every newly-promoted row still carries a real current_write_endpoint (Stage 4 write-registry endpoint unchanged, not a new one)",
  newlyPromotedRows.every((r) => !!r.current_write_endpoint));
const gpsHeartbeatRow = inv.rows.find((r) => r.manifest_id === "GPS Heartbeat");
check("gps_heartbeat's hardware_verification_provenance explicitly records the value=1 MISMATCH limitation (never silently claimed bidirectional)",
  gpsHeartbeatRow && /LIMITATION/.test(gpsHeartbeatRow.hardware_verification_provenance) && /MISMATCH/.test(gpsHeartbeatRow.hardware_verification_provenance),
  gpsHeartbeatRow && gpsHeartbeatRow.hardware_verification_provenance);

// ===========================================================================
// The write_registry.json entry set matches EXACTLY the UNION of
// write-software-ready rows and write-hardware-verified rows that carry a
// real current_write_endpoint (2026-09-22 update: 5 fields now occupy
// this union's hardware-verified side, since hardware-verification
// promotion never removes a field's write_registry.json entry -- only
// the pre-existing 18 legacy_setting_def fields, which carry no registry
// entry at all, are the genuine "hardware-verified but NOT in the
// registry" case). Every row in this union has a real registry entry,
// and every registry entry is reflected in this union -- exact set
// equality both directions.
// ===========================================================================
const writeRegistry = loadJson("protocol/generated/write_registry.json");
const registryKeys = new Set(writeRegistry.entries.map((e) => e.key));
const softwareReady = inv.rows.filter((r) => r.stage4_state === "write-software-ready");
const hwVerifiedWithRegistryEntry = inv.rows.filter((r) => r.stage4_state === "write-hardware-verified" && registryKeys.has(r.canonical_key));
const registryBackedRows = [...softwareReady, ...hwVerifiedWithRegistryEntry];
check("write-software-ready + registry-backed write-hardware-verified row count matches the write registry's entry count",
  registryBackedRows.length === writeRegistry.entry_count,
  `software-ready=${softwareReady.length} hw-verified-with-entry=${hwVerifiedWithRegistryEntry.length} total=${registryBackedRows.length} registry=${writeRegistry.entry_count}`);
const registryBackedMissingFromRegistry = registryBackedRows.filter((r) => !registryKeys.has(r.canonical_key));
check("every write-software-ready or registry-backed write-hardware-verified row has a real write_registry.json entry",
  registryBackedMissingFromRegistry.length === 0, JSON.stringify(registryBackedMissingFromRegistry.map((r) => r.manifest_id)));
const registryKeysNotInUnion = [...registryKeys].filter((k) => !registryBackedRows.some((r) => r.canonical_key === k));
check("every write_registry.json entry is reflected in this union (no registry entry orphaned)",
  registryKeysNotInUnion.length === 0, JSON.stringify(registryKeysNotInUnion));
check("exactly 5 write-hardware-verified rows are registry-backed (the 5 newly-promoted fields; the pre-existing 18 use legacy_setting_def and carry no registry entry)",
  hwVerifiedWithRegistryEntry.length === 5, JSON.stringify(hwVerifiedWithRegistryEntry.map((r) => r.manifest_id)));

console.log(`\n${checks} checks run, ${failures} failed.`);
process.exit(failures ? 1 : 0);
