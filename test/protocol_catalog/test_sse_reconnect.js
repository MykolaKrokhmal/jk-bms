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
      return { ok: true, status: 200, json: async () => ({ blocks: [[SMART_SLEEP_BLOCK, snapshotAgeMs, snapshotRevision]] }) };
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
  check("reconnect failure: first real traffic resets the backoff", p.dbg().reconnectAttempt === 0);

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
  // A jump while the stream kept progressing does not disturb it.
  p = boot();
  first = await establish(p);
  p.timers.advance(T.SSE_WATCHDOG_INTERVAL_MS);
  p.timers.suspend(T.DISCONNECTED_ESCALATION_MS * 2);
  p.ping(first); // traffic arrived right after resume
  p.timers.advance(0);
  check("6: a clock jump with fresh traffic keeps the working connection", p.count() === 1 && first.readyState === 1);

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
  // Pings alone keep a quiet stream alive.
  p = boot();
  first = await establish(p);
  for (let i = 0; i < 20; i += 1) { p.timers.advance(10000); p.ping(first); }
  check("7: ESPHome pings every 10 s keep the stream alive for 200 s", p.count() === 1 && first.readyState === 1);

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

  console.log(`\nSSE reconnect: ${checks - failures}/${checks} passed`);
  process.exit(failures ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });
