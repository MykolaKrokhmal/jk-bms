# Build and deploy (ESPHome / Home Assistant)

**Status: OPERATIONAL GUIDE — current.** Compiling, flashing and OTA are owner
actions. An agent runs none of them without explicit, in-the-moment owner
permission.

## Pinned toolchain

Versions are pinned in [`toolchain.lock.json`](../../toolchain.lock.json)
(ESPHome, ESP-IDF, Node, Python, and the external `syssi/esphome-jk-bms`
revision) and in `.node-version` / `.python-version`. Do not restate the
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
| `components/jk_write_tx/jk_write_tx_core.h` | `esphome: includes` |
| `components/jk_write_tx/jk_preflight_snapshot_core.h` | `esphome: includes` |
| `components/jk_poll_scheduler/jk_poll_scheduler_core.h` | `esphome: includes` |
| `components/jk_topology/jk_topology_core.h` | `esphome: includes` |
| `components/jk_capability/jk_capability_core.h` | `esphome: includes` |
| `components/jk_diag/jk_reset_diag_core.h` | `esphome: includes` |
| `components/jk_diag/jk_reset_diag_rtc.h` | `esphome: includes` |

The external component is fetched by ESPHome from the pinned GitHub revision.
`components/jk_history/` is not part of the production build (see
`docs/project/CURRENT_LIMITATIONS.md`). If `batterylifepo4.yaml`'s
`packages:` / `includes:` / `web_server:` sections change, update this table
in the same commit.

## Deployed baseline (test ESP32)

- **Currently deployed code (owner-confirmed, 2026-09-27):** commit `8fbe54f`
  (`style(settings): replace blocked badges with lock affordance`). This is
  the last hardware-tested deployment the owner has confirmed. It contains
  the security baseline `be99c96`, which is recorded below.
- **Earlier security baseline:** commit `be99c96` (`fix(mock): publish
  configured cell count`, on top of the security fix `70a6aae`). The owner
  transferred the complete 14-file compile/runtime set above (every row
  except the local `secrets.yaml`), compiled it with ESPHome **2026.9.0** in
  the owner's environment (`toolchain.lock.json` still pins 2026.8.2, the
  version an agent last compiled with on 2026-09-25) and uploaded it to the
  test ESP32 on **2026-09-25**.
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
  | every other file in the table above | the same relative path |

  The repository keeps `jk_bms.js` / `jk_bms.css` at its root on purpose.
- **Read-only post-deployment check (2026-09-25):** the served `/0.js`,
  gunzipped, is byte-identical to `jk_bms.js` at `be99c96`; the retired
  `setup_passcode_readback` entity is no longer advertised and published no
  update across two reads of block 0x1470; `setup_passcode_status` published
  only `hidden`; BMS health LIVE, 16 active cells, backend min/max agree with
  the cell voltages, Settings values fresh, no console errors, no reboot in
  the observation window. No endpoint required authentication (the overlay
  above).
- **Delta reports:** until the owner deploys a newer commit, every deployment
  delta is computed against `8fbe54f`. A commit is recorded here as deployed
  only after the owner has transferred, compiled and uploaded it.
- **Local YAML:** when `batterylifepo4.yaml` did not change since the
  deployed baseline, the owner keeps their local copy (with the overlay). When
  it did change, the owner merges the change and re-applies the overlay.

## Deployment-delta reporting rule

Every change that touches the build must be reported as an exact deployment
delta against the previously deployed commit (currently `8fbe54f`, see
above). For each changed file in the set above, give its path, size, full
SHA-256 and its destination in the owner's layout (the `jk_bms_ui/` mapping). Exclude tests, docs,
evidence-only files, `demo/mock-server.js` and unchanged files. For example:

```bash
git diff --name-only <deployed-commit> HEAD -- batterylifepo4.yaml jk_bms.js jk_bms.css protocol/generated/read_plan.yaml protocol/generated/write_registry.yaml protocol/generated/read_plan_decode.h protocol/generated/write_registry_table.h components/jk_write_tx components/jk_poll_scheduler components/jk_topology components/jk_capability components/jk_diag
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
  C 20 min); values above 30 min are clamped to 30 min. Mode A ends as soon
  as its single pass completes, normally ≈ 40–50 s after boot (5 min is
  only its deadline). Capture the log from boot.
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
    .esphome/build/jk-bms-probe`. The path is relative to the
    configuration's folder, and production is unchanged.
  - The diagnostic contract test requires an explicit, relative, portable
    build path distinct from production's.
  - Check it on the first compile: the log line `Compiling app... Build
    path: …` must name a `jk-bms-probe` directory, not
    `/data/build/jk-bms`.
- **ESPHome version:** builds are validated on 2026.9.0. Do not use 2027.3.0
  or newer until the Modbus API migration in the plan is complete.

