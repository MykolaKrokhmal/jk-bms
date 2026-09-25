# Protocol and runtime architecture (current)

**Status: AUTHORITATIVE description of the current architecture**, verified
against the code at the 2026-09-25 checkpoint. It replaces the archived
diagram file
[`docs/archive/reports/ARCHITECTURE_DIAGRAMS_2026-09-10.md`](../archive/reports/ARCHITECTURE_DIAGRAMS_2026-09-10.md),
which predates the generated read plan and the Stage 4 write endpoint. Why
the protocol catalog is built this way is recorded in
[`docs/adr/0001-protocol-catalog.md`](../adr/0001-protocol-catalog.md). How to
run the generators is in [`protocol/README.md`](../../protocol/README.md).

## Artifact roles

| Role | Files | Edited by |
|---|---|---|
| Official parameter list (V1.1 manifest, 265 params) | `protocol/generated/bms_v1_1_manifest.json` | `protocol/evidence/build_v2_manifest.py` from the V2 workbook |
| Canonical register model (geometry, decode, access, UI, evidence) | `protocol/registers.canonical.json` | hand (validated by schema + `tools/protocol/lib/semantic-checks.js`) |
| Canonical non-register entities (calculated/ESP32/browser/local/mock) | `protocol/non_register_entities.canonical.json` | hand |
| Canonical write-only service actions | `protocol/service_actions.canonical.json` | hand |
| Blockers and write evidence | `protocol/evidence/protocol_blockers.json`, `protocol/evidence/hardware_verified_writes.json` | hand |
| Evidence sources and indexes | `protocol/evidence/sources.json`, `*_index.json` | sources hand; indexes by `pipeline.js` |
| Schemas | `protocol/schema/*.json` | hand |
| Manifest ↔ canonical join (by wire position, shared matcher) | `stage3_status_map.json`, `stage4_rw_inventory.json`, `settings_view_model.json` | generators in `tools/protocol/authoring/` |
| Read plan (blocks, cadence, decode) | `read_plan.json`, `read_plan.yaml`, `read_plan_decode.h` | `tools/protocol/generate_read_plan.js` |
| Write registry (Stage 4 submit surface) | `write_registry.json`, `write_registry.yaml`, `write_registry_table.h` | `tools/protocol/generate_write_registry.js` |
| Service-action registry | `stage5_service_action_*` | `build_stage5_service_actions.js` |
| Browser routes (key ↔ ESPHome entity) | `protocol_entity_routes.json` + `jk_bms.js` generated block | `build_protocol_entity_routes.js` |
| Browser catalog (`PROTOCOL_CATALOG`: fieldMeta, nonRegisterKeys, labels) | `jk_bms.js` generated block, `register_catalog.json` | `tools/protocol/generate.js` |
| Claim matrix and coverage | `claim_matrix.json`, `coverage_report.md` | `pipeline.js` / `generate.js` |

Never hand-edit a generated artifact. Every generator has a `--check` mode,
and `pipeline.js check` verifies the whole derived set.

## Runtime flow

**Read and publish.** `jk_poll_scheduler` services the generated read plan
(`protocol/generated/read_plan.yaml`, included by `batterylifepo4.yaml` as
package `register_reads`) with FC03 block reads. `read_plan_decode.h` decodes
each field, and `publish_state()` goes to that key's single template entity.
Keys excluded from the generated plan (`read_plan.json` →
`excluded_bespoke_keys`: cell blocks, clustered totals, reserved bytes) are
read and published by bespoke YAML/C++ drivers. After a successful read of a
generated block, the firmware publishes `read_plan_success` and updates the
`/settings/read-freshness` snapshot.

**Consumers.** Every non-internal ESPHome entity goes to both:
- **Home Assistant** through the native API;
- **the browser** through `web_server` v2 `/events` (SSE) →
  `ingestPayload()` → `state[key]`. Routing uses the generated
  `PROTOCOL_ENTITY_ROUTES`, which covers every register field and every
  production-published non-register entity (from its
  `esphome_configured_name`), with collisions rejected at generation time.
  The only hand `registerEntity()` is the mock-only `control_override_reason`.
  Backend-published calculated values (e.g. cell-voltage extremes, charge and
  discharge splits) are authoritative in the browser, exactly as in HA.

There is no browser polling of register data. The only HTTP reads are the
freshness snapshot when the SSE connection opens, and the write-transaction
status calls.

**Freshness.** Each Settings value is fresh only when its read block succeeded
within its `freshness_budget_s`, the BMS link health (`bms_health`) is
observed LIVE/DELAYED, and the browser link is connected. Before the first
valid `bms_health`, values are `pending`, not offline. Only `kind === "fresh"`
values can be submitted.

**Writes.**
- **Stage 4 registry keys:** preflight
  `GET /settings/register-write/preflight` → `POST /settings/register-write`
  (returns `request_id`) → `GET /settings/register-write/status` (returns
  `tx_id`). Then the firmware's write transaction manager
  (`components/jk_write_tx/`) does a read-modify-write for packed registers,
  an authoritative readback, and publishes the terminal state in
  `write_tx_snapshot` over SSE.
- **The 18 legacy keys:** these still post to ESPHome
  `/number/set_<key>/set` (see CURRENT_LIMITATIONS L8).
- **Service actions:** blocked, with no endpoint.
