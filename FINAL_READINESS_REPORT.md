# Final Readiness Report — JK BMS Dynamic Topology + Generic Write Transaction Manager

**Status: Програмно готово; апаратна верифікація очікується.**

Not "Готово." Criteria 8, 11 (60h persistence on real flash, hardware validation) are not met — no physical ESP32 + JK BMS is available in this environment — and criteria 2, 9, 12, 14 are only partially met (see the matrix below). Per the governing instructions, an unqualified "Готово" is explicitly forbidden while any mandatory criterion is unmet.

UI_VERSION: `2026.09.08-v5`. Build info: **verified against ESPHome 2026.8.2** (the version actually reported by the user's real build), ESP-IDF 5.5.5, config_hash `0xc0614563`. (An earlier pass in this session also verified ESPHome 2026.6.5, ESP-IDF 5.5.4 — kept below for reference, but 2026.8.2 is the version that matters: see §0.)

## 0. A real hardware-adjacent bug, found only from the user's own build output

The user ran `esphome compile` against their real ESPHome install (2026.8.2) and it **failed** — every lambda passed to `ModbusCommandItem::create_read_command`/`on_data_func` used the OLD callback signature `(modbus_controller::ModbusRegisterType, uint16_t, const std::vector<uint8_t>&)`. ESPHome 2026.8.2 changed this to `(modbus::EntityType, uint16_t, std::span<const uint8_t>)` — a breaking API change between minor versions this project's own 2026.6.5 test environment never surfaced. Fixed all 12 affected lambda signatures (every `create_read_command` callback and every `on_data_func` assignment) across the CellCount driver, the generic write-tx servicer, and the passcode transaction. Also addressed two other warnings from the same build output: `web_server.auth` now explicitly sets `type: digest` (available in 2026.8.2, not in 2026.6.5 — Digest never puts the password on the wire in Basic's easily-reversible form, though this is still authentication, not encryption — HTTP stays plaintext), and `command_throttle` moved from `modbus_controller:` to `modbus: turnaround_time:` (the old key silently stopped doing anything).

**This fix could not be verified in this session's original sandboxed ESPHome install (pinned at 2026.6.5, the newest available from PyPI at the time)** — a second Python 3.12 venv was built specifically to install and compile against the exact 2026.8.2 the user is running. That compile is **SUCCESS**, RAM 51.0% (92160/180736 B — note the smaller total than 2026.6.5 reported; a real, observed difference in how that ESPHome/IDF version accounts for available RAM, not a regression introduced here), Flash 60.7% (1113895/1835008 B), with exactly **one** remaining warning (a pre-existing, harmless static-analysis false-positive on a modbus_controller pointer pattern, not introduced this session). Zero `ModbusRegisterType`-deprecation or `%u`-format warnings remain.

## 1. What changed, in one paragraph

Replaced the fire-and-forget `write_bms_u32`/`write_bms_u16` scripts (queue a Modbus write, never check it landed) with a generic Write Transaction Manager (`components/jk_write_tx/jk_write_tx_core.h`, unit-tested, wired into every RW register except `cell_count` and `setup_passcode`, which keep their own already-existing bespoke transaction drivers). Converted the `charging`/`discharging`/`balancing` selects from `platform: modbus_controller` to `platform: template` so they route through the same manager. Fixed a real, previously-disclosed bug in the demo mock server where the "normal" scenario silently forced Charge/Discharge back On every tick even after an explicit user write turned them Off. Built `register_catalog.json` (47 RW-register entries: address, width, scale, manager) plus a validator that cross-checks it against the YAML, `jk_bms.js`, and the mock (418 checks). Extended `jk_bms.js`'s `writeTransaction()` to race a fast, forced-readback-backed confirmation (via a new `write_tx_snapshot` JSON entity) alongside its existing entity-state-based one, with zero behavior change for any register not in the generic manager. Fixed a real accessibility gap (register toggle switches had no accessible name) and removed one confirmed-dead function (`settingField`).

