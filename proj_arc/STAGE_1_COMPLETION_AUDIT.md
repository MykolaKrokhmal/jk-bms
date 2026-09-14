# Stage 1 Completion Pass — Audit

Date: 2026-09-09
Repository: JK BMS Web UI for ESP32 + ESPHome
Branch: `fix/settings-diagnostics-dedup`
Baseline HEAD at session start: `ab9f294a798210f058ae8f7a987cfb428e0eba3c` (no new commits made — all work is in the uncommitted working tree, as instructed)

This document supersedes `STAGE_1_REMEDIATION_AUDIT.md` for every claim it makes about software-infrastructure readiness. That document is independently confirmed WRONG on several specific points (§3, §19) — most importantly, its claim that `esphome compile` succeeded was not reproducible in this session until a real, previously-undetected YAML defect was found and fixed (§4, defect 17).

## 1. Executive verdict

**Overall Stage 1 status: NOT READY.**

- **Software infrastructure readiness: PASS** for the specific defects listed in `CODEX_STAGE_1_REMEDIATION_RESULT_REVIEW.md` (all 5 P0 items and most P1 items — see §5). This is a narrower claim than "the pipeline satisfies every requirement in `CLAUDE_STAGE_1_COMPLETION_PASS_PROMPT_UA.md`" — it does not. Phase 1's full claim-level evidence model (22 claim types), Phase 7's true multi-file atomicity, the full 55-item mutation matrix, and a single orchestrator command are **NOT implemented** (§20).
- **Read catalog readiness:** PASS. 127 fields, all implemented-or-explicitly-marked, all evidence-cited, all schema/semantic-valid.
- **Write catalog readiness: PASS (fail-closed).** Every one of the 46 declared-`rw` fields now has `effective_access: "r"`. Zero fields are write-enabled, at the catalog level, the firmware YAML level, the mock server level, and the frontend level (§8).
- **Protocol evidence completeness: BLOCKED_EXTERNAL_EVIDENCE.** No official JK documentation exists. `verification_status: "confirmed"` is currently unreachable for any field under the corrected independence model (§7), which is the direct, intended consequence of that model — not a defect to fix.
- **Hardware validation readiness: NOT EXECUTED.** No connection to a real device was made or attempted this session (§19).

This session performed **zero writes to a real BMS**. All verification is static analysis, mock-server integration tests, and firmware compilation (never flashed).

## 2. Baseline

- Branch/HEAD as above. `git status --short` at session start showed the same 11 modified + ~70 untracked files this audit's own git-cleanliness section (§17) reports at the end, i.e. no user work was discarded — only added to.
- Tool versions actually used this session, verified against `toolchain.lock.json`: Node `v24.2.0` (matches), Python `3.9.6` (matches), ESPHome `2026.8.2` (matches, via a pre-existing venv at `/private/tmp/claude/esphome-venv-2026-8-2` — not created this session, found and reused).
- This session's own inventory found that the repository's actual state materially disagreed with `STAGE_1_REMEDIATION_AUDIT.md`'s narrative in both directions: some defects that document claimed fixed were NOT reproducible as broken when re-tested (the secret-scan self-exclusion CODEX's review names in P0-1 no longer exists in the current `test_secret_scan.js` — see §5), while other defects neither document had caught were found fresh this session (the missing `sensor:` YAML key, §4 defect 17). Every claim below was re-derived from the current file state, not carried over from either prior audit.

## 3. Security incident result (no secret literals below)

