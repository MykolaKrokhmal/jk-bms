# Current known limitations

**Status: AUTHORITATIVE list of known limitations, re-verified on 2026-10-01.
Deployed production firmware: `bfa2b44` (M5+M6+M7) plus the owner's local
overlay, deployed 2026-10-01. Runtime evidence:
`protocol/evidence/stage1_corrective_evidence/m5_production_runtime_20261001.md`
(M5 on `3ee3f36`) and `protocol/evidence/stage1_corrective_evidence/m6_m7_production_runtime_20261001.md` (M6/M7).** Each entry names the
machine-readable source it was checked against, so it can be re-verified
rather than trusted. The old `OPEN_ISSUES.md` register is archived at
[`docs/archive/reports/OPEN_ISSUES_2026-09-15.md`](../archive/reports/OPEN_ISSUES_2026-09-15.md);
its entries were not all revalidated and are **not** a queue.

Planned fixes are in
[`RS485_UNIFIED_PARAMETER_PIPELINE_PLAN.md`](RS485_UNIFIED_PARAMETER_PIPELINE_PLAN.md)
(stage numbers below refer to it).

## Pipeline and runtime-model gaps (software, no hardware needed)

| # | Limitation | Where it shows | Source to re-check | Plan |
|---|---|---|---|---|
| L1 | **Closed by Stage 1 (2026-09-25).** The 9 production diagnostics (`display_cell_count`, the wire-resistance capability/attempt keys) and `read_plan_success` (category `protocol_infrastructure`) are now canonical non-register entities. `test/protocol_catalog/test_runtime_key_space.js` rejects any future unclassified runtime key. Remaining note: `read_plan_success` is still a non-internal ESPHome entity and therefore visible in HA (firmware unchanged). | — | `test_runtime_key_space.js` | done |
| L2 | **Closed by M6; deployed in `bfa2b44` (2026-10-01).** The 98 bespoke-read runtime keys have no read-plan block of their own: 32 cell voltages, 32 cell resistances, 32 CellConWireRes and `min/max_voltage_cell_index_native`. They now take freshness from a successful physical read of the cluster that contains their register: A1 for 66 keys, and C1 (26) or C2 (6) for CellConWireRes. (`reserved_0x12d2` also has no block and resolves to A1, but it is catalog-only: no route, no entity and no UI. It is outside this contract and nothing consumes its freshness.) Cluster geometry comes from the firmware's `/settings/read-freshness` snapshot. `stateUpdatedAt` (SSE arrival) is removed. A cluster latched to fallback fails closed (stale, with the reason), because the bespoke fallback readers publish no success event | — | `test_settings_catalog.js` (M6 checks, including the fallback scenario) | done in repository; deploy `jk_bms.js` |
| L3 | **Closed by Stage 2 (2026-09-25).** The 8 calculated keys (`charging_power`, `discharging_power`, `charging_current`, `discharging_current`, `min_cell_voltage`, `max_cell_voltage`, `min_voltage_cell`, `max_voltage_cell`) are routed from canonical data and reach browser state through `ingestPayload`. The Cells panel's voltage Min/Max, extreme-cell highlight and spread now show these backend values (the same ones HA receives), never a browser recomputation. | — | `test_entity_route_publishers.js` | done |
| L4 | Route duplication **closed by Stage 2**: every canonical key's route is generated (`PROTOCOL_ENTITY_ROUTES`); the only hand `registerEntity()` is the mock-only `control_override_reason`. **Still open:** `DIAGNOSTIC_ENTITY_LABELS` duplicates canonical labels (canonical `fieldMeta` labels win first; the dictionary is a fallback) | maintenance/drift risk | `jk_bms.js` `DIAGNOSTIC_ENTITY_LABELS` vs generated `fieldMeta` | Stage 3 |
| L5 | Write readiness has three uncomposed axes: `claim_matrix.json` (all fields `write_readiness: blocked`), canonical `effective_access` + `owner_write_override`, and Stage 4 state + `protocol/evidence/hardware_verified_writes.json` | confusing readiness reports | those three files | Stage 5 |
| L6 | `stage3_status_map.json` reports the six width-established Stage 5 commands as `missing`, because its generator does not read `service_actions.canonical.json` | stale status | `protocol/generated/stage3_status_map.json` | Stage 5 |
| L7 | Six internal raw read-plan sensors are republished to HA/browser by hand-written template `binary_sensor`s (a second, hand-maintained transform layer) | maintenance risk | `read_plan.json` fields with `internal: true`; `batterylifepo4.yaml` template binary sensors | Stage 6 |
| L8 | **Closed in M5 and deployed (`3ee3f36`, 2026-10-01); writes not yet hardware-validated.** All 18 former legacy Settings writes use the generated write registry and `/settings/register-write`. The second browser encoder and the editable Configuration register path are removed. Each row writes only after its own OK, with NO_CHANGE, ACK and forced readback. The production build compiled on ESPHome 2026.9.1. Since M7 (deployed in `bfa2b44`, production-verified 2026-10-01) a C1/C2 write additionally needs a physical read inside this page's active Settings lease, within the 3.5 s active budget. **Settings writes stay prohibited by owner decision until Gate D** (after M6–M8, per-field approval) | write runtime validation | `protocol/generated/write_registry.json`; `test_settings_catalog.js`; `test_write_registry_ui.js` | clustered-read sub-plan M5/M8 |
| L9 | `protocol/generated/read_plan.yaml`'s header comment still says it is "NOT YET !include'd"; it is included at `batterylifepo4.yaml` (`packages: register_reads`) | misleading comment | generator module comment in `tools/protocol/generate_read_plan.js` | next generator touch |
| L12 | **Closed and deployed (`3ee3f36`, 2026-10-01).** Seven verified wide clusters with latched narrow/bespoke fallback. Gate A verified the geometry. Production runtime observation (534.7 s): exact 1 s / 15 s cadence, `missed = 0`, no fallback, no reset, BMS `LIVE`. **Combined Gate C PASSED (2026-10-01, owner decision, one documented 60 ms `interval` exception):** 3200 FC03 reads (A1/A2 1200, C1/C2 400), 0 errors, `missed = 0`, `over1.5x = 0`, constant `queue_ms` (`protocol/evidence/stage1_corrective_evidence/gate_c_20261001.md`). **Still open (observation only):** production main-loop `modbus took a long time` warnings (252 ms in the M5 window, 159 ms during an SSE initial burst after the restore); the probe itself showed none | production main-loop blocking | Gate A, M5/M6-M7 production and Gate C evidence | M8/M9 observation |
| L13 | **Closed and deployed (`3ee3f36`, 2026-10-01).** The setup passcode is outside every cluster/cache/snapshot and is read only on explicit request; its isolated transaction participates in bus ownership. No production caller currently requests it. The production observation showed block `0x1470` never read | — | `read_clusters.canonical.json`; `jk_cluster_runtime_core.h`; M5 corrective evidence | clustered-read sub-plan M5 |
| L14 | Two legacy compiler warnings, present since before M5 (`8fbe54f`) and recorded in the M5 production build log: `components/jk_diag/jk_reset_diag_rtc.h:90` (`-Wextra`, enumerated and non-enumerated type in a conditional expression) and `batterylifepo4.yaml:5425` (line 5438 before `bfa2b44`; `-Waddress`, an always-true NULL check of `total_runtime_in_seconds`). Neither changes runtime behaviour; not fixed yet | compile log noise | M5 production runtime evidence (compiler warnings) | next touch of those files |
| L10 | **Closed (security remediation, 2026-09-25).** `setup_passcode`'s canonical read metadata now names its real read entity, `setup_passcode_status` (`esphome_read_domain: text_sensor`). That entity publishes only a content-independent `hidden` status, and the read-plan generator no longer overrides this field. Write-side metadata is unchanged. `test_entity_id_collision.js` checks strictly with no exception | — | `test_credential_redaction.js`, `test_entity_id_collision.js` | done |
| L11 | **Closed (2026-09-25).** `demo/mock-server.js` publishes `display_cell_count` (`sensor-display_cell_count`) on every topology resolve, from its CellCount register with production's `channel_count_from_configured()` rule (1..32, else 0). The real mock → SSE → `ingestPayload` → `renderCells()` path is tested for 8S, 16S and the 0 boundary | — | `test/topology/run.js` (L11 checks) | done |

