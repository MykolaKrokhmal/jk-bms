#pragma once
// jk_diag_probe_core.h -- pure, hardware-independent core of the READ-ONLY
// clustered-read measurement build (docs/project/RS485_CLUSTERED_READ_MIGRATION_PLAN.md,
// step M0; hardware gates A-C). No ESPHome, no Modbus, no I/O: the diagnostic
// configuration (jk_bms_probe.yaml) feeds this module
// timestamps, "frame sent" notifications, response lengths and parsed
// exception log lines, and logs only the metadata lines this module formats.
//
// Safety contract (enforced here at compile time and by
// test/jk_diag_probe/test_jk_diag_probe_core.cpp):
//   - FC03 (read holding registers) only; no write function code exists here;
//   - a static allowlist of exact (address, register count) reads; nothing
//     is ever read that is not in kRequests[]; there is no runtime-supplied
//     address or count anywhere;
//   - the setup-passcode range 0x1470-0x147F is never touched;
//   - response bytes are never logged: the formatters take metadata only,
//     and summaries of payload content are counts/equality results only;
//   - every run is bounded (mode default, hard maximum 30 min) and latches
//     FINISHED: no request is issued after that until a reboot.
//
// Addresses are JK-PB register addresses as used by the production firmware:
// each 16-bit register occupies 2 address units, so a read of N registers at A
// covers A .. A + 2N - 1 and returns 2N data bytes.

#include <array>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>

// Reused production primitives: the exact-length rule for a fixed-count FC03
// response and the late-callback generation check (bare include: ESPHome
// flattens `includes:` into one directory, exactly as batterylifepo4.yaml
// relies on; host builds add -I components/jk_capability).
#include "jk_capability_core.h"

