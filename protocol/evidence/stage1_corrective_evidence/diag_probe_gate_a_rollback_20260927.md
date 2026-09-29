# Diagnostic probe (M0): first hardware contact, automatic rollback and the startup stack fix — 2026-09-27

Plan: `docs/project/RS485_CLUSTERED_READ_MIGRATION_PLAN.md`, M0 → M1 gate A.
Status: **gate A has NOT run successfully; there is no gate A measurement
evidence.** This file records what did happen, the proven source defect and
its correction. Nothing here is a hardware success claim.

## 1. What the owner ran (evidence: owner-supplied ESPHome logs)

| Build | ESPHome / ESP-IDF | Build time (+0300) | config_hash | RAM (DRAM) | Flash (image) | App partition free |
|---|---|---|---|---|---|---|
| production `batterylifepo4.yaml` (with `19cdb39` UI) | 2026.9.0 / 5.5.5 | 2026-09-27 22:35:54 | `0xf870f4c4` | 105,472 / 180,736 B (58.4 %) | 1,248,303 / 1,835,008 B (68.0 %) | 32 % |
| diagnostic `jk_bms_probe.yaml`, `probe_mode: A_COMPATIBILITY` | 2026.9.0 / 5.5.5 | 2026-09-27 23:22:17 | `0x64a25230` | 77,920 / 180,736 B (43.1 %) | 818,375 / 1,835,008 B (44.6 %) | 55 % |

- Diagnostic compile: **successful**. Warnings: the expected ESPHome 2026.9.0
  deprecations of `ModbusCommandItem` / `queue_command()` at
  `jk_bms_probe.yaml:147` / `:156` (these line numbers match the committed
  probe at `5cead7e`), and ESPHome's advice to replace the OTA password with
  OTA encryption. No write-command factory appears in the diagnostic build's
  warnings (production shows `create_write_multiple_command` at yaml:4720).
- The Device Builder action used was compile **and install**: the
  diagnostic image was uploaded by OTA to 192.168.27.43 — 818,496 B, upload
  5.82 s, update 6.35 s, `OTA successful`. This was an **accidental early
  gate A execution**, not an authorized expansion of scope.

## 2. What the device did (evidence: owner-quoted runtime log lines; owner statement)

- The running image afterwards was **production** (`Project
  syssi.esphome-jk-bms version 3.0.0`, `jk_poll_scheduler`, production
  entities), compiled 2026-09-27 23:38:28, with
  `OTA rollback detected! Rolled back from partition 'app1'` and
  `The device reset before the boot was marked successful`.
- **No `diag ...` line** appeared anywhere.
- The owner confirmed that production was **not** restored manually after the
  diagnostic OTA: the bootloader rolled back automatically. (A rollback
  returns to an image already in flash, so the 23:38:28 production image was
  installed before the successful diagnostic upload; the two diagnostic
  upload attempts in the owner's logs report different preparation times,
  0.07 s and 0.06 s.)
- ESPHome's `safe_mode` marks a new OTA image valid only after 60 s of
  normal loop operation (`safe_mode_boot_is_good_after_{60000}`,
  `esp_ota_mark_app_valid_cancel_rollback()`); a reset before that makes the
  bootloader fall back to the previous image.
- Production startup in the same log showed Modbus timeouts and
  `bms health = OFFLINE`. **Not attributed to the probe** (no evidence; the
  probe very likely never reached the bus). Whether production returned to
  LIVE afterwards is an open question to the owner; until answered it is
  unclassified (startup/transient vs a separate communication issue).

## 3. Root cause (source-proven; direct Xtensa crash record still absent)

- `Probe::begin()` executed `*this = Probe();`, materialising a temporary
  `Probe` on the caller's stack.
- `sizeof(Probe)` = 32,728 B (host; the members are fixed-width arrays and
  scalars, so the ESP32 size is essentially the same). Its bulk:
  `payload_` 21 × 250 B and `stats_` 21 × 1,304 B.
- ESPHome's ESP32 loopTask stack: `ESPHOME_LOOP_TASK_STACK_SIZE 8192`.
- `begin()` is the **first statement** of the diagnostic `on_boot` lambda,
  before the first `diag run` log line; so the loop task overflows on every
  boot, long before the 20 s probe delay and the 60 s validation — which
  matches "no diag line" plus the rollback.
- Host `-fstack-usage` for the original code: `begin()` inlined into the
  on_boot entry, 31,824 B at `-O3` (ESPHome's build reported `USING O3`),
  32,816 B at `-O2`, and 32,816 B for the out-of-line `Probe::begin` at `-Os`.
- Why the M0 host tests missed it: they run on an 8 MB host stack (and keep
  `Probe` objects on the stack themselves). Object size (bounded by the
  `sizeof(Probe) < 40 KiB` static assertion) and stack-frame size are
  different invariants; only the first was checked.
- Missing for a direct device confirmation (not required for the fix): a
  serial crash record (e.g. a stack-canary panic in loopTask) or an Xtensa
  disassembly of the diagnostic `firmware.elf` showing the ~32 KB `entry`
  frame. The shared build directory (below) has probably overwritten that ELF.

## 4. Correction (commit `fix(diag): avoid probe startup stack overflow`)

- `Probe::begin()` now calls `reset()`, an in-place, field-by-field return
  to every default member initializer: explicit scalar assignments, and
  `fill()` on each array (`Histogram::reset`, `IntervalStats::reset`,
  `RequestStats::reset` and `Probe::reset`). No aggregate or array temporary
  is created, and no `memset` over non-trivial layout is used.
- New firmware-stack regression test `test/jk_diag_probe/test_jk_diag_probe_stack.sh`
  (in `test/run_all.sh`): compiles `test/jk_diag_probe/stack_harness.cpp`,
  which mirrors every YAML-facing entry point, at `-O3`, `-O2` and `-Os`
  with `-Wframe-larger-than=2048 -Werror` and `-fstack-usage`, and bounds
  every entry point **and every function in the unit** (for out-of-line
  callees) to 2,048 B.
  - The limit is a quarter of the 8 KB loopTask stack, leaving at least 6 KB
    for ESPHome's own call chain.
  - Corrected frames: `-O3`/`-O2` on_boot 240 B, interval 656 B, response
    112 B, logger 80 B; `-Os` interval 816 B, all others ≤ 240 B. 21/21
    checks pass.
  - The `19cdb39` header and the mutation restoring `*this = Probe();` both
    fail it: 13/21 checks, frame 31,824 / 32,816 B.
- Reset-equivalence tests in `test_jk_diag_probe_core.cpp` (73 checks
  total):
  - A probe dirtied by a mode-C run with retries, exceptions, timeouts, late
    answers and payloads, plus five probes stopped in transient states,
    must be **byte-equal** after `begin()` to a never-used static probe
    begun the same way. The transient states are A2 pending, C2 pending,
    just after an exception, a finished run and a partial gate A pass.
  - A gate A run after the reset must log exactly what a never-used probe
    logs.
  - Removing any single `reset()` statement is caught, except the 8 fields
    that `begin()` assigns immediately after `reset()`: `mode_`, `begun_`,
    `run_ms_`, `start_ms_`, `deadline_ms_`, `next_pass_ms_`,
    `tele_due_ms_`, `settings_due_ms_`. Those mutations are equivalent
    through `begin()`. The score is 37/45.
- Unchanged: the static FC03 allowlist, credential exclusion, strict
  lengths, bounded A/B/C modes, no writes, no remote parameters,
  statistics/comparisons/summaries, and no requests after completion. The
  diagnostic contract test and the full `run_all.sh` pass.
  `jk_bms_probe.yaml` is unchanged.

## 5. Deployment requirement: separate build directory

`jk_bms_probe.yaml` and `batterylifepo4.yaml` both use `name: jk-bms`. The
owner's logs show both builds in `/data/build/jk-bms`, so an install or
upload of one can reuse or overwrite the other's artifacts. ESPHome is not
installed on the development host, so an ESPHome 2026.9.0 build-directory
option could not be validated here, and the YAML was not changed.

**Requirement:** before the next diagnostic compile, the owner verifies on
ESPHome 2026.9.0 how to give the probe its own build directory, using a
config check that is compile-only. Until then:
- compile the probe with a **compile-only** action;
- after any probe build, compile production again before installing
  production.

**Update (commit `build(diag): isolate probe build artifacts`):**
- ESPHome's official documentation confirms that `esphome.build_path`
  customizes the build directory.
- `jk_bms_probe.yaml` now sets `build_path: .esphome/build/jk-bms-probe`.
  Later owner compile evidence showed that ESPHome 2026.9.0 Device Builder
  resolved it under `/data`, as `/data/.esphome/build/jk-bms-probe`, not
  relative to `/config/esphome`. The production configuration and node name
  are unchanged.
- `test/protocol_catalog/test_diag_probe_contract.js` requires the path to
  be:
  - explicit;
  - distinct from production's `.esphome/build/jk-bms` / `/data/build/jk-bms`,
    with production not given a `build_path` of its own;
  - relative and portable: no absolute, home, `..` or machine-specific path.
- Verified by the later ESPHome 2026.9.0 compile log: the probe used
  `/data/.esphome/build/jk-bms-probe`, distinct from production.

## 6. ESPHome API baseline

- ESPHome **2026.9.0** is the current controlled build baseline.
- The deprecated `ModbusCommandItem` / `queue_command()` family is scheduled
  for removal in **2027.3.0**. It is used by both production and the probe.
  The migration item is in the plan (§16, "Future: ESPHome Modbus API
  migration").

## 7. Next step (not executed)

A new **compile-only** validation of the corrected `jk_bms_probe.yaml` +
`components/jk_diag_probe/jk_diag_probe_core.h` on ESPHome 2026.9.0, with no
install and no OTA. Any gate A retry needs separate, explicit owner
authorization. Gate A remains incomplete.
