// Stage 4 (typed-petting-puzzle plan §5) end-to-end integration test: the
// REAL generated protocol/generated/read_plan_decode.h (jk_read_plan::
// kBlocks, produced by generate_read_plan.js from the actual committed
// registers.canonical.json) combined with jk_write_tx_core.h's RMW core,
// exercising the exact sequence begin_write_tx_rmw performs in
// batterylifepo4.yaml, for a real, currently write-software-ready packed
// field (gps_heartbeat, 0x1114 bit2) -- not a synthetic fixture.
//
//   g++ -std=c++17 -Wall -Wextra -I ../.. -I ../../components/jk_write_tx \
//       test_jk_write_tx_rmw_end_to_end.cpp -o test_jk_write_tx_rmw_end_to_end
//   ./test_jk_write_tx_rmw_end_to_end

#include "protocol/generated/read_plan_decode.h"
#include "jk_write_tx_core.h"

#include <cstdio>

using namespace jk_write_tx;

namespace {
int g_failures = 0;
int g_checks = 0;

void check(bool cond, const char *desc) {
  g_checks++;
  if (!cond) {
    g_failures++;
    std::printf("FAIL: %s\n", desc);
  }
}

template <typename T>
void check_eq(T actual, T expected, const char *desc) {
  g_checks++;
  if (actual != expected) {
    g_failures++;
    std::printf("FAIL: %s (expected != actual)\n", desc);
  }
}
}  // namespace

int main() {
  // 1. Locate the real 0x1114 block in the real generated table.
  const int block_idx = jk_poll_scheduler::find_block_index_for_address(jk_read_plan::kBlocks, 0x1114);
  check(block_idx >= 0, "0x1114 block found in the real generated kBlocks table");
  if (block_idx < 0) {
    std::printf("\n%d checks run, %d failed.\n", g_checks, g_failures);
    return 1;
  }
  check_eq<uint8_t>(jk_read_plan::kBlocks[block_idx].payload_bytes, 2, "0x1114 block payload_bytes is 2 (16-bit register)");
  check(jk_read_plan::kBlocks[block_idx].strict_length == true, "0x1114 block is strict_length=true (ORDINARY_ONE_REGISTER, not the 0x1290 exception)");

  // 2. Simulate the scheduler having just cached a fresh raw snapshot for
  // this block, exactly as the interval servicer's own read callback does
  // (id(g_rp_last_raw_word)[chosen] = read_be(...)).
  const uint32_t last_success_ms = 100000;
  const uint32_t now_ms = 100500;  // 500ms later -- well within any real freshness budget
  const uint32_t freshness_budget_ms = 30000;  // matches write_registry.json's gps_heartbeat entry
  check(raw_is_fresh(last_success_ms, now_ms, freshness_budget_ms), "cached snapshot is fresh 500ms after the last successful read");

  // Real raw value: bit0 (heat_en)=1, bit2 (gps_heartbeat)=0, bit9
  // (charging_float_mode)=1, everything else 0 -- an arbitrary but
  // internally-consistent starting state with multiple sibling bits set,
  // to make sibling-preservation meaningful (not vacuously true against
  // an all-zero register).
  const uint32_t old_raw = 0x0201u;  // bit0=1, bit9=1

  // 3. Encode gps_heartbeat = 1 (matching write_registry.json's real
  // geometry: scale=1, offset=0, minimum=0, maximum=1, field_width_bits=1,
  // unsigned).
  const auto enc = encode_numeric_field(/*decoded_value=*/1.0, /*is_signed=*/false, /*scale=*/1.0, /*offset=*/0.0,
                                         /*minimum=*/0.0, /*maximum=*/1.0, /*field_width_bits=*/1);
  check(enc.status == EncodeStatus::OK, "gps_heartbeat=1 encodes OK against its real canonical range");
  check_eq<uint32_t>(enc.encoded_raw, 1u, "gps_heartbeat=1 encodes to raw bit value 1");

  // 4. Merge using the REAL mask/shift from write_registry.json
  // (mask=0x0004, shift=2).
  const uint32_t merged_raw = merge_field_into_raw(old_raw, /*mask=*/0x0004u, /*shift=*/2, enc.encoded_raw);
  check_eq<uint32_t>(merged_raw, 0x0205u, "merged_raw sets bit2 (gps_heartbeat) while preserving bit0 and bit9");

  // 5. Sibling-bit preservation: every bit outside mask must be unchanged.
  check(verify_sibling_bits_preserved(old_raw, merged_raw, 0x0004u),
        "heat_en (bit0) and charging_float_mode (bit9) are preserved by the gps_heartbeat write");

  // 6. Writing gps_heartbeat=0 next (from the just-written state) must
  // clear ONLY bit2, still preserving the same siblings.
  const auto enc0 = encode_numeric_field(0.0, false, 1.0, 0.0, 0.0, 1.0, 1);
  check(enc0.status == EncodeStatus::OK, "gps_heartbeat=0 encodes OK");
  const uint32_t merged_raw2 = merge_field_into_raw(merged_raw, 0x0004u, 2, enc0.encoded_raw);
  check_eq<uint32_t>(merged_raw2, 0x0201u, "clearing gps_heartbeat restores the original raw value exactly (round-trip)");
  check(verify_sibling_bits_preserved(merged_raw, merged_raw2, 0x0004u), "siblings still preserved on the reverse (rollback) write");

  // 7. A stale snapshot (past the freshness budget) must be rejected --
  // proving the caller-side check begin_write_tx_rmw performs before ever
  // reaching merge_field_into_raw would correctly refuse this write.
  check(!raw_is_fresh(last_success_ms, last_success_ms + freshness_budget_ms + 1, freshness_budget_ms),
        "a snapshot 1ms past its freshness budget is correctly rejected as stale");

  std::printf("\n%d checks run, %d failed.\n", g_checks, g_failures);
  return g_failures == 0 ? 0 : 1;
}
