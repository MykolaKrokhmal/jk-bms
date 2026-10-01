import json, re, sys, statistics
from collections import defaultdict

path = sys.argv[1]
ev = None
states = []   # (ts, id, state)
logs = []     # (ts, text)
pings = []    # (ts, uptime)
for line in open(path, encoding="utf-8", errors="replace"):
    m = re.match(r"^(\d+\.\d+) (.*)$", line.rstrip("\n"))
    if not m:
        continue
    ts, body = float(m.group(1)), m.group(2)
    if body.startswith("event: "):
        ev = body[7:].strip()
        continue
    if not body.startswith("data: "):
        continue
    data = body[6:]
    if ev == "log":
        logs.append((ts, re.sub(r"\x1b\[[0-9;]*m", "", data)))
    elif ev == "ping":
        try:
            d = json.loads(data)
            if "uptime" in d:
                pings.append((ts, d["uptime"]))
        except Exception:
            pass
    elif ev == "state":
        try:
            d = json.loads(data)
            states.append((ts, d.get("id"), d.get("state")))
        except Exception:
            pass

t0 = states[0][0] if states else 0
t_end = max([s[0] for s in states] + [p[0] for p in pings] + [l[0] for l in logs])
print(f"window: {t_end - t0:.1f} s, state events {len(states)}, logs {len(logs)}, pings {len(pings)}")

# read_plan_success per cluster
rps = [(ts, st) for ts, i, st in states if i == "text_sensor/read plan success"]
per = defaultdict(list)
non_cluster = 0
for ts, st in rps:
    parts = st.split(":")
    if len(parts) != 3:
        continue
    key, rev, seq = parts[0], int(parts[1]), int(parts[2])
    if re.match(r"^[ACS]\d$", key):
        per[key].append((ts, rev, seq))
    else:
        non_cluster += 1
print(f"read_plan_success events: {len(rps)}; non-cluster (fallback block) events: {non_cluster}")
print("cluster | events | rev first..last (delta) | rev gaps (coalesced) | mean interval s | max interval s | max rev step")
for k in sorted(per):
    v = per[k]
    revs = [r for _, r, _ in v]
    iv = [b[0] - a[0] for a, b in zip(v, v[1:])]
    steps = [b - a for a, b in zip(revs, revs[1:])]
    gaps = sum(1 for s in steps if s > 1)
    back = sum(1 for s in steps if s <= 0)
    print(f"{k} | {len(v)} | {revs[0]}..{revs[-1]} ({revs[-1]-revs[0]}) | {gaps} (non-increasing: {back}) | "
          f"{statistics.mean(iv) if iv else float('nan'):.3f} | {max(iv) if iv else float('nan'):.3f} | {max(steps) if steps else 0}")
seqs = [int(st.split(':')[2]) for _, st in rps if st.count(':') == 2]
print(f"global success seq: {seqs[0] if seqs else None}..{seqs[-1] if seqs else None}, non-monotonic steps: {sum(1 for a,b in zip(seqs,seqs[1:]) if b<=a)}")

def series(name):
    return [(ts, st) for ts, i, st in states if i == name]

for name in ["text_sensor/bms health", "text_sensor/read cluster mode", "text_sensor/reset reason",
             "sensor/reset count since power on", "text_sensor/write transaction snapshot",
             "text_sensor/last write crash stage", "sensor/cell count transaction status code",
             "sensor/setup passcode transaction status code", "sensor/cell count transaction id",
             "text_sensor/topology state"]:
    s = series(name)
    vals = []
    for _, st in s:
        if not vals or vals[-1] != st:
            vals.append(st)
    print(f"{name}: {len(s)} events, distinct sequence: {vals[:10]}")

up = series("sensor/system uptime")
upv = []
for ts, st in up:
    try:
        upv.append((ts, float(st.split()[0])))
    except Exception:
        pass
disc = [(a, b) for a, b in zip(upv, upv[1:]) if b[1] < a[1]]
print(f"system uptime: {upv[0][1] if upv else None} -> {upv[-1][1] if upv else None} s, decreases: {len(disc)}")
pdisc = [(a, b) for a, b in zip(pings, pings[1:]) if b[1] < a[1]]
print(f"ping uptime: {pings[0][1] if pings else None} -> {pings[-1][1] if pings else None}, decreases: {len(pdisc)}")

print("logs:")
for ts, txt in logs:
    print(f"  +{ts - t0:7.1f}s {txt[:220]}")
kw = re.compile(r"write|tx_id|FC06|FC16|FC10|passcode|fallback|timeout|length|mismatch|queue|stale", re.I)
print("flagged logs:", sum(1 for _, t in logs if kw.search(t)))
