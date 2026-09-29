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
const writeReturn = at("if (write_in_flight) return;");
const firstIssue = at("rt.issue(now, false, lease)");
check("servicer: the busy check and the write-in-flight return both precede the first issue",
  servicerStart >= 0 && busyReturn > 0 && writeReturn > busyReturn && firstIssue > writeReturn);
check("servicer: write_in_flight covers the generic write slots, the CellCount driver and the setup-passcode write",
  servicer.includes("bool write_in_flight = id(g_cellcount_tx_pending) || id(g_topology_recovery_pending) || id(g_passcode_tx_pending);") &&
  servicer.includes("if (id(g_wtx_in_use)[i] && jk_write_tx::is_pending(id(g_wtx_status)[i])) { write_in_flight = true; break; }"));
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

console.log(`\ncluster servicer structure: ${checks - failures}/${checks} passed`);
process.exit(failures ? 1 : 0);
