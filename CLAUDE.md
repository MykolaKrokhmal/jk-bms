# JK BMS Web UI

ESP32 + ESPHome application for reading and safely configuring a JK-PB BMS over
Modbus RTU/RS485. `batterylifepo4.yaml` is the firmware config/backend;
`jk_bms.js`/`jk_bms.css` are the embedded web UI; `demo/mock-server.js` runs the
real frontend against a mock HTTP/SSE backend (no hardware needed for UI work).

Current status, known limitations, decisions and the active plan live under
`docs/project/` (`PROJECT_STATE.md`, `CURRENT_LIMITATIONS.md`, `DECISIONS.md`,
`RS485_UNIFIED_PARAMETER_PIPELINE_PLAN.md`); `docs/README.md` indexes every
document and its status. Older handoff/state/issue files are historical,
under `docs/archive/` (not a queue).

## Build & test

- No package manager, no third-party dependencies — Node stdlib + Python
  stdlib only. This is a deliberate project policy; don't add npm/pip packages.
- Full regression suite: `bash test/run_all.sh`
  - Needs a real TCP port for the integration suite. If it fails with
    `EPERM` on a port bind, you're in a sandboxed shell — disable the
    sandbox for this command.
  - Some checks additionally need the private source workbook (a personal
    file, never committed to this repo — its path on this machine goes in
    `CLAUDE.local.md`, not here): run as
    `JK_BMS_WORKBOOK_PATH="<path>" bash test/run_all.sh`. Without it, those
    specific checks are skipped, not failed.
- After touching `protocol/registers.canonical.json` or
  `protocol/non_register_entities.canonical.json`, resync in this order:
  1. `node tools/protocol/generate.js` (writes `register_catalog.json`,
     `jk_bms.js`'s generated block, `protocol/generated/coverage_report.md`)
  2. `node tools/protocol/pipeline.js build --workbook <path>` (full resync +
     claim matrix)
  3. `node tools/protocol/generate.js --check` and re-run `test/run_all.sh`
     to confirm zero drift before considering the change done.
- If a hand-written (non-generated) part of `jk_bms.js` or
  `batterylifepo4.yaml` changes, `protocol/evidence/sources.json`'s
  `project_implementation` fingerprint goes stale (`pipeline.js check` fails
  with `IMPLEMENTATION_SOURCE_FINGERPRINT_MISMATCH`). Fix it with the
  sanctioned workflow, never by hand-editing the hash citations:
  `node tools/protocol/fingerprint.js check` → `review` → `accept`.

## Architecture conventions

- **No client-side polling.** The browser never fetches register data —
  everything arrives over one `EventSource` (SSE) into `jk_bms.js`'s
  `ingestPayload()`. Push cadence is controlled entirely by ESPHome's
  `update_interval:` in the firmware, not the browser. Read any future
  "poll differently per register" requirement as "compute per-key freshness
  against `poll_group`/`freshness_budget_s`" (see `PROTOCOL_CATALOG.fieldMeta`
  in the generated block), not "add a client fetch loop" — a real client
  poller would fight the existing, tested push architecture.
- **Never hand-edit a generated artifact.** `register_catalog.json`,
  `jk_bms.js`'s block between `>>> BEGIN GENERATED PROTOCOL CATALOG` /
  `<<< END...`, everything under `protocol/generated/`, and
  `protocol/evidence/workbook_index.json` are all regenerated from
  `tools/protocol/generate.js` / `protocol/evidence/build_*.py`. Edit the
  generator, then regenerate — never patch the output by hand. Verify
  determinism with each generator's `--check` flag before calling a change
  done.
- **Never fabricate a derivation when source data is ambiguous.** If two
  things in the source data don't have a clean 1:1 mapping (e.g. a UI-order
  taxonomy that doesn't line up with a UI-group taxonomy), record the field
  as `null` with an explanatory note, rather than guessing a
  plausible-looking mapping. Precedent:
  `bms_v1_1_manifest.json`'s `parameters[].ui.ui_order`.
- Durable evidence (test run logs, audit results) belongs in the repo —
  under `protocol/evidence/stage1_corrective_evidence/` for this project —
  never left only in `/tmp` or session scratch. A result isn't "verified"
  until it's in a file a future session can read.
- The sandboxed test fixtures under `test/protocol_catalog/`
  (`test_negative_fixtures.js`, `test_generation_atomicity.js`,
  `test_fingerprint_drift_regression.js`) each keep their own
  `FILES_TO_COPY`-style list of repo files to stage into an isolated temp
  copy. Adding a new file under `protocol/evidence/` almost always means
  updating these lists too — a recurring, easy-to-miss regression source.

## Working style (applies to all contributors, human or agent)

- Never declare a task/stage "done" without an independent, skeptical
  re-verification pass using real commands — not a restatement of what was
  attempted. Audits in this project have repeatedly found real,
  previously-missed gaps on the *second* look; treat your own prior "done"
  report as a claim to check, not evidence.
- Never commit or push without the user's explicit, in-the-moment
  instruction, even after a large amount of verified work. Kept here (not
  as a personal habit note) because this repo is worked on by more than one
  AI agent concurrently on the same checkout — an uncoordinated commit from
  either agent risks committing the other agent's in-progress, unreviewed
  changes under the wrong authorship/intent. See the "Ризики / відкриті
  питання" section of the 2026-09-12 handoff (`git show c291106:HANDOFF.md`) for a concrete
  instance of this happening.
