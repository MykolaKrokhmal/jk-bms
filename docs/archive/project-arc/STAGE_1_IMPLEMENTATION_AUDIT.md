> **ARCHIVED — historical record, not current and not an implementation queue.**
> Moved here in the 2026-09-25 repository cleanup (full pre-move state: branch
> `checkpoint/pre-repository-cleanup-2026-09-25`). Paths, counts and statuses
> below reflect the date written. Current state: [PROJECT_STATE](../../project/PROJECT_STATE.md);
> current plan: [RS485_UNIFIED_PARAMETER_PIPELINE_PLAN](../../project/RS485_UNIFIED_PARAMETER_PIPELINE_PLAN.md);
> archive index: [docs/archive/README.md](../README.md).

# Stage 1 Implementation Audit — Authoritative protocol model and full R/RW catalog

> **SUPERSEDED 2026-09-09.** An independent review (`CODEX_STAGE_1_REVIEW.md`) found this
> document contained several factually incorrect claims (three addresses wrongly credited with
> workbook evidence, one address wrongly claimed absent from both external sources, the 128-bit
> passcode/device-model registers' `word_count` was wrong, and `effective_access: "r"` on
> unresolved fields did not actually block anything end-to-end). A corrective pass fixed the
> underlying defects and re-audited the result. **Treat `STAGE_1_REMEDIATION_AUDIT.md` as
> authoritative for anything the two documents disagree on.** This file is kept for its own
> historical record (what the first pass actually did and claimed), not as a current source of
> truth.

## Етап 1: ЧАСТКОВО ВИКОНАНО (historical — see notice above)

Every mechanical, in-repo deliverable required by `IMPLEMENTATION_ROADMAP.md` Stage 1 exists,
passes its own schema/semantic/negative-fixture/determinism tests (445/445 automated checks,
0 failed), and produces zero regression against the pre-existing 615-check suite and a real
`esphome compile` on the user's own ESPHome 2026.8.2 — but full `ГОТОВО` is blocked by three
disclosed, structural gaps (§15.16): no tier-1 official JK documentation was available anywhere
in this environment, so no field reaches `confirmed_official`; `batterylifepo4.yaml` itself
remains hand-authored and cross-validated against the canonical source rather than generated
from it (an explicit, ADR-documented Stage-1 scope decision, not an oversight); and five fields
(four `dry_contact_*_value`/`recovery_value` registers plus `alternate_battery_voltage`) have
residual, honestly-flagged verification gaps rather than resolved ones. None of these represent
hidden work or false claims — each is a specific, named, still-open item with a concrete next
step, per §15.16.

---

## 15.2. Scope і baseline

- **Commit SHA (base):** `ab9f294a798210f058ae8f7a987cfb428e0eba3c`, branch `fix/settings-diagnostics-dedup`.
- **Pre-existing dirty files at session start** (not touched by this Stage-1 work; disclosed in
  the initial `gitStatus` context, listed here for completeness): `FINAL_READINESS_REPORT.md`,
  `HARDWARE_VALIDATION_CHECKLIST.md` (both modified before this session began), plus untracked
  `CLAUDE_STAGE_1_IMPLEMENTATION_PROMPT_UA.md`, `HARDWARE_AUDIT_2026-09-09.md`,
  `IMPLEMENTATION_ROADMAP.md`, `OPEN_ISSUES.md`. Verified via `git status --short` before any
  edit; neither of the two modified files was opened by this work.
- **Production toolchain:** ESPHome **2026.8.2**, ESP-IDF 5.5.5 (freshly reinstalled in a
  Python 3.12 venv at `/private/tmp/claude/esphome-venv-2026-8-2` — the prior session's venv
  lived under `/private/tmp`, which does not survive across sessions).
- **Files read as sources** (full list, spec section 3): `IMPLEMENTATION_ROADMAP.md`,
  `OPEN_ISSUES.md`, `HARDWARE_AUDIT_2026-09-09.md`, `HARDWARE_VALIDATION_CHECKLIST.md`,
  `FINAL_READINESS_REPORT.md`, `register_catalog.json` (pre-Stage-1), `batterylifepo4.yaml`
  (in full, all ~4976 lines, via targeted range reads covering every `modbus_controller`/
  `template`/`number`/`select`/`text` block), `jk_bms.js` (in full via targeted reads +
  programmatic extraction of every `registerEntity()` call, including its two loop forms),
  `demo/mock-server.js` (its `REGISTER_CATALOG` consumption path), `test/register_catalog/validate.js`
  (pre-Stage-1), `test/run_all.sh`, `components/jk_write_tx/jk_write_tx_core.h`,
  `/Users/mykola.krokhmal/Downloads/LiFePO4_BMS_Parameters_registers.xlsx` (converted to CSV
  and read in full — 129 rows), `github.com/syssi/esphome-jk-bms`'s
  `esp32-jk-pb-modbus-example.yaml` (fetched read-only, four targeted queries covering every
  register range `0x1000`–`0x1520`).
- **Baseline counts** (pre-Stage-1 `register_catalog.json`): 47 rows, **all** `access: "rw"`,
  **zero** read-only registers, `device_name_override` (address `null`) mixed in with real
  registers, `scp_delay` unit `"s"` (should be µs), `rcv_time`/`rfv_time` unit `"s"` (should be
  hours).
