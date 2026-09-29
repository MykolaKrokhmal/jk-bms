#!/usr/bin/env node
/*
 * JK BMS V2 — demo server.
 *
 * Serves the REAL production jk_bms.js / jk_bms.css (read from the parent
 * directory, byte-for-byte, never copied/modified) behind a fake but
 * protocol-faithful ESPHome backend:
 *   - GET  /events        real text/event-stream SSE, same event-type/JSON
 *                          shape as ESPHome's web_server component
 *   - POST /select/:id/set, /number/:id/set, /text/:id/set
 *                          rejects catalog fields whose effective access is
 *                          read-only (HTTP 409). Only explicitly enabled
 *                          development endpoints exercise write simulation.
 *   - GET  /history.json  same shape as the on-device ring buffer
 *   - /demo/*             dev-only scenario control — NOT part of the
 *                          production wire protocol, used only by the
 *                          demo page's own dev panel.
 *
 * No dependencies beyond Node's standard library.
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const ROOT = path.join(__dirname, "..");
// Single source of truth (spec section 6) for which register lives at
// which address, shared with jk_bms.js's GENERIC_TX_ADDRESS and with
// batterylifepo4.yaml's own set_action addresses. Only "generic"-managed
// entries participate in the generic write-tx simulation below;
// cell_count and setup_passcode keep their own bespoke handling exactly
// like the real firmware.
const REGISTER_CATALOG = require(path.join(ROOT, "register_catalog.json"));
const READ_PLAN = require(path.join(ROOT, "protocol", "generated", "read_plan.json"));
// Mirror the firmware's read-only freshness snapshot and revision SSE using
// the demo's existing 1s tick, with no extra browser polling or bus model.
const readPlanFreshness = READ_PLAN.blocks.map((block) => ({
  address: parseInt(block.address, 16), cadenceMs: block.cadence_ms,
  lastSuccessMs: Date.now(), revision: 1,
}));
// Clustered reads (plan M5), from the same canonical cluster table the
// firmware's generated read_clusters_table.h comes from. In "clusters" mode
// the mock publishes the production wire format: one
// '<cluster id>:<cluster revision>:<sequence>' success per cluster read,
// every read-plan block inside the cluster read with it, and clusters[] in
// the freshness snapshot. A latched fallback group (POST
// /demo/cluster-fallback?cluster=A1) reverts to per-block
// '<address>:<revision>:<sequence>' events at the blocks' own cadence, for
// good. "legacy" mode (POST /demo/read-mode?name=legacy) is the pre-M5
// firmware: per-block events only and no clusters[] in the snapshot.
const READ_CLUSTERS = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "read_clusters.canonical.json"), "utf8"));
const readClusters = READ_CLUSTERS.clusters.map((c) => {
  const start = parseInt(c.start, 16);
  const end = start + 2 * c.register_count;  // JK addresses advance by 2 per register
  return {
    id: c.cluster_id, start, registers: c.register_count, cadenceMs: c.cadence_ms, budgetMs: c.freshness_budget_ms,
    sequenceAfter: c.sequence_after, lastSuccessMs: Date.now(), revision: 1, sequence: 0, fallback: false,
    blocks: readPlanFreshness.filter((b) => b.address >= start && b.address < end),
  };
});
const readClusterById = new Map(readClusters.map((c) => [c.id, c]));
const READ_MODES = ["clusters", "legacy"];
let readMode = "clusters";
function readClusterModeText() {
  const latched = readClusters.filter((c) => c.fallback).map((c) => c.id);
  return latched.length ? `fallback:${latched.join(",")}` : "clusters";
}
// Stage 4 production-integration gap fix (2026-09-21): the real firmware's
// generated write_registry.yaml `number:` entities are ALL internal:true
// -- ESPHome's generic /number/<id>/set REST route can never reach any of
// them on real hardware, only the new dedicated /settings/register-write
// endpoint can (see RegisterWriteHandler, batterylifepo4.yaml). Loaded
// here (not lower, where the rest of this file's own Stage 4 simulation
// lives) specifically so WRITE_REGISTRY_LIVE_KEYS exists before the
// REGISTER_BY_KEY loop below runs.
const WRITE_REGISTRY = require(path.join(ROOT, "protocol", "generated", "write_registry.json"));
const WRITE_REGISTRY_BY_KEY = Object.create(null);
const WRITE_REGISTRY_LIVE_KEYS = new Set();
const MIGRATED_SETTINGS_KEYS = new Set((WRITE_REGISTRY.settings_write_migration || [])
  .filter((m) => m.outcome === "migrated").map((m) => m.key));
for (const e of WRITE_REGISTRY.entries) {
  WRITE_REGISTRY_BY_KEY[e.key] = e;
  if (e.submit_policy === "live") WRITE_REGISTRY_LIVE_KEYS.add(e.key);
}
const REGISTER_BY_KEY = Object.create(null);
for (const reg of REGISTER_CATALOG.registers) {
  // Before this fix, a write-registry-eligible field (manager:"generic" in
  // register_catalog.json, since Stage 4 promoted its effective_access to
  // "rw") fell straight through to the legacy generic write-tx simulation
  // below, letting a test POST /number/set_gps_heartbeat/set succeed in
  // the mock even though the real entity is internal:true and genuinely
  // unreachable that way on real hardware -- a real mock/firmware
  // fidelity gap, not merely a hypothetical one (found this round).
  //
  // Settings write migration (clustered-read plan M5, owner decision
  // 2026-09-29): the 14 migrated owner-authorized Settings fields are live
  // registry entries too, but the SIMULATOR keeps their generic write-tx
  // route as a test-only hook -- it models the firmware entity's own
  // set_action -> generic Write Transaction Manager (ACK, forced readback,
  // WRITE_UNCERTAIN recovery, collision) that test/topology/run.js exercises
  // through /number/set_cell_uvpr and /number/set_cell_ovpr. The web UI
  // never uses this route (it writes only through /settings/register-write,
  // test_settings_catalog.js U4/U5), and on real hardware the entity is
  // internal:true with no REST route at all.
  if (reg.manager === "generic" && WRITE_REGISTRY_LIVE_KEYS.has(reg.key) && !MIGRATED_SETTINGS_KEYS.has(reg.key)) continue;
  if (reg.manager === "generic") REGISTER_BY_KEY[reg.key] = { ...reg, addr: parseInt(reg.address, 16) };
}
// Stage 1 Completion Pass (CODEX_STAGE_1_REMEDIATION_RESULT_REVIEW.md P0-4/
// Phase 6.4 "mock rejection" test requirement): every field the real
// firmware now refuses to write (declared access "rw" but effective_access
// != "rw" — see batterylifepo4.yaml's own set_action comments for cell_uvp/
// cell_count/setup_passcode/charging/etc.) must ALSO be rejected here, not
// just excluded from REGISTER_BY_KEY's generic-simulation path — the mock
// previously fell through to a generic "unknown entity, accepted but never
// confirmed" echo-back handler for exactly these keys, which silently
// applied the client's requested value after a short delay (a real,
// observable false success in the mock, even though real hardware was
// never touched). This set makes the mock's behavior match the firmware's:
// an outright rejection, not an optimistic echo.
const BLOCKED_REGISTER_KEYS = new Set(
  REGISTER_CATALOG.registers
    .filter((r) => (r.access === "rw" && r.effective_access !== "rw") || r.manager === "generic_authorization_required")
    .map((r) => r.key)
);
const PORT = Number(process.env.PORT) || 8321;
// Bind explicitly to IPv4 so a phone on the local Wi-Fi can open the demo
// using the Mac's LAN address. Some macOS setups expose an IPv6-only
// wildcard for listen(port), which makes localhost work but rejects IPv4.
const HOST = process.env.HOST || "0.0.0.0";

/* ============================================================
   ENTITY STATE — one flat map, wire id -> {state, value}, mirroring
   exactly what jk_bms.js's registerEntity() expects on the wire
   ("<domain>-<object_id>", e.g. "sensor-total_voltage").
   ============================================================ */
const entities = Object.create(null);
function setEntity(id, state, value) {
  entities[id] = { id, state: String(state), value: value === undefined ? state : value };
}

const CELL_COUNT = 16; // protocol/transport maximum -- never changes, mirrors MAX_CELL_COUNT in jk_bms.js
const BASE_CELL_V = 3.28;
// A realistic, mostly-quiet resting spread — cell_imbalance scenario grows
// this over time instead of starting from a suspiciously perfect pack.
let cellOffsetsMv = [4, -6, 2, 9, -2, 1, -11, 3, 6, -4, 2, -1, 14, -3, 0, -18];
let cellResistances = [1.28, 1.36, 1.44, 1.52, 1.20, 1.28, 1.36, 1.44, 1.52, 1.20, 1.28, 1.36, 1.44, 1.52, 1.20, 1.28];

/* ============================================================
   INDEPENDENT PHYSICAL/REGISTER STATE — deliberately three separate
   variables, exactly per spec §10 ("Запис configuredCellCount не повинен
   автоматично змінювати physicalTopologyCount"):
     registerCellCount     — what sensor-cell_count (the CellCount
                              register) currently reads. A write updates
                              THIS, and only this, directly.
     physicalTopologyCount — how many channels tick() actually treats as
                              wired/alive (real jittered voltage). Only a
                              scenario that represents "the BMS genuinely
                              re-detected the new topology" moves this.
     physicalMask          — the raw connected-mask bits. Normally the
                              contiguous "first physicalTopologyCount bits"
                              pattern, but deliberately settable to a
                              non-contiguous or extra-high-bit pattern for
                              the negative topology tests (mask_scenario).
   resolveTopologyMock() (below) is a faithful port of
   batterylifepo4.yaml's resolve_topology — it DERIVES topology_state from
   these three (+ cellVoltages + packVoltage + comms freshness), the same
   way the real firmware does, so no scenario can shortcut straight to a
   guaranteed "success" outcome — the outcome always falls out of the
   simulated physical facts, exactly like the device.
   ============================================================ */
let registerCellCount = CELL_COUNT;
let physicalTopologyCount = CELL_COUNT;
let physicalMask = (2 ** CELL_COUNT) - 1;
// Per-channel override: null = "derive from physicalTopologyCount /
// cellOffsetsMv as usual"; a number = a fixed voltage (including NaN) that
// tick() will keep publishing verbatim for that channel, for the
// missing_cell_voltage / nan_cell_voltage scenarios.
let cellVoltageOverride = new Array(CELL_COUNT).fill(null);
// null = "derive pack voltage as the natural sum of active channels";
// a number = a fixed override, for the VOLTAGE_SUM_DIFFERS scenario.
let packVoltageOverride = null;
let topologyRevision = 0;
let lastConfirmedCellCount = CELL_COUNT;
let topologyUncertain = false;
let cellCountTxId = 0;
let cellCountTxInFlight = false;

/* ============================================================
   PERSISTED CONTROL-REGISTER STATE — charging/discharging/balancing are
   two SEPARATE things on the real device (spec §4.3's disclosed defect
   was this mock conflating them): select-charging/select-discharging/
   select-balancing mirror the RW *control register* (0x1070/0x1074/
   0x1078) a user explicitly writes and which only a CONFIRMED write
   transaction (or a /demo override, see applyControlOverride below) may
   change — tick() must NEVER overwrite them on its own, the exact bug
   that was previously reported ("normal" scenario forced Charge/
   Discharge back to On every second even after a user turned it Off).
   binary_sensor-charging/binary_sensor-discharging (fed by the separate
   chargingOn/dischargingOn locals computed inside tick(), further down)
   mirror a DIFFERENT, genuinely continuously-live status register
   (the real device's charging_raw/discharging_raw) reflecting whether
   the BMS is actually passing current right now — legitimately scenario-
   driven (e.g. active_alarm correctly shows live current stopping due to
   a protection trip), independent of what the control register says.
   ============================================================ */
let controlChargingOn = true;
let controlDischargingOn = true;
let controlBalancingOn = true;
// Set by a scenario that deliberately, visibly overrides the control
// register's own confirmed value for demonstration purposes (matching
// spec §4.3's "for scenarios that intentionally overwrite outputs, the
// UI/test must receive an explicit reason, not a silent success") --
// null when no override is in effect.
let controlOverrideReason = null;

/* ============================================================
   GENERIC WRITE TRANSACTION MANAGER (mock) — mirrors
   batterylifepo4.yaml's jk_write_tx_core.h + the generic 250ms servicer:
   every RW select/number write EXCEPT cell_count (which keeps its own,
   separately-verified runCellCountTransaction below) goes through this,
   producing the SAME write_tx_snapshot JSON shape
   ([{"addr","tx_id","status","req","rb"}]) the real firmware publishes,
   so jk_bms.js's generic write path can be exercised against the demo
   exactly as it will run against real hardware.
   ============================================================ */
const WTX_SLOT_COUNT = 6;
let wtxSlots = []; // {inUse, txId, addr, wordCount, req, rb, status, startedMs}
let wtxNextId = 0;
const GENERIC_WRITE_SCENARIOS = [
  "confirm", "mismatch", "ack_timeout", "readback_timeout", "reject_busy",
  // Third critical audit (2026-09-10, item 7): the write DID silently
  // take effect on the register, but its ACK never arrived — same shape
  // as CellCount's own "applied_ack_lost" scenario, proving the recovery
  // probe can reach RECOVERED_CONFIRMED, not just RECOVERED_MISMATCH.
  "applied_ack_lost",
];
let genericWriteScenario = "confirm";

// Third critical audit (2026-09-10, item 7): WRITE_UNCERTAIN(6) blocks a
// new write to the same address, exactly like jk_write_tx_core.h's
// is_pending() now does on the real firmware — the address stays
// unwritable until the recovery probe resolves it to
// RECOVERED_CONFIRMED(10)/RECOVERED_MISMATCH(11).
const WTX_PENDING_STATUS = new Set([1, 2, 3, 6]); // sending, ack_wait, readback_wait, write_uncertain

// Single-flight guards a PENDING transaction, not a terminal one that
// merely hasn't been freed yet (see runGenericWriteTx's 3s grace
// period below) -- matches jk_write_tx_core.h's begin(), fixed after the
// automated suite caught two back-to-back writes to the same register
// being wrongly rejected as "still busy" moments after the first had
// already reached CONFIRMED.
function findPendingGenericSlot(addr) {
  return wtxSlots.find((s) => s.inUse && s.addr === addr && WTX_PENDING_STATUS.has(s.status)) || null;
}

function publishWriteTxSnapshot() {
  const arr = wtxSlots.filter((s) => s.inUse).map((s) => {
    const entry = { addr: s.addr, tx_id: s.txId, status: s.status };
    if (!s.suppress) { entry.req = s.req; entry.rb = s.rb; }
    return entry;
  });
  setEntity("text_sensor-write_tx_snapshot", JSON.stringify(arr));
  broadcastEntity("text_sensor-write_tx_snapshot");
}

// Mirrors jk_write_tx_core.h's state machine (sending -> ack_wait ->
// readback_wait -> confirmed/mismatch/ack_timeout/readback_timeout),
// honoring genericWriteScenario -- unlike batterylifepo4.yaml's raw
// register words, the mock stores/compares the SAME already-scaled
// display value the entity itself uses (e.g. "3.650" for cell_ovp), so
// no register-level unscaling is needed here; this is purely a
// simulation aid and does not change what the frontend observes on the
// wire (a JSON snapshot keyed by address, exactly like the real device).
// Second critical audit (2026-09-10): a busy-rejection previously only
// ever invoked `onTerminal(9, ...)` as a plain in-process callback -- it
// never touched write_tx_snapshot at all, so a real HTTP client (the
// actual frontend, not this file's own callback) had NO way to observe
// the rejection: findWriteTxEntry(addr) would keep returning either
// nothing or the OTHER in-flight transaction's entry, and the caller
// would silently time out waiting for a terminal status that was never
// coming for ITS OWN transaction id. Publishing a short-lived REJECTED(9)
// entry (same 3s grace period as a real terminal slot) closes that gap
// and mirrors the equivalent fix in batterylifepo4.yaml's begin_write_tx.
function publishRejected(addr) {
  const txId = ++wtxNextId;
  const slot = { inUse: true, addr, txId, status: 9, req: undefined, rb: undefined, suppress: true };
  wtxSlots.push(slot);
  publishWriteTxSnapshot();
  setTimeout(() => {
    const idx = wtxSlots.indexOf(slot);
    if (idx !== -1) wtxSlots.splice(idx, 1);
    publishWriteTxSnapshot();
  }, 3000);
}

function runGenericWriteTx(addr, wireId, requestedValue, suppress, onTerminal) {
  if (findPendingGenericSlot(addr)) {
    publishRejected(addr);
    if (onTerminal) onTerminal(9, requestedValue); // REJECTED — a transaction for this address is still pending
    return;
  }
  // A lingering TERMINAL slot for this same address (still `inUse` only
  // for the snapshot's own grace period, below) is superseded immediately
  // rather than counted against capacity or left duplicated.
  const staleIdx = wtxSlots.findIndex((s) => s.inUse && s.addr === addr);
  if (staleIdx !== -1) wtxSlots.splice(staleIdx, 1);
  if (wtxSlots.filter((s) => s.inUse).length >= WTX_SLOT_COUNT) {
    publishRejected(addr);
    if (onTerminal) onTerminal(9, requestedValue); // REJECTED — every slot busy
    return;
  }
  const scenario = genericWriteScenario;
  const txId = ++wtxNextId;
  const slot = { inUse: true, addr, txId, status: 1, req: requestedValue, rb: null, suppress };
  wtxSlots.push(slot);
  publishWriteTxSnapshot();

  const finishTerminal = (statusCode, applyValue) => {
    slot.status = statusCode;
    if (applyValue !== undefined && entities[wireId]) {
      setEntity(wireId, String(applyValue));
      broadcastEntity(wireId);
    }
    publishWriteTxSnapshot();
    setTimeout(() => {
      slot.inUse = false;
      const idx = wtxSlots.indexOf(slot);
      if (idx !== -1) wtxSlots.splice(idx, 1); // bound the array's long-term size, not just its "active" view
      publishWriteTxSnapshot();
    }, 3000);
    if (onTerminal) onTerminal(statusCode, applyValue);
  };

  // Third critical audit (2026-09-10, item 7): an ACK/readback timeout is
  // never reported to the client as a plain completed error — mirrors
  // CellCount's own bespoke uncertainty-recovery probe (finishUncertain in
  // runCellCountTransaction, above). timeoutStatusCode (7 or 8) is
  // published first so a client can see WHY, then the slot moves to
  // WRITE_UNCERTAIN(6) (blocking a new write to this address — see
  // WTX_PENDING_STATUS above) while an independent recovery probe does a
  // genuinely fresh read of the entity and resolves to
  // RECOVERED_CONFIRMED(10) (the write silently DID apply) or
  // RECOVERED_MISMATCH(11) (it did not, or applied to something else).
  const finishUncertain = (timeoutStatusCode) => {
    slot.status = timeoutStatusCode;
    publishWriteTxSnapshot();
    setTimeout(() => {
      if (!wtxSlots.includes(slot)) return; // superseded by a newer write to this address in the meantime
      slot.status = 6; // WRITE_UNCERTAIN
      publishWriteTxSnapshot();
      setTimeout(() => {
        if (!wtxSlots.includes(slot)) return;
        const actual = entities[wireId] ? entities[wireId].value : undefined;
        const recovered = !suppress && actual !== undefined && String(actual) === String(requestedValue);
        slot.rb = suppress ? undefined : actual;
        slot.status = recovered ? 10 : 11;
        publishWriteTxSnapshot();
        if (onTerminal) onTerminal(slot.status, recovered ? requestedValue : undefined);
        setTimeout(() => {
          slot.inUse = false;
          const idx = wtxSlots.indexOf(slot);
          if (idx !== -1) wtxSlots.splice(idx, 1);
          publishWriteTxSnapshot();
        }, 3000);
      }, 1500);
    }, 100);
  };

  setTimeout(() => {
    if (scenario === "ack_timeout") { finishUncertain(7); return; }
    if (scenario === "applied_ack_lost") {
      // The BMS DID receive and apply the write -- only its ACK response
      // is what gets lost, so the client sees exactly the same
      // ack_wait -> timeout sequence as plain ack_timeout, EXCEPT the
      // entity has already, silently, genuinely changed underneath it.
      if (entities[wireId]) { setEntity(wireId, String(requestedValue)); broadcastEntity(wireId); }
      finishUncertain(7);
      return;
    }
    slot.status = 2; // ack_wait -> acked immediately after
    publishWriteTxSnapshot();
    setTimeout(() => {
      slot.status = 3; // readback_wait
      publishWriteTxSnapshot();
      if (scenario === "readback_timeout") { setTimeout(() => finishUncertain(8), 1200); return; }
      setTimeout(() => {
        if (scenario === "mismatch") {
          slot.rb = suppress ? undefined : "(mismatch)";
          finishTerminal(5);
        } else {
          slot.rb = suppress ? undefined : requestedValue;
          finishTerminal(4, requestedValue);
        }
      }, 300);
    }, 300);
  }, 200);
}

/* ============================================================
   STAGE 4 PRODUCTION-INTEGRATION SIMULATION (2026-09-21, user-directed
   deployment-gate audit) -- /settings/register-write and
   /settings/register-write/preflight. SIMULATOR ONLY: this JS re-derives
   the encode/merge math from the REAL, generated write_registry.json (the
   same catalog batterylifepo4.yaml's compiled write_registry_table.h is
   generated from) and mirrors jk_write_tx_core.h's own
   encode_numeric_field/merge_field_into_raw formulas and the REAL
   firmware's physical block-cache model (one raw uint16/uint32 snapshot
   per physical register, with a freshness budget) -- but it is a
   reimplementation in JS for demo purposes, never a substitute for
   compiling and exercising the actual C++ handlers
   (RegisterWriteHandler/RegisterWritePreflightHandler) against real
   hardware. Reuses the SAME wtxSlots/runGenericWriteTx state machine as
   every other register write here (real single-flight is genuinely
   per-address across every write kind sharing the firmware's one 6-slot
   pool, so this is the MORE faithful simulation, not a shortcut) --
   register-write's own job is only computing the merged raw value to
   hand to it and applying it back to rawWordCache on CONFIRMED.
   (WRITE_REGISTRY/WRITE_REGISTRY_BY_KEY are declared near the top of this
   file, alongside REGISTER_BY_KEY's own exclusion filter -- see there.)
   ============================================================ */

// One raw physical-register snapshot per address this project's write
// registry ever references, mirroring g_rp_last_raw_word/
// g_rp_last_success_ms. A CellConWireRes* address (never in this demo's
// read plan, exactly like real hardware -- see jk_capability_core.h's own
// "never-before-read" module comment) is deliberately NEVER seeded here,
// so preflight/POST correctly report it unavailable, not a fabricated 0.
const rawWordCache = Object.create(null); // address(number) -> {raw, lastSuccessMs}
function seedRawWord(addrHex, raw) {
  rawWordCache[parseInt(addrHex, 16)] = { raw, lastSuccessMs: Date.now() };
}
// 0x1114: charging_float_mode (bit 9, pre-existing) starts "On" to match
// this file's own seedEntities() (`binary_sensor-charging_float_mode`,
// "On") -- every other documented bit starts 0/Off, matching a fresh
// device default. 0x1118: smart_sleep_timeout_hours (bits 8-15) starts 0.
seedRawWord("0x1114", 0x0200);
seedRawWord("0x1118", 0x0000);

// Mirrors jk_write_tx_core.h's encode_numeric_field exactly (same status
// enum ordering: 0=OK,1=NOT_FINITE,2=OUT_OF_RANGE,3=OVERFLOWS_FIELD).
function encodeNumericFieldMock(decodedValue, isSigned, scale, offset, minimum, maximum, fieldWidthBits) {
  if (!Number.isFinite(decodedValue)) return { status: 1, encodedRaw: 0 };
  if (decodedValue < minimum || decodedValue > maximum) return { status: 2, encodedRaw: 0 };
  const rawD = scale !== 0 ? Math.round((decodedValue - offset) / scale) : 0;
  if (!Number.isFinite(rawD)) return { status: 1, encodedRaw: 0 };
  if (isSigned) {
    const lo = -(2 ** (fieldWidthBits - 1));
    const hi = 2 ** (fieldWidthBits - 1) - 1;
    if (rawD < lo || rawD > hi) return { status: 3, encodedRaw: 0 };
    const mask = fieldWidthBits >= 32 ? 0xFFFFFFFF : (2 ** fieldWidthBits) - 1;
    return { status: 0, encodedRaw: (rawD < 0 ? rawD + 2 ** fieldWidthBits : rawD) & mask };
  }
  if (rawD < 0) return { status: 3, encodedRaw: 0 };
  const maxu = fieldWidthBits >= 32 ? 0xFFFFFFFF : (2 ** fieldWidthBits) - 1;
  if (rawD > maxu) return { status: 3, encodedRaw: 0 };
  return { status: 0, encodedRaw: rawD };
}
function mergeFieldIntoRawMock(oldRaw, mask, shift, encodedRaw) {
  const encodedBits = ((encodedRaw << shift) >>> 0) & mask;
  return ((oldRaw & ~mask) >>> 0 | encodedBits) >>> 0;
}
function parseHexAddr(s) { return parseInt(s, 16); }

// Width-aware register-container semantics (2026-09-21 hardware-acceptance
// corrective pass): a JS mirror of jk_write_tx_core.h's own
// container_mask_for_word_count/validate_field_geometry/
// format_hex_fixed_width/hex_digits_for_word_count -- kept in exact sync
// with the real production functions (same statuses, same formulas,
// same fail-closed cases) so this simulator can never again silently
// paper over the class of bug a real device just found (preservation_mask
// reported as the unbounded 32-bit complement of a 16-bit field's own
// mask). See that header's own module comment for the full root-cause
// writeup.
function containerMaskForWordCount(wordCount) {
  if (wordCount === 1) return { ok: true, containerMask: 0x0000FFFF };
  if (wordCount === 2) return { ok: true, containerMask: 0xFFFFFFFF };
  return { ok: false, containerMask: 0 };
}
function validateFieldGeometry(rawMask, shift, containerMask) {
  if (rawMask === 0) return { status: "ZERO_MASK", fieldMask: 0, preservationMask: 0 };
  if (((rawMask & ~containerMask) >>> 0) !== 0) return { status: "MASK_EXCEEDS_CONTAINER", fieldMask: 0, preservationMask: 0 };
  if (shift >= 32 || (((1 << shift) >>> 0) & rawMask) === 0) return { status: "SHIFT_MASK_MISMATCH", fieldMask: 0, preservationMask: 0 };
  return { status: "OK", fieldMask: rawMask, preservationMask: (containerMask & ~rawMask) >>> 0 };
}
function hexDigitsForWordCount(wordCount) { return wordCount === 2 ? 8 : 4; }
function formatHexFixedWidth(value, hexDigits) {
  return `0x${(value >>> 0).toString(16).toUpperCase().padStart(hexDigits, "0")}`;
}

function preflightRegisterWrite(entry, valueRaw) {
  const rawMask = parseHexAddr(entry.mask === null ? "0xFFFFFFFF" : entry.mask);
  const addr = parseHexAddr(entry.address);
  const cache = rawWordCache[addr];
  const now = Date.now();
  const fresh = !!cache && now - cache.lastSuccessMs <= entry.freshness_budget_ms;
  const isCredential = entry.write_safety_class === "credential";

  const width = containerMaskForWordCount(entry.word_count);
  const geom = width.ok ? validateFieldGeometry(rawMask, entry.shift, width.containerMask) : { status: "UNSUPPORTED_WORD_COUNT", fieldMask: 0, preservationMask: 0 };
  const geometryOk = width.ok && geom.status === "OK";
  const hexDigits = hexDigitsForWordCount(entry.word_count);

  let hasValue = valueRaw !== null && valueRaw !== undefined && String(valueRaw).trim() !== "";
  let enc = { status: 1, encodedRaw: 0 };
  if (hasValue) {
    const value = Number(valueRaw);
    if (!Number.isFinite(value)) hasValue = false;
    else enc = encodeNumericFieldMock(value, entry.signedness === "signed", entry.scale, entry.offset, entry.minimum, entry.maximum, entry.field_width_bits);
  }

  let rejectReason = null;
  // Geometry is a structural property of the registry entry itself, not
  // request-dependent -- checked first, matching RegisterWritePreflightHandler.
  if (!width.ok) rejectReason = "unsupported word_count";
  else if (geom.status === "ZERO_MASK") rejectReason = "invalid field mask (zero)";
  else if (geom.status === "MASK_EXCEEDS_CONTAINER") rejectReason = "field mask exceeds register width";
  else if (geom.status === "SHIFT_MASK_MISMATCH") rejectReason = "shift inconsistent with field mask";
  else if (!cache) rejectReason = "no read-plan block for this register";
  else if (!fresh) rejectReason = "raw snapshot unavailable or stale";
  else if (!hasValue) rejectReason = "value missing or not a finite number";
  else if (enc.status !== 0) rejectReason = "value rejected by encode/range check";
  else if (entry.submit_policy !== "live") rejectReason = "authorization_required";

  const canPreviewMerge = geometryOk && hasValue && enc.status === 0 && !!cache && fresh;
  const mergedRaw = canPreviewMerge ? (mergeFieldIntoRawMock(cache.raw, geom.fieldMask, entry.shift, enc.encodedRaw) & width.containerMask) >>> 0 : null;
  const encodedTargetBits = canPreviewMerge ? (((enc.encodedRaw << entry.shift) >>> 0) & geom.fieldMask) >>> 0 : null;
  const showPreservation = geometryOk && !isCredential && !!cache;
  const siblingBitsBefore = showPreservation ? (cache.raw & geom.preservationMask) >>> 0 : null;
  // sibling_bits_expected_after is deliberately derived FROM mergedRaw,
  // never copied from siblingBitsBefore -- see the production handler's
  // own comment for why a direct copy would make this field trivially
  // true instead of an honest proof.
  const siblingBitsExpectedAfter = canPreviewMerge && !isCredential ? (mergedRaw & geom.preservationMask) >>> 0 : null;

  const activeSlot = wtxSlots.find((s) => s.inUse && s.addr === addr) || null;
  return {
    key: entry.key,
    write_safety_class: entry.write_safety_class,
    submit_policy: entry.submit_policy,
    address: entry.address,
    write_function: "write_multiple_registers_fc16",
    word_count: entry.word_count,
    current_raw: isCredential || !cache ? null : cache.raw,
    raw_age_ms: cache ? now - cache.lastSuccessMs : null,
    generation: cache ? cache.lastSuccessMs : 0,
    mask: formatHexFixedWidth(rawMask, hexDigits),
    shift: entry.shift,
    encoded_target_bits: canPreviewMerge && !isCredential ? formatHexFixedWidth(encodedTargetBits, hexDigits) : null,
    merged_raw: canPreviewMerge && !isCredential ? mergedRaw : null,
    preservation_mask: showPreservation ? formatHexFixedWidth(geom.preservationMask, hexDigits) : null,
    sibling_bits_before: siblingBitsBefore,
    sibling_bits_expected_after: siblingBitsExpectedAfter,
    ready: rejectReason === null,
    reject_reason: rejectReason,
    active_transaction: activeSlot ? { tx_id: activeSlot.txId, status: activeSlot.status } : null,
  };
}

