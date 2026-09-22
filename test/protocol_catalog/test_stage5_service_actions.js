#!/usr/bin/env node
"use strict";

// STRUCTURAL/GENERATED-ARTIFACT tests for Stage 5's authoritative
// service-action inventory + registry + generator determinism. Mirrors
// test_stage4_rw_inventory.js's own role for Stage 4.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");

let checks = 0;
let failures = 0;
function check(name, pass, detail = "") {
  checks += 1;
  if (!pass) failures += 1;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` -- ${detail}` : ""}`);
}

// Determinism: regenerating twice in a row must be byte-identical, and
// --check must report no drift against the committed artifacts.
const genPath = path.join(ROOT, "tools", "protocol", "authoring", "build_stage5_service_actions.js");
const inventoryPath = path.join(ROOT, "protocol", "generated", "stage5_service_action_inventory.json");
const registryPath = path.join(ROOT, "protocol", "generated", "stage5_service_action_registry.json");
const headerPath = path.join(ROOT, "protocol", "generated", "stage5_service_action_table.h");
const before = {
  inventory: fs.readFileSync(inventoryPath, "utf8"),
  registry: fs.readFileSync(registryPath, "utf8"),
  header: fs.readFileSync(headerPath, "utf8"),
  jkBmsJs: fs.readFileSync(path.join(ROOT, "jk_bms.js"), "utf8"),
};
execFileSync(process.execPath, [genPath], { cwd: ROOT });
const after = {
  inventory: fs.readFileSync(inventoryPath, "utf8"),
  registry: fs.readFileSync(registryPath, "utf8"),
  header: fs.readFileSync(headerPath, "utf8"),
  jkBmsJs: fs.readFileSync(path.join(ROOT, "jk_bms.js"), "utf8"),
};
check("regenerating is byte-identical to the committed artifacts (deterministic, no source drift)",
  before.inventory === after.inventory && before.registry === after.registry &&
  before.header === after.header && before.jkBmsJs === after.jkBmsJs);

let checkExitCode = 0;
try {
  execFileSync(process.execPath, [genPath, "--check"], { cwd: ROOT });
} catch (e) {
  checkExitCode = e.status;
}
check("generator --check reports no drift (exit 0)", checkExitCode === 0);

const inventory = JSON.parse(fs.readFileSync(inventoryPath, "utf8"));
const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
const canon = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "service_actions.canonical.json"), "utf8"));

const EXPECTED_ADDRESSES = ["0x1600", "0x1604", "0x1606", "0x160A", "0x160C", "0x160E", "0x1610", "0x1612"];
const EXPECTED_MANIFEST_IDS = [
  "VoltageCalibration", "Shutdown", "CurrentCalibration", "LI-ION",
  "LIFEPO4", "LTO", "Emergency", "Timecalibration",
];

// ---------------------------------------------------------------------------
// 1. Inventory covers exactly the 8 manifest W-commands, no gaps/dupes.
// ---------------------------------------------------------------------------
check("inventory has exactly 8 rows", inventory.rows.length === 8, `actual=${inventory.rows.length}`);
check("inventory covers exactly the 8 known manifest addresses, no gaps",
  EXPECTED_ADDRESSES.every((a) => inventory.rows.some((r) => r.address === a)),
  JSON.stringify(inventory.rows.map((r) => r.address)));
check("inventory covers exactly the 8 known manifest_ids, no gaps",
  EXPECTED_MANIFEST_IDS.every((id) => inventory.rows.some((r) => r.manifest_id === id)),
  JSON.stringify(inventory.rows.map((r) => r.manifest_id)));
check("no duplicate addresses in the inventory",
  new Set(inventory.rows.map((r) => r.address)).size === inventory.rows.length);
check("no duplicate keys in the inventory",
  new Set(inventory.rows.map((r) => r.key)).size === inventory.rows.length);

// ---------------------------------------------------------------------------
// 2. blocked/software-ready partition is exact and sums to 8.
// ---------------------------------------------------------------------------
const blocked = inventory.rows.filter((r) => r.implementation_state === "blocked");
const softwareReady = inventory.rows.filter((r) => r.implementation_state === "service-action-software-ready");
check("every row is one of the 2 allowed Stage 5 states, never undecided", blocked.length + softwareReady.length === 8);
check("every row carries the shared, invariant fields (declared_access=w, control_kind=service_action, readback_rule=ack_only_no_readback)",
  inventory.rows.every((r) => r.declared_access === "w" && r.control_kind === "service_action" && r.readback_rule === "ack_only_no_readback"));
check("no row ever declares a read_function or is polled (poll_group/freshness_budget_s must not appear in the inventory row shape at all)",
  inventory.rows.every((r) => !("read_function" in r) && !("poll_group" in r) && !("freshness_budget_s" in r)));

// ---------------------------------------------------------------------------
// 3. 0x1600 and 0x1606 are NOT executable while the width ambiguity is open.
// ---------------------------------------------------------------------------
for (const addr of ["0x1600", "0x1606"]) {
  const row = inventory.rows.find((r) => r.address === addr);
  check(`${addr} is blocked, not executable, while the UINT16-vs-Length=4 width ambiguity is open`,
    row && row.implementation_state === "blocked" && row.word_count === null && row.payload_bytes === null,
    row ? JSON.stringify(row) : "row missing");
  check(`${addr}'s blocked_reason names the width ambiguity explicitly`,
    row && row.blocked_reason && row.blocked_reason.includes("REGISTER_WIDTH_AMBIGUOUS"));
}

