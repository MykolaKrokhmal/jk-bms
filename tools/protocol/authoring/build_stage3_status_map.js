#!/usr/bin/env node
"use strict";

/*
 * Stage 3 (typed-petting-puzzle plan) preflight deliverable: a WIRE-POSITION
 * mapping of every one of the 265 manifest parameters (protocol/generated/
 * bms_v1_1_manifest.json) against the CURRENT registers.canonical.json and
 * the CURRENT open-blocker register -- never a mechanical count comparison
 * (packed fields, aliases, and derived entities have a different structure
 * between the manifest and the canonical catalog; see registers.canonical.
 * json's own field count vs. the manifest's 265 rows -- they were never
 * expected to match 1:1).
 *
 * TERMINOLOGY (2026-09-19 hardening pass): "match" below means WIRE-POSITION
 * identity only -- a manifest parameter's declared bit/byte-half/
 * whole-register slot at an address coincides with a canonical field's
 * declared slot at that same address (see fieldOccupiesManifestParamWire
 * Position()'s own comment for the exact rules). It is deliberately NOT a
 * claim of full SEMANTIC identity -- this generator never inspects or
 * compares field names/descriptions to decide a match, only wire geometry.
 * Two same-position entries that turned out to mean different things would
 * still "match" by this definition; that is exactly why classifyOne() below
 * refuses to classify a position with more than one canonical match as
 * implemented (step 5a) rather than silently picking one.
 *
 * Classification order (blocker status checked BEFORE canonical-address
 * presence -- a packed/bit-field parameter can share an address with an
 * ALREADY-implemented sibling, e.g. an individual 0x12A0 alarm bit next
 * to the already-modeled alarm register, while this parameter's own
 * specific semantic is still an open, named blocker; the register
 * existing does not make THIS parameter confirmed):
 *   1. manifest classification "reserved"  -> reserved
 *   2. manifest classification "derived"   -> derived_not_a_register
 *   3. manifest address.bit_unspecified=true -> unsupported_bit_position_
 *      undocumented, PERMANENTLY (2026-09-22 addition) -- checked BEFORE
 *      the open-blocker check below, so this is deterministic regardless
 *      of blocker open/closed state; never falls through to "missing".
 *   4. parameter_id named in an open protocol_blockers.json entry -> blocked
 *   5. no canonical register at this address at all -> missing
 *   6. a canonical register exists; find every field occupying this
 *      parameter's exact wire position (bit / byte-half / whole-register):
 *      6a. more than one such field -> missing, with an explicit
 *          "AMBIGUOUS wire-position match" note (never implemented_*,
 *          never a guessed pick -- see TERMINOLOGY above)
 *      6b. exactly one such field -> inspect it:
 *        implemented + effective_access "rw" -> implemented_write_confirmed
 *        implemented + effective_access "r"  -> implemented_read
 *        implemented (other effective_access) -> implemented_other
 *        source_only_unimplemented / partially_implemented /
 *          implementation_only_unverified     -> catalog_only
 *      6c. zero such fields (e.g. only a reserved placeholder sibling,
 *          like the 0x12EE half-register's OWN half not yet being this
 *          parameter's half) -> missing
 *
 * Run:
 *   node tools/protocol/authoring/build_stage3_status_map.js
 *   node tools/protocol/authoring/build_stage3_status_map.js --check
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const MANIFEST_PATH = path.join(ROOT, "protocol", "generated", "bms_v1_1_manifest.json");
const CANONICAL_PATH = path.join(ROOT, "protocol", "registers.canonical.json");
const LOCATORS_PATH = path.join(ROOT, "protocol", "generated", "pdf_locators.json");
const BLOCKERS_PATH = path.join(ROOT, "protocol", "evidence", "protocol_blockers.json");
const OUT_PATH = path.join(ROOT, "protocol", "generated", "stage3_status_map.json");
const CHECK = process.argv.includes("--check");

function loadJson(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
function sha256(p) { return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex"); }

// WIRE-POSITION match between one manifest parameter's own address
// (base_address + bit OR byte_half OR neither) and one canonical field at
// that SAME base_address (2026-09-19, user-directed fail-open-bug fix --
// see this file's own header comment for the full incident: Special
// Charger/0x1114-bit5 and AlarmBatUVP/0x12A0-bit12 were both classified
// "implemented_read" solely because SOME OTHER field existed at their
// shared address, never checking whether that field occupied THEIR own
// bit/byte slot).
//
// TERMINOLOGY (2026-09-19 hardening pass, corrected): this function proves
// only WIRE-POSITION identity -- that a manifest parameter's declared
// bit/byte-half/whole-register slot at an address coincides with a
// canonical field's declared slot at the same address. It is NOT full
// SEMANTIC identity -- it does not know or verify that the two names refer
// to the same real-world quantity, only that they occupy the same wire
// location. Two same-position entries with genuinely different meanings
// (an aliasing/collision case) would still match here; classifyOne()'s
// caller-side ambiguity guard (below) is what keeps a *positional*
// collision from being silently resolved as if it were also a semantic
// one -- when more than one canonical field or manifest parameter shares
// a position, this project refuses to guess which pairing is the real
// semantic one and fails closed instead (see the >1-match branch in
// classifyOne()). A full 265-parameter audit (2026-09-19) found zero
// wire-position collisions in the current production data -- every real
// manifest parameter's position matches at most one canonical field, and
// no two non-bit_unspecified manifest parameters share a position -- so
// this guard is defense-in-depth against a *future* collision, not a fix
// for an existing one.
//
// Position rules, cross-checked against every real packed-sibling
// register in registers.canonical.json before being written (26 real
// 8-bit byte-half fields, 100% follow byte_offset=0/mask=0xFF00=high and
// byte_offset=1/mask=0x00FF=low with zero exceptions; the 1 real BIT
// field follows mask=(1<<shift) with zero exceptions; all 185
// whole-register-width fields have field_width_bits===register_width_bits,
// mask either the full-width value or null for ASCII/multi-word fields)
// -- this is not a guessed convention, it is the actual, universal shape
// of the data this generator already reads.
function fieldOccupiesManifestParamWirePosition(pAddr, field, registerWidthBits) {
  if (pAddr.bit_unspecified) return false; // e.g. TemperatureSensorAnomaly -- cannot match anything, even correctly-blocked ones must never silently resolve via this path
  if (pAddr.bit !== null && pAddr.bit !== undefined && pAddr.byte_half != null) {
    // Compound address (2026-09-20 hardening, discovered while authoring
    // the 0x12D0 cluster): the manifest's own address-parsing convention
    // represents "BITn of the PDF's high/low byte sub-row" as byte_half +
    // a BYTE-RELATIVE bit (0-7), not a register-absolute one -- confirmed
    // against 0x12D0's real manifest rows (MOSTempSensorPresent..
    // BATTempSensor5Present, byte_half="high", bit=0..5, matching the
    // PDF's own per-byte "BIT0".."BIT5" labels, which restart from 0 at
    // each byte, not at the register's own bit 0). A canonical field's own
    // shift is always register-absolute (e.g. shift=9 for high-byte bit1
    // of a 16-bit register), so the byte-relative manifest bit must be
    // translated to the same absolute frame before comparing: high byte
    // bit N -> absolute shift (registerWidthBits-8)+N; low byte bit N ->
    // absolute shift N. Only meaningful for byte_half booleans within an
    // 8-bit sub-byte of a wider register (registerWidthBits > 8); a
    // register that is itself exactly 8 bits wide has no "byte within a
    // byte" concept and this branch is not reached for one (no
    // byte_half-carrying field width_bits===8 register exists in this
    // catalog as of this writing).
    const absoluteShift = pAddr.byte_half === "high" ? (registerWidthBits - 8) + pAddr.bit : pAddr.bit;
    return field.wire_type === "BIT" && field.shift === absoluteShift;
  }
  if (pAddr.bit !== null && pAddr.bit !== undefined) {
    return field.wire_type === "BIT" && field.shift === pAddr.bit;
  }
  if (pAddr.byte_half === "high") {
    return field.field_width_bits === 8 && field.wire_type !== "BIT" && field.byte_offset === 0 && field.mask === "0xFF00";
  }
  if (pAddr.byte_half === "low") {
    return field.field_width_bits === 8 && field.wire_type !== "BIT" && field.byte_offset === 1 && field.mask === "0x00FF";
  }
  // Neither a bit nor a byte-half: a whole-register manifest parameter.
  // Matches a field spanning the register's full declared width (covers
  // both bitmask-width-mask fields like sensor_heating_mask=0xFFFF and
  // ASCII/multi-word fields like setup_passcode, whose mask is null).
  return field.field_width_bits === registerWidthBits;
}

function classifyOne(p, canonByAddr, blockedIds, locatorById) {
  const addr = p.address.base_address;

  if (p.classification === "reserved") return { status: "reserved", note: "manifest classification=reserved" };
  if (p.classification === "derived") return { status: "derived_not_a_register", note: "manifest classification=derived (not a hardware register)" };

  // Permanent bit_unspecified classification (2026-09-22, unmapped-rows
  // cleanup): a manifest parameter whose own address carries
  // bit_unspecified=true has no documented bit position in either the
  // official PDF or the V1.1/V2 workbook (confirmed: as of this writing
  // exactly 2 manifest parameters, TemperatureSensorAnomaly and
  // PCLModuleAnomaly, carry this flag) -- assigning one from availability
  // or ordering would be fabrication, and
  // fieldOccupiesManifestParamWirePosition() already refuses to match
  // such a parameter to ANY canonical field, by construction (see its own
  // early bit_unspecified guard above). Checked here BEFORE the
  // open-blocker check, so this classification is stable and
  // DETERMINISTIC regardless of whether this parameter's own
  // protocol_blockers.json entry is open or closed -- the whole point is
  // that closing the blocker (recording the permanent-unsupported
  // resolution) must never cause this parameter to regress to a generic
  // "missing" status, and the classification must never depend on
  // keeping an "open blocker" forever to stay honestly reported.
  if (p.address && p.address.bit_unspecified) {
    return {
      status: "unsupported_bit_position_undocumented",
      note: "MANUFACTURER_BIT_POSITION_NOT_DOCUMENTED: neither the official PDF nor the V1.1/V2 workbook states which bit within this packed register this parameter occupies -- permanently classified unsupported/unaddressable as an individual value, not a guessable gap.",
    };
  }

  if (blockedIds.has(p.id)) {
    return { status: "blocked", note: "named in an open protocol_blockers.json entry" };
  }

  const canonRegs = canonByAddr.get(addr) || [];
  if (canonRegs.length === 0) {
    const loc = locatorById.get(p.id);
    const hasResolvedPdf = Boolean(loc && loc.pdf_locator);
    return { status: "missing", note: hasResolvedPdf ? "no canonical register at this address; PDF locator resolved" : "no canonical register at this address; PDF locator unresolved (unexpected -- should have an open blocker)" };
  }

  // Fail-closed field selection: only fields that are WIRE-POSITION
  // matches for THIS parameter's own bit/byte/whole-register address may
  // ever drive its classification. A sibling field existing at the same
  // address (a different bit, the other byte-half, or an unrelated
  // whole-register field) is never sufficient by itself -- see the
  // function comment above for why this was previously wrong.
  const positionMatches = [];
  for (const reg of canonRegs) {
    for (const f of reg.fields) {
      if (fieldOccupiesManifestParamWirePosition(p.address, f, reg.register_width_bits)) {
        positionMatches.push({ registerAddress: reg.address, key: f.key, implementation_status: f.implementation_status, effective_access: f.effective_access });
      }
    }
  }

  // Ambiguity guard (2026-09-19 hardening pass): a WIRE-POSITION match is
  // not the same thing as a proven SEMANTIC match (see the function
  // comment above). If more than one canonical field occupies this
  // parameter's exact position, this generator has no principled way to
  // pick which one is "really" this parameter's own field -- guessing by
  // name similarity is explicitly forbidden by this project's evidence
  // policy. Fail closed: never implemented_*, and say exactly why, rather
  // than silently picking the first match (which is what an unguarded
  // `.some()`/`.find()` over this array would have done). Reuses the
  // existing "missing" status rather than inventing a new one -- a full
  // 265-parameter audit (2026-09-19) found zero real occurrences of this
  // case in current production data, so a new status would add schema/
  // counts/consumer surface for a branch nothing exercises today; if a
  // real collision is ever found, that is the point to reopen this
  // decision, not before.
  if (positionMatches.length > 1) {
    const describe = positionMatches.map((m) => `${m.registerAddress}:${m.key}`).join(", ");
    return { status: "missing", note: `AMBIGUOUS wire-position match -- ${positionMatches.length} canonical fields (${describe}) occupy this parameter's exact bit/byte/whole-register position; refusing to guess which one is this parameter's own semantic field, so this parameter is not classified implemented_* until the canonical side is disambiguated` };
  }

  if (positionMatches.some((s) => s.implementation_status === "implemented" && s.effective_access === "rw")) {
    return { status: "implemented_write_confirmed", note: "canonical field implemented (unique wire-position match), effective_access=rw" };
  }
  if (positionMatches.some((s) => s.implementation_status === "implemented" && s.effective_access === "r")) {
    return { status: "implemented_read", note: "canonical field implemented (unique wire-position match), effective_access=r" };
  }
  if (positionMatches.some((s) => s.implementation_status === "implemented")) {
    return { status: "implemented_other", note: "canonical field implemented (unique wire-position match), effective_access neither r nor rw" };
  }
  if (positionMatches.some((s) => ["source_only_unimplemented", "partially_implemented", "implementation_only_unverified"].includes(s.implementation_status))) {
    return { status: "catalog_only", note: "canonical field exists (unique wire-position match) but not implementation_status=implemented" };
  }
  // Either no field at this address occupies THIS parameter's own wire
  // position at all (a sibling bit/byte/whole-field exists, but not this
  // one's own), or exactly one does but its implementation_status is
  // something else entirely -- either way, this parameter's own data is
  // not yet captured by anything, and it is not named in any open
  // blocker either (checked above) -- a real, fail-closed gap this
  // generator surfaces honestly rather than silently inheriting a
  // sibling's status.
  return { status: "missing", note: "canonical register exists at this address, but no field occupies this parameter's own exact bit/byte/whole-register wire position -- this parameter's own data is not yet modeled, and it is not named in any open blocker either" };
}

function build() {
  const manifest = loadJson(MANIFEST_PATH);
  const canonical = loadJson(CANONICAL_PATH);
  const locators = loadJson(LOCATORS_PATH);
  const blockers = loadJson(BLOCKERS_PATH);

  const locatorById = new Map(locators.locators.map((l) => [l.id, l]));
  const blockedIds = new Set();
  for (const b of blockers.blockers) {
    if (b.status !== "open") continue;
    for (const id of b.parameter_id.split(",")) blockedIds.add(id.trim());
  }
  const canonByAddr = new Map();
  for (const r of canonical.registers) {
    if (!canonByAddr.has(r.address)) canonByAddr.set(r.address, []);
    canonByAddr.get(r.address).push(r);
  }

  const parameters = manifest.parameters.map((p) => {
    const { status, note } = classifyOne(p, canonByAddr, blockedIds, locatorById);
    return {
      id: p.id,
      base_address: p.address.base_address,
      access: p.access,
      classification: p.classification,
      status,
      note,
    };
  });

  const counts = {};
  for (const p of parameters) counts[p.status] = (counts[p.status] || 0) + 1;

  return {
    $comment: "GENERATED -- Stage 3 (typed-petting-puzzle plan) preflight deliverable: wire-position-based status of every one of the 265 manifest parameters against the CURRENT registers.canonical.json and CURRENT open protocol_blockers.json entries. 'Wire-position' means bit/byte-half/whole-register slot identity, not proven semantic identity -- a status is implemented_* only when exactly one canonical field occupies a parameter's own wire position; more than one such field yields status=missing with an explicit AMBIGUOUS note rather than a guess (see tools/protocol/authoring/build_stage3_status_map.js's own header comment). NOT a mechanical manifest-count-vs-canonical-count comparison -- packed fields, aliases, and derived entities have a different structure between the two catalogs. DO NOT EDIT BY HAND. Regenerate with tools/protocol/authoring/build_stage3_status_map.js. Because this reads the CURRENT canonical/blocker state (which Stage 3 itself will change), this file's own committed content reflects one snapshot in the stage's history -- re-run this generator (and its own --check) after each canonical/blocker change within Stage 3, exactly like every other generator in this pipeline.",
    manifest_source_sha256: sha256(MANIFEST_PATH),
    canonical_source_sha256: sha256(CANONICAL_PATH),
    blockers_source_sha256: sha256(BLOCKERS_PATH),
    parameter_count: parameters.length,
    counts,
    parameters,
  };
}

function main() {
  const output = build();
  const serialized = JSON.stringify(output, null, 2) + "\n";
  if (CHECK) {
    if (!fs.existsSync(OUT_PATH)) {
      console.error("build_stage3_status_map.js --check: DRIFT -- protocol/generated/stage3_status_map.json does not exist.");
      process.exit(1);
    }
    if (fs.readFileSync(OUT_PATH, "utf8") !== serialized) {
      console.error("build_stage3_status_map.js --check: DRIFT -- protocol/generated/stage3_status_map.json does not match a fresh regeneration.");
      process.exit(1);
    }
    console.log("build_stage3_status_map.js --check: no drift.");
    return;
  }
  fs.writeFileSync(OUT_PATH, serialized);
  console.log(`wrote ${path.relative(ROOT, OUT_PATH)}`);
  console.log(`${output.parameter_count} parameters:`);
  for (const [status, n] of Object.entries(output.counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${status}`);
  }
}

if (require.main === module) {
  main();
}

// Exported for direct unit testing of the pure classification logic
// (2026-09-19 hardening pass) -- specifically so regression tests can
// construct synthetic collision fixtures (two manifest IDs / two
// canonical fields sharing one wire position) that do not exist anywhere
// in current production data, without needing to fabricate a full,
// on-disk manifest/canonical/blockers file trio. No behavior change to
// the CLI entry point: `node build_stage3_status_map.js` still runs
// exactly as before via the require.main guard above.
module.exports = { fieldOccupiesManifestParamWirePosition, classifyOne };
