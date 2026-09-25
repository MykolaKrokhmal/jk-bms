# Archive — historical records only

**Status: HISTORICAL.** Nothing here is the current state, the current plan,
or an implementation queue. Current documents are indexed in
[`docs/README.md`](../README.md):

- **State:** [`docs/project/PROJECT_STATE.md`](../project/PROJECT_STATE.md)
- **Plan:** [`docs/project/RS485_UNIFIED_PARAMETER_PIPELINE_PLAN.md`](../project/RS485_UNIFIED_PARAMETER_PIPELINE_PLAN.md)
- **Limitations:** [`docs/project/CURRENT_LIMITATIONS.md`](../project/CURRENT_LIMITATIONS.md)

These files are kept because they contain unique decision history,
investigation notes and audit reasoning. The full pre-move tree is preserved
on branch `checkpoint/pre-repository-cleanup-2026-09-25` (commit `f6de12c`);
earlier states are on `checkpoint/pre-cleanup-2026-09-14` (`c291106`).

| Folder | Contents | Superseded by |
|---|---|---|
| [`claude/`](claude/README.md) | the last Claude session handoff log (root `HANDOFF.md`, including the owner's deferred GPS Heartbeat note) | `PROJECT_STATE.md`, `CURRENT_LIMITATIONS.md` |
| [`codex/`](codex/README.md) | Codex agent rules, handoff, project state, troubleshooting history (root `codex *.md`) | `CLAUDE.md`, `PROJECT_STATE.md`, `DECISIONS.md` |
| [`reports/`](reports/README.md) | the `OPEN_ISSUES.md` register (not revalidated) and the pre-read-plan architecture diagrams | `CURRENT_LIMITATIONS.md`, `docs/protocol/ARCHITECTURE.md` |
| [`project-arc/`](project-arc/README.md) | Stage 1 prompts, audits, roadmap and execution logs (former `proj_arc/`) | the active plan |

## Old path → new path

Code comments, generator markers, canonical `safety_notes`, the ADR's dated
addenda and captured evidence logs still mention some of these files by
their original name or path. That is deliberate: they are historical
provenance, and some of those files are fingerprint- or hash-covered. Resolve
any such mention with this table.

| Former path | Archived at |
|---|---|
| `HANDOFF.md` | [`docs/archive/claude/HANDOFF_2026-09-25.md`](claude/HANDOFF_2026-09-25.md) |
| `codex AGENTS.md` | [`docs/archive/codex/AGENTS.md`](codex/AGENTS.md) |
| `codex HANDOFF.md` | [`docs/archive/codex/HANDOFF.md`](codex/HANDOFF.md) |
| `codex PROJECT_STATE.md` | [`docs/archive/codex/PROJECT_STATE.md`](codex/PROJECT_STATE.md) |
| `codex TROUBLESHOOTING.md` | [`docs/archive/codex/TROUBLESHOOTING.md`](codex/TROUBLESHOOTING.md) |
| `proj_arc/BMS_V2_GAP_REMEDIATION_PLAN.md` | [`docs/archive/project-arc/BMS_V2_GAP_REMEDIATION_PLAN.md`](project-arc/BMS_V2_GAP_REMEDIATION_PLAN.md) |
| `proj_arc/BMS_V2_MANIFEST_EXECUTION_LOG.md` | [`docs/archive/project-arc/BMS_V2_MANIFEST_EXECUTION_LOG.md`](project-arc/BMS_V2_MANIFEST_EXECUTION_LOG.md) |
| `proj_arc/CLAUDE_FINAL_READINESS_PROMPT_UA.md` | [`docs/archive/project-arc/CLAUDE_FINAL_READINESS_PROMPT_UA.md`](project-arc/CLAUDE_FINAL_READINESS_PROMPT_UA.md) |
| `proj_arc/CLAUDE_STAGE_1_COMPLETION_PASS_PROMPT_UA.md` | [`docs/archive/project-arc/CLAUDE_STAGE_1_COMPLETION_PASS_PROMPT_UA.md`](project-arc/CLAUDE_STAGE_1_COMPLETION_PASS_PROMPT_UA.md) |
| `proj_arc/CLAUDE_STAGE_1_IMPLEMENTATION_PROMPT_UA.md` | [`docs/archive/project-arc/CLAUDE_STAGE_1_IMPLEMENTATION_PROMPT_UA.md`](project-arc/CLAUDE_STAGE_1_IMPLEMENTATION_PROMPT_UA.md) |
| `proj_arc/CLAUDE_STAGE_1_REMEDIATION_PROMPT_UA.md` | [`docs/archive/project-arc/CLAUDE_STAGE_1_REMEDIATION_PROMPT_UA.md`](project-arc/CLAUDE_STAGE_1_REMEDIATION_PROMPT_UA.md) |
| `proj_arc/CODEX_STAGE_1_REMEDIATION_RESULT_REVIEW.md` | [`docs/archive/project-arc/CODEX_STAGE_1_REMEDIATION_RESULT_REVIEW.md`](project-arc/CODEX_STAGE_1_REMEDIATION_RESULT_REVIEW.md) |
| `proj_arc/CODEX_STAGE_1_REVIEW.md` | [`docs/archive/project-arc/CODEX_STAGE_1_REVIEW.md`](project-arc/CODEX_STAGE_1_REVIEW.md) |
| `proj_arc/CURRENT_STATE_AUDIT.md` | [`docs/archive/project-arc/CURRENT_STATE_AUDIT.md`](project-arc/CURRENT_STATE_AUDIT.md) |
| `proj_arc/FINAL_READINESS_REPORT.md` | [`docs/archive/project-arc/FINAL_READINESS_REPORT.md`](project-arc/FINAL_READINESS_REPORT.md) |
| `proj_arc/HARDWARE_VALIDATION_CHECKLIST.md` | [`docs/archive/project-arc/HARDWARE_VALIDATION_CHECKLIST.md`](project-arc/HARDWARE_VALIDATION_CHECKLIST.md) |
| `proj_arc/IMPLEMENTATION_EXECUTION_LOG.md` | [`docs/archive/project-arc/IMPLEMENTATION_EXECUTION_LOG.md`](project-arc/IMPLEMENTATION_EXECUTION_LOG.md) |
| `proj_arc/IMPLEMENTATION_ROADMAP.md` | [`docs/archive/project-arc/IMPLEMENTATION_ROADMAP.md`](project-arc/IMPLEMENTATION_ROADMAP.md) |
| `proj_arc/README.md` | [`docs/archive/project-arc/README.md`](project-arc/README.md) |
| `proj_arc/RW_REGISTER_VERIFICATION_MATRIX.md` | [`docs/archive/project-arc/RW_REGISTER_VERIFICATION_MATRIX.md`](project-arc/RW_REGISTER_VERIFICATION_MATRIX.md) |
| `proj_arc/STAGE_1_COMPLETION_AUDIT.md` | [`docs/archive/project-arc/STAGE_1_COMPLETION_AUDIT.md`](project-arc/STAGE_1_COMPLETION_AUDIT.md) |
| `proj_arc/STAGE_1_IMPLEMENTATION_AUDIT.md` | [`docs/archive/project-arc/STAGE_1_IMPLEMENTATION_AUDIT.md`](project-arc/STAGE_1_IMPLEMENTATION_AUDIT.md) |
| `proj_arc/STAGE_1_REMEDIATION_AUDIT.md` | [`docs/archive/project-arc/STAGE_1_REMEDIATION_AUDIT.md`](project-arc/STAGE_1_REMEDIATION_AUDIT.md) |
| `docs/ARCHITECTURE.md` | [`docs/archive/reports/ARCHITECTURE_DIAGRAMS_2026-09-10.md`](reports/ARCHITECTURE_DIAGRAMS_2026-09-10.md) |
| `OPEN_ISSUES.md` | [`docs/archive/reports/OPEN_ISSUES_2026-09-15.md`](reports/OPEN_ISSUES_2026-09-15.md) |
| `codex DECISIONS.md` | moved to the active [`docs/project/DECISIONS.md`](../project/DECISIONS.md) (not archived) |
| `docs/AUTH_AND_HISTORY.md` | moved to the active [`docs/guides/AUTH_AND_HISTORY.md`](../guides/AUTH_AND_HISTORY.md) (not archived) |
