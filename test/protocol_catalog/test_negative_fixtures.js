#!/usr/bin/env node
/*
 * Negative-fixture tests for the protocol catalog validator (Stage 1, spec
 * section 10). Proves the schema + semantic checkers actually FAIL, with
 * the expected reason, for every failure class listed below — a validator
 * that only ever runs against the (valid) real canonical source never
 * proves its failure paths work.
 *
 * Each case starts from BASE_VALID (a minimal one-register, one-field
 * canonical source that passes both mini-schema and semantic-checks
 * cleanly — asserted below before any mutation is applied) and applies
 * exactly one deliberate mutation.
 *
 * Run:
 *   node test/protocol_catalog/test_negative_fixtures.js
 *   node test/protocol_catalog/test_negative_fixtures.js --write-fixtures
 *     (also (re)writes the mutated documents to protocol/fixtures/negative/*.json)
 */
"use strict";

const fs = require("fs");
const path = require("path");
const mini = require("../../tools/protocol/lib/mini-schema.js");
const semantic = require("../../tools/protocol/lib/semantic-checks.js");

const ROOT = path.join(__dirname, "..", "..");
const registerSchema = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "schema", "register-source.schema.json"), "utf8"));
const nonRegisterSchema = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "schema", "non-register-source.schema.json"), "utf8"));
const WRITE_FIXTURES = process.argv.includes("--write-fixtures");
const FIXTURES_DIR = path.join(ROOT, "protocol", "fixtures", "negative");

// Real fingerprints, read live from sources.json rather than hardcoded —
// this is exactly the "BASE_VALID fixture falls out of sync with the
// schema/manifest" drift class that has recurred every time sources.json's
// project_implementation.fingerprint gets legitimately re-stamped after a
// real batterylifepo4.yaml/jk_bms.js edit (semantic-checks.js's
// CITATION_SOURCE_FINGERPRINT_MISMATCH check has no other way to know a
// citation is stale). Reading it live means this fixture can never itself
// be the thing that's out of date.
const SOURCES_MANIFEST = require("../../protocol/evidence/sources.json");
function fingerprintFor(sourceId) {
  const source = SOURCES_MANIFEST.sources.find((s) => s.source_id === sourceId);
  if (!source) throw new Error(`test fixture: no such source_id "${sourceId}" in sources.json`);
  return source.fingerprint;
}

function baseField(overrides = {}) {
  const implementationEvidence = {
    source_id: "project_implementation", locator_id: "fixture:implementation", locator: "batterylifepo4.yaml (test fixture)",
    claim_types: ["address"], source_fingerprint: fingerprintFor("project_implementation"),
    confidence: "medium", applicability: "synthetic test fixture", derivation_group: "syssi_implementation_family",
  };
  const hardwareEvidence = {
    source_id: "hardware_audit_2026_09_09", locator_id: "fixture:hardware", locator: "HARDWARE_AUDIT_2026-09-09.md (test fixture)",
    claim_types: ["observed_decoded_value"], source_fingerprint: fingerprintFor("hardware_audit_2026_09_09"),
    confidence: "low", applicability: "synthetic test fixture", derivation_group: "deployed_project_decode_family",
  };
  return Object.assign({
    key: "example_field", parent_register_id: "reg_0x1000_example", field_width_bits: 32,
    byte_offset: 0, mask: null, shift: 0, signedness: "unsigned", wire_type: "U32",
    scale: 0.001, offset: 0, canonical_unit: "V", uk_display_unit: "В", en_display_unit: "V",
    decimal_precision: 3, minimum: 0, maximum: 6, step: 0.001, reserved_values: [], nullable: true,
    packed_siblings: [], overlap_rule: null, projection_of: null, access: "rw", effective_access: "r",
    write_safety_class: "normal", write_uses_read_modify_write: false, esphome_domain: "number", esphome_read_entity_id: "example_field",
    esphome_configured_name: null, esphome_write_entity_id: null, backend_key: "example_field",
    frontend_label_uk: "Приклад", frontend_label_en: "Example", ui_section: "settings", ui_order: 10,
    ui_group: null,
    editor_kind: "readonly", dynamic_dependency: null, enum_map: null, unknown_code_policy: null,
    evidence: [implementationEvidence, hardwareEvidence],
    verification_status: "corroborated_with_limitations", exclusion_reason: "TEST_WRITE_BLOCKED", implementation_status: "implemented",
  }, overrides);
}