namespace jk_diag_probe {

constexpr uint8_t FC_READ_HOLDING_REGISTERS = 0x03;
constexpr uint16_t kMaxRegistersPerRead = 125;  // Modbus RTU FC03 protocol limit (256-byte ADU)
constexpr uint16_t kCredentialStart = 0x1470;   // setup passcode, 8 registers
constexpr uint16_t kCredentialEndExclusive = 0x1480;
constexpr uint32_t kHardMaxRunMs = 30UL * 60UL * 1000UL;  // 30 min, never exceeded

// VERIFIED CONSERVATIVE OPERATIONAL MAXIMUM per read (owner decision
// 2026-09-28) -- a design limit, NOT the BMS device/protocol limit and NOT a
// request validation rule. Gate A (2026-09-28): 0x1200 x 125 and 0x1000 x 124
// got exception 2; the x 120 clusters AND all four x 121 boundary controls
// below succeeded with exact lengths. For the tested ranges the largest
// confirmed successful length is 121 and the smallest observed failing length
// is 124; the exact device limit was not determined. Only the cluster
// geometry is held to it; the protocol limit stays kMaxRegistersPerRead so
// the x 121 controls remain legal requests.
constexpr uint16_t kOperationalMaxRegisters = 120;

// Deterministic request timing. jk_bms_probe.yaml sets the same values (the
// contract test compares them): the hub sends each frame exactly once
// (modbus_controller max_cmd_retries: 0) and gives up after send_wait_time,
// long before the probe declares its own timeout and moves on, so no frame of
// an earlier request can overlap the next one.
constexpr uint32_t kHubSendWaitMs = 500;  // modbus: send_wait_time
constexpr uint32_t kHubMaxRetries = 0;    // modbus_controller: max_cmd_retries
constexpr uint32_t kTimeoutMarginMs = 500;
constexpr uint32_t kRequestTimeoutMs = 1500;
static_assert(kRequestTimeoutMs >= (kHubMaxRetries + 1U) * kHubSendWaitMs + kTimeoutMarginMs,
              "the probe timeout must outlast every hub attempt plus a margin (no overlapping requests)");

// Raw response frames are never logged. Flipping this is a contract violation
// that fails to compile.
constexpr bool kLogRawFrames = false;
static_assert(!kLogRawFrames, "the diagnostic build must never log raw response frames");

// WIDE = a cluster (<= kOperationalMaxRegisters); BOUNDARY = a gate A boundary
// control, one register above it; NARROW = a comparison read.
enum class Kind : uint8_t { WIDE = 0, BOUNDARY = 1, NARROW = 2 };
// The outcome gate A expects. Regular reads must answer OK. A boundary
// control's EXCEPTION_2 expectation is the hypothesis gate A tested ("120 is
// the hardware limit"); on 2026-09-28 all four controls answered OK
// (match=0), which disproved it. Any unexpected outcome is recorded
// (match=0) -- it is data, not by itself a communication failure (only a
// failed liveness step is).
enum class Expect : uint8_t { OK = 0, EXCEPTION_2 = 1 };
inline const char *expect_name(Expect e) { return e == Expect::OK ? "OK" : "EXC2"; }

struct Request {
  const char *id;
  Kind kind;
  uint8_t function;
  uint16_t address;
  uint16_t count;           // registers
  uint16_t expected_bytes;  // data bytes = 2 * count
  Expect expect;
};

// --- Static allowlist --------------------------------------------------------
// Wide clusters, then the boundary controls, then the narrow reads gate A
// compares against. Every narrow read is a sub-range of one wide read (see
// kComparisons) and, except N_CAL29, is a read production already performs.
//
// Corrected geometry (2026-09-28; gate A refused A1 0x1200 x 125 and C1
// 0x1000 x 124 with exception 2): each x 120 cluster plus its tail cluster
// covers exactly the old span (A 0x1200..0x130C = 135 words, C
// 0x1000..0x111C = 143 words) and every split falls on a canonical register
// boundary (A1 ends with the 1-word 0x12EE, A2 starts with the U32 at
// 0x12F0; C1 ends with the U32 0x10EC-0x10EE, C2 starts with the U32 at
// 0x10F0).
//
// Boundary controls (x 121, FC03, read-only):
//   A121  0x1200 x 121 -- the A1 prefix plus 0x12F0, which is only the FIRST
//         half of the U32 bms_system_ticks (deliberately);
//   A121W 0x1202 x 121 -- whole registers only; every word lies in A1 u A2;
//   C121  0x1000 x 121 -- the C1 prefix plus 0x10F0, the first half of a U32;
//   C121W 0x1024 x 121 -- whole registers only; every word lies in C1 u C2.
// Exception 2 from BOTH the prefix and the whole-register control, with the
// clusters OK, is the evidence for a quantity limit; a refused prefix alone
// could equally be a "no partial register" rule.
constexpr std::size_t kWideCount = 7;
constexpr std::size_t kBoundaryCount = 4;
constexpr Request kRequests[] = {
    {"A1", Kind::WIDE, FC_READ_HOLDING_REGISTERS, 0x1200, 120, 240, Expect::OK},
    {"A2", Kind::WIDE, FC_READ_HOLDING_REGISTERS, 0x12F0, 15, 30, Expect::OK},
    {"C1", Kind::WIDE, FC_READ_HOLDING_REGISTERS, 0x1000, 120, 240, Expect::OK},
    {"C2", Kind::WIDE, FC_READ_HOLDING_REGISTERS, 0x10F0, 23, 46, Expect::OK},
    {"S1", Kind::WIDE, FC_READ_HOLDING_REGISTERS, 0x1400, 20, 40, Expect::OK},
    {"S2", Kind::WIDE, FC_READ_HOLDING_REGISTERS, 0x14B2, 18, 36, Expect::OK},
    {"S3", Kind::WIDE, FC_READ_HOLDING_REGISTERS, 0x14E4, 18, 36, Expect::OK},
    // Boundary controls.
    {"A121", Kind::BOUNDARY, FC_READ_HOLDING_REGISTERS, 0x1200, 121, 242, Expect::EXCEPTION_2},
    {"A121W", Kind::BOUNDARY, FC_READ_HOLDING_REGISTERS, 0x1202, 121, 242, Expect::EXCEPTION_2},
    {"C121", Kind::BOUNDARY, FC_READ_HOLDING_REGISTERS, 0x1000, 121, 242, Expect::EXCEPTION_2},
    {"C121W", Kind::BOUNDARY, FC_READ_HOLDING_REGISTERS, 0x1024, 121, 242, Expect::EXCEPTION_2},
    // Narrow comparison reads.
    {"N_CELLS", Kind::NARROW, FC_READ_HOLDING_REGISTERS, 0x1200, 53, 106, Expect::OK},  // production 1 s cell block
    {"N_AVGV", Kind::NARROW, FC_READ_HOLDING_REGISTERS, 0x1244, 1, 2, Expect::OK},      // average cell voltage
    {"N_RES17", Kind::NARROW, FC_READ_HOLDING_REGISTERS, 0x126A, 16, 32, Expect::OK},   // resistance 17-32 probe range
    {"N_1290", Kind::NARROW, FC_READ_HOLDING_REGISTERS, 0x1290, 12, 24, Expect::OK},    // clustered total V / current
    {"N_T4", Kind::NARROW, FC_READ_HOLDING_REGISTERS, 0x12FA, 1, 2, Expect::OK},        // temperature 4
    {"N_PCL", Kind::NARROW, FC_READ_HOLDING_REGISTERS, 0x130C, 1, 2, Expect::OK},       // PCL module status
    {"N_SLEEP", Kind::NARROW, FC_READ_HOLDING_REGISTERS, 0x1000, 2, 4, Expect::OK},     // smart sleep voltage; also the liveness read
    {"N_CHG", Kind::NARROW, FC_READ_HOLDING_REGISTERS, 0x1070, 2, 4, Expect::OK},       // charging switch
    {"N_CAL29", Kind::NARROW, FC_READ_HOLDING_REGISTERS, 0x10F8, 2, 4, Expect::OK},     // calibration 29
    {"N_FLAGS", Kind::NARROW, FC_READ_HOLDING_REGISTERS, 0x1114, 1, 2, Expect::OK},     // control flags
    {"N_HEAT", Kind::NARROW, FC_READ_HOLDING_REGISTERS, 0x111C, 1, 2, Expect::OK},      // heating temperatures
    {"N_MODEL", Kind::NARROW, FC_READ_HOLDING_REGISTERS, 0x1400, 8, 16, Expect::OK},    // device model (ASCII)
    {"N_UART1", Kind::NARROW, FC_READ_HOLDING_REGISTERS, 0x14B2, 1, 2, Expect::OK},     // UART1 protocol number
    {"N_CANVER", Kind::NARROW, FC_READ_HOLDING_REGISTERS, 0x1506, 1, 2, Expect::OK},    // CAN protocol version
};
constexpr std::size_t kRequestCount = sizeof(kRequests) / sizeof(kRequests[0]);
constexpr std::size_t kMaxExpectedBytes = 242;

constexpr bool overlaps_credential(uint16_t address, uint16_t count) {
  const uint32_t start = address, end = uint32_t(address) + 2U * uint32_t(count);
  return start < kCredentialEndExclusive && end > kCredentialStart;
}

constexpr bool request_is_valid(const Request &r) {
  return r.function == FC_READ_HOLDING_REGISTERS && r.count >= 1 && r.count <= kMaxRegistersPerRead &&
         r.expected_bytes == 2U * r.count && r.expected_bytes <= kMaxExpectedBytes &&
         !overlaps_credential(r.address, r.count) && r.id != nullptr;
}

constexpr Kind kind_at(std::size_t i) {
  return i < kWideCount ? Kind::WIDE : i < kWideCount + kBoundaryCount ? Kind::BOUNDARY : Kind::NARROW;
}

constexpr bool allowlist_is_valid() {
  for (std::size_t i = 0; i < kRequestCount; i++) {
    const Request &r = kRequests[i];
    if (!request_is_valid(r)) return false;
    if (r.kind != kind_at(i)) return false;
    // Clusters stay within the operational maximum; each control is exactly
    // one register above it and is the only kind expected to be refused.
    if (r.kind == Kind::WIDE && r.count > kOperationalMaxRegisters) return false;
    if ((r.kind == Kind::BOUNDARY) != (r.count == kOperationalMaxRegisters + 1)) return false;
    if ((r.kind == Kind::BOUNDARY) != (r.expect == Expect::EXCEPTION_2)) return false;
    for (std::size_t j = 0; j < i; j++) {
      if (kRequests[j].address == kRequests[i].address && kRequests[j].count == kRequests[i].count) return false;
    }
  }
  return true;
}
static_assert(allowlist_is_valid(), "diagnostic allowlist violates the FC03/length/credential/uniqueness contract");

// The only lookup there is: a (function, address, count) triple is allowed
// exactly when it equals one allowlisted request. Returns its index or -1.
inline int find_allowed(uint8_t function, uint16_t address, uint16_t count) {
  if (function != FC_READ_HOLDING_REGISTERS) return -1;
  if (overlaps_credential(address, count)) return -1;
  for (std::size_t i = 0; i < kRequestCount; i++) {
    if (kRequests[i].address == address && kRequests[i].count == count) return request_is_valid(kRequests[i]) ? int(i) : -1;
  }
  return -1;
}

constexpr int index_of(const char *id) {
  for (std::size_t i = 0; i < kRequestCount; i++) {
    const char *a = kRequests[i].id;
    const char *b = id;
    while (*a && *a == *b) { a++; b++; }
    if (*a == 0 && *b == 0) return int(i);
  }
  return -1;
}

// --- Narrow/wide comparisons (gate A) ----------------------------------------
// stable = configuration/static data, expected identical between the two
// reads; live = telemetry, reported but allowed to differ (read at different
// moments). Only equal-word counts are reported, never values.
struct Comparison {
  int narrow;
  int wide;
  uint16_t word_offset;
  uint16_t word_count;
  bool stable;
};
constexpr Comparison kComparisons[] = {
    {index_of("N_CELLS"), index_of("A1"), 0, 53, false},
    {index_of("N_AVGV"), index_of("A1"), 34, 1, false},
    {index_of("N_RES17"), index_of("A1"), 53, 16, false},
    {index_of("N_1290"), index_of("A1"), 72, 12, false},
    {index_of("N_T4"), index_of("A2"), 5, 1, false},
    {index_of("N_PCL"), index_of("A2"), 14, 1, false},
    {index_of("N_SLEEP"), index_of("C1"), 0, 2, true},
    {index_of("N_CHG"), index_of("C1"), 56, 2, true},
    {index_of("N_CAL29"), index_of("C2"), 4, 2, true},
    {index_of("N_FLAGS"), index_of("C2"), 18, 1, true},
    {index_of("N_HEAT"), index_of("C2"), 22, 1, true},
    {index_of("N_MODEL"), index_of("S1"), 0, 8, true},
    {index_of("N_UART1"), index_of("S2"), 0, 1, true},
    {index_of("N_CANVER"), index_of("S3"), 17, 1, true},
};
constexpr std::size_t kComparisonCount = sizeof(kComparisons) / sizeof(kComparisons[0]);

constexpr bool comparisons_are_valid() {
  for (const auto &c : kComparisons) {
    if (c.narrow < 0 || c.wide < 0) return false;
    const Request &n = kRequests[c.narrow], &w = kRequests[c.wide];
    if (n.kind != Kind::NARROW || w.kind != Kind::WIDE) return false;
    if (n.count != c.word_count) return false;
    if (n.address != w.address + 2U * c.word_offset) return false;
    if (c.word_offset + c.word_count > w.count) return false;
  }
  return true;
}
static_assert(comparisons_are_valid(), "every comparison must be an exact sub-range of its wide read");

// --- Allowlisted content summaries (counts only) -----------------------------
// Gap words: addresses inside a wide read that no canonical register defines
// (checked against protocol/registers.canonical.json by
// test/protocol_catalog/test_diag_probe_contract.js). Gate A on 2026-09-28
// found them NOT all zero (A2 1/3, C2 1/4 zero): undocumented data, never
// assumed zero. Channel ranges: voltages 17-32 and resistances 17-32 inside
// A1 (inactive on a 16S pack).
struct WordSet {
  const char *id;
  int wide;
  uint16_t first_address;  // used only for the contiguous ranges below
  uint16_t count;          // contiguous word count, or 0 when `words` is used
  const uint16_t *words;   // explicit gap-word addresses
  uint16_t word_count;
};
constexpr uint16_t kA1GapWords[] = {0x12E0, 0x12E2, 0x12E8, 0x12EA, 0x12EC};
constexpr uint16_t kA2GapWords[] = {0x12F4, 0x12F6, 0x12FE, 0x1304, 0x1306};
constexpr uint16_t kC2GapWords[] = {0x1110, 0x1112, 0x1116, 0x111A};
constexpr WordSet kSummaries[] = {
    {"A1_V17_32", index_of("A1"), 0x1220, 16, nullptr, 0},
    {"A1_R17_32", index_of("A1"), 0x126A, 16, nullptr, 0},
    {"A1_GAPS", index_of("A1"), 0, 0, kA1GapWords, uint16_t(sizeof(kA1GapWords) / sizeof(kA1GapWords[0]))},
    {"A2_GAPS", index_of("A2"), 0, 0, kA2GapWords, uint16_t(sizeof(kA2GapWords) / sizeof(kA2GapWords[0]))},
    {"C2_GAPS", index_of("C2"), 0, 0, kC2GapWords, uint16_t(sizeof(kC2GapWords) / sizeof(kC2GapWords[0]))},
};
constexpr std::size_t kSummaryCount = sizeof(kSummaries) / sizeof(kSummaries[0]);

constexpr bool summary_words_inside(const WordSet &s) {
  if (s.wide < 0) return false;
  const Request &w = kRequests[s.wide];
  const uint32_t end = uint32_t(w.address) + 2U * w.count;
  if (s.words == nullptr) return s.first_address >= w.address && uint32_t(s.first_address) + 2U * s.count <= end;
  for (uint16_t i = 0; i < s.word_count; i++) {
    if (s.words[i] < w.address || s.words[i] >= end || ((s.words[i] - w.address) % 2) != 0) return false;
  }
  return true;
}
constexpr bool summaries_are_valid() {
  for (const auto &s : kSummaries) if (!summary_words_inside(s)) return false;
  return true;
}
static_assert(summaries_are_valid(), "summary words must lie inside their wide read");

// --- Response classification -------------------------------------------------
enum class Outcome : uint8_t { OK = 0, SHORT = 1, LONG = 2, EXCEPTION = 3, TIMEOUT = 4 };
constexpr std::size_t kOutcomeCount = 5;
inline const char *outcome_name(Outcome o) {
  switch (o) {
    case Outcome::OK: return "OK";
    case Outcome::SHORT: return "SHORT";
    case Outcome::LONG: return "LONG";
    case Outcome::EXCEPTION: return "EXCEPTION";
    case Outcome::TIMEOUT: return "TIMEOUT";
  }
  return "?";
}
// Strict length validation: exactly the expected byte count, nothing else
// (the production rule, jk_capability::classify_response); a mismatch is split
// into SHORT / LONG for the evidence.
inline Outcome classify_length(uint16_t expected_bytes, std::size_t got_bytes) {
  if (jk_capability::classify_response(got_bytes, expected_bytes) == jk_capability::ATTEMPT_RESPONSE_OK) return Outcome::OK;
  return got_bytes < expected_bytes ? Outcome::SHORT : Outcome::LONG;
}

// ESPHome's modbus_controller reports an exception response only as a log line
// (ModbusCommandItem::on_error):
//   "Modbus error function code: 0x%X register 0x%X exception: %d"
// Parses exactly that text; anything else returns false.
inline bool parse_modbus_error_line(const char *msg, uint8_t &function, uint16_t &address, uint8_t &exception) {
  if (msg == nullptr) return false;
  const char *p = std::strstr(msg, "Modbus error function code: 0x");
  if (p == nullptr) return false;
  unsigned fc = 0, reg = 0;
  int exc = -1, consumed = 0;
  if (std::sscanf(p, "Modbus error function code: 0x%x register 0x%x exception: %d%n", &fc, &reg, &exc, &consumed) != 3) return false;
  if (fc > 0xFF || reg > 0xFFFF || exc < 0 || exc > 0xFF) return false;
  function = uint8_t(fc);
  address = uint16_t(reg);
  exception = uint8_t(exc);
  return true;
}

// --- Modes -------------------------------------------------------------------
enum class Mode : uint8_t { A_COMPATIBILITY = 0, B_TELEMETRY_SOAK = 1, C_COEXISTENCE = 2 };
inline const char *mode_name(Mode m) {
  switch (m) {
    case Mode::A_COMPATIBILITY: return "A";
    case Mode::B_TELEMETRY_SOAK: return "B";
    case Mode::C_COEXISTENCE: return "C";
  }
  return "?";
}
constexpr uint32_t default_run_ms(Mode m) {
  return m == Mode::A_COMPATIBILITY ? 5UL * 60UL * 1000UL
         : m == Mode::B_TELEMETRY_SOAK ? 10UL * 60UL * 1000UL
                                        : 20UL * 60UL * 1000UL;
}
static_assert(default_run_ms(Mode::A_COMPATIBILITY) <= kHardMaxRunMs && default_run_ms(Mode::B_TELEMETRY_SOAK) <= kHardMaxRunMs &&
                  default_run_ms(Mode::C_COEXISTENCE) <= kHardMaxRunMs, "mode defaults must respect the hard maximum");
// 0 selects the mode default; anything above the hard maximum is clamped.
constexpr uint32_t effective_run_ms(Mode m, uint32_t requested_ms) {
  const uint32_t r = requested_ms == 0 ? default_run_ms(m) : requested_ms;
  return r > kHardMaxRunMs ? kHardMaxRunMs : r;
}

constexpr uint32_t kTelemetryCadenceMs = 1000;   // A1 then A2, each cycle
constexpr uint32_t kSettingsCadenceMs = 3000;    // C1 then C2 (mode C)
constexpr uint32_t kSettingsPhaseMs = 500;       // stagger from the telemetry cycle
constexpr uint32_t kPassSpacingMs = 1000;        // mode A: gap between requests

// --- Mode A: the fixed gate A schedule ---------------------------------------
// 29 steps, statically defined; nothing is ever added at run time (no
// bisection, no x 122/123). LIVENESS = the production-identical read
// 0x1000 x 2 (production read-plan block 0): if it is not OK the run aborts
// and no further Modbus request is issued. It opens the run and follows every
// boundary control, so each (expected) exception 2 is followed by proof that
// the link is still healthy. An unexpected result on any other step only
// sets match=0 and counts as unexpected; the fixed schedule continues, since
// the remaining controls are needed to read the full matrix.
enum class Role : uint8_t { LIVENESS = 0, CLUSTER = 1, CONTROL = 2, NARROW = 3 };
struct Step {
  int request;
  Role role;
};
constexpr Step kPassA[] = {
    {index_of("N_SLEEP"), Role::LIVENESS},
    {index_of("A2"), Role::CLUSTER},     // proves 0x12F0 and the new A tail readable on their own
    {index_of("A1"), Role::CLUSTER},
    {index_of("A121"), Role::CONTROL},
    {index_of("N_SLEEP"), Role::LIVENESS},
    {index_of("A121W"), Role::CONTROL},
    {index_of("N_SLEEP"), Role::LIVENESS},
    {index_of("C2"), Role::CLUSTER},     // proves 0x10F0 and the new C tail readable on their own
    {index_of("C1"), Role::CLUSTER},
    {index_of("C121"), Role::CONTROL},
    {index_of("N_SLEEP"), Role::LIVENESS},
    {index_of("C121W"), Role::CONTROL},
    {index_of("N_SLEEP"), Role::LIVENESS},
    {index_of("S1"), Role::CLUSTER},     // repeated so every gate A comparison stays valid
    {index_of("S2"), Role::CLUSTER},
    {index_of("S3"), Role::CLUSTER},
    {index_of("N_CELLS"), Role::NARROW},
    {index_of("N_AVGV"), Role::NARROW},
    {index_of("N_RES17"), Role::NARROW},
    {index_of("N_1290"), Role::NARROW},
    {index_of("N_T4"), Role::NARROW},
    {index_of("N_PCL"), Role::NARROW},
    {index_of("N_CHG"), Role::NARROW},
    {index_of("N_CAL29"), Role::NARROW},
    {index_of("N_FLAGS"), Role::NARROW},
    {index_of("N_HEAT"), Role::NARROW},
    {index_of("N_MODEL"), Role::NARROW},
    {index_of("N_UART1"), Role::NARROW},
    {index_of("N_CANVER"), Role::NARROW},
};
constexpr std::size_t kPassACount = sizeof(kPassA) / sizeof(kPassA[0]);
constexpr int kLivenessRequest = index_of("N_SLEEP");

constexpr bool pass_a_is_valid() {
  if (kPassACount != 29 || kPassA[0].role != Role::LIVENESS) return false;
  std::size_t liveness = 0;
  for (std::size_t i = 0; i < kPassACount; i++) {
    const Step &s = kPassA[i];
    if (s.request < 0 || std::size_t(s.request) >= kRequestCount) return false;
    const Kind k = kRequests[s.request].kind;
    if ((s.role == Role::LIVENESS) != (s.request == kLivenessRequest)) return false;
    if (s.role == Role::CLUSTER && k != Kind::WIDE) return false;
    if (s.role == Role::CONTROL && k != Kind::BOUNDARY) return false;
    if (s.role == Role::NARROW && k != Kind::NARROW) return false;
    if (s.role == Role::LIVENESS) liveness++;
    // Every control is immediately followed by a liveness step.
    if (s.role == Role::CONTROL && (i + 1 >= kPassACount || kPassA[i + 1].role != Role::LIVENESS)) return false;
  }
  if (liveness != 5) return false;
  // Every allowlisted request is used at least once.
  for (std::size_t r = 0; r < kRequestCount; r++) {
    bool used = false;
    for (const Step &s : kPassA) used = used || s.request == int(r);
    if (!used) return false;
  }
  return true;
}
static_assert(pass_a_is_valid(), "gate A schedule: 29 steps, liveness first and after every control, every request used");

// Whether a terminal outcome is the one gate A expects for that request.
inline bool outcome_matches(Expect e, Outcome o, uint8_t exception) {
  return e == Expect::OK ? o == Outcome::OK : (o == Outcome::EXCEPTION && exception == 2);
}

// --- Statistics ----------------------------------------------------------------
constexpr uint32_t kHistBucketMs = 10;
constexpr std::size_t kHistBuckets = 128;  // 0..1270 ms, last bucket open-ended (max tracked exactly)
struct Histogram {
  std::array<uint16_t, kHistBuckets> b{};
  uint32_t n = 0, min = 0xFFFFFFFFu, max = 0;
  uint64_t sum = 0;
  // In-place reset to the default member values (no temporary; see Probe::begin).
  void reset() {
    b.fill(0);
    n = 0; min = 0xFFFFFFFFu; max = 0;
    sum = 0;
  }
  void add(uint32_t v) {
    std::size_t i = v / kHistBucketMs;
    if (i >= kHistBuckets) i = kHistBuckets - 1;
    if (b[i] < 0xFFFF) b[i]++;
    n++; sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  // Upper edge of the bucket holding the q-th fraction (q in [0,1]).
  uint32_t percentile(double q) const {
    if (n == 0) return 0;
    const uint32_t target = uint32_t(q * n + 0.999999);
    uint32_t acc = 0;
    for (std::size_t i = 0; i < kHistBuckets; i++) {
      acc += b[i];
      if (acc >= (target == 0 ? 1 : target)) return i == kHistBuckets - 1 ? max : uint32_t((i + 1) * kHistBucketMs);
    }
    return max;
  }
};
constexpr uint32_t kIntervalBucketMs = 50;
constexpr std::size_t kIntervalBuckets = 200;  // 0..10 s
struct IntervalStats {
  std::array<uint16_t, kIntervalBuckets> b{};
  uint32_t n = 0, max = 0, over_1_5x = 0, missed = 0;  // missed = interval >= 2 x cadence
  void reset() {
    b.fill(0);
    n = 0; max = 0; over_1_5x = 0; missed = 0;
  }
  void add(uint32_t v, uint32_t cadence) {
    std::size_t i = v / kIntervalBucketMs;
    if (i >= kIntervalBuckets) i = kIntervalBuckets - 1;
    if (b[i] < 0xFFFF) b[i]++;
    n++;
    if (v > max) max = v;
    if (cadence && uint64_t(v) * 2 > uint64_t(cadence) * 3) over_1_5x++;
    if (cadence && v >= 2 * cadence) missed++;
  }
  uint32_t percentile(double q) const {
    if (n == 0) return 0;
    const uint32_t target = uint32_t(q * n + 0.999999);
    uint32_t acc = 0;
    for (std::size_t i = 0; i < kIntervalBuckets; i++) {
      acc += b[i];
      if (acc >= (target == 0 ? 1 : target)) return i == kIntervalBuckets - 1 ? max : uint32_t((i + 1) * kIntervalBucketMs);
    }
    return max;
  }
};
struct RequestStats {
  std::array<uint32_t, kOutcomeCount> outcomes{};
  uint32_t issued = 0, resends = 0, late = 0;
  Histogram bms_ms;      // last frame sent -> response
  Histogram total_ms;    // issued -> response
  Histogram queue_ms;    // issued -> first frame sent
  uint32_t callback_us_max = 0;
  uint32_t last_ok_ms = 0;
  bool has_ok = false;
  IntervalStats ok_interval;
  void reset() {
    outcomes.fill(0);
    issued = 0; resends = 0; late = 0;
    bms_ms.reset(); total_ms.reset(); queue_ms.reset();
    callback_us_max = 0;
    last_ok_ms = 0;
    has_ok = false;
    ok_interval.reset();
  }
};

// One terminal event, as a metadata-only record for the log line.
struct Terminal {
  bool valid = false;
  int request = -1;
  Outcome outcome = Outcome::OK;
  uint16_t got_bytes = 0;
  uint8_t exception = 0;
  uint8_t sends = 0;
  uint32_t queue_ms = 0, bms_ms = 0, total_ms = 0;
  int step = -1;    // mode A step (0-based), -1 outside mode A
  bool match = true;  // outcome equals the request's expectation
};

// --- The bounded run ------------------------------------------------------------
class Probe {
 public:
  void begin(Mode mode, uint32_t now_ms, uint32_t start_delay_ms, uint32_t requested_run_ms) {
    // Reset in place. `*this = Probe();` materialised a ~32 KB temporary on
    // the caller's stack -- 4x the ESP32 loopTask stack (8 KB) -- and, as the
    // first statement of on_boot, crashed the diagnostic image on every boot
    // before ESPHome marked the OTA valid (automatic rollback, 2026-09-27).
    // test/jk_diag_probe/test_jk_diag_probe_stack.sh bounds every entry
    // point's frame; the reset-equivalence tests pin reset() to the defaults.
    reset();
    mode_ = mode;
    run_ms_ = effective_run_ms(mode, requested_run_ms);
    start_ms_ = now_ms + start_delay_ms;
    deadline_ms_ = start_ms_ + run_ms_;
    begun_ = true;
    next_pass_ms_ = start_ms_;
    tele_due_ms_ = start_ms_;
    settings_due_ms_ = start_ms_ + kSettingsPhaseMs;
  }