function handleRegisterWritePreflight(query, res) {
  const key = query.get("key") || "";
  const valueRaw = query.get("value");
  if (!key) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ready: false, reject_reason: "missing key" })); return; }
  const entry = WRITE_REGISTRY_BY_KEY[key];
  if (!entry) { res.writeHead(404, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ready: false, reject_reason: "unknown key" })); return; }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(preflightRegisterWrite(entry, valueRaw)));
}

// Async accepted/request_id/status-poll contract (2026-09-21, second
// corrective pass): removes the divergence a prior round's own comment
// here documented honestly -- this simulator now implements the SAME
// contract the real, rearchitected RegisterWriteHandler/
// RegisterWriteStatusHandler/main-loop consumer (batterylifepo4.yaml) and
// jk_write_tx_core.h's RegisterWriteResultTable implement: POST responds
// {"ok":true,"status":"accepted","key":...,"request_id":N} SYNCHRONOUSLY
// (never a real tx_id yet -- that would be a fabricated one, exactly what
// the real handler's own honest-contract comment forbids); a real tx_id
// only appears later, asynchronously, once a simulated ~100ms main-loop
// consumer delay elapses and GET /settings/register-write/status?
// request_id=N is polled. Single-flight (one staged-or-being-processed
// request_id at a time) and the full main-loop-only re-validation set
// (bms_health/topology_state/encode/freshness) are both simulated, so a
// simulator test can genuinely exercise every rejection reason production
// can produce -- not just the HTTP-time ones a synchronous mock could
// reach.
let registerWriteNextRequestId = 0;
let registerWritePendingRequestId = 0; // 0 = none in flight -- mirrors g_register_write_pending_request_id
const REGISTER_WRITE_RESULT_TTL_MS = 30000; // mirrors kRegisterWriteResultTtlMs
const registerWriteResults = new Map(); // request_id(number) -> {accepted, txId, reason, publishedAtMs}

function publishRegisterWriteResult(requestId, accepted, txId, reason) {
  registerWriteResults.set(requestId, { accepted, txId: txId || 0, reason: reason || "", publishedAtMs: Date.now() });
  if (registerWritePendingRequestId === requestId) registerWritePendingRequestId = 0;
}

function handleRegisterWrite(query, res) {
  const key = query.get("key") || "";
  const valueRaw = query.get("value");
  const submitPolicyArg = query.get("submit_policy") || "";
  const respondJson = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };

  // Every check in THIS function mirrors RegisterWriteHandler's own
  // httpd-task-safe checks (key lookup, submit_policy, well-formed
  // value) -- pure/no-shared-state, same as production. Everything that
  // needs the main loop's own re-validation (bms_health/topology_state/
  // encode-with-real-range/freshness/single-flight-on-the-real-slots) is
  // deferred to the simulated main-loop consumer below, exactly like
  // production defers it to its own interval: 100ms consumer.
  if (!key) return respondJson(400, { ok: false, error: "missing key" });
  if (submitPolicyArg !== "live") return respondJson(400, { ok: false, error: "submit_policy must be 'live'" });
  if (valueRaw === null || valueRaw === undefined || String(valueRaw).trim() === "") return respondJson(400, { ok: false, error: "missing value" });
  const value = Number(valueRaw);
  if (!Number.isFinite(value)) return respondJson(400, { ok: false, error: "value must be a finite number" });

  const entry = WRITE_REGISTRY_BY_KEY[key];
  if (!entry) return respondJson(404, { ok: false, error: "unknown key" });
  if (entry.submit_policy !== "live") return respondJson(403, { ok: false, error: "authorization_required", write_safety_class: entry.write_safety_class });

  // RegisterWriteHandler's own real encode/range check ALSO runs at HTTP
  // time (a pure function, no shared/component state touched -- safe on
  // any task, batterylifepo4.yaml's own comment: "no point burning the
  // single-flight slot on a value that could never succeed"). The main-
  // loop consumer below redoes this SAME check unconditionally -- this is
  // intentional, documented redundancy in production, not a shortcut this
  // simulator invented.
  const httpEnc = encodeNumericFieldMock(value, entry.signedness === "signed", entry.scale, entry.offset, entry.minimum, entry.maximum, entry.field_width_bits);
  if (httpEnc.status !== 0) return respondJson(400, { ok: false, error: "encode_rejected", status: httpEnc.status });

  // Single-flight mailbox: one staged-or-being-processed request at a
  // time, mirroring RegisterWriteRequestMailbox's own CAS-guarded state
  // machine -- a second POST while one is still unconsumed is REJECTED
  // outright, never queued/overwritten.
  if (registerWritePendingRequestId !== 0) {
    return respondJson(409, {
      ok: false, error: "pending",
      reason: "a write request is already staged and not yet consumed by the main loop",
    });
  }

  const requestId = ++registerWriteNextRequestId;
  registerWritePendingRequestId = requestId;
  respondJson(200, { ok: true, status: "accepted", key, request_id: requestId });

  // Simulated main-loop consumer -- a real, asynchronous delay (not
  // resolved synchronously within this same POST handler call) so a
  // client polling GET .../status genuinely observes "pending" at least
  // once before resolution, exactly like the real ~100ms interval: main
  // loop cadence. Re-validates everything from scratch, trusting nothing
  // already checked above (same reasoning as the real consumer's own
  // module comment in batterylifepo4.yaml).
  setTimeout(() => {
    if (entities["text_sensor-bms_health"] && entities["text_sensor-bms_health"].state !== "LIVE") {
      publishRegisterWriteResult(requestId, false, 0, "bms not live");
      return;
    }
    if (entities["text_sensor-topology_state"] && entities["text_sensor-topology_state"].state !== "CONFIRMED") {
      publishRegisterWriteResult(requestId, false, 0, "topology not confirmed");
      return;
    }
    const enc = encodeNumericFieldMock(value, entry.signedness === "signed", entry.scale, entry.offset, entry.minimum, entry.maximum, entry.field_width_bits);
    if (enc.status !== 0) { publishRegisterWriteResult(requestId, false, 0, "value rejected by encode/range check"); return; }

    const addr = parseHexAddr(entry.address);
    const mask = parseHexAddr(entry.mask === null ? "0xFFFFFFFF" : entry.mask);
    const cache = rawWordCache[addr];
    const now = Date.now();
    if (entry.write_uses_read_modify_write) {
      if (!cache) { publishRegisterWriteResult(requestId, false, 0, "no read-plan block for this register"); return; }
      if (now - cache.lastSuccessMs > entry.freshness_budget_ms) { publishRegisterWriteResult(requestId, false, 0, "stale"); return; }
    }
    const mergedRaw = cache ? mergeFieldIntoRawMock(cache.raw, mask, entry.shift, enc.encodedRaw) : enc.encodedRaw;
    // Write only when the register value changes (clustered-read plan M5,
    // owner decision 2026-09-29): the register already holds the value ->
    // terminal "no change", no write transaction at all -- the firmware's
    // RejectReason::NO_CHANGE, reported by the status endpoint as
    // "no_change".
    if (cache && mergedRaw === cache.raw) { publishRegisterWriteResult(requestId, false, 0, "no change"); return; }

    const idBefore = wtxNextId;
    runGenericWriteTx(addr, `__register_write_raw_${addr}`, String(mergedRaw), false, (statusCode) => {
      if (statusCode === 4 && rawWordCache[addr]) { rawWordCache[addr].raw = mergedRaw; rawWordCache[addr].lastSuccessMs = Date.now(); }
      else if (statusCode === 4) rawWordCache[addr] = { raw: mergedRaw, lastSuccessMs: Date.now() };
    });
    const idAfter = wtxNextId;
    if (idAfter === idBefore) { publishRegisterWriteResult(requestId, false, 0, "write not queued"); return; }
    // status !== 9 excludes publishRejected's own short-lived notification
    // slot -- this mock's wtxSlots array carries BOTH real transaction
    // slots and rejection notifications (for the SSE snapshot's sake) in
    // one array, unlike the real firmware, which keeps rejections in a
    // wholly separate g_wtx_rejected_* ring buffer that this same
    // txId/addr match could never accidentally hit there.
    const slot = wtxSlots.find((s) => s.inUse && s.txId === idAfter && s.addr === addr && s.status !== 9);
    if (!slot) {
      publishRegisterWriteResult(requestId, false, 0, "a transaction for this register is already in flight, or every transaction slot is busy");
      return;
    }
    publishRegisterWriteResult(requestId, true, idAfter, "");
  }, 100);
}

// GET /settings/register-write/status?request_id=N -- the async
// contract's own status poll, matching RegisterWriteStatusHandler's real
// JSON shapes exactly: pending/accepted/rejected/no_change/expired/unknown.
function handleRegisterWriteStatus(query, res) {
  const respondJson = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
  const requestIdRaw = query.get("request_id");
  const requestId = requestIdRaw !== null ? Number(requestIdRaw) : NaN;
  if (!Number.isInteger(requestId) || requestId <= 0) {
    return respondJson(400, { resolved: false, error: "missing or invalid request_id" });
  }

  const result = registerWriteResults.get(requestId);
  if (result) {
    if (Date.now() - result.publishedAtMs > REGISTER_WRITE_RESULT_TTL_MS) {
      return respondJson(200, { status: "expired", request_id: requestId });
    }
    if (result.accepted) return respondJson(200, { status: "accepted", request_id: requestId, tx_id: result.txId });
    if (result.reason === "no change") return respondJson(200, { status: "no_change", request_id: requestId });
    return respondJson(200, { status: "rejected", request_id: requestId, reason: result.reason });
  }
  if (registerWritePendingRequestId === requestId) return respondJson(200, { status: "pending", request_id: requestId });
  return respondJson(200, { status: "unknown", request_id: requestId });
}

/* ============================================================
   TOPOLOGY RESOLVER — a faithful JS port of resolve_topology in
   batterylifepo4.yaml (same priority order, same exact-mask check, same
   OFFLINE/WRITE_UNCERTAIN precedence, same voltage-sum tolerance). Reads
   ONLY the current entity/physical state and derives topology_state from
   it — no scenario handler ever sets topology_state directly, so a
   scenario cannot shortcut to a guaranteed outcome; the outcome always
   falls out of whatever physical facts that scenario set up, exactly
   like the real firmware.
   ============================================================ */
const TOPOLOGY_REASONS = [
  "OK", "AWAITING_SNAPSHOT", "COUNT_OUT_OF_RANGE", "NO_CONNECTED_CELLS",
  "NO_VALID_VOLTAGE", "MASK_COUNT_DIFFERS", "VOLTAGE_COUNT_DIFFERS",
  "ACTIVE_RANGE_GAP", "VOLTAGE_SUM_DIFFERS", "MASK_NOT_CONTIGUOUS",
  "BMS_OFFLINE", "WRITE_UNCERTAIN"
];
const TOPOLOGY_STATE_NAMES = ["LOADING", "CONFIRMED", "MISMATCH", "INVALID", "WRITE_UNCERTAIN", "OFFLINE", "PENDING"];

// display_cell_count mirrors jk_topology_core.h's
// channel_count_from_configured(): the CellCount register rounded, when it is
// within the protocol's channel capacity, else 0 ("no valid N to show").
// Computed on every resolve, independent of topology state, like production.
const PROTOCOL_CHANNEL_CAPACITY = 32;
function mockDisplayCellCount() {
  if (!Number.isFinite(registerCellCount)) return 0;
  const candidate = Math.round(registerCellCount);
  return candidate >= 1 && candidate <= PROTOCOL_CHANNEL_CAPACITY ? candidate : 0;
}

