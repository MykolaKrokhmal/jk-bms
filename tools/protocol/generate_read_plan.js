#!/usr/bin/env node
/*
 * Read-plan generator (Final-preparation-plan Stage 1, commit boundary 2,
 * spec section "3.1. Canonical -> runtime pipeline").
 *
 *   node tools/protocol/generate_read_plan.js          — regenerate every derived artifact
 *   node tools/protocol/generate_read_plan.js --check  — regenerate in memory and diff
 *                                                         against what's on disk; exit
 *                                                         non-zero on any drift, without
 *                                                         writing anything
 *   node tools/protocol/generate_read_plan.js --root /tmp/copy
 *                                                       — operate on an isolated tree
 *
 * Reads (never writes) protocol/registers.canonical.json — the SAME source
 * generate.js already reads; this is a second, independent projection of
 * it, not a second source of truth. Writes:
 *   protocol/generated/read_plan.json        (audit/validation projection)
 *   protocol/generated/read_plan.yaml        (ESPHome package — NOT yet
 *                                             !include'd by batterylifepo4.yaml;
 *                                             that happens in Stage 1's third
 *                                             commit boundary, alongside
 *                                             removing the legacy entities it
 *                                             replaces, so the working tree
 *                                             never passes through a state
 *                                             with two conflicting entities
 *                                             at the same object_id)
 *   protocol/generated/read_plan_decode.h    (generated DATA ONLY — the
 *                                             decode LOGIC it feeds lives in
 *                                             components/jk_poll_scheduler/
 *                                             jk_poll_scheduler_core.h,
 *                                             hand-written and unit-tested;
 *                                             see that header's own module
 *                                             comment for why the split)
 *
 * ---------------------------------------------------------------------
 * Scope: which of today's 87 `platform: modbus_controller` read entities
 * this generator covers, and which three stay on their existing, already-
 * tested bespoke drivers (verified directly against batterylifepo4.yaml,
 * 2026-09-15, not assumed):
 *
 *   EXCLUDED (BESPOKE_EXCLUDED_KEYS, below) — untouched by this generator
 *   or by Stage 1's migration at all:
 *     - cell_voltage_1..16, cell_resistance_1..16 (32 fields): the existing
 *       1Hz `interval: 1s` reader (0x1200-0x1234, one 106-byte gapless
 *       read) already IS a scheduler-owned, custom read+decode path — it
 *       is not "legacy modbus_controller polling" in the sense Stage 1's
 *       exit criterion cares about, and replacing an already-audited,
 *       already-hardware-verified reader with a generated one is not this
 *       stage's job.
 *     - total_voltage_raw, current_raw (electrical_metrics_scan, 0x1290/
 *       0x1298): a hand-audited voltage/current/power/sign-convention
 *       computation that drives 7 downstream sensors via component.update
 *       — see batterylifepo4.yaml's own SIGN CONVENTION comment at that
 *       lambda. Too safety-relevant to replace mechanically without
 *       hardware to re-verify the sign convention against.
 *   native_bms_power (0x1294) is NOT excluded — despite modbus_controller
 *   merging it with the preceding electrical_metrics_scan range as a bus
 *   optimization today, it has no lambda of its own (plain filters:
 *   multiply) and decodes independently of that cluster.
 *
 *   NOT REAL ENTITIES TODAY (also in BESPOKE_EXCLUDED_KEYS, for a
 *   different reason) — canonical.json models these fields but no
 *   esphome_read_entity_id ever reached a real, wired entity (confirmed:
 *   grep of batterylifepo4.yaml for both fields finds no modbus_controller
 *   or template entity at their address). Generating a NEW read for them
 *   now would be new content, which Stage 1 must not add:
 *     - max_voltage_cell_index_native, min_voltage_cell_index_native
 *       (0x1248) — max/min cell index is instead computed client-side by
 *       the 1Hz cell-block reader scanning its own 16 decoded voltages.
 *     - reserved_0x12d2 (0x12D2) — effective_access "unsupported", no
 *       domain, confirmed unread today.
 *
 *   DERIVED-BOOLEAN OVERRIDE (DERIVED_BOOLEAN_OVERRIDE, below) — 6 fields
 *   whose canonical esphome_domain is "binary_sensor" but whose real value
 *   is a numeric-THRESHOLD over a raw register, not a true single-bit
 *   WireType::BIT field. Each of today's 6 hand-written template lambdas
 *   uses a different comparison (charging: ==1; balancing: >0; the three
 *   "_allowed" ones: !=0) that is not mechanically derivable from
 *   canonical.json alone (confirmed by direct inspection of
 *   batterylifepo4.yaml's binary_sensor: section, 2026-09-15). This
 *   generator publishes only the RAW numeric register, under the exact
 *   "_raw" entity id each existing lambda already reads from; the derived
 *   boolean stays hand-written and verbatim in batterylifepo4.yaml.
 *
 *   READ DOMAIN (READ_DOMAIN_OVERRIDE, below) — deliberately NOT
 *   canonical.json's own esphome_domain field. esphome_domain classifies a
 *   field's WRITE/UI-editor concept (e.g. "number" for an RW field like
 *   smart_sleep) — but every RW field's READ side in this project has
 *   always published under `sensor` domain (a SEPARATE, `number`-domain,
 *   `internal: true` entity — e.g. `set_smart_sleep` — handles the write
 *   side only, per batterylifepo4.yaml's own "Owner-authorized write
 *   re-enablement" comment). Confirmed by direct inspection that
 *   canonical.json's esphome_domain also disagrees with the real read
 *   entity's platform for uart_protocol_library_version (canonical says
 *   text_sensor; the real entity is a plain `sensor`, decoding a numeric
 *   byte, not an ASCII string) — trusting esphome_domain for this purpose
 *   would silently publish an SSE event under the WRONG domain prefix
 *   (jk_bms.js's entityByWireId map is keyed `${domain}/${device}/${id}`),
 *   breaking that field end-to-end. This table is exhaustive: any field
 *   not listed defaults to "sensor" (verified true for every one of the
 *   87 real entities except the 3 entries below).
 *
 *   WIRE REGISTER COUNT — the actual Modbus register_count requested is
 *   NOT canonical.json's own word_count. Cross-checked directly against
 *   every real, hardware-tested batterylifepo4.yaml entity's declared
 *   register_count (2026-09-15): for every non-ASCII field, real
 *   register_count = 2 x canonical word_count (the JK protocol's
 *   documented declared-address gap convention, applied uniformly to
 *   every single-register read, not merely to multi-value clustered ones
 *   as an earlier draft of this generator's design assumed) — confirmed
 *   across 76 of 78 non-ASCII addresses exactly; the 2 exceptions
 *   (cell_count requesting 8 instead of 4, mosfet_temperature requesting
 *   6 instead of 2) are both explained by an artificial widening to merge
 *   with an ADJACENT register for bus efficiency in today's YAML — a
 *   cross-register optimization this generator's deliberately conservative
 *   "one block per register" design does not replicate (see
 *   jk_poll_scheduler_core.h's own Block comment), so the uniform 2x rule
 *   is used for those two as well, not their inflated real-YAML value.
 *   ASCII fields (device_model, setup_passcode) request register_count =
 *   word_count, UNDOUBLED (confirmed: 8 requested for an 8-word/16-byte
 *   field, no gap convention for contiguous string bytes).
 *
 *   FLAGGED FOR HARDWARE VERIFICATION (not resolvable from documentation
 *   alone, no device available this session): 0x1504 (rcv_time/rfv_time)
 *   is the one address where the uniform 2x rule goes the OTHER direction
 *   from today's real, hardware-tested value -- the real YAML requests
 *   register_count=1 for each of its two overlapping declared entities,
 *   while this generator's uniform formula gives register_count=2 for the
 *   single merged block. 2 is used here (consistent with every other
 *   single_word register in the same memory region, and Modbus over-
 *   reading is ordinarily harmless), but this is a real, identified point
 *   of residual uncertainty -- confirm on real hardware before trusting it
 *   in a hardware-verified state (see this stage's own consolidated report).
 *
 * Anti-stall policy (plan section 6): any field this generator cannot
 * place with full confidence throws a hard error naming the field, rather
 * than guessing — the run fails loudly, not silently, exactly like this
 * project's PDF-evidence policy for Stage 2.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function cliValue(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : process.argv[i + 1];
}
const ROOT = path.resolve(cliValue("--root") || path.join(__dirname, "..", ".."));
const CHECK_MODE = process.argv.includes("--check");

function sha256(str) {
  return crypto.createHash("sha256").update(str, "utf8").digest("hex");
}

function atomicWrite(targetPath, content) {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(targetPath)}.tmp-${process.pid}`);
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, targetPath);
}

// ---------------------------------------------------------------------------
// Load canonical source (already schema/semantic-validated by generate.js's
// own run — this generator does not re-validate; run generate.js --check
// first if that's in doubt, exactly like every other consumer of this file).
// ---------------------------------------------------------------------------
const registerSourcePath = path.join(ROOT, "protocol", "registers.canonical.json");
const registerSourceRaw = fs.readFileSync(registerSourcePath, "utf8");
const registerDoc = JSON.parse(registerSourceRaw);
const canonicalHash = sha256(registerSourceRaw).slice(0, 16);
const catalogVersion = registerDoc.catalog_version;
const HEADER = `Generated by tools/protocol/generate_read_plan.js from protocol/registers.canonical.json. DO NOT EDIT BY HAND. catalog_version=${catalogVersion} source_hash=${canonicalHash}`;

const allRegisterFields = []; // {field, register}, address-sorted (canonical.json's own order)
for (const reg of registerDoc.registers) {
  for (const f of reg.fields) allRegisterFields.push({ field: f, register: reg });
}

// ---------------------------------------------------------------------------
// Hand-authored exception tables — see this file's own module comment above
// for the full, audited reasoning behind every entry.
// ---------------------------------------------------------------------------

const BESPOKE_EXCLUDED_KEYS = new Set([
  ...Array.from({ length: 16 }, (_, i) => `cell_voltage_${i + 1}`),
  ...Array.from({ length: 16 }, (_, i) => `cell_resistance_${i + 1}`),
  "total_voltage_raw",
  "current_raw",
  "max_voltage_cell_index_native",
  "min_voltage_cell_index_native",
  "reserved_0x12d2",
]);

const DERIVED_BOOLEAN_OVERRIDE = {
  charging_active: { entityId: "charging_raw" },
  discharging_active: { entityId: "discharging_raw" },
  balancing_active: { entityId: "balancing_raw" },
  charging: { entityId: "charging_control_raw", cadenceMs: 75000 },
  discharging: { entityId: "discharging_control_raw", cadenceMs: 75000 },
  balancing: { entityId: "balancing_control_raw", cadenceMs: 75000 },
};

const READ_DOMAIN_OVERRIDE = {
  charging_float_mode: "binary_sensor",
  device_model: "text_sensor",
  setup_passcode: "text_sensor",
};

// Fields whose canonical poll_group implies a cadence this generator has
// no other default for, but which ARE genuinely read on the real device
// today (confirmed by direct inspection of batterylifepo4.yaml,
// 2026-09-15) -- Stage 1 preserves exact current behavior rather than
// silently fixing (or silently dropping) a pre-existing classification
// mismatch.
const CADENCE_OVERRIDE_MS = {
  // on_demand_passcode's default is "not auto-polled" -- but the real
  // entity has no skip_updates, i.e. it uses the plain 15s default today.
  setup_passcode: 15000,
  // cell_connected_mask/average_cell_voltage/delta_cell_voltage are
  // cell_block_1s by poll_group classification (grouped with the bespoke
  // 1Hz cell-voltage/resistance reader conceptually), but are NOT actually
  // part of that reader's own 0x1200-0x1234 response (which stops before
  // 0x1240) -- each is its own separate, regular modbus_controller entity
  // on the plain 15s default cadence, confirmed by direct inspection.
  cell_connected_mask: 15000,
  average_cell_voltage: 15000,
  delta_cell_voltage: 15000,
};

// poll_group -> default cadence, matching batterylifepo4.yaml's own
// modbus_controller_update_interval (15s) x skip_updates (1 or the shared
// bms_control_params_skip_updates=20) substitutions, confirmed per-address
// against every real entity this session.
const POLL_GROUP_CADENCE_MS = {
  telemetry_15s: 15000,
  config_slow_300s: 300000,
  on_demand_passcode: null, // no default -- every field in this poll_group must have an explicit CADENCE_OVERRIDE_MS entry
  on_demand_topology: null,
  on_demand_service: null,
  cell_block_1s: null, // bespoke-excluded; never reached if BESPOKE_EXCLUDED_KEYS is correct
};

// Extra verbatim ESPHome YAML (already correctly indented for a package's
// sensor: list item body) appended to one generated entity, preserving a
// pre-existing on_value: trigger this migration must not silently drop.
// on_value: fires on any publish_state() call regardless of which platform
// declared the entity, so carrying it forward here is exactly equivalent
// to today's modbus_controller-declared trigger, not an approximation.
const EXTRA_ENTITY_YAML = {
  alarms_bitmask: "    on_value:\n      - component.update: alarms\n",
};

const WIRE_TYPE_ENUM = new Set(["U8", "S8", "U16", "S16", "U32", "S32", "F32", "ASCII", "BIT"]);

// ---------------------------------------------------------------------------
// Build the field list: filter, resolve entity id/domain/cadence per field.
// ---------------------------------------------------------------------------
const planFields = []; // {field, register, entityId, domain, cadenceMs}
for (const { field: f, register: r } of allRegisterFields) {
  if (BESPOKE_EXCLUDED_KEYS.has(f.key)) continue;
  if (!WIRE_TYPE_ENUM.has(f.wire_type)) {
    throw new Error(`READ_PLAN_UNKNOWN_WIRE_TYPE: field "${f.key}" has unrecognized wire_type "${f.wire_type}"`);
  }

  const override = DERIVED_BOOLEAN_OVERRIDE[f.key];
  if (f.esphome_domain === "binary_sensor" && f.wire_type !== "BIT" && !override) {
    throw new Error(
      `READ_PLAN_UNHANDLED_DERIVED_BOOLEAN: field "${f.key}" is esphome_domain=binary_sensor with a non-BIT ` +
      `wire_type (${f.wire_type}) and has no DERIVED_BOOLEAN_OVERRIDE entry -- refusing to guess its threshold ` +
      `comparison. Add an explicit override (verified against batterylifepo4.yaml's real lambda) before regenerating.`
    );
  }

  const entityId = override ? override.entityId : (f.esphome_read_entity_id || f.key);
  const domain = override ? "sensor" : (READ_DOMAIN_OVERRIDE[f.key] || "sensor");

  let cadenceMs = CADENCE_OVERRIDE_MS[f.key];
  if (cadenceMs === undefined) cadenceMs = override && override.cadenceMs !== undefined ? override.cadenceMs : undefined;
  if (cadenceMs === undefined) {
    cadenceMs = POLL_GROUP_CADENCE_MS[r.poll_group];
    if (cadenceMs === undefined) {
      throw new Error(`READ_PLAN_UNKNOWN_POLL_GROUP: register "${r.register_id}" has unrecognized poll_group "${r.poll_group}"`);
    }
    if (cadenceMs === null) {
      throw new Error(
        `READ_PLAN_NO_CADENCE: field "${f.key}" (poll_group "${r.poll_group}") has no default cadence and no ` +
        `CADENCE_OVERRIDE_MS entry -- every on-demand-classified field that IS actually auto-polled today must be ` +
        `given one explicitly (see setup_passcode's own entry for the pattern).`
      );
    }
  }

  planFields.push({ field: f, register: r, entityId, domain, cadenceMs });
}

// ---------------------------------------------------------------------------
// Group into blocks (one per register address -- see this file's own
// module comment for why Stage 1 deliberately does not cluster multiple
// registers into one physical read).
// ---------------------------------------------------------------------------
const blocksByAddress = new Map(); // address -> { register, cadenceMs, fields: [] }
for (const pf of planFields) {
  const addr = pf.register.address;
  if (!blocksByAddress.has(addr)) {
    blocksByAddress.set(addr, { register: pf.register, cadenceMs: pf.cadenceMs, fields: [] });
  }
  const block = blocksByAddress.get(addr);
  if (block.cadenceMs !== pf.cadenceMs) {
    throw new Error(
      `READ_PLAN_CADENCE_CONFLICT: register ${addr} has fields with different cadences ` +
      `(${block.cadenceMs}ms vs ${pf.cadenceMs}ms for "${pf.field.key}") -- packed sibling fields sharing one ` +
      `physical register must share one read cadence; resolve via an explicit override.`
    );
  }
  block.fields.push(pf);
}

const WIRE_REGISTER_COUNT_BYTES = 2; // one Modbus holding register = 2 bytes, always, in this protocol

function wireRegisterCount(register) {
  const isAscii = register.fields.every((f) => f.wire_type === "ASCII") ||
    (register.fields[0] && register.fields[0].wire_type === "ASCII");
  // ASCII fields request word_count unchanged (no declared-address gap
  // convention for contiguous string bytes); every other field requests
  // 2x word_count (the JK protocol's gap convention -- see module comment).
  return isAscii ? register.word_count : register.word_count * 2;
}

const blocks = [...blocksByAddress.values()]
  .sort((a, b) => parseInt(a.register.address, 16) - parseInt(b.register.address, 16))
  .map((b) => {
    const registerCount = wireRegisterCount(b.register);
    return {
      address: b.register.address,
      register_count: registerCount,
      payload_bytes: b.register.payload_bytes,
      cadence_ms: b.cadenceMs,
      fields: b.fields.map((pf) => ({
        key: pf.field.key,
        entity_id: pf.entityId,
        domain: pf.domain,
        byte_offset: pf.field.byte_offset || 0,
        // ASCII fields carry mask:null in canonical.json (mask/shift don't
        // apply to a raw byte-string copy) -- 0x0 is an unused placeholder
        // for these, never read by the ASCII decode path.
        mask: pf.field.mask || "0x0",
        shift: pf.field.shift || 0,
        signed: pf.field.signedness === "signed",
        wire_type: pf.field.wire_type,
        scale: pf.field.scale,
        offset: pf.field.offset,
        unit: pf.field.canonical_unit || null,
        precision: pf.field.decimal_precision,
        internal: !!DERIVED_BOOLEAN_OVERRIDE[pf.field.key],
        label_en: pf.field.frontend_label_en || null,
      })),
    };
  });

// ---------------------------------------------------------------------------
// 1. read_plan.json — audit/validation projection.
// ---------------------------------------------------------------------------
function buildReadPlanJson() {
  return {
    "$comment": "GENERATED — audit projection of the scheduler-owned read plan. DO NOT EDIT BY HAND. " +
      "Edit protocol/registers.canonical.json and run `node tools/protocol/generate_read_plan.js` instead.",
    "$generated_by": HEADER,
    block_count: blocks.length,
    field_count: blocks.reduce((n, b) => n + b.fields.length, 0),
    excluded_bespoke_keys: [...BESPOKE_EXCLUDED_KEYS].sort(),
    blocks,
  };
}

// ---------------------------------------------------------------------------
// 2. read_plan_decode.h — generated DATA (kFields/kBlocks), no logic.
// ---------------------------------------------------------------------------
function cEscape(s) {
  return String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
function cFloat(n) {
  return Number.isInteger(n) ? `${n}.0f` : `${n}f`;
}

function buildDecodeHeader() {
  const lines = [];
  lines.push("// " + HEADER);
  lines.push("//");
  lines.push("// Data table only -- decode logic (decode_numeric/decode_bool) and the Block/");
  lines.push("// FieldDecode/BlockState types live in components/jk_poll_scheduler/");
  lines.push("// jk_poll_scheduler_core.h, hand-written and unit-tested. See that header's own");
  lines.push("// module comment. Never hand-edit this file -- edit");
  lines.push("// protocol/registers.canonical.json and tools/protocol/generate_read_plan.js's");
  lines.push("// exception tables, then regenerate.");
  lines.push("#pragma once");
  lines.push("");
  lines.push('#include "components/jk_poll_scheduler/jk_poll_scheduler_core.h"');
  lines.push("");
  lines.push("namespace jk_read_plan {");
  lines.push("");

  const wireTypeMap = { U8: "U8", S8: "S8", U16: "U16", S16: "S16", U32: "U32", S32: "S32", F32: "F32", ASCII: "ASCII", BIT: "BIT" };

  lines.push(`constexpr std::size_t kFieldCount = ${blocks.reduce((n, b) => n + b.fields.length, 0)};`);
  lines.push("constexpr jk_poll_scheduler::FieldDecode kFields[kFieldCount] = {");
  for (const b of blocks) {
    for (const f of b.fields) {
      lines.push(
        `    {"${cEscape(f.entity_id)}", ${f.byte_offset}, ${f.mask}, ${f.shift}, ` +
        `${f.signed ? "true" : "false"}, jk_poll_scheduler::WireType::${wireTypeMap[f.wire_type]}, ` +
        `${cFloat(f.scale)}, ${cFloat(f.offset)}},  // ${cEscape(f.key)}`
      );
    }
  }
  lines.push("};");
  lines.push("");

  lines.push(`constexpr std::size_t kBlockCount = ${blocks.length};`);
  lines.push("constexpr jk_poll_scheduler::Block kBlocks[kBlockCount] = {");
  let offset = 0;
  for (const b of blocks) {
    lines.push(
      `    {${b.address}, ${b.payload_bytes}, ${b.cadence_ms}u, ${offset}, ${b.fields.length}},  ` +
      `// register_count=${b.register_count}`
    );
    offset += b.fields.length;
  }
  lines.push("};");
  lines.push("");
  lines.push("} // namespace jk_read_plan");
  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// 3. read_plan.yaml — ESPHome package (NOT yet !include'd -- see module
//    comment). Every entity gets an EXPLICIT object_id equal to its id,
//    so the wire key is pinned regardless of what `name:` is chosen --
//    deliberately eliminating the whole class of bug this project has hit
//    twice now (an entity's real object_id silently diverging from its
//    intended key because it was left to ESPHome's name-slugify default;
//    see jk_bms.js's own commit-boundary-1 fix for the two concrete cases).
// ---------------------------------------------------------------------------
function humanize(key) {
  return key.replace(/_/g, " ");
}

function buildReadPlanYaml() {
  const lines = [];
  lines.push(`# ${HEADER}`);
  lines.push("#");
  lines.push("# ESPHome package -- every entity here is `platform: template`,");
  lines.push("# `update_interval: never`: nothing here polls on its own. Values are");
  lines.push("# published externally, by components/jk_poll_scheduler's interval-driven");
  lines.push("# servicer in batterylifepo4.yaml, via publish_state() after a scheduler-issued");
  lines.push("# Modbus read decodes this entity's field. NOT YET !include'd by");
  lines.push("# batterylifepo4.yaml (see this generator's own module comment) -- that happens");
  lines.push("# in Stage 1's third commit boundary, alongside removing the `platform:");
  lines.push("# modbus_controller` entities this package replaces.");
  lines.push("sensor:");
  const bySection = { sensor: [], binary_sensor: [], text_sensor: [] };
  for (const b of blocks) {
    for (const f of b.fields) {
      bySection[f.domain].push(f);
    }
  }
  function emit(list) {
    for (const f of list) {
      lines.push("  - platform: template");
      lines.push(`    id: ${f.entity_id}`);
      lines.push(`    object_id: ${f.entity_id}`);
      if (f.internal) lines.push("    internal: true");
      lines.push(`    name: "${cEscape(f.label_en || humanize(f.key))}"`);
      lines.push("    update_interval: never");
      if (f.unit) lines.push(`    unit_of_measurement: "${cEscape(f.unit)}"`);
      if (f.domain === "sensor" && typeof f.precision === "number") {
        lines.push(`    accuracy_decimals: ${f.precision}`);
      }
      if (EXTRA_ENTITY_YAML[f.key]) lines.push(EXTRA_ENTITY_YAML[f.key].replace(/\n$/, ""));
      lines.push("");
    }
  }
  emit(bySection.sensor);
  lines.push("binary_sensor:");
  emit(bySection.binary_sensor);
  lines.push("text_sensor:");
  emit(bySection.text_sensor);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

// ---------------------------------------------------------------------------
// Compute, then either write (normal mode) or diff (--check).
// ---------------------------------------------------------------------------
const outputs = {
  [path.join(ROOT, "protocol", "generated", "read_plan.json")]: JSON.stringify(buildReadPlanJson(), null, 2) + "\n",
  [path.join(ROOT, "protocol", "generated", "read_plan_decode.h")]: buildDecodeHeader(),
  [path.join(ROOT, "protocol", "generated", "read_plan.yaml")]: buildReadPlanYaml(),
};

if (CHECK_MODE) {
  let drift = false;
  for (const [target, content] of Object.entries(outputs)) {
    const rel = path.relative(ROOT, target);
    if (!fs.existsSync(target)) {
      console.log(`MISSING ${rel}`);
      drift = true;
      continue;
    }
    const onDisk = fs.readFileSync(target, "utf8");
    if (onDisk !== content) {
      console.log(`DRIFT   ${rel}`);
      drift = true;
    }
  }
  if (drift) {
    console.log("generate_read_plan.js --check: artifact(s) out of date. Run 'node tools/protocol/generate_read_plan.js' to regenerate.");
    process.exit(1);
  }
  console.log("generate_read_plan.js --check: no drift. All generated artifacts match the canonical source.");
  process.exit(0);
}

for (const [target, content] of Object.entries(outputs)) {
  atomicWrite(target, content);
  console.log(`wrote ${path.relative(ROOT, target)}`);
}
console.log(`${blocks.length} blocks, ${blocks.reduce((n, b) => n + b.fields.length, 0)} fields.`);
