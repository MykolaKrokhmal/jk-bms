#!/usr/bin/env bash
# Single command to run every automated check in this repo. Exits non-zero
# on the first failure. Needs a real TCP port for the integration suite —
# if running inside a sandboxed shell, disable the sandbox for this script.
#
# Stage 1 Remediation (CODEX_STAGE_1_REVIEW.md P2-1 / defect 14, Крок L):
# rewritten so that (a) every compiled C++ test binary lives ONLY in a
# `mktemp -d` build directory, never inside the repo tree, cleaned up via
# `trap` on normal exit, failure, or a signal — not just on the happy path;
# (b) TEST_PORT, whether caller-supplied or auto-picked, is verified free
# BEFORE the integration suite starts, with a clear diagnostic instead of a
# raw EADDRINUSE; (c) the whole script has an overall timeout so a hang
# fails loudly instead of running forever.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"

BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/jk-bms-test-build.XXXXXX")"
cleanup() {
  local exit_code=$?
  rm -rf "$BUILD_DIR"
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

# --- port selection/verification -------------------------------------------
# A caller-supplied TEST_PORT is verified free before anything binds to it
# (a clear "port busy" diagnostic beats a raw EADDRINUSE mid-suite); with no
# TEST_PORT given, the OS picks a genuinely free ephemeral port (bind to 0,
# read back the assigned port, close) instead of a second hardcoded guess.
pick_or_verify_port() {
  node -e '
    const net = require("net");
    const requested = process.env.TEST_PORT ? Number(process.env.TEST_PORT) : 0;
    const srv = net.createServer();
    srv.once("error", (err) => {
      if (requested) {
        console.error(`TEST_PORT=${requested} is not free: ${err.message}`);
      } else {
        console.error(`could not allocate a free ephemeral port: ${err.message}`);
      }
      process.exit(1);
    });
    srv.listen(requested, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => { process.stdout.write(String(port)); });
    });
  '
}
TEST_PORT="$(pick_or_verify_port)"
export TEST_PORT
echo "Using TEST_PORT=${TEST_PORT} (verified free just before use)"

echo
echo "=== jk_write_tx_core unit tests ==="
g++ -std=c++17 -Wall -Wextra -I "$REPO_ROOT/components/jk_write_tx" \
  "$REPO_ROOT/test/jk_write_tx/test_jk_write_tx_core.cpp" -o "$BUILD_DIR/test_jk_write_tx_core"
"$BUILD_DIR/test_jk_write_tx_core"

echo
echo "=== jk_write_tx_core RMW (Stage 4) unit tests ==="
g++ -std=c++17 -Wall -Wextra -I "$REPO_ROOT/components/jk_write_tx" \
  "$REPO_ROOT/test/jk_write_tx/test_jk_write_tx_rmw_core.cpp" -o "$BUILD_DIR/test_jk_write_tx_rmw_core"
"$BUILD_DIR/test_jk_write_tx_rmw_core"

echo
echo "=== Wire-resistance calibration units: raw uOhm <-> displayed mOhm round trip (real encoder + generated rows) ==="
g++ -std=c++17 -Wall -Wextra -I "$REPO_ROOT/components/jk_write_tx" -I "$REPO_ROOT/protocol/generated" \
  "$REPO_ROOT/test/jk_write_tx/test_jk_write_tx_wire_resistance_units.cpp" -o "$BUILD_DIR/test_jk_write_tx_wire_resistance_units"
"$BUILD_DIR/test_jk_write_tx_wire_resistance_units"

echo
echo "=== jk_write_tx_core width-aware preflight-geometry unit tests (2026-09-21 hardware-acceptance corrective pass) ==="
g++ -std=c++17 -Wall -Wextra -I "$REPO_ROOT/components/jk_write_tx" \
  "$REPO_ROOT/test/jk_write_tx/test_jk_write_tx_preflight_geometry.cpp" -o "$BUILD_DIR/test_jk_write_tx_preflight_geometry"
"$BUILD_DIR/test_jk_write_tx_preflight_geometry"

echo
echo "=== jk_write_tx_core HTTP-task-to-main-loop handoff mailbox unit + concurrency-stress tests (2026-09-21 post-reboot fail-closed rearchitecture) ==="
g++ -std=c++17 -Wall -Wextra -pthread -I "$REPO_ROOT/components/jk_write_tx" \
  "$REPO_ROOT/test/jk_write_tx/test_jk_write_tx_mailbox.cpp" -o "$BUILD_DIR/test_jk_write_tx_mailbox"
"$BUILD_DIR/test_jk_write_tx_mailbox"

