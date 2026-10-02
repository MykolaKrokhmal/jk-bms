#!/usr/bin/env bash
# Mutation check of the gate D send-attempt counter (2026-10-02). Each mutant
# re-breaks one guarantee in a copy of the REAL source and must be killed by
# the named check:
#   - C++ mutants (jk_write_tx_core.h / jk_write_tx_hub_device.h) by
#     test_tx_send_attempts.cpp (the real TxDevice on a 2026.9.1-lifecycle hub);
#   - YAML / device-wiring mutants by test_send_attempt_wiring.js.
# The unmutated sources must pass. A mutant whose text is not found exactly
# once is itself a failure (vacuous).
#
#   bash test/jk_write_tx/run_send_attempt_mutations.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/jk-bms-send-attempt-mutants.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
UNIT="$REPO_ROOT/test/jk_write_tx/test_tx_send_attempts.cpp"
STUB="$REPO_ROOT/test/jk_write_tx/esphome_modbus_stub"
WIRING="$REPO_ROOT/test/jk_write_tx/test_send_attempt_wiring.js"
CORE="components/jk_write_tx/jk_write_tx_core.h"
DEVICE="components/jk_write_tx/jk_write_tx_hub_device.h"
YAML="batterylifepo4.yaml"

run_unit() {  # $1: directory holding jk_write_tx_core.h + jk_write_tx_hub_device.h; $2: log
  g++ -std=c++20 -O1 -I "$STUB" -I "$1" "$UNIT" -o "$1/unit" >"$2" 2>&1 && "$1/unit" >>"$2" 2>&1
}

baseline="$WORK/baseline"
mkdir -p "$baseline"
cp "$REPO_ROOT/$CORE" "$REPO_ROOT/$DEVICE" "$baseline/"
if run_unit "$baseline" "$WORK/baseline_unit.log" && node "$WIRING" >"$WORK/baseline_wiring.log" 2>&1; then
  echo "PASS  unmutated sources: $(tail -1 "$WORK/baseline_unit.log"); $(tail -1 "$WORK/baseline_wiring.log")"
else
  echo "FAIL  unmutated sources do not pass"; tail -5 "$WORK/baseline_unit.log" "$WORK/baseline_wiring.log"; exit 1
fi

failures=0
total=0
# mutate <name> <repo file> <find> <replace> <required FAIL text> [<find2> <replace2>]
mutate() {
  local name="$1" file="$2" find="$3" repl="$4" must="$5" find2="${6:-}" repl2="${7:-}"
  local dir="$WORK/$name" log="$WORK/$name.log"
  total=$((total + 1))
  mkdir -p "$dir"
  cp "$REPO_ROOT/$CORE" "$REPO_ROOT/$DEVICE" "$dir/"
  cp "$REPO_ROOT/$YAML" "$dir/batterylifepo4.yaml"
  local target="$dir/$(basename "$file")"
  if ! FIND="$find" REPL="$repl" FIND2="$find2" REPL2="$repl2" python3 - "$target" <<'PY'
import os, sys
p = sys.argv[1]
s = open(p).read()
for f, r in ((os.environ["FIND"], os.environ["REPL"]), (os.environ["FIND2"], os.environ["REPL2"])):
    if not f:
        continue
    if s.count(f) != 1:
        sys.exit(1)
    s = s.replace(f, r)
open(p, "w").write(s)
PY
  then
    echo "FAIL  mutant $name: target text not found exactly once (vacuous)"; failures=$((failures + 1)); return
  fi
  local killed=0
  if [ "$file" = "$YAML" ]; then
    JK_BMS_YAML_UNDER_TEST="$target" node "$WIRING" >"$log" 2>&1 || killed=1
  else
    run_unit "$dir" "$log" || killed=1
    JK_TX_HUB_DEVICE_UNDER_TEST="$dir/jk_write_tx_hub_device.h" node "$WIRING" >>"$log" 2>&1 || true
  fi
  if [ "$killed" -eq 0 ]; then
    echo "FAIL  mutant $name SURVIVED"; failures=$((failures + 1))
  elif ! grep -q "^FAIL  .*$must" "$log"; then
    echo "FAIL  mutant $name: killed, but not by '$must'"; grep -m3 -E '^FAIL|error' "$log"; failures=$((failures + 1))
  else
    echo "PASS  mutant $name killed ($(grep -c '^FAIL' "$log") failed checks), incl.: $(grep -m1 "^FAIL  .*$must" "$log")"
  fi
}

