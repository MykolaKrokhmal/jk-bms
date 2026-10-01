# Implementation fingerprint drift review

> **Supersession note (2026-09-30):** item 1.1 below records a historical
> build configuration, not the current one. Production no longer declares the
> unused `external_components_source` substitution. The pinned syssi revision
> is now modeled only as a non-runtime upstream provenance reference in
> `toolchain.lock.json` and `protocol/evidence/sources.json`; attribution is
> recorded in `THIRD_PARTY_NOTICES.md` and `LICENSES/Apache-2.0.txt`.

Scope: identify, with evidence, every real change to `batterylifepo4.yaml` /
`jk_bms.js` that caused `project_implementation.fingerprint` (in
`protocol/evidence/sources.json`) to stop matching
`normalizedImplementationFingerprint()`, classify each change's effect (if
any) on the canonical register/protocol catalog, and determine whether a
fingerprint restamp is admissible for it.

**What this fingerprint is, and is not, evidence of.** It is a content hash
of exactly two files (`batterylifepo4.yaml` + `jk_bms.js`, generated-catalog
block masked out). Its only job is to detect when the `project_implementation`
evidence source's citation content has gone stale — i.e., whether a claim
in `registers.canonical.json` that cites `project_implementation` as a
source is still citing the implementation as it actually is. **Matching the
hash proves nothing about register mapping, address, encoding, range,
packed semantics, or write-path correctness.** Those are governed
separately by each field's `verification_status`, `evidence` array, and (for
the 18 effective-RW fields) `owner_write_override` — none of which this
review changes or upgrades. A restamp is only ever "admissible" in the
narrow sense of "the two files really do contain what the new hash says";
it is never itself proof of protocol correctness, and nothing in this
document should be read as claiming otherwise.

## Method

