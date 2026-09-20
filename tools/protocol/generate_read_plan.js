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
 *   native_bms_power (0x1294) was never excluded — despite modbus_controller
 *   merging it with the preceding electrical_metrics_scan range as a bus
 *   optimization pre-migration, it has no lambda of its own (plain filters:
 *   multiply) and decodes independently of that cluster; it migrated as an
 *   ordinary field in commit boundary 3.
 *
 *   CUSTOM-DECODE BLOCK (CUSTOM_DECODE_BLOCKS, below) — total_voltage_raw
 *   and current_raw (0x1290/0x1298) are NOT ordinary per-field entries: the
 *   pre-migration modbus_controller lambda read them TOGETHER in one
 *   gapless 12-byte response (0x1290 BatVol + 0x1294 BatWatt [decoded
 *   nowhere, deliberately skipped, see below] + 0x1298 BatCurrent) so
 *   voltage and current are GUARANTEED to be from the same physical Modbus
 *   frame — P = V x I would be wrong if they could come from two different
 *   samples. This is a hand-audited sign-convention computation (BatCurrent
 *   read with no sign inversion: positive = charging, negative =
 *   discharging) that fans out atomically to 7 downstream sensors. Ported
 *   here VERBATIM (same byte offsets, same sign convention, same globals,
 *   same fan-out — see CUSTOM_DECODE_BLOCKS' own code string) rather than
 *   through the generic per-field FieldDecode pipeline, which cannot
 *   express "read two non-adjacent sub-ranges of one block and compute a
 *   product with a global side effect." Golden-vector tests for this exact
 *   code live in test/jk_poll_scheduler/test_electrical_metrics_decode.cpp.
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
 *   WIRE REGISTER COUNT (CORRECTED 2026-09-19, user-directed systemic
 *   fix — supersedes the prior version of this note, which claimed a
 *   uniform "2x canonical word_count" rule as "the JK protocol's
 *   documented declared-address gap convention, applied uniformly to
 *   every single-register read"): that claim was a mechanical
 *   overgeneralization of an old YAML-literal population that itself
 *   turned out to contain the exact same unit-confusion bug (a byte
 *   count passed where ESPHome's create_read_command() expects a
 *   register count) in 6 independently-audited, independently-fixed
 *   cases (2026-09-18 commits c722f5a/73c65f2/f6483a3/7832182/b867781/
 *   9adce23 — 0x1200, 0x1088, 0x126A, 0x106C, 0x1240, 0x1470, and the
 *   generic write-tx ACK-readback/recovery-probe mechanism) — zero of
 *   which needed genuine doubling once correctly re-derived against
 *   registers.canonical.json. The real upstream technique this rule was
 *   modeled on (protocol/evidence/upstream_esp32-jk-pb-modbus-example.
 *   yaml) doubles register_count specifically so ESPHome's OWN
 *   modbus_controller auto-range-merge heuristic can correctly span
 *   MULTIPLE, separately-declared sensors at DIFFERENT addresses in one
 *   combined request — a scenario that does not exist for this
 *   generator's ORDINARY_ONE_REGISTER/ASCII_CONTIGUOUS blocks, which
 *   read exactly one canonical register address each ("one block per
 *   register" design, unchanged). Both classes now request EXACTLY
 *   register.word_count, undoubled — see wireRegisterCount()'s own
 *   comment. Response validation for these blocks is EXACT-LENGTH
 *   (data.size() != payload_bytes, Block::strict_length=true), not a
 *   floor check, matching every one of the 6 already-corrected sites'
 *   own policy — an oversized response is now a rejected anomaly, not
 *   silently accepted.
 *
 *   The ONE genuine multi-address clustered read in this project is the
 *   hand-authored CUSTOM_DECODE_BLOCKS entry at 0x1290 (class
 *   CLUSTERED_GAP_AWARE) — see that table's own comment for why its
 *   register_count is a real, still-open, hardware-pending question
 *   (two candidate values identified — 10 via declared-address-span, 12
 *   as the unchanged legacy literal — neither proven this round) that is
 *   NOT resolved by this generic fix, and is deliberately NOT reduced
 *   without hardware evidence. Its response-length validation is a FLOOR
 *   check (data.size() >= payload_bytes, Block::strict_length=false), NOT
 *   exact-match — confirmed necessary by hardware acceptance 2026-09-20,
 *   which found the exact-match policy above, applied to this block
 *   unconditionally, rejected 100% of its real responses since a
 *   confirmed fresh boot. See CUSTOM_DECODE_BLOCKS' own exceptionReason
 *   for the full incident.
 *
 *   0x1504 (rcv_time/rfv_time) is an ORDINARY_ONE_REGISTER block like any
 *   other — this fix gives it register_count=1 (= its own word_count),
 *   matching the real, previously-hardware-tested legacy YAML value that
 *   the pre-fix uniform rule had disagreed with. The open blocker at this
 *   address (protocol_blockers.json) is updated to reflect that the
 *   software side is now fixed, but stays open, hardware-pending, until a
 *   real device confirms it (see this stage's own consolidated report).
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

// Block classification (2026-09-19 hardening pass, user-directed generic
// read-plan register-count correction). Declared early (module scope,
// before any table that references it) since CUSTOM_DECODE_BLOCKS below
// needs BLOCK_CLASS.CLUSTERED_GAP_AWARE at module-evaluation time. See
// wireRegisterCount()'s and blockClassOf()'s own comments, further down,
// for the full reasoning behind each class.
const BLOCK_CLASS = {
  ORDINARY_ONE_REGISTER: "ORDINARY_ONE_REGISTER",
  ASCII_CONTIGUOUS: "ASCII_CONTIGUOUS",
  CLUSTERED_GAP_AWARE: "CLUSTERED_GAP_AWARE",
  UNRESOLVED: "UNRESOLVED",
};

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
  // cell_voltage_1..16: read+decoded by the dedicated 1Hz cell-block
  // lambda (batterylifepo4.yaml, 0x1200/106-byte read), untouched by this
  // generic generator, same as ever.
  //
  // cell_voltage_17..32 (Stage 3 cell-channel batch, 2026-09-17): ALSO
  // excluded here, but for a different reason -- these ARE now decoded
  // (from the SAME already-fetched 106-byte buffer, zero new Modbus
  // reads), but by that SAME dedicated 1Hz lambda, hand-extended this
  // batch -- never by this generic scheduler, which has no cadence
  // default for poll_group "cell_block_1s" at all (see cell_block_1s:
  // null in CADENCE_OVERRIDE_MS's own comment, below).
  ...Array.from({ length: 32 }, (_, i) => `cell_voltage_${i + 1}`),
  // cell_resistance_1..16: same dedicated 1Hz lambda as cell_voltage_1..16.
  ...Array.from({ length: 16 }, (_, i) => `cell_resistance_${i + 1}`),
  //
  // cell_resistance_17..32 / CellWireRes16-31 (Stage 3 bounded batch,
  // 2026-09-17: implemented): now genuinely read, but via their OWN
  // isolated, capability-gated bespoke command (0x126A, 32 bytes, its own
  // 15s interval, jk_capability_core.h-tracked, only issued when
  // configured CellCount is 17..32) -- deliberately NOT the generic
  // pipeline's own poll_group "telemetry_15s" default cadence, which would
  // query this never-before-confirmed block unconditionally, forever,
  // regardless of configured N or of this project's own bounded-probe
  // policy. Excluded here so the generic pipeline does not silently
  // generate that unconditional read instead of the bespoke, gated one.
  ...Array.from({ length: 16 }, (_, i) => `cell_resistance_${i + 17}`),
  // cell_connection_wire_resistance_1..32 / CellConWireRes0-31 (Stage 3
  // bounded batch, 2026-09-17: implemented): genuinely read now too, via
  // their own isolated, capability-gated bespoke command (0x1088, 128
  // bytes, its own 300s interval) -- same "the generic pipeline has no
  // bounded-probe/capability-state concept, so a never-before-confirmed
  // block needs bespoke code, not its default cadence" reasoning as
  // CellWireRes16-31 above. Also explicitly RW calibration, not R
  // telemetry (never confused with CellWireRes) -- write path stays
  // fail-closed regardless (write-enablement is Stage 4 scope).
  ...Array.from({ length: 32 }, (_, i) => `cell_connection_wire_resistance_${i + 1}`),
  "max_voltage_cell_index_native",
  "min_voltage_cell_index_native",
  "reserved_0x12d2",
  // Stage 2 (typed-petting-puzzle plan): the 3 newly-authored reserved
  // half-registers (0x12EE high byte, 0x130C low byte, 0x1506 low byte)
  // -- same reasoning as reserved_0x12d2 immediately above: effective_access
  // "unsupported", no esphome_domain, no real entity wired to them today.
  // Their non-reserved sibling byte at the same address isn't in the
  // canonical catalog yet either (Stage 3's own scope to import), so
  // generating a new scheduler read for just the reserved half now would
  // be new bus traffic serving nothing.
  "rvd_12ee_h",
  "rvd_130c_l",
  "rvd_1506_l",
  // total_voltage_raw/current_raw (0x1290/0x1298) are NOT ordinary
  // per-field entries -- excluded from the generic pipeline, but NOT
  // "bespoke/untouched": they're covered by CUSTOM_DECODE_BLOCKS below,
  // which migrates them onto the scheduler with hand-ported, audited
  // decode logic instead of the generic FieldDecode path. See this file's
  // own module comment.
  "total_voltage_raw",
  "current_raw",
]);

// One hand-authored, verbatim-ported custom decoder -- see this file's own
// module comment's "CUSTOM-DECODE BLOCK" section for the full reasoning.
// Every byte offset, the sign convention, and the 7-entity fan-out are
// copied EXACTLY from the pre-migration modbus_controller lambda (git
// history: batterylifepo4.yaml before this change, address 0x1290) --
// this table exists so that verbatim C++ can be reviewed/diffed as data,
// not regenerated from canonical.json's per-field model, which cannot
// express this block's cross-field computation at all.
// CLUSTERED_GAP_AWARE exception (2026-09-19 hardening pass, user-directed):
// this is the ONE genuine multi-address clustered read in this project --
// three separately-declared canonical registers (0x1290 total_voltage_raw,
// 0x1294 native_bms_power, 0x1298 current_raw, each word_count=2) read in
// ONE physical FC03 request, exactly the scenario the upstream JK
// declared-address-gap technique (protocol/evidence/upstream_esp32-jk-pb-
// modbus-example.yaml) was actually written for -- unlike every ORDINARY_
// ONE_REGISTER/ASCII_CONTIGUOUS block above, which reads only ONE address
// and has no gap to cover.
//
// registerCount=12/payloadBytes=12 are UNCHANGED from the pre-migration
// literal this round -- deliberately NOT reduced to the naive "6 registers
// = sum of the 3 fields' own word_counts" figure, because that number
// would only be correct if the JK device's response is exactly as wide as
// the real field data with NO padding for the declared-address gaps
// between fields (0x1290->0x1291 real, 0x1292-0x1293 unmodeled, 0x1294-
// 0x1295 real, 0x1296-0x1297 unmodeled, 0x1298-0x1299 real) -- unproven
// either way this round. Two candidate register_count values were
// computed but NEITHER is hardware-confirmed:
//   (a) declared-span: (0x1298 + word_count(2)) - 0x1290 = 10 registers
//   (b) current/legacy literal: 12 registers (this file's existing value)
// payload_bytes=12 (the COMPACT response the decoder actually reads) is
// independently supported regardless of which register_count is correct
// -- decode_electrical_metrics() only ever reads bytes 0-11 of whatever
// comes back, per its own golden-vector tests, so payload_bytes is not
// part of this open question. Changing registerCount without a real
// FC03 capture at 0x1290 to disambiguate (a) vs (b) vs the current value
// would be exactly the kind of "mechanical reduction without proof" this
// round was explicitly told not to do -- left as an open,
// hardware-pending question (see this file's own emitted exception_reason
// on this block, and the parallel 0x1504 open blocker for the same class
// of unresolved question).
const CUSTOM_DECODE_BLOCKS = [
  {
    address: "0x1290",
    blockClass: BLOCK_CLASS.CLUSTERED_GAP_AWARE,
    exceptionReason: "Multi-address clustered read (0x1290 total_voltage_raw + 0x1294 native_bms_power [unread] + 0x1298 current_raw, each word_count=2). registerCount=12 is the pre-existing literal, UNCHANGED this round -- neither proven correct nor reduced without hardware evidence. A declared-address-span computation gives 10 registers as an alternative candidate; payload_bytes=12 (the decoder's own compact-response read length) is independent of this question and unaffected either way. Hardware-pending: a real FC03 capture at 0x1290 is needed to disambiguate 10 vs 12 vs any other candidate before this block can be called resolved. CONFIRMED DEFECT, hardware acceptance 2026-09-20: the generic exact-length validation (data.size() != payload_bytes) was applied to this block unconditionally, and total_voltage/current (and every entity this block feeds) were observed unavailable (NA) continuously for >2.5h across a confirmed fresh boot -- 100% failure rate, while every other, individually-audited block on the identical validator succeeded throughout. Root cause: payload_bytes=12 was only ever proven as this block's own decoder's read length (unit/golden-vector tests), never as this device's true wire response byte count, which remains the same open question as registerCount (10 vs 12 vs other). Fix: this block now validates as a floor (data.size() >= payload_bytes), restoring the tolerant check this literal was actually hardware-validated under before the 2026-09-19 change, via Block::strict_length=false. Still open pending a real FC03 capture; do not tighten back to exact-match without one.",
    registerCount: 12, // UNCHANGED pre-existing literal -- see exceptionReason above; not reduced without proof.
    payloadBytes: 12, // real, gapless response: 3 adjacent DWORDs (BatVol, BatWatt [unused here], BatCurrent).
    cadenceMs: 15000, // telemetry_15s, matching total_voltage_raw's own canonical poll_group.
    coversKeys: ["total_voltage_raw", "current_raw"],
    // `raw` is the block's own payload_bytes-length buffer (byte 0 = start
    // of THIS block's response, never a merge offset -- see
    // jk_poll_scheduler_core.h's own read_be() comment for why byte_offset
    // is otherwise unused in this project's real data). Bytes 4-7 (BatWatt)
    // are deliberately never read here, exactly as the original comment
    // says -- every power metric is derived from voltage x current instead,
    // to avoid a stale cross-sensor dependency and BatWatt's own rounding.
    // The actual decode MATH lives in jk_poll_scheduler_core.h's own
    // decode_electrical_metrics() -- a real, hand-written, unit-tested
    // function (test/jk_poll_scheduler/test_electrical_metrics_decode.cpp),
    // not a string here. This generated glue only marshals its result into
    // the existing globals and triggers the same 7-entity atomic fan-out
    // the pre-migration on_value: automation did.
    decodeCode: [
      "const jk_poll_scheduler::ElectricalMetrics m = jk_poll_scheduler::decode_electrical_metrics(raw);",
      "id(g_total_voltage_v) = m.total_voltage_v;",
      "id(g_current_a) = m.current_a;",
      "id(g_power_w) = m.power_w;",
      "id(g_charging_power_w) = m.charging_power_w;",
      "id(g_discharging_power_w) = m.discharging_power_w;",
      "id(g_last_current_sample_ms) = millis();",
      "id(total_voltage)->update();",
      "id(current)->update();",
      "id(power)->update();",
      "id(charging_power)->update();",
      "id(discharging_power)->update();",
      "id(charging_current)->update();",
      "id(discharging_current)->update();",
    ].join("\n"),
  },
];

// canonical.json's esphome_read_entity_id is WRONG for this one field --
// confirmed with real generated ESPHome C++ (set_object_id(...) inspected
// directly in a real compiled main.cpp, 2026-09-15): ESPHome ALWAYS
// derives an entity's real, wire-level object_id from its `name:` field
// via sanitize(snake_case(name)), completely independent of `id:`
// (confirmed against ESPHome's own esphome/cpp_helpers.py). The
// total_runtime register's real entity has `id: total_runtime` but
// `name: "total runtime in seconds"`, whose real object_id is
// "total_runtime_in_seconds" -- NOT "total_runtime" as canonical.json
// claims. jk_bms.js's own DIAGNOSTIC_ENTITY_LABELS/ORDER tables already
// independently reference "total_runtime_in_seconds" (an earlier session
// apparently already discovered and compensated for this in the frontend
// without canonical.json ever being corrected to match) -- so the REAL,
// currently-live key is what this generator must publish under, or this
// field would go dark the instant it migrated.
//
// This same id-vs-name-derived-object_id class of bug was found MUCH more
// broadly across the file during this verification (29 mismatches across
// the whole tracked YAML, including a severe, unrelated, pre-existing one:
// cell_resistance_1..16's real object_ids are "cell_1_wire_resistance"..
// "cell_16_wire_resistance", not "cell_resistance_N" as jk_bms.js's own
// cellResistanceKeys array expects -- meaning that headline diagnostic
// feature has likely never displayed live data). That finding is entirely
// outside this generator's own migration scope (cell_resistance_* stays
// on its existing bespoke 1Hz reader, untouched) and is reported
// separately, not silently fixed here.
const ENTITY_ID_OVERRIDE = {
  // total_runtime's real, pre-existing entity id ("total_runtime_in_seconds")
  // used to be overridden here, but as of the Stage 3 precision fix
  // canonical.json's own esphome_read_entity_id for this field no longer
  // equals "total_runtime" (it now points at the new exact text_sensor),
  // so this entry would silently stop applying to the field it was meant
  // for. The legacy id now lives in canonical.json's own
  // legacy_companion_entity_id (registers.canonical.json), read directly
  // below wherever this generator needs it.
  //
  // canonical.json claims esphome_read_entity_id "setup_passcode" for this
  // field -- but that id already belongs to a DIFFERENT, pre-existing
  // `text` domain entity (the always-masked write-side display, which
  // literally always publishes "****************" regardless of wire
  // content -- see batterylifepo4.yaml's own `id: setup_passcode` entity).
  // The real, distinct read entity for the raw decoded bytes has always
  // been `setup_passcode_readback` (a separate text_sensor). Confirmed via
  // a real `esphome config` ID-collision error this session (2026-09-15)
  // when the two entities' generated ids collided.
  setup_passcode: "setup_passcode_readback",
};

const DERIVED_BOOLEAN_OVERRIDE = {
  charging_active: { entityId: "charging_raw" },
  discharging_active: { entityId: "discharging_raw" },
  balancing_active: { entityId: "balancing_raw" },
  charging: { entityId: "charging_control_raw", cadenceMs: 75000 },
  discharging: { entityId: "discharging_control_raw", cadenceMs: 75000 },
  balancing: { entityId: "balancing_control_raw", cadenceMs: 75000 },
};

// A genuinely different, narrower case from DERIVED_BOOLEAN_OVERRIDE above:
// DERIVED_BOOLEAN_OVERRIDE exists for fields whose real semantics are an
// AMBIGUOUS numeric-threshold comparison this generator cannot safely
// derive on its own (charging_active etc. -- routed to a plain numeric
// "_raw" sensor instead, deliberately not claiming a boolean at all).
// WHOLE_VALUE_BOOLEAN_FIELDS (2026-09-20, generalized projection
// architecture) is the OPPOSITE case: a field whose own evidence directly
// confirms its wire value is ALWAYS exactly 0 or 1 (never a genuine
// multi-value threshold) despite not being a single-bit WireType::BIT
// field (e.g. heating_active: a whole LOW BYTE of a packed register,
// PDF-confirmed "1=On/0=Off" -- see 0x12D0's own safety_notes). For these,
// decode_bool()'s `(raw & mask) != 0` is exactly as safe and correct as
// it is for a real BIT field (the mask already selects only that field's
// own byte/bit span) -- an explicit, evidence-backed opt-in list, never a
// generic "any non-BIT binary_sensor is fine" relaxation, which would
// silently swallow a genuine ambiguous-threshold field.
const WHOLE_VALUE_BOOLEAN_FIELDS = new Set([
  "heating_active", // 0x12D0 low byte, PDF p.12 + V2 workbook row 13: confirmed always 0 or 1
]);

const READ_DOMAIN_OVERRIDE = {
  charging_float_mode: "binary_sensor",
  // 0x1114 cluster (Stage 3 completion pass, 2026-09-20): 8 genuinely
  // single-bit boolean flags, same reasoning as charging_float_mode
  // itself (its own sibling bit on the SAME register) -- PDF p.8 confirms
  // each is a plain "1: On / 0: Off" bit. port_switch (bit3) is
  // deliberately NOT listed here -- it is an explicit 2-state MODE
  // selector (1=RS485, 0=CAN per the same PDF row), not a boolean, so it
  // stays on the default "sensor" domain with its own enum_map.
  heat_en: "binary_sensor",
  disable_temp_sensor: "binary_sensor",
  gps_heartbeat: "binary_sensor",
  lcd_always_on: "binary_sensor",
  special_charger: "binary_sensor",
  smart_sleep_enabled: "binary_sensor",
  disable_pcl_module: "binary_sensor",
  timed_stored_data: "binary_sensor",
  // 0x12D0 projections (Stage 3 completion pass, 2026-09-20, generalized
  // projection architecture): heating_active is a whole-byte 0/1 boolean
  // (see WHOLE_VALUE_BOOLEAN_FIELDS above); the 5 bat_temp_sensor_N_present
  // fields are real single bits, same reasoning as the 0x1114 cluster.
  // mos_temp_sensor_status_bit_raw is deliberately NOT listed here -- its
  // own polarity is single-source only, so it stays on the default
  // "sensor" domain (raw numeric), never asserting a confirmed boolean.
  heating_active: "binary_sensor",
  bat_temp_sensor_1_present: "binary_sensor",
  bat_temp_sensor_2_present: "binary_sensor",
  bat_temp_sensor_3_present: "binary_sensor",
  bat_temp_sensor_4_present: "binary_sensor",
  bat_temp_sensor_5_present: "binary_sensor",
  // 0x12A0 alarm-bit projections (Stage 3 continuation pass, 2026-09-20):
  // 22 real single-bit alarm flags, PDF-confirmed "1=Fault/0=Normal" on
  // every row -- genuine booleans, same reasoning as every entry above.
  alarm_wire_res: "binary_sensor",
  alarm_mos_otp: "binary_sensor",
  alarm_cell_quantity: "binary_sensor",
  alarm_cur_sensor_err: "binary_sensor",
  alarm_cell_ovp: "binary_sensor",
  alarm_bat_ovp: "binary_sensor",
  alarm_ch_ocp: "binary_sensor",
  alarm_ch_scp: "binary_sensor",
  alarm_ch_otp: "binary_sensor",
  alarm_ch_utp: "binary_sensor",
  alarm_cpu_aux_commu_err: "binary_sensor",
  alarm_cell_uvp: "binary_sensor",
  alarm_bat_uvp: "binary_sensor",
  alarm_dch_ocp: "binary_sensor",
  alarm_dch_scp: "binary_sensor",
  alarm_dch_otp: "binary_sensor",
  alarm_charge_mos: "binary_sensor",
  alarm_discharge_mos: "binary_sensor",
  gps_disconnected: "binary_sensor",
  modify_pwd_in_time: "binary_sensor",
  discharge_on_failed: "binary_sensor",
  battery_over_temp_alarm: "binary_sensor",
  // UART raw hex arrays (2026-09-20): wire_type HEX, decode_hex_string()
  // always produces a std::string, same reasoning as ASCII above.
  uart1_mprtol_enable: "text_sensor",
  uart_mprtol_enable_0_15: "text_sensor",
  device_model: "text_sensor",
  setup_passcode: "text_sensor",
  // Stage 3 batch 1 (typed-petting-puzzle plan): two more ASCII-wire-type
  // fields, same reasoning as device_model/setup_passcode above -- without
  // an entry here they'd default to "sensor" (a float-publishing entity)
  // and fail to compile against decode_ascii's std::string output (caught
  // by a real `esphome compile` on real hardware after this file's first
  // version shipped without these two entries; see the ASCII-domain-
  // coverage self-check below, added so the next such field is caught by
  // `generate_read_plan.js --check` instead of requiring another real
  // compile).
  hardware_version: "text_sensor",
  software_version: "text_sensor",
  // Stage 3 precision fix: these 4 keys' PRIMARY entity is now the exact
  // text_sensor entity (see EXACT_DECIMAL_FIELDS below) -- same "an
  // override entry is required, canonical.json's esphome_domain alone is
  // not trusted here" reasoning as every entry above.
  rtc_ticks: "text_sensor",
  odd_run_time: "text_sensor",
  bms_system_ticks: "text_sensor",
  total_runtime: "text_sensor",
  // Stage 3 cell-channel batch (2026-09-17): cell_connected_mask's
  // precision fix -- same reasoning as the 4 entries directly above.
  cell_connected_mask: "text_sensor",
};

// Stage 3 precision fix (user-directed, 2026-09-17): wide UINT32 counters
// whose real magnitude already exceeds float's 24-bit exact-integer
// ceiling (2^24 = 16,777,216). decode_numeric()'s float(raw) cast, and
// ESPHome's own Sensor::state (hard-typed `float`, confirmed against the
// real esphome/components/sensor/sensor.h -- returning double from
// decode_numeric would not have fixed this, since publish_state(float)
// truncates it right back), silently round these -- confirmed on real
// hardware, 2026-09-17: rtc_ticks (~2.1e8) was observed quantizing to
// 16-second steps.
//
// For each key here, canonical.json's own esphome_domain/
// esphome_read_entity_id now point at a NEW "<key>_exact" text_sensor
// entity (decoded via decode_exact_decimal(), pure integer/string
// arithmetic, no float anywhere) -- that's what planFields/blocks resolve
// as this field's PRIMARY entity below, and what the project's own custom
// web UI (jk_bms.js, driven by canonical.json's fieldMeta) now displays.
// legacyEntityId is each field's real, pre-existing generated entity id
// (confirmed against a real hardware capture, 2026-09-17) -- this table
// makes the block-building step below ALSO emit that entity, unchanged
// name/domain/decode path (decode_numeric, approximate), purely so
// existing Home Assistant history/dashboards referencing it keep working.
// This is the ONLY mechanism in this generator that makes one canonical
// field publish to two ESPHome entities -- deliberately narrow, not a
// general facility, because registers.canonical.json's own
// OVERLAPPING_MASKS validation (tools/protocol/lib/semantic-checks.js)
// would reject modeling this as two canonical fields sharing one
// register's bytes; doing it here, after block-grouping, sidesteps that
// without weakening the validator for every other field.
//
// Routing/duplication fix (user-directed, 2026-09-17): the legacy entity's
// identity used to be hardcoded here as its own small table -- but
// jk_bms.js (built by the OTHER generator, generate.js, from the SAME
// canonical.json, never from this file) had no way to learn that same
// fact, so it could not register the legacy wire id at all -- confirmed
// on real hardware to produce a second, duplicate, mislabeled row in the
// project's own custom UI. Fixed by moving the legacy identity into
// canonical.json itself (registers.canonical.json's own
// legacy_companion_entity_id/_domain/_configured_name, all 3 confirmed
// against a real live SSE capture, 2026-09-17) -- generate.js and
// generate_read_plan.js now both read the SAME source fact independently,
// instead of one hardcoding what only the other used to know.
// Stage 3 cell-channel batch (2026-09-17): cell_connected_mask joins this
// set for a DIFFERENT reason than the original 4 (wide monotonic
// counters whose DECIMAL MAGNITUDE exceeds float's exact-integer range) --
// a bitmask needs bit-exactness regardless of magnitude (a value with
// bit31 set already corrupts float's LOW-bit precision too, at any
// decimal_precision), but the underlying fix (decode_exact_decimal(),
// never decode_numeric()) is identical either way. decimal_precision=0
// for this field, so decode_exact_decimal() degenerates to a plain
// integer string -- exactly what a mask needs, no decimal point.
const EXACT_DECIMAL_FIELDS = new Set(["rtc_ticks", "odd_run_time", "bms_system_ticks", "total_runtime", "cell_connected_mask"]);

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

const WIRE_TYPE_ENUM = new Set(["U8", "S8", "U16", "S16", "U32", "S32", "F32", "ASCII", "BIT", "HEX"]);

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
  if (f.esphome_domain === "binary_sensor" && f.wire_type !== "BIT" && !override && !WHOLE_VALUE_BOOLEAN_FIELDS.has(f.key)) {
    throw new Error(
      `READ_PLAN_UNHANDLED_DERIVED_BOOLEAN: field "${f.key}" is esphome_domain=binary_sensor with a non-BIT ` +
      `wire_type (${f.wire_type}) and has no DERIVED_BOOLEAN_OVERRIDE or WHOLE_VALUE_BOOLEAN_FIELDS entry -- refusing ` +
      `to guess its threshold comparison. Add an explicit override (verified against batterylifepo4.yaml's real ` +
      `lambda) or a WHOLE_VALUE_BOOLEAN_FIELDS entry (only if evidence confirms the wire value is always exactly 0 ` +
      `or 1) before regenerating.`
    );
  }

  const entityId = override ? override.entityId : (ENTITY_ID_OVERRIDE[f.key] || f.esphome_read_entity_id || f.key);
  const domain = override ? "sensor" : (READ_DOMAIN_OVERRIDE[f.key] || "sensor");

  // ASCII decode always publishes a std::string (decode_ascii's own
  // signature), which only compiles against a text_sensor's
  // publish_state(std::string) -- never sensor's publish_state(float).
  // A missing READ_DOMAIN_OVERRIDE entry for a new ASCII field silently
  // defaults to "sensor" here and fails only at real `esphome compile`
  // time (confirmed the hard way: hardware_version/software_version were
  // shipped without an override entry in Stage 3 batch 1 and broke a real
  // compile). Catch it here instead, at generation time.
  if ((f.wire_type === "ASCII" || f.wire_type === "HEX") && domain !== "text_sensor") {
    throw new Error(
      `READ_PLAN_ASCII_WRONG_DOMAIN: field "${f.key}" has wire_type ${f.wire_type} but resolved read domain "${domain}" ` +
      `(expected "text_sensor") -- decode_ascii()/decode_hex_string() always produce a std::string, which will not compile ` +
      `against a non-text_sensor platform's publish_state(float). Add an entry for "${f.key}": "text_sensor" to ` +
      `READ_DOMAIN_OVERRIDE before regenerating.`
    );
  }

  // decode_exact_decimal() also always produces a std::string (same
  // reasoning as the ASCII check immediately above) -- a field listed in
  // EXACT_DECIMAL_FIELDS without a matching READ_DOMAIN_OVERRIDE entry
  // would hit the identical publish_state(float)-vs-std::string compile
  // error the ASCII check exists to catch pre-emptively.
  if (EXACT_DECIMAL_FIELDS.has(f.key) && domain !== "text_sensor") {
    throw new Error(
      `READ_PLAN_EXACT_DECIMAL_WRONG_DOMAIN: field "${f.key}" is in EXACT_DECIMAL_FIELDS but resolved read ` +
      `domain "${domain}" (expected "text_sensor") -- decode_exact_decimal() always produces a std::string. ` +
      `Add an entry for "${f.key}": "text_sensor" to READ_DOMAIN_OVERRIDE before regenerating.`
    );
  }
  if (EXACT_DECIMAL_FIELDS.has(f.key) && !f.legacy_companion_entity_id) {
    throw new Error(
      `READ_PLAN_EXACT_DECIMAL_MISSING_LEGACY_COMPANION: field "${f.key}" is in EXACT_DECIMAL_FIELDS but has no ` +
      `legacy_companion_entity_id in registers.canonical.json -- add one (confirmed against a real live SSE ` +
      `capture) before regenerating.`
    );
  }

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

// Block classification (2026-09-19 hardening pass, user-directed generic
// read-plan register-count correction). See this file's own module
// comment's "WIRE REGISTER COUNT" section for the full incident history:
// a uniform "2x word_count for every non-ASCII block" rule was found to
// be a mechanical overgeneralization of a upstream/pre-migration YAML
// literal population that turned out to contain the exact same
// unit-confusion bug (byte count passed as register count) in 6
// independently-audited, independently-fixed cases (2026-09-18 commits
// c722f5a/73c65f2/f6483a3/7832182/b867781/9adce23) -- zero of which
// needed genuine doubling once corrected. This project's generic
// pipeline issues exactly ONE physical Modbus read per canonical
// register address (module comment, "one block per register") -- the
// upstream project's real "declared-address gap" doubling technique
// (protocol/evidence/upstream_esp32-jk-pb-modbus-example.yaml) exists
// specifically to make ESPHome's OWN modbus_controller auto-range-merge
// heuristic correctly span MULTIPLE, separately-declared sensors at
// DIFFERENT addresses in one combined request -- a scenario this
// project's one-block-per-address design does not create for any
// ordinary or ASCII field. The only genuine multi-address clustered
// read in this project is the hand-authored CUSTOM_DECODE_BLOCKS entry
// at 0x1290 (see its own comment for why that one case IS potentially
// gap-aware and is deliberately NOT resolved by this function).

function blockClassOf(register) {
  // HEX (2026-09-20, UART raw-bitmask decoder) is the same shape as ASCII
  // for classification purposes: one multi-byte-array field spanning the
  // whole register, no per-bit/per-byte gap concept -- register_count =
  // word_count, undoubled, same as ASCII_CONTIGUOUS.
  const isContiguousByteArray = register.fields.every((f) => f.wire_type === "ASCII" || f.wire_type === "HEX") ||
    (register.fields[0] && (register.fields[0].wire_type === "ASCII" || register.fields[0].wire_type === "HEX"));
  return isContiguousByteArray ? BLOCK_CLASS.ASCII_CONTIGUOUS : BLOCK_CLASS.ORDINARY_ONE_REGISTER;
}

// Both ORDINARY_ONE_REGISTER and ASCII_CONTIGUOUS request EXACTLY the
// register's own canonical word_count -- no doubling, no gap-covering
// multiplier. A single, standalone FC03 read of one canonical register
// has no declared-address gap to cover (there is only one address), so
// there is nothing for a gap convention to apply to. This is the fix:
// the previous version of this function multiplied non-ASCII requests by
// 2 here; every one of the 6 already-corrected bespoke/write-tx sites
// converged on exactly word_count (unmultiplied) once independently
// re-derived against protocol/registers.canonical.json, so that is what
// this function now returns uniformly, for both classes.
function wireRegisterCount(register) {
  return register.word_count;
}

// A block's ui_group (Stage 1 hardware acceptance corrective pass, active-
// group scheduler consumption) is the ONE non-null ui_group every field it
// covers agrees on -- never guessed or defaulted when fields disagree or
// none carry one yet (registers.canonical.json's own ui_group population is
// Stage 2's deliverable; as of this pass every field's ui_group is still
// null, so every block's aggregated ui_group is null/-1 too -- a real,
// honest reflection of that dependency, not a placeholder pretending
// otherwise). null here becomes -1 (jk_poll_scheduler::Block's own "no
// group" sentinel, matching active_group_block_index's) at emission time.
function aggregateUiGroup(uiGroups) {
  const distinct = new Set(uiGroups.filter((g) => g !== null && g !== undefined));
  return distinct.size === 1 ? [...distinct][0] : null;
}

const blocks = [...blocksByAddress.values()]
  .sort((a, b) => parseInt(a.register.address, 16) - parseInt(b.register.address, 16))
  .map((b) => {
    const registerCount = wireRegisterCount(b.register);
    return {
      address: b.register.address,
      block_class: blockClassOf(b.register),
      register_count: registerCount,
      payload_bytes: b.register.payload_bytes,
      validation_policy: "exact",
      strict_length: true,
      exception_reason: null,
      cadence_ms: b.cadenceMs,
      ui_group: aggregateUiGroup(b.fields.map((pf) => pf.field.ui_group)),
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

// Stage 3 precision fix: inject the approximate "legacy companion" entity
// for every EXACT_DECIMAL_FIELDS field, into the SAME block its exact
// primary already landed in (same register, same raw bytes -- this reads
// nothing twice on the wire, it publishes the one already-read block to a
// second entity). Done here, after `blocks` exists, rather than as a
// second canonical field, because two canonical fields covering the same
// register bytes would fail registers.canonical.json's own
// OVERLAPPING_MASKS validation. The companion's `key` is synthetic (never
// a real canonical field key) -- confirmed safe: this generator's own
// kFields emission only uses `key` in a C++ comment for human debugging,
// and entity_id (not key) is what actually becomes the published
// entity's wire id. legacyEntityId is read from canonical.json's own
// legacy_companion_entity_id (the single shared source generate.js also
// reads, routing/duplication fix, 2026-09-17) via fieldByKey, moved above
// this loop for that purpose.
const fieldByKey = new Map(allRegisterFields.map(({ field: f }) => [f.key, f]));
for (const block of blocks) {
  for (const pf of block.fields.slice()) {
    if (!EXACT_DECIMAL_FIELDS.has(pf.key)) continue;
    const sourceField = fieldByKey.get(pf.key);
    const legacyEntityId = sourceField && sourceField.legacy_companion_entity_id;
    if (!legacyEntityId) {
      throw new Error(`READ_PLAN_EXACT_DECIMAL_MISSING_LEGACY_COMPANION: field "${pf.key}" has no legacy_companion_entity_id in registers.canonical.json`);
    }
    block.fields.push({
      key: `${pf.key}__legacy_companion`,
      entity_id: legacyEntityId,
      domain: "sensor",
      byte_offset: pf.byte_offset,
      mask: pf.mask,
      shift: pf.shift,
      signed: pf.signed,
      wire_type: pf.wire_type,
      scale: pf.scale,
      offset: pf.offset,
      unit: pf.unit,
      precision: pf.precision,
      internal: false,
      label_en: pf.label_en ? `${pf.label_en} (approximate, Home Assistant compatibility)` : null,
    });
  }
}

// Merge in the hand-authored custom-decode blocks (no FieldDecode entries
// -- fields: [] -- their decode dispatch is the verbatim decodeCode string
// instead of the generic per-field switch; see buildServicerInterval()).
// (fieldByKey itself is declared above, ahead of the legacy-companion
// injection loop, which needs it first.)
for (const cb of CUSTOM_DECODE_BLOCKS) {
  blocks.push({
    address: cb.address,
    block_class: cb.blockClass,
    register_count: cb.registerCount,
    payload_bytes: cb.payloadBytes,
    // CLUSTERED_GAP_AWARE (currently the only class CUSTOM_DECODE_BLOCKS
    // carries): floor-check, not exact-match. This block's real wire
    // response length is an open, hardware-pending question (see this
    // block's own exceptionReason) -- payload_bytes is only proven as the
    // DECODE function's own read length (golden-vector unit tests), never
    // hardware-confirmed as the response's exact byte count. Hardware
    // acceptance 2026-09-20 found the unconditional exact-match check
    // (introduced generically for ORDINARY_ONE_REGISTER/ASCII_CONTIGUOUS
    // blocks) rejected 100% of this block's real responses since a
    // confirmed fresh boot -- see protocol_blockers.json / hardware
    // evidence for this date. Reverting to floor-check restores exactly
    // the tolerant validation this literal was actually hardware-proven
    // under, without weakening the exact check for any other block.
    validation_policy: cb.blockClass === BLOCK_CLASS.CLUSTERED_GAP_AWARE ? "floor" : "exact",
    strict_length: cb.blockClass !== BLOCK_CLASS.CLUSTERED_GAP_AWARE,
    exception_reason: cb.exceptionReason,
    cadence_ms: cb.cadenceMs,
    ui_group: aggregateUiGroup(cb.coversKeys.map((k) => (fieldByKey.get(k) || {}).ui_group ?? null)),
    fields: [],
    custom_decode: cb.decodeCode,
    covers_keys: cb.coversKeys,
  });
}
blocks.sort((a, b) => parseInt(a.address, 16) - parseInt(b.address, 16));

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
  // Bare filename, NOT the full components/jk_poll_scheduler/... path this
  // repo uses everywhere else -- confirmed directly against a real
  // `esphome compile`: ESPHome's `esphome: includes:` flattens every listed
  // file into one shared build src/ directory (no subdirectory structure
  // preserved), so a nested relative #include from within an included file
  // fails to resolve there even though the same path is exactly correct
  // for every OTHER purpose (this project's own g++ unit test compiles,
  // -I flags, etc., which all still use the real repo-relative path).
  lines.push('#include "jk_poll_scheduler_core.h"');
  lines.push("");
  lines.push("namespace jk_read_plan {");
  lines.push("");

  const wireTypeMap = { U8: "U8", S8: "S8", U16: "U16", S16: "S16", U32: "U32", S32: "S32", F32: "F32", ASCII: "ASCII", BIT: "BIT", HEX: "HEX" };

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
      `    {${b.address}, ${b.register_count}, ${b.payload_bytes}, ${b.cadence_ms}u, ${offset}, ${b.fields.length}, ${b.ui_group === null ? -1 : b.ui_group}, ${b.strict_length ? "true" : "false"}},`
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
      if (f.internal) lines.push("    internal: true");
      // `name:` is deliberately humanize(entity_id) -- NOT canonical's own,
      // nicer frontend_label_en -- and there is no `object_id:` override
      // alongside it. Confirmed directly against real ESPHome source
      // (esphome/cpp_helpers.py): an entity's real, wire-level object_id is
      // ALWAYS sanitize(snake_case(name)), and an explicit `object_id:`
      // config key does not exist to override it in the real, available
      // ESPHome release this project's own compile gate could be verified
      // against this session (2025.5.2) -- nor is its presence in this
      // project's actual newer pinned target confirmed (this environment
      // cannot reach that release to check). Deriving `name:` FROM
      // entity_id, verified to round-trip exactly through
      // sanitize(snake_case(...)) for all 90 generated fields, is the one
      // mechanism guaranteed stable across ESPHome versions -- eliminating
      // the entire class of bug this migration's own verification pass
      // found live elsewhere in this file (id: silently diverging from the
      // real name-derived object_id, e.g. cell_resistance_1 vs its real
      // "cell_1_wire_resistance" -- see this generator's own
      // ENTITY_ID_OVERRIDE comment). This project's OWN UI never reads this
      // `name:` value (jk_bms.js displays PROTOCOL_CATALOG.fieldMeta's own
      // labelEn/labelUk instead) -- only Home-Assistant-native-API/generic-
      // ESPHome-dashboard cosmetics are affected by this less-polished name.
      lines.push(`    name: "${cEscape(humanize(f.entity_id))}"`);
      // binary_sensor.template has no update_interval concept at all (it is
      // purely state-driven -- confirmed directly against real ESPHome
      // config validation; matches this project's own existing hand-written
      // binary_sensor templates, e.g. "charging"/"discharging"/"balancing"
      // in batterylifepo4.yaml, none of which set it either). Every other
      // domain here is polled externally by the scheduler, never by
      // ESPHome's own component.update(), hence update_interval: never.
      if (f.domain !== "binary_sensor") lines.push("    update_interval: never");
      // text_sensor has no unit_of_measurement concept in ESPHome's real
      // schema (confirmed: every existing text_sensor field in this
      // catalog -- device_model, hardware_version, software_version --
      // carries canonical_unit:"" for exactly this reason). The Stage 3
      // precision-fix fields (rtc_ticks etc.) are the first text_sensor
      // entries whose canonical_unit is genuinely non-empty (they still
      // carry "s" so the CUSTOM web UI's own unit display, driven by
      // canonical.json's fieldMeta, keeps showing it) -- guarding by
      // domain here, not by emptiness, is what actually prevents emitting
      // an invalid YAML key for them.
      if (f.unit && f.domain !== "text_sensor") lines.push(`    unit_of_measurement: "${cEscape(f.unit)}"`);
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
  lines.push("");
  lines.push(buildServicerGlobals());
  lines.push("");
  lines.push(buildServicerInterval());
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

// ---------------------------------------------------------------------------
// Scheduler servicer: globals: (the physical block cache, parallel-array
// storage -- see jk_write_tx_core.h's own module comment for why ESPHome
// globals cannot hold a custom struct type directly) + interval: (the
// tick that decides the next block via jk_poll_scheduler::pick_next_block,
// issues the real Modbus command, and -- in its callback -- decodes and
// publishes every field the completed block feeds, via a GENERATED
// per-block dispatch: id() resolves entities at C++ compile time, so this
// dispatch cannot be a runtime loop over field keys the way the decode
// math itself is generic; only the decode MATH stays hand-written).
// ---------------------------------------------------------------------------
function buildServicerGlobals() {
  const lines = [];
  lines.push("globals:");
  lines.push("  # Physical block cache (spec section 3.5) storage -- parallel arrays,");
  lines.push("  # not a global of jk_poll_scheduler::BlockState, for the same reason");
  lines.push("  # jk_write_tx's own slot storage is split (see batterylifepo4.yaml's");
  lines.push("  # own \"Generic write transaction manager\" comment): ESPHome's globals");
  lines.push("  # codegen instantiates every `globals:` entry before this package's own");
  lines.push("  # `includes:`-provided types are #included.");
  lines.push("  - id: g_rp_last_attempt_ms");
  lines.push(`    type: uint32_t[${blocks.length}]`);
  lines.push("  - id: g_rp_last_success_ms");
  lines.push(`    type: uint32_t[${blocks.length}]`);
  lines.push("  - id: g_rp_error_count");
  lines.push(`    type: uint16_t[${blocks.length}]`);
  lines.push("  - id: g_rp_timeout_count");
  lines.push(`    type: uint16_t[${blocks.length}]`);
  lines.push("  - id: g_rp_transport_state");
  lines.push(`    type: uint8_t[${blocks.length}]`);
  lines.push("  - id: g_rp_revision");
  lines.push(`    type: uint32_t[${blocks.length}]`);
  lines.push("  # -1 = no read currently outstanding; otherwise the block index whose");
  lines.push("  # response the next completed create_read_command callback belongs to.");
  lines.push("  # A callback for any OTHER index (a late/stale response arriving after");
  lines.push("  # its own read already timed out and the scheduler moved on) still");
  lines.push("  # decodes and publishes its own block's fields -- a late-but-correct");
  lines.push("  # update is harmless and even beneficial -- but must NOT clear pending");
  lines.push("  # state that now belongs to a DIFFERENT, currently in-flight read.");
  lines.push("  - id: g_rp_pending_index");
  lines.push("    type: int");
  lines.push("    restore_value: false");
  lines.push('    initial_value: "-1"');
  lines.push("  - id: g_rp_pending_started_ms");
  lines.push("    type: uint32_t");
  lines.push("    restore_value: false");
  lines.push('    initial_value: "0"');
  return lines.join("\n");
}

const SERVICER_READ_TIMEOUT_MS = 3000;
const SERVICER_TICK_INTERVAL = "200ms";

function buildServicerInterval() {
  const lines = [];
  lines.push("interval:");
  lines.push(`  - interval: ${SERVICER_TICK_INTERVAL}`);
  lines.push("    startup_delay: 3s");
  lines.push("    then:");
  lines.push("      - lambda: |-");
  const L = (s) => lines.push(s === "" ? "" : "          " + s);

  L("const uint32_t now = millis();");
  L("");
  L("// A read is already outstanding -- only check it for timeout; never issue");
  L("// a second one (single Modbus transaction in flight at a time).");
  L("if (id(g_rp_pending_index) >= 0) {");
  L("  if (now - id(g_rp_pending_started_ms) > " + SERVICER_READ_TIMEOUT_MS + "U) {");
  L("    const int idx = id(g_rp_pending_index);");
  L("    id(g_rp_timeout_count)[idx] = uint16_t(id(g_rp_timeout_count)[idx] + 1);");
  L("    id(g_rp_transport_state)[idx] = jk_poll_scheduler::IDLE;");
  L("    id(g_rp_pending_index) = -1;");
  L('    ESP_LOGW("jk_poll_scheduler", "Read timeout for block %u (address 0x%04X)", unsigned(idx), unsigned(jk_read_plan::kBlocks[idx].address));');
  L("  }");
  L("  return;");
  L("}");
  L("");
  L("// Tier 1: any write transaction in flight (jk_write_tx's 6 generic slots,");
  L("// or the CellCount topology driver's own bespoke transaction/recovery-probe");
  L("// state) suppresses every background read this tick.");
  L("bool write_in_flight = id(g_cellcount_tx_pending) || id(g_topology_recovery_pending);");
  L("if (!write_in_flight) {");
  L("  for (uint8_t i = 0; i < 6; i++) {");
  L("    if (id(g_wtx_in_use)[i] && jk_write_tx::is_pending(id(g_wtx_status)[i])) { write_in_flight = true; break; }");
  L("  }");
  L("}");
  L("if (write_in_flight) return;");
  L("");
  L("// Tier 2: active-settings-group hint. Real consumption (Stage 1 hardware");
  L("// acceptance corrective pass) -- resolve_active_group_block_index() scans");
  L("// jk_read_plan::kBlocks for one whose generated ui_group matches the");
  L("// browser's hint; see that function's own comment in");
  L("// jk_poll_scheduler_core.h. Every real block's ui_group is -1 today (per-");
  L("// field ui_group population is Stage 2's own deliverable, not yet done),");
  L("// so this always resolves to NO_BLOCK against production data -- real,");
  L("// wired, and unit-tested, but a documented no-op until Stage 2 supplies");
  L("// ui_group data, not a missing feature.");
  L("const bool group_hint_active = id(g_active_group_hint) >= 0 && now < id(g_active_group_hint_expires_ms);");
  L("const int active_group_block_index = jk_poll_scheduler::resolve_active_group_block_index(");
  L("    jk_read_plan::kBlocks, id(g_active_group_hint), group_hint_active);");
  L("");
  L(`std::array<jk_poll_scheduler::BlockState, jk_read_plan::kBlockCount> states;`);
  L("for (size_t i = 0; i < jk_read_plan::kBlockCount; i++) {");
  L("  states[i].last_attempt_ms = id(g_rp_last_attempt_ms)[i];");
  L("  states[i].last_success_ms = id(g_rp_last_success_ms)[i];");
  L("  states[i].error_count = id(g_rp_error_count)[i];");
  L("  states[i].timeout_count = id(g_rp_timeout_count)[i];");
  L("  states[i].transport_state = id(g_rp_transport_state)[i];");
  L("  states[i].revision = id(g_rp_revision)[i];");
  L("}");
  L("uint32_t cadence_ms[jk_read_plan::kBlockCount];");
  L("for (size_t i = 0; i < jk_read_plan::kBlockCount; i++) cadence_ms[i] = jk_read_plan::kBlocks[i].cadence_ms;");
  L("");
  L("const int chosen = jk_poll_scheduler::pick_next_block(states, cadence_ms, false, active_group_block_index, now);");
  L("if (chosen < 0) return;");
  L("");
  L("jk_poll_scheduler::mark_issued(states[chosen], now);");
  L("id(g_rp_last_attempt_ms)[chosen] = states[chosen].last_attempt_ms;");
  L("id(g_rp_transport_state)[chosen] = states[chosen].transport_state;");
  L("id(g_rp_pending_index) = chosen;");
  L("id(g_rp_pending_started_ms) = now;");
  L("");
  L("const auto &block = jk_read_plan::kBlocks[chosen];");
  L("auto command = esphome::modbus_controller::ModbusCommandItem::create_read_command(");
  L("    id(bms0), esphome::modbus::EntityType::HOLDING, block.address, block.register_count,");
  L("    [chosen](auto, uint16_t, const auto &data) {");
  L("      const uint8_t payload_bytes = jk_read_plan::kBlocks[chosen].payload_bytes;");
  L("      const bool strict_length = jk_read_plan::kBlocks[chosen].strict_length;");
  L("      // Length validation (2026-09-19 hardening pass, user-directed;");
  L("      // per-block strict_length carve-out added 2026-09-20 after");
  L("      // hardware acceptance found the exact check wrongly applied to");
  L("      // the one CLUSTERED_GAP_AWARE block -- see jk_poll_scheduler_core.h's");
  L("      // own Block::strict_length comment). strict_length blocks (every");
  L("      // ORDINARY_ONE_REGISTER/ASCII_CONTIGUOUS block, individually");
  L("      // audited 2026-09-18/19): a fixed-register_count FC03 read has a");
  L("      // deterministic response size, so short OR long is a real anomaly.");
  L("      // Non-strict blocks (0x1290 only, as of this generation): floor");
  L("      // check only -- payload_bytes is this block's own decoder's read");
  L("      // length, not a hardware-proven exact response size.");
  L("      const bool length_ok = strict_length ? (data.size() == payload_bytes) : (data.size() >= payload_bytes);");
  L("      if (!length_ok) {");
  L('        ESP_LOGW("jk_poll_scheduler", "Response length mismatch for block %u (address 0x%04X): %u/%u bytes",');
  L("                 unsigned(chosen), unsigned(jk_read_plan::kBlocks[chosen].address), unsigned(data.size()), unsigned(payload_bytes));");
  L("        id(g_rp_error_count)[chosen] = uint16_t(id(g_rp_error_count)[chosen] + 1);");
  L("        id(g_rp_transport_state)[chosen] = jk_poll_scheduler::IDLE;");
  L("        if (id(g_rp_pending_index) == chosen) id(g_rp_pending_index) = -1;");
  L("        return;");
  L("      }");
  L("      const uint8_t *raw = data.data();");
  L("      switch (chosen) {");
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    L(`        case ${i}: {  // 0x${parseInt(b.address, 16).toString(16).toUpperCase().padStart(4, "0")}`);
    if (b.custom_decode) {
      // Hand-authored, verbatim-ported decode (see CUSTOM_DECODE_BLOCKS'
      // own comment) -- not a generic per-field dispatch, because this
      // block computes a cross-field product with a global side effect
      // and fans out to entities that don't correspond 1:1 with any single
      // decoded field.
      for (const codeLine of b.custom_decode.split("\n")) L("          " + codeLine);
    } else {
      for (let j = 0; j < b.fields.length; j++) {
        const f = b.fields[j];
        const fieldIndex = blocks.slice(0, i).reduce((n, bb) => n + bb.fields.length, 0) + j;
        if (f.wire_type === "ASCII") {
          L(`          { char buf[17]; jk_poll_scheduler::decode_ascii(raw, payload_bytes, buf, sizeof(buf)); id(${f.entity_id})->publish_state(std::string(buf)); }`);
        } else if (f.wire_type === "HEX") {
          L(`          { char buf[64]; jk_poll_scheduler::decode_hex_string(raw, payload_bytes, buf, sizeof(buf)); id(${f.entity_id})->publish_state(std::string(buf)); }`);
        } else if (EXACT_DECIMAL_FIELDS.has(f.key)) {
          // Primary entity for a Stage 3 precision-fix field: exact
          // fixed-point decimal, never float -- see decode_exact_decimal's
          // own header comment. The synthetic "__legacy_companion" entry
          // (same block, different entity_id) below does NOT match this
          // key and falls through to the plain decode_numeric branch,
          // publishing the approximate value under its unchanged legacy id.
          L(`          { char buf[16]; jk_poll_scheduler::decode_exact_decimal(raw, jk_read_plan::kFields[${fieldIndex}], payload_bytes, ${f.precision}, buf, sizeof(buf)); id(${f.entity_id})->publish_state(std::string(buf)); }`);
          // Stage 3 cell-channel batch: cell_connected_mask ALSO exports
          // its bit-exact raw value into a global -- see
          // g_cell_connected_mask_raw's own comment in batterylifepo4.yaml.
          // No other EXACT_DECIMAL_FIELDS entry needs this (they are scalar
          // counters, not bitmasks resolve_topology tests bit-by-bit), so
          // this stays a narrow, named special case rather than a new
          // generic per-field mechanism for a single current user.
          if (f.key === "cell_connected_mask") {
            L(`          id(g_cell_connected_mask_raw) = jk_poll_scheduler::decode_raw_u32(raw, jk_read_plan::kFields[${fieldIndex}], payload_bytes);`);
            L(`          id(g_cell_connected_mask_valid) = true;`);
          }
        } else if (f.domain === "binary_sensor" && (f.wire_type === "BIT" || WHOLE_VALUE_BOOLEAN_FIELDS.has(f.key))) {
          // decode_bool() publishes a real bool, matching a binary_sensor
          // entity's publish_state(bool) overload. A BIT-width field whose
          // real semantic is NOT a boolean (e.g. port_switch: 1-bit but a
          // genuine 2-state MODE selector, RS485/CAN, published as a plain
          // numeric sensor with its own enum_map for the frontend to
          // render) must NOT go through this branch -- it falls through to
          // the plain decode_numeric() branch below instead, exactly like
          // any other non-boolean field, since decode_numeric's mask+shift
          // logic already handles a 1-bit-wide field correctly (returns
          // 0.0/1.0), it just returns float instead of bool.
          L(`          id(${f.entity_id})->publish_state(jk_poll_scheduler::decode_bool(raw, jk_read_plan::kFields[${fieldIndex}], payload_bytes));`);
        } else {
          L(`          id(${f.entity_id})->publish_state(jk_poll_scheduler::decode_numeric(raw, jk_read_plan::kFields[${fieldIndex}], payload_bytes));`);
        }
      }
    }
    L("          break;");
    L("        }");
  }
  L("        default: break;");
  L("      }");
  L("      id(g_rp_last_success_ms)[chosen] = millis();");
  L("      id(g_rp_revision)[chosen] = id(g_rp_revision)[chosen] + 1;");
  L("      id(g_rp_transport_state)[chosen] = jk_poll_scheduler::IDLE;");
  L("      if (id(g_rp_pending_index) == chosen) id(g_rp_pending_index) = -1;");
  L("    });");
  L("id(bms0)->queue_command(std::move(command));");
  return lines.join("\n");
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
