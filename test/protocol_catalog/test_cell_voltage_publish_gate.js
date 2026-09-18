#!/usr/bin/env node
"use strict";

// Regression test for the "inactive-channel publish-before-blank" fix
// (2026-09-18, user-directed, found via a real 30-minute hardware SSE
// capture during the 260cbba read-only retest: cell_voltage_17..32 were
// observed publishing a fabricated "0.000 V" numeric value on ~99% of 1Hz
// decode cycles, ~20-90ms before being corrected to NA by
// resolve_topology()'s own blanking pass -- a real race, not a capture
// artifact; see protocol/evidence/stage1_corrective_evidence/
// hw_retest_260cbba_sse_30min_20260918.log).
//
// The fix moves the gate to the point of publish itself: a channel index
// >= the currently-configured CellCount (jk_topology::
// channel_count_from_configured(id(cell_count).state), the SAME shared
// helper jk_topology::resolve()'s own blank_voltage_from now calls --
// real behavioral coverage of that helper across N=4/8/16/24/32 lives in
// test/jk_topology/test_jk_topology_core.cpp, executed via a real g++
// build) never receives a publish_state() call with a decoded numeric
// value at all. resolve_topology()'s existing blank-to-NaN pass is left
// completely unchanged as a defensive backstop for states this decode
// callback doesn't reach (OFFLINE, no fresh response, etc.) -- this file
// does not touch or re-test that pass, only the NEW gate upstream of it.
//
// IMPORTANT, per this project's own stated convention (see
// test_bespoke_read_register_count.js's own header): every check in this
// file is a STRUCTURAL/SOURCE-TEXT regression test. There is no ESPHome
// toolchain in this environment (the user compiles/flashes via Home
// Assistant), so none of these checks execute the real, compiled decode
// lambda -- they pin the fixed YAML source text directly. The actual
// hardware-observed absence of the flicker is proven separately by a
// targeted read-only retest capture against real hardware (out of this
// file's scope, see the retest report), and the shared helper's own
// arithmetic correctness is REAL production-code execution, but in
// test_jk_topology_core.cpp, not here.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const yaml = fs.readFileSync(path.join(ROOT, "batterylifepo4.yaml"), "utf8");

let checks = 0;
let failures = 0;
function check(name, condition) {
  checks += 1;
  if (condition) {
    console.log(`PASS  [structural]  ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL  [structural]  ${name}`);
  }
}

// ===========================================================================
// 1. The gate variable exists, computed fresh every decode from the live
// cell_count sensor via the shared helper -- never a hardcoded channel
// count, so this scales to whatever N the connected pack actually reports
// (8S/16S/24S/32S), not just the currently-deployed 16S unit.
// ===========================================================================
check("decode callback: known_active_channels is computed from jk_topology::channel_count_from_configured(id(cell_count).state) -- not a literal",
  /const uint8_t known_active_channels =\s*\n\s*jk_topology::channel_count_from_configured\(id\(cell_count\)\.state\);/.test(yaml));

