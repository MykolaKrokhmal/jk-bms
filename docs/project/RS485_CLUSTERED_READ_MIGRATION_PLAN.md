# RS485 clustered-read migration — architecture sub-plan

**Status: AUTHORITATIVE active architecture-migration sub-plan** of
[`RS485_UNIFIED_PARAMETER_PIPELINE_PLAN.md`](RS485_UNIFIED_PARAMETER_PIPELINE_PLAN.md).
Approved as a design by the owner on 2026-09-27. **Nothing in this plan is
implemented or hardware-proven yet.** Every address range, latency, budget
and timing below is a proposal or a model output until the hardware gate
named next to it has passed and its evidence is committed under
`protocol/evidence/`.

Evidence labels used throughout:

- **[measured]** — observed on the real device, with a committed evidence file.
- **[model]** — output of the calibrated host model
  (`test/jk_poll_scheduler/poll_cadence_model.h`), not hardware.
- **[proposal]** — the agreed design, not yet built or proven.
- **[gate X]** — an open fact that hardware phase X must settle before the
  design depends on it.

Baseline for this plan: commit `faed82d` on `codex/rs485-unified-pipeline`.
The mΩ cell-resistance label fix (`faed82d`) is a closed prerequisite.

---

## 0. Discovery summary (verified against `faed82d`)

### 0.1 Existing APIs and state machines

| Area | What exists (path → symbol) |
|---|---|
| Scheduler core | `components/jk_poll_scheduler/jk_poll_scheduler_core.h` → `Block` (address, register_count, payload_bytes, cadence_ms, fields_offset/count, ui_group, strict_length), `BlockState`, `mark_issued/mark_success/mark_error/mark_timeout`, `pick_next_block()` (skip if `now - last_attempt < cadence`; otherwise the most overdue ms wins; tier-2 group hint), `resolve_active_group_block_index()`, `find_block_index_for_address()` (exact address match), `decode_numeric/decode_bool/decode_ascii/read_be` |
| Generated read plan | `protocol/generated/read_plan_decode.h` → `jk_read_plan::kBlocks[103]`, `kFields`, `kBlockFreshnessBudgetMs[]`, `kFreshnessJitterAllowanceMs`; `protocol/generated/read_plan.yaml` → globals `g_rp_last_attempt_ms/last_success_ms/error_count/timeout_count/transport_state/revision/last_raw_word` (all `[103]`), `g_rp_pending_index`, `g_rp_pending_started_ms`, `g_rp_success_seq`; the 200 ms servicer `interval:` (one read outstanding, 3000 ms timeout, write pause, then `pick_next_block`, `create_read_command`, per-block decode `switch`, `read_plan_success` = `address:revision:sequence`) |
| Read-plan generator | `tools/protocol/generate_read_plan.js` → `POLL_GROUP_CADENCE_MS`, `derivedFreshnessBudgetMs()` (cadence + 7.5 s; enforced against canonical `freshness_budget_s`), `CUSTOM_DECODE_BLOCKS` (0x1290), `BESPOKE_EXCLUDED_KEYS`, `EXACT_DECIMAL_FIELDS`, the `strict_length` / `validation_policy` split |
| Write core | `components/jk_write_tx/jk_write_tx_core.h` → `Status` (SENDING, ACK_WAIT, READBACK_WAIT, CONFIRMED, MISMATCH, ACK_TIMEOUT, READBACK_TIMEOUT, WRITE_UNCERTAIN), `Slot`, `tick()` (`DEFAULT_ACK_TIMEOUT_MS = 3000`, `DEFAULT_READBACK_TIMEOUT_MS = 4000`), `is_pending()`, `raw_is_fresh()`, `encode_numeric_field()`, `merge_field_into_raw()`, `verify_sibling_bits_preserved()`, `compare_masked()`, `RegisterWriteRequestMailbox` + `try_stage_write_request()` / `try_take_write_request()`, result table |
| Preflight snapshot | `components/jk_write_tx/jk_preflight_snapshot_core.h` → `kMaxReadPlanBlocksForPreflightSnapshot = 160`, `publish_read_plan_block_snapshot()`, `read_read_plan_block_snapshot()`, write-tx snapshot table; published every 100 ms from the main loop (`batterylifepo4.yaml`, second `interval: 100ms`) |
| Write registry | `protocol/generated/write_registry_table.h` → `jk_write_registry::Entry` (address, word_count, uses_rmw, mask, shift, scale, limits, `freshness_budget_ms`, submit policy), 42 entries; `tools/protocol/generate_write_registry.js` |
| Write paths in YAML | the 250 ms write-tx tick loop (loads a `Slot`, calls `tick()`, issues the authoritative readback on `issue_readback`); the 100 ms register-write consumer (full re-validation, `raw_is_fresh` against `g_rp_last_success_ms`, `begin_write_tx_rmw` / `write_bms_u32` / `write_bms_u16`); the `begin_write_tx_rmw` script (`find_block_index_for_address` → `g_rp_last_raw_word` → `merge_field_into_raw`); the preflight handler (`current_raw`, `raw_age_ms`, `merged_raw` for registry keys only) |
| Topology / CellCount | the 250 ms topology loop: `g_cellcount_tx_*`, `g_topology_recovery_*`, `resolve_topology`; `components/jk_topology/`; `test/jk_topology/`, `test/topology/run.js` |
| Capability probes | `components/jk_capability/jk_capability_core.h` → `State`, `ProbeState`, `MAX_PROBE_ATTEMPTS = 3`, `should_attempt()`, `record_outcome()`, `needs_cellwireres_extended_read()`, `classify_response()`, `callback_matches_pending_attempt()` |
| Bespoke readers | `batterylifepo4.yaml`: 1 s cell reader (0x1200 × 53, `g_cell_poll_pending`, 15 s pending guard); 15 s resistance 17–32 probe (0x126A × 16, capability-gated, only when cell_count > 16); 300 s calibration reader (0x1088, 32 × 2 registers, capability-gated); passcode transaction (`g_passcode_tx_*`, 0x1470 × 8 readback) |
| Active-group hint | `batterylifepo4.yaml` `ActiveGroupHandler`: `POST /settings/active-group`, 100 ms rate limit, 30 s expiry, groups 1–12; globals `g_active_group_hint`, `g_active_group_hint_expires_ms`, `g_active_group_last_request_ms`. **No client calls it** (`jk_bms.js` and `demo/mock-server.js` have no caller), and every generated block's `ui_group` is −1, so today it is a no-op |
| Freshness endpoint | `ReadPlanFreshnessHandler`: `GET /settings/read-freshness` → `{"blocks":[[address, age_ms, revision], …]}` from the atomic snapshot table (no Modbus) |
| Browser freshness | `jk_bms.js` → `readBlockFreshness`, `readBlockSuccess()` (accepts `addr:rev[:seq]`, triggers resync on a sequence jump or skipped revision), `acceptReadBlockSnapshot()`, `mergeReadBlockSnapshot()` (forward-only), `requestReadBlockResync()` (≤ 1 per 5 s, one in flight, one trailing run), `settingsFieldFreshness()`, `isFieldStale()` (`block ? block.updatedAt : stateUpdatedAt[key]`), `settingsFreshnessFloorAt`, `healthSinceConnect` |
| ESPHome SSE | on connect, `web_server` sends every entity's current state (`DeferredUpdateEventSourceList::on_client_connect_` → `entities_iterator_`). While a socket is backed up it keeps one deferred event per entity, rendered from the current state (`deq_push_back_with_dedup_`) |
| Mock | `demo/mock-server.js` → `readPlanFreshness` (from `read_plan.json`), `read_plan_success` with sequence, `/settings/read-freshness` |

