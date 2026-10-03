#!/bin/sh
# Read-only audit of production c531ba1 (2026-10-03): GET /0.js once,
# GET /settings/read-freshness at start and end, one SSE connection.
# No POST, no Settings lease, no Modbus write.
cd /private/tmp/jk-bms-runtime-audit-c531ba1
date -u +%Y-%m-%dT%H:%M:%SZ > t_start.txt
curl -sS -m 20 -D 0js.headers -o 0js.raw "http://192.168.27.43/0.js"
curl -sS -m 10 -o freshness_start.json "http://192.168.27.43/settings/read-freshness"
curl -sS -N -m 280 "http://192.168.27.43/events" 2> sse.curl.err | python3 ts.py > sse_timed.log
curl -sS -m 10 -o freshness_end.json "http://192.168.27.43/settings/read-freshness"
date -u +%Y-%m-%dT%H:%M:%SZ > t_end.txt