function baseRegister(overrides = {}, fieldOverrides = {}) {
  return Object.assign({
    register_id: "reg_0x1000_example", protocol_family: "JK_PB_MODBUS_RTU",
    model_scope: ["test"],
    address: "0x1000", address_space: "holding_register", register_width_bits: 32, word_count: 2, payload_bytes: 4,
    byte_order: "big_endian", word_order: "high_word_first", read_function: "read_holding_registers_fc03",
    write_function: "write_multiple_registers_fc16", declared_access: "rw", poll_group: "config_slow_300s",
    freshness_budget_s: 320, atomicity_group: "reg_0x1000_example",
    fields: [baseField(fieldOverrides)],
    evidence: baseField().evidence,
    verification_status: "corroborated_with_limitations", safety_notes: "test fixture",
  }, overrides);
}

function baseVersionContext() {
  return JSON.parse(JSON.stringify(require("../../protocol/registers.canonical.json").version_context));
}

function baseDoc(registers) {
  return {
    catalog_version: "1.1.0", protocol_family: "JK_PB_MODBUS_RTU",
    version_context: baseVersionContext(), ui_order_gap_policy: "sparse_allowed_stable_manual_slots", registers,
  };
}

const EMPTY_NON_REGISTER_DOC = { catalog_version: "1.0.0", entities: [{
  key: "example_non_register", category: "calculated_esphome", esphome_domain: "sensor",
  esphome_entity_id: "example", unit: "", uk_display_unit: "", en_display_unit: "",
  frontend_label_uk: "Приклад", frontend_label_en: "Example", note: "test fixture",
}] };

const BASE_VALID = baseDoc([baseRegister()]);

function runAll(registerDoc, nonRegisterDoc = EMPTY_NON_REGISTER_DOC, repoRoot = ROOT) {
  const schemaErrors = mini.validate(registerSchema, registerDoc);
  const nrSchemaErrors = mini.validate(nonRegisterSchema, nonRegisterDoc);
  let semanticErrors = [];
  if (schemaErrors.length === 0 && nrSchemaErrors.length === 0) {
    semanticErrors = semantic.check(registerDoc, nonRegisterDoc, repoRoot);
  }
  return { schemaErrors, nrSchemaErrors, semanticErrors };
}

let checks = 0;
let failures = 0;
function check(name, cond, detail) {
  checks += 1;
  if (!cond) { failures += 1; console.log(`FAIL  ${name}${detail ? "  -- " + detail : ""}`); }
  else console.log(`PASS  ${name}${detail ? "  -- " + detail : ""}`);
}

// --- 0. Sanity: BASE_VALID itself must be clean before any mutation. ---
{
  const { schemaErrors, nrSchemaErrors, semanticErrors } = runAll(BASE_VALID);
  check("BASE_VALID fixture is schema+semantically clean before mutation",
    schemaErrors.length === 0 && nrSchemaErrors.length === 0 && semanticErrors.length === 0,
    JSON.stringify([...schemaErrors, ...nrSchemaErrors, ...semanticErrors].slice(0, 2)));
}

const cases = [];
function negativeCase(name, expectedCode, mutate, repoRoot) {
  cases.push({ name, expectedCode, mutate, repoRoot });
}

negativeCase("empty_registers_array", "SCHEMA:minItems", (doc) => { doc.registers = []; });
negativeCase("empty_fields_array", "SCHEMA:minItems", (doc) => { doc.registers[0].fields = []; });
negativeCase("unknown_property", "SCHEMA:additionalProperties", (doc) => { doc.registers[0].bogus_extra_property = true; });

