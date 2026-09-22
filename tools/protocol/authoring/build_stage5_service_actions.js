#!/usr/bin/env node
"use strict";

/*
 * Stage 5 (write-only V1.1 service commands, 0x1600-0x1612): reads the
 * hand-authored protocol/service_actions.canonical.json (schema:
 * protocol/schema/service-actions-source.schema.json), validates it
 * structurally (mini-schema) AND semantically (this file's own
 * checkSemanticInvariants(), below -- cross-field rules mini-schema
 * cannot express), then emits three deterministic generated artifacts:
 *
 *   protocol/generated/stage5_service_action_inventory.json
 *     -- all 8 commands, one row each, implementation_state in
 *        {"service-action-software-ready", "blocked"}. The authoritative
 *        Stage 5 classification record (mirrors stage4_rw_inventory.json's
 *        own role for Stage 4).
 *
 *   protocol/generated/stage5_service_action_registry.json
 *     -- ONLY the service-action-software-ready commands, with their full
 *        compile-time dispatch contract (address/FC/word_count/payload_
 *        bytes/encoding/safety_class/submit_policy). Empty today (every
 *        one of the 8 commands is blocked -- see each one's own
 *        blocked_reason in the inventory above) -- an empty registry is
 *        the CORRECT, honest output given the current evidence, not a
 *        bug to paper over.
 *
 *   protocol/generated/stage5_service_action_table.h
 *     -- a single, generic, fail-closed-by-construction C++ table
 *        covering all 8 commands (both states) for
 *        components/jk_service_action/jk_service_action_core.h and
 *        batterylifepo4.yaml's own HTTP handler to enumerate without
 *        ever hand-duplicating this list.
 *
 * Also injects a matching SERVICE_ACTIONS catalog block into jk_bms.js
 * (frontend rendering), the same established BEGIN/END-marker-replace
 * pattern tools/protocol/authoring/build_stage4_rw_inventory.js already
 * uses for WRITE_REGISTRY -- see that file's own injectIntoJkBmsJs for
 * the identical technique this mirrors.
 *
 * Run:
 *   node tools/protocol/authoring/build_stage5_service_actions.js
 *   node tools/protocol/authoring/build_stage5_service_actions.js --check
 */

const fs = require("fs");
const path = require("path");
const { validate } = require("../lib/mini-schema.js");
const { checkSemanticInvariants } = require("../lib/service-action-semantic-checks.js");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const CANON_PATH = path.join(ROOT, "protocol", "service_actions.canonical.json");
const SCHEMA_PATH = path.join(ROOT, "protocol", "schema", "service-actions-source.schema.json");
const INVENTORY_OUT = path.join(ROOT, "protocol", "generated", "stage5_service_action_inventory.json");
const REGISTRY_OUT = path.join(ROOT, "protocol", "generated", "stage5_service_action_registry.json");
const HEADER_OUT = path.join(ROOT, "protocol", "generated", "stage5_service_action_table.h");
const JK_BMS_JS_PATH = path.join(ROOT, "jk_bms.js");

const CHECK = process.argv.includes("--check");

const canon = JSON.parse(fs.readFileSync(CANON_PATH, "utf8"));
const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));

const structuralErrors = validate(schema, canon);
if (structuralErrors.length) {
  console.error("build_stage5_service_actions.js: STRUCTURAL SCHEMA VIOLATION(S):");
  for (const e of structuralErrors) console.error(`  ${e.path}: ${e.message}`);
  process.exit(1);
}

