# Transient yellow Settings fields — diagnosis (2026-09-26)

> **Correction (2026-09-27).** Two conclusions below are wrong. The first is
> "real successful-read intervals of the 15 s blocks are ≈ 30 s". The second is
> that the owner's yellow was "genuine stale by the current contract".
>
> A 10-minute follow-up observation recorded every block revision. The device
> reads every 15 s block on time: median 15.02 s, p99 15.87 s. Each 30–33 s gap
> carried a revision +2, so the success event was dropped in transit and the
> read was never missed. ESPHome's SSE server keeps one deferred event per
> entity, and all block successes share `read_plan_success`.
>
> The offline-yellow fix in this file stands. For the corrected analysis and
> fix, see `poll_cadence_freshness_20260927.md`.

Owner report: on the device the 0x1114 fields (Heating, Temp. sensor, GPS
heartbeat, Port switch, LCD always on, Special charger, SmartSleep, PCL
module, Timed stored data, Charging float mode) briefly turned yellow — live
selects with a yellow border and fill, locked values with yellow text.

## What the yellow means in this UI

`settingsFieldFreshness()` kinds: fresh, stale, offline, pending,
unavailable. The field-shell yellow (`--warn` border + fill, yellow value)
is only `data-freshness="stale"`: the physical read block's last successful
read (`read_plan_success` "addr:rev" / `/settings/read-freshness`) is older
than the key's `freshness_budget_s` while the browser link is up and BMS
health is LIVE/DELAYED since this connection. Offline shows a dotted border
and grey text, pending a dashed border.

## Device observation (read-only, 6 min, SSE GET only)

Aggregated result: `ui_stale_observation_20260926.json` (no raw payloads).
360 s, 27 845 state events, 37 pings, `bms_health` LIVE from 8.4 s with no
further transition (no offline, no reconnect).

- 70 read blocks seen; 14 of the 15 s-cadence blocks exceeded their 30 s
  budget at least once, by 5 ms … 2.9 s: 0x1244 32.88 s, 0x12a4 32.75 s,
  0x12f0 32.62 s, 0x12f8 32.21 s, 0x12ac 30.89 s, 0x12e4 30.69 s, 0x12e6
  30.48 s, 0x12dc 30.46 s, 0x1424 30.11 s, 0x12da 30.10 s, 0x1420 30.04 s,
  0x1470 30.03 s, 0x12ee 30.02 s, 0x12fa 30.01 s. 0x1114 stayed within
  budget in this window.
- Real successful-read intervals of the "15 s" blocks are ≈ 30 s (the
  scheduler reaches each block about every second cycle), i.e. the
  cadence runs with ~0 margin against the 30 s budget.
- Cells (budget 3 s): one 5.2–5.4 s gap for all 32 voltages and one
  4.2–4.5 s gap for resistances at ≈ 10.8 s — the pause between the initial
  state dump and the first live publication.

Conclusion: the reported all-0x1114 yellow is **genuine stale by the
current contract** — a missed read budget, consistent with the measured
≈ 30 s intervals plus scheduler lateness of up to ~3 s. Not a dirty draft
(no Settings editor turned yellow through dirty; dirty is the accent
border), not validation (red), not an event-order race (see below). It is
kept. Making it disappear would need a firmware/protocol decision about
the scheduler throughput or the 15 s group budget — not a UI grace period.

## Code review of the other causes

- **Dirty**: exactly two code paths set `dataset.dirty = "true"`: the
  delegated `input` event handler on `#panel-configuration` (real user
  input; programmatic `.value =` fires no input event) and the diagnostics
  rebuild that re-applies an already-dirty draft. SSE population,
  relocalization, rerender and reconnect never mark dirty.
- **Timer/read race**: `readBlockSuccess()` records the new block time and
  calls `refreshSettingsFreshness()` in the same synchronous step, so the
  warning clears at the read, not at the next 1 s sweep; a read recorded
  before a sweep tick never produces a stale frame. The budget test is
  strictly greater-than. No race; no change.
- **Offline masquerading as stale — real defect, fixed**:
  `applySettingsFreshness()` added `.is-stale` (yellow text + bullet) for
  `offline` as well as `stale`, so every read-only Settings value and cell
  voltage/resistance turned yellow during a browser reconnect or BMS
  OFFLINE. Now only `stale` gets `.is-stale`; offline read-only values use
  `--ink-faint` (grey), like the offline field shell. Write gates are
  unchanged (offline/pending/stale still disable OK and dispatch nothing).

## Tests

`test/protocol_catalog/test_settings_catalog.js` `runFalseStaleScenario`
(17 checks, real `jk_bms.js` closures, controlled clock): no dirty from SSE /
relocalization / rerender / reconnect; structural proof of the two dirty
writers; fresh at exactly 30 000 ms, stale at 30 001 ms; read-before-tick
never stale; genuine stale keeps yellow and closes the gate (zero GET/POST);
read clears stale synchronously; replayed revision cannot refresh; browser
offline and BMS OFFLINE are not yellow (Settings editors, selects, cell
values) and keep the gate closed.
`test_settings_controls_css.js`: offline/pending never use `--warn`.

Mutations (each killed): offline re-added to `.is-stale`; offline value
colour set to `--warn`; SSE render marks a numeric editor dirty; select
prefill marks dirty; read success without synchronous refresh; inclusive
budget (`>=`); 5 s grace period.
