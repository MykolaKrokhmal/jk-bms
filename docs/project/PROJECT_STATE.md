# Project state

**Status: AUTHORITATIVE current-state entry point** (replaces the former root
`HANDOFF.md`, `codex PROJECT_STATE.md` and `codex HANDOFF.md`, now under
[`docs/archive/`](../archive/README.md)). Keep it short. Counts belong in the
generated inventories linked below, not in prose.

- **Baseline:** checkpoint commit `f6de12c` (branch
  `checkpoint/pre-repository-cleanup-2026-09-25`), followed by the repository
  cleanup on `codex/repository-cleanup`. Development history before that is on
  `bms-v1.1-manifest-audit`.
- **Active plan:** [`RS485_UNIFIED_PARAMETER_PIPELINE_PLAN.md`](RS485_UNIFIED_PARAMETER_PIPELINE_PLAN.md).
  Stages 1–2 are done on `feature/rs485-unified-pipeline` (renamed from
  `codex/rs485-unified-pipeline` on 2026-10-01). The next task is
  Stage 3, which starts only after owner review.
- **Active architecture-migration sub-plan:**
  [`RS485_CLUSTERED_READ_MIGRATION_PLAN.md`](RS485_CLUSTERED_READ_MIGRATION_PLAN.md)
  (clustered RS485 reads). It is an approved design (2026-09-27); `35bea1d`
  is its planning checkpoint. The owner accepted the C1/C2 boundary
  correction and chose the isolated diagnostic build.
  **M0 status (2026-09-27):**
  - The read-only measurement build (`jk_bms_probe.yaml` +
    `components/jk_diag_probe/`) compiled on ESPHome 2026.9.0.
  - An accidental OTA of it reset before boot validation and was rolled back
    automatically. The cause was a ~32 KB stack temporary in
    `Probe::begin()` against the 8 KB loopTask stack.
  - The fix, with a firmware-stack regression test, is confirmed on the
    device: the corrected diagnostic build booted, passed boot validation and
    completed its runs on 2026-09-28.
  - Compile-only validation of the corrected probe passed on 2026-09-28.
  - **Gate A (M1): COMPLETE on 2026-09-28** (boundary run at 20:58,
    `e93a5a9`).
    - Earlier, A1 0x1200 × 125 and C1 0x1000 × 124 got Modbus exception 2.
    - The ×120 clusters (A1 0x1200 ×120, A2′ 0x12F0 ×15, C1 0x1000 ×120,
      C2′ 0x10F0 ×23) and S1–S3 all succeeded with exact lengths.
    - All four ×121 boundary controls also succeeded, so 120 is not the
      hardware limit.
    - **Owner decision:** 120 registers is the verified conservative
      operational maximum. The exact global device limit was not determined.
    - **Gate B (2026-10-01): folded into one combined gate C** by owner
      decision (no separate probe OTA; see `DECISIONS.md`). Combined gate
      C passed on 2026-10-01.
    - Evidence:
      `protocol/evidence/stage1_corrective_evidence/diag_probe_gate_a_20260928.md`.
  - Evidence:
    `protocol/evidence/stage1_corrective_evidence/diag_probe_gate_a_rollback_20260927.md`.

  **M2–M5:** M2–M4 are host-implemented and tested (`0d8aed8`, `33c4102`,
  `da44183`, cadence `b951402`). M5 (`c83a676`, with follow-ups up to
  `3ee3f36`) is **deployed since 2026-10-01**.
  - The owner compiled it with ESPHome 2026.9.1: 0 errors, RAM 59.8 %,
    flash 68.6 %.
  - The owner flashed it by OTA.
  - A read-only production observation of 534.7 s found exact 1 s / 15 s
    cluster cadence, `missed = 0`, no fallback, no reset and no write
    (`protocol/evidence/stage1_corrective_evidence/m5_production_runtime_20261001.md`).
  - **M6 and M7 are deployed in `bfa2b44` since 2026-10-01** (ESPHome
    2026.9.1 / ESP-IDF 5.5.5, 0 new warnings). The read-only production
    audit passed (`protocol/evidence/stage1_corrective_evidence/m6_m7_production_runtime_20261001.md`):
    - the lease activation read C1 within 0.25 s;
    - C1/C2 ran every 3.0 s under the lease and returned to 15 s 30 s after
      the last renewal;
    - the OK rows unlocked only after the first active C1/C2 read;
    - no reset, fallback or write.
  - **Combined gate C PASSED on 2026-10-01** (owner decision, with one
    documented one-off `interval took a long time (60 ms)` exception;
    `protocol/evidence/stage1_corrective_evidence/gate_c_20261001.md`):
    - 20 min of `C_COEXISTENCE`: 3200 FC03 reads, 0 errors, `missed = 0`,
      `over1.5x = 0`, constant `queue_ms`;
    - production `bfa2b44` was then restored (same `config_hash`
      `0x5dc113b1`) and checked LIVE.
  - **M8 is host-complete (2026-10-01; not compiled or deployed):**
    - full read pause during writes, from `jk_write_tx::bus_owner()`, with
      a published `read_pause_reason`;
    - a proven maximum of 7500 ms per write;
    - `WRITE_UNCERTAIN` no longer holds the pause; before M8 that pause
      was unbounded;
    - a "paused for write" browser state that is never fresh.
  - Next: production compile and deploy of M8, then gate D with per-field
    approval, then M9 and M10.
  - **Settings writes stay prohibited until gate D.**

  ESPHome 2026.9.1 is the controlled build baseline (2026-10-01). Do not
  adopt 2027.3.0+ before the Modbus API migration in the plan.
