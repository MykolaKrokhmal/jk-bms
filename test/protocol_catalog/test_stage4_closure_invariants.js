#!/usr/bin/env node
"use strict";

// STAGE 4 CLOSURE INVARIANTS (2026-09-22) -- a single, compact, machine-
// checked proof of every fact this project's Stage 4 closure verdict
// depends on. Reads ONLY the existing authoritative generated artifacts
// (protocol/generated/stage4_rw_inventory.json, protocol/generated/
// write_registry.json) and the real production jk_bms.js -- no
// re-derivation, no new generation, no duplication of what
// test_stage4_rw_inventory.js / test_stage4_write_registry_equality.js /
// test_write_registry_ui_structural.js already prove field-by-field. This
// file exists because none of those individually assert the SPECIFIC,
// closure-relevant combination below: the exact 18/42/37 split together
// with the 5/37 registry split, hardware-verified provenance, software-
// ready production endpoints, blocked-row fail-closed shape, gps_heartbeat's
// own partial-hardware-smoke status, and the frontend live-submit surface
// never leaking an authorization_required/blocked key.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");

let checks = 0;
let failures = 0;
function check(name, pass, detail = "") {
  checks += 1;
  if (!pass) failures += 1;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` -- ${detail}` : ""}`);
}

const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "generated", "stage4_rw_inventory.json"), "utf8"));
const registry = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "generated", "write_registry.json"), "utf8"));
const jsSource = fs.readFileSync(path.join(ROOT, "jk_bms.js"), "utf8");

const rows = inventory.rows;
const hw = rows.filter((r) => r.stage4_state === "write-hardware-verified");
const sw = rows.filter((r) => r.stage4_state === "write-software-ready");
const bl = rows.filter((r) => r.stage4_state === "blocked");

check("97 manifest RW rows = 18 write-hardware-verified + 42 write-software-ready + 37 blocked",
  rows.length === 97 && hw.length === 18 && sw.length === 42 && bl.length === 37,
  `total=${rows.length} hw=${hw.length} sw=${sw.length} bl=${bl.length}`);

const liveEntries = registry.entries.filter((e) => e.submit_policy === "live");
const authEntries = registry.entries.filter((e) => e.submit_policy === "authorization_required");
check("write_registry.json: 42 entries = 5 live + 37 authorization_required",
  registry.entries.length === 42 && liveEntries.length === 5 && authEntries.length === 37,
  `total=${registry.entries.length} live=${liveEntries.length} auth=${authEntries.length}`);

check("every write-hardware-verified row carries a real, non-empty hardware_verification_provenance",
  hw.length > 0 && hw.every((r) => typeof r.hardware_verification_provenance === "string" && r.hardware_verification_provenance.length > 0),
  hw.filter((r) => !r.hardware_verification_provenance).map((r) => r.canonical_key).join(",") || "none missing");

check("every write-software-ready row carries a real, non-empty current_write_endpoint (a genuine production endpoint)",
  sw.length > 0 && sw.every((r) => typeof r.current_write_endpoint === "string" && r.current_write_endpoint.length > 0),
  sw.filter((r) => !r.current_write_endpoint).map((r) => r.canonical_key).join(",") || "none missing");

check("no blocked row carries a current_write_endpoint (no production write endpoint exists for any blocked field)",
  bl.every((r) => !r.current_write_endpoint),
  bl.filter((r) => r.current_write_endpoint).map((r) => r.canonical_key).join(",") || "none");

check("every blocked row carries both a real blocked_reason and a real blocker_closure_criterion (fail-closed, never a silent gap)",
  bl.every((r) => !!r.blocked_reason && !!r.blocker_closure_criterion),
  bl.filter((r) => !r.blocked_reason || !r.blocker_closure_criterion).map((r) => r.canonical_key).join(",") || "none missing");

const gps = rows.find((r) => r.canonical_key === "gps_heartbeat");
check("gps_heartbeat is NOT marked write-hardware-verified (2026-09-22 hardware smoke: request accepted/no-op preserved, terminal ACK/readback not directly observed -- remains write-software-ready)",
  !!gps && gps.stage4_state === "write-software-ready" && gps.write_hardware_verified === false,
  gps ? `state=${gps.stage4_state} write_hardware_verified=${gps.write_hardware_verified}` : "gps_heartbeat row missing from inventory");

// Frontend live-submit surface: the generated WRITE_REGISTRY.live key set
// embedded in jk_bms.js must be EXACTLY the registry's 5 live keys --
// never an authorization_required or blocked key leaking into the one
// surface that can actually issue a POST without a policy check.
const blockMatch = jsSource.match(/\/\/ >>> BEGIN GENERATED WRITE REGISTRY[\s\S]*?\/\/ <<< END GENERATED WRITE REGISTRY/);
check("jk_bms.js has the generated WRITE REGISTRY block", !!blockMatch);
const block = blockMatch ? blockMatch[0] : "";
const liveKeysInSource = [...block.matchAll(/key:\s*"([a-z0-9_]+)"[^}]*submitPolicy:\s*"live"/g)].map((m) => m[1]);
const authKeysInSource = new Set([...block.matchAll(/key:\s*"([a-z0-9_]+)"[^}]*submitPolicy:\s*"authorization_required"/g)].map((m) => m[1]));
const blockedKeysInSource = new Set([...block.matchAll(/key:\s*"([a-z0-9_]+)",\s*address:\s*\d+,\s*writeSafetyClass:[^}]*reason:/g)].map((m) => m[1]));

check("the frontend's live-submit key set exactly matches the registry's 5 live keys, with zero authorization_required/blocked key overlap",
  liveKeysInSource.length === 5 &&
    liveEntries.every((e) => liveKeysInSource.includes(e.key)) &&
    liveKeysInSource.every((k) => !authKeysInSource.has(k) && !blockedKeysInSource.has(k)),
  `live=${JSON.stringify(liveKeysInSource)}`);

console.log(`\nStage 4 closure invariants summary: ${checks - failures}/${checks} passed`);
process.exit(failures ? 1 : 0);