## Security: setup passcode exposure (remediated; firmware deployed 2026-09-25)

- **What happened:** earlier generated firmware decoded the BMS setup passcode
  (register 0x1470) and published it on a non-internal `text_sensor`
  (`setup_passcode_readback`). It reached Home Assistant (native API, and
  likely its recorder history), the web UI's SSE stream, Settings
  (`PWD_Config`) and Diagnostics. The values also ended up in four committed
  hardware SSE captures.
- **Code remediation:**
  - Credential-class fields are never decoded or published: the read plan
    publishes only a constant `hidden` status (`setup_passcode_status`).
  - The browser drops any payload from the retired entity, and masks every
    credential key before diagnostics and state. Settings and Diagnostics
    render a localized "Hidden" marker.
  - The repository secret scan has a structural detector for readback records,
    including files over 2 MB.
  - Write authorization, password masking and the fail-closed passcode write
    path are unchanged.
  - Tests: `test_credential_redaction.js` (artificial sentinel), plus rendered
    checks in `test_settings_catalog.js` and
    `test_diagnostic_software_variables_scroll.js`.
- **History:** the four affected captures were redacted in local history, a
  targeted rewrite with only the readback records changed. No affected commit
  had been pushed. The old local objects were pruned.
- **Device:** the remediated firmware (`be99c96`, contained in the later
  owner-confirmed deployment `8fbe54f`) was deployed to the test
  ESP32 on 2026-09-25. A read-only check confirmed that the retired entity no
  longer publishes and that `setup_passcode_status` publishes only `hidden`
  (see `docs/guides/BUILD_AND_DEPLOY.md` -> "Deployed baseline").
