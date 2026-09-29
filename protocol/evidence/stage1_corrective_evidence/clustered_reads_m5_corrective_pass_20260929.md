# Clustered reads M5 — corrective pass verification (2026-09-29)

Plan: `docs/project/RS485_CLUSTERED_READ_MIGRATION_PLAN.md`, M5. Base: `24c94e6`.
The verified corrective pass was committed on 2026-09-29 as `c83a676`
(`fix(protocol): finalize safe clustered read writes`).

**Scope: host only.** No ESPHome compile, no flash/OTA, no device access, no
Modbus traffic, no BMS write, no push. Gates B, C and D not started.

## Root causes corrected (owner decisions 2026-09-29)

1. **Setup passcode read after boot.** `Runtime::begin()` set
   `passcode_requested_ = true`, so 0x1470×8 was read after every boot.
   Now `false`: strictly on demand; one isolated read per explicit
   `request_passcode_status()` (no production caller). The passcode write
   transaction keeps its own isolated readback.
2. **Double RMW gate.** The UI consumer decided READY at its `now`, then
   called `begin_write_tx_rmw`, which re-gated with a later `millis()`; a
   crossing of the 3.5 s budget between the two parked the write in the
   untracked `g_rmw_deferred_*` slot, the consumer published
   `WRITE_NOT_QUEUED`, and the 100 ms interval could still execute the write
   later. Now one tracked `jk_cluster_runtime::RmwRequest` per request: each
   step is one decision against one lookup, QUEUE carries that lookup's merged
   raw, the consumer queues it through `begin_write_tx` (never
   `begin_write_tx_rmw`), and QUEUE/REJECT are terminal. The HA entity path
   has its own tracked request (`g_entity_write_rmw`, `rmw_entity_step`). The
   untracked slot is gone.
3. **Fallback RMW refused outright** (contradicted plan §10). Now the
   register's own narrow read-plan block is the source in a latched group:
   only a success after the latch, under the strict 3.5 s budget, with one
   tracked narrow pre-read that the servicer issues before the bespoke
   readers.
4. **Mock without the cluster protocol.** `demo/mock-server.js` now emits
   `<cluster>:<revision>:<sequence>`, serves `clusters[]`, latches fallback
   groups (`/demo/cluster-fallback`) and keeps a legacy mode
   (`/demo/read-mode?name=legacy`). The other session's uncommitted topology
   edit in the same file was preserved untouched.

## Results

Environment: Node v24.2.0, Apple clang 21.0.0 (`g++`), macOS.

| Check | Working tree | Clean export (24c94e6 + this pass only, without the other session's topology edits) |
|---|---|---|
| `bash test/run_all.sh` | exit 0, 0 FAIL | exit 0, 0 FAIL ("All suites passed.") |
| `test_jk_cluster_runtime_core.cpp` | 89/89 | 89/89 ×3 |
| `test_cluster_mock_browser_end_to_end.js` (new) | 22/22 | 22/22 ×3 |
| `test_cluster_servicer_structure.js` | 29/29 | 29/29 |
| `test_register_write_handoff_structural.js` | 51/51 | 51/51 |
| `test/firmware_lambda_compile/run.js` | 5/5 | 5/5 |

All generators `--check`: no drift (4 generators + 7 authoring builders).
`pipeline.js check` PASS. Fingerprint check → review → accept (the
hand-written `jk_bms.js` and `batterylifepo4.yaml` changed), then
`FINGERPRINT_MATCH`. `git diff --check` clean.

## Mutations (each applied, tested, restored and compared)

- Runtime core + cache: **20/20** caught — passcode read after boot; QUEUE,
  REJECT and deadline not terminal; no deadline; narrow success before the
  latch; narrow budget ignored; narrow boundary `<`; repeated narrow and
  cluster pre-reads; one shared pre-read flag; narrow width not checked; no
  merge; fallback refused outright; no narrow request; narrow request while
  in flight; latch time lost; narrow request not cleared on take; arming
  twice; cluster boundary `>=`.
- YAML + generator wiring: **10/10** — consumer calling
  `begin_write_tx_rmw` (second gate); no terminal cancel; result published
  while waiting; entity REJECT queueing; entity write bypassing the gate; a
  passcode request caller; a direct `check_rmw` call; narrow pre-read ignored,
  issued after the bespoke readers, or for any block.
- Mock: **5/5** — cluster events removed; `clusters[]` removed; latch no-op;
  blocks not advanced by a cluster read; revision skipping.
- UI: **2/2** — cluster events ignored; snapshot `clusters[]` ignored.

## Deployment preparation

- Cumulative `batterylifepo4.yaml` patch from the deployed base `8fbe54f`:
  15 hunks. `patch -p1 --dry-run` against a model of the owner overlay
  (`auth:` commented, `js_include`/`css_include` under `jk_bms_ui/`): rc 0.
  The patched overlay copy is byte-identical to the repository YAML plus
  the same overlay. The patch contains no `auth`/include lines, secrets,
  IP/MAC addresses or local paths.
- The real owner copy was not available; the overlay was modelled.

## Limits

- The lambda compile check uses ESPHome API stubs; it is not an ESPHome
  compile. Real compile-only validation is still required.
- UI freshness budgets (M6), the Settings lease caller (M7), write
  coordination and gate D (M8) remain open.

## Addendum: write only when the value changes (2026-09-29, same day)

- **Write paths audited.** The only Modbus write command is
  `create_write_multiple_command` in `begin_write_tx` (1 or 2 registers).
  It is reached from: the UI register-write consumer (100 ms interval), the
  HA entity scripts `begin_write_tx_rmw` (5 generated RMW entities),
  `write_bms_u16` / `write_bms_u32` (20 hand-written numeric entities), and
  `entity_write_step`. CellCount and the setup passcode are fail-closed
  (their set_actions queue nothing).
- **Equality check.** `jk_cluster_runtime::RmwRequest::step()`: on READY it
  computes the merged raw (field merged into the register, or the
  full-width value masked to 16/32 bits) and compares it with that same
  lookup's current raw; equal -> terminal `RmwStep::NO_CHANGE`. The UI
  consumer and `entity_write_step` queue only on `QUEUE`; every write now
  passes through the tracked request (the consumer calls `begin_write_tx`
  directly, never `write_bms_u16/u32`, which now only arm the entity pool).
- **Results (working tree):** `run_all.sh` exit 0; runtime core 103/103;
  servicer structure 34/34; handoff structural 49/49; lambda compile 6/6
  (now also compiles `RegisterWriteStatusHandler`); write-registry UI 93/93
  (H2b no_change); register-write simulator E2E 43/43 (same value ->
  `no_change`, zero write transactions).
- **Mutations:** 12/12 caught after one structural check was added (the
  first run had one survivor: the consumer mapping NO_CHANGE to the queued
  raw).

## Addendum: one Settings write contract (2026-09-29, same day)

- **Root cause.** `build_settings_view_model.js` made every
  `write-hardware-verified` row without a write-registry entry `live` with
  `writePathKind: legacy_setting_def`; jk_bms.js then wrote those 18 rows
  through `submitRegisterSetting()` -> `writeTransaction()` ->
  `/number/set_<key>/set` (internal ESPHome number entities), bypassing
  `/settings/register-write` (no preflight, no NO_CHANGE result, no request
  status). The Configuration register list also rendered editable
  `reg_<key>` editors/OK buttons for the same keys.
- **Fix.** The generator now locks such rows (`readWriteState: blocked`,
  `blockedReason: NOT_IN_UNIFIED_WRITE_REGISTRY`, no endpoint). jk_bms.js:
  removed `writeTransaction`, `submitRegisterSetting`,
  `sendCellCountWrite`, the register toggles, `submitSettings`,
  `writableDefinitionForEntry` (the register list is read-only), the
  `SETTING_DEFS`/`settingDef` endpoints, `CONTROL_DEFS`, `COMPARATORS` and
  the `data-register-write`/`data-register-toggle` handlers.
  `submitRegisterWrite()` now also validates range/step (and accepts a
  decimal comma) before any request. `SETTING_KEYS` stays only as the
  record of the 18 locked owner-authorized keys.
- **Mapping outcome (18 SETTING_KEYS):** none has a write-registry entry;
  all 18 are locked with `NOT_IN_UNIFIED_WRITE_REGISTRY`. Live Settings
  writes: gps_heartbeat, lcd_always_on, smart_sleep_enabled,
  timed_stored_data (0x1114 bits), smart_sleep_timeout_hours (0x1118).
- **Tests:** test_settings_catalog.js 252/252 (new U0-U9), view model
  45/45, blocked-write surface 114/114, input-pattern 4/4, write-registry UI
  structural 62/62. Mutations 6/6 (legacy endpoint restored, automatic
  select write, cross-row drafts, no client range check, locked row given an
  OK, generator legacy-live).

## Addendum: Settings write migration (2026-09-29, same day)

- **Rule.** `generate_write_registry.js` admits an owner_write_override
  field only if it is in the explicit `SETTINGS_WRITE_MIGRATION_KEYS` list
  (the 18 former Settings OK fields) AND `migrationContradiction()` finds its
  canonical write facts complete and consistent (type/sign/width/mask/
  scale/step/range). Audited table: `write_registry.json`
  `settings_write_migration` (all 18, facts + outcome + reason).
- **Outcome.** Migrated (live, full-width U32, FC16, 2 registers, readback
  compare 0xFFFFFFFF): smart_sleep 0x1000, cell_uvpr 0x1008, cell_ovpr
  0x1010, start_balance_trigger 0x1014, soc_100 0x1018, soc_0 0x101C,
  cell_rcv 0x1020, cell_rfv 0x1024, charge_ocpr_time 0x1034,
  discharge_ocpr_time 0x1040, scpr_time 0x1044, max_balance_current 0x1048,
  battery_capacity 0x107C, start_balance 0x1084. Blocked: charge_otpr
  0x1050, discharge_otpr 0x1058, charge_utpr 0x1060, mos_otpr 0x1068 --
  canonical `wire_type U32`, `signedness unsigned`, `minimum -100` (°C,
  scale 0.1); their canonical evidence is `project_implementation` only,
  while the legacy hand-written encoder used `int32_t(lroundf(x * 10))`.
  Resolving the sign needs independent protocol evidence.
- **Firmware.** The 14 hand-written internal `set_<key>` numbers were
  removed from batterylifepo4.yaml; the generated ones (same ids) encode with
  `jk_write_tx::encode_numeric_field` and write through `write_bms_u32` (the
  tracked entity pool: NO_CHANGE, then begin_write_tx with ACK + forced
  readback). The 4 blocked fields keep their internal hand-written entity.
- **Mock.** The simulator keeps a test-only generic write-tx hook on
  `/number/set_<migrated key>/set` for test/topology/run.js (another
  session's file); the UI never calls it and real hardware has no such route.
- **Tests:** registry equality 21/21 (exact facts per field, one id per
  key, tracked write path), settings catalog 256/256 (U3m/U6m/U10), view
  model 47/47, stage4 inventory 25/25, closure invariants 10/10, write
  registry UI 93/93 + structural 62/62, claim matrix 26/26, write-tx count
  20/20, HTTP simulator 83/83, topology green. Mutations 6/6.

## Addendum: signed temperature recoveries (2026-09-29, same day)

This supersedes the "Blocked" outcome of the previous addendum.

- **Defect.** `registers.canonical.json` declared charge_otpr 0x1050,
  discharge_otpr 0x1058, charge_utpr 0x1060 and mos_otpr 0x1068 as
  `wire_type U32`, `signedness unsigned`, although their own range is
  -100..200 °C. The earlier statement that no independent evidence existed
  was wrong: each field already cited the upstream source with a
  `wire_type` claim (e.g. `upstream_syssi_esphome_jk_bms:3973feb7c93d283c`
  for charge_otpr, `:678cc5bedba98ea6` for mos_otpr).
- **Evidence, re-verified.** Source `upstream_syssi_esphome_jk_bms`:
  https://github.com/syssi/esphome-jk-bms, `esp32-jk-pb-modbus-example.yaml`,
  commit `08f25eb4941b03b6ee0b6c38660aeadfc4ef7cd1`, Apache-2.0. Local copy
  `protocol/evidence/upstream_esp32-jk-pb-modbus-example.yaml`, sha256
  `00ad253cbacf2a945960c7c81718af6f50c68cb4b1cc18314a30f1ddf8c2868d`,
  identical in `sources.json` and `upstream_index.json` and recomputed from
  the file. Register-table comments at lines 476/510/544/578 (`INT32`, 4
  bytes, RW, 0.1 °C); the implemented entities at `address:` 480/514/548/582
  have `value_type: S_DWORD` at 482/516/550/584 and `multiply: 0.1` at
  491/525/559/593 (upstream also has a `register_count: 4` quirk next to
  `response_size: 4`; the project keeps 2 registers, per its own width
  evidence). The legacy project encoder was
  `int(int32_t(lroundf(x * 10.0f)))`.
- **Correction.** Only `wire_type` -> `S32` and `signedness` -> `signed` for
  the 4 fields, plus a `safety_notes` line on each register. Width 32,
  2 registers, FC16, high-word-first, scale 0.1, -100..200, step 0.1
  unchanged. All derived artifacts regenerated; fingerprint workflow re-run.
  Result: all 18 Settings fields migrated; registry 60 eligible (23 live,
  37 authorization-required). The generator type table uses the canonical
  `S16`/`S32` names. The read decode is now signed too (negative readings
  were previously decoded as ~429 million).
- **Golden vectors** (`test/jk_poll_scheduler/test_settings_signed_golden.cpp`,
  80/80, generated tables + production encode/decode/verify/RMW):
  -100.0 -> 0xFFFFFC18, -0.1 -> 0xFFFFFFFF, 0.0 -> 0, 25.5 -> 0x000000FF,
  200.0 -> 0x000007D0, each decoded back; -100.1, 200.1, -1000, 4294967
  rejected (OUT_OF_RANGE, no write); full 32-bit readback compare (-100.0
  never matches +100.0 or a 16-bit echo); -100.0 over a cached 0xFFFFFC18 ->
  NO_CHANGE; -99.9 -> one 2-register write of 0xFFFFFC19, mask 0xFFFFFFFF.
- **Mutations: 6/6 killed** — canonical charge_otpr back to U32/unsigned;
  canonical mos_otpr wire_type U32 only (sign mismatch); generated entity
  `isSigned` forced false; registry table `is_signed` forced false; read
  decode forced unsigned; `S32` removed from the generator width table.
  Each: regenerate, run golden + registry equality + settings catalog,
  restore, byte-compare.
