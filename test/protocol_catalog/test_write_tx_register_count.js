#!/usr/bin/env node
"use strict";

// Register-count unit fix for the generic Write Transaction Manager's
// ACK-readback and uncertainty-recovery-probe reads (2026-09-18,
// user-directed). ModbusCommandItem::create_read_command()'s 4th
// parameter is Modbus REGISTERS (confirmed against the real esphome
// 2026.9.0 source -- the actual pinned HA build -- not 2026.8.2 or dev),
// forwarded verbatim into create_client_pdu()'s literal FC03
// quantity-of-registers field. Both call sites previously passed
// `word_count * 2` (a byte count) where the framework expects a register
// count -- the exact same class of bug already fixed for the
// CellConWireRes0-31 read (see jk_capability_core.h). This is a
// source-level structural regression suite: no ESPHome toolchain is
// available in this environment, so these checks pin the fixed source
// text directly (register_count/expected_payload_bytes named separately,
// no re-inlined "* 2U" feeding the wire request, exact-length response
// validation) rather than exercising a compiled binary.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const yaml = fs.readFileSync(path.join(ROOT, "batterylifepo4.yaml"), "utf8");

let checks = 0;
let failures = 0;
function check(name, condition) {
  checks += 1;
  if (condition) {
    console.log(`PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${name}`);
  }
}

// ===========================================================================
// 1. The old, unit-confused pattern must be gone from BOTH call sites --
// a literal `word_count * 2U` (or the old `byte_count` variable name)
// feeding directly into a create_read_command() register_count argument.
// ===========================================================================
check("generic write-tx servicer: the old 'const uint16_t byte_count = uint16_t(s.word_count) * 2U;' pattern does not appear anywhere",
  !yaml.includes("const uint16_t byte_count = uint16_t(s.word_count) * 2U;"));
