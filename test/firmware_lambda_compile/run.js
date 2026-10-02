#!/usr/bin/env node
"use strict";

// Host compile check of the firmware's own C++ lambdas (clustered-read plan
// M5). There is no ESPHome toolchain in this environment -- the owner
// compiles in Home Assistant -- so this harness catches the project-code
// class of compile errors before that: typos, wrong types, missing ids,
// wrong script arguments, header API misuse.
//
// How: every `lambda: |-` of batterylifepo4.yaml's interval: and script:
// sections and of protocol/generated/read_plan.yaml is extracted, rewritten
// the way ESPHome rewrites lambdas (id(x). -> x->, id(global) ->
// global->value(), id(other) -> other), wrapped in a function (a script
// lambda gets its declared parameters) and compiled with `g++
// -fsyntax-only` against the real project headers plus a minimal stub of
// the ESPHome API surface these lambdas use.
//
// Limits (stated, not implied): the stubs are this file's own model of the
// ESPHome API, so an ESPHome API mismatch is NOT caught here -- only the
// real ESPHome compile catches that. Of the esphome: on_boot lambda only
// the ReadPlanFreshnessHandler (GET /settings/read-freshness) and
// RegisterWriteStatusHandler (GET /settings/register-write/status) classes,
// both changed by M5, are compiled, against a stub of the web server API;
// the other handler classes, sensor/number/select actions and the remaining
// sections are not compiled here.

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const MAIN = path.join(ROOT, "batterylifepo4.yaml");
const READ_PLAN = path.join(ROOT, "protocol", "generated", "read_plan.yaml");

let checks = 0;
let failures = 0;
function check(name, condition, detail = "") {
  checks += 1;
  if (condition) console.log(`PASS  ${name}`);
  else { failures += 1; console.log(`FAIL  ${name}${detail ? `\n${detail}` : ""}`); }
}

// --- YAML scanning (line based; the files are hand/generator formatted) ---
function topSection(lines, i) {
  for (let k = i; k >= 0; k--) { const m = /^([a-z_]+):/.exec(lines[k]); if (m) return m[1]; }
  return null;
}

function declaredIds(text) {
  const lines = text.split("\n");
  const ids = new Map();  // id -> { section, type, params }
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(?:- )?id: ([A-Za-z_][A-Za-z0-9_]*)\s*(#.*)?$/.exec(lines[i]);
    if (!m) continue;
    const section = topSection(lines, i);
    const entry = { section, type: null, params: [] };
    if (section === "globals") {
      for (let k = i + 1; k < Math.min(lines.length, i + 6); k++) {
        const t = /^\s+type: (.+?)\s*(#.*)?$/.exec(lines[k]);
        if (t) { entry.type = t[1].trim(); break; }
        if (/^\s*- id:/.test(lines[k])) break;
      }
    }
    if (section === "script") {
      const base = m[1].length;
      for (let k = i + 1; k < lines.length; k++) {
        if (/^\s*parameters:\s*$/.test(lines[k])) {
          for (let p = k + 1; p < lines.length; p++) {
            const pm = /^\s+([a-z_][a-z0-9_]*): ([A-Za-z0-9_:<>\[\]]+)\s*$/.exec(lines[p]);
            if (!pm) break;
            entry.params.push([pm[1], pm[2]]);
          }
          break;
        }
        const li = lines[k].length - lines[k].trimStart().length;
        if (lines[k].trim() && li <= base) break;
        if (/^\s+then:/.test(lines[k])) break;
      }
    }
    if (!ids.has(m[2])) ids.set(m[2], entry);
  }
  return ids;
}

function lambdas(text, sections) {
  const lines = text.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(?:- )?lambda: \|-\s*$/.exec(lines[i]);
    if (!m) continue;
    const section = topSection(lines, i);
    const base = m[1].length;
    const body = [];
    let j = i + 1;
    let ind = null;
    for (; j < lines.length; j++) {
      const l = lines[j];
      if (l.trim() === "") { body.push(""); continue; }
      const li = l.length - l.trimStart().length;
      if (li <= base) break;
      if (ind === null) ind = li;
      body.push(l.slice(Math.min(ind, li)));
    }
    if (sections.includes(section)) {
      // The owning script (nearest preceding `- id:` at script level).
      let script = null;
      if (section === "script") {
        for (let k = i; k >= 0; k--) { const s = /^  - id: ([a-z_0-9]+)\s*$/.exec(lines[k]); if (s) { script = s[1]; break; } }
      }
      out.push({ line: i + 1, section, script, body: body.join("\n") });
    }
    i = j - 1;
  }
  return out;
}