// ===========================================================================
// 2. Base channels 1-16: both voltage_sensors[i] and resistance_sensors[i]
// publish_state() calls are gated behind `i < known_active_channels` --
// the old unconditional pair (no surrounding if) must be gone. (The plain
// "publish pair immediately followed by an unguarded `if millivolts>=500U`"
// text check that used to live here was retired: since the second-round
// audit below moved min/max INSIDE the same gate, that sequential-text
// pattern would still match even though the code is now correctly gated --
// the real discriminator is check #80 below, which specifically requires
// the gate's closing brace to appear BEFORE the min/max checks, not after.)
// ===========================================================================
check("base 1-16 loop: voltage_sensors[i] and resistance_sensors[i] publish_state() are both wrapped in `if (i < known_active_channels)`",
  /if \(i < known_active_channels\) \{\s*\n\s*voltage_sensors\[i\]->publish_state\(millivolts \* 0\.001f\);\s*\n\s*resistance_sensors\[i\]->publish_state\(milliohms \* 0\.001f\);/.test(yaml));
// Second-round audit (2026-09-18, user-directed): min/max-tracking is now
// ALSO inside the same `i < known_active_channels` gate, not a separate,
// unconditional pass -- raw bytes from an inactive channel (N<16) could
// pass the >=500U sanity floor and corrupt min_cell_voltage/max_cell_voltage/
// min_voltage_cell/max_voltage_cell with a non-trustworthy reading.
check("base 1-16 loop: min/max-tracking (millivolts >= 500U comparisons) is now INSIDE the known_active_channels gate, not a separate unconditional pass",
  /if \(i < known_active_channels\) \{\s*\n\s*voltage_sensors\[i\]->publish_state\(millivolts \* 0\.001f\);\s*\n\s*resistance_sensors\[i\]->publish_state\(milliohms \* 0\.001f\);\s*\n\s*if \(millivolts >= 500U && millivolts < min_mv\) \{\s*\n\s*min_mv = millivolts;\s*\n\s*min_index = i \+ 1U;\s*\n\s*\}\s*\n\s*if \(millivolts >= 500U && millivolts > max_mv\) \{\s*\n\s*max_mv = millivolts;\s*\n\s*max_index = i \+ 1U;\s*\n\s*\}\s*\n\s*\}\s*\n\s*\}/.test(yaml));
check("base 1-16 loop: the OLD unconditional min/max pattern (checks running outside/after the gate) is gone",
  !/\}\s*\n\s*if \(millivolts >= 500U && millivolts < min_mv\) \{\s*\n\s*min_mv = millivolts;\s*\n\s*min_index = i \+ 1U;\s*\n\s*\}\s*\n\s*if \(millivolts >= 500U && millivolts > max_mv\) \{\s*\n\s*max_mv = millivolts;\s*\n\s*max_index = i \+ 1U;\s*\n\s*\}\s*\n\s*\}\s*\n\s*\n\s*\/\/ Stage 3 cell-channel batch/.test(yaml));

// ===========================================================================
// 3. Extended channels 17-32: voltage_sensors_ext[i] publish_state() is
// gated behind `(16U + i) < known_active_channels` -- channel 17 is index
// 16 overall, so this is the correct absolute-index comparison, not a
// re-based-to-0 comparison that would silently always be true/false.
// ===========================================================================
check("ext 17-32 loop: the OLD unconditional single-line publish is gone",
  !/const uint16_t millivolts =\s*\n\s*\(uint16_t\(data\[voltage_offset\]\) << 8\) \| data\[voltage_offset \+ 1U\];\s*\n\s*voltage_sensors_ext\[i\]->publish_state\(millivolts \* 0\.001f\);\s*\n\s*\}/.test(yaml));
check("ext 17-32 loop: voltage_sensors_ext[i] publish_state() is wrapped in `if ((16U + i) < known_active_channels)`",
  /if \(\(16U \+ i\) < known_active_channels\) \{\s*\n\s*voltage_sensors_ext\[i\]->publish_state\(millivolts \* 0\.001f\);\s*\n\s*\}/.test(yaml));

// ===========================================================================
// 4. Raw decode (millivolts/milliohms) is still computed unconditionally
// for every one of the 32 base+ext channels -- gating happens only at the
// point values are USED (publish_state and, since the second-round audit,
// min/max tracking too), per instruction: "raw decode може зберігатися
// внутрішньо, але не виходить назовні як достовірний стан."
// ===========================================================================
check("base loop: millivolts/milliohms are still decoded unconditionally for all 16 base channels (only downstream USE is gated)",
  yaml.includes("const uint16_t millivolts =\n                      (uint16_t(data[voltage_offset]) << 8) | data[voltage_offset + 1U];\n                  const uint16_t milliohms =\n                      (uint16_t(data[resistance_offset]) << 8) | data[resistance_offset + 1U];"));