echo
echo "=== jk_reset_diag_core unit tests (2026-09-21 post-reboot observability pass) ==="
g++ -std=c++17 -Wall -Wextra -I "$REPO_ROOT/components/jk_diag" \
  "$REPO_ROOT/test/jk_diag/test_jk_reset_diag_core.cpp" -o "$BUILD_DIR/test_jk_reset_diag_core"
"$BUILD_DIR/test_jk_reset_diag_core"

echo
echo "=== jk_write_tx_core RMW (Stage 4) end-to-end integration test (real generated read_plan_decode.h) ==="
g++ -std=c++17 -Wall -Wextra -I "$REPO_ROOT" -I "$REPO_ROOT/components/jk_write_tx" -I "$REPO_ROOT/components/jk_poll_scheduler" \
  "$REPO_ROOT/test/jk_write_tx/test_jk_write_tx_rmw_end_to_end.cpp" -o "$BUILD_DIR/test_jk_write_tx_rmw_end_to_end"
"$BUILD_DIR/test_jk_write_tx_rmw_end_to_end"

echo
echo "=== jk_history_format unit tests ==="
g++ -std=c++17 -Wall -Wextra -I "$REPO_ROOT/components/jk_history" \
  "$REPO_ROOT/test/jk_history/test_jk_history_format.cpp" "$REPO_ROOT/components/jk_history/jk_history_format.cpp" \
  -o "$BUILD_DIR/test_jk_history_format"
"$BUILD_DIR/test_jk_history_format"

echo
echo "=== jk_poll_scheduler_core unit tests ==="
g++ -std=c++17 -Wall -Wextra -I "$REPO_ROOT/components/jk_poll_scheduler" \
  "$REPO_ROOT/test/jk_poll_scheduler/test_jk_poll_scheduler_core.cpp" -o "$BUILD_DIR/test_jk_poll_scheduler_core"
"$BUILD_DIR/test_jk_poll_scheduler_core"

echo
echo "=== electrical_metrics_scan golden-vector decode tests ==="
g++ -std=c++17 -Wall -Wextra -I "$REPO_ROOT/components/jk_poll_scheduler" \
  "$REPO_ROOT/test/jk_poll_scheduler/test_electrical_metrics_decode.cpp" -o "$BUILD_DIR/test_electrical_metrics_decode"
"$BUILD_DIR/test_electrical_metrics_decode"

echo
echo "=== jk_topology_core unit tests (4S/8S/16S/24S/32S, transitions, sparse/high-bit masks, UNKNOWN/MISMATCH) ==="
g++ -std=c++17 -Wall -Wextra -I "$REPO_ROOT/components/jk_topology" \
  "$REPO_ROOT/test/jk_topology/test_jk_topology_core.cpp" -o "$BUILD_DIR/test_jk_topology_core"
"$BUILD_DIR/test_jk_topology_core"

echo
echo "=== publish-sequence simulation (decode-gate + resolve_topology, N=4/8/16/24/32 x 7 topology states, no publish-then-blank flicker) ==="
g++ -std=c++17 -Wall -Wextra -I "$REPO_ROOT/components/jk_topology" \
  "$REPO_ROOT/test/jk_topology/test_publish_sequence_simulation.cpp" -o "$BUILD_DIR/test_publish_sequence_simulation"
"$BUILD_DIR/test_publish_sequence_simulation"

echo
echo "=== jk_capability_core unit tests (bounded probing, no starvation, CellWireRes16-31 / CellConWireRes0-31) ==="
g++ -std=c++17 -Wall -Wextra -I "$REPO_ROOT/components/jk_capability" \
  "$REPO_ROOT/test/jk_capability/test_jk_capability_core.cpp" -o "$BUILD_DIR/test_jk_capability_core"
"$BUILD_DIR/test_jk_capability_core"

echo
echo "=== read_plan_decode.h generated-table integration test ==="
# Two -I roots: repo root (so #include "protocol/generated/read_plan_decode.h"
# resolves the same way it does from batterylifepo4.yaml's own includes:) AND
# the component dir (so THAT header's own bare #include "jk_poll_scheduler_core.h"
# resolves too -- a bare filename, not the full components/... path, because
# ESPHome's real `includes:` flattens every included file into one shared
# build src/ directory with no subdirectory structure preserved; confirmed
# directly against a real `esphome compile`, see generate_read_plan.js's own
# comment on this).
g++ -std=c++17 -Wall -Wextra -I "$REPO_ROOT" -I "$REPO_ROOT/components/jk_poll_scheduler" \
  "$REPO_ROOT/test/jk_poll_scheduler/test_read_plan_decode.cpp" -o "$BUILD_DIR/test_read_plan_decode"
