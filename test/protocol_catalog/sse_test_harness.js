"use strict";

// Shared deterministic fakes for tests that drive jk_bms.js's REAL SSE
// connection manager (connect()/checkConnection()/sseWatchdogTick()):
//   - Clock: the single time source behind Date.now() and the timer queue;
//   - TimerQueue: window.setTimeout/setInterval under test control, with
//     `advance()` (time passes, timers fire in order) and `suspend()` (time
//     passes while timers are frozen, as in macOS sleep -- overdue timers
//     then fire once, late, on the next advance());
//   - FakeEventSource: records every instance so a test can open/fail/emit
//     on a specific connection, including a superseded one.

class Clock {
  constructor(start = 1000000) { this.value = start; }
  now() { return this.value; }
}

function makeControlledDate(clock) {
  return class ControlledDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.now()])); }
    static now() { return clock.now(); }
  };
}

class TimerQueue {
  constructor(clock) {
    this.clock = clock;
    this.seq = 1;
    this.timers = new Map(); // id -> { cb, at, interval }
  }
  setTimeout(cb, ms) {
    const id = this.seq++;
    this.timers.set(id, { cb, at: this.clock.now() + Math.max(0, ms || 0), interval: null });
    return id;
  }
  setInterval(cb, ms) {
    const id = this.seq++;
    const interval = Math.max(1, ms || 0);
    this.timers.set(id, { cb, at: this.clock.now() + interval, interval });
    return id;
  }
  clear(id) { this.timers.delete(id); }
  count(kind) {
    let n = 0;
    for (const t of this.timers.values()) if (kind === undefined || (kind === "interval") === (t.interval !== null)) n += 1;
    return n;
  }
  // Time passes normally: every timer due within `ms` fires in time order.
  advance(ms) {
    const end = this.clock.now() + ms;
    for (;;) {
      let nextId = null;
      let next = null;
      for (const [id, t] of this.timers) if (t.at <= end && (!next || t.at < next.at)) { nextId = id; next = t; }
      if (!next) break;
      this.clock.value = Math.max(this.clock.value, next.at);
      if (next.interval !== null) next.at = Math.max(next.at + next.interval, this.clock.value + 1);
      else this.timers.delete(nextId);
      next.cb();
    }
    this.clock.value = end;
  }
  // Time passes while every timer is frozen (sleep): nothing fires now.
  suspend(ms) { this.clock.value += ms; }
}

class FakeEventSource {
  constructor(url) {
    this.url = String(url);
    this.readyState = 0; // CONNECTING
    this.listeners = new Map();
    this.onopen = null;
    this.onerror = null;
    this.onmessage = null;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  listenerCount() { let n = 0; for (const l of this.listeners.values()) n += l.length; return n; }
  close() { this.readyState = 2; }
  // Server side / network side actions.
  open() { this.readyState = 1; if (this.onopen) this.onopen({ type: "open" }); }
  fail({ permanent = false } = {}) { this.readyState = permanent ? 2 : 0; if (this.onerror) this.onerror({ type: "error" }); }
  // Delivers regardless of readyState: models an event already queued when a
  // newer connection superseded this one.
  emit(type, data) {
    const event = { type, data: typeof data === "string" ? data : JSON.stringify(data) };
    for (const fn of (this.listeners.get(type) || []).slice()) fn(event);
    if (type === "message" && this.onmessage) this.onmessage(event);
  }
  static reset() { FakeEventSource.instances = []; }
  static live() { return FakeEventSource.instances.filter((s) => s.readyState !== 2); }
}
FakeEventSource.instances = [];

// Minimal event target for window/document lifecycle listeners.
class ListenerRegistry {
  constructor() { this.map = new Map(); }
  add(type, fn) { if (!this.map.has(type)) this.map.set(type, []); this.map.get(type).push(fn); }
  dispatch(type, event = {}) { for (const fn of (this.map.get(type) || []).slice()) fn({ type, ...event }); }
  count(type) { return (this.map.get(type) || []).length; }
  total() { let n = 0; for (const l of this.map.values()) n += l.length; return n; }
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

module.exports = { Clock, makeControlledDate, TimerQueue, FakeEventSource, ListenerRegistry, flush };
