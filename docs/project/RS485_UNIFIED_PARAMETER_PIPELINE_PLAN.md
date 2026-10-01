# RS485 Unified Parameter Pipeline — active plan

**Status: AUTHORITATIVE — this is the current implementation plan.** Agreed with
the owner on 2026-09-25. Every earlier roadmap/plan/prompt file lives under
[`docs/archive/`](../archive/README.md) and is historical, not a queue.

## Objective

Every supported JK BMS parameter has an evidence-backed definition, is read and
decoded correctly, has one authoritative current value, and is shown and
managed in Settings and exposed to Home Assistant from that same value.
Writable parameters stay fail-closed until their full write contract is
established and verified.

```
evidence + canonical model  (protocol/*.canonical.json, manifest, blockers)
  → generated read/write/runtime contract (read_plan.*, write_registry.*, PROTOCOL_CATALOG,
                                           PROTOCOL_ENTITY_ROUTES, SETTINGS_VIEW_MODEL)
  → RS485 read + decode (jk_poll_scheduler + generated decode, or a bespoke driver)
  → exactly one ESPHome entity per key, one publish_state()
  → Home Assistant (native API)  and  browser (web_server /events SSE → ingestPayload)
```

"One authoritative current-state window" means: one canonical key per logical
parameter, one ESPHome entity and publication path per key, one freshness
source per key (a successful physical block read), and Settings and HA both
consuming that entity. Presentation formatting stays in each consumer;
decoding and state truth do not. HA and the browser cannot share a literal
runtime object, so the shared thing is the ESPHome entity plus one generated
key contract used by both YAML generation and browser routing. No browser
polling — the SSE push architecture stays.

What already satisfies this design is described in
[`docs/protocol/ARCHITECTURE.md`](../protocol/ARCHITECTURE.md); the concrete
gaps each stage closes are listed in
[`CURRENT_LIMITATIONS.md`](CURRENT_LIMITATIONS.md).

## Safety invariants (apply to every stage)

- No guessed protocol geometry and no fabricated payload values; ambiguity is
  recorded as `null` + note.
- Writes stay fail-closed; only `kind === "fresh"` Settings values may submit.
- Freshness comes from successful physical reads, not from SSE arrival.
- No extra RS485 traffic unless a missing read justifies it.
- No service-action execution; `gps_heartbeat=1` is deferred and must not be
  retried or called hardware-verified.
- No hardware write, compile or flash without separate, explicit owner
  approval for that step.
- Generated artifacts are never hand-edited; each stage regenerates, passes
  every `--check`, `pipeline.js check`, the fingerprint workflow when covered
  code changes, and the full `bash test/run_all.sh`.

## Architecture-migration sub-plan

The read architecture is being migrated from one FC03 read per register
address to a small set of wide clusters. That work has its own active
sub-plan:
[`RS485_CLUSTERED_READ_MIGRATION_PLAN.md`](RS485_CLUSTERED_READ_MIGRATION_PLAN.md).
Gate A verified the conservative cluster geometry on 2026-09-28, and M2–M4
are done. M5 (`3ee3f36`) was compiled with ESPHome 2026.9.1 and deployed on
2026-10-01. M6/M7 followed in `bfa2b44` and M8 in `3e1981c` the same day
(M8 audit: `protocol/evidence/stage1_corrective_evidence/m8_production_runtime_20261001.md`). Their read-only runtime audits passed
(`protocol/evidence/stage1_corrective_evidence/m6_m7_production_runtime_20261001.md`). A read-only production observation found exact cluster cadence,
no fallback and no reset
(`protocol/evidence/stage1_corrective_evidence/m5_production_runtime_20261001.md`).
By owner decision the formal Gate B metrics were folded into one combined
Gate C, which passed on 2026-10-01 (`protocol/evidence/stage1_corrective_evidence/gate_c_20261001.md`). M8 and Gate D remain open, and
Settings writes stay prohibited until Gate D passes.
Stage 4 below (freshness from physical reads for the bespoke cell keys) is
delivered by that sub-plan's step M6, unless the owner decides otherwise.

## Stages

Each stage is one logical commit and must change code, a generator, a test or
runtime behaviour — no audit-only stages.

### Stage 1 — Classify every runtime key into one canonical source — DONE (2026-09-25)

