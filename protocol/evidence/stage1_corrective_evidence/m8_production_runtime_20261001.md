# M8 production runtime audit — 2026-10-01

**Status: PASSED (all 7 owner checks). Open observation:** main-loop
blocking warnings of 361–638 ms and one 5.3 s SSE delivery gap. Their cause
is unknown. This is not a gate D result: no write was made.

## Build and deployment

- **Source:** `3e1981c` (M8 write coordination) plus the owner overlay.
  - It was applied as the incremental package from the deployed `bfa2b44`.
  - The patch had 2 hunks, with `auth:` and the `jk_bms_ui/` paths
    unchanged.
- **Compile:** ESPHome 2026.9.1 / ESP-IDF 5.5.5, build path
  `/data/build/jk-bms`.
  - 0 errors, `config_hash=0x761ac342`, built 2026-10-01 23:12:35 +0300.
  - RAM 108,192 B (59.9 %, 72 B more than `bfa2b44`); flash 1,261,987 B
    (68.8 %, 1,248 B more).
  - 26 warnings, all at the predicted lines and none new:
    - 24 Modbus API deprecations: `batterylifepo4.yaml` 1811/1821,
      1829/1842, 1915/1925, 1929/1942, 2046/2079, 2100/2194, 2285/2296,
      4380/4401, and `read_plan.yaml` 1054/1061, 1067/1998, 2020/2032,
      2056/2563;
    - L14 `jk_reset_diag_rtc.h:90` and `batterylifepo4.yaml:5441`.
- **OTA:** the owner pressed Install, so compile and OTA ran together. The
  OTA uploaded 1,262,096 B and logged `OTA successful`.
  - Log: `m8_production_runtime_20261001/compile_ota_3e1981c.txt.gz`.
  - The original is 153,385 B, SHA-256 `c2ba9b6c…c860`.

## Audit

- **Scope:** owner-authorized, read-only, at most 10 min. Only GET `/0.js`,
  GET `/settings/read-freshness` and one SSE connection: no POST, no lease,
  no Modbus request, and no browser UI from the auditor.
- **Window:** 2026-10-01 20:22:42Z–20:26:52Z, with SSE for 239.6 s.

| # | Check | Result |
|---|---|---|
| 1 | `/0.js` identity | gunzipped SHA-256 `02a4c77ed2160e81be33719b127e0e1cfd08945731e7155b61076ca72be2c59d` = `jk_bms.js@3e1981c` (byte-identical; served gzip 180,576 B, `63edf774…992e`; not retained) |
| 2 | `read_pause_reason` | present; `none` in all 3 events |
| 3 | State | `bms health` LIVE (118 events); `read cluster mode` `clusters`; lease 0 for all 7 clusters in both snapshots |
| 4 | A1/A2 | device revisions +249 in about 250 s, so about 1.00 s |
| 5 | C1/C2, S1–S3 | +17 in about 250 s (14.7 s); SSE mean 14.98–15.00 s, max 15.13 s |
| 6 | Fallback, resets, writes | no fallback events; uptime 515 → 755 s with no decrease; `reset reason` SW (OTA); write snapshot empty, crash stage `IDLE`, CellCount/passcode `NA` |
| 7 | Block freshness | 102/103 in both snapshots; only `0x1470` (setup passcode, on demand) has no age |

## Observations (open)

1. **Main-loop blocking:** `[W][component:419]: modbus took a long time for
   an operation` at 361, 371, 381 and **638 ms**. They arrived at SSE
   arrival times +10.6, +38.6, +43.7 and +52.9 s (`long_operation_warnings.txt`);
   none in the remaining 187 s.
   - Earlier windows: 252 ms once (M5 on `3ee3f36`); none (M6/M7 audit on
     `bfa2b44`); 159 ms once (`bfa2b44` restore check); none in the 20-min
     gate C probe run, which publishes no entities.
2. **SSE delivery gap:** A1 was absent from the stream for 5.30 s (+47.4 to
   +52.7 s; revision 563 → 568), around the 638 ms warning. The device kept
   reading, since device revisions are continuous, so this was delivery
   latency, not missed reads. A browser may briefly have shown A1 stale or
   resynchronized.
3. **Duplicate SSE events:** the two "non-monotonic" sequence steps in
   `analysis.txt` are the same `read_plan_success` value delivered twice
   (`A2:589:1410`, `A2:649:1550`), not a decrease.
4. **Lease before the audit:** the start snapshot shows C1/C2 revision 50
   against 34 for S1–S3. So a Settings lease (3 s cadence) was active for a
   while after the OTA, from a client other than the auditor. Lease was 0
   throughout the audit.

## Files (`m8_production_runtime_20261001/`)

| File | Bytes | SHA-256 |
|---|---|---|
| `sse_timed.log.gz` (`gzip -9 -n`) | 294600 | `78f0a3dcf53bf3436a296fc702f93cae06dc922998ac4134f130cebe790a5abb` |
| `freshness_start.json` | 2946 | `c29b592614a0e6f64241b057133733d5d49d8e99d49aaeb50b539a7a1eb308d2` |
| `freshness_end.json` | 2946 | `67751bca1f3c43854d8c902cd9d2fb89b6457e5bab6445b17102edb59fc99519` |
| `analysis.txt` | 2005 | `f6bf32d73bac246f6dde1b3040726eb7908a4ad89ad96f6ae9515b72dae2f72c` |
| `analyze_sse.py` (produces `analysis.txt` from the uncompressed log) | 4035 | `3c6c3a7d972c5bac5d3cf4c9bacf99d59a4caa7a168031ced846605ee70091ea` |
| `long_operation_warnings.txt` (SSE log lines, trailing CR stripped) | 424 | `6bc268b71cbc379e2550c876cd7ce0dcce46a41ccaa702326e599448924e4490` |
| `capture_metadata.txt` | 307 | `8607e7e86e91e34db150878303cf1652f310e21a08cb699f6cb34e446e4f13ed` |
| `compile_ota_3e1981c.txt.gz` | 17345 | `28cafe30e424ef081b145162d467eac8b6a707582fa38e725ed2f4abbe3b1d34` |

- **Uncompressed SSE capture:** 4,386,382 B, SHA-256
  `857a15542d993b04874e6111826653df72d425bfe981c4aa08d7016698759ac5`.
- **Secret scan:** no local compile-environment value appears in any file,
  including the gzip contents. The capture holds the device LAN IP, as
  earlier hardware evidence does.
- **Restrictions in force:** Settings writes remain prohibited; gate D has
  not started.
