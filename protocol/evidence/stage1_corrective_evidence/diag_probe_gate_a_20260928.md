# Diagnostic probe gate A — 2026-09-28: two hardware runs, the A1/C1 audit and the corrected boundary-control run

Plan: `docs/project/RS485_CLUSTERED_READ_MIGRATION_PLAN.md`, M1 gate A.
Status: **gate A partial. 120 registers is a CANDIDATE operational limit, not
a proven device limit.** The corrected run described in §4 has not been
compiled or run.

## 1. Raw hardware logs (verbatim, owner-supplied)

| File | SHA-256 | Probe build | Status |
|---|---|---|---|
| `hw_diag_probe_gate_a_all_timeout_20260928.log` (98 lines) | `e55e3342b53b3c1619dba47d17de47b632f7b533a1e2cf7372d68ba78a7914a1` | compiled 2026-09-28 11:06:47, run 11:07–11:09 | **INVALID for geometry** |
| `hw_diag_probe_gate_a_exc2_20260928.log` (77 lines) | `972b74d85756fb03eabdbb81ce5e6fe082acd2584824c0680ab3e0eeb34fb92d` | same build, run 17:37–17:38 | **valid, partial gate A** |

- **11:07 run — invalid for geometry.**
  - All 21 requests timed out, including reads identical to production's;
    `Modbus device=1 set offline`.
  - Production restored at 11:16 timed out the same way, so the BMS link was
    down. The owner later found an external cause and fixed it.
  - What this run does prove: the stack fix (`777a817`) booted on hardware.
    `safe_mode` logged "Boot seems successful" and there was no rollback.
  - It also exposed a probe timing defect: the 3 s probe timeout was shorter
    than the hub's retry window (2000 ms × up to 4 retries), so requests
    overlapped. The correction is in §4.
- **17:37 run — valid, partial.**
  - Captured from boot: 21/21 requests, all FC03, `finished=1`,
    `drops=0`, `diag done`.

## 2. Findings of the valid run

| Read | Result |
|---|---|
| A1 0x1200 × 125 | **exception 2**, reply ~10 ms after the send |
| C1 0x1000 × 124 | **exception 2**, ~10 ms |
| A2, C2, S1, S2, S3 and all 14 narrow reads | OK, exact 2·n bytes |

- Wide and narrow reads matched on every available comparison:
  - A2: T4, PCL;
  - C2: CAL29 2/2, FLAGS, HEAT;
  - S1: MODEL 8/8;
  - S2: UART1;
  - S3: CANVER.

  Several of these hold at non-zero word offsets, which confirms the stride-2
  address model.
- Canonical gap words are **not zero**: in A2 1 of 3 are zero, in C2 1 of 4.
  They are undocumented data and must never be assumed zero.
- Latency and timing:
  - BMS latency ≈ 6 ms for 1–2 registers, 7–9 ms for 10–20, 17 ms for 53;
  - total 8–22 ms; queue 2–16 ms; callback 86–95 µs.
- The one-burst summary blocked the loop for 559 ms.
- Not obtained:
  - the A1 and C1 comparisons;
  - the inactive-channel 17–32 summaries;
  - the A1 gap words;
  - the 0x1290 wide read.

## 3. Audit: why A1 / C1 got exception 2 (read-only)

The five explanations, checked against the evidence:

1. **Address/count arithmetic: rejected.**
   - All 19 successful replies were exactly 2·n bytes.
   - Wide and narrow reads matched at non-zero offsets.
   - The JK PDF (`protocol/evidence/BMS_RS485_Modbus_V1.1.pdf`) gives
     offsets in bytes: 0x0000, 0x0004, … for 4-byte values.
2. **ESPHome framing or receive buffer: rejected.**
   - The BMS itself sent a valid exception frame (0x83 / 2) about 4.7 ms
     after the send, and kept answering afterwards.
   - `rx_buffer_size` is 384, above the 255-byte maximum frame.
3. **Crossing a 0x100 page: rejected.**
   - A2 (0x12FA–0x130C), C2 (0x10F8–0x111C) and production's `0x1088 × 64`
     all cross a page and work.
   - C1 crosses no page at all.
