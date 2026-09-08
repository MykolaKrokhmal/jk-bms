// Host-side unit tests for jk_history_format.{h,cpp} -- no ESP32, no
// ESPHome, no ESP-IDF needed. Build and run with a plain desktop compiler:
//
//   g++ -std=c++17 -Wall -Wextra -I ../../components/jk_history \
//       test_jk_history_format.cpp \
//       ../../components/jk_history/jk_history_format.cpp \
//       -o test_jk_history_format
//   ./test_jk_history_format
//
// Exits non-zero (and prints which check failed) on any failure, so it's
// usable as a CI gate, not just a manual smoke test.

#include "jk_history_format.h"

#include <cstdio>
#include <cstring>

using namespace jk_history_format;

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

// ---------------------------------------------------------------------
// Little-endian round-trip
// ---------------------------------------------------------------------
static void test_le_roundtrip() {
  std::vector<uint8_t> buf;
  put_u16le(buf, 0xABCD);
  put_u32le(buf, 0xDEADBEEFu);
  put_u64le(buf, 0x0123456789ABCDEFull);
  check_eq<uint16_t>(get_u16le(buf.data()), 0xABCD, "u16le roundtrip");
  check_eq<uint32_t>(get_u32le(buf.data() + 2), 0xDEADBEEFu, "u32le roundtrip");
  check_eq<uint64_t>(get_u64le(buf.data() + 6), 0x0123456789ABCDEFull, "u64le roundtrip");
  // Explicit byte-order check (not just "roundtrip via the same function"
  // -- catches an accidental big-endian implementation that still
  // roundtrips against itself).
  check_eq<uint8_t>(buf[0], 0xCD, "u16le low byte first");
  check_eq<uint8_t>(buf[1], 0xAB, "u16le high byte second");
}

// ---------------------------------------------------------------------
// CRC32 -- known-answer test against the standard "123456789" test vector
// (CRC-32/ISO-HDLC, the same variant zlib/most tools use: poly 0xEDB88320
// reflected, init 0xFFFFFFFF, xorout 0xFFFFFFFF). Expected value is the
// well-known, widely-published check value for this exact CRC variant.
// ---------------------------------------------------------------------
static void test_crc32_known_answer() {
  const uint8_t data[] = "123456789";
  const uint32_t crc = crc32_of(data, 9);
  check_eq<uint32_t>(crc, 0xCBF43926u, "CRC32 known-answer test vector '123456789'");
}

static void test_crc32_streaming_matches_oneshot() {
  const uint8_t data[] = "The quick brown fox jumps over the lazy dog";
  const size_t len = sizeof(data) - 1;
  const uint32_t oneshot = crc32_of(data, len);
  // Same data, fed in three uneven chunks -- must match the one-shot
  // result exactly (this is what the streamed checkpoint-write path
  // relies on).
  uint32_t crc = crc32_init();
  crc = crc32_update(crc, data, 7);
  crc = crc32_update(crc, data + 7, 20);
  crc = crc32_update(crc, data + 27, len - 27);
  const uint32_t streamed = crc32_finish(crc);
  check_eq<uint32_t>(streamed, oneshot, "CRC32 streamed (3 chunks) matches one-shot");
}

static void test_crc32_detects_corruption() {
  uint8_t data[16];
  for (int i = 0; i < 16; i++) data[i] = static_cast<uint8_t>(i * 7 + 1);
  const uint32_t original = crc32_of(data, 16);
  data[8] ^= 0x01;  // flip one bit
  const uint32_t corrupted = crc32_of(data, 16);
  check(original != corrupted, "CRC32 changes when a single bit is corrupted");
}

