# `proj_arc/` — archived Stage 1 docs, evidence index

This directory holds session-generated audit/report/prompt documents from
Stage 1 of `IMPLEMENTATION_ROADMAP.md` — archived here because they
describe a specific completed pass, not current project state, but kept
(not deleted) because every one of them is still cited by path from either
the current codebase or another active document. Nothing in this directory
is required for the build/test pipeline itself (confirmed:
`tools/protocol/lib/semantic-checks.js`'s `KNOWN_REPO_FILES` allowlist
contains zero files from here).

## What's here, and why each file earned its keep

Verified 2026-09-15 (final preparation pass) by direct `grep`/citation
search across the tracked tree, not assumed from filenames:

- **`STAGE_1_IMPLEMENTATION_AUDIT.md`**, **`STAGE_1_REMEDIATION_AUDIT.md`**
  — each is self-declared superseded by the next audit in the chain
  (`STAGE_1_REMEDIATION_AUDIT.md` supersedes the first;
  `STAGE_1_COMPLETION_AUDIT.md` supersedes the second), but each still
  carries facts unique to that pass (e.g. specific SHA-256 evidence
  hashes) cited from `docs/adr/0001-protocol-catalog.md` and
  `register_catalog.json`'s field notes. **Canonical for current state:**
  `STAGE_1_COMPLETION_AUDIT.md` (the end of that chain; linked directly
  from `protocol/README.md`).
- **`RW_REGISTER_VERIFICATION_MATRIX.md`** — not superseded; its counts
  still match `protocol/generated/coverage_report.md`. Cited from
  `docs/ARCHITECTURE.md`, the ADR, and `OPEN_ISSUES.md`.
- **`CODEX_STAGE_1_REVIEW.md`**, **`CODEX_STAGE_1_REMEDIATION_RESULT_REVIEW.md`**
  — their P0/P1/P2 defect IDs are load-bearing: cited directly from code
  comments in `tools/protocol/generate.js`, `semantic-checks.js`,
  `test/run_all.sh`, `test/register_catalog/validate.js`,
  `test/protocol_catalog/test_negative_fixtures.js`,
  `demo/mock-server.js`, and `batterylifepo4.yaml`. Do not renumber or
  remove — these are the canonical source for those defect numbers.
- **`IMPLEMENTATION_ROADMAP.md`** — the governing Stage 1 roadmap; cited
  from `OPEN_ISSUES.md`, `codex AGENTS.md`, `protocol/README.md`, the
  ADR's own "Status" line, and generated-code banner comments.
- **`IMPLEMENTATION_EXECUTION_LOG.md`** — cited from `test/run_release.sh`,
  `test/release/port.js`, `test/protocol_catalog/test_port_allocation.js`.
- **`BMS_V2_MANIFEST_EXECUTION_LOG.md`** — the only `proj_arc/` file cited
  directly from `protocol/evidence/sources.json` (as the V1.1 PDF
  cross-check source). Canonical narrative for the V2 manifest work;
  its §G1–G8 fully restate and resolve every gap
  `BMS_V2_GAP_REMEDIATION_PLAN.md` lists.
