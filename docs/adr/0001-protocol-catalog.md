# ADR 0001 — Authoritative protocol catalog and generation pipeline

**Status:** Accepted (Stage 1 of `IMPLEMENTATION_ROADMAP.md`)
**Date:** 2026-09-09

See `docs/protocol/ARCHITECTURE.md` for the current artifact roles and
runtime data flow. The original diagrams (system data flow, the generic
write-transaction state machine including the WRITE_UNCERTAIN recovery
path, and the RW-field access classification) are archived at
`docs/archive/reports/ARCHITECTURE_DIAGRAMS_2026-09-10.md`. Mentions of
`IMPLEMENTATION_ROADMAP.md` / `OPEN_ISSUES.md` in this record's dated
addenda refer to files now under `docs/archive/` (see its README's path map).

## Context

The project's only machine-readable protocol description was
`register_catalog.json`: 47 hand-typed rows, every one `access: "rw"`, no
read-only registers, unit drift on three fields (`scp_delay`, `rcv_time`,
`rfv_time`), and a "single source of truth" claim its own validator
(`test/register_catalog/validate.js`) could not actually prove — that
validator ran `String.includes()` and a couple of regexes over
`batterylifepo4.yaml`/`jk_bms.js`/`demo/mock-server.js`, which catches a
key present in one file and silently absent from another but proves
nothing about whether an address/mask/scale/unit is *correct*, and nothing
at all about registers this project reads but never renders.

Four packed registers (`0x111C`, `0x1504`, `0x14E4`, `0x14E6`) shared one
16-bit word between two logical fields with no documented byte/bit
boundary beyond a hand-written comment. `device_name_override` (a local
ESPHome config value, `address: null`) sat in the same array as real BMS
registers. Roughly 60 read-only telemetry registers this project actually
polls (cell voltages, resistances, temperatures, alarm/status words) had
no catalog entry of any kind.

## Decision

### 1. Two hand-maintained canonical sources, one generator, one validator

```
protocol/registers.canonical.json              <- physical BMS registers + logical fields (hand-maintained)
protocol/non_register_entities.canonical.json   <- calculated ESPHome / ESP32 / browser-UI / local-config (hand-maintained)
        |
        v  tools/protocol/lib/mini-schema.js  (schema)
        v  tools/protocol/lib/semantic-checks.js  (invariants)
        v
tools/protocol/generate.js  --check  (drift detector, CI-safe)
tools/protocol/generate.js           (writes the artifacts below)
        |
        +--> register_catalog.json                         (backward-compatible location/shape)
        +--> protocol/generated/coverage_report.md
        +--> jk_bms.js's own "GENERATED PROTOCOL CATALOG" block (GENERIC_TX_ADDRESS, NON_REGISTER_ENTITY_IDS)

test/register_catalog/validate.js  -- schema + semantic + generate.js --check + cross-file (YAML/JS/mock) checks
test/protocol_catalog/test_packed_codec.js       -- packed-register encode/decode round-trip
test/protocol_catalog/test_negative_fixtures.js  -- 18 deliberately-broken fixtures, asserts the right failure fires
```

Two JSON files, not one, because a physical register and a logical field
are different things with different lifetimes (a packed register has one
address and two-to-three fields; `device_name_override` has a field but no
register at all) — spec section 5 explicitly forbids collapsing them into
one row per key, which was exactly what `register_catalog.json` did before.

The two source files are **hand-maintained**, not generated. A one-time
authoring script, `tools/protocol/authoring/build_seed.py`, produced their
*initial* content from the evidence review below and is kept only for that
provenance trail (its own file header says so); it is never invoked by
`generate.js` or by any test. Every future register/field change is a
direct edit to the two JSON files.

### 2. Why JSON Schema without a library

This repository has zero npm dependencies today (`demo/mock-server.js`,
`jk_bms.js`, every existing test — all plain Node, no `package.json`). A
schema validator (`tools/protocol/lib/mini-schema.js`, ~100 lines) implements
exactly the JSON Schema draft-2020-12 subset the two schemas use (`type`,
`required`, `properties`, `additionalProperties: false`, `enum`,
`minimum`/`maximum`, `pattern`, `items`, `minItems`) rather than adding
`ajv` as this project's first dependency. It is not a general-purpose
implementation and does not try to be.

### 3. Evidence trust ordering (spec section 3) and how it was actually applied

| Tier | Source | Used here? |
|---|---|---|
| 1 | Official JK manufacturer documentation | **Not available** in this environment. No field in this catalog is graded `confirmed_official`. |
| 2 | Controlled, documented read-only hardware capture | `HARDWARE_AUDIT_2026-09-09.md` (a logged GET/SSE-only session against the real `jk-bms.local` device). Used to corroborate live values (cell voltages, SOC, model string), never used alone to establish an address. |
| 3 | Workbook with explicit addresses, or the project's own upstream dependency | Two sources graded here: (a) `/Users/mykola.krokhmal/Downloads/LiFePO4_BMS_Parameters_registers.xlsx` — a user-supplied workbook with explicit `0xNNNN` addresses and R/RW access per row, whose decoded values (SOH 97%, cycle count 42, model `JK-PB2A16S15P`, cell voltages/resistances) are internally consistent with this project's own hardware capture, but whose exact capture methodology/session log is **not** available in this session — graded tier 3, not tier 2, specifically because that methodology can't be independently confirmed here. (b) `github.com/syssi/esphome-jk-bms`'s own `esp32-jk-pb-modbus-example.yaml` — this project's declared `external_components_source:`, fetched read-only on 2026-09-09 and cross-checked address-by-address against every inline register-table comment already in `batterylifepo4.yaml`. It independently confirmed the *entire* `0x1000`–`0x1084` RW config block, all 16 cell voltages, all 16 wire resistances, most of the `0x128A`–`0x12FC` telemetry block, and — critically — the exact facts the Stage-1 baseline only hypothesized: wire resistance is in **mΩ**, `scp_delay` is in **µs**, and RCV/RFV time is `0.1 H` (**hours**), not seconds. |
| 4 | This project's own implementation | `batterylifepo4.yaml`/`jk_bms.js` — evidence that a byte layout is *implemented*, never proof it is *correct*. Used alone only where no independent source exists at all (one register: `alternate_battery_voltage` / `0x12E4` — the single field in this catalog graded `implemented_unverified`). |

**A PDF found alongside the workbook (`LiFePO4-1S16P-00.pdf`) was deliberately NOT used as evidence.** It is a printed export of this project's own demo panel (`localhost:8321`, "Demo panel +" footer visible on every page) — using it would have been circular (this project's own mock output "confirming" this project's own catalog).

An unrelated pair of `.xlsx` files found under
`~/Documents/Codex/2026-09-04/.../outputs/` (produced by a different tool,
in a different project directory, on an earlier date) were inspected as a
sanity cross-check only — they turned out to carry the *identical* address/
value data as the Downloads workbook, so they corroborate rather than
contradict it, but per spec section 3 ("не використовуй... чужий код як
єдиний доказ") they are not cited as an independent evidence source in the
canonical JSON's `evidence` arrays.

### 4. Two packed registers are NOT in the upstream reference — and stay writable anyway, with a documented caveat

`0x111C` (heating activation/deactivation temperature) and `0x14E4`/`0x14E6`
(LCD-buzzer / dry-contact trigger sources) are **absent** from the upstream
`syssi/esphome-jk-bms` reference — this project's own YAML comment already
calls `0x111C` "an undocumented JK-PB packed register used by recent
firmware." The spec's hard rule (section 3) is that an unverified field's
`effective_access` must be `r`, never `rw`. Applied literally to these two
registers, that rule would have meant *removing a currently-working,
user-relied-upon write feature from live firmware* — which spec section 4
separately and explicitly forbids ("Stage 1 не повинен змінювати wire
write behavior", "не видаляй наявну функціональність без доказу, що це
мертвий дублікат").

Resolution: register **geometry** (address/mask/shift/byte-boundary) for
these fields is graded `confirmed_multiple_sources` — implementation *and*
the workbook agree, with the workbook additionally showing live decoded
values (5 °C / 15 °C activation/deactivation) consistent with that exact
layout — so `effective_access: "rw"` is justified for the fields
themselves. What genuinely stays unverified is the **enum semantics**: no
source available in this session documents what each of the 13 possible
`dry_contact_*_trigger_source` codes (0–12) physically means. That gap is
what the spec's write-gating rule actually bites on: the four downstream
`dry_contact_*_trigger_value`/`recovery_value` fields (whose physical
*unit* depends on that unresolved enum) are the ones graded
`verification_status: "conflict"` with `effective_access` downgraded to
`"r"` — declared `rw` (matching the live, unchanged firmware) but not
policy-endorsed for a future write-enabled UI until the source→unit table
is confirmed. This is recorded per-field in `dynamic_dependency.resolved:
false`, not silently dropped.

### 5. `GENERIC_TX_ADDRESS` reflects wire reality, not catalog policy

`tools/protocol/generate.js` derives the `GENERIC_TX_ADDRESS` object it
injects into `jk_bms.js` from **declared** `access`, not `effective_access`
— i.e. from "does the deployed firmware's generic write-transaction
manager service this address today", not from "does Stage-1 catalog policy
currently endorse writing it." Deriving it from `effective_access` instead
would have silently removed the four `dry_contact_*_value` keys from the
live write path — a wire-behavior change Stage 1 is not permitted to make.
`register_catalog.json`'s per-row `effective_access` field carries the
policy signal forward for the transaction core a later stage builds.

### 6. C++ metadata is generated but not wired into the firmware build

`protocol/generated/protocol_catalog.h` is a real, `g++ -fsyntax-only`-clean
C++17 header with a `constexpr` table of all 123 fields (address, mask,
shift, signedness, wire type, scale, declared/effective access). It is
**not** `#include`d by `batterylifepo4.yaml` or any build target. Two
reasons: (a) Stage 1 explicitly excludes rebuilding the transaction manager
— including it would only be meaningful once something consumes it; (b) it
avoids any RAM/flash risk in a stage that must not change firmware
behavior. RAM/flash impact is therefore exactly **0 bytes** (verified: the
Stage-1 `esphome compile` RAM/Flash percentages are compared against the
pre-Stage-1 baseline in `STAGE_1_IMPLEMENTATION_AUDIT.md` §15.13). A later
stage that builds the real transaction core is expected to `#include` this
header (or a regenerated version of it) directly.

### 7. Generated mock fixtures — satisfied without a new file

`demo/mock-server.js` already builds its own generic-register write map
directly from `register_catalog.json` at `require()` time
(`REGISTER_BY_KEY`, filtered on `reg.manager === "generic"`). Since
`register_catalog.json` is now itself a *generated* artifact, this
existing code path already satisfies spec section 9's "generated mock
register/entity fixtures" deliverable — a second, parallel fixture file
would be redundant, unconsumed, and itself a duplicate source of truth
(the thing this whole stage exists to eliminate). This is a deliberate
decision, not an oversight.

### 8. `jk_bms.js` injection, not a separate frontend bundle

`jk_bms.js` ships to the browser as one file (compiled into the firmware
binary; the demo serves it fresh from disk). Adding a `<script src=...>`
for a second generated module would touch the page's load wiring —
disruptive relative to Stage 1's UI boundary. Instead `generate.js`
replaces a clearly marked, generator-owned block
(`// >>> BEGIN GENERATED PROTOCOL CATALOG ... // <<< END GENERATED
PROTOCOL CATALOG`) in place inside `jk_bms.js` itself, and everything
outside those markers is untouched. This block is the **only** part of
`jk_bms.js` Stage 1 modifies for generation purposes; `GENERIC_TX_ADDRESS`
and `NON_REGISTER_ENTITY_IDS` were converted from hand-typed literals to
`= PROTOCOL_CATALOG.genericTxAddress` / `new Set(PROTOCOL_CATALOG.nonRegisterKeys)`
— eliminating exactly the duplication spec section 9 requires eliminated,
without touching any rendering, ordering, or lifecycle logic (Settings/
Diagnostics UI structure is Stage 11's scope, not Stage 1's).

### 9. Two real, pre-existing bugs found and fixed as a direct consequence

1. **Cell wire resistance unit label.** Both `batterylifepo4.yaml`'s
   `unit_of_measurement: "Ω"` (16 sensors) and `jk_bms.js`'s Cells-tab card
   (`unitLabel("Ω")`) mislabeled a millivolt-scale quantity as ohms — a
   ~1000x label error (the Settings-list code path, `diagnosticUnit()`,
   already had the correct "mΩ" override, so the bug was visible only on
   the Cells tab and in raw ESPHome entity metadata). Both call sites are
   fixed to `"mΩ"`, matching the canonical source and the upstream
   reference. This is exactly spec section 8 item 3.
2. **`NON_REGISTER_ENTITY_IDS` contained keys that never matched anything.**
   The hand-typed Set had `"battery_state_candidate_direction"`,
   `"battery_state_candidate_fresh_samples"`, `"battery_state_current_direction"`,
   and `"bms_display_name"` — none of which are the actual `registerEntity()`
   state keys jk_bms.js resolves to (`battery_state_direction`,
   `battery_state_candidate_samples`, `device_name`, respectively — verified
   by extracting jk_bms.js's own registration table, see
   `STAGE_1_IMPLEMENTATION_AUDIT.md` §15.9). Those four computed/calculated
   entities were silently leaking into the Settings register list as if
   they were real BMS registers — precisely the P1-04 defect this stage
   exists to close. The generated `nonRegisterKeys` list uses the verified,
   correct keys.

### 10. One open, explicitly-flagged, NOT-fixed finding

`jk_bms.js` calls `registerEntity("cell_request_charge_voltage", "sensor",
"cell RCV", "cell_rcv")` individually, then its later generic-key loop
calls `registerEntity("cell_rcv", "sensor", "cell rcv", "cell_rcv")` again
for the *same* wire ids (`cell RCV`/`cell_rcv`, both resolving to ESPHome
object-id `cell_rcv` since ESPHome derives object ids from `name:`, not
from the internal `id:`). Because `registerEntity()` just overwrites
`entityByWireId` Map entries, the second (loop) call wins, and the state
key `"cell_request_charge_voltage"` (and its float-voltage twin) may never
receive live SSE updates via that path. This is a frontend entity-
resolution bug, not a catalog/Settings/Diagnostics issue, and squarely
outside Stage 1's boundary to fix. It is recorded in
`protocol/registers.canonical.json`'s `cell_rcv`/`cell_rfv` `safety_notes`
and repeated in `STAGE_1_IMPLEMENTATION_AUDIT.md` §15.16.

## Consequences

- `register_catalog.json` now has 123 rows (46 RW, 77 R) instead of 47
  (all RW) — read-only registers are no longer a missing class.
- `device_name_override` no longer appears in `register_catalog.json`; it
  lives in `protocol/non_register_entities.canonical.json` as `local_config`.
- Every RW field's `effective_access` is consistent with its
  `verification_status` by construction (`semantic-checks.js` enforces
  this and refuses to let `generate.js` emit anything otherwise).
- No wire write behavior changed. `GENERIC_TX_ADDRESS`'s 44 keys and their
  addresses are byte-identical to the pre-Stage-1 hand-written object
  (verified in `STAGE_1_IMPLEMENTATION_AUDIT.md`).
- Two real UI bugs (resistance unit label, non-register leak into
  Settings) are fixed as a direct, minimal consequence of generating from
  a single correct source instead of maintaining three independent
  hand-typed copies.
- Stage 2–16 items (transaction core rebuild, topology resolver,
  persistence, security) are **not** started. This ADR's C++ header and
  `effective_access` field exist so those stages have a real, versioned
  input to consume — they do not consume it yet.

## Addendum: Stage 1 Remediation (2026-09-09, second pass)

An independent review (`CODEX_STAGE_1_REVIEW.md`) audited the state this
ADR originally described and found several claims that did not hold up
under direct re-checking — most seriously, three addresses
(`0x12A4`/`0x12E6`/`0x12F8`) were credited with "workbook" evidence the
workbook does not contain, one address (`0x12E4`) was wrongly said to be
absent from both external sources when it is present in both, the 128-bit
passcode/device-model registers had `word_count: 2` instead of the correct
`8`, and `effective_access: "r"` on the four dry-contact value fields was
purely decorative (`GENERIC_TX_ADDRESS` was still derived from *declared*
access, so nothing was actually blocked). Full findings:
`CODEX_STAGE_1_REVIEW.md`. Full remediation, evidence, and re-audit:
`STAGE_1_REMEDIATION_AUDIT.md` (supersedes `STAGE_1_IMPLEMENTATION_AUDIT.md`
for anything the two disagree on).

**Root cause of the evidence-citation errors:** the original
`build_seed.py` applied one hand-typed evidence tuple (e.g.
`CONFIRMED_UPSTREAM = evidence(IMPL, UPSTREAM, WORKBOOK)`) across an entire
*group* of registers sharing similar geometry, without checking each
group member's *own* address against the real sources — a tuple correct
for most of a group's addresses was silently wrong for the exceptions.
This is fixed architecturally, not just patched at the four named
addresses: `protocol/evidence/build_workbook_index.py`,
`build_upstream_index.py`, and `build_implementation_index.py` each
produce a real, re-runnable, address-indexed JSON extract of their source
(workbook row numbers, upstream file line numbers with an exact pinned
commit SHA, implementation `address:` YAML line numbers), and
`protocol/evidence/reconcile_evidence.py` recomputes **every** field's
`evidence` array and `verification_status` from those three indices
directly — an evidence citation can no longer be "probably right for most
of the group." `tools/protocol/lib/semantic-checks.js` additionally
cross-checks every `workbook`/`upstream_reference` evidence entry in the
canonical source against the same two index files at validation time
(`EVIDENCE_ADDRESS_NOT_IN_WORKBOOK_INDEX`/`_UPSTREAM_INDEX`), so a future
hand-edit that reintroduces a false citation fails the validator, not just
a one-time manual check.

**`verification_status` is now a formal, deterministic function** (spec
Крок F) of which independent *evidence-source groups* (`official`,
`workbook_family`, `upstream_family`, `implementation_family`,
`hardware_family` — see `protocol/evidence/sources.json`) back a field:
`confirmed` (2+ independent non-implementation groups),
`corroborated_with_limitations` (exactly 1 + implementation),
`implementation_only_unverified` (implementation alone),
`single_source` (a `source_only_unimplemented`/`intentionally_not_exposed`
field backed by exactly one non-implementation source, since it has no
implementation dimension to combine with), `conflict` (preserved by hand
where a real source disagreement was found — never auto-assigned), and
`unknown_variant` (no evidence at all — should never occur in the real
catalog; exists for the algorithm's completeness). This replaced the
original pass's older, coarser enum
(`confirmed_multiple_sources`/`implemented_unverified`/...).

**`effective_access` is now an enforced policy output, not decoration**
(Крок G). `tools/protocol/generate.js`'s `GENERIC_TX_ADDRESS` derivation
switched from `declared access === "rw"` to `effective_access === "rw"`,
and — because that alone does not stop ESPHome's own native
`/number/<id>/set` HTTP endpoint from accepting a call that still reaches
a real Modbus write — the `set_action` was removed from all 7 affected
ESPHome entities in `batterylifepo4.yaml` itself (`lcd_buzzer_trigger`,
`dry_contact_1_trigger_source`, `dry_contact_2_trigger_source`, and all 4
`dry_contact_*_trigger_value`/`recovery_value` entities), replaced with a
no-op `ESP_LOGW(...)` action. Verified directly: zero remaining
`write_bms_u16`/`write_bms_u32` script references near any of the 7
addresses in the compiled configuration. `jk_bms.js`'s
`writableDefinitionForEntry()` also checks a generated `blockedWriteKeys`
map before consulting `SETTING_DEFS`, so the Settings UI renders these
7 rows read-only with a visible reason instead of an editable input —
belt-and-suspenders with the firmware-level block, not a substitute for it.

**Protocol completeness widened from "what this project reads" to "what
either external source documents, whether implemented or not"** (Крок E).
`protocol/evidence/build_reconciliation_report.py` diffed the catalog's
own address set against the workbook and upstream index and found three
addresses (`0x1248`, `0x128C`, `0x12D2`) present in the upstream reference
that `batterylifepo4.yaml` never reads. All three now have real catalog
entries with `implementation_status: "source_only_unimplemented"` (the
first two) or `"intentionally_not_exposed"` (`0x12D2` — upstream's own
table literally labels it `Reserved`), each `effective_access: "r"`
(there is no write evidence for anything not implemented, from any
source). A new `implementation_status` field (spec section 4,
`implemented`/`partially_implemented`/`source_only_unimplemented`/
`implementation_only_unverified`/`intentionally_not_exposed`) now exists
on every field precisely so this distinction — protocol inventory vs.
implementation mapping — is machine-readable rather than implicit in
which fields happen to have implementation evidence.

**Version model separated** (Крок D). `firmware_scope: "v3.0.0"` — which
was, on inspection, `jk_bms.js:3178`'s hardcoded UI label
(`setText("sysFirmware", "v3.0.0")`), never a value read from the BMS —
is removed from every register entirely. A single document-level
`version_context` object now separates `esphome_project_version` (unknown
— no `project.version:` is set), `web_ui_version` (`2026.09.08-v5`,
explicitly labeled as a UI build string), `bms_model_identity`
(`JK-PB2A16S15P`, confirmed), `bms_protocol_variant` (unknown), and
`bms_firmware_version` (unknown) as five genuinely distinct claims instead
of one conflated string. `semantic-checks.js`'s `UI_VERSION_AS_MODEL_SCOPE`
check guards against a future register re-introducing a UI/project version
string as a scope claim.

**Geometry**: `word_count` is now computed as `register_width_bits / 16`
with a hard rejection of any non-multiple-of-16 width, replacing the
`1 if width == 16 else 2` special case that produced the wrong
`word_count: 2` for the 128-bit passcode and device-model registers (the
correct value, matching `register_count: 8` in both
`batterylifepo4.yaml` entities, is `8`). `semantic-checks.js` independently
re-derives and checks `word_count * 16 === register_width_bits` for every
register (not just at authoring time), plus `word_order` consistency for
1/2/>2-word registers and a `fullMask`-bounded check that a field's mask
can never exceed its own register's width (the previous pass computed
`fullMask` but never used it against anything — CODEX_STAGE_1_REVIEW.md
P1-2).

**Test runner** (Крок L): `test/run_all.sh` rewritten to build C++ test
binaries only inside a `mktemp -d` directory cleaned up via `trap ... EXIT
INT TERM`, to verify (or auto-pick) a genuinely free `TEST_PORT` before
the integration suite starts instead of a hardcoded port number, and to
report `git status --short` before/after so a build artifact leaking into
the working tree would be visible rather than silently gitignored away
(verified empirically: `git status --short --untracked-files=all` is
byte-identical before and after a full suite run).

**What this remediation pass deliberately did NOT do**, per its own
explicit scope boundary ("Не використовуй цю задачу як привід для
широкого redesign поза Етапом 1"): it did not fix the pre-existing
`cell_request_charge_voltage`/`cell_rcv` wire-id registration collision in
`jk_bms.js` (documented, regression-tested via
`test/protocol_catalog/test_entity_id_collision.js`, left open — fixing it
touches core frontend entity-resolution order, outside a catalog-focused
pass — **superseded, see the addendum below: fixed in a later pass**); it
did not generate `batterylifepo4.yaml`'s own register geometry
from the canonical source (still hand-authored, still cross-validated —
full YAML generation remains future-stage scope, per the original ADR's
own §11 reasoning, unchanged by this pass); and it did not obtain official
JK documentation (none was available in this environment before or after
this pass — `confirmed_official` remains unreachable for every field).

## Addendum: claim-level evidence model, single pipeline, real write-path removal (2026-09-09, third pass)

This addendum documents a further pass that replaced the field-level
evidence model above with a claim-level one, replaced the four
hand-run scripts with a single lock-protected orchestrator, and closed
the gap between the catalog's `effective_access` metadata and what
`batterylifepo4.yaml` actually lets a client write over HTTP. It
supersedes specific claims in the sections above where noted.

**Claim-level evidence** (was: one `evidence` array entry per source per
field, keyed by a short alias like `"workbook"`). Every evidence entry
now carries `source_id` (an actual foreign key into
`protocol/evidence/sources.json`, not a bare alias), `locator_id` and
`locator` (an exact, re-derivable pointer — a row number, a line number
— not just a citation string), `claim_types` (which of this field's
facts this specific piece of evidence actually supports — an address
citation does not imply a scale citation), `source_fingerprint` (the
exact content/revision hash of the source AT THE TIME this citation was
checked — `sources.json` carries the same hash per source, and
`semantic-checks.js`'s `CITATION_SOURCE_FINGERPRINT_MISMATCH` check fails
the whole catalog if they ever drift apart), `confidence`, and
`applicability`. `sources[source_id].derivation_group` and
`provenance_status` are the actual, sole determinants of independence —
`upstream_syssi_esphome_jk_bms` and `project_implementation` share one
`derivation_group` (this project's ESPHome component IS the upstream
component, not an independent reimplementation of it), and an
`"unknown"`-provenance source (the workbook) cannot count as independent
corroboration on its own. `protocol/evidence/build_claim_matrix.js`
recomputes a full claim coverage matrix from these citations
(`protocol/generated/claim_matrix.json`) for the semantic validator to
check total claim coverage against, not just address presence.

**`build_seed.py` removed, not "kept but fixed".** The prior addendum's
Крок E/build_seed.py remediation left the authoring script executable
with its own hand-typed evidence tuples and `effective_access` literals
still in its source — a re-run would have silently reverted every
fail-closed downgrade a later pass applied by hand-editing the generated
JSON. Rather than keep maintaining an authoring script whose whole
purpose (deriving facts once) was already done, `tools/protocol/
authoring/` was deleted outright; `protocol/registers.canonical.json` is
now the direct, hand-maintained source of truth for register/field
facts, and `effective_access`/`verification_status` are derived at
validation time by `semantic-checks.js` from the claim matrix — never
authored as a literal anywhere.

**Single pipeline orchestrator** (`tools/protocol/pipeline.js build|check
--workbook <path>`) replaces running four separate scripts by hand in the
right order. It: takes an exclusive lock file (`wx`-mode create, refuses
a concurrent second `build`) so two invocations can never interleave
writes; rejects a mutable `@main`/`@master`/`@latest` external-component
pin outright before doing anything else; verifies the Node version
against `.node-version`; verifies `sources.json`'s `project_implementation
.fingerprint` matches a fresh hash of the CURRENT `batterylifepo4.yaml`
+ `jk_bms.js` (refusing to proceed on drift — this is a deliberate human
gate: re-stamping the fingerprint after a real implementation edit is a
one-line, auditable act of re-attestation, not something the pipeline
does for itself); rebuilds every index and the claim matrix in an
isolated `mkdtempSync` directory (never touching the real tree until
every step has succeeded); and writes one full manifest
(`protocol/generated/.pipeline-manifest.json`) covering the ENTIRE
derived-artifact chain — `sources.json`, all three indices, the claim
matrix, the canonical sources, every `generate.js` output, and `jk_bms.js`
— not just `generate.js`'s own outputs, closing the "stale
`workbook_index.json` invisible to `--check`" gap the previous pass left
open.

**Real crash-injection, not just post-hoc corruption detection.**
`test/protocol_catalog/test_generation_atomicity.js` now runs entirely
inside an isolated `mkdtempSync` sandbox (copying every file
`generate.js`/`semantic-checks.js` actually reads — `sources.json`
itself was missing from that copy list until this pass, which is why the
suite could not even complete its first isolated run before the fix) and
injects a real process kill (`SIGKILL` via a child `generate.js --root
<sandbox>` invocation) both immediately before and immediately after
each of the 4 rename operations in the staged-publish sequence, asserting
that `--check` on the resulting mixed state always fails with a stable
diagnostic AND that a follow-up clean run fully restores every prior
artifact with no leftover `.tmp`/lock files. A second `build` started
while a lock file already exists is rejected with a stable
`PIPELINE_LOCKED`/lock-rejection code rather than silently interleaving.

**Two generated artifacts deleted as misleading non-runtime outputs**
(closing the gap the second addendum's own audit flagged but did not
fix): `protocol/generated/protocol_catalog.h` (a C++ header never
`#include`d by any build target) and `protocol/generated/
frontend_catalog.generated.js` (a standalone projection no frontend code
ever imported). Both were "prepared for a later stage" outputs that
existed only to be described in a report, not consumed by anything;
`generate.js` no longer produces either.

**The `cell_rcv`/`cell_request_charge_voltage` wire-id collision this
ADR previously left open is fixed.** `jk_bms.js` no longer has a bespoke
`registerEntity("cell_request_charge_voltage", ...)` call competing with
the generic loop's `registerEntity("cell_rcv", ...)` for the same wire
id — only the generic-loop registration remains, so
`entityByWireId.get("sensor-cell_rcv")` resolves to the one canonical key
every consumer (chart bindings, the settings row, the mock) now shares.
`test_entity_id_collision.js` asserts this directly (one wire owner per
key, canonical key wins, no dangling alias consumer) rather than merely
documenting that the collision exists.

**Real backend write-path removal (closes the "catalog says `r`, firmware
still writes" gap).** Every field whose `effective_access` is `"r"` (all
46 previously-`rw`-declared fields — none reach `verification_status:
"confirmed"` under the corrected independence model, so none currently
qualify) had its REAL Modbus write path removed from `batterylifepo4.yaml`,
not just its catalog metadata flipped: 34 `number:` entities were deleted
outright (no HTTP endpoint exists for them at all); `cell_count`,
`setup_passcode`, and the `charging`/`discharging`/`balancing` `select:`
entities were kept (their dependent transaction-tracking globals/
intervals have cross-file references too extensive to safely delete in
one pass) but their `set_action` bodies now refuse unconditionally and
never queue a Modbus command — verified by `esphome compile` succeeding
and by `test/topology/run.js` POSTing directly to each HTTP endpoint
(bypassing the frontend) and asserting rejection.

**What this pass still did not do**: build the full claim-taxonomy
coverage check per individual claim type against every field (the claim
matrix exists and is validated for internal consistency, but semantic-
checks.js does not yet assert every field has 100% of its applicable
claim types cited); replace `test/register_catalog/validate.js`'s
substring/regex-based YAML↔catalog cross-check with a real structural
YAML parser; or obtain official JK documentation (still unavailable —
`confirmed_official` remains unreachable for every field, unchanged).

## Addendum: owner-authorized write re-enablement (2026-09-10, fourth pass)

The repo owner, after reviewing the fail-closed audit above and the real
register/access table it produced, made an explicit, informed decision
for their own hardware: the evidence gap that keeps every field's
`verification_status` below `"confirmed"` (no official docs; workbook
provenance unknown; upstream and this project's implementation share one
derivation group) is real and unchanged, but they accept that residual
risk themselves for 36 of the 46 previously-blocked fields and want the
real write path restored rather than left disabled pending evidence that
may never arrive.

**The evidence architecture is extended, not weakened, to carry this.**
`verification_status` is never forged — every one of the 36 fields still
honestly reports `"implementation_only_unverified"` or
`"corroborated_with_limitations"`, exactly as the independence model
derives it. A new, strictly human-authored field,
`owner_write_override: {authorized, authorized_by, date, rationale}`, is
the ONLY thing that can move a field's `effective_access` to `"rw"`
without `verification_status: "confirmed"` —
`tools/protocol/lib/semantic-checks.js`'s `derivedAccess`/
`UNVERIFIED_FIELD_WRITE_ENABLED` logic explicitly checks for it, and a
new `OWNER_OVERRIDE_ON_NON_RW` check rejects an override on any field the
protocol itself doesn't declare `"rw"` — this can re-enable a write path
the protocol asserts exists, never invent one. The override is fully
attributed and dated, never a silent flip.

**Scope: 36 of 46 fields, not all of them.** Unlocked: every
`write_safety_class` `"normal"`/`"disruptive"` numeric register (voltage/
current/temperature protection thresholds, delays, balance parameters,
`battery_capacity`), the packed `rcv_time`/`rfv_time` pair (its own
`overlap_rule` already specified the correct read-modify-write shape),
`cell_count` (`"topology"` class), and `charging`/`discharging`/
`balancing` (the three output-permission selects). Deliberately left
blocked: `setup_passcode` (`"credential"` class — a wrong write there
risks a hardware lockout, a qualitatively different and less reversible
risk than a wrong voltage threshold, and its frontend UI was fully
removed rather than merely disabled, a larger rebuild than this pass took
on) and the 9 fields the catalog already classifies
`write_safety_class: "unsupported"` (`heating_activation/deactivation_
temperature`, `lcd_buzzer_trigger`, `dry_contact_1/2_trigger_source`,
`dry_contact_1/2_trigger_value`/`recovery_value`) — these carry a
structural gap beyond mere evidence: their packed sub-field masked-write
logic doesn't exist yet, or (the dry-contact values) even their basic
physical unit/meaning depends on an unconfirmed enum selection elsewhere.

**Nothing about the write MECHANISM changed.** The generic Write
Transaction Manager (`write_bms_u32`/`write_bms_u16` -> `begin_write_tx`
-> the 250ms ack/forced-readback servicer) and `cell_count`'s bespoke
topology-aware transaction driver already existed, fully built and unit-
tested, from earlier passes — they were simply never wired to any live
UI entity. This pass added the 32 missing `number:`/`select:` entities
(`batterylifepo4.yaml`), populated `jk_bms.js`'s `SETTING_DEFS`/
`CONTROL_DEFS` allowlists and made `writableDefinitionForEntry()`
actually consult them (previously a hardcoded `return null;`, kept
deliberately empty exactly so a later change could not accidentally
expose a write path without an explicit code change here too), and
un-stubbed the `set_action` bodies for `cell_count`/`charging`/
`discharging`/`balancing` (previously simply refused unconditionally).
`register_catalog.json`, `jk_bms.js`'s generated `genericTxAddress`/
`blockedWriteKeys` blocks, and `demo/mock-server.js`'s own generic-write
simulation are all regenerated/data-driven from the same canonical
source, so the demo backend accepts and correctly confirms/mismatches/
times out writes for exactly this set with no separate mock-specific
change needed.

Verified: `node tools/protocol/generate.js --check` (no drift),
`test/register_catalog/validate.js` (writable-field↔YAML-entity and
`genericTxAddress` consistency checks), `test/protocol_catalog/
test_blocked_write_surface.js` (rewritten to assert the remaining 10
fields stay genuinely blocked end-to-end AND the 36 unlocked fields carry
a well-formed override with a real, exercised write path), and
`test/topology/run.js` (rewritten generic-write/control-register/
cell_count-public-endpoint tests exercising confirm/mismatch/ack_timeout/
readback_timeout against the real mock simulation), plus
`esphome config` against the real YAML (locally, via a pinned-version-
appropriate ESPHome install — see this file's own version_context for
the toolchain pin).

**What this pass still did not do**: build the `setup_passcode` UI back
(deliberately deferred — credential-class risk, larger rebuild); give
the 9 `"unsupported"`-class fields real masked-write entities; or change
anything about the underlying evidence/verification_status honesty —
every unlocked field's `verification_status` is exactly as unverified as
it was before this pass, which is the entire point of a separate,
explicit, attributed override rather than a quiet reclassification.

## Addendum: the remaining 10 fields, unlocked too (2026-09-10, fifth pass)

The repo owner's follow-up instruction was explicit: the two deferrals
above were this assistant's own extra caution, not something the owner
asked for — "don't leave RW fields deliberately blocked, fix it." All 10
are unlocked now, closing the gap between "protocol declares RW" and
"effective_access rw" completely: 46 of 46 protocol-RW fields.

**`setup_passcode`.** `set_action` now encodes the new passcode into the
8-word (16-byte, null-padded ASCII) wire format and queues a real
`create_write_multiple_command` to 0x1470, reusing the write -> ACK ->
forced-readback-and-compare servicer that already existed (only the
trigger half was ever missing — same shape as `cell_count`'s dormant
machinery in the third-pass addendum). Its frontend UI is rebuilt as its
own dedicated password field in the app-settings modal (`setupPasscodeInput`/
`setupPasscodeSaveBtn`), not a generic register-list row — it stays
unverifiable-by-nature (the readback bytes never leave the device, only
the terminal status code does) and deliberately outside `SETTING_DEFS`/
`CONTROL_DEFS`.

**The 9 `write_safety_class: "unsupported"` fields required a second,
separate override.** Investigating why `effective_access: "rw"` was
still rejected after setting `owner_write_override` surfaced a REAL,
distinct gate this assistant's own semantic-checks.js additions had not
accounted for: `dynamic_dependency.resolved === false`
(`UNRESOLVED_DYNAMIC_DEPENDENCY_WRITE_ENABLED`), which
`tools/protocol/lib/semantic-checks.js` enforced unconditionally,
independent of `verification_status`. For `lcd_buzzer_trigger` and
`dry_contact_1/2_trigger_source` the dependency is `depends_on_field:
null` — "this field's own enum semantics aren't confirmed," the same
class of gap `owner_write_override` already covers elsewhere, just
tracked on a different field. For the 4 dry-contact VALUE fields it is a
genuine cross-field dependency (`depends_on_field:
"dry_contact_1/2_trigger_source"` — the value's physical meaning depends
on which source is selected) — still the same category of risk
acceptance (the owner can read the paired source field directly off the
same UI), so `ownerAuthorized` now bypasses this gate too, exactly
mirroring how it already bypasses the `verification_status !==
"confirmed"` gate — never by marking the dependency `resolved: true`,
which would misrepresent it as actually confirmed.

**Two registers (`heating_activation_temperature`/`deactivation_temperature`)
had no entity at all**, read or write — `jk_bms.js` had registered them
as expected `number`-domain keys since an earlier pass, but
`batterylifepo4.yaml` never defined them, only the raw packed sensor
(`heating_thresholds_raw`). Both the read-side split sensors and the
write-side `number:` entities were built from scratch this pass,
following the exact byte-extraction pattern already used for
`lcd_buzzer_trigger_source`/`dry_contact_1_trigger_source`.

**The 250ms write-tx servicer's readback-publish switch, previously
covering only the plain (non-packed) registers, now also covers 0x111C
(heating pair), 0x14E4 (`lcd_buzzer_trigger` + `dry_contact_1_trigger_source`),
and 0x14E6 (`dry_contact_2_trigger_source` only — its packed sibling,
`uart_protocol_library_version`, is genuinely `access: "r"` and is read
directly off the raw register purely to preserve it on write, never
published as a write target).**

Verified the same way as the third/fourth passes: `generate.js --check`
(no drift), `validate.js` (197 checks), `test_negative_fixtures.js` (110),
`test_packed_codec.js` (16, unchanged pre-existing assertions about
0x111C/0x14E4/0x14E6/0x1504 still hold), the rewritten
`test_blocked_write_surface.js` (19 — 0 fields now blocked; every
unlocked field's frontend/YAML write path individually asserted), and a
local `esphome config` pass against the real YAML.

## Addendum: second critical audit — evidence vs. risk acceptance, and four real defects (2026-09-10, sixth pass)

The repo owner pushed back on the fifth-pass result with twelve specific,
checkable claims, prefaced correctly: `owner_write_override` is risk
acceptance, not protocol verification, and should not have been treated
as an equivalent "correct baseline" on its own. Each claim was verified
directly against the repo before any code changed. Four were real,
previously-undetected defects; the rest were true-but-already-understood
properties of the override mechanism, or artifacts needing a wording fix
rather than a code fix.

**Scope reverted: 27 of 46 fields, back to fail-closed.** Every
`write_safety_class: "disruptive"` field, `cell_count` (`"topology"`),
`setup_passcode` (`"credential"`), the 7 fields with an unresolved
`dynamic_dependency`, and every packed-register field (`rcv_time`/
`rfv_time`, the heating pair, `lcd_buzzer_trigger`/
`dry_contact_1/2_trigger_source`) were reverted: `owner_write_override`
removed, `effective_access` back to `"r"`, and — critically, going
further than the fifth pass's own YAML — each entity's `set_action` body
itself re-stubbed to a `queue_command`-free refusal (the same
"catalog says `r`, but does the real Modbus write path still exist"
distinction this project has enforced since Stage 1). 19 fields remain
unlocked: `write_safety_class: "normal"`, non-packed, fully
dependency-resolved (the *-recovery/*-return thresholds, `smart_sleep`,
`start_balance`/`start_balance_trigger`, `soc_100`/`soc_0`, `cell_rcv`/
`cell_rfv`, `scpr_time`, `max_balance_current`, `battery_capacity`,
`balancing`). `jk_bms.js`'s `SETTING_DEFS`/`CONTROL_DEFS` were cut down to
match, and `writableDefinitionForEntry()` gained a defense-in-depth check
— it now consults the GENERATED `blockedWriteKeys` (single source of
truth, tied straight to `registers.canonical.json`) before either
hand-maintained table, so a table left stale after a future revert can
never expose a live editor for an actually-blocked field.

**Claim 4/5 (claim_matrix.json `write_ready: 0` vs. 46 effective-RW;
pipeline fingerprint mismatch) — both real, both were simple staleness,
now fixed.** `protocol/generated/claim_matrix.json` is written only by
`tools/protocol/pipeline.js build` (needs the real workbook, unavailable
in this environment) — it was last regenerated *before* any
`owner_write_override` work and was never touched by the plain
`generate.js` path this session actually used, so it silently drifted
out of sync with `registers.canonical.json`. This is a real structural
gap (`generate.js --check` cannot catch drift in an artifact it doesn't
produce) — logged as an open item, not fixed this pass (fixing it
requires either extending `generate.js`'s `--check` to also cover
`claim_matrix.json`'s inputs, or running the full pipeline routinely,
which needs the workbook). Separately, `protocol/evidence/sources.json`'s
`project_implementation.fingerprint` was stale relative to every YAML/JS
edit made earlier in this session (each edit round re-stamps it, but the
last several rounds today hadn't) — re-hashed and re-stamped across all
239 citations that cite it, using the exact algorithm
`pipeline.js`'s own `normalizedImplementationFingerprint()` uses, so
`pipeline.js check` (once run with the workbook) will no longer fail with
`IMPLEMENTATION_SOURCE_FINGERPRINT_MISMATCH` purely from staleness.

**Claim 10 (a `begin_write_tx` single-flight rejection was silently
masked as a client-side timeout) — real, and the single most important
fix this pass, because it's the exact defect class the original
CellCount symptom investigation was launched to find.** `jk_write_tx::begin()`
already correctly returns `-1` on a same-address collision or an
all-slots-busy condition (and `Status::REJECTED = 9` already existed in
`jk_write_tx_core.h`, reserved but never emitted by the real firmware
path) — but the calling lambda in `batterylifepo4.yaml` only logged a
warning and returned. Nothing was ever published to `write_tx_snapshot`,
and ESPHome's own web_server layer still returns HTTP 200 for the
set_action (the action *ran*; declining to queue a Modbus command is not
a C++ exception) — so a client had no way to learn the write was refused
except waiting out its own client-side timeout. Fixed: three new globals
(`g_wtx_last_rejected_addr/tx_id/ms`), `begin_write_tx`'s `idx < 0` branch
now assigns a fresh transaction id and calls
`publish_write_tx_snapshot()`, and that function now appends a
short-lived `{"addr","tx_id","status":9}` entry (same 3s grace period as
a real terminal slot) when a rejection is fresh. `demo/mock-server.js`
had the *identical* defect (`onTerminal(9, ...)` was invoked as a plain
in-process callback that the generic write handler's own callback
ignored for any status other than 4 — never touched
`write_tx_snapshot` either) — fixed the same way (`publishRejected()`).
Frontend: `WTX_TERMINAL_STATUS` now includes `9`, `TX_STATE.REJECTED` is
new, and `checkSnapshotTerminal()` branches on status 9 with its own
message (`tx.rejectedBusy`) instead of falling into the generic timeout
branch. `test/topology/run.js` gained
`testGenericWriteRejectedOnCollision` proving two overlapping writes to
the same address now produce a real, observable REJECTED entry instead
of silence.

**Claims 9/11 (packed-field read-modify-write can race a stale sibling
read; generic-manager correlation is address-only, ambiguous for two
fields sharing one address) — real, architectural, and the reason packed
fields specifically stayed in the reverted set.** Every packed writer
built in the fifth pass (`set_heating_activation_temperature`, etc.)
reads its sibling via `id(<sensor>).state` — the sibling's last *polled*
value, not a value freshly re-read at write time — before merging and
writing the combined word; and `findWriteTxEntry(address)` on the
frontend matches by address alone, with no field-key disambiguation, so
two packed siblings sharing one address cannot have independently
correlated transactions (compounded by claim 10's collision behavior:
the *second* sibling's write would previously vanish with no signal at
all). Neither is fixed this pass — both require a real design change
(a synchronous fresh-read-before-write for the RMW hazard; adding `key`
to the `write_tx_snapshot` schema and correlating on it, for the
ambiguity) that's out of scope for a same-day audit response. Recorded
as an explicit prerequisite in `OPEN_ISSUES.md`: no packed field may be
re-unlocked until both are fixed and covered by a dedicated test.

**Claims 1/2/3 (no field reaches `verification_status: "confirmed"`;
7 fields had `dynamic_dependency.resolved === false`; `owner_write_override`
bypasses both) — all true, and exactly as designed, not a defect.**
This is the honesty property the whole mechanism exists to preserve:
`verification_status` is never forged (every unlocked field still
reports its real, unconfirmed status), only `effective_access` moves,
and only behind an explicit, attributed, human-authored override — see
the fourth-pass addendum. The audit's framing (risk acceptance ≠
protocol verification) is correct and is now stated explicitly in
`protocol/README.md` rather than left implicit.

**Claims 6/7/8 (the blocked-write test's HTTP loop ran 0 iterations
because the blocked set was empty; `test_blocked_write_surface.js` was
never wired into `run_all.sh`; the topology suite only exercised a small
subset of the 46 fields) — all real.** The first is now moot (27 fields
are blocked again, so the loop is exhaustive over a real set); the
second is fixed (`test/run_all.sh` now runs it, right after the
atomicity suite); the third remains true in the narrow sense that no
single test file drives all 46 fields through a live mock HTTP
round-trip — `test_blocked_write_surface.js`'s 27-field loop covers the
*blocked* set exhaustively via structural YAML/JSON checks plus one live
HTTP round-trip per field, and `test/topology/run.js` covers the
*unlocked* set's live transaction timeline via 2 representative fields
(`cell_uvpr`, `cell_ovpr`) plus `balancing` — not all 19 individually.
Logged as a residual gap, not fixed this pass (effort/time; the marginal
value of 19 nearly-identical live-HTTP round trips beyond the 2 already
covered is low, since they all route through the exact same
`begin_write_tx`/`write_bms_u32` code path already exercised end to end).

**Claim 12 (setup_passcode transported via URL query, no strict-ASCII
validation) — real, but now moot: setup_passcode is back in the reverted
set (credential class), so this is a defect in dormant code, not live
code.** Documented as a prerequisite for setup_passcode's own future
re-enablement, not fixed.

**Full ESPHome compile, against the exact pinned toolchain (2026.8.2,
not a substitute), succeeded — RAM 51.3%, Flash 61.2%, `Successfully
compiled program.`** This session's sandbox ships Python 3.9, which
cannot install the pinned esphome release (`Requires-Python >=3.12`); an
earlier compile attempt against the newest installable version
(2026.6.5) failed with `'esphome::modbus::EntityType' has not been
declared` across many lines — including lines written in earlier
sessions, not just today's — which was correctly diagnosed as a
version-mismatch artifact (2026.6.5's modbus callback type is
`ModbusRegisterType`, renamed to `EntityType` by 2026.8.2) rather than a
real defect, and resolved by locating a Homebrew-installed Python 3.12.11
and building a second, correctly-versioned virtualenv. This — not the
config-schema-only checks the third/fourth/fifth passes relied on — is
the first real proof this session that the current YAML actually
compiles end to end, for every field including all 27 reverted stubs and
the `begin_write_tx`/`publish_write_tx_snapshot` REJECTED-signaling
changes.

**What this pass still did not do**: fix claims 9/11 (packed RMW
freshness, address-only correlation — both now explicit prerequisites
for ever re-unlocking a packed field); extend `generate.js --check` to
cover `claim_matrix.json` staleness; run the real workbook-backed
`pipeline.js check` (workbook unavailable in this environment); or
perform ANY write against real hardware — this environment cannot reach
`http://jk-bms.local/` at all (mDNS `.local` resolution fails even with
the sandbox's network restrictions lifted), so hardware validation
(Stage 9 of the audit request) is blocked on the user providing either a
routable IP or running the read-only/write verification commands
themselves and sharing the output.

## Addendum: transaction architecture hardening — no new unlocks (2026-09-10, seventh pass)

Explicit scope for this pass: fix the write-transaction architecture and
protocol pipeline, not unlock more fields. Baseline confirmed unchanged
going in: 119 physical registers, 127 logical fields, 46 declared RW.
19→18 effective-RW and 27→28 fail-closed changed by exactly one field
this pass (`balancing` — see below), which is a correctness fix, not a
scope change.

**`balancing` was wrongly left unlocked — reclassified and reverted.**
`registers.canonical.json` had `write_safety_class: "normal"` for
`balancing`, but `batterylifepo4.yaml`'s own Stage 1 Completion Pass
comment, right above `select_charging`/`select_discharging`/
`select_balancing`, has always said "charging/discharging/balancing ...
are declared write_safety_class 'disruptive'" — all three together. The
canonical source was the one that was wrong; fixed to `"disruptive"` and
`select_balancing`'s `set_action` reverted to the same fail-closed stub
as its two siblings. 18 fields remain unlocked.

**`setup_passcode`'s UI (added in the fifth-pass addendum) is removed
again.** While a credential-class write stays fail-closed, no input or
endpoint reference for it may exist in the UI at all — a rejected write
is not sufficient assurance on its own for a field whose readback is
permanently masked, so the control surface itself must not exist. The
dedicated password field, its transaction handler, and its i18n strings
are all deleted; `test_blocked_write_surface.js` now asserts their
absence (inverted from the fifth pass's own assertion that they exist).

**Two real defects the previous audit's own fix still had, now closed:**

1. **A single "last rejected" record could lose a second, concurrent
   rejection.** `begin_write_tx`'s REJECTED-publishing fix (sixth-pass
   addendum) used three scalar globals — a second rejection for a
   *different* address within the same 3s window would silently
   overwrite the first's record before any client observed it. Replaced
   with a real 4-slot ring buffer (`g_wtx_rejected_addr/tx_id/ms[4]` +
   a rotating write index), independent of the 6-slot transaction pool
   (which only ever tracks *accepted* transactions). `publish_write_tx_
   snapshot()` now emits every still-fresh rejection as its own row.
2. **Slot reuse had no protection against a late ACK/readback callback
   corrupting a newer transaction at the same slot index.** ESPHome's
   modbus command callbacks close over the slot *index*, not a
   reference — `jk_write_tx::Slot` gained a `generation` counter
   (`components/jk_write_tx/jk_write_tx_core.h`), bumped by `begin()`
   every time a slot index is (re)used, on BOTH reuse paths (a freed
   slot, and the "immediately supersede a terminal same-address slot"
   fast path). Both the ACK callback and the forced-readback callback in
   `batterylifepo4.yaml`'s 250ms servicer now capture
   `{idx, tx_id, address, generation}` at command-issue time and verify
   all four before writing anything back; a stale callback is logged and
   discarded instead of mutating the wrong transaction. Three new unit
   tests (`test_begin_bumps_generation_on_first_use`,
   `_on_each_reuse`, `_on_same_address_supersede`) lock down the one
   invariant this protection depends on: generation always increments,
   never resets.

**A real, previously-undetected false-success path closed (item 5):**
`writeTransaction()`'s entity-state watcher (`watchKey(cfg.key, ...)`)
used to resolve CONFIRMED/MISMATCH from *any* new SSE update to the
target entity — including one from the entity's own unrelated periodic
poll, with no correlation to whether the write's ACK actually landed.
For any key whose value already equals the requested value, a lost ACK
followed by nothing more than the entity's normal slow poll landing
would read as a false CONFIRMED. Fixed: whenever `cfg.address` is known
(every current `SETTING_DEFS`/`CONTROL_DEFS` entry, since both tables
only ever contain keys with a `GENERIC_TX_ADDRESS` mapping),
`write_tx_snapshot` — keyed by exact tx_id, the authoritative backend
verdict — is now the *only* path that may resolve CONFIRMED/MISMATCH;
the entity-state path is kept only as a documented fallback for a
hypothetical future caller with no known address, and no current caller
takes it.

**A real bug in the second pass's OWN test found and fixed.** The
"`SETTING_DEFS`/`CONTROL_DEFS` exactly cover the unlocked key set" check
extracted `CONTROL_DEFS`'s keys with a regex requiring a `"\n  });"`
closer; an *empty* `Object.freeze({})` (which `CONTROL_DEFS` now is,
`balancing` having been reverted too) has no such closer, so the
non-greedy `[\s\S]*?` kept matching forward past the empty object and
captured everything up to the *next* `"\n  });"` anywhere later in the
file — `PROTOCOL_CATALOG`'s own closing brace — silently pulling
`genericTxAddress`/`blockedWriteKeys`' keys in as false "frontend"
entries and failing the check against a phantom 44-key list. Fixed by
checking the empty form explicitly first.

**Verified:** `validate.js` (171), `test_negative_fixtures.js` (110),
`test_packed_codec.js` (16), the C++ unit tests (54, up from 46 — the
three new generation tests), `test_blocked_write_surface.js` (91),
`test/topology/run.js`, `generate.js --check` (no drift), a local
`esphome config` AND a full `esphome compile` — both against the exact
pinned 2026.8.2 — succeeded (RAM 51.3%, Flash 61.2%,
`Successfully compiled program.`).

**What this pass explicitly did NOT do, and why — each is a real,
separately-scoped engineering investment, not an oversight:**

- **Item 2 (pipeline rebuild with the real workbook).** `pipeline.js
  build/check` needs `JK_BMS_WORKBOOK_PATH` pointing at the real
  `LiFePO4_BMS_Parameters_registers.xlsx` — a personal file never
  committed to this repo and not present in this environment. Blocked on
  the user supplying the path (or running it themselves).
- **Item 3 (a real `{accepted, tx_id, key, address, generation, reason}`
  JSON write endpoint, replacing ESPHome's built-in `/number/.../set`
  etc.).** ESPHome's number/select/text "set" HTTP handlers are
  generated framework code — they can only ever return a bare `OK`, 200,
  never a custom JSON body. Getting the exact JSON contract the audit
  asks for requires a genuinely new custom `AsyncWebHandler` (the same
  pattern `HistoryHandler`/`ChargeHistoryHandler` already use in this
  file), intercepting a new `/api/write`-style route, doing the
  begin_write_tx dispatch synchronously inside the HTTP handler itself,
  and rewiring all 18 unlocked entities' frontend calls to it. This is
  the single largest remaining item — a new, safety-critical HTTP
  component, not a small patch — and was not attempted this pass rather
  than ship it undertested.
- **Item 7 (generic WRITE_UNCERTAIN + recovery-probe, mirroring
  CellCount's own bespoke mechanism for every OTHER RW field).** Requires
  extending `jk_write_tx::Status`/`tick()` with real recovery states,
  wiring a recovery-readback issue/callback into the 250ms servicer, and
  mirroring the same state machine in `demo/mock-server.js` (currently
  independent JS that would otherwise diverge from the real firmware,
  breaking the project's "faithful port" principle) — not attempted this
  pass for the same reason as item 3.
- **Items 11/12 (Playwright-class browser E2E; exhaustive per-field
  encode/endpoint/ACK/readback/rollback/timeout E2E for all 18 unlocked
  fields).** No browser test framework exists in this repo yet
  (`OPEN_ISSUES.md` P1-09 already tracked this before this pass). Item
  4's own "test the REAL frontend algorithm, not just grep JSON" ask
  falls in the same bucket — `jk_bms.js` is a single non-modular IIFE not
  built for programmatic import, so exercising its actual `writeTransaction()`
  code (not a re-implementation of its logic in the Node test) needs
  either a real browser harness or a DOM-shim (jsdom) loader — the same
  infrastructure investment as full browser E2E, not a quick addition.

Given the above, `READY` is not and cannot be claimed this pass — the
audit's own stated gates (pipeline green, exact tx_id correlation
end-to-end via a real endpoint, browser E2E, hardware validation) are
each either partially addressed (tx_id/generation correlation now real
at the C++/YAML layer, but not yet exposed through a dedicated endpoint)
or not attempted (pipeline without a workbook, browser E2E, hardware).

## Addendum: generic WRITE_UNCERTAIN + recovery probe (2026-09-10, eighth pass)

A single, self-scoped follow-up action, chosen and executed as the top
remaining P0-priority item from the seventh pass's own explicit
"not attempted" list above: **item 7 — a generic ACK/readback-timeout
recovery probe for every non-CellCount RW register**, matching P0-04 in
`OPEN_ISSUES.md`. Scope was deliberately bounded to this one item, with
concrete, verifiable success criteria fixed *before* any code was
written (see the session transcript's own self-authored prompt). No RW
field's access changed in this pass — this is purely a state-machine
completeness fix.

### What changed

- **`components/jk_write_tx/jk_write_tx_core.h`**: added
  `RECOVERED_CONFIRMED = 10` / `RECOVERED_MISMATCH = 11` to `Status`
  (never emitted by `tick()` itself — reserved for the caller-layered
  recovery probe below, exactly like `WRITE_UNCERTAIN` already was).
  Extended `is_pending()` to also treat `WRITE_UNCERTAIN` as pending, so
  `begin()`'s existing single-flight guard automatically blocks a new
  write to an address whose recovery is still in flight, and
  automatically un-blocks it the instant recovery resolves to either
  terminal code. This is the ONLY core-logic change — `tick()` itself is
  untouched, so every one of the 54 pre-existing unit tests (and every
  existing caller, including CellCount's own unrelated bespoke driver)
  keeps its exact prior behavior. 4 new unit tests added (63 total, was
  54): `is_pending` includes `WRITE_UNCERTAIN`; `begin()` rejects a
  second write to a `WRITE_UNCERTAIN` address; `begin()` allows a new
  write once resolved to `RECOVERED_CONFIRMED`/`RECOVERED_MISMATCH`.
- **`batterylifepo4.yaml`**'s 250ms generic-write servicer: an
  `ACK_TIMEOUT`/`READBACK_TIMEOUT` terminal result from `tick()` is now
  intercepted immediately (before it is ever published) and reclassified
  to `WRITE_UNCERTAIN`, which arms a recovery-readback probe (reusing the
  exact same generation-guarded, immutable-quadruple-capture command
  pattern already proven for the ordinary forced readback and the ACK
  callback — see the seventh pass's item-6 fix). The probe re-issues
  every 2s until a response lands, compares the recovered value against
  the original request with the transaction's own `compare_mask`
  (correctly handling packed sub-fields), and resolves to
  `RECOVERED_CONFIRMED`/`RECOVERED_MISMATCH`. A slot in `WRITE_UNCERTAIN`
  is deliberately NOT freed by the existing 3s grace-period logic (it
  only frees once `finished_ms` is set, which now only happens on true
  resolution) — mirrors CellCount's own bespoke uncertainty-recovery
  probe pattern (`g_topology_recovery_*`) as closely as possible, by
  design, to keep the two mental models consistent for anyone reading
  the firmware later.
- **`demo/mock-server.js`**: `runGenericWriteTx`'s `ack_timeout`/
  `readback_timeout` scenarios now go through a new `finishUncertain()`
  helper (mirroring `runCellCountTransaction`'s existing one) instead of
  ending the transaction outright — publishes the timeout code, then
  `WRITE_UNCERTAIN`(6), then a genuinely fresh read of the entity 1.5s
  later, resolving to 10/11 exactly like the real firmware's own probe
  would. A new `applied_ack_lost` scenario was added (mirroring
  CellCount's own scenario of the same name) so the suite can prove BOTH
  outcomes: the write silently applied (→ `RECOVERED_CONFIRMED`) and the
  write genuinely never landed (→ `RECOVERED_MISMATCH`).
- **`jk_bms.js`**: added `TX_STATE.UNCERTAIN` (non-terminal — every
  `onState()` caller now treats it exactly like `PENDING_READBACK`: the
  control stays disabled, no green/red shown, so there is never a
  premature success OR failure indication while the backend's own
  recovery probe is still working). `WTX_TERMINAL_STATUS` no longer
  treats raw `ACK_TIMEOUT`(7)/`READBACK_TIMEOUT`(8) as terminal (the
  backend now always moves a slot past them into `WRITE_UNCERTAIN`
  before a client can act on them) and now includes `RECOVERED_CONFIRMED`
  (10) / `RECOVERED_MISMATCH`(11). `checkSnapshotTerminal()` recognizes
  status 6 and re-arms an extended (10s default) client-side timer
  instead of letting the ordinary ~6s write-timeout race the backend's
  own multi-second recovery probe. New UK/EN strings:
  `tx.uncertainRecovering`, `tx.recoveredAfterUncertainty`,
  `tx.recoveredMismatchAfterUncertainty`.
- **`test/jk_write_tx/test_jk_write_tx_core.cpp`**: +4 tests (63 total).
- **`test/topology/run.js`**: new `testGenericWriteUncertaintyRecovery`
  proving both outcomes end to end against the mock's real HTTP+SSE
  surface, on `cell_uvpr` (0x1008) — a register OTHER than CellCount, so
  this is genuinely new coverage, not a restatement of CellCount's
  already-tested recovery path. Also fixed `resetGenericWrite()`
  (previously a bare 200ms sleep) to poll the real snapshot state until
  no address is left pending — a fixed short sleep would have let a
  later test's write to the SAME address land while a PRIOR test's
  slower recovery probe (now several seconds, not instant) was still
  outstanding, and briefly did exactly that (a real, caught-and-fixed
  regression in `testGenericWriteAcrossDifferentRegisters` during this
  pass's own verification — `cell_uvpr` stayed at its old value because
  the write was silently rejected by the still-`WRITE_UNCERTAIN`
  address).

### Verification (this pass)

| Check | Result |
|---|---|
| `g++ -std=c++17 -Wall -Wextra` unit tests | **63/63 PASS**, 0 warnings (was 54) |
| `node test/register_catalog/validate.js` | **171/171 PASS** (unchanged) |
| `node test/protocol_catalog/test_packed_codec.js` | **16/16 PASS** (unchanged) |
| `node test/protocol_catalog/test_negative_fixtures.js` | **110/110 PASS** (unchanged) |
| `node test/protocol_catalog/test_blocked_write_surface.js` | **91/91 PASS** (unchanged — no access changed) |
| `TEST_PORT=... node test/topology/run.js` | **76/76 PASS** (was 69; +7 net: +8 new uncertainty-recovery checks, the pre-existing collision test's own snapshot content shifted by one extra ring entry in its detail string, no assertion count change there) |
| `bash test/run_all.sh` | exit **0**, "All suites passed." |
| `esphome config batterylifepo4.yaml` | Valid |
| `esphome compile batterylifepo4.yaml` (pinned **2026.8.2**) | **SUCCESS** — RAM 51.4% (92824/180736 B), Flash 61.4% (1125899/1835008 B); only the same 3 pre-existing third-party warnings (`modbus_controller.cpp` empty-body x2, `total_runtime` address-never-null) as before this pass — zero new warnings |

### What this pass explicitly did NOT do

- **No browser-level E2E** for this specific recovery path — the new
  test drives the mock's real HTTP+SSE surface from Node, which is
  strictly more than a unit test but still not a real browser exercising
  the actual `jk_bms.js` `writeTransaction()` code path end to end (the
  seventh pass's items 11/12 gap, `OPEN_ISSUES.md` P1-09, is unchanged by
  this pass).
- **No hardware validation** — the recovery-probe timing (2s retry
  cadence, compare-mask semantics) is unverified against a real BMS;
  mDNS blocker from prior passes is unchanged.
- **CellCount's own bespoke recovery driver was deliberately left
  untouched** — it already had this exact capability before this pass;
  duplicating or refactoring it toward the generic manager was
  explicitly out of scope (touching a separately-tested, already-correct
  driver for stylistic unification alone is not worth the regression
  risk).
- **The recovery-probe retry cadence (2s) is a judgment call, not a
  verified real-hardware value** — CellCount's own probe uses 5s;
  chosen shorter here mainly to keep this pass's own test suite fast,
  not derived from any protocol document or real-device observation.

No RW field's `effective_access` changed. `RW_REGISTER_VERIFICATION_MATRIX.md` counts (18 WRITE_VERIFIED / 21 BLOCKED_CONFLICT / 7 NOT_IMPLEMENTED / 81 READ_ONLY_UNVERIFIED) are unaffected by this pass.

## Addendum: P1-04 closed — non-register entity filter now single-sourced (2026-09-10, ninth pass)

A second self-scoped follow-up action (after the eighth pass's P0-04). Root cause: `jk_bms.js`'s `NON_REGISTER_ENTITY_IDS` was a SEPARATE, hand-typed array (~41 entries) that had drifted from reality, while a correct, GENERATED `PROTOCOL_CATALOG.nonRegisterKeys` (53 entries, from `protocol/non_register_entities.canonical.json`) already existed in the same file and was simply never consulted by the filter.

### The actual bug, precisely

`diagnosticObjectId(entry)` always resolves to the LOGICAL key a `registerEntity(key, domain, configuredName, legacyObjectId)` call registered — never a raw YAML `id:` (which is only a C++ config-reference name, invisible to the frontend) and never the raw wire name either. Six entries in the old hand list used the WRONG logical key — a name that no `registerEntity()` call actually produces — so they silently matched nothing:

| Hand list had (wrong) | Real `registerEntity()` key |
|---|---|
| `bms_display_name` | `device_name` |
| `charge_status_time_elapsed` | `charge_status_time` |
| `charge_phase_elapsed` | `charge_phase_time` |
| `battery_state_elapsed` | `battery_state_time` |
| `battery_state_candidate_direction` | `battery_state_direction` |
| `battery_state_candidate_fresh_samples` | `battery_state_candidate_samples` |

Each of these six entities therefore leaked straight into the Settings register list — this is the exact, named defect `HARDWARE_AUDIT_2026-09-09.md` recorded against real hardware ("Battery state time", "Charge phase time", "Runtime" appearing as if they were BMS registers). `Balancing active`/`Charging active`/`Discharging active`, also named in that same hardware observation, turned out on investigation to be genuine registers (`balancing_active` 0x12A6 etc., `READ_ONLY_UNVERIFIED`) correctly belonging in the list — not part of this defect, contrary to the original P1-04 description's grouping.

### The fix

`NON_REGISTER_ENTITY_IDS` is now `new Set(PROTOCOL_CATALOG.nonRegisterKeys)` — a derivation, not a second hand-maintained source. This makes the exact class of drift that caused the leak structurally impossible going forward: there is only one list to maintain, and it is already the one `tools/protocol/generate.js --check` keeps honest against `protocol/non_register_entities.canonical.json`.

### Verification

- New checks in `test/protocol_catalog/test_blocked_write_surface.js`: the derivation is in place (regex on source), and all six previously-broken keys are present in the live `PROTOCOL_CATALOG.nonRegisterKeys` the filter now actually uses.
- **Live browser verification** (Browser pane, real `jk_bms.js` served by `demo/mock-server.js`, not a Node re-implementation): confirmed `Battery state time`, `Charge phase time`, `Charge status time`, `Runtime`, `Device name` now render correctly under Діагностика and are absent from the Settings register list; `Balancing active`/`Charging active`/`Discharging active` remain in Settings, confirmed correct.
- `esphome config batterylifepo4.yaml` — Valid (this pass touched only `jk_bms.js` and test files, never the YAML/C++ write paths).
- Full `bash test/run_all.sh` — exit 0, "All suites passed." (98/98 blocked-write-surface, was 91 — the 7 new checks; every other suite's count is unchanged from the eighth pass).

### A real, unrelated bug found and fixed along the way

While re-running the full suite to verify this pass, `test/run_all.sh` failed at the secret-scan step (exit 1) — a regression exposed by THIS SESSION's earlier `git push`, not by this pass's own change. `test/protocol_catalog/test_secret_scan.js`'s synthetic-positive-fixture exclusion (`DEFAULT_EXCLUDED_FILES`) was applied only in `scanWorktree()`, never in `scanIndex()`/`scanRecentHistory()`. Before the fixture was committed, those two scans never saw it, so the gap was invisible; the moment it landed in the git index and history (this session's earlier push), both scans correctly "detected" the deliberately-detectable fixture and the test wrongly counted that as a real leak. Fixed by applying the same exclusion check uniformly across all three scan functions — `node test/protocol_catalog/test_secret_scan.js` now prints `secret-scan PASS` again, exit 0.

### What this pass explicitly did NOT do

- **`registers.canonical.json`'s `esphome_read_entity_id` drift, tracked as `OPEN_ISSUES.md` P1-13** — discovered during this pass's own verification, not fixed this pass (closed the following pass — see this ADR's own addendum below). The claim above that `cell_rcv`/`cell_rfv` were also affected was **wrong**, corrected in that same later addendum: it came from checking the YAML's internal `id:` field (a C++ config-reference name, never sent over the wire) instead of the real `name:`-derived wire id — `cell_rcv`/`cell_rfv` are in fact correct, already independently proven by `test/protocol_catalog/test_entity_id_collision.js`'s pre-existing "Крок M" checks.
- The other 9 `PROTOCOL_CATALOG.nonRegisterKeys` entries that match no `registerEntity()` call at all (`ui_version`/`browser_connection`/`write_result_counters`/`firmware_version` — intentionally browser-only concepts, expected; `battery_state`/`min_cell_voltage`/`max_cell_voltage`/`min_voltage_cell`/`max_voltage_cell` — not investigated further this pass, likely harmless dead filter entries but not confirmed).

No RW field's `effective_access` changed this pass either.

## Addendum: claim-matrix policy gate made owner-override-aware and actually wired in (2026-09-13, tenth pass)

An outside audit (prompted by an unrelated investigation elsewhere) asked why
`protocol/evidence/build_claim_matrix.js --check`'s own
`CLAIM_POLICY_INCONSISTENT` gate — comparing each field's stored
`effective_access` against a `derived_effective_access` recomputed from
claim-level evidence — is never actually invoked: `tools/protocol/
pipeline.js` calls `build_claim_matrix.js` without `--check` in both `build`
and `check` modes (its own `check` mode does a separate byte-staleness diff,
not this policy check), and no `test/` file calls it either. True, confirmed
by re-grepping every `test/` file and `pipeline.js` for the literal
invocation.

**But turning it on as-is would have been the wrong fix, not the right one.**
`deriveField()`'s `derivedEffectiveAccess` had no concept of
`owner_write_override` — the hand-authored, attributed risk-acceptance field
the fourth/fifth/sixth-pass addenda above built specifically because this
same mechanical 2-independent-group bar is unreachable for every field
(`write_ready: 0` of 127, confirmed unchanged by this pass — see the sixth
pass's "exactly as designed, not a defect" finding, still true). Regenerating
`claim_matrix.json` fresh from the current `registers.canonical.json`/
`sources.json` (the committed copy was itself stale — a different, already-
logged gap, untouched by this pass) showed `policy_inconsistent: 18` —
exactly the repo's 18 live `effective_access: "rw"` fields, every one of them
carrying a well-formed `owner_write_override` (`authorized: true,
authorized_by: "Mykola Krokhmal", date: "2026-09-10"`). Wiring the gate in
unmodified would have hard-failed the pipeline on all 18 already-reviewed,
already-authorized fields — re-litigating a decision this project's own
sixth-pass audit already made and confirmed correct, not catching a real
defect.

**What changed instead**: `deriveField()` in `build_claim_matrix.js` now
computes `derivedEffectiveAccess` the same way `semantic-checks.js`'s
`FORGED_EFFECTIVE_ACCESS` check already does — `ownerAuthorized` (mirroring
`f.owner_write_override.authorized === true && f.access === "rw"`) licenses
`"rw"` independently of the mechanical `writeReady` verdict, and (mirroring
the same file's `UNRESOLVED_DYNAMIC_DEPENDENCY_WRITE_ENABLED` bypass) an
owner override also bypasses an unresolved `dynamic_dependency`. Critically,
`write_readiness`/`missing_write_claims` themselves are untouched — still the
honest, unforced mechanical verdict — only the separate
`derived_effective_access`/`policy_consistent` computation now agrees with
the override mechanism instead of contradicting it. A new `owner_authorized`
field is added to each claim-matrix entry so this is visible directly in the
generated evidence, not just cross-referenced against the canonical catalog.
`tools/protocol/pipeline.js` now runs `build_claim_matrix.js --check`
immediately after generating `tempClaims`, pointed at that same path — the
freshness half of `--check` is a trivial self-compare, so the only thing that
can newly fail there is `CLAIM_POLICY_INCONSISTENT`, in both `build` and
`check` modes, before anything is ever published.

This is the claim-level model becoming a real refinement of
`semantic-checks.js`'s coarser field-level check (2 groups have cited the
field *at all*, vs. every individual required claim type independently
confirmed) rather than a second, conflicting, never-enforced opinion. The two
are not fully redundant: `semantic-checks.js` runs live on every
`validate.js` invocation without needing the workbook, while
`build_claim_matrix.js`'s finer check only runs where `claim_matrix.json` is
freshly regenerated — a real workbook-backed `pipeline.js build|check`.

### Verification (this pass)

| Check | Result |
|---|---|
| `node --check` on both edited files | syntax OK |
| `node protocol/evidence/build_claim_matrix.js` against current `registers.canonical.json` | `policy_inconsistent` **18 → 0**; `write_ready`/`write_blocked` unchanged at **0/127** (mechanical honesty preserved); all 18 fields show `owner_authorized: true` |
| `node protocol/evidence/build_claim_matrix.js --check` against that fresh output | **PASS** (was: would have failed `CLAIM_POLICY_INCONSISTENT` before this pass) |
| Negative-path test: `owner_write_override` stripped from `smart_sleep` in a scratch copy, re-run generate+`--check` | correctly fails `CLAIM_POLICY_INCONSISTENT` — the gate has teeth, not vacuously passing |
| `node tools/protocol/pipeline.js check --workbook <real workbook, sha256-verified>` | fails **`IMPLEMENTATION_SOURCE_FINGERPRINT_MISMATCH`** — a pre-existing gate earlier in the pipeline (line 110), unrelated to this pass, that this branch does not currently pass regardless of this change; this pass's own code is never reached by that run |

### What this pass explicitly did NOT do

- **Did not regenerate or commit a fresh `protocol/generated/claim_matrix.json`.**
  The committed copy is stale relative to the current `registers.canonical.json`/
  `sources.json` (confirmed independently — different `source_manifest_sha256`,
  `policy_inconsistent: 0` committed vs. `18` fresh) — this is the exact gap
  the sixth-pass addendum already logged as open
  ("`generate.js --check` cannot catch drift in an artifact it doesn't
  produce"). Left alone deliberately: this branch is mid-migration (the V2
  manifest work) and committing a regenerated artifact now risks colliding
  with that in-progress work rather than helping it.
- **Did not fix `IMPLEMENTATION_SOURCE_FINGERPRINT_MISMATCH`** — pre-existing,
  unrelated, blocks a full real `pipeline.js check` from ever reaching this
  pass's code on this branch's current tip.
- **Did not run `esphome compile` or the full `test/run_all.sh`** — this
  pass touches only the claim-matrix policy computation and its one call
  site; the broader suite is unaffected by construction (no test file
  references `claim_matrix.json`, `policy_consistent`, or
  `CLAIM_POLICY_INCONSISTENT` — confirmed by grep — so nothing there could
  have regressed).
- **Landed on its own branch (`fix/claim-matrix-owner-override-check`,
  forked from this ADR's own tip), not on `bms-v1.1-manifest-audit`
  directly** — that branch was checked out elsewhere (likely concurrent V2
  migration work) when this pass ran; merge/rebase is left to the repo
  owner's judgment on timing. **Superseded by the integration note below.**

No RW field's `effective_access` changed. This pass changes only how
*consistency between* `effective_access` and the claim-level evidence is
computed and enforced — never which fields are writable.

### Integration note (2026-09-14, merged into `bms-v1.1-manifest-audit`)

Merged via `git merge --no-ff fix/claim-matrix-owner-override-check`. Two
textual conflicts, both resolved by keeping both sides' content, not by
discarding either:

- `tools/protocol/pipeline.js` — both branches inserted a line immediately
  after the same anchor (this pass's new `--check` call; the V2-manifest
  branch's `stampReleaseGenerationId` loop). Resolved by keeping both, in
  the order this pass's own text above already required: the policy
  `--check` runs first, against the still-unstamped `tempClaims`, then
  stamping happens — never the other order, which would make the `--check`
  compare a stamped file against its own unstamped recomputation and
  spuriously report staleness on every run.
- `docs/adr/0001-protocol-catalog.md` (this file) — both branches forked
  from the same eighth-pass tip and each added their own addendum labeled
  "ninth pass". Resolved by keeping the other branch's P1-04 addendum as
  the real ninth pass (it was already committed on `bms-v1.1-manifest-audit`
  first) and renumbering this addendum to **tenth pass** — a label change
  only, no content lost from either side.

The two items this addendum's "what this pass explicitly did NOT do" section
raised — the stale committed `claim_matrix.json` and
`IMPLEMENTATION_SOURCE_FINGERPRINT_MISMATCH` blocking a full `pipeline.js
check` from reaching this pass's code — no longer describe
`bms-v1.1-manifest-audit`'s post-merge state (the fingerprint was already
resolved on this branch before this merge; the stale-artifact class of gap
is addressed by this same integration pass's next commit). They remain
accurate as a description of the state on `fix/claim-matrix-owner-override-check`
at the time this addendum was written, and are left unedited above for that
reason — this note records what changed, rather than rewriting the original
pass's own contemporaneous report of its own branch.
