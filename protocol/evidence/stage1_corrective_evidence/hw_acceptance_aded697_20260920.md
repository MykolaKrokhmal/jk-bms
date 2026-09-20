# Stage 3 hardware acceptance — second attempt (post-reflash)

Date: 2026-09-20
Deployed firmware commit (expected HEAD at flash time): `aded697`
Device: ESP32 + jk_poll_scheduler, RS485/Modbus RTU bridge to JK-PB BMS, `http://192.168.27.43`
Method: read-only, single-EventSource `/events` (SSE) capture from the Browser pane, no POST/writes/OK-clicks/artificial state changes. Digest Auth was disabled for this session (state recorded, not changed).

This is the second hardware-acceptance attempt for Stage 3, following a first attempt on the
same branch that concluded **Stage 3 NOT CLOSED** because the flashed firmware did not match
the expected commit (deployment mismatch). This round starts after the user re-transferred
files, performed a clean build, and reflashed.

## 1. Deployment gate

| Check | Result |
|---|---|
| ESP uptime at connect | 1713s (~28.5 min) — decisively different from, and far smaller than, the prior round's stale 118615s. Confirms a genuine new boot. |
| Canary entities present (`binary_sensor/heating active`, `binary_sensor/alarm wire res`, `text_sensor/uart1 mprtol enable`, `text_sensor/uart mprtol enable 0 15`, `sensor/smart sleep timeout hours`) | All 5 present with plausible values within the first 2 minutes. |
| Cluster coverage (0x1114, 0x1118, 0x12D0, 0x12A0, UART) | At least one entity from each of the 5 clusters confirmed present. |

**Gate: PASSED.** Proceeded to full acceptance per the session's own protocol.

## 2. Phase A — continuous capture

Single `EventSource` connection held open across the observation window, reaching **3563s
(~59.4 min) with reconnects=0, errors=0** on the first uninitialized connection. Uptime grew
monotonically and consistently with elapsed wall-clock time (1713s → 5273s), confirming no
reboot occurred mid-observation. Two later, deliberate, sequential (never parallel)
reconnects occurred — one to force a fresh full-state dump, one unintended (a page navigation
that reset the JS capture context) — both logged transparently; a final independent
reconnect near session end reached uptime 9354s (~2.6h) with the electrical-metrics anomaly
(§4 below) still reproducing identically, ruling out a client-side/stale-cache artifact.

## 3. Phase B/C/D/E — results

- **0x1504 (RCVTime/RFVTime):** stable, repeatedly re-confirmed across the full observation
  window and again after each reconnect — `rcv_time=5.0 h`, `rfv_time=1.0 h`. No response
  length mismatch, no Modbus exception. Confirms `register_count=1` (the 2026-09-19-corrected
  value) is correct on real hardware. **0x1504 blocker CLOSED** (see
  `protocol/evidence/protocol_blockers.json`).
- **0x1114/0x1118/0x12D0/0x12A0 projection arithmetic:**
  - 0x12D0: RAW `sensor_heating_mask` = 65280 (0xFF00). Manually recomputed `(raw & mask) >>
    shift` for all 7 projections — exact match against observed values in every case
    (`heating_active=OFF`, `mos_temp_sensor_status_bit_raw=1`,
    `bat_temp_sensor_{1..5}_present=ON`).
  - 0x12A0: RAW `alarms_bitmask` = 0 → all 22 alarm bits correctly OFF. PASS for
    wiring/arithmetic; explicitly **NOT OBSERVED** (not PASS) for the active-alarm transition,
    since no alarm condition was naturally present and none was artificially triggered (per
    instruction).
  - 0x1114: routing-only confirmation (no RAW parent by architecture) — all 9 fields present
    and updating.
- **UART (0x14B4/0x14C4):** `uart1_mprtol_enable` = `FF 67 00 00 00 00 00 00 00 00 00 00 00 00
  00 00`, `uart_mprtol_enable_0_15` = `FF 0F 00 00 00 00 00 00 00 00 00 00 00 00 00 00` — both
  exactly 16 uppercase space-separated bytes, genuinely different values (no aliasing), no
  truncation at embedded `0x00`.

All of the above: **PASS**, no regressions.

## 4. Confirmed software defect — 0x1290 (total_voltage / current)

**Symptom:** `sensor/total voltage` and `sensor/current` (and every entity fed by the same
block: `power`, `charging_power`, `discharging_power`, `charging_current`,
`discharging_current`) read `NA` (unavailable) **continuously for the entire observation
window** (>2.5h, confirmed fresh boot, zero reboots, re-verified independently via two
separate `EventSource` reconnects). Individual cell voltages, `active cells voltage sum`
(55.150 V), `alternate battery voltage` (55.15 V), and `bms health=LIVE` all read normally
throughout — the raw Modbus link was not failing. Downstream: `text_sensor/topology
state=MISMATCH`, `reason=VOLTAGE_SUM_DIFFERS` (the topology resolver's own cross-check
against a total_voltage that was never successfully decoded even once). `jk_topology`'s own
code was independently confirmed untouched by any Stage 3 commit this session
(`git log --oneline -5 -- components/jk_topology/`), ruling it out as an independent defect —
it is a downstream symptom.

