# JK BMS — ESP32 / ESPHome web UI and RS485 parameter pipeline

An ESP32 + ESPHome application that reads and safely configures a JK-PB BMS
over Modbus RTU / RS485. Values reach Home Assistant through the native API
and the embedded web UI through server-sent events, both from the same ESPHome
entities.

## Entry points

| Path | Role |
|---|---|
| `batterylifepo4.yaml` | ESPHome firmware configuration (backend) |
| `jk_bms.js`, `jk_bms.css` | embedded web UI (served by `web_server`) |
| `protocol/` | canonical protocol model, schemas, generated artifacts, evidence |
| `tools/protocol/` | generators, validators, pipeline and fingerprint tooling |
| `components/` | desktop-testable C++ cores included by the firmware |
| `test/` | the full regression suite (`bash test/run_all.sh`) |
| `demo/` | the real frontend against a mock HTTP/SSE backend |
| `register_catalog.json` | generated register catalog (do not edit) |
| `toolchain.lock.json`, `.node-version`, `.python-version` | pinned toolchain |
| `HARDWARE_AUDIT_2026-09-09.md` | hash-pinned hardware evidence source (must stay here) |

## Start here

- Current state and rules: [`docs/project/PROJECT_STATE.md`](docs/project/PROJECT_STATE.md)
- Active plan: [`docs/project/RS485_UNIFIED_PARAMETER_PIPELINE_PLAN.md`](docs/project/RS485_UNIFIED_PARAMETER_PIPELINE_PLAN.md)
- All documentation: [`docs/README.md`](docs/README.md)
- Agent rules, build and test: [`CLAUDE.md`](CLAUDE.md)

No package manager and no third-party dependencies: Node and Python standard
library only. Local secrets (`secrets.yaml`, `compile.local.env`) and
personal notes (`CLAUDE.local.md`) are git-ignored. Scratch output goes in
the ignored `tmp/` directory.
