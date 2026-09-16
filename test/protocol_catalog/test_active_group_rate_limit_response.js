#!/usr/bin/env node
"use strict";

// Regression test for ActiveGroupHandler's rate-limit HTTP response (Stage 1
// hardware acceptance retest fix). A real device session found
// request->send(429, ...) actually delivering HTTP 500 on the wire,
// reproduced 2/2 times. Root cause, confirmed directly against the real
// installed ESPHome 2026.8.2 package source (not assumed): web_server_idf's
// AsyncWebServerRequest::init_response_() only has explicit switch cases for
// {200,204,400,401,404,409,422} and falls through to HTTPD_500 for any other
// code -- 429 included. Fixed by driving httpd_resp_set_status()/
// httpd_resp_send() directly (via the request's public `operator
// httpd_req_t*()`), the same pattern the vendor file's own
// AsyncWebServerRequest::redirect() already uses for its own not-in-the-
// switch "302 Found" -- not by patching the vendor file.
//
// LIMITATION, stated plainly: this project has no ESP-IDF host build or
// hardware simulator, so this test cannot execute httpd_resp_set_status()/
// httpd_resp_send() and observe a real HTTP response on the wire the way a
// live device retest can. What it verifies instead: the rate-limit branch
// in the real tracked source calls the direct httpd_resp_* API with the
// literal "429 Too Many Requests" status string, no longer the broken
// request->send(429, ...) pattern, while every other branch in the same
// handler is untouched. This is a structural/call-pattern check, not proof
// of the actual wire response -- that can only be confirmed by reflashing
// and retesting the real HTTP status code against real hardware.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const source = fs.readFileSync(path.join(ROOT, "batterylifepo4.yaml"), "utf8");

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

const classMatch = source.match(/class ActiveGroupHandler[\s\S]*?\n {10}\};/);
check("ActiveGroupHandler class body found in batterylifepo4.yaml", Boolean(classMatch));
const handlerSrc = classMatch ? classMatch[0] : "";

const rateLimitBranchMatch = handlerSrc.match(/if \(last != 0 && now - last < 100U\) \{([\s\S]*?)\n {16}return;\n {14}\}/);
check("rate-limit branch (last != 0 && now - last < 100U) found", Boolean(rateLimitBranchMatch));
// Strip full-line "//" comments before pattern-matching CODE below -- this
// branch's own explanatory comment quotes the broken request->send(429...)
// pattern by name, which would otherwise false-match these checks.
const rateLimitBranch = (rateLimitBranchMatch ? rateLimitBranchMatch[1] : "")
  .split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");

check("rate-limit branch no longer uses the broken request->send(429, ...) pattern",
  !/request->send\(\s*429/.test(rateLimitBranch));

check("rate-limit branch sets status via the direct httpd_resp_set_status() API (bypasses init_response_'s fixed switch)",
  /httpd_resp_set_status\(\s*\*request\s*,\s*"429 Too Many Requests"\s*\)/.test(rateLimitBranch));

check("rate-limit branch sets JSON content type via httpd_resp_set_type()",
  /httpd_resp_set_type\(\s*\*request\s*,\s*"application\/json"\s*\)/.test(rateLimitBranch));

check("rate-limit branch sends the response via httpd_resp_send() (not request->send())",
  /httpd_resp_send\(\s*\*request\s*,/.test(rateLimitBranch) && !/request->send\(/.test(rateLimitBranch));

check("rate-limit JSON body text is unchanged", rateLimitBranch.includes('{\\"ok\\":false,\\"error\\":\\"rate limited\\"}'));

// The fix must be scoped to only the rate-limit branch -- every other
// response in this handler (200 valid, 200 none, 400 missing, 400 invalid)
// must still use the ordinary request->send(code, ...) path, proving this
// wasn't a blanket rewrite that could have changed other status codes too.
const handlerSrcCodeOnly = handlerSrc.split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
const otherSendCalls = (handlerSrcCodeOnly.match(/request->send\(\s*(\d+)/g) || []).map((m) => m.match(/\d+/)[0]);
check("every OTHER response in the handler still uses request->send() unchanged (200/200/400/400)",
  otherSendCalls.sort().join(",") === "200,200,400,400", `found=${otherSendCalls.join(",")}`);

// Everything the prior pass's own retest required to stay intact.
check("group validation (1-12 range check) is unchanged",
  handlerSrc.includes("parsed < 1 || parsed > 12"));
check("rate-limit interval constant (100U ms) is unchanged",
  handlerSrc.includes("now - last < 100U"));
check("reset-to-none path is unchanged",
  handlerSrc.includes('raw == "none"') && handlerSrc.includes('"group\\":\\"none\\"'));
check("handler still never calls jk_write_tx / touches the Modbus write path",
  !handlerSrc.includes("jk_write_tx") && !handlerSrc.includes("queue_command"));

console.log("\nNOTE: this is a structural/call-pattern check against the tracked source, not a live HTTP");
console.log("transport test (no ESP-IDF host build exists in this project) -- the actual wire status code");
console.log("(429 vs any other value) can only be confirmed by reflashing and retesting against real hardware.");
console.log(`\n${checks} checks run, ${failures} failed.`);
process.exit(failures ? 1 : 0);