**Root cause:** the 2026-09-19 generic exact-length response validation
(`data.size() != payload_bytes`) in `tools/protocol/generate_read_plan.js`'s emitted scheduler
callback was applied **unconditionally to every block**, including the one
`CLUSTERED_GAP_AWARE` custom-decode block at 0x1290. That block's `payload_bytes=12` was only
ever proven as `decode_electrical_metrics()`'s own read length (unit/golden-vector tests),
never as this device's true wire response byte count — which remains the same open,
hardware-pending question this block's own `exceptionReason` has carried since before this
round (`register_count` candidates: 10 via declared-address-span, 12 as the unchanged legacy
literal, neither proven). Before this round, the identical `payload_bytes=12` literal lived
under a floor check (`data.size() < payload_bytes`) that tolerated any response ≥ 12 bytes;
this round's blanket exact-match change silently converted that into a strict check for the
one block whose exactness was never hardware-proven, while correctly tightening validation for
the 6 genuinely, individually audited `ORDINARY_ONE_REGISTER`/`ASCII_CONTIGUOUS` sites. Every
one of those other blocks continued to update correctly on the identical validator throughout
this session — only 0x1290 failed, and failed 100% of the time.

**Fix (this round, software-only):**
- `components/jk_poll_scheduler/jk_poll_scheduler_core.h`: added `Block::strict_length`
  (`true` = exact-match, `false` = floor-check).
- `tools/protocol/generate_read_plan.js`: the 0x1290 `CUSTOM_DECODE_BLOCKS` entry now emits
  `strict_length=false` (floor check, `data.size() >= payload_bytes`); every other block keeps
  `strict_length=true` (exact-match, unchanged). The emitted scheduler callback now branches
  per block: `length_ok = strict_length ? (data.size() == payload_bytes) : (data.size() >=
  payload_bytes)`.
- Regression coverage:
  `test/jk_poll_scheduler/test_read_plan_decode.cpp`'s
  `test_strict_length_carve_out_for_clustered_gap_aware_block()` (new, C++, exercises the real
  generated table and simulates the emitted `length_ok` expression against representative
  response sizes: 12/20/24 accepted, 0/11 rejected for 0x1290; exact-match still enforced both
  directions for 0x1504); updated assertions in
  `test/protocol_catalog/test_generic_read_plan_register_count.js`,
  `test/protocol_catalog/test_projection_decoder.js`, and
  `test/register_catalog/validate.js`.
- `protocol/evidence/protocol_blockers.json`: new open blocker for 0x1290 documenting this
  incident and fix, still hardware-pending on the underlying `register_count`/response-length
  question.

**This fix is software-only and was NOT live on the device that produced this evidence** — it
requires a new firmware build and flash to take effect. All gates
(`generate_read_plan.js --check`, `generate.js --check`, `pipeline.js check`, full
`test/run_all.sh`, `git diff --check`, secret scan) pass with the fix applied; see this
session's own commit for the exact diff.

## 5. Second retest attempt (same day) — deployment mismatch, working-tree reversion

A second retest attempt was made the same day, still against HEAD `3e4de6f`. The deployment
gate **FAILED**: `total_voltage`/`current`/`power`/`charging_power`/`discharging_power`/
`charging_current`/`discharging_current` all still `NA`, `topology_state=MISMATCH`,
`reason=VOLTAGE_SUM_DIFFERS` — the identical pre-fix symptom, on a genuinely fresh boot
(uptime 282s→302s, monotonic).

Root cause of *this* failure was traced to the local working tree, not the device: 12 tracked
files — `components/jk_poll_scheduler/jk_poll_scheduler_core.h`, `protocol/generated/read_plan.yaml`,
`protocol/generated/read_plan_decode.h`, and 9 other generated artifacts — had been silently
reverted outside of git (no stash, no reflog checkout) to content byte-identical to commit
`aded697` (the pre-fix commit), with owner-only `-rwx------` file modes suggesting an external
tool wrote them. The transferred `jk_poll_scheduler_core.h`/`read_plan.yaml`/`read_plan_decode.h`
therefore did not contain the `strict_length` fix at all. A diagnostic patch of the reversion
was saved to `/tmp/jk-bms-stale-external-reversion-20260920.patch` (outside the repo, never
committed), and all 12 files were restored with `git restore --source=HEAD` — verified by
SHA-256 (`jk_poll_scheduler_core.h`=`c25a029c...`, `read_plan.yaml`=`af802fa0...`,
`read_plan_decode.h`=`04cb71e8...`), file mode (`100644`), and direct content grep
(`bool strict_length`, `const bool length_ok = strict_length ? ...`, the `0x1290` kBlocks row
ending `false`). No tests/generators/compile/flash/commit were run at that point — restore-only.

## 6. Third retest attempt — PASS, fix confirmed live

Files re-transferred fresh from the restored HEAD `3e4de6f`; SHA-256 verified on the device
side before compile (matching the same three hashes above). Clean build, compile, flash.

**Deployment gate: PASSED.**

