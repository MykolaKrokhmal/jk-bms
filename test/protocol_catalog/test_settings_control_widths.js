#!/usr/bin/env node
"use strict";

// Settings control widths (owner request 2026-09-26): the shared widths in
// jk_bms.css must come from a measured audit of every RW Settings editor,
// not from eyeballing. The audit (fixtures/settings_control_width_audit.json)
// records, per editor, the widest candidate string -- min/max at the field's
// precision with both decimal separators, sign, uk/en unit, every localized
// option -- and the pixel width it needs inside the field shell, measured in
// the browser with the editors' computed fonts.
//
// This test proves:
//   1. the audit covers exactly today's RW Settings editors, with exactly the
//      candidate strings today's schema produces (a range/precision/unit/
//      option change fails here until the audit is re-measured);
//   2. each CSS width token is at least the widest requirement of its group
//      plus the rendering margin, and not more than 4 px above it (compact);
//   3. there is exactly ONE ordinary width: raw-value fields show the compact
//      suffix "raw" and fit it too (no special wide branch);
//   4. the cell-calibration width is derived the same way from the cell
//      calibration contract (mOhm, 3 decimals, 0 .. 4294967.295).

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const audit = JSON.parse(read("test/protocol_catalog/fixtures/settings_control_width_audit.json"));
const vm = JSON.parse(read("protocol/generated/settings_view_model.json"));
const rows = vm.rows || vm;
const css = read("jk_bms.css");
const js = read("jk_bms.js");

let checks = 0;
let failures = 0;
function check(name, condition, detail = "") {
  checks += 1;
  if (!condition) failures += 1;
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` -- ${detail}` : ""}`);
}
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

// --- 1. Audit coverage and candidate strings -------------------------------
const editable = rows.filter((r) => r.access === "RW" && r.canonicalKey && ["numeric", "binary", "enum"].includes(r.valueKind));
const general = editable.filter((r) => r.compositeGroup !== "cell");
const cells = editable.filter((r) => r.compositeGroup === "cell");
check("the audit covers exactly the RW Settings editors (no missing, no stale keys)",
  same(general.map((r) => r.canonicalKey), Object.keys(audit.controls)),
  `${general.length} editors, ${Object.keys(audit.controls).length} audited`);

const i18n = (section, key, which) => {
  // which: 0 = EN block, 1 = UK block (the two i18n dictionaries in order).
  let from = 0;
  for (let i = 0; i <= which; i++) from = js.indexOf(`${section}: {`, from) + 1;
  const m = js.slice(from).match(new RegExp(`\\b${key}: "([^"]+)"`));
  return m && m[1];
};
const yesNo = [i18n("settingsCatalog", "yes", 0), i18n("settingsCatalog", "no", 0), i18n("settingsCatalog", "yes", 1), i18n("settingsCatalog", "no", 1)];
const wireWorst = { U8: ["255"], U16: ["65535"], S16: ["-32768", "32767"], U32: ["4294967295"], S32: ["-2147483648", "2147483647"] };
const fmt = (v, p) => v.toFixed(typeof p === "number" ? p : 0);
let stringsMatch = true;
const mismatches = [];
for (const r of general) {
  const a = audit.controls[r.canonicalKey];
  if (!a) continue;
  if (r.valueKind === "numeric") {
    let values = [r.min, r.max].filter((v) => typeof v === "number").map((v) => fmt(v, r.precision));
    values = [...new Set(values.flatMap((v) => [v, v.replace(".", ",")]))];
    if (!values.length) values = wireWorst[r.wireType] || [];
    // Visible suffixes (settingsRowUnit): "raw" for raw values in both languages.
    const units = r.unit === "raw" ? ["raw"] : [r.ukUnit, r.enUnit].filter(Boolean);
    if (a.kind !== "number" || !same(values, a.values) || !same(units, a.units)) { stringsMatch = false; mismatches.push(r.canonicalKey); }
  } else {
    let opts = r.options ? Object.values(r.options) : yesNo;
    if (opts.includes("On") || opts.includes("Off")) opts = [...opts, "Увімк", "Вимк"];
    if (a.kind !== "select" || !same([...new Set(opts)], a.strings)) { stringsMatch = false; mismatches.push(r.canonicalKey); }
  }
}
check("every audited candidate string still matches the schema (re-measure the audit if this fails)", stringsMatch, mismatches.join(","));
const cellSpec = cells[0];
const cellValues = [...new Set([cellSpec.min, cellSpec.max].map((v) => fmt(v, cellSpec.precision)).flatMap((v) => [v, v.replace(".", ",")]))];
check("all 32 cell calibration rows share one contract (mΩ, 3 decimals, 0 .. 4294967.295)",
  cells.length === 32 && cells.every((r) => r.min === cellSpec.min && r.max === cellSpec.max && r.precision === 3 && r.enUnit === "mΩ" && r.ukUnit === "мОм"));
