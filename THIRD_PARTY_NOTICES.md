# Third-party notices

## syssi/esphome-jk-bms

Portions of [`batterylifepo4.yaml`](batterylifepo4.yaml) were derived from
`esp32-jk-pb-modbus-example.yaml` in
[`syssi/esphome-jk-bms`](https://github.com/syssi/esphome-jk-bms).

- Upstream revision: `08f25eb4941b03b6ee0b6c38660aeadfc4ef7cd1`
- Evidence snapshot: `protocol/evidence/upstream_esp32-jk-pb-modbus-example.yaml`
- Snapshot SHA-256: `00ad253cbacf2a945960c7c81718af6f50c68cb4b1cc18314a30f1ddf8c2868d`
- License: Apache License 2.0; see [`LICENSES/Apache-2.0.txt`](LICENSES/Apache-2.0.txt)

The local configuration has been substantially modified, including its board
configuration, web interface, clustered Modbus reads, scheduler, cache,
transaction-safe writes, diagnostics and topology handling. The exact upstream
snapshot is retained unchanged as protocol provenance and secondary evidence.
The production firmware does not fetch or load `syssi/esphome-jk-bms` as an
ESPHome external component.

The `syssi.esphome-jk-bms` value retained in `esphome.project.name` is inherited
project-identification metadata; it does not mean that the upstream component is
loaded at build time.