### 0.2 Reusable patterns

- **Host-testable pure cores** (no ESPHome, no I/O) with `g++` tests:
  `test/jk_poll_scheduler/test_jk_poll_scheduler_core.cpp`,
  `test/jk_write_tx/test_jk_write_tx_core.cpp`,
  `test_jk_write_tx_rmw_core.cpp`, `test_jk_write_tx_rmw_end_to_end.cpp`,
  `test/jk_capability/test_jk_capability_core.cpp`.
- **Calibrated deterministic simulation using the real `pick_next_block()`**:
  `test/jk_poll_scheduler/poll_cadence_model.h` +
  `test_poll_cadence_simulation.cpp`.
- **Cross-task data safety:** HTTP handlers stage into a mailbox or atomic
  snapshot, and the main loop consumes it (`RegisterWriteRequestMailbox`,
  `jk_preflight_snapshot_core.h`).
- **Bounded capability probe with a boot-session latch**:
  `jk_capability_core.h`.
- **Real-closure browser tests** through `window.__JK_BMS_TEST_HOOKS__`:
  `test_settings_catalog.js`, `test_sse_reconnect.js` (controlled clock, fake
  EventSource, held fetch), `test_cell_resistance_units.js`,
  `test_cell_composite_rows.js`.
- **Generator discipline:** every generator has `--check`; `pipeline.js
  check`; the fingerprint check → review → accept workflow
  (`protocol/README.md`).

### 0.3 Unproven assumptions (each becomes a hardware gate)

1. The BMS answers FC03 reads of 125 registers, and reads spanning undefined
   words (A1: 7, A2: 3, corrected C2: 4 gap words), with exact lengths. **[gate A]**
2. Wide-response latency `L` as a function of register count. **[gate A]**
3. The real response length of the 0x1290 cluster (today a floor check,
   documented as hardware-pending). **[gate A]**
4. Values of inactive channels 17–32 (0x126A–0x1288, and voltages 17–32) on
   the 16S device. **[gate A]**
5. ESP32 callback processing time and modbus_controller queue behaviour with
   wide responses. **[gate A]**
6. Sustained 1 Hz telemetry (and + 3 s Settings) with no timeouts, no queue
   growth and no missed cycles. **[gates B, C]**
7. Whether one telemetry read may use the write-state-machine idle windows
   without delaying the authoritative readback beyond its timeout.
   **[host simulation, then gate D]**

### 0.4 Stale text that is not authority

- `protocol/generated/read_plan.yaml` header "NOT YET !include'd by …" (L9;
  the package is included) and the servicer comment "ui_group population is
  Stage 2's own deliverable, not yet done". Both come from the generator.
- **Resolved 2026-09-27:** the owner confirmed `8fbe54f` as the last
  hardware-tested deployment baseline (it contains the earlier security
  baseline `be99c96`). `PROJECT_STATE.md` and `docs/guides/BUILD_AND_DEPLOY.md`
  record it.
- `DECISIONS.md` → "Freshness budget = cadence + one absolute scheduling
  allowance" and `derivedFreshnessBudgetMs()` apply to the current
  per-address scheduler only. The cluster budgets replace them (§7).
- `poll_cadence_model.h` models the current per-address scheduler. Its
  calibration (L = 60 ± 20 ms) is for small reads, not wide ones.
- `ARCHITECTURE.md` describes the current block model; it changes when
  clusters land.

### 0.5 Findings that constrain the design

- **The agreed C1/C2 split cuts a 32-bit register.** `0x1000 × 125` ends at
  0x10F9, but `cell_connection_wire_resistance_29` at 0x10F8 is two words
  (0x10F8, 0x10FA). **Correction, accepted by the owner on 2026-09-27:**
  C1 = `0x1000 × 124` (0x1000–0x10F7, 248 bytes), C2 = `0x10F8 × 19`
  (0x10F8–0x111D, 38 bytes). A1/A2 split no register (checked against
  `registers.canonical.json`).
- **Credential bytes are in the general cache today.** The generated
  servicer stores the first 4 bytes of every block, 0x1470 included, in
  `g_rp_last_raw_word` and the preflight snapshot table. They never leave
  the device, because preflight returns `current_raw` only for write-registry
  keys and the passcode is not one. They still violate the target rule
  (§11).
- **The passcode is polled today**: 0x1470 × 8 belongs to `telemetry_15s`
  in the read plan, and it is decoded only to the constant status `hidden`.
- **The passcode write transaction is not part of the scheduler's
  `write_in_flight`** (only `g_cellcount_tx_pending`,
  `g_topology_recovery_pending` and pending `g_wtx` slots are).
- **The active-group endpoint writes plain globals from the HTTP task.**
  The lease must use the mailbox/atomic pattern instead (§8).
- **Every canonical register falls inside exactly one target cluster or P**
  (no uncovered register; checked against `registers.canonical.json`).

### 0.6 Anti-patterns to avoid

- Hand-editing generated artifacts, or hard-coding cluster geometry in YAML
  or JS instead of generating it.
- Guessing geometry, budgets, deadbands or lease timings and presenting them
  as facts.
- Freshness from SSE arrival or from value publication.
- A read issued while a write/readback command is outstanding; a second
  outstanding read.
- A write gate that uses a background (300 s) budget.
- Credential bytes in any shared buffer, log, SSE, HA entity or diagnostic.
- Silent or oscillating fallback.
- Browser polling of register data.
- Widening a freshness budget to hide a write pause.

---

## 1. Baseline and objective

**Current read path (faed82d):**

- Generated scheduler: 103 blocks, one canonical register address per block,
  except the clustered 0x1290 × 12 and ASCII blocks. Cadences: 52 blocks at
  15 s, 3 at 75 s, 48 at 300 s. One read outstanding, a 200 ms servicer
  tick, a 3 s timeout, most-overdue selection, and a full pause while any
  write-tx slot, CellCount transaction or topology recovery is pending.
- Bespoke readers: 1 s cell block 0x1200 × 53; resistance 17–32 probe
  0x126A × 16 (15 s, only > 16 cells); calibration 0x1088 × 64 (300 s,
  capability-gated); passcode transaction; topology/CellCount reads.
- **[measured]** (`protocol/evidence/stage1_corrective_evidence/poll_cadence_freshness_20260927.md`,
  600 s read-only):
  - 3.62 scheduler successes/s, meeting the 3.67/s demand;
  - 15 s blocks: median 15.02 s, p99 15.87 s, max healthy lateness +2.97 s;
  - cell voltage 1: median 1.000 s, p99 1.106 s.
- **[model]** ≈ 54 % bus occupancy including turnaround (L = 60 ± 20 ms, cell
  read 60 ms).
- Freshness today:
  - scheduler blocks: `cadence + 7.5 s` (22.5 / 82.5 / 307.5 s);
  - cells: 3 s from `stateUpdatedAt` (value publication, L2);
  - SSE coalescing: detected by the `read_plan_success` sequence jump or a
    skipped revision, then a forward-only merge of the snapshot.

**Objective [proposal]:** one canonical source for read geometry (clusters),
decode, freshness, UI and HA publication:
- telemetry at a target of 1 Hz;
- Settings refreshed every 3 s while the Settings view is active;
- at the same or lower bus load than today.

The target load is an estimate until wide-read latency is measured
**[gate A]**.

