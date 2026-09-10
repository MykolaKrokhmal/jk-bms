#!/usr/bin/env node
"use strict";

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

function extractCalls(src) {
  const calls = [];
  const literal = /registerEntity\("([a-zA-Z0-9_]+)",\s*"([a-zA-Z0-9_]+)",\s*"([^"]*)",\s*"([^"]*)"\)/g;
  for (let match = literal.exec(src); match; match = literal.exec(src)) {
    calls.push({ key: match[1], domain: match[2], configuredName: match[3], legacyObjectId: match[4] });
  }
  const loop = src.match(/for \(const name of \[(.*?)\]\)\s*registerEntity\(name,\s*"sensor",\s*name\.replaceAll\("_",\s*" "\),\s*name\)/s);
  if (loop) {
    for (const match of loop[1].matchAll(/"([a-zA-Z0-9_]+)"/g)) {
      const key = match[1];
      calls.push({ key, domain: "sensor", configuredName: key.replaceAll("_", " "), legacyObjectId: key });
    }
  }
  return calls;
}

const calls = extractCalls(source);
check("entity registrations extracted", calls.length > 100, `count=${calls.length}`);

for (const [wireObjectId, expectedKey] of [["cell_rcv", "cell_rcv"], ["cell_rfv", "cell_rfv"]]) {
  const owners = calls.filter((call) => call.domain === "sensor" && (
    call.legacyObjectId === wireObjectId || call.configuredName.toLowerCase().replaceAll(" ", "_") === wireObjectId
  ));
  check(`${wireObjectId} has one wire owner`, owners.length === 1, `owners=${owners.map((item) => item.key).join(",")}`);
  check(`${wireObjectId} owner is canonical`, owners.length === 1 && owners[0].key === expectedKey);
}

check("charge target consumers use canonical keys",
  source.includes('numeric("cell_rcv")') && source.includes('numeric("cell_rfv")') &&
  source.includes('bind("cell_rcv", drawTimeline)') && source.includes('bind("cell_rfv", drawTimeline)'));
check("obsolete alias keys are absent from live state consumers",
  !source.includes('registerEntity("cell_request_charge_voltage"') &&
  !source.includes('registerEntity("cell_request_float_voltage"') &&
  !source.includes('numeric("cell_request_charge_voltage")') &&
  !source.includes('numeric("cell_request_float_voltage")'));

console.log(`\n${checks} checks run, ${failures} failed.`);
process.exit(failures ? 1 : 0);
