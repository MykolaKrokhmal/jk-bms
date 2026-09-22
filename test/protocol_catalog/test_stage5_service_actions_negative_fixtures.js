#!/usr/bin/env node
"use strict";

// STRUCTURAL/SEMANTIC negative-fixture tests for Stage 5's canonical
// service-action source (protocol/schema/service-actions-source.schema.json
// + tools/protocol/lib/service-action-semantic-checks.js). Proves the
// validator/generator's own gate actually REJECTS each forbidden shape
// this round's directive names explicitly -- a validator only ever run
// against the (valid) real canonical source never proves its failure
// paths work. Uses the REAL production schema + the REAL, shared
// checkSemanticInvariants() (the exact function
// build_stage5_service_actions.js gates generation on), never a
// reimplementation.

const fs = require("fs");
const path = require("path");
const { validate } = require("../../tools/protocol/lib/mini-schema.js");
const { checkSemanticInvariants } = require("../../tools/protocol/lib/service-action-semantic-checks.js");

const ROOT = path.join(__dirname, "..", "..");
const schema = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "schema", "service-actions-source.schema.json"), "utf8"));

let checks = 0;
let failures = 0;
function check(name, pass, detail = "") {
  checks += 1;
  if (!pass) failures += 1;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` -- ${detail}` : ""}`);
}

function baseCommand(overrides = {}) {
  return Object.assign({
    key: "example_action",
    manifest_id: "ExampleAction",
    address: "0x1600",
    declared_access: "w",
    read_function: null,
    write_function: null,
    poll_group: null,
    freshness_budget_s: null,
    readback_rule: "ack_only_no_readback",
    control_kind: "service_action",
    wire_type: "UINT16",
    word_count: null,
    payload_bytes: null,
    byte_order: "big_endian",
    word_order: "single_word",
    payload_parameterized: false,
    payload_value_contract: null,
    safety_class: "disruptive",
    submit_policy: "authorization_required",
    implementation_state: "blocked",
    blocked_reason: "PAYLOAD_VALUE_CONTRACT_NOT_ESTABLISHED",
    blocker_closure_criterion: "A controlled protocol-capture experiment confirms the exact payload.",
    evidence: [{ source: "official_pdf_v1_1", citation: "fixture citation" }],
  }, overrides);
}

function baseSoftwareReadyCommand(overrides = {}) {
  return baseCommand(Object.assign({
    write_function: "write_multiple_registers_fc16",
    word_count: 1,
    payload_bytes: 2,
    payload_value_contract: "Always writes the fixed UINT16 value 0x0001 to trigger the action -- confirmed by [fixture].",
    implementation_state: "service-action-software-ready",
    blocked_reason: null,
    blocker_closure_criterion: null,
  }, overrides));
}

function structuralErrorsFor(commands) {
  return validate(schema, { schema_version: 1, commands });
}

// ---------------------------------------------------------------------------
// Sanity: both base fixtures are valid on their own (proves the negative
// cases below are failing for the SPECIFIC mutation, not some unrelated
// baseline defect).
// ---------------------------------------------------------------------------
check("base blocked fixture passes structural validation", structuralErrorsFor([baseCommand()]).length === 0,
  JSON.stringify(structuralErrorsFor([baseCommand()])));
check("base blocked fixture passes semantic validation", checkSemanticInvariants([baseCommand()]).length === 0,
  JSON.stringify(checkSemanticInvariants([baseCommand()])));
check("base software-ready fixture passes structural validation", structuralErrorsFor([baseSoftwareReadyCommand()]).length === 0,
  JSON.stringify(structuralErrorsFor([baseSoftwareReadyCommand()])));
check("base software-ready fixture passes semantic validation", checkSemanticInvariants([baseSoftwareReadyCommand()]).length === 0,
  JSON.stringify(checkSemanticInvariants([baseSoftwareReadyCommand()])));

// ---------------------------------------------------------------------------
// 1. A W-command must never be modeled with read polling.
// ---------------------------------------------------------------------------
{
  const bad = baseCommand({ poll_group: "on_demand" });
  check("W-command with a non-null poll_group is rejected", checkSemanticInvariants([bad]).some((e) => e.includes("poll_group must be null")));
}
{
  const bad = baseCommand({ freshness_budget_s: 30 });
  check("W-command with a non-null freshness_budget_s is rejected", checkSemanticInvariants([bad]).some((e) => e.includes("freshness_budget_s must be null")));
}
{
  const bad = baseCommand({ read_function: "read_holding_registers_fc03" });
  check("W-command with a non-null read_function is rejected (structural)", structuralErrorsFor([bad]).length > 0);
}

// ---------------------------------------------------------------------------
// 2. A software-ready (executable) command without a write function.
// ---------------------------------------------------------------------------
{
  const bad = baseSoftwareReadyCommand({ write_function: null });
  check("executable command without write_function is rejected", checkSemanticInvariants([bad]).some((e) => e.includes("write_function is null")));
}

// ---------------------------------------------------------------------------
// 3. Executable command without exact word_count/payload_bytes.
// ---------------------------------------------------------------------------
{
  const bad = baseSoftwareReadyCommand({ word_count: null, payload_bytes: null });
  check("executable command with null word_count/payload_bytes is rejected", checkSemanticInvariants([bad]).some((e) => e.includes("unambiguous wire width")));
}

// ---------------------------------------------------------------------------
// 4. payload_bytes != word_count * 2.
// ---------------------------------------------------------------------------
{
  const bad = baseSoftwareReadyCommand({ word_count: 1, payload_bytes: 4 });
  check("payload_bytes mismatched with word_count*2 is rejected (executable)", checkSemanticInvariants([bad]).some((e) => e.includes("!= word_count*2")));
}
{
  const bad = baseCommand({ word_count: 2, payload_bytes: 2 });
  check("payload_bytes mismatched with word_count*2 is rejected (blocked, non-null width)", checkSemanticInvariants([bad]).some((e) => e.includes("!= word_count*2")));
}

// ---------------------------------------------------------------------------
// 5. An ACK-only command incorrectly declared forced-readback.
// ---------------------------------------------------------------------------
{
  const bad = baseCommand({ readback_rule: "forced_readback_confirmed" });
  check("readback_rule other than ack_only_no_readback is rejected (structural)", structuralErrorsFor([bad]).length > 0);
}

// ---------------------------------------------------------------------------
// 6. A blocked command with a production submit endpoint -- modeled here
// as "blocked but claims a resolved payload_value_contract" (the
// canonical-source-level equivalent of "has a real dispatch contract");
// the generator's own registry-emission step additionally never includes
// a blocked row at all (see test_stage5_service_actions.js's registry-
// exclusion check for that runtime-level proof).
// ---------------------------------------------------------------------------
{
  const bad = baseCommand({ payload_value_contract: "Always writes 0x0001." });
  check("blocked command with a non-null payload_value_contract is rejected", checkSemanticInvariants([bad]).some((e) => e.includes("must never claim a resolved payload contract")));
}
{
  const bad = baseCommand({ blocked_reason: null });
  check("blocked command with a null blocked_reason is rejected", checkSemanticInvariants([bad]).some((e) => e.includes("blocked_reason is null/empty")));
}
{
  const bad = baseCommand({ blocker_closure_criterion: null });
  check("blocked command with a null blocker_closure_criterion is rejected", checkSemanticInvariants([bad]).some((e) => e.includes("blocker_closure_criterion is null/empty")));
}

// ---------------------------------------------------------------------------
// 7. A software-ready command without a confirmed payload contract --
// THE central prohibition of this round.
// ---------------------------------------------------------------------------
{
  const bad = baseSoftwareReadyCommand({ payload_value_contract: null });
  check("software-ready command with a null payload_value_contract is rejected (PAYLOAD_VALUE_CONTRACT_NOT_ESTABLISHED)",
    checkSemanticInvariants([bad]).some((e) => e.includes("PAYLOAD_VALUE_CONTRACT_NOT_ESTABLISHED")));
}
{
  const bad = baseSoftwareReadyCommand({ blocked_reason: "SOMETHING" });
  check("software-ready command that also carries a blocked_reason is rejected", checkSemanticInvariants([bad]).some((e) => e.includes("must not also carry blocker fields")));
}

// ---------------------------------------------------------------------------
// 8. Command address collision.
// ---------------------------------------------------------------------------
{
  const a = baseCommand({ key: "action_a", address: "0x1600" });
  const b = baseCommand({ key: "action_b", address: "0x1600" });
  check("two commands sharing the same address are rejected", checkSemanticInvariants([a, b]).some((e) => e.includes("address collision")));
}
{
  const a = baseCommand({ key: "dup_key", address: "0x1600" });
  const b = baseCommand({ key: "dup_key", address: "0x1604" });
  check("two commands sharing the same key are rejected", checkSemanticInvariants([a, b]).some((e) => e.includes("duplicate key")));
}

// ---------------------------------------------------------------------------
// 9. Structural: declared_access must be "w" (never r/rw -- that belongs
// in registers.canonical.json instead), and an unknown implementation_state
// is rejected.
// ---------------------------------------------------------------------------
{
  const bad = baseCommand({ declared_access: "rw" });
  check("declared_access other than 'w' is rejected (structural)", structuralErrorsFor([bad]).length > 0);
}
{
  const bad = baseCommand({ implementation_state: "implemented" });
  check("an unrecognized implementation_state is rejected (structural)", structuralErrorsFor([bad]).length > 0);
}

// ---------------------------------------------------------------------------
// 10. Missing evidence.
// ---------------------------------------------------------------------------
{
  const bad = baseCommand({ evidence: [] });
  check("a command with zero evidence citations is rejected", checkSemanticInvariants([bad]).some((e) => e.includes("evidence citation is required")));
}

console.log(`\nStage 5 service-action negative fixtures summary: ${checks - failures}/${checks} passed`);
process.exit(failures ? 1 : 0);