const CPP_TYPES = { int: "int", bool: "bool", float: "float", string: "std::string", "int[]": "std::vector<int>", "float[]": "std::vector<float>" };

function globalDecl(name, type) {
  // `uint32_t[6]` -> std::array-like C array value.
  const arr = /^(.+?)\[(\d+)\]$/.exec(type);
  const t = arr ? `${arr[1]}[${arr[2]}]` : type;
  const typedefName = `T_${name}`;
  return arr ? `typedef ${arr[1]} ${typedefName}[${arr[2]}];\nesphome::globals::GlobalsComponent<${typedefName}> *${name};`
             : `esphome::globals::GlobalsComponent<${t}> *${name};`;
}

const DOMAIN_TYPES = {
  sensor: "esphome::sensor::Sensor",
  text_sensor: "esphome::text_sensor::TextSensor",
  binary_sensor: "esphome::binary_sensor::BinarySensor",
  number: "esphome::number::Number",
  select: "esphome::select::Select",
  switch: "esphome::switch_::Switch",
  text: "esphome::text::Text",
  button: "esphome::button::Button",
  modbus_controller: "esphome::modbus_controller::ModbusController",
  web_server_base: "esphome::web_server_base::WebServerBase",
};

function transform(body, ids) {
  // ESPHome: id(x). -> x->  ;  id(global) -> global->value()  ;  id(x) -> x
  return body
    .replace(/\bid\(([A-Za-z_][A-Za-z0-9_]*)\)\./g, (_, n) => (ids.get(n) && ids.get(n).section === "globals" ? `${n}->value().` : `${n}->`))
    .replace(/\bid\(([A-Za-z_][A-Za-z0-9_]*)\)/g, (_, n) => (ids.get(n) && ids.get(n).section === "globals" ? `${n}->value()` : n));
}