  bool finished() const { return finished_; }
  bool begun() const { return begun_; }
  Mode mode() const { return mode_; }
  uint32_t run_ms() const { return run_ms_; }
  int outstanding() const { return outstanding_; }
  uint32_t generation() const { return generation_; }
  const RequestStats &stats(std::size_t i) const { return stats_[i]; }
  uint32_t total_issued() const { return total_issued_; }
  bool aborted() const { return aborted_; }
  int abort_step() const { return abort_step_; }
  uint32_t unexpected() const { return unexpected_; }

  // Called on every poll. Returns the index of the one request to issue now,
  // or -1. Resolves the outstanding request's timeout first. `timed_out` gets
  // the timeout's terminal record when one happened on this call.
  int poll(uint32_t now_ms, Terminal &timed_out) {
    timed_out = Terminal();
    if (!begun_ || finished_) return -1;
    if (outstanding_ >= 0) {
      if (elapsed(now_ms, issued_ms_) < kRequestTimeoutMs) return -1;
      timed_out = finish(now_ms, exception_seen_ ? Outcome::EXCEPTION : Outcome::TIMEOUT, 0);
      if (finished_) return -1;  // a failed liveness step aborted the run
    }
    if (before(now_ms, start_ms_)) return -1;
    if (!before(now_ms, deadline_ms_)) { finished_ = true; return -1; }
    const int next = choose(now_ms);
    if (next < 0) return -1;
    outstanding_ = next;
    generation_++;
    issued_ms_ = now_ms;
    sends_ = 0;
    exception_seen_ = false;
    exception_code_ = 0;
    stats_[next].issued++;
    total_issued_++;
    return next;
  }