> Implemented on `codex/rs485-unified-pipeline`: canonical entries for the 10 keys
> (with `read_plan_success` as category `protocol_infrastructure`), the exhaustive
> invariant `test/protocol_catalog/test_runtime_key_space.js`, and real-render
> coverage in `test_diagnostic_software_variables_scroll.js`.

- **Objective:** every key the browser can route (generated
  `PROTOCOL_ENTITY_ROUTES` plus any hand `registerEntity()`) belongs to exactly
  one of `registers.canonical.json`, `non_register_entities.canonical.json`,
  `service_actions.canonical.json`.
- **Keys:** the 9 production entities outside both canonical sources
  (`display_cell_count`, `cell_wire_resistance_ext_capability`,
  `cell_connection_wire_resistance_{capability,last_outcome,queued_count,callback_count,last_response_bytes,attempt_started_uptime_s,attempt_ended_uptime_s}`)
  plus the infrastructure entity `read_plan_success`.
- **Inputs:** `protocol/non_register_entities.canonical.json`, the YAML
  publishers of those entities.
- **Outputs:** generated `PROTOCOL_CATALOG.nonRegisterKeys`.
- **Files:** the non-register canonical file, `test/register_catalog/validate.js`
  or the routing test, the diagnostic render test.
- **Tests/invariants:** a total key-space invariant that fails on today's
  state with exactly these keys; a real-render test that they appear in the
  Diagnostics software list and not the Settings register list;
  `display_cell_count` still drives 16S visibility; register/non-register
  key sets stay disjoint.
- **Done when:** the invariant passes, and all gates are green.
- **Hardware:** none.

### Stage 2 — Generate non-register routes; remove hand route duplication — DONE (2026-09-25)

> Implemented on `codex/rs485-unified-pipeline`. Non-register canonical entries
> gained `esphome_configured_name` / `esphome_yaml_id` (from the real publishers).
> `build_protocol_entity_routes.js` now routes them too, and refuses to generate
> if any wire form would collide. All hand `registerEntity()` calls for
> canonical keys are removed; only the mock-only `control_override_reason`
> remains. Route parity against the pre-change resolution: 0 changed, 0
> collisions. The lost ids were only wrong-domain `number/…` forms that no
> production entity publishes. All 266 wire ids in the committed hardware
> captures resolve. Two evidence-backed corrections: `write_tx_snapshot`'s
> domain (`text_sensor`) and a new `esphome_read_domain` (`sensor`) for the 32
> RW wire-resistance channels, whose read route had wrongly used their write
> domain `number`. **Owner decision (2026-09-25):** the browser consumes
> backend-published calculated values as authoritative, matching HA. The Cells
> voltage Min/Max/extreme cells/spread now use them. Tests:
> `test_entity_route_publishers.js`, plus updated `test_protocol_entity_routes.js`
> and `test_entity_id_collision.js`.

- **Objective:** routes for non-register entities come from canonical data;
  hand `registerEntity()` calls for canonical keys are removed.
- **Inputs:** non-register schema gains the ESPHome configured name (the value
  moves once from `jk_bms.js` into canonical data).
- **Outputs:** `PROTOCOL_ENTITY_ROUTES` covers register and non-register keys.
- **Files:** `tools/protocol/authoring/build_protocol_entity_routes.js`,
  `protocol/schema/non-register-source.schema.json`, the non-register
  canonical file, `jk_bms.js`.
- **Tests/invariants:** no hand `registerEntity()` for any canonical key; every
  route resolves to exactly one non-internal ESPHome entity of the same
  domain; the 8 calculated keys HA already receives
  (`charging_power`, `discharging_power`, `charging_current`,
  `discharging_current`, `min_cell_voltage`, `max_cell_voltage`,
  `min_voltage_cell`, `max_voltage_cell`) become routed in the browser.
- **Done when:** the hand route list for canonical keys is empty.
- **Hardware:** none. **Owner decision pending:** whether the browser should
  use these backend values instead of computing its own.

### Post-Stage-2 consistency follow-up (2026-09-25)

- **Security:** setup-passcode exposure remediated in code (credential fields
  are status-only, retired publisher dropped, browser masking, strengthened
  secret scan, local history redacted). L10 is closed. Device flash, then
  passcode rotation, then HA history cleanup remain owner actions (see
  `CURRENT_LIMITATIONS.md`).