const STUBS = `
#include <array>
#include <cstdlib>
#include <sys/types.h>
// ESP-IDF esp_http_server.h, as ActiveGroupHandler's 429 path uses it.
struct httpd_req_t {};
constexpr ssize_t HTTPD_RESP_USE_STRLEN = -1;
inline int httpd_resp_set_status(httpd_req_t *, const char *) { return 0; }
inline int httpd_resp_set_type(httpd_req_t *, const char *) { return 0; }
inline int httpd_resp_set_hdr(httpd_req_t *, const char *, const char *) { return 0; }
inline int httpd_resp_send(httpd_req_t *, const char *, ssize_t) { return 0; }
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <functional>
#include <span>
#include <string>
#include <vector>
uint32_t millis();
#define ESP_LOGW(tag, ...) std::printf(__VA_ARGS__)
#define ESP_LOGI(tag, ...) std::printf(__VA_ARGS__)
#define ESP_LOGD(tag, ...) std::printf(__VA_ARGS__)
#define ESP_LOGE(tag, ...) std::printf(__VA_ARGS__)
#define ESP_LOGV(tag, ...) std::printf(__VA_ARGS__)
namespace esphome {
namespace globals { template<typename T> struct GlobalsComponent { T v{}; T &value() { return v; } }; }
namespace sensor { struct Sensor { float state = NAN; void publish_state(float) {} bool has_state() const { return true; } void update() {} }; }
namespace text_sensor { struct TextSensor { std::string state; void publish_state(const std::string &) {} bool has_state() const { return true; } void update() {} }; }
namespace binary_sensor { struct BinarySensor { bool state = false; void publish_state(bool) {} }; }
namespace number { struct NumberCall { NumberCall &set_value(float) { return *this; } void perform() {} };
  struct Number { float state = NAN; void publish_state(float) {} NumberCall make_call() { return {}; } bool has_state() const { return true; } }; }
namespace select { struct Select { std::string state; void publish_state(const std::string &) {} bool has_state() const { return true; } }; }
namespace switch_ { struct Switch { bool state = false; void publish_state(bool) {} }; }
namespace text { struct Text { std::string state; void publish_state(const std::string &) {} }; }
namespace button { struct Button { void press() {} }; }
namespace web_server_base { struct WebServerBase {}; }
namespace web_server_idf {
enum HttpMethod { HTTP_GET = 1, HTTP_POST = 2 };
struct AsyncWebServerRequest {
  static constexpr std::size_t URL_BUF_SIZE = 64;
  HttpMethod method() const { return HTTP_GET; }
  std::string url_to(char *) const { return {}; }
  std::string arg(const char *) const { return {}; }
  void send(int, const char *, const char *) {}
  operator httpd_req_t *() { return nullptr; }
};
struct AsyncWebHandler {
  virtual ~AsyncWebHandler() = default;
  virtual bool canHandle(AsyncWebServerRequest *) const { return false; }
  virtual void handleRequest(AsyncWebServerRequest *) {}
};
}
namespace script { template<typename... Ts> struct Script { void execute(Ts...) {} bool is_running() { return false; } void stop() {} }; }
// The ESPHome 2026.9.0 shape the device-compiled code already uses:
// (EntityType, uint16_t start, std::span<const uint8_t> data) handlers.
namespace modbus { enum class EntityType { COIL, DISCRETE_INPUT, HOLDING, READ };
// ModbusClientHub's two public queries the pre-write quiescence barrier
// (plan M8.1) reads -- the real 2026.9.1 declarations in modbus.h are
// \`bool tx_buffer_empty();\` and \`bool tx_blocked() override;\`.
struct ModbusClientDevice;
// Plan M8.2: the hub/device surface jk_write_tx_hub_device.h uses, with the
// real 2026.9.1 declarations (modbus.h / modbus_helpers.h / modbus_definitions.h).
enum class ExceptionCode : uint8_t { ILLEGAL_FUNCTION = 1 };
struct CommandOptions { bool continuous : 1 {false}; };
struct ModbusClientHub {
  bool tx_buffer_empty() { return true; }
  bool tx_blocked() { return false; }
  bool queue_pdu(uint8_t, std::span<const uint8_t>, ModbusClientDevice * = nullptr, CommandOptions = {}) { return true; }
  void clear_tx_queue_for_device(ModbusClientDevice *) {}
};
namespace helpers { inline std::span<const uint8_t> server_pdu_payload(std::span<const uint8_t> pdu) { return pdu; } }
class ModbusClientDevice {
 public:
  ModbusClientDevice() = default;
  ModbusClientDevice(ModbusClientHub *parent, uint8_t address) : parent_(parent), address_(address) {}
  virtual ~ModbusClientDevice() = default;
  ModbusClientDevice(const ModbusClientDevice &) = delete;
  ModbusClientDevice &operator=(const ModbusClientDevice &) = delete;
  ModbusClientDevice(ModbusClientDevice &&) = delete;
  ModbusClientDevice &operator=(ModbusClientDevice &&) = delete;
  void set_parent(ModbusClientHub *parent) { this->parent_ = parent; }
  void set_address(uint8_t address) { this->address_ = address; }
  virtual void on_response(std::span<const uint8_t> request_pdu, std::span<const uint8_t> response_pdu) {}
  virtual void on_error(std::span<const uint8_t> request_pdu, ExceptionCode exception_code) {}
  virtual void on_not_sent(std::span<const uint8_t> request_pdu) {}
  virtual void on_sent(std::span<const uint8_t> request_pdu) {}
  virtual bool on_no_response(std::span<const uint8_t> request_pdu) { return false; }
  bool read_holding_registers(uint16_t start_address, uint16_t number_of_registers, CommandOptions options = {}) { return true; }
  bool write_multiple_registers(uint16_t start_address, std::span<const uint16_t> values, CommandOptions options = {}) { return true; }
  inline void clear_tx_queue_for_device() { this->parent_->clear_tx_queue_for_device(this); }
 protected:
  ModbusClientHub *parent_{nullptr};
  uint8_t address_{0};
};
}
namespace modbus_controller {
struct ModbusController;
using Handler = std::function<void(modbus::EntityType, uint16_t, std::span<const uint8_t>)>;
struct ModbusCommandItem {
  static ModbusCommandItem create_read_command(ModbusController *, modbus::EntityType, uint16_t, uint16_t, Handler &&) { return {}; }
  static ModbusCommandItem create_write_multiple_command(ModbusController *, uint16_t, uint16_t, const std::vector<uint16_t> &) { return {}; }
  Handler on_data_func;
};
// hub() / device_address(): the real 2026.9.1 \`modbus::ModbusClientHub *hub() const\` and
// \`uint8_t device_address() const\` (modbus_controller.h).
struct ModbusController { void queue_command(const ModbusCommandItem &) {} modbus::ModbusClientHub *hub() const { return nullptr; }
  uint8_t device_address() const { return 1; } };
}
}
`;