| Check | Result |
|---|---|
| ESP uptime at connect | 172s — fresh boot |
| `total_voltage` | `55.147 V` — live, non-NA |
| `current` | `0.000 A` — live, non-NA |
| `power`/`charging_power`/`discharging_power`/`charging_current`/`discharging_current` | all published, non-NA (`0.00 W`/`0.00 W`/`0.00 W`/`0.000 A`/`-0.000 A`) |
| `topology_state` | `CONFIRMED` |
| `topology_reason` | `OK` |

**20+ minute continuous single-EventSource observation** (wall-clock: 2026-09-20T17:45:05Z →
2026-09-20T18:12:22Z, ~27.5 min, exceeding the 20-min requirement):

| Metric | Result |
|---|---|
| First/last ESP uptime | 148s → 1860.7s (monotonic, consistent with elapsed wall-clock; zero reboots) |
| Reconnects / transport errors | 0 / 0 |
| `total_voltage` updates | 104, **0 NA** |
| `current` updates | 104, **0 NA** |
| `total_voltage` min/max/last | 55.137 V / 55.154 V / 55.145 V |
| `current` min/max/last | 0.000 A / 0.370 A / 0.000 A |
| `power` max (at the `current`=0.37A sample) | 20.4055 W |
| BMS health | `LIVE` throughout |
| `topology_state` / `reason` | `CONFIRMED` / `OK` throughout |

**Consistency checks:**
- `total_voltage` (55.15 V) vs `active_cells_voltage_sum` (55.143–55.148 V) — within ~2–7 mV,
  inside the topology resolver's own tolerance (topology stayed `CONFIRMED` the entire window).
- `power = total_voltage × current` verified exactly at the peak-current sample:
  `55.15 × 0.37 = 20.4055 W` = observed `power` = observed `charging_power` (current positive →
  charging, matching the project's documented sign convention); `discharging_current`/
  `discharging_power` correctly `0` at that same sample.
- No response-length mismatch, no short-response, no Modbus warning observed for 0x1290 or any
  other block across the full window.

**Regression spot-check — all PASS:**
- `rcv_time=5.0 h`, `rfv_time=1.0 h` — present.
- 0x1114 (`heating_active=OFF`), 0x1118 (`smart_sleep_timeout_hours=24 h`) — present.
- 0x12D0 projection (`bat_temp_sensor_1_present=ON`), 0x12A0 alarm (`alarm_wire_res=OFF`) — present.
- Both UART hex `text_sensor`s: 16 uppercase space-separated bytes each, distinct values
  (`FF 67 00...` vs `FF 0F 00...`) — unchanged from the first attempt.
- Cell voltages/resistances live (`cell 1` = 3.447 V / 0.056 mΩ).
- Cells tab header: "Батарея 16S · напруга та опір"; DOM-level check confirmed channel 16's
  history button `disabled=false, display=flex` and channel 17's `disabled=true, hidden=true,
  display=none` — exactly the required 16-visible/17–32-hidden+disabled boundary.
- Diagnostics panel: `ОСТАННЯ КОМАНДА` → Команда `—`, Результат `—`. `РЕЗУЛЬТАТИ ЗАПИСУ`:
  ПІДТВЕРДЖЕНО `0`, РОЗБІЖНІСТЬ `0`, ТАЙМ-АУТ `0`, ПОМИЛКА `0`.
- Zero POST requests, zero BMS writes, zero OK/confirm clicks performed this session (only
  passive tab navigation and read-only SSE).

## 7. Blocker disposition

The immediate 0x1290 software-defect blocker (opened 2026-09-20) is **CLOSED** per its own
closure_criterion option (b): a subsequent hardware-acceptance session on the fixed firmware
build confirmed `total_voltage`/`current` read live, non-NA values repeatedly (104/104) and
without regression.

The deeper question — the exact FC03 wire response byte length for 0x1290 (register_count 10
vs 12, never directly captured) — remains genuinely open and is **not** claimed proven by this
result: the floor-check accepting the response proves functional recovery, not the exact byte
count. A new, narrow, explicitly **non-blocking** technical-debt entry was opened for this at
the same address, so the gap stays tracked without gating Stage 3 or any later stage.

## 8. Final verdict

**Stage 3 CLOSED — READY FOR STAGE 4.**

Deployment gate PASSED, ≥20-minute continuous observation PASSED with zero NA/zero errors,
voltage/current/power consistency PASSED, regression spot-check PASSED, write-safety proof
PASSED (0/0/0/0, Last command `—`, zero POST/writes). The full `test/run_all.sh` gate, secret
scan, `git diff --check`, and the metadata/pipeline/fingerprint checks all pass with this
round's evidence-only changes; see this session's own commit for the exact diff.

## Minimal deployment manifest (historical — already applied and hardware-confirmed)

Files changed by the software fix (already transferred, compiled, flashed, and confirmed live
in §6 above — kept here for the record, not as a pending action):

- `components/jk_poll_scheduler/jk_poll_scheduler_core.h`
- `protocol/generated/read_plan.yaml` (generated)
- `protocol/generated/read_plan_decode.h` (generated)
- `protocol/generated/read_plan.json` (generated, audit-only, not compiled)