# C1 -- counted at queue time instead of at the hub's transmission.
mutate count_at_queue "$DEVICE" \
  'jk_write_tx::count_frame_attempt(this->tx_attempts_, this->purpose_, fc);' \
  '(void) fc;' \
  'queueing alone counts nothing' \
  'if (this->write_multiple_registers(start, values)) return true;' \
  'if (this->write_multiple_registers(start, values)) { jk_write_tx::count_frame_attempt(this->tx_attempts_, this->purpose_, jk_write_tx::kFunctionWriteMultipleRegisters); return true; }'

# C2 -- a new transaction inherits the previous one's counts.
mutate no_reset_per_transaction "$DEVICE" \
  'void begin_transaction_attempts() { this->tx_attempts_ = {}; }' \
  'void begin_transaction_attempts() {}' \
  'accounting restarts at 0'

# C2b -- a phase end (timeout -> cancel) wipes the FC16 already sent.
mutate reset_on_cancel "$DEVICE" \
  '    if (this->parent_ != nullptr) this->clear_tx_queue_for_device();
    this->disarm_();' \
  '    if (this->parent_ != nullptr) this->clear_tx_queue_for_device();
    this->tx_attempts_ = {};
    this->disarm_();' \
  'the hub.s own frame count'

# C3 -- forced readback and recovery probe counted into each other.
mutate readback_probe_swapped "$CORE" \
  ': purpose == FramePurpose::READBACK              ? a.readback' \
  ': purpose == FramePurpose::READBACK              ? a.probe' \
  'told apart'

# C4 -- FC16 classified by intent instead of by the PDU that was sent.
mutate fc16_by_purpose "$CORE" \
  'uint8_t &c = function_code == kFunctionWriteMultipleRegisters ? a.fc16' \
  'uint8_t &c = purpose == FramePurpose::WRITE ? a.fc16' \
  'the sent PDU decides'

# C5 -- the transport retry is back: the counter must expose the second FC16.
mutate transport_retry_back "$CORE" \
  'constexpr uint8_t kTransactionFrameAttempts = 1;' \
  'constexpr uint8_t kTransactionFrameAttempts = 2;' \
  'never resent'

# C6 -- the boot-wide total counts every frame, FC03 included.
mutate total_counts_every_frame "$DEVICE" \
  'if (fc == jk_write_tx::kFunctionWriteMultipleRegisters) g_fc16_sent_total++;' \
  'g_fc16_sent_total++;' \
  'grew by exactly one'

# C7 -- the snapshot drops the FC16 count.
mutate snapshot_without_fc16 "$CORE" \
  ',\"fn\":%u,\"qty\":%u,\"fc16_send_attempts\":%u,\"readback_send_attempts\":%u,"' \
  ',\"fn\":%u,\"qty\":%u,\"fc16\":%u,\"readback_send_attempts\":%u,"' \
  'three send-attempt counts'

# Y1 -- the firmware never restarts a slot's accounting.
mutate yaml_no_begin "$YAML" \
  '          jk_write_tx_bus::g_slot_devices[idx].begin_transaction_attempts();
' \
  '' \
  'starts its accounting at 0'

# Y2 -- the forced readback is labelled as a probe.
mutate yaml_readback_as_probe "$YAML" \
  'register_count, on_readback, jk_write_tx::FramePurpose::READBACK)' \
  'register_count, on_readback, jk_write_tx::FramePurpose::PROBE)' \
  'labelled READBACK'

# Y3 -- the snapshot never publishes the counts.
mutate yaml_snapshot_without_counts "$YAML" \
  'jk_write_tx_bus::g_slot_devices[i].transaction_attempts());
            out += buf;' \
  'jk_write_tx_bus::g_slot_devices[i].transaction_attempts());' \
  'closes each slot object'

# Y4 -- a NO_CHANGE result without the boot-wide FC16 total.
mutate yaml_no_change_without_total "$YAML" \
  'no Modbus command (fc16_sent_total=%u)",
                       unsigned(w.address), unsigned(jk_write_tx_bus::g_fc16_sent_total));' \
  'no Modbus command",
                       unsigned(w.address));' \
  'NO_CHANGE log lines carry fc16_sent_total'

if [ "$failures" -ne 0 ]; then
  echo "send attempt mutations: $failures of $total mutant(s) survived, were vacuous or killed by the wrong check"
  exit 1
fi
echo "send attempt mutations: all $total mutants killed"