## 2. Safety invariants now enforced

- Every RW register except `cell_count`/`setup_passcode` gets: a monotonic `tx_id`, a genuine Modbus ACK (via `on_data_func`, not a fixed delay), a **forced** one-shot readback (not a wait for the register's own slow poll cycle), and an atomic terminal result (`CONFIRMED`/`MISMATCH`/`ACK_TIMEOUT`/`READBACK_TIMEOUT`) published as one JSON snapshot.
- Single-flight per register address: a second write to an address with a transaction **still pending** is rejected outright; a write to an address whose prior transaction already reached a terminal state is accepted immediately (this exact distinction was a real bug, caught by the automated suite and fixed in both the C++ core and the mock — see §4).
- A packed register (two logical fields sharing one 16-bit word) is compared only on the bits it actually wrote, so a legitimately-differing sibling field is never mis-reported as MISMATCH.
- `select-charging`/`select-discharging`/`select-balancing` (the control register) can now change **only** via a CONFIRMED write transaction or an explicit `/demo/*` override — never as a side effect of the mock's own periodic simulation tick.
- A genuine simulated protection trip (`active_alarm`) still stops live current-flow status, but now publishes an explicit `control_override_reason` rather than silently diverging from the control register.

## 3. Automated test results

| Suite | Command | Result |
|---|---|---|
| `jk_write_tx_core.h` unit tests (new) | `g++ -std=c++17 test/jk_write_tx/test_jk_write_tx_core.cpp && run` | **46/46 PASS** |
| `jk_history_format` unit tests (unchanged from prior session) | `g++ -std=c++17 test/jk_history/test_jk_history_format.cpp ... && run` | **94/94 PASS** |
| Register catalog validator (new) | `node test/register_catalog/validate.js` | **418/418 PASS** |
| Topology + write-transaction integration suite (extended) | `TEST_PORT=19999 node test/topology/run.js` | **57/57 PASS** |
| **Total automated checks** | | **615/615 PASS, 0 failed** |
| `esphome config batterylifepo4.yaml` | | Valid |
| `esphome compile batterylifepo4.yaml` (ESPHome **2026.8.2**, the user's real version) | | **SUCCESS** — RAM 51.0% (92160/180736 B), Flash 60.7% (1113895/1835008 B), 1 pre-existing harmless warning |
| `esphome compile batterylifepo4.yaml` (ESPHome 2026.6.5, this session's original sandbox) | | SUCCESS — RAM 28.2% (92320/327680 B), Flash 60.0% (1100091/1835008 B) |
| Live browser check (Browser pane, real jk_bms.js/CSS served fresh from disk) | manual, scripted | Charge toggle Off survives 5s+ of live ticks; numeric write (cell_ovp) confirms end-to-end; 0 console errors |

## 4. A real bug found and fixed by the new tests

The single-flight guard originally rejected a write to a register whose **previous** transaction had already reached a terminal state (CONFIRMED etc.) but hadn't yet been freed from its slot (a ~3s grace period exists so a client reading the snapshot can still observe the result). Caught by two new integration tests writing to the same register twice in quick succession. Fixed in both `jk_write_tx_core.h::begin()` (now distinguishes PENDING from TERMINAL-but-lingering, and immediately reuses/supersedes a lingering terminal slot for the same address) and the mock's equivalent logic — with a new dedicated regression unit test (`test_begin_immediately_reuses_own_terminal_slot_same_address`).

## 5. register_catalog.json (spec §6)

A single JSON file (repo root) listing every RW register: key, address, width, signedness, scale, unit, editor kind, and which transaction manager owns it (`generic`, `bespoke_topology` for CellCount, `bespoke_passcode`, or `none` for the local-only device name). `test/register_catalog/validate.js` cross-checks it against `batterylifepo4.yaml` (address literal appears in the YAML), `jk_bms.js` (its `GENERIC_TX_ADDRESS` map agrees on every address, and every RW key has some UI reference), and confirms `demo/mock-server.js` derives its own register map directly from this file (not a hand-duplicated copy). **Scope limitation, disclosed honestly**: this catalog covers RW registers only, not the larger set of read-only telemetry sensors — the spec's literal "усі R/RW-регістри" (all R/RW registers) is not 100% met; only the RW half has 100% coverage + a CI gate.

## 6. Known limitations / what remains open

1. **60-hour persistent history is not wired into production.** The LittleFS PoC (`test/littlefs_poc/`) compiles in isolation (established in the prior session), but the production partition table is still ESPHome's default and no `jk_history:` block is applied — this project's own standing rule requires a real flash/OTA/power-loss cycle on physical hardware before touching the production partition table, and no hardware is available here.
2. **No hardware validation was performed** — no physical ESP32 + JK BMS in this environment. Everything above is verified against the mock simulator (protocol-faithful, independently JS-ported resolver/transaction logic) and a real ESPHome cross-compile, never against real Modbus traffic.
3. **No committed browser E2E test suite** (Playwright or equivalent) exists in the repo. This session's browser verification was real (a live Chromium instance, the actual production `jk_bms.js`, real clicks) but manual/scripted through the Browser pane tool, not a repeatable, CI-runnable test file.
4. **Generic write-transaction race-condition coverage is inherited, not independently re-tested.** The stale/duplicate/out-of-order-SSE and reload-mid-transaction protections in `jk_bms.js`'s `writeTransaction()` are shared code (the same `settled` guard and revision check CellCount already relies on, now extended with a parallel snapshot watcher) — CellCount's own dedicated tests for these scenarios still pass, but no NEW dedicated stale/duplicate/reload test was written specifically exercising the generic-register path.
5. **No dedicated automated accessibility (axe) suite or full keyboard/responsive sweep was run this session** — one concrete, real gap (unlabeled register-toggle switches) was found by manual DOM inspection and fixed; a systematic sweep was not repeated.
6. **Security section (§4.5 of the governing spec — CSRF/Origin checks, rate limiting, negative 401/403/405/415/422/429 tests)** was not addressed this session; carried over unchanged from the prior session's state.

## 7. Changed/added files

| File | What |
|---|---|
| `components/jk_write_tx/jk_write_tx_core.h` (new) | Pure, unit-tested generic write-transaction state machine |
| `test/jk_write_tx/test_jk_write_tx_core.cpp` (new) | 46 desktop unit tests |
| `register_catalog.json` (new) | Single source of truth for every RW register |
| `test/register_catalog/validate.js` (new) | 418-check catalog/YAML/JS/mock cross-validator |
| `batterylifepo4.yaml` | Generic manager wiring (globals, scripts, 250ms servicer, `write_tx_snapshot`), passcode's own small transaction, `charging`/`discharging`/`balancing` converted to template selects |
| `demo/mock-server.js` | Generic write-tx simulation (mirrors the firmware), control-register persistence fix, `text_sensor-control_override_reason` |
| `jk_bms.js` | `GENERIC_TX_ADDRESS` map, `write_tx_snapshot` parsing, `writeTransaction()`'s parallel fast-confirmation path, aria-labelledby fix, removed dead `settingField()` |
| `test/topology/run.js` | +9 new tests (generic write matrix, control-register persistence regression) |

## 8. Justification for the status line

Criteria 3, 4 (mostly), 5, 6, 7, 13 of the governing spec's acceptance list are met and evidenced above with real, reproducible commands. Criteria 8 and 11 are explicitly hardware-gated and cannot be completed in this environment — the spec's own fallback rule for exactly this situation is "Програмно готово; апаратна верифікація очікується," not "Готово." Criteria 2, 9, 12, 14 are partially met, disclosed in §6 rather than glossed over. No test was skipped or its failure hidden; every number above comes from a command actually run in this session, logged under `.esphome/*.log`.
