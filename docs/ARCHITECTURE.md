# Architecture overview — diagrams

Visual companion to `docs/adr/0001-protocol-catalog.md` (the full decision
record). This file covers the two pieces of the system that are hardest to
follow from code alone: the system's overall data flow, and the generic
Write Transaction Manager's state machine (including the WRITE_UNCERTAIN
recovery path added in the ADR's eighth-pass addendum). It does not restate
the ADR's own reasoning — see that file for *why* each decision was made,
including the safety invariants and what remains unverified against real
hardware.

## 1. System data flow

```mermaid
flowchart LR
    BMS["JK BMS\n(RS485 / Modbus RTU)"]
    Browser["Browser UI\n(jk_bms.js)"]

    subgraph ESP["ESP32 (ESPHome + custom components)"]
        Modbus[modbus_controller]
        Topology["Topology resolver\n(CellCount, bespoke)"]
        WriteTx["Generic Write Transaction\nManager (jk_write_tx_core.h)\n— every other RW register"]
        Snapshot["write_tx_snapshot\n(JSON text_sensor)"]
        Modbus --> Topology
        Modbus --> WriteTx
        Topology --> Snapshot
        WriteTx --> Snapshot
    end

    BMS <-->|"Modbus RTU\naddr 0x1000-0x1504"| Modbus
    Snapshot -->|"SSE (/events)\nentity state pushes"| Browser
    Browser -->|"HTTP POST\n/number,/select,/text ...set"| Modbus
```

`register_catalog.json` and `protocol/registers.canonical.json` are the
single source of truth both the firmware (`batterylifepo4.yaml`) and the
browser UI (`jk_bms.js`) are generated/validated against — see
`tools/protocol/generate.js` and the ADR's "Decision" section for the full
pipeline.

## 2. Generic write transaction — state machine

Every RW register **except** CellCount (which keeps its own, older,
separately-tested bespoke driver — see the ADR's Context section) goes
through `jk_write_tx_core.h`'s state machine. States 0–5, 7–9 are emitted
by `tick()` itself; `WRITE_UNCERTAIN`(6) and the two `RECOVERED_*` states
(10, 11) are never emitted by `tick()` — they are applied by the *caller*
(`batterylifepo4.yaml`'s 250ms servicer) as a recovery layer on top of the
same numeric status-code space, mirroring how CellCount's own bespoke
driver already folds its timeouts into `WRITE_UNCERTAIN`.

```mermaid
stateDiagram-v2
    [*] --> SENDING: begin() — single-flight guard\nper register address
    SENDING --> ACK_WAIT: tick()
    ACK_WAIT --> READBACK_WAIT: Modbus ACK received
    ACK_WAIT --> ACK_TIMEOUT: no ACK within 3s

    READBACK_WAIT --> CONFIRMED: forced readback\nmatches requested (masked)
    READBACK_WAIT --> MISMATCH: forced readback\ndisagrees
    READBACK_WAIT --> READBACK_TIMEOUT: no readback within 4s

    ACK_TIMEOUT --> WRITE_UNCERTAIN: caller reclassifies\n(2026-09-10, eighth pass)
    READBACK_TIMEOUT --> WRITE_UNCERTAIN: caller reclassifies

    WRITE_UNCERTAIN --> WRITE_UNCERTAIN: recovery probe\n(fresh read every 2s)
    WRITE_UNCERTAIN --> RECOVERED_CONFIRMED: recovered value\nmatches request
    WRITE_UNCERTAIN --> RECOVERED_MISMATCH: recovered value\ndisagrees (or unchanged)

    CONFIRMED --> [*]: freed after 3s grace period
    MISMATCH --> [*]: freed after 3s grace period
    RECOVERED_CONFIRMED --> [*]: freed after 3s grace period
    RECOVERED_MISMATCH --> [*]: freed after 3s grace period

    note right of WRITE_UNCERTAIN
        Blocks a NEW write to the SAME
        address (jk_write_tx::is_pending)
        until recovery resolves it —
        never silently reused mid-recovery.
    end note
```

A second write to an address already in `SENDING`/`ACK_WAIT`/
`READBACK_WAIT`/`WRITE_UNCERTAIN` is rejected outright (`REJECTED`, status
9) rather than queued or allowed to race — see `begin()` in
`jk_write_tx_core.h`.

## 3. Why WRITE_UNCERTAIN exists: the two outcomes a timeout can hide

An ACK or forced-readback timeout is ambiguous by itself — the write may
have silently taken effect on the BMS even though its acknowledgement
never reached the ESP32. Reporting a plain "error" at that point would
either produce a false negative (user thinks the write failed, it didn't)
or, if treated as an optimistic success, a false positive. The recovery
probe removes the ambiguity by re-reading the register independently:

```mermaid
sequenceDiagram
    participant UI as Browser (jk_bms.js)
    participant ESP as ESP32 (250ms servicer)
    participant BMS as JK BMS

    UI->>ESP: POST /number/set_cell_uvpr/set?value=2.90
    ESP->>BMS: write_multiple_registers(0x1008, 2.90)
    Note over ESP,BMS: ACK never arrives (lost on the wire,<br/>BMS busy, etc.) — ACK_TIMEOUT after 3s
    ESP->>ESP: status -> WRITE_UNCERTAIN(6)<br/>publish write_tx_snapshot
    UI->>UI: TX_STATE.UNCERTAIN — control stays<br/>disabled, no green/red shown yet
    loop every 2s until resolved
        ESP->>BMS: read_holding_registers(0x1008)
        BMS-->>ESP: current raw value
    end
    alt recovered value == requested
        ESP->>ESP: status -> RECOVERED_CONFIRMED(10)
        ESP->>UI: SSE: write_tx_snapshot updated
        UI->>UI: shown as confirmed<br/>("after a recovery check")
    else recovered value != requested
        ESP->>ESP: status -> RECOVERED_MISMATCH(11)
        ESP->>UI: SSE: write_tx_snapshot updated
        UI->>UI: shown as not confirmed<br/>(write did not take effect)
    end
```

## 4. RW field access classification

`registers.canonical.json` is the only place this decision is made. Every
field the protocol declares `access: "rw"` lands in exactly one bucket —
see `RW_REGISTER_VERIFICATION_MATRIX.md` for the full, generated table.

```mermaid
flowchart TD
    Start["Field declared access: rw\n(46 of 127 logical fields)"] --> Q1{"write_safety_class ==\ndisruptive / topology /\ncredential / unsupported?"}
    Q1 -->|yes, unsupported| NI["NOT_IMPLEMENTED\n(7 fields — structural gap,\ne.g. unconfirmed enum semantics)"]
    Q1 -->|yes, one of the others| Q2{"owner_write_override\npresent and well-formed?"}
    Q1 -->|no — normal, resolvable| Q2
    Q2 -->|no| Blocked["BLOCKED_CONFLICT\n(21 fields — fail-closed;\nrequires explicit owner\nrisk acceptance to unlock)"]
    Q2 -->|yes| Verified["WRITE_VERIFIED\n(18 fields — owner-authorized,\nreal ACK+readback tested,\nNOT independently\nprotocol-verified)"]

    style NI fill:#f4d35e,color:#000
    style Blocked fill:#e07a5f,color:#fff
    style Verified fill:#81b29a,color:#000
```

`owner_write_override` is **risk acceptance, not protocol verification** —
see the ADR's fourth-pass addendum for exactly what that distinction means
and why it matters. No field currently carries `verification_status:
"confirmed"`.
