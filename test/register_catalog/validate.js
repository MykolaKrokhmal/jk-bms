#!/usr/bin/env node
/*
 * Register catalog coverage validator (spec section 6): checks that
 * register_catalog.json, batterylifepo4.yaml, jk_bms.js and
 * demo/mock-server.js all agree on every RW register this project
 * exposes — a register present in one layer but missing (or disagreeing
 * on its address) in another is a real, silent bug waiting to happen
 * (a UI control that writes to nothing a real firmware build actually
 * has, or a firmware register the UI can never reach).
 *
 * This is intentionally a set of pragmatic string/regex cross-checks
 * against the real source files, not a full YAML/JS parser — proportionate
 * to what a catalog coverage gate needs to catch (an entry present in one
 * file and silently absent from another), not a general-purpose linter.
 *
 * Run:
 *   node test/register_catalog/validate.js
 *
 * Exit code 0 = every check passed. Non-zero = at least one failed.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const catalog = require(path.join(ROOT, "register_catalog.json"));
const yamlSrc = fs.readFileSync(path.join(ROOT, "batterylifepo4.yaml"), "utf8");
const jsSrc = fs.readFileSync(path.join(ROOT, "jk_bms.js"), "utf8");
const mockSrc = fs.readFileSync(path.join(ROOT, "demo", "mock-server.js"), "utf8");

let failures = 0;
let checks = 0;
function check(name, cond, detail) {
  checks += 1;
  if (!cond) {
    failures += 1;
    console.log(`FAIL  ${name}${detail ? "  -- " + detail : ""}`);
  } else {
    console.log(`PASS  ${name}${detail ? "  -- " + detail : ""}`);
  }
}

// Pulls jk_bms.js's own GENERIC_TX_ADDRESS map out with a regex over
// its `key: 0xNNNN` entries, deliberately NOT eval()/Function()'d — the
// object literal is plain data (identifier keys, hex-literal values, no
// expressions), so a targeted regex is both safe and sufficient; no
// general JS expression evaluation is needed or wanted here.
function extractGenericTxAddress(src) {
  const marker = "const GENERIC_TX_ADDRESS = Object.freeze({";
  const start = src.indexOf(marker);
  if (start === -1) throw new Error("GENERIC_TX_ADDRESS not found in jk_bms.js");
  const braceStart = src.indexOf("{", start);
  let depth = 0;
  let end = -1;
  for (let i = braceStart; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") { depth -= 1; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) throw new Error("Unterminated GENERIC_TX_ADDRESS object literal");
  const literal = src.slice(braceStart + 1, end);
  const result = {};
  const entryPattern = /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(0x[0-9A-Fa-f]+)/g;
  let m;
  while ((m = entryPattern.exec(literal)) !== null) {
    result[m[1]] = parseInt(m[2], 16);
  }
  return result;
}

const genericTxAddress = extractGenericTxAddress(jsSrc);

const registers = catalog.registers;
check("register_catalog.json parses and has at least one entry", Array.isArray(registers) && registers.length > 0,
  `${Array.isArray(registers) ? registers.length : "n/a"} entries`);

const seenKeys = new Set();
for (const reg of registers) {
  check(`catalog: "${reg.key}" has a unique key`, !seenKeys.has(reg.key), reg.key);
  seenKeys.add(reg.key);

  if (reg.address === null) continue; // device_name_override — deliberately no BMS register

  const addrNum = parseInt(reg.address, 16);
  check(`catalog: "${reg.key}" address ${reg.address} is a valid hex literal`, Number.isFinite(addrNum), reg.address);

  // 1. The literal hex address must actually appear in batterylifepo4.yaml
  //    (catches a catalog entry describing a register the firmware never
  //    references at all).
  const inYaml = yamlSrc.includes(reg.address);
  check(`yaml: "${reg.key}" address ${reg.address} appears in batterylifepo4.yaml`, inYaml, reg.address);

  if (reg.manager === "generic") {
    // 2. jk_bms.js's GENERIC_TX_ADDRESS must know this key, with the SAME
    //    address — catches the UI silently drifting from the catalog
    //    (or the catalog drifting from what the UI actually watches).
    const jsAddr = genericTxAddress[reg.key];
    check(`jk_bms.js: GENERIC_TX_ADDRESS["${reg.key}"] exists`, jsAddr !== undefined, reg.key);
    if (jsAddr !== undefined) {
      check(`jk_bms.js: GENERIC_TX_ADDRESS["${reg.key}"] === ${reg.address}`, jsAddr === addrNum,
        `catalog=${addrNum} (${reg.address}) js=${jsAddr} (0x${jsAddr.toString(16)})`);
    }

    // 3. mock-server.js's REGISTER_BY_KEY (built directly from this same
    //    catalog file at require-time) must resolve this key too — this
    //    mostly guards against a future refactor of the mock silently
    //    stopping consuming the catalog, since today it's derived
    //    directly from it.
    const mockUsesCatalog = mockSrc.includes("REGISTER_CATALOG") && mockSrc.includes('reg.manager === "generic"');
    check(`demo/mock-server.js: derives its generic-register map from register_catalog.json`, mockUsesCatalog);
  }

  // 4. Every RW register must have SOME UI surface in jk_bms.js: either a
  //    SETTING_DEFS/CONTROL_DEFS/registerEntity number-or-select
  //    reference, or (for the two bespoke-managed registers) its own
  //    dedicated, named handling.
  if (reg.access === "rw") {
    // A plain substring match is deliberate here: the passcode's own key
    // only appears embedded in its endpoint string ("/text/setup_passcode/set"),
    // not as its own quoted literal — this check exists to catch a key
    // with NO reference anywhere, not to enforce one particular syntactic form.
    const hasUiSurface = jsSrc.includes(reg.key);
    check(`jk_bms.js: "${reg.key}" has SOME UI reference (SETTING_DEFS/CONTROL_DEFS/registerEntity/bespoke)`, hasUiSurface);
  }
}

// 5. The reverse direction: every key jk_bms.js's GENERIC_TX_ADDRESS
//    lists must be a catalog entry with manager "generic" — catches a
//    key added to the frontend map that was never added to the catalog.
for (const key of Object.keys(genericTxAddress)) {
  const reg = registers.find((r) => r.key === key);
  check(`catalog: jk_bms.js's GENERIC_TX_ADDRESS["${key}"] has a matching catalog entry`, Boolean(reg), key);
  if (reg) {
    check(`catalog: "${key}"'s catalog manager is "generic" (matches its presence in GENERIC_TX_ADDRESS)`,
      reg.manager === "generic", `manager=${reg.manager}`);
  }
}

// 6. packed_with references must be symmetric and point at a real entry.
for (const reg of registers) {
  if (!reg.packed_with) continue;
  const partner = registers.find((r) => r.key === reg.packed_with);
  check(`catalog: "${reg.key}".packed_with -> "${reg.packed_with}" exists`, Boolean(partner));
  if (partner) {
    check(`catalog: "${reg.key}" and "${reg.packed_with}" share the same address (packed sub-fields of one register)`,
      partner.address === reg.address, `${reg.address} vs ${partner.address}`);
  }
}

console.log(`\n${checks} checks run, ${failures} failed.`);
process.exit(failures ? 1 : 0);
