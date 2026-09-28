#!/usr/bin/env bash
# Firmware-stack regression test for the read-only diagnostic probe.
#
# Every YAML-facing entry point of jk_bms_probe.yaml (stack_harness.cpp) must
# keep its own stack frame <= FRAME_LIMIT bytes at every optimisation level
# the ESPHome build may use (ESPHome 2026.9.0 builds with -O3; -O2/-Os are
# checked too so the result does not hinge on one inliner decision).
#
# Why 2048 bytes: the ESP32 loopTask stack is 8192 bytes and ESPHome's own
# call chain (App::loop -> interval/logger/modbus hub -> lambda, plus the
# logger's formatting) runs on it. A diagnostic frame of at most a quarter
# of the stack leaves >= 6 KB for ESPHome. The original
# `*this = Probe();` needed ~32 KB and crashed the image on every boot
# (2026-09-27 accidental Gate A OTA, automatic rollback).
#
# Checks, per optimisation level:
#   1. the harness compiles with -Wframe-larger-than=FRAME_LIMIT -Werror;
#   2. -fstack-usage reports every harness entry point, each <= FRAME_LIMIT
#      and "static" (no dynamically sized frame);
#   3. no function in the unit, including out-of-line callees such as
#      Probe::begin, exceeds FRAME_LIMIT.
#
# JK_DIAG_PROBE_INCLUDE overrides the header directory (mutation checks).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INCLUDE_DIR="${JK_DIAG_PROBE_INCLUDE:-$REPO_ROOT/components/jk_diag_probe}"
CXX="${CXX:-g++}"
FRAME_LIMIT=2048
ENTRIES="yaml_on_boot yaml_command_sent yaml_logger_on_message yaml_response yaml_interval yaml_summary_line"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/jk_diag_stack.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

checks=0
failures=0
check() {
  checks=$((checks + 1))
  if [ "$1" = ok ]; then echo "PASS  $2"; else failures=$((failures + 1)); echo "FAIL  $2"; fi
}

for opt in -O3 -O2 -Os; do
  obj="$WORK/stack_harness$opt.o"
  if "$CXX" -std=c++17 "$opt" -Wall -Wextra -Wframe-larger-than=$FRAME_LIMIT -Werror -fstack-usage \
      -I "$INCLUDE_DIR" -I "$REPO_ROOT/components/jk_capability" \
      -c "$REPO_ROOT/test/jk_diag_probe/stack_harness.cpp" -o "$obj" 2> "$WORK/cc$opt.log"; then
    check ok "$opt: every entry point compiles under -Wframe-larger-than=$FRAME_LIMIT -Werror"
  else
    check fail "$opt: every entry point compiles under -Wframe-larger-than=$FRAME_LIMIT -Werror -- $(grep -m1 -o 'stack frame size[^[]*\|frame size[^[]*' "$WORK/cc$opt.log" || head -c 200 "$WORK/cc$opt.log")"
    # Still measure: rebuild without -Werror so the .su report exists.
    "$CXX" -std=c++17 "$opt" -fstack-usage -I "$INCLUDE_DIR" -I "$REPO_ROOT/components/jk_capability" \
      -c "$REPO_ROOT/test/jk_diag_probe/stack_harness.cpp" -o "$obj" 2>/dev/null || true
  fi
  su="${obj%.o}.su"
  for entry in $ENTRIES; do
    row="$(grep -E "[: ]$entry[[:space:]]" "$su" 2>/dev/null | head -1 || true)"
    if [ -z "$row" ]; then check fail "$opt: $entry has a stack-usage record"; continue; fi
    bytes="$(printf '%s\n' "$row" | awk -F'\t' '{print $2}')"
    kind="$(printf '%s\n' "$row" | awk -F'\t' '{print $3}')"
    if [ "$bytes" -le $FRAME_LIMIT ] && [ "$kind" = static ]; then
      check ok "$opt: $entry frame $bytes B <= $FRAME_LIMIT B ($kind)"
    else
      check fail "$opt: $entry frame $bytes B <= $FRAME_LIMIT B ($kind)"
    fi
  done
  # Callees the inliner kept out of line (e.g. Probe::begin at -Os) have
  # their own rows; none of them may exceed the limit either.
  worst="$(awk -F'\t' '{ if ($2 + 0 > max) { max = $2 + 0; fn = $1 } } END { printf "%d %s", max, fn }' "$su" 2>/dev/null || echo "0 ?")"
  worst_bytes="${worst%% *}"
  rows="$(wc -l < "$su" 2>/dev/null | tr -d ' ' || echo 0)"
  if [ "$rows" -gt 0 ] && [ "$worst_bytes" -le $FRAME_LIMIT ] && ! awk -F'\t' '$3 != "static"' "$su" | grep -q .; then
    check ok "$opt: all $rows functions in the unit (inlined or not) <= $FRAME_LIMIT B, all static -- worst $worst_bytes B"
  else
    check fail "$opt: all $rows functions in the unit (inlined or not) <= $FRAME_LIMIT B, all static -- worst: ${worst#* } $worst_bytes B"
  fi
done

echo
echo "diag probe stack frames: $((checks - failures))/$checks checks passed"
[ "$failures" -eq 0 ]