// ---------------------------------------------------------------------
// Record encode/decode
// ---------------------------------------------------------------------
static void test_record_roundtrip() {
  struct Case { int16_t v; uint8_t s; };
  const Case cases[] = {
      {0, 0}, {5648, 1}, {-1, 4}, {kVoltageNoSample, kStageOffline},
      {32767, 4}, {-32768, 0}, {100, 255},
  };
  for (const auto &c : cases) {
    uint8_t buf[3];
    encode_record(c.v, c.s, buf);
    int16_t v2;
    uint8_t s2;
    decode_record(buf, v2, s2);
    check_eq<int16_t>(v2, c.v, "record voltage_cv roundtrip");
    check_eq<uint8_t>(s2, c.s, "record stage roundtrip");
  }
  // Explicit 3-byte size / byte-order check for one concrete case.
  uint8_t buf[3];
  encode_record(5648, 2, buf);  // 5648 = 0x1610
  check_eq<uint8_t>(buf[0], 0x10, "record byte0 = voltage_cv low");
  check_eq<uint8_t>(buf[1], 0x16, "record byte1 = voltage_cv high");
  check_eq<uint8_t>(buf[2], 2, "record byte2 = stage");
}

// ---------------------------------------------------------------------
// Header encode/decode/validate
// ---------------------------------------------------------------------
static SnapshotHeader make_valid_header(uint32_t capacity = 3600) {
  SnapshotHeader h;
  h.capacity = capacity;
  h.valid_count = 100;
  h.write_index = 42;
  h.sequence = 7;
  h.newest_timestamp = 1234567890ull;
  h.payload_length = kRecordSize * capacity;
  h.flags = 0;
  return h;
}

static void test_header_roundtrip_and_size() {
  SnapshotHeader h = make_valid_header();
  uint8_t buf[kHeaderSize];
  encode_header(h, buf);
  SnapshotHeader h2 = decode_header(buf);
  check_eq<uint32_t>(h2.magic, kMagic, "decoded magic");
  check_eq<uint16_t>(h2.schema_version, kSchemaVersion, "decoded schema_version");
  check_eq<uint16_t>(h2.header_size, kHeaderSize, "decoded header_size");
  check_eq<uint16_t>(h2.record_size, kRecordSize, "decoded record_size");
  check_eq<uint32_t>(h2.capacity, h.capacity, "decoded capacity");
  check_eq<uint32_t>(h2.valid_count, h.valid_count, "decoded valid_count");
  check_eq<uint32_t>(h2.write_index, h.write_index, "decoded write_index");
  check_eq<uint32_t>(h2.sequence, h.sequence, "decoded sequence");
  check_eq<uint64_t>(h2.newest_timestamp, h.newest_timestamp, "decoded newest_timestamp");
  check_eq<uint32_t>(h2.payload_length, h.payload_length, "decoded payload_length");
  check_eq<HeaderValidation>(validate_header(h2, 3600), HeaderValidation::kOk,
                              "freshly encoded header validates OK");
}

