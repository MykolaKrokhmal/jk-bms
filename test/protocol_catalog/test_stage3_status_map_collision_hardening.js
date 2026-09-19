#!/usr/bin/env node
"use strict";

// Bounded hardening regression test for build_stage3_status_map.js
// (2026-09-19, user-directed follow-up to the 2026-09-19 fail-open fix
// covered by test_stage3_status_map_exact_identity.js).
//
// Terminology correction this round: fieldOccupiesManifestParamWirePosition
// (formerly fieldMatchesManifestParam) proves only WIRE-POSITION identity
// (bit/byte-half/whole-register slot coincidence at a shared address) --
// never full SEMANTIC identity (that two same-position entries actually
// mean the same real-world quantity). This file's job is to prove the
// ambiguity guard this round adds to classifyOne(): when more than one
// canonical field occupies one manifest parameter's exact wire position,
// the generator refuses to guess and fails closed to status=missing with
// an explicit "AMBIGUOUS" note, instead of silently picking one (which is
// what an unguarded `.some()`/`.find()` over the match list would do).
//
// A full 265-parameter audit (2026-09-19, this round) found ZERO real
// wire-position collisions in current production data -- so the collision
// fixtures below are necessarily SYNTHETIC (built directly against the
// exported pure functions, not the real committed manifest/canonical
// files), exercising a defensive branch that no production parameter
// reaches today. The non-collision fixtures (unique bit match, unique
// byte-half match, sibling non-infection, blocker precedence) reuse the
// same synthetic-fixture style for precise, self-contained coverage,
// distinct from test_stage3_status_map_exact_identity.js's real-data
// integration coverage of the same properties.

const { fieldOccupiesManifestParamWirePosition, classifyOne } = require("../../tools/protocol/authoring/build_stage3_status_map.js");

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

// ---------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------
function manifestParam(id, address, classification = "normal") {
  return {
    id,
    classification,
    address: {
      base_address: address.base_address,
      bit: address.bit === undefined ? null : address.bit,
      byte_half: address.byte_half === undefined ? null : address.byte_half,
      bit_unspecified: Boolean(address.bit_unspecified),
    },
  };
}

function bitField(key, shift, status = "implemented", access = "r") {
  return { key, wire_type: "BIT", shift, field_width_bits: 1, byte_offset: null, mask: `0x${(1 << shift).toString(16).toUpperCase()}`, implementation_status: status, effective_access: access };
}
function highByteField(key, status = "implemented", access = "r") {
  return { key, wire_type: "UINT8", field_width_bits: 8, byte_offset: 0, mask: "0xFF00", implementation_status: status, effective_access: access };
}
function lowByteField(key, status = "implemented", access = "r") {
  return { key, wire_type: "UINT8", field_width_bits: 8, byte_offset: 1, mask: "0x00FF", implementation_status: status, effective_access: access };
}
function wholeRegisterField(key, widthBits, status = "implemented", access = "r") {
  return { key, wire_type: `UINT${widthBits}`, field_width_bits: widthBits, byte_offset: null, mask: null, implementation_status: status, effective_access: access };
}

function canonByAddr(address, registerWidthBits, fields, registerAddress) {
  return new Map([[address, [{ address: registerAddress || address, register_width_bits: registerWidthBits, fields }]]]);
}

const NO_BLOCKERS = new Set();
const NO_LOCATORS = new Map();

// ===========================================================================
// 1. Unique bit match -- exactly one BIT field at the parameter's own bit
// classifies implemented_read (baseline sanity, synthetic isolation of the
// real 0x1114 ChargingFloatMode/Special-Charger shape without the blocker
// that complicates the real fixture).
// ===========================================================================
{
  const p = manifestParam("SyntheticBitParam", { base_address: "0x9000", bit: 5 });
  const regs = canonByAddr("0x9000", 16, [bitField("synthetic_bit_5", 5)]);
  const result = classifyOne(p, regs, NO_BLOCKERS, NO_LOCATORS);
  check("unique bit match -> implemented_read", result.status === "implemented_read", JSON.stringify(result));
}