  // The hub reports a frame on the wire (fires again for each retry).
  void on_frame_sent(uint32_t now_ms, uint8_t function, uint16_t address) {
    if (outstanding_ < 0) return;
    const Request &r = kRequests[outstanding_];
    if (function != r.function || address != r.address) return;
    if (sends_ == 0) first_sent_ms_ = now_ms;
    last_sent_ms_ = now_ms;
    if (sends_ < 0xFF) sends_++;
  }

  // A parsed modbus_controller exception log line for the outstanding request.
  // The terminal record is produced right away: an exception response is final.
  Terminal on_exception(uint32_t now_ms, uint8_t function, uint16_t address, uint8_t exception) {
    if (outstanding_ < 0) return Terminal();
    const Request &r = kRequests[outstanding_];
    if (function != r.function || address != r.address) return Terminal();
    exception_seen_ = true;
    exception_code_ = exception;
    return finish(now_ms, Outcome::EXCEPTION, 0);
  }

  // A data callback for request `index` issued under `gen`. `data` is used
  // only to fill the fixed comparison/summary buffers; it is never logged.
  Terminal on_response(uint32_t now_ms, int index, uint32_t gen, const uint8_t *data, std::size_t got_bytes, uint32_t callback_us) {
    if (index < 0 || std::size_t(index) >= kRequestCount) return Terminal();
    if (outstanding_ != index || !jk_capability::callback_matches_pending_attempt(gen, generation_)) {
      stats_[index].late++;
      return Terminal();
    }
    const Request &r = kRequests[index];
    const Outcome o = classify_length(r.expected_bytes, got_bytes);
    if (o == Outcome::OK && data != nullptr) {
      std::memcpy(payload_[index].data(), data, r.expected_bytes);
      have_payload_[index] = true;
    }
    if (callback_us > stats_[index].callback_us_max) stats_[index].callback_us_max = callback_us;
    return finish(now_ms, o, got_bytes);
  }

