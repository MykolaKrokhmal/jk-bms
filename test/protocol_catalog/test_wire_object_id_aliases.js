#!/usr/bin/env node
"use strict";

// Regression test for PROTOCOL_CATALOG.wireObjectIdAliases (Final-
// preparation-plan Stage 1 corrective pass) -- the GENERATED table
// (tools/protocol/generate.js's buildWireObjectIdAliases()) that lets
// jk_bms.js recognize a field whose real, compiled ESPHome object_id
// diverges from its own canonical key (ESPHome's object_id is ALWAYS
// sanitize(snake_case(name)), confirmed directly against ESPHome source
// and a real compiled main.cpp this session -- never the YAML `id:`).
//
// This project has no DOM/jsdom harness to execute jk_bms.js's own
// browser-only IIFE directly (see docs/adr/0001-protocol-catalog.md's
// own disclosed gap, P1-09) and CLAUDE.md's no-npm-dependencies policy
// rules out adding one (jsdom is an npm package). Following this
// project's own established precedent for exactly this situation
// (test/topology/run.js reimplements jk_bms.js's own documented
// SSE-client behavior in Node rather than executing jk_bms.js itself),
// this test extracts the REAL generated alias data straight out of
// jk_bms.js's own source text (never hand-typed) and feeds it through a
// minimal, deliberately faithful reimplementation of
// registerEntity()/ingestPayload()'s actual resolution algorithm --
// proving the DATA is complete and collision-free, and that a realistic
// incoming wire payload (matching ESPHome's real SSE id format,
// "<domain>-<object_id>", confirmed against esphome/components/
// web_server/web_server.cpp's own set_json_icon_state_value call sites)
// resolves to the correct canonical key for all 16 cell-resistance rows.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const source = fs.readFileSync(path.join(ROOT, "jk_bms.js"), "utf8");
const canonical = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "registers.canonical.json"), "utf8"));

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

// --- Extract the REAL generated table from jk_bms.js's own source (never
// hand-typed here) -----------------------------------------------------
function extractWireObjectIdAliases(src) {
  const blockMatch = src.match(/wireObjectIdAliases: Object\.freeze\(\[([\s\S]*?)\n\s*\]\),/);
  if (!blockMatch) throw new Error("wireObjectIdAliases block not found in jk_bms.js in the expected shape");
  const entries = [];
  const entryPattern = /\["([a-zA-Z0-9_]+)",\s*"([a-zA-Z0-9_]+)",\s*"([a-zA-Z0-9_]+)"\]/g;
  for (let m = entryPattern.exec(blockMatch[1]); m; m = entryPattern.exec(blockMatch[1])) {
    entries.push({ key: m[1], domain: m[2], realId: m[3] });
  }
  return entries;
}

const aliases = extractWireObjectIdAliases(source);
check("wireObjectIdAliases extracted from jk_bms.js", aliases.length > 0, `count=${aliases.length}`);

// --- 1:1 coverage / no-collision validator ------------------------------
// Every alias's realId must be unique (no two canonical keys claiming the
// same real wire id) unless a field genuinely shares one wire entity by
// design -- none do here, this project's real data has none, so the rule
// is simply "no duplicates."
{
  const byRealId = new Map();
  let collisions = 0;
  for (const a of aliases) {
    const dupe = byRealId.get(`${a.domain}/${a.realId}`);
    if (dupe && dupe !== a.key) {
      console.log(`COLLISION: real id "${a.realId}" (domain ${a.domain}) claimed by both "${dupe}" and "${a.key}"`);
      collisions += 1;
    }
    byRealId.set(`${a.domain}/${a.realId}`, a.key);
  }
  check("no two canonical keys claim the same real wire object_id", collisions === 0, `collisions=${collisions}`);
}

// Every alias key must be a real canonical field key (no stale/orphaned
// entries surviving a canonical.json edit that removed a field).
{
  const canonicalKeys = new Set(canonical.registers.flatMap((r) => r.fields).map((f) => f.key));
  const orphaned = aliases.filter((a) => !canonicalKeys.has(a.key));
  check("every alias key is a real canonical field key (no orphaned entries)", orphaned.length === 0,
    orphaned.map((a) => a.key).join(","));
}

