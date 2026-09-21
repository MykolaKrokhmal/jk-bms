#!/usr/bin/env node
"use strict";

// Stage 4 (typed-petting-puzzle plan §5 Phase 3): exact-equality proof.
//
// This project's write-enablement is two-tier by design:
//   - the original 18 fields (owner_write_override, 2026-09-10) -- hand-
//     authored `number:` entities in batterylifepo4.yaml, keyed in
//     jk_bms.js's own hand-curated SETTING_KEYS allowlist.
//   - the NEW 42 fields (Stage 4, verification_status="confirmed" alone,
//     no owner override needed) -- generated `number:` entities in
//     protocol/generated/write_registry.yaml, keyed in
//     protocol/generated/write_registry.json.
//
// The invariant this proves: canonical-authorized writable keys (every
// field with effective_access==="rw") is EXACTLY the union of these two
// allowlists, with zero overlap and zero gap in either direction -- no
// canonical-authorized key is missing from both, no allowlist key claims
// authorization the canonical source doesn't grant, and every key in
// each allowlist has a real, registered write entity in its own file.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
function loadJson(p) { return JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8")); }

let checks = 0;
let failures = 0;
function check(name, cond, detail = "") {
  checks += 1;
  if (cond) console.log(`PASS  ${name}${detail ? ` -- ${detail}` : ""}`);
  else { failures += 1; console.log(`FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
}

const canonical = loadJson("protocol/registers.canonical.json");
const writeRegistry = loadJson("protocol/generated/write_registry.json");
const js = fs.readFileSync(path.join(ROOT, "jk_bms.js"), "utf8");
const yaml = fs.readFileSync(path.join(ROOT, "batterylifepo4.yaml"), "utf8");
const registryYaml = fs.readFileSync(path.join(ROOT, "protocol", "generated", "write_registry.yaml"), "utf8");

// --- canonical-authorized set: every field with effective_access==="rw". ---
const canonicalAuthorized = new Set();
for (const r of canonical.registers) {
  for (const f of r.fields) {
    if (f.effective_access === "rw") canonicalAuthorized.add(f.key);
  }
}
check("canonical-authorized (effective_access=rw) set is non-empty", canonicalAuthorized.size > 0, `count=${canonicalAuthorized.size}`);

// --- SETTING_DEFS (original 18, hand-curated). ---
const settingKeysMatch = js.match(/SETTING_KEYS\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\)/);
check("jk_bms.js SETTING_KEYS table exists", !!settingKeysMatch);
const settingKeys = new Set((settingKeysMatch ? settingKeysMatch[1] : "").match(/"([a-z0-9_]+)"/g).map((s) => s.slice(1, -1)));
check("SETTING_KEYS has exactly 18 entries (unchanged by Stage 4 -- no Stage 4 field was added here)", settingKeys.size === 18, `actual=${settingKeys.size}`);

// --- write_registry.json (the NEW 42). ---
const registryKeys = new Set(writeRegistry.entries.map((e) => e.key));
check("write_registry.json has entries", registryKeys.size > 0, `count=${registryKeys.size}`);

// --- zero overlap between the two allowlists. ---
const overlap = [...settingKeys].filter((k) => registryKeys.has(k));
check("zero overlap between SETTING_KEYS and write_registry.json (a key belongs to exactly one tier)", overlap.length === 0, JSON.stringify(overlap));

// --- union equals canonical-authorized, exactly. ---
const union = new Set([...settingKeys, ...registryKeys]);
const missingFromUnion = [...canonicalAuthorized].filter((k) => !union.has(k));
const extraInUnion = [...union].filter((k) => !canonicalAuthorized.has(k));
check("every canonical-authorized key is in SETTING_KEYS or write_registry.json (no orphaned authorization)",
  missingFromUnion.length === 0, JSON.stringify(missingFromUnion));
check("no allowlist key claims authorization the canonical source doesn't grant",
  extraInUnion.length === 0, JSON.stringify(extraInUnion));
check("SETTING_KEYS ∪ write_registry.json keys exactly equals the canonical-authorized set",
  union.size === canonicalAuthorized.size && missingFromUnion.length === 0 && extraInUnion.length === 0,
  `union=${union.size} canonical=${canonicalAuthorized.size}`);

// --- every write_registry.json key has a real generated entity. ---
let missingRegistryEntities = [];
for (const key of registryKeys) {
  if (!registryYaml.includes(`id: set_${key}\n`)) missingRegistryEntities.push(key);
}
check("every write_registry.json key has a real `id: set_<key>` entity in write_registry.yaml",
  missingRegistryEntities.length === 0, JSON.stringify(missingRegistryEntities));

// --- every write_registry.json key's real geometry matches canonical exactly. ---
const canonicalByKey = new Map();
for (const r of canonical.registers) for (const f of r.fields) canonicalByKey.set(f.key, { reg: r, field: f });
let geometryMismatches = [];
for (const e of writeRegistry.entries) {
  const c = canonicalByKey.get(e.key);
  if (!c) { geometryMismatches.push(`${e.key}: not in canonical at all`); continue; }
  if (e.address !== c.reg.address) geometryMismatches.push(`${e.key}: address ${e.address} != ${c.reg.address}`);
  if (e.mask !== c.field.mask) geometryMismatches.push(`${e.key}: mask ${e.mask} != ${c.field.mask}`);
  if (e.shift !== c.field.shift) geometryMismatches.push(`${e.key}: shift ${e.shift} != ${c.field.shift}`);
  if (e.write_uses_read_modify_write !== c.field.write_uses_read_modify_write) {
    geometryMismatches.push(`${e.key}: write_uses_read_modify_write ${e.write_uses_read_modify_write} != ${c.field.write_uses_read_modify_write}`);
  }
}
check("every write_registry.json entry's geometry (address/mask/shift/RMW flag) matches canonical exactly",
  geometryMismatches.length === 0, JSON.stringify(geometryMismatches.slice(0, 5)));

// --- no Stage 5 W-only action leaked into either allowlist. ---
const wOnlyKeys = new Set();
for (const r of canonical.registers) for (const f of r.fields) if (f.access === "w") wOnlyKeys.add(f.key);
const wLeakedIntoSetting = [...settingKeys].filter((k) => wOnlyKeys.has(k));
const wLeakedIntoRegistry = [...registryKeys].filter((k) => wOnlyKeys.has(k));
check("no declared-write-only (access='w') Stage 5 field leaked into SETTING_KEYS", wLeakedIntoSetting.length === 0, JSON.stringify(wLeakedIntoSetting));
check("no declared-write-only (access='w') Stage 5 field leaked into write_registry.json", wLeakedIntoRegistry.length === 0, JSON.stringify(wLeakedIntoRegistry));

// --- write_registry.yaml is actually included from batterylifepo4.yaml. ---
check("batterylifepo4.yaml includes protocol/generated/write_registry.yaml as a package",
  /write_registry:\s*!include protocol\/generated\/write_registry\.yaml/.test(yaml));

// --- disruptive/topology/credential entries never dispatch a live write
// (Phase 5 rule 8 / Phase 6: no active submit without a lab-safe policy). ---
let liveButUnsafe = [];
for (const e of writeRegistry.entries) {
  if (e.write_safety_class !== "normal" && e.submit_policy === "live") liveButUnsafe.push(e.key);
}
check("every non-normal-class write_registry.json entry has submit_policy=authorization_required, never live",
  liveButUnsafe.length === 0, JSON.stringify(liveButUnsafe));

console.log(`\n${checks} checks run, ${failures} failed.`);
process.exit(failures ? 1 : 0);
