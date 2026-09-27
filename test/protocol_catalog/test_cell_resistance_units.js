#!/usr/bin/env node
"use strict";

// Cell wire-resistance unit regression (owner report 2026-09-27): the Cells
// tab showed an already-normalized cell_resistance_N value (mΩ, see
// protocol/registers.canonical.json) as "Ω" in its resistance mode: the
// summary and chart unit, the card placeholder, the average/delta metric
// labels and the cell history. The row itself was already labelled mΩ.
// Only the label changes; the value is rendered exactly as published.
//
// Drives the REAL jk_bms.js closures (renderCells, setCellMode, cellCard,
// metricLabel, historyPointsFor) through window.__JK_BMS_TEST_HOOKS__ with a
// minimal fake DOM; each language is a fresh page load via the real
// navigator.language detection (detectInitialLanguage).

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..", "..");
const source = fs.readFileSync(path.join(ROOT, "jk_bms.js"), "utf8");

let checks = 0;
let failures = 0;
function check(name, condition, detail = "") {
  checks += 1;
  if (!condition) failures += 1;
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` -- ${detail}` : ""}`);
}

class Node {
  constructor(id) {
    this.id = id; this.textContent = ""; this.innerHTML = ""; this.hidden = false; this.disabled = false;
    this.childNodes = []; this.className = ""; this.dataset = {}; this.style = { setProperty() {} };
    const set = new Set();
    this.classList = { add: (c) => set.add(c), remove: (c) => set.delete(c), contains: (c) => set.has(c),
      toggle: (c, on) => { const v = on === undefined ? !set.has(c) : on; if (v) set.add(c); else set.delete(c); return v; } };
  }
  appendChild(c) { this.childNodes.push(c); return c; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  closest() { return null; }
  setAttribute() {}
  getContext() { return { measureText() { return { width: 0 }; } }; }
}

function load(language) {
  const nodes = new Map();
  const node = (id) => { if (!nodes.has(id)) nodes.set(id, new Node(id)); return nodes.get(id); };
  const window = {
    __JK_BMS_TEST_HOOKS__: {}, location: { href: "http://jk-bms.local/" }, addEventListener() {}, matchMedia() { return { matches: false }; },
    requestAnimationFrame() { return 0; }, cancelAnimationFrame() {}, setInterval() { return 0; }, clearInterval() {}, setTimeout() { return 0; }, clearTimeout() {},
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  };
  const document = {
    readyState: "complete", addEventListener() {}, getElementById: (id) => node(id), querySelector: () => null, querySelectorAll() { return []; },
    documentElement: new Node("html"), scrollingElement: { scrollTop: 0 }, createElement: (tag) => new Node(tag),
  };
  const sandbox = { window, document, navigator: { language }, URL, console, Map, HTMLInputElement: class {} };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "jk_bms.js" });
  return { h: window.__JK_BMS_TEST_HOOKS__, node };
}

const volts = [3.301, 3.252, 3.403, 3.354];
const res = [0.053, 0.061, 0.049, 0.057];
const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
for (const [lang, unit, voltUnit] of [["en", "mΩ", "V"], ["uk", "мОм", "В"]]) {
  const { h, node } = load(lang === "uk" ? "uk-UA" : "en-US");
  const tag = lang.toUpperCase();
  const feed = (id, value, text) => h.ingestPayload({ id, value, state: text === undefined ? String(value) : text });
  feed("text_sensor/topology state", "CONFIRMED");
  feed("sensor/display cell count", 4);
  volts.forEach((v, i) => feed(`sensor/cell voltage ${i + 1}`, v, `${v.toFixed(3)} V`));
  res.forEach((r, i) => feed(`sensor/cell ${i + 1} wire resistance`, r, `${r.toFixed(3)} mΩ`));

  // Numeric values are untouched: no x1000 / /1000 anywhere on the path.
  check(`${tag} the published resistance reaches state unchanged (0.053, no scaling)`, h.numeric("cell_resistance_1") === 0.053, String(h.numeric("cell_resistance_1")));
  check(`${tag} the canonical unit of cell_resistance_N is mΩ / мОм`, h.PROTOCOL_CATALOG.fieldMeta.cell_resistance_1.unit === "mΩ" &&
    h.PROTOCOL_CATALOG.fieldMeta.cell_resistance_1.ukUnit === "мОм");

  // Voltage mode is unchanged.
  h.setCellMode("v");
  check(`${tag} voltage mode: the row shows volts first and mΩ below`,
    node("cellPrimary0").innerHTML === `3.301<i>${voltUnit}</i>` && node("cellTertiary0").innerHTML === `0.053<i>${unit}</i>`,
    `${node("cellPrimary0").innerHTML} | ${node("cellTertiary0").innerHTML}`);
  check(`${tag} voltage mode: summary stays in volts`, node("statAvgCells").textContent === `${avg(volts).toFixed(3)} ${voltUnit}`, node("statAvgCells").textContent);

  // Resistance mode.
  h.setCellMode("r");
  check(`${tag} resistance mode: the cell row shows 0.053 ${unit}`, node("cellPrimary0").innerHTML === `0.053<i>${unit}</i>`, node("cellPrimary0").innerHTML);
  const rAvg = avg(res.map((r) => Math.fround(r)));
  check(`${tag} resistance mode: average in ${unit}, same number`, node("statAvgCells").textContent === `${rAvg.toFixed(3)} ${unit}`, node("statAvgCells").textContent);
  check(`${tag} resistance mode: min / max in ${unit}`, node("statMinCells").textContent === `0.049 ${unit}` && node("statMaxCells").textContent === `0.061 ${unit}`,
    `${node("statMinCells").textContent} / ${node("statMaxCells").textContent}`);
  check(`${tag} resistance mode: delta in ${unit}`, node("statDeltaCells").textContent === `0.012 ${unit}`, node("statDeltaCells").textContent);
  const cardsAndStats = ["cellPrimary0", "cellPrimary1", "cellPrimary2", "cellPrimary3", "statAvgCells", "statMinCells", "statMaxCells", "statDeltaCells"]
    .map((id) => node(id).innerHTML + node(id).textContent).join(" ");
  check(`${tag} resistance mode: no bare Ω anywhere in the row/summary`, !/(^|[^m])Ω/.test(cardsAndStats), cardsAndStats);

  // Placeholder markup before any data.
  check(`${tag} card placeholder labels resistance ${unit}`, h.cellCard(0).includes(`id="cellTertiary0">--<i>${unit}</i>`));

  // Average / delta resistance trend metrics.
  check(`${tag} avgResistance / deltaResistance metrics use mΩ (3 decimals)`,
    JSON.stringify(h.metricLabel("avgResistance").slice(1)) === '["mΩ",3]' && JSON.stringify(h.metricLabel("deltaResistance").slice(1)) === '["mΩ",3]');

  // Cell history in resistance mode (synthetic series ending at the live value).
  h.setHistoryContext({ kind: "cell", cellIndex: 0, mode: "r" });
  const hist = h.historyPointsFor();
  check(`${tag} cell history (resistance) reports unit mΩ and ends at the live 0.053`,
    hist.unit === "mΩ" && hist.digits === 3 && Math.abs(hist.pts[hist.pts.length - 1] - 0.053) < 1e-6,
    `${hist.unit} ${hist.pts[hist.pts.length - 1]}`);
  h.setHistoryContext({ kind: "cell", cellIndex: 0, mode: "v" });
  check(`${tag} cell history (voltage) still reports V`, h.historyPointsFor().unit === "V");
}

// The history renderer localizes whatever unit the series reports.
const drawHistory = source.slice(source.indexOf("const { pts, unit, digits, real, intervalS } = historyPointsFor();"));
check("history min/avg/max and the modal unit are rendered through unitLabel(unit)",
  /const unitDisplay = unitLabel\(unit\);[\s\S]{0,400}histMin[\s\S]{0,200}histAvg[\s\S]{0,200}histMax[\s\S]{0,240}cellModalUnit\.textContent = unitDisplay;/.test(drawHistory));
check("no Cells-tab path labels cell resistance with a bare \"Ω\" token",
  !/"V" : "Ω"|unitLabel\("Ω"\)|Resistance: \["Ω"/.test(source));

console.log(`\ncell resistance units: ${checks - failures}/${checks} passed`);
process.exit(failures ? 1 : 0);