## 2. Target cluster inventory [A/C/S geometry verified by gate A 2026-09-28; cadence and ownership still proposal]

These ranges are proposed geometry. They become authoritative only when
Phase A proves the exact response behaviour, and are then encoded in the
canonical cluster source (§15).

| ID | Start × count | Bytes | Covers (canonical) | Normal cadence | Active cadence | Priority | Access | Security | Fallback | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| A1 | 0x1200 × 120 *(gate A 2026-09-28: × 125 refused with exception 2)* | 240 | 0x1200–0x12EF: cell voltages 1–32, 0x1240–0x1249 mask/average/delta/extrema, cell resistances 1–32 (0x124A–0x1288), telemetry 0x128A–0x12EE incl. the 0x1290 cluster; 5 gap words (0x12E0/E2/E8/EA/EC) | 1 s (target) | 1 s | 2 (telemetry) | R | normal | 0x1200 × 53 + 17–32 probe + narrow blocks | 0x1200 × 53 and 0x1290 × 12 in production use; × 120 **verified 2026-09-28** (240/240 bytes) |
| A2 | 0x12F0 × 15 *(was 0x12FA × 10)* | 30 | 0x12F0–0x130D: RTC ticks (U32 0x12F0), temperature 3 (0x12F8), temperatures 4/5, time-enter-sleep, PCL status; 5 gap words (0x12F4/F6/FE, 0x1304/06) | 1 s (target) | 1 s | 2 | R | normal | narrow blocks | × 15 **verified 2026-09-28** (30/30 bytes) |
| C1 | 0x1000 × 120 *(gate A 2026-09-28: × 124 refused with exception 2)* | 240 | 0x1000–0x10EF: protections, control switches 0x1070/74/78, capacity, calibration 1–26; 0 gap words | 300 s | immediate + 3 s | 3 active / 4 background | RW (per field) | narrow blocks + calibration reader | × 120 **verified 2026-09-28** (240/240 bytes) |
| C2 | 0x10F0 × 23 *(was 0x10F8 × 19)* | 46 | 0x10F0–0x111D: calibration 27–32, 0x1108 device address, 0x110C, 0x1114 flags, 0x1118, 0x111C heating temperatures; 4 gap words | 300 s | immediate + 3 s | 3 / 4 | RW (per field) | narrow blocks + calibration reader | × 23 **verified 2026-09-28** (46/46 bytes) |
| S1 | 0x1400 × 20 | 40 | device model, hardware/software version, odd run time, power-on count | startup + 300 s | — | 5 | R | normal | narrow blocks | **[gate A]** |
| S2 | 0x14B2 × 18 | 36 | UART/CAN protocol configuration | startup + 300 s | — | 5 | R/RW | normal | narrow blocks | **[gate A]** |
| S3 | 0x14E4 × 18 | 36 | LCD buzzer, dry contacts, data-stored period, RCV/RFV time, CAN protocol version | startup + 300 s | — | 5 | R/RW | normal | narrow blocks | **[gate A]** |
| P | 0x1470 × 8 | 16 | setup passcode | not periodic in the target design (decision in §11) | — | isolated | credential | **credential** | its own isolated reader | never read in gate A |

Notes:
- Moving odd run time, power-on count and CAN protocol version from 15 s to
  300 s is a deliberate cadence change. Owner confirmation is required
  (they are counters or constants).
- The owner accepted the C1/C2 correction on 2026-09-27; the diagnostic
  allowlist (M0) used it.
- **Gate A, 2026-09-28** (`protocol/evidence/stage1_corrective_evidence/diag_probe_gate_a_20260928.md`):
  - The BMS refused A1 0x1200 × 125 and C1 0x1000 × 124 with exception 2.
  - A2, C2, S1, S2 and S3 answered with exact lengths, and wide = narrow on
    every comparison.
  - **Boundary run, 20:58** (`hw_diag_probe_gate_a_boundary_20260928.log`):
    every cluster above succeeded with an exact length, and **all four ×121
    controls also succeeded**. The hypothesis that 120 is the hardware limit
    is false.
  - Ending a read on half of a U32 did not fail.
  - **Owner decision:** 120 registers is the **verified conservative
    operational maximum**. This is a design decision, not a claim about the
    BMS protocol limit.
  - For the tested ranges, the largest confirmed successful length is 121
    registers, and the smallest previously observed failing length is 124.
  - The exact global device limit was not determined, and ×122/×123 are not
    tested.

## 3. Load and capacity model [model]

Transaction cost ≈ 0.7 ms request + L + response wire time
(0.0868 ms/byte at 115200 Bd) + 50 ms turnaround.

| Wide-response latency L | Telemetry 1 Hz (A1 + A2) | Settings 3 s (C1 + C2) | Active total |
|---|---:|---:|---:|
| 60 ms | 24.6 % | 8.2 % | 32.8 % |
| 100 ms | 32.6 % | 10.9 % | 43.5 % |
| 150 ms | 42.6 % | 14.2 % | 56.8 % |

These figures were computed for the agreed C1 × 125 / C2 × 18 split. The
corrected × 124 / × 19 split changes C by less than 0.1 %. Static clusters
add < 0.1 %.

**Two different limits:**
- **Physical bus occupation:** the table above.
- **Scheduler-slot capacity:** with a 200 ms servicer tick and one read
  outstanding, every transaction takes at least one tick:
  - if a response (plus callback) completes within ~200 ms of issue
    (≈ L ≲ 160–175 ms for a 125-register read), capacity is 5 requests/s;
  - if it spans two ticks, capacity drops to 2.5 requests/s, below the
    active demand of ≈ 2.67 requests/s (2 telemetry + 0.67 Settings), and
    the queue grows.

**Dispatch decision [gate A]:** dispatch the next request from the
completion callback, or use a shorter tick. Either way, capacity ≈
1 / (L + 73 ms). Callback dispatch needs a safe re-entry into the scheduler
from the Modbus callback context; a shorter tick costs more loop
wake-ups. Choose only after gate A measures L, callback time and queue
behaviour.

**Acceptance criteria [proposal]:**
- the queue never holds more than one scheduler request plus one bespoke
  or write command;
- no telemetry cycle is skipped under the worst healthy burst
  (A1 + A2 + C1 + C2 due together) with the chosen dispatch;
- burst completion is below 1 s.

## 4. Scheduler redesign [proposal]

Explicit priority tiers replace "most overdue milliseconds":

1. write and authoritative readback (unchanged ownership: the write-tx and
   topology machines);
2. overdue telemetry (A1, A2);
3. active Settings (C1, C2 under an active lease);
4. background Settings (C1, C2);
5. static (S1–S3).

Rules:

- **One physical request in flight.** No read is issued while a write,
  readback, CellCount or topology-recovery command is outstanding (§5).
- **Due time:** `due = last_attempt + cadence(mode)`, subtraction-safe
  (existing pattern). A tier-n cluster is served only when no tier < n
  cluster is due.
- **Phase staggering:** active Settings are released mid-way between two
  telemetry cycles, not together with them. The offset is a model parameter
  chosen by simulation, not a fixed number here.
- **Timeout:** keep the per-request timeout semantics (a timeout marks the
  cluster, frees the bus, and re-arms the cluster one cadence after the
  attempt). The timeout value for wide reads is set from gate A (today 3 s).
- **No starvation:** a background or static cluster overdue by more than a
  bound (an aging rule, chosen by simulation) is promoted one tier. The
  simulation must show every cluster is served within its budget under
  sustained 1 Hz + 3 s load.