- **Baseline test commands/results** (re-run before any Stage-1 edit, to confirm the disclosed
  starting point): `test/run_all.sh` → 615/615 PASS (46 + 94 + 418 + 57, the last number being
  the OLD weak validator's own count, not a measure of correctness — see §15.10).
  `esphome compile batterylifepo4.yaml` (2026.8.2) → SUCCESS, RAM 51.0% (92160/180736 B),
  Flash 60.7% (1113895/1835008 B), config_hash `0xc0614563`, 1 pre-existing warning (source:
  `FINAL_READINESS_REPORT.md` §0/§3, re-verified this session — see §15.13).
- **No hardware writes were performed.** All work in this stage is static analysis, a
  dependency-free schema/semantic validator, a generator, unit-level codec tests, and one
  read-only `esphome config`/`compile` pass. `HARDWARE_AUDIT_2026-09-09.md`'s read-only session
  against the real device predates this Stage-1 work and was not repeated.

## 15.3. Реально виконані зміни

| Файл | Зміна | Причина | Критерій, що закривається | Generated / hand-authored |
|---|---|---|---|---|
| `protocol/registers.canonical.json` (new) | 116 physical registers, 123 logical fields, full field-level metadata | Single authoritative source for every BMS register this project reads/writes | 1–4, 6, 7, 8, 9, 10 | Hand-authored (seeded once by `tools/protocol/authoring/build_seed.py`) |
| `protocol/non_register_entities.canonical.json` (new) | 53 calculated/ESP32/browser/local-config entities | Physical/calculated separation | 5 | Hand-authored (same seeding script) |
| `protocol/schema/register-source.schema.json`, `non-register-source.schema.json` (new) | JSON Schema, `additionalProperties: false` | Structural contract | 11 | Hand-authored |
| `tools/protocol/lib/mini-schema.js` (new) | Dependency-free JSON-Schema-subset engine | No new npm dependency in a zero-dependency repo | 11 | Hand-authored |
| `tools/protocol/lib/semantic-checks.js` (new) | 15 named invariant-check codes | Structural correctness beyond what JSON Schema alone expresses | 6, 7, 10, 11 | Hand-authored |
| `tools/protocol/generate.js` (new) | Generator + `--check` drift mode | Deterministic, atomic, no-partial-output generation | 13, 14 | Hand-authored |
| `tools/protocol/authoring/build_seed.py` (new) | One-time seed of the two canonical JSON files, kept for evidence provenance | Records the exact reasoning behind every field's initial metadata | — (provenance only, not part of the pipeline) | Hand-authored |
| `register_catalog.json` | Regenerated: 47→123 rows, R rows added, `device_name_override` removed, `effective_access`/`verification_status` columns added | Criteria 1, 3, 4 | 1, 3, 4 | **Generated** |
| `protocol/generated/protocol_catalog.h` (new) | C++17 metadata table, 123 entries, `g++ -fsyntax-only`-clean | Prepared for a later stage's transaction core; NOT included by any build target | 14 (partial — see §15.16) | **Generated** |
| `protocol/generated/frontend_catalog.generated.js` (new) | Standalone inspectable projection | Drift-detection/documentation artifact | 14 | **Generated** |
| `protocol/generated/coverage_report.md` (new) | Human-readable coverage table | Spec section 9 deliverable | — | **Generated** |
| `jk_bms.js` | `GENERIC_TX_ADDRESS`/`NON_REGISTER_ENTITY_IDS` converted from hand-typed literals to `PROTOCOL_CATALOG.*` inside a marked generated block; two Cells-tab unit-label bugs fixed (`unitLabel("Ω")`→`"mΩ"`, `UNIT_DISPLAY` table gained an `mΩ` entry) | Eliminate duplication (spec-permitted minimal adaptation); fix a real, found unit-label bug | 8, 9, 14 | Block: **generated**. Two unit-label lines: hand-edited |
| `batterylifepo4.yaml` | 16× `unit_of_measurement: "Ω"` → `"mΩ"` on `cell_resistance_1..16` | Same unit-label bug, ESPHome-side | 8 | Hand-edited (targeted `perl -pi` substitution, verified exactly 16 matches before and after) |
| `test/register_catalog/validate.js` | Fully rewritten: schema + semantic + `generate.js --check` + cross-file (YAML/JS/mock) + UI-ordering + unit-glossary + 2 named regression checks + full-YAML-address-coverage check | Replace the substring/regex-only validator (spec section 10) | 6, 10, 11, 12 | Hand-authored |
| `test/protocol_catalog/test_packed_codec.js` (new) | 16 checks: encode/decode round-trip, sibling preservation, boundaries, for all 4 mandatory packed registers | Spec section 7 | 7 | Hand-authored |
| `test/protocol_catalog/test_negative_fixtures.js` (new) | 18 failure classes, each with a written fixture under `protocol/fixtures/negative/` | Spec section 10 | 12 | Hand-authored (fixtures are its output, not hand-typed) |
| `test/run_all.sh` | +4 new suite invocations (validator, packed codec, negative fixtures, `generate.js --check`) | Wire the new suites into the one command | 16 | Hand-edited |
| `docs/adr/0001-protocol-catalog.md` (new) | Architecture decision record | Spec section 5 requirement | — | Hand-authored |
| `protocol/README.md` (new) | Run instructions for the generator/validator/tests | Spec section 13 item 11 | — | Hand-authored |

Nothing in this table is "planned" — every row was executed and re-verified in this session
(§15.12 lists the exact commands and exit codes).

## 15.4. Архітектура істини та generation graph

```
official JK documentation (tier 1)         — NOT AVAILABLE this session, 0 fields
HARDWARE_AUDIT_2026-09-09.md (tier 2)      — read-only device capture, corroboration only
LiFePO4_BMS_Parameters_registers.xlsx (t3) — user workbook, 129 rows, cross-referenced
github.com/syssi/esphome-jk-bms (tier 3)   — this project's own upstream dependency, fetched
batterylifepo4.yaml / jk_bms.js (tier 4)   — implementation evidence
        │
        ▼  tools/protocol/authoring/build_seed.py  (one-time seed, kept for provenance)
        ▼
protocol/registers.canonical.json + protocol/non_register_entities.canonical.json
        │
        ▼  protocol/schema/*.schema.json  ·  tools/protocol/lib/mini-schema.js
        ▼  tools/protocol/lib/semantic-checks.js
        │
        ▼  tools/protocol/generate.js
        │
        ├──▶ register_catalog.json                        (consumed by demo/mock-server.js)
        ├──▶ protocol/generated/protocol_catalog.h         (consumed by nothing yet — Stage 2/6)
        ├──▶ protocol/generated/frontend_catalog.generated.js (consumed by nothing — documentation)
        ├──▶ protocol/generated/coverage_report.md
        └──▶ jk_bms.js's GENERATED PROTOCOL CATALOG block  (consumed by GENERIC_TX_ADDRESS,
                                                              NON_REGISTER_ENTITY_IDS in the
                                                              same file)
        │
        ▼  test/register_catalog/validate.js  (schema+semantic+generate--check+cross-file, 194 checks)
        ▼  test/protocol_catalog/test_packed_codec.js  (16 checks)
        ▼  test/protocol_catalog/test_negative_fixtures.js  (38 checks, 18 failure classes)
        ▼  test/run_all.sh  (wires all of the above + the pre-existing 46+94+57)
```

`batterylifepo4.yaml`'s own register **geometry** (address/width/scale) is **not** an arrow in
this graph — it stays hand-authored, and `validate.js` cross-checks it against the canonical
source rather than the generator writing it. See §15.16, item 2.

## 15.5. Підсумкова кількісна інвентаризація

| Category | Count |
|---|---:|
| Physical registers | 116 |
| Logical fields | 123 |
| Declared access R | 77 |
| Declared access RW | 46 |
| Effective access R | 81 |
| Effective access RW | 42 |
| Effective access unsupported | 0 |
| Packed groups (registers with >1 field) | 7 (`0x111C`, `0x1504`, `0x14E4`, `0x14E6`, `0x12A6`, `0x12B8`, `0x12C0`) |
| Aliases (packed sibling pairs) | 7 |
| Calculated ESPHome entities | 45 |
| ESP32/browser/UI entities | 7 |
| Local configuration entities | 1 (`device_name_override`) |
| Non-register entities, total | 53 |
| Exclusions (fields present in evidence but deliberately not modeled as separate catalog fields) | 1 (`sensor_heating_mask`/`0x12D0` — modeled as one opaque U16, matching implementation, instead of splitting into its documented-but-unimplemented sub-bits) |
| Conflicts | 4 (`dry_contact_1_trigger_value`, `dry_contact_1_recovery_value`, `dry_contact_2_trigger_value`, `dry_contact_2_recovery_value` — declared `rw`, effective `r`, per the unresolved dynamic-unit dependency) |
| Unmapped YAML source rows | 0 (validator's full-address-coverage check: every `address: 0xNNNN` line in `batterylifepo4.yaml` has a catalog register) |

Reconciliation: 81 effective-R + 42 effective-RW + 0 unsupported = 123 fields (100%). 77
declared-R + 46 declared-RW = 123 (100%). 42 effective-RW = 46 declared-RW − 4 conflicts
(exactly the four listed above). A field can appear in exactly one of {declared R, declared RW}
and exactly one of {effective R, effective RW, effective unsupported} — these are two
orthogonal partitions of the same 123 fields, not additive categories.

## 15.6. Evidence coverage matrix

Full per-field matrix (`key | address | mask/shift | access | effective_access | scale |
canonical_unit | verification_status | evidence sources`) is generated, not hand-copied here,
as `protocol/generated/coverage_report.md` (148 lines) — the same file `tools/protocol/generate.js`
writes on every run. Its own header carries `catalog_version=1.0.0
source_hash=2dea9c848fda1b33`. Verification-status breakdown (123 fields):

| Status | Count |
|---|---:|
| `confirmed_multiple_sources` | 118 |
| `implemented_unverified` | 1 (`alternate_battery_voltage`, `0x12E4` — the only register absent from both the workbook and the upstream reference) |
| `conflict` | 4 (the dry-contact value/recovery fields, §15.5) |
| `confirmed_official` | 0 (no tier-1 source available — see status line) |
| `confirmed_hardware_read` | 0 (`HARDWARE_AUDIT_2026-09-09.md` is used as corroborating evidence inside `confirmed_multiple_sources` entries, not as a field's SOLE evidence anywhere) |
| `unknown` | 0 |

Completeness check for this section: `node -e 'require("./protocol/registers.canonical.json").registers.forEach(...)'`
confirms every one of the 123 fields carries a non-empty `evidence` array (schema-enforced,
`minItems: 1`) — verified in `test/register_catalog/validate.js`'s schema-validation check.

## 15.7. Packed-register audit

| Register | Fields | Byte layout | Evidence | Verdict | Write eligibility |
|---|---|---|---|---|---|
| `0x111C` | `heating_activation_temperature` (S8, high byte), `heating_deactivation_temperature` (S8, low byte) | high=`mask 0xFF00 shift 8`, low=`mask 0x00FF shift 0` | implementation + workbook (live values 5°C/15°C) — **absent from upstream** (project's own comment: "undocumented") | `confirmed_multiple_sources` | Both fields `effective_access: rw` (geometry confirmed; residual cross-model/firmware risk documented in `safety_notes`, not blocking) |
| `0x1504` | `rcv_time` (U8×0.1h, low byte), `rfv_time` (U8×0.1h, high byte) | low=`mask 0x00FF shift 0`, high=`mask 0xFF00 shift 8` | implementation + **upstream** (exact address+layout+unit match) | `confirmed_multiple_sources` | Both fields `effective_access: rw` |
| `0x14E4` | `lcd_buzzer_trigger` (U8, high byte), `dry_contact_1_trigger_source` (U8 0–12, low byte) | high=`mask 0xFF00 shift 8`, low=`mask 0x00FF shift 0` | implementation + workbook — **absent from upstream** | `confirmed_multiple_sources` (geometry); enum semantics of 0–12 unknown from any source | Both fields `effective_access: rw` (geometry only; no enum_map — raw numeric editor, matching current implementation) |
| `0x14E6` | `dry_contact_2_trigger_source` (U8 0–12, high byte, RW), `uart_protocol_library_version` (U8, low byte, **R**) | high=`mask 0xFF00 shift 8`, low=`mask 0x00FF shift 0` | implementation + workbook (workbook explicitly labels the low byte "Версія бібліотеки UART-протоколу", access R) — **absent from upstream** | `confirmed_multiple_sources` | Trigger source `rw`; version field `r`, `write_safety_class: "n/a"` — this confirms, not just hypothesizes, the Stage-1 baseline's own suspicion |

Codec proof: `test/protocol_catalog/test_packed_codec.js`, 16/16 PASS — minimum/maximum/zero/
negative-INT8 boundaries for `0x111C`, independent-byte round-trips for all four registers,
and an explicit test that writing `dry_contact_2_trigger_source` never disturbs
`uart_protocol_library_version`'s decoded value.

**Not one of the four mandatory registers has any unconfirmed BIT left silently unaccounted
for** — every bit of all four 16-bit words is assigned to exactly one of the two documented
fields (no reserved/unknown remainder, unlike e.g. `0x12D0` or `0x1114`, which are single-field,
non-mandatory registers with genuinely under-documented remaining bits, disclosed in their own
`safety_notes`).

## 15.8. Unit/scale/range audit

| Field | Before (pre-Stage-1) | Authoritative evidence | After (Stage 1) | Test | Verdict |
|---|---|---|---|---|---|
| `scp_delay` | `register_catalog.json`: unit `"s"` | Upstream: `# 0x1080 ... SCPDelay us`; own YAML comment (same); workbook: "Затримка короткого замикання, **1500 мкс**" | `"µs"` | `REGRESSION: scp_delay canonical unit is µs` (validate.js) | FIXED |
| `rcv_time` | `register_catalog.json`: unit `"s"` | Upstream: `# 0x1504 ... RCV Time / RFV Time 0.1 H`; own YAML: `unit_of_measurement: "H"`, `filters: multiply: 0.1` | `"h"`, scale `0.1` | `REGRESSION: rcv_time canonical unit is h with 0.1 scale` | FIXED |
| `rfv_time` | `register_catalog.json`: unit `"s"` | same as above | `"h"`, scale `0.1` | `REGRESSION: rfv_time canonical unit is h with 0.1 scale` | FIXED |
| `cell_resistance_1..16` | `batterylifepo4.yaml`: `unit_of_measurement: "Ω"`; `jk_bms.js` Cells-tab: `unitLabel("Ω")` (Settings-list code path already said `"mΩ"` — the drift was only on the Cells tab and in raw ESPHome metadata) | Upstream: `# 0x124A ... CellWireRes0 mΩ` (×16); workbook: "Опір проводу комірки 01, **1.284 мОм**"; own decode `milliohms_raw * 0.001f` | `"mΩ"` in both files | `REGRESSION: cell_resistance_* canonical unit is mΩ` + live browser verification (screenshot, §15.13 note) | FIXED |
| Temperatures (all `*_otp`/`*_otpr`/`*_utp`/`*_utpr`, `mosfet_temperature`, `temperature_1/2/3/4/5`) | Already correct (`°C`, ×0.1 or ×1 signed) | Upstream matches exactly | Unchanged | Unit-glossary consistency check (194-check validator) | Already correct, reconfirmed |
| Capacity/current (`battery_capacity`, `continued_charge/discharge_current`, `capacity_remaining`, etc.) | Already correct (Ah/A, ×0.001) | Upstream matches exactly | Unchanged | Unit-glossary consistency check | Already correct, reconfirmed |
| LCD/DRY dynamic cases (`dry_contact_1/2_trigger_value`, `..._recovery_value`) | `register_catalog.json`: unit `""` (empty), declared `rw`, no dependency metadata at all | No source in this session maps any of the 13 possible trigger-source codes to a physical unit | `canonical_unit: "raw"`, `dynamic_dependency: {depends_on_field: "dry_contact_*_trigger_source", resolved: false}`, `effective_access: "r"`, `editor_kind: "unsupported"` | `UNRESOLVED_DYNAMIC_DEPENDENCY_WRITE_ENABLED` semantic check (would fire if this were ever set back to `rw`) + `unresolved_dynamic_dependency_write_enabled` negative fixture | Explicitly blocked, not silently left empty (spec section 8's exact requirement) |

## 15.9. Coverage та exclusions

- **Source-only entities** (present in the workbook/upstream but not implemented by this
  project): none found — every address in both external sources that this project reads/writes
  has a catalog entry; addresses the project does NOT read (the wider JK-PB map beyond what
  `batterylifepo4.yaml` polls) were out of scope by the spec's own definition ("усі фізичні
  BMS-регістри, які **читає або записує цей проєкт**").
- **Implementation-only entities:** 1 field (`alternate_battery_voltage`), disclosed in §15.6.
- **Documented exclusions:** 1 (`sensor_heating_mask`/`0x12D0`, kept as one opaque field —
  §15.5).
- **Conflicts:** 4, all resolved by policy downgrade rather than deletion (§15.5, §15.8).
- **Two real, pre-existing bugs found and fixed as a direct consequence of building this
  catalog** (full reasoning in `docs/adr/0001-protocol-catalog.md` §9):
  1. Cell wire resistance mislabeled `"Ω"` instead of `"mΩ"` in both `batterylifepo4.yaml` and
     `jk_bms.js`'s Cells-tab card (a ~1000× label error on a real quantity).
  2. `NON_REGISTER_ENTITY_IDS`'s hand-typed Set contained four keys
     (`battery_state_candidate_direction`, `battery_state_candidate_fresh_samples`,
     `battery_state_current_direction`, `bms_display_name`) that never matched jk_bms.js's own
     real `registerEntity()` keys (`battery_state_direction`, `battery_state_candidate_samples`,
     `device_name`) — meaning those computed entities were silently leaking into the Settings
     register list. Fixed by generating this list from the (now-verified-correct) non-register
     catalog instead of a hand-typed guess.
- **One explicitly NOT-fixed, out-of-scope finding**, carried to §15.16: a wire-id registration
  collision between `cell_request_charge_voltage`/`cell_request_float_voltage` and
  `cell_rcv`/`cell_rfv` in `jk_bms.js`'s `registerEntity()` calls (full detail in
  `docs/adr/0001-protocol-catalog.md` §10 and in `protocol/registers.canonical.json`'s
  `cell_rcv`/`cell_rfv` `safety_notes`).

Zero-list claims above are backed by the validator's own full-address-coverage check
(§15.2/§15.4), not asserted from memory.

## 15.10. Validator і negative tests

`test/protocol_catalog/test_negative_fixtures.js`, 38/38 PASS, 18 distinct failure classes
(each as its own file under `protocol/fixtures/negative/`):

| # | Fixture | Failure class (spec section 10) | Mechanism |
|---|---|---|---|
| 1 | `empty_registers_array.json` | missing register | JSON Schema `minItems` |
| 2 | `empty_fields_array.json` | missing logical field | JSON Schema `minItems` |
| 3 | `unknown_property.json` | unknown property forbidden by schema | JSON Schema `additionalProperties: false` |
| 4 | `duplicate_register_id.json` | duplicate register ID | `DUPLICATE_REGISTER_ID` |
| 5 | `duplicate_field_key.json` | duplicate key | `DUPLICATE_FIELD_KEY` |
| 6 | `duplicate_address_unrelated_registers.json` | duplicate address without packed/alias declaration | `DUPLICATE_ADDRESS` |
| 7 | `field_unknown_parent_register.json` | unknown parent register | `FIELD_UNKNOWN_PARENT` |
| 8 | `field_mask_mismatch.json` | invalid mask | `FIELD_MASK_MISMATCH` |
| 9 | `field_shift_mismatch.json` | invalid shift | `FIELD_SHIFT_MISMATCH` |
| 10 | `overlapping_masks.json` | overlapping masks | `OVERLAPPING_MASKS` |
| 11 | `asymmetric_packed_sibling.json` | asymmetric sibling relation | `ASYMMETRIC_PACKED_SIBLING` |
| 12 | `signedness_wire_type_mismatch.json` | signedness drift | `SIGNEDNESS_WIRE_TYPE_MISMATCH` |
| 13 | `invalid_bounds_min_gt_max.json` | invalid min/max | `INVALID_BOUNDS` |
| 14 | `unverified_field_write_enabled.json` | unverified field with write-enabled metadata | `UNVERIFIED_FIELD_WRITE_ENABLED` |
| 15 | `effective_access_exceeds_declared.json` | access/effective-access drift | `EFFECTIVE_ACCESS_EXCEEDS_DECLARED` |
| 16 | `unresolved_dynamic_dependency_write_enabled.json` | RW field without confirmed evidence for its dynamic dependency | `UNRESOLVED_DYNAMIC_DEPENDENCY_WRITE_ENABLED` |
| 17 | `packed_sibling_not_found.json` | packed sibling not found | `PACKED_SIBLING_NOT_FOUND` |
| 18 | `evidence_locator_file_missing.json` | source reference without existing document | `EVIDENCE_LOCATOR_FILE_MISSING` (run against a fake empty repo root — see the fixture generator's own comment for why) |
| — | `register_nonregister_key_collision.json` (paired doc, not counted above) | BMS register in non-register dataset | `REGISTER_NONREGISTER_KEY_COLLISION` |

Every case is proven to (a) fire the exact expected code/schema keyword and (b) produce at
least one error overall — `test_negative_fixtures.js`'s own `check()` asserts both per case.
`BASE_VALID` (the un-mutated starting fixture) is itself asserted clean before any mutation, so
a case "passing" cannot be an artifact of a broken baseline.

**Not implemented as dedicated negative fixtures** (covered instead by positive/regression
checks in `test/register_catalog/validate.js`, per §15.8/§15.9's tables, not by an adversarial
fixture file): uncovered-known-bits, endian/word-order drift, scale/offset drift,
canonical/display-unit drift, invalid step/precision, enum duplicate/reserved collision, UI
order duplicate/gap, natural cell order, entity-ID/backend-key collision, calculated/local/
browser entity in the register catalog. Each of these IS enforced (see the relevant `check()`
call in `validate.js`), just not via a standalone fixture — a scope limitation, disclosed here
rather than silently left untested.

Substring/regex-only proof is **no longer** the mechanism for anything this validator checks —
the one remaining regex-based extraction (`extractObjectLiteral` for `GENERIC_TX_ADDRESS`/
`nonRegisterKeys`) is deliberately narrow (plain hex-literal/string-literal object data, no
expressions) for the same safety reason the old validator gave for not using `eval()`, not
because it's "good enough" — it feeds into an exact key-set and address-value comparison
against the canonical source, not a presence-only substring check.

## 15.11. Детермінізм generated artifacts

- Generator version: `tools/protocol/generate.js` (no separate version number — its behavior
  IS the version; content-addressed via the hash below).
- Canonical source hash: `source_hash=2dea9c848fda1b33` (sha256 of the concatenated canonical
  JSON files, truncated to 16 hex chars, embedded in every generated artifact's header).
- Artifact hashes (sha256, this session's final run):
  - `protocol/registers.canonical.json`: `103617e9ba1c2374fe79efa3ed44d880ef9c548d6a812ecce3961d1d47c88ab9`
  - `protocol/non_register_entities.canonical.json`: `69402565c96722e680c5905f265d13efbb1101097e49a895cf83069b920ce901`
  - `register_catalog.json`: `9bfc1032b3f649401c70e9aac0ce2e328513cdffdd1b58efa95584bb19a593a9`
  - `protocol/generated/protocol_catalog.h`: `a555579e909164f9240ebf035b62d08352d3feff7e0a2add8f333f4566013e32`
  - `protocol/generated/frontend_catalog.generated.js`: `4ab86bf817eb6c0c4c2318d18368f098947ea26254c29578ea142813d8b3e921`
- **Two consecutive generations, byte-identical:** `node tools/protocol/generate.js` run twice
  in sequence; `diff` on `register_catalog.json` between the two runs → empty (no diff). Also
  proven indirectly by `--check` succeeding immediately after a normal run.
- **`--check` finds no drift:** `node tools/protocol/generate.js --check` → exit 0,
  `"no drift. All generated artifacts match the canonical source."` — run as the very last step
  before writing this audit, after all other edits in this session.
- **No timestamps or absolute paths in generated outputs:** every generated file's header uses
  `catalog_version`/`source_hash` only; `atomicWrite()` writes to a `.tmp-<pid>` file and
  `fs.renameSync`s it into place (verified by reading `tools/protocol/generate.js`'s own
  `atomicWrite` function — no partial-write path exists).
- **git tree after re-generation:** re-running the generator a third time (for this audit)
  produced **zero** further `git diff` — confirmed via `git status --short` showing the same
  file set as before the re-run.

## 15.12. Повна матриця виконаних команд

| # | Command | cwd | Tool/version | Exit | Result | What it proves / does not prove |
|---|---|---|---|---:|---|---|
| 1 | `node tools/protocol/generate.js` | repo root | Node (project's pinned runtime) | 0 | wrote 4 files + updated `jk_bms.js` | Canonical source is schema+semantically valid AND generation succeeds; does not prove firmware behavior |
| 2 | `node tools/protocol/generate.js --check` (run 3×, at different points in the session) | repo root | same | 0 (every time) | "no drift" | Determinism + no manual edits to generated files since |
| 3 | `node test/register_catalog/validate.js` | repo root | same | 0 | 194 checks, 0 failed | Schema, semantic, cross-file (YAML/JS/mock), UI-order, unit-glossary, 2 regressions, full-address-coverage — does not prove hardware correctness |
| 4 | `node test/protocol_catalog/test_packed_codec.js` | repo root | same | 0 | 16 checks, 0 failed | Packed-register metadata is internally consistent for boundary/negative/round-trip cases — does not prove the real BMS decodes bytes the same way |
| 5 | `node test/protocol_catalog/test_negative_fixtures.js --write-fixtures` | repo root | same | 0 | 38 checks, 0 failed | Validator's failure paths actually fire, with the right reason — see §15.10 for what is/isn't covered |
| 6 | `node --check jk_bms.js` | repo root | same | 0 | syntax OK | Parses; does not prove runtime correctness |
| 7 | `node --check demo/mock-server.js`, `demo/panel.js` | repo root | same | 0 each | syntax OK | Same caveat |
| 8 | `TEST_PORT=<free port> bash test/run_all.sh` (run twice: once mid-work at port 18999/18998, once final at 18997) | repo root | bash, g++ (Xcode clang), Node | 0 (both times) | `46 + 94 + 194 + 16 + 38 + 57 = 445` checks, 0 failed, `"All suites passed."` | Full existing + new suite, no regression from the pre-Stage-1 615-check baseline's non-catalog portions (46+94+57=197, unchanged) |
| 9 | `esphome config batterylifepo4.yaml` | repo root | ESPHome 2026.8.2 | 0 | `"Configuration is valid!"` | YAML is well-formed and every entity resolves — does not prove wire behavior |
| 10 | `esphome compile batterylifepo4.yaml` | repo root | ESPHome 2026.8.2, ESP-IDF 5.5.5 | 0 | SUCCESS — see §15.13 | Compiles for the real target; does not prove runtime/hardware behavior (no hardware writes performed this stage, per spec section 4) |
| 11 | `g++ -std=c++17 -Wall -Wextra -fsyntax-only protocol/generated/protocol_catalog.h` | repo root | Xcode clang (g++ alias) | 0 | "syntax OK" | The unwired C++ metadata header is valid C++17 — does not prove it is wired in (it deliberately isn't, §15.13) |
| 12 | `git diff --check` | repo root | git | 0 | no output (clean) | No whitespace-only errors in the diff |
| 13 | heuristic secret scan over every changed/untracked file (grep for generic credential-shaped patterns plus the specific fragments from the one real credential disclosed earlier this project, filtered) | repo root | grep | — | no real secret matches (only `!secret` YAML refs, doc prose, and field-type mentions) | Not a substitute for a dedicated secret-scanning tool; a targeted heuristic pass only |
| 14 | `git status --short` (before/after every write) | repo root | git | — | tracked the exact file set at every step | Confirms no unrelated files were touched, no destructive operation occurred |
| 15 | Live browser verification (demo, `localhost:8321`, real `jk_bms.js`/`mock-server.js` served fresh from disk) | — | Browser pane | — | Cells-tab card shows "мОм" (not "Ω"); Settings/Diagnostics tabs render with no console errors; 0 error-level console logs | Demo-level UI proof only — no real hardware browser session was run this stage (that remains Stage 15 scope) |

## 15.13. Build і resource impact

- `esphome config`: **Valid** (command 9 above).
- `esphome compile`: **SUCCESS** (command 10). Full comparison:

  | Metric | Before (baseline, this session's re-verification of `FINAL_READINESS_REPORT.md` §0/§3) | After (Stage 1, this session) | Delta |
  |---|---:|---:|---:|
  | RAM | 51.0% (92160 / 180736 B) | 51.0% (92160 / 180736 B) | **0 bytes** |
  | Flash | 60.7% (1113895 / 1835008 B) | 60.9% (1117083 / 1835008 B) | **+3188 bytes (+0.17 pp)** |
  | config_hash | `0xc0614563` | `0x8326d398` | Changed — expected: 16 `unit_of_measurement` string literals changed (`"Ω"`→`"mΩ"`) |
  | Warnings | 1 (pre-existing, `modbus_controller__total_runtime__pstorage` `-Waddress` false-positive on a pointer-that-is-never-NULL pattern) | 1 (same warning, same line `batterylifepo4.yaml:4492`) | **0 new warnings** |

  RAM is byte-for-byte unchanged — expected, since Stage 1 touched only `.rodata` string
  literals (unit labels), never any global/struct layout. The small Flash increase is fully
  accounted for by those same longer string literals plus their downstream code-gen; it is not
  the C++ metadata header (`protocol_catalog.h`, ~7 KB source) or any generated code, because
  that header is **not** `#include`d anywhere — verified by `grep -rn "protocol_catalog.h" batterylifepo4.yaml
  components/` returning no match, and independently by RAM being identical (a real
  `constexpr` table of 123 entries would show up in `.rodata`/Flash at minimum, and this one
  provably does not, since it is never compiled into this binary at all).
- No new runtime JSON parser was added — `register_catalog.json` is read only by Node tooling
  (`demo/mock-server.js`, the validator, the generator itself), never by the firmware.

## 15.14. Safety і security audit

- **No hardware writes performed.** Confirmed by: no `Bash`/browser tool call in this session
  targeted `jk-bms.local` or any real device; `esphome compile` produces a `.bin` that was never
  flashed (no `esphome upload`/`run` command was issued); the only device-adjacent evidence used
  (`HARDWARE_AUDIT_2026-09-09.md`) predates this session and was read, not re-executed.
- **No secret leakage.** `secrets.yaml` remains gitignored (`git check-ignore -v secrets.yaml` →
  matched); the heuristic secret scan (§15.12 #13) found no credential-shaped strings in any
  changed or new file; no credentials were ever printed to a log this session touches.
- **Write-capability changes:** four fields (`dry_contact_1_trigger_value`,
  `dry_contact_1_recovery_value`, `dry_contact_2_trigger_value`,
  `dry_contact_2_recovery_value`) had their catalog `effective_access` **lowered** from the
  naive `rw` (matching declared access) to `r`, per the spec's own hard rule for an unresolved
  dynamic dependency. This is a metadata-only, forward-looking policy signal — `GENERIC_TX_ADDRESS`
  (what the live firmware actually services) is unchanged and still lists these four addresses,
  by deliberate design (`docs/adr/0001-protocol-catalog.md` §5) — Stage 1 is not permitted to
  change wire write behavior, and did not.
- **Transaction behavior unchanged.** `jk_write_tx_core.h` was not modified; `components/jk_write_tx/`
  has zero diff; the 46 `jk_write_tx_core` unit tests and 57 topology/write-transaction
  integration tests (including the full generic-write and CellCount matrices) pass unchanged.
- **Residual safety risks carried to Stage 2–8:**
  1. Four dry-contact value/recovery fields remain writable in the live firmware today with an
     unverified unit interpretation — a real, pre-existing risk this stage did not introduce but
     also could not eliminate without changing wire behavior (out of scope). Stage 2+'s
     transaction core is expected to consult `effective_access` and either resolve the enum
     table or gate these writes for real.
  2. `0x111C`/`0x14E4`/`0x14E6` remain writable based on two non-tier-1/2 sources; a future stage
     with access to official documentation or a safe hardware test rig should re-verify.
  3. The `cell_rcv`/`cell_request_charge_voltage` wire-id collision (§15.9) is a live frontend
     bug, unrelated to write safety directly but worth fixing before it causes a stale-display
     confusion during a future stage's UI work.

## 15.15. Матриця 20 критеріїв завершення

| № | PASS/FAIL/BLOCKED | Доказ | Команда/файл | Залишковий ризик |
|---|---|---|---|---|
| 1. 100% BMS YAML entities mapped or excluded | PASS | Full-address-coverage check | `validate.js` check "every address: 0xNNNN..." | None found |
| 2. 100% catalog fields have physical parent + source evidence | PASS | Schema `required: evidence`, semantic `FIELD_UNKNOWN_PARENT` | schema + `semantic-checks.js` | None |
| 3. 100% confirmed R/RW fields present | **PASS with caveat** | 118/123 `confirmed_multiple_sources`, 0 `confirmed_official` (no tier-1 source exists in this environment) | §15.6 | "Confirmed" here means tier-3/4 corroboration, never manufacturer-grade |
| 4. Read-only registers no longer missing as a class | PASS | 77 R fields, up from 0 | `register_catalog.json` | None |
| 5. Non-register fields physically separated | PASS | Separate file+schema, 0 key collisions | `REGISTER_NONREGISTER_KEY_COLLISION` check, 0 hits | None |
| 6. No duplicate keys/collisions/overlapping masks | PASS | 0 semantic errors on the real catalog | `semantic.check()` → `[]` | None |
| 7. 4 mandatory packed registers have full evidentiary matrix; unverified parts blocked | PASS | §15.7; enum semantics genuinely unresolved and correctly NOT modeled as if known | packed codec tests, `dynamic_dependency` | Enum meaning of trigger-source codes still unknown |
| 8. `scp_delay`/`rcv_time`/`rfv_time` unit drift fixed | PASS | 3 regression tests | `validate.js` REGRESSION checks | None |
| 9. LCD/DRY dynamic metadata data-driven; unknown mapping blocks editor | PASS | 4 fields correctly downgraded | `dynamic_dependency.resolved: false` | Depends on #7's residual risk |
| 10. Access/effective-access/safety-class consistent; unverified never write-enabled | PASS | `UNVERIFIED_FIELD_WRITE_ENABLED`/`EFFECTIVE_ACCESS_EXCEEDS_DECLARED`, 0 hits on real data | `semantic-checks.js` | None |
| 11. Canonical source passes schema + semantic validation | PASS | 0 errors | `validate.js` checks 1–2 | None |
| 12. All negative fixtures fail with correct reason/location | PASS | 38/38, 18 classes | `test_negative_fixtures.js` | 10 failure classes covered by positive checks, not dedicated fixtures (§15.10) |
| 13. Generator outputs deterministic; `--check` finds no drift | PASS | 2 consecutive runs byte-identical; `--check` exit 0 ×3 | §15.11 | None |
| 14. C++/ESPHome/frontend/mock share ONE canonical source | **BLOCKED (partial)** | C++/frontend/mock: yes, generated or generation-consuming. **ESPHome YAML register geometry itself is hand-authored, not generated** — cross-validated (address + `id:` presence) against the canonical source, not derived from it | `docs/adr/0001-protocol-catalog.md` §11 (ADR requirement acknowledged) | A hand-edit to `batterylifepo4.yaml` that changes a register's address/scale would only be caught by the next `validate.js` run, not prevented at generation time |
| 15. Cell voltage/resistance natural 01..16 order | PASS | Dedicated check | `validate.js` "*_wire_resistance* fields sort into natural 01..N order" | None |
| 16. Full suite passes, no hidden mandatory SKIP | PASS | 445/445, 0 failed, 0 skipped | §15.12 #8 | None |
| 17. ESPHome config + production-version compile pass | PASS | §15.12 #9–10, §15.13 | compile log | None |
| 18. No new secrets, no write-behavior change, no unrelated regression | PASS | §15.14; `GENERIC_TX_ADDRESS` byte-identical key/address set; 0 changes to `jk_write_tx_core.h`/topology resolver | §15.12, §15.14 | None |
| 19. Documentation describes real files/commands/scope/uncertainty | PASS | This document + ADR | — | None |
| 20. `git diff --check` clean; full diff manually reviewed for stray changes | PASS | Exit 0; diff limited to the files in §15.3's table, each with a stated reason | §15.12 #12 | None |

**17/20 unqualified PASS, 2 PASS-with-caveat (3, and implicitly 7/9 via the same enum gap),
1 BLOCKED (14, partial).** Per spec section 14's own rule ("Якщо хоча б один критерій не
доведено, статус повинен бути НЕ ГОТОВО або ЧАСТКОВО ВИКОНАНО"), criterion 14's genuine partial
block is what keeps this stage from `ГОТОВО`.

## 15.16. Відкриті питання та наступний безпечний крок

| ID | Невідоме | Чому не вирішено | Ризик | Що потрібно | Блокує Етап 1? | Заборонена дія до вирішення |
|---|---|---|---|---|---|---|
| OQ-1 | Official JK protocol documentation for the JK-PB2A16S15P (or a compatible model) | Not available anywhere in this environment; no network access to a manufacturer document repository was possible/appropriate | Every field in this catalog tops out at tier-3 corroboration | Obtain the actual manufacturer register-map document, or a logged, methodology-documented hardware capture session (tier 2) | Blocks reaching `confirmed_official`/full evidentiary certainty, but does not block Stage 1's own deliverables | Do not upgrade any field's `verification_status` to `confirmed_official` without a real tier-1 document in hand |
| OQ-2 | Physical meaning of `dry_contact_1/2_trigger_source` values 0–12 | No source (implementation, workbook, or upstream) documents the enum | The 4 dependent value/recovery fields cannot get a real unit/range | A JK app capture, official doc, or systematic hardware test correlating each source code with an observed physical effect | No — correctly downgraded (`conflict`/`r`) rather than blocking | Do not set these 4 fields' `effective_access` back to `rw` without a resolved `dynamic_dependency` |
| OQ-3 | Cross-model/firmware applicability of `0x111C`/`0x14E4`/`0x14E6` beyond the one deployed unit | Only one real device was ever observed (this project's own); "undocumented" per the project's own YAML comment | A different JK-PB firmware/model could use these bytes differently | Test against a second unit/firmware version, or find the document that defines them | No | Do not assume portability to other JK-PB units without re-verification |
| OQ-4 | `alternate_battery_voltage`/`0x12E4`'s correctness | Single-source (implementation only); absent from both external sources checked | Low — read-only, presentation-only field | Corroborate via workbook/upstream/official source | No | None beyond keeping it `implemented_unverified` |
| OQ-5 | `cell_request_charge_voltage`/`cell_rcv` wire-id registration collision in `jk_bms.js` | Genuine pre-existing frontend bug, found during this audit's registerEntity() cross-check, outside Stage 1's frontend-lifecycle boundary | The `cell_request_charge_voltage` state key may never receive live updates via that specific alias | A dedicated frontend session should either remove the duplicate registration or rename one side | No — documented, not silently left undiscovered | Do not "fix" this inside a future catalog-only change without also re-running the full E2E/topology suite |
| OQ-6 | `batterylifepo4.yaml` register geometry is not literally generated from the canonical source | Full YAML generation was judged too disruptive for Stage 1's "don't rebuild anything" boundary (ADR §11) | A future hand-edit to the YAML could silently drift from the canonical source between `validate.js` runs | Either accept the cross-validation model permanently, or build a structured YAML-fragment generator in a stage explicitly scoped for it | **Yes — this is criterion 14's partial block** | Do not claim Stage 1 `ГОТОВО` while this gap is open |

**Stage 2 prerequisites check:** Stage 2 (`Архітектурний контракт транзакцій і даних`) needs a
stable, versioned field-level contract (address/mask/access/safety-class) to design its
`POST /api/v1/bms/writes` payload schema against. That contract exists now
(`protocol/registers.canonical.json`, `catalog_version: "1.0.0"`) and is stable under
`generate.js --check`. Stage 2 is **not started** by this work, per its own explicit boundary.

## 15.17. Остаточний висновок

**Етап 1: ЧАСТКОВО ВИКОНАНО.**

17 of 20 completion criteria are unqualified PASS with reproducible evidence; criterion 3 PASSes
only at tier-3/4 evidentiary strength (no tier-1 source was available in this environment, a
structural limitation, not a shortcut); criterion 14 is genuinely BLOCKED in part
(`batterylifepo4.yaml`'s own register geometry remains hand-authored and cross-validated, not
generated — an explicit, ADR-recorded Stage-1 scope decision, since full YAML generation would
have required exactly the kind of build/behavior change Stage 1 is barred from making). 445/445
automated checks pass (194 catalog validator + 16 packed-codec + 38 negative-fixture + 46
`jk_write_tx_core` + 94 `jk_history_format` + 57 topology/write-transaction), zero regressions
against the pre-existing suite, `esphome config`/`compile` both succeed against the user's real
ESPHome 2026.8.2 with RAM unchanged and a 0.17-percentage-point Flash increase fully attributable
to two disclosed, deliberate unit-label string fixes. No hardware write was performed at any
point. Two real, previously-undiscovered bugs (cell-resistance unit mislabeling, a
`NON_REGISTER_ENTITY_IDS` leak) were found and fixed as a direct, minimal consequence of building
this catalog; one more (a `jk_bms.js` wire-id registration collision) was found and deliberately
left unfixed, with its exact location and reasoning recorded, because fixing it falls outside
this stage's frontend-lifecycle boundary. Stages 2–16 are not started.
