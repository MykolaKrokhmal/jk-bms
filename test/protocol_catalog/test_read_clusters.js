#!/usr/bin/env node
"use strict";

// Canonical read clusters (clustered-read migration plan, M2):
//   1. the committed generated table matches the canonical source (--check),
//      covers every canonical register exactly once and equals the
//      hardware-verified gate A geometry of the diagnostic probe;
//   2. negative fixtures: each rule of tools/protocol/generate_read_clusters.js
//      rejects a mutated canonical source in an isolated copy of the tree.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const GEN = "tools/protocol/generate_read_clusters.js";
let checks = 0;
let failures = 0;
function check(name, condition, detail = "") {
  checks += 1;
  if (!condition) failures += 1;
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` -- ${detail}` : ""}`);
}
const read = (rel, root = ROOT) => fs.readFileSync(path.join(root, rel), "utf8");
const run = (args, root = ROOT) => spawnSync(process.execPath, [path.join(root, GEN), "--root", root, ...args], { encoding: "utf8" });

// --- 1. The committed table ---------------------------------------------------
const checkRun = run(["--check"]);
check("generate_read_clusters.js --check: the committed artifacts match the canonical source", checkRun.status === 0, checkRun.stdout.trim().split("\n").pop());
const gen = JSON.parse(read("protocol/generated/read_clusters.json"));
const registers = JSON.parse(read("protocol/registers.canonical.json")).registers;
check("every canonical register is covered exactly once (201 in clusters + 1 isolated = 202)",
  gen.covered_register_count + gen.isolated_register_count === registers.length && gen.isolated_register_count === 1);
const all = [...gen.clusters.flatMap((c) => c.register_ids), ...gen.isolated_reads.flatMap((r) => r.register_ids)];
check("no register id appears in two spans", new Set(all).size === all.length && all.length === registers.length);
const verified = [["A1", "0x1200", 120], ["A2", "0x12F0", 15], ["C1", "0x1000", 120], ["C2", "0x10F0", 23], ["S1", "0x1400", 20], ["S2", "0x14B2", 18], ["S3", "0x14E4", 18]];
check("the clusters are exactly the hardware-verified gate A geometry (A1 x120, A2 x15, C1 x120, C2 x23, S1-S3)",
  JSON.stringify(gen.clusters.map((c) => [c.cluster_id, c.start, c.register_count])) === JSON.stringify(verified));
const probe = read("components/jk_diag_probe/jk_diag_probe_core.h");
const probeWide = [...probe.matchAll(/\{"([A-Z][0-9])", Kind::WIDE, FC_READ_HOLDING_REGISTERS, (0x[0-9A-F]+), (\d+), \d+, Expect::OK\}/g)].map((m) => [m[1], m[2], Number(m[3])]);
check("the production cluster table equals the geometry the diagnostic probe verified on hardware",
  JSON.stringify(probeWide) === JSON.stringify(verified), JSON.stringify(probeWide));
const probeGaps = (name) => ((probe.match(new RegExp(`constexpr uint16_t ${name}\\[\\] = \\{([^}]*)\\}`)) || ["", ""])[1]).split(",").map((s) => s.trim().toUpperCase().replace("0X", "0x")).filter(Boolean);
check("gap words equal the probe's hardware-read gap lists (A1 5, A2 5, C2 4; C1, S1-S3 none)",
  JSON.stringify(gen.clusters.find((c) => c.cluster_id === "A1").gap_words) === JSON.stringify(probeGaps("kA1GapWords")) &&
  JSON.stringify(gen.clusters.find((c) => c.cluster_id === "A2").gap_words) === JSON.stringify(probeGaps("kA2GapWords")) &&
  JSON.stringify(gen.clusters.find((c) => c.cluster_id === "C2").gap_words) === JSON.stringify(probeGaps("kC2GapWords")) &&
  ["C1", "S1", "S2", "S3"].every((id) => gen.clusters.find((c) => c.cluster_id === id).gap_words.length === 0));
check("the setup passcode 0x1470 x8 is the only isolated read and in no cluster",
  gen.isolated_reads.length === 1 && gen.isolated_reads[0].start === "0x1470" && gen.isolated_reads[0].register_count === 8 &&
  JSON.stringify(gen.isolated_reads[0].register_ids) === JSON.stringify(["reg_0x1470_setup_passcode"]) &&
  !gen.clusters.some((c) => c.register_ids.includes("reg_0x1470_setup_passcode")));
check("cadences and budgets: A 1 s / 1.5 s; C 15 s / 15.5 s, active 3 s / 3.5 s; S 15 s / 15.5 s; J = 500 ms (no field slower than before, owner 2026-09-29)",
  gen.scheduling_allowance_ms === 500 &&
  gen.clusters.every((c) => ({ telemetry: [1000, 1500, null, null], settings: [15000, 15500, 3000, 3500], static: [15000, 15500, null, null] })[c.role]
    .every((v, i) => v === [c.cadence_ms, c.freshness_budget_ms, c.active_cadence_ms, c.active_freshness_budget_ms][i])));
check("A2 follows A1 and C2 follows C1 in the same cycle",
  gen.clusters.find((c) => c.cluster_id === "A2").sequence_after === "A1" && gen.clusters.find((c) => c.cluster_id === "C2").sequence_after === "C1");
check("the operational maximum is 120 and is documented as a design limit, not the protocol limit",
  gen.operational_max_registers === 120 && /not the BMS protocol limit/.test(read("protocol/read_clusters.canonical.json")) &&
  gen.clusters.every((c) => c.register_count <= 120));
const header = read("protocol/generated/read_clusters_table.h");
check("the generated header carries the table, the credential isolation and a static_assert",
  /constexpr Cluster kClusters\[\] = \{/.test(header) && /\{"P", 0x1470, 8\}/.test(header) &&
  /static_assert\(table_is_valid\(\)/.test(header) && /kMaxClusterPayloadBytes = 240;/.test(header));

// --- 2. Negative fixtures -----------------------------------------------------
const COPY = ["protocol/read_clusters.canonical.json", "protocol/schema/read-clusters-source.schema.json", "protocol/registers.canonical.json",
  GEN, "tools/protocol/lib/mini-schema.js", "protocol/generated/read_clusters.json", "protocol/generated/read_clusters_table.h"];
function sandbox(mutate) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jk-read-clusters-"));
  for (const rel of COPY) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), path.join(root, rel));
  }
  if (mutate) {  // no mutation: keep the canonical bytes (its hash is stamped into the outputs)
    const src = JSON.parse(read("protocol/read_clusters.canonical.json", root));
    mutate(src);
    fs.writeFileSync(path.join(root, "protocol/read_clusters.canonical.json"), JSON.stringify(src, null, 2));
  }
  return root;
}
const byId = (src, id) => src.clusters.find((c) => c.cluster_id === id);
const negatives = [
  ["a multi-word register split by a boundary (C1 x119 cuts the U32 at 0x10EC)", "READ_CLUSTERS_STRADDLE", (s) => { byId(s, "C1").register_count = 119; }],
  ["the setup passcode inside a cluster", "READ_CLUSTERS_CREDENTIAL", (s) => {
    s.isolated_reads = [];
    s.clusters.push({ ...byId(s, "S1"), cluster_id: "S4", start: "0x1470", register_count: 8 });
  }],
  ["an uncovered register (S3 removed)", "READ_CLUSTERS_UNCOVERED", (s) => { s.clusters = s.clusters.filter((c) => c.cluster_id !== "S3"); }],
  ["overlapping clusters (A2 from 0x12EE)", "READ_CLUSTERS_OVERLAP", (s) => { byId(s, "A2").start = "0x12EE"; byId(s, "A2").register_count = 16; }],
  ["a cluster above the operational maximum (A1 x121)", "READ_CLUSTERS_TOO_WIDE", (s) => { byId(s, "A1").register_count = 121; }],
  ["a freshness budget off the cadence + J rule", "READ_CLUSTERS_BUDGET", (s) => { byId(s, "C1").freshness_budget_ms = 22500; }],
  ["a wrong active budget", "READ_CLUSTERS_BUDGET", (s) => { byId(s, "C2").active_freshness_budget_ms = 6000; }],
  ["a duplicate cluster id", "READ_CLUSTERS_DUPLICATE_ID", (s) => { byId(s, "S3").cluster_id = "S2"; }],
  ["an isolated read holding non-credential registers", "READ_CLUSTERS_ISOLATED_NON_CREDENTIAL", (s) => {
    s.clusters = s.clusters.filter((c) => c.cluster_id !== "S1");
    s.isolated_reads.push({ read_id: "Q", start: "0x1400", register_count: 20, reason: "test", trigger: "on_demand" });
  }],
  ["sequence_after naming a cluster of another role", "READ_CLUSTERS_SEQUENCE", (s) => { byId(s, "A2").sequence_after = "C1"; }],
  ["an active cadence on a telemetry cluster", "READ_CLUSTERS_ACTIVE_ROLE", (s) => { byId(s, "A1").active_cadence_ms = 500; byId(s, "A1").active_freshness_budget_ms = 1000; }],
  ["an unknown property (schema)", "READ_CLUSTERS_SCHEMA", (s) => { byId(s, "A1").poll_hint = 1; }],
  ["an odd start address", "READ_CLUSTERS_ODD_START", (s) => { byId(s, "S2").start = "0x14B3"; }],
];
for (const [name, code, mutate] of negatives) {
  const root = sandbox(mutate);
  const before = read("protocol/generated/read_clusters.json", root);
  const r = run([], root);
  const after = read("protocol/generated/read_clusters.json", root);
  check(`rejects ${name} (${code}) and writes nothing`, r.status !== 0 && r.stderr.includes(code) && before === after,
    r.status === 0 ? "accepted" : (r.stderr.split("\n")[0] || "").slice(0, 120));
  fs.rmSync(root, { recursive: true, force: true });
}
{
  const root = sandbox(null);
  fs.appendFileSync(path.join(root, "protocol/generated/read_clusters_table.h"), "// hand edit\n");
  const r = run(["--check"], root);
  check("--check reports a hand-edited generated header as drift", r.status !== 0 && r.stdout.includes("DRIFT  protocol/generated/read_clusters_table.h"));
  const regen = run([], root);
  const again = run(["--check"], root);
  check("regeneration is deterministic (regenerate, then --check is clean)", regen.status === 0 && again.status === 0 &&
    read("protocol/generated/read_clusters.json", root) === read("protocol/generated/read_clusters.json"));
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\nread clusters: ${checks - failures}/${checks} passed`);
process.exit(failures ? 1 : 0);
