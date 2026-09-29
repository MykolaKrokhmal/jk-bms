> **Status: OPERATIONAL GUIDE with historical sections.** The auth, flash/OTA,
> USB recovery, credential-rotation and rollback procedures below are the
> current how-to. The "Compile status (this session)" and "Update" notes are
> dated snapshots, not current build results. The current build/runtime file
> set and the deployment-delta rule are in [`BUILD_AND_DEPLOY.md`](BUILD_AND_DEPLOY.md).
> Moved from `docs/AUTH_AND_HISTORY.md` in the 2026-09-25 cleanup.

# Web auth + 60-hour history persistence — implementation notes

This document covers what was actually implemented in this pass, how to
build/flash/rotate/recover it, and exactly what remains unverified without
a physical ESP32. See the session's final report for the full PASS/FAIL
table and verdict; this file is the operational how-to.

**Update (topology-resolver pass):** the isolated LittleFS PoC referenced
below as "not yet compiled" now compiles successfully end to end
(`esphome compile test/littlefs_poc/littlefs_poc.yaml` — SUCCESS, RAM
14.1%, Flash 47.1% of that PoC's own smaller test build). Getting there
required a real fix, not just a longer wait: `jk_history_store.h/.cpp`
referenced the pure-format library's symbols (`GapResult`,
`SnapshotHeader`, `kHeaderSize`, `SlotChoice`, ...) as bare
`jk_history::X`, but both the format library AND the ESPHome component
class were named `jk_history` — from inside `namespace esphome::jk_history`,
an unqualified `jk_history::X` self-resolves to the ENCLOSING
`esphome::jk_history` namespace, not the global one the format library
actually lives in, so every one of those references silently failed once
the whole chain was linked together (the desktop unit test never caught
this because it only links `jk_history_format.cpp` in isolation, never
`jk_history_store.cpp`). Fixed by renaming the pure format library's
namespace to `jk_history_format` throughout
(`jk_history_format.{h,cpp}`, `jk_history_store.{h,cpp}`,
`test/jk_history/test_jk_history_format.cpp`) — the ESPHome component
itself stays `esphome::jk_history::JkHistoryStore`, matching
`__init__.py`'s codegen, unaffected. The 94/94 desktop unit tests still
pass unchanged (they never touched the renamed symbol's callers).
Production wiring (a `jk_history:` block + the partition-table change in
`batterylifepo4.yaml` + checkpoint/restore calls) is still **not**
applied, for the same reason as before — see "What was NOT applied to
production yet" below, now updated.

## What changed in `batterylifepo4.yaml` (applied to production)

- `wifi.ap.password`: was the hardcoded string `"change-this-password"`,
  now `!secret jk_bms_ap_password`.
- `ota[0].password`: was unset, now `!secret jk_bms_ota_password`.
- `web_server.auth`: new block, `username`/`password` plus an explicit
  `type:`. **Historical note (true when this section was first
  written):** the ESPHome version in use then (2026.6.5) had no `type:`
  key in its `web_server.auth` schema at all — Basic was the only,
  implicit option, so this block was Basic auth implicitly. **Current
  state:** the project's pinned ESPHome version is now 2026.9.0 (see
  `toolchain.lock.json`); the `type: basic|digest` key introduced by the
  previously pinned 2026.8.2 remains available;
  `batterylifepo4.yaml`'s `web_server.auth` now sets `type: digest`
  explicitly (`batterylifepo4.yaml:310-328`, see that block's own
  in-line comment for the full reasoning) — Digest never puts the
  password on the wire in an easily-reversible form the way Basic does,
  chosen deliberately since ESPHome's own default for this key stays
  `basic` until 2027.1.0. As that same comment notes, this is confirmed
  by reading the config/source, not yet by a live 401 challenge test
  against real hardware.
