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

const match = source.match(/input\.pattern = "((?:[^"\\]|\\.)*)";/);
check("numeric register-editor input.pattern= assignment found in jk_bms.js", Boolean(match));
const patternSource = match ? JSON.parse(`"${match[1]}"`) : null;

check("the OLD, browser-rejected pattern is no longer present", patternSource !== "[0-9.,+-]*", `pattern=${JSON.stringify(patternSource)}`);

let compiledU = null;
let compiledUError = null;
try { compiledU = new RegExp(`^(?:${patternSource})$`, "u"); } catch (e) { compiledUError = e.message; }
check("pattern compiles under the 'u' (unicode) regex flag", compiledU !== null, compiledUError || "");

let compiledV = null;
let compiledVError = null;
try { compiledV = new RegExp(`^(?:${patternSource})$`, "v"); } catch (e) { compiledVError = e.message; }
check("pattern compiles under the newer, stricter 'v' (unicodeSets) regex flag (WebKit's real trigger)", compiledV !== null, compiledVError || "");

// The exact character-membership set must be byte-for-byte unchanged from
// the pre-fix pattern (digits, '.', ',', '+', '-', zero-or-more) -- proves
// this is a syntax fix only, never a validation-strength change.
if (compiledV) {
  const accept = ["", "3,450", "-12.5", "+5", "123", "--", "3-4", ".", ",", "+-"];
  const reject = ["a1", "1a", " 1", "1 ", "1e5", "NaN", "1_000"];
  const acceptFailures = accept.filter((s) => !compiledV.test(s));
  const rejectFailures = reject.filter((s) => compiledV.test(s));
  check("pattern still accepts every previously-accepted character combination (digits/sign/decimal point/comma)",
    acceptFailures.length === 0, `unexpectedly rejected: ${acceptFailures.join(",")}`);
  check("pattern still rejects non-numeric characters (letters, spaces, exponent notation, underscores)",
    rejectFailures.length === 0, `unexpectedly accepted: ${rejectFailures.join(",")}`);
}

check("backend numeric validation (submitRegisterSetting) is untouched by this fix",
  source.includes("function submitRegisterSetting("));

console.log(`\n${checks} checks run, ${failures} failed.`);
process.exit(failures ? 1 : 0);
