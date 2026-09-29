#!/usr/bin/env node
"use strict";

// Browser resume / SSE reconnect regression (owner-reported defect,
// 2026-09-25): after a Mac slept with the UI open, the page never restored
// its data flow until a manual refresh. Root causes in the previous
// connect(): (1) no page-owned reconnection -- a native EventSource that
// reached readyState CLOSED (HTTP error on retry) was never replaced;
// (2) no progress watchdog -- a half-open socket after sleep stayed "OPEN"
// with no events and no error, forever "connected"; (3) pagehide tore the
// connection down with {once:true} and nothing reopened it on a
// back/forward-cache pageshow; (4) no visibility/online/resume handling;
// (5) a reconnect reused the previous connection's bms_health as LIVE.
//
// This drives the REAL connection manager (window.__JK_BMS_TEST_HOOKS__:
// connect/checkConnection/sseWatchdogTick/connectionDebugState plus the real
// ingest/freshness closures) with a controlled clock, a controlled timer
// queue and a fake EventSource. No UI logic is reimplemented here.

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { Clock, makeControlledDate, TimerQueue, FakeEventSource, ListenerRegistry, flush } = require("./sse_test_harness");

const ROOT = path.resolve(__dirname, "..", "..");
const source = fs.readFileSync(path.join(ROOT, "jk_bms.js"), "utf8");

