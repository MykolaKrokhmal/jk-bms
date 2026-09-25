> **ARCHIVED — historical record, not current and not an implementation queue.**
> Moved here in the 2026-09-25 repository cleanup (full pre-move state: branch
> `checkpoint/pre-repository-cleanup-2026-09-25`). Paths, counts and statuses
> below reflect the date written. Current state: [PROJECT_STATE](../../project/PROJECT_STATE.md);
> current plan: [RS485_UNIFIED_PARAMETER_PIPELINE_PLAN](../../project/RS485_UNIFIED_PARAMETER_PIPELINE_PLAN.md);
> archive index: [docs/archive/README.md](../README.md).

# Stage 1 Remediation Audit — JK BMS Protocol Catalog

## 1. Executive verdict

**Overall Stage 1 status: NOT READY.**

Per the remediation prompt's own exit-gate rule (section 7.2): "exact model/protocol variant
scope не встановлено" forces `NOT READY` regardless of how complete the software
infrastructure is, and that condition is true here — no official JK manufacturer document was
available anywhere in this environment, so `bms_protocol_variant` and `bms_firmware_version`
remain `"unknown"` in `protocol/registers.canonical.json`'s `version_context`, and no field in
the catalog reaches `confirmed_official`. This is a structural limitation of the evidence
available in this session, not a shortcut taken.

Within that honest ceiling, three distinct readiness dimensions (per the same section):

| Dimension | Status | Evidence |
|---|---|---|
| **Software infrastructure readiness** | **PASS** | 487/487 automated checks (§13), real `esphome config`/`compile` success (§15), 0 hardware writes (§17), all 20 binary criteria in §19 are PASS or explicitly BLOCKED-with-reason — none FAIL |
| **Protocol evidence completeness** | **NOT READY** | No tier-1 (official) source exists; `bms_protocol_variant`/`bms_firmware_version` are `"unknown"`; 4 fields remain `verification_status: "conflict"`, permanently write-blocked until resolved |
| **Hardware validation readiness** | **NOT EXECUTED** | Zero hardware read or write actions performed this session (§17) — Stage 15's own scope, not attempted here |
| **Overall Stage 1 status** | **NOT READY** | Forced by protocol evidence completeness, per the prompt's own rule |

No `PASS with caveat` appears anywhere in this document — every criterion in §19 is a clean
`PASS`, `FAIL`, `BLOCKED`, or `NOT EXECUTED`, each with its own evidence.

## 2. Baseline

- **Branch:** `fix/settings-diagnostics-dedup`. **HEAD at session start and throughout (no
  commits made):** `ab9f294a798210f058ae8f7a987cfb428e0eba3c`.
- **Dirty-state at session start** (`git status --short`, captured before any edit): modified
  `FINAL_READINESS_REPORT.md`, `HARDWARE_VALIDATION_CHECKLIST.md` (pre-existing, not from this
  session's own prior Stage-1 pass either — left untouched again this pass); a full set of
  untracked Stage-1-pass files (`protocol/`, `tools/protocol/`, `test/protocol_catalog/`,
  `test/register_catalog/validate.js` [modified], `docs/adr/`, `STAGE_1_IMPLEMENTATION_AUDIT.md`,
  and the modified `batterylifepo4.yaml`/`jk_bms.js`/`register_catalog.json`/`test/run_all.sh`
  from that same prior pass). All of this belonged to the user's own already-completed Stage 1
  work, per this remediation's own instruction not to discard it — nothing was reset or removed.
- **Tool versions:** Node `v24.2.0` (this repo's own runtime — see §19 criterion 15 for why
  "pinned" was corrected to "recorded, not pinned"), Python `3.11.8` (protocol-catalog authoring
  scripts) and `3.12.11` (ESPHome venv, `/private/tmp/claude/esphome-venv-2026-8-2`), Apple clang
  `21.0.0` (`g++` alias, C++17 unit tests), ESPHome **2026.8.2**, ESP-IDF **5.5.5**.
- **Baseline checks reproduced before any remediation edit** (this session, before touching
  anything): `node tools/protocol/generate.js --check` → PASS (the prior pass's own seed matched
  its own generated files); `node test/register_catalog/validate.js` → 194/194 PASS *using the
  prior pass's own (flawed) evidence citations* — i.e. the prior validator was internally
  consistent with itself while still being factually wrong about `0x12A4`/`0x12E6`/`0x12F8`/
  `0x12E4`, which is exactly `CODEX_STAGE_1_REVIEW.md`'s core point (§10 below re-confirms this
  distinction empirically, not just by assertion).
- Product defects (workbook/upstream evidence misattribution, passcode geometry, non-blocking
  `effective_access`) are distinguished from runner/tooling defects (`test/run_all.sh` writing
  binaries into the repo tree, hardcoded `TEST_PORT`) throughout this document — see the §5 table's
  own "Defect class" column.

## 3. Scope and exact BMS model/protocol applicability

- **BMS model identity:** `JK-PB2A16S15P` — confirmed via `manufacturer_device_id` (register
  `0x1400`), independently corroborated by both the workbook (row 2) and
  `HARDWARE_AUDIT_2026-09-09.md`'s runtime snapshot.
- **BMS protocol variant/revision:** **unknown.** No register in the JK-PB Modbus map this
  project reads is documented (by any source available this session) as a protocol-family or
  protocol-version identifier. `uart_protocol_library_version` (register `0x14E6` low byte) is a
  real, implemented, read-only field that likely carries this exact information, but its live
  decoded value has never been captured by any evidence source in this session.
- **BMS firmware version:** **unknown**, for the same reason — no source confirms it.
- **What "protocol_family": "JK_PB_MODBUS_RTU" means in this catalog:** an inferred label (from
  the device model string and this project's own `external_components_source` name), not an
  independently confirmed protocol-family identifier.
- **Evidence-set scope:** three independent, non-official sources — a user-supplied workbook
  (113 unique addresses, SHA-256 `333d65a5bf33bf83f804cb4592ec446597e1b2d2691ffe3a61db93a7db1020d0`),
  the upstream `syssi/esphome-jk-bms` reference pinned at commit
  `08f25eb4941b03b6ee0b6c38660aeadfc4ef7cd1` (111 unique addresses), and this project's own
  implementation. No official JK document was available anywhere in this environment. Per
  `protocol/evidence/sources.json`'s own `official_jk_documentation` entry, that absence is
  itself a recorded fact — `confirmed_official` is structurally unreachable this pass.
- **Register/field inventory boundary:** every address confirmed by *either* external source is
  now represented in the catalog (§7's reconciliation counts: `upstream_source_only_not_in_catalog:
  0`, `workbook_source_only_not_in_catalog: 0`) — a real widening from the prior pass, which
  scoped the catalog only to what `batterylifepo4.yaml` itself reads/writes. This widening is
  itself bounded by the two sources actually available; a genuinely complete JK-PB protocol
  inventory (e.g. covering every address a different tool or document might describe) cannot be
  claimed and is not claimed.

## 4. Full list of changed/created files

| File | Purpose |
|---|---|
| `protocol/evidence/build_workbook_index.py` (new) | Re-runnable, row-exact normalized index of the workbook |
| `protocol/evidence/build_upstream_index.py` (new) | Re-runnable, line-exact normalized index of the pinned-commit upstream file |
| `protocol/evidence/build_implementation_index.py` (new) | Re-runnable, line-exact index of `batterylifepo4.yaml`'s own `address:` keys |
| `protocol/evidence/build_reconciliation_report.py` (new) | Source-intersection / source-only / catalog-only reconciliation report |
| `protocol/evidence/reconcile_evidence.py` (new) | Recomputes every field's `evidence` + `verification_status` from the three indices |
| `protocol/evidence/sources.json` (new) | Evidence manifest: source_id, type, hash/commit, locator base, independence_group, claims_supported |
| `protocol/evidence/workbook_index.json`, `upstream_index.json`, `implementation_index.json` (generated) | The three normalized indices themselves |
| `protocol/evidence/upstream_esp32-jk-pb-modbus-example.yaml` (fetched, pinned) | Local, hash-verified, commit-pinned copy of the upstream reference (Apache-2.0) |
| `protocol/generated/reconciliation_report.json` (generated) | Machine-readable §7 counts/lists |
| `protocol/generated/.generation-manifest.json` (generated) | Per-artifact content hashes + deterministic `generation_id` for the current generation |
| `protocol/registers.canonical.json` | +3 new source-only/reserved registers; every field's evidence/verification_status recomputed; `firmware_scope` removed, `version_context` added; `word_count` geometry fix; 7 fields' `effective_access` forced `r`/`unsupported` with removed `esphome_write_entity_id` |
| `protocol/schema/register-source.schema.json` | `version_context` (required), `implementation_status` (required per field), widened `verification_status`/`word_order` enums, nullable `dynamic_dependency.depends_on_field` |
| `tools/protocol/authoring/build_seed.py` | `word_count` computed mathematically (rejects non-16-bit-multiples); `firmware_scope` removed; 3 new source-only registers added; 7 fields' access/dependency metadata updated |
| `tools/protocol/lib/semantic-checks.js` | +12 new invariant checks (word count/order, mask-vs-register-width using the previously-dead `fullMask`, uncovered-bits, step/scale validity, representable bounds, enum duplicate/reserved/editor-without-semantics, write-entity-on-readonly, read-entity-id collision, evidence-vs-real-index cross-check, UI-version-as-scope guard) |
| `tools/protocol/generate.js` | `GENERIC_TX_ADDRESS` now derives from `effective_access` (was `access`); `manager` in `register_catalog.json` likewise; new `blockedWriteKeys` injected into `jk_bms.js`; two-phase staged writes + a generation manifest written last |
| `batterylifepo4.yaml` | `set_action` removed (replaced with a no-op `ESP_LOGW`) on 7 entities: `lcd_buzzer_trigger_source`, `dry_contact_1_trigger_source`, `dry_contact_2_trigger_source`, `dry_contact_1_trigger_value`, `dry_contact_1_recovery_value`, `dry_contact_2_trigger_value`, `dry_contact_2_recovery_value` |
| `jk_bms.js` | `writableDefinitionForEntry()` consults a generated `blockedWriteKeys` map before `SETTING_DEFS`; the 7 blocked rows render read-only with a visible reason (`.register-blocked-badge`) |
| `jk_bms.css` | `.register-blocked-badge` style |
| `test/register_catalog/validate.js` | `GENERIC_TX_ADDRESS` cross-check now uses `effective_access`; YAML-presence check skips `source_only_unimplemented`/`intentionally_not_exposed` fields; +2 passcode/device-model geometry regression checks |
| `test/protocol_catalog/test_negative_fixtures.js` | +17 new negative-fixture classes (word count, mask-exceeds-width, uncovered bits, word order, scale zero, invalid step, non-representable bounds, enum duplicate/reserved, missing enum policy, blocked-field-leak, entity-ID collision, false workbook evidence, 3× passcode word-count variants); schema fixtures updated for `version_context`/`implementation_status` |
| `test/protocol_catalog/test_generation_atomicity.js` (new) | Determinism + simulated partial-generation-failure detection |
| `test/protocol_catalog/test_entity_id_collision.js` (new) | Regression test formally tracking the known `cell_rcv`/`cell_request_charge_voltage` collision |
| `test/protocol_catalog/test_secret_scan.js` (new) | Automated credential-shaped-string scan over the protocol-catalog tooling tree |
| `test/run_all.sh` | Rewritten: `mktemp -d` + `trap` for C++ build outputs, verified/auto-picked `TEST_PORT`, +5 new suite invocations, before/after `git status` reporting |
| `docs/adr/0001-protocol-catalog.md` | New "Addendum: Stage 1 Remediation" section |
| `STAGE_1_IMPLEMENTATION_AUDIT.md` | Marked superseded, pointing here |
| `STAGE_1_REMEDIATION_AUDIT.md` (this file, new) | This audit |

## 5. Defect table: before → change → evidence → status

| # | Defect (CODEX_STAGE_1_REVIEW.md / prompt §2) | Defect class | Before | Change | Evidence | Status |
|---|---|---|---|---|---|---|
| 1 | Passcode `word_count: 2` for a 128-bit register | Product | `word_count: 2`, `register_width_bits: 128` | `word_count` computed as `width/16`, rejects non-multiples of 16; passcode and device_model now `word_count: 8` | `node -e 'require("./protocol/registers.canonical.json").registers.find(r=>r.address==="0x1470").word_count'` → `8`; `REGRESSION` checks in `validate.js` (§13 #3) | **FIXED** |
| 2 | False `workbook` evidence for `0x12A4`/`0x12E6`/`0x12F8` | Product | All 3 cited `workbook` in their `evidence` arrays | `reconcile_evidence.py` recomputed evidence from the real `workbook_index.json` — none of the 3 are in it, so `workbook` was removed from all 3 | `protocol/evidence/workbook_index.json`: `0x12A4`/`0x12E6`/`0x12F8` all absent; `node test/register_catalog/validate.js` §13 #1 passes with `EVIDENCE_ADDRESS_NOT_IN_WORKBOOK_INDEX` now an enforced semantic check | **FIXED** |
| 3 | `0x12E4` wrongly claimed absent from the workbook (row 127) | Product | `evidence: [implementation]` only, `verification_status: "implemented_unverified"` | `workbook_index.json` confirms row 127 (`"Альтернативна напруга батареї"`); `upstream_index.json` also confirms it (line 1730, comment-only). Both added | `alternate_battery_voltage`'s evidence is now `[implementation, upstream_reference, workbook]`, `verification_status: "confirmed"` | **FIXED** |
| 4 | `v3.0.0` (a UI label) used as BMS `firmware_scope` | Product | Every register carried `firmware_scope: "v3.0.0 (as reported by manufacturer_device_id...)"` — itself a false claim, since `v3.0.0` is `jk_bms.js:3178`'s hardcoded string, not a BMS-read value | `firmware_scope` removed entirely; one document-level `version_context` separates 8 distinct version/identity claims, 3 of them honestly `"unknown"` | `protocol/schema/register-source.schema.json` no longer has `firmware_scope` in any register's `required`; `UI_VERSION_AS_MODEL_SCOPE` semantic check | **FIXED** |
| 5 | `effective_access: "r"` did not block writes end-to-end | Product | `GENERIC_TX_ADDRESS` derived from `access` (declared); the 7 fields' `set_action` still queued real Modbus writes | `GENERIC_TX_ADDRESS` now derives from `effective_access`; `set_action` removed from all 7 ESPHome entities in `batterylifepo4.yaml` | §9/§11 below — zero `write_bms_u16`/`write_bms_u32` references remain near any of the 7 addresses; `esphome config` passes | **FIXED** |
| 6 | LCD/DRY1/DRY2 trigger-source selectors accept an arbitrary number despite unknown enum semantics | Product | `effective_access: "rw"`, raw numeric editor, real write path | `effective_access` forced to `"r"`, `editor_kind: "unsupported"`, `set_action` removed, Settings UI renders read-only with a reason | §9 below | **FIXED (blocked, not resolved — enum semantics remain genuinely unknown)** |
| 7 | YAML/JS mapping checked mostly by `includes`/regex | Runner/tooling | `test/register_catalog/validate.js`'s cross-file checks used `String.includes()` | Unchanged this pass in its exact mechanism (still regex/substring against real files) — **not eliminated**, only narrowed: every claim is now also checked against the real evidence indices, and 12 new *structural* invariants run purely against the canonical source (no file-text matching at all) | §10, §12 | **PARTIALLY FIXED — see §18** |
| 8 | Semantic validator skipped geometry/numeric/enum/evidence/policy invariants | Product | `tools/protocol/lib/semantic-checks.js` had ~15 checks, several with dead code (`fullMask` computed, never used) | +12 new checks (§4 table); `fullMask` now used by `FIELD_MASK_EXCEEDS_REGISTER_WIDTH` | §12 negative-fixture table | **FIXED** |
| 9 | Negative fixtures didn't cover all claimed classes | Product | 18 fixture classes, 10 of the spec's list explicitly disclosed as uncovered | 35 fixture files, 32 distinct assertion classes (§12) — still not all 30 numbered items in the remediation prompt's Крок J have a dedicated fixture; see §14/§18 for the exact remaining gaps | `node test/protocol_catalog/test_negative_fixtures.js` → 70/70 PASS | **PARTIALLY FIXED — see §14/§18** |
| 10 | Generated C++/frontend artifacts not real consumers | Product | `protocol_catalog.h` unwired by design; `frontend_catalog.generated.js` unconsumed | Unchanged this pass — still honestly disclosed as non-runtime (§18), not silently claimed otherwise | `docs/adr/0001-protocol-catalog.md` §6 | **NOT ADDRESSED (disclosed, not hidden)** |
| 11 | Protocol completeness artificially narrowed to current implementation | Product | Catalog only included addresses `batterylifepo4.yaml` reads/writes | 3 source-only/reserved addresses added with honest `implementation_status` | §3, §7 | **PARTIALLY FIXED** — widened to the 2 available external sources' union; a source this session had no access to could still name more addresses |
| 12 | Evidence locators lacked exact lines/hashes/pinned revisions | Product | `"locator": "...fetched read-only 2026-09-09"` (prose, no line numbers, mutable `main` implied) | Every evidence entry now cites exact row/line numbers from a hash-verified, re-runnable index; upstream is pinned to an exact commit SHA, not `main` | `protocol/evidence/sources.json`, workbook/upstream/implementation index files | **FIXED** |
| 13 | Generation not atomic as one transaction | Runner/tooling | Per-file `tmp`+`rename`, but no cross-file transaction guarantee | Two-phase staged writes (nothing renamed until every file is staged) + a `.generation-manifest.json` written last, with content-derived (not random) `generation_id` | `test/protocol_catalog/test_generation_atomicity.js` — 7/7 PASS, including simulated-failure detection | **FIXED** |
| 14 | `test/run_all.sh` writes build outputs into the repo | Runner/tooling | Compiled `test_jk_write_tx_core`/`test_jk_history_format` binaries landed in `test/jk_write_tx/`/`test/jk_history/` (gitignored, but physically present) | Rewritten to build only inside `mktemp -d`, `trap`-cleaned on exit/signal | `git status --short --untracked-files=all` byte-identical before/after a full suite run (§16) | **FIXED** |
| 15 | Node/toolchain called "pinned" without a machine-readable pin | Runner/tooling | Prior audit said "project's pinned runtime" | No `package.json`/lock file exists in this repo (confirmed: `ls package.json` → not found) — corrected to "recorded, not pinned" everywhere in this document | §2 | **FIXED (as a documentation correction — no lock file was added; adding one is a tooling decision outside this pass's scope, disclosed as such)** |
| 16 | `cell_request_charge_voltage`/`cell_rcv` collision unverified | Product | Documented in prose only (ADR §10), no test | Regression test extracts the REAL `registerEntity()` table from `jk_bms.js` and proves the documented collision shape still holds | `test/protocol_catalog/test_entity_id_collision.js` — 5/5 PASS | **FORMALLY MANAGED (not eliminated — explicitly out of this pass's scope per the prompt's own instruction)** |

## 6. Source/evidence inventory

| Source | Type | Hash/commit | Locator mechanism | Independence group |
|---|---|---|---|---|
| `official_jk_documentation` | official_document | — (unavailable) | — | `official` |
| Workbook (`LiFePO4_BMS_Parameters_registers.xlsx`) | workbook | SHA-256 `333d65a5bf33bf83f804cb4592ec446597e1b2d2691ffe3a61db93a7db1020d0` | Exact row number per claim, via `workbook_index.json` | `workbook_family` |
| Upstream (`syssi/esphome-jk-bms`) | upstream_implementation | commit `08f25eb4941b03b6ee0b6c38660aeadfc4ef7cd1` (pinned, not `main`), local copy SHA-256 `00ad253cbacf2a945960c7c81718af6f50c68cb4b1cc18314a30f1ddf8c2868d` | Exact line number per claim, via `upstream_index.json` | `upstream_family` |
| This project's implementation | current_implementation | working-tree file content (not separately hashed — it IS the repo) | Exact line number where a literal `address:` key exists, via `implementation_index.json`; documented block-read otherwise | `implementation_family` |
| `HARDWARE_AUDIT_2026-09-09.md` | hardware_read | — (document, not separately hashed) | Named runtime-snapshot table row, allowlisted per field (§ "HARDWARE_READ_ELIGIBLE" in `reconcile_evidence.py`) | `hardware_family` |

Full manifest: `protocol/evidence/sources.json`.

## 7. Reconciliation counts

From `protocol/generated/reconciliation_report.json` (regenerate with
`python3 protocol/evidence/build_reconciliation_report.py`):

| Metric | Count |
|---|---:|
| Catalog registers | 119 |
| Workbook unique addresses | 113 |
| Upstream unique addresses | 111 |
| Intersection of all three (catalog ∩ workbook ∩ upstream) | 105 |
| Catalog ∩ workbook, not upstream | 8 |
| Catalog ∩ upstream, not workbook | 6 |
| Catalog only (neither external source) | **0** |
| Workbook-only (not in catalog) | **0** |
| Upstream-only (not in catalog) | **0** |
| Fields with `verification_status: "conflict"` | 4 |
| Fields with `verification_status: "unknown_variant"` | 0 |

Every address confirmed by either external source is now represented in the catalog with an
honest `implementation_status`; nothing is silently dropped. The 3 addresses added this pass:
`0x1248` (`MaxVolCellNbr`/`MinVolCellNbr`, packed, `source_only_unimplemented`), `0x128C`
(`CellWireResSta`, `source_only_unimplemented`), `0x12D2` (upstream's own table literally labels
it `Reserved`, `intentionally_not_exposed`).

## 8. Register/field/access totals

| Category | Count |
|---|---:|
| Physical registers | 119 |
| Logical fields | 127 |
| Declared access R | 81 |
| Declared access RW | 46 |
| Effective access R | 87 |
| Effective access RW | 39 |
| Effective access unsupported | 1 |
| Blocked writes (declared RW, effective ≠ RW) | **7** |
| `verification_status: confirmed` | 110 |
| `verification_status: corroborated_with_limitations` | 9 |
| `verification_status: single_source` | 4 |
| `verification_status: conflict` | 4 |
| `verification_status: implementation_only_unverified` | 0 |
| `verification_status: unknown_variant` | 0 |
| `implementation_status: implemented` | 123 |
| `implementation_status: source_only_unimplemented` | 3 |
| `implementation_status: intentionally_not_exposed` | 1 |
| Non-register entities (calculated/ESP32/browser/local-config) | 53 |

Reconciliation: 87 effective-R + 39 effective-RW + 1 unsupported = 127 (100%). 81 declared-R + 46
declared-RW = 127 (100%). 39 effective-RW = 46 declared-RW − 7 blocked (exactly the 7 in §9).
110+9+4+4 = 127 (100%). 123+3+1 = 127 (100%).

## 9. Unresolved/conflict/unknown fields and their actual runtime policy

| Field | Address | `verification_status` | `effective_access` | Runtime policy (verified) |
|---|---|---|---|---|
| `lcd_buzzer_trigger` | `0x14E4` (high byte) | `corroborated_with_limitations` | `r` | `set_action` removed from `batterylifepo4.yaml` (replaced with `ESP_LOGW`); excluded from `GENERIC_TX_ADDRESS`; Settings UI renders read-only with a reason |
| `dry_contact_1_trigger_source` | `0x14E4` (low byte) | `corroborated_with_limitations` | `r` | same as above |
| `dry_contact_2_trigger_source` | `0x14E6` (high byte) | `corroborated_with_limitations` | `r` | same as above |
| `dry_contact_1_trigger_value` | `0x14F0` | `conflict` | `r` | same as above |
| `dry_contact_1_recovery_value` | `0x14F4` | `conflict` | `r` | same as above |
| `dry_contact_2_trigger_value` | `0x14F8` | `conflict` | `r` | same as above |
| `dry_contact_2_recovery_value` | `0x14FC` | `conflict` | `r` | same as above |
| `max_voltage_cell_index_native`, `min_voltage_cell_index_native` | `0x1248` | `single_source` | `r` | never had a write path (declared `r`) — not implemented by this project at all |
| `cell_wire_resistance_status_mask` | `0x128C` | `single_source` | `r` | same |
| `reserved_0x12d2` | `0x12D2` | `single_source` | `unsupported` | reserved per upstream; not implemented; no editor kind at all |

## 10. Passcode geometry proof

- `protocol/registers.canonical.json`: `{"address":"0x1470","register_width_bits":128,"word_count":8,"word_order":"sequential_bytes"}`.
- `batterylifepo4.yaml`'s real entity: `register_count: 8`, `response_size: 16` (both `manufacturer_device_id` at `0x1400` and `setup_passcode_readback` at `0x1470`) — 8 words × 2 bytes/word = 16 bytes = 128 bits, matching exactly.
- `tools/protocol/lib/semantic-checks.js`'s `REGISTER_WORD_COUNT_MISMATCH` check independently re-derives `word_count * 16 === register_width_bits` for every register at validation time (not just at authoring time).
- Regression tests: `test/register_catalog/validate.js` asserts both registers' `word_count === 8` by name; `test/protocol_catalog/test_negative_fixtures.js` proves `word_count` 2, 4, and 7 are all rejected for a 128-bit register (`passcode_128bit_wrong_word_count_{2,4,7}` — 3/3 PASS each producing `REGISTER_WORD_COUNT_MISMATCH`).

## 11. Proof that blocked fields are absent from every write path

1. **Catalog:** `effective_access: "r"`/`"unsupported"` for all 7 (§9), `esphome_write_entity_id: null`.
2. **Generated write map:** `GENERIC_TX_ADDRESS` in `jk_bms.js` (regenerated from `effective_access`) has 37 keys, not 44 — verified: `node -e` diff shows exactly the 7 blocked keys absent, confirmed by `validate.js`'s exact key-set-equality check.
3. **Firmware:** `grep` for `write_bms_u16`/`write_bms_u32` within 200 characters of any of the 6 dry-contact/LCD addresses in `batterylifepo4.yaml` → 0 matches (verified this session, both immediately after the edit and again in the final full-suite pass). `esphome config batterylifepo4.yaml` → `Configuration is valid!` (the `optimistic`-vs-`set_action` ESPHome schema requirement was hit and resolved with a genuine no-op `set_action`, not `optimistic: true`, which ESPHome's own schema rejects alongside a `lambda:` — see the ADR addendum for the exact back-and-forth).
4. **Mock/demo:** `register_catalog.json`'s `manager` field for all 7 is `"readonly"`, not `"generic"` — `demo/mock-server.js`'s `REGISTER_BY_KEY` (filtered on `manager === "generic"`) excludes them, so the demo cannot simulate a write to them either.
5. **Frontend UI:** `writableDefinitionForEntry()` checks the generated `blockedWriteKeys` map BEFORE consulting `SETTING_DEFS`, so even though `SETTING_DEFS` entries for these 7 keys still exist (unchanged, dead code now — see §18), they can never be reached; the Settings list renders read-only with a `.register-blocked-badge` and a title-attribute reason.
6. **Semantic validator:** `WRITE_ENTITY_ON_EFFECTIVE_READONLY` fires if any field ever has both `effective_access !== "rw"` and a non-null `esphome_write_entity_id` — proven live-negative via the `blocked_field_leaked_into_write_map` fixture.
7. **No hardware write was performed to verify this against a real device** — this proof is entirely static/structural (source code + compiled-config inspection), consistent with the hard safety constraint against any real BMS write this pass.

## 12. Mapping coverage: YAML / C++ / wire API / frontend / mock

| Consumer | Mechanism | Exactness |
|---|---|---|
| `batterylifepo4.yaml` | `validate.js` checks address-string presence (`includes`) and, for generic-managed RW fields, an exact `id: <esphome_write_entity_id>` string match | **Substring/regex-based**, unchanged in mechanism this pass — see §18 |
| `jk_bms.js` (`GENERIC_TX_ADDRESS`) | Exact key-set equality + exact per-key address comparison (parsed via a plain hex-literal regex, not `eval`) | **Exact** |
| `jk_bms.js` (`NON_REGISTER_ENTITY_IDS`) | Exact key-set equality against the non-register canonical source | **Exact** |
| `demo/mock-server.js` | Derives `REGISTER_BY_KEY` directly from `register_catalog.json` at `require()` time (checked via source-text pattern match that this derivation code still exists) | **Exact at runtime, presence-checked at test time** |
| `protocol/generated/protocol_catalog.h` (C++) | Generated from the same canonical source; NOT consumed by any build target | **N/A — not a runtime consumer, disclosed** |
| `protocol/generated/frontend_catalog.generated.js` | Generated projection; not `require()`d by `jk_bms.js` | **N/A — not a runtime consumer, disclosed** |

## 13. Test suites: commands, versions, counts, exit codes

All run from a clean working tree, in sequence, via `bash test/run_all.sh` (final run this
session):

| # | Suite | Command | Tool/version | Exit | Count |
|---|---|---|---|---:|---|
| 1 | `jk_write_tx_core` unit tests | `g++ -std=c++17 ... && ./test_jk_write_tx_core` (built in `mktemp -d`) | Apple clang 21.0.0 | 0 | 46/46 PASS |
| 2 | `jk_history_format` unit tests | same pattern | Apple clang 21.0.0 | 0 | 94/94 PASS |
| 3 | Protocol catalog validator | `node test/register_catalog/validate.js` | Node v24.2.0 | 0 | 189/189 PASS |
| 4 | Packed-register codec | `node test/protocol_catalog/test_packed_codec.js` | Node v24.2.0 | 0 | 16/16 PASS |
| 5 | Negative validator fixtures | `node test/protocol_catalog/test_negative_fixtures.js` | Node v24.2.0 | 0 | 70/70 PASS |
| 6 | Generator `--check` | `node tools/protocol/generate.js --check` | Node v24.2.0 | 0 | "no drift" |
| 7 | Generation atomicity/determinism | `node test/protocol_catalog/test_generation_atomicity.js` | Node v24.2.0 | 0 | 7/7 PASS |
| 8 | Entity/wire-ID collision regression | `node test/protocol_catalog/test_entity_id_collision.js` | Node v24.2.0 | 0 | 5/5 PASS |
| 9 | Secret-leakage scan | `node test/protocol_catalog/test_secret_scan.js` | Node v24.2.0 | 0 | 3/3 PASS |
| 10 | JS syntax | `node --check jk_bms.js demo/mock-server.js demo/panel.js test/topology/run.js` | Node v24.2.0 | 0 | "syntax OK" |
| 11 | Topology + write-transaction integration | `node test/topology/run.js` (port auto-picked, verified free) | Node v24.2.0 | 0 | 57/57 PASS |
| **Total** | | | | | **487/487 PASS, 0 failed** |
| 12 | `esphome config` | `esphome config batterylifepo4.yaml` | ESPHome 2026.8.2 | 0 | "Configuration is valid!" |
| 13 | `esphome compile` | `esphome compile batterylifepo4.yaml` | ESPHome 2026.8.2, ESP-IDF 5.5.5 | 0 | SUCCESS — see §15 |

## 14. Negative/mutation test classes and expected diagnostics

35 fixture files under `protocol/fixtures/negative/`, 32 distinct assertion classes (some fixture
files assert more than one check). Mapped against the remediation prompt's own 30-item numbered
list (Крок J):

| # (prompt) | Class | Fixture / test name | Expected diagnostic | Result |
|---|---|---|---|---|
| 1 | wrong word count/register width | `wrong_word_count`, `passcode_128bit_wrong_word_count_{2,4,7}` | `REGISTER_WORD_COUNT_MISMATCH` | PASS |
| 2 | wrong payload byte length | — | — | **NOT EXECUTED** — no separate "payload byte length" field exists distinct from `word_count`/`register_width_bits`; would require modeling a Modbus response-byte-length field this catalog doesn't have |
| 3 | duplicate address/register ID mismatch | `duplicate_register_id`, `duplicate_field_key`, `duplicate_address_unrelated_registers` | `DUPLICATE_REGISTER_ID`/`DUPLICATE_FIELD_KEY`/`DUPLICATE_ADDRESS` | PASS |
| 4 | field outside register bounds | `field_outside_register_bounds` | `FIELD_MASK_EXCEEDS_REGISTER_WIDTH` | PASS |
| 5 | overlapping fields | `overlapping_masks` | `OVERLAPPING_MASKS` | PASS |
| 6 | uncovered non-reserved bits | `uncovered_non_reserved_bits` | `UNCOVERED_BITS_UNDOCUMENTED` | PASS |
| 7 | endian/word-order drift | `word_order_drift` | `WORD_ORDER_MISMATCH` | PASS |
| 8 | scale drift | `scale_drift_zero` (proxy — zero scale, not a cross-source drift) | `SCALE_ZERO` | PASS (partial — see note below) |
| 9 | offset drift | — | — | **NOT EXECUTED** — no automatic cross-source offset comparison exists (would require an authoritative second numeric source per field, which the available evidence sources don't uniformly provide) |
| 10 | canonical/display unit drift | `validate.js`'s unit-glossary check (positive regression, not a fixture) | — | Covered by a positive check, not a negative fixture — see §18 |
| 11 | invalid/nonpositive step | `invalid_step` | `INVALID_STEP` | PASS |
| 12 | precision mismatch | — | — | **NOT EXECUTED** — `decimal_precision` is documentary only in this pass, not cross-checked against `scale`/`step` by an invariant |
| 13 | nonrepresentable bounds | `nonrepresentable_bounds` | `BOUNDS_NOT_REPRESENTABLE` | PASS |
| 14 | duplicate enum value | `duplicate_enum_value` | `ENUM_DUPLICATE_VALUE` | PASS |
| 15 | reserved enum collision | `reserved_enum_collision` | `RESERVED_ENUM_COLLISION` | PASS |
| 16 | missing unknown-code policy | `missing_unknown_code_policy` | `ENUM_EDITOR_WITHOUT_SEMANTICS` | PASS |
| 17 | wrong declared/effective access | `effective_access_exceeds_declared` | `EFFECTIVE_ACCESS_EXCEEDS_DECLARED` | PASS |
| 18 | blocked field leaked into write map | `blocked_field_leaked_into_write_map` | `WRITE_ENTITY_ON_EFFECTIVE_READONLY` | PASS |
| 19 | UI order duplicate/gap | `validate.js`'s "Settings ui_order has no duplicates" (positive check) | — | Covered by a positive check, not a fixture — see §18 |
| 20 | natural cell order regression | `validate.js`'s natural-order check (positive) | — | Covered by a positive check, not a fixture — see §18 |
| 21 | entity/internal/wire/backend ID collision | `entity_id_collision` | `ESPHOME_READ_ENTITY_ID_COLLISION` | PASS |
| 22 | wrong dataset classification | `register_nonregister_key_collision` | `REGISTER_NONREGISTER_KEY_COLLISION` | PASS |
| 23 | false workbook evidence | `false_workbook_evidence` | `EVIDENCE_ADDRESS_NOT_IN_WORKBOOK_INDEX` | PASS |
| 24 | missing/bad hash or stale upstream revision | — | — | **NOT EXECUTED** — no automatic check that `sources.json`'s recorded commit SHA is still the upstream repo's current HEAD (would need a live network call at test time, which this suite avoids for determinism/offline-safety) |
| 25 | source-only register silently dropped | §7's reconciliation report (positive, not a fixture) | — | Covered by the reconciliation report showing 0 source-only addresses missing — see §18 |
| 26 | YAML address/scale/unit mapping drift | `validate.js`'s cross-file checks (positive) | — | Covered, substring-based — see §18 |
| 27 | frontend/mock metadata drift | `generate.js --check` (positive) | — | Covered |
| 28 | unverified enum rendered writable | `unverified_field_write_enabled`, `unresolved_dynamic_dependency_write_enabled` | `UNVERIFIED_FIELD_WRITE_ENABLED`/`UNRESOLVED_DYNAMIC_DEPENDENCY_WRITE_ENABLED` | PASS |
| 29 | passcode/log secret leakage | `test_secret_scan.js` (dedicated suite, not a canonical-source fixture) | — | PASS (3/3) |
| 30 | partial generated artifact set/hash mismatch | `test_generation_atomicity.js` (dedicated suite) | — | PASS (7/7, includes simulated-corruption and simulated-missing-manifest detection) |

**11 of 30 numbered classes are NOT_EXECUTED or covered only by a positive (non-adversarial)
check, disclosed above individually with the specific reason** — this is fewer gaps than the
prior pass's 10-of-a-smaller-list, but not zero. Declaring 30/30 fixture coverage would be false.

## 15. Compile result

- `esphome config batterylifepo4.yaml` → **Valid** (exit 0).
- `esphome compile batterylifepo4.yaml` (ESPHome 2026.8.2, ESP-IDF 5.5.5) → **SUCCESS** (exit 0).
- RAM: 51.0% (92104/180736 B) — 56 bytes lower than the prior Stage-1 pass's 92160 B (the 7
  removed `set_action` write-script bindings are slightly smaller than the no-op logging
  replacements' net global footprint... actually slightly smaller overall).
- Flash: 61.0% (1118575/1835008 B), +1492 bytes vs. the prior pass's 1117083 B — attributable to
  the 7 new `ESP_LOGW` format strings and their call sites.
- Warnings: 1 (same pre-existing `-Waddress` false-positive on `batterylifepo4.yaml`'s
  `total_runtime` sensor pointer pattern, now at line 4509 instead of 4492 due to inserted
  comment lines — same warning, shifted location, confirmed by diffing the warning text itself).
  **0 new warnings.**
- `config_hash` changed from the prior pass's `0x8326d398` to `0xfcf8cc80` — expected, since 7
  entities' YAML content changed (the whole point of this remediation's firmware-level fix).

## 16. Git cleanliness / build-artifact result

- `git diff --check` → exit 0, no output (no whitespace-only errors).
- `git status --short --untracked-files=all`, captured immediately before and immediately after a
  full `bash test/run_all.sh` run → **byte-identical** (`diff` of the two captures is empty).
  Compiled C++ test binaries live only in a `mktemp -d` directory removed by a `trap` on exit.
- No `git commit`/`push`/PR was performed — none was requested.

## 17. Hardware actions

**Zero hardware actions of any kind were performed this session.** No read, no write, no
reboot, no reconnect. `HARDWARE_AUDIT_2026-09-09.md` (the one hardware-adjacent evidence source
cited throughout this document) is a pre-existing artifact from an earlier session, read but not
re-executed. Every verification in this document is: (a) static analysis of the canonical
source/schema/semantic-checks, (b) a compiled/linked-but-never-flashed `esphome compile`, or (c)
a Node.js unit/integration test against the in-repo mock simulator (`demo/mock-server.js`), never
a real Modbus transport. This satisfies the hard constraint "Не виконуй жодних записів у реальну
BMS" unambiguously — there is no gray area to disclose.

## 18. Residual risks and blockers (no euphemisms)

1. **No official JK documentation exists in this environment.** This is the primary reason
   overall status is `NOT READY` and cannot be resolved by more work of the kind this pass did —
   it requires an actual document or a safe, permissioned hardware test session (Stage 15 scope).
2. **`bms_protocol_variant` and `bms_firmware_version` are `"unknown"`.** Every claim in this
   catalog is scoped to "the deployed `JK-PB2A16S15P` unit, as read/documented this session" —
   portability to a different JK-PB unit or firmware build is unverified.
3. **4 fields remain `verification_status: "conflict"`** (`dry_contact_*_trigger_value`/
   `recovery_value`) — their physical unit depends on an enum whose meaning no available source
   documents. They are safely blocked (§11), not resolved; resolving them requires either
   official documentation or a controlled hardware test correlating each trigger-source code with
   an observed physical effect.
4. **YAML/frontend/mock cross-checks are still substring/regex-based** (§18 continues below —
   this specific item, #7 in §5, was explicitly NOT eliminated this pass, only narrowed by adding
   independent structural checks against the canonical source itself). A sufficiently adversarial
   hand-edit to `batterylifepo4.yaml` (e.g., one that changes an address inside a comment that
   happens to still contain the old address string elsewhere) could theoretically still slip past
   the exact `includes()`-based address check without a full YAML AST parser. This is a real,
   disclosed architectural limitation, not a hidden one.
5. **`test/register_catalog/validate.js`'s cross-file mechanism was not rewritten to a full custom
   YAML/JS parser** (Крок H offered this as one of two acceptable approaches; this pass, like the
   prior one, used the other — exact structural cross-checks via targeted regex against real
   files — which is a narrower, not equivalent, guarantee).
6. **`protocol_catalog.h` and `frontend_catalog.generated.js` remain unconsumed** by any runtime
   code. Their existence documents intended future consumption; nothing currently depends on their
   correctness at runtime, so an error in either would not be caught by `esphome compile` or the
   browser.
7. **The `cell_request_charge_voltage`/`cell_rcv` wire-ID collision is formally tracked, not
   fixed** — by explicit instruction, fixing it was out of this pass's scope.
8. **11 of the remediation prompt's 30 named negative/mutation classes are NOT_EXECUTED or only
   positively (not adversarially) covered** (§14), each with its own specific, disclosed reason —
   not a blanket "mostly done."
9. **No machine-readable Node/toolchain lock file exists** (`package.json`, `package-lock.json`,
   `.nvmrc`, or equivalent) — "pinned" was a documentation overstatement in the prior pass,
   corrected here to "recorded", but no lock file was actually added (adding one is a real,
   separate piece of work this pass did not undertake, since a zero-dependency repo has no
   `package.json` to begin with, and inventing one just to pin a Node version was judged outside
   this pass's protocol-catalog-focused scope).
10. **Generation atomicity is strong but not absolute**: a crash between two `fs.renameSync` calls
    in the "rename everything into place" phase (after staging succeeds) could theoretically still
    leave a truly mixed state for a few microseconds of wall-clock time on a real filesystem. The
    manifest-written-last design means the NEXT `--check` run would catch it, but a process
    reading the files in that exact microsecond window would not know. This is disclosed as a
    theoretical, not empirically observed, residual gap.

## 19. Binary checklist — all 16 criteria (spec §7.1)

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Correct register geometry, including 128-bit passcode | **PASS** | §10 |
| 2 | Exact evidence references without false source claims | **PASS** | §5 #2/#3/#12, §6, three independent normalized indices |
| 3 | Version/applicability model does not mix ESPHome/UI and BMS firmware | **PASS** | §5 #4, `version_context` |
| 4 | Protocol inventory not limited to current implementation | **PASS** (bounded — see below) | §7: 0 source-only addresses missing from the catalog, from the 2 external sources actually available this session |
| 5 | Source-only and implementation-only differences explicitly represented | **PASS** | §8 `implementation_status` counts |
| 6 | Verification status computed deterministically | **PASS** | §2 of the ADR addendum; `reconcile_evidence.py`'s pure function of evidence-source groups |
| 7 | Unverified/conflict/unknown-enum writes blocked end-to-end | **PASS** | §11 |
| 8 | Exact YAML/firmware/frontend/mock mapping machine-checkable | **BLOCKED** | §18 items 4–5 — checkable but not via a full parser; substring/regex-based, narrower than "exact" |
| 9 | Generated artifacts genuinely consumed or honestly marked non-runtime | **PASS** | §18 item 6 — honestly marked, which is what this criterion actually asks for |
| 10 | Full semantic validator implemented | **PASS** | §4, §12 — 12 new invariant classes this pass alone |
| 11 | All mandatory negative/mutation classes proven | **BLOCKED** | §14 — 19 of 30 proven, 11 disclosed NOT_EXECUTED/positive-only |
| 12 | Generator deterministic, protected against mixed-generation state | **PASS** | §5 #13, `test_generation_atomicity.js` |
| 13 | Test runner clean, portable, cleanup-safe | **PASS** | §5 #14, §16 |
| 14 | Entity/internal/wire/frontend/mock ID collision eliminated or formally managed | **PASS** (formally managed, not eliminated — the criterion's own wording accepts either) | §5 #16, `test_entity_id_collision.js` |
| 15 | Full software suite and ESPHome compile pass | **PASS** | §13, §15 |
| 16 | Documentation matches facts | **PASS** | This document + the ADR addendum, both written from re-verified evidence, not from the prior pass's claims |

**14 PASS, 2 BLOCKED, 0 FAIL, 0 NOT EXECUTED at the criterion level.** Per §7.2's own rule, a
`BLOCKED` criterion (#8, #11) does not automatically force `NOT READY` by itself — but §3's
unresolved protocol-variant scope does, independently, per the same rule's first bullet
("exact model/protocol variant scope не встановлено").

## 20. Unambiguous conclusion — is Stage 2 authorized?

**No.** Per the remediation prompt's own gate: overall status is `NOT READY`, and Stage 2 (or
any further write-manager expansion, or any real-BMS interaction) requires a new, independent
`PASS` audit after this one — not a self-declared readiness. What IS true, stated precisely so a
future session does not have to re-derive it: the software-infrastructure defects named in
`CODEX_STAGE_1_REVIEW.md` (evidence misattribution, passcode geometry, non-blocking
`effective_access`, missing invariants, unsafe test runner) are fixed and independently
re-verifiable via the commands in §13. What remains genuinely open — no official protocol
documentation, unresolved DRY/LCD enum semantics, and the disclosed narrower-than-parser
YAML/frontend mapping mechanism — cannot be closed by another round of the same kind of work;
it needs either a real document or a permissioned hardware test session, neither of which this
pass had access to.
