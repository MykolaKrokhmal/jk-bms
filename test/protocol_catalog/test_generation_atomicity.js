#!/usr/bin/env node
"use strict";

// Exercises publication only in an isolated temporary tree. The real source
// tree is never mutated by this test.
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const SOURCE_ROOT = path.join(__dirname, "..", "..");
const GENERATOR = path.join(SOURCE_ROOT, "tools", "protocol", "generate.js");
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "jk-bms-generator-test-"));
let checks = 0;
let failures = 0;

function check(name, condition, detail = "") {
  checks += 1;
  if (condition) console.log(`PASS  ${name}${detail ? `  -- ${detail}` : ""}`);
  else { failures += 1; console.log(`FAIL  ${name}${detail ? `  -- ${detail}` : ""}`); }
}

function copy(relative) {
  const src = path.join(SOURCE_ROOT, relative);
  const dst = path.join(sandbox, relative);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

function run(args = [], env = {}) {
  return spawnSync(process.execPath, [GENERATOR, "--root", sandbox, ...args], {
    cwd: SOURCE_ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

function digest(relative) {
  const p = path.join(sandbox, relative);
  return fs.existsSync(p) ? crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex") : null;
}

const TARGETS = [
  "register_catalog.json",
  "protocol/generated/coverage_report.md",
  "jk_bms.js",
  "protocol/generated/.generation-manifest.json",
];

try {
  [
    "protocol/registers.canonical.json",
    "protocol/non_register_entities.canonical.json",
    "protocol/schema/register-source.schema.json",
    "protocol/schema/non-register-source.schema.json",
    "protocol/evidence/sources.json",
    "protocol/evidence/workbook_index.json",
    "protocol/evidence/upstream_index.json",
    "protocol/evidence/upstream_esp32-jk-pb-modbus-example.yaml",
    "batterylifepo4.yaml",
    "HARDWARE_AUDIT_2026-09-09.md",
    "toolchain.lock.json",
    "demo/mock-server.js",
    "jk_bms.js",
  ].forEach(copy);
  fs.mkdirSync(path.join(sandbox, "protocol", "generated"), { recursive: true });

  let result = run();
  check("isolated initial generation succeeds", result.status === 0, (result.stderr + result.stdout).trim());
  const baseline = Object.fromEntries(TARGETS.map((p) => [p, digest(p)]));

  result = run();
  check("second generation succeeds", result.status === 0, (result.stderr + result.stdout).trim());
  check("two generations are byte-identical", TARGETS.every((p) => digest(p) === baseline[p]));
  check("--check accepts the completed generation", run(["--check"]).status === 0);

  for (let i = 0; i < TARGETS.length; i += 1) {
    for (const side of ["before", "after"]) {
      result = run([], { PROTOCOL_GENERATOR_FAIL_AT: `${side}:${i}` });
      check(`fault ${side}:${i} exits non-zero with rollback diagnostic`,
        result.status !== 0 && result.stderr.includes("GENERATOR_PUBLISH_ROLLBACK"));
      check(`fault ${side}:${i} restores every prior artifact`,
        TARGETS.every((p) => digest(p) === baseline[p]));
      const debris = fs.readdirSync(path.join(sandbox, "protocol", "generated"))
        .filter((n) => n.includes(".tmp-") || n.includes(".bak-") || n === ".generation.lock");
      check(`fault ${side}:${i} leaves no lock/tmp/backup debris`, debris.length === 0, debris.join(","));
    }
  }

  const lock = path.join(sandbox, "protocol", "generated", ".generation.lock");
  fs.writeFileSync(lock, "synthetic-holder\n");
  result = run();
  check("concurrent publisher is rejected with stable code", result.status === 2 && result.stderr.includes("GENERATOR_LOCKED"));
  check("lock rejection leaves generation unchanged", TARGETS.every((p) => digest(p) === baseline[p]));
  fs.unlinkSync(lock);

  const manifest = path.join(sandbox, "protocol", "generated", ".generation-manifest.json");
  const originalManifest = fs.readFileSync(manifest, "utf8");
  const parsed = JSON.parse(originalManifest);
  parsed.catalog_version = "corrupted";
  fs.writeFileSync(manifest, JSON.stringify(parsed, null, 2) + "\n");
  result = run(["--check"]);
  check("full manifest corruption is detected", result.status !== 0 && result.stdout.includes("manifest"));
  fs.writeFileSync(manifest, originalManifest);
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}

console.log(`\n${checks} checks run, ${failures} failed.`);
process.exit(failures ? 1 : 0);