// Exhaustive coverage: every canonical field whose esphome_read_entity_id
// differs from its own key MUST appear in this generated table (proves
// buildWireObjectIdAliases() itself didn't silently skip anything).
{
  const aliasKeys = new Set(aliases.map((a) => a.key));
  const missing = [];
  for (const r of canonical.registers) {
    for (const f of r.fields) {
      if (f.esphome_read_entity_id && f.esphome_read_entity_id !== f.key && !aliasKeys.has(f.key)) {
        missing.push(f.key);
      }
    }
  }
  check("every canonical field with a real-id divergence has a generated alias entry", missing.length === 0, missing.join(","));
}

// All 16 cell-resistance fields specifically (this corrective pass's own
// named target) must be present with the exact expected real ids.
{
  let allCorrect = true;
  for (let i = 1; i <= 16; i++) {
    const key = `cell_resistance_${i}`;
    const expectedRealId = `cell_${i}_wire_resistance`;
    const entry = aliases.find((a) => a.key === key);
    if (!entry || entry.realId !== expectedRealId || entry.domain !== "sensor") allCorrect = false;
  }
  check("all 16 cell_resistance_N keys have the correct generated alias (cell_N_wire_resistance, sensor domain)", allCorrect);
}

// --- Faithful reimplementation of registerEntity()/ingestPayload()'s
// actual resolution algorithm (see this file's own module comment for why
// this project reimplements rather than executes jk_bms.js directly) ----
function buildEntityByWireId(registrations) {
  const DEVICE_ID = "jk-bms-test";
  const entityByWireId = new Map();
  function registerEntity(key, domain, configuredName, legacyObjectId) {
    entityByWireId.set(`${domain}/${DEVICE_ID}/${legacyObjectId}`, key);
    entityByWireId.set(`${domain}/${DEVICE_ID}/${configuredName}`, key);
    entityByWireId.set(`${domain}/${configuredName}`, key);
    entityByWireId.set(`${domain}-${configuredName}`, key);
    entityByWireId.set(`${domain}-${legacyObjectId}`, key);
    entityByWireId.set(configuredName, key);
    entityByWireId.set(legacyObjectId, key);
  }
  for (const r of registrations) registerEntity(r.key, r.domain, r.realId, r.realId);
  return entityByWireId;
}

function resolveWireId(entityByWireId, wireId) {
  return entityByWireId.get(wireId);
}

const entityByWireId = buildEntityByWireId(aliases);

// Real wire payload simulation: ESPHome's own web_server component always
// formats a state-change event's id as "<domain>-<object_id>" (confirmed
// against esphome/components/web_server/web_server.cpp's
// set_json_icon_state_value call sites, e.g. "sensor-" + obj->get_object_id()).
{
  let resolvedCount = 0;
  const unresolved = [];
  for (let i = 1; i <= 16; i++) {
    const wireId = `sensor-cell_${i}_wire_resistance`;
    const resolvedKey = resolveWireId(entityByWireId, wireId);
    if (resolvedKey === `cell_resistance_${i}`) resolvedCount += 1;
    else unresolved.push(`${wireId} -> ${resolvedKey}`);
  }
  check("all 16 cell-resistance rows resolve to their canonical key from a real 'sensor-cell_N_wire_resistance' wire payload",
    resolvedCount === 16, unresolved.join(", "));
}

// Same check via the OTHER real ESPHome wire format
// ("<domain>/<device_id>/<object_id>", the native API/JSON form) -- both
// formats must resolve, since registerEntity() registers both.
{
  let resolvedCount = 0;
  for (let i = 1; i <= 16; i++) {
    const wireId = `sensor/jk-bms-test/cell_${i}_wire_resistance`;
    if (resolveWireId(entityByWireId, wireId) === `cell_resistance_${i}`) resolvedCount += 1;
  }
  check("all 16 cell-resistance rows also resolve via the domain/device_id/object_id wire format", resolvedCount === 16);
}

// Negative control: with ONLY the generated alias registrations applied
// (no other jk_bms.js registerEntity() calls in this minimal
// reimplementation), the canonical key used AS-IS as a wire id must NOT
// resolve -- proves this test isn't vacuously passing via some
// accidentally-over-broad match, and that the alias is genuinely doing
// real work (not redundant with some other registration).
{
  const wrongId = "sensor-cell_resistance_1";
  const resolved = resolveWireId(entityByWireId, wrongId);
  check("the canonical key used directly as a wire id does NOT resolve (proves the alias, not a coincidence, does the real work)",
    resolved === undefined, `resolved=${resolved}`);
}

console.log(`\n${checks} checks run, ${failures} failed.`);
process.exit(failures ? 1 : 0);
