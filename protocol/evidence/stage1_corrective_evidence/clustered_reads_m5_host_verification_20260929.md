# Clustered reads M5 — host verification record (2026-09-29)

Plan: `docs/project/RS485_CLUSTERED_READ_MIGRATION_PLAN.md`, M5
(`feat(firmware): read registers in clusters`), on top of `b951402`.

**Scope: host only.** Nothing was compiled with ESPHome, flashed, uploaded
(OTA) or run on the ESP32/BMS; no Modbus request and no write was issued; no
push. Gates B, C and D were not started.

Environment: Node v24.2.0, Apple clang 21.0.0 (`g++`), macOS.

## Full regression suite

`bash test/run_all.sh` (sandbox disabled for the integration port): **exit 0,
no FAIL line**. The V1 workbook was not available, so its optional
revalidation was skipped (standard self-contained check).

Generators, all `--check` with no drift: `generate_read_clusters.js`,
`generate_read_plan.js`, `generate.js`, `generate_write_registry.js` and the
seven `tools/protocol/authoring/build_*.js`. `pipeline.js check` PASS.
`fingerprint.js`: check → review → accept (drift from the hand-written
`jk_bms.js` / `batterylifepo4.yaml` changes), then `FINGERPRINT_MATCH`.
`git diff --check` clean.

Focused results inside that run:

| Test | Result |
|---|---|
| `test_jk_cluster_scheduler_core.cpp` | 40/40 |
| `test_jk_cluster_cache_core.cpp` | 24/24 |
| `test_jk_cluster_runtime_core.cpp` (new) | 57/57 |
| `test/firmware_lambda_compile/run.js` (new) | 5/5 (14 interval/script lambdas + the read-freshness handler compile) |
| `test_cluster_servicer_structure.js` (new) | 18/18 |
| `test_sse_reconnect.js` (K0–K9 cluster events) | 131/131 |
| `test_read_clusters.js` | 26/26 |

## Mutation results (each mutant applied, test run, source restored and compared)

- **Runtime core** (`jk_cluster_runtime_core.h`): 16/18 caught — oscillating
  fallback via re-enable (latch), silent fallback, passcode read during a
  write, passcode length, bespoke reader while not latched, bespoke long and
  short length, bespoke cadence, late bespoke response, bespoke during a
  write, bespoke timeout not freeing the bus, extension gate, extension
  validity, extension offset, latch threshold, snapshot sequence source,
  duplicate RMW pre-read. The 2 survivors are equivalent mutants: a latched
  cluster is never issued again, so it can never complete successfully and
  unlatch; and a fallback cluster's raw lookup is `FALLBACK`, never
  `STALE`/`MISSING`, so the extra "not fallback" guard is redundant.
- **UI** (`jk_bms.js` cluster events): 8/8 — cluster range, skipped-revision
  resync, unknown-geometry guess, stale revision, dropped and already-covered
  pending successes, lowercase ids, cluster events bypassing the sequence.
- **Generator** (`generate_read_plan.js` servicer): 5/5 — passcode write
  outside bus ownership, busy check after issue, passcode bytes logged, event
  sequence not recorded, decode before the length check.
- **Compile harness**: 6/6 — typo in a runtime call, wrong script arity, wrong
  script parameter type, undeclared global, wrong `check_rmw` arity, wrong
  `on_bespoke_response` argument; plus a typo inside the read-freshness
  handler.

## Limits

- The lambda compile harness uses its own stubs of the ESPHome 2026.9.0 API
  (`std::span` handlers, `EntityType`), modelled on code that already
  compiled on the device; an ESPHome API mismatch is only caught by the real
  compile-only validation.
- The UI Settings freshness budgets are still the pre-migration per-group
  values (M6/M7); the firmware RMW gate enforces the strict 3.5 s budget.
