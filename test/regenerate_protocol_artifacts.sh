#!/usr/bin/env bash
# Controlled, MUTATING regeneration of every derived protocol artifact.
# This is deliberately a separate, distinctly-named command from
# test/run_release.sh (release verification): verification must fail
# closed on a stale repository, never repair it — regeneration is the
# explicit, human-invoked action that fixes staleness. Never call this
# script from test/run_release.sh or from any CI "verify" job.
#
# Usage: JK_BMS_WORKBOOK_PATH=/path/to/workbook.xlsx bash test/regenerate_protocol_artifacts.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${JK_BMS_WORKBOOK_PATH:-}" ]; then
  echo "REGENERATE_WORKBOOK_REQUIRED: set JK_BMS_WORKBOOK_PATH." >&2
  exit 2
fi

echo "=== regenerating register_catalog.json / coverage_report.md / jk_bms.js's generated block ==="
node tools/protocol/generate.js

echo
echo "=== rebuilding workbook/upstream/implementation indices + claim matrix + pipeline manifest ==="
node tools/protocol/pipeline.js build --workbook "$JK_BMS_WORKBOOK_PATH"

echo
echo "Regeneration complete. Run test/run_release.sh to VERIFY the result — this script does not verify anything itself."
