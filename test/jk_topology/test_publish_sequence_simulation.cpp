// Real, executable publish-SEQUENCE simulation for the Stage 3 corrective
// fix (batterylifepo4.yaml's 1Hz cell-block decode gate, commit 332eda0)
// -- user-directed, 2026-09-18, second-round audit. Requested specifically
// because neither test_jk_topology_core.cpp's channel_count_from_configured()
// unit tests NOR test/protocol_catalog/test_cell_voltage_publish_gate.js's
// source-text regex prove the full two-stage PUBLISH SEQUENCE (decode-gate
// publish, then resolve_topology()'s own blank pass) never lets a channel
// receive an intermediate numeric value across every combination of N and
// topology state -- they can only prove each stage is internally correct
// in isolation. This file drives the ACTUAL two real functions
// (jk_topology::channel_count_from_configured, jk_topology::resolve --
// the exact code batterylifepo4.yaml calls, no reimplementation) through a
// SIMULATED two-stage cycle that mirrors the real decode callback +
// resolve_topology() sequence byte-for-byte, and asserts the sequence
// invariant directly against the resulting mock sensor array.
//
//   g++ -std=c++17 -Wall -Wextra -I ../../components/jk_topology \
//       test_publish_sequence_simulation.cpp -o test_publish_sequence_simulation
//   ./test_publish_sequence_simulation
//
// Software/fixture test, no ESP32/ESPHome/hardware involved -- see
// test_jk_topology_core.cpp's own header for the same disclaimer, which
// applies identically here.

#include "jk_topology_core.h"

#include <cmath>
#include <cstdio>
#include <cstring>

using namespace jk_topology;

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

// A stand-in for esphome::sensor::Sensor -- just a float `state`, NAN
// meaning "never published this session" (ESPHome's own real default for
// an unpublished sensor), mirroring exactly what jk_topology::Inputs::
// voltage[] and the real voltage_sensors[]->state read in
// batterylifepo4.yaml's resolve_topology lambda actually see.
struct MockSensor {
  float state = NAN;
};

// Mirrors the REAL two-stage sequence, statement for statement:
//   1. batterylifepo4.yaml's decode callback: known_active_channels =
//      channel_count_from_configured(id(cell_count).state); then for each
//      channel i, publish_state(raw_value) ONLY if i < known_active_channels
//      (voltage_sensors_ext's ext channels use `(16U + i) <
//      known_active_channels`, folded here into one 0..31 loop for
//      simplicity -- identical arithmetic, see batterylifepo4.yaml itself).
//   2. resolve_topology(): reads back sensor state into Inputs.voltage[],
//      calls resolve(), then blanks [out.blank_voltage_from, 32) to NaN.
//
// Returns the resulting Outputs (for state/reason assertions) and leaves
// `sensors` in its final, real, externally-observable state.
Outputs simulate_one_cycle(MockSensor (&sensors)[PROTOCOL_CHANNEL_CAPACITY],
                            const Inputs &topology_in,
                            float raw_decoded_value = 3.300f) {
  // Stage 1: decode-gate publish (batterylifepo4.yaml's known_active_channels).
  const uint8_t known_active_channels = channel_count_from_configured(topology_in.configured_f);
  for (uint8_t i = 0; i < PROTOCOL_CHANNEL_CAPACITY; i++) {
    if (i < known_active_channels) {
      sensors[i].state = raw_decoded_value;
    }
    // else: NOT published this cycle at all -- sensors[i].state is left
    // exactly as it was (matches the real decode callback: no publish_state
    // call happens for a gated-off channel, full stop).
  }

  // Stage 2: resolve_topology() -- gather real (possibly stale-from-a-prior-
  // cycle) sensor state into Inputs.voltage[], exactly like the real lambda's
  // `in.voltage[i] = voltage_sensors[i]->state;` loop.
  Inputs in = topology_in;
  for (uint8_t i = 0; i < PROTOCOL_CHANNEL_CAPACITY; i++) {
    in.voltage[i] = sensors[i].state;
  }
  const Outputs out = resolve(in);

  // Apply the real blank-to-NaN pass, exactly like batterylifepo4.yaml's
  // `for (uint8_t i = out.blank_voltage_from; i < ...; i++) publish_state(NAN);`
  for (uint8_t i = out.blank_voltage_from; i < PROTOCOL_CHANNEL_CAPACITY; i++) {
    sensors[i].state = NAN;
  }
  return out;
}