function main() {
  const mainText = fs.readFileSync(MAIN, "utf8");
  const planText = fs.readFileSync(READ_PLAN, "utf8");
  const ids = declaredIds(mainText);
  for (const [k, v] of declaredIds(planText)) if (!ids.has(k)) ids.set(k, v);

  const includes = [...mainText.matchAll(/^    - ((?:components|protocol)\/[^\s]+\.h)\s*$/gm)].map((m) => m[1]);
  check("the ESPHome includes list names the cluster headers", ["protocol/generated/read_clusters_table.h",
    "components/jk_poll_scheduler/jk_cluster_runtime_core.h"].every((h) => includes.includes(h)), includes.join(" "));

  const found = [...lambdas(mainText, ["interval", "script"]), ...lambdas(planText, ["interval"])];
  check("lambdas found: the generated servicer, cluster_stored, the RMW request paths and the M5 intervals",
    found.some((l) => l.body.includes("rt.issue(now, false, lease)")) &&
    found.some((l) => l.script === "cluster_stored") &&
    found.some((l) => l.script === "entity_write_step" && l.body.includes("g_entity_write_requests")) &&
    found.some((l) => l.script === "write_bms_u16" && l.body.includes("arm_write(")) &&
    found.some((l) => l.body.includes("g_register_write_rmw")), `${found.length} lambdas`);

  // Every id() a compiled lambda names must be declared somewhere.
  const used = new Set();
  for (const l of found) for (const m of l.body.matchAll(/\bid\(([A-Za-z_][A-Za-z0-9_]*)\)/g)) used.add(m[1]);

  // The handler classes changed by M5 (and ActiveGroupHandler by M7: the
  // Settings lease), from the on_boot lambda.
  const handlerClass = (name) => {
    const start = mainText.indexOf(`class ${name} : public AsyncWebHandler {`);
    if (start < 0) return { text: "", line: 0 };
    const lineStart = mainText.lastIndexOf("\n", start) + 1;
    const indent = start - lineStart;
    const close = mainText.indexOf(`\n${" ".repeat(indent)}};`, start);
    return { text: mainText.slice(start, close + indent + 3), line: mainText.slice(0, start).split("\n").length };
  };
  const freshness = handlerClass("ReadPlanFreshnessHandler");
  const status = handlerClass("RegisterWriteStatusHandler");
  const lease = handlerClass("ActiveGroupHandler");
  check("the ActiveGroupHandler class was found and renews the global Settings lease (M7)",
    lease.text.includes("renew_settings_lease(jk_cluster_runtime::g_settings_lease") && lease.text.includes("release_settings_lease("),
    lease.text.slice(0, 200));
  check("the ReadPlanFreshnessHandler class was found and names the clusters array", freshness.text.includes("\"],\\\"clusters\\\":[\""),
    freshness.text.slice(0, 200));
  check("the RegisterWriteStatusHandler class was found and reports no_change", status.text.includes("\\\"status\\\":\\\"no_change\\\""),
    status.text.slice(0, 200));
  // Their ids are declared like the lambdas' (collected before the decls).
  for (const h of [freshness, status, lease]) for (const m of h.text.matchAll(/\bid\(([A-Za-z_][A-Za-z0-9_]*)\)/g)) used.add(m[1]);
  const undeclared = [...used].filter((n) => !ids.has(n));
  check("every id() used by the compiled lambdas is declared in the YAML", undeclared.length === 0, undeclared.join(", "));

  const decls = [];
  for (const n of [...used].sort()) {
    const e = ids.get(n);
    if (!e) continue;
    if (e.section === "globals") {
      if (!e.type) { check(`global ${n} has a type`, false); continue; }
      decls.push(globalDecl(n, e.type));
    } else if (e.section === "script") {
      const types = e.params.map(([, t]) => CPP_TYPES[t] || t);
      decls.push(`esphome::script::Script<${types.join(", ")}> *${n};`);
    } else if (DOMAIN_TYPES[e.section]) {
      decls.push(`${DOMAIN_TYPES[e.section]} *${n};`);
    } else {
      check(`id ${n} has a known domain`, false, e.section);
    }
  }


  const fns = found.map((l, k) => {
    let params = "";
    if (l.script) {
      const e = ids.get(l.script);
      params = (e ? e.params : []).map(([n, t]) => `${CPP_TYPES[t] || t} ${n}`).join(", ");
    }
    const src = l.section === "interval" && l.body.includes("rt.issue(") ? "read_plan.yaml" : "batterylifepo4.yaml";
    return `// ${src}:${l.line}${l.script ? ` script ${l.script}` : ""}\nvoid lambda_${k}(${params}) {\n#line ${l.line + 1} "${src}"\n${transform(l.body, ids)}\n}\n`;
  });

  const cpp = [STUBS, "using namespace esphome;",
    ...includes.map((h) => `#include "${path.join(ROOT, h)}"`),
    // jk_reset_diag_rtc.h is ESP32-only (#ifdef USE_ESP32, esp_attr.h): its
    // one API the lambdas call, modelled on the real signature.
    "namespace jk_diag { inline void mark_write_crash_stage(WriteCrashStage) {} }",
    ...decls, ...fns,
    "using namespace esphome::web_server_idf;",
    `#line ${freshness.line} "batterylifepo4.yaml"`, transform(freshness.text, ids),
    `#line ${status.line} "batterylifepo4.yaml"`, transform(status.text, ids),
    `#line ${lease.line} "batterylifepo4.yaml"`, transform(lease.text, ids)].join("\n");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jk-lambda-"));
  const file = path.join(dir, "lambdas.cpp");
  fs.writeFileSync(file, cpp);
  const r = spawnSync("g++", ["-std=gnu++20", "-fsyntax-only", "-Wall", "-Wno-unused-variable", "-Wno-unused-but-set-variable",
    "-Wno-unused-function", "-Wno-format", "-ferror-limit=40", "-I", path.join(ROOT, "components", "jk_poll_scheduler"),
    "-I", path.join(ROOT, "components", "jk_write_tx"), "-I", path.join(ROOT, "components", "jk_topology"),
    "-I", path.join(ROOT, "components", "jk_capability"), "-I", path.join(ROOT, "components", "jk_diag"),
    "-I", path.join(ROOT, "protocol", "generated"), file], { encoding: "utf8" });
  const errors = (r.stderr || "").split("\n").filter((x) => / error: /.test(x));
  check(`${found.length} firmware lambdas compile (g++ -fsyntax-only against the project headers + ESPHome API stubs)`,
    r.status === 0, (r.stderr || "").split("\n").slice(0, 60).join("\n"));
  if (process.env.KEEP_LAMBDA_CPP) console.log(`kept: ${file}`); else fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\nfirmware lambda compile: ${checks - failures}/${checks} passed${errors.length ? ` (${errors.length} errors)` : ""}`);
  process.exit(failures ? 1 : 0);
}

main();
