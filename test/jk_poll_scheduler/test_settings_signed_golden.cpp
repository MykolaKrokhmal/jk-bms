// Golden vectors for the four signed Settings temperature recoveries
// (charge_otpr 0x1050, discharge_otpr 0x1058, charge_utpr 0x1060,
// mos_otpr 0x1068): S32, scale 0.1 degC, range -100..200, step 0.1,
// 2 registers, full-width write (clustered-read plan M5, Settings write
// migration, 2026-09-29). Signedness evidence: upstream_syssi_esphome_jk_bms
// (esp32-jk-pb-modbus-example.yaml @ 08f25eb4, INT32 / value_type S_DWORD).
//
// Uses only generated data (write_registry_table.h, read_plan_decode.h) and
// the production encode/decode/verify/RMW code -- no copied constants.
//
//   g++ -std=c++17 -I components/jk_poll_scheduler -I components/jk_write_tx -I protocol/generated \
//       test/jk_poll_scheduler/test_settings_signed_golden.cpp

#include "jk_cluster_runtime_core.h"
#include "jk_write_tx_core.h"
#include "read_plan_decode.h"
#include "write_registry_table.h"

#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

using namespace jk_cluster_runtime;

namespace {
int g_checks = 0, g_failures = 0;
void check(bool cond, const std::string &desc) {
  g_checks++;
  if (!cond) { g_failures++; std::printf("FAIL: %s\n", desc.c_str()); }
}
const jk_write_registry::Entry *entry_for(const char *key) {
  for (const auto &e : jk_write_registry::kEntries) if (std::strcmp(e.key, key) == 0) return &e;
  return nullptr;
}
const jk_poll_scheduler::FieldDecode *field_for(const char *key) {
  for (const auto &f : jk_read_plan::kFields) if (std::strcmp(f.key, key) == 0) return &f;
  return nullptr;
}
std::vector<uint8_t> be32(uint32_t v) { return {uint8_t(v >> 24), uint8_t(v >> 16), uint8_t(v >> 8), uint8_t(v)}; }
}  // namespace