  // Processing time of the data callback, measured by the caller around
  // on_response() (the ESP32 side of the dispatch decision, plan section 3).
  void note_callback_us(int index, uint32_t us) {
    if (index >= 0 && std::size_t(index) < kRequestCount && us > stats_[index].callback_us_max) stats_[index].callback_us_max = us;
  }

  // --- Evidence (metadata only) ---------------------------------------------
  // Comparison c: equal words of the two most recent OK payloads, or -1 when
  // either payload is missing.
  int comparison_equal_words(std::size_t c) const {
    const Comparison &k = kComparisons[c];
    if (!have_payload_[k.narrow] || !have_payload_[k.wide]) return -1;
    int equal = 0;
    for (uint16_t i = 0; i < k.word_count; i++) {
      const uint8_t *n = payload_[k.narrow].data() + 2 * i;
      const uint8_t *w = payload_[k.wide].data() + 2 * (k.word_offset + i);
      if (n[0] == w[0] && n[1] == w[1]) equal++;
    }
    return equal;
  }
  // Summary s: {zero words, total words} of the most recent OK wide payload, or
  // {-1, total} when missing.
  void summary_zero_words(std::size_t s, int &zero, int &total) const {
    const WordSet &k = kSummaries[s];
    total = k.words ? k.word_count : k.count;
    zero = -1;
    if (!have_payload_[k.wide]) return;
    const Request &w = kRequests[k.wide];
    zero = 0;
    for (int i = 0; i < total; i++) {
      const uint16_t addr = k.words ? k.words[i] : uint16_t(k.first_address + 2 * i);
      const std::size_t off = std::size_t(addr - w.address);  // byte offset = address delta
      const uint8_t *p = payload_[k.wide].data() + off;
      if (p[0] == 0 && p[1] == 0) zero++;
    }
  }

