#!/usr/bin/env node
"use strict";

// Settings controls normalization (owner request 2026-09-25): static
// regression over the REAL jk_bms.css. It proves the contract the rendered
// check (mock browser, desktop 1024 px and phone 375 px, light and dark)
// measured: one control style for number inputs and selects, a visible
// focus state, distinguishable fresh/stale/offline/pending/unavailable/
// disabled/error states, a themed field surface, a fixed alignment grid
// whose status track is always reserved (no layout jump), and a three-track
// phone layout that cannot overflow.

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

// 1. One base control style shared by <input> and <select>.
const base = bodyOf(".settings-catalog-editor");
check("base control rule is tag-agnostic (applies to input AND select)", base.length > 0);
check("base control: 38 px height (usable touch target)", decl(base, "height") === "38px", decl(base, "height"));
check("base control: 8 px radius, 1 px border, horizontal padding, border-box",
  decl(base, "border-radius") === "8px" && /^1px solid/.test(decl(base, "border") || "") && decl(base, "padding") === "0 10px" &&
  decl(base, "box-sizing") === "border-box");
check("base control: themed field surface and ink color, inherited font, tabular digits",
  decl(base, "background-color") === "var(--field-bg)" && decl(base, "color") === "var(--ink)" && decl(base, "font") === "inherit" &&
  decl(base, "font-variant-numeric") === "tabular-nums");
check("cell calibration inputs share the same base control style", find(".cell-composite-calibration-editor").some((r) => r.body === base));
const select = bodyOf("select.settings-catalog-editor");
check("select keeps its native element, drawn to the same box with a chevron",
  decl(select, "appearance") === "none" && /linear-gradient/.test(decl(select, "background-image") || "") && decl(select, "padding-right") === "26px");
check("number input spinners removed (no clipped digits), value right-aligned",
  bodyOf("input.settings-catalog-editor").includes("text-align:right") &&
  rules.some((r) => r.selectors.includes("input.settings-catalog-editor::-webkit-inner-spin-button")));

// 2. Visible keyboard focus.
const focus = bodyOf(".settings-catalog-editor:focus-visible");
check("focus-visible draws a 2 px accent outline on every control", /^2px solid/.test(decl(focus, "outline") || "") && /accent/.test(focus));
check("action button has a visible focus-visible outline", /^2px solid/.test(decl(bodyOf(".settings-catalog-action:focus-visible"), "outline") || ""));
const action = bodyOf(".settings-catalog-action");
check("action button: 38 px tall, >= 44 px wide", decl(action, "height") === "38px" && parseInt(decl(action, "min-width"), 10) >= 44);

// 3. States are distinguishable.
const states = {
  pending: bodyOf('.settings-catalog-editor[data-freshness="pending"]'),
  unavailable: bodyOf('.settings-catalog-editor[data-freshness="unavailable"]'),
  offline: bodyOf('.settings-catalog-editor[data-freshness="offline"]'),
  stale: bodyOf('.settings-catalog-editor[data-freshness="stale"]'),
  error: bodyOf(".settings-catalog-editor.invalid"),
  disabled: bodyOf(".settings-catalog-editor:disabled"),
  dirty: bodyOf('.settings-catalog-editor[data-dirty="true"]'),
};
check("every state has its own rule", Object.values(states).every((b) => b.length > 0), JSON.stringify(Object.keys(states).filter((k) => !states[k])));
check("every state rule is different", new Set(Object.values(states)).size === Object.keys(states).length);
check("stale = warning border, error = danger border, offline = dotted, pending = dashed",
  /var\(--warn\)/.test(decl(states.stale, "border-color") || "") && /var\(--danger\)/.test(decl(states.error, "border-color") || "") &&
  decl(states.offline, "border-style") === "dotted" && decl(states.pending, "border-style") === "dashed");
check("disabled/readonly is flat (hairline border, muted surface) and not-allowed",
  decl(states.disabled, "border-color") === "var(--hair)" && decl(states.disabled, "background-color") === "var(--hair)" &&
  decl(states.disabled, "cursor") === "not-allowed");
const order = (sel) => rules.findIndex((r) => r.selectors.includes(sel));
check("error styling is declared after the freshness states (an invalid draft always shows as error)",
  order(".settings-catalog-editor.invalid") > order('.settings-catalog-editor[data-freshness="stale"]'));

