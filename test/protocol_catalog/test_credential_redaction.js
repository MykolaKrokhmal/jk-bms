#!/usr/bin/env node
"use strict";

// Credential redaction regression (security remediation, 2026-09-25).
// Earlier firmware published the decoded 0x1470 setup passcode on a public
// text_sensor (setup_passcode_readback), reaching Home Assistant, the browser
// SSE stream, Settings and Diagnostics. This test proves, with an ARTIFICIAL
// sentinel only, that no externally observable channel carries a credential
// value any more. Failure output names the leaking CHANNEL, never the value.
//
// Rendered Settings/Diagnostics rows are covered with the real DOM harnesses
// in test_settings_catalog.js and test_diagnostic_software_variables_scroll.js;
// evidence captures are covered by test_secret_scan.js.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const SENTINEL = "ARTIFICIAL-SENTINEL-PASSCODE-0000";

let checks = 0;
let failures = 0;
function check(name, condition, channel = "") {
  checks += 1;
  if (!condition) failures += 1;
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${!condition && channel ? ` -- leaking/failed channel: ${channel}` : ""}`);
}

const canonicalFields = JSON.parse(read("protocol/registers.canonical.json")).registers.flatMap((r) => r.fields);
const credentialFields = canonicalFields.filter((f) => f.write_safety_class === "credential");
const retired = credentialFields.flatMap((f) => (f.retired_secret_read_entities || []).map((e) => ({ key: f.key, ...e })));
check("canonical model has credential fields and at least one retired secret publisher", credentialFields.length > 0 && retired.length > 0);

// ---------------------------------------------------------------------------
// A. Generated firmware artifacts: credential bytes are never decoded/published
// ---------------------------------------------------------------------------
const readPlan = JSON.parse(read("protocol/generated/read_plan.json"));
const planFields = readPlan.blocks.flatMap((b) => b.fields);
const readPlanYaml = read("protocol/generated/read_plan.yaml");
for (const f of credentialFields) {
  const pf = planFields.find((x) => x.key === f.key);
  check(`${f.key}: read plan marks it credential_status_only on its canonical read entity (no override)`,
    !!pf && pf.credential_status_only === true && pf.entity_id === f.esphome_read_entity_id && pf.domain === f.esphome_read_domain,
    "read_plan.json");
  const publishLines = readPlanYaml.split("\n").filter((l) => l.includes(`id(${f.esphome_read_entity_id})->publish_state`));
  check(`${f.key}: its read entity only ever publishes the constant status marker`,
    publishLines.length > 0 && publishLines.every((l) => /publish_state\(std::string\("hidden"\)\)/.test(l) && !/decode_ascii|decode_hex_string|buf/.test(l)),
    "read_plan.yaml publisher");
}
const generatedText = ["protocol/generated/read_plan.yaml", "protocol/generated/read_plan_decode.h", "protocol/generated/write_registry.yaml",
  "protocol/generated/read_plan.json"].map(read).join("\n");
for (const e of retired) {
  check(`retired secret publisher ${e.entity_id} no longer exists in any generated firmware artifact`, !generatedText.includes(e.entity_id), "generated firmware");
}
const routes = JSON.parse(read("protocol/generated/protocol_entity_routes.json"));
check("no browser route points at a retired secret publisher", !routes.routes.some((r) => retired.some((e) => e.entity_id === r.entityId)), "routes");

// Write side unchanged: the masked `text` entity stays internal, always
// publishes asterisks, and its set_action stays fail-closed.
const yaml = read("batterylifepo4.yaml");
const textBlock = yaml.slice(yaml.indexOf("    id: setup_passcode\n"), yaml.indexOf("text_sensor:", yaml.indexOf("    id: setup_passcode\n")));
check("write-side setup_passcode text entity stays internal, masked and fail-closed",
  /internal: true/.test(textBlock) && /mode: password/.test(textBlock) && /return std::string\("\*+"\)/.test(textBlock) && /Passcode write rejected/.test(textBlock),
  "batterylifepo4.yaml text entity");
// Passcode transaction path publishes only numeric status codes and logs no word values.
const txStart = yaml.indexOf("Setup passcode transaction");
const txLines = yaml.slice(txStart, yaml.indexOf("platform: template", yaml.indexOf("setup_passcode_tx_status_code", txStart))).split("\n");
const passcodeLogs = txLines.filter((l) => /ESP_LOG\w\("jk_passcode"/.test(l));
check("passcode transaction logs never format readback/expected words", passcodeLogs.every((l) => !/g_passcode_(readback|expected)_words/.test(l)), "firmware log");
check("passcode transaction publishes only numeric status codes",
  yaml.split("\n").filter((l) => l.includes("setup_passcode_tx_status_code)->publish_state"))
    .every((l) => /publish_state\(((?:matches \? )?\d+\.\d+f(?: : \d+\.\d+f)?)\)/.test(l) && !/std::string|g_passcode/.test(l)), "tx status");

// Mock backend never publishes a credential value or retired secret entity.
const mock = read("demo/mock-server.js");
check("mock backend publishes no retired secret publisher and no credential readback",
  retired.every((e) => !mock.includes(e.entity_id)) && !/setup_passcode_status"\s*,\s*"(?!hidden)/.test(mock), "mock-server");

// ---------------------------------------------------------------------------
// B. Browser: real ingestPayload with the artificial sentinel
// ---------------------------------------------------------------------------
function loadClosures() {
  const window = {
    __JK_BMS_TEST_HOOKS__: {}, location: { href: "http://jk-bms.local/" }, addEventListener() {}, matchMedia() { return { matches: false }; },
    requestAnimationFrame() { return 0; }, cancelAnimationFrame() {}, setInterval() { return 0; }, clearInterval() {}, setTimeout() { return 0; }, clearTimeout() {},
  };
  const document = {
    readyState: "complete", addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll() { return []; },
    scrollingElement: { scrollTop: 0 }, createElement() { return { getContext() { return { measureText() { return { width: 0 }; } }; } }; },
  };
  const sandbox = { window, document, navigator: { language: "en" }, URL, console, Map, HTMLInputElement: class {} };
  vm.createContext(sandbox);
  vm.runInContext(read("jk_bms.js"), sandbox, { filename: "jk_bms.js" });
  return window.__JK_BMS_TEST_HOOKS__;
}
const h = loadClosures();
const contains = (obj) => JSON.stringify(obj, (k, v) => (v instanceof Map ? [...v.entries()] : typeof v === "symbol" ? String(v) : v)).includes(SENTINEL);

const retiredWireIds = [...h.entityByWireId.entries()].filter(([, v]) => v === h.RETIRED_SECRET_SUPPRESSED).map(([w]) => w);
check(`retired secret publisher wire forms are registered for suppression (${retiredWireIds.length})`, retiredWireIds.length >= 7);
for (const wireId of retiredWireIds) {
  h.ingestPayload({ id: wireId, domain: "text_sensor", value: SENTINEL, state: SENTINEL });
}
check("a retired publisher's payload (every wire form) never reaches browser state", !contains(h.state), "browser state");
check("a retired publisher's payload never reaches the diagnostic readouts", !contains(h.diagnosticReadouts), "diagnostics");

for (const f of credentialFields) {
  const statusWire = `${f.esphome_read_domain}/${f.esphome_configured_name}`;
  check(`${f.key}: its status entity routes to the credential key`, h.entityByWireId.get(statusWire) === f.key, "routing");
  // A misbehaving (or old) firmware sending a secret on the routed entity.
  h.ingestPayload({ id: statusWire, domain: f.esphome_read_domain, value: SENTINEL, state: SENTINEL });
  check(`${f.key}: a secret sent on its routed entity is masked before state`, h.state[f.key] && h.state[f.key].state === "hidden" && !contains(h.state), "browser state");
  check(`${f.key}: and before diagnostics`, !contains(h.diagnosticReadouts), "diagnostics");
  const entry = [...h.diagnosticReadouts.values()].find((e) => e.key === f.key);
  const shown = entry ? h.diagnosticReadoutValue(entry) : "";
  check(`${f.key}: the diagnostic value text is the localized hidden marker`, !!entry && !shown.includes(SENTINEL) && /hidden/i.test(shown), "diagnostic value");
  check(`${f.key}: no write surface (not in the write registry, no set_ route, Settings row blocked)`,
    !["live", "authorizationRequired"].some((g) => (h.WRITE_REGISTRY[g] || []).some((e) => e.key === f.key)) &&
    ![...h.entityByWireId.values()].includes(`set_${f.key}`) &&
    h.SETTINGS_CATALOG_ROWS.some((r) => r.canonicalKey === f.key && r.readWriteState === "blocked"), "write surface");
}
check("credential keys known to the browser equal the canonical credential fields",
  [...h.CREDENTIAL_KEYS].sort().join(",") === credentialFields.map((f) => f.key).sort().join(","), "CREDENTIAL_KEYS");

console.log(`\ncredential redaction: ${checks - failures}/${checks} passed`);
process.exit(failures ? 1 : 0);
