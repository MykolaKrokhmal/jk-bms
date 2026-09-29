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
// Settings write migration (clustered-read plan M5, owner decision
// 2026-09-29): the overlap is EXACTLY the migrated Settings fields -- the
// generator's explicit, audited list, never every owner_write_override.
const migration = writeRegistry.settings_write_migration || [];
const migrated = migration.filter((m) => m.outcome === "migrated").map((m) => m.key).sort();
const overlap = [...settingKeys].filter((k) => registryKeys.has(k)).sort();
check("the SETTING_KEYS / write_registry.json overlap is exactly the 18 migrated Settings fields",
  JSON.stringify(overlap) === JSON.stringify(migrated) && migrated.length === 18, JSON.stringify({ overlap, migrated }));
check("the migration table covers exactly the 18 SETTING_KEYS",
  migration.length === 18 && migration.every((m) => settingKeys.has(m.key)));
check("no owner_write_override field outside the migration list is in the registry",
  writeRegistry.entries.filter((e) => e.owner_write_override && e.owner_write_override.authorized).every((e) => migrated.includes(e.key)));
{
  const canonicalBy = new Map();
  for (const r of canonical.registers) for (const f of r.fields) canonicalBy.set(f.key, { reg: r, field: f });
  const bad = [];
  for (const key of migrated) {
    const e = writeRegistry.entries.find((x) => x.key === key);
    const { reg, field } = canonicalBy.get(key);
    for (const [k, got, want] of [["address", e.address, reg.address], ["word_count", e.word_count, reg.word_count],
      ["write_function", e.write_function, reg.write_function], ["wire_type", e.wire_type, field.wire_type],
      ["signedness", e.signedness, field.signedness], ["scale", e.scale, field.scale], ["offset", e.offset, field.offset],
      ["minimum", e.minimum, field.minimum], ["maximum", e.maximum, field.maximum], ["step", e.step, field.step],
      ["field_width_bits", e.field_width_bits, field.field_width_bits], ["mask", e.mask, field.mask], ["shift", e.shift, field.shift]]) {
      if (got !== want) bad.push(`${key}.${k}: ${got} != ${want}`);
    }
    if (e.write_uses_read_modify_write !== false || e.compare_mask !== "0xFFFFFFFF" || e.submit_policy !== "live" ||
        !(e.word_count === 1 || e.word_count === 2)) bad.push(`${key}: not a live full-width 1-2 register write`);
  }
  check("every migrated field uses its exact canonical address, width, type, sign, scaling, range and step (live, full-width, 1-2 registers)",
    bad.length === 0, bad.slice(0, 5).join("; "));
  const blocked = migration.filter((m) => m.outcome === "blocked");
  check("no migration field is blocked", blocked.length === 0, JSON.stringify(blocked.map((m) => [m.key, m.blocked_reason])));
  // The four temperature recoveries are signed S32 (upstream INT32 / S_DWORD).
  const temps = ["charge_otpr", "discharge_otpr", "charge_utpr", "mos_otpr"].map((k) => writeRegistry.entries.find((x) => x.key === k));
  check("the four temperature recoveries are live, signed S32, scale 0.1, -100..200, step 0.1, 2 registers",
    temps.every((e) => e && e.wire_type === "S32" && e.signedness === "signed" && e.scale === 0.1 && e.minimum === -100 &&
      e.maximum === 200 && e.step === 0.1 && e.word_count === 2 && e.submit_policy === "live" && e.write_function === "write_multiple_registers_fc16"));
  const mainYaml = fs.readFileSync(path.join(ROOT, "batterylifepo4.yaml"), "utf8");
  // Each migrated entity writes through write_bms_u32 (the tracked entity
  // pool: NO_CHANGE -> no command; otherwise begin_write_tx with ACK +
  // forced readback), with its own canonical address -- never directly.
  const badAction = migrated.filter((k) => {
    const start = registryYaml.indexOf(`    id: set_${k}\n`);
    const block = start < 0 ? "" : registryYaml.slice(start, registryYaml.indexOf("\n  - platform:", start + 5) >>> 0);
    const e = writeRegistry.entries.find((x) => x.key === k);
    return !(block.includes(`id(write_bms_u32)->execute(${e.address}, int(enc.encoded_raw));`) && !block.includes("begin_write_tx)->execute") &&
      block.includes(`jk_write_tx::encode_numeric_field(double(x), ${e.signedness === "signed"}, ${e.scale}, ${e.offset}, ${e.minimum}, ${e.maximum}, 32);`));
  });
  check("every migrated entity encodes with its canonical scaling and writes through the tracked write_bms_u32 path (never begin_write_tx directly)",
    badAction.length === 0, JSON.stringify(badAction));
  const writeU32 = mainYaml.slice(mainYaml.indexOf("  - id: write_bms_u32\n"), mainYaml.indexOf("  - id: write_bms_u16\n"));
  check("write_bms_u32 only arms a tracked request (NO_CHANGE-aware), and begin_write_tx keeps ACK + forced readback",
    writeU32.includes("arm_write(jk_cluster_runtime::g_entity_write_requests, w, millis())") && writeU32.includes("w.full_width = true;") &&
    /id\(g_wtx_acked\)\[idx\] = 1;/.test(mainYaml) && mainYaml.includes("create_write_multiple_command("));
  const dup = [...settingKeys].filter((k) => ((mainYaml + registryYaml).match(new RegExp(`\\n\\s*id: set_${k}\\n`, "g")) || []).length > 1);
  check("every set_<key> id exists exactly once across batterylifepo4.yaml + write_registry.yaml (migrated = generated only)",
    dup.length === 0 && migrated.every((k) => !new RegExp(`\\n\\s*id: set_${k}\\n`).test(mainYaml) && registryYaml.includes(`id: set_${k}\n`)),
    JSON.stringify(dup));
}

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
