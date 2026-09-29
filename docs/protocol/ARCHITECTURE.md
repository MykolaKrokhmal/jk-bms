# Protocol and runtime architecture (current)

**Status: AUTHORITATIVE description of the current repository architecture**,
re-verified against host candidate `c83a676` on 2026-09-30. The last
owner-confirmed deployed firmware remains `8fbe54f`; where the two differ,
this document says so explicitly. It replaces the archived
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
| Read clusters (geometry, cadence, priority, passcode exclusion) | `read_clusters.canonical.json`, `read_clusters.json`, `read_clusters_table.h` | canonical hand; outputs by `generate_read_clusters.js` |
| Write registry (Stage 4 submit surface) | `write_registry.json`, `write_registry.yaml`, `write_registry_table.h` | `tools/protocol/generate_write_registry.js` |
| Service-action registry | `stage5_service_action_*` | `build_stage5_service_actions.js` |
| Browser routes (key ↔ ESPHome entity) | `protocol_entity_routes.json` + `jk_bms.js` generated block | `build_protocol_entity_routes.js` |
| Browser catalog (`PROTOCOL_CATALOG`: fieldMeta, nonRegisterKeys, labels) | `jk_bms.js` generated block, `register_catalog.json` | `tools/protocol/generate.js` |
| Claim matrix and coverage | `claim_matrix.json`, `coverage_report.md` | `pipeline.js` / `generate.js` |

Never hand-edit a generated artifact. Every generator has a `--check` mode,
and `pipeline.js check` verifies the whole derived set.

`syssi/esphome-jk-bms` is a pinned upstream provenance/evidence reference,
not a production runtime dependency. Production contains no active
`external_components` entry for it. `batterylifepo4.yaml` is a substantially
modified descendant of the pinned example; attribution and the applicable
Apache-2.0 license copy are recorded in `THIRD_PARTY_NOTICES.md` and
`LICENSES/Apache-2.0.txt`. The upstream reference and this implementation
share `syssi_implementation_family`, so they never count as independent
evidence groups.

## Runtime flow

**Read and publish (repository M5 candidate).** `jk_cluster_runtime` services
the seven generated FC03 clusters A1/A2, C1/C2 and S1–S3 from
`read_clusters_table.h`, one request in flight. Exact-length responses enter
the cluster cache; `read_plan_decode.h` decodes every contained canonical
block at its generated offset, and `publish_state()` goes to that key's
single template entity. Three consecutive failures latch that lead group for
the boot session to its generated narrow blocks and the pre-M5 bespoke cell /
calibration readers. The setup passcode is outside every cluster and cache
and has only an isolated on-demand read. Each successful physical read
publishes `read_plan_success` and advances `/settings/read-freshness`.

The deployed `8fbe54f` firmware still uses the earlier per-address generated
scheduler plus bespoke readers. M5 has passed host verification but has not
been compiled with ESPHome or run on the device.

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

**Browser link.** The page owns the SSE connection: exactly one EventSource
at a time, tagged with a generation so a superseded one cannot change state;
errors retry with capped backoff (1 s → 30 s); a progress watchdog (any event,
including ESPHome's ~10 s ping) treats a silent stream as lost after 30 s; and
page resume signals (visible, pageshow, resume, online, a late timer tick)
probe the link at once. After a reconnect, Settings becomes writable only
when the new connection has delivered its own valid `bms_health` and a
read-block success newer than the loss boundary. No reconnect reloads the
page or touches drafts.

There is no browser polling of register data. The only HTTP reads are the
freshness snapshot (when the SSE connection opens, and again after evidence
that success events were coalesced in transit -- see below), and the
write-transaction status calls.

**Freshness.** The M5 firmware candidate publishes cluster successes as
`<cluster>:<revision>:<sequence>` and fallback successes in the earlier
`<address>:<revision>:<sequence>` form. Its snapshot includes the effective
cluster mode, cadence and budget. The sequence detects SSE coalescing; the
browser then re-reads the read-only snapshot at most once per 5 s, one request
at a time plus one trailing run, and merges only forward.

The browser migration is not complete: Settings still uses the pre-migration
per-group budgets and the cell keys still fall back to their SSE arrival time
(M6); no browser caller activates the 3 s Settings lease yet (M7). Firmware
RMW is stricter: it accepts cluster or narrow-fallback raw only within the
3.5 s active budget and otherwise requests a physical pre-read. Before the
first valid `bms_health`, values are `pending`, not offline; only
`kind === "fresh"` browser values can submit.

**Writes (repository M5 candidate).**
- **All live Settings keys:** preflight
  `GET /settings/register-write/preflight` → `POST /settings/register-write`
  (returns `request_id`) → `GET /settings/register-write/status` (returns
  `tx_id`). Then the firmware's write transaction manager
  (`components/jk_write_tx/`) does a read-modify-write for packed registers,
  an authoritative readback, and publishes the terminal state in
  `write_tx_snapshot` over SSE. Editing changes only the row-local draft; its
  own OK starts the transaction. All 18 former legacy Settings keys are now
  in this same registry, for 23 live fields total. Equal raw values terminate
  as `NO_CHANGE` without creating a Modbus command. A real write targets only
  that field's owning register (1 or 2 registers), never a read cluster.
- **HA entity writes:** use the same tracked RMW/equality gate and write
  transaction manager. In latched fallback the pre-read is the exact narrow
  source block.
- **Service actions:** blocked, with no endpoint.

The unified M5 write path is host-tested only. Production compile and the
owner-authorized Gate D write matrix remain open.
