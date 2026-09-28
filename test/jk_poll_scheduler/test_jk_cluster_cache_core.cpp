// Host tests for components/jk_poll_scheduler/jk_cluster_cache_core.h and the
// generated block -> cluster map (protocol/generated/read_plan_decode.h
// kBlockCluster), clustered-read plan M4:
//   1. wide/narrow golden vectors: every read-plan field decoded from its
//      cluster payload equals the same field decoded from a narrow per-block
//      read of the same bytes; the narrow slice is located independently of
//      the generated map (from the cluster start in read_clusters_table.h);
//   2. cell decode from A1 equals the legacy 0x1200 x53 + 0x126A x16 readers,
//      the 0x1290 electrical block decodes identically from A1;
//   3. topology 1S, 2S, 4S, 8S, 16S, 17S, 24S, 32S: inactive channels are
//      never published;
//   4. the raw cache: exact length only, revision/sequence/time/mode,
//      fallback and credential refusal, the strict RMW gate (never the
//      background budget), and an RMW merge from fresh cluster bytes that
//      preserves sibling bits.
//
//   g++ -std=c++17 -Wall -Wextra -I components/jk_poll_scheduler -I components/jk_write_tx \
//       -I components/jk_topology -I protocol/generated test/jk_poll_scheduler/test_jk_cluster_cache_core.cpp

#include "jk_cluster_cache_core.h"
#include "jk_topology_core.h"
#include "jk_write_tx_core.h"
#include "read_plan_decode.h"

#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

using namespace jk_cluster_cache;

namespace {
int g_checks = 0, g_failures = 0;
void check(bool cond, const std::string &desc) {
  g_checks++;
  if (!cond) { g_failures++; std::printf("FAIL: %s\n", desc.c_str()); }
}
int cluster_index(const char *id) {
  for (std::size_t i = 0; i < kClusterCount; i++) if (std::strcmp(kClusters[i].id, id) == 0) return int(i);
  return -1;
}
// Distinct, address-derived content for every byte of every cluster.
std::vector<uint8_t> payload_for(std::size_t c, uint8_t salt) {
  std::vector<uint8_t> p(kClusters[c].payload_bytes);
  for (std::size_t i = 0; i < p.size(); i++) p[i] = uint8_t((kClusters[c].start + i) * 37U + salt * 11U + (i >> 3));
  return p;
}
bool same_float(float a, float b) { return (std::isnan(a) && std::isnan(b)) || a == b; }
}  // namespace

int main() {
  const int A1 = cluster_index("A1"), C2 = cluster_index("C2");

  // 1. Golden vectors: every generated field, cluster vs narrow.
  {
    std::vector<std::vector<uint8_t>> clusters;
    for (std::size_t c = 0; c < kClusterCount; c++) clusters.push_back(payload_for(c, 3));
    std::size_t mapped = 0, isolated = 0, fields = 0, credential_fields = 0;
    bool map_ok = true, values_ok = true;
    std::string detail;
    for (std::size_t b = 0; b < jk_read_plan::kBlockCount; b++) {
      const auto &blk = jk_read_plan::kBlocks[b];
      const auto &ref = jk_read_plan::kBlockCluster[b];
      if (ref.cluster < 0) {
        isolated++;
        credential_fields += blk.fields_count;
        map_ok &= jk_cluster_cache::touches_credential(blk.address, blk.register_count ? blk.register_count : 1);
        continue;
      }
      mapped++;
      // Independent location: the cluster that contains the block by address.
      const int c = jk_read_clusters::cluster_of(blk.address);
      const std::size_t off = std::size_t(blk.address - kClusters[c].start);
      map_ok &= ref.cluster == c && ref.byte_offset == off && off + blk.payload_bytes <= kClusters[c].payload_bytes;
      std::vector<uint8_t> narrow(clusters[std::size_t(c)].begin() + long(off), clusters[std::size_t(c)].begin() + long(off + blk.payload_bytes));
      const uint8_t *wide = clusters[std::size_t(ref.cluster)].data() + ref.byte_offset;
      for (uint16_t k = 0; k < blk.fields_count; k++) {
        const auto &f = jk_read_plan::kFields[blk.fields_offset + k];
        fields++;
        bool eq;
        if (f.wire_type == jk_poll_scheduler::WireType::ASCII || f.wire_type == jk_poll_scheduler::WireType::HEX) {
          eq = std::memcmp(narrow.data(), wide, blk.payload_bytes) == 0;
        } else if (f.wire_type == jk_poll_scheduler::WireType::BIT) {
          eq = jk_poll_scheduler::decode_bool(narrow.data(), f, blk.payload_bytes) == jk_poll_scheduler::decode_bool(wide, f, blk.payload_bytes);
        } else {
          eq = same_float(jk_poll_scheduler::decode_numeric(narrow.data(), f, blk.payload_bytes),
                          jk_poll_scheduler::decode_numeric(wide, f, blk.payload_bytes));
        }
        if (!eq && detail.size() < 200) detail += std::string(" ") + f.key;
        values_ok &= eq;
      }
    }
    check(map_ok && mapped == 102 && isolated == 1,
          "every read-plan block maps to the cluster that holds it at the exact byte offset (102 mapped, 1 isolated credential)");
    check(values_ok && credential_fields == 1 && fields + credential_fields == jk_read_plan::kFieldCount,
          "golden vectors: all " + std::to_string(fields) + " non-credential fields decode identically from the cluster and from a narrow read" + detail);
  }

  // 2. Cells and electrical metrics: A1 vs the legacy narrow readers.
  {
    std::vector<uint8_t> a1 = payload_for(std::size_t(A1), 9);
    for (std::size_t i = 0; i < 32; i++) { a1[2 * i] = uint8_t(0x0C + (i % 3)); a1[2 * i + 1] = uint8_t(0x10 + i); }  // 3.0-3.9 V
    const std::vector<uint8_t> legacy(a1.begin(), a1.begin() + 106);       // 0x1200 x53
    const std::vector<uint8_t> res17(a1.begin() + 106, a1.begin() + 138);  // 0x126A x16
    const CellFrame f = decode_cells_from_a1(a1.data(), 16);
    bool same = true;
    uint16_t lmin = 0xFFFF, lmax = 0; uint8_t lmin_i = 0, lmax_i = 0;
    for (uint8_t i = 0; i < 16; i++) {  // the legacy loop, verbatim arithmetic
      const uint16_t mv = uint16_t((uint16_t(legacy[2 * i]) << 8) | legacy[2 * i + 1]);
      const uint16_t mo = uint16_t((uint16_t(legacy[74 + 2 * i]) << 8) | legacy[74 + 2 * i + 1]);
      same &= f.millivolts[i] == mv && f.milliohms[i] == mo;
      if (mv >= 500 && mv < lmin) { lmin = mv; lmin_i = i + 1; }
      if (mv >= 500 && mv > lmax) { lmax = mv; lmax_i = i + 1; }
    }
    for (uint8_t i = 0; i < 16; i++) {
      same &= f.millivolts[16 + i] == uint16_t((uint16_t(legacy[32 + 2 * i]) << 8) | legacy[32 + 2 * i + 1]);
      same &= f.milliohms[16 + i] == uint16_t((uint16_t(res17[2 * i]) << 8) | res17[2 * i + 1]);
    }
    check(same, "cells: all 32 voltages and 32 resistances from A1 equal the legacy 0x1200 x53 and 0x126A x16 decodes");
    check(f.min_mv == lmin && f.max_mv == lmax && f.min_index == lmin_i && f.max_index == lmax_i &&
              f.native_max_index == legacy[72] && f.native_min_index == legacy[73],
          "cells (16S): min/max and the native index bytes equal the legacy reader exactly");
    const auto wide = jk_poll_scheduler::decode_electrical_metrics(a1.data() + kA1ElectricalOffset);
    const std::vector<uint8_t> blk(a1.begin() + long(kA1ElectricalOffset), a1.begin() + long(kA1ElectricalOffset) + 12);
    const auto narrow = jk_poll_scheduler::decode_electrical_metrics(blk.data());
    check(wide.total_voltage_v == narrow.total_voltage_v && wide.current_a == narrow.current_a && wide.power_w == narrow.power_w,
          "electrical metrics: 0x1290 decodes identically from A1 (offset 144) and from the 12-byte block");
    // Above 16S the cluster decode includes channels 17-32 in min/max (the
    // legacy reader only compared channels 1-16: a documented change).
    std::vector<uint8_t> hi = a1;
    hi[2 * 20] = 0x0F; hi[2 * 20 + 1] = 0xA0;  // cell 21 = 4.000 V, the pack maximum
    const CellFrame f24 = decode_cells_from_a1(hi.data(), 24);
    check(f24.max_index == 21 && f24.max_mv == 4000, "cells (24S): min/max cover every active channel, including 17-32");
  }

  // 3. Topology: only active channels are ever published.
  {
    std::vector<uint8_t> a1 = payload_for(std::size_t(A1), 5);
    const uint8_t cases[] = {1, 2, 4, 8, 16, 17, 24, 32};
    bool ok = true;
    std::string bad;
    for (uint8_t n : cases) {
      const uint8_t active = jk_topology::channel_count_from_configured(float(n));
      const CellFrame f = decode_cells_from_a1(a1.data(), active);
      std::size_t published = 0;
      bool prefix = true;
      for (std::size_t i = 0; i < kCellChannels; i++) { published += f.publish[i]; prefix &= f.publish[i] == (i < n); }
      if (!(active == n && published == n && prefix)) { ok = false; bad += " " + std::to_string(n) + "S"; }
    }
    check(ok, "topology 1/2/4/8/16/17/24/32S: exactly channels 1..N are published, inactive channels never" + bad);
    const CellFrame none = decode_cells_from_a1(a1.data(), 0);
    bool nothing = true;
    for (bool p : none.publish) nothing &= !p;
    check(nothing && none.min_index == 0 && none.max_index == 0, "unknown topology (0 channels): nothing is published and no min/max");
  }

  // 4. Raw cache.
  {
    Cache cache;
    std::vector<uint8_t> c2 = payload_for(std::size_t(C2), 1);
    check(cache.register_raw(0x1114, 1, 0).status == Lookup::MISSING, "cache: a never-read cluster is MISSING");
    check(cache.store(C2, c2.data(), c2.size() - 2, 100, false) == StoreStatus::WRONG_LENGTH &&
              cache.store(C2, c2.data(), c2.size() + 2, 100, false) == StoreStatus::WRONG_LENGTH &&
              cache.entry(std::size_t(C2)).source == Source::NONE && cache.sequence() == 0,
          "cache: a short or long response is refused and changes nothing");
    check(cache.store(C2, c2.data(), c2.size(), 1000, true) == StoreStatus::OK, "cache: an exact-length response is stored");
    const Entry &e = cache.entry(std::size_t(C2));
    check(e.revision == 1 && e.sequence == 1 && e.success_ms == 1000 && e.active_mode && e.source == Source::CLUSTER,
          "cache: revision, global sequence, time and lease mode recorded");
    std::vector<uint8_t> a1 = payload_for(std::size_t(A1), 2);
    cache.store(A1, a1.data(), a1.size(), 1100, false);
    check(cache.entry(std::size_t(A1)).sequence == 2 && cache.entry(std::size_t(A1)).revision == 1, "cache: the success sequence is global across clusters");
    const RawResult r = cache.register_raw(0x1114, 1, 1000 + kRmwStrictBudgetMs);
    const std::size_t off = 0x1114 - kClusters[C2].start;
    check(r.status == Lookup::OK && r.raw == ((uint32_t(c2[off]) << 8) | c2[off + 1]) && r.cluster == C2 && r.revision == 1,
          "cache: a register raw value comes from the exact cluster bytes while fresh");
    const RawResult r32 = cache.register_raw(0x10F8, 2, 2000);
    const std::size_t o32 = 0x10F8 - kClusters[C2].start;
    check(r32.status == Lookup::OK && r32.raw == ((uint32_t(c2[o32]) << 24) | (uint32_t(c2[o32 + 1]) << 16) | (uint32_t(c2[o32 + 2]) << 8) | c2[o32 + 3]),
          "cache: a 32-bit register is assembled big-endian from the cluster bytes");
    check(kRmwStrictBudgetMs == 3500 && cache.register_raw(0x1114, 1, 1000 + kRmwStrictBudgetMs + 1).status == Lookup::STALE,
          "cache: the RMW gate is the strict 3.5 s active budget; 1 ms later the raw is STALE (never the 300 s background budget)");
    check(cache.register_raw(0x1470, 8, 1000).status == Lookup::CREDENTIAL && cache.register_raw(0x146E, 2, 1000).status == Lookup::CREDENTIAL,
          "cache: any lookup touching the setup passcode 0x1470-0x147F is refused as CREDENTIAL");
    check(cache.register_raw(0x1440, 1, 1000).status == Lookup::UNKNOWN && cache.register_raw(0x12EE, 2, 1000).status == Lookup::UNKNOWN,
          "cache: an address in no cluster, or a value split across two clusters, is UNKNOWN");
    check(cache.register_raw(0x1114, 3, 1000).status == Lookup::BAD_WIDTH, "cache: only 1- or 2-word registers are RMW targets");
    cache.mark_fallback(C2);
    check(cache.register_raw(0x1114, 1, 1200).status == Lookup::FALLBACK && !cache.fresh(C2, 1200, 300500),
          "cache: after a fallback takeover the cluster's bytes are never RMW input");
    cache.store(C2, c2.data(), c2.size(), 5000, false);
    check(cache.register_raw(0x1114, 1, 5000).status == Lookup::OK && cache.entry(std::size_t(C2)).revision == 2,
          "cache: a new cluster read restores it (revision 2)");
    // RMW: change one bit of the 0x1114 flag word from fresh cluster bytes;
    // sibling bits are preserved and verified.
    const RawResult flags = cache.register_raw(0x1114, 1, 5100);
    const uint32_t mask = 0x0004;
    const uint32_t merged = jk_write_tx::merge_field_into_raw(flags.raw, mask, 2, (flags.raw & mask) ? 0u : 1u);
    check(flags.status == Lookup::OK && (merged & ~mask & 0xFFFF) == (flags.raw & ~mask & 0xFFFF) && (merged & mask) != (flags.raw & mask) &&
              jk_write_tx::verify_sibling_bits_preserved(flags.raw, merged, mask) &&
              !jk_write_tx::verify_sibling_bits_preserved(flags.raw, merged ^ 0x0001, mask),
          "RMW: one bit flipped in the 0x1114 flag word from fresh cluster bytes; every sibling bit preserved (and a sibling change detected)");
    // Passcode bytes can never be stored: no cluster covers them.
    check(jk_read_clusters::cluster_of(0x1470) == jk_read_clusters::kNoCluster && jk_read_clusters::cluster_of(0x147E) == jk_read_clusters::kNoCluster,
          "credential: no cluster (and so no cache entry) covers 0x1470-0x147F");
  }

  std::printf("cluster cache: %d/%d checks passed\n", g_checks - g_failures, g_checks);
  return g_failures == 0 ? 0 : 1;
}
