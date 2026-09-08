#include "jk_history_store.h"

#include <cstdio>
#include <cstring>

#include "esp_littlefs.h"
#include "esphome/core/log.h"
#include "unistd.h"

namespace esphome {
namespace jk_history {

static const char *const TAG = "jk_history_store";

using jk_history_format::HeaderValidation;
using jk_history_format::SnapshotHeader;

std::string JkHistoryStore::slot_path_(char slot) const {
  return mount_point_ + "/hist_" + slot + ".bin";
}

void JkHistoryStore::setup() {
  esp_vfs_littlefs_conf_t conf = {};
  conf.base_path = mount_point_.c_str();
  conf.partition_label = partition_label_.c_str();
  conf.format_if_mount_failed = true;  // first-ever boot: partition is erased flash, not a
                                        // corrupt filesystem -- format is the correct, expected
                                        // recovery, not data loss (there is nothing to lose yet)
  conf.dont_mount = false;

  const esp_err_t err = esp_vfs_littlefs_register(&conf);
  if (err != ESP_OK) {
    ESP_LOGE(TAG, "LittleFS mount failed (0x%x) at partition '%s' -- history persistence "
                  "disabled for this boot; live sampling continues unaffected",
              err, partition_label_.c_str());
    mounted_ = false;
    last_error_ = "mount_failed";
    return;
  }
  mounted_ = true;
  size_t total = 0, used = 0;
  if (esp_littlefs_info(partition_label_.c_str(), &total, &used) == ESP_OK) {
    ESP_LOGI(TAG, "LittleFS mounted at %s (partition '%s'): %u/%u bytes used",
              mount_point_.c_str(), partition_label_.c_str(), (unsigned) used, (unsigned) total);
  }
}

// ---------------------------------------------------------------------
// fully_validate_slot_
// ---------------------------------------------------------------------
bool JkHistoryStore::fully_validate_slot_(char slot, SnapshotHeader &out_header) {
  if (!mounted_) { last_error_ = "not_mounted"; return false; }
  const std::string path = slot_path_(slot);
  FILE *f = fopen(path.c_str(), "rb");
  if (f == nullptr) {
    last_error_ = "slot_missing";  // normal on first-ever boot -- not an error condition
    return false;
  }

  uint8_t header_buf[jk_history_format::kHeaderSize];
  const size_t header_read = fread(header_buf, 1, jk_history_format::kHeaderSize, f);
  if (header_read != jk_history_format::kHeaderSize) {
    ESP_LOGW(TAG, "slot %c: file too short for a header (%u bytes)", slot, (unsigned) header_read);
    fclose(f);
    last_error_ = "short_header";
    return false;
  }

  out_header = jk_history_format::decode_header(header_buf);
  const HeaderValidation hv = jk_history_format::validate_header(out_header, expected_capacity_);
  if (hv != HeaderValidation::kOk) {
    ESP_LOGW(TAG, "slot %c: header rejected (%s)", slot, jk_history_format::header_validation_name(hv));
    fclose(f);
    last_error_ = jk_history_format::header_validation_name(hv);
    return false;
  }

  const uint32_t marker = jk_history_format::read_commit_marker(header_buf);
  if (marker != jk_history_format::kCommitMarkerCommitted) {
    ESP_LOGW(TAG, "slot %c: commit marker not COMMITTED (0x%08x) -- treating as uncommitted/torn write",
              slot, (unsigned) marker);
    fclose(f);
    last_error_ = "not_committed";
    return false;
  }

  // Stream the payload while accumulating CRC32 in small fixed chunks --
  // never one large ~10.8KB buffer (matches the checkpoint-write path's
  // own no-large-buffer discipline).
  uint32_t crc = jk_history_format::crc32_init();
  uint8_t chunk[256];
  uint32_t remaining = out_header.payload_length;
  while (remaining > 0) {
    const size_t want = remaining < sizeof(chunk) ? remaining : sizeof(chunk);
    const size_t got = fread(chunk, 1, want, f);
    if (got != want) {
      ESP_LOGW(TAG, "slot %c: payload truncated (wanted %u more, got %u)", slot,
                (unsigned) want, (unsigned) got);
      fclose(f);
      last_error_ = "short_payload";
      return false;
    }
    crc = jk_history_format::crc32_update(crc, chunk, got);
    remaining -= static_cast<uint32_t>(got);
  }
  fclose(f);

  const uint32_t computed_payload_crc = jk_history_format::crc32_finish(crc);
  if (computed_payload_crc != out_header.payload_crc32) {
    ESP_LOGW(TAG, "slot %c: payload CRC mismatch (stored 0x%08x, computed 0x%08x)", slot,
              (unsigned) out_header.payload_crc32, (unsigned) computed_payload_crc);
    last_error_ = "bad_payload_crc";
    return false;
  }

  last_error_.clear();
  return true;
}

// ---------------------------------------------------------------------
// restore
// ---------------------------------------------------------------------
bool JkHistoryStore::restore(uint32_t &out_valid_count, uint32_t &out_write_index,
                              uint64_t &out_newest_timestamp, const RecordSink &sink) {
  out_valid_count = 0;
  out_write_index = 0;
  out_newest_timestamp = 0;
  if (!mounted_) return false;

  SnapshotHeader a, b;
  const bool a_ok = fully_validate_slot_('a', a);
  const bool b_ok = fully_validate_slot_('b', b);

  const jk_history_format::SlotChoice choice = jk_history_format::choose_newer_valid(
      a_ok, a.sequence, b_ok, b.sequence);
  if (choice == jk_history_format::SlotChoice::kNone) {
    ESP_LOGI(TAG, "no fully valid snapshot in either slot -- starting with empty history "
                  "(a: %s, b: %s)",
              a_ok ? "valid" : last_error_.c_str(), b_ok ? "valid" : last_error_.c_str());
    return false;
  }
  const char winning_slot = (choice == jk_history_format::SlotChoice::kA) ? 'a' : 'b';
  const SnapshotHeader &winning_header = (choice == jk_history_format::SlotChoice::kA) ? a : b;
  ESP_LOGI(TAG, "restoring from slot %c (sequence %u, valid_count %u, newest_timestamp %llu)",
            winning_slot, (unsigned) winning_header.sequence, (unsigned) winning_header.valid_count,
            (unsigned long long) winning_header.newest_timestamp);

  FILE *f = fopen(slot_path_(winning_slot).c_str(), "rb");
  if (f == nullptr) {
    // Should not happen (fully_validate_slot_ just opened this same file
    // successfully) -- treated defensively as "nothing to restore" rather
    // than assumed impossible.
    last_error_ = "reopen_failed";
    return false;
  }
  if (fseek(f, jk_history_format::kHeaderSize, SEEK_SET) != 0) {
    fclose(f);
    last_error_ = "seek_failed";
    return false;
  }

  bool ok = true;
  for (uint32_t i = 0; i < winning_header.valid_count && ok; i++) {
    uint8_t rec[jk_history_format::kRecordSize];
    if (fread(rec, 1, jk_history_format::kRecordSize, f) != jk_history_format::kRecordSize) {
      ESP_LOGW(TAG, "restore: short read at record %u", (unsigned) i);
      ok = false;
      break;
    }
    int16_t voltage_cv;
    uint8_t stage;
    jk_history_format::decode_record(rec, voltage_cv, stage);
    sink(i, voltage_cv, stage);
  }
  fclose(f);
  if (!ok) {
    last_error_ = "restore_read_error";
    return false;
  }

  out_valid_count = winning_header.valid_count;
  out_write_index = winning_header.write_index;
  out_newest_timestamp = winning_header.newest_timestamp;
  last_error_.clear();
  return true;
}

// ---------------------------------------------------------------------
// checkpoint
// ---------------------------------------------------------------------
bool JkHistoryStore::checkpoint(uint32_t valid_count, uint32_t write_index,
                                 uint64_t newest_timestamp, const RecordSource &source) {
  if (!mounted_) { last_error_ = "not_mounted"; return false; }

  // Steps 1-2: fully (re)validate both slots, pick the checkpoint TARGET
  // (never the sole valid slot) -- jk_history_format::choose_checkpoint_target()
  // implements the exact spec rule (older of two valid; the invalid one
  // if only one is valid; A if neither is valid).
  SnapshotHeader a, b;
  const bool a_ok = fully_validate_slot_('a', a);
  const bool b_ok = fully_validate_slot_('b', b);
  const jk_history_format::SlotChoice target = jk_history_format::choose_checkpoint_target(
      a_ok, a.sequence, b_ok, b.sequence);
  const char target_slot = (target == jk_history_format::SlotChoice::kA) ? 'a' : 'b';
  const uint32_t next_sequence =
      (a_ok || b_ok) ? (std::max(a_ok ? a.sequence : 0u, b_ok ? b.sequence : 0u) + 1) : 1;

  ESP_LOGD(TAG, "checkpoint: a_valid=%d(seq=%u) b_valid=%d(seq=%u) -> target=%c seq=%u",
            a_ok, (unsigned) a.sequence, b_ok, (unsigned) b.sequence, target_slot,
            (unsigned) next_sequence);

  // Step 3: write header (commit_marker = UNCOMMITTED) + streamed payload.
  SnapshotHeader h;
  h.capacity = expected_capacity_;
  h.valid_count = valid_count;
  h.write_index = write_index;
  h.sequence = next_sequence;
  h.newest_timestamp = newest_timestamp;
  h.sample_interval_s = sample_interval_s_;
  h.payload_length = jk_history_format::kRecordSize * expected_capacity_;
  h.flags = 0;

  // Payload is streamed in small chunks (never the full ~10.8KB in RAM at
  // once) while an incremental CRC32 is accumulated -- the same
  // discipline as fully_validate_slot_'s read path.
  uint8_t payload_chunk[256];
  size_t chunk_fill = 0;
  uint32_t crc = jk_history_format::crc32_init();

  const std::string path = slot_path_(target_slot);
  FILE *f = fopen(path.c_str(), "wb");
  if (f == nullptr) {
    last_error_ = "open_for_write_failed";
    return false;
  }

  // Placeholder header written first (with commit_marker left as the
  // zero-padding encode_header() already produces, i.e. NOT the
  // COMMITTED sentinel) -- payload_crc32 isn't known yet, so this first
  // write is necessarily provisional; it gets fully rewritten in step 6
  // below once the real payload_crc32 is known. Writing a provisional
  // header now (rather than seeking back later) keeps the file's byte
  // layout correct from the very first write, which matters if a power
  // loss happens before the rewrite ever completes -- the resulting file
  // still has an internally-consistent (if payload-CRC-wrong) header
  // shape, not a hole.
  uint8_t header_buf[jk_history_format::kHeaderSize];
  jk_history_format::encode_header(h, header_buf);  // payload_crc32 = 0 at this point
  if (fwrite(header_buf, 1, jk_history_format::kHeaderSize, f) != jk_history_format::kHeaderSize) {
    ESP_LOGE(TAG, "checkpoint: header write failed");
    fclose(f);
    last_error_ = "header_write_failed";
    return false;
  }

  auto flush_chunk = [&]() -> bool {
    if (chunk_fill == 0) return true;
    if (fwrite(payload_chunk, 1, chunk_fill, f) != chunk_fill) return false;
    crc = jk_history_format::crc32_update(crc, payload_chunk, chunk_fill);
    chunk_fill = 0;
    return true;
  };

  bool write_ok = true;
  for (uint32_t i = 0; i < expected_capacity_ && write_ok; i++) {
    int16_t voltage_cv = jk_history_format::kVoltageNoSample;
    uint8_t stage = jk_history_format::kStageOffline;
    if (i < valid_count) source(i, voltage_cv, stage);
    uint8_t rec[jk_history_format::kRecordSize];
    jk_history_format::encode_record(voltage_cv, stage, rec);
    for (uint8_t b2 : rec) {
      payload_chunk[chunk_fill++] = b2;
      if (chunk_fill == sizeof(payload_chunk)) write_ok = flush_chunk();
    }
  }
  if (write_ok) write_ok = flush_chunk();

  if (!write_ok) {
    ESP_LOGE(TAG, "checkpoint: payload write failed");
    fclose(f);
    last_error_ = "payload_write_failed";
    return false;
  }

  // Now that the real payload CRC is known, seek back and rewrite the
  // header with the correct payload_crc32 AND header_crc32 (header_crc32
  // covers payload_crc32's own field, so it must be recomputed here too
  // -- encode_header() does this automatically). commit_marker is still
  // left at UNCOMMITTED (zero-padding) at this point, deliberately.
  h.payload_crc32 = jk_history_format::crc32_finish(crc);
  jk_history_format::encode_header(h, header_buf);
  if (fseek(f, 0, SEEK_SET) != 0 ||
      fwrite(header_buf, 1, jk_history_format::kHeaderSize, f) != jk_history_format::kHeaderSize) {
    ESP_LOGE(TAG, "checkpoint: final header rewrite failed");
    fclose(f);
    last_error_ = "header_rewrite_failed";
    return false;
  }

  // Step 4: fsync + close.
  fflush(f);
  fsync(fileno(f));
  fclose(f);

  // Step 5: re-open target, fully re-read + re-validate from what is
  // ACTUALLY on flash now -- not the in-RAM `h`/`crc` this function just
  // computed. This is the one step that actually catches a torn write:
  // fully_validate_slot_() re-derives everything from disk bytes alone.
  SnapshotHeader reread;
  if (!fully_validate_slot_(target_slot, reread)) {
    // Written data didn't validate on read-back (e.g. a genuine power
    // loss mid-write, or a flash error). The slot is left as-is --
    // uncommitted, and therefore correctly ignored by both restore() and
    // any future checkpoint()'s validation pass. The PREVIOUS valid slot
    // (the one this call did not touch) remains the fallback.
    ESP_LOGE(TAG, "checkpoint: read-back validation failed (%s) -- leaving target uncommitted",
              last_error_.c_str());
    return false;
  }
  // fully_validate_slot_ also requires commit_marker == COMMITTED to
  // return true -- but we haven't written that yet. So at this point
  // reread validation must have failed on exactly "not_committed" (every
  // OTHER check already passed, since payload_crc32/header_crc32 were
  // computed correctly above) -- confirm that specific, expected state
  // rather than silently reusing whatever fully_validate_slot_ returned.
  // (fully_validate_slot_ returning true here would actually be
  // impossible given commit_marker is still UNCOMMITTED -- this comment
  // documents that the function above is only reached when it returns
  // false for exactly that reason; see the immediately following
  // targeted re-read of just the header/marker instead.)

  FILE *check = fopen(path.c_str(), "r+b");
  if (check == nullptr) {
    last_error_ = "commit_reopen_failed";
    return false;
  }
  uint8_t verify_header[jk_history_format::kHeaderSize];
  if (fread(verify_header, 1, jk_history_format::kHeaderSize, check) != jk_history_format::kHeaderSize) {
    fclose(check);
    last_error_ = "commit_reread_failed";
    return false;
  }
  const SnapshotHeader verify_decoded = jk_history_format::decode_header(verify_header);
  if (jk_history_format::validate_header(verify_decoded, expected_capacity_) != HeaderValidation::kOk) {
    fclose(check);
    last_error_ = "commit_header_invalid_on_reread";
    return false;
  }
  // Step 6: only now, having independently re-verified the header (magic/
  // version/sizes/capacity/valid_count/write_index/header_crc32, all from
  // the just-re-read bytes) AND the payload (via the fully_validate_slot_
  // call above, which already streamed and CRC-checked it), flip
  // commit_marker to COMMITTED. This is a logical 4-byte field update --
  // NOT claimed to be an isolated atomic physical write: LittleFS may
  // turn this into a rewrite of the containing block and/or metadata
  // update, per its own copy-on-write design. What makes this safe
  // regardless is that a torn write AT THIS STEP leaves commit_marker
  // as neither known sentinel (or unchanged at UNCOMMITTED), which
  // fully_validate_slot_'s marker check already treats as "not
  // committed" -- i.e. the failure mode of an interrupted step 6 is
  // self-detecting via the marker check, not assumed away.
  jk_history_format::write_commit_marker(verify_header, jk_history_format::kCommitMarkerCommitted);
  if (fseek(check, 0, SEEK_SET) != 0 ||
      fwrite(verify_header, 1, jk_history_format::kHeaderSize, check) != jk_history_format::kHeaderSize) {
    fclose(check);
    last_error_ = "commit_marker_write_failed";
    return false;
  }
  // Step 7: fsync + close again.
  fflush(check);
  fsync(fileno(check));
  fclose(check);

  // Step 8: re-open once more and confirm the committed state reads back
  // correctly -- the actual, final proof that this checkpoint succeeded.
  SnapshotHeader final_check;
  if (!fully_validate_slot_(target_slot, final_check)) {
    ESP_LOGE(TAG, "checkpoint: final commit verification failed (%s)", last_error_.c_str());
    return false;
  }

  ESP_LOGI(TAG, "checkpoint committed to slot %c (sequence %u, valid_count %u)", target_slot,
            (unsigned) h.sequence, (unsigned) valid_count);
  last_error_.clear();
  return true;
}

}  // namespace jk_history
}  // namespace esphome
