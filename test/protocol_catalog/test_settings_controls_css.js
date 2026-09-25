#!/usr/bin/env node
"use strict";

// Settings controls (owner requests 2026-09-25): static regression over the
// REAL jk_bms.css, matching what was measured in the mock browser at 1280,
// 820, 375 and 320 px, light and dark, and with enlarged text: one field
// shell per control (value, then unit suffix, then lock), a small neutral
// lock instead of status badges, reasons kept visually hidden for screen
// readers, a visible focus ring, distinguishable locked/pending/offline/
// unavailable/stale/error/draft states, a fixed alignment grid whose status
// track is reserved on desktop, and a phone layout with no empty rows.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const css = fs.readFileSync(path.join(ROOT, "jk_bms.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

let checks = 0;
let failures = 0;
function check(name, condition, detail = "") {
  checks += 1;
  if (!condition) failures += 1;
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` -- ${detail}` : ""}`);
}

// Flat rule list: { media, selectors[], body }.
function parse(text) {
  const rules = [];
  let i = 0;
  function block(media) {
    while (i < text.length) {
      const open = text.indexOf("{", i);
      const close = text.indexOf("}", i);
      if (close !== -1 && (open === -1 || close < open)) { i = close + 1; return; }
      if (open === -1) { i = text.length; return; }
      const head = text.slice(i, open).trim();
      i = open + 1;
      if (head.startsWith("@media") || head.startsWith("@supports")) { block(head); continue; }
      if (head.startsWith("@")) { // @keyframes etc.: skip the balanced block
        for (let depth = 1; depth > 0 && i < text.length; i += 1) {
          if (text[i] === "{") depth += 1;
          else if (text[i] === "}") depth -= 1;
        }
        continue;
      }
      const end = text.indexOf("}", i);
      rules.push({ media, selectors: head.split(",").map((s) => s.trim()).filter(Boolean), body: text.slice(i, end).trim() });
      i = end + 1;
    }
  }
  block(null);
  return rules;
}
const rules = parse(css);
const decl = (body, prop) => {
  const m = new RegExp(`(?:^|;|\\s)${prop.replace(/[-]/g, "\\-")}\\s*:\\s*([^;]+)`).exec(body);
  return m ? m[1].trim() : null;
};
const find = (selector, media = null) => rules.filter((r) => r.media === media && r.selectors.includes(selector));
const bodyOf = (selector, media = null) => find(selector, media).map((r) => r.body).join(";");

// 1. One field shell for inputs and selects; the editor inside it is bare.
const shell = bodyOf(".settings-field-shell");
check("field shell: 38 px tall, 8 px radius, 1 px border, themed surface, flex row", decl(shell, "height") === "38px" &&
  decl(shell, "border-radius") === "8px" && /^1px solid/.test(decl(shell, "border") || "") &&
  decl(shell, "background-color") === "var(--field-bg)" && decl(shell, "display") === "flex" && decl(shell, "box-sizing") === "border-box");
const inner = bodyOf(".settings-field-shell > .settings-catalog-editor");
check("editor inside the shell is borderless, transparent, flexible and can shrink (no overlap with suffixes)",
  decl(inner, "border") === "0" && decl(inner, "background-color") === "transparent" && decl(inner, "flex") === "1 1 auto" &&
  decl(inner, "min-width") === "0" && decl(inner, "padding") === "0");
check("cell calibration editors use the same inner rule", find(".settings-field-shell > .cell-composite-calibration-editor").some((r) => r.body === inner));
check("number values are right-aligned against the unit; spinners removed",
  bodyOf(".settings-field-shell > input").includes("text-align:right") &&
  rules.some((r) => r.selectors.includes(".settings-field-shell > input::-webkit-inner-spin-button")));
const unit = bodyOf(".settings-field-shell > .settings-catalog-unit");
check("unit suffix is inside the shell, never shrinks and never wraps", decl(unit, "flex") === "none" && decl(unit, "white-space") === "nowrap");
const select = bodyOf(".settings-field-shell > select");
check("select keeps its native element, drawn inside the shell with a chevron", decl(select, "appearance") === "none" &&
  /linear-gradient/.test(decl(select, "background-image") || ""));

check("an editable value is full-contrast ink even inside a generic .diag-row (which dims spans)",
  decl(bodyOf(".diag-row .settings-field-shell"), "color") === "var(--ink)" &&
  decl(bodyOf(".diag-row .settings-field-shell.is-locked"), "color") === "var(--ink-dim)");

// 2. The lock: one small neutral icon, not a control or a badge.
const lock = bodyOf(".settings-lock");
const lockSvg = bodyOf(".settings-lock svg");
check("lock is 14 px, neutral ink, never shrinks", decl(lock, "width") === "14px" && decl(lock, "height") === "14px" &&
  decl(lock, "color") === "var(--ink-faint)" && decl(lock, "flex") === "none");
check("lock uses the project's outline icon style (no fill, currentColor stroke, round caps)",
  decl(lockSvg, "fill") === "none" && decl(lockSvg, "stroke") === "currentColor" && decl(lockSvg, "stroke-linecap") === "round");
check("lock is not styled as an action (no pointer cursor, no background, no border)",
  decl(lock, "cursor") === "default" && !decl(lock, "background") && !decl(lock, "border"));
check("no badge/pill styling remains for write-status notes",
  !rules.some((r) => r.selectors.some((sel) => /settings-catalog-note|cell-composite-write-state/.test(sel)) && /border-radius|background/.test(r.body)));
const srOnly = bodyOf(".sr-only");
check("reasons are visually hidden but kept in the accessibility tree (sr-only, not display:none)",
  /clip/.test(srOnly) && decl(srOnly, "width") === "1px" && !/display\s*:\s*none/.test(srOnly) && !/visibility/.test(srOnly));

// 3. Focus and states on the shell.
check("keyboard focus draws a 2 px accent ring on the shell",
  /^2px solid/.test(decl(bodyOf(".settings-field-shell:has(> :focus-visible)"), "outline") || ""));
check("action button keeps a visible focus ring and 38 px height",
  /^2px solid/.test(decl(bodyOf(".settings-catalog-action:focus-visible"), "outline") || "") && decl(bodyOf(".settings-catalog-action"), "height") === "38px");
const states = {
  locked: bodyOf(".settings-field-shell.is-locked"),
  pending: bodyOf('.settings-field-shell:has(> [data-freshness="pending"])'),
  offline: bodyOf('.settings-field-shell:has(> [data-freshness="offline"])'),
  unavailable: bodyOf('.settings-field-shell:not(.is-locked):has(> [data-freshness="unavailable"])'),
  stale: bodyOf('.settings-field-shell:not(.is-locked):has(> [data-freshness="stale"])'),
  error: bodyOf(".settings-field-shell:has(> .invalid)"),
  dirty: bodyOf('.settings-field-shell:has(> [data-dirty="true"])'),
};
check("every state has its own rule and every rule differs",
  Object.values(states).every((b) => b.length > 0) && new Set(Object.values(states)).size === Object.keys(states).length,
  JSON.stringify(Object.keys(states).filter((k) => !states[k])));
check("locked = no field fill, hairline border, not-allowed: quieter than an editable (filled) field",
  decl(states.locked, "background-color") === "transparent" && decl(states.locked, "border-color") === "var(--hair)" &&
  decl(states.locked, "cursor") === "not-allowed");
check("warning color only for stale data, danger only for errors; neither on a normally locked field",
  /var\(--warn\)/.test(states.stale) && /var\(--danger\)/.test(states.error) && !/warn|danger/.test(states.locked) && !/warn|danger/.test(lock));
check("offline = dotted, pending = dashed", decl(states.offline, "border-style") === "dotted" && decl(states.pending, "border-style") === "dashed");
const order = (sel) => rules.findIndex((r) => r.selectors.includes(sel));
check("error styling is declared after the freshness states",
  order(".settings-field-shell:has(> .invalid)") > order('.settings-field-shell:not(.is-locked):has(> [data-freshness="stale"])'));
const fieldBgDefs = rules.filter((r) => /--field-bg\s*:/.test(r.body));
check("--field-bg is defined for default, prefers-light, data-theme=light and data-theme=dark", fieldBgDefs.length === 4);

// 4. Alignment grid.
const group = bodyOf(".settings-catalog-editor-group");
check("desktop: three fixed tracks (field shell | action | status)", decl(group, "display") === "grid" &&
  decl(group, "grid-template-columns") === "var(--sc-field-w) var(--sc-action-w) var(--sc-status-w)" &&
  ["--sc-field-w", "--sc-action-w", "--sc-status-w"].every((v) => /^\d+px$/.test(decl(bodyOf(".settings-catalog-row"), v) || "")));
const reserved = bodyOf(".settings-catalog-row .settings-freshness-note[hidden]");
check("desktop: a hidden status keeps its space (no layout jump)", decl(reserved, "visibility") === "hidden" && decl(reserved, "display") === "block");
check("an empty write-result message takes no space", decl(bodyOf(".settings-catalog-message:empty"), "display") === "none");

// 5. Phone layout: no empty badge/status rows.
const phone = "@media (max-width:560px)";
const phoneGroup = bodyOf(".settings-catalog-editor-group", phone);
check("phone: the group takes its own line as [field | action]", decl(phoneGroup, "flex-basis") === "100%" &&
  decl(phoneGroup, "grid-template-columns") === "minmax(0, 1fr) var(--sc-action-w)");
check("phone: a hidden status takes no line (display:none)",
  decl(bodyOf(".settings-catalog-editor-group > .settings-freshness-note[hidden]", phone), "display") === "none");
check("cell calibration controls wrap instead of overflowing narrow rows", decl(bodyOf(".cell-composite-calibration"), "flex-wrap") === "wrap");

console.log(`\nsettings controls CSS: ${checks - failures}/${checks} passed`);
process.exit(failures ? 1 : 0);