// ===========================================================================
// 2. Unique byte-half match -- exactly one high-byte field classifies
// implemented_read; the low byte at the same address is irrelevant noise
// here (present but non-implemented, to prove it's ignored, not summed).
// ===========================================================================
{
  const p = manifestParam("SyntheticHighByteParam", { base_address: "0x9010", byte_half: "high" });
  const regs = canonByAddr("0x9010", 16, [highByteField("synthetic_high", "implemented", "r"), lowByteField("synthetic_low", "source_only_unimplemented", "r")]);
  const result = classifyOne(p, regs, NO_BLOCKERS, NO_LOCATORS);
  check("unique byte-half match -> implemented_read", result.status === "implemented_read", JSON.stringify(result));
}

// ===========================================================================
// 3. Sibling does not inherit status -- the LOW byte manifest parameter,
// at the SAME address as an implemented HIGH byte, must NOT itself
// classify implemented_* when its own half is only catalog_only. This is
// the exact shape of the original fail-open bug, in isolation.
// ===========================================================================
{
  const pLow = manifestParam("SyntheticLowByteSibling", { base_address: "0x9010", byte_half: "low" });
  const regs = canonByAddr("0x9010", 16, [highByteField("synthetic_high", "implemented", "r"), lowByteField("synthetic_low", "source_only_unimplemented", "r")]);
  const result = classifyOne(pLow, regs, NO_BLOCKERS, NO_LOCATORS);
  check("sibling (low byte) does not inherit the high byte's implemented_read -- classifies catalog_only from its OWN field",
    result.status === "catalog_only", JSON.stringify(result));
}
{
  // Even harsher: the sibling's own half doesn't exist as a canonical
  // field at all (only the high byte is modeled) -- must be missing, not
  // implemented, not catalog_only (there's genuinely nothing for it).
  const pLow = manifestParam("SyntheticLowByteUnmodeledSibling", { base_address: "0x9020", byte_half: "low" });
  const regs = canonByAddr("0x9020", 16, [highByteField("synthetic_high_only", "implemented", "r")]);
  const result = classifyOne(pLow, regs, NO_BLOCKERS, NO_LOCATORS);
  check("sibling (low byte) with no canonical field of its own at all -> missing, not implemented",
    result.status === "missing", JSON.stringify(result));
}

// ===========================================================================
// 4. Two manifest IDs at the SAME wire position -- fieldOccupiesManifest
// ParamWirePosition() itself is position-only, so both IDs independently
// match the same canonical field; the CLASSIFIER's output for each is
// legitimate (both really do occupy that position -- this is not the
// per-manifest-parameter ambiguity guard, which is about multiple
// CANONICAL fields at ONE parameter's position, fixture #5 below). This
// fixture instead proves fieldOccupiesManifestParamWirePosition() treats
// both manifest parameters identically and does not silently prefer one
// id over the other -- true positional symmetry, not name-based guessing.
// ===========================================================================
{
  const addr = { base_address: "0x9030", bit: 3 };
  const pA = manifestParam("SyntheticDualIdA", addr);
  const pB = manifestParam("SyntheticDualIdB", addr);
  const field = bitField("synthetic_bit_3", 3);
  const regs = canonByAddr("0x9030", 16, [field]);
  const resultA = classifyOne(pA, regs, NO_BLOCKERS, NO_LOCATORS);
  const resultB = classifyOne(pB, regs, NO_BLOCKERS, NO_LOCATORS);
  check("two manifest IDs sharing one wire position both resolve identically from the same single canonical field (no id-based favoritism)",
    resultA.status === "implemented_read" && resultB.status === "implemented_read" && resultA.note === resultB.note,
    JSON.stringify({ resultA, resultB }));
}

