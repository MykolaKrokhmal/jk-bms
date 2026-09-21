#!/usr/bin/env node
"use strict";

// Structural tests for the generalized read-only projection architecture
// (2026-09-20, user-directed continuation pass). Exercises
// tools/protocol/lib/semantic-checks.js's real PROJECTION_*/OVERLAPPING_
// MASKS logic directly, via synthetic fixtures -- these are STRUCTURAL
// tests (constructed inputs against the real checker function), not
// integration tests against the committed catalog; see
// test_projection_decoder.js for the executable, real-data-projection
// coverage (0x12D0/0x12A0 actually decoding from one payload).

const path = require("path");
const ROOT = path.join(__dirname, "..", "..");
const semanticChecks = require(path.join(ROOT, "tools", "protocol", "lib", "semantic-checks.js"));

let checks = 0;
let failures = 0;
function check(name, condition, detail = "") {
  checks += 1;
  if (condition) console.log(`PASS  [structural]  ${name}${detail ? ` -- ${detail}` : ""}`);
  else {
    failures += 1;
    console.log(`FAIL  [structural]  ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

function baseField(overrides) {
  return Object.assign({
    key: "x", parent_register_id: "reg_test", field_width_bits: 16, byte_offset: 0,
    mask: "0xFFFF", shift: 0, signedness: "unsigned", wire_type: "U16", scale: 1, offset: 0,
    canonical_unit: "", uk_display_unit: "", en_display_unit: "", decimal_precision: 0,
    minimum: 0, maximum: 65535, step: 1, reserved_values: [], nullable: true,
    packed_siblings: [], overlap_rule: null, projection_of: null,
    access: "r", effective_access: "r", write_safety_class: "n/a", write_uses_read_modify_write: false,
    esphome_domain: "sensor", esphome_read_entity_id: "x", esphome_configured_name: null,
    esphome_write_entity_id: null, backend_key: null, frontend_label_uk: "t", frontend_label_en: "t",
    ui_section: "diagnostics", ui_order: 1, ui_group: null, editor_kind: "readonly",
    dynamic_dependency: null, enum_map: null, evidence: [], verification_status: "confirmed",
    exclusion_reason: null, implementation_status: "implemented", unknown_code_policy: null,
  }, overrides);
}

function baseRegister(fields, overrides) {
  return Object.assign({
    register_id: "reg_test", protocol_family: "JK_PB_MODBUS_RTU",
    model_scope: ["JK-PB2A16S15P (deployed unit)"], address: "0x9999", address_space: "holding_register",
    register_width_bits: 16, word_count: 1, byte_order: "big_endian", word_order: "single_word",
    read_function: "read_holding_registers_fc03", write_function: null, declared_access: "r",
    poll_group: "telemetry_15s", freshness_budget_s: 30, atomicity_group: "reg_test",
    safety_notes: "synthetic fixture", payload_bytes: 2, evidence: [], verification_status: "confirmed",
    fields,
  }, overrides);
}

function errorsFor(fields) {
  const registerDoc = { registers: [baseRegister(fields)] };
  return semanticChecks.check(registerDoc, { entities: [] }, ROOT);
}

// ===========================================================================
// 1. Valid raw + projection -- no errors of any kind.
// ===========================================================================
{
  const raw = baseField({ key: "raw_word", esphome_read_entity_id: "raw_word" });
  const proj = baseField({
    key: "proj_bit", field_width_bits: 1, mask: "0x0001", shift: 0, wire_type: "BIT",
    maximum: 1, projection_of: "raw_word", esphome_domain: "binary_sensor", esphome_read_entity_id: "proj_bit",
  });
  const errors = errorsFor([raw, proj]);
  // Filtered to the projection-relevant codes only -- this minimal fixture
  // deliberately doesn't satisfy every OTHER unrelated catalog invariant
  // (evidence completeness, version_context, etc., which are out of this
  // test's scope); what matters here is that the projection RELATIONSHIP
  // itself produces no OVERLAPPING_MASKS/PROJECTION_* complaint.
  const relevant = errors.filter((e) => e.code === "OVERLAPPING_MASKS" || e.code.startsWith("PROJECTION_"));
  check("valid raw + projection produces zero projection/overlap-related errors", relevant.length === 0, JSON.stringify(relevant));
}

// ===========================================================================
// 2. Invalid arbitrary overlap -- two physical fields (neither projects
// from the other) with overlapping masks must still fail.
// ===========================================================================
{
  const a = baseField({ key: "field_a", mask: "0x00FF", esphome_read_entity_id: "field_a" });
  const b = baseField({ key: "field_b", mask: "0x000F", esphome_read_entity_id: "field_b" });
  const errors = errorsFor([a, b]);
  check("two physical fields with overlapping masks, neither a declared projection of the other, still fails OVERLAPPING_MASKS",
    errors.some((e) => e.code === "OVERLAPPING_MASKS"), JSON.stringify(errors));
}

// ===========================================================================
// 3. Invalid: projection without a real parent.
// ===========================================================================
{
  const proj = baseField({
    key: "orphan_proj", field_width_bits: 1, mask: "0x0001", shift: 0, wire_type: "BIT",
    maximum: 1, projection_of: "does_not_exist", esphome_domain: "binary_sensor", esphome_read_entity_id: "orphan_proj",
  });
  const errors = errorsFor([proj]);
  check("a projection whose projection_of names a nonexistent field fails PROJECTION_PARENT_NOT_FOUND",
    errors.some((e) => e.code === "PROJECTION_PARENT_NOT_FOUND"), JSON.stringify(errors));
}

// ===========================================================================
// 4. Invalid: projection of a projection (chain).
// ===========================================================================
{
  const raw = baseField({ key: "raw_word", esphome_read_entity_id: "raw_word" });
  const proj1 = baseField({
    key: "proj_1", field_width_bits: 1, mask: "0x0001", shift: 0, wire_type: "BIT",
    maximum: 1, projection_of: "raw_word", esphome_domain: "binary_sensor", esphome_read_entity_id: "proj_1",
  });
  const proj2 = baseField({
    key: "proj_2", field_width_bits: 1, mask: "0x0001", shift: 0, wire_type: "BIT",
    maximum: 1, projection_of: "proj_1", esphome_domain: "binary_sensor", esphome_read_entity_id: "proj_2",
  });
  const errors = errorsFor([raw, proj1, proj2]);
  check("a projection-of-a-projection (chain) fails PROJECTION_OF_PROJECTION",
    errors.some((e) => e.code === "PROJECTION_OF_PROJECTION"), JSON.stringify(errors));
}

// ===========================================================================
// 5. Invalid: projection mask not a subset of its parent's mask.
// ===========================================================================
{
  const raw = baseField({ key: "raw_low_byte", mask: "0x00FF", esphome_read_entity_id: "raw_low_byte" });
  const proj = baseField({
    key: "proj_out_of_range", field_width_bits: 1, mask: "0x0100", shift: 8, wire_type: "BIT",
    maximum: 1, projection_of: "raw_low_byte", esphome_domain: "binary_sensor", esphome_read_entity_id: "proj_out_of_range",
  });
  const errors = errorsFor([raw, proj]);
  check("a projection whose mask extends beyond its declared parent's own mask fails PROJECTION_MASK_NOT_SUBSET_OF_PARENT",
    errors.some((e) => e.code === "PROJECTION_MASK_NOT_SUBSET_OF_PARENT"), JSON.stringify(errors));
}

// ===========================================================================
// 6. Out-of-range mask/shift (pre-existing FIELD_RANGE_EXCEEDS_REGISTER
// check, still fires for a projection exactly as it would for a physical
// field -- the projection architecture does not weaken this).
// ===========================================================================
{
  const raw = baseField({ key: "raw_word", esphome_read_entity_id: "raw_word" });
  const proj = baseField({
    key: "proj_bad_shift", field_width_bits: 1, mask: "0x0001", shift: 20, wire_type: "BIT",
    maximum: 1, projection_of: "raw_word", esphome_domain: "binary_sensor", esphome_read_entity_id: "proj_bad_shift",
  });
  const errors = errorsFor([raw, proj]);
  check("a projection with shift+width exceeding the 16-bit register still fails FIELD_RANGE_EXCEEDS_REGISTER",
    errors.some((e) => e.code === "FIELD_RANGE_EXCEEDS_REGISTER"), JSON.stringify(errors));
}

// ===========================================================================
// 7. Duplicate projection identity -- two projections with the same key
// (pre-existing DUPLICATE_FIELD_KEY-style check should still catch this;
// verify by checking for ANY duplicate-key-shaped error, not a specific
// projection-only code, since duplicate keys are a general catalog
// invariant, not a projection-specific one).
// ===========================================================================
{
  const raw = baseField({ key: "raw_word", esphome_read_entity_id: "raw_word" });
  const proj1 = baseField({
    key: "dup_proj", field_width_bits: 1, mask: "0x0001", shift: 0, wire_type: "BIT",
    maximum: 1, projection_of: "raw_word", esphome_domain: "binary_sensor", esphome_read_entity_id: "dup_proj",
  });
  const proj2 = baseField({
    key: "dup_proj", field_width_bits: 1, mask: "0x0002", shift: 1, wire_type: "BIT",
    maximum: 1, projection_of: "raw_word", esphome_domain: "binary_sensor", esphome_read_entity_id: "dup_proj_2",
  });
  const errors = errorsFor([raw, proj1, proj2]);
  check("two projections declaring the same key fail with a duplicate-key error",
    errors.some((e) => /DUPLICATE/i.test(e.code)), JSON.stringify(errors));
}

// ===========================================================================
// 8. A projection can never enable write -- effective_access forced to
// something other than "r" fails, independent of what its own evidence
// would otherwise allow.
// ===========================================================================
{
  const raw = baseField({ key: "raw_word", esphome_read_entity_id: "raw_word" });
  const proj = baseField({
    key: "proj_writeish", field_width_bits: 1, mask: "0x0001", shift: 0, wire_type: "BIT",
    maximum: 1, projection_of: "raw_word", esphome_domain: "binary_sensor", esphome_read_entity_id: "proj_writeish",
    access: "rw", effective_access: "rw", verification_status: "confirmed",
  });
  const errors = errorsFor([raw, proj]);
  check("a projection with effective_access!=='r' fails PROJECTION_EFFECTIVE_ACCESS_NOT_R (write capability is never inherited or independently granted)",
    errors.some((e) => e.code === "PROJECTION_EFFECTIVE_ACCESS_NOT_R"), JSON.stringify(errors));
}
{
  const raw = baseField({ key: "raw_word", esphome_read_entity_id: "raw_word" });
  const proj = baseField({
    key: "proj_write_entity", field_width_bits: 1, mask: "0x0001", shift: 0, wire_type: "BIT",
    maximum: 1, projection_of: "raw_word", esphome_domain: "binary_sensor", esphome_read_entity_id: "proj_write_entity",
    esphome_write_entity_id: "set_proj_write_entity",
  });
  const errors = errorsFor([raw, proj]);
  check("a projection declaring an esphome_write_entity_id fails PROJECTION_WRITE_ENTITY_PRESENT",
    errors.some((e) => e.code === "PROJECTION_WRITE_ENTITY_PRESENT"), JSON.stringify(errors));
}

// ===========================================================================
// 9. Sibling projections of the SAME parent must not overlap EACH OTHER
// (only overlap with the declared parent itself is allowed).
// ===========================================================================
{
  const raw = baseField({ key: "raw_word", esphome_read_entity_id: "raw_word" });
  const proj1 = baseField({
    key: "sib_proj_1", field_width_bits: 1, mask: "0x0001", shift: 0, wire_type: "BIT",
    maximum: 1, projection_of: "raw_word", esphome_domain: "binary_sensor", esphome_read_entity_id: "sib_proj_1",
  });
  const proj2 = baseField({
    key: "sib_proj_2", field_width_bits: 1, mask: "0x0001", shift: 0, wire_type: "BIT",
    maximum: 1, projection_of: "raw_word", esphome_domain: "binary_sensor", esphome_read_entity_id: "sib_proj_2",
  });
  const errors = errorsFor([raw, proj1, proj2]);
  check("two sibling projections of the SAME parent, overlapping each other, still fail OVERLAPPING_MASKS (only parent<->projection overlap is exempt)",
    errors.some((e) => e.code === "OVERLAPPING_MASKS"), JSON.stringify(errors));
}

// ===========================================================================
// 10. A projection overlapping a field it does NOT declare as its parent
// (even if that field happens to be physical) still fails.
// ===========================================================================
{
  const rawA = baseField({ key: "raw_a", mask: "0x00FF", esphome_read_entity_id: "raw_a" });
  const rawB = baseField({ key: "raw_b", mask: "0xFF00", shift: 8, esphome_read_entity_id: "raw_b" });
  const proj = baseField({
    key: "wrong_parent_proj", field_width_bits: 1, mask: "0x0100", shift: 8, wire_type: "BIT",
    maximum: 1, projection_of: "raw_a", esphome_domain: "binary_sensor", esphome_read_entity_id: "wrong_parent_proj",
  });
  const errors = errorsFor([rawA, rawB, proj]);
  check("a projection overlapping a field OTHER than its declared projection_of parent still fails OVERLAPPING_MASKS",
    errors.some((e) => e.code === "OVERLAPPING_MASKS"), JSON.stringify(errors));
}

console.log(`\n${checks} checks run, ${failures} failed.`);
process.exit(failures ? 1 : 0);
