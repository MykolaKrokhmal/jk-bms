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
  function block(media, outer = []) {
    while (i < text.length) {
      const open = text.indexOf("{", i);
      const close = text.indexOf("}", i);
      if (close !== -1 && (open === -1 || close < open)) { i = close + 1; return; }
      if (open === -1) { i = text.length; return; }
      const head = text.slice(i, open).trim();
      i = open + 1;
      if (head.startsWith("@media") || head.startsWith("@supports") || head.startsWith("@container")) { block(head, media ? [...outer, media] : outer); continue; }
      if (head.startsWith("@")) { // @keyframes etc.: skip the balanced block
        for (let depth = 1; depth > 0 && i < text.length; i += 1) {
          if (text[i] === "{") depth += 1;
          else if (text[i] === "}") depth -= 1;
        }
        continue;
      }
      const end = text.indexOf("}", i);
      rules.push({ media, outer, selectors: head.split(",").map((s) => s.trim()).filter(Boolean), body: text.slice(i, end).trim() });
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
const select = bodyOf(".settings-field-shell > select.settings-catalog-editor");
check("select keeps its native element, drawn inside the shell with a chevron and a 16 px chevron zone", decl(select, "appearance") === "none" &&
  /linear-gradient/.test(decl(select, "background-image") || "") && decl(select, "padding-right") === "16px");
// The chevron zone must out-rank the bare-editor rule that zeroes padding
// (a bare `.settings-field-shell > select` lost to it and let text run under the chevron).
check("the select chevron-zone rule is more specific than the bare-editor padding rule",
  rules.some((r) => r.selectors.includes(".settings-field-shell > select.settings-catalog-editor")) &&
  !rules.some((r) => r.selectors.includes(".settings-field-shell > select") && /padding-right/.test(r.body)));

check("an editable value is full-contrast ink even inside a generic .diag-row (which dims spans)",
  decl(bodyOf(".diag-row .settings-field-shell"), "color") === "var(--ink)" &&
  decl(bodyOf(".diag-row .settings-field-shell.is-locked"), "color") === "var(--ink-dim)");

// 2. The action slot: OK, or the lock that replaces it, in one footprint.
const okBtn = bodyOf(".settings-catalog-action");
const lockSlot = bodyOf(".settings-action-lock");
const lockSvg = bodyOf(".settings-action-lock svg");
check("OK and lock share one footprint: same width variable (44 px) and 38 px height",
  decl(okBtn, "width") === "var(--sc-action-w, 44px)" && decl(lockSlot, "width") === "var(--sc-action-w, 44px)" &&
  decl(okBtn, "height") === "38px" && decl(lockSlot, "height") === "38px" &&
  decl(bodyOf(".settings-catalog-row"), "--sc-action-w") === "var(--settings-action-width)" && /--settings-action-width:44px/.test(css));
check("cell OK buttons use the same action rule", find(".cell-composite-action").some((r) => r.body === okBtn));
check("lock icon is 18 px, centred, neutral ink, outline style",
  decl(lockSvg, "width") === "18px" && decl(lockSvg, "height") === "18px" && decl(lockSlot, "justify-content") === "center" &&
  decl(lockSlot, "align-items") === "center" && decl(lockSlot, "color") === "var(--ink-faint)" &&
  decl(lockSvg, "fill") === "none" && decl(lockSvg, "stroke") === "currentColor");
check("the lock is framed with the OK button's exact geometry (1 px border, 8 px radius, 44 x 38, border-box)",
  decl(lockSlot, "box-sizing") === "border-box" && decl(okBtn, "box-sizing") === "border-box" &&
  decl(lockSlot, "border-radius") === decl(okBtn, "border-radius") && /^1px solid /.test(decl(lockSlot, "border") || "") &&
  /^1px solid /.test(decl(okBtn, "border") || "") && decl(lockSlot, "margin") === "0" && decl(okBtn, "margin") === "0");
check("the lock frame is neutral only (grey border, transparent fill, no accent/warning) and never looks clickable",
  decl(lockSlot, "border") === "1px solid var(--hair-strong)" && decl(lockSlot, "background-color") === "transparent" &&
  !/accent|warn|danger|shadow/.test(lockSlot) && decl(lockSlot, "cursor") === "default" && decl(lockSlot, "pointer-events") === "none" &&
  !rules.some((r) => r.selectors.some((sel) => /settings-action-lock:(hover|active|focus)/.test(sel))));
check("no lock styling exists inside the field shell",
  !rules.some((r) => r.selectors.some((sel) => /settings-field-shell[^,]*settings-lock|settings-field-shell > \.settings-lock/.test(sel))));
check("no badge/pill styling remains for write-status notes",
  !rules.some((r) => r.selectors.some((sel) => /settings-catalog-note|cell-composite-write-state/.test(sel)) && /border-radius|background/.test(r.body)));
const srOnly = bodyOf(".sr-only");
check("reasons and freshness status are visually hidden but kept in the accessibility tree",
  find(".settings-freshness-note").some((r) => r.body === srOnly) && /clip/.test(srOnly) && decl(srOnly, "width") === "1px" &&
  !/display\s*:\s*none/.test(srOnly));

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
  /var\(--warn\)/.test(states.stale) && /var\(--danger\)/.test(states.error) && !/warn|danger/.test(states.locked) && !/warn|danger/.test(lockSlot));
check("offline = dotted, pending = dashed", decl(states.offline, "border-style") === "dotted" && decl(states.pending, "border-style") === "dashed");
const order = (sel) => rules.findIndex((r) => r.selectors.includes(sel));
check("error styling is declared after the freshness states",
  order(".settings-field-shell:has(> .invalid)") > order('.settings-field-shell:not(.is-locked):has(> [data-freshness="stale"])'));
const fieldBgDefs = rules.filter((r) => /--field-bg\s*:/.test(r.body));
check("--field-bg is defined for default, prefers-light, data-theme=light and data-theme=dark", fieldBgDefs.length === 4);

// 4. Settings grid: field | action, no status column.
const group = bodyOf(".settings-catalog-editor-group");
check("desktop: exactly two tracks (field shell | action slot) -- no reserved status column",
  decl(group, "display") === "grid" && decl(group, "grid-template-columns") === "var(--sc-field-w) var(--sc-action-w)");
check("field width is the audited shared token (see test_settings_control_widths.js), action fixed",
  decl(bodyOf(".settings-catalog-row"), "--sc-field-w") === "var(--settings-control-width)" &&
  decl(bodyOf(".settings-catalog-row"), "--sc-action-w") === "var(--settings-action-width)");
check("OK and lock both sit in track 2, the shell in track 1",
  decl(bodyOf(".settings-catalog-editor-group > .settings-field-shell"), "grid-column") === "1" &&
  find(".settings-catalog-editor-group > .settings-action-lock").some((r) => r.selectors.includes(".settings-catalog-editor-group > .settings-catalog-action") && decl(r.body, "grid-column") === "2"));
check("no rule reserves visible space for a status note",
  !rules.some((r) => r.selectors.some((sel) => /settings-freshness-note\[hidden\]/.test(sel))) &&
  !rules.some((r) => r.selectors.some((sel) => /settings-freshness-note/.test(sel)) && /grid-column|flex\s*:/.test(r.body)));
check("an empty write-result message takes no space",
  decl(bodyOf(".settings-catalog-message:empty"), "display") === "none" &&
  decl(bodyOf(".cell-composite-calibration > .cell-composite-write-state.request-message:empty"), "display") === "none");
check("stale and unavailable are visibly different (warning vs neutral grey)",
  /var\(--warn\)/.test(bodyOf('.settings-field-shell:not(.is-locked):has(> [data-freshness="stale"])')) &&
  /var\(--ink-faint\)/.test(bodyOf('.settings-field-shell:has(> [data-freshness="unavailable"]) > *')) &&
  /var\(--ink-faint\)/.test(bodyOf('.settings-catalog-value[data-freshness="unavailable"]')));

// 5. Cell rows: an explicit instrument grid.
const cellRow = bodyOf(".cell-composite-row");
check("cell row is a grid: label | voltage | resistance | calibration, ch-sized numeric tracks, tabular figures",
  decl(cellRow, "display") === "grid" &&
  decl(cellRow, "grid-template-columns") === "minmax(max-content, 1fr) var(--cc-volt-w) var(--cc-res-w) auto" &&
  ["--cc-volt-w", "--cc-res-w"].every((v) => /^\d+ch$/.test(decl(cellRow, v) || "")) &&
  decl(cellRow, "--cc-field-w") === "var(--cell-calibration-width)" &&
  decl(cellRow, "font-variant-numeric") === "tabular-nums" && decl(cellRow, "align-items") === "center");
check("voltage and resistance are right-aligned in their tracks",
  ["voltage", "resistance"].every((k) => {
    const b = bodyOf(`.cell-composite-row > .cell-composite-${k}`);
    return decl(b, "justify-self") === "end" && decl(b, "text-align") === "right" && decl(b, "white-space") === "nowrap";
  }));
const calib = bodyOf(".cell-composite-calibration");
check("calibration is [field (audited width) | action (shared 44 px)]", decl(calib, "display") === "grid" &&
  decl(calib, "grid-template-columns") === "var(--cc-field-w) var(--cc-action-w)" && decl(cellRow, "--cc-action-w") === "var(--settings-action-width)");
// 6. Layout states follow the width of the list itself (container queries),
// not the viewport: in the two-column deck (viewport 860-1100 px) the right
// column is narrower than a single-column 820 px page, and browser zoom
// changes both, so viewport breakpoints chose the wrong state.
check("the cell list and the Settings list are inline-size containers whose em is the value font",
  decl(bodyOf(".cell-composite-list"), "container-type") === "inline-size" && decl(bodyOf(".cell-composite-list"), "container-name") === "cells" &&
  decl(bodyOf(".cell-composite-list"), "font-size") === "var(--fs-body)" &&
  decl(bodyOf("#settingsCatalogList"), "container-type") === "inline-size" && decl(bodyOf("#settingsCatalogList"), "container-name") === "settings" &&
  decl(bodyOf("#settingsCatalogList"), "font-size") === "var(--fs-body)");
check("labels never wrap inside a state: nowrap, and the label track never shrinks below its content (wide/intermediate)",
  decl(bodyOf(".cell-composite-label"), "white-space") === "nowrap" && /^minmax\(max-content, 1fr\)/.test(decl(cellRow, "grid-template-columns")));
check("no viewport-only breakpoint drives the cell/Settings layout (only the @supports fallback may)",
  css.includes("@supports not (container-type:inline-size)") &&
  !rules.some((r) => r.media && r.media.startsWith("@media") &&
    !r.outer.includes("@supports not (container-type:inline-size)") &&
    r.selectors.some((sel) => /cell-composite-(row|label|calibration|voltage|resistance)|settings-catalog-editor-group|settings-field-shell/.test(sel))));

// Thresholds come from measured minimum content widths at 15 px (Chromium,
// UK -- the longer language: label "Комірка 32" 81.8 px, 9ch 82.9 px, 11ch
// 101.4 px, 18 px row padding each side, 14 px gaps; Settings label basis
// 140 px). The field widths come from the audited CSS tokens themselves.
const px = (v) => Number(v.replace("px", ""));
const tokenPx = (name) => { const m = css.match(new RegExp(`${name}:calc\\((\\d+(?:\\.\\d+)?)px \\+ var\\(--fs-body\\) \\* (\\d+(?:\\.\\d+)?)\\)`)); return Number(m[1]) + 15 * Number(m[2]); };
const actionPx = px(css.match(/--settings-action-width:\s*([\d.]+px)/)[1]);
const calibPx = tokenPx("--cell-calibration-width") + 8 + actionPx;
const M = { label: 81.8, volt: 82.9, res: 101.4, pad: 18 * 2, gap: 14, settingsLabel: 140 };
const needWide = M.pad + M.label + M.gap + M.volt + M.gap + M.res + M.gap + calibPx;
const needIntermediate = Math.max(M.pad + M.label + M.gap + M.volt + M.gap + M.res, M.pad + calibPx);
const needSettings = M.pad + M.settingsLabel + M.gap + tokenPx("--settings-control-width") + 8 + actionPx;
const threshold = (name, maxEm) => rules.some((r) => r.media === `@container ${name} (max-width:${maxEm}em)`);
const em = (maxEm) => (maxEm + 0.01) * 15;
// Each state switches at the first 0.5em step at or above its requirement:
// never earlier (it would overflow), and less than 1em later (no arbitrary slack).
const fits = (maxEm, need) => em(maxEm) >= need && em(maxEm) - need < 15;
check("wide -> intermediate at 37.5em, derived from the measured five-column minimum",
  threshold("cells", 37.49) && fits(37.49, needWide), `${needWide.toFixed(1)} px needed, switch at ${em(37.49).toFixed(1)} px`);
check("intermediate -> narrow at 22.5em, derived from the measured three-column minimum",
  threshold("cells", 22.49) && fits(22.49, needIntermediate), `${needIntermediate.toFixed(1)} px needed, switch at ${em(22.49).toFixed(1)} px`);
check("Settings group drops under its label at 26.5em, derived from label basis + audited field + action",
  threshold("settings", 26.49) && fits(26.49, needSettings), `${needSettings.toFixed(1)} px needed, switch at ${em(26.49).toFixed(1)} px`);

const mid = "@container cells (max-width:37.49em)";
check("intermediate: values stay on the label line; field + action move together to their own right-aligned line",
  decl(bodyOf(".cell-composite-row", mid), "grid-template-columns") === "minmax(max-content, 1fr) var(--cc-volt-w) var(--cc-res-w)" &&
  decl(bodyOf(".cell-composite-row > .cell-composite-calibration", mid), "grid-column") === "1 / -1" &&
  decl(bodyOf(".cell-composite-row > .cell-composite-calibration", mid), "grid-row") === "2" &&
  decl(bodyOf(".cell-composite-row > .cell-composite-calibration", mid), "justify-self") === "end");
const narrow = "@container cells (max-width:22.49em)";
check("narrow: label line, values line (content-sized, cannot overflow at large text), field + action line",
  decl(bodyOf(".cell-composite-row", narrow), "grid-template-columns") === "minmax(0, 1fr) auto auto" &&
  decl(bodyOf(".cell-composite-label", narrow), "grid-column") === "1 / -1" &&
  decl(bodyOf(".cell-composite-row > .cell-composite-calibration", narrow), "grid-row") === "3");
check("the lock/OK never separates from its field: calibration stays one [field | action] grid in every state",
  [null, mid, narrow].every((m) => !find(".cell-composite-calibration > .settings-action-lock", m).some((r) => /grid-row:\s*[2-9]/.test(r.body))) &&
  decl(bodyOf(".cell-composite-calibration", narrow), "grid-template-columns") === "minmax(0, var(--cc-field-w)) var(--cc-action-w)");
const settingsNarrow = "@container settings (max-width:26.49em)";
check("narrow Settings rows: the same compact [field | action] pair, right-aligned, shrinking only when the row is narrower",
  decl(bodyOf(".settings-catalog-editor-group", settingsNarrow), "flex-basis") === "100%" &&
  decl(bodyOf(".settings-catalog-editor-group", settingsNarrow), "justify-content") === "end" &&
  decl(bodyOf(".settings-catalog-editor-group", settingsNarrow), "grid-template-columns") === "minmax(0, var(--sc-field-w)) var(--sc-action-w)");
check("narrowest lists (< 16.5em): tighter shell chrome and field-action gap keep the audited widths beside the action",
  ["cells", "settings"].every((n) => decl(bodyOf(".settings-field-shell", `@container ${n} (max-width:16.49em)`), "padding") === "0 6px") &&
  decl(bodyOf(".cell-composite-calibration", "@container cells (max-width:16.49em)"), "column-gap") === "4px" &&
  decl(bodyOf(".settings-catalog-editor-group", "@container settings (max-width:16.49em)"), "column-gap") === "4px");
check("fallback without container queries keeps the previous viewport states",
  decl(bodyOf(".cell-composite-row > .cell-composite-calibration", "@media (max-width:560px)"), "grid-row") === "2" &&
  decl(bodyOf(".cell-composite-row > .cell-composite-calibration", "@media (max-width:420px)"), "grid-row") === "3" &&
  decl(bodyOf(".settings-catalog-editor-group", "@media (max-width:560px)"), "flex-basis") === "100%");
check("inside the containers the header and unconfirmed text keep their previous absolute size (em would now follow --fs-body)",
  decl(bodyOf(".settings-catalog-group-header"), "font-size") === "12.48px" && decl(bodyOf(".cell-composite-unconfirmed"), "font-size") === "14.4px");

console.log(`\nsettings controls CSS: ${checks - failures}/${checks} passed`);
process.exit(failures ? 1 : 0);