// Semantic invariants (§3 of the round's own directive) live in
// ../lib/service-action-semantic-checks.js, shared with
// test/protocol_catalog/test_stage5_service_actions_negative_fixtures.js so
// the same rules that gate generation are the ones proven to actually fire.
// Every one of these is a REAL bug in protocol/service_actions.canonical.json
// if it ever fires (this is OUR OWN hand-authored file, not external data),
// so a violation here is fail-closed: the generator refuses to produce any
// output rather than emit a self-contradictory registry.
const semanticErrors = checkSemanticInvariants(canon.commands);
if (semanticErrors.length) {
  console.error("build_stage5_service_actions.js: SEMANTIC INVARIANT VIOLATION(S):");
  for (const e of semanticErrors) console.error(`  ${e}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Inventory (all 8 rows, deterministic order == canonical source order,
// which is itself address-ascending).
// ---------------------------------------------------------------------------
const inventoryRows = canon.commands.map((c) => ({
  key: c.key,
  manifest_id: c.manifest_id,
  address: c.address,
  declared_access: c.declared_access,
  control_kind: c.control_kind,
  write_function: c.write_function,
  wire_type: c.wire_type,
  word_count: c.word_count,
  payload_bytes: c.payload_bytes,
  byte_order: c.byte_order,
  word_order: c.word_order,
  payload_parameterized: c.payload_parameterized,
  readback_rule: c.readback_rule,
  safety_class: c.safety_class,
  submit_policy: c.submit_policy,
  implementation_state: c.implementation_state,
  blocked_reason: c.blocked_reason,
  blocker_closure_criterion: c.blocker_closure_criterion,
  evidence_count: c.evidence.length,
}));

const countsByState = inventoryRows.reduce((acc, r) => {
  acc[r.implementation_state] = (acc[r.implementation_state] || 0) + 1;
  return acc;
}, {});

const inventoryDoc = {
  $comment: "GENERATED by tools/protocol/authoring/build_stage5_service_actions.js from protocol/service_actions.canonical.json. DO NOT EDIT BY HAND.",
  schema_version: 1,
  row_count: inventoryRows.length,
  counts_by_state: countsByState,
  rows: inventoryRows,
};

// ---------------------------------------------------------------------------
// Registry: ONLY service-action-software-ready commands, full compile-time
// dispatch contract. Deliberately excludes blocked rows entirely (a
// blocked command has no production endpoint at all -- see
// jk_service_action_core.h's own module comment for why this table's mere
// EXISTENCE for a key is itself the "executable" fact the backend trusts).
// ---------------------------------------------------------------------------
const softwareReady = canon.commands.filter((c) => c.implementation_state === "service-action-software-ready");
const registryEntries = softwareReady.map((c) => ({
  key: c.key,
  manifest_id: c.manifest_id,
  address: c.address,
  write_function: c.write_function,
  word_count: c.word_count,
  payload_bytes: c.payload_bytes,
  byte_order: c.byte_order,
  word_order: c.word_order,
  payload_parameterized: c.payload_parameterized,
  payload_value_contract: c.payload_value_contract,
  safety_class: c.safety_class,
  submit_policy: c.submit_policy,
  readback_rule: c.readback_rule,
}));

const registryDoc = {
  $comment: "GENERATED by tools/protocol/authoring/build_stage5_service_actions.js from protocol/service_actions.canonical.json. DO NOT EDIT BY HAND. Contains ONLY service-action-software-ready commands -- see stage5_service_action_inventory.json for the full 8-command classification including every blocked command's reason.",
  schema_version: 1,
  entry_count: registryEntries.length,
  entries: registryEntries,
};

function atomicWrite(targetPath, content) {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(targetPath)}.tmp-${process.pid}`);
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, targetPath);
}

const inventoryJson = JSON.stringify(inventoryDoc, null, 2) + "\n";
const registryJson = JSON.stringify(registryDoc, null, 2) + "\n";

// ---------------------------------------------------------------------------
// C++ header: one generic, bounded table covering all 8 commands (both
// states). Fail-closed by construction -- a command not in this table (or
// present but with is_executable=false) can never be dispatched by
// jk_service_action_core.h's own generic lookup, no per-command hand-wiring
// possible/needed in batterylifepo4.yaml.
// ---------------------------------------------------------------------------
function cEscape(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ");
}
function cStr(s) { return s === null || s === undefined ? "nullptr" : `"${cEscape(s)}"`; }