// ===========================================================================
// 5. Two canonical fields at the SAME position -- the actual ambiguity
// guard under test. A manifest parameter whose exact wire position is
// occupied by TWO distinct canonical fields (a genuine collision on the
// canonical side) must fail closed: status=missing, note starts with
// "AMBIGUOUS", both field keys named in the note, and -- critically --
// this must hold regardless of whether one, both, or neither of the
// colliding fields is itself "implemented" (never let an implemented
// collision member win by chance iteration order).
// ===========================================================================
{
  const p = manifestParam("SyntheticBitCollisionParam", { base_address: "0x9040", bit: 7 });
  const regs = canonByAddr("0x9040", 16, [bitField("synthetic_collider_a", 7, "implemented", "r"), bitField("synthetic_collider_b", 7, "implemented", "rw")]);
  const result = classifyOne(p, regs, NO_BLOCKERS, NO_LOCATORS);
  check("two canonical BIT fields at the same bit -> status=missing (never implemented_*, even though both members ARE implemented)",
    result.status === "missing", JSON.stringify(result));
  check("ambiguous-collision note is explicitly labeled AMBIGUOUS and names both colliding field keys",
    /AMBIGUOUS/.test(result.note) && result.note.includes("synthetic_collider_a") && result.note.includes("synthetic_collider_b"),
    result.note);
}
{
  // Same collision shape, but neither member is implemented -- still
  // must be the ambiguity note, not the generic "no field matches" note,
  // since the ambiguity is itself the reportable fact regardless of
  // downstream implementation status.
  const p = manifestParam("SyntheticBitCollisionUnimplemented", { base_address: "0x9050", bit: 2 });
  const regs = canonByAddr("0x9050", 16, [bitField("synthetic_collider_c", 2, "source_only_unimplemented", "r"), bitField("synthetic_collider_d", 2, "partially_implemented", "r")]);
  const result = classifyOne(p, regs, NO_BLOCKERS, NO_LOCATORS);
  check("two canonical BIT fields at the same bit, neither implemented -> still status=missing with an AMBIGUOUS note (not the generic no-match note)",
    result.status === "missing" && /AMBIGUOUS/.test(result.note), JSON.stringify(result));
}

// ===========================================================================
// 6. Whole-register collision -- two full-width canonical fields at one
// address, for a manifest parameter with neither bit nor byte_half (a
// whole-register parameter). Same fail-closed AMBIGUOUS behavior.
// ===========================================================================
{
  const p = manifestParam("SyntheticWholeRegisterCollision", { base_address: "0x9060" });
  const regs = canonByAddr("0x9060", 16, [wholeRegisterField("synthetic_whole_a", 16, "implemented", "r"), wholeRegisterField("synthetic_whole_b", 16, "implemented", "r")]);
  const result = classifyOne(p, regs, NO_BLOCKERS, NO_LOCATORS);
  check("two whole-register-width canonical fields at one address -> status=missing (AMBIGUOUS), not implemented_*",
    result.status === "missing" && /AMBIGUOUS/.test(result.note), JSON.stringify(result));
}
{
  // Sanity: a genuinely UNIQUE whole-register field still classifies
  // normally -- the guard must not over-fire on the non-collision case.
  const p = manifestParam("SyntheticWholeRegisterUnique", { base_address: "0x9070" });
  const regs = canonByAddr("0x9070", 16, [wholeRegisterField("synthetic_whole_unique", 16, "implemented", "rw")]);
  const result = classifyOne(p, regs, NO_BLOCKERS, NO_LOCATORS);
  check("a single whole-register canonical field (no collision) still classifies implemented_write_confirmed",
    result.status === "implemented_write_confirmed", JSON.stringify(result));
}

// ===========================================================================
// 7. bit_unspecified -- must never match anything (0 matches, not >1, not
// a false ambiguity), and must resolve however the existing 0-match /
// blocker rules dictate -- never implemented_*, never mislabeled
// AMBIGUOUS (this is a "we don't know the bit" case, not a "multiple
// real candidates" case -- the two are semantically distinct and must
// not share a note).
// ===========================================================================
{
  const p = manifestParam("SyntheticBitUnspecified", { base_address: "0x9080", bit_unspecified: true });
  const regs = canonByAddr("0x9080", 16, [bitField("synthetic_unrelated_bit", 0, "implemented", "r")]);
  const result = classifyOne(p, regs, NO_BLOCKERS, NO_LOCATORS);
  check("bit_unspecified parameter never matches any field -> status=missing, not AMBIGUOUS, not implemented_*",
    result.status === "missing" && !/AMBIGUOUS/.test(result.note), JSON.stringify(result));
  check("fieldOccupiesManifestParamWirePosition returns false directly for a bit_unspecified address against any field",
    fieldOccupiesManifestParamWirePosition({ bit_unspecified: true, bit: null, byte_half: null }, bitField("x", 0), 16) === false);
}
{
  // bit_unspecified WITH an open blocker: blocker precedence still wins,
  // exactly as for any other parameter -- confirms the guard doesn't
  // change step 3 of the classification order.
  const p = manifestParam("SyntheticBitUnspecifiedBlocked", { base_address: "0x9080", bit_unspecified: true });
  const regs = canonByAddr("0x9080", 16, [bitField("synthetic_unrelated_bit", 0, "implemented", "r")]);
  const result = classifyOne(p, regs, new Set(["SyntheticBitUnspecifiedBlocked"]), NO_LOCATORS);
  check("bit_unspecified parameter named in an open blocker -> blocked (unaffected by the wire-position guard)",
    result.status === "blocked", JSON.stringify(result));
}

