#include "jk_history_format.h"

namespace jk_history_format {

// ---------------------------------------------------------------------
// Little-endian primitives
// ---------------------------------------------------------------------
void put_u16le(std::vector<uint8_t> &out, uint16_t v) {
  out.push_back(static_cast<uint8_t>(v & 0xFF));
  out.push_back(static_cast<uint8_t>((v >> 8) & 0xFF));
}
void put_u32le(std::vector<uint8_t> &out, uint32_t v) {
  out.push_back(static_cast<uint8_t>(v & 0xFF));
  out.push_back(static_cast<uint8_t>((v >> 8) & 0xFF));
  out.push_back(static_cast<uint8_t>((v >> 16) & 0xFF));
  out.push_back(static_cast<uint8_t>((v >> 24) & 0xFF));
}
void put_u64le(std::vector<uint8_t> &out, uint64_t v) {
  for (int i = 0; i < 8; i++) out.push_back(static_cast<uint8_t>((v >> (8 * i)) & 0xFF));
}
uint16_t get_u16le(const uint8_t *p) {
  return static_cast<uint16_t>(p[0]) | (static_cast<uint16_t>(p[1]) << 8);
}
uint32_t get_u32le(const uint8_t *p) {
  return static_cast<uint32_t>(p[0]) | (static_cast<uint32_t>(p[1]) << 8) |
         (static_cast<uint32_t>(p[2]) << 16) | (static_cast<uint32_t>(p[3]) << 24);
}
uint64_t get_u64le(const uint8_t *p) {
  uint64_t v = 0;
  for (int i = 0; i < 8; i++) v |= static_cast<uint64_t>(p[i]) << (8 * i);
  return v;
}

// ---------------------------------------------------------------------
// CRC32 -- standard reflected IEEE 802.3 table, generated at namespace-
// init time (no 1KB const table baked into flash; this runs once and the
// table is tiny -- 256 uint32_t = 1KB of RAM, freed never needed since
// it's a static local, acceptable for a feature that runs a handful of
// times per hour).
// ---------------------------------------------------------------------
namespace {
const uint32_t *crc_table() {
  static uint32_t table[256];
  static bool built = false;
  if (!built) {
    for (uint32_t i = 0; i < 256; i++) {
      uint32_t c = i;
      for (int k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320u ^ (c >> 1)) : (c >> 1);
      table[i] = c;
    }
    built = true;
  }
  return table;
}
}  // namespace

uint32_t crc32_init() { return 0xFFFFFFFFu; }

uint32_t crc32_update(uint32_t crc, const uint8_t *data, size_t len) {
  const uint32_t *table = crc_table();
  for (size_t i = 0; i < len; i++) crc = table[(crc ^ data[i]) & 0xFFu] ^ (crc >> 8);
  return crc;
}

uint32_t crc32_finish(uint32_t crc) { return crc ^ 0xFFFFFFFFu; }

uint32_t crc32_of(const uint8_t *data, size_t len) {
  return crc32_finish(crc32_update(crc32_init(), data, len));
}

// ---------------------------------------------------------------------
// Record encode/decode
// ---------------------------------------------------------------------
void encode_record(int16_t voltage_cv, uint8_t stage, uint8_t out[3]) {
  const uint16_t bits = static_cast<uint16_t>(voltage_cv);  // two's-complement bit pattern
  out[0] = static_cast<uint8_t>(bits & 0xFF);
  out[1] = static_cast<uint8_t>((bits >> 8) & 0xFF);
  out[2] = stage;
}

void decode_record(const uint8_t in[3], int16_t &voltage_cv, uint8_t &stage) {
  const uint16_t bits = static_cast<uint16_t>(in[0]) | (static_cast<uint16_t>(in[1]) << 8);
  voltage_cv = static_cast<int16_t>(bits);  // round-trips correctly: same two's-complement width
  stage = in[2];
}

// ---------------------------------------------------------------------
// Header encode/decode
// ---------------------------------------------------------------------

namespace {
// Serializes fields magic..flags only (12 fields, 42 bytes) -- the region
// header_crc32 itself protects. Shared by encode_header() (to compute the
// CRC before appending it) and by nothing else, kept private to this file.
void append_crc_covered_fields(std::vector<uint8_t> &buf, const SnapshotHeader &h) {
  put_u32le(buf, h.magic);
  put_u16le(buf, h.schema_version);
  put_u16le(buf, h.header_size);
  put_u16le(buf, h.record_size);
  put_u32le(buf, h.sample_interval_s);
  put_u32le(buf, h.capacity);
  put_u32le(buf, h.valid_count);
  put_u32le(buf, h.write_index);
  put_u32le(buf, h.sequence);
  put_u64le(buf, h.newest_timestamp);
  put_u32le(buf, h.payload_length);
  put_u32le(buf, h.flags);
}
}  // namespace

void encode_header(SnapshotHeader h, uint8_t *out) {
  std::vector<uint8_t> buf;
  buf.reserve(kHeaderSize);
  append_crc_covered_fields(buf, h);
  const uint32_t computed_crc = crc32_of(buf.data(), buf.size());
  put_u32le(buf, computed_crc);
  put_u32le(buf, h.payload_crc32);
  // buf is now 42 (crc-covered fields) + 4 (header_crc32) + 4 (payload_crc32)
  // = 50 bytes. The remaining 8 bytes up to kHeaderSize (58) are the
  // commit_marker field, deliberately NOT written here -- see
  // write_commit_marker(). We zero-pad them so encode_header() always
  // produces a fully-defined kHeaderSize-byte block even before a marker
  // is written (avoids leaving uninitialized bytes on disk).
  while (buf.size() < kHeaderSize) buf.push_back(0);
  for (uint16_t i = 0; i < kHeaderSize; i++) out[i] = buf[i];
}

SnapshotHeader decode_header(const uint8_t *in) {
  SnapshotHeader h;
  size_t off = 0;
  h.magic = get_u32le(in + off); off += 4;
  h.schema_version = get_u16le(in + off); off += 2;
  h.header_size = get_u16le(in + off); off += 2;
  h.record_size = get_u16le(in + off); off += 2;
  h.sample_interval_s = get_u32le(in + off); off += 4;
  h.capacity = get_u32le(in + off); off += 4;
  h.valid_count = get_u32le(in + off); off += 4;
  h.write_index = get_u32le(in + off); off += 4;
  h.sequence = get_u32le(in + off); off += 4;
  h.newest_timestamp = get_u64le(in + off); off += 8;
  h.payload_length = get_u32le(in + off); off += 4;
  h.flags = get_u32le(in + off); off += 4;
  h.header_crc32 = get_u32le(in + off); off += 4;
  h.payload_crc32 = get_u32le(in + off); off += 4;
  // off == 50 here; the remaining 8 bytes (up to kHeaderSize) are the
  // commit_marker region, read separately via read_commit_marker().
  return h;
}

void write_commit_marker(uint8_t *header_bytes, uint32_t marker) {
  // The marker occupies the FIRST 4 bytes of the trailing padding region
  // (offset 50..53), i.e. immediately after payload_crc32. The remaining
  // 4 bytes (54..57) stay reserved/zero for future use.
  header_bytes[50] = static_cast<uint8_t>(marker & 0xFF);
  header_bytes[51] = static_cast<uint8_t>((marker >> 8) & 0xFF);
  header_bytes[52] = static_cast<uint8_t>((marker >> 16) & 0xFF);
  header_bytes[53] = static_cast<uint8_t>((marker >> 24) & 0xFF);
}

uint32_t read_commit_marker(const uint8_t *header_bytes) {
  return get_u32le(header_bytes + 50);
}

// ---------------------------------------------------------------------
// Header validation
// ---------------------------------------------------------------------
HeaderValidation validate_header(const SnapshotHeader &h, uint32_t expected_capacity) {
  if (h.magic != kMagic) return HeaderValidation::kBadMagic;
  if (h.schema_version != kSchemaVersion) return HeaderValidation::kBadSchemaVersion;
  if (h.header_size != kHeaderSize) return HeaderValidation::kBadHeaderSize;
  if (h.record_size != kRecordSize) return HeaderValidation::kBadRecordSize;
  if (h.capacity == 0 || h.capacity != expected_capacity) return HeaderValidation::kBadCapacity;
  // Overflow-safe: capacity is a uint32_t bounded by expected_capacity
  // (a small compile-time constant, 3600 today), and record_size is a
  // uint16_t constant (3) -- their product cannot overflow a uint32_t
  // for any realistic capacity, but the multiplication is still done in
  // a wide-enough type deliberately rather than assumed safe.
  const uint64_t expected_payload_length =
      static_cast<uint64_t>(h.record_size) * static_cast<uint64_t>(h.capacity);
  if (static_cast<uint64_t>(h.payload_length) != expected_payload_length) {
    return HeaderValidation::kBadPayloadLength;
  }
  if (h.valid_count > h.capacity) return HeaderValidation::kValidCountExceedsCapacity;
  if (h.write_index >= h.capacity) return HeaderValidation::kWriteIndexOutOfRange;

  std::vector<uint8_t> buf;
  buf.reserve(kHeaderSize);
  append_crc_covered_fields(buf, h);
  const uint32_t computed_crc = crc32_of(buf.data(), buf.size());
  if (computed_crc != h.header_crc32) return HeaderValidation::kBadHeaderCrc;

  return HeaderValidation::kOk;
}

const char *header_validation_name(HeaderValidation v) {
  switch (v) {
    case HeaderValidation::kOk: return "OK";
    case HeaderValidation::kBadMagic: return "BAD_MAGIC";
    case HeaderValidation::kBadSchemaVersion: return "BAD_SCHEMA_VERSION";
    case HeaderValidation::kBadHeaderSize: return "BAD_HEADER_SIZE";
    case HeaderValidation::kBadRecordSize: return "BAD_RECORD_SIZE";
    case HeaderValidation::kBadPayloadLength: return "BAD_PAYLOAD_LENGTH";
    case HeaderValidation::kBadCapacity: return "BAD_CAPACITY";
    case HeaderValidation::kValidCountExceedsCapacity: return "VALID_COUNT_EXCEEDS_CAPACITY";
    case HeaderValidation::kWriteIndexOutOfRange: return "WRITE_INDEX_OUT_OF_RANGE";
    case HeaderValidation::kBadHeaderCrc: return "BAD_HEADER_CRC";
  }
  return "UNKNOWN";
}

// ---------------------------------------------------------------------
// A/B slot selection
// ---------------------------------------------------------------------
bool sequence_is_newer(uint32_t a, uint32_t b) {
  // "Serial number arithmetic" (RFC 1982-style): interpret the difference
  // as a signed 32-bit value. Correct for any pair of sequence numbers
  // less than 2^31 apart -- true for the life of this device at any
  // realistic checkpoint cadence (a 30-minute cadence would need ~122,000
  // years to accumulate a 2^31 gap between two numbers being compared).
  return static_cast<int32_t>(a - b) > 0;
}

SlotChoice choose_newer_valid(bool a_fully_valid, uint32_t a_sequence, bool b_fully_valid,
                               uint32_t b_sequence) {
  if (!a_fully_valid && !b_fully_valid) return SlotChoice::kNone;
  if (a_fully_valid && !b_fully_valid) return SlotChoice::kA;
  if (!a_fully_valid && b_fully_valid) return SlotChoice::kB;
  // Both valid -- higher (wraparound-safe) sequence wins.
  return sequence_is_newer(a_sequence, b_sequence) ? SlotChoice::kA : SlotChoice::kB;
}

SlotChoice choose_checkpoint_target(bool a_fully_valid, uint32_t a_sequence, bool b_fully_valid,
                                     uint32_t b_sequence) {
  if (a_fully_valid && b_fully_valid) {
    // Target the OLDER of the two valid slots -- never touch the newer
    // one, which stays the fallback if this write is interrupted.
    return sequence_is_newer(a_sequence, b_sequence) ? SlotChoice::kB : SlotChoice::kA;
  }
  if (a_fully_valid && !b_fully_valid) return SlotChoice::kB;  // overwrite the invalid one
  if (!a_fully_valid && b_fully_valid) return SlotChoice::kA;
  return SlotChoice::kA;  // neither valid -- A by convention
}

// ---------------------------------------------------------------------
// Timestamp / Offline-gap reconciliation
// ---------------------------------------------------------------------
GapResult compute_gap(bool now_unix_valid, int64_t now_unix, int64_t newest_timestamp,
                       uint32_t sample_interval_s, uint32_t capacity,
                       int64_t max_backward_skew_s) {
  GapResult result;
  if (!now_unix_valid) {
    result.action = GapAction::kHold;
    return result;
  }
  // newest_timestamp == 0 means "no prior sample was ever stored" (empty
  // history, e.g. very first boot) -- nothing to reconcile against.
  if (newest_timestamp == 0) {
    result.action = GapAction::kNone;
    return result;
  }
  const int64_t gap_seconds = now_unix - newest_timestamp;
  if (gap_seconds < -max_backward_skew_s) {
    // Clock appears to have moved backwards beyond ordinary jitter --
    // never fabricate samples against an untrustworthy reading.
    result.action = GapAction::kHold;
    return result;
  }
  if (gap_seconds < 0) {
    // Within the small allowed backward-skew tolerance (ordinary NTP
    // jitter) -- treat as "no meaningful gap", same as gap_seconds == 0.
    result.action = GapAction::kNone;
    return result;
  }
  const uint32_t missed_intervals =
      static_cast<uint32_t>(gap_seconds / static_cast<int64_t>(sample_interval_s));
  if (missed_intervals == 0) {
    result.action = GapAction::kNone;
    return result;
  }
  if (missed_intervals >= capacity) {
    result.action = GapAction::kDiscard;
    return result;
  }
  result.action = GapAction::kInsertGap;
  result.missed_intervals = missed_intervals;
  return result;
}

}  // namespace jk_history_format