negativeCase("duplicate_register_id", "DUPLICATE_REGISTER_ID", (doc) => {
  doc.registers.push(baseRegister({ address: "0x1002" }));
});
negativeCase("duplicate_field_key", "DUPLICATE_FIELD_KEY", (doc) => {
  doc.registers.push(baseRegister({ register_id: "reg_0x1002_other", address: "0x1002", atomicity_group: "reg_0x1002_other" },
    { parent_register_id: "reg_0x1002_other" }));
});
negativeCase("duplicate_address_unrelated_registers", "DUPLICATE_ADDRESS", (doc) => {
  doc.registers.push(baseRegister({ register_id: "reg_0x1000_second" },
    { key: "other_field", parent_register_id: "reg_0x1000_second", backend_key: "other_field", esphome_read_entity_id: "other_field", esphome_write_entity_id: "other_field" }));
});
negativeCase("field_unknown_parent_register", "FIELD_UNKNOWN_PARENT", (doc) => {
  doc.registers[0].fields[0].parent_register_id = "reg_does_not_exist";
});
negativeCase("field_mask_mismatch", "FIELD_MASK_MISMATCH", (doc) => {
  doc.registers[0].fields[0].mask = "0x00FF"; // field_width_bits=32 implies full-word mask, not 0x00FF
});
negativeCase("field_shift_mismatch", "FIELD_SHIFT_MISMATCH", (doc) => {
  const reg = baseRegister({ register_width_bits: 16, word_count: 1, word_order: "single_word" }, {
    field_width_bits: 8, byte_offset: 0, mask: "0xFF00", shift: 0, // byte_offset=0 in a 16-bit reg implies shift=8, not 0
  });
  doc.registers = [reg];
});
negativeCase("overlapping_masks", "OVERLAPPING_MASKS", (doc) => {
  const reg = baseRegister({ register_width_bits: 16, word_count: 1, word_order: "single_word" }, {
    key: "field_a", field_width_bits: 8, byte_offset: 0, mask: "0xFF00", shift: 8,
    esphome_read_entity_id: "field_a", esphome_write_entity_id: "field_a", backend_key: "field_a",
    packed_siblings: ["field_b"],
  });
  const fieldB = baseField({
    key: "field_b", parent_register_id: reg.register_id, field_width_bits: 8, byte_offset: 0,
    mask: "0xFF00", shift: 8, // deliberately overlaps field_a's mask instead of using the low byte
    esphome_read_entity_id: "field_b", esphome_write_entity_id: "field_b", backend_key: "field_b",
    packed_siblings: ["field_a"],
  });
  reg.fields.push(fieldB);
  doc.registers = [reg];
});
negativeCase("asymmetric_packed_sibling", "ASYMMETRIC_PACKED_SIBLING", (doc) => {
  const reg = baseRegister({ register_width_bits: 16, word_count: 1, word_order: "single_word" }, {
    key: "field_a", field_width_bits: 8, byte_offset: 0, mask: "0xFF00", shift: 8,
    esphome_read_entity_id: "field_a", esphome_write_entity_id: "field_a", backend_key: "field_a",
    packed_siblings: ["field_b"],
  });
  const fieldB = baseField({
    key: "field_b", parent_register_id: reg.register_id, field_width_bits: 8, byte_offset: 1,
    mask: "0x00FF", shift: 0, esphome_read_entity_id: "field_b", esphome_write_entity_id: "field_b",
    backend_key: "field_b", packed_siblings: [], // does NOT list field_a back
  });
  reg.fields.push(fieldB);
  doc.registers = [reg];
});
negativeCase("signedness_wire_type_mismatch", "SIGNEDNESS_WIRE_TYPE_MISMATCH", (doc) => {
  doc.registers[0].fields[0].signedness = "signed";
  doc.registers[0].fields[0].wire_type = "U32"; // signed=true but an unsigned wire type
});
negativeCase("invalid_bounds_min_gt_max", "INVALID_BOUNDS", (doc) => {
  doc.registers[0].fields[0].minimum = 10;
  doc.registers[0].fields[0].maximum = 1;
});
negativeCase("unverified_field_write_enabled", "UNVERIFIED_FIELD_WRITE_ENABLED", (doc) => {
  doc.registers[0].fields[0].verification_status = "implementation_only_unverified";
  doc.registers[0].fields[0].effective_access = "rw"; // the Etap-1 hard rule this must violate
});
negativeCase("effective_access_exceeds_declared", "EFFECTIVE_ACCESS_EXCEEDS_DECLARED", (doc) => {
  doc.registers[0].fields[0].access = "r";
  doc.registers[0].fields[0].effective_access = "rw";
});
negativeCase("unresolved_dynamic_dependency_write_enabled", "UNRESOLVED_DYNAMIC_DEPENDENCY_WRITE_ENABLED", (doc) => {
  doc.registers[0].fields[0].dynamic_dependency = { depends_on_field: "example_field", rule: "test", resolved: false };
  doc.registers[0].fields[0].effective_access = "rw";
});
negativeCase("packed_sibling_not_found", "PACKED_SIBLING_NOT_FOUND", (doc) => {
  doc.registers[0].fields[0].packed_siblings = ["field_that_does_not_exist"];
});
// EVIDENCE_LOCATOR_FILE_MISSING can only fire for a KNOWN repo filename
// (see tools/protocol/lib/semantic-checks.js's KNOWN_REPO_FILES allowlist)
// that is genuinely absent — every real one of those files genuinely
// exists in this repo. So this one case runs against a fake, empty
// repoRoot instead of the real one, making even "batterylifepo4.yaml"
// (a real, allowlisted, always-true-in-this-repo filename) resolve as
// missing — proving the check itself fires correctly, without needing a
// permanently-broken fixture file to make the point.
const FAKE_EMPTY_ROOT = fs.mkdtempSync(path.join(require("os").tmpdir(), "jk-bms-negative-fixture-"));
negativeCase("evidence_locator_file_missing", "EVIDENCE_LOCATOR_FILE_MISSING", (doc) => {
  doc.registers[0].evidence[0].locator = "batterylifepo4.yaml (checked against an intentionally empty fake repo root)";
}, FAKE_EMPTY_ROOT);