// Builds an Inputs matching one named topology-state scenario for a given
// configured N -- mirrors healthy_pack()/its state-forcing variants in
// test_jk_topology_core.cpp, but named explicitly per scenario here since
// this file's whole point is exercising EVERY state, not just CONFIRMED.
enum Scenario {
  SCENARIO_CONFIRMED,
  SCENARIO_LOADING_NO_SNAPSHOT,     // have_cell_data == false
  SCENARIO_LOADING_MASK_UNKNOWN,    // have_cell_data == true, mask not yet valid ("UNKNOWN")
  SCENARIO_MISMATCH,                // mask/count disagree
  SCENARIO_OFFLINE,                 // comm_elapsed_ms > 30000
  SCENARIO_WRITE_UNCERTAIN,         // a write transaction is in flight
  SCENARIO_INVALID_COUNT,           // configured_f out of [1,32] range
};

Inputs make_inputs(Scenario scenario, uint8_t n) {
  Inputs in;
  in.configured_f = float(n);
  in.pack_voltage = 3.300f * float(n);
  in.mask_raw = (n >= 32) ? 0xFFFFFFFFu : ((uint32_t(1) << n) - 1U);
  in.mask_valid = true;
  in.have_cell_data = true;
  in.comm_elapsed_ms = 500;
  in.topology_uncertain = false;

  switch (scenario) {
    case SCENARIO_CONFIRMED:
      break;
    case SCENARIO_LOADING_NO_SNAPSHOT:
      in.have_cell_data = false;
      break;
    case SCENARIO_LOADING_MASK_UNKNOWN:
      in.mask_valid = false;
      break;
    case SCENARIO_MISMATCH:
      // Sabotage the mask so it no longer matches `n` exactly -> MISMATCH.
      in.mask_raw ^= 0x1u;
      break;
    case SCENARIO_OFFLINE:
      in.comm_elapsed_ms = 30001;
      break;
    case SCENARIO_WRITE_UNCERTAIN:
      in.topology_uncertain = true;
      break;
    case SCENARIO_INVALID_COUNT:
      in.configured_f = 200.0f;  // out of [1,32]
      break;
  }
  return in;
}

const char *scenario_name(Scenario s) {
  switch (s) {
    case SCENARIO_CONFIRMED: return "CONFIRMED";
    case SCENARIO_LOADING_NO_SNAPSHOT: return "LOADING(no snapshot yet)";
    case SCENARIO_LOADING_MASK_UNKNOWN: return "LOADING(mask UNKNOWN)";
    case SCENARIO_MISMATCH: return "MISMATCH";
    case SCENARIO_OFFLINE: return "OFFLINE";
    case SCENARIO_WRITE_UNCERTAIN: return "WRITE_UNCERTAIN";
    case SCENARIO_INVALID_COUNT: return "INVALID(count out of range)";
  }
  return "?";
}
}  // namespace