- **`BMS_V2_GAP_REMEDIATION_PLAN.md`** (4.4 KB) — reviewed: its content is
  ~fully subsumed by `BMS_V2_MANIFEST_EXECUTION_LOG.md`'s §G1–G8. Kept
  anyway (not deleted): it's still the one place the 8 gaps are listed as
  a flat table rather than prose, it's referenced by name from `codex
  PROJECT_STATE.md`, and at 4.4 KB the cost of touching it isn't justified
  by the size saved.
- **`CURRENT_STATE_AUDIT.md`**, **`HARDWARE_VALIDATION_CHECKLIST.md`** —
  Stage-0 baseline and a partial hardware checklist respectively; both
  explicitly defer to root `OPEN_ISSUES.md`/`HARDWARE_AUDIT_2026-09-09.md`
  for current facts, kept as audit-trail inputs.
- **`FINAL_READINESS_REPORT.md`** — has no live inbound references (only
  self-referenced by its own siblings here); its own text points forward
  to the ADR's "seventh pass" addendum and `OPEN_ISSUES.md`. Kept as the
  historical record of that specific readiness pass, not as a current
  pointer target.
- **`CLAUDE_STAGE_1_COMPLETION_PASS_PROMPT_UA.md`**,
  **`CLAUDE_STAGE_1_IMPLEMENTATION_PROMPT_UA.md`** — the original task
  prompts whose execution produced `STAGE_1_COMPLETION_AUDIT.md`/
  `STAGE_1_IMPLEMENTATION_AUDIT.md`. No live inbound references, kept as
  the exact-instructions record (this project's own convention: durable
  evidence of what was actually asked, not just what was done).
- **`CLAUDE_STAGE_1_REMEDIATION_PROMPT_UA.md`** — same category, plus one
  direct code-comment citation
  (`test/protocol_catalog/test_negative_fixtures.js:229`, "Крок J").
- **`CLAUDE_FINAL_READINESS_PROMPT_UA.md`** — recovered via `git show
  HEAD:...` during the 2026-09-14 archival-conflict resolution (see
  "Origin" below) after being plain-deleted rather than moved by a
  parallel session; kept for the same reason as the other prompt files.

## Origin: why this directory has exactly these 17 files

On 2026-09-12, two parallel AI sessions ("Claude" and "Codex") each
archived the same 13 Stage 1 docs independently, to two different
locations (`proj_arc/` vs `proj_archive docs/`). The conflict was resolved
by standardizing on `proj_arc/`, **minus 2 files deliberately restored to
the repo root** (`OPEN_ISSUES.md` — explicitly kept active; `HARDWARE_AUDIT_
2026-09-09.md` — live evidence cited by `sources.json`/`semantic-checks.js`,
despite superficially matching the naming pattern of these 17 siblings),
**plus 1 file recovered from git history** (`CLAUDE_FINAL_READINESS_
PROMPT_UA.md`, deleted rather than archived by the other session). Full
narrative: `protocol/evidence/stage1_corrective_evidence/v2_pipeline_bridge/README.md`
§4.

## Removed as confirmed redundant (2026-09-15, final preparation pass)

Three files under `protocol/evidence/stage1_corrective_evidence/` were
removed after direct `diff` confirmed each was a strict subset of a sibling
file in `pass2_p0_1/`, differing only in nondeterministic run noise
(ports/PIDs/timestamps) plus 6–7 lines the `pass2_p0_1/` version adds
proving the P0-1 security fix; neither had any inbound reference anywhere
in the tracked tree (`git grep` confirmed zero hits):

- `release_runner_full_output.txt` → superseded by `pass2_p0_1/test_release_runner_output.txt`
- `nominal_fast_suite_with_workbook.txt` → superseded by `pass2_p0_1/nominal_fast_suite.txt`
- `nominal_release_gate_with_workbook.txt` → superseded by `pass2_p0_1/nominal_release_gate.txt`

Nothing else in `protocol/evidence/stage1_corrective_evidence/` was
removed. Everything else that looked, at first glance, like a pruning
candidate turned out on inspection to be deliberate: `mandatory_verification/`
is a hash-manifested bundle (`summary.tsv` records every file's SHA-256)
where apparent "duplicates" are the intended proof — e.g. `08_pipeline_build.txt`
== `10b_build2.txt` demonstrates build determinism, `22_.../23_..._probe.txt`
being identical demonstrates the non-mutation guard, and
`01_git_diff_check.txt` being 0 bytes is the recorded, expected proof that
`git diff --check` produced no output. `v2_manifest_baseline/`'s ten
`run_all_*.txt` captures are each individually cited by exact path from
`proj_arc/BMS_V2_MANIFEST_EXECUTION_LOG.md` (and `run_all_stage5_self_audit_fixes.txt`
specifically from the root `HANDOFF.md`); deleting any would leave those
citations dangling. `proj_arc/` itself had zero byte-identical duplicates
and zero empty files (checked directly via `shasum`/`find -size 0`, not
assumed).

## Full history and every prior version

The pre-cleanup state (before this final preparation pass, and before the
Phase 2A/2B/Stage-1-corrective cleanup passes that preceded it) is
preserved in full at git tag/branch `checkpoint/pre-cleanup-2026-09-14`
(commit `c291106`). Anything removed from tracked state at any point is
still recoverable from git history regardless of this index — this file
exists to explain the *reasoning*, not as the only path back to old
content.

## Reconciled V2 workbook row accounting

Verified directly against the `Реєстр параметрів` worksheet (`A1:O266`):
the workbook has 266 physical worksheet rows, consisting of 1 header row
plus 265 parameter rows. Therefore `parameter_count=265` in the manifest
and `total_rows=266` in `workbook_v2_index.json` describe the same source
without contradiction. The 265 parameters map to 210 unique physical base
addresses.
