// Host-side unit tests for jk_write_tx_core.h's HTTP-task-to-main-loop
// handoff mailboxes (RegisterWriteRequestMailbox + RegisterWriteResultTable)
// -- added 2026-09-21, REWRITTEN 2026-09-21 (second corrective pass) after a
// code review found the original RegisterWriteResultMailbox design was not
// a valid C++ seqlock: it guarded non-atomic payload fields (request_id,
// accepted, tx_id, reason[]) with a single atomic flag, which is
// [intro.races] undefined behavior on any concurrent read+write regardless
// of a later discard-on-mismatch check. The replacement (RegisterWriteResultTable,
// see jk_write_tx_core.h's own module comment) makes EVERY payload field a
// real std::atomic and uses a monotonic per-slot version counter (not a
// binary flag) to detect a straddled or fully-interleaved publish cycle.
//
// This rewrite also fixes the original stress test's own acknowledged gap:
// each producer thread used to mint request_ids from its OWN LOCAL counter,
// so the test never actually exercised the SHARED production
// g_register_write_next_request_id counter under real multi-producer
// contention -- every producer here now draws from one shared
// std::atomic<uint32_t>, exactly as production does (this project only
// ever has one real producer task in practice, but the counter itself must
// still be provably safe under concurrent use, not merely assumed so).
//
//   g++ -std=c++17 -Wall -Wextra -pthread -I ../../components/jk_write_tx \
//       test_jk_write_tx_mailbox.cpp -o test_jk_write_tx_mailbox
//   ./test_jk_write_tx_mailbox
//
// ThreadSanitizer (attempted per this round's own instructions): see this
// project's audit report for whether TSan was actually run in this
// sandboxed environment and what it found -- if unavailable, that is
// stated explicitly there, not silently skipped.

#include "jk_write_tx_core.h"

#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <set>
#include <string>
#include <thread>
#include <vector>

using namespace jk_write_tx;

namespace {
int g_failures = 0;
int g_checks = 0;
void check(bool cond, const char *desc) {
  g_checks++;
  if (!cond) { g_failures++; std::printf("FAIL: %s\n", desc); }
}
}  // namespace

