#!/usr/bin/env node
"use strict";

// Converts source-specific indexes into field/claim-level evidence. Address
// presence never silently confirms scale, unit, access, or write transforms.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const rootArg = process.argv.indexOf("--root");
const ROOT = rootArg === -1 ? path.join(__dirname, "..", "..") : path.resolve(process.argv[rootArg + 1]);
const outputArg = process.argv.indexOf("--output");
const OUTPUT = outputArg === -1 ? path.join(ROOT, "protocol/generated/claim_matrix.json") : path.resolve(process.argv[outputArg + 1]);
const CHECK = process.argv.includes("--check");
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const sha = (data) => crypto.createHash("sha256").update(data).digest("hex");
const stable = (value) => JSON.stringify(value, Object.keys(value || {}).sort());

const catalog = read("protocol/registers.canonical.json");
const sourceDoc = read("protocol/evidence/sources.json");
const workbook = read("protocol/evidence/workbook_index.json");
const upstream = read("protocol/evidence/upstream_index.json");
const implementation = read("protocol/evidence/implementation_index.json");
const sources = new Map(sourceDoc.sources.map((s) => [s.source_id, s]));

const REQUIRED_WRITE_CLAIMS = Object.freeze([
  "address", "register_width", "word_count", "payload_byte_length", "byte_order", "word_order",
  "field_width", "mask_shift_byte_offset", "signedness", "wire_type",
  "scale", "offset", "canonical_unit", "raw_encode_decode_transform",
  "minimum_maximum_step", "declared_access", "write_function",
  "readback_function_comparator", "packed_atomicity_preserve_sibling",
  "model_protocol_applicability", "safety_class",
]);

function sourceRecord(sourceId, locator, claimType, value) {
  const source = sources.get(sourceId);
  return {
    source_id: sourceId,
    locator,
    claim_type: claimType,
    normalized_value: value,
    fingerprint: source.fingerprint,
    provenance_status: source.provenance_status,
    derivation_group: source.derivation_group,
  };
}

function implValue(claim, register, field) {
  const values = {
    address: register.address,
    register_width: register.register_width_bits,
    word_count: register.word_count,
    payload_byte_length: register.payload_bytes,
    byte_order: register.byte_order,
    word_order: register.word_order,
    field_width: field.field_width_bits,
    mask_shift_byte_offset: { mask: field.mask, shift: field.shift, byte_offset: field.byte_offset },
    signedness: field.signedness,
    wire_type: field.wire_type,
    scale: field.scale,
    offset: field.offset,
    canonical_unit: field.canonical_unit,
    declared_access: field.access,
    minimum_maximum_step: { minimum: field.minimum, maximum: field.maximum, step: field.step },
    implementation_entity_mapping: {
      domain: field.esphome_domain,
      read_entity_id: field.esphome_read_entity_id,
      write_entity_id: field.esphome_write_entity_id,
      backend_key: field.backend_key,
    },
  };
  return values[claim];
}

function addClaim(claims, record) {
  if (record.normalized_value === undefined) return;
  (claims[record.claim_type] ||= []).push(record);
}

