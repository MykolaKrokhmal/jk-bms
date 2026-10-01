import json, re, sys, statistics
A = sys.argv[1]
P2_START, P2_END = 1790860225.110, 1790860363.595   # lease POST start, Settings left
LAST_RENEW = 1790860360.009
ev = None; rps = []; logs = []; pings = []; up = []; health = []; mode = []; wtx = []
for line in open(f"{A}/sse_timed.log", encoding="utf-8", errors="replace"):
    m = re.match(r"^(\d+\.\d+) (.*)$", line.rstrip("\n"))
    if not m: continue
    ts, body = float(m.group(1)), m.group(2)
    if body.startswith("event: "): ev = body[7:].strip(); continue
    if not body.startswith("data: "): continue
    data = body[6:]
    if ev == "log": logs.append((ts, re.sub(r"\x1b\[[0-9;]*m", "", data)))
    elif ev == "ping":
        try: pings.append((ts, json.loads(data).get("uptime")))
        except Exception: pass
    elif ev == "state":
        try: d = json.loads(data)
        except Exception: continue
        i, st = d.get("id"), d.get("state")
        if i == "text_sensor/read plan success": rps.append((ts, st))
        elif i == "sensor/system uptime": up.append((ts, st))
        elif i == "text_sensor/bms health": health.append(st)
        elif i == "text_sensor/read cluster mode": mode.append(st)
        elif i in ("text_sensor/write transaction snapshot", "text_sensor/last write crash stage",
                   "sensor/cell count transaction status code", "sensor/setup passcode transaction status code"): wtx.append((i, st))
per = {}
nonc = 0
for ts, st in rps:
    p = st.split(":")
    if len(p) == 3 and re.match(r"^[ACS]\d$", p[0]): per.setdefault(p[0], []).append((ts, int(p[1]), int(p[2])))
    else: nonc += 1
def stats(k, a, b):
    v = [x for x in per.get(k, []) if a <= x[0] < b]
    iv = [y[0]-x[0] for x, y in zip(v, v[1:])]
    revs = [x[1] for x in v]
    steps = [y-x for x, y in zip(revs, revs[1:])]
    return len(v), (statistics.mean(iv) if iv else None), (min(iv) if iv else None), (max(iv) if iv else None), sum(1 for s in steps if s != 1)
t0 = min(t for t, _ in rps); tE = max(t for t, _ in rps)
EXP = LAST_RENEW + 30.05
phases = [("1 background", t0, P2_START), ("2 active (after first active read)", P2_START + 0.4, P2_END), ("3a lease still held (left, <TTL)", P2_END, EXP), ("3b expired", EXP + 1, tE + 1)]
print(f"capture {t0:.1f}..{tE:.1f}; non-cluster success events: {nonc}")
for name, a, b in phases:
    print(f"== phase {name}: {a:.1f}..{b:.1f} ({b-a:.0f} s)")
    for k in ["A1", "A2", "C1", "C2", "S1", "S2", "S3"]:
        n, mean, mn, mx, gaps = stats(k, a, b)
        print(f"   {k}: events={n} mean={mean and round(mean,3)} min={mn and round(mn,3)} max={mx and round(mx,3)} rev_steps!=1:{gaps}")
c1 = per.get("C1", [])
print("C1 events around activation:", [(round(t,3), r) for t, r, _ in c1 if P2_START-15 < t < P2_START+8])
print("C1 events around expiry:", [(round(t,3), r) for t, r, _ in c1 if EXP-8 < t < tE+1])
seqs = [int(st.split(":")[2]) for _, st in rps if st.count(":") == 2]
print("global seq", seqs[0], "->", seqs[-1], "non-monotonic", sum(1 for a, b in zip(seqs, seqs[1:]) if b <= a))
print("uptime", up[0][1] if up else None, "->", up[-1][1] if up else None, "ping", pings[0][1] if pings else None, "->", pings[-1][1] if pings else None,
      "decreases", sum(1 for a, b in zip(pings, pings[1:]) if b[1] < a[1]))
print("bms health values", sorted(set(health)), "count", len(health), "| cluster mode", sorted(set(mode)))
print("write-related values", sorted(set(wtx)))
print("logs:"); [print(f"   {t:.1f} {l[:180]}") for t, l in logs]
# freshness lease timeline
print("lease flag transitions (C1):")
prev = None
for line in open(f"{A}/freshness_series.log"):
    t, b = line.split(" ", 1)
    try: d = json.loads(b)
    except Exception: print("  ", t, "unparsable"); continue
    c = {x["id"]: x for x in d["clusters"]}
    s = (c["C1"]["lease"], c["C1"]["cadence_ms"], c["C1"]["mode"])
    if s != prev: print(f"   {float(t):.1f} C1 lease={s[0]} cadence={s[1]} mode={s[2]} rev={c['C1']['revision']}"); prev = s
    modes = {x["mode"] for x in d["clusters"]}
    if modes != {"cluster"}: print("   FALLBACK at", t, modes)
