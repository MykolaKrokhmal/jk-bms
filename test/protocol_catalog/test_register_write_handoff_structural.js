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
check("RegisterWriteStatusHandler only reads via try_read_write_result, never stages/publishes",
  statusBlock.includes("try_read_write_result(") && !statusBlock.includes("try_stage_write_request(") && !statusBlock.includes("publish_write_result("));

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
check("the main-loop consumer calls begin_write_tx_rmw (the ONLY safe place to)", consumerBlock.includes("begin_write_tx_rmw)->execute"));
check("the main-loop consumer calls write_bms_u32", consumerBlock.includes("write_bms_u32)->execute"));
check("the main-loop consumer calls write_bms_u16", consumerBlock.includes("write_bms_u16)->execute"));
check("the main-loop consumer publishes its outcome via publish_write_result", consumerBlock.includes("publish_write_result("));

// Confirm the dangerous calls appear EXACTLY where expected: nowhere in
// the handler blocks, and in the consumer block.
const wholeHandlerRegion = handlerBlock + statusBlock;
for (const call of ["begin_write_tx_rmw)->execute", "write_bms_u32)->execute", "write_bms_u16)->execute"]) {
  check(`"${call}" appears in the main-loop consumer but NOT in either HTTP handler`,
    consumerBlock.includes(call) && !wholeHandlerRegion.includes(call));
}

// ---------------------------------------------------------------------
// 5. Fail-closed prerequisites: single-flight, queue-full, stale-RAW,
// and the NEW topology/health prerequisite checks are all present in the
// consumer, with request_id correlation used for their rejection.
// ---------------------------------------------------------------------
check("the consumer independently re-checks the registry key (unknown key rejection)", consumerBlock.includes("\"unknown key\""));
check("the consumer independently re-checks submit_policy=live (authorization_required rejection)", consumerBlock.includes("\"authorization_required\""));
check("the consumer checks BMS health is LIVE (NEW prerequisite, not present in the pre-rearchitecture handler)",
  consumerBlock.includes('id(bms_health).state != "LIVE"'));
check("the consumer checks topology is CONFIRMED (NEW prerequisite, not present in the pre-rearchitecture handler)",
  consumerBlock.includes('id(topology_state).state != "CONFIRMED"'));
check("the consumer re-validates value encoding/range via encode_numeric_field", consumerBlock.includes("encode_numeric_field("));
check("the consumer re-checks fresh RAW via raw_is_fresh", consumerBlock.includes("raw_is_fresh("));
check("the consumer enforces single-flight via the existing g_wtx_in_use/g_wtx_address scan", consumerBlock.includes("g_wtx_tx_id)[i] == next_after"));
check("a rejected request publishes a real reason string, never a fabricated tx_id", consumerBlock.includes("publish_write_result(jk_write_tx::g_register_write_result_mailbox, req.request_id, false, 0,"));

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
// Includes wiring: the new headers are actually included, in the right
// place (before any code that uses them).
// ---------------------------------------------------------------------
check("jk_reset_diag_core.h is in includes:", yaml.includes("components/jk_diag/jk_reset_diag_core.h"));
check("jk_reset_diag_rtc.h is in includes:", yaml.includes("components/jk_diag/jk_reset_diag_rtc.h"));

console.log(`\nregister-write handoff structural summary: ${checks - failures}/${checks} passed`);
process.exit(failures ? 1 : 0);