// ===========================================================================
// 1. THE core invariant this fix exists for: after ONE simulated decode+
// resolve_topology cycle, no channel the gate just published a numeric
// value to is left blanked (NaN) by the SAME cycle's resolve_topology
// pass -- i.e. no publish-then-immediately-blank flicker -- across every
// combination of N in {8,16,24,32} and every topology state this project's
// own resolve() can emit. This is the literal hardware-observed bug
// (fabricated "0.000 V" then NA within ~20-90ms), reproduced and disproven
// here via the REAL functions, not re-argued structurally.
// ===========================================================================
static void test_no_publish_then_immediate_blank_all_states_all_n() {
  const Scenario scenarios[] = {
    SCENARIO_CONFIRMED, SCENARIO_LOADING_NO_SNAPSHOT, SCENARIO_LOADING_MASK_UNKNOWN,
    SCENARIO_MISMATCH, SCENARIO_OFFLINE, SCENARIO_WRITE_UNCERTAIN, SCENARIO_INVALID_COUNT,
  };
  for (uint8_t n : {4, 8, 16, 24, 32}) {
    for (Scenario scenario : scenarios) {
      MockSensor sensors[PROTOCOL_CHANNEL_CAPACITY];
      const Inputs in = make_inputs(scenario, n);
      const uint8_t known_active_channels = channel_count_from_configured(in.configured_f);
      const Outputs out = simulate_one_cycle(sensors, in);

      char desc[192];
      // Every channel the gate published to (i < known_active_channels)
      // must have SURVIVED resolve_topology's blank pass as a real, finite
      // number -- never NaN'd out in the same cycle it was just published.
      for (uint8_t i = 0; i < known_active_channels; i++) {
        std::snprintf(desc, sizeof(desc),
          "N=%d %s: channel %d was published this cycle (i<known_active_channels=%d) and must stay finite, not flicker to NaN (got %s)",
          n, scenario_name(scenario), i + 1, known_active_channels,
          std::isfinite(sensors[i].state) ? "finite" : "NaN");
        check(std::isfinite(sensors[i].state), desc);
      }
      // Every channel the gate did NOT publish to (i >= known_active_channels)
      // must be NaN after the cycle -- either it was already NaN (never
      // touched) or resolve_topology blanked it; either way, NEVER a
      // leftover/fabricated number.
      for (uint8_t i = known_active_channels; i < PROTOCOL_CHANNEL_CAPACITY; i++) {
        std::snprintf(desc, sizeof(desc),
          "N=%d %s: channel %d was NOT published this cycle (i>=known_active_channels=%d) and must be NaN, never a numeric leftover",
          n, scenario_name(scenario), i + 1, known_active_channels);
        check(std::isnan(sensors[i].state), desc);
      }
      // The gate and resolve()'s own blanking bound must agree exactly --
      // this is what makes the two invariants above possible at all.
      std::snprintf(desc, sizeof(desc),
        "N=%d %s: known_active_channels (%d) == out.blank_voltage_from (%d) -- gate and resolver never disagree",
        n, scenario_name(scenario), known_active_channels, out.blank_voltage_from);
      check(known_active_channels == out.blank_voltage_from, desc);
    }
  }
}

// ===========================================================================
// 2. Active channels (within N) KEEP updating cycle over cycle -- the fix
// must not have accidentally turned the gate into a one-shot/latch that
// stops publishing after the first cycle.
// ===========================================================================
static void test_active_channels_keep_updating_across_cycles() {
  for (uint8_t n : {8, 16, 24, 32}) {
    MockSensor sensors[PROTOCOL_CHANNEL_CAPACITY];
    const Inputs in = make_inputs(SCENARIO_CONFIRMED, n);
    simulate_one_cycle(sensors, in, 3.300f);
    simulate_one_cycle(sensors, in, 3.310f);
    const Outputs out = simulate_one_cycle(sensors, in, 3.320f);
    char desc[160];
    for (uint8_t i = 0; i < out.blank_voltage_from; i++) {
      std::snprintf(desc, sizeof(desc), "N=%d: channel %d reflects the THIRD cycle's fresh value (3.320), not stuck on an earlier one", n, i + 1);
      check(std::fabs(sensors[i].state - 3.320f) < 1e-6f, desc);
    }
  }
}

