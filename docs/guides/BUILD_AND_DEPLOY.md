# Build and deploy (ESPHome / Home Assistant)

**Status: OPERATIONAL GUIDE — current.** Compiling, flashing and OTA are owner
actions. An agent runs none of them without explicit, in-the-moment owner
permission.

## Pinned toolchain

Versions are pinned in [`toolchain.lock.json`](../../toolchain.lock.json)
(ESPHome, ESP-IDF, Node and Python). The same lock also identifies the
`syssi/esphome-jk-bms` upstream reference used for provenance and secondary
protocol evidence; it is not a runtime dependency. Do not restate the
versions elsewhere; read the lock file.

## Compile/runtime file set

These are exactly the files an ESPHome / Home Assistant build of
`batterylifepo4.yaml` consumes. Keep the directory structure intact, because
the paths are relative to the YAML.

| File | Why it is needed |
|---|---|
| `batterylifepo4.yaml` | device configuration |
| `secrets.yaml` | local, never committed; start from `secrets.yaml.example` |
| `jk_bms.js`, `jk_bms.css` | `web_server` `js_include` / `css_include` (served as `/0.js`) |
| `protocol/generated/read_plan.yaml` | `packages: register_reads` |
| `protocol/generated/write_registry.yaml` | `packages: write_registry` |
| `protocol/generated/read_plan_decode.h` | `esphome: includes` |
| `protocol/generated/write_registry_table.h` | `esphome: includes` |
| `protocol/generated/read_clusters_table.h` | `esphome: includes` (clustered reads, M5) |
| `components/jk_write_tx/jk_write_tx_core.h` | `esphome: includes` |
| `components/jk_write_tx/jk_preflight_snapshot_core.h` | `esphome: includes` |
| `components/jk_poll_scheduler/jk_poll_scheduler_core.h` | `esphome: includes` |
| `components/jk_poll_scheduler/jk_cluster_scheduler_core.h` | `esphome: includes` (clustered reads, M5) |
| `components/jk_poll_scheduler/jk_cluster_cache_core.h` | `esphome: includes` (clustered reads, M5) |
| `components/jk_poll_scheduler/jk_cluster_runtime_core.h` | `esphome: includes` (clustered reads, M5) |
| `components/jk_topology/jk_topology_core.h` | `esphome: includes` |
| `components/jk_capability/jk_capability_core.h` | `esphome: includes` |
| `components/jk_diag/jk_reset_diag_core.h` | `esphome: includes` |
| `components/jk_diag/jk_reset_diag_rtc.h` | `esphome: includes` |

