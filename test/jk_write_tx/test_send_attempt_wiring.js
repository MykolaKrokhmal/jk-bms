#!/usr/bin/env node
"use strict";
// Gate D send-attempt accounting (2026-10-02): structural checks that
// batterylifepo4.yaml and jk_write_tx_hub_device.h wire the counter the way
// test_tx_send_attempts.cpp exercises it -- counted at the hub's on_sent()
// only, reset at each write's start, readback/probe labelled, published in
// write_tx_snapshot and in the NO_CHANGE / terminal log lines.
// JK_BMS_YAML_UNDER_TEST / JK_TX_HUB_DEVICE_UNDER_TEST point the checks at
// a mutated copy (test/jk_write_tx/run_send_attempt_mutations.sh).

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const YAML = process.env.JK_BMS_YAML_UNDER_TEST || path.join(ROOT, "batterylifepo4.yaml");
const DEVICE = process.env.JK_TX_HUB_DEVICE_UNDER_TEST || path.join(ROOT, "components/jk_write_tx/jk_write_tx_hub_device.h");

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
}
// Comment lines never count as wiring.
const code = (text) => text.split("\n").filter((l) => !/^\s*(\/\/|#)/.test(l)).join("\n");

const yaml = code(fs.readFileSync(YAML, "utf8"));
const dev = code(fs.readFileSync(DEVICE, "utf8"));

// 1. One FC16 site, and the transaction's accounting restarts right before it.
const writes = [...yaml.matchAll(/\.write_registers\(/g)];
check("exactly one FC16 send site in the firmware", writes.length === 1, `${writes.length} found`);
check("each write starts its accounting at 0 just before queueing the FC16",
  /g_slot_devices\[idx\]\.begin_transaction_attempts\(\);\s*\n\s*if \(!jk_write_tx_bus::g_slot_devices\[idx\]\.write_registers\(/.test(yaml));

check("the accounting is reset nowhere else (timeouts, recovery and cancel keep the transaction's counts)",
  (yaml.match(/begin_transaction_attempts\(\)/g) || []).length === 1 &&
  (dev.match(/this->tx_attempts_ = \{\}/g) || []).length === 1 &&
  /void begin_transaction_attempts\(\) \{ this->tx_attempts_ = \{\}; \}/.test(dev));

// 2. The slot's FC03 frames are labelled.
check("the forced readback is labelled READBACK",
  /register_count, on_readback, jk_write_tx::FramePurpose::READBACK\)/.test(yaml));
check("the recovery probe is labelled PROBE",
  /register_count, on_probe, jk_write_tx::FramePurpose::PROBE\)/.test(yaml));

// 3. Published in write_tx_snapshot, from the slot's own device.
const snapStart = yaml.indexOf("- id: publish_write_tx_snapshot");
const snap = snapStart >= 0 ? yaml.slice(snapStart, yaml.indexOf("publish_state(out)", snapStart)) : "";
check("write_tx_snapshot appends the slot's send attempts (fn/qty/fc16/readback/probe)",
  /format_frame_attempts_json\(buf, sizeof\(buf\), jk_write_tx::kFunctionWriteMultipleRegisters,\s*uint16_t\(id\(g_wtx_word_count\)\[i\]\),\s*jk_write_tx_bus::g_slot_devices\[i\]\.transaction_attempts\(\)\)/.test(snap));
check("write_tx_snapshot closes each slot object after the counts",
  /transaction_attempts\(\)\);\s*\n\s*out \+= buf;\s*\n\s*out \+= "}";/.test(snap));

// 4. Log lines.
const noChange = [...yaml.matchAll(/no change -- [^\n]*no Modbus command[^\n]*\n[^\n]*/g)].map((m) => m[0]);  // + its continuation line
check("both NO_CHANGE log lines carry fc16_sent_total",
  noChange.length === 2 && noChange.every((l) => l.includes("fc16_sent_total=%u")), noChange.join(" | "));
check("the terminal and recovery log lines carry the send attempts",
  (yaml.match(/send attempts: fc16=%u readback=%u probe=%u/g) || []).length === 2);

// 5. The device counts at on_sent only, by the PDU actually sent.
const onSent = (/void on_sent\(std::span<const uint8_t> request_pdu\) override \{([\s\S]*?)\n  \}/.exec(dev) || [])[1] || "";
check("on_sent counts the transmitted frame by its own function code",
  /const uint8_t fc = request_pdu\.empty\(\) \? 0 : request_pdu\[0\];/.test(onSent) &&
  /count_frame_attempt\(this->tx_attempts_, this->purpose_, fc\)/.test(onSent));
check("fc16_sent_total grows only for an FC16 frame",
  /if \(fc == jk_write_tx::kFunctionWriteMultipleRegisters\) g_fc16_sent_total\+\+;/.test(onSent));
check("nothing else counts a send attempt (not at queue, arm or cancel time)",
  (dev.match(/count_frame_attempt\(/g) || []).length === 1 && (dev.match(/g_fc16_sent_total\+\+/g) || []).length === 1);

console.log(`send attempt wiring: ${pass}/${pass + fail} checks passed`);
process.exit(fail === 0 ? 0 : 1);
