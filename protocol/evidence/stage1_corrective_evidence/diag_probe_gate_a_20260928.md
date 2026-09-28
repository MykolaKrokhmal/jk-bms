# Diagnostic probe gate A — 2026-09-28: three hardware runs, the A1/C1 audit and the boundary-control result

Plan: `docs/project/RS485_CLUSTERED_READ_MIGRATION_PLAN.md`, M1 gate A.
Status: **gate A complete (20:58 boundary run, §6).**
- The hypothesis that 120 is the hardware limit is **false**: all four ×121
  controls succeeded.
- The owner adopted 120 registers as a **verified conservative operational
  maximum**. This is a design decision, not a statement of the BMS protocol
  limit, and the exact global device limit was not determined.
- Sections 3–5 are kept as the record of the reasoning before that run. Where
  they differ from §6, §6 supersedes them.

## 1. Raw hardware logs (verbatim, owner-supplied)

| File | SHA-256 | Probe build | Status |
|---|---|---|---|
| `hw_diag_probe_gate_a_all_timeout_20260928.log` (98 lines) | `e55e3342b53b3c1619dba47d17de47b632f7b533a1e2cf7372d68ba78a7914a1` | compiled 2026-09-28 11:06:47, run 11:07–11:09 | **INVALID for geometry** |
| `hw_diag_probe_gate_a_exc2_20260928.log` (77 lines) | `972b74d85756fb03eabdbb81ce5e6fe082acd2584824c0680ab3e0eeb34fb92d` | same build, run 17:37–17:38 | **valid, partial gate A** |
| `hw_diag_probe_gate_a_boundary_20260928.log` (84 lines, 13,067 bytes) | `d92dc3a634d170a5c9a0fd92261ab33c05b328d308f06c433393aa17672daf25` | `e93a5a9`, compiled 2026-09-28 20:55:11 +0300, run 20:58:34–20:59:19 | **valid, complete gate A** (§6) |

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
   - *Superseded by §6.* ×121 later succeeded, so this bracket was only a
     pre-run hypothesis, and a universal monotonic quantity limit was never
     established.
   - The JK PDF defines 02H as "access to a register the slave forbids" and
     03H as "data invalid or over a limit". The generic code alone cannot
     identify the condition.

## 4. The corrected gate A run (commit `feat(diag): add gate A boundary controls`; hardware result in §6)

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
  | OK | OK | exc 2 | exc 2 | strong evidence of a 120-register quantity ceiling (did **not** occur, §6) |
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

## 5. What was not proven before the boundary run (resolved or updated by §6)

- 120 as a device limit — **disproven**: ×121 succeeded.
- The cause of the A1 refusal — **not determined**; see §6.
- That ESPHome 2026.9.0 accepts `max_cmd_retries: 0` and
  `send_wait_time: 500ms` — **confirmed** by the compile-only check on
  2026-09-28 20:55:11 and by the run.
- Any behaviour of the corrected run on hardware — see §6.

## 6. Boundary-control run, 20:58 (valid, complete)

The facts below were re-parsed from
`hw_diag_probe_gate_a_boundary_20260928.log`, not copied from a summary.

**Run integrity**
- 29 of 29 terminal records, steps 1–29 in schedule order; the run line
  reads `issued=29 finished=1 unexpected=4 aborted=no`.
- `diag done … (log queue drops=0)`.
- Every request was FC03 with exactly one frame (`sends=1`).
- Across all 25 per-request statistics lines: no timeout, retry (resend),
  SHORT, LONG, exception or late callback.
- All five N_SLEEP liveness reads (steps 1, 5, 7, 11, 13) were OK, 4/4 bytes.
- No "interval took a long time" warning. The staggered summary took
  about 0.65 s, one line per tick.

**Operational clusters — all OK with exact lengths**

| Cluster | Bytes | Latency at the BMS / total |
|---|---|---|
| A1 0x1200 ×120 | 240/240 | 29 / 31 ms |
| A2′ 0x12F0 ×15 | 30/30 | 9 / 12 ms |
| C1 0x1000 ×120 | 240/240 | 28 / 30 ms |
| C2′ 0x10F0 ×23 | 46/46 | 10 / 12 ms |
| S1 0x1400 ×20 | 40/40 | |
| S2 0x14B2 ×18 | 36/36 | |
| S3 0x14E4 ×18 | 36/36 | |

**Boundary controls — all four succeeded** (expected EXC2, so `match=0`)

| Control | Bytes | Latency at the BMS / total |
|---|---|---|
| A121 0x1200 ×121 | 242/242 | 28 / 30 ms |
| A121W 0x1202 ×121 | 242/242 | 28 / 34 ms |
| C121 0x1000 ×121 | 242/242 | 28 / 37 ms |
| C121W 0x1024 ×121 | 242/242 | 28 / 31 ms |

**Conclusions**
- The hypothesis that 120 is the hardware limit is **false**.
- Ending a read on the first word of a U32 (A121 at 0x12F0, C121 at 0x10F0)
  did **not** cause a failure.
- For the tested ranges, the largest confirmed successful length is 121
  registers. The smallest previously observed failing length is 124
  registers (`0x1000 ×124`, 17:37 run; `0x1200 ×125` also failed). Both
  failures were exception 2.
- Every constituent address of those failing requests is readable in smaller
  requests, so an individually illegal address is unlikely.
- Without ×122/×123 and broader start-address coverage, a universal
  monotonic length limit is **not** claimed. The exact global device limit
  was not determined, and ×122/×123 are deliberately not tested (owner
  decision).
- **A geometry of 120 registers is adopted as a verified conservative
  operational maximum** (owner decision, 2026-09-28):
  - A1 0x1200 ×120;
  - A2′ 0x12F0 ×15;
  - C1 0x1000 ×120;
  - C2′ 0x10F0 ×23;
  - S1–S3 unchanged.

**Narrow/wide comparisons**
- Stable fields matched completely:

  | Field | Equal words |
  |---|---|
  | N_SLEEP | 2/2 |
  | N_CHG | 2/2 |
  | N_CAL29 | 2/2 |
  | N_FLAGS | 1/1 |
  | N_HEAT | 1/1 |
  | N_MODEL | 8/8 |
  | N_UART1 | 1/1 |
  | N_CANVER | 1/1 |

- Live fields: N_CELLS 47/53, N_AVGV 1/1, N_RES17 16/16, N_1290 11/12,
  N_T4 0/1, N_PCL 1/1. The wide and narrow reads happened about 14–20 s
  apart (A1 20:58:52.1 vs N_CELLS 20:59:06.4; A2 20:58:51.1 vs N_PCL
  20:59:11.5), so differences in live telemetry are expected.
  They are **not** decode failures.

**Content summaries (one 16S unit)**
- Voltage channels 17–32: 16/16 zero.
- Resistance channels 17–32: 16/16 zero.
- This supports reading the complete fixed cell range and filtering inactive
  channels after decoding. It is evidence from one 16S device, not a
  universal protocol guarantee.
- Gap words were **not** uniformly zero: A1 2/5 zero, A2′ 3/5 zero, C2′ 1/4
  zero. They stay ignored/unknown unless independently identified, and are
  never documented as reserved zero fields.

**Not established by this run**
- The exact global length limit.
- The mechanism behind the earlier ×124/×125 exceptions.
- Repeatability over time (the gate B soak will show it).
- Behaviour on other units or firmware versions.
