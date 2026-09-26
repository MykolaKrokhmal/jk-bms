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
      const response = { ok: true, status: 200, json: async () => ({ blocks: [[SMART_SLEEP_BLOCK, snapshotAgeMs, snapshotRevision]] }) };
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
    p.clock.value += 20000; success(es, OTHER, ++otherRev); await flush();
    check("C1: ... not even after a long quiet gap without a lost success", gets() === 1);

    // The device reads 0x1000 revision 3; that success (and 4 others) is
    // coalesced away. The next delivered success shows the jump.
    const tRead = p.clock.now();
    await healthy(1500);
    let n = gets();
    p.setSnapshot(p.clock.now() - tRead, 3);
    await coalesced(5);
    check("C2: a jump in the success sequence triggers exactly one snapshot GET", gets() === n + 1 && p.writes() === 0);
    p.clock.value = tRead + budgetMs;
    check("C2: the merged snapshot carries the device's real read time: fresh up to that read's budget", p.fresh() === "fresh");
    p.clock.value = tRead + budgetMs + 1;
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
    p.clock.value = tFresh + budgetMs;
    check("C5: an older snapshot revision can never regress a block", p.fresh() === "fresh");
    p.clock.value += spacing * 2;  // now past tFresh + budget
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
    p.clock.value = tLast + budgetMs + 1;
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

  console.log(`\nSSE reconnect: ${checks - failures}/${checks} passed`);
  process.exit(failures ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });
