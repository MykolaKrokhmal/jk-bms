# Handoff to the next Codex session

## 1. What is this project?

JK BMS Web UI is an ESP32 + ESPHome application for reading and safely configuring a JK-PB BMS over Modbus RTU/RS485. `batterylifepo4.yaml` is the firmware configuration/backend; `jk_bms.js` and `jk_bms.css` are the embedded web UI; `demo/mock-server.js` runs the real frontend against a mock HTTP/SSE backend.

The product goal is a complete, grouped, bilingual Settings UI for all official protocol parameters, confirmed RW writes, read-only R display, isolated W actions, dynamic cell topology, clear Diagnostics, persistent history, secure local deployment and evidence-based readiness.

## 2. Where are we now?

**НЕ ГОТОВО.** The checkout is a large dirty, uncommitted transition on branch `bms-v1.1-manifest-audit`, HEAD `93b4c1df9003e76072e08915a20614075dac8693`.

Old canonical tooling models 119 physical registers / 127 fields. The current official V1.1 + verified V2 model contains 265 parameters / 210 unique base addresses. Gap audit: 130 implemented, 97 missing, 38 partial. The verified V2 workbook is present and its standalone manifest check passes, but the old release pipeline cannot read its sheet/schema.

Generic write recovery/generation guards, UI write states, localization and freshness have meaningful implementation, but exact HTTP transaction correlation, packed RMW, full freshness, complete Settings grouping, dynamic 16/32 topology, browser E2E, production persistence, security HIL and hardware writes remain incomplete.

## 3. What was the user asking most recently?

The immediate request was to consolidate the entire long thread into `AGENTS.md`, `PROJECT_STATE.md`, `DECISIONS.md`, `TROUBLESHOOTING.md` and this handoff without changing application behavior.

The immediately preceding technical request was to independently audit Claude's latest Stage 5 work and synchronize with the real repository. The audit found that Claude's broad green result did not include a successful run against the current V2 workbook.

## 4. What should the next agent do first?

First validate this snapshot against `git status`, current hashes and relevant tests. Then address the P0 V2 pipeline split before adding protocol fields or changing UI. The correct first implementation target is a single fail-closed, deterministic pipeline/release contract around the current V2 workbook and official PDF-derived manifest.

Do not begin with visual cleanup, hardware writes, mass RW unlocking or ad-hoc additions to old canonical JSON.

## 5. Files to inspect first

1. `AGENTS.md` — stable rules, safety, UI and evidence policy.
2. `PROJECT_STATE.md` — exact current findings/TODO/dirty tree.
3. `protocol/evidence/LiFePO4_BMS_Parameters_registers-V2_verified.xlsx` and `protocol/evidence/BMS_RS485_Modbus_V1.1.pdf` — normative sources; verify hashes.
4. `protocol/evidence/build_v2_manifest.py`, `protocol/generated/bms_v1_1_manifest.json`, `protocol/generated/bms_v1_1_gap_audit.json` — new V2 path.
5. `protocol/evidence/build_workbook_index.py`, `tools/protocol/pipeline.js`, `test/run_all.sh`, `test/run_release.sh` — broken/parallel old release path.
6. `protocol/registers.canonical.json`, `protocol/non_register_entities.canonical.json`, `tools/protocol/generate.js`, `register_catalog.json` — current runtime catalog path.
7. `batterylifepo4.yaml`, `components/jk_write_tx/jk_write_tx_core.h` — production read/write/topology behavior.
8. `jk_bms.js`, `jk_bms.css`, `demo/mock-server.js`, `test/topology/run.js` — UI/mock/integration behavior.
9. `IMPLEMENTATION_ROADMAP.md`, `OPEN_ISSUES.md`, `BMS_V2_MANIFEST_EXECUTION_LOG.md` — roadmap/history; verify rather than trust dates/counts.
10. `HARDWARE_AUDIT_2026-09-09.md`, `HARDWARE_VALIDATION_CHECKLIST.md` — only real-device evidence and missing HIL matrix.

## 6. What must not be broken?

- GPIO22 TX, GPIO21 RX, GPIO17 RS485 flow control, 115200 baud and default Modbus address 1.
- Pinned upstream component commit.
- Fail-closed access for hazardous/topology/credential/packed/ambiguous fields.
- Existing read-only telemetry on the deployed 16S unit.
- Per-address single-flight, generation-safe callbacks and `WRITE_UNCERTAIN` recovery.
- UI input focus/dirty preservation during SSE.
- Exact user-approved write button/toggle behavior and current responsive width baseline.
- Ukrainian/English labels, one value + localized unit, numeric order `01…N`.
- Separation: registers in Settings; derived/ESP32/browser/UI in Diagnostics.
- Secrets must stay out of repo/log/docs. Never repeat credentials from the old chat.
- Dirty user/Claude changes: no reset, clean, discard or mass reformat.

## 7. What must be verified before changes?

- Current source hashes still equal PDF `b9b3…` and workbook `3226…`.
- Whether the user approves adding an explicit per-row mapping to the 12 workbook UI groups; do not infer it.
- Which V2 rows are truly reserved/ambiguous/vendor extensions and which are safe to implement read-only.
- The intended model/capability policy for 16S vs 32S.
- Current real browser DOM because the final independent audit could not repeat Claude's visual check.
- Current firmware build/tool versions and warnings.
- Exact scope/safety authorization before any real hardware write or flash.

## Unresolved contradictions / uncertainties

- Old docs call `protocol/registers.canonical.json` the source of truth; newer user decision makes official PDF + verified V2 workbook the foundation. Migration is not complete.
- `docs/AUTH_AND_HISTORY.md` says Basic auth/ESPHome 2026.6.5; current YAML says Digest/2026.8.2.
- Claude reported all suites passing; current V2 workbook causes `KeyError: 'BMS Parameters'` in the old pipeline. No-workbook suite passes only by skipping it.
- Stage 5 claims UI-wide freshness; current code leaves most non-register budgets null.
- P1-04 was reported closed, but `control_override_reason` is not classified in either canonical file.
- Protocol supports 32 channels, deployed device observed 16S, code hardcodes 16. Safe capability of the deployed model beyond 16 is unknown.
- V2 has 12 desired groups but no deterministic per-register mapping/order.
- Real cause of failed CellCount 16→8 write is unknown without raw Modbus trace.
- Vendor extensions `0x111C`/`0x1470` are not in official V1.1.

## Recommended first actions for the next Codex session

1. Read `AGENTS.md` and `PROJECT_STATE.md`; run `git status --short`, record branch/HEAD, and do not mutate the tree.
2. Recompute the official PDF and V2 workbook hashes; inspect actual workbook sheet names/columns and V2 manifest `--check`.
3. Reproduce both runner modes in a temporary copy: no-workbook partial PASS and V2-workbook `KeyError` failure.
4. Write a narrow design/contract for one V2 authoritative pipeline: inputs, schema, source hashes, generated artifacts, release ID, atomicity, fail-closed errors and compatibility/retirement of old indices.
5. Add failing tests proving: V2 sheet accepted, old/wrong schema rejected clearly, missing workbook rejects release, source hash drift rejects, mixed-generation artifacts reject, skipped pipeline cannot print release success.
6. Implement only the minimal pipeline/index migration required to make those tests pass; do not change firmware/UI behavior in the same change set.
7. Regenerate in an isolated staging directory and diff every artifact; run syntax, generator, fingerprint, release and full relevant tests with exact exit codes.
8. Update `PROJECT_STATE.md` and execution log with actual evidence and residual contradictions. Do not claim Stage/P0 closure unless all stated exit criteria pass.
9. Next, obtain/approve explicit 12-group per-row mapping and plan canonical migration of 97 missing/38 partial rows, read-only first.
10. Defer exact write API, packed RMW, dynamic topology and hardware writes to separate controlled stages after the source pipeline is trustworthy.
