#!/usr/bin/env node
"use strict";

// STRUCTURAL TEST -- source-inspection only, no compile/flash/DOM. Written
// 2026-09-21 (post-reboot hardware-acceptance audit, Phase 4): a real
// ESP32 reboot occurred immediately after a single write POST, with zero
// HTTP response bytes ever received. Direct source evidence (fetched and
// grepped against ESPHome 2026.8.2 / ESP-IDF 5.5.5's own real, pinned
// source -- see this project's own audit report) confirmed
// RegisterWriteHandler's handleRequest() ran on the ESP-IDF httpd
// server's own FreeRTOS task and called begin_write_tx_rmw/queue_command
// directly, racing the main loop's own unsynchronized use of the same
// modbus_controller command vector. This test proves the STATIC shape of
// the fail-closed rearchitecture that fixes it: the HTTP handler no
// longer contains any call into ESPHome/Modbus component state, and the
// new main-loop `interval:` consumer is the ONLY place those calls
// happen. It cannot prove RUNTIME thread-safety by itself (that needs
// real hardware or, at minimum, a compile this round's own instructions
// explicitly forbid) -- the mailbox's own concurrency correctness is
// instead proven by a REAL multi-threaded stress test, see
// test/jk_write_tx/test_jk_write_tx_mailbox.cpp.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const yaml = fs.readFileSync(path.join(ROOT, "batterylifepo4.yaml"), "utf8");

let checks = 0;
let failures = 0;
function check(name, pass, detail = "") {
  checks += 1;
  if (!pass) failures += 1;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` -- ${detail}` : ""}`);
}

function extractBlock(startMarker, endMarker) {
  const start = yaml.indexOf(startMarker);
  if (start === -1) throw new Error(`structural test: start marker not found: ${startMarker}`);
  const end = yaml.indexOf(endMarker, start);
  if (end === -1) throw new Error(`structural test: end marker not found: ${endMarker}`);
  return yaml.slice(start, end + endMarker.length);
}

// ---------------------------------------------------------------------
// 1/2. RegisterWriteHandler (HTTP task): must generate exactly one
// handoff per request, and must never itself call any ESPHome/Modbus
// component mutation.
// ---------------------------------------------------------------------
const handlerBlock = extractBlock(
  "class RegisterWriteHandler : public AsyncWebHandler {",
  "id(web_server_base_id)->add_handler(new RegisterWriteHandler());"
);
check("RegisterWriteHandler never calls begin_write_tx_rmw", !handlerBlock.includes("begin_write_tx_rmw)->execute"));
check("RegisterWriteHandler never calls write_bms_u32", !handlerBlock.includes("write_bms_u32)->execute"));
check("RegisterWriteHandler never calls write_bms_u16", !handlerBlock.includes("write_bms_u16)->execute"));
check("RegisterWriteHandler never references queue_command directly", !handlerBlock.includes("queue_command"));
check("RegisterWriteHandler never calls ->publish_state( (no ESPHome entity mutation from the httpd task)",
  !handlerBlock.includes("->publish_state("));
check("RegisterWriteHandler stages into the mailbox via try_stage_write_request exactly once",
  (handlerBlock.match(/try_stage_write_request\(/g) || []).length === 1);
check("RegisterWriteHandler's success response never claims a tx_id (honest accepted/request_id contract)",
  !handlerBlock.includes("\\\"tx_id\\\":") && handlerBlock.includes("\\\"request_id\\\":"));
check("RegisterWriteHandler's success response uses status:\"accepted\", never status:\"pending\" (that implied a real transaction existed)",
  handlerBlock.includes("\\\"status\\\":\\\"accepted\\\"") && !handlerBlock.includes("\\\"status\\\":\\\"pending\\\""));

// ---------------------------------------------------------------------
// RegisterWriteStatusHandler: read-only, never mutates anything.
// ---------------------------------------------------------------------
const statusBlock = extractBlock(
  "class RegisterWriteStatusHandler : public AsyncWebHandler {",
  "id(web_server_base_id)->add_handler(new RegisterWriteStatusHandler());"
);
check("RegisterWriteStatusHandler only handles GET", statusBlock.includes("request->method() != HTTP_GET"));
check("RegisterWriteStatusHandler never calls begin_write_tx_rmw/write_bms_u32/write_bms_u16",
  !statusBlock.includes("begin_write_tx_rmw)->execute") && !statusBlock.includes("write_bms_u32)->execute") && !statusBlock.includes("write_bms_u16)->execute"));
check("RegisterWriteStatusHandler only reads via lookup_write_result, never stages/publishes",
  statusBlock.includes("lookup_write_result(") && !statusBlock.includes("try_stage_write_request(") && !statusBlock.includes("publish_write_result("));

// ---------------------------------------------------------------------
// 3. Main-loop consumer (the ONLY place the dangerous calls happen):
// must exist, must be the interval right after the reset-diagnostics
// wiring, and must be the SOLE site of these calls.
// ---------------------------------------------------------------------
const wholeFileAfterHandler = yaml.slice(yaml.indexOf("id(web_server_base_id)->add_handler(new RegisterWriteStatusHandler());"));
const consumerStart = wholeFileAfterHandler.indexOf("- interval: 100ms");
check("a dedicated interval: 100ms main-loop consumer exists after the HTTP handlers", consumerStart !== -1);
const consumerBlock = wholeFileAfterHandler.slice(consumerStart, consumerStart + wholeFileAfterHandler.slice(consumerStart).indexOf("- interval: 30s"));
check("the main-loop consumer takes from the mailbox via try_take_write_request", consumerBlock.includes("try_take_write_request("));
// Clustered reads M5 corrective pass (owner decision 2026-09-29): an RMW
// request is decided by ONE tracked gate (jk_cluster_runtime::RmwRequest)
// and the consumer queues exactly that decision's merged raw through
// begin_write_tx -- never begin_write_tx_rmw, which would gate a second time.
// ... and (write-only-when-changed, owner decision 2026-09-29) the same one
// tracked gate now covers full-width 16/32-bit writes too: every write the
// consumer queues goes through begin_write_tx with the decided raw.
// Plan M8.1 (pre-write quiescence barrier): the consumer no longer queues
// the write itself. Its QUEUE decision becomes the one write intent, and the
// write_barrier_step script -- on the same main loop -- queues exactly that
// decided raw through begin_write_tx once the Modbus hub has drained.
const barrierStart = yaml.indexOf("  - id: write_barrier_step\n");
const barrierBlock = barrierStart < 0 ? "" : yaml.slice(barrierStart, yaml.indexOf("\n  - id: ", barrierStart + 10));
check("the main-loop consumer hands every QUEUE decision to the pre-write barrier as the write intent and never queues a write itself (plan M8.1)",
  consumerBlock.includes("jk_cluster_runtime::accept_write_intent(intent, jk_cluster_runtime::IntentSource::REGISTER_REQUEST, w, rmw_queued, now, owner)") &&
  consumerBlock.includes("rmw_req.step(jk_cluster_runtime::g_runtime, now, narrow)") && consumerBlock.includes("id(write_barrier_step)->execute();") &&
  !consumerBlock.includes("begin_write_tx)->execute"));
check("the pre-write barrier queues every write via begin_write_tx with the intent's decided raw (the ONLY place a Modbus write is queued)",
  barrierBlock.includes("id(begin_write_tx)->execute(int(intent.write.address), int(intent.write.word_count), int(intent.merged_raw),") &&
  (yaml.match(/id\(begin_write_tx\)->execute\(/g) || []).length === 1);
check("the main-loop consumer never calls begin_write_tx_rmw / write_bms_u16 / write_bms_u32 (no second gate)",
  !consumerBlock.includes("begin_write_tx_rmw)->execute") && !consumerBlock.includes("write_bms_u32)->execute") && !consumerBlock.includes("write_bms_u16)->execute"));
check("the main-loop consumer publishes its outcome via publish_write_result", consumerBlock.includes("publish_write_result("));

// Confirm the dangerous calls appear EXACTLY where expected: nowhere in
// the handler blocks, and in the consumer block.
const wholeHandlerRegion = handlerBlock + statusBlock;
for (const call of ["begin_write_tx_rmw)->execute", "write_bms_u32)->execute", "write_bms_u16)->execute"]) {
  check(`neither HTTP handler calls ${call}`, !wholeHandlerRegion.includes(call));
}
check('"begin_write_tx)->execute" appears only in the main-loop pre-write barrier, NOT in either HTTP handler',
  barrierBlock.includes("begin_write_tx)->execute") && !wholeHandlerRegion.includes("begin_write_tx)->execute"));

// ---------------------------------------------------------------------
// 5. Fail-closed prerequisites: single-flight, queue-full, stale-RAW,
// and the NEW topology/health prerequisite checks are all present in the
// consumer, with request_id correlation used for their rejection.
// ---------------------------------------------------------------------
check("the consumer independently re-checks the registry key (unknown key rejection)", consumerBlock.includes("RejectReason::UNKNOWN_KEY"));
check("the consumer independently re-checks submit_policy=live (authorization_required rejection)", consumerBlock.includes("RejectReason::AUTHORIZATION_REQUIRED"));
check("the consumer checks BMS health is LIVE (NEW prerequisite, not present in the pre-rearchitecture handler)",
  consumerBlock.includes('id(bms_health).state != "LIVE"'));
check("the consumer checks topology is CONFIRMED (NEW prerequisite, not present in the pre-rearchitecture handler)",
  consumerBlock.includes('id(topology_state).state != "CONFIRMED"'));
check("the consumer re-validates value encoding/range via encode_numeric_field", consumerBlock.includes("encode_numeric_field("));
check("the consumer re-checks fresh RAW via raw_is_fresh", consumerBlock.includes("raw_is_fresh("));
check("the barrier enforces single-flight via the existing g_wtx_in_use/g_wtx_address scan", barrierBlock.includes("g_wtx_tx_id)[i] == next_after"));
check("the barrier re-validates the request's own checks immediately before the write (registry live, BMS LIVE, topology CONFIRMED, same encoding)",
  barrierBlock.includes("e->submit_policy != jk_write_registry::SubmitPolicy::LIVE") && barrierBlock.includes('id(bms_health).state != "LIVE"') &&
  barrierBlock.includes('id(topology_state).state != "CONFIRMED"') && barrierBlock.includes("uint32_t(enc.encoded_raw) != intent.write.encoded"));
{
  const at = (x) => barrierBlock.indexOf(x);
  check("the barrier: hub check -> quiesce_step -> intent ended -> recheck -> begin_write_tx, in that order, in one lambda",
    at("hub->tx_buffer_empty(), hub->tx_blocked()") > 0 && at("jk_write_tx::quiesce_step(") > at("hub->tx_buffer_empty()") &&
    at("in.active = false;") > at("jk_write_tx::quiesce_step(") && at("recheck_write_intent(") > at("in.active = false;") &&
    at("id(begin_write_tx)->execute(") > at("recheck_write_intent(") && (barrierBlock.match(/lambda: \|-/g) || []).length === 1);
  check("a refused intent publishes its rejection and never reaches begin_write_tx",
    /if \(reason != jk_write_tx::RejectReason::NONE\) \{[\s\S]*?publish_write_result\([\s\S]*?return;\n          \}/.test(barrierBlock) &&
    barrierBlock.indexOf("if (reason != jk_write_tx::RejectReason::NONE) {") < at("id(begin_write_tx)->execute("));
}
check("a rejected request publishes via the result table with tx_id=0, never a fabricated tx_id",
  (consumerBlock.match(/publish_write_result\(jk_write_tx::g_register_write_result_table,[\s\S]{0,260}?false, 0,/g) || []).length >= 3);
check("an accepted request publishes the real next_after tx_id, never 0", barrierBlock.includes("intent.request_id, true,\n                                             next_after, jk_write_tx::RejectReason::NONE"));
check("the consumer uses jk_write_tx::RejectReason enum values, never free-form ad hoc strings", consumerBlock.includes("jk_write_tx::RejectReason::"));

// ---------------------------------------------------------------------
// 9. No auto-retry anywhere in the new production code (handler, status
// handler, or consumer) -- this project's own explicit fail-closed
// policy, never silently retried after a timeout/uncertain/rejected
// outcome.
// ---------------------------------------------------------------------
for (const [name, block] of [["RegisterWriteHandler", handlerBlock], ["RegisterWriteStatusHandler", statusBlock], ["main-loop consumer", consumerBlock]]) {
  check(`${name} contains no retry/re-queue loop around the write dispatch`,
    !/for\s*\([^)]*\)\s*\{[^}]*(begin_write_tx_rmw|write_bms_u32|write_bms_u16)\)->execute/s.test(block));
}

// ---------------------------------------------------------------------
// Reset/crash observability wiring (Phase 2): the boot-time capture
// exists, runs before anything else, and the new diagnostic entities are
// declared.
// ---------------------------------------------------------------------
check("jk_diag::read_and_reset_boot_diagnostics() is actually CALLED (assigned) exactly once at boot -- other mentions are documentation prose",
  (yaml.match(/const auto diag = jk_diag::read_and_reset_boot_diagnostics\(\);/g) || []).length === 1);
check("the reset_reason text_sensor entity is declared", /id:\s*reset_reason\b/.test(yaml));
check("the reset_count_since_power_on sensor entity is declared", /id:\s*reset_count_since_power_on\b/.test(yaml));
check("the last_write_crash_stage text_sensor entity is declared", /id:\s*last_write_crash_stage\b/.test(yaml));
check("crash-stage markers are written at HANDLER_ENTERED", yaml.includes("jk_diag::STAGE_HANDLER_ENTERED"));
check("crash-stage markers are written at HANDOFF_QUEUED", yaml.includes("jk_diag::STAGE_HANDOFF_QUEUED"));
check("crash-stage markers are written at MAIN_LOOP_EXECUTION_STARTED", yaml.includes("jk_diag::STAGE_MAIN_LOOP_EXECUTION_STARTED"));
check("crash-stage markers are written at TRANSACTION_ALLOCATED", yaml.includes("jk_diag::STAGE_TRANSACTION_ALLOCATED"));
check("crash-stage markers are written at MODBUS_COMMAND_QUEUED", yaml.includes("jk_diag::STAGE_MODBUS_COMMAND_QUEUED"));
check("last_write_crash_stage is never published as trustworthy without the rtc_trustworthy gate",
  yaml.includes("diag.rtc_trustworthy") && yaml.includes("not available for this reset type"));

// ---------------------------------------------------------------------
// Second corrective pass (2026-09-21): crash-stage marker timing. The
// success path must NOT reset to STAGE_IDLE immediately after queuing --
// a real transaction is still outstanding -- and TRANSACTION_ALLOCATED/
// MODBUS_COMMAND_QUEUED must be set only AFTER proof (i.e. after
// accepted_idx is found), never before the call that could still reject.
// ---------------------------------------------------------------------
{
  const successTailStart = barrierBlock.lastIndexOf("jk_diag::mark_write_crash_stage(jk_diag::STAGE_TRANSACTION_ALLOCATED)");
  const successTail = barrierBlock.slice(successTailStart);
  check("STAGE_TRANSACTION_ALLOCATED/STAGE_MODBUS_COMMAND_QUEUED are set together, after accepted_idx proof, immediately before the final accepted publish",
    successTailStart !== -1 &&
    successTail.indexOf("jk_diag::STAGE_MODBUS_COMMAND_QUEUED") < successTail.indexOf("publish_write_result") &&
    successTail.indexOf("publish_write_result") < successTail.indexOf("true,"));
  check("the success path never calls mark_write_crash_stage(STAGE_IDLE) (the marker is left at MODBUS_COMMAND_QUEUED/TRANSACTION_PENDING until the write-tx tick loop resolves it)",
    !successTail.includes("STAGE_IDLE"));
}
check("jk_diag::STAGE_TRANSACTION_PENDING exists as a distinct stage (2026-09-21 corrective pass)", yaml.includes("jk_diag::STAGE_TRANSACTION_PENDING"));
check("the 250ms write-tx tick loop publishes a conservative aggregate pending/idle marker across all slots",
  yaml.includes("any_pending") && yaml.includes("jk_write_tx::is_pending(id(g_wtx_status)[i])"));

// ---------------------------------------------------------------------
// Includes wiring: the new headers are actually included, in the right
// place (before any code that uses them).
// ---------------------------------------------------------------------
check("jk_reset_diag_core.h is in includes:", yaml.includes("components/jk_diag/jk_reset_diag_core.h"));
check("jk_reset_diag_rtc.h is in includes:", yaml.includes("components/jk_diag/jk_reset_diag_rtc.h"));

console.log(`\nregister-write handoff structural summary: ${checks - failures}/${checks} passed`);
process.exit(failures ? 1 : 0);