4. **An inaccessible address inside the range:**
   - **Rejected for C1.** Every word in 0x1000–0x10F6 is canonical and read
     individually by production: the generated read plan covers 0x1000–0x1086
     and the bespoke `0x1088 × 64` reader covers 0x1088–0x1106. The 128-word
     variant of that reader failed earlier (`73c65f2`); the 64-word one works
     (`cea9900`).
   - **Still possible for A1.** Its gap words 0x12E0/E2/E8/EA/EC/F4/F6 were
     never read individually.
5. **A quantity ceiling explains both failures with one rule.**
   - Accepted: at least 106. Production read `0x1200 × 106` registers until
     `c722f5a`. That rests on the commit message; the response length was
     not checked then.
   - Refused: 124 and 125.
   - So the ceiling lies in [106, 123]. The value 120 is **unproven**.
   - The JK PDF defines 02H as "access to a register the slave forbids" and
     03H as "data invalid or over a limit". The generic code alone cannot
     identify the condition.

## 4. The corrected gate A run (implemented host-only, commit `feat(diag): add gate A boundary controls`)

**Allowlist (25 entries, FC03 only):**

| Kind | Entries |
|---|---|
| Clusters | A1 0x1200×120, A2 0x12F0×15, C1 0x1000×120, C2 0x10F0×23, S1 0x1400×20, S2 0x14B2×18, S3 0x14E4×18 |
| Boundary controls, expecting exception 2 | A121 0x1200×121, A121W 0x1202×121, C121 0x1000×121, C121W 0x1024×121 |
| Narrow reads | the same 14 as before |

- **Coverage:** A1+A2 = 0x1200..0x130C (135 words) and C1+C2 = 0x1000..0x111C
  (143 words), exactly the old spans, contiguous. Every split falls on a
  canonical register boundary.
- **Why two controls per side:** A121 and C121 end on the first half of a
  U32 (0x12F0, 0x10F0), so an exception from them alone could also be a
  "no partial register" rule. A121W and C121W read whole registers only, and
  every one of their words lies inside A1∪A2 or C1∪C2.
- **Limits:** the protocol limit stays 125. `kCandidateOperationalRegisters =
  120` bounds only the cluster geometry.
- **Schedule (29 fixed steps):**
  1. N_SLEEP (liveness)
  2. A2
  3. A1
  4. A121
  5. N_SLEEP
  6. A121W
  7. N_SLEEP
  8. C2
  9. C1
  10. C121
  11. N_SLEEP
  12. C121W
  13. N_SLEEP
  14–16. S1, S2, S3
  17–29. the 13 other narrow reads
- **Aborting:** only a failed liveness step aborts, and then no further Modbus
  request is sent. Any other unexpected outcome — including an OK from a
  control — sets `match=0`, increments `unexpected` and the fixed schedule
  continues. There is no bisection, no ×122/×123 and no request generated at
  run time.
- **Timing:**
  - `modbus: send_wait_time: 500ms`;
  - `modbus_controller: max_cmd_retries: 0`;
  - probe timeout 1500 ms, which is at least (0 + 1) · 500 + 500.

  No requests overlap.
- **Summary:** one line per 10 ms tick, once the result queue is empty.
- **Interpreting the result (A shown; C likewise):**

  | A1 | A2 | A121 | A121W | Conclusion |
  |---|---|---|---|---|
  | OK | OK | exc 2 | exc 2 | strong evidence of a 120-register quantity ceiling |
  | OK | OK | exc 2 | OK | a partial-register rule, not a ×120 ceiling |
  | OK | OK | OK | any | the 120 hypothesis is false; stop and redesign |
  | not OK | | | | the controls cannot be interpreted; redesign |

- **Host verification:**
  - core 103/103;
  - contract 49/49;
  - stack frames 24/24 at -O3/-O2/-Os: largest 800 B, on_boot 272 B;
  - mutations 30/31 killed. The survivor is equivalent: dropping the
    post-timeout `finished_` return is covered by the 1 s step spacing and the
    `finished_` check at the top of `poll()`.
- `sizeof(Probe)` = 38,768 B, under the 40 KiB static-RAM assertion.

## 5. What is not proven

- 120 as a device limit.
- The cause of the A1 refusal (quantity limit or gap-word hole).
- That ESPHome 2026.9.0 accepts `max_cmd_retries: 0` and
  `send_wait_time: 500ms`; the next compile check will show it.
- Any behaviour of the corrected run on hardware.
