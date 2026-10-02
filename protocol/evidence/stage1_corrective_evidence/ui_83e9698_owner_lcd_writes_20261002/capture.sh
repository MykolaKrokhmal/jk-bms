#!/bin/sh
cd /private/tmp/jk-bms-ui-83e9698-check
date -u +%Y-%m-%dT%H:%M:%SZ > t_start.txt
curl -sS -m 10 -o freshness_initial.json "http://192.168.27.43/settings/read-freshness"
( curl -sS -N -m 480 "http://192.168.27.43/events" 2> sse.curl.err | python3 ts.py > sse_timed.log ) &
END=$(( $(date +%s) + 480 ))
while [ $(date +%s) -lt $END ]; do
  T=$(python3 -c 'import time;print("%.3f"%time.time())')
  B=$(curl -sS -m 4 "http://192.168.27.43/settings/read-freshness" 2>&1 | tr -d '\n')
  printf '%s %s\n' "$T" "$B" >> freshness_series.log
  sleep 5
done
wait
date -u +%Y-%m-%dT%H:%M:%SZ > t_end.txt