`git log --oneline -- protocol/evidence/sources.json` shows exactly one
commit touching the fingerprint: `8659ca9` ("Add authoritative protocol
catalog and generation pipeline"), never updated since. `git log --oneline
-- batterylifepo4.yaml jk_bms.js` shows both files were later changed by
commit `9df9dd8` ("Harden the generic write-transaction architecture")
without a matching fingerprint update — the first, historical, already-
committed source of drift. On top of that, this session's own (still
uncommitted) working tree carries a second layer of drift in `jk_bms.js`
only (`batterylifepo4.yaml` is byte-identical to `HEAD`, confirmed by
`git diff HEAD -- batterylifepo4.yaml` producing zero output).

Every change below was located by diffing real file content
(`git diff 8659ca9 9df9dd8` for the committed layer;
`git diff HEAD -- jk_bms.js` with the generated-catalog block masked out,
for the uncommitted layer) — not by re-reading prior narrative reports.

## Layer 1 — committed, `8659ca9` → `9df9dd8` ("Harden the generic write-transaction architecture")

| # | File | Logical key(s) | Address | Previous state | Current state | Evidence source | Impact on canonical catalog | Restamp admissible | Status |
|---|---|---|---|---|---|---|---|---|---|
| 1.1 | `batterylifepo4.yaml` | n/a (build config) | n/a | `external_components_source: github://syssi/esphome-jk-bms@main` | pinned to immutable commit `08f25eb4941b03b6ee0b6c38660aeadfc4ef7cd1` | pipeline's own `MUTABLE_EXTERNAL_COMPONENT_REVISION` check (`tools/protocol/pipeline.js:106`) | none — not a register/protocol claim | Yes | NOT_APPLICABLE |
| 1.2 | `batterylifepo4.yaml`, `jk_bms.js` | `charging`, `discharging`, `balancing` | 0x1070, 0x1074, 0x1078 | writable via `CONTROL_DEFS`/`begin_write_tx` | `set_action` reverted to a fail-closed log-only lambda; `CONTROL_DEFS = {}` | `docs/adr/0001-protocol-catalog.md` sixth-pass addendum (cited in-line) | write_safety_class "disruptive" fields moved from unlocked back to fail-closed — a **restriction**, not a new protocol claim; addresses/encoding unchanged | Yes | NOT_APPLICABLE (access-policy tightening, already mirrored in canonical `effective_access`) |
| 1.3 | `batterylifepo4.yaml` | `setup_passcode` | 0x1470 | write path implemented (URL-transported, unreviewed encoding) | `set_action` reverted to fail-closed log-only lambda; `internal: true` | in-line comment: credential-class write, pending independent write-contract verification | write path removed; register definition/address unchanged | Yes | NOT_APPLICABLE |
| 1.4 | `batterylifepo4.yaml` | write-tx machinery globals (`g_wtx_generation`, `g_wtx_recovery_pending`, `g_wtx_recovery_next_ms`, `g_wtx_rejected_*`) | n/a | not present | generation-guard + WRITE_UNCERTAIN recovery-probe + rejected-write ring buffer added | `components/jk_write_tx/jk_write_tx_core.h`'s own status enum (already reviewed/tested, 63 C++ unit tests) | none — ESP32-side transaction-machinery reliability, not a register table change | Yes | NOT_APPLICABLE |
| 1.5 | `batterylifepo4.yaml` | `heating_activation_temperature`, `heating_deactivation_temperature`, `lcd_buzzer_trigger`, `dry_contact_1_trigger_source`, `dry_contact_2_trigger_source` | 0x111C, 0x14E4, 0x14E6 | packed decode/publish for these siblings not implemented in the YAML | split-decode `publish_state` calls added for each packed sibling | **already declared** in `protocol/registers.canonical.json` at these exact addresses with these exact sibling sets (verified: `node -e` query against the canonical file, unchanged since `8659ca9`) | none — implements decode for register/field pairs the canonical catalog already asserted; no new claim | Yes | NOT_APPLICABLE |
| 1.6 | `jk_bms.js` | i18n strings (`rejectedBusy`, `uncertainRecovering`, `recoveredAfterUncertainty`, `recoveredMismatchAfterUncertainty`) | n/a | absent | added (EN+UK) | n/a — UI text | none | Yes | NOT_APPLICABLE |
| 1.7 | `jk_bms.js` | `SETTING_DEFS` (Configuration UI entries) | (16 keys, addresses unchanged) | large hand-written array incl. now-fail-closed fields | reduced to only the fields still policy-unlocked, via a shared `settingDef()` helper; comparator selection now derives from `Number.isInteger(step)` instead of a hand-picked `step < 1` | in-line comments citing the same ADR addendum | UI-only exposure narrowed to match the access reduction in 1.2/1.3; no address/encoding change | Yes | NOT_APPLICABLE |

**Layer 1 conclusion:** every change in commit `9df9dd8` either (a) tightens
write-safety policy in a way already reflected in canonical
`effective_access`, (b) improves ESP32-side write-transaction reliability
machinery with no register-table footprint, or (c) implements decode for
packed fields the canonical catalog already declared. None introduces a
new, unverified protocol claim. The commit should have carried a fingerprint
restamp at the time (a real process gap — noted so it isn't repeated) but
the drift it caused is fully accounted for and restamp-admissible.

## Layer 2 — uncommitted, `HEAD` → working tree (`jk_bms.js` only; `batterylifepo4.yaml` is byte-identical to `HEAD`)

| # | File | Logical key(s) | Address | Previous state | Current state | Evidence source | Impact on canonical catalog | Restamp admissible | Status |
|---|---|---|---|---|---|---|---|---|---|
| 2.1 | `jk_bms.js` | `control_override_reason` | n/a (mock-only `text_sensor`, not in production YAML) | not registered via `registerEntity()` | `registerEntity("control_override_reason", "text_sensor", "control override reason", "control_override_reason")` added | P1-05 session change | **not yet reflected** in `protocol/non_register_entities.canonical.json` — this is a real, already-tracked, open defect (leaks into Settings' non-register exclusion set) | Yes, for the fingerprint specifically (the key exists in `jk_bms.js` either way) | UNVERIFIED — pre-existing open defect, explicitly out of scope for this Gate-1-only corrective pass per instruction; belongs to Stage 5 |
| 2.2 | `jk_bms.js` | `diagnosticUnit()` regex | n/a | `/^cell_\d+_wire_resistance$/`, capacity key `total_charging_cycle_capacity` | `/^cell_resistance_\d+$/`, capacity key `cycle_capacity` | P1-05: these are the real `registerEntity()`-registered keys (verified against `registerEntity()` call sites, not YAML `id:`) | none — bug fix aligning a display-unit lookup to the real key, no register/address change | Yes | NOT_APPLICABLE |
| 2.3 | `jk_bms.js` | `DIAGNOSTIC_ENTITY_ORDER`, `diagnosticNumberedSeries()`, `diagnosticEntityLabel()` regexes | n/a | `cell_(\d+)_wire_resistance`, `temperature_sensor_(\d+)`, `total_charging_cycle_capacity` | `cell_resistance_(\d+)`, `temperature_(\d+)`, `cycle_capacity` | same as 2.2 | none | Yes | NOT_APPLICABLE |
| 2.4 | `jk_bms.js` | `DIAGNOSTIC_ENTITY_LABELS` (EN+UK) | n/a | ~7 stale/wrong keys (e.g. `battery_state_elapsed`, `bms_display_name`, `charge_status_time_elapsed`) that matched no real `registerEntity()` key; ~29 real keys entirely missing (`charging_active`, `topology_state`, `cellcount_tx_id`, etc.) | corrected to the real keys; missing entries added, both languages | P1-05: cross-checked every entry against `registerEntity()` call sites via `dictionaryGaps()` in `test/protocol_catalog/test_entity_id_collision.js` (16 checks, 0 failed) | none — display-label dictionary only, no register/address/encoding claim | Yes | NOT_APPLICABLE |
| 2.5 | `jk_bms.js` | `NON_REGISTER_ENTITY_IDS` | n/a | hand-typed 41-entry array (had drifted: wrong keys silently matched nothing, letting real non-register entities leak into Settings — the defect `HARDWARE_AUDIT_2026-09-09.md` observed) | `new Set(PROTOCOL_CATALOG.nonRegisterKeys)` — derived from the same generated catalog `blockedWriteKeys` already comes from | P1-04: `test/protocol_catalog/test_blocked_write_surface.js` (98/98) | none — sourcing change only; makes this class of drift structurally impossible for every key that IS in `non_register_entities.canonical.json` (2.1's `control_override_reason` is the one key not yet added there) | Yes | NOT_APPLICABLE |
| 2.6 | `jk_bms.js` | cell-resistance card unit comment (Cells tab) | n/a | comment referenced the old (wrong) regex | comment updated to reference the corrected regex | same as 2.2 | none — comment only | Yes | NOT_APPLICABLE |

**Layer 2 conclusion:** every uncommitted change is either a pure
display/label correction that now matches the real `registerEntity()`-
registered key (verified independently against call sites, not against
YAML `id:` — the mistake self-corrected earlier this session), a sourcing
refactor with no behavioral change to the excluded-key set itself, or the
one already-known, already-open, out-of-scope `control_override_reason`
non-register-classification gap (item 2.1), which this review does not
close — it is explicitly Stage 5 scope, and the instruction for this
corrective pass is not to touch Settings/Diagnostics beyond what Gate 1
itself requires.

## Overall conclusion

No change identified in either layer alters register address, word width,
scale, offset, signedness, min/max/step, mask/shift, packed-sibling
membership, or canonical `effective_access`. A fingerprint restamp is
therefore admissible for the current implementation state as a whole,
**strictly as a drift-detector resync** — it does not upgrade, and must
never be described as upgrading, any field's protocol-verification status.
The one open non-register-classification gap (2.1) remains tracked and
open, unaffected by whether the fingerprint itself is current.

This review's own currency (not just its conclusion) is what the fingerprint
CLI's `review`/`accept` modes verify mechanically — see `protocol/README.md`
and `tools/protocol/fingerprint.js` (Work 2 of the Stage 1 corrective pass).

## Addendum 2026-09-25 — item 2.1 resolved

Item 2.1 above is left as originally recorded. Resolution:
`control_override_reason` is now in `protocol/non_register_entities.canonical.json`
with the new schema category `mock_backend_only`. Runtime evidence at
resolution time: production `batterylifepo4.yaml` and `components/` have no
publisher; only `demo/mock-server.js` publishes it (consumed by
`test/topology/run.js`). The generated `PROTOCOL_CATALOG.nonRegisterKeys`
now carries it, so `NON_REGISTER_ENTITY_IDS` routes it to Diagnostics'
read-only software-variable list and never to the Settings register list.
There is no second exclusion list. Regression:
`test/protocol_catalog/test_diagnostic_software_variables_scroll.js` (the
control_override_reason section) and `test/register_catalog/validate.js`.