int main() {
  struct Vec { double value; uint32_t raw; };
  const Vec vectors[] = {
      {-100.0, 0xFFFFFC18u},  // -1000
      {-0.1, 0xFFFFFFFFu},    // -1
      {0.0, 0x00000000u},
      {25.5, 0x000000FFu},    // 255
      {200.0, 0x000007D0u},   // 2000
  };
  const int C1 = jk_read_clusters::cluster_of(0x1050);
  const char *keys[] = {"charge_otpr", "discharge_otpr", "charge_utpr", "mos_otpr"};
  const uint16_t addrs[] = {0x1050, 0x1058, 0x1060, 0x1068};
  for (int k = 0; k < 4; k++) {
    const std::string key = keys[k];
    const auto *e = entry_for(keys[k]);
    check(e != nullptr, key + ": in the generated write registry");
    if (!e) continue;
    check(e->address == addrs[k] && e->word_count == 2 && !e->uses_rmw && e->mask == 0xFFFFFFFFu && e->shift == 0 &&
              e->is_signed && e->scale == 0.1 && e->offset == 0 && e->minimum == -100 && e->maximum == 200 &&
              e->field_width_bits == 32 && e->submit_policy == jk_write_registry::SubmitPolicy::LIVE,
          key + ": signed S32, 2 registers, full width, scale 0.1, -100..200, live");
    const auto *f = field_for(keys[k]);
    check(f != nullptr && f->is_signed && f->wire_type == jk_poll_scheduler::WireType::S32, key + ": read decode is signed S32");
    for (const Vec &v : vectors) {
      const auto enc = jk_write_tx::encode_numeric_field(v.value, e->is_signed, e->scale, e->offset, e->minimum, e->maximum, e->field_width_bits);
      char buf[160];
      std::snprintf(buf, sizeof buf, "%s: encode %.1f -> 0x%08X (got 0x%08X, status %d)", keys[k], v.value, unsigned(v.raw),
                    unsigned(enc.encoded_raw), int(enc.status));
      check(enc.status == jk_write_tx::EncodeStatus::OK && enc.encoded_raw == v.raw, buf);
      if (f) {
        const auto bytes = be32(v.raw);
        const float back = jk_poll_scheduler::decode_numeric(bytes.data(), *f, 4);
        std::snprintf(buf, sizeof buf, "%s: decode 0x%08X -> %.1f (got %.4f)", keys[k], unsigned(v.raw), v.value, double(back));
        check(std::fabs(double(back) - v.value) < 1e-3, buf);
      }
    }
    for (double bad : {-100.1, 200.1, -1000.0, 4294967.0}) {
      const auto enc = jk_write_tx::encode_numeric_field(bad, e->is_signed, e->scale, e->offset, e->minimum, e->maximum, e->field_width_bits);
      check(enc.status == jk_write_tx::EncodeStatus::OUT_OF_RANGE, key + ": out-of-range " + std::to_string(bad) + " rejected before any write");
    }
    // ACK/readback comparison on the signed raw (full-register mask).
    check(jk_write_tx::compare_masked(0xFFFFFC18u, 0xFFFFFC18u, 0xFFFFFFFFu) && !jk_write_tx::compare_masked(0xFFFFFC18u, 0x000003E8u, 0xFFFFFFFFu) &&
              !jk_write_tx::compare_masked(0xFFFFFFFFu, 0x0000FFFFu, 0xFFFFFFFFu),
          key + ": readback compares the full signed 32-bit raw (-100.0 != +100.0; a truncated 16-bit echo never confirms -0.1)");

    // NO_CHANGE with a negative raw already in the cluster bytes; a changed
    // negative value queues exactly its 2-register signed raw.
    std::vector<uint8_t> c1(kClusters[C1].payload_bytes, 0);
    const std::size_t off = std::size_t(addrs[k] - kClusters[C1].start);
    const auto neg = be32(0xFFFFFC18u);
    std::memcpy(c1.data() + off, neg.data(), 4);
    Runtime rt;
    rt.begin(0);
    bool stored = false;
    uint32_t now = 0;
    for (; now < 3000 && !stored; now += 20) {
      const int c = rt.issue(now, false, false);
      if (c < 0) continue;
      std::vector<uint8_t> other(kClusters[c].payload_bytes, 0);
      const auto &b = c == C1 ? c1 : other;
      rt.on_cluster_response(c, rt.generation(), b.data(), b.size(), now, false);
      stored |= c == C1;
    }
    RmwWrite w;
    w.address = addrs[k];
    w.word_count = 2;
    w.full_width = true;
    const auto same = jk_write_tx::encode_numeric_field(-100.0, true, 0.1, 0, -100, 200, 32);
    w.encoded = same.encoded_raw;
    RmwRequest q;
    q.arm(w, now);
    const auto r = q.step(rt, now);
    check(stored && r.step == RmwStep::NO_CHANGE && r.old_raw == 0xFFFFFC18u && !q.active(),
          key + ": -100.0 requested while the register holds -100.0 (0xFFFFFC18) -> NO_CHANGE, no write");
    const auto changed = jk_write_tx::encode_numeric_field(-99.9, true, 0.1, 0, -100, 200, 32);
    w.encoded = changed.encoded_raw;
    RmwRequest q2;
    q2.arm(w, now);
    const auto r2 = q2.step(rt, now);
    check(r2.step == RmwStep::QUEUE && r2.merged_raw == 0xFFFFFC19u && w.tx_compare_mask() == 0xFFFFFFFFu && w.word_count == 2,
          key + ": -99.9 queues exactly the signed raw 0xFFFFFC19 as one 2-register write with a full readback compare");
  }
  std::printf("signed settings golden vectors: %d/%d checks passed\n", g_checks - g_failures, g_checks);
  return g_failures ? 1 : 0;
}