let checks = 0;
let failures = 0;
function check(name, condition, detail = "") {
  checks += 1;
  if (!condition) failures += 1;
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` -- ${detail}` : ""}`);
}

const SMART_SLEEP_BLOCK = 0x1000;

function boot() {
  FakeEventSource.reset();
  const clock = new Clock(1000000);
  const timers = new TimerQueue(clock);
  const winListeners = new ListenerRegistry();
  const docListeners = new ListenerRegistry();
  const fetchLog = [];
  const navigator = { language: "en", onLine: true };
  let snapshotAgeMs = 0;
  let snapshotRevision = 1;
  let snapshotFails = false;
  let snapshotClusters = null;  // null = a pre-M5 snapshot without clusters[]
  let holdNext = false;
  const held = [];
  const window = {
    __JK_BMS_TEST_HOOKS__: {},
    location: { href: "http://jk-bms.local/" },
    addEventListener: (type, fn) => winListeners.add(type, fn),
    matchMedia() { return { matches: false }; },
    requestAnimationFrame() { return 1; }, cancelAnimationFrame() {},
    setTimeout: (cb, ms) => timers.setTimeout(cb, ms), clearTimeout: (id) => timers.clear(id),
    setInterval: (cb, ms) => timers.setInterval(cb, ms), clearInterval: (id) => timers.clear(id),
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  };
  const document = {
    readyState: "complete",
    visibilityState: "visible",
    addEventListener: (type, fn) => docListeners.add(type, fn),
    getElementById: () => null, querySelector: () => null, querySelectorAll() { return []; },
    scrollingElement: { scrollTop: 0 },
    createElement() { return { getContext() { return { measureText() { return { width: 0 }; } }; } }; },
    activeElement: null,
  };
  async function fetch(url, opts) {
    const method = (opts && opts.method) || "GET";
    fetchLog.push({ url: String(url), method });
    if (method === "GET" && String(url).endsWith("/settings/read-freshness")) {
      if (snapshotFails) return { ok: false, status: 503, json: async () => ({}) };
      const response = { ok: true, status: 200, json: async () => (snapshotClusters
        ? { blocks: [[SMART_SLEEP_BLOCK, snapshotAgeMs, snapshotRevision]], clusters: snapshotClusters.map((c) => ({ ...c })) }
        : { blocks: [[SMART_SLEEP_BLOCK, snapshotAgeMs, snapshotRevision]] }) };
      // A held response resolves only when the test releases it (in flight).
      if (holdNext) { holdNext = false; return new Promise((resolve) => { held.push(() => resolve(response)); }); }
      return response;
    }
    throw new Error(`unexpected ${method} ${url}`);
  }
  window.fetch = fetch;
  const sandbox = {
    window, document, navigator, URL, console, Map, HTMLInputElement: class {}, AbortController,
    Date: makeControlledDate(clock), EventSource: FakeEventSource, fetch,
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "jk_bms.js" });
  const h = window.__JK_BMS_TEST_HOOKS__;
  const page = {
    h, clock, timers, winListeners, docListeners, fetchLog, navigator, document,
    setSnapshot(ageMs, revision) { snapshotAgeMs = ageMs; snapshotRevision = revision; },
    failSnapshot(value) { snapshotFails = value; },
    setClusters(list) { snapshotClusters = list; },
    holdNextSnapshot() { holdNext = true; },
    releaseHeld() { const all = held.splice(0); all.forEach((fn) => fn()); return all.length; },
    es() { return FakeEventSource.instances[FakeEventSource.instances.length - 1]; },
    count() { return FakeEventSource.instances.length; },
    live() { return FakeEventSource.live().length; },
    dbg() { return h.connectionDebugState(); },
    writes() { return fetchLog.filter((f) => f.method !== "GET").length; },
    health(es, value) { es.emit("state", { id: "text_sensor/bms health", state: value, value }); },
    blockRead(es, revision) { es.emit("state", { id: "text_sensor/read plan success", state: `${SMART_SLEEP_BLOCK}:${revision}`, value: `${SMART_SLEEP_BLOCK}:${revision}` }); },
    smartSleep(es) { es.emit("state", { id: "smart_sleep", state: "3.321 V", value: 3.321 }); },
    ping(es) { es.emit("ping", JSON.stringify({ uptime: 1 })); },
    fresh() { return h.settingsFieldFreshness("smart_sleep").kind; },
    tier() { return h.combinedFreshness(); },
  };
  return page;
}

// Reaches a confirmed, LIVE, fresh steady state on the first connection.
async function establish(p) {
  p.h.connect();
  const es = p.es();
  es.open();
  await flush();
  p.smartSleep(es);
  p.health(es, "LIVE");
  p.clock.value += 1;
  p.blockRead(es, 2);
  return es;
}

async function main() {
  const T = boot().h.SSE_TIMING;

  // 1. Normal initial connection.
  let p = boot();
  p.h.connect();
  check("1: connect() creates exactly one EventSource and the link is 'connecting'",
    p.count() === 1 && p.live() === 1 && p.dbg().browserLink === "connecting" && p.dbg().generation === 1);
  check("1: before open, the page is pending (never live) and Settings is not fresh", p.tier() === "pending" && p.fresh() !== "fresh");
  p.es().open();
  await flush();
  check("1: open confirms the link and fetches the read-freshness snapshot once (GET only)",
    p.dbg().browserLink === "connected" && p.fetchLog.length === 1 && p.fetchLog[0].method === "GET");
  p.smartSleep(p.es());
  p.health(p.es(), "LIVE");
  p.clock.value += 1;
  p.blockRead(p.es(), 2);
  check("1: health + post-snapshot block read -> live and fresh", p.tier() === "live" && p.fresh() === "fresh");
  const winListenerTotal = p.winListeners.total();
  const docListenerTotal = p.docListeners.total();
  check("1: lifecycle listeners installed once (pageshow/pagehide/online/offline, visibilitychange/resume)",
    p.winListeners.count("pageshow") === 1 && p.winListeners.count("pagehide") === 1 && p.winListeners.count("online") === 1 &&
    p.winListeners.count("offline") === 1 && p.docListeners.count("visibilitychange") === 1 && p.docListeners.count("resume") === 1);
  check("1: one watchdog + one stale-sweep interval, no reconnect timer", p.timers.count("interval") === 2 && !p.dbg().reconnectTimerActive);

  // 2. EventSource error followed by a successful reconnect.
  p = boot();
  let first = await establish(p);
  first.fail();
  check("2: an error closes the failed EventSource and marks the link reconnecting",
    first.readyState === 2 && p.live() === 0 && p.dbg().browserLink === "reconnecting" && p.dbg().reconnectTimerActive);
  check("2: reconnecting -> Settings immediately not fresh (offline)", p.fresh() === "offline" && p.tier() === "reconnecting");
  p.timers.advance(T.RECONNECT_BASE_MS - 1);
  check("2: no new EventSource before the base backoff delay", p.count() === 1);
  p.timers.advance(1);
  let second = p.es();
  check("2: exactly one new EventSource after the base delay, with a new generation",
    p.count() === 2 && p.live() === 1 && second !== first && p.dbg().generation === 2 && !p.dbg().reconnectTimerActive);
  second.open();
  await flush();
  check("2: reconnect confirmed but no health on this connection -> reconnecting, not live",
    p.dbg().browserLink === "connected" && p.tier() === "reconnecting" && p.fresh() === "offline");
  p.health(second, "LIVE");
  p.clock.value += 1;
  p.blockRead(second, 3);
  check("2: this connection's health + post-boundary block read -> live and fresh", p.tier() === "live" && p.fresh() === "fresh");

  // 2b. Native EventSource giving up for good (readyState CLOSED) is replaced too.
  p = boot();
  first = await establish(p);
  first.fail({ permanent: true });
  p.timers.advance(T.RECONNECT_BASE_MS);
  check("2b: a permanently CLOSED EventSource is replaced by the page", p.count() === 2 && p.live() === 1);

  // Bounded, capped backoff; never a tight loop; never >1 timer or EventSource.
  p = boot();
  first = await establish(p);
  const created = [];
  let maxLive = 0;
  let maxTimers = 0;
  first.fail();
  for (let i = 0; i < 12; i += 1) {
    const before = p.count();
    const start = p.clock.now();
    while (p.count() === before) {
      p.timers.advance(250);
      maxLive = Math.max(maxLive, p.live());
      maxTimers = Math.max(maxTimers, p.timers.count("timeout") - (p.dbg().browserLink === "reconnecting" ? 1 : 0));
      if (p.clock.now() - start > 120000) break;
    }
    created.push(p.clock.now() - start);
    p.es().fail();
  }
  const delays = created.map((d) => Math.round(d / 1000));
  check("backoff: 1,2,4,8,16 s then capped at 30 s", JSON.stringify(delays) === JSON.stringify([1, 2, 4, 8, 16, 30, 30, 30, 30, 30, 30, 30]),
    JSON.stringify(delays));
  check("backoff: never more than one EventSource or reconnect timer at a time", maxLive <= 1 && maxTimers <= 1, `live=${maxLive} timers=${maxTimers}`);
  check("reconnect failure: link escalates to disconnected and Settings stays blocked, zero writes",
    p.dbg().browserLink === "disconnected" && p.tier() === "offline" && p.fresh() === "offline" && p.writes() === 0);
  p.timers.advance(T.RECONNECT_MAX_MS);
  check("reconnect failure: a retry keeps 'disconnected' (no flicker) until a connection actually opens",
    p.live() === 1 && p.dbg().browserLink === "disconnected");
  const beforeRecovery = p.count();
  p.es().open();
  await flush();
  check("reconnect failure: the next success resets the backoff only after real traffic",
    p.dbg().reconnectAttempt > 0 && p.count() === beforeRecovery);
  p.ping(p.es());
  check("reconnect failure: a ping alone does not reset the backoff (no application data yet)", p.dbg().reconnectAttempt > 0);
  p.health(p.es(), "LIVE");
  check("reconnect failure: first real data resets the backoff", p.dbg().reconnectAttempt === 0);

  // 3. offline -> online.
  p = boot();
  first = await establish(p);
  p.navigator.onLine = false;
  p.winListeners.dispatch("offline");
  check("3: offline closes the stream, marks reconnecting, schedules nothing",
    p.live() === 0 && p.dbg().browserLink === "reconnecting" && !p.dbg().reconnectTimerActive && p.fresh() === "offline");
  p.timers.advance(120000);
  check("3: while offline the watchdog creates no connection (no loop)", p.count() === 1 && p.dbg().browserLink === "disconnected");
  p.navigator.onLine = true;
  p.winListeners.dispatch("online");
  check("3: online immediately opens exactly one new EventSource", p.count() === 2 && p.live() === 1);
  p.es().open();
  await flush();
  p.health(p.es(), "LIVE");
  p.clock.value += 1;
  p.blockRead(p.es(), 3);
  check("3: after online + health + block read -> live and fresh", p.tier() === "live" && p.fresh() === "fresh");

  // 4. visible -> hidden -> long sleep -> visible (half-open socket: OPEN, no error, no data).
  p = boot();
  first = await establish(p);
  p.document.visibilityState = "hidden";
  p.docListeners.dispatch("visibilitychange");
  check("4: becoming hidden does not touch a healthy connection", p.count() === 1 && first.readyState === 1);
  p.timers.suspend(60 * 60 * 1000);
  p.document.visibilityState = "visible";
  p.docListeners.dispatch("visibilitychange");
  check("4: visible after a 1 h sleep with a silent OPEN stream -> immediate new connection, old one closed",
    p.count() === 2 && p.live() === 1 && first.readyState === 2 && p.dbg().browserLink === "reconnecting");
  check("4: while unconfirmed the UI is reconnecting and Settings offline", p.tier() === "reconnecting" && p.fresh() === "offline");

  // 5. pageshow after back/forward-cache suspension.
  p = boot();
  first = await establish(p);
  p.winListeners.dispatch("pagehide", { persisted: true });
  check("5: pagehide(persisted) closes the stream and stops the connection timers",
    first.readyState === 2 && p.live() === 0 && p.timers.count() === 0 && p.dbg().suspended);
  p.timers.suspend(10 * 60 * 1000);
  p.timers.advance(60000);
  check("5: nothing reconnects while the page is in the cache", p.count() === 1);
  p.winListeners.dispatch("pageshow", { persisted: true });
  check("5: pageshow(persisted) reopens exactly one stream and restarts exactly the two intervals",
    p.count() === 2 && p.live() === 1 && !p.dbg().suspended && p.timers.count("interval") === 2 && p.dbg().browserLink === "reconnecting");
  check("5: pageshow adds no duplicate listeners", p.winListeners.total() === winListenerTotal && p.docListeners.total() === docListenerTotal);

  // 6. Timer jump larger than the disconnect threshold (sleep while visible).
  p = boot();
  first = await establish(p);
  p.timers.advance(T.SSE_WATCHDOG_INTERVAL_MS); // one normal tick
  p.ping(first);
  p.timers.suspend(T.DISCONNECTED_ESCALATION_MS * 5);
  p.timers.advance(0);
  check("6: a late watchdog tick after a silent sleep reconnects immediately (no backoff wait)",
    p.count() === 2 && p.live() === 1 && first.readyState === 2);
  // A late tick while the stream kept delivering (timers throttled, the
  // machine awake) does not disturb it.
  p = boot();
  first = await establish(p);
  p.timers.advance(T.SSE_WATCHDOG_INTERVAL_MS);
  for (let i = 0; i < 8; i += 1) { p.clock.value += 2000; p.health(first, "LIVE"); }
  p.timers.advance(0);
  check("6: a late tick with continuous traffic keeps the working connection", p.count() === 1 && first.readyState === 1);
  // But traffic that is the first thing to run after a real gap is a sleep
  // boundary, not proof that the pre-sleep stream still works.
  p = boot();
  first = await establish(p);
  p.timers.advance(T.SSE_WATCHDOG_INTERVAL_MS);
  p.timers.suspend(T.DISCONNECTED_ESCALATION_MS * 2);
  p.ping(first); // the old socket's ping ran before the late tick
  p.timers.advance(0);
  check("6: a ping arriving first after a sleep gap replaces the stream (one new EventSource)",
    p.count() === 2 && p.live() === 1 && first.readyState === 2 && p.tier() !== "live");

  // 7. EventSource that stays OPEN but delivers nothing.
  p = boot();
  first = await establish(p);
  p.timers.advance(T.SSE_STALL_MS - 1000);
  check("7: under the stall limit the silent stream is kept", p.count() === 1 && p.dbg().browserLink === "connected");
  p.timers.advance(T.SSE_WATCHDOG_INTERVAL_MS + 1000);
  check("7: past the stall limit the stream is declared lost (reconnecting, Settings offline)",
    first.readyState === 2 && p.dbg().browserLink === "reconnecting" && p.fresh() === "offline");
  p.timers.advance(T.RECONNECT_BASE_MS);
  check("7: and replaced by exactly one new EventSource through the backoff", p.count() === 2 && p.live() === 1);
  // Pings plus the firmware's 2 s bms_health keep a stream alive.
  p = boot();
  first = await establish(p);
  for (let i = 0; i < 100; i += 1) { p.timers.advance(2000); p.health(first, "LIVE"); if (i % 5 === 0) p.ping(first); }
  check("7: ESPHome pings every 10 s plus bms_health every 2 s keep the stream alive for 200 s", p.count() === 1 && first.readyState === 1);

  // 8. Several resume/online events arriving together.
  p = boot();
  first = await establish(p);
  p.timers.suspend(30 * 60 * 1000);
  p.document.visibilityState = "visible";
  p.docListeners.dispatch("visibilitychange");
  p.winListeners.dispatch("pageshow", { persisted: false });
  p.docListeners.dispatch("resume");
  p.winListeners.dispatch("online");
  p.timers.advance(0);
  check("8: a burst of visible/pageshow/resume/online/late-tick creates exactly one new EventSource",
    p.count() === 2 && p.live() === 1 && !p.dbg().reconnectTimerActive, `created=${p.count()} live=${p.live()}`);
  check("8: the burst installed no extra listeners", p.winListeners.total() === winListenerTotal && p.docListeners.total() === docListenerTotal);

  // 9. Stale events from a superseded EventSource.
  p = boot();
  first = await establish(p);
  first.fail();
  p.timers.advance(T.RECONNECT_BASE_MS);
  second = p.es();
  second.open();
  await flush();
  p.health(second, "LIVE");
  p.clock.value += 1;
  p.blockRead(second, 3);
  const gen = p.dbg().generation;
  p.health(first, "OFFLINE");
  first.emit("state", { id: "smart_sleep", state: "9.999 V", value: 9.999 });
  if (first.onerror) first.onerror({});
  if (first.onopen) first.onopen({});
  check("9: events and callbacks from a superseded EventSource change nothing",
    p.tier() === "live" && p.fresh() === "fresh" && p.h.state.smart_sleep.value === 3.321 && p.dbg().generation === gen &&
    p.live() === 1 && p.dbg().browserLink === "connected");

  // 10. Reconnect, health BEFORE freshness.
  p = boot();
  first = await establish(p);
  p.clock.value += 500;
  first.fail();
  p.timers.advance(T.RECONNECT_BASE_MS);
  second = p.es();
  p.setSnapshot(T.RECONNECT_BASE_MS + 400, 2); // last read 100 ms BEFORE the loss
  second.open();
  await flush();
  p.health(second, "LIVE");
  check("10: health before freshness -> link live, Settings still offline (read predates the loss)",
    p.tier() === "live" && p.fresh() === "offline");
  p.clock.value += 1;
  p.blockRead(second, 3);
  check("10: then a post-boundary block read -> fresh", p.fresh() === "fresh");

  // 11. Reconnect, freshness BEFORE health.
  p = boot();
  first = await establish(p);
  first.fail();
  p.timers.advance(T.RECONNECT_BASE_MS);
  second = p.es();
  second.open();
  await flush();
  p.clock.value += 1;
  p.blockRead(second, 3);
  check("11: freshness before this connection's health -> still not writable", p.fresh() === "offline" && p.tier() === "reconnecting");
  p.health(second, "LIVE");
  check("11: then health -> fresh and live", p.fresh() === "fresh" && p.tier() === "live");
  p.health(second, "STALE");
  check("11: a non-healthy report on the new connection blocks again", p.fresh() === "offline");

  // 12. Reconnect whose read-freshness snapshot fails -> fail closed.
  p = boot();
  first = await establish(p);
  first.fail();
  p.timers.advance(T.RECONNECT_BASE_MS);
  second = p.es();
  p.failSnapshot(true);
  second.open();
  await flush();
  p.health(second, "LIVE");
  p.clock.value += 1;
  p.blockRead(second, 3);
  check("12: failed snapshot after reconnect -> link live but Settings never fresh (fail closed)",
    p.tier() === "live" && p.fresh() !== "fresh", p.fresh());
  check("12: zero non-GET requests", p.writes() === 0);

  check("13: only GET /settings/read-freshness was ever fetched",
    p.fetchLog.every((f) => f.method === "GET" && f.url.endsWith("/settings/read-freshness")));

  // R. Real Mac sleep/resume (owner report 2026-09-27: after wake the header
  // said LIVE while Settings cell values stayed stale/amber and writes stayed
  // locked; it recovered by itself after ~57 s). While the machine sleeps no
  // JavaScript runs, so a stream gap cannot be told apart from a lost
  // connection. The first thing to run after wake may be SSE traffic (a
  // ping, bms_health, a read success) rather than the watchdog timer.
  {
    const sleepFor = 10 * 60 * 1000;
    const health = (p, es, v = "LIVE") => p.health(es, v);
    const healthy = async (p, es, ms) => {  // a real stream: data every 2 s, ping every 10 s
      for (let t = 0; t < ms; t += 2000) {
        p.timers.advance(2000);
        health(p, es);
        if (t % 10000 === 0) p.ping(es);
      }
      await flush();
    };
    const wakeScenario = async (first) => {
      const p = boot();
      const es = await establish(p);
      await healthy(p, es, 20000);
      check(`R[${first}]: before sleep the page is live and fresh`, p.tier() === "live" && p.fresh() === "fresh");
      p.timers.suspend(sleepFor);  // no timer, no event handler runs
      if (first === "ping") p.ping(es);
      else if (first === "health") health(p, es);
      else if (first === "read") p.blockRead(es, 99);
      await flush();
      return { p, es };
    };
    for (const first of ["ping", "health", "read"]) {
      const { p, es } = await wakeScenario(first);
      check(`R[${first}]: the first post-wake ${first} event cannot hide the sleep boundary (new connection generation, old one closed)`,
        p.count() === 2 && es.readyState === 2 && p.live() === 1, `count=${p.count()} old=${es.readyState}`);
      check(`R[${first}]: pre-sleep health cannot keep the header LIVE (reconnecting until this connection's own health)`,
        p.tier() !== "live", `tier=${p.tier()}`);
      check(`R[${first}]: pre-sleep freshness cannot unlock writes`, p.fresh() !== "fresh", p.fresh());
      // The new connection recovers both global health and Settings freshness.
      const t0 = p.clock.now();
      const next = p.es();
      p.setSnapshot(500, 7);  // the device kept reading while we slept
      next.open();
      await flush();
      const tOpen = p.clock.now() - t0;
      health(p, next);
      const tHealth = p.clock.now() - t0;
      p.clock.value += 1;
      p.blockRead(next, 8);  // a post-boundary read success on this connection
      await flush();
      check(`R[${first}]: after the new connection's health + post-boundary snapshot -> live and fresh`,
        p.tier() === "live" && p.fresh() === "fresh", `tier=${p.tier()} fresh=${p.fresh()} open=${tOpen}ms health=${tHealth}ms`);
      p.timers.advance(0);
      check(`R[${first}]: the late watchdog tick after wake adds no second new connection`, p.count() === 2 && p.live() === 1);
    }

    // The dropped boundary event (possibly buffered before the sleep) never
    // reaches the page state, not only the freshness gates.
    {
      const p = boot();
      const es = await establish(p);
      await healthy(p, es, 10000);
      const before = p.h.state.smart_sleep.value;
      p.timers.suspend(sleepFor);
      es.emit("state", { id: "smart_sleep", state: "9.999 V", value: 9.999 });
      await flush();
      check("R[dropped]: the first post-wake event is dropped, not ingested", p.count() === 2 && before === 3.321 && p.h.state.smart_sleep.value === before,
        `${before} -> ${p.h.state.smart_sleep.value}`);
    }

    // Hidden, sleep, then visible (visibilitychange first).
    {
      const p = boot();
      const es = await establish(p);
      p.document.visibilityState = "hidden";
      p.docListeners.dispatch("visibilitychange");
      p.timers.suspend(sleepFor);
      p.document.visibilityState = "visible";
      p.docListeners.dispatch("visibilitychange");
      p.ping(es);  // then the old stream's ping
      await flush();
      check("R[hidden]: visible after sleep opens exactly one new connection; the late ping changes nothing",
        p.count() === 2 && es.readyState === 2 && p.live() === 1 && p.tier() !== "live");
    }

    // pageshow + resume + visible + late tick burst after a ping-first wake.
    {
      const { p } = await wakeScenario("ping");
      p.winListeners.dispatch("pageshow", { persisted: false });
      p.docListeners.dispatch("resume");
      p.docListeners.dispatch("visibilitychange");
      p.winListeners.dispatch("online");
      p.timers.advance(0);
      await flush();
      check("R[burst]: a ping-first wake plus a lifecycle burst still yields exactly one new EventSource and no reconnect timer",
        p.count() === 2 && p.live() === 1 && !p.dbg().reconnectTimerActive);
    }

    // A healthy uninterrupted stream is never reconnected (30 min).
    {
      const p = boot();
      const es = await establish(p);
      await healthy(p, es, 30 * 60 * 1000);
      check("R[healthy]: 30 min of normal traffic (health every 2 s, ping every 10 s) never reconnects", p.count() === 1 && es.readyState === 1 && p.tier() === "live");
    }
    // Timers late (throttled) while traffic kept flowing: not a sleep.
    {
      const p = boot();
      const es = await establish(p);
      await healthy(p, es, 10000);
      for (let t = 0; t < 40000; t += 2000) { p.clock.value += 2000; health(p, es); }  // timers frozen 40 s, events continuous
      p.timers.advance(0);
      await flush();
      check("R[throttled]: a late watchdog tick with continuous traffic keeps the connection", p.count() === 1 && es.readyState === 1 && p.tier() === "live");
    }
    // An awake page (timers running) with a 20 s quiet spell is not a sleep:
    // only the watchdog's 30 s limit decides, so the stream is kept.
    {
      const p = boot();
      const es = await establish(p);
      await healthy(p, es, 10000);
      p.timers.advance(20000);
      health(p, es);
      await flush();
      check("R[awake-gap]: a 20 s quiet spell with timers running keeps the stream and ingests the next event",
        p.count() === 1 && es.readyState === 1 && p.tier() === "live");
    }
    // Pings but no application data (bms_health is published every 2 s by the firmware).
    {
      const p = boot();
      const es = await establish(p);
      let replacedAt = null;
      for (let t = 0; t < 120000 && replacedAt === null; t += 1000) {
        p.timers.advance(1000);
        if (t % 10000 === 0) p.ping(es);
        if (es.readyState === 2) replacedAt = t;
      }
      check("R[ping-only]: a stream delivering only pings is declared lost within the stall limit",
        replacedAt !== null && replacedAt <= T.SSE_STALL_MS + T.SSE_WATCHDOG_INTERVAL_MS, `replaced at ${replacedAt} ms`);
    }

    // Wake with a dead socket while Wi-Fi/routing is still recovering.
    const recoverAfterWake = async (networkUpAfterMs) => {
      const p = boot();
      const es = await establish(p);
      await healthy(p, es, 10000);
      p.timers.suspend(sleepFor);
      const tWake = p.clock.now();
      const seen = new Set([es]);
      let tOpen = null;
      for (let t = 0; t <= 180000 && tOpen === null; t += 250) {
        p.timers.advance(250);
        const cur = p.es();
        if (!seen.has(cur)) {
          seen.add(cur);
          if (p.clock.now() - tWake < networkUpAfterMs) cur.fail();
          else { p.setSnapshot(500, 7); cur.open(); await flush(); tOpen = p.clock.now() - tWake; }
        }
      }
      return { p, tOpen, attempts: seen.size - 1 };
    };
    {
      const r = await recoverAfterWake(35000);
      check("R[network-35s]: after wake the first successful reconnect follows the network within 6 s (not the 30 s backoff cap)",
        r.tOpen !== null && r.tOpen <= 35000 + 6000, `open after ${r.tOpen} ms, ${r.attempts} attempts`);
      r.p.health(r.p.es(), "LIVE");
      await flush();
      r.p.clock.value += 1;
      r.p.blockRead(r.p.es(), 8);
      await flush();
      check("R[network-35s]: then health and Settings recover on that connection", r.p.tier() === "live" && r.p.fresh() === "fresh", `tier=${r.p.tier()} fresh=${r.p.fresh()}`);
    }
    {
      // A genuine prolonged outage keeps bounded exponential backoff after the wake window.
      const p = boot();
      const es = await establish(p);
      es.fail();
      const created = [];
      let last = p.clock.now();
      for (let t = 0; t < 10 * 60 * 1000; t += 250) {
        const before = p.count();
        p.timers.advance(250);
        if (p.count() !== before) { created.push(p.clock.now() - last); last = p.clock.now(); p.es().fail(); }
      }
      const tail = created.slice(-5).map((d) => Math.round(d / 1000));
      check("R[outage]: a real outage (no wake) still backs off to the 30 s cap and never loops tightly",
        tail.every((d) => d === 30) && created.every((d) => d >= 1000), JSON.stringify(created.map((d) => Math.round(d / 1000))));
      // A lifecycle signal while a 30 s timer is pending: one immediate safe retry.
      check("R[outage]: a reconnect timer is pending", p.dbg().reconnectTimerActive);
      const n = p.count();
      p.setSnapshot(500, 7);
      p.document.visibilityState = "visible";
      p.docListeners.dispatch("visibilitychange");
      p.winListeners.dispatch("online");
      check("R[outage]: visible/online while a long timer is pending retries once, immediately, without duplicates",
        p.count() === n + 1 && p.live() === 1 && !p.dbg().reconnectTimerActive);
      p.es().open();
      await flush();
      p.health(p.es(), "LIVE");
      p.clock.value += 1;
      p.blockRead(p.es(), 8);
      await flush();
      check("R[outage]: that retry recovers global health and Settings freshness", p.tier() === "live" && p.fresh() === "fresh");
    }
    // Stale callbacks from the superseded stream after a sleep boundary.
    {
      const { p, es } = await wakeScenario("ping");
      health(p, es, "OFFLINE");
      p.blockRead(es, 150);
      p.ping(es);
      await flush();
      check("R[superseded]: events from the pre-sleep stream after the boundary change nothing",
        p.count() === 2 && p.live() === 1 && p.tier() !== "live" && p.fresh() !== "fresh");
    }
  }

  // C. Coalesced success events (2026-09-27). ESPHome keeps one deferred
  // event per entity while the SSE socket is backed up, so successes of other
  // blocks that share read_plan_success are dropped in transit. The firmware
  // numbers every success ("<address>:<revision>:<sequence>"); after a jump
  // in the sequence (or a skipped block revision) the page re-reads the
  // read-only freshness snapshot and merges it forward only.
  // Block 0x1000 (smart_sleep): budget 307.5 s.
  {
    const p = boot();
    let es = await establish(p);
    const gets = () => p.fetchLog.filter((f) => f.method === "GET" && f.url.endsWith("/settings/read-freshness")).length;
    const budgetMs = p.h.PROTOCOL_CATALOG.fieldMeta.smart_sleep.freshnessBudgetS * 1000;
    const spacing = p.h.READ_FRESHNESS_RESYNC_SPACING_MS;
    const OTHER = 0x1114;
    let seq = 100, otherRev = 1, blockRev = 2;
    const success = (source, address, revision) => {
      seq += 1;
      const value = `${address}:${revision}:${seq}`;
      source.emit("state", { id: "text_sensor/read plan success", state: value, value });
    };
    // A healthy stream: another block's success every 280 ms (3.6/s), timers running.
    const healthy = async (ms, source = es) => {
      for (let t = 0; t < ms; t += 280) { p.timers.advance(280); success(source, OTHER, ++otherRev); }
      await flush();
    };
    // `lost` successes coalesced away in transit, then the next one arrives.
    const coalesced = async (lost, source = es) => { seq += lost; success(source, OTHER, ++otherRev); await flush(); };
    check("C: budget and spacing come from the generated contract (307.5 s; 5 s)", budgetMs === 307500 && spacing === 5000);

    success(es, SMART_SLEEP_BLOCK, blockRev);  // sequence baseline on this connection
    await healthy(60000);
    check("C1: a healthy numbered stream never fetches anything (60 s, ~214 successes)", gets() === 1 && p.writes() === 0);
    p.timers.advance(20000); success(es, OTHER, ++otherRev); await flush();
    check("C1: ... not even after a long quiet gap without a lost success", gets() === 1);

    // The device reads 0x1000 revision 3; that success (and 4 others) is
    // coalesced away. The next delivered success shows the jump.
    const tRead = p.clock.now();
    await healthy(1500);
    let n = gets();
    p.setSnapshot(p.clock.now() - tRead, 3);
    await coalesced(5);
    check("C2: a jump in the success sequence triggers exactly one snapshot GET", gets() === n + 1 && p.writes() === 0);
    // Time passes on a working stream (timers running, other blocks'
    // successes); jumping the clock alone would be a system sleep.
    const runTo = (target) => {
      while (p.clock.now() + 280 < target) { p.timers.advance(280); success(es, OTHER, ++otherRev); }
      p.timers.advance(target - p.clock.now());
    };
    runTo(tRead + budgetMs);
    check("C2: the merged snapshot carries the device's real read time: fresh up to that read's budget", p.fresh() === "fresh");
    runTo(tRead + budgetMs + 1);
    check("C2: ... and stale one ms later (nothing invented)", p.fresh() === "stale");
    success(es, SMART_SLEEP_BLOCK, blockRev = 4);
    await healthy(spacing * 2);

    // Throttle: more evidence inside the spacing window runs once, trailing.
    n = gets();
    await coalesced(2);
    check("C3: a lost success fetches once", gets() === n + 1);
    await coalesced(1);
    await coalesced(3);
    check("C3: more evidence inside the spacing window does not fetch immediately", gets() === n + 1);
    await healthy(spacing);
    check("C3: ... one trailing resync runs after the spacing", gets() === n + 2);
    await healthy(spacing * 3);
    check("C3: ... and nothing more without new evidence (no loop)", gets() === n + 2);

    // Evidence while a resync is in flight runs exactly one trailing resync.
    n = gets();
    p.holdNextSnapshot();
    await coalesced(1);
    check("C3b: a jump starts a resync (held in flight)", gets() === n + 1);
    await coalesced(1);
    check("C3b: evidence while in flight does not start a second request", gets() === n + 1);
    await healthy(spacing * 2);
    await coalesced(1);
    check("C3b: ... not even when the request outlives the spacing (never two in flight)", gets() === n + 1);
    p.releaseHeld();
    await flush();
    await healthy(spacing);
    check("C3b: ... one trailing resync runs after the in-flight one", gets() === n + 2);
    await healthy(spacing * 3);
    check("C3b: ... and then nothing more", gets() === n + 2);

    // A pending (throttled) resync is dropped when the link is lost.
    {
      const q = boot();
      const qes = await establish(q);
      const qgets = () => q.fetchLog.filter((f) => f.method === "GET").length;
      let qseq = 1;
      const qsuccess = (lost) => { qseq += 1 + lost; const v = `${OTHER}:${qseq}:${qseq}`; qes.emit("state", { id: "text_sensor/read plan success", state: v, value: v }); };
      qsuccess(0);
      q.timers.advance(10000); qsuccess(2); await flush();
      const m = qgets();
      q.timers.advance(1000); qsuccess(2); await flush();  // throttled: a timer is pending
      qes.fail();
      q.timers.advance(spacing);
      await flush();
      check("C3c: a throttled resync whose timer fires after the link was lost fetches nothing", qgets() === m,
        `${qgets() - m} extra GET`);
    }

    // A skipped revision is evidence on its own, also in the older
    // "<address>:<revision>" form without a sequence.
    n = gets();
    es.emit("state", { id: "text_sensor/read plan success", state: `${SMART_SLEEP_BLOCK}:6`, value: `${SMART_SLEEP_BLOCK}:6` });
    blockRev = 6;
    await flush();
    check("C4: a skipped block revision alone triggers a snapshot GET (legacy format too)", gets() === n + 1);
    await healthy(spacing * 2);

    // Merge only moves forward.
    success(es, SMART_SLEEP_BLOCK, blockRev = 7);
    const tFresh = p.clock.now();
    n = gets();
    p.setSnapshot(200000, 5);  // older revision, older read
    await coalesced(1);
    check("C5: the stale-looking snapshot was really fetched", gets() === n + 1);
    runTo(tFresh + budgetMs);
    check("C5: an older snapshot revision can never regress a block", p.fresh() === "fresh");
    runTo(p.clock.now() + spacing * 2);  // now past tFresh + budget
    n = gets();
    p.setSnapshot(0, 7);  // same revision, "read just now": still not a new read
    await coalesced(1);
    check("C5: a same-revision snapshot cannot extend it (stale on its own budget)", gets() === n + 1 && p.fresh() === "stale");

    // A failed resync keeps the evidence it has: a real miss still turns stale.
    success(es, SMART_SLEEP_BLOCK, blockRev = 8);
    const tLast = p.clock.now();
    await healthy(spacing * 2);
    n = gets();
    p.failSnapshot(true);
    p.setSnapshot(0, 9);
    await coalesced(1);
    p.failSnapshot(false);
    runTo(tLast + budgetMs + 1);
    check("C6: a failed resync is attempted, changes nothing; a block without a read goes stale", gets() === n + 1 &&
      p.fresh() === "stale" && p.writes() === 0);

    // Reconnect: the sequence baseline and the floor belong to one connection.
    success(es, SMART_SLEEP_BLOCK, blockRev = 9);
    await healthy(spacing * 2);
    es.fail();
    n = gets();
    await coalesced(3);
    check("C7: while the link is down, lost successes fetch nothing", gets() === n);
    p.timers.advance(p.h.SSE_TIMING.RECONNECT_BASE_MS);
    es = p.es();
    p.setSnapshot(60000, 10);  // read 60 s ago: before the loss boundary
    es.open();
    await flush();
    p.health(es, "LIVE");
    n = gets();
    seq += 500;  // the new connection starts wherever the device's counter is
    success(es, OTHER, ++otherRev);
    await flush();
    check("C7: the first success on a new connection only sets its baseline (no fetch)", gets() === n);
    seq = 3;  // the device rebooted: its counter restarted
    success(es, OTHER, ++otherRev);
    await flush();
    success(es, OTHER, ++otherRev);
    await flush();
    check("C7: a restarted counter becomes the new baseline (no fetch, and later jumps still count)", gets() === n);
    await healthy(spacing * 2);
    n = gets();
    p.setSnapshot(61000, 11);  // a newer revision, but also read before the loss
    await coalesced(1);
    check("C7: after reconnect a lost success fetches the snapshot again", gets() === n + 1);
    check("C7: ... and a merged pre-loss read keeps the field offline (fail closed)", p.fresh() === "offline");
    p.clock.value += 1;
    success(es, SMART_SLEEP_BLOCK, blockRev = 12);
    check("C7: a post-boundary read on this connection unlocks it", p.fresh() === "fresh");

    // A resync still in flight when the link drops must not land in the new
    // connection, even if its answer arrives after the new bootstrap.
    await healthy(spacing * 2);
    n = gets();
    p.holdNextSnapshot();
    await coalesced(1);
    check("C8: a resync is in flight", gets() === n + 1);
    es.fail();
    p.timers.advance(p.h.SSE_TIMING.RECONNECT_BASE_MS);
    es = p.es();
    p.setSnapshot(60000, 12);  // the new bootstrap: last read before the loss
    es.open();
    await flush();
    p.health(es, "LIVE");
    p.setSnapshot(0, 20);  // the old request's answer: "read just now"
    check("C8: the old request is released", p.releaseHeld() === 1);
    await flush();
    check("C8: an answer from the previous connection cannot unlock the field", p.fresh() === "offline");
    p.clock.value += 1;
    success(es, SMART_SLEEP_BLOCK, blockRev = 13);
    check("C8: this connection's own post-boundary read unlocks it", p.fresh() === "fresh");
    check("C: only read-only GETs of the freshness snapshot, zero writes", p.writes() === 0 &&
      p.fetchLog.every((f) => f.method === "GET" && f.url.endsWith("/settings/read-freshness")));
  }

  // K. Clustered reads (M5). One '<cluster id>:<cluster revision>:<sequence>'
  // success covers every read-plan block inside the cluster; the geometry
  // comes only from the firmware snapshot's clusters[] (C1 = 0x1000 x120
  // holds the smart_sleep block 0x1000; A1 = 0x1200 x120 does not).
  {
    const clusters = (c1Revision) => [
      { id: "A1", start: 0x1200, registers: 120, mode: "cluster", lease: 0, cadence_ms: 1000, budget_ms: 1500, age_ms: 10, revision: 40, sequence: 90 },
      { id: "C1", start: 0x1000, registers: 120, mode: "cluster", lease: 0, cadence_ms: 15000, budget_ms: 15500, age_ms: 0, revision: c1Revision, sequence: 91 },
    ];
    const p = boot();
    p.setClusters(clusters(5));
    p.h.connect();
    const es = p.es();
    es.open();
    await flush();
    p.smartSleep(es);
    p.health(es, "LIVE");
    const gets = () => p.fetchLog.filter((f) => f.method === "GET" && f.url.endsWith("/settings/read-freshness")).length;
    let seq = 200;
    const success = async (value) => { es.emit("state", { id: "text_sensor/read plan success", state: value, value }); await flush(); };
    const budgetMs = p.h.PROTOCOL_CATALOG.fieldMeta.smart_sleep.freshnessBudgetS * 1000;
    // A working stream: bms_health every 2 s while time passes.
    const run = (ms) => { for (let t = 0; t < ms; t += 2000) { p.timers.advance(Math.min(2000, ms - t)); p.health(es, "LIVE"); } };
    run(budgetMs + 1);
    check("K0: the snapshot's own read expires by its budget", p.fresh() === "stale", `${p.fresh()} ${p.tier()}`);
    let n = gets();
    await success(`A1:41:${++seq}`);
    check("K1: an A1 success does not refresh a block outside A1", p.fresh() === "stale" && gets() === n);
    await success(`C1:6:${++seq}`);
    check("K1: the next C1 success refreshes the 0x1000 block it contains (no fetch)", p.fresh() === "fresh" && gets() === n);
    run(budgetMs + 1);
    await success(`C1:6:${++seq}`);
    check("K2: a repeated cluster revision refreshes nothing", p.fresh() === "stale" && gets() === n);
    await success(`C1:5:${++seq}`);
    check("K2: an older cluster revision refreshes nothing", p.fresh() === "stale" && gets() === n);
    p.setSnapshot(0, 4);
    await success(`C1:8:${++seq}`);
    check("K3: a skipped cluster revision refreshes the block and triggers exactly one snapshot GET",
      p.fresh() === "fresh" && gets() === n + 1);
    p.timers.advance(p.h.READ_FRESHNESS_RESYNC_SPACING_MS + 1);
    run(budgetMs + 1);
    n = gets();
    await success(`Z9:1:${++seq}`);
    check("K4: an unknown cluster id refreshes nothing and re-reads the snapshot instead of guessing",
      p.fresh() === "stale" && gets() === n + 1);
    run(p.h.READ_FRESHNESS_RESYNC_SPACING_MS + 1);
    await flush();
    n = gets();
    for (const bad of ["c1:9:1", "C1:0:1", "C1-9", "C1:x:1", "1C:9:1", ":9:1"]) await success(bad);
    check("K5: malformed cluster events are ignored (no refresh, no fetch)", p.fresh() === "stale" && gets() === n);
    await success(`C1:9:${seq += 4}`);
    check("K6: a jump in the shared success sequence across cluster events triggers a resync",
      p.fresh() === "fresh" && gets() === n + 1);
    check("K: only read-only GETs of the freshness snapshot, zero writes", p.writes() === 0);
  }
  // A cluster success that arrives before the snapshot is applied once the
  // snapshot lands, at the snapshot's receipt time, only if it is newer.
  {
    const p = boot();
    p.setClusters([{ id: "C1", start: 0x1000, registers: 120, revision: 5, sequence: 1 }]);
    p.setSnapshot(10 * 60 * 1000, 1);  // the snapshot's own block read is old
    p.holdNextSnapshot();
    p.h.connect();
    const es = p.es();
    es.open();
    await flush();
    p.smartSleep(es);
    p.health(es, "LIVE");
    p.clock.value += 1;
    es.emit("state", { id: "text_sensor/read plan success", state: "C1:6:1", value: "C1:6:1" });
    check("K7: a cluster success before the snapshot cannot unlock anything yet", p.fresh() !== "fresh");
    check("K7: the snapshot request is released", p.releaseHeld() === 1);
    await flush();
    check("K7: ... then the pending newer C1 success refreshes the block", p.fresh() === "fresh");
  }
  {
    const p = boot();
    p.setClusters([{ id: "C1", start: 0x1000, registers: 120, revision: 6, sequence: 1 }]);
    p.setSnapshot(10 * 60 * 1000, 1);
    p.holdNextSnapshot();
    p.h.connect();
    const es = p.es();
    es.open();
    await flush();
    p.smartSleep(es);
    p.health(es, "LIVE");
    p.clock.value += 1;
    es.emit("state", { id: "text_sensor/read plan success", state: "C1:6:1", value: "C1:6:1" });
    p.releaseHeld();
    await flush();
    check("K8: a pending cluster success already covered by the snapshot adds nothing", p.fresh() !== "fresh");
  }
  // A snapshot without clusters[] (fallback-only / pre-M5 firmware, or the
  // mock server): numeric block events keep working, cluster events resync.
  {
    const p = boot();
    const es = await establish(p);
    check("K9: numeric block events still work with a snapshot without clusters[]", p.fresh() === "fresh");
    const n = p.fetchLog.length;
    es.emit("state", { id: "text_sensor/read plan success", state: "C1:2:1", value: "C1:2:1" });
    await flush();
    check("K9: a cluster event without known geometry triggers a resync, never a guess", p.fetchLog.length === n + 1);
  }

  console.log(`\nSSE reconnect: ${checks - failures}/${checks} passed`);
  process.exit(failures ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });
