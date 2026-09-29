#!/usr/bin/env node
"use strict";

// Regression test for the numeric register-editor input's HTML `pattern=`
// attribute (Stage 1 hardware acceptance corrective pass). A real device
// session found WebKit/Safari logging "Pattern attribute value
// '[0-9.,+-]*' is not a valid regular expression" at high frequency
// (jk_bms.js's own ingestPayload/renderDiagnosticPanels re-render path).
// Root cause, confirmed directly in this Node version: a bare, unescaped
// trailing "-" inside a character class is valid under the plain and "u"
// (unicode) regex flags, but invalid under the newer, stricter "v"
// (unicodeSets) flag some browsers now compile pattern= attributes with —
// `new RegExp("[0-9.,+-]*", "v")` throws.
//
// This guards two things: (1) the pattern jk_bms.js actually ships is valid
// under BOTH the legacy "u" flag and the newer "v" flag (so it can never
// silently regress back to the browser-rejected form), and (2) fixing the
// syntax did not change which characters the pattern accepts or rejects —
// backend/real validation (submitRegisterSetting()'s comma→dot
// normalization + numeric range/step check) is separate and untouched.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const source = fs.readFileSync(path.join(ROOT, "jk_bms.js"), "utf8");

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

// Unified write contract (clustered-read plan M5, owner decision
// 2026-09-29): the legacy register-list numeric editor that carried this
// pattern (and its submitRegisterSetting() validation) was removed with the
// legacy Settings write path. What this file still guards: no HTML pattern
// assignment left in jk_bms.js may use the WebKit-rejected form, and every
// one that exists must compile under both the "u" and the stricter "v"
// regex flag (WebKit's real trigger).
const patterns = [...source.matchAll(/\.pattern = "((?:[^"\\]|\\.)*)";/g)].map((m) => JSON.parse(`"${m[1]}"`));
check("the OLD, browser-rejected pattern [0-9.,+-]* is not present anywhere", !patterns.includes("[0-9.,+-]*") && !source.includes('pattern = "[0-9.,+-]*"'),
  JSON.stringify(patterns));
const bad = [];
for (const p of patterns) {
  for (const flag of ["u", "v"]) {
    try { new RegExp(`^(?:${p})$`, flag); } catch (e) { bad.push(`${p} (${flag}): ${e.message}`); }
  }
}
check("every remaining HTML pattern compiles under both the 'u' and the 'v' regex flags", bad.length === 0, bad.join("; "));
check("the removed legacy editor's validation path is really gone (no submitRegisterSetting)", !source.includes("function submitRegisterSetting("));
check("the unified Settings write path validates the numeric value before any request (submitRegisterWrite)",
  /function submitRegisterWrite\([\s\S]{0,1500}?!Number\.isFinite\(Number\(rawValue\)\)/.test(source));

console.log(`\n${checks} checks run, ${failures} failed.`);
process.exit(failures ? 1 : 0);
