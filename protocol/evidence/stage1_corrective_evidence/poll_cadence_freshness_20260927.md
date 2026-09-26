# Polling cadence vs freshness — audit, hardware evidence, fix (2026-09-27)

Base: bab3d27. Scope: why healthy Settings fields turned yellow, and whether
the problem is the scheduler, the budget or the event path. No compile, no
flash, no POST, no BMS write. The device was accessed with read-only
GET /events for 10 min 15 s (a 15 s smoke run plus a 10 min run).

## 1. Scheduler path (code audit)

| item | value (source) |
|---|---|
| servicer tick | 200 ms `interval:` in `protocol/generated/read_plan.yaml` (startup 3 s) |
| outstanding reads | at most 1 (`g_rp_pending_index`); next issue only on the first tick after the response |
| read timeout | 3000 ms; a timed-out block keeps `last_attempt_ms`, so it is due again one cadence after the attempt |
| due-block selection | `pick_next_block()`: skip if `now - last_attempt < cadence`; most overdue wins; tier-2 group hint is a no-op (every `ui_group` is -1) |
| round-robin | emergent from "most overdue first" plus `last_attempt` reset |
| write/readback | any jk_write_tx slot pending, CellCount tx or topology probe → the servicer issues nothing that tick |
| bus | `modbus:` 115200 Bd, `turnaround_time: 50ms`, one FIFO command queue |
| other bus users | bespoke cell reader every 1 s (0x1200, 53 regs); calibration reader every 300 s; 15 s extended-resistance probe (only when > 16 cells); write ACK/readback and topology on demand |
| skip/update | `modbus_controller update_interval: 15s`, but no `platform: modbus_controller` entity remains to poll |
| blocks | 52 × 15 s, 3 × 75 s, 48 × 300 s = 103 (`read_plan.json`) |
| demand | 52/15 + 3/75 + 48/300 = **3.667 reads/s** |
| "15 s" means | per-block minimum interval between read attempts (`cadence_ms`), not a group frequency |
| canonical budgets before | 30 / 90 / 320 s (hand-set; 30 = exactly 2 × 15) |
| runtime diagnostics | `read_plan_success` "addr:rev" on SSE per success; `/settings/read-freshness` [addr, age_ms, rev] from the atomic snapshot table (no Modbus) |

## 2. Hardware observation (read-only, 600 s)

Stored as `poll_cadence_observation_20260927.json`: timestamps, block address
and revision only; no field values, no log text.

- 46 527 state events. `bms_health` LIVE from 8.5 s, no transition, 0
  scheduler warnings.
- 2 128 block successes, all 103 blocks seen: **3.62 successes/s**, i.e. the
  declared demand is met.
- Healthy per-block intervals (revision +1):

| cadence | n | median | p99 | max | max lateness |
|---|---|---|---|---|---|
| 15 s | 1 919 | 15.02 s | 15.87 s | 17.97 s | +2.97 s (during the 300 s burst) |
| 75 s | 21 | 75.19 s | 75.35 s | 75.35 s | +0.35 s |
| 300 s | 44 | 300.36 s | 300.82 s | 300.82 s | +0.82 s |

- All 13 intervals above the old 30 s budget (30.6–31.2 s, blocks
  0x12d0–0x1300) had a **revision +2**: the device read each block on time.
  The intermediate success events were lost during two SSE stalls (a 2.1 s
  and a 2.5 s gap in the received stream at 41–46 s).
- The 48 slow blocks are read as one burst about every 300 s (37–70 s,
  337–371 s). During the burst the success rate rises to 4.3/s and the
  15 s-group lateness to p99 +1.7 s / max +3.0 s; otherwise p99 +0.4 s.

**Mechanism (ESPHome source, `.esphome/build/.../web_server_idf.cpp`,
`deq_push_back_with_dedup_`).** While the SSE socket cannot send, each
publish is queued as (entity, message generator), deduplicated per entity.
The message is rendered from the entity's current state when finally sent.
All 103 blocks report through the one `read_plan_success` text sensor, so
only the latest success survives a stall.

The previous diagnosis (`ui_transient_stale_diagnosis_20260926.md`) read
these gaps as ≈ 30 s real intervals. That was wrong and is corrected there.

## 3. Deterministic simulation

- Model: `test/jk_poll_scheduler/poll_cadence_model.h`, using the real
  `pick_next_block()` and the real generated `kBlocks`, with the 200 ms
  servicer, one read outstanding, a 3 s timeout, the write pause, a FIFO bus
  with 50 ms turnaround, the 1 s cell reader and forced commands.
- Calibration: block response 60 ± 20 ms and cell read 60 ms reproduce the
  device (3.616/s vs 3.622/s; max healthy 15 s lateness +2.9 s vs +2.97 s).

| scenario (20 min, after 60 s warm-up) | worst 15 s | worst 75 s | worst 300 s | notes |
|---|---|---|---|---|
| nominal | 17.9 s | 77.9 s | 302.9 s | bus 54 %, queue ≤ 2 |
| 1 s write every minute | 18.9 s | 78.8 s | 303.9 s | |
| forced readback 200 ms / 5 s | 19.5 s | 79.0 s | 304.5 s | queue ≤ 3 |
| another block's 3 s timeout | 21.0 s | 81.0 s | 302.9 s | |
| responses +33 % (80 ms) | < budget | < budget | < budget | |
| failed write (7 s pause) | 24.9 s | 84.8 s | 303.7 s | genuine delay, < 2 × cadence |
| responses 100 ms (+67 %) | 23.3 s | 82.3 s | 306.0 s | degraded bus |
| one missed read of the block | ≈ 30 s | ≈ 150 s | ≈ 600 s | = 2 × cadence |