- **Implementation home:** `jk_poll_scheduler_core.h` (pure). New functions
  are named in the implementation phase. This plan does not invent their
  signatures.
- **Deterministic simulation:** extend `poll_cadence_model.h` with clusters,
  tiers, staggering, both dispatch modes, write windows and fault
  injection, calibrated to gate A numbers.

## 5. Write-transaction interaction [proposal]

**Current machine (read from code at `faed82d`):**
- `tick()` runs every 250 ms. SENDING → ACK_WAIT; the ACK callback sets
  `acked`; the next tick moves to READBACK_WAIT and sets `issue_readback`,
  and the loop queues the readback; the readback callback sets
  `readback_done`; the next tick finalizes CONFIRMED/MISMATCH.
- Timeouts: ACK 3000 ms, readback 4000 ms. Six slots. `is_pending()` covers
  SENDING, ACK_WAIT, READBACK_WAIT and WRITE_UNCERTAIN.
- The scheduler pauses on any pending slot, CellCount or topology recovery.
  It does not pause on the passcode transaction; that gap must be closed.

**Idle windows (proposal to prove):**
- W1: after the ACK callback, until the next tick issues the readback
  (0–250 ms);
- W2: after the readback callback, until the confirm tick (0–250 ms).

In W1/W2 the bus is physically idle.

**Rules:**
- Write and readback stay the highest priority. Never issue a read while
  their command is outstanding.
- At most one read-only telemetry request (A1 or A2) may use W1 or W2. If
  it is still on the bus when the readback is queued, the readback waits
  behind it in FIFO order. That delay must stay far below the readback
  timeout.
- CellCount and topology-recovery transactions keep a complete telemetry
  pause, with no interleaving.
- If interleaving is not proven safe, use an explicit bounded
  **write-pause** state:
  - telemetry freshness shows "paused for write" (not stale) for at most
    the transaction bound (ACK + readback timeouts);
  - normal budgets are never widened;
  - a timeout or an excessive duration produces genuine stale.
- The RMW cache age for the register being written is always checked
  against the strict active budget (§6).

**Simulations and tests to choose between them:**
- model W1/W2 with the real `tick()` cadence;
- measure the readback queueing delay distribution against the readback
  timeout;
- FIFO order;
- a timed-out telemetry read inside a window;
- repeated writes;
- a CellCount write (must fully pause);
- write-tx tests for readback timeout margin;
- telemetry freshness with and without interleaving under a 1 s write and
  under a 7 s failed write.

## 6. Cluster raw cache and RMW [proposal]

**Today:**
- `g_rp_last_raw_word[103]` holds ≤ 4 bytes per block;
- `find_block_index_for_address()` matches exact block addresses;
- RMW users:
  - the 100 ms register-write consumer;
  - the `begin_write_tx_rmw` script;
  - the preflight handler;
  - the preflight snapshot copy (`publish_read_plan_block_snapshot`).

**Target:**
- A generated field → (cluster id, byte offset, word count) table. RMW reads
  the target register's raw bytes from the cluster cache at that offset,
  using the existing `merge_field_into_raw()` and
  `verify_sibling_bits_preserved()` to preserve packed siblings.
- The cluster raw cache stores either complete cluster payloads or only the
  writable registers' words. Sizes come from generated geometry (a
  `static_assert` like the preflight table's), never chosen by hand.
- Write gate: raw age ≤ the **strict active budget** of the owning cluster.
  An unknown mode uses the strict active budget. The 300 s background
  budget is never a write gate.
- The narrow authoritative readback after a write stays as it is (a
  one-register read, not a cluster read).
- The preflight snapshot and `/settings/read-freshness` carry cluster
  entries with the same atomic-copy pattern.
- Credential bytes never enter this cache (§11).

## 7. Dynamic cadence and freshness [proposal]

- The only freshness source is a successful physical cluster read. Every
  field maps to its cluster (`fieldMeta.readAddress` → cluster start).
- Cells move from `stateUpdatedAt` to cluster success **before**
  publish-on-change (closes L2 / plan Stage 4).
- `read_plan_success` = `<cluster start>:<cluster revision>:<global sequence>`
  (one entity; the existing browser parser already accepts this shape).
- `/settings/read-freshness` stays read-only with no Modbus traffic. The
  snapshot schema gains, per cluster, the effective mode, cadence and
  budget (or an equally explicit generated representation). The UI uses the
  strict active budget when mode data is missing.
- A switch from 300 s to 3 s requires a new active-mode physical success
  before writes unlock.
- The forward-only merge and the reconnect floor (`settingsFreshnessFloorAt`)
  are unchanged.

**Budget rule:** `maximum measured healthy interval < budget < missed-cycle
interval`. No 1 s or 3 s budget is fixed here. Derivation:
1. Gates B and C produce per-cluster interval distributions
   (p50/p95/p99/max) with the chosen dispatch.
