# UI `83e9698` check + two owner-executed 0x1114 writes on production (2026-10-02)

Status: **separate evidence record. This is NOT a completed Gate D.**
Raw data: [`ui_83e9698_owner_lcd_writes_20261002/`](ui_83e9698_owner_lcd_writes_20261002/)
(hashes in its `SHA256SUMS`).

## What ran

- **Production firmware:** `ca7d337` (M8.1 + M8.2), OTA 2026-10-02 13:56,
  `config_hash 0x9965ace9`.
- **UI:** `83e9698` (in-page, non-blocking write confirmation), OTA 2026-10-02 17:41.
  - Flash image 1,268,271 B.
  - `config_hash` unchanged at `0x9965ace9`: `js_include`/`css_include` enter the
    hash only as paths.
  - `GET /0.js` returned a body byte-identical to `git show 83e9698:jk_bms.js`
    (952,288 B, sha256 `e0f20be0…7fbfa6`). See `0js_identity.txt`.
- **Claude (read-only):** one SSE connection plus `GET /settings/read-freshness`
  every ~5 s.
  - Window: 2026-10-02 14:47:22Z → 14:55:22Z (17:47:22 → 17:55:22 EEST).
  - Claude made no POST and no Modbus write.
  - Capture scripts: `capture.sh`, `ts.py`.
- **Owner (manual, in the browser):** opened Settings, used the LCD "always on"
  (`lcd_always_on`, bit of 0x1114) control, and used Cancel and OK in the new dialog.

## Findings

All times are EEST. Sources are `transaction_log_fragments.txt`, `timeline.txt`,
`analysis.txt` and `freshness_series.log.gz`.

### 1. Versions

Production firmware was `ca7d337` and the UI was `83e9698`, both as above.

### 2. The UI confirmation fix passed

- **Lease did not expire.** It was 1 continuously from 17:48:05 to 17:51:19, while the
  Settings page and dialog were in use.
- **Reads kept running under the lease.** C1/C2 read every 3.00 s (C2 rev 25 → 88 over
  189 s).
  - The worst 0x1114 block age in snapshots under the lease was 3,093 ms, below the
    3,500 ms active budget.
  - Across the whole window it was 14,929 ms, all outside the lease, against a
    22.5 s budget.
- **SSE did not reconnect.** Only three new-session iterator bursts were seen:
  - 17:47:22 — Claude's capture;
  - 17:48:12 — the owner opened the page;
  - 17:53:48 — the owner left Settings.

  The 17:53:48 burst is not a reconnect loop of the old ~20 s kind.
- **Cancel created no write intent.** Apart from the two NO_CHANGE requests and the two
  transactions below, no `register-write` log line, write-transaction snapshot or
  `read_pause_reason=register_write` appears in the window.

### 3. Owner-executed requests

| local time | request | result |
|---|---|---|
| 17:48:46 | `request_id=1` `lcd_always_on` = Так | NO_CHANGE — "0x1114 already holds the value, no Modbus command" |
| 17:49:57 | `request_id=2` `lcd_always_on` = Так | NO_CHANGE — no Modbus command |
| 17:50:23.571 → 17:50:24.080 | tx_id=1 addr 0x1114 **12816 → 12800** | status 1 → 3 → **4 CONFIRMED**, readback 12800 |
| 17:50:35.238 → 17:50:36.006 | tx_id=2 addr 0x1114 **12800 → 12816** | status 1 → 2 → 3 → **4 CONFIRMED**, readback 12816 |

- Status codes come from `jk_write_tx::Status`: 1 SENDING, 2 ACK_WAIT,
  3 READBACK_WAIT, 4 CONFIRMED.
- For tx_id=1, status 2 did not appear among the streamed snapshot values. The likely
  cause is state-publish coalescing; it is not evidence of a skipped step.
- `read_pause_reason` was `register_write` for about 0.5–0.8 s per transaction
  (≈ 1 s including the snapshot cadence).
- `lcd always on` read back as OFF at 17:50:25.870 and as ON at 17:50:37.879.

### 4. Initial state restored

The final state is LCD = Так, 0x1114 = 12816, the same as the initial state
(`lcd always on = ON` at 17:47:22).

### 5. Other bits of 0x1114 preserved

12816 = 0x3210 and 12800 = 0x3200. The two values differ only in bit 4 (0x0010), the
`lcd_always_on` bit. The read-modify-write left the other bits at 0x3200 both ways.

### 6. Both writes acknowledged and confirmed

Both writes reached ACK and readback and ended in CONFIRMED, about 0.5–0.8 s from
`register_write` to terminal status 4 (≈ 1 s).

### 7. No error path seen

There was no WRITE_UNCERTAIN, ACK/READBACK timeout, fallback read or reset:

- `last write crash stage` stayed IDLE throughout.
- Read mode stayed `clusters`, with 0 fallback-block events.
- Topology stayed CONFIRMED.
- Uptime ran 304 → 694 s with no decrease.
- `reset count since power on` stayed 4, the value left by the OTA.
- `bms health` stayed LIVE.
- The only warnings are `component:419` long-operation lines (`modbus` 230–326 ms,
  `web_server` 131 ms, `template.sensor` 64 ms).

### 8. Not proven by this record

- the exact number of FC16 frames on the wire;
- the absence of a transport retry;
- Gate D for any other field type (U16/U32/S32 numeric, other bitmasks, enum, multi-reg,
  CellCount/topology, passcode).

### Direct send-attempt counter

The raw data was checked for one. **None of the 319 SSE entities is a direct
FC16/send-attempt counter.** The name matches found are unrelated, for example the
temperature-sensor "present" entity and the CellConWireRes "attempt/queued" fields.

Separately, the streamed device log has no hub `Stop waiting for response`, `not sent`
or retry line. That is an absence in the log only; no conclusion about frame count is
drawn from it.

## Consequences recorded

- The functional read-modify-write of 0x1114 has now been observed on production.
  **0x1114 does not need to be changed again without a new reason.**
- Gate D remains **not completed**. Settings writes beyond these owner-executed LCD
  writes stay prohibited until Gate D is authorized and passed.

## Files

| file | content |
|---|---|
| `sse_timed.log.gz` | full timestamped SSE stream (`gzip -9 -n`). Uncompressed: 7,784,298 B, sha256 `9e3d57c0f87ee9117d72ff5b59bddf5efb2a1512decaf1664725a823551ceca7`. Contains LAN addresses of the device and HA host (as earlier captures do). |
| `freshness_series.log.gz` | 76 `/settings/read-freshness` snapshots, epoch-prefixed. Uncompressed: 226,042 B, sha256 `a7f188b1a71bc04e1a4c021421e68d71888bac506aa86335afa9ffd7cff38439` |
| `freshness_initial.json` | first freshness snapshot |
| `transaction_log_fragments.txt` | all streamed device log lines + every value change of write-related entities |
| `timeline.txt`, `analysis.txt` | snapshot timeline and the `m8_production_runtime_20261001/analyze_sse.py` output |
| `0js_identity.txt` | `/0.js` headers, hashes, git identity |
| `capture_metadata.txt`, `capture.sh`, `ts.py` | capture window and scripts |
| `SHA256SUMS` | sha256 of every file in the folder (`shasum -a 256 -c SHA256SUMS`) |
