# Production `c531ba1`: compile/OTA and read-only runtime audit (2026-10-03)

Status: **read-only runtime audit PASSED (accepted by the owner).** The send-attempt
diagnostics are deployed but have **not yet been observed in a real transaction**.
Gate D has not started.
Raw data: [`c531ba1_send_attempt_runtime_20261003/`](c531ba1_send_attempt_runtime_20261003/)
(hashes in its `SHA256SUMS`).

## Deployed state

- **Firmware / backend: `c531ba1`** (`feat(write): expose actual Modbus send attempts`).
  - Owner Device Builder compile + OTA on 2026-10-03; build time 21:22:54 +0300.
  - Log: `compile_ota_c531ba1.txt.gz`, 141,757 B uncompressed, sha256 `b811d341…a30e`.
  - `config_hash 0xcb0075fd`.
  - ESPHome 2026.9.1, `Build path: /data/build/jk-bms`.
  - RAM 108,968 B (+96 B over ca7d337); flash 1,268,847 B (+576 B over the 83e9698 UI build).
  - Image 1,268,960 B; `OTA successful`.
  - 10 compiler warnings, as expected:
    - 8 Modbus API deprecations in `read_plan.yaml` (1058, 1065, 1071, 2002, 2024, 2036,
      2060, 2567);
    - `jk_reset_diag_rtc.h:90`;
    - `batterylifepo4.yaml:5678`. This was 5660; the YAML grew by 18 lines.
  - None of the warnings names the new send-attempt code.
- **Embedded UI: byte-identical to `jk_bms.js@83e9698`.**
  - Size 952,288 B, sha256 `e0f20be0d467ea9e7dd847d4df65b71962041575db9d81b39ed60007ec7fbfa6`.
  - This is the expected result. The c531ba1 package did not ship `jk_bms.js`, because
    `jk_bms.js@c531ba1` differs only in two generated hash lines. See `0js_identity.txt`.
  - The UI lineage is 83e9698.

## Audit

Window and access:
- 2026-10-03 18:36:45Z → 18:41:26Z: one SSE connection, curl `-m 280`.
- `GET /0.js` once; `GET /settings/read-freshness` at start and at end.
- No POST, no Settings view, no Modbus write.

| Check | Result |
|---|---|
| uptime | 785 → 1055 s, no decrease. `reset count since power on` = 6, which is the OTA itself (boot ≈ 21:23). |
| `bms health` / `read cluster mode` | LIVE throughout / `clusters` |
| cadence | A1/A2 1.000 s mean. S1–S3 15.0 s. C1/C2 3.0 s while the Settings lease was held and 15.0 s while it was not (`c2_lease_timeline.txt`). |
| lease | 1 at start and end, 0 from 21:38:12 to 21:40:57. It was held by a Settings client already connected before the capture: the window shows no new SSE session (only this capture's own iterator burst). The capture itself sent only GETs. This is correct M7 behaviour, not a firmware deviation. |
| `read_pause_reason` | `none` |
| `write transaction snapshot` | `""`: never published since boot, so no transaction since boot (not an error) |
| fallback / WRITE_UNCERTAIN / cleanup | 0 non-cluster (fallback) events. Crash stage IDLE. No transaction and `read_pause_reason` `none` mean no write-uncertain slot and no pending transport cleanup. |
| warnings (L16 observation) | 5 × `component:419` `modbus took a long time` of 304, 335, 356, 368 and 374 ms, all in the first 74 s of the window. No other warning. Recorded only; no new L16 investigation. |

## Not shown by this audit

- **The send-attempt fields** (`fn`, `qty`, `fc16_send_attempts`, `readback_send_attempts`,
  `probe_send_attempts`) appear only in a transaction's snapshot entry. They will first be
  observed in gate D.
- **Firmware source identity** is high but not cryptographic. The warning set and line
  numbers match the modelled c531ba1 YAML.

## Files

| file | content |
|---|---|
| `compile_ota_c531ba1.txt.gz` | owner compile + OTA log (`gzip -9 -n`) |
| `sse_timed.log.gz` | the full timestamped SSE stream. Uncompressed 5,310,263 B, sha256 `6ea1d38a…8b73`. Contains LAN addresses, as earlier captures do. |
| `freshness_start.json`, `freshness_end.json` | `/settings/read-freshness` at start and at end |
| `analysis.txt` | `m8_production_runtime_20261001/analyze_sse.py` output |
| `c2_lease_timeline.txt` | C2 success intervals and new-session bursts |
| `0js_identity.txt` | `/0.js` headers, hashes, comparison with 83e9698 and c531ba1 |
| `capture_metadata.txt`, `capture.sh`, `ts.py` | capture window and scripts |
| `SHA256SUMS` | `shasum -a 256 -c SHA256SUMS` |
