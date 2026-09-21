#!/usr/bin/env node
"use strict";

/*
 * Stage 4 (typed-petting-puzzle plan §5, Phase 1): authoritative, generated
 * 97-row inventory of every manifest RW parameter against the CURRENT
 * registers.canonical.json, protocol_blockers.json, and
 * protocol/generated/write_registry.json.
 *
 * Reuses build_stage3_status_map.js's own real, production
 * fieldOccupiesManifestParamWirePosition() matcher -- wire-position
 * identity, never a name/string-similarity guess (see that file's own
 * TERMINOLOGY comment).
 *
 * 97 vs 96 RECONCILIATION (documented here, not smoothed over): the
 * manifest's 97 RW rows map onto exactly 96 canonical fields with
 * access==="rw", NOT 97 -- one manifest row, "ChargingFloatMode" (0x1114
 * bit9), occupies the SAME wire position as a real canonical field
 * (charging_float_mode), but that field's own access is "r", not "rw" --
 * contradicting the manifest's own RW classification. The canonical
 * field's access="r" carries THREE citations (project_implementation,
 * a V1 workbook row explicitly stating "access R", and the upstream
 * syssi implementation, which exposes it read-only) that all agree with
 * each other; the manifest's RW claim (from the separate V2 workbook) has
 * NO PDF locator and no corroboration. This is treated as a genuine V2-
 * workbook data error for this one row, not a gap in this project's own
 * modeling -- registers.canonical.json is NOT changed to match the
 * manifest's overclaim (this project's own no-fabricated-derivation
 * policy); ChargingFloatMode is MATCHED (not ambiguous, not duplicated,
 * not missing) to its real canonical field, and classified "blocked" with
 * an explicit MANIFEST_RW_CLAIM_CONTRADICTED_BY_CANONICAL_ACCESS reason.
 *
 * Stage 4 states (mutually exclusive, one per row):
 *   accounted              -- canonical entry exists, nothing more true yet
 *   read-implemented       -- canonical field's own implementation_status
 *                              is "implemented" (real, live, verified read)
 *   write-software-ready   -- a real, generated write path exists for this
 *                              field (protocol/generated/write_registry.json
 *                              OR the original 18 owner-authorized fields)
 *   write-hardware-verified -- write-software-ready AND independently
 *                              confirmed on real hardware at least once
 *                              (the original 18 -- stage3_status_map.json's
 *                              own implemented_write_confirmed count)
 *   blocked                -- write access blocked for a specific,
 *                              recorded reason; read side may still be
 *                              fully implemented (tracked separately, see
 *                              read_implemented boolean -- never lost)
 *
 * Run:
 *   node tools/protocol/authoring/build_stage4_rw_inventory.js
 *   node tools/protocol/authoring/build_stage4_rw_inventory.js --check
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { fieldOccupiesManifestParamWirePosition } = require("./build_stage3_status_map.js");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const MANIFEST_PATH = path.join(ROOT, "protocol", "generated", "bms_v1_1_manifest.json");
const CANONICAL_PATH = path.join(ROOT, "protocol", "registers.canonical.json");
const BLOCKERS_PATH = path.join(ROOT, "protocol", "evidence", "protocol_blockers.json");
const WRITE_REGISTRY_PATH = path.join(ROOT, "protocol", "generated", "write_registry.json");
const OUT_PATH = path.join(ROOT, "protocol", "generated", "stage4_rw_inventory.json");
const CHECK = process.argv.includes("--check");

function loadJson(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
function sha256(p) { return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex"); }

const manifest = loadJson(MANIFEST_PATH);
const canonical = loadJson(CANONICAL_PATH);
const blockersDoc = loadJson(BLOCKERS_PATH);
const writeRegistry = loadJson(WRITE_REGISTRY_PATH);
const writeRegistryByKey = new Map(writeRegistry.entries.map((e) => [e.key, e]));

const openBlockedNames = new Set();
const blockerByName = new Map();
for (const b of blockersDoc.blockers) {
  if (b.status !== "open") continue;
  for (const name of b.parameter_id.split(",")) {
    const trimmed = name.trim();
    openBlockedNames.add(trimmed);
    blockerByName.set(trimmed, b);
  }
}

const canonByAddr = new Map();
for (const reg of canonical.registers) {
  if (!canonByAddr.has(reg.address)) canonByAddr.set(reg.address, []);
  canonByAddr.get(reg.address).push(reg);
}

const rwParams = manifest.parameters.filter((p) => p.access === "RW");

const rows = [];
let ambiguousCount = 0;
let unmatchedCount = 0;
let duplicatedCanonicalKeys = new Map(); // canonical key -> [manifest ids]

for (const p of rwParams) {
  const addr = p.address.base_address;
  const regsAtAddr = canonByAddr.get(addr) || [];
  const matches = [];
  for (const reg of regsAtAddr) {
    for (const field of reg.fields) {
      if (fieldOccupiesManifestParamWirePosition(p.address, field, reg.register_width_bits)) {
        matches.push({ reg, field });
      }
    }
  }

  const row = {
    manifest_id: p.id,
    manifest_address: addr,
    canonical_key: null,
    match_status: null,
    register_id: null,
    address: addr,
    read_function: null,
    write_function: null,
    declared_access: null,
    effective_access: null,
    wire_type: null,
    signedness: null,
    scale: null,
    offset: null,
    minimum: null,
    maximum: null,
    enum_map: null,
    word_count: null,
    payload_bytes: null,
    byte_order: null,
    word_order: null,
    mask: null,
    shift: null,
    packed_siblings: null,
    verification_status: null,
    evidence_derivation_groups: null,
    write_safety_class: null,
    owner_write_override: null,
    current_write_endpoint: null,
    write_uses_read_modify_write: null,
    stage4_state: null,
    read_implemented: false,
    write_software_ready: false,
    write_hardware_verified: false,
    blocked_reason: null,
    blocker_closure_criterion: null,
    hardware_verification_provenance: null,
    revalidation_required: false,
  };

  if (regsAtAddr.length === 0) {
    unmatchedCount += 1;
    row.match_status = "unmatched";
    row.stage4_state = "blocked";
    row.blocked_reason = "NO_CANONICAL_REGISTER_AT_ADDRESS";
    row.blocker_closure_criterion = "A canonical register must be authored at this address before this parameter can progress beyond 'blocked'.";
    rows.push(row);
    continue;
  }
  if (matches.length === 0) {
    unmatchedCount += 1;
    row.match_status = "unmatched";
    row.stage4_state = "blocked";
    row.blocked_reason = "NO_FIELD_AT_WIRE_POSITION";
    row.blocker_closure_criterion = "A canonical field must be authored at this exact bit/byte-half/whole-register wire position before this parameter can progress beyond 'blocked'.";
    rows.push(row);
    continue;
  }
  if (matches.length > 1) {
    ambiguousCount += 1;
    row.match_status = "ambiguous";
    row.stage4_state = "blocked";
    row.blocked_reason = "AMBIGUOUS_WIRE_POSITION_MATCH";
    row.blocker_closure_criterion = `More than one canonical field (${matches.map((m) => m.field.key).join(", ")}) occupies this exact wire position -- must be resolved to exactly one before this parameter can progress.`;
    rows.push(row);
    continue;
  }

  const { reg, field } = matches[0];
  row.match_status = "matched";
  row.canonical_key = field.key;
  row.register_id = reg.register_id;
  row.read_function = reg.read_function;
  row.write_function = reg.write_function;
  row.declared_access = field.access;
  row.effective_access = field.effective_access;
  row.wire_type = field.wire_type;
  row.signedness = field.signedness;
  row.scale = field.scale;
  row.offset = field.offset;
  row.minimum = field.minimum;
  row.maximum = field.maximum;
  row.enum_map = field.enum_map;
  row.word_count = reg.word_count;
  row.payload_bytes = reg.payload_bytes;
  row.byte_order = reg.byte_order;
  row.word_order = reg.word_order;
  row.mask = field.mask;
  row.shift = field.shift;
  row.packed_siblings = field.packed_siblings;
  row.verification_status = field.verification_status;
  row.evidence_derivation_groups = [...new Set(field.evidence.map((e) => e.derivation_group))];
  row.write_safety_class = field.write_safety_class;
  row.owner_write_override = field.owner_write_override;
  row.current_write_endpoint = field.esphome_write_entity_id;
  row.write_uses_read_modify_write = field.write_uses_read_modify_write;
  row.read_implemented = field.implementation_status === "implemented";

  if (!duplicatedCanonicalKeys.has(field.key)) duplicatedCanonicalKeys.set(field.key, []);
  duplicatedCanonicalKeys.get(field.key).push(p.id);

  // Manifest RW claim contradicted by canonical's own, better-evidenced
  // access classification (the ChargingFloatMode case -- see this file's
  // own header comment).
  if (field.access !== "rw") {
    row.stage4_state = "blocked";
    row.blocked_reason = "MANIFEST_RW_CLAIM_CONTRADICTED_BY_CANONICAL_ACCESS";
    row.blocker_closure_criterion = `Canonical field "${field.key}" declares access="${field.access}" (evidenced: ${row.evidence_derivation_groups.join(", ")}), contradicting the manifest's own RW classification for "${p.id}". Requires independent (e.g. PDF) evidence resolving the contradiction before any write path can be built.`;
    rows.push(row);
    continue;
  }

  // Open blocker naming this field (by manifest id or canonical key).
  const blocker = blockerByName.get(p.id) || blockerByName.get(field.key);
  if (blocker) {
    row.stage4_state = "blocked";
    row.blocked_reason = "OPEN_BLOCKER";
    row.blocker_closure_criterion = blocker.closure_criterion;
    rows.push(row);
    continue;
  }

  if (field.write_safety_class === "unsupported") {
    row.stage4_state = "blocked";
    row.blocked_reason = "UNSUPPORTED_WRITE_SAFETY_CLASS";
    row.blocker_closure_criterion = "No known write mechanism exists in the protocol for this field's write_safety_class -- structurally blocked, not evidence-pending.";
    rows.push(row);
    continue;
  }
  if (field.write_safety_class === "n/a") {
    row.stage4_state = "blocked";
    row.blocked_reason = "WRITE_SAFETY_CLASS_NOT_YET_TRIAGED";
    row.blocker_closure_criterion = "write_safety_class is still the untriaged placeholder -- a deliberate, reasoned classification is required before any write path can be built.";
    rows.push(row);
    continue;
  }

  const registryEntry = writeRegistryByKey.get(field.key);
  const isOriginal18 = !!(field.owner_write_override && field.owner_write_override.authorized === true) && field.effective_access === "rw";

  if (field.effective_access !== "rw") {
    row.stage4_state = "blocked";
    if (field.minimum === null || field.maximum === null || field.step === null) {
      row.blocked_reason = "RANGE_NOT_ESTABLISHED";
      row.blocker_closure_criterion = "minimum/maximum/step are not established in canonical.json for this field -- a real write path requires a proven safe operating range, not a guessed one.";
    } else if (field.verification_status !== "confirmed") {
      row.blocked_reason = "INSUFFICIENT_EVIDENCE";
      row.blocker_closure_criterion = "verification_status is not \"confirmed\" (2+ independent evidence groups) and no owner_write_override exists -- evidence-pending, not guessed.";
    } else {
      row.blocked_reason = "NOT_YET_PROMOTED";
      row.blocker_closure_criterion = "Evidence and safety class are both sufficient, but no write path has been generated for this field yet.";
    }
    rows.push(row);
    continue;
  }

  row.write_software_ready = true;
  if (isOriginal18) {
    // Pre-existing, previously hardware-verified fields (Stage 1's own 18
    // implemented_write_confirmed set). This round's changes (schema
    // additions, the new write registry, the new RMW mechanism) do NOT
    // touch write_bms_u32/write_bms_u16 or their invocation for these
    // fields at all -- full-width writes are unaffected by the packed-RMW
    // work -- so no revalidation is required.
    row.stage4_state = "write-hardware-verified";
    row.write_hardware_verified = true;
    row.hardware_verification_provenance = "Pre-existing (Stage 1, owner-authorized 2026-09-10): real ACK + forced-readback write-transaction confirmed on real hardware. Unaffected by this Stage's schema/registry/RMW additions -- write_bms_u32/u16 dispatch is unchanged for full-width fields.";
    row.revalidation_required = false;
  } else if (registryEntry) {
    row.stage4_state = "write-software-ready";
    row.current_write_endpoint = registryEntry.entity_id;
  } else {
    // effective_access is rw (promoted) but somehow absent from the
    // registry -- fail closed rather than claim a state nothing backs.
    row.stage4_state = "blocked";
    row.write_software_ready = false;
    row.blocked_reason = "EFFECTIVE_ACCESS_RW_WITHOUT_REGISTRY_ENTRY";
    row.blocker_closure_criterion = "effective_access is rw but no write_registry.json entry exists for this field -- data inconsistency, must be resolved before this field can be trusted.";
  }
  rows.push(row);
}

// No manifest RW row silently duplicated onto the same canonical key
// alongside another DIFFERENT row (an aliasing bug this project's own
// wire-position matcher is specifically designed to catch) -- ChargingFloatMode
// sharing charging_float_mode with nobody else is fine; two DIFFERENT
// manifest ids sharing one canonical key would not be.
const duplicated = [...duplicatedCanonicalKeys.entries()].filter(([, ids]) => ids.length > 1);

const counts_by_state = {};
const counts_by_safety_class = {};
for (const row of rows) {
  counts_by_state[row.stage4_state] = (counts_by_state[row.stage4_state] || 0) + 1;
  const cls = row.write_safety_class || "unmatched";
  counts_by_safety_class[cls] = (counts_by_safety_class[cls] || 0) + 1;
}

const HEADER = "Generated by tools/protocol/authoring/build_stage4_rw_inventory.js from " +
  "protocol/generated/bms_v1_1_manifest.json + protocol/registers.canonical.json + " +
  "protocol/evidence/protocol_blockers.json + protocol/generated/write_registry.json. " +
  "DO NOT EDIT BY HAND. Authoritative 97-row Stage 4 RW inventory -- see this file's own header " +
  "comment for the full 97-vs-96 reconciliation and the exact Stage 4 state ladder.";

const outDoc = {
  $comment: HEADER,
  manifest_source_sha256: sha256(MANIFEST_PATH),
  canonical_source_sha256: sha256(CANONICAL_PATH),
  blockers_source_sha256: sha256(BLOCKERS_PATH),
  write_registry_source_sha256: sha256(WRITE_REGISTRY_PATH),
  row_count: rows.length,
  unmatched_count: unmatchedCount,
  ambiguous_count: ambiguousCount,
  duplicated_canonical_key_count: duplicated.length,
  counts_by_state,
  counts_by_safety_class,
  rows,
};

function atomicWrite(targetPath, content) {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(targetPath)}.tmp-${process.pid}`);
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, targetPath);
}

const jsonContent = JSON.stringify(outDoc, null, 2) + "\n";

if (CHECK) {
  const existing = fs.existsSync(OUT_PATH) ? fs.readFileSync(OUT_PATH, "utf8") : null;
  if (existing !== jsonContent) {
    console.log(`build_stage4_rw_inventory.js --check: DRIFT -- ${path.relative(ROOT, OUT_PATH)} does not match a fresh regeneration.`);
    process.exit(1);
  }
  console.log("build_stage4_rw_inventory.js --check: no drift.");
  process.exit(0);
}

atomicWrite(OUT_PATH, jsonContent);
console.log(`wrote ${path.relative(ROOT, OUT_PATH)}`);
console.log(`${rows.length} rows: ${JSON.stringify(counts_by_state)}`);
console.log(`unmatched=${unmatchedCount} ambiguous=${ambiguousCount} duplicated=${duplicated.length}`);