2. The calibrated simulation adds the worst healthy scenarios (write
   windows or write pause, another cluster's timeout, a Settings burst).
3. The budget sits strictly between that maximum healthy interval and the
   missed-cycle interval (for the chosen timeout semantics), with the
   margins written in the evidence.
4. The generator enforces the relation and fails otherwise, replacing
   today's `derivedFreshnessBudgetMs()` for clustered reads.

## 8. Active Settings lease [proposal]

- One global bounded lease, device-side:
  - opening or returning to Settings requests an immediate C1 + C2 refresh;
  - a visible Settings view renews the lease;
  - a hidden page, disconnect or expiry returns the clusters to 300 s.
- Multiple clients share the single lease; the cadence is never multiplied.
- The endpoint only stages a hint (mailbox or atomic, never plain globals
  from the HTTP task). It never performs a Modbus read; the scheduler acts on
  its next pass.
- Rate limiting and expiry follow the `ActiveGroupHandler` pattern (100 ms,
  expiry). The final TTL and renew interval are chosen and tested in the
  implementation phase. This plan does not fix them.
- Old clients that never send a lease get background cadence. Their writes
  fail closed through the firmware's strict active-budget gate.
- Lease renewal is a periodic hint POST, not register polling. It is
  recorded as an explicit exception next to the freshness resync.
- Tests:
  - two tabs, where one hides;
  - disconnect or sleep/wake with expiry;
  - reconnect;
  - rate limiting;
  - lease abuse from many requests (no cadence increase);
  - an old client without a lease.

## 9. Publish-on-change [proposal, only after §7 is in place]

- Exact comparison for binary, enum, configuration, masks, integer counters
  and text.
- Analog thresholds come only from canonical `scale`, `decimal_precision`
  and wire resolution, or explicit evidence. There are no arbitrary
  deadbands.
- Always publish:
  - at startup and on the first successful read;
  - after a topology change;
  - after a confirmed write whose value changed.
- HA and a newly connected browser receive current states on connect
  (ESPHome API state on subscribe; `web_server` initial entity dump). After
  SSE loss, the reconnect dump plus the snapshot resync restore state.
- Freshness advances on every successful cluster read, even when no state
  is published.

## 10. Legacy reader retirement and fallback [proposal]

| Reader | Normal operation | Fallback role | Trigger | Latch | Diagnostics |
|---|---|---|---|---|---|
| Bespoke 0x1200 × 53 (1 s) | removed (A1 covers it) | cell fallback | A1 fails with an exception, timeout, wrong length or failed value validation after bounded retry | boot session | visible cluster mode + reason |
| 17–32 resistance probe 0x126A × 16 | removed | kept with the cell fallback, still capability-gated | same as above | boot session | existing capability entity |
| Narrow scheduler blocks (per address) | removed | per-cluster fallback | that cluster fails as above | boot session, per cluster | cluster mode entity |
| Calibration reader 0x1088 (300 s) | removed (C1/C2 cover it) | Settings fallback | C1/C2 fail | boot session | existing capability entity |
| Duplicate 0x1240–0x1249 reads at 15 s | removed | none (A1 fallback covers it) | — | — | — |
| Narrow write readback | **kept** | — | — | — | — |
| Topology/CellCount reads | **kept** | — | — | — | — |

Fallback rules:
- latched for the boot session;
- never switches back and forth;
- recovery only by reboot or an explicit owner-requested re-test;
- write gates in fallback use the narrow blocks' success times with the
  strict active budget.

## 11. Security [proposal]

- The setup passcode (0x1470–0x147F) stays isolated. Its bytes are never in
  any cluster, cluster raw cache, `g_rp_last_raw_word` or preflight snapshot,
  and never in HA, SSE, Diagnostics or logs. This removes today's first-4-bytes
  cache entry (§0.5).
- The retired `setup_passcode_readback` stays rejected by the browser.
  `setup_passcode_status` stays status-only.
- Periodic passcode polling (today every 15 s, status only) is an owner
  decision:
  - keep an isolated status read;
  - or read only during the passcode transaction.

  Either way it uses its own reader.
- The passcode transaction joins the scheduler's write/bus-ownership gate.
- Diagnostic firmware never prints full raw frames, and Phase A never reads
  0x1470–0x147F.

## 12. Diagnostic measurement mechanism

| | 1. Isolated diagnostic firmware | 2. USB-RS485 adapter, ESP32 disconnected |
|---|---|---|
| Measures BMS latency L | yes | yes |
| Measures ESP32 callback and queue behaviour (the dispatch decision) | **yes** | no |
| Hardware change | none (flash) | rewiring; two masters on one bus are not allowed |
| Tooling | the owner's ESPHome 2026.9.0 | a host script. Serial access with the Python stdlib alone (`termios`) is possible; `pyserial` is a third-party package and against project policy |
| Risk | a flash cycle, rolled back to the known image | disconnecting the monitor, manual wiring |

**Owner decision (2026-09-27): option 1**, the isolated diagnostic build,
because the tick/callback decision needs ESP32 timing. Implemented in M0.

Diagnostic firmware contract:
- only an enumerated list of FC03 reads (the cluster table in §2, P
  excluded);
- no network endpoint accepting arbitrary addresses;
- no FC06/FC10/FC16;
- runs for a bounded time, then idles;
- reports per request: length, L, exception code, timeout and CRC/length
  failure. Values are reported as a digest plus decoded non-credential
  fields only; no full raw frames;
- rollback: re-flash the known deployed image.

Expected files: a separate diagnostic configuration and a pure measurement
header with host tests. Production `batterylifepo4.yaml` behaviour does not
change. Compile and flash each need explicit owner authorization.

## 13. Hardware gates

**Phase A (one-shot, read-only):**
- A1, A2, C1, C2 (corrected), S1, S2, S3;
- wide-decoded values vs current narrow values of the same fields;
- gap words;
- inactive 17–32 channels on 16S;
- 0x1290 layout and length;
- L vs request size;
- callback processing time;
- queue timing.

**Phase A rerun (2026-09-28 design, one fixed 29-step read-only pass):**
- The steps: liveness (0x1000 × 2), A2, A1 × 120, A121, liveness, A121W,
  liveness, C2, C1 × 120, C121, liveness, C121W, liveness, S1–S3, then the
  13 narrow comparison reads.
- Only a failed liveness read aborts the pass. Any other unexpected result
  is recorded (`match=0`, `unexpected`), and the pass continues.
- No ×122/123 and no on-device bisection.
- If a ×121 control answers OK, the 120-limit hypothesis is false: stop and
  redesign.
- **Result (2026-09-28 20:58):** a complete, valid pass.
  - 29/29 steps; no timeout, retry, short/long reply or late callback.
  - Liveness 5/5 OK.
  - All clusters OK with exact lengths, and all four ×121 controls OK
    (242 bytes), so the 120-limit hypothesis is false.
  - Stable comparisons all equal.
  - On this 16S unit, voltage and resistance channels 17–32 read all zero.
  - Gap words are not uniformly zero.
  - The redesign decision: keep 120 as the verified conservative operational
    maximum; do not test ×122/×123.

**Phase B (read-only):** A1 + A2 at 1 Hz for ≥ 10 min, no writes. Record:
- p50/p95/p99/max intervals;
- timeouts and wrong lengths;
- queue depth;
- missed cycles.

**Phase B status (2026-09-28): host-prepared only — not compiled, not
authorized, not eligible for OTA until the owner confirms production is
restored.**
- `B_TELEMETRY_SOAK` issues only A1 `0x1200 × 120` then A2′ `0x12F0 × 15`
  once per second, for a 10 min default. Each read is one FC03 frame with no
  hub retry, and there is never more than one request outstanding.
- A late cycle starts once, as soon as the previous one ends. Missed 1 s
  slots are skipped (counted as `missed`), never replayed.
- Every non-OK outcome counts as unexpected. Gate B never aborts; it stops
  permanently at the deadline, until reboot.
- Host tests prove this: the core suite's gate B section, the contract
  checks and the gate B mutations. How to run it and the pass criteria are in
  `docs/guides/BUILD_AND_DEPLOY.md` ("Gate B").

**Phase C (read-only):** 1 Hz telemetry + Settings every 3 s for 15–30 min.
Validate:
- staggering;
- the lease;
- dynamic freshness;
- no queue accumulation.

**Phase D:** writes, separately authorized per field and value. It needs
§5 and §6 implemented and host-proven, and gates A–C passed. Nothing is
pre-authorized here.

**Final acceptance:** a 24–72 h observation.
- **Pass criteria:**
  - no false stale under healthy traffic;
  - real stale on missed cycles and timeouts;
  - no credential exposure;
  - no HA or UI regression.
- **Rollback criteria:** any fallback latch under healthy conditions,
  unexplained timeouts, queue growth or a stale storm → re-flash the
  previous image.

## 14. Tests and mutation plan

| Topic | Extend | New |
|---|---|---|
| Cluster geometry and ownership | `test/register_catalog/validate.js`, `test_negative_fixtures.js` | cluster-schema tests (no straddle, full coverage, P excluded) |
| Decode | `test_read_plan_decode.cpp` | wide/narrow golden-vector equivalence per cluster; topology cases 1S/2S/4S/8S/16S/17S/24S/32S; inactive-channel suppression |
| Scheduler | `test_jk_poll_scheduler_core.cpp`, `poll_cadence_model.h`, `test_poll_cadence_simulation.cpp` | tier/starvation; one-tick vs two-tick capacity; staggering; dispatch modes |
| Writes | `test_jk_write_tx_core.cpp`, `test_jk_write_tx_rmw_core.cpp`, `test_jk_write_tx_rmw_end_to_end.cpp` | cluster-offset RMW; strict-age gate; W1/W2 FIFO and readback-timeout margin; CellCount full pause |
| Freshness and lease | `test_settings_catalog.js`, `test_sse_reconnect.js` | multi-client lease; mode transitions; coalescing recovery with clusters |
| Publish-on-change | — | per-type comparison; initial publication; topology and write publication |
| Fallback | `test_jk_capability_core.cpp` | fault injection (exception, timeout, short, long, bad values); latch with no oscillation |
| Security | `test_credential_redaction.js`, `test_secret_scan.js` | P never in any cluster, cache or snapshot; a sentinel never leaves the device |

Mutations each phase must catch:
- a straddling boundary;
- P inside a cluster;
- most-overdue priority restored;
- no staggering;
- a two-tick dispatch at the measured L;
- a read during an outstanding write;
- the background budget used as a write gate;
- unknown mode defaulting to background;
- value publication used as the freshness source;
- an arbitrary deadband;
- an oscillating fallback;
- credential bytes cached;
- the lease multiplying the cadence.

## 15. Canonical, generator and artifact ownership [proposal]

| Fact | Owner |
|---|---|
| Register geometry, decode and UI metadata | `protocol/registers.canonical.json` (hand, validated) |
| Cluster definitions (ID, start, count, cadences, priority, P exclusion) | a new hand canonical source, `protocol/read_clusters.canonical.json` + schema (proposal), validated for coverage/no-straddle/no-credential |
| Cluster table, field offsets, cache sizes, budgets | `tools/protocol/generate_read_plan.js` → `read_plan.json/.yaml`, `read_plan_decode.h` (generated) |
| Priority, staggering, dispatch | `components/jk_poll_scheduler/jk_poll_scheduler_core.h` (hand, pure) |
| Write entries and RMW offsets | `tools/protocol/generate_write_registry.js` → `write_registry*` (generated) |
| Browser catalog and routes | `tools/protocol/generate.js`, `build_protocol_entity_routes.js` (generated block in `jk_bms.js`) |
| Runtime state (lease, mode, fallback latch) | `batterylifepo4.yaml` + pure cores |
| Evidence (gates A–D, soak) | `protocol/evidence/…` |

Generator order: `generate.js` → `generate_read_plan.js` →
`generate_write_registry.js` → `tools/protocol/authoring/*` →
`pipeline.js build` → every `--check` → `pipeline.js check`. Then run the
fingerprint check → review → accept whenever `jk_bms.js` or
`batterylifepo4.yaml` changes. A new file under `protocol/` must also be
added to the `FILES_TO_COPY`-style lists in `test_negative_fixtures.js`,
`test_generation_atomicity.js` and `test_fingerprint_drift_regression.js`.

## 16. Phases (each resumable in a new session)

Rules that apply to every phase:
- **Prerequisite:** the previous phase's commit is HEAD on
  `codex/rs485-unified-pipeline` and the tree is clean (`git status
  --porcelain` is empty). Stop otherwise.
- **Commit:** one commit per phase, only on the owner's instruction,
  staging explicit paths only.
- **Rollback:** `git revert <phase commit>`. Firmware phases also re-flash
  the previously deployed image.
- **Deployment delta:** for each changed runtime file, report the
  repository path → ESPHome destination (`jk_bms.js` →
  `jk_bms_ui/jk_bms.js`, `jk_bms.css` → `jk_bms_ui/jk_bms.css`, generated
  files at the same path), byte size and SHA-256. `batterylifepo4.yaml`
  only as a patch against the owner's overlay, never as a whole file.
  Docs-only phases have no deployment.
- **Standard verification** (in every phase that changes code or data): the
  targeted tests; every generator `--check`; `pipeline.js check`; the
  fingerprint check → review → accept when `jk_bms.js` or
  `batterylifepo4.yaml` changes; the full `bash test/run_all.sh`.
- No phase relies on chat context. Its inputs are this plan, the committed
  evidence and the listed files.

### M0 — Diagnostic measurement mechanism (execution step 3) — CORRECTED, awaiting a new compile-only validation

> **Status (2026-09-27):**
> - Implemented in `5cead7e`. It compiled on ESPHome 2026.9.0: RAM 43.1 %,
>   flash 44.6 %.
> - An accidental OTA then showed a **real embedded-stack defect**.
>   `Probe::begin()`'s `*this = Probe();` put a ~32 KB temporary on the
>   8 KB ESP32 loopTask stack. The image reset before ESPHome marked the
>   OTA valid, and the bootloader rolled back to production. No `diag`
>   line was logged.
> - The host functional tests did not catch it: they run on an 8 MB stack.
> - Fixed in `fix(diag): avoid probe startup stack overflow`: in-place
>   `reset()`, plus a firmware-stack regression test and reset-equivalence
>   tests.
> - The fix is source-proven. There is no device confirmation yet (no
>   serial crash record, no Xtensa ELF).
> - Evidence: `protocol/evidence/stage1_corrective_evidence/diag_probe_gate_a_rollback_20260927.md`.
> - **M0 still requires a new compile-only validation** of the corrected
>   probe (no install, no OTA). No production file changed.

- **Prerequisite:** this plan's commit `35bea1d`. The owner chose option 1
  and accepted the C1/C2 correction.
- **Files:**
  - `components/jk_diag_probe/jk_diag_probe_core.h` — pure core:
    - the static allowlist with compile-time checks;
    - classification and the exception-line parser;
    - the bounded A/B/C scheduler;
    - statistics;
    - metadata-only formatting.
  - `jk_bms_probe.yaml` — the separate diagnostic configuration, placed next
    to `batterylifepo4.yaml` so that it shares `secrets.yaml`.
  - `test/jk_diag_probe/test_jk_diag_probe_core.cpp`.
  - `test/protocol_catalog/test_diag_probe_contract.js` — the allowlist
    against canonical geometry, plus a static audit of the configuration.
  - `test/run_all.sh`.
- **Reuse:**
  - `ModbusCommandItem::create_read_command` (the production pattern);
  - `jk_capability::classify_response()` (the exact-length rule) and
    `jk_capability::callback_matches_pending_attempt()` (late replies);
  - `ModbusController::add_on_command_sent_callback()` (the frame-on-wire
    time: queue delay vs BMS latency);
  - `logger: on_message` (ESPHome reports an exception response only as a
    WARN line, which the core parses strictly).
- **Allowlist:**
  - the seven wide reads of §2 (C1 `0x1000 × 124`, C2 `0x10F8 × 19`);
  - 14 narrow comparison reads, each a whole-register sub-range of one wide
    read. All but `0x10F8 × 2` are reads production already performs.
  - The setup passcode 0x1470–0x147F is excluded (compile-time and runtime
    checks).
  - The only other functionality is logging and OTA: no web server,
    entities, API services or write path. `modbus_controller` polls nothing
    (`update_interval: never`).
- **Phase selection (compile-time only):** substitution `probe_mode`:
  - `A_COMPATIBILITY` (gate A): one pass over every allowlisted read, ≥ 1 s
    apart. It finishes as soon as the pass completes, normally ≈ 40–50 s
    after boot: 20 s delay + 21 × (1 s spacing + latency). The worst case,
    with every request timing out at 3 s, is ≈ 104 s. 5 min is only the
    deadline.
  - `B_TELEMETRY_SOAK` (gate B): A1 then A2 every 1 s, 10 min;
  - `C_COEXISTENCE` (gate C): gate B plus C1 then C2 every 3 s, staggered
    500 ms, 20 min.

  `probe_run_ms` (0 = mode default) is clamped to 30 min, and
  `probe_start_delay_ms` defaults to 20 s. Nothing on the network can change
  a mode, an address or a count.
- **Termination:** the run latches FINISHED at its deadline (mode A: after
  the pass). Then it logs the summary (`diag run/stat/cmp/sum` lines) and
  issues no Modbus request until a reboot; a reboot repeats the same
  bounded run.
- **Evidence per request:**
  - identity, expected and actual length, class
    (OK/SHORT/LONG/EXCEPTION/TIMEOUT), exception code and hub re-sends;
  - queue delay (issue → first frame on the wire);
  - BMS latency (last frame → response) and total;
  - callback processing time;
  - OK-to-OK interval statistics (p99, max, > 1.5 × cadence, missed cycles);
  - narrow/wide equal-word counts (stable vs live);
  - zero-word counts for inactive channels 17–32 and gap words.

  No response bytes are ever logged.
- **Verification:**
  - `test_jk_diag_probe_core.cpp`: 64 checks at `5cead7e`, 73 after the
    stack fix. The new checks are the reset-equivalence ones: a byte-equal
    default state after `begin()` on used probes in every transient state.
  - `test/jk_diag_probe/test_jk_diag_probe_stack.sh` (added by the stack
    fix):
    - every YAML-facing entry point, and every function in the harness unit,
      must stay ≤ 2,048 B of stack at `-O3`/`-O2`/`-Os`;
    - also enforced with `-Wframe-larger-than=2048 -Werror`;
    - it rejects `*this = Probe();` with a 31,824 B frame at `-O3`.
  - `test_diag_probe_contract.js` (32 checks);
  - 15 mutations, all caught: credential entry added (wide or narrow);
    credential check removed; write function allowed; raw-frame logging;
    YAML payload logging; clamp removed; no deadline; length check
    weakened, in the core or in the shared rule; requests after finish;
    endless pass; late generation accepted; YAML write path; allowlist
    re-check removed; `web_server` added;
  - full `run_all.sh`.
- **Hardware:** none in this phase.
- **Commit:** `feat(diag): add bounded clustered-read measurement build`.
- **Deploy:** nothing to production. For M1 only, the owner copies
  `jk_bms_probe.yaml` (next to `batterylifepo4.yaml`) and
  `components/jk_diag_probe/jk_diag_probe_core.h`.
  `components/jk_capability/jk_capability_core.h` is already part of the
  production set.

### M1 — Hardware gates A–C (execution step 4)

> **Status (2026-09-28, 20:58): gate A COMPLETE.**
> - The boundary-control run (`e93a5a9`, build 20:55:11) passed 29/29 steps.
> - The verified cluster geometry is: A1 0x1200 ×120, A2′ 0x12F0 ×15,
>   C1 0x1000 ×120, C2′ 0x10F0 ×23, S1–S3.
> - 120 is the owner-adopted conservative operational maximum (×121 also
>   succeeded).
> - Evidence: `protocol/evidence/stage1_corrective_evidence/diag_probe_gate_a_20260928.md`
>   §6.
> - Gate B needs separate owner authorization, and production must be
>   confirmed restored first.
>
> **Earlier status (2026-09-28): gate A partial; the boundary-control rerun was implemented host-only.**
> - The 11:07 run is invalid for geometry: an external BMS communication
>   failure made every read time out.
> - The 17:37 run is valid but partial: A1 × 125 and C1 × 124 got
>   exception 2; everything else was OK.
> - The corrected run adds ×120 clusters, ×121 controls (prefix and
>   whole-register), five liveness reads and deterministic timing (§13).
>   It needs a compile-only check, then separate owner authorization.
>
> **Earlier status (2026-09-27): gate A incomplete and not authorized.**
> - One accidental install booted the defective `5cead7e` image, which
>   rolled back. It produced **no gate A measurement evidence**.
> - A retry needs the corrected M0 to pass a compile-only validation first,
>   then separate, explicit owner authorization.
> - Build isolation is resolved in the repository. Both configurations are
>   named `jk-bms` and had shared `/data/build/jk-bms`. `jk_bms_probe.yaml`
>   now sets `esphome.build_path: .esphome/build/jk-bms-probe`, and the
>   contract test enforces it (evidence file, §5).
> - The next compile log must show the `jk-bms-probe` build path.

- **Prerequisite:** M0, including the compile-only validation of the
  corrected probe.
- **Files:** evidence files under
  `protocol/evidence/stage1_corrective_evidence/` (or a new evidence
  folder) and the fixture lists if a new evidence file must be copied
  (§15).
- **Reuse:** the observation/evidence format of
  `poll_cadence_freshness_20260927.md`.
- **Deliverables:**
  - results for gates A, B and C (§13);
  - decisions on the dispatch mode, the confirmed geometry, the wide-read
    timeout and the per-cluster budgets (§7 derivation).
- **Verification:** each claim is traceable to a committed evidence file.
- **Mutations:** not applicable (evidence only).
- **Hardware:** **owner authorization** for the compile and flash of the M0
  build, each run's duration, and the rollback re-flash.
- **Commit:** `docs(evidence): record clustered read gates A-C`.
- **Deploy:** re-flash the baseline image after the runs.

### M2 — Canonical clusters and the generated cluster table (host only) — DONE (host)

> **Status (2026-09-28):** implemented.
> - `protocol/read_clusters.canonical.json` (schema
>   `protocol/schema/read-clusters-source.schema.json`) holds the verified
>   geometry A1 0x1200×120, A2 0x12F0×15, C1 0x1000×120, C2 0x10F0×23,
>   S1–S3, with the passcode P 0x1470×8 as the only isolated, on-demand read.
> - `tools/protocol/generate_read_clusters.js` validates it: coverage of all
>   202 canonical registers exactly once (201 in clusters + P), no overlap, no
>   straddle, credential isolation, and budget = cadence + J (J = 500 ms).
>   It emits `protocol/generated/read_clusters.json` and
>   `read_clusters_table.h`, and has a deterministic `--check`.
> - Tests: `test/protocol_catalog/test_read_clusters.js`, with 13 negative
>   fixtures; 13/13 generator-rule mutations are caught.
> - The per-cluster budgets are the rule applied to the cadences; gate B/C
>   interval evidence is still pending.

- **Prerequisite:** M1.
- **Files:** `protocol/read_clusters.canonical.json`, a schema under
  `protocol/schema/`, `test/register_catalog/validate.js`,
  `tools/protocol/generate_read_plan.js`, the generated `read_plan.*`, and
  the fixture lists in `test_negative_fixtures.js`,
  `test_generation_atomicity.js` and `test_fingerprint_drift_regression.js`.
- **Reuse:** canonical validation in `tools/protocol/lib/semantic-checks.js`;
  the generator's `--check` pattern.
- **Deliverables:**
  - validated coverage (every register in exactly one cluster or P);
  - a no-straddle check;
  - the P exclusion;
  - a generated cluster table, not yet used at runtime.
- **Mutations:** a straddling boundary; P inside a cluster; an uncovered
  register; an overlap.
- **Hardware:** none.
- **Commit:** `feat(protocol): define canonical read clusters`.
- **Deploy:** generated files, if their bytes changed.

### M3 — Scheduler tiers, staggering and dispatch (host only)
- **Prerequisite:** M2.
- **Files:** `components/jk_poll_scheduler/jk_poll_scheduler_core.h`,
  `test/jk_poll_scheduler/test_jk_poll_scheduler_core.cpp`,
  `poll_cadence_model.h`, `test_poll_cadence_simulation.cpp`.
- **Reuse:** the subtraction-safe due arithmetic in `pick_next_block()`; the
  calibrated model.
- **Deliverables:**
  - the tier selection and aging rule;
  - the staggering offset chosen by simulation;
  - the dispatch mode chosen in M1.
- **Mutations:** most-overdue restored; no staggering; starvation; two-tick
  dispatch at the measured L.
- **Hardware:** none.
- **Commit:** `feat(scheduler): prioritize clustered reads`.
- **Deploy:** none until M5 uses it.

### M4 — Cluster decode, raw cache and RMW offsets (host only)
- **Prerequisite:** M3.
- **Files:** `tools/protocol/generate_read_plan.js`,
  `tools/protocol/generate_write_registry.js`, the generated
  `read_plan_decode.h` and `write_registry*`, `test_read_plan_decode.cpp`,
  `test/jk_write_tx/*`.
- **Reuse:** `merge_field_into_raw()`, `verify_sibling_bits_preserved()`,
  `raw_is_fresh()`, the `static_assert` sizing pattern of
  `jk_preflight_snapshot_core.h`.
- **Deliverables:**
  - wide/narrow golden vectors;
  - the field → (cluster, offset) table;
  - cache sizes from geometry;
  - the strict-age gate;
  - credential exclusion.
- **Mutations:** a wrong offset; the background budget used as a gate;
  unknown mode defaulting to background; credential bytes cached.
- **Hardware:** none.
- **Commit:** `feat(protocol): decode clusters and cache writable raw`.
- **Deploy:** none until M5.

### M5 — Firmware servicer on clusters, with fallback
- **Prerequisite:** M4.
- **Files:**
  - the generated `read_plan.yaml`;
  - `batterylifepo4.yaml` (the bespoke readers become fallback);
  - `demo/mock-server.js`;
  - `jk_bms.js` (the cluster success format and snapshot schema);
  - the tests.
- **Reuse:** the `jk_capability` latch; the `read_plan_success` sequence;
  `mergeReadBlockSnapshot()`.
- **Deliverables:**
  - cluster reads in normal operation;
  - `cluster:revision:sequence` events;
  - the snapshot schema with mode/cadence/budget;
  - the fallback latch and its diagnostics;
  - the passcode moved to its isolated reader and added to the bus
    ownership gate.
- **Mutations:** an oscillating fallback; a silent fallback; P in a
  cluster; the passcode transaction outside the gate.
- **Hardware:** **owner authorization** for the compile, the flash and a
  bounded read-only runtime check.
- **Commit:** `feat(firmware): read registers in clusters`.
- **Deploy:** `jk_bms.js`, generated files, `batterylifepo4.yaml` patch.

### M6 — Cells on cluster freshness (closes L2 / Stage 4)
- **Prerequisite:** M5.
- **Files:** `jk_bms.js`, `tools/protocol/generate.js` (`fieldMeta.readAddress`
  → cluster), `test_settings_catalog.js`, `test_cell_composite_rows.js`.
- **Reuse:** `settingsFieldFreshness()`, `readBlockFreshness`.
- **Deliverables:** no cell key takes freshness from `stateUpdatedAt`.
- **Mutations:** the `stateUpdatedAt` fallback restored for cells.
- **Hardware:** none (runtime check covered by M5/M7).
- **Commit:** `fix(ui): take cell freshness from cluster reads`.
- **Deploy:** `jk_bms.js`.

### M7 — Active Settings lease and dynamic freshness
- **Prerequisite:** M6.
- **Files:** the `batterylifepo4.yaml` handler (the lease),
  `jk_poll_scheduler_core.h`, `jk_bms.js`, `test_sse_reconnect.js`,
  `test_settings_catalog.js`.
- **Reuse:** the `ActiveGroupHandler` rate-limit/expiry shape and the
  `RegisterWriteRequestMailbox` staging pattern.
- **Deliverables:**
  - one global lease;
  - an immediate refresh on open;
  - strict budgets for writes;
  - a new active-mode success required before unlock.
- **Mutations:** the lease multiplying the cadence; no expiry; an old
  background read unlocking writes.
- **Hardware:** **owner authorization** for a read-only runtime check.
- **Commit:** `feat(settings): refresh Settings under an active lease`.
- **Deploy:** `jk_bms.js`, `batterylifepo4.yaml` patch, generated files.

### M8 — Write interleaving or explicit write pause; gate D
- **Prerequisite:** M7.
- **Files:** the write-tx loop in `batterylifepo4.yaml`, the scheduler
  core, `test/jk_write_tx/*`, the simulation.
- **Reuse:** `tick()`, `is_pending()`, `DEFAULT_*_TIMEOUT_MS`.
- **Deliverables:** the §5 decision made in simulation, then confirmed in
  gate D.
- **Mutations:** a read during an outstanding write; interleaving during
  CellCount; a widened budget in place of the write-pause state.
- **Hardware:** **per-field write authorization** for gate D.
- **Commit:** `feat(write): coordinate writes with clustered reads`.
- **Deploy:** `batterylifepo4.yaml` patch, generated files.

### M9 — Publish-on-change
- **Prerequisite:** M8.
- **Files:** the generated publish logic (`generate_read_plan.js`), tests.
- **Reuse:** canonical `scale` / `decimal_precision`.
- **Deliverables:** §9 rules.
- **Mutations:** an arbitrary deadband; no initial publication; freshness
  tied to publication.
- **Hardware:** **owner authorization** for a read-only runtime check.
- **Commit:** `perf(firmware): publish cluster values on change`.
- **Deploy:** generated files.

### M10 — Acceptance and cleanup
- **Prerequisite:** M9.
- **Files:**
  - evidence;
  - `docs/protocol/ARCHITECTURE.md`, `CURRENT_LIMITATIONS.md` (close L2,
    L9, L12, L13), `DECISIONS.md`;
  - the generator comment behind L9.
- **Deliverables:** the 24–72 h soak evidence (§13); fallback readers kept
  only as the latched fallback.
- **Verification:** the §13 pass and rollback criteria.
- **Hardware:** **owner authorization** for the soak.
- **Commit:** `docs(project): accept clustered read architecture`.
- **Deploy:** only if the cleanup regenerates files.

### Future: ESPHome Modbus API migration (not scheduled; blocks upgrading ESPHome)

- **Baseline:** ESPHome **2026.9.0** is the current controlled build
  baseline for production and the diagnostic probe.
- **The change:** ESPHome 2026.9.0 deprecates `ModbusCommandItem`, its
  factories (`create_read_command`, `create_write_multiple_command`, …),
  `queue_command()`, `unqueue_command()` and related APIs. Their documented
  removal is in **2027.3.0**. The replacements are the entity write helpers
  and `modbus_client` actions.
- **Scope:** every production and diagnostic use:
  - `batterylifepo4.yaml`;
  - `components/jk_capability`, `components/jk_write_tx`,
    `components/jk_diag`, `components/jk_diag_probe`;
  - `jk_bms_probe.yaml`;
  - the generator `tools/protocol/generate_read_plan.js`, never its output
    `protocol/generated/read_plan.yaml`;
  - including write acknowledgements and recovery reads.
- **Required tests:** equivalent coverage for clustered reads, forced
  readback, RMW, timeout/retry handling, diagnostics and writes.
- **Rule:** do not adopt ESPHome 2027.3.0 or newer until this migration is
  complete and verified. It does not interrupt M0–M10.

## 17. Non-goals

- No `gps_heartbeat` retry.
- No authentication redesign.
- No service-action execution.
- No BMS write without per-field authorization.
- No browser polling of register data.
- No broad UI redesign.
- No guessed geometry, budgets, deadbands or lease timings presented as facts.
- No credential data in shared clusters, caches, logs or streams.
