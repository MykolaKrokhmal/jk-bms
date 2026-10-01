"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
let failures = 0;

function check(name, condition, detail = "") {
  if (condition) {
    console.log(`PASS  ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

const toolchain = JSON.parse(fs.readFileSync(path.join(ROOT, "toolchain.lock.json"), "utf8"));
const canonical = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol/registers.canonical.json"), "utf8"));
const sources = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol/evidence/sources.json"), "utf8"));
const yaml = fs.readFileSync(path.join(ROOT, "batterylifepo4.yaml"), "utf8");
const upstream = sources.sources.find((source) => source.source_id === "upstream_syssi_esphome_jk_bms");

check("toolchain models syssi as an upstream reference, not an external component",
  toolchain.upstream_reference && !Object.prototype.hasOwnProperty.call(toolchain, "external_component"));
check("canonical version context names the upstream reference pin",
  typeof canonical.version_context.upstream_reference_pin === "string" &&
  !Object.prototype.hasOwnProperty.call(canonical.version_context, "external_component_pin"));
check("production YAML carries no unused syssi runtime-source substitution",
  !/^\s*external_components_source:/m.test(yaml));
check("the evidence manifest explicitly marks the syssi snapshot as non-runtime provenance",
  upstream && upstream.runtime_dependency === false && upstream.relationship === "upstream_reference");
check("toolchain, canonical and evidence manifest resolve to one immutable syssi revision",
  upstream && toolchain.upstream_reference &&
  canonical.version_context.upstream_reference_pin ===
    `github://${toolchain.upstream_reference.repository}@${toolchain.upstream_reference.revision}` &&
  upstream.commit_sha === toolchain.upstream_reference.revision &&
  upstream.local_copy_sha256 === toolchain.upstream_reference.source_snapshot_sha256);
check("the upstream-derived production YAML is declared in provenance metadata",
  upstream && Array.isArray(upstream.derived_files) && upstream.derived_files.includes("batterylifepo4.yaml"));

const licensePath = upstream && path.join(ROOT, upstream.license_file || "");
const noticePath = upstream && path.join(ROOT, upstream.notice_file || "");
check("the recorded Apache-2.0 license copy exists",
  Boolean(upstream && upstream.license === "Apache-2.0" && upstream.license_file && fs.existsSync(licensePath)));
check("the recorded third-party notice exists",
  Boolean(upstream && upstream.notice_file && fs.existsSync(noticePath)));

if (failures) process.exit(1);
