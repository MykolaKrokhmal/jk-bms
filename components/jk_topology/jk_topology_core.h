#pragma once
// jk_topology_core.h -- pure, hardware-independent core for the Topology
// Resolver's decision logic (user-directed rework, 2026-09-17). No
// ESPHome, no Modbus, no I/O of any kind -- the same split as
// components/jk_poll_scheduler/jk_poll_scheduler_core.h and
// components/jk_write_tx/jk_write_tx_core.h: the caller
// (batterylifepo4.yaml's resolve_topology script) owns reading real
// sensor/global state and publishing the result; this module only
// computes the decision from plain inputs. That split is what makes this
// desktop-testable without ESP-IDF or real hardware -- see
// test/jk_topology/test_jk_topology_core.cpp for behavioral coverage
// across 4S/8S/16S/24S/32S and the transitions between them (one general
// mechanism driven entirely by the `configured` count that flows through
// it, never a fixed set of hardcoded topology sizes).
//
// Extracted from the inline YAML lambda this logic used to live in
// entirely (Stage 3 cell-channel batch's own targeted corrections,
// 2026-09-17) specifically because a user-directed request for real
// behavioral tests against concrete channel-count scenarios cannot be
// satisfied by a source-text grep against YAML -- only by executing the
// actual decision logic against inputs. Every constant, branch, and
// ordering below is a direct, mechanical translation of that lambda; the
// YAML wrapper that replaced it does nothing but gather inputs, call
// resolve(), and apply the outputs (publish_state calls) -- see that
// wrapper's own comment for the exact division of responsibility.

#include <cstdint>
#include <cmath>
#include <algorithm>