 private:
  static uint32_t elapsed(uint32_t now, uint32_t since) { return now - since; }
  static bool before(uint32_t now, uint32_t t) { return int32_t(now - t) < 0; }

  int choose(uint32_t now_ms) {
    const int a1 = index_of("A1"), a2 = index_of("A2"), c1 = index_of("C1"), c2 = index_of("C2");
    if (mode_ == Mode::A_COMPATIBILITY) {
      if (step_cursor_ >= kPassACount) { finished_ = true; return -1; }
      if (before(now_ms, next_pass_ms_)) return -1;
      current_step_ = int(step_cursor_);
      return kPassA[step_cursor_++].request;
    }
    // Telemetry first: A1 opens a cycle, A2 follows it.
    if (tele_pending_a2_) { tele_pending_a2_ = false; return a2; }
    if (!before(now_ms, tele_due_ms_)) {
      while (!before(now_ms, tele_due_ms_)) tele_due_ms_ += kTelemetryCadenceMs;  // never bunch missed cycles
      tele_pending_a2_ = true;
      return a1;
    }
    if (mode_ == Mode::C_COEXISTENCE) {
      if (settings_pending_c2_) { settings_pending_c2_ = false; return c2; }
      if (!before(now_ms, settings_due_ms_)) {
        while (!before(now_ms, settings_due_ms_)) settings_due_ms_ += kSettingsCadenceMs;
        settings_pending_c2_ = true;
        return c1;
      }
    }
    return -1;
  }