"$BUILD_DIR/test_read_plan_decode"

echo
echo "=== protocol catalog: schema + semantic + cross-file validator ==="
node test/register_catalog/validate.js

echo
echo "=== protocol catalog: packed-register codec round-trip tests ==="
node test/protocol_catalog/test_packed_codec.js

echo
echo "=== protocol catalog: negative validator fixtures ==="
node test/protocol_catalog/test_negative_fixtures.js

echo
echo "=== protocol catalog: generator determinism (--check) ==="
node tools/protocol/generate.js --check

echo
echo "=== read plan: generator determinism (--check) ==="
node tools/protocol/generate_read_plan.js --check

echo
echo "=== Stage 4: write registry generator determinism (--check) ==="
node tools/protocol/generate_write_registry.js --check

echo
echo "=== Stage 2: V1.1 manifest / PDF-locator / settings-UI-mapping generator determinism (--check) ==="
python3 protocol/evidence/build_v2_manifest.py --workbook protocol/evidence/LiFePO4_BMS_Parameters_registers-V2_verified.xlsx --check
node tools/protocol/authoring/build_pdf_locators.js --check
node tools/protocol/authoring/build_settings_ui_mapping.js --check

echo
echo "=== Stage 3: exact status-map generator determinism (--check) ==="
node tools/protocol/authoring/build_stage3_status_map.js --check

echo
echo "=== Stage 4: authoritative RW inventory generator determinism (--check) ==="
node tools/protocol/authoring/build_stage4_rw_inventory.js --check

echo
echo "=== Stage 4: authoritative 97-row RW inventory regression ==="
node test/protocol_catalog/test_stage4_rw_inventory.js

echo
echo "=== Stage 4: write registry exact-equality proof ==="
node test/protocol_catalog/test_stage4_write_registry_equality.js

echo
echo "=== Stage 4: closure invariants (2026-09-22, Stage 4/5 boundary) ==="
node test/protocol_catalog/test_stage4_closure_invariants.js

echo
echo "=== Stage 4: write registry HTTP end-to-end (spawns its own demo server) ==="
node test/protocol_catalog/test_stage4_write_http_simulator_end_to_end.js
node test/protocol_catalog/test_stage4_register_write_simulator_end_to_end.js
node test/protocol_catalog/test_write_registry_ui_structural.js
node test/protocol_catalog/test_write_registry_ui.js
node test/protocol_catalog/test_register_write_handoff_structural.js

echo
echo "=== Stage 5: service-action generator determinism (--check) ==="
node tools/protocol/authoring/build_stage5_service_actions.js --check

echo
echo "=== Stage 5: authoritative 8-command inventory/registry regression ==="
node test/protocol_catalog/test_stage5_service_actions.js

echo
echo "=== Stage 5: canonical-source negative fixtures (schema + semantic invariants) ==="
node test/protocol_catalog/test_stage5_service_actions_negative_fixtures.js

echo
echo "=== Stage 5: service-action panel UI structural regression ==="
node test/protocol_catalog/test_stage5_service_actions_ui_structural.js

echo
echo "=== Cell-composite batch: generated Settings view-model generator determinism (--check) ==="
node tools/protocol/authoring/build_settings_view_model.js --check

echo
echo "=== protocol catalog: generation atomicity + simulated-failure detection ==="
node test/protocol_catalog/test_generation_atomicity.js

echo
echo "=== protocol catalog: exhaustive blocked/unlocked write surface (spawns its own demo server) ==="
node test/protocol_catalog/test_blocked_write_surface.js

echo
echo "=== protocol catalog: single-pipeline orchestrator (tools/protocol/pipeline.js check) ==="
# This is the critical release-evidence gate — it always runs, unconditionally,
# and its exit code always gates this script's own exit code (set -e above),
# never just a conditionally-printed step. The repo-committed, SHA-256-
# verified V2 workbook is sufficient on any checkout — no personal file
# needed. If JK_BMS_WORKBOOK_PATH is ALSO set (a personal file, never
# committed to this repo), pipeline.js additionally revalidates against the
# legacy V1 workbook as an extra, optional layer — never a precondition for
# this step to run, and never able to make this step silently skip.
if [ -n "${JK_BMS_WORKBOOK_PATH:-}" ]; then
  node tools/protocol/pipeline.js check --workbook "$JK_BMS_WORKBOOK_PATH"
else
  node tools/protocol/pipeline.js check
fi

echo
echo "=== protocol catalog: implementation fingerprint (check, non-mutating) ==="
node tools/protocol/fingerprint.js check

