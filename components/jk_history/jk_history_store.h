// jk_history_store.h
//
// ESP-IDF-specific filesystem lifecycle for the 60-hour Charge History
// A/B snapshot. Everything that can be, is delegated to the pure,
// desktop-unit-tested jk_history_format.{h,cpp} module (binary format,
// CRC32, header validation, A/B slot selection, timestamp reconciliation)
// -- this file only owns: mounting LittleFS, and the streamed read/write
// I/O sequence described in the project's A/B commit protocol.
//
// This header (and its .cpp) is ESP-IDF specific (uses esp_vfs_littlefs.h,
// <stdio.h> POSIX file I/O against the mounted /littlefs path) and is NOT
// part of the desktop-testable unit test suite -- see
// test/jk_history/test_jk_history_format.cpp for what IS host-tested.

#pragma once

#include <functional>
#include <string>

#include "esphome/core/component.h"
#include "jk_history_format.h"

namespace esphome {
namespace jk_history {

using jk_history_format::GapResult;
using jk_history_format::SnapshotHeader;

// Streams one record at a time so a checkpoint write never needs a large
// (~10.8KB) in-RAM buffer -- see the project's explicit "no large
// serialization buffer" requirement. Called once per ring slot, in
// chronological order (oldest first), i == 0..valid_count-1.
using RecordSource = std::function<void(uint32_t i, int16_t &voltage_cv, uint8_t &stage)>;

// Called once per restored record, in the same chronological order they
// were written -- the caller is responsible for placing each one into the
// live RAM ring buffer at the right index.
using RecordSink = std::function<void(uint32_t i, int16_t voltage_cv, uint8_t stage)>;

class JkHistoryStore : public Component {
 public:
  void set_mount_point(const std::string &mount_point) { mount_point_ = mount_point; }
  void set_partition_label(const std::string &label) { partition_label_ = label; }
  void set_expected_capacity(uint32_t capacity) { expected_capacity_ = capacity; }
  void set_sample_interval_s(uint32_t interval_s) { sample_interval_s_ = interval_s; }

  void setup() override;
  float get_setup_priority() const override { return setup_priority::LATE; }

  // Boot-time restore (spec: "Повністю validate A. Повністю validate B.
  // Вибрати новіший лише серед повністю валідних committed slots."). On
  // success, calls `sink` once per restored record (in chronological
  // order) and fills the three out-params from the winning header.
  // Returns false (out-params left at 0/empty) if neither slot is fully
  // valid -- callers should then start with an empty ring, not treat this
  // as a fatal error.
  bool restore(uint32_t &out_valid_count, uint32_t &out_write_index,
               uint64_t &out_newest_timestamp, const RecordSink &sink);

  // Full A/B checkpoint sequence per the project's commit protocol:
  //   1. fully (re)validate both slots
  //   2. pick the checkpoint TARGET (never the sole valid slot)
  //   3. write header (commit_marker = UNCOMMITTED) + streamed payload
  //   4. fsync + close
  //   5. re-open target, fully re-read + re-validate (header CRC AND
  //      payload CRC) from what is actually on flash
  //   6. only if that re-read validates: flip commit_marker to COMMITTED
  //      (a small write at a fixed offset within the already-written
  //      header block -- NOT a claim that the underlying filesystem/flash
  //      operation this becomes is atomic; see the .cpp comment on this
  //      step for exactly what is and isn't guaranteed)
  //   7. fsync + close again
  //   8. re-open once more and confirm the committed state reads back
  //      correctly
  // The previously-valid slot (the one NOT targeted) is never opened for
  // writing at any point in this sequence.
  bool checkpoint(uint32_t valid_count, uint32_t write_index, uint64_t newest_timestamp,
                  const RecordSource &source);

  const char *last_error() const { return last_error_.c_str(); }

 protected:
  std::string mount_point_{"/littlefs"};
  std::string partition_label_{"littlefs"};
  uint32_t expected_capacity_{3600};
  uint32_t sample_interval_s_{60};
  bool mounted_{false};
  std::string last_error_;

  std::string slot_path_(char slot) const;  // slot 'a' or 'b'

  // Fully validates one slot: opens it, reads+checks the header (all
  // jk_history_format::validate_header() checks), reads the commit marker,
  // streams the payload while accumulating CRC32, and compares against
  // payload_crc32. Returns true only if EVERY one of those passes --
  // never just the 58-byte header, per the project's explicit
  // requirement. On success, `out_header` holds the decoded header.
  bool fully_validate_slot_(char slot, SnapshotHeader &out_header);
};

}  // namespace jk_history
}  // namespace esphome