- **Still pending (owner actions, in this order):**
  1. Rotate the BMS setup passcode (owner decision; never by an agent).
  2. Clean the old value from Home Assistant's recorder/history (the retired
     `setup passcode readback` entity).

## Security: web authentication disabled on the development device (temporary exception)

- **Finding (2026-09-25, kept on record):** a read-only check of the deployed
  test ESP32 found that no endpoint required authentication -- `/`, `/0.js`,
  `/events`, `/history.json`, `/charge_history.json`,
  `/settings/read-freshness` and the `/settings/register-write*` handlers
  all answered without credentials and without a `WWW-Authenticate`
  challenge. The repository's `batterylifepo4.yaml` still configures
  `web_server: auth: type: digest`, and an agent's 2026-09-25 compile of it
  (ESPHome 2026.8.2) did enable digest auth.
- **Cause and decision:** the owner commented out `web_server.auth` in their
  local deployment copy and defers web authentication for the development
  phase. This is an owner-accepted, **development-only** exception, not a
  repository change: the device must stay on a trusted development network,
  and anyone on that network can read telemetry and reach the write
  handlers.
- **Before any non-development deployment:** restore the `auth:` block in the
  deployed YAML, recompile, and re-run the unauthenticated-GET check (every
  protected endpoint must answer 401).

## Write and hardware-evidence limits

- Write states per key are in
  [`protocol/generated/stage4_rw_inventory.json`](../../protocol/generated/stage4_rw_inventory.json)
  (`stage4_state`). Only `write-hardware-verified` rows have real-hardware
  write evidence; `write-software-ready` rows are implemented but not
  hardware-verified; `blocked` rows carry `blocked_reason` and
  `blocker_closure_criterion`.
- **`gps_heartbeat`: verified only for value 0.** Writing `1` ended in a real
  terminal MISMATCH ("BMS reports No") on `JK_PB1A16S15P`; the cause is
  unknown. The owner deferred this to the final stages: do not retry `1`, and
  never call that direction hardware-verified. Full note:
  [`docs/archive/claude/HANDOFF_2026-09-25.md`](../archive/claude/HANDOFF_2026-09-25.md)
  (first section).
- All Stage 5 service actions are blocked (see
  [`protocol/generated/stage5_service_action_inventory.json`](../../protocol/generated/stage5_service_action_inventory.json)).
  Every repository-local payload source has been checked and recorded
  (`protocol/service_actions.canonical.json` evidence). Closing a blocker
  needs an official clarification or a controlled, owner-approved capture.
  Service actions must never be executed without explicit owner permission.
- Real dynamic-topology changes (e.g. 16↔8), fault behaviour (BMS/Wi-Fi
  loss, protection trips), and power-loss/OTA recovery have not been
  hardware-tested; the deployed unit is observed as 16S.

## Platform limits

- 60-hour history is RAM-only in production: the history endpoints exist, but
  the LittleFS persistence component (`components/jk_history`) is not
  included by `batterylifepo4.yaml`. The isolated proof of concept is
  `test/littlefs_poc/`.
- There is no browser end-to-end suite: UI behaviour is tested with
  real-closure DOM harnesses under Node (project policy: no third-party
  dependencies).
- The private V1 workbook is optional input; without it the pipeline runs
  self-contained and the workbook-dependent checks are skipped (see
  `CLAUDE.md`).