echo
echo "=== protocol catalog: fingerprint-drift regression ==="
node test/protocol_catalog/test_fingerprint_drift_regression.js

echo
echo "=== protocol catalog: claim-matrix exact-set invariant ==="
node test/protocol_catalog/test_claim_matrix_invariant.js

echo
echo "=== protocol catalog: capacity_remaining (0x12A8) signedness regression ==="
node test/protocol_catalog/test_capacity_remaining_signedness.js

echo
echo "=== protocol catalog: mixed-generation artifact rejection (self-contained; extra pass if JK_BMS_WORKBOOK_PATH is set) ==="
node test/protocol_catalog/test_mixed_generation_rejection.js

echo
echo "=== protocol catalog: entity/wire-ID collision regression (Крок M) ==="
node test/protocol_catalog/test_entity_id_collision.js

echo
echo "=== protocol catalog: exhaustive runtime key-space invariant (RS485 plan Stage 1) ==="
node test/protocol_catalog/test_runtime_key_space.js

echo
echo "=== protocol catalog: generated entity routes vs real ESPHome publishers (RS485 plan Stage 2) ==="
node test/protocol_catalog/test_entity_route_publishers.js

echo
echo "=== protocol catalog: credential redaction (setup passcode never published; security remediation) ==="
node test/protocol_catalog/test_credential_redaction.js

echo
echo "=== protocol catalog: generated wire-object-id alias coverage/collision + resolution regression ==="
node test/protocol_catalog/test_wire_object_id_aliases.js

echo
echo "=== protocol catalog: numeric register-editor input pattern validity regression ==="
node test/protocol_catalog/test_input_pattern_validity.js

echo
echo "=== protocol catalog: generic write-tx ACK-readback/recovery-probe register-count unit fix regression ==="
node test/protocol_catalog/test_write_tx_register_count.js

echo
echo "=== protocol catalog: bespoke read (0x1200/0x126A/0x106C/0x1240/0x1470) register-count unit fix regression ==="
node test/protocol_catalog/test_bespoke_read_register_count.js

echo
echo "=== protocol catalog: generic read-plan register-count systemic fix (block_class, exact-length validation, 0x1290 clustered exception) ==="
node test/protocol_catalog/test_generic_read_plan_register_count.js

echo
echo "=== protocol catalog: inactive-channel publish-before-blank fix regression (cell_voltage 1-32 gate) ==="
node test/protocol_catalog/test_cell_voltage_publish_gate.js

echo
echo "=== protocol catalog: MaxVolCellNbr/MinVolCellNbr (0x1248) + CellWireResSta (0x128C) read-only implementation regression ==="
node test/protocol_catalog/test_min_max_native_and_wire_res_status.js

echo
echo "=== protocol catalog: 0x12D0 sensor_heating_mask metadata correction regression ==="
node test/protocol_catalog/test_0x12d0_metadata_correction.js

echo
echo "=== protocol catalog: OVERLAPPING_MASKS architectural blocker (0x12D0/0x12A0 bit-projection gap, reproduced against the real checker) ==="
node test/protocol_catalog/test_overlapping_masks_architectural_blocker.js

echo
echo "=== protocol catalog: secret-leakage scan ==="
node test/protocol_catalog/test_secret_scan.js

echo
echo "=== protocol catalog: active-group rate-limit HTTP response regression ==="
node test/protocol_catalog/test_active_group_rate_limit_response.js

echo
echo "=== protocol catalog: Діагностика software-variables scroll-reset regression ==="
node test/protocol_catalog/test_diagnostic_software_variables_scroll.js

echo
echo "=== protocol catalog: exact-decimal companion routing/duplication regression ==="
node test/protocol_catalog/test_exact_decimal_companion_routing.js

echo
echo "=== protocol catalog: cell-channel capability batch (CellVol/CellWireRes/CellConWireRes, mask precision) ==="
node test/protocol_catalog/test_cell_channel_batch.js

echo
echo "=== protocol catalog: cell-channel frontend (activeCellCount adaptive hiding, LOADING/PENDING/MISMATCH) ==="
node test/protocol_catalog/test_cell_channel_frontend.js

echo
echo "=== protocol catalog: Settings/Diagnostics register-list cell-channel hiding (N=8/16/24/32, 16->8 transition, late SSE) ==="
node test/protocol_catalog/test_diagnostic_cell_channel_hiding.js

echo
echo "=== Cell-composite batch: generated Settings view-model determinism + full inventory + 32-channel binding ==="
node test/protocol_catalog/test_settings_view_model.js

