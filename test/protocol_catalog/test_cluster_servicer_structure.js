#!/usr/bin/env node
"use strict";

// Clustered read servicer (docs/project/RS485_CLUSTERED_READ_MIGRATION_PLAN.md,
// M5): structural invariants of the generated servicer
// (protocol/generated/read_plan.yaml) and its batterylifepo4.yaml wiring.
// The scheduling/fallback/RMW logic itself is executed by
// test/jk_poll_scheduler/test_jk_cluster_runtime_core.cpp; the lambdas are
// host-compiled by test/firmware_lambda_compile/run.js. This file pins what
// only the generated text can show: bus ownership order, passcode isolation,
// the success-event format and that no duplicate reader survived.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const plan = fs.readFileSync(path.join(ROOT, "protocol", "generated", "read_plan.yaml"), "utf8");
const yaml = fs.readFileSync(path.join(ROOT, "batterylifepo4.yaml"), "utf8");
const clusters = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "read_clusters.canonical.json"), "utf8"));

let checks = 0;
let failures = 0;
function check(name, condition, detail = "") {
  checks += 1;
  if (condition) console.log(`PASS  ${name}`);
  else { failures += 1; console.log(`FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
}

const servicerStart = plan.indexOf("// Clustered read servicer");
const servicer = plan.slice(servicerStart);
const at = (s) => servicer.indexOf(s);

// 1. Bus ownership: nothing is issued while a read is in flight or a write
// (generic slots, CellCount, setup passcode) owns the bus.
const busyReturn = at("if (rt.busy() || id(g_rp_pending_index) >= 0) return;");
const writeReturn = at("if (bus_owner != jk_write_tx::BusOwner::NONE) return;");
const firstIssue = at("rt.issue(now, false, lease)");
check("servicer: the busy check and the write-in-flight return both precede the first issue",
  servicerStart >= 0 && busyReturn > 0 && writeReturn > busyReturn && firstIssue > writeReturn);
check("servicer (M8/M8.1): the pause is jk_write_tx::bus_owner() over the generic write slots, CellCount, topology recovery, the setup-passcode write and an accepted write intent",
  servicer.includes("const auto bus_owner = jk_write_tx::bus_owner(id(g_wtx_in_use), id(g_wtx_status), 6, id(g_cellcount_tx_pending),") &&
  servicer.includes("id(g_topology_recovery_pending), id(g_passcode_tx_pending),\n") &&
  servicer.includes("jk_cluster_runtime::g_write_intent.active);") && !/jk_write_tx::is_pending\(/.test(servicer));
{
  // M8: the transaction's own ACK/readback/recovery commands are queued by the
  // 250 ms write servicer, which never consults the read pause; the pause
  // reason is published from the same predicate.
  const wStart = yaml.indexOf("const auto result = jk_write_tx::tick(s, now);");
  const wEnd = yaml.indexOf("\n  - interval:", wStart);
  const writeServicer = wStart >= 0 ? yaml.slice(wStart, wEnd) : "";
  const rb0 = writeServicer.indexOf("if (result.issue_readback) {");
  const readbackBlock = rb0 < 0 ? "" : writeServicer.slice(rb0, writeServicer.indexOf("id(bms0)->queue_command(std::move(read_cmd));", rb0));
  check("write servicer (M8): issues its forced readback after the ACK tick and that readback never consults the read pause",
    rb0 > 0 && readbackBlock.length > 0 && !readbackBlock.includes("bus_owner(") && !readbackBlock.includes("recovery_probe_allowed("));
  check("write servicer (M8.1): the WRITE_UNCERTAIN recovery probe is issued only when nothing owns the bus and no write intent drains",
    /if \(s\.status == jk_write_tx::WRITE_UNCERTAIN && id\(g_wtx_recovery_pending\)\[i\] &&\s*now >= id\(g_wtx_recovery_next_ms\)\[i\] &&\s*jk_write_tx::recovery_probe_allowed\(jk_write_tx::bus_owner\(\s*id\(g_wtx_in_use\), id\(g_wtx_status\), 6, id\(g_cellcount_tx_pending\), id\(g_topology_recovery_pending\),\s*id\(g_passcode_tx_pending\), jk_cluster_runtime::g_write_intent\.active\)\)\) \{/.test(writeServicer));
  const probeAt = yaml.indexOf("auto rec_cc_cmd = ");
  const probeGate = yaml.lastIndexOf("if (!jk_write_tx::recovery_probe_allowed(jk_write_tx::bus_owner(", probeAt);
  check("topology recovery probe (M8.1): gated on recovery_probe_allowed(bus_owner(..., write intent)) before it queues its two reads",
    probeAt > 0 && probeGate > 0 && probeAt - probeGate < 1200 &&
    yaml.slice(probeGate, probeAt).includes("id(g_passcode_tx_pending), jk_cluster_runtime::g_write_intent.active))) return;"));
  const pauseScript = (() => { const a = yaml.indexOf("  - id: publish_read_pause_reason\n"); return a < 0 ? "" : yaml.slice(a, yaml.indexOf("\n  - id: ", a + 10)); })();
  check("firmware (M8/M8.1): read_pause_reason is published on change from jk_write_tx::bus_owner() with all five ownership sources, from one script",
    pauseScript.includes("const char *pause = jk_write_tx::bus_owner_name(jk_write_tx::bus_owner(") &&
    pauseScript.includes("id(g_wtx_in_use), id(g_wtx_status), 6, id(g_cellcount_tx_pending), id(g_topology_recovery_pending),") &&
    pauseScript.includes("id(g_passcode_tx_pending), jk_cluster_runtime::g_write_intent.active));") &&
    pauseScript.includes("if (id(read_pause_reason).state != pause) id(read_pause_reason).publish_state(pause);") &&
    (yaml.match(/id\(read_pause_reason\)\.publish_state\(/g) || []).length === 1 &&
    /id: read_pause_reason\n\s+name: "read pause reason"/.test(yaml));
  check("firmware (M8.1): read_pause_reason is republished the instant an intent is accepted (UI request and entity) and when the barrier ends it",
    (yaml.match(/id\(publish_read_pause_reason\)->execute\(\);/g) || []).length >= 5);
}
check("servicer: every read (cluster, passcode, bespoke fallback, per-block fallback) is issued after those returns",
  [...servicer.matchAll(/create_read_command\(/g)].every((m) => m.index > writeReturn) &&
  (servicer.match(/create_read_command\(/g) || []).length === 4);
check("servicer: exactly one servicer interval (no second polling loop)",
  (plan.match(/^interval:/gm) || []).length === 1 && (plan.match(/^  - interval: /gm) || []).length === 1);

// 2. Passcode isolation: read via the runtime's isolated read, length only.
{
  const p0 = at("if (next == jk_cluster_runtime::Runtime::kPasscodeRead) {");
  const p1 = servicer.indexOf("return;\n", servicer.indexOf("queue_command(std::move(pcmd));", p0));
  const pass = servicer.slice(p0, p1);
  check("passcode: read with the isolated kPasscodeStart/kPasscodeRegisters, never a cluster",
    pass.includes("jk_cluster_runtime::kPasscodeStart, jk_cluster_runtime::kPasscodeRegisters,"));
  check("passcode: the callback uses only data.size() -- never data.data(), data[..] or a log of the bytes",
    pass.includes("on_passcode_response(gen, data.size(), length_ok)") && !/data\.data\(\)|data\[|ESP_LOG/.test(pass));
  check("passcode: publishes only the hidden marker", /publish_state\(std::string\("hidden"\)\)/.test(pass));
  const credBlock = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "generated", "read_plan.json"), "utf8"))
    .blocks.findIndex((b) => parseInt(b.address, 16) === 0x1470);
  check("passcode: its read-plan block has no case in the fallback decode switch and no cluster",
    credBlock >= 0 && !new RegExp(`case ${credBlock}: \\{  // 0x1470`).test(servicer) &&
    clusters.clusters.every((c) => 0x1470 < parseInt(c.start, 16) || 0x1470 >= parseInt(c.start, 16) + 2 * c.register_count));
  check("passcode: 0x1470 is the one isolated, on-demand read", clusters.isolated_reads.length === 1 &&
    parseInt(clusters.isolated_reads[0].start, 16) === 0x1470 && clusters.isolated_reads[0].trigger === "on_demand");
}

// 3. Success events and freshness snapshot.
check("cluster success: one '<cluster id>:<revision>:<sequence>' event per cluster read",
  servicer.includes('id(read_plan_success)->publish_state(std::string(jk_read_clusters::kClusters[next].id) + ":" + std::to_string(entry.revision) + ":" + std::to_string(id(g_rp_success_seq)));'));
check("cluster success: the event's sequence is recorded for the freshness snapshot",
  servicer.includes("rt2.note_event_sequence(next, id(g_rp_success_seq));"));
check("fallback block success keeps the per-block '<address>:<revision>:<sequence>' event",
  servicer.includes('id(read_plan_success)->publish_state(std::to_string(jk_read_plan::kBlocks[chosen].address) + ":"'));
check("/settings/read-freshness adds clusters[] with id, start, registers, mode, lease, cadence, budget, age, revision, sequence",
  ["\\\"id\\\":\\\"", "\\\"start\\\":", "\\\"registers\\\":", "\\\"mode\\\":\\\"", "\\\"lease\\\":", "\\\"cadence_ms\\\":",
    "\\\"budget_ms\\\":", "\\\"age_ms\\\":", "\\\"revision\\\":", "\\\"sequence\\\":"].every((k) => yaml.includes(k)) &&
  yaml.includes('json += "],\\"clusters\\":[";'));
check("read_cluster_mode is published on change only (no oscillating republish)",
  yaml.includes("if (id(read_cluster_mode).state != mode) id(read_cluster_mode).publish_state(mode);"));

// 4. No duplicate reads: the registers inside A1 have no second reader.
check("no dedicated cell, CellWireRes16-31 or CellConWireRes reader remains in batterylifepo4.yaml",
  !/create_read_command\([^)]*0x1200/.test(yaml.replace(/\n\s*/g, " ")) &&
  !yaml.includes("0x126A, register_count,") && !yaml.includes("0x1088, register_count,") && !yaml.includes("g_cell_poll_pending"));
check("the only create_read_command calls left in batterylifepo4.yaml are the write-transaction readbacks (0x106C, 0x1240, 0x1470) and the generic write-tx readback",
  (() => {
    const flat = yaml.replace(/\n\s*/g, " ");
    const calls = [...flat.matchAll(/create_read_command\( id\(bms0\), esphome::modbus::EntityType::HOLDING, ([^,]+),/g)].map((m) => m[1].trim());
    return calls.length > 0 && calls.every((a) => ["0x106C", "0x1240", "0x1470"].includes(a) || !/^0x/.test(a));
  })());
check("cluster decode only runs for a stored, exact-length cluster (Completion::OK)",
  servicer.indexOf("if (done != jk_cluster_runtime::Completion::OK) {") < servicer.indexOf("switch (next) {"));
check("no publish-on-change logic was added to the cluster decode (every read republishes)",
  !/last_published|publish_on_change|if \(.*!= .*->state\) id\(/.test(servicer.slice(at("switch (next) {"), at("default: break;"))));

// 5. One authoritative RMW gate per request (owner decision 2026-09-29).
const runtimeCore = fs.readFileSync(path.join(ROOT, "components", "jk_poll_scheduler", "jk_cluster_runtime_core.h"), "utf8");
const lambdaText = yaml + plan;
check("RMW: no YAML lambda calls check_rmw directly -- every gate decision goes through RmwRequest::step",
  !/\.check_rmw\(/.test(lambdaText));
check("RMW: the untracked g_rmw_deferred_* slot and DeferredRmw are gone",
  !/g_rmw_deferred_|DeferredRmw|g_deferred_register_write/.test(lambdaText + runtimeCore));
{
  const c0 = yaml.indexOf("auto &rmw_req = jk_cluster_runtime::g_register_write_rmw;");
  const terminal = yaml.indexOf("rmw_req.cancel();\n          deferred = false;", c0);
  const noChange = yaml.indexOf("if (no_change) {", c0);
  const queue = yaml.indexOf("jk_cluster_runtime::accept_write_intent(intent, jk_cluster_runtime::IntentSource::REGISTER_REQUEST, w, rmw_queued, now, owner)", c0);
  const firstResult = yaml.indexOf("jk_write_tx::publish_write_result(", c0);
  check("write (UI request): one armed request for EVERY write (RMW and full-width), stepped once per tick; WAIT returns before any result",
    c0 > 0 && yaml.indexOf("w.full_width = !e_ptr->uses_rmw;", c0) > c0 &&
    yaml.indexOf("const auto st = rmw_req.step(jk_cluster_runtime::g_runtime, now, narrow);", c0) > c0 &&
    /if \(st\.step == jk_cluster_runtime::RmwStep::WAIT\) \{[\s\S]{0,600}?return;  \/\/ no result yet/.test(yaml.slice(c0, firstResult)));
  check("write (UI request): the gate is disarmed for good before any result or queueing (a rejected / no-change request can never write later)",
    terminal > c0 && terminal < firstResult && terminal < queue && terminal < noChange);
  check("write (UI request): the NO_CHANGE decision sets no_change (never the queued raw); only QUEUE sets the raw to write",
    /\} else if \(st\.step == jk_cluster_runtime::RmwStep::NO_CHANGE\) \{\s*\n\s*no_change = true;\s*\n\s*\} else \{/.test(yaml.slice(c0, terminal)) &&
    (yaml.slice(c0, terminal).match(/rmw_queued = st;/g) || []).length === 1 &&
    /if \(st\.step == jk_cluster_runtime::RmwStep::QUEUE\) \{\s*\n\s*rmw_queued = st;/.test(yaml.slice(c0, terminal)));
  const ncBlock = yaml.slice(noChange, yaml.indexOf("\n          }\n", noChange));
  check("write (UI request): NO_CHANGE publishes its own terminal result (RejectReason::NO_CHANGE) and returns before any queueing",
    noChange > terminal && noChange < queue && ncBlock.includes("jk_write_tx::RejectReason::NO_CHANGE") && ncBlock.includes("return;") &&
    !/begin_write_tx|write_bms_u|queue_command/.test(ncBlock));
  check("write (UI request, M8.1): the decided step becomes the write intent (queued later by the barrier), never begin_write_tx_rmw / write_bms_u16 / write_bms_u32",
    queue > noChange && !/id\(begin_write_tx_rmw\)->execute\(int\(e_ptr|id\(write_bms_u(16|32)\)->execute\(int\(e_ptr/.test(yaml));
  check("status endpoint: NO_CHANGE is reported as its own terminal status 'no_change', not as a rejection",
    yaml.includes("} else if (lookup.reason == jk_write_tx::RejectReason::NO_CHANGE) {") && yaml.includes('json += "{\\"status\\":\\"no_change\\",\\"request_id\\":";'));
}
{
  const scriptBody = (id) => { const a = yaml.indexOf(`  - id: ${id}\n`); return a < 0 ? "" : yaml.slice(a, yaml.indexOf("\n  - id: ", a + 10)); };
  const step = scriptBody("entity_write_step");
  const rmwArm = scriptBody("begin_write_tx_rmw");
  const u16 = scriptBody("write_bms_u16");
  const u32 = scriptBody("write_bms_u32");
  check("write (HA entity): begin_write_tx_rmw, write_bms_u16 and write_bms_u32 only arm a tracked request in the entity pool -- none queues a write",
    [rmwArm, u16, u32].every((b) => b.includes("jk_cluster_runtime::arm_write(jk_cluster_runtime::g_entity_write_requests, w, millis());") &&
      b.includes("script.execute: entity_write_step") && !b.includes("begin_write_tx)->execute") && !/id: begin_write_tx,/.test(b)) &&
    u16.includes("w.full_width = true;") && u32.includes("w.full_width = true;") && u16.includes("w.word_count = 1;") && u32.includes("w.word_count = 2;"));
  check("write (HA entity, M8.1): entity_write_step hands the decision to the barrier as the write intent (one at a time, nothing stepped while one drains or a transaction owns the bus); NO_CHANGE and REJECT only log",
    step.includes("if (!jk_cluster_runtime::accept_write_intent(intent, jk_cluster_runtime::IntentSource::ENTITY, w, st, now, owner)) {") &&
    step.includes("if (intent.active || owner != jk_write_tx::BusOwner::NONE) return;") &&
    step.indexOf("if (intent.active || owner != jk_write_tx::BusOwner::NONE) return;") < step.indexOf("req.step(") &&
    step.includes("id(write_barrier_step)->execute();") && !step.includes("begin_write_tx)->execute") &&
    /RmwStep::NO_CHANGE\) \{\s*\n\s*ESP_LOGI\([^;]*no change[^;]*;\s*\n\s*\}/.test(step));
  const barrier = scriptBody("write_barrier_step");
  check("write (M8.1): write_barrier_step is the one caller of begin_write_tx, and runs every 20 ms",
    (yaml.match(/id\(begin_write_tx\)->execute\(/g) || []).length === 1 && barrier.includes("id(begin_write_tx)->execute(") &&
    /- interval: 20ms\n    then:\n      - script\.execute: write_barrier_step\n/.test(yaml));
  check("write (M8.1): the barrier queues only on quiesce_step READY over the hub's own state (tx_buffer_empty && !tx_blocked) and bus_owner() without the intent",
    barrier.includes("auto *hub = id(bms0)->hub();") &&
    barrier.includes("const bool quiet = jk_write_tx::hub_quiescent(hub->tx_buffer_empty(), hub->tx_blocked());") &&
    barrier.includes("id(g_topology_recovery_pending), id(g_passcode_tx_pending), false);") &&
    barrier.includes("if (qs == jk_write_tx::QuiesceStep::WAIT) return;") &&
    barrier.includes("reason = jk_write_tx::RejectReason::BUS_NOT_QUIESCENT;"));
  check("write (M8.1): the barrier's assumption holds -- no continuous (polling) modbus_controller entity exists, so tx_buffer_empty() hides no frame",
    !/platform: modbus_controller\b/.test(yaml.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n")) &&
    !/platform: modbus_controller\b/.test(fs.readFileSync(path.join(ROOT, "protocol", "generated", "write_registry.yaml"), "utf8") + plan));
  const failClosed = (id) => { const a = yaml.indexOf(`    id: ${id}\n`); const b = yaml.indexOf("set_action:", a); return a < 0 || b < 0 ? null : yaml.slice(b, yaml.indexOf("\n\n", b)); };
  for (const id of ["set_cell_count", "setup_passcode"]) {
    const act = failClosed(id);
    check(`write (M8.1): ${id}'s trigger still queues no Modbus command (fail-closed) -- every live write goes through the barrier`,
      act !== null && /rejected: reverted to/.test(act) && !/queue_command|begin_write_tx|create_write|g_(cellcount|passcode)_tx_pending\) = true/.test(act));
  }
  check("write (HA entity): the 100 ms interval only re-decides tracked requests",
    yaml.includes("for (const auto &req : jk_cluster_runtime::g_entity_write_requests) {\n            if (req.active()) { id(entity_write_step)->execute(); break; }"));
  // Every Modbus write goes through the one create_write_multiple_command in
  // begin_write_tx, with at most 2 registers -- never a read cluster.
  check("writes: exactly one Modbus write command site (begin_write_tx), 1 or 2 registers, never a whole read cluster",
    (yaml.match(/create_write_multiple_command\(/g) || []).length === 1 && !/create_write_single_command|create_custom_command/.test(yaml + plan) &&
    yaml.includes("if (word_count >= 2) words = {uint16_t(uint32_t(raw) >> 16), uint16_t(uint32_t(raw) & 0xFFFFU)};") &&
    yaml.includes("else words = {uint16_t(raw)};") && clusters.clusters.every((c) => c.register_count > 2));
  const writeRegistry = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "generated", "write_registry.json"), "utf8"));
  const callWidths = [...(yaml + fs.readFileSync(path.join(ROOT, "protocol", "generated", "write_registry.yaml"), "utf8"))
    .matchAll(/id\((?:begin_write_tx_rmw|begin_write_tx)\)->execute\(0x[0-9A-Fa-f]+, (\d+),/g)].map((m) => Number(m[1]));
  check("writes: every generated write-registry entry and literal write call targets 1 or 2 registers",
    writeRegistry.entries.every((e) => e.word_count === 1 || e.word_count === 2) && callWidths.every((n) => n === 1 || n === 2),
    JSON.stringify(callWidths));
}
{
  const fb = servicer.indexOf("if (rt.fallback_mask() == 0) return;");
  const urgent = servicer.indexOf("int urgent = rt.take_narrow_request();", fb);
  const bespoke = servicer.indexOf("const int bespoke = rt.issue_bespoke(", fb);
  check("fallback RMW (plan section 10): the tracked narrow pre-read is issued before the bespoke readers and the cadence pick",
    fb > 0 && urgent > fb && bespoke > urgent && servicer.includes("if (urgent < 0) {") &&
    servicer.includes("const int chosen = urgent >= 0 ? urgent : jk_poll_scheduler::pick_next_block("));
  check("fallback RMW: only a block of a latched cluster is pre-read (never the credential block, kBlockCluster -1)",
    servicer.includes("!rt.cluster_fallback(jk_read_plan::kBlockCluster[urgent].cluster))) urgent = -1;"));
}
check("passcode: strictly on demand -- no read after boot, and no caller requests one",
  runtimeCore.includes("passcode_requested_ = false;  // strictly on demand: no read after boot") &&
  !runtimeCore.includes("passcode_requested_ = true;  // one") && !/request_passcode_status\(\)/.test(lambdaText));

console.log(`\ncluster servicer structure: ${checks - failures}/${checks} passed`);
process.exit(failures ? 1 : 0);
