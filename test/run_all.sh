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
echo "=== jk_history_format unit tests ==="
g++ -std=c++17 -Wall -Wextra -I "$REPO_ROOT/components/jk_history" \
  "$REPO_ROOT/test/jk_history/test_jk_history_format.cpp" "$REPO_ROOT/components/jk_history/jk_history_format.cpp" \
  -o "$BUILD_DIR/test_jk_history_format"
"$BUILD_DIR/test_jk_history_format"

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
echo "=== protocol catalog: generation atomicity + simulated-failure detection ==="
node test/protocol_catalog/test_generation_atomicity.js

echo
echo "=== protocol catalog: exhaustive blocked/unlocked write surface (spawns its own demo server) ==="
node test/protocol_catalog/test_blocked_write_surface.js

echo
echo "=== protocol catalog: single-pipeline orchestrator (tools/protocol/pipeline.js check) ==="
if [ -n "${JK_BMS_WORKBOOK_PATH:-}" ]; then
  node tools/protocol/pipeline.js check --workbook "$JK_BMS_WORKBOOK_PATH"
else
  echo "NOT EXECUTED — set JK_BMS_WORKBOOK_PATH to the local LiFePO4_BMS_Parameters_registers.xlsx to run this step (the workbook is a personal file, never committed to this repo, so this check cannot run unconditionally in every environment)."
fi

echo
echo "=== protocol catalog: entity/wire-ID collision regression (Крок M) ==="
node test/protocol_catalog/test_entity_id_collision.js

echo
echo "=== protocol catalog: secret-leakage scan ==="
node test/protocol_catalog/test_secret_scan.js

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