// ===========================================================================
// 3. CellCount change mid-session (N shrinks/grows) combined with topology
// going uncertain at the same time -- the exact "зміна N та непідтверджена
// topology" scenario named in the request. Channels that just fell out of
// range must be blanked on the VERY NEXT cycle (no one-cycle lag showing a
// stale numeric value for a channel that is no longer part of N), and no
// newly-in-range channel is left un-published just because topology is
// simultaneously unconfirmed.
// ===========================================================================
static void test_n_change_with_unconfirmed_topology() {
  // 16 -> 8 shrink, topology simultaneously WRITE_UNCERTAIN.
  {
    MockSensor sensors[PROTOCOL_CHANNEL_CAPACITY];
    simulate_one_cycle(sensors, make_inputs(SCENARIO_CONFIRMED, 16));
    check(std::isfinite(sensors[7].state), "16->8 shrink: before the shrink, channel 8 (i=7) is finite");
    check(std::isfinite(sensors[15].state), "16->8 shrink: before the shrink, channel 16 (i=15) is finite");

    Inputs shrunk = make_inputs(SCENARIO_WRITE_UNCERTAIN, 8);
    const Outputs out = simulate_one_cycle(sensors, shrunk);
    check(out.state_code == STATE_WRITE_UNCERTAIN, "16->8 shrink + WRITE_UNCERTAIN: state_code is WRITE_UNCERTAIN");
    // Channels 9-16 (i=8..15) must already be blanked THIS cycle, not one
    // cycle late -- known_active_channels for N=8 is 8, so the gate itself
    // never re-published them, and resolve()'s own blank_from (state-
    // independent, per its own header comment) also blanks them here.
    for (uint8_t i = 8; i < 16; i++) {
      char desc[128];
      std::snprintf(desc, sizeof(desc), "16->8 shrink + WRITE_UNCERTAIN: channel %d (now out of range) is NaN on the SAME cycle as the shrink, not one cycle late", i + 1);
      check(std::isnan(sensors[i].state), desc);
    }
    // Channels 1-8 (still in range) must remain finite even though topology
    // is WRITE_UNCERTAIN -- current policy blanks purely on N, never on
    // state (verified structurally in jk_topology_core.h and exercised
    // directly here).
    for (uint8_t i = 0; i < 8; i++) {
      char desc[128];
      std::snprintf(desc, sizeof(desc), "16->8 shrink + WRITE_UNCERTAIN: channel %d (still in range) stays finite despite WRITE_UNCERTAIN", i + 1);
      check(std::isfinite(sensors[i].state), desc);
    }
  }

  // 8 -> 24 grow, topology simultaneously MISMATCH.
  {
    MockSensor sensors[PROTOCOL_CHANNEL_CAPACITY];
    simulate_one_cycle(sensors, make_inputs(SCENARIO_CONFIRMED, 8));
    for (uint8_t i = 8; i < 24; i++) {
      char desc[128];
      std::snprintf(desc, sizeof(desc), "8->24 grow: before the grow, channel %d (i=%d) is still NaN (was out of the 8S range)", i + 1, i);
      check(std::isnan(sensors[i].state), desc);
    }

    Inputs grown = make_inputs(SCENARIO_MISMATCH, 24);
    const Outputs out = simulate_one_cycle(sensors, grown);
    check(out.state_code == STATE_MISMATCH, "8->24 grow + MISMATCH: state_code is MISMATCH");
    for (uint8_t i = 8; i < 24; i++) {
      char desc[128];
      std::snprintf(desc, sizeof(desc), "8->24 grow + MISMATCH: channel %d (newly in range) is finite THIS cycle, not left blank just because topology is MISMATCH", i + 1);
      check(std::isfinite(sensors[i].state), desc);
    }
  }
}

// ===========================================================================
// 4. Raw decode may be retained internally, but MUST NOT leak out as a
// "trustworthy" published value for a channel the gate excluded -- this is
// really the same invariant as check #1's second loop, restated as its own
// explicit, named test per the request's own wording ("raw decode може
// зберігатися внутрішньо, але не виходить назовні як достовірний стан").
// ===========================================================================
static void test_raw_decode_never_leaks_out_for_excluded_channel() {
  MockSensor sensors[PROTOCOL_CHANNEL_CAPACITY];
  const Inputs in = make_inputs(SCENARIO_CONFIRMED, 8);
  // A raw_decoded_value that is itself perfectly plausible (a real 3.3V
  // reading) -- if the gate were absent/broken, this would leak straight
  // out as a believable, undetectable-by-range-check fake reading, exactly
  // the class of bug a "millivolts >= 500U" sanity floor can never catch.
  simulate_one_cycle(sensors, in, /*raw_decoded_value=*/3.300f);
  for (uint8_t i = 8; i < PROTOCOL_CHANNEL_CAPACITY; i++) {
    char desc[160];
    std::snprintf(desc, sizeof(desc), "N=8: channel %d's raw-decoded 3.300V never became externally-visible sensor state (stayed NaN)", i + 1);
    check(std::isnan(sensors[i].state), desc);
  }
}

int main() {
  test_no_publish_then_immediate_blank_all_states_all_n();
  test_active_channels_keep_updating_across_cycles();
  test_n_change_with_unconfirmed_topology();
  test_raw_decode_never_leaks_out_for_excluded_channel();

  std::printf("%d checks run, %d failed.\n", g_checks, g_failures);
  return g_failures ? 1 : 0;
}