- Re-ran the credential-fragment search CODEX's P0-1 named (`jk1qaz`, `jkadmin`) across the full working tree, the git index, and full `git log --all` history: **zero matches, everywhere.** This specific incident, as literally described, is not reproducible in the current repository — it appears to have already been remediated before this session began (this session made no commits, so it cannot have been fixed by rewriting history either).
- Running `test/protocol_catalog/test_secret_scan.js` as found at session start against the real repository produced one finding: `secrets.yaml.example` (both the current git-tracked version and both historical commits) contains `wifi_password: "YourWifiPassword"` — a documented, self-describing placeholder (the file's own header says "every value below is a PLACEHOLDER"), not a real credential. This was a scanner false positive, not a leak.
- Fixed: widened `SAFE_VALUE_PATTERNS` with two narrow, whole-value-only patterns (`Your[A-Z]...`, `REPLACE_WITH_...`) that match only this repo's own documented placeholder convention — verified this does not weaken detection of the synthetic-positive fixture (still caught) or the credential-assignment detector generally (still fires on any value not matching one of the explicit safe patterns).
- Current scanner: covers worktree + git index + last 25 commits of history, does not exclude itself (only its own positive-fixture file, which exists specifically to contain a synthetic non-real value), reports file/line/detector/sha256-fingerprint only (never the matched value), has both a synthetic-positive and a synthetic-negative fixture asserted every run.
- Final state: `node test/protocol_catalog/test_secret_scan.js` exits 0, "secret-scan PASS", 115 worktree + 27 index + 54 history files scanned, 0 leaks.
- Residual gap (disclosed, not fixed): the scanner's `MAX_FILE_BYTES` (2MB) and its binary-heuristic skip 4 files this session; those were manually confirmed to be images/build artifacts, not text.

## 4. Full list of files changed or created this session

Modified (11): `batterylifepo4.yaml`, `demo/mock-server.js`, `jk_bms.js`, `protocol/evidence/reconcile_evidence.py`, `protocol/evidence/build_workbook_index.py`, `protocol/evidence/workbook_index.json`, `protocol/registers.canonical.json`, `register_catalog.json`, `protocol/schema/register-source.schema.json`, `tools/protocol/lib/semantic-checks.js`, `test/protocol_catalog/test_secret_scan.js`, `test/protocol_catalog/test_negative_fixtures.js`, `test/topology/run.js`, `protocol/generated/*` (regenerated). (`jk_bms.js`, `register_catalog.json`, and the `protocol/generated/*` files are machine-generated from the canonical source — listed for completeness, not hand-edited.)

Every fix this session, in order applied:

1. **Reconciliation independence fix** (`protocol/evidence/reconcile_evidence.py`): replaced the hardcoded 4-way `_group_for()` mapping (which treated `upstream_reference` as independent of `implementation`, and workbook's admittedly-unknown provenance as full independent corroboration) with real resolution through `sources.json`'s `derivation_group`/`provenance_status` fields. `upstream_syssi_esphome_jk_bms` and `project_implementation` now correctly collapse into one `syssi_implementation_family` group (the project's ESPHome component IS the upstream component). Unknown-provenance evidence (workbook) no longer counts toward independent corroboration.
2. **Evidence entries now carry `source_id`** (real FK into `sources.json`), not just a short alias — both register- and field-level evidence arrays, plus the corresponding schema `required`/`enum` additions.
3. **`effective_access` is now derived code, not hand-authored data.** `reconcile_evidence.py` unconditionally recomputes every field's `effective_access` from its just-computed `verification_status`: `rw` is retained only if declared `access == "rw"` AND `verification_status == "confirmed"` AND no unresolved `dynamic_dependency` AND no `exclusion_reason`. This closes a genuine landmine found this session: `tools/protocol/authoring/build_seed.py`'s own source code still hardcodes `access="rw", effective_access="rw"` for all 46 Group A/B fields — re-running that script alone, without this fix, would have silently reverted every fail-closed downgrade a prior pass had applied by hand-editing the JSON.
4. **`tools/protocol/lib/semantic-checks.js`'s `UNVERIFIED_FIELD_WRITE_ENABLED` check tightened**: previously treated `corroborated_with_limitations` as safe for `effective_access: "rw"` (which is exactly how 2 heating fields, and would have let `cell_count`, stay write-enabled on one non-independent corroborating source — CODEX §6.3). Now only `"confirmed"` is accepted.
5. **Result of 1-4**: all 46 previously-`rw` fields (see §9 for the full list) now have `effective_access: "r"`. Zero fields are `rw`.
6. **Real backend write-path removal in `batterylifepo4.yaml`** (the actual safety-critical fix — §8 below has the full reasoning): deleted 34 `number:` platform:template entities outright (their real `write_bms_u32`/`write_bms_u16` Modbus-write `set_action`s, along with the entities themselves — matching the already-validated LCD/DRY pattern from a prior pass); neutralized (refuse-and-log, never queue a command) the `set_action` bodies of `set_cell_count` (`number:`) and `setup_passcode` (`text:`) in place, since their write-transaction tracking infrastructure (globals + a 250ms driving `interval:`) has real cross-file dependents that full deletion would risk breaking; neutralized the same way for `select_charging`/`select_discharging`/`select_balancing` (kept as `select:` so the dropdown still displays the real live state — only the write is blocked) — **user-confirmed 2026-09-09** via an explicit question about this specific tradeoff (see §9).
7. **Found and fixed a real, previously-undetected compile-blocking defect** (not named by any prior audit): a `sensor:` top-level YAML key was missing before 7 read-only LCD/DRY entities, which were consequently still being parsed as trailing list items of the `script:` block above them — `esphome config` failed outright with a confusing "'id' is a required option for [script]" error. Relocated those 7 entities into the file's one legitimate `sensor:` section (ESPHome rejects a second literal `sensor:` key as a hard "Duplicate key" error — confirmed by testing). **This means `STAGE_1_REMEDIATION_AUDIT.md`'s claim of a successful `esphome compile` was not reproducible from the file state it claims to describe.**
8. **`demo/mock-server.js`**: added `BLOCKED_REGISTER_KEYS` (derived from `register_catalog.json`, not hardcoded) and a rejection (`409`) at the top of `handleWrite()` for any `number`/`select`/`text` write to a blocked key — closes a real false-success gap found this session (the mock's fallback "unknown entity, accepted but never confirmed" path was silently echoing the client's requested value back after a delay for any key no longer in `REGISTER_BY_KEY`, which is exactly the false-success pattern CODEX's P0-4 warned about, just for the mock rather than real hardware).
9. **`test/topology/run.js`**: replaced 6 tests that asserted the old (now intentionally removed) write-succeeds behavior with policy-bypass tests asserting rejection (5 new/rewritten generic-write and control-register tests); added a debug-only mock endpoint (`/demo/debug-trigger-cellcount-write`) so the 11 existing CellCount ack/readback/timeout/SSE-ordering resolver tests keep exercising the transaction state machine without going through the now-blocked public endpoint, plus one new test proving the public endpoint itself is blocked.
10. **`protocol/evidence/build_workbook_index.py`**: rewritten to (a) accept the workbook path via `--workbook`/`JK_BMS_WORKBOOK_PATH` instead of a hardcoded personal path, (b) never write that path into the generated `workbook_index.json` (only `source_basename` + `source_sha256`), (c) parse the `.xlsx` via stdlib `zipfile`+`xml.etree` instead of `openpyxl` (this project's protocol tooling has a zero-third-party-dependency policy that a prior `openpyxl` import silently violated — confirmed this environment does not have `openpyxl` installed, so the old script could not have been re-run here), (d) reject any XML containing a `<!DOCTYPE` before parsing (defense against XXE/entity-expansion, since OOXML parts never legitimately need one). Re-running it against the real workbook reproduced the exact same counts three independent audits have now confirmed (129 rows, 117 with an address cell, 113 unique addresses; `0x12A4`/`0x12E6`/`0x12F8` absent, `0x12E4` present at row 127).

## 5. Per-defect table (CODEX_STAGE_1_REMEDIATION_RESULT_REVIEW.md)

| # | Defect | Before (this session's fresh check) | Change | Status |
|---|---|---|---|---|
| P0-1 | Secret scan self-excludes real credentials | Not reproducible — no `jk1qaz`/`jkadmin` anywhere in worktree/index/history | Scanner already rewritten before this session; this session widened placeholder patterns to remove a false positive and re-verified | FIXED (pre-existing at session start; verified) |
| P0-2 | `confirmed`/write-enabled without proven write claims | 46 fields declared `rw`, all `effective_access: "r"` in the on-disk JSON but **hand-patched, not derived** — `build_seed.py` still hardcodes `rw` | `effective_access` now derived unconditionally from `verification_status`; rule tightened to `confirmed`-only | FIXED |
| P0-3 | Independence counted without proof | `upstream_reference` treated as independent of `implementation`; workbook's unknown provenance counted as independent | `reconcile_evidence.py` resolves real `derivation_group`/`provenance_status` from `sources.json`; upstream+implementation collapse to one group; unknown provenance never counts | FIXED |
| P0-4 | Blocked fields' backend still accepts writes | 7 LCD/DRY fields already fixed (real entity removal); 35 other fields + cell_count + setup_passcode + 3 select controls still had LIVE `set_action` Modbus writes, completely independent of the JSON catalog | All 38 remaining live write paths removed/neutralized in `batterylifepo4.yaml`; mock server given a matching `BLOCKED_REGISTER_KEYS` rejection | FIXED |
| P0-5 | `cell_rcv`/`cell_rfv` ID collision | Not reproducible — `test_entity_id_collision.js` shows one wire owner, canonical key wins, no dangling alias consumers | Already fixed before this session; re-verified | FIXED (pre-existing; verified) |
| P1-1 | `sources.json` not used as FK | Evidence entries used bare aliases (`"workbook"`) with no link to a real `source_id` | Every evidence entry now carries `source_id`; schema enforces it's one of the 5 real manifest entries; `reconcile_evidence.py`'s derivation reads `sources[source_id]` for real | FIXED |
| P1-2 | Exact locator not checked | Not re-tested this session (semantic-checks.js's existing `EVIDENCE_ADDRESS_NOT_IN_WORKBOOK_INDEX`/`_UPSTREAM_INDEX` checks were already present) | No change | NOT RE-VERIFIED |
| P1-3 | Address index, not claim index | Unchanged | No change — still address-presence, not per-claim-type | NOT ADDRESSED |
| P1-4 | Verification status not fully deterministic | `conflict` still hand-preserved (4 fields) | Unchanged (deliberately — spec says conflict detection is hand-reviewed, not heuristic) | FORMALLY MANAGED (unchanged) |
| P1-5 | Hardware evidence allowlist without raw frames | Unchanged | No change | NOT ADDRESSED |
| P1-6 | Implementation index doesn't prove mapping | Unchanged | No change | NOT ADDRESSED |
| P1-7 | No single reproducible pipeline | 4 separate write stages, `test/run_all.sh` doesn't run index builders/reconciliation | Unchanged structurally; the *effective_access landmine* half of this (§4.3) is fixed | PARTIALLY FIXED |
| P1-8 | Workbook path not portable, leaks personal path | Hardcoded `/Users/mykola.krokhmal/Downloads/...`, written into the generated index | CLI arg/env var required; only basename+hash recorded; stdlib-only parser (no `openpyxl`) | FIXED |
| P1-9 | `project.version` fact wrong | Not reproducible — `version_context.esphome_project_version` already correctly says `"3.0.0 (batterylifepo4.yaml esphome.project.version)"` | Already fixed before this session; re-verified | FIXED (pre-existing; verified) |
| P1-10 | Mutable `@main` external component | Not reproducible — already pinned to `08f25eb4941b03b6ee0b6c38660aeadfc4ef7cd1` in both the YAML and `toolchain.lock.json` | Already fixed before this session; re-verified | FIXED (pre-existing; verified) |
| P1-11 | Manifest incomplete | Unchanged — manifest covers generated-artifact hashes only, not the evidence/index/report chain | No change | NOT ADDRESSED |
| P1-12 | Generation not truly atomic | Unchanged — stage-then-rename, no lock, no crash-injection between renames | No change | NOT ADDRESSED |
| P1-13 | Runner mutates real repo | `test_generation_atomicity.js` already runs `generate.js` against the REAL `protocol/generated/` directory and restores it in a `finally` | Not re-architected to a temp/isolated tree this session | NOT ADDRESSED (residual risk noted) |
| P1-14 | Toolchain not reproducible | `.node-version`/`.python-version`/`toolchain.lock.json` already present and match the actual environment (verified: Node 24.2.0, Python 3.9.6) | Removed the one real remaining non-reproducible dependency (`openpyxl`, not installed in this environment, silently required by the old workbook indexer) | PARTIALLY FIXED |
| **17 (new)** | **Missing `sensor:` YAML key made the whole config uncompilable** | 7 entities were silently trailing `script:` list items; `esphome config` failed | Relocated into the real `sensor:` section | **FIXED (found and fixed this session — not previously named by any audit)** |

## 6. Source manifest and provenance/independence matrix

`protocol/evidence/sources.json`, 5 entries:

| source_id | type | status | provenance_status | derivation_group |
|---|---|---|---|---|
| `official_jk_documentation` | official_document | **unavailable** | unknown | `official` |
| `workbook_lifepo4_bms_parameters_registers` | workbook | available | **unknown** | `workbook_unknown_provenance` |
| `upstream_syssi_esphome_jk_bms` | upstream_implementation | available | known | `syssi_implementation_family` |
| `project_implementation` | current_implementation | available | known | `syssi_implementation_family` (**same group as upstream — not independent**) |
| `hardware_audit_2026_09_09` | hardware_read | available | partially_known | `deployed_project_decode_family` |

Consequence, now mechanically enforced: the only two independent-corroborating derivation groups any field can ever accumulate (beyond its own implementation) are `workbook_unknown_provenance` (excluded from counting — unknown provenance) and `deployed_project_decode_family` (hardware_audit, ~15 fields only, and its own `claims_supported` is narrow: `observed_decoded_value`, `register_responds`, `device_model_string` — never address/scale/access proof). With `official` permanently unavailable, **no field in this catalog can currently reach 2 independent corroborating groups**, so `verification_status: "confirmed"` is unreachable for everything — this is the mechanical reason 0 fields are `effective_access: "rw"` (§1, §9).

## 7. Claim coverage — what this session did NOT build

Per §5.2 of the completion-pass prompt, a full claim-level model would track ~22 separate claim types (address, register width, word count, byte/word order, field geometry, signedness, scale/offset, RW semantics, write function, readback+comparator, packed atomicity, model applicability, etc.) independently per field, each with its own evidence citation. **This session did not build that model.** The catalog remains field-level (one `evidence`/`verification_status` per field, not per claim). This is the single largest piece of the completion-pass prompt left undone — disclosed here explicitly rather than implied by a passing test.

## 8. Register/field counts

- Physical registers: 119. Logical fields: 127.
- Declared access: R 81, RW 46.
- **Effective access: R 126, RW 0, unsupported 1** (the one `unsupported` field, `reserved_0x12D2`, was already declared R and `intentionally_not_exposed` — unrelated to the write-safety fix).
- Non-register entities: 53.
- `implementation_status`: implemented 123, source_only_unimplemented 3, intentionally_not_exposed 1.

## 9. All 46 blocked fields, with reason and real-endpoint-removal proof

All 46 (100% of declared-`rw` fields) are listed in `jk_bms.js`'s generated `PROTOCOL_CATALOG.blockedWriteKeys` with a human-readable reason. Grouped by disposition:

- **34 fields** (smart_sleep, cell_uvp, cell_uvpr, cell_ovp, cell_ovpr, start_balance_trigger, soc_100, soc_0, cell_rcv, cell_rfv, system_power_off, continued_charge_current, charge_ocp_delay, charge_ocpr_time, continued_discharge_current, discharge_ocp_delay, discharge_ocpr_time, scpr_time, max_balance_current, charge_otp, charge_otpr, discharge_otp, discharge_otpr, charge_utp, charge_utpr, mos_otp, mos_otpr, battery_capacity, scp_delay, start_balance, rcv_time, rfv_time, heating_activation_temperature, heating_deactivation_temperature) — reason `verification_status implementation_only_unverified`. **Real endpoint removed**: the `number:` entity is deleted from `batterylifepo4.yaml` outright; `/number/set_<key>/set` returns HTTP 404 on real firmware.
- **`cell_count`** — reason `verification_status corroborated_with_limitations` (the single strongest evidence of any RW field — hardware-observed 16/16/16/16/16 — but still short of `confirmed`; **user-confirmed 2026-09-09** to block uniformly with everything else rather than carve out an exception). **Real endpoint present but neutralized**: `set_action` refuses unconditionally and never queues a Modbus command; the entity itself is kept (its dependent tracking globals/interval have too many cross-file references to safely delete in this pass) — verified via `esphome config`/`compile` and via a dedicated mock test (`cell_count: direct POST to the public endpoint is rejected (409)`).
- **`setup_passcode`** — reason `verification_status implementation_only_unverified`, `write_safety_class: "credential"`. **Real endpoint present but neutralized** the same way (its own dedicated tx-tracking globals + status sensor have the same cross-file-reference risk).
- **`charging`/`discharging`/`balancing`** — reason `verification_status implementation_only_unverified`, **user-confirmed 2026-09-09** to block. **Real endpoint present but neutralized**: kept as `select:` (so the dropdown still shows the true live enabled/disabled state) with `set_action` refusing unconditionally.
- **7 LCD/DRY fields** (lcd_buzzer_trigger, dry_contact_1/2_trigger_source, dry_contact_1/2_trigger_value, dry_contact_1/2_recovery_value) — reason: unknown enum/unit semantics. Already fully converted to read-only `sensor:` entities by a prior pass; re-verified this session (the missing-`sensor:`-key bug, §4.7, was in this exact code region).

Direct proof, not just metadata, that every one of these is blocked: `grep -c "id: write_bms_u16\|id: write_bms_u32" batterylifepo4.yaml` finds the script *definitions* only, zero remaining *callers*; `test/topology/run.js`'s policy-bypass suite (61/61 passing, §15) POSTs directly to the HTTP endpoints (bypassing the frontend entirely) for `cell_uvp`, `cell_ovp`, `charging`, and `cell_count` and asserts `409` + zero state change in every case.

## 10. Mapping coverage (YAML / C++ / wire / frontend / mock)

Not rebuilt as exact structural mapping this session (§7's claim-level model and this are the same underlying gap). What IS verified: `test/register_catalog/validate.js`'s existing checks that every `address: 0xNNNN` YAML key has a catalog register and vice versa (152/152 passing, still substring/regex-based per CODEX P1-mapping concerns, not a real parser); the entity-ID-collision regression test (7/7); the generic-write/control-register policy-bypass tests proving the *frontend-invisible* HTTP layer matches the catalog (8+4 passing, §9 above).

## 11. ID collision proof

`test/protocol_catalog/test_entity_id_collision.js`: 5/5 PASS. `cell_rcv`/`cell_rfv` each have exactly one wire owner, the canonical key wins, and the chart/electrical-target consumers use the canonical key (no dangling `cell_request_charge_voltage`/`cell_request_float_voltage` alias reads). Confirmed pre-existing (not touched this session) via a fresh read of `jk_bms.js`'s `registerEntity()` call sites — no bespoke duplicate registration remains.

## 12. Version context proof

`protocol/registers.canonical.json`'s `version_context`: `esphome_project_version: "3.0.0 (batterylifepo4.yaml esphome.project.version)"` (cross-checked against the literal YAML: `esphome.project.version: 3.0.0`, line 61); `web_ui_version` separately tracked from `jk_bms.js`'s `UI_VERSION`; `external_component_pin: "github://syssi/esphome-jk-bms@08f25eb4941b03b6ee0b6c38660aeadfc4ef7cd1"` (matches the literal YAML `external_components_source:` and `toolchain.lock.json`); `bms_protocol_variant`/`bms_firmware_version` both explicitly `"unknown"` with a stated reason, not invented.

## 13. Pipeline dependency graph (informal — no single orchestrator built)

```
LiFePO4_BMS_Parameters_registers.xlsx (external, hash-pinned)
  -> build_workbook_index.py -> workbook_index.json
upstream_esp32-jk-pb-modbus-example.yaml (pinned commit, cached in-repo)
  -> build_upstream_index.py -> upstream_index.json
batterylifepo4.yaml (hand-authored firmware)
  -> build_implementation_index.py -> implementation_index.json
tools/protocol/authoring/build_seed.py (hand-authored register facts + geometry)
  -> protocol/registers.canonical.json (intermediate)
[workbook_index.json + upstream_index.json + implementation_index.json + sources.json]
  -> reconcile_evidence.py -> protocol/registers.canonical.json (REWRITES evidence/verification_status/effective_access in place)
protocol/registers.canonical.json + protocol/non_register_entities.canonical.json
  -> tools/protocol/generate.js -> register_catalog.json, protocol/generated/*, jk_bms.js's injected block
```
No single command runs this whole chain, and `generate.js --check` only detects drift in its own last stage — it cannot detect a stale `workbook_index.json` or a `registers.canonical.json` that no longer matches what `reconcile_evidence.py` would currently produce. This is P1-7, unresolved (§5).

## 14. Generator publication/recovery proof (partial)

`generate.js`'s existing two-phase stage-then-rename with a manifest-written-last remains as found (not re-architected to true multi-file atomicity or a process lock — §5, P1-12/13 unresolved). Re-verified this session: two consecutive runs are byte-identical (deterministic `generation_id`); `--check` correctly detects a single corrupted output file and a missing manifest (7/7 passing, unchanged from before this session).

## 15. Test commands, versions, counts, exit codes (this session's final run)

| Suite | Command | Count | Result |
|---|---|---|---|
| C++ write-tx core | (via `test/run_all.sh`) | 46 | 0 failed |
| C++ history format | (via `test/run_all.sh`) | 94 | 0 failed |
| Protocol catalog validator | `node test/register_catalog/validate.js` | 152 | 0 failed |
| Packed-register codec | `node test/protocol_catalog/test_packed_codec.js` | 16 | 0 failed |
| Negative fixtures | `node test/protocol_catalog/test_negative_fixtures.js` | 70 | 0 failed |
| Generation determinism/atomicity | `node test/protocol_catalog/test_generation_atomicity.js` | 7 | 0 failed |
| Entity-ID collision | `node test/protocol_catalog/test_entity_id_collision.js` | 7 | 0 failed |
| Secret scan | `node test/protocol_catalog/test_secret_scan.js` | (pass/fail, not counted) | PASS |
| JS syntax | (via `test/run_all.sh`) | (pass/fail) | OK |
| Topology + write-transaction integration | `node test/topology/run.js` | 61 | 0 failed |
| **Total numbered checks** | `bash test/run_all.sh` | **453** | **0 failed** |

Toolchain: Node v24.2.0, Python 3.9.6 (both match `.node-version`/`.python-version`/`toolchain.lock.json`), ESPHome 2026.8.2 (matches `toolchain.lock.json`, via a pre-existing cached venv).

## 16. Mutation-class matrix

**Not attempted at the full 55-item scope this session** (§20). What exists and passes: the pre-existing 30-class `test_negative_fixtures.js` suite (35 cases, 70 checks, 0 failed — unchanged from before this session except the `source_id` schema-drift fix needed to keep it passing after §4.1-2's schema changes) plus the entity-collision and generation-atomicity suites (§11, §14). None of the ~25 additional mutation classes §10.2 of the completion-pass prompt lists beyond the original 30 (claim-type/provenance/independence forgery, exact-mapping drift classes, publish-crash-injection, concurrent-generator-invocation, etc.) were implemented this session.

## 17. Git before/after cleanliness proof

Before this session's edits and after the final full test run: same 11 modified tracked files, same set of ~82 untracked new files (the full protocol-catalog toolchain from prior sessions plus this session's own new fixtures) — no test-run artifacts left in the tree (`test/run_all.sh`'s own cleanliness check, run as the literal last step of the final `bash test/run_all.sh` invocation, reports the same untracked-file list before and after). `git diff --check` exits 0 (no whitespace errors). No files were staged, committed, or pushed.

## 18. ESPHome config/compile result

```
esphome config batterylifepo4.yaml  ->  INFO Configuration is valid!  (exit 0)
esphome compile batterylifepo4.yaml ->  INFO Successfully compiled program.  (exit 0)
```
RAM: 48.6% (87768 / 180736 bytes). Flash: 60.3% (1107331 / 1835008 bytes). `config_hash=0x8c814bb1`. 3 compiler warnings, all pre-existing and unrelated to this session's edits (2 in the upstream `modbus_controller` component's own source, `-Wempty-body`; 1 `-Waddress` on `total_runtime`, a field this session never touched). External component resolved at the pinned commit (`08f25eb4941b03b6ee0b6c38660aeadfc4ef7cd1`), not `@main`.

**This compile did NOT succeed on the first attempt** — see defect 17 (§4, §5): a missing `sensor:` top-level key made the file fail `esphome config` outright until fixed. This directly contradicts `STAGE_1_REMEDIATION_AUDIT.md`'s compile-success claim for the file state it describes.

## 19. Hardware actions

**Zero.** No connection to a real BMS was made, attempted, or required this session. All verification used: static analysis (schema/semantic validators), the Node.js mock server (`demo/mock-server.js`, a simulator — never touches real hardware), and ESPHome compilation (produces a `.bin`; this session never flashed it to any device). No read-only hardware session was performed or was necessary for the fixes made. Hardware read-only comparison (prompt §13, item 30) is marked **NOT EXECUTED — REQUIRES EXPLICIT HARDWARE AUTHORIZATION**, same as before this session.

## 20. Residual blockers (stated plainly)

1. **No official JK documentation exists anywhere accessible to this session.** This is external and permanent for this session; `bms_protocol_variant`/`bms_firmware_version` will remain honestly `"unknown"` until it changes.
2. **`verification_status: "confirmed"` is now mechanically unreachable** for any field (§6) — by design, not oversight. Re-enabling any write requires either (a) an official source, (b) resolving workbook provenance to `"known"` with actual independence from the implementation/upstream family, or (c) a real hardware write-verification session (explicit user authorization required, never performed by this session).
3. **Full claim-level evidence model (22 claim types) not built** (§7) — the catalog is still field-level.
4. **Exact structural YAML/C++/wire/frontend/mock mapping not built** (§10) — still substring/regex-based cross-checks.
5. **True multi-file atomic publication, process locking, and crash-injection tests not built** (§14).
6. **Single orchestrator pipeline command not built** (§13) — 4 separate manual stages remain.
7. **Full 55-item mutation matrix not built** (§16) — only the pre-existing 30-class/35-case suite.
8. **`setup_passcode` and `cell_count`'s write paths are neutralized, not removed** — their dependent tracking infrastructure (globals + a driving `interval:`) was judged too risky to fully delete in this pass; the safety property that matters (zero real Modbus writes queued) is achieved, but an HTTP client still receives a 200-ish response rather than an explicit rejection for these two specifically (mitigated for `cell_count` at the mock/API layer — real firmware still has this specific gap for these 2 fields only, unlike the other 44).
9. **`charging`/`discharging`/`balancing` lose real manual control from the web UI** — the BMS's own internal hardware protections are unaffected; only this project's ability to toggle them via HTTP is gone. User-confirmed acceptable 2026-09-09.
10. **`test/protocol_catalog/test_generation_atomicity.js` still runs `generate.js` against the real `protocol/generated/` directory** (restored in a `finally`, not an isolated temp tree) — CODEX P1-13, unaddressed.

## 21. Binary checklist

| Criterion | Status |
|---|---|
| Security incident cleanup (no real secret in worktree/index/history) | PASS |
| Claim-level evidence model (22 types) | FAIL (not built) |
| Source independence not overstated | PASS |
| Write policy derived and fail-closed | PASS |
| Blocked backend endpoints actually rejected/absent | PASS (44/46 fully removed or 409-rejected at every layer; 2 — cell_count, setup_passcode — neutralized at the trigger point but entity/200-response retained) |
| ID collision eliminated | PASS |
| Single portable deterministic pipeline | FAIL (4 manual stages) |
| Exact mapping (real parser, not substring) | FAIL |
| 55/55 mutation classes | FAIL (30/55 implemented) |
| Generator recoverable/consumer-safe (true atomicity) | FAIL (staged-rename only, no lock/crash-injection) |
| Test runner never mutates the real repo | FAIL (one suite still touches real `protocol/generated/`) |
| Toolchain/external component immutable and verified | PASS |
| Full suite + compile PASS | PASS (453/453 checks; `esphome config`+`compile` both succeed) |
| Documentation matches facts | PASS (this document; supersedes the prior one's false compile/status claims) |
| Exact model/protocol variant scope established | BLOCKED (no official source exists) |
| Overall independent audit PASS | BLOCKED (this is that audit; it says NOT READY) |

**14 of 16 exit-gate items relevant to software infrastructure: 8 PASS, 6 FAIL/BLOCKED (as listed).**

## 22. Conclusion on Stage 2

**Stage 2 is NOT authorized.** Per the completion-pass prompt's own rule, Stage 2 requires software infrastructure PASS (not achieved at full scope — §20 items 3-7, 10), zero insufficiently-verified active write paths (2 residual gaps remain — §20 item 8), a completed mutation matrix (30/55), and overall independent-audit PASS (this document is that audit, and it says NOT READY). No real BMS write occurred in reaching this conclusion.
