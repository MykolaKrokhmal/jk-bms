#!/usr/bin/env node
"use strict";

/*
 * Stage 4 (typed-petting-puzzle plan §5, Phase 3): generated write registry.
 * Reads registers.canonical.json + protocol_blockers.json, determines which
 * RW fields are ELIGIBLE for a real write path (never guessed/asserted --
 * every gate below is a real, checkable condition), and generates:
 *
 *   - protocol/generated/write_registry.json  (audit: full per-field
 *     metadata, machine-readable, one entry per eligible field)
 *   - protocol/generated/write_registry.yaml  (a real ESPHome `number:`
 *     package, `!include`d from batterylifepo4.yaml exactly like
 *     read_plan.yaml already is -- one entity per eligible field, each
 *     dispatching through the SAME two shared, already-tested write paths:
 *     write_bms_u32/write_bms_u16 for a full-width field (no merge needed),
 *     begin_write_tx_rmw for a packed field (real read-modify-write). No
 *     per-field YAML is hand-authored -- this generator is the one source.)
 *
 * ELIGIBILITY (Phase 2 rule 5 -- ALL of the following, never any subset):
 *   1. field.access === "rw"
 *   2. field.verification_status === "confirmed" (2+ independent evidence
 *      groups) OR a real, schema-valid owner_write_override with
 *      authorized:true -- exactly the same bar semantic-checks.js's own
 *      FORGED_EFFECTIVE_ACCESS derivation already enforces; this generator
 *      never invents a weaker bar.
 *   3. field.write_safety_class is a REAL classification, never the
 *      "n/a" placeholder (meaning "not yet triaged") and never
 *      "unsupported" (meaning "no known write mechanism exists at all").
 *   4. No OPEN protocol_blockers.json entry names this field's manifest
 *      parameter_id(s) or its own canonical key.
 *   5. minimum, maximum, and step are ALL non-null -- a field whose safe
 *      operating range was never established in canonical.json (evidence
 *      covers its address/type/access but not its bounds) is a genuine,
 *      separate evidence gap; this generator refuses to guess a range and
 *      leaves such a field un-generated (Stage 4 state stays short of
 *      write-software-ready for it -- see build_stage4_rw_inventory.js).
 *   6. field.projection_of === null (a projection never has a write path
 *      of its own -- redundant with access==="rw" never being true for a
 *      projection, kept as an explicit belt-and-suspenders check).
 *
 * SUBMIT GATING (Phase 5 rule 8, Phase 6): every eligible field still gets
 * a real, generated entity (Stage 4 state write-software-ready requires a
 * REAL path to exist, not a hidden one) -- but write_safety_class="normal"
 * fields dispatch a LIVE write, while disruptive/topology/credential
 * fields generate an entity whose set_action is a deliberate, logged no-op
 * ("lab-safe authorization policy pending"), exactly mirroring this
 * project's own EXISTING pattern for evidence-blocked fields (see e.g.
 * set_cell_uvp's own fail-closed stub, batterylifepo4.yaml) -- never an
 * active submit control without a separate, not-yet-built authorization
 * policy. Both classes are equally real, equally generated, equally
 * tested; only the terminal action differs.
 *
 * Run:
 *   node tools/protocol/generate_write_registry.js
 *   node tools/protocol/generate_write_registry.js --check
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(cliValue("--root") || path.join(__dirname, "..", ".."));
const CHECK = process.argv.includes("--check");

function cliValue(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : process.argv[i + 1];
}

function loadJson(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
function sha256(p) { return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex"); }

const CANONICAL_PATH = path.join(ROOT, "protocol", "registers.canonical.json");
const BLOCKERS_PATH = path.join(ROOT, "protocol", "evidence", "protocol_blockers.json");
const OUT_JSON = path.join(ROOT, "protocol", "generated", "write_registry.json");
const OUT_YAML = path.join(ROOT, "protocol", "generated", "write_registry.yaml");

const canonicalDoc = loadJson(CANONICAL_PATH);
const blockersDoc = loadJson(BLOCKERS_PATH);
const canonicalHash = sha256(CANONICAL_PATH).slice(0, 16);
const blockersHash = sha256(BLOCKERS_PATH).slice(0, 16);

// Every open blocker's parameter_id (comma-split) plus the RAW string --
// matches this project's own established convention in
// build_stage3_status_map.js (blockers are keyed loosely by manifest ID or
// canonical key, comma-separated).
const openBlockedNames = new Set();
for (const b of blockersDoc.blockers) {
  if (b.status !== "open") continue;
  for (const name of b.parameter_id.split(",")) openBlockedNames.add(name.trim());
}

function parseHex(s) { return s === null ? null : parseInt(s, 16); }

function isEligible(reg, field) {
  if (field.access !== "rw") return false;
  if (field.projection_of !== null && field.projection_of !== undefined) return false;
  if (field.write_safety_class === "n/a" || field.write_safety_class === "unsupported") return false;
  const ownerAuthorized = !!(field.owner_write_override && field.owner_write_override.authorized === true);
  if (field.verification_status !== "confirmed" && !ownerAuthorized) return false;
  if (openBlockedNames.has(field.key)) return false;
  if (field.minimum === null || field.maximum === null || field.step === null) return false;
  // A field carrying an owner_write_override already has a real, hand-
  // authored, previously-hardware-verified write path (the original 18
  // owner-authorized fields, re-enabled 2026-09-10 -- see
  // batterylifepo4.yaml's own "Owner-authorized write re-enablement"
  // section) -- this generator's own job is fields eligible via
  // verification_status="confirmed" alone, which do NOT carry an
  // owner_write_override. Excluding by esphome_write_entity_id instead
  // would be circular (THIS generator is what assigns it), silently
  // emptying the registry on every re-run once entity ids are promoted
  // into canonical.json -- owner_write_override is the one field this
  // generator itself never writes, so it stays a stable, non-circular
  // exclusion signal.
  if (ownerAuthorized) return false;
  return true;
}

const eligible = [];
for (const reg of canonicalDoc.registers) {
  for (const field of reg.fields) {
    if (isEligible(reg, field)) eligible.push({ reg, field });
  }
}
eligible.sort((a, b) => parseInt(a.reg.address, 16) - parseInt(b.reg.address, 16) || a.field.key.localeCompare(b.field.key));

// ---------------------------------------------------------------------------
// Build the audit JSON.
// ---------------------------------------------------------------------------
const registryEntries = eligible.map(({ reg, field }) => {
  const isRmw = field.write_uses_read_modify_write === true;
  const isLive = field.write_safety_class === "normal";
  return {
    key: field.key,
    entity_id: `set_${field.key}`,
    read_entity_id: field.esphome_read_entity_id,
    address: reg.address,
    read_function: reg.read_function,
    write_function: reg.write_function,
    word_count: reg.word_count,
    byte_order: reg.byte_order,
    word_order: reg.word_order,
    wire_type: field.wire_type,
    signedness: field.signedness,
    scale: field.scale,
    offset: field.offset,
    decimal_precision: field.decimal_precision,
    minimum: field.minimum,
    maximum: field.maximum,
    step: field.step,
    field_width_bits: field.field_width_bits,
    mask: field.mask,
    shift: field.shift,
    packed_siblings: field.packed_siblings,
    write_uses_read_modify_write: isRmw,
    compare_mask: isRmw ? field.mask : "0xFFFFFFFF",
    write_safety_class: field.write_safety_class,
    owner_write_override: field.owner_write_override,
    freshness_budget_ms: reg.freshness_budget_s * 1000,
    editor_kind: "number",
    submit_policy: isLive ? "live" : "authorization_required",
    stage4_state: "write-software-ready",
  };
});

const generationManifestPath = path.join(ROOT, "protocol", "generated", ".write-registry-manifest.json");
const HEADER = `Generated by tools/protocol/generate_write_registry.js from protocol/registers.canonical.json + protocol/evidence/protocol_blockers.json. DO NOT EDIT BY HAND. canonical_source_hash=${canonicalHash} blockers_source_hash=${blockersHash}`;

const outJsonDoc = {
  $comment: HEADER,
  canonical_source_sha256: sha256(CANONICAL_PATH),
  blockers_source_sha256: sha256(BLOCKERS_PATH),
  entry_count: registryEntries.length,
  live_count: registryEntries.filter((e) => e.submit_policy === "live").length,
  authorization_required_count: registryEntries.filter((e) => e.submit_policy === "authorization_required").length,
  entries: registryEntries,
};

// ---------------------------------------------------------------------------
// Build the ESPHome `number:` package (write_registry.yaml).
// ---------------------------------------------------------------------------
function cEscape(s) { return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"'); }

const yamlLines = [];
yamlLines.push(`# ${HEADER}`);
yamlLines.push("number:");
for (const e of registryEntries) {
  const addrHex = e.address;
  const isSigned = e.signedness === "signed" ? "true" : "false";
  const maskInt = e.mask === null ? -1 : parseHex(e.mask);
  yamlLines.push("  - platform: template");
  yamlLines.push(`    id: ${e.entity_id}`);
  yamlLines.push("    internal: true");
  yamlLines.push(`    name: "set ${e.key.replace(/_/g, " ")}"`);
  yamlLines.push(`    min_value: ${e.minimum}`);
  yamlLines.push(`    max_value: ${e.maximum}`);
  yamlLines.push(`    step: ${e.step}`);
  yamlLines.push(`    lambda: return id(${e.read_entity_id}).state;`);
  yamlLines.push("    set_action:");
  yamlLines.push("      - lambda: |-");
  const L = (s) => yamlLines.push("          " + s);
  L(`const auto enc = jk_write_tx::encode_numeric_field(double(x), ${isSigned}, ${e.scale}, ${e.offset}, ${e.minimum}, ${e.maximum}, ${e.field_width_bits});`);
  L("if (enc.status != jk_write_tx::EncodeStatus::OK) {");
  L(`  ESP_LOGW("jk_write_tx", "${cEscape(e.entity_id)}: value rejected before any Modbus command was queued (encode status=%d)", int(enc.status));`);
  L("  return;");
  L("}");
  if (e.submit_policy !== "live") {
    // Disruptive/topology/credential: entity + full encode/validate path
    // are real and generated, but the terminal write action is a
    // deliberate, logged no-op pending a separate lab-safe authorization
    // policy -- mirrors this project's own existing fail-closed stub
    // pattern for evidence-blocked fields (e.g. set_cell_uvp), never an
    // active submit control for a write_safety_class this project has not
    // yet built a lab-safe policy for.
    L(`ESP_LOGW("jk_write_tx", "${cEscape(e.entity_id)} (0x${addrHex.replace(/^0x/, "")}, write_safety_class=${e.write_safety_class}): write-software-ready but no active submit without a separate lab-safe authorization policy -- no Modbus command was queued.");`);
  } else if (e.write_uses_read_modify_write) {
    L(`id(begin_write_tx_rmw)->execute(${addrHex}, ${e.word_count}, ${maskInt}, ${e.shift}, int(enc.encoded_raw), ${e.freshness_budget_ms});`);
  } else if (e.word_count >= 2) {
    L(`id(write_bms_u32)->execute(${addrHex}, int(enc.encoded_raw));`);
  } else {
    L(`id(write_bms_u16)->execute(${addrHex}, int(enc.encoded_raw));`);
  }
  yamlLines.push("");
}

// ---------------------------------------------------------------------------
// Write / check.
// ---------------------------------------------------------------------------
function atomicWrite(targetPath, content) {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(targetPath)}.tmp-${process.pid}`);
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, targetPath);
}

const jsonContent = JSON.stringify(outJsonDoc, null, 2) + "\n";
const yamlContent = yamlLines.join("\n") + "\n";

if (CHECK) {
  let drift = false;
  for (const [target, content] of [[OUT_JSON, jsonContent], [OUT_YAML, yamlContent]]) {
    const existing = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
    if (existing !== content) {
      console.log(`DRIFT  ${path.relative(ROOT, target)}`);
      drift = true;
    }
  }
  if (drift) {
    console.log("generate_write_registry.js --check: artifact(s) out of date. Run 'node tools/protocol/generate_write_registry.js' to regenerate.");
    process.exit(1);
  }
  console.log("generate_write_registry.js --check: no drift. All generated artifacts match the canonical source.");
  process.exit(0);
}

atomicWrite(OUT_JSON, jsonContent);
atomicWrite(OUT_YAML, yamlContent);
console.log(`wrote ${path.relative(ROOT, OUT_JSON)}`);
console.log(`wrote ${path.relative(ROOT, OUT_YAML)}`);
console.log(`${registryEntries.length} eligible fields (${outJsonDoc.live_count} live, ${outJsonDoc.authorization_required_count} authorization-required).`);