// ===========================================================================
// 8. Blocker precedence -- a parameter with a UNIQUE, implemented
// wire-position match that is ALSO named in an open blocker must still
// classify "blocked", never "implemented_read" -- proves the ambiguity
// guard (which runs after the blocker check in classifyOne()'s existing
// order) does not disturb this pre-existing precedence rule. This is the
// synthetic-fixture counterpart to the real ChargingFloatMode case.
// ===========================================================================
{
  const p = manifestParam("SyntheticBlockedDespiteUniqueMatch", { base_address: "0x9090", bit: 1 });
  const regs = canonByAddr("0x9090", 16, [bitField("synthetic_blocked_bit", 1, "implemented", "r")]);
  const resultUnblocked = classifyOne(p, regs, NO_BLOCKERS, NO_LOCATORS);
  check("precondition: without a blocker, this fixture DOES classify implemented_read (proves the blocked result below isn't just 'nothing matched')",
    resultUnblocked.status === "implemented_read", JSON.stringify(resultUnblocked));
  const resultBlocked = classifyOne(p, regs, new Set(["SyntheticBlockedDespiteUniqueMatch"]), NO_LOCATORS);
  check("blocker precedence: a unique, implemented wire-position match is still overridden to 'blocked' when the parameter is named in an open blocker",
    resultBlocked.status === "blocked", JSON.stringify(resultBlocked));
}

// ===========================================================================
// 9. Real-data corroboration: ChargingFloatMode (0x1114 bit9) is the
// production instance of fixture #8's exact shape -- re-asserted here
// against the REAL generated status map (not synthetic) so this file
// also pins the specific, user-flagged distinction: this is a stale/
// overbroad protocol_blockers.json entry (the 0x1114 blocker's own
// parameter_id list includes ChargingFloatMode alongside 8 genuinely
// unimplemented siblings, even though ChargingFloatMode itself has a
// real, unique, implemented canonical field), not a matcher defect --
// out of scope for this round (blockers file is not touched), a
// candidate for a future, dedicated 0x1114 blocker-scoping batch.
// ===========================================================================
{
  const fs = require("fs");
  const path = require("path");
  const ROOT = path.join(__dirname, "..", "..");
  const statusMap = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "generated", "stage3_status_map.json"), "utf8"));
  const canonical = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "registers.canonical.json"), "utf8"));
  const blockers = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "evidence", "protocol_blockers.json"), "utf8"));

  const reg1114 = canonical.registers.find((r) => r.address === "0x1114");
  const chargingFloatField = reg1114 && reg1114.fields.find((f) => f.key === "charging_float_mode");
  check("registers.canonical.json still has exactly one field at 0x1114 (charging_float_mode) -- ChargingFloatMode's own wire-position match is genuinely unique in production, not a collision",
    reg1114 && reg1114.fields.length === 1 && chargingFloatField && chargingFloatField.implementation_status === "implemented");

  const blocker1114 = blockers.blockers.find((b) => b.address === "0x1114" && b.status === "open");
  check("the open 0x1114 blocker's parameter_id list still names ChargingFloatMode alongside its genuinely-unimplemented siblings (the stale/overbroad condition this fixture documents)",
    blocker1114 && blocker1114.parameter_id.split(",").map((s) => s.trim()).includes("ChargingFloatMode"));

  const chargingFloatEntry = statusMap.parameters.find((p) => p.id === "ChargingFloatMode");
  check("ChargingFloatMode's generated status is 'blocked' (blocker precedence), NOT 'implemented_read' -- confirms this is a blocker-scoping issue, not a matcher false-negative",
    chargingFloatEntry && chargingFloatEntry.status === "blocked", JSON.stringify(chargingFloatEntry));
}

