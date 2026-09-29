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

// Clustered reads (plan M5): the cell decode moved from the dedicated 1 s
// reader's callback into cluster_stored (A1, or a latched fallback's
// bespoke cell image) and jk_cluster_cache::decode_cells_from_a1(). The
// gate itself is now REAL, compiled, desktop-executed code:
// test/jk_poll_scheduler/test_jk_cluster_cache_core.cpp checks 1/2/4/8/16/
// 17/24/32S publication and that an inactive channel never reaches min/max.
// The checks below pin the YAML wiring around that decoder.
const cacheCore = fs.readFileSync(path.join(ROOT, "components", "jk_poll_scheduler", "jk_cluster_cache_core.h"), "utf8");
const storedStart = yaml.indexOf("  - id: cluster_stored");
const stored = storedStart >= 0 ? yaml.slice(storedStart, yaml.indexOf("\n  - id: ", storedStart + 10)) : "";

// ===========================================================================
// 1. The active channel count comes from the live cell_count sensor via the
// shared helper -- never a literal.
// ===========================================================================
check("cluster_stored: the active channel count is jk_topology::channel_count_from_configured(id(cell_count).state) -- not a literal",
  stored.includes("const uint8_t active = jk_topology::channel_count_from_configured(id(cell_count).state);") &&
  stored.includes("jk_cluster_cache::decode_cells_from_a1(a1, active)"));

// ===========================================================================
// 2./3. Channels 1-32: voltage and resistance publish_state() only for a
// channel the decoder marked active; min/max only from active channels.
// ===========================================================================
check("cluster_stored: every publish_state() of a cell voltage/resistance is behind `if (!f.publish[i]) continue;`",
  /if \(!f\.publish\[i\]\) continue;[^\n]*\n\s*voltage_sensors\[i\]->publish_state\(f\.millivolts\[i\] \* 0\.001f\);\s*\n\s*if \(i < 16 \|\| ext_resistance_ok\) resistance_sensors\[i\]->publish_state\(f\.milliohms\[i\] \* 0\.001f\);/.test(stored));
check("decode_cells_from_a1: publish[i] = i < active_channels, and min/max skip every unpublished channel",
  cacheCore.includes("f.publish[i] = i < active_channels;") &&
  cacheCore.includes("if (!f.publish[i] || f.millivolts[i] < 500U) continue;"));
check("cluster_stored: min/max are published from the decoder's active-only result (no separate unconditional pass)",
  stored.includes("id(g_min_cell_v) = f.min_mv * 0.001f;") && stored.includes("id(g_max_cell_v) = f.max_mv * 0.001f;") &&
  !stored.includes("millivolts >= 500U"));
check("the OLD per-reader decode loops (voltage_sensors_ext / known_active_channels) are gone",
  !yaml.includes("voltage_sensors_ext[i]->publish_state") && !yaml.includes("known_active_channels"));

// ===========================================================================
// 4. The decoder reads every channel unconditionally; only its USE is gated.
// ===========================================================================
check("decode_cells_from_a1: millivolts/milliohms are decoded for all 32 channels (only publication/min-max is gated)",
  cacheCore.includes("f.millivolts[i] = be16(a1 + kA1VoltageOffset + 2 * i);") &&
  cacheCore.includes("f.milliohms[i] = be16(a1 + kA1ResistanceOffset + 2 * i);"));

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
check("the cell block is read by A1 (0x1200 x120, 1 s) and, only in a latched fallback, by the bespoke 0x1200 x53 reader at 1 s",
  fs.readFileSync(path.join(ROOT, "components", "jk_poll_scheduler", "jk_cluster_runtime_core.h"), "utf8").includes("{0x1200, 53, 0x1200, 0x1200, 1000},"));
check("no dedicated 1 s cell reader interval left (the cluster servicer owns the bus)",
  !yaml.includes("g_cell_poll_started_ms") && (yaml.match(/^  - interval: 1s$/gm) || []).length <= 2);

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