const headerLines = [];
headerLines.push("#pragma once");
headerLines.push("// Generated by tools/protocol/authoring/build_stage5_service_actions.js from");
headerLines.push("// protocol/service_actions.canonical.json. DO NOT EDIT BY HAND -- edit the");
headerLines.push("// canonical source and its schema, then regenerate.");
headerLines.push("//");
headerLines.push("// One row per V1.1 write-only (access=W) service command, ALL 8, both");
headerLines.push("// states. is_executable=false commands have no write_function/word_count/");
headerLines.push("// payload_bytes (zero-valued placeholders) -- jk_service_action_core.h's own");
headerLines.push("// dispatch function must reject any entry with is_executable=false before");
headerLines.push("// ever touching those fields, never treat the zero placeholder as a real 0.");
headerLines.push("#include <cstddef>");
headerLines.push("#include <cstdint>");
headerLines.push("");
headerLines.push("namespace jk_service_action {");
headerLines.push("");
headerLines.push("struct ServiceActionEntry {");
headerLines.push("  const char *key;");
headerLines.push("  const char *manifest_id;");
headerLines.push("  uint16_t address;");
headerLines.push("  bool is_executable;  // true only for service-action-software-ready commands");
headerLines.push("  uint8_t word_count;  // 0 when not executable");
headerLines.push("  uint8_t payload_bytes;  // 0 when not executable");
headerLines.push("  bool payload_parameterized;");
headerLines.push("  const char *safety_class;");
headerLines.push("  const char *submit_policy;");
headerLines.push("  const char *blocked_reason;  // nullptr when executable");
headerLines.push("};");
headerLines.push("");
headerLines.push(`constexpr std::size_t kServiceActionCount = ${canon.commands.length};`);
headerLines.push("constexpr ServiceActionEntry kServiceActions[kServiceActionCount] = {");
for (const c of canon.commands) {
  const executable = c.implementation_state === "service-action-software-ready";
  headerLines.push(
    `    {${cStr(c.key)}, ${cStr(c.manifest_id)}, ${c.address}, ${executable ? "true" : "false"}, ` +
    `${executable ? c.word_count : 0}, ${executable ? c.payload_bytes : 0}, ` +
    `${c.payload_parameterized ? "true" : "false"}, ${cStr(c.safety_class)}, ${cStr(c.submit_policy)}, ` +
    `${executable ? "nullptr" : cStr(c.blocked_reason)}},  // ${c.address}`
  );
}
headerLines.push("};");
headerLines.push("");
headerLines.push("}  // namespace jk_service_action");
headerLines.push("");
const headerContent = headerLines.join("\n");

// ---------------------------------------------------------------------------
// jk_bms.js injection -- SERVICE_ACTIONS catalog block, same marker-replace
// technique as build_stage4_rw_inventory.js's own WRITE_REGISTRY injection.
// ---------------------------------------------------------------------------
const JS_BEGIN = "  // >>> BEGIN GENERATED SERVICE ACTIONS (Stage 5, 2026-09-22) — DO NOT EDIT BY HAND.";
const JS_END = "  // <<< END GENERATED SERVICE ACTIONS";

function jsLiteral(v) { return v === null || v === undefined ? "null" : JSON.stringify(v); }

function buildEntryLine(c) {
  return (
    `      { key: ${jsLiteral(c.key)}, manifestId: ${jsLiteral(c.manifest_id)}, address: ${jsLiteral(c.address)}, ` +
    `state: ${jsLiteral(c.implementation_state)}, safetyClass: ${jsLiteral(c.safety_class)}, ` +
    `submitPolicy: ${jsLiteral(c.submit_policy)}, payloadParameterized: ${jsLiteral(c.payload_parameterized)}, ` +
    `blockedReason: ${jsLiteral(c.blocked_reason)}, blockerClosureCriterion: ${jsLiteral(c.blocker_closure_criterion)} },`
  );
}

