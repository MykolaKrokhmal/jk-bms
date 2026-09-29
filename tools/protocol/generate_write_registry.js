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
 *   - protocol/generated/write_registry_table.h  (Stage 4 production-
 *     integration gap fix, 2026-09-21, user-directed: a COMPILED C++
 *     lookup table -- namespace jk_write_registry, array kEntries[] --
 *     the SAME per-field metadata as write_registry.json, but as data a
 *     firmware HTTP handler can actually iterate/binary-search by string
 *     key at runtime. Until this existed, the only production write path
 *     was one `number:` entity per field, individually `internal: true`,
 *     reachable only by ESPHome's own generic `/number/<id>/set` REST
 *     route -- which does not exist for an internal entity, and which a
 *     generic key+value POST handler could never look up anyway (no
 *     firmware-readable table of keys existed). This header is that
 *     table -- see batterylifepo4.yaml's RegisterWriteHandler/
 *     RegisterWritePreflightHandler for the two production HTTP handlers
 *     that consume it.)
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
const OUT_HEADER = path.join(ROOT, "protocol", "generated", "write_registry_table.h");

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

// Settings write migration (clustered-read plan M5, owner decision
// 2026-09-29): EXACTLY these 18 owner-authorized (owner_write_override),
// previously hardware-verified Settings fields move from their hand-written
// internal set_<key> entities into this generated registry, so the web UI
// writes them only through /settings/register-write. An explicit, closed
// list -- owner_write_override alone never makes a field eligible. Each one
// is migrated only if its canonical write facts are complete and consistent
// (migrationContradiction()); otherwise it stays out, with the reason
// recorded in write_registry.json's settings_write_migration table.
const SETTINGS_WRITE_MIGRATION_KEYS = Object.freeze([
  "smart_sleep", "cell_uvpr", "cell_ovpr", "start_balance_trigger", "soc_100", "soc_0", "cell_rcv", "cell_rfv",
  "charge_ocpr_time", "discharge_ocpr_time", "scpr_time", "max_balance_current", "charge_otpr", "discharge_otpr",
  "charge_utpr", "mos_otpr", "battery_capacity", "start_balance",
]);
const SETTINGS_WRITE_MIGRATION = new Set(SETTINGS_WRITE_MIGRATION_KEYS);
// Canonical wire types (register-source.schema.json): S16/S32 are the
// signed 16/32-bit types.
const WIRE_TYPE_BITS = { U16: 16, S16: 16, U32: 32, S32: 32 };