namespace jk_topology {

// Protocol channel capacity (NOT a claim of hardware-verified support):
// CellVol/CellWireRes/CellConWireRes all span channel indices 0-31 in
// both the official PDF and the V2 workbook (confirmed 2026-09-17 --
// see registers.canonical.json's cell_count safety_notes). Used here as
// the acceptance range for a configured count and the "we don't yet know,
// don't hide anything real" fallback -- never as a claim that any
// specific deployed unit has been tested beyond its own observed
// CellCount.
constexpr uint8_t PROTOCOL_CHANNEL_CAPACITY = 32;

// cell_resistance_17..32 (CellWireRes16-31) have no entities at all this
// batch (source_only_unimplemented -- not actively polled; CellCount
// alone never proves that extension read-block is available). Only this
// many real resistance sensors exist to read or blank.
constexpr uint8_t RESISTANCE_CHANNEL_COUNT = 16;

enum StateCode : uint8_t {
  STATE_LOADING = 0,
  STATE_CONFIRMED = 1,
  STATE_MISMATCH = 2,
  STATE_INVALID = 3,
  STATE_WRITE_UNCERTAIN = 4,
  STATE_OFFLINE = 5,
  // STATE_PENDING (6) is a frontend-only concept (a write in flight) --
  // this resolver itself never emits it, kept out of this enum for that
  // reason (mirrors the original lambda, which also never assigned it).
};

enum ReasonCode : uint8_t {
  REASON_OK = 0,
  REASON_AWAITING_SNAPSHOT = 1,
  REASON_COUNT_OUT_OF_RANGE = 2,
  REASON_NO_CONNECTED_CELLS = 3,
  REASON_NO_VALID_VOLTAGE = 4,
  REASON_MASK_COUNT_DIFFERS = 5,
  REASON_VOLTAGE_COUNT_DIFFERS = 6,  // reserved, never emitted by resolve() below (kept for REASON_NAMES parity)
  REASON_ACTIVE_RANGE_GAP = 7,
  REASON_VOLTAGE_SUM_DIFFERS = 8,
  REASON_MASK_NOT_CONTIGUOUS = 9,
  REASON_BMS_OFFLINE = 10,
  REASON_WRITE_UNCERTAIN = 11,
};

// Display strings, indexed by StateCode/ReasonCode -- kept in this one
// place (not duplicated into the YAML caller) so the enum and its string
// representation can never drift out of sync. Array size 7 for
// STATE_NAMES (not 6) preserves the original lambda's own layout exactly:
// index 6 ("PENDING") is a frontend-only concept this resolver itself
// never emits (see StateCode's own comment) but was always reserved here.
inline constexpr const char *const REASON_NAMES[12] = {
  "OK", "AWAITING_SNAPSHOT", "COUNT_OUT_OF_RANGE", "NO_CONNECTED_CELLS",
  "NO_VALID_VOLTAGE", "MASK_COUNT_DIFFERS", "VOLTAGE_COUNT_DIFFERS",
  "ACTIVE_RANGE_GAP", "VOLTAGE_SUM_DIFFERS", "MASK_NOT_CONTIGUOUS",
  "BMS_OFFLINE", "WRITE_UNCERTAIN"
};
inline constexpr const char *const STATE_NAMES[7] = {
  "LOADING", "CONFIRMED", "MISMATCH", "INVALID",
  "WRITE_UNCERTAIN", "OFFLINE", "PENDING"
};

// Every input the decision logic needs, gathered by the caller from real
// sensor/global state before calling resolve() -- voltage[] is the RAW,
// live, NOT-yet-blanked reading for all 32 protocol-capacity channels
// (reading it before any blanking is what lets `measured_count` remain a
// genuine diagnostic of what the BMS itself still reports on channels
// beyond the configured range, exactly as the original design intended).
struct Inputs {
  bool topology_uncertain = false;
  bool have_cell_data = false;
  uint32_t comm_elapsed_ms = 0;
  float configured_f = NAN;   // id(cell_count).state
  bool mask_valid = false;    // g_cell_connected_mask_valid
  uint32_t mask_raw = 0;      // g_cell_connected_mask_raw
  float voltage[PROTOCOL_CHANNEL_CAPACITY] = {};  // cell_voltage_1..32 .state, RAW (pre-blank)
  float pack_voltage = NAN;   // id(total_voltage).state
};

// Everything the caller needs to publish/apply -- deliberately plain data,
// no ESPHome types, so this stays testable without a real Sensor.
struct Outputs {
  uint8_t state_code = STATE_LOADING;
  uint8_t reason_code = REASON_AWAITING_SNAPSHOT;
  uint8_t effective_cell_count = PROTOCOL_CHANNEL_CAPACITY;
  bool has_connected_count = false;
  float connected_count = 0.0f;
  bool has_measured_count = false;
  float measured_count = 0.0f;
  bool has_active_sum = false;
  float active_sum = 0.0f;
  // Channel-aware blanking bounds: the caller should publish_state(NaN)
  // on voltage_sensors[i] for i in [blank_voltage_from, 32), and
  // resistance_sensors[i] for i in [blank_resistance_from, 16) -- in
  // EVERY case this function returns, not only when confirmed. This is
  // what guarantees a channel beyond the current candidate CellCount
  // never shows raw/residual bytes as a trustworthy active-cell voltage
  // in ANY state (LOADING/WRITE_UNCERTAIN/OFFLINE/INVALID/MISMATCH/
  // CONFIRMED).
  uint8_t blank_voltage_from = 0;
  uint8_t blank_resistance_from = 0;
  bool confirmed = false;
  uint8_t configured = 0;  // only meaningful when have_cell_data/mask_valid/count_in_range all held
};

inline Outputs resolve(const Inputs &in) {
  Outputs out;

  // Channel-aware blanking bound -- computed unconditionally, before any
  // branch below, from whatever candidate CellCount is currently readable
  // (even if the rest of this function goes on to reject it). Unknown/
  // unreadable CellCount defaults to 0 (blank everything) -- the safest
  // default when nothing is known yet, e.g. before the very first
  // snapshot since boot. Never "silently picks" a trusted count: this
  // bound feeds ONLY the blanking outputs, never mask/plausibility/
  // CONFIRMED determination below (those independently re-derive
  // `configured` from the same read, but as their own local variable).
  uint8_t blank_from = 0;
  if (!std::isnan(in.configured_f)) {
    const int32_t candidate_raw = int32_t(lroundf(in.configured_f));
    if (candidate_raw >= 1 && candidate_raw <= int32_t(PROTOCOL_CHANNEL_CAPACITY)) {
      blank_from = uint8_t(candidate_raw);
    }
  }
  out.blank_voltage_from = blank_from;
  out.blank_resistance_from = blank_from < RESISTANCE_CHANNEL_COUNT ? blank_from : RESISTANCE_CHANNEL_COUNT;

  if (in.topology_uncertain) {
    out.state_code = STATE_WRITE_UNCERTAIN;
    out.reason_code = REASON_WRITE_UNCERTAIN;
    return out;
  }
  if (!in.have_cell_data) {
    out.state_code = STATE_LOADING;
    out.reason_code = REASON_AWAITING_SNAPSHOT;
    return out;
  }
  if (in.comm_elapsed_ms > 30000U) {
    out.state_code = STATE_OFFLINE;
    out.reason_code = REASON_BMS_OFFLINE;
    return out;
  }
  if (std::isnan(in.configured_f) || !in.mask_valid) {
    out.state_code = STATE_LOADING;
    out.reason_code = REASON_AWAITING_SNAPSHOT;
    return out;
  }

  const int32_t configured_raw = int32_t(lroundf(in.configured_f));
  const bool count_in_range = configured_raw >= 1 && configured_raw <= int32_t(PROTOCOL_CHANNEL_CAPACITY);
  if (!count_in_range) {
    out.state_code = STATE_INVALID;
    out.reason_code = REASON_COUNT_OUT_OF_RANGE;
    return out;
  }
  const uint8_t configured = uint8_t(configured_raw);
  out.configured = configured;

  // The ONE exact mask this configuration can ever legitimately produce:
  // the first `configured` bits set, nothing else -- a gap, an extra high
  // bit, or a right POPCOUNT in the wrong POSITIONS all fail this, which
  // a popcount-only check would miss. `configured` can reach 32 -- `1u <<
  // 32` is undefined behavior (shift-by-full-width), guarded explicitly
  // rather than relying on a particular compiler's shift-amount-masking
  // behavior.
  const uint32_t expected_mask = configured >= 32 ? 0xFFFFFFFFu : ((uint32_t(1) << configured) - 1U);
  const bool mask_exact = in.mask_raw == expected_mask;

  uint8_t connected_count = 0;
  for (uint8_t i = 0; i < PROTOCOL_CHANNEL_CAPACITY; i++) {
    if (in.mask_raw & (uint32_t(1) << i)) connected_count++;
  }
  if (connected_count == 0) {
    out.state_code = STATE_INVALID;
    out.reason_code = REASON_NO_CONNECTED_CELLS;
    out.has_connected_count = true;
    out.connected_count = 0.0f;
    return out;
  }

  // measured_count is a DIAGNOSTIC over all 32 protocol-capacity channels
  // — published for the operator to see, but deliberately NOT a CONFIRMED
  // gate: whether a channel beyond `configured` happens to still report a
  // plausible (possibly stale) voltage is a BMS firmware implementation
  // detail this resolver has no verified way to depend on, and gating on
  // it would create a genuine chicken-and-egg deadlock. Computed from the
  // caller's RAW (pre-blank) voltage[] -- this is a real, meaningful
  // diagnostic of what the BMS itself still reports on now-unused
  // channels, only ever DISPLAYED after the caller applies the blank
  // (blank_voltage_from) to the actual published sensors, never exposed
  // as a "trustworthy" reading itself. Spec: "для кожного неактивної
  // комірки значення не використовуються" — inactive-channel values are
  // excluded from the CONFIRMED determination entirely, not required to
  // look a certain way.
  uint8_t measured_count = 0;
  uint8_t active_measured_count = 0;
  bool active_range_gap = false;
  float active_sum = 0.0f;
  for (uint8_t i = 0; i < PROTOCOL_CHANNEL_CAPACITY; i++) {
    const float v = in.voltage[i];
    // isfinite() explicitly rejects NaN AND +/-infinity, not just the
    // range check below (which would already exclude both, but this
    // makes the exclusion an explicit, named intent rather than an
    // accident of the bounds chosen).
    const bool plausible = std::isfinite(v) && v > 0.5f && v < 10.0f;
    if (plausible) measured_count++;
    if (i < configured) {
      if (plausible) { active_sum += v; active_measured_count++; } else active_range_gap = true;
    }
  }
  if (active_measured_count == 0) {
    out.state_code = STATE_INVALID;
    out.reason_code = REASON_NO_VALID_VOLTAGE;
    out.has_connected_count = true; out.connected_count = float(connected_count);
    out.has_measured_count = true; out.measured_count = float(measured_count);
    return out;
  }

  uint8_t state_code = STATE_CONFIRMED;  // optimistically
  uint8_t reason = REASON_OK;
  if (!mask_exact) {
    state_code = STATE_MISMATCH;
    reason = (connected_count != configured) ? REASON_MASK_COUNT_DIFFERS : REASON_MASK_NOT_CONTIGUOUS;
  } else if (active_range_gap) {
    state_code = STATE_MISMATCH;
    reason = REASON_ACTIVE_RANGE_GAP;
  } else {
    const float tolerance = std::max(0.5f, std::fabs(in.pack_voltage) * 0.015f);
    if (!std::isfinite(in.pack_voltage) || std::fabs(in.pack_voltage - active_sum) > tolerance) {
      state_code = STATE_MISMATCH;
      reason = REASON_VOLTAGE_SUM_DIFFERS;
    }
  }

  out.state_code = state_code;
  out.reason_code = reason;
  out.effective_cell_count = state_code == STATE_CONFIRMED ? configured : PROTOCOL_CHANNEL_CAPACITY;
  out.has_connected_count = true; out.connected_count = float(connected_count);
  out.has_measured_count = true; out.measured_count = float(measured_count);
  out.has_active_sum = true; out.active_sum = active_sum;
  out.confirmed = state_code == STATE_CONFIRMED;
  return out;
}

}  // namespace jk_topology