  Terminal finish(uint32_t now_ms, Outcome o, std::size_t got_bytes) {
    Terminal t;
    t.valid = true;
    t.request = outstanding_;
    t.outcome = o;
    t.got_bytes = uint16_t(got_bytes > 0xFFFF ? 0xFFFF : got_bytes);
    t.exception = exception_code_;
    t.sends = sends_;
    t.total_ms = elapsed(now_ms, issued_ms_);
    t.queue_ms = sends_ ? elapsed(first_sent_ms_, issued_ms_) : 0;
    t.bms_ms = sends_ ? elapsed(now_ms, last_sent_ms_) : 0;
    t.step = mode_ == Mode::A_COMPATIBILITY ? current_step_ : -1;
    t.match = outcome_matches(kRequests[outstanding_].expect, o, exception_code_);
    if (!t.match) unexpected_++;
    // Only a failed liveness step stops the run: no further request at all.
    if (mode_ == Mode::A_COMPATIBILITY && current_step_ >= 0 && kPassA[current_step_].role == Role::LIVENESS &&
        o != Outcome::OK) {
      aborted_ = true;
      abort_step_ = current_step_;
      finished_ = true;
    }
    RequestStats &s = stats_[outstanding_];
    s.outcomes[std::size_t(o)]++;
    if (sends_ > 1) s.resends += sends_ - 1;
    if (o == Outcome::OK || o == Outcome::SHORT || o == Outcome::LONG) {
      s.total_ms.add(t.total_ms);
      if (sends_) { s.queue_ms.add(t.queue_ms); s.bms_ms.add(t.bms_ms); }
    }
    if (o == Outcome::OK) {
      const uint32_t cadence = cadence_of(outstanding_);
      if (s.has_ok) s.ok_interval.add(elapsed(now_ms, s.last_ok_ms), cadence);
      s.last_ok_ms = now_ms;
      s.has_ok = true;
    }
    outstanding_ = -1;
    if (mode_ == Mode::A_COMPATIBILITY) next_pass_ms_ = now_ms + kPassSpacingMs;
    return t;
  }

  // Every member back to its default initializer below, field by field.
  void reset() {
    mode_ = Mode::A_COMPATIBILITY;
    begun_ = false; finished_ = false;
    run_ms_ = 0; start_ms_ = 0; deadline_ms_ = 0;
    outstanding_ = -1;
    generation_ = 0; issued_ms_ = 0; first_sent_ms_ = 0; last_sent_ms_ = 0;
    sends_ = 0; exception_code_ = 0;
    exception_seen_ = false;
    step_cursor_ = 0;
    current_step_ = -1;
    aborted_ = false;
    abort_step_ = -1;
    unexpected_ = 0;
    next_pass_ms_ = 0; tele_due_ms_ = 0; settings_due_ms_ = 0;
    tele_pending_a2_ = false; settings_pending_c2_ = false;
    total_issued_ = 0;
    for (RequestStats &s : stats_) s.reset();
    for (auto &p : payload_) p.fill(0);
    have_payload_.fill(false);
  }

  uint32_t cadence_of(int i) const {
    if (mode_ == Mode::A_COMPATIBILITY) return 0;
    if (i == index_of("A1") || i == index_of("A2")) return kTelemetryCadenceMs;
    return kSettingsCadenceMs;
  }

  Mode mode_ = Mode::A_COMPATIBILITY;
  bool begun_ = false, finished_ = false;
  uint32_t run_ms_ = 0, start_ms_ = 0, deadline_ms_ = 0;
  int outstanding_ = -1;
  uint32_t generation_ = 0, issued_ms_ = 0, first_sent_ms_ = 0, last_sent_ms_ = 0;
  uint8_t sends_ = 0, exception_code_ = 0;
  bool exception_seen_ = false;
  std::size_t step_cursor_ = 0;
  int current_step_ = -1;
  bool aborted_ = false;
  int abort_step_ = -1;
  uint32_t unexpected_ = 0;
  uint32_t next_pass_ms_ = 0, tele_due_ms_ = 0, settings_due_ms_ = 0;
  bool tele_pending_a2_ = false, settings_pending_c2_ = false;
  uint32_t total_issued_ = 0;
  std::array<RequestStats, kRequestCount> stats_{};
  std::array<std::array<uint8_t, kMaxExpectedBytes>, kRequestCount> payload_{};
  std::array<bool, kRequestCount> have_payload_{};
};

// Object size and stack-frame size are separate invariants: this bounds the
// static object (it lives in .data/.bss as g_probe); the per-function stack
// frames are bounded by test/jk_diag_probe/test_jk_diag_probe_stack.sh.
static_assert(sizeof(Probe) < 40 * 1024, "the probe state must stay small enough for ESP32 static RAM");

// Terminal records produced inside a logger callback are queued and logged
// later from the main-loop interval (logging from a log callback would recurse).
class LogQueue {
 public:
  bool push(const Terminal &t) {
    if (count_ == kCapacity) { dropped_++; return false; }
    items_[(head_ + count_) % kCapacity] = t;
    count_++;
    return true;
  }
  bool pop(Terminal &out) {
    if (count_ == 0) return false;
    out = items_[head_];
    head_ = (head_ + 1) % kCapacity;
    count_--;
    return true;
  }
  uint32_t dropped() const { return dropped_; }
  bool empty() const { return count_ == 0; }
  static constexpr std::size_t kCapacity = 8;

