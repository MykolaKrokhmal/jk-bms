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
  Stages 1–2 are done on `codex/rs485-unified-pipeline`. The next task is
  Stage 3, which starts only after owner review.
- **Active architecture-migration sub-plan:**
  [`RS485_CLUSTERED_READ_MIGRATION_PLAN.md`](RS485_CLUSTERED_READ_MIGRATION_PLAN.md)
  (clustered RS485 reads). It is an approved design (2026-09-27); `35bea1d`
  is its planning checkpoint. The owner accepted the C1/C2 boundary
  correction and chose the isolated diagnostic build. **M0 is implemented
  (host-only):** the read-only measurement build (`jk_bms_probe.yaml` +
  `components/jk_diag_probe/`) has not been compiled or run on hardware.
  **Next: M1** (gates A–C), which needs owner authorization. No production
  runtime has changed.
- **Known limitations:** [`CURRENT_LIMITATIONS.md`](CURRENT_LIMITATIONS.md).
- **Architecture decisions:** [`DECISIONS.md`](DECISIONS.md) (principles) and
  [`docs/adr/0001-protocol-catalog.md`](../adr/0001-protocol-catalog.md)
  (protocol-catalog decision record).

## What exists today (details: [`docs/protocol/ARCHITECTURE.md`](../protocol/ARCHITECTURE.md))

- **Protocol model:** the official V1.1 manifest, canonical registers,
  non-register entities and service actions, plus blockers and evidence. All
  runtime definitions are generated from them.
- **Read path:** the generated read plan, decoded by `jk_poll_scheduler`, plus
  bespoke drivers for the cell blocks and a few others. Every implemented key
  is published through exactly one ESPHome entity, which HA (native API) and
  the browser (SSE) both consume.
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
- **Service actions:** [`stage5_service_action_inventory.json`](../../protocol/generated/stage5_service_action_inventory.json);
  all are blocked, and local evidence is exhausted.

## Deployment and open security items

- **Deployed baseline:** `8fbe54f` is the last owner-confirmed,
  hardware-tested deployment on the test ESP32. It contains the earlier
  security baseline `be99c96` (deployed 2026-09-25). The owner's local
  overlay applies (web auth commented out, UI files under `jk_bms_ui/`).
  Later commits are not deployed. Details and the delta rule:
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