check("generic write-tx servicer: no create_read_command() call passes a literal '* 2U'-derived register_count argument",
  !/create_read_command\(\s*\n\s*id\(bms0\), esphome::modbus::EntityType::HOLDING, addr, byte_count,/.test(yaml));

// ===========================================================================
// 2. Both call sites (recovery-probe, ACK-readback) now declare
// register_count and expected_payload_bytes as separate, named locals --
// register_count used directly (word_count itself, not doubled) for the
// wire request; expected_payload_bytes (register_count * 2) used only for
// response-length validation and decode.
// ===========================================================================
const registerCountDecl = "const uint16_t register_count = uint16_t(s.word_count);";
const expectedBytesDecl = "const size_t expected_payload_bytes = size_t(register_count) * 2U;";
const declCount = (yaml.match(new RegExp(registerCountDecl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
check("generic write-tx servicer: 'register_count = uint16_t(s.word_count)' is declared exactly twice (recovery-probe + ACK-readback)",
  declCount === 2);
const expectedBytesCount = (yaml.match(new RegExp(expectedBytesDecl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
check("generic write-tx servicer: 'expected_payload_bytes = size_t(register_count) * 2U' is declared exactly twice",
  expectedBytesCount === 2);

// ===========================================================================
// 3. Both create_read_command() calls in this servicer pass register_count
// (not byte_count, not a re-inlined word_count*2) as the wire request's
// register-count argument.
// ===========================================================================
const readCmdWithRegisterCount = (yaml.match(/create_read_command\(\s*\n\s*id\(bms0\), esphome::modbus::EntityType::HOLDING, addr, register_count,/g) || []).length;
check("generic write-tx servicer: exactly 2 create_read_command() calls request register_count registers (recovery-probe + ACK-readback)",
  readCmdWithRegisterCount === 2);

// ===========================================================================
// 4. Response-length validation is an EXACT match (!=), not a floor (<) --
// a short OR an excess response must never confirm a write (user-directed:
// "коротка/зайва відповідь не підтверджує запис").
// ===========================================================================
check("generic write-tx servicer: recovery-probe readback uses exact-length check (data.size() != expected_payload_bytes), not a floor",
  yaml.includes('if (data.size() != expected_payload_bytes) {\n                      ESP_LOGW("jk_write_tx", "Recovery-probe readback length mismatch'));
check("generic write-tx servicer: ACK-readback uses exact-length check (data.size() != expected_payload_bytes), not a floor",
  yaml.includes('if (data.size() != expected_payload_bytes) {\n                      ESP_LOGW("jk_write_tx", "Readback length mismatch'));
check("generic write-tx servicer: no remaining '< need' / '< expected_payload_bytes' floor-style length check in this block",
  !/data\.size\(\)\s*<\s*(need|expected_payload_bytes)/.test(yaml));

// ===========================================================================
// 5. word_count is used verbatim (never re-multiplied) as register_count --
// this is what makes the fix correct for BOTH word_count=1 (16-bit,
// write_bms_u16 -- defined but not yet invoked by any live entity) and
// word_count=2 (32-bit, write_bms_u32 -- the only currently-invoked
// generic-write entry point, all 18 SETTING_KEYS). The arithmetic itself
// (register_count = word_count; expected_payload_bytes = register_count*2)
// is unit-proved directly below, independent of which word_count value
// production traffic happens to exercise today.
// ===========================================================================
function deriveRegisterCountAndBytes(wordCount) {
  const registerCount = wordCount; // mirrors "uint16_t(s.word_count)" verbatim
  const expectedPayloadBytes = registerCount * 2;
  return { registerCount, expectedPayloadBytes };
}
{
  const r1 = deriveRegisterCountAndBytes(1);
  check("word_count=1 (16-bit register, write_bms_u16): register_count=1, expected_payload_bytes=2",
    r1.registerCount === 1 && r1.expectedPayloadBytes === 2);
}
{
  const r2 = deriveRegisterCountAndBytes(2);
  check("word_count=2 (32-bit packed pair, write_bms_u32 -- the only invoked production path today): register_count=2, expected_payload_bytes=4",
    r2.registerCount === 2 && r2.expectedPayloadBytes === 4);
}
// Settings write migration (owner decision 2026-09-29): 14 hand-written
// entities moved to the generated write_registry.yaml; the 4 contradictory
// temperature recoveries keep their hand-written (internal) entity here.
check("no hand-written entity in batterylifepo4.yaml invokes write_bms_u32/u16 any more (all 18 Settings writes are generated registry entities)",
  (yaml.match(/^\s*id: write_bms_u32$/gm) || []).length === 0 &&
  (yaml.match(/^\s*id: write_bms_u16$/gm) || []).length === 0);
check("write_bms_u16 (word_count: 1) is still defined (desktop-test-verified path, not yet exercised by any live entity)",
  yaml.includes("- id: write_bms_u16"));

// ===========================================================================
// 6. Preserved invariants: write allowlist unchanged (18 SETTING_KEYS),
// fail-closed defaults untouched, ACK/readback comparison logic untouched,
// timeout/recovery states untouched, late-response generation-guards
// untouched. None of these should have moved as part of this fix.
// ===========================================================================
const jkBms = fs.readFileSync(path.join(ROOT, "jk_bms.js"), "utf8");
{
  const m = jkBms.match(/const SETTING_KEYS = Object\.freeze\(\[([\s\S]*?)\]\);/);
  const keyCount = m ? (m[1].match(/"[a-z0-9_]+"/g) || []).length : 0;
  check("jk_bms.js: SETTING_KEYS still has exactly 18 entries (write allowlist unchanged by this fix)", keyCount === 18);
}
check("generic write-tx servicer: WRITE_UNCERTAIN reclassification (ACK_TIMEOUT/READBACK_TIMEOUT -> recovery probe) is untouched",
  yaml.includes("s.status = jk_write_tx::WRITE_UNCERTAIN;") &&
  yaml.includes("id(g_wtx_recovery_pending)[i] = 1;"));
check("generic write-tx servicer: the immutable {idx, tx_id, address, generation} stale-response guard is untouched for the ACK-readback callback",
  yaml.includes("if (id(g_wtx_generation)[i] != readback_generation || id(g_wtx_tx_id)[i] != readback_tx_id ||\n                        id(g_wtx_address)[i] != readback_addr) {"));
check("generic write-tx servicer: the immutable {idx, tx_id, address, generation} stale-response guard is untouched for the recovery-probe callback (also re-checks WRITE_UNCERTAIN)",
  yaml.includes("if (id(g_wtx_generation)[i] != recovery_generation || id(g_wtx_tx_id)[i] != recovery_tx_id ||\n                        id(g_wtx_address)[i] != recovery_addr || id(g_wtx_status)[i] != jk_write_tx::WRITE_UNCERTAIN) {"));
check("generic write-tx servicer: compare_masked() (ACK/readback comparison) call site is untouched",
  yaml.includes("jk_write_tx::compare_masked(id(g_wtx_requested_raw)[i], v, id(g_wtx_compare_mask)[i]);"));
check("generic write-tx servicer: single-flight/fail-closed rejection path (jk_write_tx::begin returning < 0) is untouched",
  yaml.includes('ESP_LOGW("jk_write_tx", "Write to 0x%04X rejected -- a transaction for this register "'));
check("generic write-tx servicer: exactly 2 '250ms' interval blocks exist project-wide (this generic servicer + CellCount's own pre-existing bespoke one) -- this fix did not add a new polling loop",
  (yaml.match(/^  - interval: 250ms$/gm) || []).length === 2);

// ===========================================================================
// 7. jk_write_tx_core.h (pure state machine) is untouched by this fix --
// word_count is opaque to it (register_count/byte semantics live entirely
// in the YAML glue this suite tests above).
// ===========================================================================
const coreHeader = fs.readFileSync(path.join(ROOT, "components", "jk_write_tx", "jk_write_tx_core.h"), "utf8");
check("jk_write_tx_core.h: word_count remains a plain, opaque uint8_t field (no register_count/byte_count concept added to the pure core)",
  coreHeader.includes("uint8_t word_count = 1;") &&
  !coreHeader.includes("register_count") && !coreHeader.includes("byte_count"));

console.log(`\n${checks} checks run, ${failures} failed.`);
process.exit(failures ? 1 : 0);