// ===========================================================================
// 10. Full 265-parameter production audit re-assertion: this round found
// zero real wire-position collisions. Re-run the same audit logic here
// (independently, against the real committed files) so a future
// regression that introduces a real collision is caught by this test
// suite, not just by a one-time manual audit.
// ===========================================================================
{
  const fs = require("fs");
  const path = require("path");
  const ROOT = path.join(__dirname, "..", "..");
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "generated", "bms_v1_1_manifest.json"), "utf8"));
  const canonical = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "registers.canonical.json"), "utf8"));

  const canonByAddress = new Map();
  for (const r of canonical.registers) {
    if (!canonByAddress.has(r.address)) canonByAddress.set(r.address, []);
    canonByAddress.get(r.address).push(r);
  }

  let canonicalCollisions = [];
  let manifestPositionCollisions = [];
  const posToIds = new Map();
  for (const p of manifest.parameters) {
    if (p.classification === "reserved" || p.classification === "derived") continue;
    const key = p.address.bit_unspecified
      ? null // bit_unspecified never resolves to a real position -- excluded from the collision census, tracked separately below
      : JSON.stringify([p.address.base_address, p.address.bit, p.address.byte_half]);
    if (key) {
      if (!posToIds.has(key)) posToIds.set(key, []);
      posToIds.get(key).push(p.id);
    }

    const regs = canonByAddress.get(p.address.base_address) || [];
    const matches = [];
    for (const reg of regs) {
      for (const f of reg.fields) {
        if (fieldOccupiesManifestParamWirePosition(p.address, f, reg.register_width_bits)) matches.push(`${reg.address}:${f.key}`);
      }
    }
    if (matches.length > 1) canonicalCollisions.push({ id: p.id, matches });
  }
  for (const [key, ids] of posToIds) {
    if (ids.length > 1) manifestPositionCollisions.push({ key, ids });
  }

  check("production audit: zero manifest parameters share one real (non-bit_unspecified) wire position with another manifest parameter",
    manifestPositionCollisions.length === 0, JSON.stringify(manifestPositionCollisions));
  check("production audit: zero manifest parameters have more than one canonical field occupying their exact wire position",
    canonicalCollisions.length === 0, JSON.stringify(canonicalCollisions));

  const bitUnspecifiedIds = manifest.parameters.filter((p) => p.address.bit_unspecified).map((p) => p.id);
  check("production audit: exactly 2 bit_unspecified manifest parameters (TemperatureSensorAnomaly, PCLModuleAnomaly) -- unchanged from Stage 2's known ambiguity",
    bitUnspecifiedIds.length === 2 && bitUnspecifiedIds.includes("TemperatureSensorAnomaly") && bitUnspecifiedIds.includes("PCLModuleAnomaly"),
    JSON.stringify(bitUnspecifiedIds));
}

// ===========================================================================
// 11. Given zero production collisions (checks 10 above), the real
// generated status map's counts must be unchanged from the pre-hardening
// baseline: 182 implemented_read / 50 blocked / 18 implemented_write_
// confirmed / 10 missing / 4 reserved / 1 derived_not_a_register, summing
// to 265 -- this hardening pass reshuffles no real classification.
// ===========================================================================
{
  const fs = require("fs");
  const path = require("path");
  const ROOT = path.join(__dirname, "..", "..");
  const statusMap = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "generated", "stage3_status_map.json"), "utf8"));
  const expected = { implemented_read: 182, blocked: 50, implemented_write_confirmed: 18, missing: 10, reserved: 4, derived_not_a_register: 1 };
  const countsMatch = Object.keys(expected).length === Object.keys(statusMap.counts).length &&
    Object.entries(expected).every(([k, v]) => statusMap.counts[k] === v);
  check("real generated stage3_status_map.json counts are unchanged by this hardening pass (182/50/18/10/4/1, sum 265)",
    countsMatch, JSON.stringify(statusMap.counts));
  check("no AMBIGUOUS note appears anywhere in the real generated status map (production has zero collisions)",
    !statusMap.parameters.some((p) => /AMBIGUOUS/.test(p.note)));
}

console.log(`\n${checks} checks run, ${failures} failed.`);
process.exit(failures ? 1 : 0);