- **L11:** the mock publishes `display_cell_count` with production semantics.
  The demo Cells tab renders the configured active cells, and backend min/max
  stay authoritative. L11 is closed.

### Stage 3 — One label source

- **Objective:** `DIAGNOSTIC_ENTITY_LABELS` no longer duplicates canonical
  labels; labels come from generated `fieldMeta`.
- **Files:** `jk_bms.js`, `tools/protocol/generate.js` if needed.
- **Tests/invariants:** no hand label for any canonical key; UK/EN labels
  unchanged for every key (a snapshot comparison).
- **Hardware:** none.

### Stage 4 — Freshness from successful physical reads for bespoke fields

> Planned to be delivered by the clustered-read sub-plan, step M6
> ([`RS485_CLUSTERED_READ_MIGRATION_PLAN.md`](RS485_CLUSTERED_READ_MIGRATION_PLAN.md)).

- **Objective:** the 98 bespoke-read keys (96 cell channels plus
  `min_voltage_cell_index_native` / `max_voltage_cell_index_native`) are fresh
  only after a successful read of their physical block, not on SSE arrival.
- **Inputs:** canonical register geometry for blocks 0x1200, 0x124A, 0x1088
  and 0x1248.
- **Outputs:** a generated block table for bespoke reads, success events
  through the existing `read_plan_success` / `/settings/read-freshness`
  mechanism, and `fieldMeta.readAddress` set to the physical block.
- **Files:** generator(s), `batterylifepo4.yaml` bespoke read lambdas, desktop
  C++ tests, `jk_bms.js`.
- **Tests/invariants:** unchanged-value SSE alone never refreshes these keys;
  a block success event does.
- **Hardware:** compile and flash for a read-only runtime check — owner
  approval required.

### Stage 5 — One generated write-contract state; Stage 3 service-action composition

- **Objective:** a single composed write state per key, derived from
  `claim_matrix`, `owner_write_override` and `hardware_verified_writes.json`,
  consumed by Settings. `build_stage3_status_map.js` reads
  `service_actions.canonical.json`, so modelled commands stop reporting
  `missing`.
- **Tests/invariants:** Settings shows one state per key; the composed state
  never exceeds its evidence; 0 `missing` entries for modelled commands.
- **Hardware:** none. **Owner decision pending:** which axis is the runtime
  truth (proposal: the composed Stage 4 state, with `claim_matrix` kept as
  evidence detail).

### Stage 6 — Generate raw-to-binary transforms

- **Objective:** the hand template `binary_sensor`s that republish the 6
  internal raw read-plan fields (`charging`, `discharging`, `balancing`,
  `charging_active`, `discharging_active`, `balancing_active`) are generated
  from canonical `esphome_domain` + mask.
- **Tests/invariants:** HA entity IDs and states stay unchanged.
- **Hardware:** compile plus a read-only runtime check — owner approval
  required.

### Stage 7 — Migrate the 18 legacy writes to the unified write registry — DONE ON HOST BY M5

- **Host result (`c83a676`):** the second browser encoder and legacy Settings
  submit path are removed. All 18 former legacy rows use the generated
  registry, one row-local OK and the same NO_CHANGE/ACK/forced-readback flow.
- **Hardware:** the M5 firmware is deployed (`3ee3f36`, 2026-10-01). That is
  not a declaration that the migrated writes were revalidated on the BMS.
  Settings writes stay prohibited until the owner-approved per-field Gate D
  write matrix passes (after M6–M8).

## Open owner decisions

1. The authoritative runtime write axis (Stage 5).
2. ~~Whether the browser consumes the backend's calculated values rather than
   computing its own (Stage 2).~~ Decided 2026-09-25: yes, backend values are
   authoritative.
3. The compile/flash window for Stages 4 and 6 (read-only).
4. The bounded per-field Gate D write matrix for the Stage 7/M5 migration.
5. Whether the "confirmed toggles" UI decision in
   [`DECISIONS.md`](DECISIONS.md) still applies, given that Settings now
   renders binary fields as dropdowns.
6. Whether Codex sessions need a root `AGENTS.md` entry point; the former
   `codex AGENTS.md` is archived under `docs/archive/codex/`.
