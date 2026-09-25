# Documentation index

Each document is labelled **authoritative** (current source of truth),
**operational** (current how-to), or **historical**. When prose and a
generated artifact disagree, the generated artifact wins; see
[`docs/protocol/ARCHITECTURE.md`](protocol/ARCHITECTURE.md) for which
artifact owns which fact.

## Current (authoritative)

| Document | Purpose |
|---|---|
| [`project/PROJECT_STATE.md`](project/PROJECT_STATE.md) | where the project stands; standing owner rules |
| [`project/RS485_UNIFIED_PARAMETER_PIPELINE_PLAN.md`](project/RS485_UNIFIED_PARAMETER_PIPELINE_PLAN.md) | **the active implementation plan** |
| [`project/CURRENT_LIMITATIONS.md`](project/CURRENT_LIMITATIONS.md) | verified known limitations, each with a re-check source |
| [`project/DECISIONS.md`](project/DECISIONS.md) | architecture and product decisions (principles) |
| [`protocol/ARCHITECTURE.md`](protocol/ARCHITECTURE.md) | artifact roles and runtime data flow |
| [`adr/0001-protocol-catalog.md`](adr/0001-protocol-catalog.md) | protocol-catalog decision record with dated addenda |
| [`../protocol/evidence/IMPLEMENTATION_DRIFT_REVIEW.md`](../protocol/evidence/IMPLEMENTATION_DRIFT_REVIEW.md) | fingerprint drift review (evidence) |

## Operational guides

| Document | Purpose |
|---|---|
| [`../CLAUDE.md`](../CLAUDE.md) | agent working rules, build & test commands |
| [`../AGENTS.md`](../AGENTS.md) | short entry point for Codex and other agents (routes to `CLAUDE.md` and this index) |
| [`../protocol/README.md`](../protocol/README.md) | running the protocol generators, pipeline and fingerprint workflow |
| [`guides/BUILD_AND_DEPLOY.md`](guides/BUILD_AND_DEPLOY.md) | ESPHome/HA compile/runtime file set and the deployment-delta rule |
| [`guides/AUTH_AND_HISTORY.md`](guides/AUTH_AND_HISTORY.md) | web auth, flash/OTA, recovery, credential rotation, rollback |
| [`../demo/README.md`](../demo/README.md) | running the real frontend against the mock backend |

## Evidence

Durable evidence lives in [`../protocol/evidence/`](../protocol/evidence/): the
official PDF, the V2 workbook, indexes, blockers, hardware-verified writes and
captured test and hardware logs. `HARDWARE_AUDIT_2026-09-09.md` stays at the
repository root because it is a hash-pinned evidence source
(`protocol/evidence/sources.json` → `hardware_audit_2026_09_09`) whose path the
validator checks.

## Historical

[`archive/`](archive/README.md) holds superseded handoffs, state files,
registers, prompts, audits and plans, with an old→new path map. None of it is
a queue.
