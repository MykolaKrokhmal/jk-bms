#!/usr/bin/env node
"use strict";

// Regression test for the Stage 3 cell-channel batch (user-directed,
// 2026-09-17) and its FOLLOW-UP bounded batch (also 2026-09-17: read-path
// for CellWireRes16-31 + CellConWireRes0-31, the 48 parameters this file
// originally proved were deliberately catalog-only). Covers:
//   - cell_connected_mask routing (exact/legacy, both arrival orders,
//     bit31+low-bits together, sparse masks) via the REAL jk_bms.js
//     closures (same vm test-hook technique as
//     test_exact_decimal_companion_routing.js -- no reimplementation).
//   - Catalog-level: protocol capacity (32 channels) vs this deployed
//     16S unit's own connected topology, kept as separate, explicit
//     concerns -- never a fabricated value for an unsupported/unknown
//     channel.
//   - CellWireRes16-31 / CellConWireRes0-31 are now genuinely implemented
//     (bounded batch, 2026-09-17) via their OWN isolated, capability-gated
//     bespoke commands, absent from the GENERIC read plan on purpose (that
//     pipeline has no bounded-probe/capability-state concept) but present
//     in batterylifepo4.yaml's own code, each behind a short-response
//     guard exactly like the existing 1-16 decode.
//   - Existing 16S telemetry (cell_voltage_1..16/cell_resistance_1..16)
//     unchanged.
//
// Does NOT claim 32S hardware support is verified, and does NOT claim
// CellWireRes16-31/CellConWireRes0-31 are hardware-verified on the
// deployed 16S unit either -- that unit's own configured CellCount (16)
// never triggers the CellWireRes16-31 read at all, and CellConWireRes0-31
// has not been read on real hardware as of this batch. Every check below
// either exercises protocol-capacity-only data (explicitly labeled), the
// deployed 16S unit's own real, hardware-confirmed shape, or source-level
// structural facts about the new bespoke code (never a hardware claim by
// itself) -- see test/jk_capability/test_jk_capability_core.cpp for the
// capability state machine's own behavioral coverage.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..", "..");
const jkBmsSource = fs.readFileSync(path.join(ROOT, "jk_bms.js"), "utf8");
const canonical = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "registers.canonical.json"), "utf8"));
const readPlanYaml = fs.readFileSync(path.join(ROOT, "protocol", "generated", "read_plan.yaml"), "utf8");
const batteryYaml = fs.readFileSync(path.join(ROOT, "batterylifepo4.yaml"), "utf8");

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

function loadRealClosures() {
  const fakeElement = () => ({
    style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {}, appendChild() {}, setAttribute() {}, getAttribute() { return null; },
    getContext() { return {}; },
  });
  const window = {
    __JK_BMS_TEST_HOOKS__: {},
    location: { href: "http://jk-bms.local/" },
    addEventListener() {}, matchMedia() { return { matches: false }; },
    cancelAnimationFrame() {}, requestAnimationFrame() { return 1; },
    clearInterval() {}, setInterval() {},
  };
  const document = {
    documentElement: undefined,
    readyState: "complete",
    createElement() { return fakeElement(); },
    addEventListener() {},
    getElementById() { return null; },
    body: fakeElement(),
    activeElement: null,
  };
  class HTMLInputElement {}
  const sandbox = { window, document, navigator: { language: "en" }, URL, console, Map, HTMLInputElement };
  vm.createContext(sandbox);
  vm.runInContext(jkBmsSource, sandbox, { filename: "jk_bms.js" });
  if (!window.__JK_BMS_TEST_HOOKS__.ingestPayload) {
    throw new Error("jk_bms.js's test hook did not populate -- window.__JK_BMS_TEST_HOOKS__ shape may have drifted");
  }
  return window.__JK_BMS_TEST_HOOKS__;
}

const hooks = loadRealClosures();
const { ingestPayload, entityByWireId, state, diagnosticReadouts, LEGACY_COMPANION_SUPPRESSED, PROTOCOL_CATALOG,
  numeric, activeCellCount } = hooks;

check("real jk_bms.js closures loaded via the test hook (not reimplemented)",
  typeof ingestPayload === "function" && entityByWireId instanceof Map);

// ===========================================================================
// 1. cell_connected_mask routing: real wire ids resolve correctly
// ===========================================================================
const EXACT_WIRE_ID = "text_sensor/cell connected mask exact";
const LEGACY_WIRE_ID = "sensor/cell connected mask";

check(`exact wire id "${EXACT_WIRE_ID}" resolves to canonical key "cell_connected_mask"`,
  entityByWireId.get(EXACT_WIRE_ID) === "cell_connected_mask");
check(`legacy wire id "${LEGACY_WIRE_ID}" resolves to LEGACY_COMPANION_SUPPRESSED, not a canonical key`,
  entityByWireId.get(LEGACY_WIRE_ID) === LEGACY_COMPANION_SUPPRESSED);

function exactPayload(v) {
  return { id: EXACT_WIRE_ID, domain: "text_sensor", name: "cell connected mask exact", icon: "", entity_category: 0, value: v, state: v };
}
function legacyPayload(raw, stateStr) {
  return { id: LEGACY_WIRE_ID, domain: "sensor", name: "cell connected mask", icon: "", entity_category: 0, value: raw, state: stateStr };
}

// ===========================================================================
// 2. bit31 + low bits together -- the precision risk this batch closes.
// A value with any high bit set corrupts float's LOW-bit precision too
// (float's ULP scales with magnitude) -- these cases prove the exact
// channel preserves every bit, unlike the legacy float channel would.
// ===========================================================================
{
  const raw = "2147483649"; // 0x80000001: bit31 + bit0 together
  ingestPayload(exactPayload(raw));
  check("bit31+bit0 together: canonical state holds the exact, bit-perfect decimal string",
    state.cell_connected_mask.state === raw, `state=${state.cell_connected_mask.state}`);
  check("bit31+bit0 together: stored value is the untouched string, not a float-coerced Number",
    typeof state.cell_connected_mask.value === "string" && state.cell_connected_mask.value === raw);
}

{
  // Legacy (float-published) update for the SAME underlying value must
  // never overwrite the already-resolved exact one -- the legacy channel
  // is what WOULD lose the low bit (float(2147483649) rounds to
  // 2147483648), so this also proves state[] never regresses to that.
  ingestPayload(legacyPayload(2147483648, "2147483648"));
  check("legacy update for the same underlying mask does not downgrade the exact bit31+bit0 value",
    state.cell_connected_mask.state === "2147483649");
  check("legacy payload creates no duplicate diagnostic row",
    !diagnosticReadouts.has(LEGACY_WIRE_ID) && diagnosticReadouts.has(EXACT_WIRE_ID));
}

// ===========================================================================
// 3. sparse / non-contiguous mask -- proves no bit silently merges or drops
// through the full ingestPayload -> state[] pipeline (not just the C++
// decode already covered by test_jk_poll_scheduler_core.cpp).
// ===========================================================================
{
  const raw = "65541"; // 0x00010005: bits 0, 2, 16 set
  ingestPayload(exactPayload(raw));
  check("sparse/non-contiguous mask (bits 0,2,16) survives the full pipeline exactly",
    state.cell_connected_mask.state === raw);
}

// ===========================================================================
// 4. 16S deployed-unit shape (bits 0-15 set, real hardware-plausible value)
// and legacy-first arrival order (order independence, mirrors the Stage 3
// precision-fix companion test's own "legacy->exact" case).
// ===========================================================================
{
  const legacyRaw = 65535;
  ingestPayload(legacyPayload(legacyRaw, "65535"));
  // The prior check block (section 3) left canonical state at "65541"
  // (the sparse-mask exact value) -- this legacy payload, carrying a
  // DIFFERENT value (65535), must not have overwritten it.
  check("legacy-first arrival never overwrites the already-resolved exact state",
    state.cell_connected_mask.state === "65541");

  ingestPayload(exactPayload("65535"));
  check("exact payload after legacy-first arrival correctly updates canonical state to the 16S deployed-unit mask",
    state.cell_connected_mask.state === "65535");
}

// ===========================================================================
// 5. unrelated wire id still resolves to neither a key nor the sentinel
// ===========================================================================
check("an unrelated wire id resolves to neither a canonical key nor the suppression sentinel",
  entityByWireId.get("sensor/cell connected mask totally made up") === undefined);

// ===========================================================================
// 6. Catalog: protocol capacity (32) vs connected topology, kept separate
// ===========================================================================
const fieldsByKey = new Map();
for (const r of canonical.registers) for (const f of r.fields) fieldsByKey.set(f.key, { field: f, register: r });

for (let ch = 17; ch <= 32; ch++) {
  const entry = fieldsByKey.get(`cell_voltage_${ch}`);
  check(`cell_voltage_${ch} exists in canonical.json (protocol capacity, CellVol${ch - 1})`, !!entry);
  if (entry) {
    check(`cell_voltage_${ch} is implemented this batch (decoded from the existing 1Hz buffer)`,
      entry.field.implementation_status === "implemented");
  }
}
for (let ch = 17; ch <= 32; ch++) {
  const entry = fieldsByKey.get(`cell_resistance_${ch}`);
  check(`cell_resistance_${ch} exists in canonical.json (protocol capacity, CellWireRes${ch - 1})`, !!entry);
  if (entry) {
    // Bounded batch (2026-09-17): now implemented, read via its own
    // isolated capability-gated command (batterylifepo4.yaml, 0x126A) --
    // ui_section "cells"/ui_order 1200+ch, matching cell_resistance_1..16's
    // own convention (see test/register_catalog/validate.js's own natural-
    // order check, updated to expect all 32 this batch).
    check(`cell_resistance_${ch} is implemented this bounded batch (own isolated capability-gated read, not a fabricated value)`,
      entry.field.implementation_status === "implemented" && entry.field.ui_section === "cells" && entry.field.ui_order === 1200 + ch);
  }
}
for (let ch = 1; ch <= 32; ch++) {
  const entry = fieldsByKey.get(`cell_connection_wire_resistance_${ch}`);
  check(`cell_connection_wire_resistance_${ch} exists in canonical.json (CellConWireRes${ch - 1}, RW calibration)`, !!entry);
  if (entry) {
    check(`cell_connection_wire_resistance_${ch} is RW-declared but write-blocked (calibration, not R telemetry, not confused with CellWireRes)`,
      entry.field.access === "rw" && entry.field.effective_access === "r");
    // Bounded batch (2026-09-17): read is now implemented (own isolated,
    // capability-gated, slow-cadence command, batterylifepo4.yaml 0x1088)
    // -- write stays blocked above regardless, and independently: an
    // explicit dynamic_dependency.rule (not just effective_access) records
    // that write-enablement is deliberately deferred to Stage 4, checked
    // below so a future accidental write-enable is caught even if
    // effective_access were ever miscomputed.
    check(`cell_connection_wire_resistance_${ch} is implemented (read) this bounded batch`,
      entry.field.implementation_status === "implemented");
    check(`cell_connection_wire_resistance_${ch} records its write-deferral as canonical fact (dynamic_dependency.resolved === false), not just a YAML comment`,
      !!entry.field.dynamic_dependency && entry.field.dynamic_dependency.resolved === false);
  }
}

{
  // Two rounds of user-directed correction (2026-09-17): round 1 reverted
  // maximum=32 -> 16 (CellVol/CellWireRes/CellConWireRes spanning indices
  // 0-31 proves protocol CHANNEL CAPACITY is 32, not that CellCount's OWN
  // register documents a range up to 32). Round 2 went further: 16 was
  // ALSO never a confirmed protocol-wide maximum, only this deployed
  // unit's own observed value -- neither the official PDF nor the V2
  // workbook states an explicit valid range for CellCount itself
  // (re-searched both rounds) -- maximum is now explicitly null (schema-
  // supported -- 25 other fields already use null min/max, all
  // editor_kind:"readonly" like this one), stating plainly that the range
  // is genuinely unknown rather than asserting either unevidenced number.
  // See cell_count's own register safety_notes for the full three-way
  // distinction: protocol capacity=32 (evidenced), resolve_topology's own
  // acceptance range=1..32 (an acceptance-range change, not a hardware
  // claim), CellCount's own confirmed documented range=unknown (null).
  const cc = fieldsByKey.get("cell_count").field;
  check("cell_count.maximum is explicitly null -- genuinely unconfirmed, not asserted as either 16 or 32",
    cc.maximum === null, `maximum=${cc.maximum}`);
  check("cell_count's evidence array was not manipulated to dodge or force the verification-status cascade (still 4 citations, same as pre-batch)",
    Array.isArray(cc.evidence) && cc.evidence.length === 4, `evidence.length=${cc.evidence.length}`);
}

