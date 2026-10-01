# M6/M7 production runtime observation — 2026-10-01

**Status: PASSED.** This is a bounded, read-only production runtime audit of
`bfa2b44` (M6 cell freshness and the M7 active Settings lease). It is **not**
a combined gate C pass: the gate B diagnostic counters remain open.

## Build and deployment

- **Source:** `bfa2b44` plus the owner's local overlay (commented `auth:`,
  files under `jk_bms_ui/`). It was applied as an incremental patch from the
  deployed `3ee3f36`.
- **Toolchain:** ESPHome 2026.9.1 with ESP-IDF 5.5.5. Build path
  `/data/build/jk-bms`. Full build, 0 errors.
  - RAM 59.8 % (108,120 B, 24 B less than `3ee3f36`).
  - Flash 68.7 % (1,260,739 B, 2,620 B more).
  - `config_hash=0x5dc113b1`, build time 2026-10-01 15:40:23 +0300.
- **Deployment:** the owner ran compile and OTA together ("Install"); the
  OTA succeeded. Log: `m6_m7_production_runtime_20261001/compile_ota_bfa2b44.log.gz`.
- **Warnings (26), all previously known; none new from M6/M7:**
  - 24 Modbus API deprecations, at exactly the line numbers predicted for
    `bfa2b44`;
  - the two legacy L14 warnings: `jk_reset_diag_rtc.h:90` and
    `batterylifepo4.yaml:5425` (formerly line 5438).

### Source identity

- **UI: cryptographic.** The served `/0.js`, gunzipped, is byte-identical to
  `jk_bms.js@bfa2b44` (939,964 B, SHA-256 `45252784…d136`).
- **Firmware: high, not cryptographic.** All 26 warning line numbers match
  `bfa2b44`.
- **Uptime** was continuous: 1565 → 1925 s during the capture, consistent
  with a boot right after the 15:40 OTA.

## Method

- **Authorization:** the owner authorized at most 10 minutes. Interactions
  were limited to:
  - GET `/0.js` and GET `/settings/read-freshness`, the snapshot every 2 s;
    it never touches Modbus;
  - one SSE connection;
  - the browser lease POST caused by opening the Settings tab.
- **Browser:** the built-in browser pane. Claude switched only the panel tab
  (Overview → Settings → Overview), with the owner's explicit permission.
- **Inspection only:**
  - a MutationObserver recorded the OK buttons' `disabled` state;
  - PerformanceResourceTiming recorded the lease requests;
  - no OK button was activated and no value was changed;
  - there were zero write or entity requests (`browser_timeline.json`).
- **Pre-check (aborted, ≈2.5 min, 16:05:45–16:08 EEST):** another client
  held the global lease (`lease=1`, C1 every 3 s for over 70 s while this
  pane showed Overview). The owner closed the other UI clients, and the
  lease expired by itself about 10 s later. This incidentally confirmed the
  3 s active cadence; the data is in `precheck_freshness_series.log.gz`.
- **Main capture:** 13:08:05Z–13:14:14Z (16:08:05–16:14:14 EEST). SSE
  connection 1 ran from 13:08:05Z to 13:13:36Z. A 25 s extension ran to
  13:14:14Z, with a 12.6 s SSE gap between the two. Cadence across that gap
  is taken from device revisions.

## Results

| Cluster | Background (phase 1, 131 s) | Active lease (phase 2, 138 s) | After expiry (phase 3) |
|---|---|---|---|
| A1 | 1.000 s (129 events, steps all 1) | 1.000 s | 1.000 s |
| A2 | 1.018 s (one SSE coalescing at the initial burst) | 1.000 s | 1.000 s |
| C1 | 15.003 s | **3.001 s** (46 events, min 2.964 / max 3.029, steps all 1) | **15.0 s**: last active read 387.411, then 402.414; rev 450 → 453 over 402.4–447.4 = 3 × 15.0 s |
| C2 | 14.999 s | **3.000 s** (46 events) | 15.0 s, follows C1 |
| S1–S3 | 15.00 s | 15.00 s (S2/S3 jitter ±0.5 s, sharing the phase slot) | 15.0 s |

Epoch-second suffixes below are 1790860xxx.

**Lease activation:**
- The lease POST ran 225.110–225.164 (HTTP 200).
- The first C1 read completed at 225.416, 0.25 s later, at the next phase
  slot; the first C2 read followed at 225.460.
