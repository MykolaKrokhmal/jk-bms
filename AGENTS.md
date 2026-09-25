# AGENTS.md — entry point for coding agents (Codex and others)

This file only routes you. The working rules live in [`CLAUDE.md`](CLAUDE.md):
build and test commands, the generator order, the fingerprint workflow and
the working style. They apply to every agent. Read that file first.

## Where things are

- Documentation index, with each document's status: [`docs/README.md`](docs/README.md)
- **Active implementation plan:** [`docs/project/RS485_UNIFIED_PARAMETER_PIPELINE_PLAN.md`](docs/project/RS485_UNIFIED_PARAMETER_PIPELINE_PLAN.md)
- Active project state: [`docs/project/PROJECT_STATE.md`](docs/project/PROJECT_STATE.md),
  [`docs/project/CURRENT_LIMITATIONS.md`](docs/project/CURRENT_LIMITATIONS.md),
  [`docs/project/DECISIONS.md`](docs/project/DECISIONS.md)
- Which artifact owns which protocol fact (canonical vs generated):
  [`docs/protocol/ARCHITECTURE.md`](docs/protocol/ARCHITECTURE.md) and
  [`protocol/README.md`](protocol/README.md)
- [`docs/archive/`](docs/archive/README.md) is **historical**. It is not the
  active task queue.

## Non-negotiable

- Never guess protocol facts (geometry, decode, payloads, epochs, word order).
  Record an ambiguity as `null` with a note.
- Never hand-edit generated artifacts. Edit the canonical source or the
  generator, then regenerate.
- No device access, Modbus write, service action, firmware compile or flash
  without explicit, in-the-moment owner permission for that step.
- Do not retry `gps_heartbeat=1`.
- Never push. Commit only on explicit owner instruction, and stage explicit
  paths only: more than one agent works on this checkout.
