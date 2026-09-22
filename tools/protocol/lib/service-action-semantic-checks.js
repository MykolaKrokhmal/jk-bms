"use strict";

/*
 * Semantic invariants for protocol/service_actions.canonical.json (Stage 5)
 * -- cross-field rules the structural mini-schema
 * (protocol/schema/service-actions-source.schema.json) cannot express.
 * Shared by tools/protocol/authoring/build_stage5_service_actions.js (which
 * refuses to generate anything if this reports any error) and
 * test/protocol_catalog/test_stage5_service_actions_negative_fixtures.js
 * (which proves each rule actually fires on a deliberately broken fixture).
 *
 * Returns an array of human-readable error strings (empty = valid).
 */
function checkSemanticInvariants(commands) {
  const errors = [];
  const seenKeys = new Set();
  const seenAddresses = new Map();

  for (const c of commands) {
    const tag = `${c.key} (${c.address})`;

    if (seenKeys.has(c.key)) errors.push(`duplicate key "${c.key}"`);
    seenKeys.add(c.key);

    if (seenAddresses.has(c.address)) {
      errors.push(`address collision: ${c.address} used by both "${seenAddresses.get(c.address)}" and "${c.key}"`);
    }
    seenAddresses.set(c.address, c.key);

    if (c.read_function !== null) errors.push(`${tag}: read_function must be null for a write-only service command`);
    if (c.poll_group !== null) errors.push(`${tag}: poll_group must be null -- a service action is never read-polled`);
    if (c.freshness_budget_s !== null) errors.push(`${tag}: freshness_budget_s must be null -- meaningless for a field that is never read back`);
    if (c.readback_rule !== "ack_only_no_readback") errors.push(`${tag}: readback_rule must be exactly "ack_only_no_readback" (a service action is never forced-readback-confirmed)`);

    if (c.implementation_state === "service-action-software-ready") {
      if (!c.write_function) errors.push(`${tag}: software-ready but write_function is null -- an executable command must have a real write function`);
      if (c.word_count === null || c.payload_bytes === null) {
        errors.push(`${tag}: software-ready but word_count/payload_bytes is null -- an executable command must have an exact, unambiguous wire width`);
      } else if (c.payload_bytes !== c.word_count * 2) {
        errors.push(`${tag}: payload_bytes (${c.payload_bytes}) != word_count*2 (${c.word_count * 2})`);
      }
      if (!c.payload_value_contract) {
        errors.push(`${tag}: software-ready but payload_value_contract is null/empty -- PAYLOAD_VALUE_CONTRACT_NOT_ESTABLISHED forbids marking this executable (confirmed length/type never implies a confirmed payload VALUE)`);
      }
      if (c.blocked_reason !== null || c.blocker_closure_criterion !== null) {
        errors.push(`${tag}: software-ready but blocked_reason/blocker_closure_criterion is non-null -- a software-ready row must not also carry blocker fields`);
      }
    }

    if (c.implementation_state === "blocked") {
      if (c.payload_value_contract !== null) {
        errors.push(`${tag}: blocked but payload_value_contract is non-null -- a blocked command must never claim a resolved payload contract`);
      }
      if (!c.blocked_reason) errors.push(`${tag}: blocked but blocked_reason is null/empty`);
      if (!c.blocker_closure_criterion) errors.push(`${tag}: blocked but blocker_closure_criterion is null/empty`);
      if (c.word_count !== null && c.payload_bytes !== null && c.payload_bytes !== c.word_count * 2) {
        errors.push(`${tag}: payload_bytes (${c.payload_bytes}) != word_count*2 (${c.word_count * 2}) even while blocked -- a declared-but-wrong width is still a real authoring error`);
      }
    }

    if (c.evidence.length === 0) errors.push(`${tag}: at least one evidence citation is required`);
  }

  return errors;
}

module.exports = { checkSemanticInvariants };
