#!/usr/bin/env node
"use strict";

// Regression test documenting a real architectural finding from the Stage
// 3 completion pass (2026-09-20, user-directed): registers.canonical.json's
// OVERLAPPING_MASKS invariant (tools/protocol/lib/semantic-checks.js)
// unconditionally forbids two fields on the same register from covering
// overlapping bit ranges. This blocks individual bit/byte projections
// (Heating, BATTempSensor1-5Present, MOSTempSensorPresent at 0x12D0; the
// 23 individual alarm bits at 0x12A0) from coexisting with their
// registers' own established RAW whole-register entities
// (sensor_heating_mask, alarms_bitmask) -- confirmed by directly
// attempting to author the 0x12D0 fields this round and observing the
// real generator reject it with 7 OVERLAPPING_MASKS errors (not a
// hypothetical -- a real, reproduced failure). This is NOT an evidence
// gap (PDF p.8/p.11-12 directly document all of these bits) -- it is a
// genuine architectural gap: no mechanism exists yet to publish a
// read-only projection of an already-covered field's own sub-range
// without a second, overlapping canonical field. Documented here as a
// reproducible regression (proves the constraint is real, not asserted)
// and cross-checked against the two blockers' own updated text.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
function loadJson(p) { return JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8")); }

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

// ===========================================================================
// 1. Reproduce the real OVERLAPPING_MASKS rejection directly: construct a
// synthetic canonical doc with a whole-register RAW field plus one
// sub-bit field at the SAME address, run it through the real semantic
// checker (not a reimplementation), and confirm it is rejected with
// exactly this error code -- proves the constraint is real and load-
// bearing, not merely asserted in a blocker's prose.
// ===========================================================================
{
  const semanticChecks = require("../../tools/protocol/lib/semantic-checks.js");
  const registerDoc = {
    registers: [
      {
        register_id: "reg_test_overlap",
        protocol_family: "JK_PB_MODBUS_RTU",
        model_scope: ["JK-PB2A16S15P (deployed unit)"],
        address: "0x9999",
        address_space: "holding_register",
        register_width_bits: 16,
        word_count: 1,
        byte_order: "big_endian",
        word_order: "single_word",
        read_function: "read_holding_registers_fc03",
        write_function: null,
        declared_access: "r",
        poll_group: "telemetry_15s",
        freshness_budget_s: 30,
        atomicity_group: "reg_test_overlap",
        safety_notes: "synthetic test fixture, not real catalog data",
        payload_bytes: 2,
        evidence: [],
        verification_status: "confirmed",
        fields: [
          {
            key: "test_raw_mask", parent_register_id: "reg_test_overlap", field_width_bits: 16,
            byte_offset: 0, mask: "0xFFFF", shift: 0, signedness: "unsigned", wire_type: "U16",
            scale: 1, offset: 0, canonical_unit: "", uk_display_unit: "", en_display_unit: "",
            decimal_precision: 0, minimum: 0, maximum: 65535, step: 1, reserved_values: [],
            nullable: true, packed_siblings: [], overlap_rule: null, access: "r", effective_access: "r",
            write_safety_class: "n/a", esphome_domain: "sensor", esphome_read_entity_id: "test_raw_mask",
            esphome_configured_name: null, esphome_write_entity_id: null, backend_key: null,
            frontend_label_uk: "test", frontend_label_en: "test", ui_section: "diagnostics",
            ui_order: 9999, ui_group: null, editor_kind: "readonly", dynamic_dependency: null,
            enum_map: null, evidence: [], verification_status: "confirmed", exclusion_reason: null,
            implementation_status: "implemented", unknown_code_policy: null,
          },
          {
            key: "test_sub_bit", parent_register_id: "reg_test_overlap", field_width_bits: 1,
            byte_offset: null, mask: "0x0001", shift: 0, signedness: "unsigned", wire_type: "BIT",
            scale: 1, offset: 0, canonical_unit: "", uk_display_unit: "", en_display_unit: "",
            decimal_precision: 0, minimum: 0, maximum: 1, step: 1, reserved_values: [],
            nullable: true, packed_siblings: ["test_raw_mask"], overlap_rule: null, access: "r", effective_access: "r",
            write_safety_class: "n/a", esphome_domain: "binary_sensor", esphome_read_entity_id: "test_sub_bit",
            esphome_configured_name: null, esphome_write_entity_id: null, backend_key: null,
            frontend_label_uk: "test", frontend_label_en: "test", ui_section: "diagnostics",
            ui_order: 9998, ui_group: null, editor_kind: "readonly", dynamic_dependency: null,
            enum_map: null, evidence: [], verification_status: "confirmed", exclusion_reason: null,
            implementation_status: "implemented", unknown_code_policy: null,
          },
        ],
      },
    ],
  };
  const nonRegisterDoc = { entities: [] };
  const errors = semanticChecks.check(registerDoc, nonRegisterDoc, ROOT);
  const overlapErrors = errors.filter((e) => e.code === "OVERLAPPING_MASKS");
  check("a whole-register RAW field + a sub-bit field at the SAME address is rejected by the real semantic checker with OVERLAPPING_MASKS (reproduces the exact failure this round's 0x12D0 authoring attempt hit)",
    overlapErrors.length > 0, JSON.stringify(overlapErrors));
}

// ===========================================================================
// 2. registers.canonical.json itself: sensor_heating_mask (0x12D0) and
// alarms_bitmask (0x12A0) both remain the SOLE field on their register --
// confirming no sub-bit field was silently added around this constraint
// (which would itself fail generate.js's own real validation, but this
// pins intent directly against the canonical source too).
// ===========================================================================
const canonical = loadJson("protocol/registers.canonical.json");
const reg12D0 = canonical.registers.find((r) => r.address === "0x12D0");
const reg12A0 = canonical.registers.find((r) => r.address === "0x12A0");
check("0x12D0 still has exactly 1 field (sensor_heating_mask) -- no sub-bit fields added around the OVERLAPPING_MASKS constraint",
  reg12D0 && reg12D0.fields.length === 1 && reg12D0.fields[0].key === "sensor_heating_mask");
check("0x12A0 still has exactly 1 field (alarms_bitmask) -- no sub-bit fields added around the OVERLAPPING_MASKS constraint",
  reg12A0 && reg12A0.fields.length === 1 && reg12A0.fields[0].key === "alarms_bitmask");

// ===========================================================================
// 3. Both blockers' own text names the real architectural reason
// precisely (not a generic "matcher failed" restatement), and both stay
// open with a concrete closure criterion.
// ===========================================================================
const blockers = loadJson("protocol/evidence/protocol_blockers.json");
const blocker12D0 = blockers.blockers.find((b) => b.address === "0x12D0" && b.parameter_id.includes("Heating"));
const blocker12A0 = blockers.blockers.find((b) => b.address === "0x12A0" && b.parameter_id.includes("Alarm Mask"));
for (const [label, blocker] of [["0x12D0", blocker12D0], ["0x12A0", blocker12A0]]) {
  check(`${label} blocker exists and is open`, blocker && blocker.status === "open");
  check(`${label} blocker's issue text names OVERLAPPING_MASKS specifically (not a generic locator-matcher restatement)`,
    blocker && /OVERLAPPING_MASKS/.test(blocker.issue));
  check(`${label} blocker's closure_criterion describes a concrete architectural resolution (a projection mechanism), not a vague "TBD"`,
    blocker && /projection/i.test(blocker.closure_criterion));
}
check("AlarmBatUVP is named in the 0x12A0 blocker (added this round -- was previously omitted by a since-fixed classifier bug, same architectural reason as its 22 siblings)",
  blocker12A0 && blocker12A0.parameter_id.split(",").map((s) => s.trim()).includes("AlarmBatUVP"));

// ===========================================================================
// 4. TempSensorAbsent has its OWN, separate blocker (a different reason --
// no evidenced aggregation formula -- not conflated with the architectural
// OVERLAPPING_MASKS reason above).
// ===========================================================================
const blockerTempAbsent = blockers.blockers.find((b) => b.address === "0x12D0" && b.parameter_id === "TempSensorAbsent");
check("TempSensorAbsent has its own, separate 0x12D0 blocker entry (distinct reason from the other 7 parameters)",
  !!blockerTempAbsent && blockerTempAbsent.status === "open");
check("TempSensorAbsent's blocker does NOT cite OVERLAPPING_MASKS (its reason is a missing formula, not the architectural constraint)",
  blockerTempAbsent && !/OVERLAPPING_MASKS/.test(blockerTempAbsent.issue));

console.log(`\n${checks} checks run, ${failures} failed.`);
process.exit(failures ? 1 : 0);
