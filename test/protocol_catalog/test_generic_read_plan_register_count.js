#!/usr/bin/env node
"use strict";

// Regression test for the generic read-plan register-count systemic fix
// (2026-09-19/20, user-directed Stage 3 completion pass). Root cause: the
// generator's wireRegisterCount() applied a uniform "2x canonical
// word_count" rule to every non-ASCII block, believed at the time to be
// "the JK protocol's documented declared-address gap convention". That
// belief was found to be a mechanical overgeneralization of an old
// YAML-literal population that itself contained the exact same
// byte-vs-register unit-confusion bug in 6 independently-audited,
// independently-fixed cases (2026-09-18 commits c722f5a/73c65f2/f6483a3/
// 7832182/b867781/9adce23) -- zero of which needed genuine doubling once
// correctly re-derived. This project's generic pipeline issues exactly
// ONE physical Modbus read per canonical register address, which is not
// the scenario the real upstream gap-doubling technique addresses (that
// technique exists to help ESPHome's own multi-sensor auto-range-merge
// heuristic span several DIFFERENT declared addresses in one request).
//
// This is a real regeneration test against the actual generator and its
// actual generated output, not a reimplementation.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
function loadJson(p) { return JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8")); }

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

// Regenerate for real (self-contained even if run before anyone else
// regenerated the committed artifacts), then restore, matching the
// pattern established by test_stage3_status_map_exact_identity.js.
const GEN_SCRIPT = path.join(ROOT, "tools", "protocol", "generate_read_plan.js");
const OUT_PATHS = ["read_plan.json", "read_plan_decode.h", "read_plan.yaml"].map((f) => path.join(ROOT, "protocol", "generated", f));
const committedBefore = OUT_PATHS.map((p) => fs.readFileSync(p, "utf8"));
execFileSync(process.execPath, [GEN_SCRIPT], { cwd: ROOT, stdio: "pipe" });
const secondRun = OUT_PATHS.map((p) => fs.readFileSync(p, "utf8"));
execFileSync(process.execPath, [GEN_SCRIPT], { cwd: ROOT, stdio: "pipe" });
const thirdRun = OUT_PATHS.map((p) => fs.readFileSync(p, "utf8"));
check("regenerating read_plan.{json,decode.h,yaml} twice in a row is byte-identical (deterministic)",
  OUT_PATHS.every((_, i) => secondRun[i] === thirdRun[i]));
OUT_PATHS.forEach((p, i) => fs.writeFileSync(p, committedBefore[i]));

const readPlan = loadJson("protocol/generated/read_plan.json");
const canonical = loadJson("protocol/registers.canonical.json");
const canonByAddr = new Map(canonical.registers.map((r) => [r.address, r]));
const readPlanYaml = fs.readFileSync(path.join(ROOT, "protocol", "generated", "read_plan.yaml"), "utf8");

// ===========================================================================
// 1. No implicit uniform 2x rule remains: every ORDINARY_ONE_REGISTER and
// ASCII_CONTIGUOUS block requests EXACTLY its canonical word_count -- not
// double, not any other multiplier.
// ===========================================================================
let ordinaryCount = 0;
let asciiCount = 0;
let clusteredCount = 0;
let wrongOrdinary = [];
for (const b of readPlan.blocks) {
  if (b.block_class === "ORDINARY_ONE_REGISTER") {
    ordinaryCount += 1;
    const reg = canonByAddr.get(b.address);
    if (b.register_count !== reg.word_count) wrongOrdinary.push({ address: b.address, register_count: b.register_count, word_count: reg.word_count });
  } else if (b.block_class === "ASCII_CONTIGUOUS") {
    asciiCount += 1;
    const reg = canonByAddr.get(b.address);
    if (b.register_count !== reg.word_count) wrongOrdinary.push({ address: b.address, register_count: b.register_count, word_count: reg.word_count });
  } else if (b.block_class === "CLUSTERED_GAP_AWARE") {
    clusteredCount += 1;
  }
}
check("every ORDINARY_ONE_REGISTER/ASCII_CONTIGUOUS block requests register_count === canonical word_count (no implicit 2x rule)",
  wrongOrdinary.length === 0, JSON.stringify(wrongOrdinary));
check("there are 96 ORDINARY_ONE_REGISTER blocks (95 at this round's start + 1 new: 0x1118, authored later the same round)", ordinaryCount === 96, `actual=${ordinaryCount}`);
check("there are 6 ASCII_CONTIGUOUS blocks (4 real ASCII + 2 HEX arrays: 0x14B4/0x14C4, authored later the same round)", asciiCount === 6, `actual=${asciiCount}`);
check("there is exactly 1 CLUSTERED_GAP_AWARE block (0x1290)", clusteredCount === 1, `actual=${clusteredCount}`);
check("block_count is 103 (100 from this round's register-count fix + 3 new blocks authored later the same round: 0x1118, 0x14B4, 0x14C4)", readPlan.block_count === 103, `actual=${readPlan.block_count}`);

// ===========================================================================
// 2. block_class/validation_policy/exception_reason machine-readable audit
// fields are present on every block, and every block is exact/documented.
// ===========================================================================
let missingClass = [];
let nonExactPolicy = [];
let undocumentedException = [];
let wrongStrictLength = [];
for (const b of readPlan.blocks) {
  if (!b.block_class) missingClass.push(b.address);
  // CORRECTED 2026-09-20 (hardware acceptance defect, see this file's own
  // updated module comment below): every block is "exact" EXCEPT the ONE
  // CLUSTERED_GAP_AWARE block (0x1290), which is legitimately "floor" --
  // this was the original design intent (module comment in
  // generate_read_plan.js), but the emitted C++ ignored it and applied
  // exact-match unconditionally until this fix. See
  // test/jk_poll_scheduler/test_read_plan_decode.cpp's
  // test_strict_length_carve_out_for_clustered_gap_aware_block() for the
  // dedicated regression coverage of the incident itself.
  const expectedPolicy = b.block_class === "CLUSTERED_GAP_AWARE" ? "floor" : "exact";
  if (b.validation_policy !== expectedPolicy) nonExactPolicy.push(b.address);
  if (b.block_class === "CLUSTERED_GAP_AWARE" && b.strict_length !== false) wrongStrictLength.push(b.address);
  if (b.block_class !== "CLUSTERED_GAP_AWARE" && b.strict_length !== true) wrongStrictLength.push(b.address);
  if (b.block_class === "CLUSTERED_GAP_AWARE" && !b.exception_reason) undocumentedException.push(b.address);
  if (b.block_class !== "CLUSTERED_GAP_AWARE" && b.exception_reason) undocumentedException.push(`${b.address} (unexpected exception_reason on a non-clustered block)`);
}
check("every block carries a block_class", missingClass.length === 0, JSON.stringify(missingClass));
check("every block's validation_policy is 'exact', except the one CLUSTERED_GAP_AWARE block (0x1290), which is 'floor'", nonExactPolicy.length === 0, JSON.stringify(nonExactPolicy));
check("strict_length agrees with validation_policy for every block (false only for 0x1290)", wrongStrictLength.length === 0, JSON.stringify(wrongStrictLength));
check("every CLUSTERED_GAP_AWARE block (and ONLY that class) carries an explicit exception_reason", undocumentedException.length === 0, JSON.stringify(undocumentedException));

// ===========================================================================
// 3. Specific addresses named in this round's instructions.
// ===========================================================================
const byAddr = new Map(readPlan.blocks.map((b) => [b.address, b]));
check("0x1504 (rcv_time/rfv_time, packed) is ORDINARY_ONE_REGISTER with register_count=1 (word_count=1)",
  byAddr.get("0x1504").block_class === "ORDINARY_ONE_REGISTER" && byAddr.get("0x1504").register_count === 1,
  JSON.stringify(byAddr.get("0x1504")));
check("0x106C (cell_count generic telemetry) now requests register_count=2, matching the already-hardware-evidenced bespoke write-tx fix at the same address",
  byAddr.get("0x106C").register_count === 2, JSON.stringify(byAddr.get("0x106C")));
check("0x1240 (cell_connected_mask generic telemetry) now requests register_count=2, matching the already-hardware-evidenced bespoke write-tx fix at the same address",
  byAddr.get("0x1240").register_count === 2, JSON.stringify(byAddr.get("0x1240")));
check("0x1290 (electrical metrics, CLUSTERED_GAP_AWARE) register_count is UNCHANGED at 12 -- not mechanically reduced to 6 without hardware proof",
  byAddr.get("0x1290").register_count === 12 && byAddr.get("0x1290").payload_bytes === 12,
  JSON.stringify(byAddr.get("0x1290")));
check("0x1290's exception_reason names both open candidate register_count values (10 via declared-span, 12 current) without asserting either is proven",
  /10 registers/.test(byAddr.get("0x1290").exception_reason) && /12/.test(byAddr.get("0x1290").exception_reason) && /hardware-pending/i.test(byAddr.get("0x1290").exception_reason),
  byAddr.get("0x1290").exception_reason);

// ===========================================================================
// 4. Response validation policy: the emitted C++ scheduler callback rejects
// both short AND oversized responses (==) for strict_length blocks, and
// only short responses (>=) for the one non-strict (CLUSTERED_GAP_AWARE)
// block -- per-block, driven by jk_read_plan::kBlocks[chosen].strict_length,
// never a single global floor check that would silently accept extra bytes
// on every block uniformly (that would be the OTHER, opposite defect).
// CORRECTED 2026-09-20: this section previously asserted a single global
// "!=" literal with no per-block carve-out at all; that assertion is what
// this project's hardware acceptance found was itself the defect (see
// test/jk_poll_scheduler/test_read_plan_decode.cpp's test_strict_length_carve_out_for_clustered_gap_aware_block()).
// ===========================================================================
check("emitted scheduler callback declares a per-block strict_length flag read from kBlocks[chosen]",
  readPlanYaml.includes("const bool strict_length = jk_read_plan::kBlocks[chosen].strict_length;"));
check("emitted scheduler callback's length_ok branches strict_length ? exact-match : floor-check, not a single unconditional policy",
  readPlanYaml.includes("const bool length_ok = strict_length ? (data.size() == payload_bytes) : (data.size() >= payload_bytes);"));
check("emitted scheduler callback no longer contains the old unconditional exact-match pattern (data.size() != payload_bytes) with no strict_length gate",
  !readPlanYaml.includes("if (data.size() != payload_bytes)"));
check("emitted scheduler callback does not contain a bare, ungated floor-check pattern either (data.size() < payload_bytes) -- the branch must be per-block, not a second unconditional policy",
  !readPlanYaml.includes("if (data.size() < payload_bytes)"));
check("length-mismatch (either direction) still increments the error counter and clears pending ownership (transport/error counters preserved)",
  /if \(!length_ok\) \{[\s\S]{0,800}g_rp_error_count\)\[chosen\][\s\S]{0,300}g_rp_transport_state\)\[chosen\][\s\S]{0,300}g_rp_pending_index/.test(readPlanYaml));
