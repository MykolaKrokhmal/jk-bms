"""jk_history -- ESPHome custom component registration.

Thin Python codegen glue only: declares the `jk_history:` YAML block,
instantiates the C++ JkHistoryStore, and registers it as an ESPHome
Component. All actual logic (binary format, CRC32, header validation,
A/B slot selection, timestamp reconciliation, LittleFS I/O) lives in
jk_history_format.{h,cpp} (desktop-unit-tested, see
test/jk_history/test_jk_history_format.cpp) and jk_history_store.{h,cpp}
(the ESP-IDF-specific filesystem lifecycle wrapper).

YAML usage (see batterylifepo4.yaml's on_boot lambda for how the id() this
declares is actually driven -- restore()/checkpoint() calls, not this
file):

    external_components:
      - source: components

    jk_history:
      id: jk_hist_store
      partition: littlefs
      mount_point: /littlefs
      capacity: 3600
      sample_interval: 60s
"""

import esphome.codegen as cg
import esphome.config_validation as cv
from esphome.const import CONF_ID

CODEOWNERS = ["@jk-bms-project"]

jk_history_ns = cg.esphome_ns.namespace("jk_history")
JkHistoryStore = jk_history_ns.class_("JkHistoryStore", cg.Component)

CONF_PARTITION = "partition"
CONF_MOUNT_POINT = "mount_point"
CONF_CAPACITY = "capacity"
CONF_SAMPLE_INTERVAL = "sample_interval"

CONFIG_SCHEMA = cv.Schema(
    {
        cv.GenerateID(): cv.declare_id(JkHistoryStore),
        cv.Optional(CONF_PARTITION, default="littlefs"): cv.string_strict,
        cv.Optional(CONF_MOUNT_POINT, default="/littlefs"): cv.string_strict,
        # Must match the compiled-in RAM ring capacity (cc_hist_* arrays in
        # batterylifepo4.yaml, currently 3600) -- validate_header() rejects
        # a restored snapshot whose capacity field doesn't match this
        # value, per the schema-versioning discipline in the spec (never
        # silently reinterpret an old/different-sized snapshot).
        cv.Optional(CONF_CAPACITY, default=3600): cv.positive_int,
        cv.Optional(CONF_SAMPLE_INTERVAL, default="60s"): cv.positive_time_period_seconds,
    }
).extend(cv.COMPONENT_SCHEMA)


async def to_code(config):
    var = cg.new_Pvariable(config[CONF_ID])
    await cg.register_component(var, config)
    cg.add(var.set_partition_label(config[CONF_PARTITION]))
    cg.add(var.set_mount_point(config[CONF_MOUNT_POINT]))
    cg.add(var.set_expected_capacity(config[CONF_CAPACITY]))
    cg.add(var.set_sample_interval_s(config[CONF_SAMPLE_INTERVAL].total_seconds))
    # NOTE: this component's C++ side (jk_history_store.cpp) includes
    # esp_littlefs.h / calls esp_vfs_littlefs_register() -- the
    # joltwallet/littlefs managed component. That dependency is declared
    # once at the top level in batterylifepo4.yaml's own
    # esp32.framework.components list (ESP-IDF Component Manager), NOT
    # here -- it is not bundled with ESP-IDF core and cg.add_library()
    # (PlatformIO lib_deps) is the wrong mechanism for an IDF Component
    # Manager dependency, so it is deliberately not attempted from this
    # component's Python codegen.
