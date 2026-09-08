# JK BMS V2 — demo environment

Runs the **real, unmodified production frontend** (`../jk_bms.js`, `../jk_bms.css`,
read straight from the project root, never copied) against a fake but
protocol-faithful ESPHome backend, so the actual UI — including the Write
Transaction Manager, freshness tracking, and reconnect logic — can be opened
and exercised in a real browser without real hardware.

## Start

```bash
node demo/mock-server.js
```

Then open **http://localhost:8321/**. Override the port with `PORT=1234 node demo/mock-server.js`.

No build step, no dependencies beyond Node's standard library.

## What's real vs. mock

| | |
|---|---|
| **Production files reused, unmodified** | `jk_bms.js`, `jk_bms.css` (served straight from the project root) |
| **Mock-only files** | `demo/mock-server.js` (fake backend), `demo/index.html`, `demo/panel.js` (dev-only scenario switcher — never loaded by the real device) |

The mock backend speaks the *same wire protocol* the real ESP32 does:
`GET /events` is a genuine `text/event-stream` SSE stream (not a client-side
fake), `POST /select|number|text/:id/set` accept immediately and push the
"BMS confirmed this" state back later as a separate, delayed SSE event — so
the production Write Transaction Manager's SEND → PENDING_READBACK →
CONFIRMED/MISMATCH/TIMEOUT state machine is exercised for real, against a
real HTTP round trip, not simulated from inside the page.

## Dev panel

A small floating panel (bottom-right, collapsible) lets you switch:

**Scenario** — Normal, Charging, Discharging, Near Full, Low SOC, Cell
Imbalance (a couple of cells drift further from the pack average every
second), High Temp, Active Alarm, BMS Delayed, BMS Stale, BMS Offline,
Browser Disconnected (drops the SSE connection outright — the real
`EventSource` in `jk_bms.js` does the reconnecting, escalating from
"Reconnecting…" to "Disconnected" exactly like it would on a real dropped
link).

**Write outcome** — Confirm, Mismatch (echoes back the opposite of what was
requested), Timeout (never echoes back), HTTP Error (the POST itself
fails). Applies to every control/setting write; `setup_passcode` always
resolves as "Sent — unverified" regardless of this dial, since that field's
production code path has no readback by design (the entity is always
reported masked).

The panel is dev-only: it talks exclusively to `/demo/*` endpoints, which
don't exist in production and are never called by `jk_bms.js`.

### Deterministic links

`?scenario=cell_imbalance&writeMode=mismatch&theme=dark` applies all three
on load, so a specific state can be reopened and compared later. The panel's
own "Link to this state" field keeps this current.

## Known limitations of this demo

- Electrical/Cells/Temperature history graphs come from `/history.json`,
  synthesized fresh each request from the current live values — it mimics
  the real on-device ring buffer's shape but is not a logged history.
- No real Modbus/RS485 layer exists to simulate — `bms_health` /
  `bms_last_update_age` are driven directly by the scenario dial rather
  than derived from a simulated poll cycle, which is a reasonable
  simplification for UI validation purposes.
- Wi-Fi RSSI / IP / uptime are not simulated (the real device doesn't
  expose them either — see the Diagnostics tab's own "Not available" note).