function resolveTopologyMock() {
  const changed = new Set();
  const setc = (id, state, value) => { setEntity(id, state, value); changed.add(id); };

  function publish(stateCode, reason, effective, connectedCount, measuredCount, activeSum) {
    topologyRevision += 1;
    setc("sensor-topology_revision", String(topologyRevision));
    setc("sensor-topology_data_freshness", "0.0");
    setc("sensor-effective_cell_count", String(effective));
    setc("sensor-display_cell_count", String(mockDisplayCellCount()));
    setc("sensor-last_confirmed_cell_count", String(lastConfirmedCellCount));
    setc("text_sensor-topology_state", TOPOLOGY_STATE_NAMES[stateCode]);
    setc("text_sensor-topology_reason", TOPOLOGY_REASONS[reason]);
    if (connectedCount !== null) setc("sensor-connected_cell_count", String(connectedCount));
    if (measuredCount !== null) setc("sensor-measured_cell_count", String(measuredCount));
    if (activeSum !== null) setc("sensor-active_cells_voltage_sum", activeSum.toFixed(3));
    for (const id of changed) broadcastEntity(id);
  }

  // ---- WRITE_UNCERTAIN overrides everything else. ----
  if (topologyUncertain) { publish(4, 11, CELL_COUNT, null, null, null); return; }

  // ---- OFFLINE: mirrors bms_health's own 30s threshold. ----
  if (bmsResponseAgeS > 30) { publish(5, 10, CELL_COUNT, null, null, null); return; }

  const configured = registerCellCount;
  const countInRange = Number.isFinite(configured) && configured >= 1 && configured <= CELL_COUNT;
  if (!countInRange) { publish(3, 2, CELL_COUNT, null, null, null); return; }

  const mask = physicalMask & 0xFFFF;
  const expectedMask = (2 ** configured) - 1;
  const maskExact = mask === expectedMask;

  let connectedCount = 0;
  for (let i = 0; i < CELL_COUNT; i += 1) if (mask & (1 << i)) connectedCount += 1;
  if (connectedCount === 0) { publish(3, 3, CELL_COUNT, 0, null, null); return; }

  // measuredCount (all 16 channels) is a pure DIAGNOSTIC, never a
  // CONFIRMED gate — see resolve_topology's own comment in
  // batterylifepo4.yaml for why gating on it deadlocks: the only place a
  // channel beyond `configured` gets blanked to NaN is the CONFIRMED
  // branch below, so requiring it to already look implausible before
  // CONFIRMED can be reached is circular. Only activeMeasuredCount
  // (WITHIN the configured range) matters for the determination.
  let measuredCount = 0;
  let activeMeasuredCount = 0;
  let activeRangeGap = false;
  let activeSum = 0;
  for (let i = 0; i < CELL_COUNT; i += 1) {
    const raw = entities[`sensor-cell_voltage_${i + 1}`];
    const v = raw ? Number(raw.value) : NaN;
    const plausible = Number.isFinite(v) && v > 0.5 && v < 10.0;
    if (plausible) measuredCount += 1;
    if (i < configured) {
      if (plausible) { activeSum += v; activeMeasuredCount += 1; } else activeRangeGap = true;
    }
  }
  if (activeMeasuredCount === 0) { publish(3, 4, CELL_COUNT, connectedCount, measuredCount, null); return; }

  let stateCode = 1; // CONFIRMED, optimistically
  let reason = 0; // OK
  if (!maskExact) { stateCode = 2; reason = connectedCount !== configured ? 5 : 9; }
  else if (activeRangeGap) { stateCode = 2; reason = 7; }
  else {
    const rawPackV = Number(entities["sensor-total_voltage"] ? entities["sensor-total_voltage"].value : NaN);
    const tolerance = Math.max(0.5, Math.abs(rawPackV) * 0.015);
    if (!Number.isFinite(rawPackV) || Math.abs(rawPackV - activeSum) > tolerance) { stateCode = 2; reason = 8; }
  }

  const effective = stateCode === 1 ? configured : CELL_COUNT;
  if (stateCode === 1) lastConfirmedCellCount = configured;
  publish(stateCode, reason, effective, connectedCount, measuredCount, activeSum);

  if (stateCode === 1) {
    // Blank inactive channels, exactly like the real firmware.
    for (let i = configured; i < CELL_COUNT; i += 1) {
      setEntity(`sensor-cell_voltage_${i + 1}`, "nan");
      setEntity(`sensor-cell_${i + 1}_wire_resistance`, "nan");
      broadcastEntity(`sensor-cell_voltage_${i + 1}`);
      broadcastEntity(`sensor-cell_${i + 1}_wire_resistance`);
    }
  }
}

function seedEntities() {
  setEntity("text_sensor-bms_display_name", "LiFePO4-1S16P-00");
  setEntity("text-device_name_override", "");
  setEntity("text_sensor-manufacturer_device_id", "JK-PB2A16S15P");
  setEntity("text_sensor-total_runtime_formatted", "4d 6h 12m");
  setEntity("sensor-wifi_signal", "-58");
  setEntity("text_sensor-wifi_ip_address", "192.168.1.84");
  setEntity("sensor-system_uptime", "367920");
  // Read-only mirrors of the JK settings register block, in the same
  // logical sequence as the mobile application reference screens.
  setEntity("sensor-cell_count", "16");
  setEntity("sensor-start_balance_trigger", "0.010");
  setEntity("sensor-start_balance", "3.300");
  setEntity("sensor-max_balance_current", "1.0");
  setEntity("sensor-cell_ovp", "3.650");
  setEntity("sensor-soc_100", "3.450");
  setEntity("sensor-cell_ovpr", "3.440");
  setEntity("sensor-cell_uvpr", "2.800");
  setEntity("sensor-soc_0", "2.790");
  setEntity("sensor-cell_uvp", "2.580");
  setEntity("sensor-system_power_off", "2.500");
  setEntity("sensor-smart_sleep", "3.500");
  setEntity("sensor-continued_charge_current", "140.0");
  setEntity("sensor-charge_ocp_delay", "3");
  setEntity("sensor-charge_ocpr_time", "60");
  setEntity("sensor-continued_discharge_current", "150.0");
  setEntity("sensor-discharge_ocp_delay", "300");
  setEntity("sensor-discharge_ocpr_time", "60");
  setEntity("sensor-discharge_otp", "52.0");
  setEntity("sensor-discharge_otpr", "50.0");
  setEntity("sensor-charge_otp", "52.0");
  setEntity("sensor-charge_otpr", "50.0");
  setEntity("sensor-charge_utpr", "3.0");
  setEntity("sensor-charge_utp", "1.0");
  setEntity("sensor-mos_otp", "100.0");
  setEntity("sensor-mos_otpr", "80.0");
  setEntity("sensor-scp_delay", "1500");
  setEntity("sensor-scpr_time", "5");
  setEntity("sensor-total_voltage", "52.34");
  setEntity("sensor-current", "0.05");
  setEntity("sensor-power", "3");
  setEntity("sensor-battery_capacity", "240");
  setEntity("sensor-full_charge_capacity", "238.4");
  setEntity("sensor-capacity_remaining", "187.2");
  setEntity("sensor-state_of_charge", "78");
  setEntity("sensor-charging_cycles", "142");
  setEntity("sensor-total_charging_cycle_capacity", "231.6");
  setEntity("sensor-temperature_sensor_1", "28.5");
  setEntity("sensor-temperature_sensor_2", "27.9");
  setEntity("sensor-temperature_sensor_4", "28.1");
  setEntity("sensor-temperature_sensor_5", "27.6");
  setEntity("sensor-mosfet_temperature", "31.4");
  setEntity("sensor-average_cell_voltage", "3.280");
  setEntity("sensor-delta_cell_voltage", "0.032");
  setEntity("sensor-balance_current", "0.42");
  setEntity("sensor-cell_rcv", "3.450");
  setEntity("sensor-cell_rfv", "3.400");
  // register 0x12B8 is a single UINT8 (0-100) on real hardware — no
  // fractional resolution, so the mock must not seed a decimal value.
  setEntity("sensor-state_of_health", "97");
  setEntity("text_sensor-alarms", "");
  setEntity("sensor-alarms_bitmask", "0");
  setEntity("text_sensor-charge_status", "float");
  setEntity("text_sensor-charge_phase", "float");
  setEntity("sensor-charge_status_time_elapsed", "5423");
  setEntity("sensor-charge_phase_elapsed", "0");
  setEntity("sensor-battery_state_elapsed", "0");
  setEntity("binary_sensor-charging_float_mode", "On");
  setEntity("text_sensor-battery_state_direction", "neutral");
  setEntity("text_sensor-battery_state_candidate", "neutral");
  setEntity("sensor-battery_state_candidate_samples", "0");
  setEntity("sensor-current_sample_age", "0.5");
  setEntity("text_sensor-battery_state_unknown_reason", "n/a");
  setEntity("text_sensor-battery_state_last_known", "float");
  setEntity("text_sensor-charge_phase_last_known", "float");
  setEntity("sensor-idle_current_noise_min", "NaN");
  setEntity("sensor-idle_current_noise_max", "NaN");
  setEntity("text_sensor-bms_health", "LIVE");
  setEntity("sensor-bms_last_update_age", "0.4");
  setEntity("binary_sensor-charging_allowed", "On");
  setEntity("binary_sensor-charging", "On");
  setEntity("binary_sensor-discharging_allowed", "On");
  setEntity("binary_sensor-discharging", "On");
  setEntity("binary_sensor-balancing_allowed", "On");
  setEntity("binary_sensor-balancing", "On");
  setEntity("text_sensor-control_override_reason", "");
  setEntity("text_sensor-write_tx_snapshot", "[]");
  setEntity("sensor-setup_passcode_tx_status_code", "0");
  // Production publishes these read-only readbacks as `sensor` entities
  // (protocol/generated/read_plan.yaml), not `number`.
  setEntity("sensor-heating_activation_temperature", "5");
  setEntity("sensor-heating_deactivation_temperature", "15");
  setEntity("sensor-dry_contact_1_trigger_source", "0");
  setEntity("sensor-dry_contact_2_trigger_source", "0");
  setEntity("sensor-dry_contact_1_trigger_value", "0");
  setEntity("sensor-dry_contact_1_recovery_value", "0");
  setEntity("sensor-dry_contact_2_trigger_value", "0");
  setEntity("sensor-dry_contact_2_recovery_value", "0");
  setEntity("sensor-rcv_time", "5.0");
  setEntity("sensor-rfv_time", "5.0");
  setEntity("sensor-lcd_buzzer_trigger", "9");
  for (let i = 0; i < CELL_COUNT; i += 1) {
    setEntity(`sensor-cell_voltage_${i + 1}`, (BASE_CELL_V + cellOffsetsMv[i] / 1000).toFixed(3));
    setEntity(`sensor-cell_${i + 1}_wire_resistance`, cellResistances[i].toFixed(3));
  }

  setEntity("sensor-cell_connected_mask", String(physicalMask));
  setEntity("sensor-last_confirmed_cell_count", String(lastConfirmedCellCount));
  setEntity("sensor-topology_revision", String(topologyRevision));
  setEntity("sensor-topology_data_freshness", "0.0");
  setEntity("sensor-cellcount_tx_id", String(cellCountTxId));
  setEntity("sensor-cellcount_tx_status_code", "0");
  // Topology Resolver outputs — boots CONFIRMED at the full 16S seed
  // above, exactly like a real BMS that has always reported a physically-
  // consistent snapshot. Every field here is re-derived by
  // resolveTopologyMock() (below), a faithful JS port of
  // batterylifepo4.yaml's resolve_topology; tick() never sets these
  // directly, and neither does any scenario handler — they only ever
  // mutate the underlying physical/register facts and then call the
  // resolver, exactly mirroring the real firmware.
  resolveTopologyMock();
}
// Called further below, after `clients` and `bmsResponseAgeS` are
// declared — resolveTopologyMock() (called from seedEntities()) reads
// both, and `let` bindings are in their temporal dead zone until the
// declaration itself has executed.

/* ============================================================
   SCENARIOS — dev-only, mutually exclusive telemetry situations plus an
   independent write-outcome dial. See demo/panel.js for the switcher UI.
   ============================================================ */
const SCENARIOS = [
  "normal", "charging", "discharging", "near_full", "low_soc",
  "cell_imbalance", "high_temp", "active_alarm",
  "bms_delayed", "bms_stale", "bms_offline", "browser_disconnected",
  // V2.2 hardening pass — timing-sensitive resolver test scenarios. These
  // run through resolverSim() below (an accelerated-timing equivalent of
  // batterylifepo4.yaml's charge_status state machine — same deadband/
  // hysteresis/adaptive-sample-count/reversal logic, dwell times scaled
  // down so multi-sample confirmation is observable in an interactive
  // session instead of requiring literal 15-30s real-world waits), not
  // the direct-value-setting path the scenarios above use.
  "idle", "unknown", "charging_near_threshold", "discharging_near_threshold",
  "zero_noise", "direction_reversal", "float_with_discharge", "reconnect_after_offline"
];
const WRITE_MODES = ["confirm", "mismatch", "timeout", "http_error"];
// Independent of SCENARIOS — deterministic 60h/6h *history* test fixtures
// for the Charge Cycle timeline rework (see chargeHistoryPayload() below).
const CC_HISTORY_MODES = ["normal", "idle_float", "complex", "short_transitions", "offline_gap", "partial"];
let ccHistoryMode = "normal";

let scenario = "normal";
let scenarioEnteredAt = Date.now();
let writeMode = "confirm";
let bmsResponseAgeS = 0.4; // drives bms_last_update_age / bms_health directly
let imbalanceGrowth = 0; // cell_imbalance ramps this each tick
let lastChargeStatus = "float";
let lastChargePhase = "float";
let chargePhaseS = 0;
let batteryStateS = 0;

/* ============================================================
   RESOLVER SIMULATION — accelerated-timing equivalent of the real
   charge_status resolver (batterylifepo4.yaml), used only by the
   timing-sensitive test scenarios listed above. Logic mirrors the real
   lambda exactly (deadband/hysteresis/adaptive fresh-sample count/
   direction reversal/Float-vs-discharge precedence/boot-unknown/
   reconnect-unknown) — only ACTIVE_CONFIRM_MS/NEUTRAL_DWELL_MS are
   compressed so a demo session can actually observe multi-sample
   confirmation without a literal 15-30s wait. One simulated tick here =
   one fresh sample, same as the real device's own per-poll cadence.
   ============================================================ */
const SIM = {
  CURRENT_ENTER_A: 0.5, CURRENT_EXIT_A: 0.2, STRONG_CURRENT_THRESHOLD_A: 2.5,
  ACTIVE_CONFIRM_MS: 3000, NEUTRAL_DWELL_MS: 6000, // accelerated from 15000/30000
  FRESH_SAMPLES_STRONG: 1, FRESH_SAMPLES_NEAR: 2, FRESH_SAMPLES_EXIT: 2
};
let simConfirmedDir = "neutral";
let simCandidateDir = "neutral";
let simCandidateSinceMs = Date.now();
let simCandidateFreshSamples = 0;
let simWasOffline = false;
let simHasValidData = false;

