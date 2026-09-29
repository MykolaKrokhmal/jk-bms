#!/usr/bin/env node
"use strict";

// Clustered reads (plan M5), end to end: the real jk_bms.js (in a vm
// context, the same way the other browser-model tests run it) against the
// real demo/mock-server.js over real HTTP + SSE. Covers the production
// cluster wire format ('<cluster>:<revision>:<sequence>' events and the
// clusters[] snapshot), revision/sequence progress, snapshot resync after a
// lost success event, the latched fallback transition to per-block events,
// and the legacy (pre-M5) block format.
//
// Would fail if the mock (or firmware contract) dropped cluster events or
// clusters[]: block revisions inside a cluster would then not advance in the
// page, or every cluster event would force a snapshot resync.

const fs = require("fs");
const path = require("path");
const http = require("http");
const vm = require("vm");
const { spawn } = require("child_process");
const { pickPort } = require("../release/port");

const ROOT = path.resolve(__dirname, "..", "..");
const source = fs.readFileSync(path.join(ROOT, "jk_bms.js"), "utf8");
const HOST = "127.0.0.1";

let checks = 0;
let failures = 0;
function check(name, condition, detail = "") {
  checks += 1;
  if (!condition) failures += 1;
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` -- ${detail}` : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function request(port, method, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: HOST, port, method, path: pathname }, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

// A real SSE connection to the mock with the EventSource surface jk_bms.js
// uses. `filter(type, data)` returning false drops that event (a lost event
// in transit, as ESPHome's coalescing does).
function makeEventSourceClass(state) {
  return class RealEventSource {
    constructor(url) {
      this.url = String(url);
      this.readyState = 0;
      this.listeners = new Map();
      this.onopen = null; this.onerror = null; this.onmessage = null;
      state.sources.push(this);
      const u = new URL(this.url);
      this.req = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: "GET" }, (res) => {
        this.readyState = 1;
        if (this.onopen) this.onopen({ type: "open" });
        let buf = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          buf += chunk;
          let idx;
          while ((idx = buf.indexOf("\n\n")) !== -1) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            let type = "message";
            const data = [];
            for (const line of frame.split("\n")) {
              if (line.startsWith("event:")) type = line.slice(6).trim();
              else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
            }
            const payload = data.join("\n");
            state.wire.push({ type, data: payload });
            if (this.readyState === 2 || (state.filter && !state.filter(type, payload))) continue;
            const event = { type, data: payload };
            for (const fn of (this.listeners.get(type) || []).slice()) fn(event);
            if (type === "message" && this.onmessage) this.onmessage(event);
          }
        });
      });
      this.req.on("error", () => { if (this.readyState !== 2 && this.onerror) this.onerror({ type: "error" }); });
      this.req.end();
    }
    addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); }
    close() { this.readyState = 2; try { this.req.destroy(); } catch (_) { /* gone */ } }
  };
}

function bootPage(port, state) {
  const fetchLog = [];
  const listeners = { add() {} };
  const window = {
    __JK_BMS_TEST_HOOKS__: {},
    location: { href: `http://${HOST}:${port}/` },
    addEventListener: () => {},
    matchMedia() { return { matches: false }; },
    requestAnimationFrame() { return 1; }, cancelAnimationFrame() {},
    setTimeout, clearTimeout, setInterval, clearInterval,
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  };
  const document = {
    readyState: "complete", visibilityState: "visible",
    addEventListener: () => {},
    getElementById: () => null, querySelector: () => null, querySelectorAll() { return []; },
    scrollingElement: { scrollTop: 0 },
    createElement() { return { getContext() { return { measureText() { return { width: 0 }; } }; } }; },
    activeElement: null,
  };
  async function fetch(url, opts) {
    const method = (opts && opts.method) || "GET";
    const u = new URL(String(url));
    fetchLog.push({ path: u.pathname, method });
    const r = await request(port, method, u.pathname + u.search);
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => JSON.parse(r.body) };
  }
  window.fetch = fetch;
  const sandbox = { window, document, navigator: { language: "en", onLine: true }, URL, console, Map, Date,
    HTMLInputElement: class {}, AbortController, EventSource: makeEventSourceClass(state), fetch };
  void listeners;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "jk_bms.js" });
  return { h: window.__JK_BMS_TEST_HOOKS__, fetchLog };
}

const snapshotGets = (page) => page.fetchLog.filter((f) => f.method === "GET" && f.path === "/settings/read-freshness").length;
const uiBlock = (page, address) => page.h.readFreshnessDebugState().blocks.find(([a]) => a === address);
const uiCluster = (page, id) => page.h.readFreshnessDebugState().clusters.find(([c]) => c === id);
const successEvents = (state) => state.wire
  .filter((e) => { try { return JSON.parse(e.data).id === "text_sensor-read_plan_success"; } catch (_) { return false; } })
  .map((e) => JSON.parse(e.data).state);
async function waitFor(pred, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (pred()) return true; await sleep(50); }
  return pred();
}

async function main() {
  const port = await pickPort();
  const child = spawn(process.execPath, [path.join(ROOT, "demo", "mock-server.js")], {
    cwd: ROOT, env: { ...process.env, PORT: String(port), HOST }, stdio: ["ignore", "pipe", "pipe"],
  });
  let childOutput = "";
  child.stdout.on("data", (c) => { childOutput += c; });
  child.stderr.on("data", (c) => { childOutput += c; });
  const A1_BLOCK = 0x1240;  // cell_connected_mask, inside A1 (0x1200 x120)
  const C1_BLOCK = 0x1000;  // inside C1
  try {
    const up = await waitFor(() => /running at/.test(childOutput), 10000);
    check("mock server started", up, childOutput.slice(0, 200));

    // 1. Normal cluster operation.
    const state = { sources: [], wire: [], filter: null };
    const page = bootPage(port, state);
    page.h.connect();
    const ready = await waitFor(() => page.h.readFreshnessDebugState().ready, 5000);
    check("the page bootstraps from the mock's /settings/read-freshness snapshot", ready && snapshotGets(page) === 1);
    const snap = JSON.parse((await request(port, "GET", "/settings/read-freshness")).body);
    check("the mock snapshot carries clusters[] with the production fields",
      Array.isArray(snap.clusters) && snap.clusters.some((c) => c.id === "A1" && c.start === 0x1200 && c.registers === 120) &&
      snap.clusters.every((c) => ["id", "start", "registers", "mode", "lease", "cadence_ms", "budget_ms", "age_ms", "revision", "sequence"].every((k) => k in c)));
    const g = uiCluster(page, "A1");
    check("the page learned the A1 geometry from the snapshot only", g && g[1] === 0x1200 && g[2] === 0x1200 + 240, JSON.stringify(g));
    const before = uiBlock(page, A1_BLOCK);
    const wireStart = state.wire.length;
    await sleep(3500);
    const events = successEvents({ wire: state.wire.slice(wireStart) });
    const a1 = events.filter((e) => e.startsWith("A1:")).map((e) => e.split(":").map((x, i) => (i ? Number(x) : x)));
    check("the mock emits the production cluster format ('A1:<revision>:<sequence>')",
      a1.length >= 2 && events.every((e) => /^[A-Z][A-Z0-9]*:\d+:\d+$/.test(e)), events.slice(0, 6).join(" "));
    check("A1 revisions advance by exactly 1 per read; the shared sequence only increases",
      a1.every((e, i) => i === 0 || e[1] === a1[i - 1][1] + 1) &&
      events.map((e) => Number(e.split(":")[2])).every((q, i, all) => i === 0 || q > all[i - 1]));
    const after = uiBlock(page, A1_BLOCK);
    check("every A1 event advanced the page's 0x1240 block (inside A1) by one revision",
      before && after && after[1] - before[1] === a1.length && after[2] > before[2], `${before && before[1]} -> ${after && after[1]} over ${a1.length} events`);
    check("the page's A1 cluster revision tracks the wire", uiCluster(page, "A1")[3] === a1[a1.length - 1][1]);
    check("a healthy numbered stream causes no snapshot resync", snapshotGets(page) === 1);
    const c1 = uiBlock(page, C1_BLOCK);
    check("a block outside A1 is not advanced by A1 events", c1 && c1[1] === (snap.blocks.find(([a]) => a === C1_BLOCK) || [])[2]);

    // 2. A lost success event: the sequence jump triggers one snapshot resync.
    let dropped = 0;
    state.filter = (type, data) => {
      if (dropped > 0) return true;
      try { if (JSON.parse(data).id === "text_sensor-read_plan_success") { dropped += 1; return false; } } catch (_) { /* keep */ }
      return true;
    };
    await waitFor(() => dropped > 0, 3000);
    await waitFor(() => snapshotGets(page) === 2, 4000);
    await sleep(300);
    check("after one lost success event the page re-reads the snapshot exactly once", dropped === 1 && snapshotGets(page) === 2, `gets=${snapshotGets(page)}`);
    state.filter = null;
    await sleep(1500);
    const server = JSON.parse((await request(port, "GET", "/settings/read-freshness")).body);
    const serverA1 = server.clusters.find((c) => c.id === "A1").revision;
    check("after the resync the page's A1 revision matches the device again (within the next read)",
      Math.abs(uiCluster(page, "A1")[3] - serverA1) <= 1, `page=${uiCluster(page, "A1")[3]} device=${serverA1}`);

    // 3. Fallback transition: A1 (and its follower A2) latch to per-block reads.
    const latch = await request(port, "POST", "/demo/cluster-fallback?cluster=A1");
    check("the mock latches A1 and its follower A2", latch.status === 200 && JSON.parse(latch.body).mode === "fallback:A1,A2", latch.body);
    await sleep(200);
    const mode = page.h.state.read_cluster_mode;
    check("the page receives read_cluster_mode = fallback:A1,A2", mode && mode.state === "fallback:A1,A2", JSON.stringify(mode));
    // A fallback group's blocks keep their own (pre-migration) cadence, up
    // to 15 s: wait for the first per-block event of an A1/A2 block.
    const fbStart = state.wire.length;
    const fbBefore = new Map(page.h.readFreshnessDebugState().blocks.map(([a, r, t]) => [a, [r, t]]));
    const inA = (a) => a >= 0x1200 && a < 0x12F0 + 30;
    const blockEvent = () => successEvents({ wire: state.wire.slice(fbStart) }).find((e) => /^\d+:/.test(e) && inA(Number(e.split(":")[0])));
    await waitFor(blockEvent, 17000);
    await sleep(200);
    const fbEvents = successEvents({ wire: state.wire.slice(fbStart) });
    const ev = blockEvent();
    check("after the latch A1/A2 never publish a cluster event again", !fbEvents.some((e) => /^A[12]:/.test(e)), fbEvents.join(" "));
    check("... their blocks arrive as per-block events ('<address>:<revision>:<sequence>')", !!ev, fbEvents.slice(0, 6).join(" "));
    const evAddress = ev ? Number(ev.split(":")[0]) : -1;
    const fbAfter = uiBlock(page, evAddress);
    const fbPrior = fbBefore.get(evAddress);
    check("the page keeps that block fresh from its per-block event", !!fbAfter && !!fbPrior && fbAfter[1] > fbPrior[0] && fbAfter[2] > fbPrior[1],
      `${evAddress}: ${fbPrior} -> ${fbAfter}`);
    const fbSnap = JSON.parse((await request(port, "GET", "/settings/read-freshness")).body);
    check("the snapshot reports A1/A2 as fallback (age null) and the others as cluster",
      fbSnap.clusters.filter((c) => c.mode === "fallback").map((c) => c.id).join(",") === "A1,A2" &&
      fbSnap.clusters.find((c) => c.id === "A1").age_ms === null);
    page.h.shutdown && page.h.shutdown();
    for (const s of state.sources) s.close();

    // 4. Legacy (pre-M5) format: block events only, no clusters[].
    await request(port, "POST", "/demo/read-mode?name=legacy");
    const lstate = { sources: [], wire: [], filter: null };
    const legacy = bootPage(port, lstate);
    legacy.h.connect();
    await waitFor(() => legacy.h.readFreshnessDebugState().ready, 5000);
    const lsnap = JSON.parse((await request(port, "GET", "/settings/read-freshness")).body);
    check("legacy mode: the snapshot has no clusters[] and the page learns no geometry",
      !("clusters" in lsnap) && legacy.h.readFreshnessDebugState().clusters.length === 0);
    const lBefore = new Map(legacy.h.readFreshnessDebugState().blocks.map(([a, r]) => [a, r]));
    const lStart = lstate.wire.length;
    await waitFor(() => successEvents({ wire: lstate.wire.slice(lStart) }).length >= 2, 17000);
    await sleep(200);
    const lEvents = successEvents({ wire: lstate.wire.slice(lStart) });
    check("legacy mode: only per-block events", lEvents.length > 0 && lEvents.every((e) => /^\d+:\d+:\d+$/.test(e)), lEvents.slice(0, 4).join(" "));
    const lAddr = lEvents.length ? Number(lEvents[lEvents.length - 1].split(":")[0]) : -1;
    const lAfter = uiBlock(legacy, lAddr);
    check("legacy mode: the page advances blocks from them without any resync",
      !!lAfter && lAfter[1] > lBefore.get(lAddr) && snapshotGets(legacy) === 1, `${lAddr}: ${lBefore.get(lAddr)} -> ${lAfter && lAfter[1]} gets=${snapshotGets(legacy)}`);
    check("only read-only GETs were issued by both pages",
      [...page.fetchLog, ...legacy.fetchLog].every((f) => f.method === "GET"));
    legacy.h.shutdown && legacy.h.shutdown();
    for (const s of lstate.sources) s.close();
  } finally {
    child.kill();
  }
  console.log(`\ncluster mock <-> browser end to end: ${checks - failures}/${checks} passed`);
  process.exit(failures ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });
