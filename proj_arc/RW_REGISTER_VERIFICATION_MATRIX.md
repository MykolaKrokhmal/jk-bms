# RW Register Verification Matrix — 2026-09-10 (regenerated, third critical audit pass)

Machine-generated from `protocol/registers.canonical.json` (the single source of
truth) — regenerate with the script in `docs/adr/0001-protocol-catalog.md`'s
sixth-pass addendum, or `node tools/protocol/generate.js` for the derived
`register_catalog.json`/`jk_bms.js` artifacts this table's `WRITE_VERIFIED`
rows correspond to 1:1. Do not hand-edit this file — it will drift the moment
`registers.canonical.json` changes.

## Status legend

- **`WRITE_VERIFIED`** — `effective_access: "rw"`, carries a well-formed
  `owner_write_override`, has a real YAML `number:`/`select:` entity with a
  `set_action` that queues a genuine Modbus write, and is covered by
  `test/protocol_catalog/test_blocked_write_surface.js`. **This still means
  "owner accepted the evidence gap," not "independently protocol-verified"**
  — see `verification_status` and `risk` columns; none reach `confirmed`.
- **`READ_ONLY_UNVERIFIED`** — `access: "r"` in the protocol itself (not a
  policy decision — the register/field is not writable per the evidence
  available).
- **`BLOCKED_CONFLICT`** — `access: "rw"` but `effective_access: "r"`: the
  protocol declares this writable, but the write path is fail-closed pending
  verification (disruptive/topology/credential class, an unresolved
  `dynamic_dependency`, or a packed-register correlation/freshness hazard —
  see `risk` column and the ADR addendum for exactly why each one is here).
- **`NOT_IMPLEMENTED`** — `write_safety_class: "unsupported"`: a structural
  gap beyond mere evidence (unconfirmed enum semantics, or a value whose
  physical meaning depends on another unconfirmed field).

## Summary

| Status | Count |
|---|---:|
| `WRITE_VERIFIED` | 18 |
| `BLOCKED_CONFLICT` | 21 |
| `NOT_IMPLEMENTED` | 7 |
| `READ_ONLY_UNVERIFIED` | 81 |
| **Total logical fields** | **127** |

## Full matrix

| key | addr | width | words | FC | byte/word order | sign | scale | offset | min | max | step | enum | read entity | write endpoint | readback | evidence | risk | status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| smart_sleep | 0x1000 | 32 | 2 | write_multiple_registers_fc16 | big_endian/high_word_first | U | 0.001 | 0 | 0 | 6 | 0.001 | - | smart_sleep | /number/set_smart_sleep/set | smart_sleep | implementation_only_unverified | normal | WRITE_VERIFIED |
| cell_uvp | 0x1004 | 32 | 2 | write_multiple_registers_fc16 | big_endian/high_word_first | U | 0.001 | 0 | 0 | 6 | 0.001 | - | cell_uvp | - | - | implementation_only_unverified | disruptive | BLOCKED_CONFLICT |
| cell_uvpr | 0x1008 | 32 | 2 | write_multiple_registers_fc16 | big_endian/high_word_first | U | 0.001 | 0 | 0 | 6 | 0.001 | - | cell_uvpr | /number/set_cell_uvpr/set | cell_uvpr | implementation_only_unverified | normal | WRITE_VERIFIED |
| cell_ovp | 0x100C | 32 | 2 | write_multiple_registers_fc16 | big_endian/high_word_first | U | 0.001 | 0 | 0 | 6 | 0.001 | - | cell_ovp | - | - | implementation_only_unverified | disruptive | BLOCKED_CONFLICT |
| cell_ovpr | 0x1010 | 32 | 2 | write_multiple_registers_fc16 | big_endian/high_word_first | U | 0.001 | 0 | 0 | 6 | 0.001 | - | cell_ovpr | /number/set_cell_ovpr/set | cell_ovpr | implementation_only_unverified | normal | WRITE_VERIFIED |
| start_balance_trigger | 0x1014 | 32 | 2 | write_multiple_registers_fc16 | big_endian/high_word_first | U | 0.001 | 0 | 0 | 1 | 0.001 | - | start_balance_trigger | /number/set_start_balance_trigger/set | start_balance_trigger | implementation_only_unverified | normal | WRITE_VERIFIED |
| soc_100 | 0x1018 | 32 | 2 | write_multiple_registers_fc16 | big_endian/high_word_first | U | 0.001 | 0 | 0 | 6 | 0.001 | - | soc_100 | /number/set_soc_100/set | soc_100 | implementation_only_unverified | normal | WRITE_VERIFIED |
| soc_0 | 0x101C | 32 | 2 | write_multiple_registers_fc16 | big_endian/high_word_first | U | 0.001 | 0 | 0 | 6 | 0.001 | - | soc_0 | /number/set_soc_0/set | soc_0 | implementation_only_unverified | normal | WRITE_VERIFIED |
| cell_rcv | 0x1020 | 32 | 2 | write_multiple_registers_fc16 | big_endian/high_word_first | U | 0.001 | 0 | 0 | 6 | 0.001 | - | cell_rcv | /number/set_cell_rcv/set | cell_rcv | implementation_only_unverified | normal | WRITE_VERIFIED |
| cell_rfv | 0x1024 | 32 | 2 | write_multiple_registers_fc16 | big_endian/high_word_first | U | 0.001 | 0 | 0 | 6 | 0.001 | - | cell_rfv | /number/set_cell_rfv/set | cell_rfv | implementation_only_unverified | normal | WRITE_VERIFIED |
| system_power_off | 0x1028 | 32 | 2 | write_multiple_registers_fc16 | big_endian/high_word_first | U | 0.001 | 0 | 0 | 6 | 0.001 | - | system_power_off | - | - | implementation_only_unverified | disruptive | BLOCKED_CONFLICT |
| continued_charge_current | 0x102C | 32 | 2 | write_multiple_registers_fc16 | big_endian/high_word_first | U | 0.001 | 0 | 0 | 2000 | 0.001 | - | continued_charge_current | - | - | implementation_only_unverified | disruptive | BLOCKED_CONFLICT |
| charge_ocp_delay | 0x1030 | 32 | 2 | write_multiple_registers_fc16 | big_endian/high_word_first | U | 1 | 0 | 0 | 2147483647 | 1 | - | charge_ocp_delay | - | - | implementation_only_unverified | disruptive | BLOCKED_CONFLICT |
| charge_ocpr_time | 0x1034 | 32 | 2 | write_multiple_registers_fc16 | big_endian/high_word_first | U | 1 | 0 | 0 | 2147483647 | 1 | - | charge_ocpr_time | /number/set_charge_ocpr_time/set | charge_ocpr_time | implementation_only_unverified | normal | WRITE_VERIFIED |
| continued_discharge_current | 0x1038 | 32 | 2 | write_multiple_registers_fc16 | big_endian/high_word_first | U | 0.001 | 0 | 0 | 2000 | 0.001 | - | continued_discharge_current | - | - | implementation_only_unverified | disruptive | BLOCKED_CONFLICT |
| discharge_ocp_delay | 0x103C | 32 | 2 | write_multiple_registers_fc16 | big_endian/high_word_first | U | 1 | 0 | 0 | 2147483647 | 1 | - | discharge_ocp_delay | - | - | implementation_only_unverified | disruptive | BLOCKED_CONFLICT |
| discharge_ocpr_time | 0x1040 | 32 | 2 | write_multiple_registers_fc16 | big_endian/high_word_first | U | 1 | 0 | 0 | 2147483647 | 1 | - | discharge_ocpr_time | /number/set_discharge_ocpr_time/set | discharge_ocpr_time | implementation_only_unverified | normal | WRITE_VERIFIED |
| scpr_time | 0x1044 | 32 | 2 | write_multiple_registers_fc16 | big_endian/high_word_first | U | 1 | 0 | 0 | 2147483647 | 1 | - | scpr_time | /number/set_scpr_time/set | scpr_time | implementation_only_unverified | normal | WRITE_VERIFIED |
| max_balance_current | 0x1048 | 32 | 2 | write_multiple_registers_fc16 | big_endian/high_word_first | U | 0.001 | 0 | 0 | 20 | 0.001 | - | max_balance_current | /number/set_max_balance_current/set | max_balance_current | implementation_only_unverified | normal | WRITE_VERIFIED |
| charge_otp | 0x104C | 32 | 2 | write_multiple_registers_fc16 | big_endian/high_word_first | U | 0.1 | 0 | -100 | 200 | 0.1 | - | charge_otp | - | - | implementation_only_unverified | disruptive | BLOCKED_CONFLICT |
| charge_otpr | 0x1050 | 32 | 2 | write_multiple_registers_fc16 | big_endian/high_word_first | U | 0.1 | 0 | -100 | 200 | 0.1 | - | charge_otpr | /number/set_charge_otpr/set | charge_otpr | implementation_only_unverified | normal | WRITE_VERIFIED |
| discharge_otp | 0x1054 | 32 | 2 | write_multiple_registers_fc16 | big_endian/high_word_first | U | 0.1 | 0 | -100 | 200 | 0.1 | - | discharge_otp | - | - | implementation_only_unverified | disruptive | BLOCKED_CONFLICT |
| discharge_otpr | 0x1058 | 32 | 2 | write_multiple_registers_fc16 | big_endian/high_word_first | U | 0.1 | 0 | -100 | 200 | 0.1 | - | discharge_otpr | /number/set_discharge_otpr/set | discharge_otpr | implementation_only_unverified | normal | WRITE_VERIFIED |
| charge_utp | 0x105C | 32 | 2 | write_multiple_registers_fc16 | big_endian/high_word_first | U | 0.1 | 0 | -100 | 200 | 0.1 | - | charge_utp | - | - | implementation_only_unverified | disruptive | BLOCKED_CONFLICT |
| charge_utpr | 0x1060 | 32 | 2 | write_multiple_registers_fc16 | big_endian/high_word_first | U | 0.1 | 0 | -100 | 200 | 0.1 | - | charge_utpr | /number/set_charge_utpr/set | charge_utpr | implementation_only_unverified | normal | WRITE_VERIFIED |
| mos_otp | 0x1064 | 32 | 2 | write_multiple_registers_fc16 | big_endian/high_word_first | U | 0.1 | 0 | -100 | 200 | 0.1 | - | mos_otp | - | - | implementation_only_unverified | disruptive | BLOCKED_CONFLICT |
| mos_otpr | 0x1068 | 32 | 2 | write_multiple_registers_fc16 | big_endian/high_word_first | U | 0.1 | 0 | -100 | 200 | 0.1 | - | mos_otpr | /number/set_mos_otpr/set | mos_otpr | implementation_only_unverified | normal | WRITE_VERIFIED |
| cell_count | 0x106C | 32 | 2 | write_multiple_registers_fc16 | big_endian/high_word_first | U | 1 | 0 | 1 | 16 | 1 | - | cell_count | - | - | corroborated_with_limitations | topology | BLOCKED_CONFLICT |
| charging | 0x1070 | 32 | 2 | write_multiple_registers_fc16 | big_endian/high_word_first | U | 1 | 0 | 0 | 1 | 1 | yes | charging_allowed | - | - | implementation_only_unverified | disruptive | BLOCKED_CONFLICT |
| discharging | 0x1074 | 32 | 2 | write_multiple_registers_fc16 | big_endian/high_word_first | U | 1 | 0 | 0 | 1 | 1 | yes | discharging_allowed | - | - | implementation_only_unverified | disruptive | BLOCKED_CONFLICT |
| balancing | 0x1078 | 32 | 2 | write_multiple_registers_fc16 | big_endian/high_word_first | U | 1 | 0 | 0 | 1 | 1 | yes | balancing_allowed | - | - | implementation_only_unverified | disruptive | BLOCKED_CONFLICT |
| battery_capacity | 0x107C | 32 | 2 | write_multiple_registers_fc16 | big_endian/high_word_first | U | 0.001 | 0 | 1 | 2000 | 0.001 | - | battery_capacity | /number/set_battery_capacity/set | battery_capacity | implementation_only_unverified | normal | WRITE_VERIFIED |
| scp_delay | 0x1080 | 32 | 2 | write_multiple_registers_fc16 | big_endian/high_word_first | U | 1 | 0 | 0 | 2147483647 | 1 | - | scp_delay | - | - | implementation_only_unverified | disruptive | BLOCKED_CONFLICT |
| start_balance | 0x1084 | 32 | 2 | write_multiple_registers_fc16 | big_endian/high_word_first | U | 0.001 | 0 | 0 | 6 | 0.001 | - | start_balance | /number/set_start_balance/set | start_balance | implementation_only_unverified | normal | WRITE_VERIFIED |
| charging_float_mode | 0x1114 | 16 | 1 | - | big_endian/single_word | U | 1 | 0 | 0 | 1 | 1 | - | charging_float_mode | - | - | implementation_only_unverified | n/a | READ_ONLY_UNVERIFIED |
| heating_activation_temperature | 0x111C | 16 | 1 | write_multiple_registers_fc16 | big_endian/single_word | S | 1 | 0 | -40 | 100 | 1 | - | heating_activation_temperature | - | - | implementation_only_unverified | disruptive | BLOCKED_CONFLICT |
| heating_deactivation_temperature | 0x111C | 16 | 1 | write_multiple_registers_fc16 | big_endian/single_word | S | 1 | 0 | -40 | 100 | 1 | - | heating_deactivation_temperature | - | - | implementation_only_unverified | disruptive | BLOCKED_CONFLICT |
| cell_voltage_1 | 0x1200 | 16 | 1 | - | big_endian/single_word | U | 0.001 | 0 | 0 | 6 | 0.001 | - | cell_voltage_1 | - | - | corroborated_with_limitations | n/a | READ_ONLY_UNVERIFIED |
| cell_voltage_2 | 0x1202 | 16 | 1 | - | big_endian/single_word | U | 0.001 | 0 | 0 | 6 | 0.001 | - | cell_voltage_2 | - | - | corroborated_with_limitations | n/a | READ_ONLY_UNVERIFIED |
| cell_voltage_3 | 0x1204 | 16 | 1 | - | big_endian/single_word | U | 0.001 | 0 | 0 | 6 | 0.001 | - | cell_voltage_3 | - | - | corroborated_with_limitations | n/a | READ_ONLY_UNVERIFIED |
| cell_voltage_4 | 0x1206 | 16 | 1 | - | big_endian/single_word | U | 0.001 | 0 | 0 | 6 | 0.001 | - | cell_voltage_4 | - | - | corroborated_with_limitations | n/a | READ_ONLY_UNVERIFIED |
| cell_voltage_5 | 0x1208 | 16 | 1 | - | big_endian/single_word | U | 0.001 | 0 | 0 | 6 | 0.001 | - | cell_voltage_5 | - | - | corroborated_with_limitations | n/a | READ_ONLY_UNVERIFIED |
| cell_voltage_6 | 0x120A | 16 | 1 | - | big_endian/single_word | U | 0.001 | 0 | 0 | 6 | 0.001 | - | cell_voltage_6 | - | - | corroborated_with_limitations | n/a | READ_ONLY_UNVERIFIED |
| cell_voltage_7 | 0x120C | 16 | 1 | - | big_endian/single_word | U | 0.001 | 0 | 0 | 6 | 0.001 | - | cell_voltage_7 | - | - | corroborated_with_limitations | n/a | READ_ONLY_UNVERIFIED |
| cell_voltage_8 | 0x120E | 16 | 1 | - | big_endian/single_word | U | 0.001 | 0 | 0 | 6 | 0.001 | - | cell_voltage_8 | - | - | corroborated_with_limitations | n/a | READ_ONLY_UNVERIFIED |
| cell_voltage_9 | 0x1210 | 16 | 1 | - | big_endian/single_word | U | 0.001 | 0 | 0 | 6 | 0.001 | - | cell_voltage_9 | - | - | corroborated_with_limitations | n/a | READ_ONLY_UNVERIFIED |
| cell_voltage_10 | 0x1212 | 16 | 1 | - | big_endian/single_word | U | 0.001 | 0 | 0 | 6 | 0.001 | - | cell_voltage_10 | - | - | corroborated_with_limitations | n/a | READ_ONLY_UNVERIFIED |
| cell_voltage_11 | 0x1214 | 16 | 1 | - | big_endian/single_word | U | 0.001 | 0 | 0 | 6 | 0.001 | - | cell_voltage_11 | - | - | corroborated_with_limitations | n/a | READ_ONLY_UNVERIFIED |
| cell_voltage_12 | 0x1216 | 16 | 1 | - | big_endian/single_word | U | 0.001 | 0 | 0 | 6 | 0.001 | - | cell_voltage_12 | - | - | corroborated_with_limitations | n/a | READ_ONLY_UNVERIFIED |
| cell_voltage_13 | 0x1218 | 16 | 1 | - | big_endian/single_word | U | 0.001 | 0 | 0 | 6 | 0.001 | - | cell_voltage_13 | - | - | corroborated_with_limitations | n/a | READ_ONLY_UNVERIFIED |
| cell_voltage_14 | 0x121A | 16 | 1 | - | big_endian/single_word | U | 0.001 | 0 | 0 | 6 | 0.001 | - | cell_voltage_14 | - | - | corroborated_with_limitations | n/a | READ_ONLY_UNVERIFIED |
| cell_voltage_15 | 0x121C | 16 | 1 | - | big_endian/single_word | U | 0.001 | 0 | 0 | 6 | 0.001 | - | cell_voltage_15 | - | - | corroborated_with_limitations | n/a | READ_ONLY_UNVERIFIED |
| cell_voltage_16 | 0x121E | 16 | 1 | - | big_endian/single_word | U | 0.001 | 0 | 0 | 6 | 0.001 | - | cell_voltage_16 | - | - | corroborated_with_limitations | n/a | READ_ONLY_UNVERIFIED |
| cell_connected_mask | 0x1240 | 32 | 2 | - | big_endian/high_word_first | U | 1 | 0 | 0 | 65535 | 1 | - | cell_connected_mask | - | - | corroborated_with_limitations | n/a | READ_ONLY_UNVERIFIED |
| average_cell_voltage | 0x1244 | 16 | 1 | - | big_endian/single_word | U | 0.001 | 0 | 0 | 6 | 0.001 | - | - | - | - | corroborated_with_limitations | n/a | READ_ONLY_UNVERIFIED |
| delta_cell_voltage | 0x1246 | 16 | 1 | - | big_endian/single_word | U | 0.001 | 0 | 0 | 6 | 0.001 | - | - | - | - | corroborated_with_limitations | n/a | READ_ONLY_UNVERIFIED |
| max_voltage_cell_index_native | 0x1248 | 16 | 1 | - | big_endian/single_word | U | 1 | 0 | 1 | 16 | 1 | - | - | - | - | single_source | n/a | READ_ONLY_UNVERIFIED |
| min_voltage_cell_index_native | 0x1248 | 16 | 1 | - | big_endian/single_word | U | 1 | 0 | 1 | 16 | 1 | - | - | - | - | single_source | n/a | READ_ONLY_UNVERIFIED |
| cell_resistance_1 | 0x124A | 16 | 1 | - | big_endian/single_word | U | 0.001 | 0 | 0 | 65.535 | 0.001 | - | cell_resistance_1 | - | - | implementation_only_unverified | n/a | READ_ONLY_UNVERIFIED |
| cell_resistance_2 | 0x124C | 16 | 1 | - | big_endian/single_word | U | 0.001 | 0 | 0 | 65.535 | 0.001 | - | cell_resistance_2 | - | - | implementation_only_unverified | n/a | READ_ONLY_UNVERIFIED |
| cell_resistance_3 | 0x124E | 16 | 1 | - | big_endian/single_word | U | 0.001 | 0 | 0 | 65.535 | 0.001 | - | cell_resistance_3 | - | - | implementation_only_unverified | n/a | READ_ONLY_UNVERIFIED |
| cell_resistance_4 | 0x1250 | 16 | 1 | - | big_endian/single_word | U | 0.001 | 0 | 0 | 65.535 | 0.001 | - | cell_resistance_4 | - | - | implementation_only_unverified | n/a | READ_ONLY_UNVERIFIED |
| cell_resistance_5 | 0x1252 | 16 | 1 | - | big_endian/single_word | U | 0.001 | 0 | 0 | 65.535 | 0.001 | - | cell_resistance_5 | - | - | implementation_only_unverified | n/a | READ_ONLY_UNVERIFIED |
| cell_resistance_6 | 0x1254 | 16 | 1 | - | big_endian/single_word | U | 0.001 | 0 | 0 | 65.535 | 0.001 | - | cell_resistance_6 | - | - | implementation_only_unverified | n/a | READ_ONLY_UNVERIFIED |
| cell_resistance_7 | 0x1256 | 16 | 1 | - | big_endian/single_word | U | 0.001 | 0 | 0 | 65.535 | 0.001 | - | cell_resistance_7 | - | - | implementation_only_unverified | n/a | READ_ONLY_UNVERIFIED |
| cell_resistance_8 | 0x1258 | 16 | 1 | - | big_endian/single_word | U | 0.001 | 0 | 0 | 65.535 | 0.001 | - | cell_resistance_8 | - | - | implementation_only_unverified | n/a | READ_ONLY_UNVERIFIED |
| cell_resistance_9 | 0x125A | 16 | 1 | - | big_endian/single_word | U | 0.001 | 0 | 0 | 65.535 | 0.001 | - | cell_resistance_9 | - | - | implementation_only_unverified | n/a | READ_ONLY_UNVERIFIED |
| cell_resistance_10 | 0x125C | 16 | 1 | - | big_endian/single_word | U | 0.001 | 0 | 0 | 65.535 | 0.001 | - | cell_resistance_10 | - | - | implementation_only_unverified | n/a | READ_ONLY_UNVERIFIED |
| cell_resistance_11 | 0x125E | 16 | 1 | - | big_endian/single_word | U | 0.001 | 0 | 0 | 65.535 | 0.001 | - | cell_resistance_11 | - | - | implementation_only_unverified | n/a | READ_ONLY_UNVERIFIED |
| cell_resistance_12 | 0x1260 | 16 | 1 | - | big_endian/single_word | U | 0.001 | 0 | 0 | 65.535 | 0.001 | - | cell_resistance_12 | - | - | implementation_only_unverified | n/a | READ_ONLY_UNVERIFIED |
| cell_resistance_13 | 0x1262 | 16 | 1 | - | big_endian/single_word | U | 0.001 | 0 | 0 | 65.535 | 0.001 | - | cell_resistance_13 | - | - | implementation_only_unverified | n/a | READ_ONLY_UNVERIFIED |
| cell_resistance_14 | 0x1264 | 16 | 1 | - | big_endian/single_word | U | 0.001 | 0 | 0 | 65.535 | 0.001 | - | cell_resistance_14 | - | - | implementation_only_unverified | n/a | READ_ONLY_UNVERIFIED |
| cell_resistance_15 | 0x1266 | 16 | 1 | - | big_endian/single_word | U | 0.001 | 0 | 0 | 65.535 | 0.001 | - | cell_resistance_15 | - | - | implementation_only_unverified | n/a | READ_ONLY_UNVERIFIED |
| cell_resistance_16 | 0x1268 | 16 | 1 | - | big_endian/single_word | U | 0.001 | 0 | 0 | 65.535 | 0.001 | - | cell_resistance_16 | - | - | implementation_only_unverified | n/a | READ_ONLY_UNVERIFIED |
| mosfet_temperature | 0x128A | 16 | 1 | - | big_endian/single_word | S | 0.1 | 0 | -100 | 200 | 0.1 | - | mosfet_temperature | - | - | implementation_only_unverified | n/a | READ_ONLY_UNVERIFIED |
| cell_wire_resistance_status_mask | 0x128C | 32 | 2 | - | big_endian/high_word_first | U | 1 | 0 | 0 | 4294967295 | 1 | - | - | - | - | single_source | n/a | READ_ONLY_UNVERIFIED |
| total_voltage_raw | 0x1290 | 32 | 2 | - | big_endian/high_word_first | U | 0.001 | 0 | 0 | 200 | 0.001 | - | total_voltage_raw | - | - | corroborated_with_limitations | n/a | READ_ONLY_UNVERIFIED |
| native_bms_power | 0x1294 | 32 | 2 | - | big_endian/high_word_first | U | 0.001 | 0 | 0 | 100000 | 0.001 | - | native_bms_power | - | - | implementation_only_unverified | n/a | READ_ONLY_UNVERIFIED |
| current_raw | 0x1298 | 32 | 2 | - | big_endian/high_word_first | S | 0.001 | 0 | -3000 | 3000 | 0.001 | - | current_raw | - | - | corroborated_with_limitations | n/a | READ_ONLY_UNVERIFIED |
| temperature_1 | 0x129C | 16 | 1 | - | big_endian/single_word | S | 0.1 | 0 | -100 | 200 | 0.1 | - | temperature_sensor_1 | - | - | implementation_only_unverified | n/a | READ_ONLY_UNVERIFIED |
| temperature_2 | 0x129E | 16 | 1 | - | big_endian/single_word | S | 0.1 | 0 | -100 | 200 | 0.1 | - | temperature_sensor_2 | - | - | implementation_only_unverified | n/a | READ_ONLY_UNVERIFIED |
| alarms_bitmask | 0x12A0 | 32 | 2 | - | big_endian/high_word_first | U | 1 | 0 | 0 | 4294967295 | 1 | - | alarms_bitmask | - | - | implementation_only_unverified | n/a | READ_ONLY_UNVERIFIED |
| balance_current | 0x12A4 | 16 | 1 | - | big_endian/single_word | S | 0.001 | 0 | -20 | 20 | 0.001 | - | balance_current | - | - | corroborated_with_limitations | n/a | READ_ONLY_UNVERIFIED |
| balancing_active | 0x12A6 | 16 | 1 | - | big_endian/single_word | U | 1 | 0 | 0 | 2 | 1 | yes | balancing_active | - | - | corroborated_with_limitations | n/a | READ_ONLY_UNVERIFIED |
| state_of_charge | 0x12A6 | 16 | 1 | - | big_endian/single_word | U | 1 | 0 | 0 | 100 | 1 | - | state_of_charge | - | - | corroborated_with_limitations | n/a | READ_ONLY_UNVERIFIED |
| capacity_remaining | 0x12A8 | 32 | 2 | - | big_endian/high_word_first | U | 0.001 | 0 | 0 | 2000 | 0.001 | - | capacity_remaining | - | - | corroborated_with_limitations | n/a | READ_ONLY_UNVERIFIED |
| full_charge_capacity | 0x12AC | 32 | 2 | - | big_endian/high_word_first | U | 0.001 | 0 | 0 | 2000 | 0.001 | - | full_charge_capacity | - | - | implementation_only_unverified | n/a | READ_ONLY_UNVERIFIED |
| charging_cycles | 0x12B0 | 32 | 2 | - | big_endian/high_word_first | U | 1 | 0 | 0 | 4294967295 | 1 | - | charging_cycles | - | - | implementation_only_unverified | n/a | READ_ONLY_UNVERIFIED |
| cycle_capacity | 0x12B4 | 32 | 2 | - | big_endian/high_word_first | U | 0.001 | 0 | 0 | 2000000 | 0.001 | - | total_charging_cycle_capacity | - | - | implementation_only_unverified | n/a | READ_ONLY_UNVERIFIED |
| precharge_status | 0x12B8 | 16 | 1 | - | big_endian/single_word | U | 1 | 0 | 0 | 1 | 1 | - | precharge_status | - | - | implementation_only_unverified | n/a | READ_ONLY_UNVERIFIED |
| state_of_health | 0x12B8 | 16 | 1 | - | big_endian/single_word | U | 1 | 0 | 0 | 100 | 1 | - | state_of_health | - | - | corroborated_with_limitations | n/a | READ_ONLY_UNVERIFIED |
| custom_alarm_1 | 0x12BA | 16 | 1 | - | big_endian/single_word | U | 1 | 0 | 0 | 65535 | 1 | - | custom_alarm_1 | - | - | implementation_only_unverified | n/a | READ_ONLY_UNVERIFIED |
| total_runtime | 0x12BC | 32 | 2 | - | big_endian/high_word_first | U | 1 | 0 | 0 | 4294967295 | 1 | - | total_runtime | - | - | implementation_only_unverified | n/a | READ_ONLY_UNVERIFIED |
| charging_active | 0x12C0 | 16 | 1 | - | big_endian/single_word | U | 1 | 0 | 0 | 1 | 1 | - | charging | - | - | implementation_only_unverified | n/a | READ_ONLY_UNVERIFIED |
| discharging_active | 0x12C0 | 16 | 1 | - | big_endian/single_word | U | 1 | 0 | 0 | 1 | 1 | - | discharging | - | - | implementation_only_unverified | n/a | READ_ONLY_UNVERIFIED |
| custom_alarm_2 | 0x12C2 | 16 | 1 | - | big_endian/single_word | U | 1 | 0 | 0 | 65535 | 1 | - | custom_alarm_2 | - | - | implementation_only_unverified | n/a | READ_ONLY_UNVERIFIED |
| discharge_ocpr_left | 0x12C4 | 16 | 1 | - | big_endian/single_word | U | 1 | 0 | 0 | 65535 | 1 | - | discharge_ocpr_left | - | - | implementation_only_unverified | n/a | READ_ONLY_UNVERIFIED |
| discharge_scpr_left | 0x12C6 | 16 | 1 | - | big_endian/single_word | U | 1 | 0 | 0 | 65535 | 1 | - | discharge_scpr_left | - | - | implementation_only_unverified | n/a | READ_ONLY_UNVERIFIED |
| charge_ocpr_left | 0x12C8 | 16 | 1 | - | big_endian/single_word | U | 1 | 0 | 0 | 65535 | 1 | - | charge_ocpr_left | - | - | implementation_only_unverified | n/a | READ_ONLY_UNVERIFIED |
| charge_scpr_left | 0x12CA | 16 | 1 | - | big_endian/single_word | U | 1 | 0 | 0 | 65535 | 1 | - | charge_scpr_left | - | - | implementation_only_unverified | n/a | READ_ONLY_UNVERIFIED |
| uvpr_left | 0x12CC | 16 | 1 | - | big_endian/single_word | U | 1 | 0 | 0 | 65535 | 1 | - | uvpr_left | - | - | implementation_only_unverified | n/a | READ_ONLY_UNVERIFIED |
| ovpr_left | 0x12CE | 16 | 1 | - | big_endian/single_word | U | 1 | 0 | 0 | 65535 | 1 | - | ovpr_left | - | - | implementation_only_unverified | n/a | READ_ONLY_UNVERIFIED |
| sensor_heating_mask | 0x12D0 | 16 | 1 | - | big_endian/single_word | U | 1 | 0 | 0 | 65535 | 1 | - | sensor_heating_mask | - | - | implementation_only_unverified | n/a | READ_ONLY_UNVERIFIED |
| reserved_0x12d2 | 0x12D2 | 16 | 1 | - | big_endian/single_word | U | 1 | 0 |  |  |  | - | - | - | - | single_source | n/a | READ_ONLY_UNVERIFIED |
| emergency_timer | 0x12D4 | 16 | 1 | - | big_endian/single_word | U | 1 | 0 | 0 | 65535 | 1 | - | emergency_timer | - | - | implementation_only_unverified | n/a | READ_ONLY_UNVERIFIED |
| battery_current_correction | 0x12D6 | 16 | 1 | - | big_endian/single_word | U | 1 | 0 | 0 | 65535 | 1 | - | battery_current_correction | - | - | implementation_only_unverified | n/a | READ_ONLY_UNVERIFIED |
| charge_current_measurement_voltage | 0x12D8 | 16 | 1 | - | big_endian/single_word | U | 1 | 0 | 0 | 65535 | 1 | - | charge_current_measurement_voltage | - | - | implementation_only_unverified | n/a | READ_ONLY_UNVERIFIED |
| discharge_current_measurement_voltage | 0x12DA | 16 | 1 | - | big_endian/single_word | U | 1 | 0 | 0 | 65535 | 1 | - | discharge_current_measurement_voltage | - | - | implementation_only_unverified | n/a | READ_ONLY_UNVERIFIED |
| battery_voltage_correction | 0x12DC | 32 | 2 | - | big_endian/high_word_first | U | 1 | 0 |  |  | 1 | - | battery_voltage_correction | - | - | implementation_only_unverified | n/a | READ_ONLY_UNVERIFIED |
| alternate_battery_voltage | 0x12E4 | 16 | 1 | - | big_endian/single_word | U | 0.01 | 0 | 0 | 655.35 | 0.01 | - | alternate_battery_voltage | - | - | implementation_only_unverified | n/a | READ_ONLY_UNVERIFIED |
| heating_current | 0x12E6 | 16 | 1 | - | big_endian/single_word | S | 0.001 | 0 | -20 | 20 | 0.001 | - | heating_current | - | - | implementation_only_unverified | n/a | READ_ONLY_UNVERIFIED |
| bms_system_ticks | 0x12F0 | 32 | 2 | - | big_endian/high_word_first | U | 0.1 | 0 | 0 | 429496729.5 | 0.1 | - | bms_system_ticks | - | - | implementation_only_unverified | n/a | READ_ONLY_UNVERIFIED |
| temperature_sensor_3 | 0x12F8 | 16 | 1 | - | big_endian/single_word | S | 0.1 | 0 | -100 | 200 | 0.1 | - | temperature_sensor_3 | - | - | implementation_only_unverified | n/a | READ_ONLY_UNVERIFIED |
| temperature_4 | 0x12FA | 16 | 1 | - | big_endian/single_word | S | 0.1 | 0 | -100 | 200 | 0.1 | - | temperature_sensor_4 | - | - | implementation_only_unverified | n/a | READ_ONLY_UNVERIFIED |
| temperature_5 | 0x12FC | 16 | 1 | - | big_endian/single_word | S | 0.1 | 0 | -100 | 200 | 0.1 | - | jkbms_bat_temp4 | - | - | implementation_only_unverified | n/a | READ_ONLY_UNVERIFIED |
| device_model | 0x1400 | 128 | 8 | - | big_endian/sequential_bytes | U | 1 | 0 |  |  |  | - | manufacturer_device_id | - | - | implementation_only_unverified | n/a | READ_ONLY_UNVERIFIED |
| setup_passcode | 0x1470 | 128 | 8 | write_multiple_registers_fc16 | big_endian/sequential_bytes | U | 1 | 0 |  |  |  | - | setup_passcode | - | - | implementation_only_unverified | credential | BLOCKED_CONFLICT |
| dry_contact_1_trigger_source | 0x14E4 | 16 | 1 | write_multiple_registers_fc16 | big_endian/single_word | U | 1 | 0 | 0 | 12 | 1 | - | dry_contact_1_trigger_source | - | - | implementation_only_unverified | unsupported | NOT_IMPLEMENTED |
| lcd_buzzer_trigger | 0x14E4 | 16 | 1 | write_multiple_registers_fc16 | big_endian/single_word | U | 1 | 0 | 0 | 255 | 1 | - | lcd_buzzer_trigger | - | - | implementation_only_unverified | unsupported | NOT_IMPLEMENTED |
| dry_contact_2_trigger_source | 0x14E6 | 16 | 1 | write_multiple_registers_fc16 | big_endian/single_word | U | 1 | 0 | 0 | 12 | 1 | - | dry_contact_2_trigger_source | - | - | implementation_only_unverified | unsupported | NOT_IMPLEMENTED |
| uart_protocol_library_version | 0x14E6 | 16 | 1 | - | big_endian/single_word | U | 1 | 0 | 0 | 255 | 1 | - | uart_protocol_library_version | - | - | implementation_only_unverified | n/a | READ_ONLY_UNVERIFIED |
| dry_contact_1_trigger_value | 0x14F0 | 32 | 2 | write_multiple_registers_fc16 | big_endian/high_word_first | S | 1 | 0 | -16777215 | 16777215 | 1 | - | dry_contact_1_trigger_value | - | - | implementation_only_unverified | unsupported | NOT_IMPLEMENTED |
| dry_contact_1_recovery_value | 0x14F4 | 32 | 2 | write_multiple_registers_fc16 | big_endian/high_word_first | S | 1 | 0 | -16777215 | 16777215 | 1 | - | dry_contact_1_recovery_value | - | - | implementation_only_unverified | unsupported | NOT_IMPLEMENTED |
| dry_contact_2_trigger_value | 0x14F8 | 32 | 2 | write_multiple_registers_fc16 | big_endian/high_word_first | S | 1 | 0 | -16777215 | 16777215 | 1 | - | dry_contact_2_trigger_value | - | - | implementation_only_unverified | unsupported | NOT_IMPLEMENTED |
| dry_contact_2_recovery_value | 0x14FC | 32 | 2 | write_multiple_registers_fc16 | big_endian/high_word_first | S | 1 | 0 | -16777215 | 16777215 | 1 | - | dry_contact_2_recovery_value | - | - | implementation_only_unverified | unsupported | NOT_IMPLEMENTED |
| rcv_time | 0x1504 | 16 | 1 | write_multiple_registers_fc16 | big_endian/single_word | U | 0.1 | 0 | 0 | 25.5 | 0.1 | - | rcv_time | - | - | implementation_only_unverified | normal | BLOCKED_CONFLICT |
| rfv_time | 0x1504 | 16 | 1 | write_multiple_registers_fc16 | big_endian/single_word | U | 0.1 | 0 | 0 | 25.5 | 0.1 | - | rfv_time | - | - | implementation_only_unverified | normal | BLOCKED_CONFLICT |