// current: the simulated signed pack current for this tick (already
// applies the scenario's own ramp — see the scenario branch below).
// floatBit/isOffline: the other two raw inputs the real resolver reads.
// Returns { batteryState, chargePhase } — same vocabulary as the real
// device's charge_status/charge_phase entities.
function resolverSim(current, floatBit, isOffline) {
  const now = Date.now();
  if (isOffline) {
    simWasOffline = true;
    return { batteryState: "offline", chargePhase: "none" };
  }
  if (simWasOffline) {
    // §11: reconnect requires one fresh sample before trusting anything
    // other than "unknown" — every simulated tick IS a fresh sample, so
    // this resolves on the very next tick after isOffline clears.
    simWasOffline = false;
    simHasValidData = true;
    return { batteryState: "unknown", chargePhase: "none" };
  }
  if (!simHasValidData) {
    simHasValidData = true; // this tick supplies the first sample
    return { batteryState: "unknown", chargePhase: "none" };
  }

  let sampleDir = simCandidateDir;
  if (current > SIM.CURRENT_ENTER_A) sampleDir = "charge";
  else if (current < -SIM.CURRENT_ENTER_A) sampleDir = "discharge";
  else if (Math.abs(current) < SIM.CURRENT_EXIT_A) sampleDir = "neutral";

  if (sampleDir !== simCandidateDir) {
    simCandidateDir = sampleDir;
    simCandidateSinceMs = now;
    simCandidateFreshSamples = 0;
  }
  simCandidateFreshSamples += 1; // this tick IS a fresh sample by construction

  const dwellNeeded = simConfirmedDir === "neutral" ? SIM.ACTIVE_CONFIRM_MS
    : simCandidateDir === "neutral" ? SIM.NEUTRAL_DWELL_MS
    : 0; // charge<->discharge reversal — no forced Idle stop
  const samplesNeeded = simCandidateDir === "neutral" ? SIM.FRESH_SAMPLES_EXIT
    : Math.abs(current) >= SIM.STRONG_CURRENT_THRESHOLD_A ? SIM.FRESH_SAMPLES_STRONG
    : SIM.FRESH_SAMPLES_NEAR;
  if (simCandidateDir !== simConfirmedDir
      && (now - simCandidateSinceMs) >= dwellNeeded
      && simCandidateFreshSamples >= samplesNeeded) {
    simConfirmedDir = simCandidateDir;
  }

  // Precedence: confirmed discharge > protocol Float > neutral/Idle >
  // charging (exactly the real resolver's order).
  if (simConfirmedDir === "discharge") return { batteryState: "discharging", chargePhase: "none" };
  if (floatBit) return { batteryState: "float", chargePhase: "float" };
  if (simConfirmedDir === "neutral") return { batteryState: "idle", chargePhase: "none" };
  return { batteryState: "charging", chargePhase: "bulk" }; // absorption sub-classification isn't simulated here — bulk is sufficient to exercise the direction/dwell machinery under test
}

/* ============================================================
   SSE — one entry per connected client; broadcast() writes to all of them.
   Matches ESPHome's actual wire shape: a named event per domain, JSON body
   {"id": "...", "state": "...", "value": ...}.
   ============================================================ */
const clients = new Set();

// Now that `clients` and `bmsResponseAgeS` both exist, it's safe to seed
// (seedEntities() calls resolveTopologyMock(), which reads both via
// broadcastEntity()/the OFFLINE check — broadcasting to zero clients here
// is a harmless no-op, exactly like ESPHome publishing before any client
// has connected).
seedEntities();
// Same "<address>:<revision>:<success sequence>" format as the firmware.
let readPlanSuccessSeq = 1;
setEntity("text_sensor-read_plan_success", `${readClusters[0].id}:1:${readPlanSuccessSeq}`);
readClusters[0].sequence = readPlanSuccessSeq;
setEntity("text_sensor-read_cluster_mode", readClusterModeText());

function publishBlockSuccess(block, now) {
  block.lastSuccessMs = now;
  block.revision += 1;
  readPlanSuccessSeq += 1;
  setEntity("text_sensor-read_plan_success", `${block.address}:${block.revision}:${readPlanSuccessSeq}`);
  broadcastEntity("text_sensor-read_plan_success");
}

// One tick of the read path: in "clusters" mode each due cluster is one
// read (its blocks all advance by one revision); a fallback cluster's blocks
// are read one by one; the isolated passcode block (in no cluster) is never
// read -- strictly on demand, as in the firmware.
function readPathTick(now) {
  if (readMode === "legacy") {
    for (const block of readPlanFreshness) {
      if (now - block.lastSuccessMs >= block.cadenceMs) publishBlockSuccess(block, now);
    }
    return;
  }
  for (const cluster of readClusters) {
    if (cluster.fallback) {
      for (const block of cluster.blocks) {
        if (now - block.lastSuccessMs >= block.cadenceMs) publishBlockSuccess(block, now);
      }
      continue;
    }
    if (now - cluster.lastSuccessMs < cluster.cadenceMs) continue;
    cluster.lastSuccessMs = now;
    cluster.revision += 1;
    for (const block of cluster.blocks) { block.lastSuccessMs = now; block.revision += 1; }
    readPlanSuccessSeq += 1;
    cluster.sequence = readPlanSuccessSeq;
    setEntity("text_sensor-read_plan_success", `${cluster.id}:${cluster.revision}:${readPlanSuccessSeq}`);
    broadcastEntity("text_sensor-read_plan_success");
  }
}

// The firmware's latch: the lead's whole group, for the rest of the session.
function latchClusterFallback(id) {
  const target = readClusterById.get(id);
  if (!target) return false;
  const lead = target.sequenceAfter || target.id;
  for (const cluster of readClusters) {
    if (cluster.id === lead || cluster.sequenceAfter === lead) cluster.fallback = true;
  }
  setEntity("text_sensor-read_cluster_mode", readClusterModeText());
  broadcastEntity("text_sensor-read_cluster_mode");
  return true;
}