// --- Stage 1 Remediation additions (Крок J, numbered per CLAUDE_STAGE_1_REMEDIATION_PROMPT_UA.md §"Крок J") ---

negativeCase("wrong_word_count", "REGISTER_WORD_COUNT_MISMATCH", (doc) => {
  // #1: the EXACT class of bug CODEX_STAGE_1_REVIEW.md P0-1 found (128-bit
  // register wrongly declaring word_count 2 instead of 8).
  doc.registers[0].register_width_bits = 128;
  doc.registers[0].word_count = 2;
  doc.registers[0].word_order = "sequential_bytes";
  doc.registers[0].fields[0].field_width_bits = 128;
  doc.registers[0].fields[0].mask = null;
});
negativeCase("passcode_128bit_wrong_word_count_2", "REGISTER_WORD_COUNT_MISMATCH", (doc) => {
  // Крок B.4: negative test for the exact wrong word counts named in the
  // remediation prompt for a 128-bit register (only 8 is correct).
  doc.registers[0].register_width_bits = 128;
  doc.registers[0].word_count = 2;
  doc.registers[0].word_order = "sequential_bytes";
  doc.registers[0].fields[0].field_width_bits = 128;
  doc.registers[0].fields[0].mask = null;
});
negativeCase("passcode_128bit_wrong_word_count_4", "REGISTER_WORD_COUNT_MISMATCH", (doc) => {
  // Крок B.4: negative test for the exact wrong word counts named in the
  // remediation prompt for a 128-bit register (only 8 is correct).
  doc.registers[0].register_width_bits = 128;
  doc.registers[0].word_count = 4;
  doc.registers[0].word_order = "sequential_bytes";
  doc.registers[0].fields[0].field_width_bits = 128;
  doc.registers[0].fields[0].mask = null;
});
negativeCase("passcode_128bit_wrong_word_count_7", "REGISTER_WORD_COUNT_MISMATCH", (doc) => {
  // Крок B.4: negative test for the exact wrong word counts named in the
  // remediation prompt for a 128-bit register (only 8 is correct).
  doc.registers[0].register_width_bits = 128;
  doc.registers[0].word_count = 7;
  doc.registers[0].word_order = "sequential_bytes";
  doc.registers[0].fields[0].field_width_bits = 128;
  doc.registers[0].fields[0].mask = null;
});

negativeCase("field_outside_register_bounds", "FIELD_MASK_EXCEEDS_REGISTER_WIDTH", (doc) => {
  // #4: a field mask that extends past its own register's width — a
  // 16-bit register (fullMask 0xFFFF) with a field mask reaching into
  // bits 16-31, which don't exist on this register at all.
  doc.registers[0].register_width_bits = 16;
  doc.registers[0].word_count = 1;
  doc.registers[0].word_order = "single_word";
  doc.registers[0].fields[0].field_width_bits = 16;
  doc.registers[0].fields[0].mask = "0xFFFF0000";
  doc.registers[0].fields[0].shift = 16;
});

negativeCase("uncovered_non_reserved_bits", "UNCOVERED_BITS_UNDOCUMENTED", (doc) => {
  // #6: a packed register whose fields don't cover every bit, with no
  // "reserved"/"unknown" mention in safety_notes documenting the gap.
  const reg = baseRegister({ register_width_bits: 16, word_count: 1, word_order: "single_word", safety_notes: "no mention of the gap" }, {
    field_width_bits: 8, byte_offset: 0, mask: "0xFF00", shift: 8, // only the high byte is modeled; low byte uncovered
  });
  doc.registers = [reg];
});

negativeCase("word_order_drift", "WORD_ORDER_MISMATCH", (doc) => {
  // #7: a 2-word register declaring the wrong word_order.
  doc.registers[0].word_order = "single_word";
});

negativeCase("scale_drift_zero", "SCALE_ZERO", (doc) => {
  // #8 (proxy): a zero scale can never round-trip a raw wire value — the
  // one scale defect that is unambiguously wrong regardless of any
  // external source (a genuine cross-source "drift" needs a second
  // document to compare against, which a synthetic fixture doesn't have).
  doc.registers[0].fields[0].scale = 0;
});

negativeCase("invalid_step", "INVALID_STEP", (doc) => {
  // #11
  doc.registers[0].fields[0].step = -1;
});