static void test_header_validation_order() {
  const uint32_t cap = 3600;
  SnapshotHeader h = make_valid_header(cap);
  uint8_t buf[kHeaderSize];

  // Baseline: valid.
  encode_header(h, buf);
  check_eq<HeaderValidation>(validate_header(decode_header(buf), cap), HeaderValidation::kOk,
                              "baseline header is valid");

  // Bad magic.
  {
    SnapshotHeader bad = h;
    bad.magic = 0;
    encode_header(bad, buf);
    check_eq<HeaderValidation>(validate_header(decode_header(buf), cap),
                                HeaderValidation::kBadMagic, "rejects bad magic");
  }
  // Bad schema version.
  {
    SnapshotHeader bad = h;
    bad.schema_version = 99;
    encode_header(bad, buf);
    check_eq<HeaderValidation>(validate_header(decode_header(buf), cap),
                                HeaderValidation::kBadSchemaVersion,
                                "rejects unknown schema_version");
  }
  // Bad header_size.
  {
    SnapshotHeader bad = h;
    bad.header_size = 12;
    encode_header(bad, buf);
    check_eq<HeaderValidation>(validate_header(decode_header(buf), cap),
                                HeaderValidation::kBadHeaderSize, "rejects bad header_size");
  }
  // Bad record_size.
  {
    SnapshotHeader bad = h;
    bad.record_size = 4;
    encode_header(bad, buf);
    check_eq<HeaderValidation>(validate_header(decode_header(buf), cap),
                                HeaderValidation::kBadRecordSize, "rejects bad record_size");
  }
  // Bad capacity (mismatch vs expected).
  {
    SnapshotHeader bad = h;
    bad.capacity = 1800;
    bad.payload_length = kRecordSize * 1800;  // keep payload_length internally
                                               // consistent so this test isolates
                                               // the capacity-mismatch check only
    encode_header(bad, buf);
    check_eq<HeaderValidation>(validate_header(decode_header(buf), cap),
                                HeaderValidation::kBadCapacity,
                                "rejects capacity != expected_capacity");
  }
  // Bad capacity (zero).
  {
    SnapshotHeader bad = h;
    bad.capacity = 0;
    encode_header(bad, buf);
    check_eq<HeaderValidation>(validate_header(decode_header(buf), cap),
                                HeaderValidation::kBadCapacity, "rejects capacity == 0");
  }
  // Bad payload_length (inconsistent with record_size * capacity).
  {
    SnapshotHeader bad = h;
    bad.payload_length = 999;
    encode_header(bad, buf);
    check_eq<HeaderValidation>(validate_header(decode_header(buf), cap),
                                HeaderValidation::kBadPayloadLength,
                                "rejects payload_length != record_size*capacity");
  }
  // valid_count > capacity.
  {
    SnapshotHeader bad = h;
    bad.valid_count = cap + 1;
    encode_header(bad, buf);
    check_eq<HeaderValidation>(validate_header(decode_header(buf), cap),
                                HeaderValidation::kValidCountExceedsCapacity,
                                "rejects valid_count > capacity");
  }
  // write_index >= capacity.
  {
    SnapshotHeader bad = h;
    bad.write_index = cap;  // exactly == capacity is out of range (valid range is [0, capacity))
    encode_header(bad, buf);
    check_eq<HeaderValidation>(validate_header(decode_header(buf), cap),
                                HeaderValidation::kWriteIndexOutOfRange,
                                "rejects write_index == capacity (out of range)");
  }
  // Corrupted header_crc32 (flip a byte in the crc-covered region after encoding).
  {
    encode_header(h, buf);
    buf[10] ^= 0xFF;  // corrupt a byte inside the crc-covered field region
    check_eq<HeaderValidation>(validate_header(decode_header(buf), cap),
                                HeaderValidation::kBadHeaderCrc,
                                "rejects header whose CRC no longer matches");
  }
}

// ---------------------------------------------------------------------
// commit_marker -- separate from header_crc32
// ---------------------------------------------------------------------
static void test_commit_marker_independent_of_header_crc() {
  SnapshotHeader h = make_valid_header();
  uint8_t buf[kHeaderSize];
  encode_header(h, buf);
  check_eq<uint32_t>(read_commit_marker(buf), 0u,
                      "commit marker starts zero-padded (uncommitted-ish) right after encode_header");

  write_commit_marker(buf, kCommitMarkerUncommitted);
  check_eq<uint32_t>(read_commit_marker(buf), kCommitMarkerUncommitted,
                      "commit marker reads back UNCOMMITTED");
  // Header must still validate -- flipping the marker must NOT affect
  // header_crc32 (the whole point of excluding it from that CRC).
  check_eq<HeaderValidation>(validate_header(decode_header(buf), 3600), HeaderValidation::kOk,
                              "header still valid with UNCOMMITTED marker");

  write_commit_marker(buf, kCommitMarkerCommitted);
  check_eq<uint32_t>(read_commit_marker(buf), kCommitMarkerCommitted,
                      "commit marker reads back COMMITTED");
  check_eq<HeaderValidation>(validate_header(decode_header(buf), 3600), HeaderValidation::kOk,
                              "header still valid with COMMITTED marker (CRC unaffected by marker flip)");

  // Garbage marker (simulated torn write) must not equal either sentinel.
  write_commit_marker(buf, 0x12345678u);
  check(read_commit_marker(buf) != kCommitMarkerCommitted &&
            read_commit_marker(buf) != kCommitMarkerUncommitted,
        "garbage marker value is neither known sentinel (torn write is detectable)");
}