No syssi external component is fetched by the production build. The local
`batterylifepo4.yaml` descends from the pinned upstream example and is now a
substantially modified implementation; attribution is in
[`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md) and the applicable
license copy is in [`LICENSES/Apache-2.0.txt`](../../LICENSES/Apache-2.0.txt).
`components/jk_history/` is not part of the production build (see
`docs/project/CURRENT_LIMITATIONS.md`). If `batterylifepo4.yaml`'s
`packages:` / `includes:` / `web_server:` sections change, update this table
in the same commit.

## Deployed baseline (test ESP32)

- **Currently deployed code (2026-10-01, 15:40):** commit `bfa2b44` (M5
  clustered reads, M6 cell freshness and the M7 Settings lease) plus the
  owner-local overlay below.
  - It was applied as an incremental patch from `3ee3f36`.
  - The owner compiled it with ESPHome **2026.9.1** / ESP-IDF 5.5.5: 0
    errors, RAM 59.8 % (108,120 B), flash 68.7 % (1,260,739 B),
    `config_hash=0x5dc113b1`.
  - The owner flashed it by OTA.
  - Source identity:
    - **UI: cryptographic.** `/0.js` equals `jk_bms.js@bfa2b44`.
    - **Firmware: high, not cryptographic.** All 26 warning line numbers
      match `bfa2b44`.
  - The read-only M6/M7 runtime audit passed (`protocol/evidence/stage1_corrective_evidence/m6_m7_production_runtime_20261001.md`). **Settings writes stay
    prohibited until gate D.**
- **Earlier deployment (2026-10-01, 10:46):** `3ee3f36` (M5), with its own
  runtime evidence in
  `protocol/evidence/stage1_corrective_evidence/m5_production_runtime_20261001.md`.
- **Previous deployed code:** `8fbe54f` (`style(settings): replace blocked
  badges with lock affordance`, owner-confirmed 2026-09-27; ESPHome
  2026.9.0). It is the rollback target and contains the security baseline
  `be99c96`, recorded below.
- **Earlier security baseline:** commit `be99c96` (`fix(mock): publish
  configured cell count`, on top of the security fix `70a6aae`). The owner
  transferred the complete 14-file compile/runtime set above (every row
  except the local `secrets.yaml`), compiled it with ESPHome **2026.9.0** in
  the owner's environment and uploaded it to the test ESP32 on
  **2026-09-25**.
- **Owner-local overlay (not in the repository, never committed):**
  - `web_server:` `auth:` is commented out -- a temporary, development-only
    security exception (see `docs/project/CURRENT_LIMITATIONS.md` ->
    "Security: web authentication disabled on the development device");
  - `web_server:` `js_include` / `css_include` point at
    `./jk_bms_ui/jk_bms.js` and `./jk_bms_ui/jk_bms.css`.
- **Path mapping** for every transfer:

  | Repository path | Owner's ESPHome layout |
  |---|---|
  | `jk_bms.js` | `jk_bms_ui/jk_bms.js` |
  | `jk_bms.css` | `jk_bms_ui/jk_bms.css` |
  | every other file in the table above | the same relative path, **but see the note below** |

  The repository keeps `jk_bms.js` / `jk_bms.css` at its root on purpose.

  **Observed 2026-10-01:** the owner's validate log resolved
  `protocol/generated/read_plan.yaml` from
  `/config/esphome/jk_bms_ui/protocol/generated/`. So the owner's local YAML
  also prefixes at least the generated package path with `jk_bms_ui/`. The
  other include paths were not observed.
  - A `batterylifepo4.yaml` patch that adds or changes `packages:` /
    `includes:` lines cannot be applied unchanged.
  - Before such a patch, confirm the owner's actual include paths.
- **Read-only post-deployment check (2026-09-25):** the served `/0.js`,
  gunzipped, is byte-identical to `jk_bms.js` at `be99c96`; the retired
  `setup_passcode_readback` entity is no longer advertised and published no
  update across two reads of block 0x1470; `setup_passcode_status` published
  only `hidden`; BMS health LIVE, 16 active cells, backend min/max agree with
  the cell voltages, Settings values fresh, no console errors, no reboot in
  the observation window. No endpoint required authentication (the overlay
  above).
- **Delta reports:** until the owner deploys a newer commit, every deployment
  delta is computed against `bfa2b44`. A commit is recorded here as deployed
  only after the owner has transferred, compiled and uploaded it.
- **Local YAML:** when `batterylifepo4.yaml` did not change since the
  deployed baseline, the owner keeps their local copy (with the overlay). When
  it did change, the owner merges the change and re-applies the overlay.

## Deployment-delta reporting rule

Every change that touches the build must be reported as an exact deployment
delta against the previously deployed commit (currently `bfa2b44`, see
above). For each changed file in the set above, give its path, size, full
SHA-256 and its destination in the owner's layout (the `jk_bms_ui/` mapping). Exclude tests, docs,
evidence-only files, `demo/mock-server.js` and unchanged files. For example:

```bash
git diff --name-only <deployed-commit> HEAD -- batterylifepo4.yaml jk_bms.js jk_bms.css protocol/generated/read_plan.yaml protocol/generated/write_registry.yaml protocol/generated/read_plan_decode.h protocol/generated/write_registry_table.h protocol/generated/read_clusters_table.h components/jk_write_tx components/jk_poll_scheduler components/jk_topology components/jk_capability components/jk_diag
```

```bash
shasum -a 256 <each changed file>
```

## Commands (owner-run)

```bash
esphome config batterylifepo4.yaml
```

```bash
esphome compile batterylifepo4.yaml
```

```bash
esphome run batterylifepo4.yaml
```

After deploying, a read-only check confirms that the deployed UI matches the
repository: compare the SHA-256 of `/0.js` with the local `jk_bms.js`.

For first USB flash, OTA, USB/serial recovery, credential rotation and
rollback, see [`AUTH_AND_HISTORY.md`](AUTH_AND_HISTORY.md).

## Diagnostic measurement build (not production)

`jk_bms_probe.yaml` is a separate, read-only ESPHome configuration for the
clustered-read hardware gates (see
[`RS485_CLUSTERED_READ_MIGRATION_PLAN.md`](../project/RS485_CLUSTERED_READ_MIGRATION_PLAN.md),
M0/M1). It is **not** part of the production file set above and is never
deployed as production firmware.

- **Files, only for an owner-authorized measurement run:**

  | Repository path | Owner's ESPHome layout |
  |---|---|
  | `jk_bms_probe.yaml` | next to `batterylifepo4.yaml` (it uses the same `secrets.yaml`) |
  | `components/jk_diag_probe/jk_diag_probe_core.h` | the same relative path |

- **Phase selection is compile-time only.** Set the `probe_mode`
  substitution to `A_COMPATIBILITY`, `B_TELEMETRY_SOAK` or `C_COEXISTENCE`,
  or pass it with `-s`. `probe_run_ms: "0"` uses the mode default (B 10 min,
  C 20 min); values above 30 min are clamped to 30 min.
  - Mode A runs one fixed 29-step pass: liveness reads, ×120 clusters, ×121
    boundary controls, then the comparisons.
  - It ends ≈ 50 s after boot (5 min is only its deadline) and aborts early
    only if a liveness read fails.
  - Timing: `send_wait_time: 500ms`, `max_cmd_retries: 0`, probe timeout
    1.5 s.
  - Capture the log from boot until `diag done`.
- **Gate B (`B_TELEMETRY_SOAK`)** is host-prepared but not compiled or
  authorized.
  - **Owner decision (2026-10-01): no separate gate B run.** Its metrics are
    collected by the combined gate C instead (`docs/project/DECISIONS.md`).
  - **Combined gate C ran on 2026-10-01 and PASSED** (`protocol/evidence/stage1_corrective_evidence/gate_c_20261001.md`).
    - Device Builder cannot pass `-s`, so `probe_mode` was set to
      `C_COEXISTENCE` temporarily.
    - **Keep the YAML default `A_COMPATIBILITY`**: the probe's node name
      equals production's, so an accidental Install would replace
      production.
    - Production is restored by rebuilding and installing
      `batterylifepo4.yaml`; verify `config_hash=0x5dc113b1` for
      `bfa2b44`.
    The text below documents the gate B mode itself and its pass criteria,
    which gate C applies to its A1/A2 part.
  - **Selection:** it is never the default. The YAML stays on
    `A_COMPATIBILITY`, and gate B is selected only on the command line:

    ```bash
    esphome -s probe_mode B_TELEMETRY_SOAK -s probe_run_ms 0 compile jk_bms_probe.yaml
    ```

  - **Run it as compile only.** The command above does not upload. Do not
    use `run` or `upload`, or Device Builder's "Install", and do not edit
    the YAML default to select gate B.
  - **The compile log must show:**
    - the probe build path (`…/jk-bms-probe`);
    - no errors;
    - only the known deprecation warnings.
  - **Behaviour:**
    - A1 `0x1200 × 120` (240 B) then A2′ `0x12F0 × 15` (30 B), every 1 s,
      for 10 min;
    - FC03 only, one frame per request, one request outstanding;
    - statistics for A1 and A2 every 60 s, and the full summary at the end;
    - no Modbus request after the deadline, until reboot.
  - **Pass criteria (after a separately authorized run):**
    - the 10 min run completes: `diag run mode=B run_ms=600000 … finished=1
      unexpected=0 aborted=no`, then `diag done … (log queue drops=0)`;
    - A1 and A2 each have about 600 reads with `ok` equal to `issued`, and
      `short=0 long=0 exc=0 timeout=0 resends=0 late=0`;
    - `ok_interval_ms` p99 and max ≈ 1000 ms, with `over1.5x=0 missed=0`;
    - no queue growth: `queue_ms max` stays small and flat across the
      60 s progress lines;
    - no "interval took a long time" warning.
- **Termination:** after one bounded run the build logs its summary and
  issues no further Modbus request until the next reboot. A reboot starts
  the same bounded run again.
- **Evidence:** the `diag …` lines of the device log (metadata only).
- **Rollback:** flash the production build again.
- Compile, upload and every run each need separate owner authorization.
- **Use a compile-only action for a compile check.** "Install" also uploads
  by OTA, and that happened by accident on 2026-09-27.
- **Build directory:** both configurations are named `jk-bms`. Until
  2026-09-27 the Device Builder built both in `/data/build/jk-bms`, so one
  could replace the other's artifacts.
  - `jk_bms_probe.yaml` now sets `esphome.build_path:
    .esphome/build/jk-bms-probe`. In the owner's ESPHome 2026.9.0 Device
    Builder environment that relative value resolved under `/data`, to
    `/data/.esphome/build/jk-bms-probe`; production is unchanged.
  - The diagnostic contract test requires an explicit, relative, portable
    build path distinct from production's.
  - Check it on the first compile: the log line `Compiling app... Build
    path: …` must name a `jk-bms-probe` directory, not
    `/data/build/jk-bms`.
- **ESPHome version:** **2026.9.1** has been the controlled build baseline
  since 2026-10-01 (`toolchain.lock.json`). The diagnostic probe and the
  earlier baselines were built with 2026.9.0, as their evidence records. Do
  not use 2027.3.0 or newer until the Modbus API migration in the plan is
  complete.
- **Known compiler warnings** (any other warning is new and must be
  reviewed):
  - `-Wdeprecated-declarations` for `ModbusCommandItem` / `queue_command`:
    the Modbus API migration item;
  - legacy, present before M5:
    - `components/jk_diag/jk_reset_diag_rtc.h:90` (`-Wextra`, enumerated
      and non-enumerated type in a conditional expression);
    - `batterylifepo4.yaml:5425` (line 5438 before `bfa2b44`; `-Waddress`, an always-true NULL check of
      `total_runtime_in_seconds`).
  - These are tracked as `docs/project/CURRENT_LIMITATIONS.md` L14.