function deriveField(register, field) {
  const claims = {};
  const implBlocks = implementation.address_index[register.address] || [];
  if (["implemented", "partially_implemented"].includes(field.implementation_status) && implBlocks.length) {
    const locator = `batterylifepo4.yaml:${implBlocks[0].start_line}-${implBlocks[0].end_line}`;
    for (const claim of sources.get("project_implementation").claims_supported) {
      addClaim(claims, sourceRecord("project_implementation", locator, claim, implValue(claim, register, field)));
    }
  }

  const workbookRows = workbook.address_index[register.address] || [];
  for (const row of workbookRows) {
    const locator = `${row.sheet}!${row.cell_range}`;
    addClaim(claims, sourceRecord("workbook_lifepo4_bms_parameters_registers", locator, "address", register.address));
    // A compound, unqualified row is not silently assigned to every sibling.
    const appliesToField = register.fields.length === 1 || row.byte_qualifier || String(row.label || "").toLowerCase().includes(field.frontend_label_uk.toLowerCase());
    if (appliesToField) {
      addClaim(claims, sourceRecord("workbook_lifepo4_bms_parameters_registers", locator, "field_label_uk", row.label));
      addClaim(claims, sourceRecord("workbook_lifepo4_bms_parameters_registers", locator, "observed_decoded_value", row.value_observed));
      addClaim(claims, sourceRecord("workbook_lifepo4_bms_parameters_registers", locator, "declared_access", String(row.access || "").toLowerCase()));
    }
  }

  const upstreamEntries = upstream.address_index[register.address] || [];
  for (const entry of upstreamEntries) {
    const locator = `protocol/evidence/upstream_esp32-jk-pb-modbus-example.yaml:${entry.start_line}-${entry.end_line}`;
    addClaim(claims, sourceRecord("upstream_syssi_esphome_jk_bms", locator, "address", register.address));
    if (entry.kind === "comment_table_row") {
      addClaim(claims, sourceRecord("upstream_syssi_esphome_jk_bms", locator, "wire_type", entry.wire_type));
      addClaim(claims, sourceRecord("upstream_syssi_esphome_jk_bms", locator, "declared_access", entry.declared_access));
      addClaim(claims, sourceRecord("upstream_syssi_esphome_jk_bms", locator, "canonical_unit", entry.displayed_unit));
    } else if (entry.kind === "yaml_entity_block") {
      addClaim(claims, sourceRecord("upstream_syssi_esphome_jk_bms", locator, "implementation_entity_mapping", {
        platform: entry.platform, id: entry.id || null, name: entry.name || null,
        value_type: entry.value_type || null, register_count: entry.register_count || null,
        response_size: entry.response_size || null, unit: entry.unit_of_measurement || null,
        has_filters: entry.has_filters, has_lambda: entry.has_lambda, has_set_action: entry.has_set_action,
      }));
    }
  }

  // Hardware audit citations are observation-only: without a raw frame they
  // do not add address/scale/access/write claims.
  const hardwareCitation = field.evidence.find((e) => e.source_id === "hardware_audit_2026_09_09");
  if (hardwareCitation) {
    addClaim(claims, sourceRecord("hardware_audit_2026_09_09", hardwareCitation.locator, "observed_decoded_value", "observed; exact decoded value is in the cited audit row"));
  }

  const verdicts = {};
  for (const [claimType, records] of Object.entries(claims)) {
    const byValue = new Map();
    for (const record of records) {
      if (record.provenance_status === "unknown") continue;
      const key = stable(record.normalized_value);
      const groups = byValue.get(key) || new Set();
      groups.add(record.derivation_group);
      byValue.set(key, groups);
    }
    const confirmed = [...byValue.values()].some((groups) => groups.size >= 2);
    const conflict = byValue.size > 1;
    verdicts[claimType] = { confirmed, conflict, evidence_count: records.length };
  }
  const missingWriteClaims = REQUIRED_WRITE_CLAIMS.filter((claim) => !verdicts[claim] || !verdicts[claim].confirmed);
  const writeReady = field.access === "rw" && missingWriteClaims.length === 0;
  // Mirrors semantic-checks.js's derivedAccess: owner_write_override is a
  // hand-authored risk acceptance that may license "rw" independently of
  // writeReady, so this claim-level check agrees with it rather than
  // re-flagging every field the owner already reviewed and authorized.
  const ownerAuthorized = !!(field.owner_write_override && field.owner_write_override.authorized === true && field.access === "rw");
  const dynamicDependencyUnresolved = !!(field.dynamic_dependency && field.dynamic_dependency.resolved === false);
  const derivedEffectiveAccess = field.access === "rw"
    ? ((writeReady || ownerAuthorized) && (ownerAuthorized || !dynamicDependencyUnresolved) ? "rw" : "r")
    : field.effective_access;
  return {
    key: field.key,
    register_id: register.register_id,
    address: register.address,
    claims,
    claim_verdicts: verdicts,
    read_readiness: Object.keys(claims).length ? "implemented_unverified" : "unsupported",
    write_readiness: writeReady ? "ready" : "blocked",
    missing_write_claims: missingWriteClaims,
    owner_authorized: ownerAuthorized,
    derived_effective_access: derivedEffectiveAccess,
    stored_effective_access: field.effective_access,
    policy_consistent: derivedEffectiveAccess === field.effective_access,
  };
}

const fields = [];
for (const register of catalog.registers) for (const field of register.fields) fields.push(deriveField(register, field));
const output = {
  "$comment": "GENERATED claim-level evidence matrix. Absence of a confirmed required claim is fail-closed.",
  "catalog_version": catalog.catalog_version,
  "source_manifest_sha256": sha(fs.readFileSync(path.join(ROOT, "protocol/evidence/sources.json"))),
  "required_write_claims": REQUIRED_WRITE_CLAIMS,
  "counts": {
    physical_registers: catalog.registers.length,
    logical_fields: fields.length,
    write_ready: fields.filter((f) => f.write_readiness === "ready").length,
    write_blocked: fields.filter((f) => f.write_readiness === "blocked").length,
    policy_inconsistent: fields.filter((f) => !f.policy_consistent).length,
  },
  fields,
};
const text = JSON.stringify(output, null, 2) + "\n";
if (CHECK) {
  const current = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, "utf8") : null;
  if (current !== text) { console.error("CLAIM_MATRIX_STALE"); process.exit(1); }
  if (output.counts.policy_inconsistent) { console.error("CLAIM_POLICY_INCONSISTENT"); process.exit(1); }
  console.log(`claim-matrix PASS fields=${fields.length} write_ready=${output.counts.write_ready}`);
} else {
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, text);
  console.log(`wrote ${path.relative(ROOT, OUTPUT)}; fields=${fields.length} write_ready=${output.counts.write_ready}`);
}