check("a length-mismatched response returns early, never falling through to decode a partial/extra payload",
  /if \(!length_ok\) \{[\s\S]{0,600}return;\s*\}\s*const uint8_t \*raw = data\.data\(\);/.test(readPlanYaml));

// ===========================================================================
// 5. Bus-load: total requested wire bytes strictly decreased vs. the
// pre-fix uniform-2x baseline (684 bytes across the 100 blocks, computed
// directly from the committed pre-fix read_plan.json in an earlier audit
// round) -- a real, verifiable improvement, not merely asserted.
// ===========================================================================
const totalWireBytesNow = readPlan.blocks.reduce((n, b) => n + b.register_count * 2, 0);
check("total requested wire bytes across all 100 blocks decreased from the pre-fix baseline (684 bytes)",
  totalWireBytesNow < 684, `now=${totalWireBytesNow}`);

// ===========================================================================
// 6. 0x1504 blocker text is internally consistent with the corrected
// generated value. CORRECTED 2026-09-20: hardware acceptance (second
// attempt, post-reflash, HEAD aded697) confirmed register_count=1 produces
// a normal response with correct, stable rcv_time/rfv_time values across a
// >1h continuous observation on a confirmed fresh boot -- exactly this
// blocker's own closure_criterion -- so it is now CLOSED, not open. This
// section previously asserted the opposite (a software fix alone cannot
// close a hardware-pending blocker) because no hardware evidence existed
// yet at that time; that reasoning still holds in general, it's just that
// the hardware evidence now exists.
// ===========================================================================
const blockers = loadJson("protocol/evidence/protocol_blockers.json");
const blocker1504 = blockers.blockers.find((b) => b.address === "0x1504");
check("the 0x1504 blocker is CLOSED (hardware acceptance 2026-09-20 confirmed register_count=1 on real hardware, satisfying its own closure_criterion)",
  blocker1504 && blocker1504.status === "closed" && !!blocker1504.closed_date);
