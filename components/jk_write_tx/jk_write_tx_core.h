#pragma once
// jk_write_tx_core.h -- pure, hardware-independent state machine for the
// generic RW-register write -> ACK -> forced-readback transaction manager
// (spec section "4.1. Єдиний backend transaction manager для всіх RW-
// регістрів"). No ESPHome, no Modbus, no I/O of any kind -- the caller
// (batterylifepo4.yaml's set_action/interval lambdas) owns issuing the
// actual Modbus write/read commands and feeds this module only
// timestamps and the resulting booleans/values. That split is what makes
// this desktop-testable without ESP-IDF or real hardware -- see
// test/jk_write_tx/test_jk_write_tx_core.cpp.
//
// This module intentionally does NOT replace the CellCount transaction
// (batterylifepo4.yaml's own jk_topology 250ms interval): CellCount's
// "readback" is "the topology resolver reaches CONFIRMED with the
// requested effective_cell_count", not a simple register echo, so it
// keeps its own bespoke, already-tested driver. Every OTHER RW register
// (numeric configuration values, packed sub-fields, the charging/
// discharging/balancing control selects, the setup passcode) uses THIS
// generic manager instead of the old fire-and-forget
// write_bms_u32/write_bms_u16 scripts, which never confirmed a write
// against anything -- component.update on a modbus_controller sensor is
// a no-op (ModbusSensor never overrides Component::update()), so the
// pre-existing UI's apparent "confirmation" was really just whatever the
// entity's own slow background poll cadence (skip_updates, up to
// several minutes) next happened to report.

#include <array>
#include <cstdint>