**Effective cadence before and after: unchanged.** The scheduler, the bus
traffic (3.62 reads/s plus 1 cell read/s, about 54 % bus time including
turnaround) and the firmware servicer are not modified. The problem was the
budget and the event path, not the cadence.

## 4. Contract (decision in `docs/project/DECISIONS.md`)

- Intended per-block cadence: **15 s / 75 s / 300 s**, confirmed on hardware.
- **Budget = cadence + J, J = (shortest scheduler cadence) / 2 = 7.5 s**:
  15 → 22.5 s, 75 → 82.5 s, 300 → 307.5 s. The cell reader keeps its bespoke
  3 s budget; it is not scheduler-driven.
- Derived and enforced in `tools/protocol/generate_read_plan.js`:
  - `READ_PLAN_FRESHNESS_BUDGET_NOT_DERIVED` rejects any canonical value that
    differs;
  - `READ_PLAN_FRESHNESS_BUDGET_MISSES_ONE_CYCLE` enforces budget < 2 × cadence;
  - it emits `kBlockFreshnessBudgetMs` / `kFreshnessJitterAllowanceMs`.
- One canonical number per register feeds the UI (`fieldMeta.freshnessBudgetS`),
  the write registry (`freshness_budget_ms`, the RMW STALE_RAW gate:
  30 → 22.5 s, 90 → 82.5 s, 320 → 307.5 s, i.e. only tightened) and diagnostics.
- Why healthy jitter no longer creates stale: the worst healthy interval,
  measured (17.97 s) or modelled with writes, forced readbacks and another
  block's timeout (≤ 21.0 s), stays below 22.5 s.
- Why one missed cycle still does: a missed read gives a 2 × cadence gap
  (30 s > 22.5 s), so the field is stale for about 7.5 s until the next read.
  With the old 30 s budget the model showed it for **4 ms**.
- Why coalesced events no longer create stale: every success is numbered
  (`read_plan_success` = `<address>:<revision>:<sequence>`; the new
  `g_rp_success_seq` global in the generated servicer is diagnostic only, with
  no change to reads, cadence or bus traffic). The first success delivered
  after a stall shows the jump. The page then re-reads `/settings/read-freshness`,
  which is read-only, served from the atomic table and triggers no Modbus
  traffic. Only one request runs at a time, at most one per 5 s plus one
  trailing run. The snapshot is merged forward only: it applies only for a
  newer revision and a newer read time, and the read time is the device's own
  (`received − age`). In the observed stall, the first delivered success after
  each gap (about 43.4 s and 45.8 s) would have triggered a resync (the second
  as a trailing run at about 48.4 s). That corrects the 13 blocks about 3–6 s before
  their 22.5 s budgets (49.3–53.0 s). A stall longer than the remaining margin
  still shows stale: the page then genuinely has no confirmation.
- A first version detected stalls by a ≥ 1 s gap between any two SSE
  events. On the demo stream it re-fetched every 7–15 s (6 GETs in 57 s),
  i.e. polling in effect, so it was replaced by the exact sequence signal.
  With the sequence the demo makes exactly one GET, the bootstrap one.
- Load after the fix: Modbus unchanged. SSE adds a few bytes per success
  event (`:<sequence>`). HTTP adds one small GET (about 2.7 kB) only when
  successes were actually lost, with a ceiling of 12/min by construction.

## 5. Tests

- `test/jk_poll_scheduler/test_poll_cadence_simulation.cpp` (21 checks, in
  `run_all.sh`) covers:
  - the contract per block;
  - nominal cadence of every block;
  - no stale under nominal load, write pauses, forced readback, another
    block's timeout and +33 % latency;
  - a missed read producing stale (≥ 5 s) in every group, then recovering;
  - a failed write never reaching 2 × cadence.
- `test_sse_reconnect.js` section C (32 checks) covers:
  - a numbered healthy stream making no fetch, even after a long quiet gap;
  - a sequence jump triggering exactly one GET;
  - the merged read keeping the device's read time and going stale on its
    own budget;
  - throttling, in-flight coalescing and exactly one trailing run;
  - a revision skip triggering a GET;
  - no regression and no extension from same or older revisions;
  - a failed GET keeping state;
  - no fetch while the link is down, including a pending timer;
  - the sequence baseline resetting per connection and after a counter restart;
  - an in-flight answer from the previous connection being unable to unlock
    after a reconnect;
  - a pre-loss read staying offline;
  - zero writes.
- `test_settings_catalog.js`:
  - the budgets 3 / 22.5 / 307.5 s;
  - fresh exactly at 22.5 s and stale 1 ms later;
  - the F2–F5 controlled-clock checks, now reading the budget from the
    generated catalog;
  - a reconnect snapshot of pre-loss reads not unlocking anything.
- Mutations, each killed:
  - sequence trigger removed;
  - sequence off-by-one (fetch on every success);
  - baseline reset removed;
  - max-only baseline;
  - skip trigger removed;
  - merge not forward-only;
  - merge by time only;
  - throttle removed;
  - readiness guard removed;
  - snapshot age ignored;
  - trailing run removed;
  - generation check removed;
  - in-flight guard removed;
  - canonical 15 s budget back to 30 s;
  - proportional 1.5 × rule;
  - allowance = full cadence;
  - generated budget 2 × cadence;
  - generated budget 16 s.
