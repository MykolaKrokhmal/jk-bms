#!/usr/bin/env node
"use strict";

// Regression test for the Stage 3 cell-channel batch (user-directed,
// 2026-09-17): 64 missing cell-channel parameters (CellVol16-31,
// CellWireRes16-31, CellConWireRes0-31) plus the cell_connected_mask
// precision fix (topology bitmask must never round-trip through float --
// a high bit set, e.g. bit31, corrupts float's LOW-bit precision too,
// since float's ULP scales with magnitude). Covers:
//   - cell_connected_mask routing (exact/legacy, both arrival orders,
//     bit31+low-bits together, sparse masks) via the REAL jk_bms.js
//     closures (same vm test-hook technique as
//     test_exact_decimal_companion_routing.js -- no reimplementation).
//   - Catalog-level: protocol capacity (32 channels) vs this deployed
//     16S unit's own connected topology, kept as separate, explicit
//     concerns -- never a fabricated value for an unsupported/unknown
//     channel.
//   - No extra polling of unconfirmed extension blocks (CellWireRes16-31 /
//     CellConWireRes0-31 must be absent from the generated read plan).
//   - Existing 16S telemetry (cell_voltage_1..16/cell_resistance_1..16)
//     unchanged.
//   - Short/exception Modbus responses stay safe by construction (the new
//     channel-17-32 decode sits inside the SAME short-response guard the
//     existing 1-16 decode already relies on).
//
// Does NOT claim 32S hardware support is verified -- every check below
// either exercises protocol-capacity-only data (explicitly labeled) or
// the deployed 16S unit's own real, hardware-confirmed shape.

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
const { ingestPayload, entityByWireId, state, diagnosticReadouts, LEGACY_COMPANION_SUPPRESSED, PROTOCOL_CATALOG } = hooks;

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
    check(`cell_resistance_${ch} is explicitly NOT polled this batch (source_only_unimplemented, not a fabricated value)`,
      entry.field.implementation_status === "source_only_unimplemented" && entry.field.ui_section === "none");
  }
}
for (let ch = 1; ch <= 32; ch++) {
  const entry = fieldsByKey.get(`cell_connection_wire_resistance_${ch}`);
  check(`cell_connection_wire_resistance_${ch} exists in canonical.json (CellConWireRes${ch - 1}, RW calibration)`, !!entry);
  if (entry) {
    check(`cell_connection_wire_resistance_${ch} is RW-declared but write-blocked (calibration, not R telemetry, not confused with CellWireRes)`,
      entry.field.access === "rw" && entry.field.effective_access === "r");
    check(`cell_connection_wire_resistance_${ch} is explicitly NOT polled this batch`,
      entry.field.implementation_status === "source_only_unimplemented" && entry.field.ui_section === "none");
  }
}

{
  // Targeted correction (user-directed, 2026-09-17): maximum=32 was
  // reverted -- CellVol/CellWireRes/CellConWireRes spanning indices 0-31
  // proves protocol CHANNEL CAPACITY is 32 (a real fact about the register
  // map), not that CellCount's OWN register documents a range up to 32.
  // Neither the official PDF nor the V2 workbook states an explicit valid
  // range for CellCount itself (re-searched this session) -- maximum=16
  // is restored to its pre-batch value, itself ALSO not a confirmed
  // protocol-wide maximum, just this deployed unit's own observed value
  // (see cell_count's own register safety_notes for the full three-way
  // distinction: protocol capacity=32, operational ceiling=16, CellCount's
  // own confirmed range=unknown).
  const cc = fieldsByKey.get("cell_count").field;
  check("cell_count.maximum was NOT left at an unevidenced protocol-capacity claim (32) -- reverted to 16",
    cc.maximum === 16, `maximum=${cc.maximum}`);
  check("cell_count's evidence array was not manipulated to dodge or force the verification-status cascade (still 4 citations, same as pre-batch)",
    Array.isArray(cc.evidence) && cc.evidence.length === 4, `evidence.length=${cc.evidence.length}`);
}

// ===========================================================================
// 7. No extra polling of unconfirmed extension blocks: CellWireRes16-31 /
// CellConWireRes0-31 addresses must be ABSENT from the generated read plan
// (the only thing that actually issues Modbus reads on real hardware).
// ===========================================================================
for (let i = 16; i <= 31; i++) {
  const addr = `0x${(0x124A + i * 2).toString(16).toUpperCase().padStart(4, "0")}`;
  check(`CellWireRes${i} address ${addr} does NOT appear in the generated read plan (not polled this batch)`,
    !readPlanYaml.includes(addr));
}
for (let i = 0; i <= 31; i++) {
  const addr = `0x${(0x1088 + i * 4).toString(16).toUpperCase().padStart(4, "0")}`;
  check(`CellConWireRes${i} address ${addr} does NOT appear in the generated read plan (not polled this batch)`,
    !readPlanYaml.includes(addr));
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
// 9b. Targeted correction (user-directed, 2026-09-17): channels 17-32 must
// never show residual/raw bytes as trustworthy active-cell voltages during
// UNKNOWN/MISMATCH -- the unconditional blank must run BEFORE every branch
// resolve_topology can take (WRITE_UNCERTAIN/LOADING/OFFLINE/INVALID/
// MISMATCH/CONFIRMED), not only inside the CONFIRMED branch.
// ===========================================================================
{
  const publishLambdaIdx = batteryYaml.indexOf("auto publish = [](uint8_t state_code");
  const writeUncertainIdx = batteryYaml.indexOf("if (id(g_topology_uncertain))", publishLambdaIdx);
  const unconditionalBlankIdx = batteryYaml.indexOf("voltage_sensors_ext[16]", publishLambdaIdx);
  check("resolve_topology's publish lambda and its own WRITE_UNCERTAIN branch are both found (source landmarks present)",
    publishLambdaIdx !== -1 && writeUncertainIdx !== -1 && unconditionalBlankIdx !== -1);
  check("channels 17-32 are blanked to NaN BEFORE the WRITE_UNCERTAIN branch (and therefore before every other branch too, since WRITE_UNCERTAIN is resolve_topology's first check) -- covers LOADING/WRITE_UNCERTAIN/OFFLINE/INVALID/MISMATCH, not only CONFIRMED",
    unconditionalBlankIdx !== -1 && writeUncertainIdx !== -1 && unconditionalBlankIdx < writeUncertainIdx);

  // Negative control: the OLD, narrower "only blank on CONFIRMED" comment
  // text must be gone (proves this is a real behavior change, not just a
  // new comment layered over the old, still-conditional code).
  check("the old CONFIRMED-only blanking comment for channels 17-32 is gone (replaced, not just annotated)",
    !batteryYaml.includes("get the exact same \"not applicable to the current connected"));
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
}

// ===========================================================================
// 10. Existing 16S telemetry preserved: cell_voltage_1..16/cell_resistance_1..16
// unchanged -- still implemented, still their original addresses.
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

console.log(`\n${checks} checks run, ${failures} failed.`);
process.exit(failures ? 1 : 0);