// ---------------------------------------------------------------------------
// 4. Currently ALL 8 are blocked (no local authoritative source establishes
// an exact payload VALUE for any of them) -- this is the honest, evidence-
// driven outcome of this round's bounded resolution pass, asserted
// explicitly so a future accidental "helpful" fabrication of a payload
// value is caught here first.
// ---------------------------------------------------------------------------
check("all 8 commands are currently blocked (zero commands have an established payload value contract)",
  blocked.length === 8 && softwareReady.length === 0,
  `blocked=${blocked.length} software_ready=${softwareReady.length}`);
check("every blocked row carries both blocked_reason and blocker_closure_criterion",
  blocked.every((r) => !!r.blocked_reason && !!r.blocker_closure_criterion));

// ---------------------------------------------------------------------------
// 5. Registry contains ONLY software-ready commands (currently: none) --
// a blocked command must never appear in the registry at all (not merely
// "marked blocked within it").
// ---------------------------------------------------------------------------
check("registry entry_count matches the inventory's software-ready count", registry.entry_count === softwareReady.length,
  `registry=${registry.entry_count} inventory_software_ready=${softwareReady.length}`);
check("registry entries array length matches entry_count", registry.entries.length === registry.entry_count);
check("no blocked command's key appears in the registry",
  blocked.every((r) => !registry.entries.some((e) => e.key === r.key)));

// ---------------------------------------------------------------------------
// 6. Canonical source round-trips into the inventory without loss --
// spot-check every command's safety_class/submit_policy/address survive.
// ---------------------------------------------------------------------------
for (const c of canon.commands) {
  const row = inventory.rows.find((r) => r.key === c.key);
  check(`${c.key}: inventory row matches canonical address/safety_class/submit_policy exactly`,
    !!row && row.address === c.address && row.safety_class === c.safety_class && row.submit_policy === c.submit_policy);
}

// ---------------------------------------------------------------------------
// 7. Address collision / cross-Stage separation: none of the 8 Stage 5
// addresses collide with any Stage 4 write_registry.json entry or any
// register in registers.canonical.json / the read plan (proves the W-
// commands never leaked into Stage 4's own RW machinery or the generic
// read plan).
// ---------------------------------------------------------------------------
const writeRegistry = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "generated", "write_registry.json"), "utf8"));
check("none of the 8 Stage 5 addresses appear in Stage 4's write_registry.json",
  EXPECTED_ADDRESSES.every((a) => !writeRegistry.entries.some((e) => e.address === a)),
  JSON.stringify(writeRegistry.entries.filter((e) => EXPECTED_ADDRESSES.includes(e.address)).map((e) => e.address)));

const registersCanonical = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "registers.canonical.json"), "utf8"));
check("none of the 8 Stage 5 addresses appear as a register in registers.canonical.json (never modeled as RW/register)",
  EXPECTED_ADDRESSES.every((a) => !registersCanonical.registers.some((r) => r.address === a)),
  JSON.stringify(registersCanonical.registers.filter((r) => EXPECTED_ADDRESSES.includes(r.address)).map((r) => r.address)));

const readPlan = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "generated", "read_plan.json"), "utf8"));
const readPlanAddresses = new Set();
for (const block of readPlan.blocks || []) {
  if (block.address) readPlanAddresses.add(block.address);
}
check("none of the 8 Stage 5 addresses appear in the generic read plan",
  EXPECTED_ADDRESSES.every((a) => !readPlanAddresses.has(a)),
  JSON.stringify([...readPlanAddresses].filter((a) => EXPECTED_ADDRESSES.includes(a))));

console.log(`\nStage 5 service-action inventory/registry summary: ${checks - failures}/${checks} passed`);
process.exit(failures ? 1 : 0);