// ===========================================================================
// 7. CellWireRes16-31 / CellConWireRes0-31 are read via their OWN bespoke,
// capability-gated commands in batterylifepo4.yaml (bounded batch,
// 2026-09-17) -- NOT via the generic read plan, which has no bounded-probe/
// capability-state concept at all and would otherwise poll them
// unconditionally, forever, regardless of configured N or of this
// project's own bounded-probe policy. Both facts checked: absent from the
// generated read plan, AND present (as a real command, not just a comment)
// in batterylifepo4.yaml's own bespoke code.
// ===========================================================================
for (let i = 16; i <= 31; i++) {
  const addr = `0x${(0x124A + i * 2).toString(16).toUpperCase().padStart(4, "0")}`;
  check(`CellWireRes${i} address ${addr} does NOT appear in the generated read plan (bespoke-excluded, not the generic pipeline's job)`,
    !readPlanYaml.includes(addr));
}
check("CellWireRes16-31's own read command (0x126A, 32 bytes) is present in batterylifepo4.yaml",
  batteryYaml.includes("0x126A, 32,"));
check("CellWireRes16-31's read is gated on configured CellCount (id(cell_count).state) via jk_capability::needs_cellwireres_extended_read(), not topology confirmation",
  batteryYaml.includes("jk_capability::needs_cellwireres_extended_read(id(cell_count).state)"));
check("CellWireRes16-31's read is bounded by jk_capability::should_attempt()/record_outcome() (no infinite probing)",
  batteryYaml.includes("jk_capability::should_attempt(ps)") && batteryYaml.includes("jk_capability::record_outcome(ps2, success)"));

for (let i = 0; i <= 31; i++) {
  const addr = `0x${(0x1088 + i * 4).toString(16).toUpperCase().padStart(4, "0")}`;
  check(`CellConWireRes${i} address ${addr} does NOT appear in the generated read plan (bespoke-excluded, not the generic pipeline's job)`,
    !readPlanYaml.includes(addr));
}
check("CellConWireRes0-31's own read command (0x1088, 128 bytes) is present in batterylifepo4.yaml",
  batteryYaml.includes("0x1088, 128,"));
check("CellConWireRes0-31 is read on a slow cadence (interval: 300s), never 1Hz",
  /interval:\s*300s[\s\S]{0,4000}0x1088,\s*128,/.test(batteryYaml));
check("CellConWireRes0-31 has no set_action / write path anywhere (write stays Stage 4 scope)",
  !batteryYaml.includes("set_cell_connection_wire_resistance"));

// ===========================================================================
// 7b. Diagnostic instrumentation (2026-09-18, user-directed): the
// CellConWireRes0-31 read's protocol contract (address, byte count,
// function code, cadence, bounded retry policy) must be BYTE-FOR-BYTE
// unchanged by adding diagnostics -- checked structurally, since this
// project has no way to compile/run the real firmware this session.
// ===========================================================================
check("CellConWireRes0-31: exactly one 300s interval exists project-wide (instrumentation did not add a second polling loop)",
  (batteryYaml.match(/interval:\s*300s/g) || []).length === 1);
check("CellConWireRes0-31: exactly one 0x1088,128 read command exists (instrumentation did not add a second/duplicate request)",
  (batteryYaml.match(/0x1088, 128,/g) || []).length === 1);
check("CellConWireRes0-31: still gated by jk_capability::should_attempt()/record_outcome() (bounded retry policy unchanged)",
  batteryYaml.includes("jk_capability::should_attempt(ps)") &&
  /record_outcome\(ps2, success\)/.test(batteryYaml));
check("CellConWireRes0-31: MAX_PROBE_ATTEMPTS is not overridden or duplicated anywhere in batterylifepo4.yaml (the ONLY bound is jk_capability_core.h's own constant)",
  !batteryYaml.includes("MAX_PROBE_ATTEMPTS ="));

