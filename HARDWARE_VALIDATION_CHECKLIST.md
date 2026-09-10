# Hardware Validation Checklist — JK BMS

**Статус: ЧАСТКОВО ВИКОНАНО 2026-09-09 у режимі лише читання.** Реальний ESP32 + JK BMS був доступний, але жоден hardware write, reboot, disconnect, load/charge або fault-injection тест не виконувався. Детальний протокол: `HARDWARE_AUDIT_2026-09-09.md`; відкриті дефекти: `OPEN_ISSUES.md`. Не позначайте решту пунктів PASS за результатами mock/compile.

Software-side equivalents (mock simulator + real ESPHome cross-compile) are already verified — see `FINAL_READINESS_REPORT.md`. Nothing here should be inferred as passed from that.

## Prerequisites before starting

- [ ] Flash the exact firmware built by `esphome compile batterylifepo4.yaml` at config_hash `0xaf454b9d` (or a later one — record the new hash if you rebuild).
- [ ] Confirm `secrets.yaml` has real WiFi/API/OTA credentials (not the placeholder generated for this session's compile-only testing).
- [ ] Have a way to safely disconnect load/charge sources (physical switch or breaker) before testing any protection-threshold or CellCount change.
- [ ] Never modify protection thresholds, CellCount, or power MOSFETs on a battery under real load without a lab test plan and a way to physically disconnect.

## 1. Boot / connectivity

- [ ] Cold boot: device reaches `bms_health: LIVE` within 30s of power-on.
- [ ] WiFi reconnect: disable AP, wait 60s, re-enable — device recovers without a manual reset.
- [ ] BMS Modbus reconnect: physically disconnect RS485, wait past the 30s OFFLINE threshold, reconnect — `topology_state` recovers to CONFIRMED without a device reboot.

## 2. Topology (read-only, at whatever cell count the test pack actually has)

- [x] PASS — 2026-09-09 read-only: `topology_state=CONFIRMED`, reason `OK`, configured/connected/measured/effective/last-confirmed all `16`.
- [x] PASS — 2026-09-09 read-only: `effective_cell_count=16`, connected mask `0xFFFF`.
- [x] PASS — 2026-09-09 for the current static 16S snapshot only: 16 cards/bars/labels, no phantom channels; min/max/delta and `53.60 V` float target are consistent. Dynamic transition remains untested.

## 3. Controlled CellCount change (lab-safe configuration only — do not attempt beyond what the physical pack safely supports)

- [ ] Write a CellCount change to a value the lab rig genuinely supports (e.g. disconnect half the pack's sense leads under a safe test rig, or use a bench BMS test fixture).
- [ ] Observe: PENDING → (ACK within 3s) → (forced readback within 4s) → CONFIRMED, with `effective_cell_count` matching the NEW value.
- [ ] Record actual observed timings against the 3s ACK / 4s readback budgets.
- [ ] Revert to the original configuration and re-confirm CONFIRMED.

## 4. Write transaction manager — real RW registers

For at least 3 representative registers (one plain u32, one packed sub-field register, one control select):

- [ ] `cell_ovp` (or another plain numeric register): write a real value, confirm ACK + forced readback both land, `write_tx_snapshot` shows CONFIRMED with matching req/rb.
- [ ] `heating_activation_temperature` (packed, shares 0x111C with `heating_deactivation_temperature`): write one, confirm the other's value is preserved (masked comparison working on real hardware, not just simulated).
- [ ] `charging` select: toggle Off, confirm the ACTUAL BMS charge-enable behavior changes (not just the UI), confirm forced readback of 0x1070 matches, then toggle back On.
- [ ] Deliberately induce an ACK timeout or readback timeout if the test rig allows (e.g. transient RS485 interference) — confirm the UI shows the correct terminal state and reverts the input, never a false green checkmark.

## 5. Charge/discharge/balance real-world behavior

- [ ] Charging enabled + real charge source connected: `charging_active`/live status reflects it.
- [ ] Discharging enabled + real load connected: `discharging_active`/live status reflects it.
- [ ] Balancing: trigger real cell imbalance (or use a bench fixture) and confirm `balancing_active` (a REAL register-driven signal per the prior session's audit) reflects actual balancing current, not just the enable switch.
- [ ] Trigger a real protection condition (within a safe lab setup) and confirm the same explicit `control_override_reason`-style distinction the mock simulates: live status changes, the control register itself is untouched.

## 6. 60-hour history — NOT APPLICABLE until persistence is wired to production

This entire section is blocked on the still-open work item "wire the LittleFS PoC into production, complete a real flash/OTA/power-loss cycle on hardware first" (see `FINAL_READINESS_REPORT.md` §6.1). Do not attempt these until that work has landed:

- [ ] Reboot mid-write does not corrupt the buffer.
- [ ] Power loss mid-write recovers cleanly on next boot.
- [ ] 60h+ of continuous operation wraps the ring buffer correctly.
- [ ] A CellCount change mid-history does not mix incompatible-topology rows in one page of `/charge_history.json`.

## 7. Security (real network)

- [ ] Confirm `web_server` Basic Auth actually gates every write endpoint (`/select/*/set`, `/number/*/set`, `/text/*/set`) on real hardware, not just in the mock.
- [ ] Confirm the ESPHome native API (port 6053) requires the configured encryption key from a real client.
- [ ] Confirm OTA requires the configured OTA password.
- [ ] From a browser NOT logged in, attempt a write — confirm it is rejected, not silently accepted.

## Reporting results

When this checklist is actually executed, replace every `[ ]` above with `[x] PASS — <date>, <observed detail>` or `[x] FAIL — <what happened>`, and file the FAIL items as tracked defects before calling any part of this "Готово."