// ---------------------------------------------------------------------
// A/B sequence comparison (wraparound-safe) and slot selection
// ---------------------------------------------------------------------
static void test_sequence_wraparound() {
  check(sequence_is_newer(5, 3), "5 is newer than 3");
  check(!sequence_is_newer(3, 5), "3 is not newer than 5");
  check(!sequence_is_newer(5, 5), "5 is not newer than itself");
  // Wraparound: a sequence that just wrapped past UINT32_MAX (now small)
  // is still correctly "newer" than a large pre-wrap value.
  check(sequence_is_newer(1, 0xFFFFFFFFu), "1 is newer than 0xFFFFFFFF (wraparound)");
  check(!sequence_is_newer(0xFFFFFFFFu, 1), "0xFFFFFFFF is not newer than 1 (wraparound)");
}

static void test_choose_newer_valid() {
  check_eq<SlotChoice>(choose_newer_valid(false, 0, false, 0), SlotChoice::kNone,
                        "neither valid -> kNone");
  check_eq<SlotChoice>(choose_newer_valid(true, 5, false, 0), SlotChoice::kA,
                        "only A valid -> kA");
  check_eq<SlotChoice>(choose_newer_valid(false, 0, true, 5), SlotChoice::kB,
                        "only B valid -> kB");
  check_eq<SlotChoice>(choose_newer_valid(true, 10, true, 5), SlotChoice::kA,
                        "both valid, A has higher sequence -> kA");
  check_eq<SlotChoice>(choose_newer_valid(true, 5, true, 10), SlotChoice::kB,
                        "both valid, B has higher sequence -> kB");
  // Wraparound case: A just wrapped to a small number, B is the old large one.
  check_eq<SlotChoice>(choose_newer_valid(true, 2, true, 0xFFFFFFF0u), SlotChoice::kA,
                        "both valid, A wrapped past B -> kA (wraparound-safe)");
}

static void test_choose_checkpoint_target() {
  check_eq<SlotChoice>(choose_checkpoint_target(false, 0, false, 0), SlotChoice::kA,
                        "neither valid -> target A (spec: 'if none valid -> A')");
  check_eq<SlotChoice>(choose_checkpoint_target(true, 5, false, 0), SlotChoice::kB,
                        "only A valid -> target B (the invalid one)");
  check_eq<SlotChoice>(choose_checkpoint_target(false, 0, true, 5), SlotChoice::kA,
                        "only B valid -> target A (the invalid one)");
  check_eq<SlotChoice>(choose_checkpoint_target(true, 10, true, 5), SlotChoice::kB,
                        "both valid, A newer -> target B (the OLDER one)");
  check_eq<SlotChoice>(choose_checkpoint_target(true, 5, true, 10), SlotChoice::kA,
                        "both valid, B newer -> target A (the OLDER one)");
  // Never targets the sole valid slot.
  check_eq<SlotChoice>(choose_checkpoint_target(true, 1, false, 0), SlotChoice::kB,
                        "single valid slot (A) is never the target");
}

// ---------------------------------------------------------------------
// Timestamp / Offline-gap reconciliation -- every boundary the task named.
// ---------------------------------------------------------------------
static void test_gap_boundaries() {
  const uint32_t interval = 60;
  const uint32_t capacity = 3600;
  const int64_t base = 1000000000;  // arbitrary fixed "newest_timestamp"

  struct Case { int64_t offset_s; GapAction expect_action; uint32_t expect_missed; const char *desc; };
  const Case cases[] = {
      {0, GapAction::kNone, 0, "gap = 0s -> no gap"},
      {30, GapAction::kNone, 0, "gap = 30s -> no gap (< 1 interval)"},
      {59, GapAction::kNone, 0, "gap = 59s -> no gap (< 1 interval)"},
      {60, GapAction::kInsertGap, 1, "gap = 60s -> exactly 1 missed interval"},
      {61, GapAction::kInsertGap, 1, "gap = 61s -> still 1 missed interval (floor)"},
      {299, GapAction::kInsertGap, 4, "gap = 299s -> 4 missed intervals (floor(299/60))"},
      {300, GapAction::kInsertGap, 5, "gap = 300s -> exactly 5 missed intervals"},
      {301, GapAction::kInsertGap, 5, "gap = 301s -> still 5 missed intervals (floor)"},
      {4 * 3600, GapAction::kInsertGap, 240, "gap = 4h -> 240 missed intervals"},
      {60 * 3600, GapAction::kDiscard, 0, "gap = exactly 60h -> discard (missed == capacity)"},
      {60 * 3600 + 60, GapAction::kDiscard, 0, "gap = 60h + 1min -> discard"},
      {200 * 3600, GapAction::kDiscard, 0, "gap = 200h -> discard"},
  };
  for (const auto &c : cases) {
    const GapResult r = compute_gap(/*now_unix_valid=*/true, base + c.offset_s, base, interval,
                                     capacity);
    check_eq<GapAction>(r.action, c.expect_action, c.desc);
    if (c.expect_action == GapAction::kInsertGap) {
      check_eq<uint32_t>(r.missed_intervals, c.expect_missed, c.desc);
    }
  }
}