negativeCase("nonrepresentable_bounds", "BOUNDS_NOT_REPRESENTABLE", (doc) => {
  // #13: an 8-bit unsigned field whose declared maximum cannot possibly
  // fit in 8 bits after inverting scale/offset.
  doc.registers[0].fields[0].field_width_bits = 8;
  doc.registers[0].fields[0].mask = "0xFF000000"; // still inside the 32-bit register width
  doc.registers[0].fields[0].shift = 24;
  doc.registers[0].fields[0].scale = 1;
  doc.registers[0].fields[0].offset = 0;
  doc.registers[0].fields[0].maximum = 99999; // far beyond an 8-bit unsigned field's 0-255 range
});

negativeCase("duplicate_enum_value", "ENUM_DUPLICATE_VALUE", (doc) => {
  // #14
  doc.registers[0].fields[0].editor_kind = "enum_select";
  doc.registers[0].fields[0].enum_map = { "0": "Off", "1": "Off" };
});

negativeCase("reserved_enum_collision", "RESERVED_ENUM_COLLISION", (doc) => {
  // #15
  doc.registers[0].fields[0].editor_kind = "enum_select";
  doc.registers[0].fields[0].enum_map = { "0": "Off", "1": "On" };
  doc.registers[0].fields[0].reserved_values = ["1"];
});

negativeCase("missing_unknown_code_policy", "ENUM_EDITOR_WITHOUT_SEMANTICS", (doc) => {
  // #16: a toggle/enum_select editor with NO enum_map at all — no policy
  // for what an out-of-range/unknown raw code means.
  doc.registers[0].fields[0].editor_kind = "toggle";
  doc.registers[0].fields[0].enum_map = null;
});

negativeCase("blocked_field_leaked_into_write_map", "WRITE_ENTITY_ON_EFFECTIVE_READONLY", (doc) => {
  // #18: effective_access "r" but an ESPHome write entity is still named —
  // exactly the shape a leaked write-map entry for a blocked field would take.
  doc.registers[0].fields[0].effective_access = "r";
  doc.registers[0].fields[0].verification_status = "corroborated_with_limitations";
  doc.registers[0].fields[0].esphome_write_entity_id = "example_field";
});

negativeCase("entity_id_collision", "ESPHOME_READ_ENTITY_ID_COLLISION", (doc) => {
  // #21
  doc.registers.push(baseRegister({ register_id: "reg_0x1002_other", address: "0x1002", atomicity_group: "reg_0x1002_other" }, {
    key: "other_field", parent_register_id: "reg_0x1002_other", backend_key: "other_field",
    esphome_read_entity_id: "example_field", // collides with the base field's read entity id
    esphome_write_entity_id: "other_field",
  }));
});

negativeCase("false_workbook_evidence", "EVIDENCE_ADDRESS_NOT_IN_WORKBOOK_INDEX", (doc) => {
  // #23: the EXACT class of bug CODEX_STAGE_1_REVIEW.md P0-2 found —
  // an address falsely credited with workbook evidence. 0x9999 is not a
  // real JK-PB register and is verified absent from the real
  // protocol/evidence/workbook_index.json.
  doc.registers[0].address = "0x9999";
  doc.registers[0].register_id = "reg_0x9999_example";
  doc.registers[0].fields[0].parent_register_id = "reg_0x9999_example";
  doc.registers[0].fields[0].evidence.push({
    source_id: "workbook_lifepo4_bms_parameters_registers",
    locator_id: "fixture:false-workbook-address",
    locator: "BMS Parameters!A1:F1 (fabricated 0x9999)",
    claim_types: ["address"],
    source_fingerprint: "sha256:333d65a5bf33bf83f804cb4592ec446597e1b2d2691ffe3a61db93a7db1020d0",
    confidence: "unrated", applicability: "synthetic negative fixture",
    derivation_group: "workbook_unknown_provenance",
  });
});

negativeCase("false_workbook_v2_evidence", "EVIDENCE_ADDRESS_NOT_IN_WORKBOOK_V2_INDEX", (doc) => {
  // V2 counterpart of "false_workbook_evidence" above, proving
  // build_workbook_v2_index.py's index is actually consulted (not just a
  // non-empty locator string accepted as proof) for the verified V2
  // workbook source too. 0x9998 is not a real JK-PB register and is
  // verified absent from the real protocol/evidence/workbook_v2_index.json.
  doc.registers[0].address = "0x9998";
  doc.registers[0].register_id = "reg_0x9998_example";
  doc.registers[0].fields[0].parent_register_id = "reg_0x9998_example";
  doc.registers[0].fields[0].evidence.push({
    source_id: "workbook_lifepo4_bms_parameters_registers_v2",
    locator_id: "fixture:false-workbook-v2-address",
    locator: "Реєстр параметрів!A1:O1 (fabricated 0x9998)",
    claim_types: ["address"],
    source_fingerprint: fingerprintFor("workbook_lifepo4_bms_parameters_registers_v2"),
    confidence: "unrated", applicability: "synthetic negative fixture",
    derivation_group: "vendor_workbook_v2",
  });
});