echo
echo "=== Cell-composite batch: composite cell-row DOM behavior (N=8/16/24/32, SSE updates, draft/focus, write policy, i18n) ==="
node test/protocol_catalog/test_cell_composite_rows.js

echo
echo "=== Finish-Settings-architecture batch: generic Settings catalog DOM behavior (catalog-first, R/RW/W shapes, SSE, dirty/focus, i18n) ==="
node test/protocol_catalog/test_settings_catalog.js

echo
echo "=== Browser resume fix: SSE reconnect after sleep/offline/bfcache (controlled clock, one EventSource, fail-closed) ==="
node test/protocol_catalog/test_sse_reconnect.js

echo
echo "=== Settings controls simplification: one control style, distinct states, reserved status track, phone layout (jk_bms.css) ==="
node test/protocol_catalog/test_settings_controls_css.js

echo
echo "=== Finish-Settings-architecture batch: Settings ownership invariant (N=0/8/16/24/32, no gaps/duplicates) ==="
node test/protocol_catalog/test_settings_ownership.js

echo
echo "=== Settings correctness fix: value formatting + BIT dropdown DOM behavior (text/HEX exactness, No/Yes select, numeric constraints) ==="
node test/protocol_catalog/test_settings_value_formatting.js

echo
echo "=== Protocol entity routing fix: generated route table (generator/model coverage invariants) ==="
node test/protocol_catalog/test_protocol_entity_routes.js

echo
echo "=== Protocol entity routing fix: production ingest->state->DOM behavior (real registerEntity/entityByWireId/ingestPayload/Settings catalog) ==="
node test/protocol_catalog/test_protocol_entity_routing.js

echo
echo "=== Settings read-value fix: total_voltage_raw/current_raw public sensors + 0x1290 decode fan-out (generated artifacts) ==="
node test/protocol_catalog/test_electrical_metrics_public_sensors.js

echo
echo "=== Unmapped-rows cleanup: TempSensorAbsent mapping + permanent unsupported classification ==="
node test/protocol_catalog/test_unmapped_rows_cleanup.js

echo
echo "=== Stage 3: build_stage3_status_map.js exact-field-identity classifier fix regression ==="
node test/protocol_catalog/test_stage3_status_map_exact_identity.js

echo
echo "=== Stage 3: build_stage3_status_map.js wire-position collision hardening (ambiguity guard + terminology) ==="
node test/protocol_catalog/test_stage3_status_map_collision_hardening.js

echo
echo "=== Stage 3: 0x1114 read-only bit-cluster (HeatEN..TimedStoredData + ChargingFloatMode unblocked) ==="
node test/protocol_catalog/test_0x1114_bit_cluster.js

echo
echo "=== Stage 3: generalized projection architecture (schema-level, synthetic fixtures) ==="
node test/protocol_catalog/test_projection_architecture.js

echo
echo "=== Stage 3: projection decoder (0x12D0/0x12A0, real generated read plan, executable) ==="
node test/protocol_catalog/test_projection_decoder.js

echo
echo "=== Stage 3: projection status-map/UI/safety consolidated coverage ==="
node test/protocol_catalog/test_projection_status_ui_safety.js

echo
echo "=== Stage 2: settings UI mapping completeness (265/265) ==="
node test/protocol_catalog/test_stage2_mapping_completeness.js

echo
echo "=== Stage 2: PDF/workbook evidence-pair completeness ==="
node test/protocol_catalog/test_stage2_evidence_completeness.js

echo
echo "=== JS syntax checks ==="
node --check jk_bms.js
node --check demo/mock-server.js
node --check demo/panel.js
node --check test/topology/run.js
echo "syntax OK"

echo
echo "=== topology + write-transaction integration suite ==="
node test/topology/run.js

echo
echo "=== release runner: ephemeral port allocation ==="
node test/protocol_catalog/test_port_allocation.js

echo
echo "=== release runner: orchestration engine regression (timeout/process-tree/non-mutation guard) ==="
node test/protocol_catalog/test_release_runner.js

echo
echo "All suites passed."

# --- working-tree cleanliness proof -----------------------------------------
# Every build artifact above lives in $BUILD_DIR (removed by the trap on
# exit), so nothing this script does should ever appear as a new untracked
# file. Report it plainly rather than asserting it — this script does not
# know what OTHER uncommitted work the caller already has pending.
UNTRACKED_AFTER="$(git status --short --untracked-files=all | grep '^??' || true)"
if [ -n "$UNTRACKED_AFTER" ]; then
  echo
  echo "NOTE: untracked files present after the suite (review whether any of these are test-run artifacts):"
  echo "$UNTRACKED_AFTER"
fi
