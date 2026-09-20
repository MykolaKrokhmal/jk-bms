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

## 5. Verdict

**Stage 3 NOT CLOSED.** A confirmed software defect was found and fixed this round, but the
fix has not yet been deployed to hardware. A new build + flash + a third hardware-acceptance
pass (repeating the deployment gate and, at minimum, re-confirming total_voltage/current read
live values and topology_state returns to CONFIRMED) is required before Stage 3 can close.

Everything else observed this round (deployment gate, Phase A continuous capture, 0x1504,
0x1114/0x1118/0x12D0/0x12A0 projection arithmetic, UART) is a clean PASS and does not need to
be re-verified from scratch on the next attempt — only the 0x1290 fix and its downstream
topology effect need re-confirmation.

## Minimal deployment manifest for the next flash

Files changed by this round's fix (re-transfer exactly these plus their already-unchanged
dependents the build already pulls in):

- `components/jk_poll_scheduler/jk_poll_scheduler_core.h`
- `protocol/generated/read_plan.yaml` (generated — re-run `node tools/protocol/generate_read_plan.js` before transfer, don't hand-copy)
- `protocol/generated/read_plan_decode.h` (generated, same as above)
- `protocol/generated/read_plan.json` (generated, audit-only, not compiled, but keep in sync)

No other component or YAML file changed. A full clean build from the current tree (same
procedure as this round's reflash) picks all of these up automatically via the existing
`packages: { register_reads: !include protocol/generated/read_plan.yaml }` include.