static void test_gap_clock_backwards() {
  const int64_t base = 1000000000;
  // Small backward jitter (within tolerance) -> treated as "no gap", not
  // an error -- ordinary NTP correction noise.
  {
    const GapResult r = compute_gap(true, base - 2, base, 60, 3600, /*max_backward_skew_s=*/5);
    check_eq<GapAction>(r.action, GapAction::kNone, "small backward jitter (-2s, tol=5s) -> kNone");
  }
  // Large backward jump (clock genuinely moved backwards) -> hold, never
  // fabricate/insert anything.
  {
    const GapResult r = compute_gap(true, base - 3600, base, 60, 3600, /*max_backward_skew_s=*/5);
    check_eq<GapAction>(r.action, GapAction::kHold, "clock moved back 1h -> kHold (never fabricate)");
  }
}

static void test_gap_no_wall_clock_yet() {
  const int64_t base = 1000000000;
  const GapResult r = compute_gap(/*now_unix_valid=*/false, base + 100, base, 60, 3600);
  check_eq<GapAction>(r.action, GapAction::kHold,
                       "no valid wall clock yet -> kHold regardless of the (meaningless) now value");
}

static void test_gap_empty_history() {
  // newest_timestamp == 0 means "never stored a sample" -- nothing to
  // reconcile, proceed normally (covers first-ever boot with no restored
  // snapshot at all, and the "live sample obtained before time sync"
  // scenario where no persistent anchor exists yet either).
  const GapResult r = compute_gap(true, 1000000000, /*newest_timestamp=*/0, 60, 3600);
  check_eq<GapAction>(r.action, GapAction::kNone, "newest_timestamp == 0 (empty history) -> kNone");
}

static void test_gap_multiple_reboots_idempotent() {
  // Simulates: reboot #1 leaves newest_timestamp = base after inserting a
  // gap and resuming; reboot #2 happens 5 minutes later. The algorithm is
  // re-run fresh each boot against whatever newest_timestamp is now,
  // with no special-casing needed for "this ring already has a gap in it".
  const int64_t base = 1000000000;
  const int64_t after_first_reboot_resume = base + 120;  // 2 missed intervals were inserted, then resumed
  const GapResult r2 = compute_gap(true, after_first_reboot_resume + 300, after_first_reboot_resume,
                                    60, 3600);
  check_eq<GapAction>(r2.action, GapAction::kInsertGap, "second reboot 5 min later -> insert gap again");
  check_eq<uint32_t>(r2.missed_intervals, 5, "second reboot -> 5 missed intervals, independent of the first gap");
}

int main() {
  test_le_roundtrip();
  test_crc32_known_answer();
  test_crc32_streaming_matches_oneshot();
  test_crc32_detects_corruption();
  test_record_roundtrip();
  test_header_roundtrip_and_size();
  test_header_validation_order();
  test_commit_marker_independent_of_header_crc();
  test_sequence_wraparound();
  test_choose_newer_valid();
  test_choose_checkpoint_target();
  test_gap_boundaries();
  test_gap_clock_backwards();
  test_gap_no_wall_clock_yet();
  test_gap_empty_history();
  test_gap_multiple_reboots_idempotent();

  std::printf("\n%d checks run, %d failed.\n", g_checks, g_failures);
  return g_failures == 0 ? 0 : 1;
}