// NOTE on wire-format fidelity: real ESPHome's web_server component
// actually publishes each entity's "id" as "<domain>/<configured name>"
// WITH SPACES INTACT (verified against a real device: "sensor/wifi
// signal", "binary_sensor/charging float mode") -- NOT this mock's own
// internal hyphen-and-underscore bookkeeping key ("sensor-wifi_signal").
// jk_bms.js's entityByWireId already registers both forms as aliases, so
// this mock's format keeps working for state resolution -- but it DID
// let a real bug in the register-list renderer go completely undetected
// through this project's demo-based test suite (diagnosticObjectId used
// to re-derive a key via a hyphen-only regex that happened to accidentally
// match THIS mock's format while silently breaking against real ESPHome's
// space-containing one -- see jk_bms.js's diagnosticObjectId/
// recordDiagnosticReadout comments for the actual fix). Reproducing the
// real slash+space format here was deliberately NOT done: it would touch
// this file's ~1000 setEntity call sites and this project's entire
// test/topology/run.js harness (which asserts against the current
// hyphenated ids throughout) for a fidelity improvement the real fix
// above no longer depends on. Left as a known, documented gap rather than
// a rushed rewrite risking the existing 615-check regression suite.
function sseFormat(domain, payload) {
  return `event: ${domain}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function domainOf(wireId) {
  const idx = wireId.indexOf("-");
  return idx === -1 ? "state" : wireId.slice(0, idx);
}

function broadcastEntity(wireId) {
  const entry = entities[wireId];
  if (!entry) return;
  const chunk = sseFormat(domainOf(wireId), entry);
  for (const res of clients) {
    try { res.write(chunk); } catch (_) { /* client gone; cleaned up on 'close' */ }
  }
}

function broadcastAll() {
  for (const wireId of Object.keys(entities)) broadcastEntity(wireId);
}

/* ============================================================
   TICK — every second, nudge values a small, physically plausible amount
   based on the active scenario. This is the same discipline the real
   device has: no delta filtering (every sensor republishes every poll),
   small steps, no chaotic random jumps.
   ============================================================ */
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function jitter(spread) { return (Math.random() - 0.5) * 2 * spread; }
function num(id) { return Number(entities[id] ? entities[id].value : 0); }

function tick() {
  const dirty = new Set();
  const tickNow = Date.now();
  if (scenario !== "bms_offline") readPathTick(tickNow);

  // Stage 4 production-integration simulation: keep rawWordCache "fresh"
  // the same way the real read-plan scheduler continuously re-polls
  // 0x1114 (15s cadence)/0x1118 (300s cadence) in the background --
  // refreshing every tick (1s) here is a conservative simplification
  // (always at least as fresh as real hardware would be), not a staleness
  // bypass: a register never seeded into rawWordCache in the first place
  // (every CellConWireRes* address -- never in this demo's read plan,
  // exactly like real hardware) stays permanently absent regardless.
  for (const addr of Object.keys(rawWordCache)) rawWordCache[addr].lastSuccessMs = Date.now();
  const set = (id, state, value) => {
    const next = String(state);
    if (entities[id] && entities[id].state === next) return;
    setEntity(id, state, value);
    dirty.add(id);
  };

  // ---- BMS communication freshness ----
  // browser_disconnected doesn't touch bms_health at all — that scenario is
  // about the SSE transport itself (see the /events handler), not the BMS link.
  if (scenario === "bms_delayed") bmsResponseAgeS = clamp(bmsResponseAgeS + jitter(0.6) + 0.3, 3.2, 9.5);
  else if (scenario === "bms_stale") bmsResponseAgeS = clamp(bmsResponseAgeS + jitter(0.8) + 0.6, 11, 28);
  else if (scenario === "bms_offline") bmsResponseAgeS += 1;
  else bmsResponseAgeS = clamp(0.2 + jitter(0.3), 0.1, 1.4);
  const health = bmsResponseAgeS < 3 ? "LIVE" : bmsResponseAgeS < 10 ? "DELAYED" : bmsResponseAgeS < 30 ? "STALE" : "OFFLINE";
  set("text_sensor-bms_health", health);
  set("sensor-bms_last_update_age", bmsResponseAgeS.toFixed(1));

  // Cleared every tick; only the active_alarm branch below re-asserts it,
  // so a scenario switch away from active_alarm can't leave a stale
  // override reason behind.
  controlOverrideReason = null;

  // ---- pack electrical + SOC drift ----
  let soc = num("sensor-state_of_charge");
  let current = num("sensor-current");
  let chargeStatus = entities["text_sensor-charge_status"].state; // battery_state: idle/charging/discharging/absorption/float/offline
  let chargePhase = entities["text_sensor-charge_phase"] ? entities["text_sensor-charge_phase"].state : "none"; // none/bulk/absorption/float
  // Live current-flow status (binary_sensor-charging/discharging) starts
  // from the persisted CONTROL register, but scenario branches below are
  // free to override it (a real BMS can legitimately stop passing
  // current while the control register stays enabled -- e.g. a
  // protection trip) -- that override only ever affects this LOCAL
  // variable, never controlChargingOn/controlDischargingOn themselves.
  let chargingOn = controlChargingOn;
  let dischargingOn = controlDischargingOn;
  let alarmText = "";

  // battery_state/charge_phase split, matching the real device's
  // charge_status resolver (batterylifepo4.yaml) exactly: "bulk" is
  // NEVER battery_state — plain charging reports battery_state=
  // "charging" with charge_phase="bulk". This mock previously reported
  // "Disabled" for the discharging/low_soc scenarios despite genuinely
  // negative (discharge-direction) current, faithfully reproducing the
  // real firmware bug that resolver fixes.
  if (scenario === "charging") {
    current = clamp(current + jitter(0.3) + (current < 12.4 ? 0.4 : 0), 0, 13.5);
    soc = clamp(soc + 0.02, 0, 100);
    const absorbing = soc > 96;
    chargeStatus = absorbing ? "absorption" : "charging";
    chargePhase = absorbing ? "absorption" : "bulk";
    chargingOn = true; dischargingOn = true;
  } else if (scenario === "discharging") {
    current = clamp(current - jitter(0.3) - (current > -8.5 ? 0.4 : 0), -9.5, 0);
    soc = clamp(soc - 0.015, 0, 100);
    chargeStatus = "discharging";
    chargePhase = "none";
    chargingOn = true; dischargingOn = true;
  } else if (scenario === "near_full") {
    soc = clamp(96 + jitter(1.5), 95, 100);
    current = clamp(current * 0.9 + jitter(0.15), 0, 2.5);
    chargeStatus = "float";
    chargePhase = "float";
    chargingOn = true; dischargingOn = true;
  } else if (scenario === "low_soc") {
    soc = clamp(7 + jitter(1.2), 3, 12);
    current = clamp(-3.5 + jitter(0.4), -5, -1);
    chargeStatus = "discharging";
    chargePhase = "none";
    chargingOn = true; dischargingOn = true;
  } else if (scenario === "active_alarm") {
    current = clamp(current * 0.8, -1, 1);
    chargeStatus = "idle";
    chargePhase = "none";
    // A genuine protection trip stops current flow WITHOUT touching the
    // control register the user configured -- controlOverrideReason
    // makes that divergence explicit (spec §4.3) rather than a silent
    // difference between the control select and the live status.
    chargingOn = false; dischargingOn = false;
    controlOverrideReason = "active_alarm_protection_trip";
    alarmText = "Cell overvoltage protection";
  } else if (scenario === "unknown") {
    // Not run through resolverSim on purpose — this demonstrates the
    // VISUAL result of an unresolved condition (§12/§26), held for as
    // long as the scenario stays selected, rather than the one-tick
    // "just booted" blip resolverSim's own boot path would otherwise
    // resolve out of on the very next sample.
    current = clamp(current + jitter(0.05), -0.2, 0.2);
    chargeStatus = "unknown";
    chargePhase = "none";
    chargingOn = true; dischargingOn = true;
    set("text_sensor-battery_state_unknown_reason", "no_telemetry_since_boot");
  } else if (scenario === "idle" || scenario === "zero_noise") {
    // zero_noise uses a tighter deadband-only oscillation to specifically
    // demonstrate NO flicker (§ test C/D); idle just settles there via
    // the same resolverSim dwell/confirmation path as any other scenario.
    const spread = scenario === "zero_noise" ? 0.05 : 0.15;
    current = clamp(jitter(spread), -0.5, 0.5);
    const r = resolverSim(current, false, false);
    chargeStatus = r.batteryState; chargePhase = r.chargePhase;
    chargingOn = true; dischargingOn = true;
  } else if (scenario === "charging_near_threshold" || scenario === "discharging_near_threshold") {
    // Oscillates just above ENTER (0.5A) but well below STRONG (2.5A) —
    // exercises the adaptive 2-fresh-sample confirmation path (§4/test A/B).
    const sign = scenario === "charging_near_threshold" ? 1 : -1;
    current = sign * clamp(0.6 + jitter(0.15), 0.5, 0.9);
    const r = resolverSim(current, false, false);
    chargeStatus = r.batteryState; chargePhase = r.chargePhase;
    chargingOn = true; dischargingOn = true;
  } else if (scenario === "direction_reversal") {
    // Flips sign every ~10s, well past STRONG_CURRENT_THRESHOLD_A each
    // way — exercises direct charge<->discharge reversal with no forced
    // Idle stop in between (§6/test E).
    const elapsedS = (Date.now() - scenarioEnteredAt) / 1000;
    const half = Math.floor(elapsedS / 10) % 2;
    current = (half === 0 ? 1 : -1) * clamp(6 + jitter(0.5), 5, 7);
    const r = resolverSim(current, false, false);
    chargeStatus = r.batteryState; chargePhase = r.chargePhase;
    chargingOn = true; dischargingOn = true;
  } else if (scenario === "float_with_discharge") {
    // Float protocol bit stays set WHILE a strong, confirmed discharge
    // current is present — exercises the explicit confirmed-discharge-
    // overrides-Float precedence (§7/§23/test F).
    current = clamp(-6 + jitter(0.4), -7, -5);
    const r = resolverSim(current, true, false);
    chargeStatus = r.batteryState; chargePhase = r.chargePhase;
    chargingOn = true; dischargingOn = true;
  } else if (scenario === "reconnect_after_offline") {
    // Offline for the first 5s after selecting this scenario, then
    // recovers — exercises §11/§22: reconnect must resolve "unknown" for
    // (at least) one tick before trusting real telemetry again, never a
    // stale pre-outage value flashed back on reconnect (test G).
    const elapsedS = (Date.now() - scenarioEnteredAt) / 1000;
    const isOfflineNow = elapsedS < 5;
    current = clamp(3 + jitter(0.3), 2, 4);
    const r = resolverSim(current, false, isOfflineNow);
    chargeStatus = r.batteryState; chargePhase = r.chargePhase;
    chargingOn = true; dischargingOn = true;
    if (isOfflineNow) bmsResponseAgeS = clamp(bmsResponseAgeS + 1, 0, 40);
    else bmsResponseAgeS = clamp(0.2 + jitter(0.3), 0.1, 1.4);
  } else {
    // normal / cell_imbalance / high_temp / bms_* / browser_disconnected —
    // idle-ish pack, not the point of those scenarios.
    current = clamp(current + jitter(0.05), -0.2, 0.2);
    soc = clamp(soc + jitter(0.02), 0, 100);
    chargeStatus = "float";
    chargePhase = "float";
    chargingOn = true; dischargingOn = true;
  }
  // *_allowed binary sensors expose the CONTROL registers read-only.
  // written here -- only a confirmed write transaction or a /demo
  // override changes them (see controlChargingOn's comment above; this
  // is the fix for the previously-reported bug where the "normal"
  // scenario forced Charge/Discharge back to On every tick even after a
  // user explicitly turned it Off).
  set("binary_sensor-charging_allowed", controlChargingOn ? "On" : "Off");
  set("binary_sensor-charging", chargingOn ? "On" : "Off");
  set("binary_sensor-discharging_allowed", controlDischargingOn ? "On" : "Off");
  set("binary_sensor-discharging", dischargingOn ? "On" : "Off");
  set("text_sensor-control_override_reason", controlOverrideReason || "");
  // balancing_allowed (the enable switch) vs binary_sensor-balancing (the
  // LIVE balancing_active signal, set further down from balanceActive)
  // are the same enabled-vs-active distinction as charging/discharging
  // above -- balancing_allowed is control-register state, only a write
  // transaction or /demo override changes it.
  set("binary_sensor-balancing_allowed", controlBalancingOn ? "On" : "Off");
  set("text_sensor-charge_status", chargeStatus);
  set("text_sensor-charge_phase", chargePhase);
  // Resolver diagnostics mirrors — reflect resolverSim()'s own internal
  // state for the scenarios that use it; harmless/static for the simpler
  // direct-value scenarios (no independent classification happens here).
  set("text_sensor-battery_state_direction", simConfirmedDir);
  set("text_sensor-battery_state_candidate", simCandidateDir);
  set("sensor-battery_state_candidate_samples", String(simCandidateFreshSamples));
  set("sensor-current_sample_age", "0.5"); // one simulated tick = one fresh sample, always recent
  if (chargeStatus !== "unknown") set("text_sensor-battery_state_unknown_reason", "n/a");
  if (chargeStatus !== "offline" && chargeStatus !== "unknown") {
    set("text_sensor-battery_state_last_known", chargeStatus);
    set("text_sensor-charge_phase_last_known", chargePhase);
  }
  if (Math.abs(current) < SIM.CURRENT_ENTER_A) {
    const prevMin = Number(entities["sensor-idle_current_noise_min"].value);
    const prevMax = Number(entities["sensor-idle_current_noise_max"].value);
    set("sensor-idle_current_noise_min", String(Number.isFinite(prevMin) ? Math.min(prevMin, current) : current));
    set("sensor-idle_current_noise_max", String(Number.isFinite(prevMax) ? Math.max(prevMax, current) : current));
  }
  set("text_sensor-alarms", alarmText);
  set("sensor-alarms_bitmask", alarmText ? "1" : "0");
  set("sensor-current", current.toFixed(2));
  set("sensor-state_of_charge", Math.round(soc));
  const mockPower = Math.round(current * num("sensor-total_voltage"));
  set("sensor-power", mockPower);
  // Charge/discharge splits, mirroring the production template sensors
  // (charging = positive part, discharging = positive part of the negation).
  set("sensor-charging_current", Math.max(current, 0).toFixed(3));
  set("sensor-discharging_current", Math.max(-current, 0).toFixed(3));
  set("sensor-charging_power", Math.max(mockPower, 0).toFixed(2));
  set("sensor-discharging_power", Math.max(-mockPower, 0).toFixed(2));
  set("sensor-capacity_remaining", (num("sensor-battery_capacity") * soc / 100).toFixed(1));
  set("sensor-charge_status_time_elapsed", String(Number(entities["sensor-charge_status_time_elapsed"].value) + 1));
  // Two SEPARATE clocks, matching the real device's battery_state/
  // charge_phase split: charge_phase_elapsed resets on bulk<->
  // absorption<->float transitions (charge_phase itself changing);
  // battery_state_elapsed resets whenever the main status changes
  // (chargeStatus itself changing) — they move together while actively
  // charging and diverge once the pack leaves the charging path.
  if (chargePhase !== lastChargePhase) { lastChargePhase = chargePhase; chargePhaseS = 0; } else { chargePhaseS += 1; }
  if (chargeStatus !== lastChargeStatus) { lastChargeStatus = chargeStatus; batteryStateS = 0; } else { batteryStateS += 1; }
  set("sensor-charge_phase_elapsed", String(chargePhaseS));
  set("sensor-battery_state_elapsed", String(batteryStateS));

  // ---- temperatures ----
  const tBase = scenario === "high_temp" ? 54 : 28;
  const tSpread = scenario === "high_temp" ? 4 : 1.5;
  set("sensor-mosfet_temperature", clamp(tBase + 3 + jitter(tSpread), -20, 90).toFixed(1));
  set("sensor-temperature_sensor_1", clamp(tBase + jitter(tSpread), -20, 90).toFixed(1));
  set("sensor-temperature_sensor_2", clamp(tBase - 0.6 + jitter(tSpread), -20, 90).toFixed(1));
  set("sensor-temperature_sensor_4", clamp(tBase + 0.3 + jitter(tSpread), -20, 90).toFixed(1));
  set("sensor-temperature_sensor_5", clamp(tBase - 0.9 + jitter(tSpread), -20, 90).toFixed(1));

  // ---- cells ----
  // Physical, not configured: only channels 0..physicalTopologyCount-1 are
  // the simulated pack's real, wired cells and get jittered every tick;
  // channels beyond that stay exactly as the last topology change left
  // them (an inactive "nan"), independent of whatever registerCellCount
  // (the CellCount register a write might have changed) currently claims
  // — that independence is the whole point (spec §10).
  if (scenario === "cell_imbalance") imbalanceGrowth = clamp(imbalanceGrowth + 0.4, 0, 40);
  else imbalanceGrowth = clamp(imbalanceGrowth - 0.6, 0, 40);
  const liveOffsets = cellOffsetsMv.map((base, i) => {
    // Cells 7 and 16 (already the widest spread in the seed data) drift
    // further apart under cell_imbalance — a growing, not chaotic, spread.
    const growth = (i === 6 || i === 15) ? -imbalanceGrowth : (i === 3 || i === 12) ? imbalanceGrowth * 0.5 : 0;
    return base + growth + jitter(0.6);
  });
  let physicalActiveSum = 0;
  const activeVoltagesForStats = [];
  for (let i = 0; i < physicalTopologyCount; i += 1) {
    const override = cellVoltageOverride[i];
    const v = override !== null ? override : BASE_CELL_V + liveOffsets[i] / 1000;
    set(`sensor-cell_voltage_${i + 1}`, Number.isFinite(v) ? v.toFixed(3) : "nan");
    if (Number.isFinite(v)) { physicalActiveSum += v; activeVoltagesForStats.push(v); }
    const r = clamp(cellResistances[i] + jitter(0.01), 0.5, 3);
    set(`sensor-cell_${i + 1}_wire_resistance`, r.toFixed(3));
  }
  // total_voltage/average/delta are the BMS's own DIRECT measurements —
  // they track the PHYSICAL pack, never the (possibly out of sync)
  // CellCount register, and packVoltageOverride can decouple total_voltage
  // from the cell sum entirely for the VOLTAGE_SUM_DIFFERS scenario.
  if (activeVoltagesForStats.length) {
    set("sensor-average_cell_voltage", (physicalActiveSum / activeVoltagesForStats.length).toFixed(3));
    set("sensor-delta_cell_voltage", (Math.max(...activeVoltagesForStats) - Math.min(...activeVoltagesForStats)).toFixed(3));
  }
  // Backend cell-voltage extremes, mirroring batterylifepo4.yaml's cell-block
  // decode: over the active channels, only plausible cells (>= 0.5 V), 1-based
  // index; left untouched when no cell is plausible (production returns early).
  // The browser displays these, never its own recomputation.
  let extremeMin = null, extremeMax = null;
  for (let i = 0; i < physicalTopologyCount; i += 1) {
    const v = Number(entities[`sensor-cell_voltage_${i + 1}`] && entities[`sensor-cell_voltage_${i + 1}`].value);
    if (!(Number.isFinite(v) && v >= 0.5)) continue;
    if (!extremeMin || v < extremeMin.v) extremeMin = { v, index: i + 1 };
    if (!extremeMax || v > extremeMax.v) extremeMax = { v, index: i + 1 };
  }
  if (extremeMin && extremeMax) {
    set("sensor-min_cell_voltage", extremeMin.v.toFixed(3));
    set("sensor-max_cell_voltage", extremeMax.v.toFixed(3));
    set("sensor-min_voltage_cell", String(extremeMin.index));
    set("sensor-max_voltage_cell", String(extremeMax.index));
  }
  const packV = packVoltageOverride !== null ? packVoltageOverride : physicalActiveSum;
  set("sensor-total_voltage", packV.toFixed(2));
  const balanceActive = scenario === "charging" || scenario === "near_full" || scenario === "cell_imbalance";
  const mockBalanceCurrent = balanceActive ? clamp(0.3 + jitter(0.2), 0.05, 1.2) : 0;
  set("sensor-balance_current", mockBalanceCurrent.toFixed(2));
  set("binary_sensor-balancing", balanceActive ? "On" : "Off");

  for (const id of dirty) broadcastEntity(id);

  // Re-derive topology every tick, exactly like the real firmware's 1Hz
  // cell-poll -> resolve_topology call — this is what lets a MISMATCH/
  // INVALID/OFFLINE self-heal the instant the underlying physical facts
  // become consistent again, with no scenario-specific "re-confirm" logic
  // needed. Skipped only while a CellCount transaction is actively
  // choreographing topology_state itself (PENDING and the ack/readback
  // phases) — see runCellCountTransaction() — so tick()'s own unconditional
  // re-resolve can't race ahead of that transaction's own timeline.
  if (!cellCountTxInFlight) resolveTopologyMock();
}
setInterval(tick, 1000);

/* ============================================================
   HISTORY — same shape as the real /history.json ring buffer.
   ============================================================ */
function walk(end, n, stepPct) {
  const pts = new Array(n);
  pts[n - 1] = end;
  let v = end;
  for (let i = n - 2; i >= 0; i -= 1) { v += jitter(end * stepPct); pts[i] = v; }
  return pts;
}
function historyPayload() {
  const v = num("sensor-total_voltage"), c = num("sensor-current"), p = num("sensor-power"), b = num("sensor-balance_current");
  return JSON.stringify({
    interval_s: 30,
    voltage: walk(v || 52.3, 60, 0.0025),
    current: walk(c || 0.1, 60, 0.15),
    power: walk(p || 5, 60, 0.15),
    balance: walk(b || 0.3, 60, 0.2),
    mosfet_temp: walk(num("sensor-mosfet_temperature") || 30, 60, 0.05),
    temp1: walk(num("sensor-temperature_sensor_1") || 28, 60, 0.04),
    temp2: walk(num("sensor-temperature_sensor_2") || 28, 60, 0.04),
    temp4: walk(num("sensor-temperature_sensor_4") || 28, 60, 0.04),
    temp5: walk(num("sensor-temperature_sensor_5") || 28, 60, 0.04)
  });
}

/* ============================================================
   CHARGE HISTORY — simulates the real 60-hour / 6-hour-window buffer
   (/charge_history.json/<offset>), replicating the ESP32 handler's own
   window_start_p/window_end_p/"any" clamping logic exactly (see
   ChargeHistoryHandler in batterylifepo4.yaml) — including the partial-
   buffer case, where a request for an offset beyond what's actually
   stored yet must come back genuinely empty, not zero-padded. Each
   sample is deterministic per CHRONOLOGICAL POSITION (seeded off the
   position itself, not the offset) so the same physical minute always
   reads the same regardless of which offset block happens to fetch it —
   required for the frontend's continuous client-side stitching to be
   testable at all. Six selectable fixtures (CC_HISTORY_MODES) cover the
   spec's required test matrix (§50): normal/idle_float/complex/
   short_transitions/offline_gap/partial.
   ============================================================ */
const CC_WINDOW = 360;   // samples per 6h window (60s each)
const CC_CAPACITY = 3600; // 60h total
const CC_MODE_TOTAL = { normal: CC_CAPACITY, idle_float: CC_CAPACITY, complex: CC_CAPACITY, short_transitions: CC_CAPACITY, offline_gap: CC_CAPACITY, partial: 120 };
function seededRand(seed) {
  let s = seed % 2147483647; if (s <= 0) s += 2147483646;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}
// minute = chronological position (0 = oldest ever stored, count-1 = newest).
function ccSampleAt(mode, minute) {
  const rand = seededRand(7919 * (minute + 1) + 13);
  let v, a, s, st;
  if (mode === "idle_float") { // spec §50 A: simple Idle -> Charging -> Float, repeating every 3h so it's visible anywhere in the buffer
    const cyclePos = (minute % 180) / 180;
    if (cyclePos < 0.4) { v = 51.2 + (rand() - 0.5) * 0.06; a = (rand() - 0.5) * 0.15; s = 55; st = 0; }
    else if (cyclePos < 0.55) { const t = (cyclePos - 0.4) / 0.15; v = 51.2 + t * 5.2; a = 6 + (rand() - 0.5) * 0.3; s = 55 + t * 20; st = 1; }
    else { v = 56.4 + (rand() - 0.5) * 0.05; a = 0.3 + (rand() - 0.5) * 0.1; s = 96; st = 3; }
  } else if (mode === "complex") { // spec §50 B: Discharge -> Charge -> Absorption -> Float -> Discharge, uneven durations, repeating every 6h
    const cyclePos = (minute % 360) / 360;
    if (cyclePos < 0.28) { const t = cyclePos / 0.28; v = 55.5 - t * 4.5 + (rand() - 0.5) * 0.1; a = -5 * (0.4 + t * 0.6); s = 80 - t * 35; st = 4; }
    else if (cyclePos < 0.50) { const t = (cyclePos - 0.28) / 0.22; v = 51.0 + t * 4.8 + (rand() - 0.5) * 0.1; a = 7 * (1 - t * 0.3); s = 45 + t * 30; st = 1; }
    else if (cyclePos < 0.60) { const t = (cyclePos - 0.50) / 0.10; v = 55.8 + t * 0.6 + (rand() - 0.5) * 0.05; a = 3 * (1 - t * 0.7); s = 75 + t * 10; st = 2; }
    else if (cyclePos < 0.75) { v = 56.4 + (rand() - 0.5) * 0.05; a = 0.3; s = 90; st = 3; }
    else { const t = (cyclePos - 0.75) / 0.25; v = 56.4 - t * 8.0 + (rand() - 0.5) * 0.1; a = -6 * (0.3 + t * 0.7); s = 90 - t * 55; st = 4; }
  } else if (mode === "short_transitions") { // spec §50 C: many short segments (5min each) cycling through every stage
    const stages = [1, 2, 3, 4, 0];
    const blockIdx = Math.floor(minute / 5);
    st = stages[blockIdx % stages.length];
    const posInBlock = (minute % 5) / 5;
    const targets = { 1: [50.0, 3.0, 6], 2: [53.0, 1.0, 2], 3: [54.0, 0, 0.3], 4: [54.0, -3.0, -5], 0: [51.2, 0, 0.05] };
    const [base, slope, cur] = targets[st];
    v = base + posInBlock * slope + (rand() - 0.5) * 0.05; a = cur; s = 50;
  } else if (mode === "offline_gap") { // spec §50 D: a real ~90min communication outage inside an otherwise normal cycle
    if (minute >= 3000 && minute < 3090) return { v: null, a: null, s: null, st: 5 };
    return ccSampleAt("normal", minute);
  } else if (mode === "partial") { // spec §50 E: only 2h genuinely exists — a single gentle charging ramp, nothing fabricated beyond it
    const t = minute / (CC_MODE_TOTAL.partial - 1);
    v = 49.0 + t * 6.0 + (rand() - 0.5) * 0.1; a = 6 * (1 - t * 0.5); s = 30 + t * 50; st = 1;
  } else { // "normal" (also spec §50 F: full 60h) — the original ~8h charge/discharge cycle, unchanged
    const cyclePos = (minute % 480) / 480;
    if (cyclePos < 0.55) {
      const t = cyclePos / 0.55;
      v = 48.5 + t * 6.5 + (rand() - 0.5) * 0.15; a = 8 * (1 - t * 0.7) + (rand() - 0.5) * 0.4; s = 20 + t * 75;
      st = t < 0.75 ? 1 : 2;
    } else {
      const t = (cyclePos - 0.55) / 0.45;
      v = 55.0 - t * 6.5 + (rand() - 0.5) * 0.15; a = -6 * (0.3 + t * 0.7) + (rand() - 0.5) * 0.4; s = 95 - t * 70;
      st = 4;
    }
  }
  return { v, a, s, st };
}
function chargeHistoryPayload(offset) {
  const clampedOffset = Math.max(0, Math.min(9, offset | 0));
  const count = CC_MODE_TOTAL[ccHistoryMode] || CC_CAPACITY;
  const windowsAvailable = count > 0 ? Math.ceil(count / CC_WINDOW) : 0;
  const windowEndP = count - 1 - clampedOffset * CC_WINDOW;
  const windowStartP = Math.max(0, windowEndP - (CC_WINDOW - 1));
  const any = count > 0 && windowEndP >= 0;
  const voltage = [], current = [], soc = [], stage = [];
  if (any) {
    for (let p = windowStartP; p <= windowEndP; p += 1) {
      const sample = ccSampleAt(ccHistoryMode, p);
      voltage.push(sample.v === null ? null : Math.round(sample.v * 100) / 100);
      current.push(sample.a === null ? null : Math.round(sample.a * 100) / 100);
      soc.push(sample.s === null ? null : Math.max(0, Math.min(100, Math.round(sample.s))));
      stage.push(sample.st);
    }
  }
  return JSON.stringify({
    interval_s: 60, window_samples: CC_WINDOW, total_samples: count,
    windows_available: windowsAvailable, offset: clampedOffset,
    voltage, current, soc, stage
  });
}

/* ============================================================
   WRITE ENDPOINTS — /select/:id/set, /number/:id/set, /text/:id/set.
   HTTP 200 is accepted immediately; the actual "BMS confirmed this" signal
   is a separate, delayed SSE push, honoring the current writeMode dial —
   exactly the gap the production Write Transaction Manager exists to close.
   ============================================================ */
function handleWrite(domain, objectId, query, res) {
  if (writeMode === "http_error") { res.writeHead(500); res.end("simulated failure"); return; }

  const targetObjectId = domain === "number" && objectId.startsWith("set_") ? objectId.slice(4) : objectId;

  if (BLOCKED_REGISTER_KEYS.has(targetObjectId)) {
    res.writeHead(409, { "Content-Type": "text/plain" });
    res.end(`write rejected: "${targetObjectId}" has no confirmed write path (see blockedWriteKeys)`);
    return;
  }

  const wireId = entities[`${domain}-${objectId}`] ? `${domain}-${objectId}` : `sensor-${targetObjectId}`;
  const requested = query.has("option") ? query.get("option") : query.get("value");
  const respondOk = () => { res.writeHead(200, { "Content-Type": "text/plain" }); res.end("OK"); };

  // CellCount doesn't just echo one field back — a real write changes
  // which channels the whole app trusts, so it runs its own staged
  // transaction timeline (runCellCountTransaction, below) instead of the
  // generic single-entity echo below. http_error is already handled
  // above (shared with every other register); every other CellCount-
  // specific scenario is chosen independently via cellCountScenario (see
  // /demo/cellcount-scenario), NOT the generic writeMode dial — a real
  // CellCount write and, say, a Balance Trigger write can fail for
  // completely different reasons at the same time.
  if (targetObjectId === "cell_count") {
    if (cellCountScenario === "sse_before_http") {
      // Deliberately hold the HTTP response until the transaction has
      // fully resolved and broadcast its terminal SSE event — the exact
      // race spec §5 requires the frontend to survive (a confirmation
      // arriving over SSE before the POST's own fetch() promise settles).
      runCellCountTransaction(Number(requested), respondOk);
      return;
    }
    respondOk();
    if (!entities[wireId]) return;
    runCellCountTransaction(Number(requested));
    return;
  }

  // Generic Write Transaction Manager (spec §4.1) — only a catalog-listed
  // "generic" register (the ~35 number/select RW registers, everything
  // except cell_count and setup_passcode) routes through the SAME
  // write -> ack_wait -> readback_wait -> confirmed/mismatch/timeout
  // staged timeline as CellCount, honoring genericWriteScenario (see
  // /demo/generic-write-scenario) rather than the old writeMode dial's
  // blunt timeout/mismatch (writeMode still governs http_error above and
  // still applies to anything NOT in the catalog, e.g. device_name_override).
  const catalogEntry = (domain === "number" || domain === "select") ? REGISTER_BY_KEY[targetObjectId] : null;
  if (catalogEntry) {
    respondOk();
    // charging/discharging/balancing are CONTROL registers (spec §4.3):
    // only a CONFIRMED write transaction may change controlChargingOn/
    // controlDischargingOn/controlBalancingOn (tick() publishes select-*
    // from these every cycle and never writes them itself, above) --
    // applying the persisted var straight from runGenericWriteTx's own
    // terminal callback, not by polling, avoids ever guessing at timing.
    runGenericWriteTx(catalogEntry.addr, wireId, requested, false, (statusCode) => {
      if (statusCode !== 4) return; // only a real CONFIRMED changes control state
      if (targetObjectId === "charging") controlChargingOn = requested === "On";
      else if (targetObjectId === "discharging") controlDischargingOn = requested === "On";
      else if (targetObjectId === "balancing") controlBalancingOn = requested === "On";
    });
    return;
  }

  if (!entities[wireId]) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("write endpoint not found");
    return;
  }
  respondOk();

  window_setTimeout(() => {
    if (writeMode === "timeout") return; // never echo back
    let echoed = requested;
    if (writeMode === "mismatch") {
      echoed = domain === "select" ? (requested === "On" ? "Off" : "On") : String(Number(requested) + 99);
    }
    setEntity(wireId, echoed);
    broadcastEntity(wireId);
    if (domain === "select") {
      const activeId = `binary_sensor-${objectId}`;
      if (entities[activeId]) { setEntity(activeId, echoed); broadcastEntity(activeId); }
    }
  }, 450 + Math.random() * 250);
}
function window_setTimeout(fn, ms) { setTimeout(fn, ms); } // named for readability at the call site above

/* ============================================================
   CELLCOUNT TRANSACTION — a staged timeline (sending -> ack_wait ->
   readback_wait -> terminal) that mirrors the REAL ESP32 firmware's own
   250ms transaction interval and timeouts (3s ACK, 4s readback), so the
   demo exercises the frontend's actual timing budget, not an
   instantaneous stand-in. Every scenario only ever mutates the
   underlying PHYSICAL facts (registerCellCount / physicalTopologyCount /
   physicalMask / per-cell voltage / pack voltage) and then calls
   resolveTopologyMock() — never topology_state directly — so no scenario
   can manufacture a guaranteed outcome; CONFIRMED only ever happens if
   the physical facts a scenario set up actually satisfy every one of the
   resolver's checks, exactly like real hardware. See CELLCOUNT_SCENARIOS
   just below for what each one simulates.
   ============================================================ */
const CELLCOUNT_SCENARIOS = [
  "confirm", "mismatch_config_only", "mismatch_non_contiguous", "mismatch_extra_bit",
  "timeout_no_apply", "applied_ack_lost", "ack_ok_readback_stale", "readback_timeout", "delayed_readback",
  "sse_before_http", "duplicate_terminal_sse", "out_of_order_sse"
];
let cellCountScenario = "confirm";

function setCellCountTxStatus(code) {
  setEntity("sensor-cellcount_tx_status_code", String(code));
  broadcastEntity("sensor-cellcount_tx_status_code");
}

// registerCellCount (the JS variable) and the sensor-cell_count entity
// are deliberately kept separate: a scenario may change the variable
// (the BMS's internal state) well before anything re-reads and publishes
// it — exactly the applied_ack_lost case, where the write silently took
// effect but nothing confirms it until the recovery probe's own forced
// read lands, seconds later.
function publishRegisterCellCount() {
  setEntity("sensor-cell_count", String(registerCellCount));
  broadcastEntity("sensor-cell_count");
}

function applyContiguousTopologyChange(requested) {
  registerCellCount = requested;
  physicalTopologyCount = requested;
  physicalMask = (2 ** requested) - 1;
  cellVoltageOverride = new Array(CELL_COUNT).fill(null);
  packVoltageOverride = null;
  // Channels 0..requested-1 need a REAL (non-NaN) voltage available
  // immediately, not just "whatever tick() last left there" — a channel
  // moving from inactive to active (e.g. 4S -> 8S) is currently NaN
  // (blanked by the previous CONFIRMED resolution), and total_voltage
  // needs to be resolveTopologyMock()-consistent right away, since
  // finishTerminal() calls the resolver SYNCHRONOUSLY, not on the next
  // tick(). Real hardware doesn't have this timing gap — its pack-voltage
  // register is an independent, continuously fresh direct measurement,
  // not derived from a per-tick cache — this is purely restoring mock
  // fidelity to that, not a resolver behavior change.
  let sum = 0;
  for (let i = 0; i < requested; i += 1) {
    const raw = entities[`sensor-cell_voltage_${i + 1}`];
    const existing = raw ? Number(raw.value) : NaN;
    const v = Number.isFinite(existing) ? existing : BASE_CELL_V + cellOffsetsMv[i] / 1000;
    setEntity(`sensor-cell_voltage_${i + 1}`, v.toFixed(3));
    setEntity(`sensor-cell_${i + 1}_wire_resistance`, cellResistances[i].toFixed(3));
    broadcastEntity(`sensor-cell_voltage_${i + 1}`);
    broadcastEntity(`sensor-cell_${i + 1}_wire_resistance`);
    sum += v;
  }
  setEntity("sensor-total_voltage", sum.toFixed(2));
  broadcastEntity("sensor-total_voltage");
}

function runCellCountTransaction(requested, onTerminal) {
  if (!Number.isFinite(requested) || requested < 1 || requested > 16) { if (onTerminal) onTerminal(); return; }
  // Mirrors the real firmware's own single-flight guard (set_cell_count's
  // set_action: "if (id(g_cellcount_tx_pending)) { ...ignoring; return; }")
  // — a second CellCount write arriving while one is already in flight is
  // silently ignored, never allowed to interleave with or override it.
  if (cellCountTxInFlight) { if (onTerminal) onTerminal(); return; }
  const scenario = cellCountScenario;
  const txId = ++cellCountTxId;
  cellCountTxInFlight = true;

  setEntity("sensor-cellcount_tx_id", String(txId));
  broadcastEntity("sensor-cellcount_tx_id");
  setCellCountTxStatus(1); // sending

  const finishUncertain = (statusCode) => {
    topologyUncertain = true;
    setCellCountTxStatus(statusCode); // 7=ack_timeout, 8=readback_timeout
    resolveTopologyMock(); // publishes WRITE_UNCERTAIN
    cellCountTxInFlight = false;
    if (onTerminal) onTerminal();
    // Recovery probe equivalent: after a delay (mirrors the real
    // firmware's periodic re-check), get a genuinely fresh read and
    // re-resolve — this is what lets applied_ack_lost eventually reveal
    // the true new topology, and timeout_no_apply correctly re-confirm
    // the unchanged old one.
    setTimeout(() => {
      if (cellCountTxId !== txId) return; // a newer transaction has since started; let it own resolution
      publishRegisterCellCount(); // the recovery probe's own forced re-read landing
      topologyUncertain = false;
      resolveTopologyMock();
    }, 5000);
  };

  const finishTerminal = () => {
    cellCountTxInFlight = false;
    publishRegisterCellCount();
    resolveTopologyMock();
    // tx_status is derived from the SAME resolver output the frontend
    // itself will see — never independently declared "confirmed".
    setEntity("sensor-cellcount_tx_status_code", entities["sensor-cell_count"].value === String(requested)
      && entities["text_sensor-topology_state"].state === "CONFIRMED"
      && entities["sensor-effective_cell_count"].value === String(requested) ? "4" : "5");
    broadcastEntity("sensor-cellcount_tx_status_code");
    if (onTerminal) onTerminal();
    if (scenario === "duplicate_terminal_sse") {
      // Re-broadcast the exact same terminal status a moment later —
      // finish() on the client is settled-guarded, so this must be a no-op.
      setTimeout(() => broadcastEntity("sensor-cellcount_tx_status_code"), 300);
    }
  };

  setTimeout(() => {
    if (scenario === "timeout_no_apply") {
      // No ACK, ever, for this transaction -- nothing physical changes.
      setCellCountTxStatus(2);
      setTimeout(() => { if (cellCountTxId === txId) finishUncertain(7); }, 3200);
      return;
    }
    if (scenario === "applied_ack_lost") {
      // The BMS DID receive and apply the write -- but we simulate its
      // ACK response getting lost, so the client sees exactly the same
      // ack_wait -> timeout sequence as timeout_no_apply, EXCEPT the
      // physical state has already, silently, genuinely changed.
      applyContiguousTopologyChange(requested);
      setCellCountTxStatus(2);
      setTimeout(() => { if (cellCountTxId === txId) finishUncertain(7); }, 3200);
      return;
    }

    // Every remaining scenario ACKs normally.
    setCellCountTxStatus(2); // ack_wait
    setTimeout(() => {
      setCellCountTxStatus(3); // readback_wait
      if (scenario === "readback_timeout") {
        // ACK landed fine; the forced readback commands simply never
        // complete (the response never arrives) -- ESPHome's own 4s
        // readback timeout is what would eventually fire on real
        // hardware here, not the 3s ACK timeout the other WRITE_UNCERTAIN
        // scenarios above hit.
        setTimeout(() => { if (cellCountTxId === txId) finishUncertain(8); }, 4200);
        return;
      }
      const readbackDelay = scenario === "delayed_readback" ? 3500 : 400 + Math.random() * 300;
      setTimeout(() => {
        if (scenario === "sse_before_http") {
          // Nothing special left to do here (the immediate pre-response
          // broadcast already happened in handleWrite's caller context —
          // see the sse_before_http branch below); fall through to a
          // normal confirm so the scenario still reaches a real terminal
          // state through the normal path.
          applyContiguousTopologyChange(requested);
        } else if (scenario === "mismatch_config_only" || scenario === "ack_ok_readback_stale") {
          // The register accepts the new value; the physical pack does
          // not change at all -- the classic "stale/rejected write" case.
          registerCellCount = requested;
        } else if (scenario === "mismatch_non_contiguous") {
          registerCellCount = requested;
          physicalTopologyCount = requested;
          // Right POPCOUNT, wrong POSITIONS: drop the lowest bit, add one
          // bit above the configured range instead.
          let mask = ((2 ** requested) - 1) & ~1;
          if (requested < CELL_COUNT) mask |= (1 << requested);
          physicalMask = mask;
          cellVoltageOverride = new Array(CELL_COUNT).fill(null);
          packVoltageOverride = null;
        } else if (scenario === "mismatch_extra_bit") {
          registerCellCount = requested;
          physicalTopologyCount = requested;
          let mask = (2 ** requested) - 1;
          if (requested < CELL_COUNT) mask |= (1 << requested); // one extra bit above the configured range
          physicalMask = mask;
          cellVoltageOverride = new Array(CELL_COUNT).fill(null);
          packVoltageOverride = null;
        } else {
          // confirm, delayed_readback, duplicate_terminal_sse,
          // out_of_order_sse — all a genuine, physically-consistent change.
          applyContiguousTopologyChange(requested);
        }

        if (scenario === "out_of_order_sse") {
          // Publish the terminal outcome first, then replay an EARLIER
          // stage's status code a moment later — proves a stale/reordered
          // event can never reopen an already-settled transaction.
          finishTerminal();
          setTimeout(() => setCellCountTxStatus(3), 250);
          return;
        }
        finishTerminal();
      }, readbackDelay);
    }, 500 + Math.random() * 200);
  }, 300 + Math.random() * 200);
}

/* ============================================================
   HTTP SERVER
   ============================================================ */
const MIME = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json" };

function serveFile(res, absPath) {
  fs.readFile(absPath, (err, data) => {
    if (err) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(absPath)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  if (p === "/" || p === "/index.html") return serveFile(res, path.join(__dirname, "index.html"));
  if (p === "/jk_bms.js") return serveFile(res, path.join(ROOT, "jk_bms.js")); // real production file, unmodified
  if (p === "/jk_bms.css") return serveFile(res, path.join(ROOT, "jk_bms.css")); // real production file, unmodified
  if (p === "/demo/panel.js") return serveFile(res, path.join(__dirname, "panel.js")); // dev-only, never loaded in production

  if (p === "/history.json") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(historyPayload());
    return;
  }
  if (p === "/settings/read-freshness" && req.method === "GET") {
    const now = Date.now();
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    const blocks = readPlanFreshness.map((block) =>
      [block.address, Math.max(0, now - block.lastSuccessMs), block.revision]);
    if (readMode === "legacy") { res.end(JSON.stringify({ blocks })); return; }
    res.end(JSON.stringify({ blocks, clusters: readClusters.map((c) => ({
      id: c.id, start: c.start, registers: c.registers, mode: c.fallback ? "fallback" : "cluster", lease: 0,
      cadence_ms: c.cadenceMs, budget_ms: c.budgetMs, age_ms: c.fallback ? null : Math.max(0, now - c.lastSuccessMs),
      revision: c.revision, sequence: c.sequence,
    })) }));
    return;
  }
  const ccMatch = p.match(/^\/charge_history\.json(?:\/(\d+))?$/);
  if (ccMatch) {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(chargeHistoryPayload(ccMatch[1] ? Number(ccMatch[1]) : 0));
    return;
  }

  if (p === "/events") {
    if (scenario === "browser_disconnected") {
      // A refused connection, not a hung one: destroying the socket fails
      // the request immediately, so EventSource's own retry timer keeps
      // firing every ~3s on its normal cadence. A request left pending
      // forever would instead swallow that retry attempt with no response
      // ever coming back — the scenario could never heal even after
      // switching back to "normal", since nothing would prompt a new try.
      req.socket.destroy();
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream", "Cache-Control": "no-cache",
      Connection: "keep-alive", "Access-Control-Allow-Origin": "*"
    });
    res.write(": connected\n\n");
    for (const wireId of Object.keys(entities)) res.write(sseFormat(domainOf(wireId), entities[wireId]));
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  const writeMatch = p.match(/^\/(select|number|text)\/([a-z0-9_]+)\/set$/);
  if (writeMatch && req.method === "POST") return handleWrite(writeMatch[1], writeMatch[2], url.searchParams, res);

  // Stage 4 production-integration simulation (2026-09-21) -- see the
  // module comment above handleRegisterWrite/handleRegisterWritePreflight.
  if (p === "/settings/register-write" && req.method === "POST") return handleRegisterWrite(url.searchParams, res);
  if (p === "/settings/register-write/preflight" && req.method === "GET") return handleRegisterWritePreflight(url.searchParams, res);
  if (p === "/settings/register-write/status" && req.method === "GET") return handleRegisterWriteStatus(url.searchParams, res);

  // ---- dev-only scenario control (never called by production jk_bms.js) ----
  if (p === "/demo/state" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      scenario, writeMode, scenarios: SCENARIOS, writeModes: WRITE_MODES, ccHistoryMode, ccHistoryModes: CC_HISTORY_MODES,
      cellCountScenario, cellCountScenarios: CELLCOUNT_SCENARIOS,
      genericWriteScenario, genericWriteScenarios: GENERIC_WRITE_SCENARIOS,
      registerCellCount, physicalTopologyCount, physicalMask, topologyUncertain,
      controlChargingOn, controlDischargingOn, controlBalancingOn, controlOverrideReason,
      // How many write transactions (simulated Modbus writes) were ever
      // created -- lets a test prove a request created none.
      writeTxCount: wtxNextId,
    }));
    return;
  }
  // Independently move the register value and/or the physical topology —
  // spec §10: "Демо-панель має дозволяти окремо змінювати фізичну
  // топологію та налаштований Cell Count." Bypasses the write-transaction
  // machinery entirely (this is a raw simulator control, not a simulated
  // Modbus write) and always re-derives topology_state via
  // resolveTopologyMock() afterward, never sets it directly.
  if (p === "/demo/physical-topology" && req.method === "POST") {
    const count = Number(url.searchParams.get("count"));
    const maskParam = url.searchParams.get("mask");
    if (Number.isFinite(count) && count >= 0 && count <= CELL_COUNT) {
      physicalTopologyCount = count;
      physicalMask = maskParam !== null && Number.isFinite(Number(maskParam)) ? (Number(maskParam) & 0xFFFF) : ((2 ** count) - 1);
      cellVoltageOverride = new Array(CELL_COUNT).fill(null);
    }
    if (!cellCountTxInFlight) resolveTopologyMock();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ physicalTopologyCount, physicalMask }));
    return;
  }
  // Stage 1 Completion Pass: cell_count is now in BLOCKED_REGISTER_KEYS
  // (see handleWrite above), so the PUBLIC /number/set_cell_count/set path
  // it used to test with a real write no longer reaches
  // runCellCountTransaction() at all — proven by the dedicated
  // "blocked write" test in test/topology/run.js. That still leaves the
  // topology RESOLVER's own handling of every ack/readback/timeout/SSE-
  // ordering state the transaction machinery can produce (CONFIRMED,
  // MISMATCH, ACK_TIMEOUT, READBACK_TIMEOUT, WRITE_UNCERTAIN, duplicate/
  // out-of-order SSE terminal events, the single-flight guard) worth
  // testing independently of whether the public endpoint exposes it. This
  // debug-only endpoint (never called by jk_bms.js or any real client —
  // dev-only, see this file's own top-of-file comment) drives the exact
  // same runCellCountTransaction() the old public path used to, so that
  // test coverage is not silently lost along with the write endpoint.
  if (p === "/demo/debug-trigger-cellcount-write" && req.method === "POST") {
    const value = Number(url.searchParams.get("value"));
    if (cellCountScenario === "sse_before_http") {
      runCellCountTransaction(value, () => { res.writeHead(200, { "Content-Type": "text/plain" }); res.end("OK"); });
      return;
    }
    res.writeHead(200, { "Content-Type": "text/plain" }); res.end("OK");
    runCellCountTransaction(value);
    return;
  }
  if (p === "/demo/register-cell-count" && req.method === "POST") {
    const count = Number(url.searchParams.get("count"));
    if (Number.isFinite(count) && count >= 0 && count <= CELL_COUNT) {
      registerCellCount = count;
      publishRegisterCellCount();
    }
    if (!cellCountTxInFlight) resolveTopologyMock();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ registerCellCount }));
    return;
  }
  // Per-channel voltage override, for the missing/NaN cell voltage tests.
  // channel is 1-based; value "nan"/"missing" clears to a real NaN; "auto"
  // clears the override back to the normal simulated jitter.
  if (p === "/demo/cell-voltage" && req.method === "POST") {
    const channel = Number(url.searchParams.get("channel"));
    const raw = url.searchParams.get("value");
    if (Number.isInteger(channel) && channel >= 1 && channel <= CELL_COUNT) {
      const idx = channel - 1;
      if (raw === "auto") cellVoltageOverride[idx] = null;
      else if (raw === "nan" || raw === "missing") cellVoltageOverride[idx] = NaN;
      else { const v = Number(raw); if (Number.isFinite(v)) cellVoltageOverride[idx] = v; }
    }
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ cellVoltageOverride }));
    return;
  }
  if (p === "/demo/pack-voltage" && req.method === "POST") {
    const raw = url.searchParams.get("value");
    packVoltageOverride = raw === "auto" ? null : (Number.isFinite(Number(raw)) ? Number(raw) : packVoltageOverride);
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ packVoltageOverride }));
    return;
  }
  if (p === "/demo/cellcount-scenario" && req.method === "POST") {
    const next = url.searchParams.get("name");
    if (CELLCOUNT_SCENARIOS.includes(next)) cellCountScenario = next;
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ cellCountScenario }));
    return;
  }
  if (p === "/demo/generic-write-scenario" && req.method === "POST") {
    const next = url.searchParams.get("name");
    if (GENERIC_WRITE_SCENARIOS.includes(next)) genericWriteScenario = next;
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ genericWriteScenario }));
    return;
  }
  // Simulates a BMS communication interruption (comms freshness pushed
  // straight to "stale" -- resolveTopologyMock() reports OFFLINE) that
  // self-heals within a couple of ticks, exactly like a real reboot mid-
  // session (real hardware's true LOADING state, "never received a
  // response since boot", isn't independently reproducible here without
  // restarting this whole in-memory process — see the final report for
  // why an actual ESP32 power-cycle test needs real hardware). Confirms
  // spec §11/§16's "resolver відновлює коректний confirmed/mismatch
  // state" for the comms-loss case this simulator CAN model faithfully.
  if (p === "/demo/bms-restart" && req.method === "POST") {
    bmsResponseAgeS = 999;
    topologyUncertain = false;
    cellCountTxInFlight = false;
    resolveTopologyMock(); // immediately observable as OFFLINE/LOADING; tick() re-resolves CONFIRMED within 1s once bmsResponseAgeS decays back down
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ restarted: true }));
    return;
  }
  if (p === "/demo/cc-history" && req.method === "POST") {
    const next = url.searchParams.get("name");
    if (CC_HISTORY_MODES.includes(next)) ccHistoryMode = next;
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ccHistoryMode }));
    return;
  }
  if (p === "/demo/scenario" && req.method === "POST") {
    const next = url.searchParams.get("name");
    if (SCENARIOS.includes(next)) {
      scenario = next;
      scenarioEnteredAt = Date.now();
      if (next !== "bms_offline") bmsResponseAgeS = Math.min(bmsResponseAgeS, 1);
      if (next === "browser_disconnected") {
        // Drop every currently-open SSE connection too, not just refuse new
        // ones — otherwise a client that connected before the switch would
        // keep receiving updates and never see a disconnect at all.
        for (const client of clients) { try { client.end(); } catch (_) {} }
        clients.clear();
      }
    }
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ scenario }));
    return;
  }
  if (p === "/demo/read-mode" && req.method === "POST") {
    const next = url.searchParams.get("name");
    if (READ_MODES.includes(next)) readMode = next;
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ readMode }));
    return;
  }
  if (p === "/demo/cluster-fallback" && req.method === "POST") {
    const latched = latchClusterFallback(url.searchParams.get("cluster"));
    res.writeHead(latched ? 200 : 404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ latched, mode: readClusterModeText() }));
    return;
  }
  if (p === "/demo/write-mode" && req.method === "POST") {
    const next = url.searchParams.get("name");
    if (WRITE_MODES.includes(next)) writeMode = next;
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ writeMode }));
    return;
  }

  res.writeHead(404); res.end("not found");
});

server.listen(PORT, HOST, () => {
  console.log(`JK BMS V2 demo server running at http://${HOST}:${PORT}`);
  console.log(`Serving production jk_bms.js / jk_bms.css from ${ROOT}`);
});