// ===========================================================================
// 5. resolve_topology()'s own blank-to-NaN pass is UNCHANGED -- still the
// defensive backstop for every state, not removed or weakened by this fix.
// ===========================================================================
check("resolve_topology: the voltage blank-to-NaN loop (out.blank_voltage_from) is still present, unchanged",
  yaml.includes("for (uint8_t i = out.blank_voltage_from; i < jk_topology::PROTOCOL_CHANNEL_CAPACITY; i++) {\n            voltage_sensors[i]->publish_state(NAN);\n          }"));
check("resolve_topology: still invoked once per successful 1Hz decode (id(resolve_topology)->execute() inside the same callback)",
  yaml.includes("id(resolve_topology)->execute();"));

// ===========================================================================
// 6. Nothing else in this fix's bounded scope moved: register_count (53),
// polling cadence (15000ms pending-guard, 1s interval), and write-access
// (SETTING_KEYS/write allowlist) are all untouched -- this is a read-path
// publish-ordering fix only, never a protocol/cadence/write change.
// ===========================================================================
check("register_count for the 0x1200 block is still exactly 53 (untouched by this fix)",
  yaml.includes("constexpr uint16_t register_count = 53;"));
check("0x1200 block still requested as 0x1200, register_count, (untouched)",
  yaml.includes("0x1200, register_count,"));
check("cell-block pending-guard still 15000ms (cadence untouched)",
  yaml.includes("uint32_t(now - id(g_cell_poll_started_ms)) < 15000U) {"));
check("no new interval:/globals: cadence mechanism was introduced by this fix (still <= 2 top-level '- interval: 1s' blocks)",
  (yaml.match(/^  - interval: 1s$/gm) || []).length <= 2);

const jkBms = fs.readFileSync(path.join(ROOT, "jk_bms.js"), "utf8");
{
  const m = jkBms.match(/const SETTING_KEYS = Object\.freeze\(\[([\s\S]*?)\]\);/);
  const keyCount = m ? (m[1].match(/"[a-z0-9_]+"/g) || []).length : 0;
  check("jk_bms.js: SETTING_KEYS still has exactly 18 entries (write allowlist untouched by this fix)", keyCount === 18);
}

// ===========================================================================
// 7. The shared helper this gate depends on is declared exactly once, in
// jk_topology_core.h, and used by BOTH resolve() and the YAML gate --
// never reimplemented inline in the YAML (which would risk the two
// diverging again, the exact class of bug this fix removes).
// ===========================================================================
const topologyHeader = fs.readFileSync(
  path.join(ROOT, "components", "jk_topology", "jk_topology_core.h"), "utf8");
check("jk_topology_core.h: channel_count_from_configured() is declared exactly once",
  (topologyHeader.match(/inline uint8_t channel_count_from_configured\(float configured_f\)/g) || []).length === 1);
check("jk_topology_core.h: resolve()'s own blank_from now calls channel_count_from_configured(), not a re-inlined copy of the old lroundf/range-check",
  topologyHeader.includes("const uint8_t blank_from = channel_count_from_configured(in.configured_f);"));
check("jk_topology_core.h: the OLD inline lroundf/range-check block inside resolve() (duplicate logic) is gone",
  !/uint8_t blank_from = 0;\s*\n\s*if \(!std::isnan\(in\.configured_f\)\) \{\s*\n\s*const int32_t candidate_raw = int32_t\(lroundf\(in\.configured_f\)\);\s*\n\s*if \(candidate_raw >= 1 && candidate_raw <= int32_t\(PROTOCOL_CHANNEL_CAPACITY\)\) \{\s*\n\s*blank_from = uint8_t\(candidate_raw\);/.test(topologyHeader));

console.log(`\n${checks} checks run, ${failures} failed.`);
process.exit(failures ? 1 : 0);