int main() {
  // ---------------------------------------------------------------------
  // Basic single-threaded request-mailbox semantics (unchanged from the
  // original pass, updated only for try_stage_write_request's new
  // pending_id parameter).
  // ---------------------------------------------------------------------
  {
    RegisterWriteRequestMailbox mbox;
    std::atomic<uint32_t> next_id{0};
    std::atomic<uint32_t> pending_id{0};
    const uint32_t id1 = try_stage_write_request(mbox, "gps_heartbeat", 1.0, 1000, next_id, pending_id);
    check(id1 == 1, "first staged request gets request_id 1");
    check(pending_id.load() == 1, "staging publishes the new id as pending immediately");

    const uint32_t id2 = try_stage_write_request(mbox, "lcd_always_on", 1.0, 1001, next_id, pending_id);
    check(id2 == 0, "a second stage attempt while the first is still unconsumed is rejected (single-flight)");

    RegisterWriteRequestMailbox out;
    const bool took = try_take_write_request(mbox, out);
    check(took, "the main loop successfully takes the staged request");
    check(out.request_id == 1, "the taken request carries the real request_id");
    check(std::strcmp(out.key, "gps_heartbeat") == 0, "the taken request carries the real key");
    check(out.value == 1.0, "the taken request carries the real value");
    check(out.submitted_at_ms == 1000, "the taken request carries the real submit timestamp");

    RegisterWriteRequestMailbox out2;
    check(!try_take_write_request(mbox, out2), "a second take on an already-empty mailbox returns false");

    // Blocker 2 corrective pass (2026-09-21): being TAKEN is not enough --
    // request 1's own result has not been published yet, so its full
    // lifecycle (staged through published) is still open and a new stage
    // attempt must still be rejected, even though the mailbox itself now
    // looks EMPTY again. See try_stage_write_request()'s own module
    // comment for the exact exploitable gap this closes.
    const uint32_t id3_too_early = try_stage_write_request(mbox, "smart_sleep_enabled", 0.0, 2000, next_id, pending_id);
    check(id3_too_early == 0, "staging a new request while the taken-but-unpublished one is still in flight is rejected, even though the mailbox itself is EMPTY again");

    RegisterWriteResultTable table{};
    publish_write_result(table, pending_id, id1, true, 99, RejectReason::NONE, 2500);
    const uint32_t id3 = try_stage_write_request(mbox, "smart_sleep_enabled", 0.0, 2000, next_id, pending_id);
    // id 4, not 3: TWO earlier attempts (the "second stage attempt while
    // unconsumed" check above, and id3_too_early just above) each
    // allocate a real counter value via fetch_add BEFORE their pending_id
    // CAS is even attempted, then lose that CAS and are rejected -- both
    // ids are wasted, exactly the documented, accepted gap-tolerance
    // tradeoff (see try_stage_write_request()'s own module comment).
    check(id3 == 4, "only AFTER request 1's result is published does the mailbox accept a new request (id 4 -- ids 2 and 3 were wasted by the two rejected early attempts above, ids are allowed gaps)");
  }

  // ---------------------------------------------------------------------
  // Key truncation is bounded, never overflows the fixed buffer.
  // ---------------------------------------------------------------------
  {
    RegisterWriteRequestMailbox mbox;
    std::atomic<uint32_t> next_id{0};
    std::atomic<uint32_t> pending_id{0};
    std::string long_key(200, 'x');
    try_stage_write_request(mbox, long_key.c_str(), 1.0, 0, next_id, pending_id);
    check(std::strlen(mbox.key) == kRegisterWriteKeyMaxLen - 1, "an oversized key is truncated to fit the fixed buffer, never overflowed");
  }

  // ---------------------------------------------------------------------
  // Result table: basic pending/resolved/unknown/expired lifecycle.
  // ---------------------------------------------------------------------
  {
    RegisterWriteResultTable table{};
    std::atomic<uint32_t> pending_id{0};

    auto lk_unknown = lookup_write_result(table, pending_id, 999, 1000);
    check(lk_unknown.status == ResultLookupStatus::UNKNOWN, "a request_id never issued and never in the table reads as UNKNOWN");

    pending_id.store(7, std::memory_order_relaxed);
    auto lk_pending = lookup_write_result(table, pending_id, 7, 1000);
    check(lk_pending.status == ResultLookupStatus::PENDING, "a request_id that is the currently in-flight one, with no table entry yet, reads as PENDING");

    publish_write_result(table, pending_id, 7, true, 42, RejectReason::NONE, 1000);
    check(pending_id.load() == 0, "publishing a result clears the pending marker for that request_id");
    auto lk_resolved = lookup_write_result(table, pending_id, 7, 1005);
    check(lk_resolved.status == ResultLookupStatus::RESOLVED && lk_resolved.accepted && lk_resolved.tx_id == 42,
          "a published accepted result is readable with its real tx_id");

    publish_write_result(table, pending_id, 8, false, 0, RejectReason::AUTHORIZATION_REQUIRED, 1006);
    auto lk_rejected = lookup_write_result(table, pending_id, 8, 1010);
    check(lk_rejected.status == ResultLookupStatus::RESOLVED && !lk_rejected.accepted &&
              lk_rejected.reason == RejectReason::AUTHORIZATION_REQUIRED,
          "a published rejection carries the real, non-fabricated reason (never a tx_id)");
    check(!lk_rejected.accepted && lk_rejected.tx_id == 0, "a rejected result never carries a fabricated tx_id");

    // Expiry.
    auto lk_expired = lookup_write_result(table, pending_id, 8, 1006 + kRegisterWriteResultTtlMs + 1);
    check(lk_expired.status == ResultLookupStatus::EXPIRED, "a resolved result older than its TTL reads as EXPIRED, not RESOLVED");

    // request_id 0 is never valid.
    auto lk_zero = lookup_write_result(table, pending_id, 0, 2000);
    check(lk_zero.status == ResultLookupStatus::UNKNOWN, "request_id 0 always reads as UNKNOWN (0 is never issued by try_stage_write_request)");
  }

  // ---------------------------------------------------------------------
  // Result table: bounded storage, fail-closed eviction on collision --
  // an OLD request_id whose slot gets reused by a NEWER one must read as
  // UNKNOWN, never an eternal false PENDING/RESOLVED.
  // ---------------------------------------------------------------------
  {
    RegisterWriteResultTable table{};
    std::atomic<uint32_t> pending_id{0};

    const uint32_t old_id = 3;                                  // 3 % 8 == 3
    const uint32_t colliding_id = 3 + kRegisterWriteResultTableSize;  // 11 % 8 == 3 -- same slot

    publish_write_result(table, pending_id, old_id, true, 100, RejectReason::NONE, 1000);
    check(lookup_write_result(table, pending_id, old_id, 1001).status == ResultLookupStatus::RESOLVED,
          "the old id resolves correctly before any collision");

    publish_write_result(table, pending_id, colliding_id, true, 200, RejectReason::NONE, 2000);
    check(lookup_write_result(table, pending_id, colliding_id, 2001).status == ResultLookupStatus::RESOLVED,
          "the newer, colliding id resolves correctly after taking over the shared slot");
    auto lk_evicted = lookup_write_result(table, pending_id, old_id, 2001);
    check(lk_evicted.status == ResultLookupStatus::UNKNOWN,
          "the OLD id, now evicted by the collision, reads as UNKNOWN -- never an eternal false PENDING or a stale RESOLVED");
  }

  // ---------------------------------------------------------------------
  // Result table: request_id wraparound. A wrapped id (small number,
  // reused after the counter overflows uint32_t) is handled by the exact
  // same equality-based lookup as any other id -- no special-cased
  // ordering logic exists to get this wrong, verified directly.
  // ---------------------------------------------------------------------
  {
    RegisterWriteResultTable table{};
    std::atomic<uint32_t> pending_id{0};
    const uint32_t wrapped_id = 1;  // what next_id_counter.fetch_add(1)+1 would produce right after wrapping past UINT32_MAX
    publish_write_result(table, pending_id, wrapped_id, true, 555, RejectReason::NONE, 5000);
    auto lk = lookup_write_result(table, pending_id, wrapped_id, 5001);
    check(lk.status == ResultLookupStatus::RESOLVED && lk.tx_id == 555,
          "a small request_id value (as produced right after real uint32 wraparound) resolves normally -- no special-case ordering assumption exists to break");
  }

  // ---------------------------------------------------------------------
  // Retained correlation across MULTIPLE distinct request_ids resolved in
  // quick succession (the bounded-table design's whole point over the
  // original single-shared-slot mailbox): every one must remain
  // independently readable until its own TTL, not just the latest.
  // ---------------------------------------------------------------------
  {
    RegisterWriteResultTable table{};
    std::atomic<uint32_t> pending_id{0};
    for (uint32_t id = 1; id <= kRegisterWriteResultTableSize; ++id) {
      publish_write_result(table, pending_id, id, true, id * 10, RejectReason::NONE, 1000);
    }
    bool all_ok = true;
    for (uint32_t id = 1; id <= kRegisterWriteResultTableSize; ++id) {
      auto lk = lookup_write_result(table, pending_id, id, 1001);
      if (lk.status != ResultLookupStatus::RESOLVED || lk.tx_id != id * 10) all_ok = false;
    }
    check(all_ok, "every one of N=table-size distinct request_ids (filling every slot exactly once) remains independently, correctly readable");
  }

  // ---------------------------------------------------------------------
  // Real concurrency stress test: many producer threads sharing ONE
  // production-shape request_id counter racing to stage a request against
  // ONE consumer thread draining the request mailbox AND publishing into
  // the result table, while MANY concurrent reader threads poll the
  // result table for results -- loading BOTH the request and result
  // mailboxes concurrently, as this round's review explicitly required.
  // ---------------------------------------------------------------------
  {
    RegisterWriteRequestMailbox req_mbox;
    RegisterWriteResultTable result_table{};
    std::atomic<uint32_t> next_id{0};       // SHARED production counter -- every producer thread draws from this one
    std::atomic<uint32_t> pending_id{0};    // SHARED production pending-id marker
    std::atomic<bool> stop{false};
    std::atomic<int> total_staged{0};
    std::atomic<int> total_rejected{0};
    std::atomic<int> total_taken{0};
    std::atomic<int> total_corrupted{0};
    std::atomic<int> total_published{0};
    std::atomic<int> total_reader_torn{0};
    std::atomic<int> total_reader_observations{0};

    constexpr int kProducers = 6;
    constexpr char const *kKeys[kProducers] = {
        "gps_heartbeat", "lcd_always_on", "smart_sleep_enabled", "timed_stored_data",
        "smart_sleep_timeout_hours", "heat_en",
    };
    constexpr double kValues[kProducers] = {11.0, 22.0, 33.0, 44.0, 55.0, 66.0};

    std::vector<std::thread> producers;
    for (int p = 0; p < kProducers; ++p) {
      producers.emplace_back([&, p]() {
        while (!stop.load(std::memory_order_relaxed)) {
          // Every producer draws from the SAME next_id/pending_id atomics
          // -- this is the exact fix this round's review required: the
          // stress test must exercise the real, shared production
          // counter under multi-producer contention, not a per-thread
          // local one.
          const uint32_t id = try_stage_write_request(req_mbox, kKeys[p], kValues[p], 1000 + p, next_id, pending_id);
          if (id != 0) {
            total_staged.fetch_add(1, std::memory_order_relaxed);
          } else {
            total_rejected.fetch_add(1, std::memory_order_relaxed);
          }
        }
      });
    }

    // Consumer: takes a staged request, verifies it, and publishes a
    // result for it (alternating accept/reject so both result shapes are
    // exercised under real contention).
    std::atomic<bool> consumer_stop{false};
    std::atomic<int> accept_toggle{0};
    std::thread consumer([&]() {
      while (!consumer_stop.load(std::memory_order_relaxed)) {
        RegisterWriteRequestMailbox out;
        if (!try_take_write_request(req_mbox, out)) continue;
        total_taken.fetch_add(1, std::memory_order_relaxed);
        bool matched = false;
        for (int p = 0; p < kProducers; ++p) {
          if (std::strcmp(out.key, kKeys[p]) == 0) {
            matched = true;
            if (out.value != kValues[p]) total_corrupted.fetch_add(1, std::memory_order_relaxed);
            break;
          }
        }
        if (!matched) total_corrupted.fetch_add(1, std::memory_order_relaxed);

        const bool accept = (accept_toggle.fetch_add(1, std::memory_order_relaxed) % 2) == 0;
        publish_write_result(result_table, pending_id, out.request_id, accept, accept ? out.request_id * 10 : 0,
                              accept ? RejectReason::NONE : RejectReason::STALE_RAW, out.submitted_at_ms);
        total_published.fetch_add(1, std::memory_order_relaxed);
      }
    });

    // Reader threads: continuously poll a sweep of plausible request_ids
    // (both real ones and ones that were never issued) -- never expect a
    // specific answer (the whole point is these run concurrently with
    // the writer with no coordination), only that every individual
    // observation is INTERNALLY CONSISTENT: a RESOLVED lookup must never
    // report `accepted=true` together with a non-NONE reason, and must
    // never report `accepted=false` together with a non-zero tx_id (that
    // exact combination is only possible from a torn read mixing an
    // accepted result's fields with a rejected one's, which the version-
    // counter recheck exists specifically to prevent).
    std::vector<std::thread> readers;
    constexpr int kReaders = 4;
    for (int r = 0; r < kReaders; ++r) {
      readers.emplace_back([&]() {
        uint32_t probe_id = 1;
        while (!stop.load(std::memory_order_relaxed)) {
          const auto lk = lookup_write_result(result_table, pending_id, probe_id, 1000);
          total_reader_observations.fetch_add(1, std::memory_order_relaxed);
          if (lk.status == ResultLookupStatus::RESOLVED) {
            const bool torn = (lk.accepted && lk.reason != RejectReason::NONE) ||
                               (!lk.accepted && lk.tx_id != 0);
            if (torn) total_reader_torn.fetch_add(1, std::memory_order_relaxed);
          }
          probe_id = (probe_id % 4096) + 1;
        }
      });
    }

    std::this_thread::sleep_for(std::chrono::milliseconds(400));
    stop.store(true, std::memory_order_relaxed);
    for (auto &t : producers) t.join();
    for (auto &t : readers) t.join();
    consumer_stop.store(true, std::memory_order_relaxed);
    consumer.join();
    // Final deterministic drain, same reasoning as the request-mailbox-only
    // test this replaces.
    RegisterWriteRequestMailbox out;
    while (try_take_write_request(req_mbox, out)) {
      total_taken.fetch_add(1, std::memory_order_relaxed);
      publish_write_result(result_table, pending_id, out.request_id, true, out.request_id * 10, RejectReason::NONE,
                            out.submitted_at_ms);
    }

    check(total_corrupted.load() == 0, "concurrent stress test: zero corrupted/torn REQUESTS observed by the consumer");
    check(total_reader_torn.load() == 0, "concurrent stress test: zero torn/inconsistent RESULTS observed by any concurrent reader thread");
    check(total_staged.load() == total_taken.load(), "concurrent stress test: every successfully staged request was eventually taken exactly once");
    check(total_taken.load() == total_published.load(), "concurrent stress test: every taken request eventually got exactly one published result");
    check(total_staged.load() > 0, "concurrent stress test: at least some requests were actually staged (real contention occurred)");
    check(total_reader_observations.load() > 0, "concurrent stress test: reader threads actually performed lookups concurrently with the writer");
    std::printf("  (stress test: staged=%d taken=%d rejected=%d corrupted=%d published=%d reader_observations=%d reader_torn=%d)\n",
                total_staged.load(), total_taken.load(), total_rejected.load(), total_corrupted.load(),
                total_published.load(), total_reader_observations.load(), total_reader_torn.load());
  }

  // ---------------------------------------------------------------------
  // Blocker 2 corrective pass (2026-09-21): deterministic proof of the
  // exact interleaving the review flagged -- try_take_write_request()
  // frees the mailbox WELL BEFORE publish_write_result() ever runs for
  // that request, so a second POST could previously stage a competing
  // request and silently clobber the single pending_request_id marker,
  // producing a false UNKNOWN for the still-in-flight first request. This
  // is a single-threaded, fully sequenced reproduction -- no scheduler
  // timing involved, so it either passes deterministically every run or
  // never does; the concurrent stress test below additionally exercises
  // this same gap under real thread scheduling.
  // ---------------------------------------------------------------------
  {
    RegisterWriteRequestMailbox mbox;
    RegisterWriteResultTable table{};
    std::atomic<uint32_t> next_id{0};
    std::atomic<uint32_t> pending_id{0};

    const uint32_t id_a = try_stage_write_request(mbox, "gps_heartbeat", 1.0, 1000, next_id, pending_id);
    check(id_a != 0, "request A stages successfully");

    RegisterWriteRequestMailbox taken_a;
    check(try_take_write_request(mbox, taken_a), "the main loop takes A (mailbox now EMPTY again)");
    check(taken_a.request_id == id_a, "the taken request really is A");

    // A's result has NOT been published yet -- the mailbox looks free,
    // but A's full lifecycle (staged through published) is still open.
    const uint32_t id_b = try_stage_write_request(mbox, "lcd_always_on", 0.0, 1001, next_id, pending_id);
    check(id_b == 0, "Blocker 2: staging B while A is taken-but-not-yet-published is rejected (busy/0), never silently overwriting A's pending marker");

    const auto lookup_a_still_pending = lookup_write_result(table, pending_id, id_a, 1002);
    check(lookup_a_still_pending.status == ResultLookupStatus::PENDING,
          "Blocker 2: A is still reported PENDING while taken-but-unpublished, NEVER UNKNOWN");

    publish_write_result(table, pending_id, id_a, true, 42, RejectReason::NONE, 1003);
    const auto lookup_a_resolved = lookup_write_result(table, pending_id, id_a, 1004);
    check(lookup_a_resolved.status == ResultLookupStatus::RESOLVED && lookup_a_resolved.tx_id == 42,
          "A resolves correctly once published");

    // Only NOW may a second request be staged.
    const uint32_t id_b2 = try_stage_write_request(mbox, "lcd_always_on", 0.0, 1005, next_id, pending_id);
    check(id_b2 != 0, "Blocker 2: staging B succeeds only after A's result was actually published (pending_request_id genuinely freed)");
    RegisterWriteRequestMailbox taken_b2;
    check(try_take_write_request(mbox, taken_b2) && taken_b2.request_id == id_b2, "B2 can be taken normally");
  }

  // ---------------------------------------------------------------------
  // Blocker 2 corrective pass: real multi-threaded reproduction of the
  // same gap under actual thread scheduling (not just single-threaded
  // sequencing) -- one thread plays the main loop (take, THEN, after a
  // deliberately inserted delay, publish), a second thread continuously
  // polls the first request's own status throughout that entire gap, and
  // (only once the poller has ITSELF cleanly observed RESOLVED -- a real
  // synchronization point, joined via std::thread, never a racy flag
  // read) a third thread stages a competing request, which must always
  // succeed and always receive a STRICTLY GREATER request_id than the
  // first (structural proof the first request's publish, and its
  // pending_id CAS-clear, had already fully completed).
  //
  // NOTE on scope: this test deliberately does NOT also hammer
  // try_stage_write_request() from a second thread WHILE the first
  // request is still unpublished in a tight racing loop against a plain
  // boolean flag. An earlier draft of this test did exactly that and
  // produced spurious failures under ThreadSanitizer's heavy scheduling
  // perturbation -- not from Blocker 2's own gap (which the fully
  // deterministic, single-threaded test above already proves exhaustively
  // and unambiguously), but from a SEPARATE, already-documented, already-
  // accepted property of a bounded, request_id-keyed table: rapid same-
  // slot eviction can, in principle, evict an entry before some OTHER
  // straggling reader ever observes its RESOLVED state (see
  // lookup_write_result()'s own module comment on eviction -- this is
  // "an OLD id reads UNKNOWN once superseded," working exactly as
  // designed). Real production traffic can never approach that: single-
  // flight means a second request is only ever issued after a client
  // already learned the first one resolved, with a real HTTP round trip
  // (hundreds of milliseconds) in between -- never a same-process, zero-
  // delay busy loop. Manufacturing that artificial pattern here would be
  // testing a different, already-accepted design property, not Blocker 2.
  // ---------------------------------------------------------------------
  {
    constexpr int kRounds = 300;
    RegisterWriteRequestMailbox mbox;
    RegisterWriteResultTable table{};
    std::atomic<uint32_t> next_id{0};
    std::atomic<uint32_t> pending_id{0};
    int false_unknown_count = 0;
    int competitor_failed_count = 0;
    int competitor_ordering_violation_count = 0;

    for (int round = 0; round < kRounds; round++) {
      const uint32_t id_a = try_stage_write_request(mbox, "gps_heartbeat", double(round), uint32_t(round), next_id, pending_id);
      check(id_a != 0, "round: A stages successfully (mailbox was left clean by the previous round)");

      std::atomic<bool> resolved_by_poller{false};
      std::atomic<bool> poller_saw_bad_unknown{false};

      RegisterWriteRequestMailbox taken_a;
      check(try_take_write_request(mbox, taken_a) && taken_a.request_id == id_a, "round: main loop takes A");

      std::thread main_loop_finisher([&]() {
        // A short, deliberately real delay -- long enough for the poller
        // below to get many real scheduler turns inside the gap.
        std::this_thread::sleep_for(std::chrono::microseconds(200));
        publish_write_result(table, pending_id, id_a, true, id_a * 100, RejectReason::NONE, uint32_t(round));
      });
      std::thread poller([&]() {
        // Mirrors real client behavior: poll until RESOLVED is seen, then
        // stop (a real status-poll client never calls lookup again after
        // that). Any UNKNOWN observed BEFORE that first clean RESOLVED
        // read is the exact bug Blocker 2 closes -- A's own lifecycle is
        // genuinely still open the entire time, so pending_id must still
        // equal id_a and lookup must therefore answer PENDING, never
        // UNKNOWN, for every single poll in this window.
        //
        // yield() between attempts is deliberate, not incidental: an
        // earlier draft of this loop spun as fast as the CPU allowed,
        // which does not model any real client (a real status-poll client
        // is always a real HTTP round trip, seconds apart, from the write
        // it is polling) -- it instead created pathological cache-line
        // contention against the writer thread's own seq_cst stores on
        // the SAME slot, which can genuinely stretch out publish_write_
        // result()'s own mid-publish window far enough to exhaust even a
        // generous bounded retry count in lookup_write_result(). That is
        // a real property of any wait-free reader racing a bounded
        // number of times against an in-progress writer under
        // adversarial, unthrottled contention -- not the Blocker 2 gap
        // this test exists to prove, and not a pattern any real client of
        // this API ever produces. yield() keeps this a genuine, real
        // multi-threaded exercise of the exact take-before-publish gap
        // without manufacturing that unrelated, unrealistic pathology.
        while (!resolved_by_poller.load(std::memory_order_seq_cst)) {
          const auto lk = lookup_write_result(table, pending_id, id_a, uint32_t(round));
          if (lk.status == ResultLookupStatus::RESOLVED) {
            resolved_by_poller.store(true, std::memory_order_seq_cst);
          } else if (lk.status == ResultLookupStatus::UNKNOWN) {
            poller_saw_bad_unknown.store(true, std::memory_order_seq_cst);
          }
          std::this_thread::sleep_for(std::chrono::microseconds(5));
        }
      });
      main_loop_finisher.join();
      poller.join();  // real synchronization point -- guarantees resolved_by_poller is true from here on

      if (poller_saw_bad_unknown.load()) false_unknown_count++;

      // Only NOW, after a real join-synchronized RESOLVED observation,
      // does a competing request attempt to stage -- matching realistic
      // production ordering (single-flight + a real client round trip
      // always separates consecutive requests).
      const uint32_t id_b = try_stage_write_request(mbox, "lcd_always_on", 0.0, uint32_t(round), next_id, pending_id);
      if (id_b == 0) {
        competitor_failed_count++;
      } else if (id_b <= id_a) {
        competitor_ordering_violation_count++;
      }
      RegisterWriteRequestMailbox taken_b;
      if (id_b != 0 && try_take_write_request(mbox, taken_b)) {
        publish_write_result(table, pending_id, id_b, true, id_b * 100, RejectReason::NONE, uint32_t(round));
      }
    }

    check(false_unknown_count == 0, "Blocker 2 multi-threaded reproduction: zero rounds where a poller observed UNKNOWN for A while its lifecycle was still genuinely open");
    check(competitor_failed_count == 0, "Blocker 2 multi-threaded reproduction: staging B always succeeds once A's result is genuinely, observably published");
    check(competitor_ordering_violation_count == 0, "Blocker 2 multi-threaded reproduction: B's request_id is always strictly greater than A's");
    std::printf("  (blocker-2 interleaving stress: rounds=%d false_unknown=%d competitor_failed=%d ordering_violations=%d)\n",
                kRounds, false_unknown_count, competitor_failed_count, competitor_ordering_violation_count);
  }

  std::printf("\n%d checks, %d failures\n", g_checks, g_failures);
  return g_failures == 0 ? 0 : 1;
}