check("CellConWireRes0-31: the response lambda captures its own generation id BY VALUE (misattribution guard, not a vendor patch)",
  batteryYaml.includes("[this_attempt_generation](auto, uint16_t, const auto &data)"));
check("CellConWireRes0-31: a late/stale callback is checked against jk_capability::callback_matches_pending_attempt() before touching any shared state",
  batteryYaml.includes("jk_capability::callback_matches_pending_attempt("));
check("CellConWireRes0-31: exactly one record_outcome() call site exists in the response lambda (never double-counted for one attempt)",
  (() => {
    const start = batteryYaml.indexOf("0x1088, 128,");
    const end = batteryYaml.indexOf("id(bms0)->queue_command(std::move(command));", start);
    const scope = batteryYaml.slice(start, end);
    return (scope.match(/jk_capability::record_outcome\(/g) || []).length === 1;
  })());

check("CellConWireRes0-31: NOT_ATTEMPTED is published explicitly at boot (distinct from an unpublished entity)",
  batteryYaml.includes("jk_capability::ATTEMPT_OUTCOME_NAMES[jk_capability::ATTEMPT_NOT_ATTEMPTED]"));
check("CellConWireRes0-31: last_response_bytes is never force-published to 0 before the first callback (stays unpublished == explicit unknown)",
  !batteryYaml.includes('cell_connection_wire_resistance_last_response_bytes)->publish_state(0'));
{
  const capabilityHeaderSrc = fs.readFileSync(path.join(ROOT, "components", "jk_capability", "jk_capability_core.h"), "utf8");
  for (const outcome of ["NOT_ATTEMPTED", "QUEUED_WAITING", "RESPONSE_OK", "RESPONSE_LENGTH_MISMATCH", "DEADLINE_EXPIRED_NO_DATA_CALLBACK"]) {
    check(`jk_capability_core.h's AttemptOutcome/ATTEMPT_OUTCOME_NAMES includes ${outcome}`,
      capabilityHeaderSrc.includes(outcome));
  }
  check("jk_capability_core.h does NOT claim an EXCEPTION-specific state (no real hook reachable from create_read_command() without subclassing -- see its own module comment)",
    !capabilityHeaderSrc.includes("ATTEMPT_EXCEPTION") && !capabilityHeaderSrc.includes("ATTEMPT_MODBUS_EXCEPTION"));
}

// ===========================================================================
// 8. cell_voltage_17-32 are read via the hand-written 1Hz cell-block lambda,
// not the generic scheduler -- confirmed absent from the generated read
// plan (bespoke-excluded) AND present in batterylifepo4.yaml's own lambda.
// ===========================================================================
for (let ch = 17; ch <= 32; ch++) {
  check(`cell_voltage_${ch} is NOT in the generated read plan (bespoke-excluded, no new Modbus command)`,
    !readPlanYaml.includes(`id(cell_voltage_${ch})`));
  check(`cell_voltage_${ch} IS decoded in batterylifepo4.yaml's own 1Hz cell-block lambda`,
    batteryYaml.includes(`id(cell_voltage_${ch})`));
}

// ===========================================================================
// 9. Short/exception response safety: the channel-17-32 decode loop lives
// INSIDE the same short-response guard the existing 1-16 decode already
// relies on (source-level check -- the guard's own early `return` is what
// makes this safe, no separate bounds check needed for the new loop).
// ===========================================================================
{
  const guardIdx = batteryYaml.indexOf("if (data.size() < 106)");
  const shortReturnIdx = batteryYaml.indexOf("return;", guardIdx);
  const extDecodeIdx = batteryYaml.indexOf("voltage_sensors_ext[16]");
  check("the channel-17-32 decode block appears AFTER the short-response guard's own early return (same safety net as channels 1-16)",
    guardIdx !== -1 && shortReturnIdx !== -1 && extDecodeIdx !== -1 && extDecodeIdx > shortReturnIdx);
}

// ===========================================================================
// 9b. User-directed architectural rework (2026-09-17, second pass):
// resolve_topology's decision logic (including the "never show residual
// bytes as trustworthy during UNKNOWN/MISMATCH, channel-aware not a fixed
// 16-ceiling" behavior) was extracted entirely into
// components/jk_topology/jk_topology_core.h's pure resolve() function --
// the REAL behavioral proof that blanking covers every branch (not only
// CONFIRMED) now lives in test/jk_topology/test_jk_topology_core.cpp
// (which actually calls resolve() with LOADING/WRITE_UNCERTAIN/OFFLINE/
// INVALID/MISMATCH/CONFIRMED inputs and asserts blank_voltage_from in
// each), a far stronger guarantee than a source-text landmark search can
// give. This block only checks that batterylifepo4.yaml's own wrapper
// correctly wires up to that pure function -- includes the header, calls
// resolve(), reads the RAW pre-blank voltage snapshot before calling it,
// and applies the returned blanking bounds afterward -- not the decision
// logic itself.
// ===========================================================================
{
  const includeIdx = batteryYaml.indexOf("components/jk_topology/jk_topology_core.h");
  check("batterylifepo4.yaml's includes: references components/jk_topology/jk_topology_core.h",
    includeIdx !== -1);

  const wrapperIdx = batteryYaml.indexOf("id: resolve_topology");
  const rawReadIdx = batteryYaml.indexOf("in.voltage[i] = voltage_sensors[i]->state;", wrapperIdx);
  const resolveCallIdx = batteryYaml.indexOf("jk_topology::resolve(in)", wrapperIdx);
  const blankAfterIdx = batteryYaml.indexOf("out.blank_voltage_from", wrapperIdx);
  check("resolve_topology's wrapper reads the RAW (pre-blank) voltage snapshot before calling jk_topology::resolve()",
    wrapperIdx !== -1 && rawReadIdx !== -1 && resolveCallIdx !== -1 && rawReadIdx < resolveCallIdx);
  check("resolve_topology's wrapper applies blank_voltage_from/blank_resistance_from AFTER calling resolve(), never before",
    resolveCallIdx !== -1 && blankAfterIdx !== -1 && resolveCallIdx < blankAfterIdx);

  // Negative control: the OLD inline decision logic (pre-extraction) must
  // be gone from the YAML, not just supplemented -- proves this is a real
  // extraction, not a second copy left behind alongside the new wrapper.
  check("the old inline MAX_CELL_CHANNELS constant is gone from batterylifepo4.yaml (logic now lives only in jk_topology_core.h)",
    !batteryYaml.includes("const uint8_t MAX_CELL_CHANNELS"));
}

// ===========================================================================
// 9c. Write safety: CellCount's real write path is fail-closed independent
// of canonical.json's derived effective_access -- a hardcoded ESP_LOGE
// refusal in set_cell_count's own set_action, never gated on catalog state.
// This is the actual, load-bearing safety mechanism; canonical.json's
// effective_access/verification_status are documentation, not the enforcement
// point -- evidence correctness must never be adjusted to manage that
// derivation, per the user's own explicit instruction this pass.
// ===========================================================================
{
  const setCellCountIdx = batteryYaml.indexOf("id: set_cell_count");
  const setActionIdx = batteryYaml.indexOf("set_action:", setCellCountIdx);
  const refusalIdx = batteryYaml.indexOf('CellCount write rejected: reverted to', setActionIdx);
  const noModbusIdx = batteryYaml.indexOf("no Modbus", setActionIdx);
  const queueCommandAfterSetAction = batteryYaml.indexOf("queue_command", setActionIdx);
  check("set_cell_count's set_action exists and contains a hardcoded fail-closed refusal (ESP_LOGE), independent of canonical.json's effective_access",
    setCellCountIdx !== -1 && setActionIdx !== -1 && refusalIdx !== -1 && refusalIdx > setActionIdx);
  check("set_cell_count's set_action explicitly logs that no Modbus command was queued",
    noModbusIdx !== -1 && noModbusIdx > setActionIdx);
  // queue_command should not appear between set_action: and the next real
  // config section boundary (max_value:) -- proves the stub genuinely
  // queues nothing, not just that it logs before queuing anyway.
  const numberSectionEndIdx = batteryYaml.indexOf("\n  - platform: template", setActionIdx + 1);
  check("set_cell_count's set_action body queues no Modbus command at all (the refusal is real, not just logged-then-ignored)",
    queueCommandAfterSetAction === -1 || (numberSectionEndIdx !== -1 && queueCommandAfterSetAction > numberSectionEndIdx));

  // Architectural rework, round 3 (user-directed, 2026-09-17): the UI
  // spinner's own max_value was raised 16 -> 32 (protocol capacity, a
  // sane input-range bound -- NOT a claim CellCount's own documented
  // range is confirmed) -- write safety is UNCHANGED by this: the
  // hardcoded refusal above still fires unconditionally regardless of
  // what value the spinner would accept. This permission never included
  // enabling any write to the BMS.
  const maxValueIdx = batteryYaml.indexOf("max_value: 32", setCellCountIdx);
  check("set_cell_count's max_value is 32 (protocol capacity, input-bound only) -- write still fail-closed regardless",
    maxValueIdx !== -1 && maxValueIdx > setCellCountIdx && maxValueIdx < setActionIdx);
}

// ===========================================================================
// 10. Adaptive mechanism preserved: cell_voltage_1..16/cell_resistance_1..16
// unchanged -- still implemented, still their original addresses. Framing
// correction (user-directed, 2026-09-17, round 3): this is NOT "the
// deployed 16S battery must keep working" as a hardcoded baseline -- it is
// "the adaptive mechanism must keep working correctly for whatever
// configured cell count it is given; the deployed 16S unit is one
// hardware test case among the fixture-tested range (see
// test/jk_topology/test_jk_topology_core.cpp's own 4S/8S/16S/24S/32S
// coverage), not a special case the mechanism is built around."
// ===========================================================================
const ORIGINAL_VOLTAGE_ADDRS = ["0x1200", "0x1202", "0x1204", "0x1206", "0x1208", "0x120A", "0x120C", "0x120E",
  "0x1210", "0x1212", "0x1214", "0x1216", "0x1218", "0x121A", "0x121C", "0x121E"];
for (let ch = 1; ch <= 16; ch++) {
  const entry = fieldsByKey.get(`cell_voltage_${ch}`);
  check(`cell_voltage_${ch} (existing 16S telemetry) still implemented at its original address`,
    !!entry && entry.field.implementation_status === "implemented" && entry.register.address === ORIGINAL_VOLTAGE_ADDRS[ch - 1]);
}
const ORIGINAL_RESISTANCE_ADDRS = ["0x124A", "0x124C", "0x124E", "0x1250", "0x1252", "0x1254", "0x1256", "0x1258",
  "0x125A", "0x125C", "0x125E", "0x1260", "0x1262", "0x1264", "0x1266", "0x1268"];
for (let ch = 1; ch <= 16; ch++) {
  const entry = fieldsByKey.get(`cell_resistance_${ch}`);
  check(`cell_resistance_${ch} (existing 16S telemetry) still implemented at its original address`,
    !!entry && entry.field.implementation_status === "implemented" && entry.register.address === ORIGINAL_RESISTANCE_ADDRS[ch - 1]);
}

// ===========================================================================
// 11. Bounded batch (2026-09-17): CellWireRes16-31 is now genuinely wired
// to the frontend -- real wire-id resolution AND the "hidden channels stay
// hidden regardless of capability" / "active channel with no value yet
// shows unavailable, never a fabricated value" contracts, exercised
// through the REAL jk_bms.js closures (ingestPayload/numeric/
// activeCellCount -- the exact functions renderCells() itself calls), not
// a reimplementation. Channel hiding itself (activeCellCount()) is NOT
// re-proven exhaustively here -- that is test/jk_topology/
// test_jk_topology_core.cpp's and test_cell_channel_frontend.js's own job
// (137+26 checks, unchanged by this batch); this section only proves the
// NEW read path plugs into that existing, already-tested mechanism
// correctly, without leaking capability state into channel visibility.
// ===========================================================================
function setCellCount(n) {
  ingestPayload({ id: "sensor/cell count", domain: "sensor", name: "cell count", icon: "", entity_category: 0, value: n, state: `${n}` });
}
function setTopologyStateForHidingTest(code) {
  ingestPayload({ id: "text_sensor/topology state", domain: "text_sensor", name: "topology state", icon: "", entity_category: 0, value: code, state: code });
}
function setDisplayCellCountForHidingTest(n) {
  ingestPayload({ id: "sensor/display cell count", domain: "sensor", name: "display cell count", icon: "", entity_category: 0, value: n, state: `${n}` });
}

{
  // 11a. Real wire-id resolution for the new entities -- proves the
  // esphome_read_entity_id/esphome_configured_name fix (canonical.json)
  // and the explicit registerEntity() calls (jk_bms.js) actually connect a
  // real incoming SSE payload to the right canonical key, for a
  // representative sample (first/last of both new families).
  check('wire id "sensor/cell 17 wire resistance" resolves to canonical key "cell_resistance_17"',
    entityByWireId.get("sensor/cell 17 wire resistance") === "cell_resistance_17");
  check('wire id "sensor/cell 32 wire resistance" resolves to canonical key "cell_resistance_32"',
    entityByWireId.get("sensor/cell 32 wire resistance") === "cell_resistance_32");
  check('wire id "sensor/cell connection wire resistance 1" resolves to canonical key "cell_connection_wire_resistance_1"',
    entityByWireId.get("sensor/cell connection wire resistance 1") === "cell_connection_wire_resistance_1");
  check('wire id "sensor/cell connection wire resistance 32" resolves to canonical key "cell_connection_wire_resistance_32"',
    entityByWireId.get("sensor/cell connection wire resistance 32") === "cell_connection_wire_resistance_32");
}

{
  // 11b. A real value for channel 17's resistance actually reaches
  // numeric() (the same accessor renderCells() itself calls) once ingested.
  ingestPayload({ id: "sensor/cell 17 wire resistance", domain: "sensor", name: "cell 17 wire resistance", icon: "", entity_category: 0, value: 0.06, state: "0.060" });
  check("cell_resistance_17's real value reaches numeric() after ingestPayload -- the read path is genuinely wired end to end",
    numeric("cell_resistance_17") === 0.06);
}

{
  // 11c. Hiding is unaffected by CellWireRes16-31 capability: for the
  // deployed unit's own N=16, activeCellCount() stays 16 (channels 17-32
  // hidden) regardless of whether cell_resistance_17 already has a real
  // value (11b, above, already gave it one) -- proves the new read path
  // cannot leak a channel into visibility just because its resistance
  // happened to arrive; channel count is still driven solely by
  // display_cell_count, exactly as test_jk_topology_core.cpp/
  // test_cell_channel_frontend.js already established.
  setTopologyStateForHidingTest("CONFIRMED");
  setDisplayCellCountForHidingTest(16);
  setCellCount(16);
  check("N=16: activeCellCount() == 16 even though cell_resistance_17 already has a real value -- CellWireRes support never leaks into channel visibility",
    activeCellCount() === 16);
}

{
  // 11d. A wider pack (N=24): channels 17-24 become active (would be
  // shown), but an active channel whose resistance has not arrived yet
  // (channel 20, deliberately never ingested) reads as null/NaN via
  // numeric() -- the exact underlying signal jk_bms.js's own
  // resistanceUnsupported condition (renderCells()) uses to show "not
  // read" instead of a fabricated value. This does not re-render the DOM
  // (this project's own no-DOM-library test convention, see
  // test_cell_channel_frontend.js's own precedent) -- it proves the real
  // data-layer signal renderCells() reads from is correct.
  setDisplayCellCountForHidingTest(24);
  setCellCount(24);
  check("N=24: activeCellCount() == 24 (channels 17-24 now active, 25-32 still hidden)",
    activeCellCount() === 24);
  check("N=24, channel 20's resistance never ingested: numeric('cell_resistance_20') is null -- renderCells() would show 'not read', never a fabricated 0",
    numeric("cell_resistance_20") === null);
  // Channel 17 (already given a real value in 11b) stays real even after
  // the topology change -- no stale-clearing bug reintroduced by this
  // batch's own changes.
  check("N=24, channel 17's earlier real value is still readable (no regression from the topology change above)",
    numeric("cell_resistance_17") === 0.06);
}

console.log(`\n${checks} checks run, ${failures} failed.`);
process.exit(failures ? 1 : 0);
