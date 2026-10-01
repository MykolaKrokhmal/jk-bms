# M5 production runtime observation — 2026-10-01

**Status:** production runtime evidence for the deployed M5 firmware. This is
**not** a formal gate B pass (see "Gate B" below).

## Build and deployment

- **Source:** commit `3ee3f36` (`feature/rs485-unified-pipeline`) plus the
  owner's local overlay:
  - web `auth:` is commented out;
  - the UI files are under `jk_bms_ui/`;
  - the owner's validate log resolved `read_plan.yaml` from
    `/config/esphome/jk_bms_ui/protocol/generated/`, so at least the
    generated package lives under `jk_bms_ui/` too. The other include paths
    were not observed.
- **Toolchain (owner's Device Builder):** ESPHome **2026.9.1**, ESP-IDF
  5.5.5. Build path `/data/build/jk-bms` (production, not the probe path).
- **Compile result:** `Successfully compiled program.`, 0 errors.
  - RAM 59.8 % (108,144 / 180,736 B); IRAM 59.3 %.
  - Flash 68.6 % (1,258,119 / 1,835,008 B); app partition 31 % free.
  - `config_hash=0x849e265d`.
- **OTA:** to the test ESP32 at 192.168.27.43, 2026-10-01 at 09:33 and again
  at 10:46 (build time 10:46:52 +0300), both with the same `config_hash`.
- **Boot:** at ≈10:47:35 +0300, immediately after the second OTA.
  `reset reason` = `SW (esp_restart)`; reset count since power on = 4.

### Compiler warnings (26)

- 24 are `-Wdeprecated-declarations` for `ModbusCommandItem` /
  `queue_command`, which are removed in ESPHome 2027.3.0. This is the known
  Modbus API migration item.
- 2 are legacy warnings from code unchanged since `8fbe54f`; they are not
  from M5:
  - `components/jk_diag/jk_reset_diag_rtc.h:90` — `-Wextra`: enumerated and
    non-enumerated type in conditional expression;
  - `batterylifepo4.yaml:5438` — `-Waddress`: the address of
    `total_runtime_in_seconds` will never be NULL (an always-true check).

## Source identity and confidence

- **Web UI:** the served `/0.js`, gunzipped, is byte-identical to
  `jk_bms.js@3ee3f36` (931,074 B, SHA-256
  `97d42992011955de0ae61771b8dd26f8fe7a4ecfe3c53f630ebb8d6927ae870f`).
  Confidence: **high (cryptographic)**.
- **Firmware:** every compiler-warning line number matches `3ee3f36`, in
  both `batterylifepo4.yaml` (1834 … 4406, 5438) and `read_plan.yaml` (1061,
  1998, 2032, 2563). Confidence: **high, not cryptographic**. The headers
  cannot be hashed on the device, and `config_hash` does not cover every
  included C++ source, so it is not used as proof.

## Observation

- **Owner authorization:** one bounded, read-only audit of at most 10 min.
  Only GET requests and SSE were used: no POST, no Modbus request from the
  host, no Settings action.
- **Interval:**
  - start snapshot at 2026-10-01 08:06:46Z (11:06:46 EEST);
  - one SSE connection from 08:06:55Z to 08:15:50Z (534.7 s, no reconnect;
    the curl exit code 28 is the planned `-m 535` deadline);
  - end snapshot at 08:15:50Z;
  - snapshot-to-snapshot interval ≈544 s.
- **An earlier attempt the same morning was superseded.** Its capture lost
  network connectivity at about 10:58. The device itself did not reboot:
  uptime is continuous from ≈10:47:35. That attempt is not retained.

### Clusters

| Cluster | Mode (start/end) | Cadence | Budget | Revision between snapshots | SSE mean interval | SSE max interval | Age at end |
|---|---|---|---|---|---|---|---|
| A1 | cluster/cluster | 1 s | 1.5 s | 1149 → 1694 (+545) | 1.000 s | 1.112 s | 199 ms |
| A2 | cluster/cluster | 1 s | 1.5 s | 1149 → 1693 (+544) | 1.004 s | 3.257 s* | 950 ms |
| C1 | cluster/cluster | 15 s | 15.5 s | 77 → 113 (+36) | 15.000 s | 15.057 s | 12.7 s |
| C2 | cluster/cluster | 15 s | 15.5 s | 77 → 113 (+36) | 15.000 s | 15.033 s | 12.6 s |
| S1 | cluster/cluster | 15 s | 15.5 s | 77 → 113 (+36) | 15.000 s | 15.032 s | 12.5 s |
| S2 | cluster/cluster | 15 s | 15.5 s | 77 → 113 (+36) | 15.000 s | 15.035 s | 12.4 s |
| S3 | cluster/cluster | 15 s | 15.5 s | 77 → 113 (+36) | 15.001 s | 15.025 s | 12.4 s |

\* One SSE coalescing during the initial state burst: the revision stepped by
4 in one event. The device-side revision count (+544 in ≈544 s) shows that
no read was missed.

- **Sequence:** the global success sequence went 2720 → 3951 with no
  non-monotonic step.
- **Fallback blocks:** 102 of 103 read-plan blocks are fresh at the end (max
  age 12.7 s). The only one with no success is `0x1470`, the setup passcode,
  which is read on demand only.

### Findings

- **Resets:** none. Uptime went 1145 → 1685 s (system uptime sensor) and
  1161 → 1691 s (SSE ping), with no decrease.
- **BMS health:** `LIVE` in all 264 events; `topology state` was `CONFIRMED`
  in all 526.
- **Fallback:** none. `read cluster mode` = `clusters`; 0 fallback-block
  success events; all 7 clusters were in `cluster` mode in both snapshots.
- **Errors:** no timeout, transport, length-mismatch or queue log.
- **Stale storms:** none, and no repeated snapshot resynchronization.
- **Writes:** none.
  - `write transaction snapshot` was empty and `last write crash stage` was
    `IDLE`.
  - The CellCount and setup-passcode transaction status was `NA`.
  - There was no `jk_write_tx` or `jk_passcode` log.
- **Blocking warning:** a single
  `[W][component:419]: modbus took a long time for an operation (252 ms), max is 250 ms`.
  It caused no visible cadence deviation. It remains an explicit gate C
  observation target.

## Gate B

This production observation is **not** a formal gate B pass. It covers:
- cadence;
- `missed = 0`, from device-side revision accounting;
- successful reads;
- absence of fallback;
- absence of writes;
- runtime stability.

It does not provide:
- the per-request counters (`issued`, `short`, `long`, `exc`, `timeout`,
  `resends`, `late`);
- the per-read interval distribution (p99, max, `over1.5x`);
- `queue_ms`;
- bus-level FC03, single-frame or single-outstanding proof.

**Owner decision (2026-10-01, risk-based):**
- No separate gate B diagnostic OTA.
- The missing gate B metrics are deferred to one combined gate C, whose
  `C_COEXISTENCE` workload already includes gate B's A1/A2 workload.
- No production diagnostic entities are added solely to reproduce gate B.

## Restrictions in force

- Settings writes remain **prohibited** until gate D (after M6–M8, with
  per-field approval).
- The M5 firmware stays deployed; no rollback is required.

## Files (`m5_production_runtime_20261001/`)

| File | Bytes | SHA-256 |
|---|---|---|
| `freshness_start.json` | 2648 | `fb1706302b58e5f01339a68142f5a0407d993a8f1c17682726c13766b41e3c20` |
| `freshness_end.json` | 2776 | `dbc2d2060cea365474d66973f4c64d988cd5e241de7d2d8457bbbd11e80240b0` |
| `analysis.txt` | 1728 | `6781302fbc6162010fec64ca7f494bddafa9c543c6bd5993b03ec751235f60c9` |
| `analyze_sse.py` (produces `analysis.txt`) | 4035 | `3c6c3a7d972c5bac5d3cf4c9bacf99d59a4caa7a168031ced846605ee70091ea` |
| `capture_metadata.txt` | 486 | `06c41ffdb7bfcfba62e9ea781c455a60ba9b5b885afeeaec83ea988eff62484e` |
| `sse_timed.log.gz` (`gzip -9 -n`) | 546095 | `d5046f11b3935006d5d024a56eb46bc7e7e6a3440bf9076b9b46b4277b2d45ab` |

- **The uncompressed SSE capture `sse_timed.log`:** 9,714,475 B, SHA-256
  `31a6cd46a782a2828804e9668659160e34fb81001407c7b9984cd9eead97cd23`. Each
  line is prefixed with its host arrival epoch time.
- **Reproduce the analysis with:**

  ```bash
  python3 analyze_sse.py <(gunzip -c sse_timed.log.gz)
  ```

  The output is byte-identical to `analysis.txt`.
- **Not retained:**
  - `/0.js` as served (`177,153 B` gzip; SHA-256 `640f7663…60ed`), because
    its body equals `jk_bms.js@3ee3f36`;
  - the HTTP headers;
  - the superseded first attempt.
- **Device identifiers:** the capture contains the device's LAN IP, as earlier
  committed hardware logs do. It contains no secret value from the local
  compile environment.
