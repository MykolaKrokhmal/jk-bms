#!/usr/bin/env node
"use strict";

// Executable, real-payload decode tests for the generalized projection
// architecture (2026-09-20, user-directed continuation pass). Verifies
// that RAW mask preservation and projection decoding actually work
// against the REAL generated read-plan (not a reimplementation) by
// simulating the exact byte-manipulation the generated C++ performs:
// (raw >> shift) & fieldmask, matching jk_poll_scheduler_core.h's own
// decode_numeric()/decode_bool() semantics exactly. Also exercises
// short/oversized payload rejection against the real generated exact-
// length validation text.

const fs = require("fs");
const path = require("path");

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

// Mirrors jk_poll_scheduler_core.h's read_be()+mask+shift decode exactly
// (big-endian, register_bytes-wide read starting at data[0]).
function readBE(bytes, width) {
  let v = 0;
  for (let i = 0; i < width; i++) v = (v << 8) | bytes[i];
  return v >>> 0;
}
function decodeField(bytes, field, registerBytes) {
  const raw = readBE(bytes, registerBytes);
  const mask = parseInt(field.mask, 16);
  return (raw & mask) >>> field.shift;
}

const readPlan = loadJson("protocol/generated/read_plan.json");
const canonical = loadJson("protocol/registers.canonical.json");

// ===========================================================================
// 1. 0x12D0: RAW mask preserved, Heating + all 7 sensor-status bits decode
// correctly from ONE synthetic payload, exercising real mask/shift values
// pulled from the actual generated read plan (not hand-typed constants).
// ===========================================================================
{
  const block = readPlan.blocks.find((b) => b.address === "0x12D0");
  check("0x12D0 block exists with 8 fields", block && block.fields.length === 8);
  const byKey = new Map(block.fields.map((f) => [f.key, f]));

  // Construct a payload: high byte = 0b00111110 (bits 1-5 set = present,
  // bit0=0=MOS-status-0, bits6-7=0), low byte (Heating) = 0x01 (on).
  const payload = Buffer.from([0b00111110, 0x01]);

  const rawValue = decodeField(payload, byKey.get("sensor_heating_mask"), 2);
  check("sensor_heating_mask (RAW) decodes the exact 16-bit value unmodified",
    rawValue === 0x3E01, `got 0x${rawValue.toString(16)}`);

  const heating = decodeField(payload, byKey.get("heating_active"), 2);
  check("heating_active (projection, low byte) decodes to 1 (On) from the SAME payload",
    heating === 1);

  for (let n = 1; n <= 5; n++) {
    const f = byKey.get(`bat_temp_sensor_${n}_present`);
    const v = decodeField(payload, f, 2);
    check(`bat_temp_sensor_${n}_present (projection, bit${f.shift}) decodes to 1 (present) from the SAME payload`, v === 1);
  }
  const mos = decodeField(payload, byKey.get("mos_temp_sensor_status_bit_raw"), 2);
  check("mos_temp_sensor_status_bit_raw (projection, bit8) decodes to 0 from the SAME payload (bit0 of high byte is 0 in this fixture)",
    mos === 0);

  // Flip only the MOS bit and re-decode -- proves each projection reads
  // its OWN bit independently, not some shared/cached value.
  const payload2 = Buffer.from([0b00111111, 0x01]);
  const mos2 = decodeField(payload2, byKey.get("mos_temp_sensor_status_bit_raw"), 2);
  const bat1_2 = decodeField(payload2, byKey.get("bat_temp_sensor_1_present"), 2);
  check("flipping only bit0 (MOS) changes mos_temp_sensor_status_bit_raw to 1 without affecting bat_temp_sensor_1_present",
    mos2 === 1 && bat1_2 === 1);
}

// ===========================================================================
// 2. 0x12A0: RAW alarms_bitmask preserved, individual alarm bits decode
// independently from one payload.
// ===========================================================================
{
  const block = readPlan.blocks.find((b) => b.address === "0x12A0");
  check("0x12A0 block exists with 23 fields", block && block.fields.length === 23);
  const byKey = new Map(block.fields.map((f) => [f.key, f]));

  // Set bit0 (AlarmWireRes) and bit12 (AlarmBatUVP), nothing else.
  const payload = Buffer.from([0x00, 0x00, 0x10, 0x01]); // big-endian u32 = 0x00001001

  const rawValue = decodeField(payload, byKey.get("alarms_bitmask"), 4);
  check("alarms_bitmask (RAW) decodes the exact 32-bit value unmodified", rawValue === 0x1001);

  const wireRes = decodeField(payload, byKey.get("alarm_wire_res"), 4);
  const batUvp = decodeField(payload, byKey.get("alarm_bat_uvp"), 4);
  const motOtp = decodeField(payload, byKey.get("alarm_mos_otp"), 4);
  check("alarm_wire_res (bit0) decodes to 1 (active) from the SAME payload", wireRes === 1);
  check("alarm_bat_uvp (bit12) decodes to 1 (active) from the SAME payload", batUvp === 1);
  check("alarm_mos_otp (bit1, NOT set in this fixture) decodes to 0 -- no sibling infection", motOtp === 0);
}

// ===========================================================================
// 3. Short/oversized payload rejection: the real generated C++ uses
// data.size() != payload_bytes (exact match), which would reject a
// payload shorter OR longer than 0x12D0's/0x12A0's own declared
// payload_bytes -- confirmed directly against the generated source text,
// covering the projection-bearing blocks specifically (not just the
// generic case already covered by test_generic_read_plan_register_count.js).
// ===========================================================================
{
  const readPlanYaml = fs.readFileSync(path.join(ROOT, "protocol", "generated", "read_plan.yaml"), "utf8");
  // CORRECTED 2026-09-20: the length check is now per-block
  // (strict_length), not a single unconditional literal -- see
  // test_generic_read_plan_register_count.js's own module comment for the
  // hardware-found defect this generalized. 0x12D0/0x12A0 are ORDINARY_
  // ONE_REGISTER blocks (unaffected by that fix, which only carves out the
  // one CLUSTERED_GAP_AWARE block, 0x1290) so they must still resolve to
  // an exact-match check at runtime.
  const readPlanJson = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "generated", "read_plan.json"), "utf8"));
  const block12D0 = readPlanJson.blocks.find((b) => b.address === "0x12D0");
  const block12A0 = readPlanJson.blocks.find((b) => b.address === "0x12A0");
  check("emitted C++ uses a per-block length_ok check (strict_length ? exact-match : floor), covering every block including 0x12D0/0x12A0",
    readPlanYaml.includes("const bool length_ok = strict_length ? (data.size() == payload_bytes) : (data.size() >= payload_bytes);"));
  check("0x12D0 (ORDINARY_ONE_REGISTER) resolves to strict_length=true -- still exact-match, unaffected by the 0x1290-only carve-out",
    block12D0 && block12D0.strict_length === true);
  check("0x12A0 (ORDINARY_ONE_REGISTER) resolves to strict_length=true -- still exact-match, unaffected by the 0x1290-only carve-out",
    block12A0 && block12A0.strict_length === true);
  const reg12D0 = canonical.registers.find((r) => r.address === "0x12D0");
  const reg12A0 = canonical.registers.find((r) => r.address === "0x12A0");
  check("0x12D0's declared payload_bytes is still 2 (unchanged by adding 7 projections)", reg12D0.payload_bytes === 2);
  check("0x12A0's declared payload_bytes is still 4 (unchanged by adding 22 projections)", reg12A0.payload_bytes === 4);
}

console.log(`\n${checks} checks run, ${failures} failed.`);
process.exit(failures ? 1 : 0);