- Two **pre-existing, unrelated** config bugs were fixed because they
  blocked `esphome config` from validating the file at all (found during
  the mandatory pre-edit audit, not introduced by this work):
  - Five entities (`battery_state_candidate_age`, `current_sample_age`,
    `battery_state_candidate_samples`, `idle_current_noise_min`,
    `idle_current_noise_max`) were declared under `text_sensor:` but
    return numeric values / use sensor-only schema keys
    (`unit_of_measurement`, `device_class: duration`, `accuracy_decimals`)
    — moved to `sensor:`, unchanged otherwise (same `id:`, same `name:`,
    same lambda body).
  - The State-of-Charge sensor (`name: "state of charge"`, register
    `0x12A6`) had no `id:`, so `id(state_of_charge)` in the existing
    60-hour-history sampler lambda referenced a non-existent identifier
    — added `id: state_of_charge`.

## What was NOT applied to production yet

The 60-hour persistence feature (LittleFS-backed A/B snapshot) is
implemented, **unit-tested**, and — as of the topology-resolver pass —
**now confirmed to compile successfully in isolation** (see the update
note at the top of this file for the namespace bug that blocked it
before, and the fix). It is still **not wired into `batterylifepo4.yaml`**
and the new partition table is still **not applied** to it. This follows
the task's own explicit rule: a new partition table must not reach a
production device before a separate flash/OTA/recovery test — that
isolated compile PASS is the gate this rule requires before wiring can
even be considered, and clearing it is new progress this pass, but it is
not the same thing as a flash/OTA/recovery test on real hardware, which
still has not happened (no physical ESP32 available in this environment).
So per the same rule, the persistence feature stops here for now, cleanly
separated from the (already validated) auth changes and from this pass's
topology-resolver work.

What **does** exist, ready to wire into production once a real
flash/OTA/recovery cycle on physical hardware is available to verify it:

- `components/jk_history/jk_history_format.{h,cpp}` — the binary format,
  CRC32, header validation, A/B slot selection, and timestamp/Offline-gap
  logic. Pure C++, zero ESP-IDF/Arduino/ESPHome dependencies. Namespace:
  `jk_history_format` (renamed from the original `jk_history`, which
  collided with the ESPHome component's own namespace — see the update
  note above).
- `test/jk_history/test_jk_history_format.cpp` — **94 unit-style checks,
  all passing**, covering every boundary case named in the task (record
  round-trip, header validation ordering, CRC corruption detection,
  commit-marker independence from header CRC, sequence wraparound, both
  A/B selection rules, and the full 0/30/59/60/61/299/300/301s, 4h,
  exactly-60h, >60h, backwards-clock, no-wall-clock-yet, empty-history,
  and multi-reboot timestamp scenarios).
- `components/jk_history/jk_history_store.{h,cpp}` — the ESP-IDF-specific
  LittleFS lifecycle (mount, the exact 8-step A/B commit sequence, the
  "fully validate both slots including payload CRC, never just the
  header" boot-time recovery). Not desktop-testable (needs real ESP-IDF
  headers) — but now confirmed to COMPILE against real ESP-IDF via the
  PoC below; still not hardware-verified (mount, real writes/reads, power-
  loss/corruption recovery on an actual LittleFS partition).
- `components/jk_history/__init__.py` — ESPHome component registration.
  **Confirmed via a real `esphome config` run** to parse correctly, along
  with the exact `esp32.framework.components` IDF-Component-Manager
  shorthand syntax and a custom `partitions:` entry — both read directly
  from the installed ESPHome's own source, not guessed.
