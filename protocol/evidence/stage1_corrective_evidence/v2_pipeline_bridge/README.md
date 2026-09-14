# V2 evidence-pipeline bridge — Phase 1 evidence (2026-09-13)

Session goal: fix the reproducible `KeyError: 'BMS Parameters'` (old
evidence pipeline pointed at the new V2 workbook) by wiring the verified V2
workbook in as a second, parallel evidence source, without touching
`registers.canonical.json`'s existing content. Full design rationale:
`.claude/plans/typed-petting-puzzle.md` (approved plan, this session).

## 1. Bug reproduction (before any fix)

```
$ python3 protocol/evidence/build_workbook_index.py --workbook \
    "protocol/evidence/LiFePO4_BMS_Parameters_registers-V2_verified.xlsx" ...
KeyError: 'BMS Parameters'
```

Root cause: `build_workbook_index.py`'s `SHEET_NAME = "BMS Parameters"` is
the deprecated V1 sheet name; the V2 workbook's registry sheet is
`"Реєстр параметрів"`. Confirmed by direct code inspection AND live
execution — this independently confirms the claim in `codex HANDOFF.md`
("current V2 workbook causes `KeyError: 'BMS Parameters'` in the old
pipeline"), which the prior Claude session's own `HANDOFF.md` had flagged
as asserted-but-not-yet-independently-reproduced.

## 2. Fix

- New `protocol/evidence/build_workbook_v2_index.py` — V2 counterpart to
  `build_workbook_index.py`, reads `"Реєстр параметрів"`, writes
  `protocol/evidence/workbook_v2_index.json`. Reuses the existing OOXML
  parser (`build_workbook_index.parse_xlsx_sheet`) and address parser
  (`build_v2_manifest.parse_address`) rather than reimplementing either.
- `protocol/evidence/build_claim_matrix.js` — now also reads
  `workbook_v2_index.json` and emits `address`/`declared_access` claims for
  the `workbook_lifepo4_bms_parameters_registers_v2` source (only these two
  claim types — `sources.json`'s `claims_supported` for this source_id does
  NOT list `field_label_uk`/`observed_decoded_value`, unlike the V1 source;
  the V2 sheet's "example" column is illustrative, not a hardware capture).
- `tools/protocol/lib/semantic-checks.js` — `checkIndexBackedEvidence` now
  has a V2 branch (`EVIDENCE_ADDRESS_NOT_IN_WORKBOOK_V2_INDEX`), proven by a
  new negative-fixture case (`false_workbook_v2_evidence`, address `0x9998`,
  verified absent from the real V2 index).
- `tools/protocol/pipeline.js` — runs the V2 indexer alongside the V1 one
  (V1 keeps the external `--workbook` path; V2 defaults to the repo-
  committed workbook file, since it is not a personal path), publishes
  `workbook_v2_index.json`, includes it in the `release_generation_id`
  cross-check and the top-level pipeline manifest.
- Sandboxed test fixture copy-lists updated where actually exercised:
  `test_generation_atomicity.js` (its isolated sandbox runs `generate.js`,
  which runs `semantic-checks.js`, which now optionally reads the V2 index).
  `test_fingerprint_drift_regression.js` deliberately NOT updated — it
  already documents needing no workbook index at all (fingerprint
  check/review/accept never opens one), V1 included; consistent scope.

## 3. Verification (commands + results)

| Command | Result |
|---|---|
| `python3 protocol/evidence/build_workbook_v2_index.py --check` | PASS — rows=266 addresses=210 (matches `sources.json`'s own "210 base addresses" note) |
| `node protocol/evidence/build_claim_matrix.js` | fields=127 write_ready=0 (unchanged from before — see §5) |
| `node test/register_catalog/validate.js` | 171 checks, 0 failed (see §4 for the 2 pre-existing failures found and fixed along the way) |
| `node tools/protocol/generate.js --check` | no drift |
| `node test/protocol_catalog/test_negative_fixtures.js` | 112 checks, 0 failed, incl. new `false_workbook_v2_evidence` case |
| `node tools/protocol/pipeline.js build --workbook <V1 path>` | `protocol-pipeline build PASS` |
| `node tools/protocol/pipeline.js check --workbook <V1 path>` | `protocol-pipeline check PASS` |
| `JK_BMS_WORKBOOK_PATH=<V1 path> bash test/run_all.sh` | exit 0, "All suites passed." Full log: `run_all_after_phase1.txt` in this directory. |

## 4. Pre-existing, unrelated bug found and fixed (user-approved)

Running `validate.js` for the first time this session (nothing had re-run it
since before the branch switch — see `HANDOFF.md`'s own "Стан перевірки")
surfaced 2 real, pre-existing failures having nothing to do with the V2
work: `SOURCE_HASH_MISMATCH`/`EVIDENCE_LOCATOR_FILE_MISSING` because
`HARDWARE_AUDIT_2026-09-09.md` — a live evidence source `sources.json` and
`registers.canonical.json` cite at repo root — physically existed only under
the parallel Codex session's `proj_archive docs/` folder (the exact
git-index-vs-disk inconsistency `HANDOFF.md`'s "Ризики" section had flagged
as an unresolved risk, not yet actually breaking anything by that point).

User explicitly approved resolving the full `proj_arc/` vs `proj_archive
docs/` conflict (not just this one file) this session. Resolution, verified
byte-identical before deleting anything:
- Standardized on `proj_arc/` (shorter, no space — `proj_archive docs/`'s
  space requires quoting everywhere) for all 18 purely-historical documents
  that were in `proj_archive docs/`, plus a 19th (`CLAUDE_FINAL_READINESS_PROMPT_UA.md`,
  recovered from `git show HEAD:...`, since it had been plain-deleted rather
  than moved to either archive location).
- **Exception 1 — `OPEN_ISSUES.md`**: restored to repo root, not archived —
  honoring the prior Claude session's own documented explicit decision
  ("який я explicitно вирішив залишити активним", `HANDOFF.md`). The
  `proj_archive docs/` copy had real edits beyond the last commit (verified
  by hash), so the newer content was kept, not `HEAD`'s stale version.
- **Exception 2 — `HARDWARE_AUDIT_2026-09-09.md`**: restored to repo root,
  not archived — it is live, cited evidence infrastructure (`sources.json`,
  multiple fields' `evidence[]` arrays, `semantic-checks.js`'s
  `KNOWN_REPO_FILES` allowlist), not a disposable historical report, despite
  superficially matching the naming pattern of its 17 genuinely-historical
  siblings. This was the direct, only cause of the 2 validator failures.
- Fixed the one live dangling reference this move affected:
  `protocol/README.md`'s `../STAGE_1_COMPLETION_AUDIT.md` link →
  `../proj_arc/STAGE_1_COMPLETION_AUDIT.md` (checked: the only real
  relative-path link to any of these 19 files anywhere in the live,
  non-archived tree).

## 5. Phase 2 — proof that V2+PDF evidence actually promotes `verification_status`

Added `workbook_lifepo4_bms_parameters_registers_v2` + `official_jk_documentation`
citations to 5 existing, read-only (`access: "r"`) fields, chosen because a
read-only field's `effective_access` is untouched by the stricter write-
readiness gate in `build_claim_matrix.js` (§6) — this keeps the demonstration
to the `verification_status` promotion mechanism itself, not the separate,
higher-stakes RW-enablement question.

Official-PDF page numbers were obtained by actually reading
`BMS_RS485_Modbus_V1.1.pdf` (via `pdftotext -layout`, `poppler` installed
this session with explicit user approval — no PDF tool existed in the
environment before) and locating each field's row by its exact, unique
`name_prog` identifier (e.g. `ManufacturerDeviceID`, `TempBat 1`) — never by
computed/assumed address arithmetic, since the PDF's own left-column
addressing is a document-internal running byte-offset, not the project's
real register address (that correspondence is established via the already-
audited V2 workbook, per `sources.json`'s own note on
`workbook_lifepo4_bms_parameters_registers_v2`).

| Field | Address | Before | After | PDF page |
|---|---|---|---|---|
| `device_model` | 0x1400 | implementation_only_unverified | confirmed | p.12 |
| `cell_voltage_1` | 0x1200 | corroborated_with_limitations | confirmed | p.8 |
| `temperature_1` | 0x129C | implementation_only_unverified | confirmed | p.10 |
| `charging_cycles` | 0x12B0 | implementation_only_unverified | confirmed | p.11 |
| `full_charge_capacity` | 0x12AC | implementation_only_unverified | confirmed | p.11 |

All 5 promotions were verified, not asserted: `test/register_catalog/validate.js`
independently re-derives `verification_status` from each field's `evidence[]`
array (`tools/protocol/lib/semantic-checks.js`'s `deriveVerificationStatus`)
and hard-fails (`FORGED_VERIFICATION_STATUS`) on any mismatch — it passed
clean (171 checks, 0 failed) with all 5 fields already set to `"confirmed"`
in the same edit, i.e. the tool confirmed my hand-derivation, not the other
way around. `claim_matrix.json`'s `policy_inconsistent` count stayed at 18
(unchanged — see §6), and all 5 fields show `policy_consistent: true`
(expected: read-only fields are untouched by that gate).

Full end-to-end re-verification after Phase 2 (every suite `test/run_all.sh`
runs, checked individually since a sibling worktree's secret-scan false
positive — see §7 — blocks that script's own aggregate run): C++ unit tests
(63+94 checks), `validate.js` (171), packed codec (16), negative fixtures
(112), `generate.js --check` (no drift), generation atomicity (31), blocked
write surface (98/98), `pipeline.js check` (PASS), fingerprint check
(FINGERPRINT_MATCH), fingerprint drift regression (36), claim-matrix
invariant (23), mixed-generation rejection (18), entity-id collision (16),
JS syntax (OK), topology + write-transaction suite (76), port allocation
(11), release-runner regression (46) — every one 0 failed.

### A real discrepancy found while sourcing PDF citations — NOT fixed here

While cross-checking `capacity_remaining` (0x12A8, `SOCCapRemain`) as a
candidate 6th field, both the official PDF (p.11: "INT32... R... mAH") and
the independently-parsed V2 manifest (`type.signedness: "signed"`,
`bms_v1_1_manifest.json`) agree it is **signed** — but
`registers.canonical.json` currently declares it `wire_type: "U32"`
(**unsigned**). Two independent sources corroborate each other against the
current implementation. Deliberately NOT used as a demo field, and NOT
"fixed" here — this is a real protocol-correctness question (does the
firmware/decoder need to change?) that deserves its own evidenced,
hardware-aware pass, not a side-effect of an evidence-citation exercise.
Flagged separately (see session's final report / spawned follow-up task).

## 6. Separately flagged, NOT fixed here (out of scope)

- `protocol/evidence/build_claim_matrix.js --check`'s own `CLAIM_POLICY_INCONSISTENT`
  gate is never actually invoked by `pipeline.js` or any test file — running it
  manually shows 18/127 fields already fail it today, entirely independent of
  this session's changes. Flagged as a separate follow-up task (safety-relevant:
  resolving it may mean removing real `effective_access: "rw"` from fields
  currently exposed as writable), not folded into this change.
- `capacity_remaining`'s signed/unsigned discrepancy (§5).

## 7. Environmental note: sibling worktree breaks `test/run_all.sh`'s secret-scan step

Partway through this session's Phase 2 work, an active sibling git worktree
appeared at `.claude/worktrees/youthful-blackwell-a21a91` (branch
`fix/claim-matrix-owner-override-check`, HEAD `93b4c1d`, actively modified —
almost certainly the user starting the `CLAIM_POLICY_INCONSISTENT` follow-up
task flagged in §6, in its own isolated worktree). `test/protocol_catalog/test_secret_scan.js`'s
`worktree` scope walks the filesystem and found that sibling's own copy of
this repo's intentionally-detectable `test/protocol_catalog/fixtures/secret_scan/synthetic_positive.fixture`,
reporting a `SECRET_SCAN_LEAK` and aborting `test/run_all.sh` immediately
(by design, for this class of check) — a false positive, not a real secret,
and not caused by anything in this session's diff (reproduced identically
from the correct working directory). Every suite that runs after the
secret-scan step in `test/run_all.sh` was instead verified individually
(§5's list) to confirm nothing was masked by the early abort.