namespace jk_write_tx {

enum Status : uint8_t {
  IDLE = 0,
  SENDING = 1,
  ACK_WAIT = 2,
  READBACK_WAIT = 3,
  CONFIRMED = 4,
  MISMATCH = 5,
  // Not emitted by tick() itself -- reserved so a caller that layers
  // extra semantics on top (the way resolve_topology folds CellCount's
  // ACK_TIMEOUT/READBACK_TIMEOUT into topology WRITE_UNCERTAIN) can reuse
  // the same numeric status-code space the frontend already understands.
  WRITE_UNCERTAIN = 6,
  ACK_TIMEOUT = 7,
  READBACK_TIMEOUT = 8,
  REJECTED = 9,
  // Third critical audit (2026-09-10, item 7): also not emitted by tick()
  // itself. The generic write manager's caller (batterylifepo4.yaml's
  // 250ms servicer) reclassifies a slot that just hit ACK_TIMEOUT/
  // READBACK_TIMEOUT into WRITE_UNCERTAIN, then launches an independent
  // recovery readback (mirroring CellCount's own bespoke uncertainty-
  // recovery probe) instead of just reporting a plain completed error --
  // the write may have silently taken effect even though its ACK or
  // forced readback never arrived. These two codes are the ONLY way such
  // a slot may leave WRITE_UNCERTAIN: RECOVERED_CONFIRMED means the
  // recovery read matched what was requested (the write DID apply,
  // just unconfirmed at the time); RECOVERED_MISMATCH means it read back
  // something else (the write did not apply, or applied differently).
  RECOVERED_CONFIRMED = 10,
  RECOVERED_MISMATCH = 11,
};

constexpr uint32_t DEFAULT_ACK_TIMEOUT_MS = 3000;
constexpr uint32_t DEFAULT_READBACK_TIMEOUT_MS = 4000;

struct Slot {
  bool in_use = false;
  uint32_t tx_id = 0;
  uint16_t address = 0;
  // How many 16-bit holding registers this write/readback spans (1 or 2 in
  // this project -- every RW register here is either a u16 or a packed/u32
  // pair). The caller uses this to size the forced re-read command.
  uint8_t word_count = 1;
  uint32_t requested_raw = 0;
  uint32_t readback_raw = 0;
  // Only the bits set in compare_mask are checked on readback -- a packed
  // register (two logical sub-fields sharing one 16-bit word, e.g.
  // lcd_buzzer_trigger_source and dry_contact_1_trigger_source both at
  // 0x14E4) must not be declared MISMATCH just because its OTHER half
  // changed between write and readback.
  uint32_t compare_mask = 0xFFFFFFFFu;
  uint8_t status = IDLE;
  uint32_t started_ms = 0;
  bool acked = false;
  uint32_t readback_started_ms = 0;
  bool readback_done = false;
  // Set by the caller (not by tick()) the moment a slot reaches a
  // terminal status, so the caller can free/reuse the slot after a short
  // grace period (long enough for a client that fetches the JSON
  // snapshot via a plain HTTP request, not just SSE, to still observe
  // the terminal result) instead of either freeing it instantly (racing
  // a slow client) or never freeing it (starving future writes).
  uint32_t finished_ms = 0;
  // The setup passcode must never surface its written/readback raw value
  // to a client (the read lambda already always returns a masked
  // "****************"); the transaction still tracks ACK/readback
  // internally so a genuine failure is still reported, it just never
  // exposes requested_raw/readback_raw in the published JSON snapshot.
  bool suppress_value = false;
  // Third critical audit (2026-09-10, item 6): bumped by begin() every
  // time this slot index is (re)used for a NEW transaction. The Modbus
  // ACK/readback callbacks the caller registers close over a slot INDEX,
  // not a C++ reference (see jk_write_tx_core.h's own module comment —
  // storage lives in parallel arrays, not a real Slot object) — a late
  // callback belonging to an OLD transaction at that same index must
  // never mutate a NEWER one that has since reused it. The caller
  // captures {idx, tx_id, address, generation} at command-issue time and
  // verifies ALL FOUR still match before writing anything back (tx_id and
  // address are redundant with generation in the current caller, kept
  // because the raw wire callback already has them cheaply available and
  // an explicit belt-and-suspenders check is cheap insurance against a
  // future refactor that loosens the generation check alone).
  uint32_t generation = 0;
};

inline bool compare_masked(uint32_t requested, uint32_t readback, uint32_t mask) {
  return (requested & mask) == (readback & mask);
}

inline bool is_pending(uint8_t status) {
  // Third critical audit (2026-09-10, item 7): WRITE_UNCERTAIN counts as
  // pending too -- a slot the caller has reclassified into recovery must
  // keep blocking a new write to the SAME address (begin()'s single-
  // flight guard, below) exactly like a genuinely in-flight transaction,
  // until the recovery probe resolves it to RECOVERED_CONFIRMED/
  // RECOVERED_MISMATCH (neither of which is "pending" -- the address
  // becomes writable again the instant recovery finishes, same as any
  // other terminal status).
  return status == SENDING || status == ACK_WAIT || status == READBACK_WAIT || status == WRITE_UNCERTAIN;
}

// Starts a new transaction in a free slot. Enforces the single-flight-
// per-register-address policy (spec: "одночасно для одного register key
// дозволено лише одну транзакцію") -- a second write to an address
// already tracked by a PENDING slot is rejected outright (returns -1),
// exactly like set_cell_count's own g_cellcount_tx_pending guard, rather
// than silently interleaving with or overwriting the in-flight one. A
// slot that already reached a TERMINAL status (CONFIRMED/MISMATCH/
// ACK_TIMEOUT/READBACK_TIMEOUT) but is still `in_use` -- kept alive
// briefly only so a client reading the snapshot can still observe the
// result, see the caller's own grace-period comment -- does NOT block a
// new write to that same address; single-flight guards against two
// writes racing each other, not against writing again after the first
// one has already finished. Such a lingering terminal slot for the SAME
// address is immediately reused/superseded by the new transaction
// (rather than requiring a separate free slot) -- a client watching the
// snapshot simply sees that address's entry move from the old tx_id's
// terminal status to the new tx_id's SENDING, exactly as if a fresh slot
// had been used.
template <size_t N>
int begin(std::array<Slot, N> &slots, uint32_t &next_tx_id, uint16_t address,
          uint8_t word_count, uint32_t requested_raw, uint32_t compare_mask, uint32_t now_ms,
          bool suppress_value = false) {
  for (size_t i = 0; i < N; i++) {
    if (slots[i].in_use && slots[i].address == address) {
      if (is_pending(slots[i].status)) return -1;
      // Terminal slot for this same address -- fall through and let the
      // second loop below pick THIS exact index back up (it is the only
      // slot allowed to be reused while still `in_use`).
      slots[i].in_use = false;
    }
  }
  for (size_t i = 0; i < N; i++) {
    if (!slots[i].in_use) {
      const uint32_t prior_generation = slots[i].generation; // preserved across reuse -- see Slot::generation's own comment
      Slot fresh;
      fresh.in_use = true;
      fresh.tx_id = ++next_tx_id;
      fresh.address = address;
      fresh.word_count = word_count;
      fresh.requested_raw = requested_raw;
      fresh.compare_mask = compare_mask;
      fresh.status = SENDING;
      fresh.started_ms = now_ms;
      fresh.suppress_value = suppress_value;
      fresh.generation = prior_generation + 1;
      slots[i] = fresh;
      return int(i);
    }
  }
  return -1; // every slot busy -- caller should log and the write is REJECTED, not queued silently
}

struct TickResult {
  bool issue_readback = false; // caller must now send the forced Modbus re-read for this slot
  bool terminal = false;       // slot reached CONFIRMED/MISMATCH/ACK_TIMEOUT/READBACK_TIMEOUT this tick
};

// Advances one slot by one tick. Pure decision logic: never touches
// hardware. The caller supplies acked/readback_done/readback_raw via the
// Slot fields (set from the Modbus command's on_data_func) BEFORE calling
// tick() each interval pass.
inline TickResult tick(Slot &s, uint32_t now_ms,
                        uint32_t ack_timeout_ms = DEFAULT_ACK_TIMEOUT_MS,
                        uint32_t readback_timeout_ms = DEFAULT_READBACK_TIMEOUT_MS) {
  TickResult r;
  if (!s.in_use) return r;

  if (s.status == SENDING) s.status = ACK_WAIT;

  if (s.status == ACK_WAIT) {
    if (s.acked) {
      s.status = READBACK_WAIT;
      s.readback_started_ms = now_ms;
      r.issue_readback = true;
      return r;
    }
    if (now_ms - s.started_ms > ack_timeout_ms) {
      s.status = ACK_TIMEOUT;
      r.terminal = true;
    }
    return r;
  }

  if (s.status == READBACK_WAIT) {
    if (s.readback_done) {
      const bool matches = compare_masked(s.requested_raw, s.readback_raw, s.compare_mask);
      s.status = matches ? CONFIRMED : MISMATCH;
      r.terminal = true;
      return r;
    }
    if (now_ms - s.readback_started_ms > readback_timeout_ms) {
      s.status = READBACK_TIMEOUT;
      r.terminal = true;
    }
    return r;
  }

  return r; // already terminal -- caller frees the slot explicitly once consumed
}

}  // namespace jk_write_tx
