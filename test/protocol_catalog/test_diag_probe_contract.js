#!/usr/bin/env node
"use strict";

// Read-only measurement build contract (clustered-read migration plan, M0).
//   1. The allowlist in components/jk_diag_probe/jk_diag_probe_core.h against
//      protocol/registers.canonical.json: every wide cluster starts and ends on
//      register boundaries (no split 32-bit value), the gap-word lists are
//      exactly the undefined words, every narrow read is a whole-register
//      sub-range of its wide read, and nothing touches 0x1470-0x147F.
//   2. A static audit of the diagnostic ESPHome configuration jk_bms_probe.yaml
//      (it is not compiled here): no web server, entities, API services,
//      scripts or write path; FC03 reads only through the allowlist; no raw
//      payload logging; bounded compile-time mode selection; production
//      batterylifepo4.yaml untouched by the probe.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const core = read("components/jk_diag_probe/jk_diag_probe_core.h");
const yaml = read("jk_bms_probe.yaml");
const canonical = JSON.parse(read("protocol/registers.canonical.json"));
const regs = (canonical.registers || canonical).map((r) => ({ a: parseInt(r.address, 16), w: r.word_count, keys: r.fields.map((f) => f.key) }));

let checks = 0;
let failures = 0;
function check(name, condition, detail = "") {
  checks += 1;
  if (!condition) failures += 1;
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` -- ${detail}` : ""}`);
}

// --- Parse the C++ tables ---------------------------------------------------
const requests = [...core.matchAll(/\{"([A-Z0-9_]+)", Kind::(WIDE|NARROW), FC_READ_HOLDING_REGISTERS, (0x[0-9A-F]+), (\d+), (\d+)\}/g)]
  .map((m) => ({ id: m[1], kind: m[2], a: parseInt(m[3], 16), n: Number(m[4]), bytes: Number(m[5]) }));
const byId = new Map(requests.map((r) => [r.id, r]));
const wordsOf = (name) => {
  const m = core.match(new RegExp(`constexpr uint16_t ${name}\\[\\] = \\{([^}]*)\\}`));
  return m ? m[1].split(",").map((s) => parseInt(s.trim(), 16)) : null;
};
const comparisons = [...core.matchAll(/\{index_of\("([A-Z0-9_]+)"\), index_of\("([A-Z0-9_]+)"\), (\d+), (\d+), (true|false)\}/g)]
  .map((m) => ({ narrow: m[1], wide: m[2], off: Number(m[3]), n: Number(m[4]), stable: m[5] === "true" }));

const P = { start: 0x1470, end: 0x1480 };
const overlapsP = (a, n) => a < P.end && a + 2 * n > P.start;
const defined = new Set();
for (const r of regs) for (let i = 0; i < r.w; i++) defined.add(r.a + 2 * i);
const straddles = (a) => regs.some((r) => r.a < a && r.a + 2 * r.w > a);  // a register starts before a and ends after it

// --- 1. Allowlist vs canonical ------------------------------------------------
const planWide = [["A1", 0x1200, 125], ["A2", 0x12FA, 10], ["C1", 0x1000, 124], ["C2", 0x10F8, 19], ["S1", 0x1400, 20], ["S2", 0x14B2, 18], ["S3", 0x14E4, 18]];
const wide = requests.filter((r) => r.kind === "WIDE");
check("the wide allowlist is exactly the plan's 7 clusters (owner-confirmed C1 0x1000x124 / C2 0x10F8x19)",
  JSON.stringify(wide.map((r) => [r.id, r.a, r.n])) === JSON.stringify(planWide), JSON.stringify(wide.map((r) => r.id)));
check("every request expects exactly 2 bytes per register and at most 125 registers",
  requests.length >= 7 && requests.every((r) => r.bytes === 2 * r.n && r.n >= 1 && r.n <= 125));
check("no request touches the setup-passcode range 0x1470-0x147F", requests.every((r) => !overlapsP(r.a, r.n)));
check("the old split 0x1000x125 / 0x10FAx18 is absent", !requests.some((r) => (r.a === 0x1000 && r.n === 125) || (r.a === 0x10FA && r.n === 18)));
check("no wide cluster starts or ends inside a canonical register (no split multi-word value)",
  wide.every((r) => !straddles(r.a) && !straddles(r.a + 2 * r.n)), wide.filter((r) => straddles(r.a) || straddles(r.a + 2 * r.n)).map((r) => r.id).join(","));
check("every canonical register except the passcode lies inside one wide cluster",
  regs.filter((r) => !overlapsP(r.a, r.w)).every((r) => wide.some((w) => r.a >= w.a && r.a + 2 * r.w <= w.a + 2 * w.n)));
const gapsOf = (r) => { const g = []; for (let i = 0; i < r.n; i++) if (!defined.has(r.a + 2 * i)) g.push(r.a + 2 * i); return g; };
const listed = { A1: wordsOf("kA1GapWords"), A2: wordsOf("kA2GapWords"), C2: wordsOf("kC2GapWords") };
for (const w of wide) {
  const expected = gapsOf(w);
  const got = listed[w.id] || [];
  check(`${w.id}: the gap-word list is exactly its undefined words (${expected.length})`,
    JSON.stringify([...got].sort()) === JSON.stringify(expected.sort()), `${got.map((x) => x.toString(16))} vs ${expected.map((x) => x.toString(16))}`);
}
const narrow = requests.filter((r) => r.kind === "NARROW");
check("every narrow read covers whole canonical registers (starts and ends on boundaries)",
  narrow.every((r) => regs.some((g) => g.a === r.a) && !straddles(r.a + 2 * r.n) && defined.has(r.a)),
  narrow.filter((r) => !regs.some((g) => g.a === r.a) || straddles(r.a + 2 * r.n)).map((r) => r.id).join(","));
check("every narrow read has exactly one comparison against its containing wide read",
  narrow.length === comparisons.length && narrow.every((n) => comparisons.filter((c) => c.narrow === n.id).length === 1));
check("every comparison is the exact sub-range of its wide read",
  comparisons.every((c) => { const n = byId.get(c.narrow), w = byId.get(c.wide); return n && w && n.a === w.a + 2 * c.off && n.n === c.n && c.off + c.n <= w.n; }));
check("only configuration/static comparisons are marked stable (telemetry is live)",
  comparisons.every((c) => c.stable === !["A1", "A2"].includes(c.wide)));
check("summaries cover inactive voltages 17-32 (0x1220) and resistances 17-32 (0x126A) inside A1",
  /\{"A1_V17_32", index_of\("A1"\), 0x1220, 16,/.test(core) && /\{"A1_R17_32", index_of\("A1"\), 0x126A, 16,/.test(core));

// --- 2. Core safety constants -------------------------------------------------
check("the core has no write function code and no raw-frame logging",
  /constexpr bool kLogRawFrames = false;/.test(core) && /static_assert\(!kLogRawFrames/.test(core) &&
  !/0x06|0x10\b|0x0F|write_multiple|create_write/i.test(core.replace(/0x10[0-9A-F]{2}|0x14[0-9A-F]{2}|0x12[0-9A-F]{2}|0x10F8|0x1000/g, "")));
check("the run is bounded: 30 min hard maximum, clamp and latched FINISHED",
  /kHardMaxRunMs = 30UL \* 60UL \* 1000UL/.test(core) && /r > kHardMaxRunMs \? kHardMaxRunMs : r/.test(core) &&
  /if \(!begun_ \|\| finished_\) return -1;/.test(core));

// --- 3. Static audit of the diagnostic configuration ----------------------------
const topKeys = [...yaml.matchAll(/^([a-z0-9_]+):/gm)].map((m) => m[1]);
const allowedTop = ["substitutions", "esphome", "esp32", "wifi", "ota", "api", "logger", "uart", "modbus", "modbus_controller", "interval"];
check("the configuration uses only the minimal top-level components (no web_server, entities, scripts, globals, packages)",
  topKeys.every((k) => allowedTop.includes(k)) && allowedTop.every((k) => topKeys.includes(k)), topKeys.join(","));
check("the API exposes no services/actions", !/^\s+(services|actions):/m.test(yaml));
check("no write path: no write command, script or FC06/FC16 anywhere",
  !/create_write|write_multiple|write_single|begin_write_tx|write_bms|WRITE|set_action|FunctionCode::WRITE/i.test(yaml.replace(/^#.*$/gm, "")));
check("exactly one Modbus request site, a create_read_command driven by the allowlist entry",
  (yaml.match(/queue_command\(/g) || []).length === 1 && (yaml.match(/create_read_command\(/g) || []).length === 1 &&
  /create_read_command\(\s*id\(bms0\), esphome::modbus::EntityType::HOLDING, r\.address, r\.count,/.test(yaml) &&
  /const Request &r = kRequests\[idx\];/.test(yaml) && /const int idx = g_probe\.poll\(now, timed_out\);/.test(yaml) &&
  /if \(find_allowed\(r\.function, r\.address, r\.count\) != idx\) return;/.test(yaml));
check("no register address literal appears in the configuration (addresses come only from the allowlist)",
  !/0x1[0-5][0-9A-Fa-f]{2}/.test(yaml.replace(/^#.*$/gm, "")));
check("the only includes are the probe core and the pure capability core it reuses",
  JSON.stringify([...yaml.matchAll(/^\s+- (components\/[^\s]+)$/gm)].map((m) => m[1])) ===
  JSON.stringify(["components/jk_capability/jk_capability_core.h", "components/jk_diag_probe/jk_diag_probe_core.h"]));
const buildPath = ((yaml.match(/^esphome:\n((?:[ #].*\n|\n)*)/m) || ["", ""])[1].match(/^  build_path:\s*(\S+)\s*$/m) || [])[1];
check("the probe has its own explicit build directory (esphome.build_path)", typeof buildPath === "string" && buildPath.length > 0, String(buildPath));
check("the probe build directory is distinct from production's (.esphome/build/jk-bms, /data/build/jk-bms)",
  typeof buildPath === "string" && !/(^|\/)build\/jk-bms\/?$/.test(buildPath.replace(/^\.\//, "")) && !/^\.esphome\/build\/?$/.test(buildPath) &&
  !/^\s*build_path:/m.test(read("batterylifepo4.yaml")), String(buildPath));
check("the probe build directory is a portable relative path (no absolute or machine-specific path)",
  typeof buildPath === "string" && !/^(\/|~|[A-Za-z]:[\\/]|\\\\)/.test(buildPath) && !buildPath.split("/").includes("..") && !/\$\{|\/Users\/|\/home\/|\/data\/|\/config\//.test(buildPath),
  String(buildPath));
check("the controller polls nothing on its own", /modbus_controller:[\s\S]*update_interval: never/.test(yaml));
check("mode selection is compile-time only, defaulting to gate A and a mode-default run length",
  /probe_mode: A_COMPATIBILITY/.test(yaml) && /probe_run_ms: "0"/.test(yaml) && /Mode::\$\{probe_mode\}/.test(yaml) &&
  !/http|endpoint|AsyncWebHandler|set_mode|register_service/i.test(yaml.replace(/^#.*$/gm, "")));
const onMessage = (yaml.match(/on_message:[\s\S]*?(?=\n[a-z0-9_]+:)/) || [""])[0];
check("the logger callback only parses and queues (never logs, so no recursion)",
  onMessage.includes("parse_modbus_error_line") && onMessage.includes("g_log_queue.push") && !/ESP_LOG/.test(onMessage));
check("response bytes never reach a log call (data only goes to on_response)",
  !/ESP_LOG[A-Z]*\([^;]*data/.test(yaml) && (yaml.match(/data\.data\(\)/g) || []).length === 1);
check("the API does not reboot the device mid-run (reboot_timeout: 0s)", /api:[\s\S]*reboot_timeout: 0s/.test(yaml));

// --- 4. Production is untouched by the probe -------------------------------------
const production = read("batterylifepo4.yaml");
check("production batterylifepo4.yaml does not include or reference the probe", !/jk_diag_probe|jk_bms_probe/.test(production));

console.log(`\ndiag probe contract: ${checks - failures}/${checks} passed`);
process.exit(failures ? 1 : 0);