- **Known limitations:** [`CURRENT_LIMITATIONS.md`](CURRENT_LIMITATIONS.md).
- **Architecture decisions:** [`DECISIONS.md`](DECISIONS.md) (principles) and
  [`docs/adr/0001-protocol-catalog.md`](../adr/0001-protocol-catalog.md)
  (protocol-catalog decision record).

## What exists today (details: [`docs/protocol/ARCHITECTURE.md`](../protocol/ARCHITECTURE.md))

- **Protocol model:** the official V1.1 manifest, canonical registers,
  non-register entities and service actions, plus blockers and evidence. All
  runtime definitions are generated from them.
- **Read path:** the deployed firmware (`bfa2b44`) services the
  generated plan through seven wide clusters, with latched per-group
  narrow/bespoke fallback and an isolated on-demand passcode read. Every
  implemented key is published through exactly one ESPHome entity, which HA
  (native API) and the browser (SSE) both consume.
- **Settings:** a generated catalog (`settings_view_model.json`) covering
  every official R/RW/W parameter. Blocked, unsupported and write-only states
  are shown explicitly. Freshness is per value; startup `pending` state is
  distinct from confirmed offline, for both the Settings fields and the global
  panel.
- **Writes:** per-key states in
  [`stage4_rw_inventory.json`](../../protocol/generated/stage4_rw_inventory.json);
  the live submit surface is in
  [`write_registry.json`](../../protocol/generated/write_registry.json).
  Hardware provenance is recorded in
  [`hardware_verified_writes.json`](../../protocol/evidence/hardware_verified_writes.json).
  In M5 every Settings row writes only through the unified registry after
  its own OK button. 23 fields are live, including all 18 migrated
  owner-authorized Settings fields. M5 is deployed, but its writes are not
  device-validated, so **Settings writes stay prohibited by owner decision
  until gate D**.
- **Service actions:** [`stage5_service_action_inventory.json`](../../protocol/generated/stage5_service_action_inventory.json);
  all are blocked, and local evidence is exhausted.

## Deployment and open security items

- **Deployed baseline (2026-10-01):** `bfa2b44` (M5+M6+M7) plus the owner's
  local overlay (web auth commented out; UI files, and at least the
  generated package, under `jk_bms_ui/`). The previous deployment was
  `3ee3f36`.
  - Built with ESPHome 2026.9.1.
  - Source confidence: the UI is cryptographically matched; the firmware
    match is high but not cryptographic.
  - The previous baseline, and the rollback target, is `8fbe54f`, which
    contains the security baseline `be99c96`. Details and the delta rule:
  [`docs/guides/BUILD_AND_DEPLOY.md`](../guides/BUILD_AND_DEPLOY.md).
- **Setup passcode:** the remediated firmware is on the device; rotating the
  passcode and cleaning HA history remain owner actions (see
  `CURRENT_LIMITATIONS.md` → "Security: setup passcode exposure").
- **Web authentication:** disabled on the development device by owner
  decision -- a temporary, development-only exception (see
  `CURRENT_LIMITATIONS.md`).

## Standing owner rules (do not relax without an explicit owner instruction)

- No device access, Modbus write, service action, firmware compile, flash or
  push without explicit, in-the-moment owner permission for that step.
- `gps_heartbeat=1` is deferred: do not retry it, and never call it
  hardware-verified (see `CURRENT_LIMITATIONS.md`).
- Commit only on explicit owner instruction. More than one AI agent works on
  this checkout, so stage explicit paths only.
- Report every change that affects the Home Assistant build as a deployment
  delta: see [`docs/guides/BUILD_AND_DEPLOY.md`](../guides/BUILD_AND_DEPLOY.md).
- Durable evidence goes under `protocol/evidence/`; scratch output goes to the
  ignored `tmp/` directory or the session scratchpad, never into evidence.