// Completion-pass additions: the matrix now covers 55 distinct adversarial
// classes. Each case still starts from the same validated baseline and changes
// one condition only.
negativeCase("wrong_payload_byte_length", "REGISTER_PAYLOAD_BYTES_MISMATCH", (doc) => {
  doc.registers[0].payload_bytes = 2;
});
negativeCase("field_width_larger_than_register_without_mask", "FIELD_WIDTH_EXCEEDS_REGISTER", (doc) => {
  doc.registers[0].register_width_bits = 16; doc.registers[0].word_count = 1; doc.registers[0].payload_bytes = 2;
  doc.registers[0].word_order = "single_word"; doc.registers[0].fields[0].field_width_bits = 32;
});
negativeCase("field_byte_offset_outside_payload", "FIELD_BYTE_OFFSET_EXCEEDS_PAYLOAD", (doc) => {
  const f = doc.registers[0].fields[0]; f.field_width_bits = 8; f.byte_offset = 4; f.mask = "0x000000FF"; f.shift = 0;
});
negativeCase("step_not_raw_representable", "STEP_NOT_RAW_REPRESENTABLE", (doc) => {
  doc.registers[0].fields[0].step = 0.0015;
});
negativeCase("decimal_precision_mismatch", "DECIMAL_PRECISION_TOO_LOW", (doc) => {
  doc.registers[0].fields[0].decimal_precision = 2;
});
negativeCase("enum_key_out_of_raw_range", "ENUM_KEY_OUT_OF_RANGE", (doc) => {
  const f = doc.registers[0].fields[0]; f.field_width_bits = 8; f.mask = "0xFF000000"; f.shift = 24;
  f.enum_map = { "0": "Off", "256": "Impossible" }; f.unknown_code_policy = "preserve_raw_and_render_unknown";
});
negativeCase("enum_unknown_policy_missing", "ENUM_UNKNOWN_POLICY_MISSING", (doc) => {
  const f = doc.registers[0].fields[0]; f.enum_map = { "0": "Off", "1": "On" }; f.unknown_code_policy = null;
});
negativeCase("unknown_source_id", "UNKNOWN_SOURCE_ID", (doc) => {
  doc.registers[0].fields[0].evidence[0].source_id = "fabricated_source";
});
// Every real source_id in the live sources.json is "available" now that
// official_jk_documentation (the manufacturer's own V1.1 spec) has been
// supplied — there is no longer a real entry this case can point at in the
// actual repo. Same technique as FAKE_EMPTY_ROOT below: a sandboxed root
// with its own protocol/evidence/sources.json carrying one synthetic,
// clearly-fake, permanently-unavailable entry, so this failure path stays
// exercised without depending on some real source staying unavailable.
const UNAVAILABLE_SOURCE_ROOT = fs.mkdtempSync(path.join(require("os").tmpdir(), "jk-bms-negative-fixture-unavailable-"));
fs.mkdirSync(path.join(UNAVAILABLE_SOURCE_ROOT, "protocol", "evidence"), { recursive: true });
fs.writeFileSync(path.join(UNAVAILABLE_SOURCE_ROOT, "protocol", "evidence", "sources.json"), JSON.stringify({
  sources: [{
    source_id: "test_only_unavailable_source",
    type: "official_document",
    status: "unavailable",
    note: "Synthetic fixture-only entry (test_negative_fixtures.js) — never a real evidence source.",
    claims_supported: [],
    provenance_status: "unknown",
    derivation_group: "test_only",
    fingerprint: null,
  }],
}, null, 2));
negativeCase("unavailable_source_cited", "UNAVAILABLE_SOURCE_CITED", (doc) => {
  const e = doc.registers[0].fields[0].evidence[0]; e.source_id = "test_only_unavailable_source";
  e.source_fingerprint = null; e.derivation_group = "test_only"; e.claim_types = ["address"];
}, UNAVAILABLE_SOURCE_ROOT);
negativeCase("unsupported_claim_type", "SOURCE_UNSUPPORTED_CLAIM_TYPE", (doc) => {
  doc.registers[0].fields[0].evidence[1].claim_types = ["write_function"];
});
negativeCase("citation_fingerprint_mismatch", "CITATION_SOURCE_FINGERPRINT_MISMATCH", (doc) => {
  doc.registers[0].fields[0].evidence[0].source_fingerprint = "sha256:synthetic-mismatch";
});
negativeCase("citation_derivation_group_mismatch", "CITATION_DERIVATION_GROUP_MISMATCH", (doc) => {
  doc.registers[0].fields[0].evidence[0].derivation_group = "fabricated-independent-group";
});
negativeCase("forged_verification_status", "FORGED_VERIFICATION_STATUS", (doc) => {
  doc.registers[0].fields[0].verification_status = "confirmed";
});
negativeCase("forged_effective_rw_policy", "FORGED_EFFECTIVE_ACCESS", (doc) => {
  doc.registers[0].fields[0].effective_access = "rw";
});