check("the cell audit used exactly that contract's strings",
  same(cellValues, audit.cellCalibration.values) && same([cellSpec.ukUnit, cellSpec.enUnit], audit.cellCalibration.units));

// --- 2. CSS tokens vs measured requirements ---------------------------------
const fsBody = Number((css.match(/--fs-body:\s*(\d+(?:\.\d+)?)px/) || [])[1]);
const widthVar = (name) => {
  const m = css.match(new RegExp(`${name}:calc\\((\\d+(?:\\.\\d+)?)px \\+ var\\(--fs-body\\) \\* (\\d+(?:\\.\\d+)?)\\)`));
  return m ? { fixed: Number(m[1]), k: Number(m[2]), px: Number(m[1]) + fsBody * Number(m[2]) } : null;
};
const env = audit.environment;
const fixedChrome = env.shellChromePx + env.unitGapPx + env.caretPx;
const margin = env.renderingMarginPx;
const ordinary = widthVar("--settings-control-width");
const cell = widthVar("--cell-calibration-width");
check("width tokens exist and scale with the value font (fixed chrome + k x --fs-body)", !!ordinary && !!cell && fsBody === 15);
check("the fixed part of every token is exactly the measured shell chrome + unit gap + caret",
  [ordinary, cell].every((t) => t && t.fixed === fixedChrome), `${fixedChrome}px`);

const rawKeys = general.filter((r) => r.unit === "raw").map((r) => r.canonicalKey);
const ordinaryKeys = general.map((r) => r.canonicalKey);
const maxOf = (keys) => Math.max(...keys.map((k) => audit.controls[k].requiredPx));
const ordReq = maxOf(ordinaryKeys);
check("ordinary width fits the widest ordinary editor plus the rendering margin",
  ordinary.px >= ordReq + margin, `${ordinary.px}px vs ${ordReq}px needed`);
check("ordinary width is compact: at most 4 px above that requirement", ordinary.px - ordReq <= margin + 2, `${(ordinary.px - ordReq).toFixed(2)}px spare`);
check("cell calibration width fits its absolute maximum plus margin, and is compact",
  cell.px >= audit.cellCalibration.requiredPx + margin && cell.px - audit.cellCalibration.requiredPx <= margin + 2,
  `${cell.px}px vs ${audit.cellCalibration.requiredPx}px`);
check("cell calibration is narrower than ordinary controls whenever its audited content permits",
  audit.cellCalibration.requiredPx > ordReq || cell.px < ordinary.px,
  `cell needs ${audit.cellCalibration.requiredPx}px (4294967.295 mΩ), ordinary ${ordReq}px`);

// --- 3. One ordinary width group --------------------------------------------
check("the raw-value fields are exactly the four dry-contact thresholds, audited with the compact 'raw' suffix",
  same(rawKeys, ["dry_contact_1_trigger_value", "dry_contact_1_recovery_value", "dry_contact_2_trigger_value", "dry_contact_2_recovery_value"]) &&
  rawKeys.every((k) => same(audit.controls[k].units, ["raw"]) && audit.controls[k].widest === "-16777215 raw"));
check("every ordinary editor, including '-16777215 raw', fits the single shared width with margin",
  ordinaryKeys.every((k) => audit.controls[k].requiredPx + margin <= ordinary.px),
  `raw fields need ${audit.controls[rawKeys[0]].requiredPx}px of ${ordinary.px}px`);
check("no special wide branch remains (no raw width token, no data-value-unit selector or marking)",
  !/--settings-control-width-raw/.test(css) && !/data-value-unit/.test(css) && !/valueUnit/.test(js));
check("the renderer shows the compact 'raw' marker in both languages (presentation only)",
  /function settingsRowUnit\(row\) \{\n    if \(row\.unit === "raw"\) return "raw";/.test(js));
check("Settings rows and cell rows consume the shared tokens",
  /\.settings-catalog-row\{ --sc-field-w:var\(--settings-control-width\); --sc-action-w:var\(--settings-action-width\);/.test(css) &&
  /--cc-field-w:var\(--cell-calibration-width\); --cc-action-w:var\(--settings-action-width\);/.test(css));

console.log(`\nsettings control widths: ${checks - failures}/${checks} passed`);
process.exit(failures ? 1 : 0);