function buildJsInjectionBlock() {
  return [
    JS_BEGIN,
    "  // Source of truth: protocol/service_actions.canonical.json ->",
    "  // protocol/generated/stage5_service_action_inventory.json.",
    "  // `node tools/protocol/authoring/build_stage5_service_actions.js --check` fails if this block drifts.",
    "  // ALL 8 V1.1 write-only service commands (0x1600-0x1612), both states -- never a register-polled field,",
    "  // never mixed into WRITE_REGISTRY/PROTOCOL_CATALOG above.",
    "  const SERVICE_ACTIONS = Object.freeze([",
    canon.commands.map(buildEntryLine).join("\n"),
    "  ]);",
    JS_END,
  ].join("\n");
}

function injectIntoJkBmsJs(currentSource) {
  const beginIdx = currentSource.indexOf(JS_BEGIN);
  const endIdx = currentSource.indexOf(JS_END);
  if (beginIdx === -1 || endIdx === -1) {
    throw new Error(
      "jk_bms.js is missing the GENERATED SERVICE ACTIONS markers. This generator only ever REPLACES the " +
      "content between an existing BEGIN/END marker pair (a deliberate one-time manual edit) — it does not " +
      "insert new markers itself."
    );
  }
  const endOfEndLine = currentSource.indexOf("\n", endIdx);
  const before = currentSource.slice(0, beginIdx);
  const after = currentSource.slice(endOfEndLine);
  return before + buildJsInjectionBlock() + after;
}

const currentJkBmsJs = fs.readFileSync(JK_BMS_JS_PATH, "utf8");
const nextJkBmsJs = injectIntoJkBmsJs(currentJkBmsJs);

if (CHECK) {
  let drift = false;
  const existingInventory = fs.existsSync(INVENTORY_OUT) ? fs.readFileSync(INVENTORY_OUT, "utf8") : null;
  if (existingInventory !== inventoryJson) { console.log(`build_stage5_service_actions.js --check: DRIFT -- ${path.relative(ROOT, INVENTORY_OUT)}`); drift = true; }
  const existingRegistry = fs.existsSync(REGISTRY_OUT) ? fs.readFileSync(REGISTRY_OUT, "utf8") : null;
  if (existingRegistry !== registryJson) { console.log(`build_stage5_service_actions.js --check: DRIFT -- ${path.relative(ROOT, REGISTRY_OUT)}`); drift = true; }
  const existingHeader = fs.existsSync(HEADER_OUT) ? fs.readFileSync(HEADER_OUT, "utf8") : null;
  if (existingHeader !== headerContent) { console.log(`build_stage5_service_actions.js --check: DRIFT -- ${path.relative(ROOT, HEADER_OUT)}`); drift = true; }
  if (currentJkBmsJs !== nextJkBmsJs) { console.log("build_stage5_service_actions.js --check: DRIFT -- jk_bms.js's GENERATED SERVICE ACTIONS block"); drift = true; }
  if (drift) process.exit(1);
  console.log("build_stage5_service_actions.js --check: no drift.");
  process.exit(0);
}

atomicWrite(INVENTORY_OUT, inventoryJson);
atomicWrite(REGISTRY_OUT, registryJson);
atomicWrite(HEADER_OUT, headerContent);
atomicWrite(JK_BMS_JS_PATH, nextJkBmsJs);
console.log(`wrote ${path.relative(ROOT, INVENTORY_OUT)}`);
console.log(`wrote ${path.relative(ROOT, REGISTRY_OUT)}`);
console.log(`wrote ${path.relative(ROOT, HEADER_OUT)}`);
console.log(`wrote ${path.relative(ROOT, JK_BMS_JS_PATH)} (GENERATED SERVICE ACTIONS block)`);
console.log(`${inventoryRows.length} commands: ${JSON.stringify(countsByState)}`);