// Stage 4 (typed-petting-puzzle plan §5 Phase 2) negative fixtures.
negativeCase("write_rmw_flag_mismatch_packed_without_flag", "WRITE_RMW_FLAG_MISMATCH", (doc) => {
  // A genuinely packed field (has a sibling) but claims write_uses_read_modify_write=false.
  const reg = baseRegister({ register_width_bits: 16, word_count: 1, word_order: "single_word" }, {
    key: "field_a", field_width_bits: 8, byte_offset: 0, mask: "0xFF00", shift: 8,
    esphome_read_entity_id: "field_a", esphome_write_entity_id: null, backend_key: "field_a",
    packed_siblings: ["field_b"], write_uses_read_modify_write: false, // WRONG: should be true
    effective_access: "r",
  });
  const fieldB = baseField({
    key: "field_b", parent_register_id: reg.register_id, field_width_bits: 8, byte_offset: 1,
    mask: "0x00FF", shift: 0, esphome_read_entity_id: "field_b", esphome_write_entity_id: null,
    backend_key: "field_b", packed_siblings: ["field_a"], write_uses_read_modify_write: false,
    effective_access: "r",
  });
  reg.fields.push(fieldB);
  doc.registers = [reg];
});
negativeCase("write_rmw_flag_mismatch_full_width_with_flag", "WRITE_RMW_FLAG_MISMATCH", (doc) => {
  // A full-width field (no siblings, full register width) but claims write_uses_read_modify_write=true.
  doc.registers[0].fields[0].write_uses_read_modify_write = true;
});
negativeCase("write_rmw_packed_full_mask", "WRITE_RMW_PACKED_FULL_MASK", (doc) => {
  // Marked RMW=true but its own mask covers the entire register -- contradiction
  // (a genuinely packed field cannot own every bit).
  doc.registers[0].fields[0].write_uses_read_modify_write = true;
  doc.registers[0].fields[0].packed_siblings = ["nonexistent_sibling_irrelevant_to_this_check"];
  doc.registers[0].fields[0].mask = "0xFFFFFFFF"; // full 32-bit register width
});
negativeCase("projection_declares_rmw", "PROJECTION_DECLARES_RMW", (doc) => {
  const reg = baseRegister({}, {
    key: "raw_word", field_width_bits: 32, mask: "0xFFFFFFFF", shift: 0,
    esphome_read_entity_id: "raw_word", esphome_write_entity_id: null, backend_key: "raw_word",
    write_uses_read_modify_write: false,
  });
  const proj = baseField({
    key: "proj_field", parent_register_id: reg.register_id, field_width_bits: 1, mask: "0x0001", shift: 0,
    projection_of: "raw_word", access: "r", effective_access: "r",
    esphome_read_entity_id: "proj_field", esphome_write_entity_id: null, backend_key: "proj_field",
    write_uses_read_modify_write: true, // WRONG: a projection never has its own write path
  });
  reg.fields.push(proj);
  doc.registers = [reg];
});
negativeCase("write_enabled_without_range_or_enum", "WRITE_ENABLED_WITHOUT_RANGE_OR_ENUM", (doc) => {
  doc.registers[0].fields[0].effective_access = "rw";
  doc.registers[0].fields[0].minimum = null;
  doc.registers[0].fields[0].maximum = null;
  doc.registers[0].fields[0].enum_map = null;
  doc.registers[0].fields[0].owner_write_override = {
    authorized: true, authorized_by: "fixture", date: "2026-01-01", rationale: "fixture",
  };
});
negativeCase("owner_override_on_unsupported_class", "OWNER_OVERRIDE_ON_UNSUPPORTED_CLASS", (doc) => {
  doc.registers[0].fields[0].write_safety_class = "unsupported";
  doc.registers[0].fields[0].owner_write_override = {
    authorized: true, authorized_by: "fixture", date: "2026-01-01", rationale: "fixture",
  };
});
negativeCase("project_version_locator_drift", "VERSION_CONTEXT_PROJECT_MISMATCH", (doc) => {
  doc.version_context.esphome_project_version = "0.0.0";
});
negativeCase("ui_version_locator_drift", "VERSION_CONTEXT_UI_MISMATCH", (doc) => {
  doc.version_context.web_ui_version = "synthetic-ui-drift";
});
negativeCase("external_component_pin_drift", "VERSION_CONTEXT_EXTERNAL_PIN_MISMATCH", (doc) => {
  doc.version_context.external_component_pin = "github://example.invalid/project@deadbeef";
});
negativeCase("esphome_toolchain_version_drift", "VERSION_CONTEXT_ESPHOME_MISMATCH", (doc) => {
  doc.version_context.esphome_framework_version_used_for_verification = "0.0.0";
});
negativeCase("bms_protocol_variant_overclaim", "BMS_PROTOCOL_VARIANT_OVERCLAIM", (doc) => {
  doc.version_context.bms_protocol_variant = "definitely-vendor-confirmed";
});
negativeCase("bms_firmware_version_overclaim", "BMS_FIRMWARE_VERSION_OVERCLAIM", (doc) => {
  doc.version_context.bms_firmware_version = "2026.09.08-v5";
});

