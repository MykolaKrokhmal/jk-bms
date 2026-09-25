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

## Deployment-delta reporting rule

Every change that touches the build must be reported as an exact deployment
delta against the previously deployed commit. For each changed file in the
set above, give its path, size and full SHA-256. Exclude tests, docs,
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
