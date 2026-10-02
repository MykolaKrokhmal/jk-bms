#!/usr/bin/env bash
# Mutation check of the pre-write quiescence barrier (clustered-read plan
# M8.1): each mutant re-breaks one guarantee in a copy of the REAL headers,
# and test_write_quiesce_barrier.cpp must fail against it. The unmutated
# build must pass. A mutant whose text was not found is itself a failure
# (a vacuous mutation proves nothing).
#
#   bash test/jk_write_tx/run_quiesce_barrier_mutations.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/jk-bms-quiesce-mutants.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

TEST="$REPO_ROOT/test/jk_write_tx/test_write_quiesce_barrier.cpp"
WTX="$REPO_ROOT/components/jk_write_tx/jk_write_tx_core.h"
RT="$REPO_ROOT/components/jk_poll_scheduler/jk_cluster_runtime_core.h"

build_and_run() {  # $1: include dir with the (possibly mutated) headers
  g++ -std=c++17 -O2 -I "$1" -I "$REPO_ROOT/components/jk_poll_scheduler" -I "$REPO_ROOT/components/jk_write_tx" \
    -I "$REPO_ROOT/protocol/generated" "$TEST" -o "$1/test_bin" 2>"$1/build.log" || { echo "build failed"; cat "$1/build.log"; return 2; }
  "$1/test_bin" >"$1/run.log" 2>&1
}

# mutate <name> <file: wtx|rt> <python find> <python replace> [<required FAIL text>]
# The optional last argument names a simulation check that must be among the
# failures -- so a mutant is not only caught by a unit check of the same
# function but by the end-to-end property it breaks.
failures=0
mutate() {
  local name="$1" which="$2" find="$3" repl="$4" must="${5:-}"
  local dir="$WORK/$name"
  mkdir -p "$dir"
  cp "$WTX" "$dir/jk_write_tx_core.h"
  cp "$RT" "$dir/jk_cluster_runtime_core.h"
  local target="$dir/jk_write_tx_core.h"
  [ "$which" = "rt" ] && target="$dir/jk_cluster_runtime_core.h"
  if ! FIND="$find" REPL="$repl" python3 - "$target" <<'PY'
import os, sys
p = sys.argv[1]
s = open(p).read()
f, r = os.environ["FIND"], os.environ["REPL"]
if s.count(f) != 1:
    sys.exit(1)
open(p, "w").write(s.replace(f, r))
PY
  then
    echo "FAIL  mutant $name: its target text was not found exactly once (vacuous mutation)"
    failures=$((failures + 1))
    return
  fi
  if build_and_run "$dir"; then
    echo "FAIL  mutant $name SURVIVED: test_write_quiesce_barrier passed against it"
    failures=$((failures + 1))
  elif [ -n "$must" ] && ! grep -q "^FAIL: .*$must" "$dir/run.log"; then
    echo "FAIL  mutant $name: killed, but not by the simulation check '$must'"
    grep '^FAIL' "$dir/run.log" | head -5
    failures=$((failures + 1))
  else
    echo "PASS  mutant $name killed ($(grep -c '^FAIL' "$dir/run.log") failed checks), e.g.: $(grep -m1 "^FAIL: .*${must}" "$dir/run.log")"
    if [ -n "$must" ]; then grep -m1 -B2 "^FAIL: .*${must}" "$dir/run.log" | grep -v '^FAIL' | sed 's/^/        /'; fi
  fi
}

# Baseline: the real headers pass.
mkdir -p "$WORK/baseline"
cp "$WTX" "$RT" "$WORK/baseline/"
if build_and_run "$WORK/baseline"; then
  echo "PASS  unmutated headers: $(tail -1 "$WORK/baseline/run.log")"
else
  echo "FAIL  unmutated headers do not pass"; tail -20 "$WORK/baseline/run.log"; exit 1
fi

# M1 -- the old interleaving: the barrier no longer waits for the hub, so a
# read the hub already holds goes out between the write's ACK and readback.
mutate hub_always_quiescent wtx \
  'inline bool hub_quiescent(bool tx_buffer_empty, bool tx_blocked) { return tx_buffer_empty && !tx_blocked; }' \
  'inline bool hub_quiescent(bool tx_buffer_empty, bool tx_blocked) { (void) tx_buffer_empty; (void) tx_blocked; return true; }' \
  'barrier: the write waits for the queued A1 (and its callback), then nothing interleaves'

# M2 -- an accepted intent no longer pauses new reads while the hub drains.
mutate intent_does_not_pause wtx \
  '  if (write_intent_pending || transport_cleanup_pending) return BusOwner::REGISTER_WRITE;
' \
  '  if (transport_cleanup_pending) return BusOwner::REGISTER_WRITE;
  (void) write_intent_pending;
' \
  'barrier: no read or probe is queued after the intent is accepted'

# M3 -- the barrier ignores another owner (e.g. a running write) and queues anyway.
mutate ignore_other_owner wtx \
  '  if (other_owner == BusOwner::NONE && hub_is_quiescent) return QuiesceStep::READY;' \
  '  if (hub_is_quiescent) return QuiesceStep::READY;'

# M4 -- no drain bound: an unanswered frame keeps the intent (and the read pause) forever.
mutate no_drain_timeout wtx \
  '  if (uint32_t(now_ms - accepted_ms) >= kQuiesceTimeoutMs) return QuiesceStep::TIMEOUT;' \
  '  (void) accepted_ms;' \
  'a drain that cannot finish is refused with BUS_NOT_QUIESCENT'

# M5 -- no recheck after the drain: a raw that went stale or changed is written.
mutate no_recheck rt \
  '  if (d.gate != RmwGate::READY) return r;  // STALE' \
  '  r.step = RecheckStep::DISPATCH;
  return r;' \
  'recheck after the drain refuses a raw that went stale'

# M6 -- recovery probes ignore the bus owner.
mutate probe_ignores_owner wtx \
  'inline bool recovery_probe_allowed(BusOwner owner) { return owner == BusOwner::NONE; }' \
  'inline bool recovery_probe_allowed(BusOwner owner) { (void) owner; return true; }'

# M7 -- plan M8.2: the old transport retry. A transaction frame (FC16 write,
# readback, probe) is resent by the hub up to 4 more times again.
mutate transport_retry wtx \
  'constexpr uint8_t kTransactionFrameAttempts = 1;' \
  'constexpr uint8_t kTransactionFrameAttempts = 5;' \
  'exactly one FC16 frame per confirmed request'

# M8 -- plan M8.2: transport cleanup no longer holds the bus (reads resume
# while the hub still holds the finished phase's frame).
mutate cleanup_does_not_pause wtx \
  '  if (write_intent_pending || transport_cleanup_pending) return BusOwner::REGISTER_WRITE;' \
  '  (void) transport_cleanup_pending;
  if (write_intent_pending) return BusOwner::REGISTER_WRITE;' \
  'no ordinary read and no probe goes out before transport cleanup ends'

# M9 -- plan M8.2: cleanup ends without waiting for the hub.
mutate cleanup_ignores_hub wtx \
  '  return hub_is_quiescent && !any_transaction_frame_outstanding;' \
  '  (void) hub_is_quiescent;
  return !any_transaction_frame_outstanding;' \
  'ordinary reads resume only once the hub holds neither the write'"'"'s FC16 nor its readback'

if [ "$failures" -ne 0 ]; then
  echo "quiesce barrier mutations: $failures mutant(s) survived or were vacuous"
  exit 1
fi
echo "quiesce barrier mutations: all 9 mutants killed"