check("the 0x1504 blocker's issue text reflects the corrected register_count=1 value, not the old register_count=2 claim",
  blocker1504 && /register_count=1/.test(blocker1504.issue) && /SOFTWARE FIX LANDED/.test(blocker1504.issue));

// ===========================================================================
// 7. The 0x1290 defect this fix addresses has its own blocker entry,
// documenting the incident and staying OPEN (the underlying register_count/
// response-length question is still hardware-unresolved; only the
// unconditional-exact-match regression itself is fixed this round).
// ===========================================================================
const blocker1290 = blockers.blockers.find((b) => b.address === "0x1290");
check("a 0x1290 blocker entry exists, documenting the strict-length hardware-acceptance defect",
  !!blocker1290);
check("the 0x1290 blocker stays OPEN (the underlying register_count/response-length question remains hardware-unresolved)",
  blocker1290 && blocker1290.status === "open");
check("the 0x1290 blocker's issue text names the confirmed defect, the fix, and that it needs a new firmware flash to take effect",
  blocker1290 && /CONFIRMED SOFTWARE DEFECT/.test(blocker1290.issue) && /strict_length/.test(blocker1290.issue) && /requires a new firmware build\+flash/.test(blocker1290.issue));

console.log(`\n${checks} checks run, ${failures} failed.`);
process.exit(failures ? 1 : 0);