function registerNonRegisterKeyCollision() {
  const doc = JSON.parse(JSON.stringify(BASE_VALID));
  const nrDoc = JSON.parse(JSON.stringify(EMPTY_NON_REGISTER_DOC));
  nrDoc.entities[0].key = "example_field"; // collides with the register field's key
  return { doc, nrDoc };
}

console.log(`Running ${cases.length + 1} negative-fixture cases (plus the BASE_VALID sanity check above)...\n`);

for (const { name, expectedCode, mutate, repoRoot } of cases) {
  const doc = JSON.parse(JSON.stringify(BASE_VALID));
  mutate(doc);

  if (WRITE_FIXTURES) {
    fs.mkdirSync(FIXTURES_DIR, { recursive: true });
    fs.writeFileSync(path.join(FIXTURES_DIR, `${name}.json`), JSON.stringify(doc, null, 2) + "\n", "utf8");
  }

  const { schemaErrors, nrSchemaErrors, semanticErrors } = runAll(doc, EMPTY_NON_REGISTER_DOC, repoRoot);
  const allErrors = [...schemaErrors, ...nrSchemaErrors, ...semanticErrors];

  if (expectedCode.startsWith("SCHEMA:")) {
    const keyword = expectedCode.split(":")[1];
    const found = schemaErrors.some((e) => e.message.includes(keyword)) || nrSchemaErrors.some((e) => e.message.includes(keyword));
    check(`${name}: schema validation fails mentioning "${keyword}"`, found,
      found ? "" : JSON.stringify(schemaErrors.concat(nrSchemaErrors).slice(0, 2)));
  } else {
    const found = semanticErrors.some((e) => e.code === expectedCode);
    check(`${name}: semantic check reports code ${expectedCode}`, found,
      found ? semanticErrors.find((e) => e.code === expectedCode).path : `got: ${semanticErrors.map((e) => e.code).join(",") || "(none — schema errors: " + JSON.stringify(schemaErrors) + ")"}`);
  }
  check(`${name}: at least one error total (validator is non-zero-exit-worthy)`, allErrors.length > 0);
}

// register/non-register key collision needs a paired mutation (both docs).
{
  const { doc, nrDoc } = registerNonRegisterKeyCollision();
  if (WRITE_FIXTURES) {
    fs.writeFileSync(path.join(FIXTURES_DIR, "register_nonregister_key_collision.json"),
      JSON.stringify({ registers: doc, non_register: nrDoc }, null, 2) + "\n", "utf8");
  }
  const { schemaErrors, nrSchemaErrors, semanticErrors } = runAll(doc, nrDoc);
  const found = semanticErrors.some((e) => e.code === "REGISTER_NONREGISTER_KEY_COLLISION");
  check("register_nonregister_key_collision: semantic check reports code REGISTER_NONREGISTER_KEY_COLLISION", found,
    found ? "" : `schema=${schemaErrors.length + nrSchemaErrors.length} semantic=${semanticErrors.map((e) => e.code).join(",")}`);
}

console.log(`\n${checks} checks run, ${failures} failed.`);
if (WRITE_FIXTURES) console.log(`Fixtures written to ${path.relative(ROOT, FIXTURES_DIR)}/`);
process.exit(failures ? 1 : 0);
