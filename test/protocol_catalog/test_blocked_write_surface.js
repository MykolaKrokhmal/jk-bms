#!/usr/bin/env node
"use strict";

// Exhaustive fail-closed/write-surface proof. Every catalog field declared
// RW but not effectively RW (no owner_write_override) must be unreachable
// from the public UI, rejected by the demo backend, and unable to mutate the
// simulator state. Every field that IS effective RW must carry a
// well-formed owner_write_override (2026-09-10 owner-authorized write
// re-enablement — see docs/adr/0001-protocol-catalog.md's addendum) and a
// real, exercised write path end to end (frontend allowlist -> ESPHome
// entity -> demo backend).

const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const PORT = Number(process.env.TEST_PORT) || 19001;
const HOST = "127.0.0.1";
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "register_catalog.json"), "utf8"));
const canonical = JSON.parse(fs.readFileSync(path.join(ROOT, "protocol", "registers.canonical.json"), "utf8"));
const js = fs.readFileSync(path.join(ROOT, "jk_bms.js"), "utf8");
const yaml = fs.readFileSync(path.join(ROOT, "batterylifepo4.yaml"), "utf8");

let checks = 0;
let failures = 0;
function check(name, pass, detail = "") {
  checks += 1;
  if (!pass) failures += 1;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` -- ${detail}` : ""}`);
}

function request(method, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: HOST, port: PORT, method, path: pathname }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

async function waitForServer(child) {
  for (let i = 0; i < 80; i += 1) {
    if (child.exitCode !== null) throw new Error(`mock server exited early (${child.exitCode})`);
    try {
      const response = await request("GET", "/demo/state");
      if (response.status === 200) return;
    } catch (_) { /* startup race */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("mock server did not become ready");
}

function endpointFor(field) {
  if (["charging", "discharging", "balancing"].includes(field.key)) {
    return `/select/${field.key}/set?option=Off`;
  }
  if (field.key === "setup_passcode") return "/text/setup_passcode/set?value=blocked-test";
  return `/number/set_${field.key}/set?value=1`;
}

function yamlItemForId(id) {
  const lines = yaml.split(/\r?\n/);
  const at = lines.findIndex((line) => new RegExp(`^\\s+id:\\s*${id}\\s*$`).test(line));
  if (at < 0) return null;
  let start = at;
  while (start >= 0 && !/^  - platform:/.test(lines[start])) start -= 1;
  let end = at + 1;
  while (end < lines.length && !/^  - platform:/.test(lines[end]) && !/^[a-z_]+:\s*$/.test(lines[end])) end += 1;
  return lines.slice(Math.max(0, start), end).join("\n");
}

async function main() {
  const canonicalFields = canonical.registers.flatMap((register) => register.fields);
  const blockedCatalog = catalog.registers.filter((field) => field.access === "rw" && field.effective_access !== "rw");
  const blockedCanonical = canonicalFields.filter((field) => field.access === "rw" && field.effective_access !== "rw");
  // As of the second critical audit (2026-09-10) this is 27: every
  // disruptive/topology/credential/unresolved-dynamic/packed field was
  // reverted to fail-closed — an owner_write_override is risk acceptance,
  // not protocol verification, and several of the unlocked fields shared
  // a Modbus register with another field (a packed-sibling correlation
  // hazard the generic manager cannot yet disambiguate). 19 fields
  // (write_safety_class "normal", non-packed, fully dependency-resolved)
  // remain unlocked. The equality check is a real regression guard either
  // way: catalog and canonical must always agree on the blocked set.
  check("catalog and canonical agree on the exhaustive blocked-RW count",
    blockedCatalog.length === blockedCanonical.length,
    `catalog=${blockedCatalog.length} canonical=${blockedCanonical.length}`);

  // Owner-authorized write re-enablement (2026-09-10): every field with
  // effective_access "rw" must carry an explicit, well-formed
  // owner_write_override (repo-owner risk acceptance — see
  // docs/adr/0001-protocol-catalog.md's addendum) — this is the one and
  // only avenue that may ever flip a field out of the blocked set, so
  // its presence is exhaustively required, never just permitted.
  const unlockedCanonical = canonicalFields.filter((field) => field.access === "rw" && field.effective_access === "rw");
  check("every effective-RW field carries a well-formed owner_write_override",
    unlockedCanonical.length > 0 && unlockedCanonical.every((f) =>
      f.owner_write_override && f.owner_write_override.authorized === true &&
      f.owner_write_override.authorized_by && f.owner_write_override.date && f.owner_write_override.rationale),
    `unlocked=${unlockedCanonical.length}`);
  check("no field carries an owner_write_override without effective_access rw",
    !canonicalFields.some((f) => f.owner_write_override && f.effective_access !== "rw"));

  const unlockedKeys = new Set(unlockedCanonical.map((f) => f.key));

  // Third critical audit (2026-09-10, item 8): while setup_passcode
  // (credential class) stays fail-closed, NO editor or write endpoint for
  // it may exist in the UI at all — the second pass's own dedicated
  // password field is removed again. This is the strongest form of
  // "blocked": a rejected write is not enough on its own, since the
  // passcode's readback is always masked and any success can never be
  // independently verified, so the input control itself must not exist.
  check("frontend has no setup-passcode editor (id or write endpoint reference)",
    !/id=["']setupPasscodeInput["']/.test(js) && !/id=["']setupPasscodeSaveBtn["']/.test(js) &&
    !/text\/setup_passcode\/set/.test(js));

  // SETTING_DEFS/CONTROL_DEFS (hand-maintained allowlists in jk_bms.js)
  // must cover EXACTLY the unlocked key set — not a subset (a silently
  // missing entry would leave a genuinely-authorized field stuck
  // read-only) and not a superset (stale metadata could not otherwise
  // turn a still-blocked field into a live editor, since
  // writableDefinitionForEntry only ever consults these two tables).
  // Final-preparation-plan Stage 1, commit boundary 1: SETTING_DEFS is now
  // built as `SETTING_KEYS.map(settingDef)` rather than 18 literal
  // `settingDef("key", "endpoint")` call sites, so the previous regex
  // (which matched that literal call shape) would now silently match
  // nothing — parse the SETTING_KEYS array itself instead, which still
  // exists specifically so this exact-coverage check keeps working.
  const settingDefsMatch = (() => {
    const m = js.match(/const SETTING_KEYS = Object\.freeze\(\[([\s\S]*?)\n {2}\]\);/);
    if (!m) throw new Error("SETTING_KEYS array not found in jk_bms.js in the expected shape");
    return [...m[1].matchAll(/"([a-z0-9_]+)"/g)].map((k) => k[1]);
  })();
  // Third critical audit (2026-09-10): the previous version of this regex
  // required a "\n  });" closer, which an EMPTY `Object.freeze({});` (all
  // on one line, as CONTROL_DEFS now is with balancing reverted too)
  // never contains — the non-greedy `[\s\S]*?` then kept matching forward
  // past the empty object entirely and captured everything up to the
  // NEXT "\n  });" anywhere later in the file (PROTOCOL_CATALOG's own
  // closer), silently pulling in genericTxAddress/blockedWriteKeys' keys
  // as false "frontend" entries. Check the empty form FIRST and
  // explicitly short-circuit it before ever trying the multi-line capture.
  const controlDefsKeys = /const CONTROL_DEFS = Object\.freeze\(\{\}\);/.test(js)
    ? []
    : (() => {
        const m = js.match(/const CONTROL_DEFS = Object\.freeze\(\{([\s\S]*?)\n {2}\}\);/);
        return m ? [...m[1].matchAll(/^\s*([a-z0-9_]+):/gm)].map((k) => k[1]) : [];
      })();
  const frontendKeys = new Set([...settingDefsMatch, ...controlDefsKeys]);
  // setup_passcode is deliberately excluded from both tables: it is
  // unverifiable-by-nature (readback is always masked) and gets its own
  // dedicated password-form UI in the app-settings modal, not a generic
  // register-list row — checked separately above.
  const expectedFrontendKeys = new Set([...unlockedKeys].filter((k) => k !== "setup_passcode"));
  check("jk_bms.js SETTING_DEFS/CONTROL_DEFS exactly cover the unlocked key set (excluding the bespoke setup_passcode UI)",
    frontendKeys.size === expectedFrontendKeys.size && [...expectedFrontendKeys].every((k) => frontendKeys.has(k)),
    `expected=${[...expectedFrontendKeys].sort().join(",")} frontend=${[...frontendKeys].sort().join(",")}`);

  check("frontend register renderer is data-driven from SETTING_DEFS/CONTROL_DEFS, not hardcoded",
    /function writableDefinitionForEntry\([\s\S]*?CONTROL_DEFS\[objectId\][\s\S]*?SETTING_DEFS\.find/.test(js));

  // P1-04 follow-up (2026-09-10): NON_REGISTER_ENTITY_IDS (used to hide
  // computed/presentation entities from the Settings register list, and to
  // populate them into Diagnostics instead) must be derived from
  // PROTOCOL_CATALOG.nonRegisterKeys, not a second, independently
  // hand-maintained array — a real, hardware-observed defect
  // (HARDWARE_AUDIT_2026-09-09.md) traced to exactly that: the hand list
  // had drifted to using stale/wrong logical keys ("bms_display_name"
  // instead of "device_name", "charge_status_time_elapsed" instead of
  // "charge_status_time", "battery_state_elapsed" instead of
  // "battery_state_time", etc.) that diagnosticObjectId() never actually
  // returns, so those entities silently leaked into the register list.
  check("NON_REGISTER_ENTITY_IDS is derived from PROTOCOL_CATALOG.nonRegisterKeys, not a second hand-maintained array",
    /const NON_REGISTER_ENTITY_IDS = new Set\(PROTOCOL_CATALOG\.nonRegisterKeys\)/.test(js));

  const nonRegisterKeysMatch = js.match(/nonRegisterKeys: Object\.freeze\(\[([\s\S]*?)\]\)/);
  const nonRegisterKeys = nonRegisterKeysMatch
    ? [...nonRegisterKeysMatch[1].matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1])
    : [];
  // The exact keys previously silently excluded by the OLD list's wrong
  // names (see above) — proves the fix actually closes the real leak,
  // not just that some derivation exists.
  for (const key of ["charge_status_time", "charge_phase_time", "battery_state_time",
    "device_name", "battery_state_direction", "battery_state_candidate_samples"]) {
    check(`PROTOCOL_CATALOG.nonRegisterKeys (now the live filter's own source) includes "${key}" (previously silently leaked under a wrong hand-list name)`,
      nonRegisterKeys.includes(key));
  }

  // Third critical audit (2026-09-10): NO control select remains
  // owner-authorized any more — "balancing" was reclassified "disruptive"
  // (registers.canonical.json had wrongly said "normal", contradicting
  // batterylifepo4.yaml's own comment that always declared
  // charging/discharging/balancing all "disruptive" together) and
  // reverted alongside charging/discharging.
  //
  // Second critical audit (2026-09-10): every one of these is reverted to
  // fail-closed — none may queue a Modbus command any more, regardless of
  // what their canonical owner_write_override said before the revert.
  // Same check shape as the original Stage-1 stub proof (queue_command
  // absent from the entity's own executable body).
  for (const id of [
    "set_cell_uvp", "set_cell_ovp", "set_system_power_off", "set_continued_charge_current",
    "set_charge_ocp_delay", "set_continued_discharge_current", "set_discharge_ocp_delay",
    "set_charge_otp", "set_discharge_otp", "set_charge_utp", "set_mos_otp", "set_cell_count",
    "select_charging", "select_discharging", "select_balancing", "set_scp_delay",
    "set_heating_activation_temperature", "set_heating_deactivation_temperature", "setup_passcode",
    "set_lcd_buzzer_trigger", "set_dry_contact_1_trigger_source", "set_dry_contact_2_trigger_source",
    "set_dry_contact_1_trigger_value", "set_dry_contact_1_recovery_value",
    "set_dry_contact_2_trigger_value", "set_dry_contact_2_recovery_value",
    "set_rcv_time", "set_rfv_time",
  ]) {
    const item = yamlItemForId(id);
    const executable = item ? item.split(/\r?\n/).filter((line) => !/^\s*#/.test(line)).join("\n") : "";
    check(`${id}'s set_action is reverted to fail-closed (no Modbus command queued)`,
      Boolean(item && !/queue_command\s*\(/.test(executable) && !/script\.execute:/.test(executable)));
  }

  const child = spawn(process.execPath, [path.join(ROOT, "demo", "mock-server.js")], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), HOST },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let childOutput = "";
  child.stdout.on("data", (chunk) => { childOutput += chunk; });
  child.stderr.on("data", (chunk) => { childOutput += chunk; });

  try {
    await waitForServer(child);
    const before = await request("GET", "/demo/state");
    for (const field of blockedCanonical) {
      const response = await request("POST", endpointFor(field));
      check(`mock rejects blocked field ${field.key}`, response.status === 409,
        `status=${response.status} endpoint=${endpointFor(field)}`);
      check(`mock rejection identifies ${field.key}`, response.body.includes(field.key), response.body.slice(0, 120));
    }
    const after = await request("GET", "/demo/state");
    check("blocked-write matrix leaves the complete simulator control state unchanged",
      before.body === after.body,
      before.body === after.body ? "" : "state snapshot differs");
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once("exit", resolve);
      setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 2000).unref();
    });
  }

  console.log(`\nBlocked-write surface summary: ${checks - failures}/${checks} passed`);
  if (childOutput && failures) console.log(childOutput.trim());
  process.exitCode = failures ? 1 : 0;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
