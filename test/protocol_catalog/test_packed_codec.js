#!/usr/bin/env node
/*
 * Packed-register encode/decode round-trip tests (Stage 1, spec section 7).
 *
 * Exercises the mask/shift/signedness metadata the canonical source declares
 * for the four mandatory packed registers (0x111C, 0x1504, 0x14E4, 0x14E6)
 * against a generic codec implemented directly from that metadata — proving
 * the catalog's own numbers are internally consistent for minimum, maximum,
 * zero, negative INT8, high-byte, low-byte and reserved values, and that a
 * merge-preserving read-modify-write round-trips the untouched sibling byte.
 *
 * This tests METADATA/CODEC correctness only — it never talks to a BMS or
 * simulates firmware; Stage 1 does not perform hardware writes (spec section 4).
 *
 * Run: node test/protocol_catalog/test_packed_codec.js
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const registerDoc = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "registers.canonical.json"), "utf8"));

let checks = 0;
let failures = 0;
function check(name, cond, detail) {
  checks += 1;
  if (!cond) {
    failures += 1;
    console.log(`FAIL  ${name}${detail ? "  -- " + detail : ""}`);
  } else {
    console.log(`PASS  ${name}${detail ? "  -- " + detail : ""}`);
  }
}

function findRegister(address) {
  const reg = registerDoc.registers.find((r) => r.address === address);
  if (!reg) throw new Error(`register ${address} not found in canonical source`);
  return reg;
}

// Decode one field's typed value from a raw register word, per the
// catalog's own mask/shift/signedness/scale metadata.
function decodeField(field, rawWord) {
  const maskNum = parseInt(field.mask, 16);
  let bits = (rawWord & maskNum) >>> (field.shift || 0);
  if (field.signedness === "signed") {
    const signBit = 1 << (field.field_width_bits - 1);
    if (bits & signBit) bits -= 1 << field.field_width_bits;
  }
  return bits * field.scale + field.offset;
}

// Encode one field's typed value into raw bits (NOT yet merged with siblings).
function encodeFieldBits(field, typedValue) {
  const raw = Math.round((typedValue - field.offset) / field.scale);
  const widthMask = field.field_width_bits >= 32 ? 0xFFFFFFFF : (1 << field.field_width_bits) - 1;
  return (raw & widthMask) << (field.shift || 0);
}

// Merge-preserving read-modify-write: encode `field` to `typedValue`, keep
// every other bit of `priorRawWord` untouched — this is the exact
// overlap_rule every packed field in the canonical source documents.
function mergeWrite(field, typedValue, priorRawWord) {
  const maskNum = parseInt(field.mask, 16);
  const encoded = encodeFieldBits(field, typedValue);
  return ((priorRawWord & ~maskNum) | (encoded & maskNum)) >>> 0;
}

// ===========================================================================
// 0x111C — heating_activation_temperature (high byte, S8) / _deactivation (low byte, S8)
// ===========================================================================
{
  const reg = findRegister("0x111C");
  const hi = reg.fields.find((f) => f.key === "heating_activation_temperature");
  const lo = reg.fields.find((f) => f.key === "heating_deactivation_temperature");

  check("0x111C: high byte decodes 5 (workbook-observed activation value)", decodeField(hi, 0x0500 | 0x0F) === 5);
  check("0x111C: low byte decodes 15 (workbook-observed deactivation value)", decodeField(lo, 0x0500 | 0x0F) === 15);

  // Negative INT8 boundary: -40 (minimum) and +100 (maximum), both bytes.
  const rawMinHi = mergeWrite(hi, -40, 0x0000);
  check("0x111C: encode/decode round-trip for high byte minimum (-40)", decodeField(hi, rawMinHi) === -40, `raw=0x${rawMinHi.toString(16)}`);
  const rawMaxHi = mergeWrite(hi, 100, 0x0000);
  check("0x111C: encode/decode round-trip for high byte maximum (100)", decodeField(hi, rawMaxHi) === 100, `raw=0x${rawMaxHi.toString(16)}`);
  const rawZeroLo = mergeWrite(lo, 0, 0xFF00);
  check("0x111C: encode/decode round-trip for low byte zero, high byte preserved", decodeField(lo, rawZeroLo) === 0 && decodeField(hi, rawZeroLo) === -1,
    `raw=0x${rawZeroLo.toString(16)}`);

  // Sibling preservation: writing the high byte must not disturb the low byte, and vice versa.
  const priorRaw = mergeWrite(lo, 15, mergeWrite(hi, 5, 0));
  check("0x111C: writing hi to a new value preserves the already-written lo byte",
    (() => {
      const afterHiWrite = mergeWrite(hi, 20, priorRaw);
      return decodeField(hi, afterHiWrite) === 20 && decodeField(lo, afterHiWrite) === 15;
    })());
  check("0x111C: writing lo to a new value preserves the already-written hi byte",
    (() => {
      const afterLoWrite = mergeWrite(lo, 3, priorRaw);
      return decodeField(lo, afterLoWrite) === 3 && decodeField(hi, afterLoWrite) === 5;
    })());
}

// ===========================================================================
// 0x1504 — rcv_time (low byte, U8, x0.1h) / rfv_time (high byte, U8, x0.1h)
// ===========================================================================
{
  const reg = findRegister("0x1504");
  const rcv = reg.fields.find((f) => f.key === "rcv_time");
  const rfv = reg.fields.find((f) => f.key === "rfv_time");

  check("0x1504: rcv_time minimum (0) round-trips", decodeField(rcv, mergeWrite(rcv, 0, 0)) === 0);
  check("0x1504: rcv_time maximum (25.5) round-trips", Math.abs(decodeField(rcv, mergeWrite(rcv, 25.5, 0)) - 25.5) < 1e-9);
  check("0x1504: rfv_time maximum (25.5) round-trips independently of rcv_time",
    (() => {
      const raw = mergeWrite(rcv, 10.0, mergeWrite(rfv, 25.5, 0));
      return Math.abs(decodeField(rfv, raw) - 25.5) < 1e-9 && Math.abs(decodeField(rcv, raw) - 10.0) < 1e-9;
    })());
  check("0x1504: reserved raw byte value 0xFF (25.5h) is representable and does not overflow the 8-bit field",
    decodeField(rcv, 0x00FF) === 25.5);
}

// ===========================================================================
// 0x14E4 — lcd_buzzer_trigger (high byte, U8) / dry_contact_1_trigger_source (low byte, U8)
// ===========================================================================
{
  const reg = findRegister("0x14E4");
  const lcd = reg.fields.find((f) => f.key === "lcd_buzzer_trigger");
  const dry1 = reg.fields.find((f) => f.key === "dry_contact_1_trigger_source");

  check("0x14E4: dry_contact_1_trigger_source minimum (0) round-trips", decodeField(dry1, mergeWrite(dry1, 0, 0)) === 0);
  check("0x14E4: dry_contact_1_trigger_source maximum (12) round-trips", decodeField(dry1, mergeWrite(dry1, 12, 0)) === 12);
  check("0x14E4: lcd_buzzer_trigger high byte independent of dry1 low byte",
    (() => {
      const raw = mergeWrite(dry1, 7, mergeWrite(lcd, 200, 0));
      return decodeField(lcd, raw) === 200 && decodeField(dry1, raw) === 7;
    })());
}

// ===========================================================================
// 0x14E6 — dry_contact_2_trigger_source (high byte, RW) / uart_protocol_library_version (low byte, R)
// ===========================================================================
{
  const reg = findRegister("0x14E6");
  const dry2 = reg.fields.find((f) => f.key === "dry_contact_2_trigger_source");
  const ver = reg.fields.find((f) => f.key === "uart_protocol_library_version");

  check("0x14E6: writing dry_contact_2_trigger_source (high byte) never touches the read-only low byte (version)",
    (() => {
      const withVersion = mergeWrite(dry2, 0, 0x0000 | 42); // simulate a device reporting protocol version 42
      const afterWrite = mergeWrite(dry2, 9, withVersion);
      return decodeField(ver, afterWrite) === 42 && decodeField(dry2, afterWrite) === 9;
    })());
  check("0x14E6: uart_protocol_library_version has write_safety_class n/a (read-only, not part of any write path)",
    ver.write_safety_class === "n/a" && ver.access === "r");
}

console.log(`\n${checks} checks run, ${failures} failed.`);
process.exit(failures ? 1 : 0);