// 4. Themed field surface in every theme block.
const fieldBgDefs = rules.filter((r) => /--field-bg\s*:/.test(r.body));
check("--field-bg is defined for default, prefers-light, data-theme=light and data-theme=dark",
  fieldBgDefs.length === 4 &&
  fieldBgDefs.some((r) => r.media && r.media.includes("prefers-color-scheme: light")) &&
  fieldBgDefs.some((r) => r.selectors.includes(':root[data-theme="light"]')) &&
  fieldBgDefs.some((r) => r.selectors.includes(':root[data-theme="dark"]')));

// 5. Alignment grid with a reserved status track.
const group = bodyOf(".settings-catalog-editor-group");
check("desktop: editor group is a four-track grid (editor | unit | action | status)",
  decl(group, "display") === "grid" &&
  decl(group, "grid-template-columns") === "var(--sc-editor-w) var(--sc-unit-w) var(--sc-action-w) var(--sc-status-w)");
check("desktop: the track widths are fixed pixel variables on every Settings row",
  ["--sc-editor-w", "--sc-unit-w", "--sc-action-w", "--sc-status-w"].every((v) => /^\d+px$/.test(decl(bodyOf(".settings-catalog-row"), v) || "")));
check("each child has an explicit track (editor 1, unit 2, action/badge 3, status 4)",
  decl(bodyOf(".settings-catalog-editor-group > .settings-catalog-editor"), "grid-column") === "1" &&
  decl(bodyOf(".settings-catalog-editor-group > .settings-catalog-unit"), "grid-column") === "2" &&
  decl(bodyOf(".settings-catalog-editor-group > .settings-catalog-action"), "grid-column") === "3" &&
  decl(bodyOf(".settings-catalog-editor-group > .settings-freshness-note"), "grid-column") === "4");
const reserved = bodyOf(".settings-catalog-row .settings-freshness-note[hidden]");
check("a hidden status keeps its space (visibility:hidden, not display:none): no layout jump",
  decl(reserved, "visibility") === "hidden" && decl(reserved, "display") === "block");
check("an empty write-result message takes no space", decl(bodyOf(".settings-catalog-message:empty"), "display") === "none");

// 6. Phone layout.
const phone = "@media (max-width:560px)";
const phoneGroup = bodyOf(".settings-catalog-editor-group", phone);
check("phone: group takes its own line and switches to three tracks ending in a flexible track",
  decl(phoneGroup, "flex-basis") === "100%" && /minmax\(0, 1fr\)$/.test(decl(phoneGroup, "grid-template-columns") || ""));
check("phone: status moves to its own reserved line under the controls",
  decl(bodyOf(".settings-catalog-editor-group > .settings-freshness-note", phone), "grid-row") === "2" &&
  decl(bodyOf(".settings-catalog-editor-group > .settings-freshness-note", phone), "grid-column") === "1 / -1");
const phoneVars = bodyOf(".settings-catalog-row", phone);
const fixedPhone = ["--sc-editor-w", "--sc-unit-w"].reduce((sum, v) => sum + parseInt(decl(phoneVars, v), 10), 0);
check("phone: fixed tracks + gaps leave room in the narrowest measured row (257 px content)", fixedPhone + 2 * 8 + 80 <= 257,
  `${fixedPhone}px fixed`);

// A disabled control with no reading must stay visible: no rule may make
// both its border and its surface transparent at once.
const invisible = rules.filter((r) => r.selectors.some((sel) => /settings-catalog-editor(:disabled|\[data-freshness)/.test(sel)) &&
  decl(r.body, "border-color") === "transparent");
check("no state makes a control's border transparent (a disabled + unavailable control stays visible)", invisible.length === 0,
  invisible.map((r) => r.selectors.join(",")).join(" | "));
check("cell calibration controls wrap instead of overflowing narrow rows",
  decl(bodyOf(".cell-composite-calibration"), "flex-wrap") === "wrap");

// 7. Commentary is not styled as a paragraph any more.
const note = bodyOf(".settings-catalog-row .settings-catalog-note");
check("write-status note is a compact badge (inline-block, small type), not a flexible paragraph column",
  decl(note, "display") === "inline-block" && decl(note, "font-size") === "12px" && !/flex\s*:\s*1 1/.test(css.match(/\.settings-catalog-note\{[^}]*\}/)?.[0] || ""));

console.log(`\nsettings controls CSS: ${checks - failures}/${checks} passed`);
process.exit(failures ? 1 : 0);