- The snapshot `lease` flag went to 1 by 226.9 (2 s polling).

**Renewals:**
- 14 lease POSTs in total, about every 10 s; the last one at 360.009.
- They did not multiply the cadence or queue work: C1/C2 stayed at a steady
  3.0 s, revision steps all 1, and the global sequence was monotonic
  (4215 → 5143).

**Expiry:**
- The tab left Settings at 362.6. No further lease POST was sent; the
  browser never sends `none`.
- The firmware `lease` flag returned to 0 by 390.3 (2 s polling), which is
  30.0 s after the last renewal was processed.
- C1/C2 returned to 15 s.

**Write readiness (strict, post-activation):**
- Before Settings opened, 0 of 23 OK buttons were enabled.
- After the tab opened at 225.116, still 0. The C1 background read at
  216.428, from before activation, did not unlock anything.
- At 225.416, the first active C1 read, exactly the **18 C1** live rows
  unlocked.
- At 225.460, the first active C2 read, the remaining **5 C2** rows
  unlocked: 23 in total.
- After leaving Settings at 362.6, 0 were enabled immediately (fail
  closed).

**Health and errors:**
- No reset: uptime and ping were monotonic.
- BMS health was `LIVE` in all 170 events; cluster mode was `clusters`
  throughout.
- 0 fallback-block events and no fallback in any snapshot.
- No timeout, length or queue log, and no stale storm.
- **No `modbus took a long time` warning** in this window. The one log line
  was `web_server took a long time … (150 ms)`.
- **Writes: none.** The write transaction snapshot was empty, the last write
  crash stage was `IDLE`, the CellCount and passcode transaction status was
  `NA`, and there was no `jk_write_tx` log.

## Not covered (still open)

- **Combined gate C diagnostic counters:** `issued`, `short`, `long`,
  `exception`, `timeout`, `resend` and `late`; the per-read interval
  p99/max/`over1.5x`; and `queue_ms`. Production does not expose them.
- **M8 and gate D.** Settings writes remain **prohibited**.

## Files (`m6_m7_production_runtime_20261001/`)

| File | Bytes | SHA-256 |
|---|---|---|
| `sse_timed.log.gz` (`gzip -9 -n`) | 388853 | `d39093bc6d457000d23f43ba19482fc80ef8a4c892694baabf5d9c1351194961` |
| `freshness_series.log.gz` | 46635 | `7cecf6f8fbec56bc94509da793881a489dda42d50c3f93585e32673aef894559` |
| `precheck_freshness_series.log.gz` | 9985 | `70c4394268e4d3ba9e14d7531089a61178dbf77e2f3a8d59babab11d2abf10c2` |
| `compile_ota_bfa2b44.log.gz` | 17357 | `2852907e4a2ac92f4f3aaed62019a6fedb5729f5ddfbc8c0bf1a616b3e0cee87` |
| `analysis.txt` | 3066 | `5302f4cb6d29ddd4025753b220e7fdee82347b8ee2d8d8bf854cf1a01bd33d02` |
| `analyze_m7.py` (produces `analysis.txt` from the uncompressed logs) | 4060 | `6d52068ffe133a34d316ebe9d6aa4edf7af1b89dac1d13458412498ba6abbe5b` |
| `browser_timeline.json` | 1499 | `651ba82619f5465159718cff6de9495fff25ce6cef5eb9adfe227abd6bf8e1f4` |
| `capture_metadata.txt` | 572 | `e0c40f71742ada7a63b89511478a0cafd3ad5760dc5fd6c36668382c9db46b07` |
| `freshness_t0.json` (pre-check snapshot; lease held by the other client) | 3088 | `1694e0f637525247a7594330a0e653184d97a479a6adb0a23c469954fb5bab2f` |

- **Uncompressed originals:**

  | Original | Bytes | SHA-256 |
  |---|---|---|
  | `sse_timed.log` | 6,763,695 | `f75d28cb…e07b` |
  | `freshness_series.log` | 447,065 | `e38739f3…b2a8` |
  | pre-check `freshness_series.log` | 91,619 | `57a72399…d6017` |
  | `batterylifepo4-install-3.txt` | 153,385 | `12908c2d…9c34` |

- **Not retained:** `/0.js` itself (only its hash and the equality result
  above).
- **Secret scan:** no value from the local compile environment appears in
  any retained file. The capture contains the device's LAN IP, as earlier
  committed hardware evidence does.