 private:
  std::array<Terminal, kCapacity> items_{};
  std::size_t head_ = 0, count_ = 0;
  uint32_t dropped_ = 0;
};

// The one probe and log queue of the diagnostic firmware (C++17 inline
// variables; the diagnostic YAML is their only user).
inline Probe g_probe;
inline LogQueue g_log_queue;

// --- Log formatting (metadata only; no payload parameter exists) ------------
inline int format_terminal(char *buf, std::size_t n, const Terminal &t) {
  if (!t.valid || t.request < 0) return std::snprintf(buf, n, "diag none");
  const Request &r = kRequests[t.request];
  return std::snprintf(buf, n,
                       "diag req=%s fc=%u addr=0x%04X n=%u exp=%u got=%u cls=%s exc=%u sends=%u queue_ms=%u bms_ms=%u total_ms=%u "
                       "step=%d expect=%s match=%d",
                       r.id, unsigned(r.function), unsigned(r.address), unsigned(r.count), unsigned(r.expected_bytes),
                       unsigned(t.got_bytes), outcome_name(t.outcome), unsigned(t.exception), unsigned(t.sends),
                       unsigned(t.queue_ms), unsigned(t.bms_ms), unsigned(t.total_ms), t.step < 0 ? 0 : t.step + 1,
                       expect_name(r.expect), t.match ? 1 : 0);
}

inline int format_request_stats(char *buf, std::size_t n, const Probe &p, std::size_t i) {
  const Request &r = kRequests[i];
  const RequestStats &s = p.stats(i);
  return std::snprintf(buf, n,
                       "diag stat req=%s issued=%u ok=%u short=%u long=%u exc=%u timeout=%u resends=%u late=%u "
                       "bms_ms p50=%u p95=%u p99=%u max=%u queue_ms max=%u total_ms max=%u cb_us max=%u "
                       "ok_interval_ms p99=%u max=%u over1.5x=%u missed=%u",
                       r.id, unsigned(s.issued), unsigned(s.outcomes[0]), unsigned(s.outcomes[1]), unsigned(s.outcomes[2]),
                       unsigned(s.outcomes[3]), unsigned(s.outcomes[4]), unsigned(s.resends), unsigned(s.late),
                       unsigned(s.bms_ms.percentile(0.50)), unsigned(s.bms_ms.percentile(0.95)), unsigned(s.bms_ms.percentile(0.99)),
                       unsigned(s.bms_ms.n ? s.bms_ms.max : 0), unsigned(s.queue_ms.n ? s.queue_ms.max : 0),
                       unsigned(s.total_ms.n ? s.total_ms.max : 0), unsigned(s.callback_us_max),
                       unsigned(s.ok_interval.percentile(0.99)), unsigned(s.ok_interval.max), unsigned(s.ok_interval.over_1_5x),
                       unsigned(s.ok_interval.missed));
}

inline int format_comparison(char *buf, std::size_t n, const Probe &p, std::size_t c) {
  const Comparison &k = kComparisons[c];
  const int eq = p.comparison_equal_words(c);
  return std::snprintf(buf, n, "diag cmp narrow=%s wide=%s words=%u equal=%d kind=%s", kRequests[k.narrow].id, kRequests[k.wide].id,
                       unsigned(k.word_count), eq, k.stable ? "stable" : "live");
}

inline int format_summary(char *buf, std::size_t n, const Probe &p, std::size_t s) {
  int zero = 0, total = 0;
  p.summary_zero_words(s, zero, total);
  return std::snprintf(buf, n, "diag sum set=%s words=%d zero=%d", kSummaries[s].id, total, zero);
}

inline int format_run(char *buf, std::size_t n, const Probe &p) {
  if (p.aborted())
    return std::snprintf(buf, n, "diag run mode=%s run_ms=%u issued=%u finished=%d unexpected=%u aborted=liveness@step%d",
                         mode_name(p.mode()), unsigned(p.run_ms()), unsigned(p.total_issued()), p.finished() ? 1 : 0,
                         unsigned(p.unexpected()), p.abort_step() + 1);
  return std::snprintf(buf, n, "diag run mode=%s run_ms=%u issued=%u finished=%d unexpected=%u aborted=no", mode_name(p.mode()),
                       unsigned(p.run_ms()), unsigned(p.total_issued()), p.finished() ? 1 : 0, unsigned(p.unexpected()));
}

// The final summary, one line per call so the device logs it one line per
// 10 ms interval tick (gate A 2026-09-28: logging it in one burst blocked the
// loop for ~559 ms). Line order: run, per-request stats, comparisons,
// summaries, "diag done". Returns the line length, or -1 past the last line.
constexpr std::size_t kSummaryLineCount = 1 + kRequestCount + kComparisonCount + kSummaryCount + 1;
inline int format_summary_line(char *buf, std::size_t n, const Probe &p, std::size_t line, uint32_t log_drops) {
  if (line == 0) return format_run(buf, n, p);
  line -= 1;
  if (line < kRequestCount) return format_request_stats(buf, n, p, line);
  line -= kRequestCount;
  if (line < kComparisonCount) return format_comparison(buf, n, p, line);
  line -= kComparisonCount;
  if (line < kSummaryCount) return format_summary(buf, n, p, line);
  line -= kSummaryCount;
  if (line == 0)
    return std::snprintf(buf, n, "diag done: no further Modbus requests until reboot (log queue drops=%u)", unsigned(log_drops));
  return -1;
}

}  // namespace jk_diag_probe
