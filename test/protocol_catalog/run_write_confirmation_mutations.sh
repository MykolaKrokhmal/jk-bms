#!/usr/bin/env bash
# Mutation check of the in-page write confirmation (2026-10-02): each mutant
# re-breaks one guarantee in a copy of the REAL jk_bms.js, and
# test_settings_catalog.js must fail against it (its runWriteConfirmationScenario
# drives the real page on a controlled clock). The unmutated file must pass.
# A mutant whose text was not found is itself a failure (vacuous).
#
#   bash test/protocol_catalog/run_write_confirmation_mutations.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/jk-bms-confirm-mutants.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
TEST="$REPO_ROOT/test/protocol_catalog/test_settings_catalog.js"
SRC="$REPO_ROOT/jk_bms.js"

run_against() {  # $1: jk_bms.js copy; $2: log
  JK_BMS_JS_UNDER_TEST="$1" node "$TEST" >"$2" 2>&1
}

if run_against "$SRC" "$WORK/baseline.log"; then
  echo "PASS  unmutated jk_bms.js: $(grep -E 'settings catalog DOM test summary' "$WORK/baseline.log")"
else
  echo "FAIL  unmutated jk_bms.js does not pass"; tail -20 "$WORK/baseline.log"; exit 1
fi

failures=0
# mutate <name> <python find> <python replace> [<required FAIL text, or "exit" for a crash/non-zero exit>]
mutate() {
  local name="$1" find="$2" repl="$3" must="${4:-}"
  local copy="$WORK/$name.js" log="$WORK/$name.log"
  if ! FIND="$find" REPL="$repl" python3 - "$SRC" "$copy" <<'PY'
import os, sys
s = open(sys.argv[1]).read()
f, r = os.environ["FIND"], os.environ["REPL"]
if s.count(f) != 1:
    sys.exit(1)
open(sys.argv[2], "w").write(s.replace(f, r))
PY
  then
    echo "FAIL  mutant $name: target text not found exactly once (vacuous)"; failures=$((failures + 1)); return
  fi
  if run_against "$copy" "$log"; then
    echo "FAIL  mutant $name SURVIVED"; failures=$((failures + 1))
  elif [ -n "$must" ] && [ "$must" != "exit" ] && ! grep -q "^FAIL  .*$must" "$log"; then
    echo "FAIL  mutant $name: killed, but not by '$must'"; grep '^FAIL' "$log" | head -3; failures=$((failures + 1))
  else
    if [ "$must" = "exit" ]; then
      echo "PASS  mutant $name killed (non-zero exit): $(grep -m1 -E 'window\.confirm|confirm\(\) called' "$log" || grep -m1 '^FAIL' "$log")"
    else
      echo "PASS  mutant $name killed ($(grep -c '^FAIL' "$log") failed checks), incl.: $(grep -m1 "^FAIL  .*$must" "$log")"
    fi
  fi
}

# M1 -- the blocking native dialog is back.
mutate blocking_window_confirm \
  'const confirmed = await openWriteConfirmation(t("writeRegistry.confirmPrompt", {' \
  'const confirmed = window.confirm(t("writeRegistry.confirmPrompt", {' \
  exit

# M2 -- OK posts without the final revalidation.
mutate no_final_revalidation \
  'const problem = await revalidateWriteConfirmation(entry, value, shown);' \
  'const problem = null;' \
  'raw changed while open -> zero POST'

# M3 -- Cancel still posts.
mutate post_after_cancel \
  'if (!confirmed) { button.disabled = settingsWriteReadiness(entry.key).kind !== "fresh"; setRequestMessage(messageId, "", ""); return; }' \
  'if (!confirmed) { button.disabled = settingsWriteReadiness(entry.key).kind !== "fresh"; setRequestMessage(messageId, "", ""); }' \
  'Cancel closes the dialog'

# M4 -- a second confirmation may start while one is open.
# (Removing the dialog's own `settled` guard is an equivalent mutant: the
# Promise settles once, so a double OK already posts once -- WC14 still
# asserts it. Not listed, as it cannot be killed.)
mutate concurrent_confirmations \
  '    if (writeConfirmationPending) {' \
  '    if (false) {' \
  'a second confirmation while one is open is refused'

if [ "$failures" -ne 0 ]; then
  echo "write confirmation mutations: $failures mutant(s) survived or were vacuous"
  exit 1
fi
echo "write confirmation mutations: all 4 mutants killed"