- `test/littlefs_poc/littlefs_poc.yaml` — the isolated proof-of-concept
  config the task requires before this touches production. **Passes both
  `esphome config` AND a full `esphome compile`** (SUCCESS, RAM 14.1%,
  Flash 47.1% of ITS OWN smaller test build — not the production
  firmware's numbers) as of this pass, including the
  `joltwallet/littlefs^1.21.1` dependency, the custom LittleFS partition,
  and the on_boot raw-LittleFS + jk_history checkpoint/restore round-trip
  logic all linking and building together.
- `test/littlefs_poc/production_partitions.csv` — the calculated,
  overlap-checked production partition table (hand-derived from
  ESPHome's own partition-generation formula, read from source), staged
  for review — not applied to `batterylifepo4.yaml`.

## Compile status (this session)

A real `esphome compile` of the (auth-only) production config was
attempted, using a freshly `pip install`-ed ESPHome 2026.6.5 in an
isolated virtualenv. It successfully:
- Resolved and downloaded the `pioarduino/platform-espressif32` platform
  (55.3.39) and ESP-IDF 5.5.4.
- Installed the Xtensa toolchain, gdb, esptool, cmake, ninja, scons, and
  the `noise-c`/`libsodium` libraries `api: encryption:` needs.
- Recovered automatically (via PlatformIO's own mirror failover) from one
  transient `403 Forbidden` against a specific package-mirror host
  (`eu2.contabostorage.com`) that this sandboxed session's network egress
  appears to intermittently block.

It did **not** reach the actual C/C++ compilation step within this
session's practical time budget — the last several checks showed the
process still installing individual toolchain sub-components (each
succeeding, just slowly, likely due to repeated instances of the same
kind of intermittent mirror blocking noted above). **This is reported
honestly as incomplete, not simulated as a pass.** ~3.5 GB of toolchain
is now cached locally; a retry from a normal (non-sandboxed) network
should complete markedly faster from that point.

**Practical implication**: the auth-only changes to `batterylifepo4.yaml`
are validated by `esphome config` (a real, fast, schema+codegen check)
but not yet by a full `esphome compile` — see the final report's
PASS/FAIL table for exactly which claims that does and does not support.

## How to build

```bash
pip install esphome   # or use the official Docker image
esphome config batterylifepo4.yaml     # fast schema/codegen validation
esphome compile batterylifepo4.yaml    # full build — needs the ESP-IDF
                                        # toolchain (first run downloads
                                        # several GB)
```

For the LittleFS PoC specifically:

```bash
esphome config test/littlefs_poc/littlefs_poc.yaml
esphome compile test/littlefs_poc/littlefs_poc.yaml
```

Both need a `secrets.yaml` alongside the YAML file being built — copy
`secrets.yaml.example` from the project root and fill in real values (the
PoC's Wi-Fi/API values can be placeholders; it never has to actually join
a network for the compile itself to succeed).

## First flash

Standard ESPHome flow — `esphome run batterylifepo4.yaml` over USB for
the very first flash (OTA needs a device that's already running ESPHome
with a reachable IP). After that, `esphome run batterylifepo4.yaml` will
prefer OTA automatically if it can find the device.

## OTA

Requires the OTA password now configured in `secrets.yaml`
(`jk_bms_ota_password`). `esphome run` / `esphome upload --device <ip>`
will prompt for or read it from the same secrets file.

## USB/serial recovery

If the Wi-Fi password, fallback-AP password, or web-auth credentials are
ever lost or wrong and the device becomes unreachable over the network:
a wired/USB reflash (`esphome run batterylifepo4.yaml` with the device
connected via USB, or `esphome upload --device /dev/ttyUSB0` /
equivalent) always works regardless of any of the above — it's the same
recovery path this project already relied on before any of these
changes, unaffected by them.

## Credential rotation

1. Edit the relevant value(s) in `secrets.yaml`.
2. Reflash — OTA if the OLD OTA password is still known and the device is
   reachable, otherwise USB.
3. No other state (Wi-Fi pairing, `device_name_override`, any future
   persisted history) is affected by rotating the web-auth or OTA
   password — they're independent secrets.

## Rollback

Every change in this pass is additive/config-level. To revert the auth
changes specifically: restore `batterylifepo4.yaml` from
`Backup/pre-auth-history-20260904/batterylifepo4.yaml.orig` (saved before
any edits in this session) or simply delete the `auth:` block under
`web_server:`, the `password:` line under `ota:`, and change
`wifi.ap.password` back to a literal string, then reflash. No partition
table was changed in production, so there is no partition-level rollback
concern for the changes actually applied.

## Behavior after a corrupted/missing snapshot (once persistence is wired in)

Per the implemented `jk_history_format`/`jk_history_store` design: a
missing file, a bad header (wrong magic/version/size/CRC), a bad payload
CRC, or a marker that isn't the exact COMMITTED sentinel all cause that
slot to be treated as fully invalid — never partially trusted. If the
OTHER slot is fully valid, it's used. If neither is, the device starts
with an empty 60-hour history and resumes normal live sampling — this is
a handled, logged, non-fatal state, not a crash or boot loop.