// null when the field's canonical write facts are complete and mutually
// consistent; otherwise the exact missing/contradictory fact. Never guesses.
function migrationContradiction(reg, field) {
  const missing = ["wire_type", "signedness", "scale", "offset", "minimum", "maximum", "step", "field_width_bits", "mask", "shift"]
    .filter((k) => field[k] === null || field[k] === undefined);
  if (reg.word_count !== 1 && reg.word_count !== 2) missing.push("word_count");
  if (!reg.write_function) missing.push("write_function");
  if (missing.length) return `missing canonical write fact(s): ${missing.join(", ")}`;
  if (field.signedness !== "signed" && field.signedness !== "unsigned") return `unknown signedness "${field.signedness}"`;
  if (field.signedness === "unsigned" && field.minimum < 0) {
    return `contradiction: signedness "unsigned" (wire_type ${field.wire_type}) with minimum ${field.minimum} ` +
      `-- an unsigned register cannot hold a negative value; the signed encoding is not established by canonical evidence`;
  }
  const bits = WIRE_TYPE_BITS[field.wire_type];
  if (bits === undefined) return `unsupported wire_type "${field.wire_type}"`;
  if ((field.wire_type[0] === "S") !== (field.signedness === "signed")) return `contradiction: wire_type ${field.wire_type} vs signedness ${field.signedness}`;
  if (bits !== 16 * reg.word_count || field.field_width_bits !== bits) {
    return `contradiction: wire_type ${field.wire_type} (${bits} bits) vs word_count ${reg.word_count} / field_width_bits ${field.field_width_bits}`;
  }
  const fullMask = bits === 32 ? "0xFFFFFFFF" : "0xFFFF";
  if (String(field.mask).toUpperCase() !== fullMask.toUpperCase() || field.shift !== 0) return `not a full-width field (mask ${field.mask}, shift ${field.shift})`;
  if (!(field.scale > 0) || !(field.step > 0)) return `non-positive scale ${field.scale} or step ${field.step}`;
  if (field.minimum > field.maximum) return `minimum ${field.minimum} > maximum ${field.maximum}`;
  const ratio = field.step / field.scale;
  if (Math.abs(ratio - Math.round(ratio)) > 1e-9) return `step ${field.step} is not a whole number of scale ${field.scale} units`;
  const maxRaw = bits === 32 ? 0xFFFFFFFF : 0xFFFF;
  if (field.signedness === "unsigned" && (field.maximum - field.offset) / field.scale > maxRaw) return `maximum ${field.maximum} does not fit ${bits} bits at scale ${field.scale}`;
  return null;
}

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
  if (ownerAuthorized) return SETTINGS_WRITE_MIGRATION.has(field.key) && migrationContradiction(reg, field) === null;
  // Fail LOUDLY, never silently, if a field otherwise eligible for a real
  // write path lives on a register with no write_function -- this should
  // already be structurally impossible (semantic-checks.js's own
  // WRITE_ENABLED_FIELD_WITHOUT_REGISTER_WRITE_FUNCTION invariant blocks
  // effective_access="rw" without one), so reaching this point means that
  // upstream guard was bypassed or this generator drifted from it --
  // exactly the class of metadata/runtime contradiction this round's own
  // audit found (write_registry.json write_function=null while the
  // runtime dispatched a real FC16). A generator that silently emitted a
  // "live" entity here would reproduce that exact bug.
  if (!reg.write_function) {
    throw new Error(`GENERATE_WRITE_REGISTRY_MISSING_WRITE_FUNCTION: field "${field.key}" on register ${reg.address} is otherwise eligible but its register has no write_function -- refusing to generate an entity for it`);
  }
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
  // The audited Settings write migration table: all 18 fields, their exact
  // canonical write facts and the outcome (migrated, or blocked + reason).
  settings_write_migration: SETTINGS_WRITE_MIGRATION_KEYS.map((key) => {
    let reg = null;
    let field = null;
    for (const r of canonicalDoc.registers) for (const f of r.fields) if (f.key === key) { reg = r; field = f; }
    if (!field) return { key, outcome: "blocked", blocked_reason: "no canonical field with this key" };
    const migrated = registryEntries.some((e) => e.key === key);
    const contradiction = migrationContradiction(reg, field);
    return {
      key,
      address: reg.address,
      word_count: reg.word_count,
      write_function: reg.write_function || null,
      wire_type: field.wire_type,
      signedness: field.signedness,
      scale: field.scale,
      offset: field.offset,
      minimum: field.minimum,
      maximum: field.maximum,
      step: field.step,
      unit: field.canonical_unit || null,
      mask: field.mask,
      shift: field.shift,
      write_safety_class: field.write_safety_class,
      outcome: migrated ? "migrated" : "blocked",
      blocked_reason: migrated ? null : (contradiction || "not eligible under the registry's other rules (see isEligible())"),
    };
  }),
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
// Build the compiled C++ lookup table (write_registry_table.h). One entry
// per eligible field, key-searchable at runtime by the production HTTP
// handlers (batterylifepo4.yaml) -- see this file's own module comment for
// why this exists as a THIRD generated artifact alongside the audit JSON
// and the ESPHome `number:` package, rather than the handler re-parsing
// write_registry.json at runtime (the firmware never reads JSON off its own
// flash for a hot request path -- a compiled array is this project's
// established convention, exactly like read_plan_decode.h's kFields).
// ---------------------------------------------------------------------------
function cppStringEscape(s) { return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"'); }

const headerLines = [];
headerLines.push(`// ${HEADER}`);
headerLines.push("//");
headerLines.push("// Data table only -- consumed by RegisterWriteHandler/RegisterWritePreflightHandler");
headerLines.push("// (batterylifepo4.yaml), which look up a request's string `key` against kEntries via");
headerLines.push("// find_entry_index(), then drive the SAME jk_write_tx::encode_numeric_field() /");
headerLines.push("// merge_field_into_raw() / begin_write_tx_rmw / write_bms_u32 / write_bms_u16 paths the");
headerLines.push("// generated write_registry.yaml `number:` entities already use -- this table never");
headerLines.push("// duplicates the write MECHANISM, only makes its per-field metadata string-key-");
headerLines.push("// addressable. Never hand-edit -- edit protocol/registers.canonical.json and");
headerLines.push("// tools/protocol/generate_write_registry.js, then regenerate.");
headerLines.push("#pragma once");
headerLines.push("");
headerLines.push("#include <cstdint>");
headerLines.push("#include <cstddef>");
headerLines.push("#include <cstring>");
headerLines.push("");
headerLines.push("namespace jk_write_registry {");
headerLines.push("");
headerLines.push("enum class SubmitPolicy : uint8_t { LIVE = 0, AUTHORIZATION_REQUIRED = 1 };");
headerLines.push("");
headerLines.push("struct Entry {");
headerLines.push("  const char *key;");
headerLines.push("  uint16_t address;");
headerLines.push("  uint8_t word_count;");
headerLines.push("  bool uses_rmw;");
headerLines.push("  uint32_t mask;          // 0xFFFFFFFF for a full-width (non-RMW) field");
headerLines.push("  uint8_t shift;");
headerLines.push("  bool is_signed;");
headerLines.push("  double scale;");
headerLines.push("  double offset;");
headerLines.push("  double minimum;");
headerLines.push("  double maximum;");
headerLines.push("  uint8_t field_width_bits;");
headerLines.push("  uint32_t freshness_budget_ms;");
headerLines.push("  SubmitPolicy submit_policy;");
headerLines.push("  const char *write_safety_class;");
headerLines.push("};");
headerLines.push("");
headerLines.push(`constexpr std::size_t kEntryCount = ${registryEntries.length};`);
headerLines.push("constexpr Entry kEntries[kEntryCount] = {");
for (const e of registryEntries) {
  const maskInt = e.mask === null ? 0xFFFFFFFF : (parseHex(e.mask) >>> 0);
  const policy = e.submit_policy === "live" ? "SubmitPolicy::LIVE" : "SubmitPolicy::AUTHORIZATION_REQUIRED";
  headerLines.push(
    `    {"${cppStringEscape(e.key)}", ${parseHex(e.address)}, ${e.word_count}, ${e.write_uses_read_modify_write}, ` +
    `${maskInt}u, ${e.shift}, ${e.signedness === "signed"}, ${e.scale}, ${e.offset}, ${e.minimum}, ${e.maximum}, ` +
    `${e.field_width_bits}, ${e.freshness_budget_ms}u, ${policy}, "${cppStringEscape(e.write_safety_class)}"},`
  );
}
headerLines.push("};");
headerLines.push("");
headerLines.push("// Linear scan -- at most 42 entries in this project's whole write registry (far smaller");
headerLines.push("// than kFields' own ~155-entry scan in jk_poll_scheduler_core.h's find_block_index_for_");
headerLines.push("// address, already accepted there for the same reason: this only runs on an actual write");
headerLines.push("// or preflight request, never on a hot poll-scheduler path.");
headerLines.push("inline int find_entry_index(const char *key) {");
headerLines.push("  for (std::size_t i = 0; i < kEntryCount; i++) {");
headerLines.push("    if (std::strcmp(kEntries[i].key, key) == 0) return int(i);");
headerLines.push("  }");
headerLines.push("  return -1;");
headerLines.push("}");
headerLines.push("");
headerLines.push("}  // namespace jk_write_registry");

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
const headerContent = headerLines.join("\n") + "\n";

if (CHECK) {
  let drift = false;
  for (const [target, content] of [[OUT_JSON, jsonContent], [OUT_YAML, yamlContent], [OUT_HEADER, headerContent]]) {
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
atomicWrite(OUT_HEADER, headerContent);
console.log(`wrote ${path.relative(ROOT, OUT_JSON)}`);
console.log(`wrote ${path.relative(ROOT, OUT_YAML)}`);
console.log(`wrote ${path.relative(ROOT, OUT_HEADER)}`);
console.log(`${registryEntries.length} eligible fields (${outJsonDoc.live_count} live, ${outJsonDoc.authorization_required_count} authorization-required).`);
