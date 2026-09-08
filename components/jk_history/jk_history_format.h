// jk_history_format.h
//
// Pure, dependency-free binary-format / CRC32 / A-B-selection / timestamp-
// reconciliation logic for the 60-hour Charge History persistence feature.
//
// Deliberately has ZERO ESP-IDF / Arduino / ESPHome includes so it compiles
// and can be unit-tested with a plain desktop g++/clang++ (see
// test/jk_history/test_jk_history_format.cpp) as well as inside the real
// firmware build. All multi-byte fields are read/written explicitly in
// little-endian, byte by byte -- never via a native C++ struct layout,
// padding, bit-fields, bool, or reinterpret_cast of the whole header/record.
//
// Record format (payload): 3 bytes, per sample.
//   byte 0: voltage_cv low byte     (int16_t voltage_cv, little-endian)
//   byte 1: voltage_cv high byte
//   byte 2: stage                   (uint8_t)
//
// Header format: 58 bytes, little-endian, field order exactly as declared
// in SnapshotHeader below. commit_marker is the last field and is
// deliberately EXCLUDED from header_crc32 (header_crc32 covers magic
// through flags only) -- see the comment on commit_marker for why, and
// how its own (much simpler) validity check works instead.

#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

namespace jk_history_format {

// ---------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------

constexpr uint32_t kMagic = 0x4A4B4248u;  // "JKBH" as a little-endian u32
constexpr uint16_t kSchemaVersion = 1;    // Variant B: voltage_cv + stage only
constexpr uint16_t kHeaderSize = 58;
constexpr uint16_t kRecordSize = 3;

// commit_marker sentinel values -- anything else observed on disk (e.g.
// a torn write leaving partial/garbage bytes) is treated as UNCOMMITTED,
// never as a third state.
constexpr uint32_t kCommitMarkerUncommitted = 0xFFFFFFFFu;
constexpr uint32_t kCommitMarkerCommitted = 0x434F4D4Du;  // "COMM"

// Sentinels shared with the existing live RAM buffers (cc_hist_voltage_cv /
// cc_hist_stage in batterylifepo4.yaml) -- the on-flash format reuses them
// unchanged so restored records need no translation step.
constexpr int16_t kVoltageNoSample = INT16_MIN;
constexpr uint8_t kStageOffline = 5;

// ---------------------------------------------------------------------
// In-RAM convenience header struct.
//
// This struct is NEVER serialized via sizeof()/memcpy()/reinterpret_cast --
// encode_header()/decode_header() below read and write every field
// individually, in the declared order, in explicit little-endian. Any
// compiler padding this struct happens to have is therefore irrelevant to
// the wire format; it exists purely so call sites don't have to carry 15
// loose local variables around.
// ---------------------------------------------------------------------
struct SnapshotHeader {
  uint32_t magic = kMagic;
  uint16_t schema_version = kSchemaVersion;
  uint16_t header_size = kHeaderSize;
  uint16_t record_size = kRecordSize;
  uint32_t sample_interval_s = 60;
  uint32_t capacity = 3600;
  uint32_t valid_count = 0;
  uint32_t write_index = 0;
  uint32_t sequence = 0;
  uint64_t newest_timestamp = 0;  // Unix seconds, 0 = unknown/never set
  uint32_t payload_length = 0;    // must equal record_size * capacity
  uint32_t flags = 0;             // reserved, all bits 0 in schema v1
  uint32_t header_crc32 = 0;      // CRC32 over magic..flags (this struct's
                                   // first 12 fields, in wire order)
  uint32_t payload_crc32 = 0;     // CRC32 over the payload bytes
  // commit_marker is NOT part of this struct -- see write_commit_marker()/
  // read_commit_marker() below. It occupies the header's final 4 bytes on
  // disk but is handled as its own tiny, separately-validated field so a
  // commit-marker flip never requires recomputing header_crc32 (which
  // covers everything BEFORE it). This is a deliberate, singular policy,
  // not left ambiguous: header_crc32 protects fields 1-12 only; the
  // commit marker protects itself, by only ever being one of two known
  // 4-byte sentinels -- any other byte pattern (torn-write garbage) reads
  // as UNCOMMITTED, which is exactly the safe/reject outcome wanted.
};

// ---------------------------------------------------------------------
// Little-endian primitive helpers (manual, no reinterpret_cast).
// ---------------------------------------------------------------------
void put_u16le(std::vector<uint8_t> &out, uint16_t v);
void put_u32le(std::vector<uint8_t> &out, uint32_t v);
void put_u64le(std::vector<uint8_t> &out, uint64_t v);
uint16_t get_u16le(const uint8_t *p);
uint32_t get_u32le(const uint8_t *p);
uint64_t get_u64le(const uint8_t *p);

// ---------------------------------------------------------------------
// CRC32 (IEEE 802.3 polynomial 0xEDB88320, init 0xFFFFFFFF, final XOR
// 0xFFFFFFFF -- the same convention zlib/most tools use). crc32_update()
// lets a caller accumulate a CRC across many small chunks (the streamed
// write path never holds the full ~10.8KB payload in RAM at once) without
// re-scanning from the start each time.
// ---------------------------------------------------------------------
uint32_t crc32_init();
uint32_t crc32_update(uint32_t crc, const uint8_t *data, size_t len);
uint32_t crc32_finish(uint32_t crc);
uint32_t crc32_of(const uint8_t *data, size_t len);  // one-shot convenience

// ---------------------------------------------------------------------
// Record (payload) encode/decode -- exactly 3 bytes, manual little-endian.
// ---------------------------------------------------------------------
void encode_record(int16_t voltage_cv, uint8_t stage, uint8_t out[3]);
void decode_record(const uint8_t in[3], int16_t &voltage_cv, uint8_t &stage);

// ---------------------------------------------------------------------
// Header encode/decode.
// ---------------------------------------------------------------------
// Writes exactly kHeaderSize bytes (magic..flags, header_crc32,
// payload_crc32 -- 54 bytes of header fields) to out; out must have room
// for kHeaderSize bytes. header_crc32 in `h` is IGNORED and recomputed
// here from the other fields, so callers never have to keep it in sync by
// hand. The commit marker is NOT written by this function -- see
// write_commit_marker().
void encode_header(SnapshotHeader h, uint8_t *out);

// Reads kHeaderSize bytes into a SnapshotHeader. Does not validate
// anything -- see validate_header() for that. Safe to call on arbitrary
// (including garbage/erased-flash) bytes.
SnapshotHeader decode_header(const uint8_t *in);

// commit_marker occupies the last 4 bytes of the on-disk header region
// (offset kHeaderSize - 4 .. kHeaderSize - 1), written/read separately
// from encode_header()/decode_header() per the policy above.
void write_commit_marker(uint8_t *header_bytes, uint32_t marker);
uint32_t read_commit_marker(const uint8_t *header_bytes);

// ---------------------------------------------------------------------
// Header validation -- the exact, ordered set of checks required before
// anything else is trusted. Returns the first failing reason, or kOk if
// every check (including header_crc32) passes. Does NOT check
// payload_crc32 or commit_marker -- callers check those separately, only
// once this returns kOk (payload_crc32 requires the payload bytes, which
// aren't available yet at header-validation time in the streamed-read
// path; commit_marker is a separate, orthogonal concept from header
// validity per the policy above).
// ---------------------------------------------------------------------
enum class HeaderValidation {
  kOk = 0,
  kBadMagic,
  kBadSchemaVersion,
  kBadHeaderSize,
  kBadRecordSize,
  kBadPayloadLength,   // payload_length != record_size * capacity
  kBadCapacity,        // capacity == 0, or doesn't match the compiled-in ring size
  kValidCountExceedsCapacity,
  kWriteIndexOutOfRange,
  kBadHeaderCrc,
};

// expected_capacity: the firmware's own compiled-in ring capacity (3600
// today) -- a restored header whose capacity field doesn't match is
// rejected rather than guessed at, per schema-versioning discipline (a
// future schema version would carry its own expected_capacity handling,
// not silently reinterpret an old one).
HeaderValidation validate_header(const SnapshotHeader &h, uint32_t expected_capacity);

const char *header_validation_name(HeaderValidation v);  // for logging

// ---------------------------------------------------------------------
// A/B slot selection -- wraparound-safe sequence comparison.
// ---------------------------------------------------------------------

// True if `a` is strictly newer than `b`, treating sequence as a uint32_t
// that may wrap (comparison via signed difference, matching the standard
// "serial number arithmetic" pattern -- correct as long as the two
// sequence numbers are never more than 2^31 apart, true for any realistic
// checkpoint cadence for the life of the device).
bool sequence_is_newer(uint32_t a, uint32_t b);

enum class SlotChoice { kNone, kA, kB };

// Boot-time / pre-checkpoint slot selection. Pass whether each slot's
// header validated AND its commit_marker == committed AND (for boot-time
// use) its payload_crc32 matched -- i.e. "fully valid" per the spec, not
// just header-valid. Returns which slot is authoritative (kNone if
// neither is fully valid).
SlotChoice choose_newer_valid(bool a_fully_valid, uint32_t a_sequence,
                               bool b_fully_valid, uint32_t b_sequence);

// Pre-checkpoint TARGET selection (spec step 6): "if both valid -> older;
// if only one valid -> the invalid one; if neither valid -> A." This is
// deliberately a different rule from choose_newer_valid() above (which
// picks the slot to READ FROM); this picks the slot to WRITE TO.
SlotChoice choose_checkpoint_target(bool a_fully_valid, uint32_t a_sequence,
                                     bool b_fully_valid, uint32_t b_sequence);

// ---------------------------------------------------------------------
// Timestamp / Offline-gap reconciliation.
// ---------------------------------------------------------------------

enum class GapAction {
  kNone,        // reboot was faster than one sample interval -- resume immediately
  kInsertGap,   // insert `missed_intervals` Offline samples, then resume
  kDiscard,     // downtime >= capacity * interval -- start a fresh empty ring
  kHold,        // clock not trustworthy yet (negative/implausible gap) --
                // do not touch history, do not write a new persistent
                // snapshot, but keep sampling live telemetry independently
};

struct GapResult {
  GapAction action = GapAction::kHold;
  uint32_t missed_intervals = 0;
};

// now_unix / newest_timestamp: Unix seconds. now_unix_valid: whether the
// caller currently has a trustworthy wall clock at all (SNTP/HA/time:
// not yet synced => false, and this function returns kHold without even
// looking at the timestamps). max_backward_skew_s: how far `now` is
// allowed to appear to be BEFORE newest_timestamp before it's treated as
// an implausible/backwards-clock reading rather than ordinary NTP jitter
// (recommended: a few seconds, e.g. 5s -- see the unit tests for the
// exact boundary this project uses).
GapResult compute_gap(bool now_unix_valid, int64_t now_unix, int64_t newest_timestamp,
                       uint32_t sample_interval_s, uint32_t capacity,
                       int64_t max_backward_skew_s = 5);

}  // namespace jk_history_format
