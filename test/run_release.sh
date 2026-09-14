#!/usr/bin/env bash
# Thin, backward-compatible entry point. All real orchestration now lives in
# test/release/{orchestrator,steps,cli}.js — a Node.js supervisor, not bash,
# because reliable whole-process-tree timeout kill needs real process-group
# control (child_process.spawn's `detached: true` + killing the negative
# pid), which bash job control (`set -m`) turned out NOT to provide safely
# in this project's sandboxed CI shell (see IMPLEMENTATION_EXECUTION_LOG.md,
# Stage 1 Corrective Pass, Work 5) and external `timeout`/`gtimeout` isn't
# installed on every machine that runs this (notably stock macOS).
exec node "$(dirname "$0")/release/cli.js" "$@"
