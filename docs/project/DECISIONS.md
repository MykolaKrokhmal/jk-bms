# Architecture and Product Decisions

> **Status: AUTHORITATIVE decision record (principles).** Moved from the root
> `codex DECISIONS.md` in the 2026-09-25 cleanup. Decisions describe intent,
> not progress. Current state: [`PROJECT_STATE.md`](PROJECT_STATE.md) and
> [`CURRENT_LIMITATIONS.md`](CURRENT_LIMITATIONS.md); current plan:
> [`RS485_UNIFIED_PARAMETER_PIPELINE_PLAN.md`](RS485_UNIFIED_PARAMETER_PIPELINE_PLAN.md).
>
> **Status review 2026-09-25.** Each entry below was not individually
> revalidated. The one confirmed divergence is resolved: on 2026-09-25 the
> owner confirmed explicit binary dropdowns, so "Two-state settings use
> confirmed toggles" is superseded (see "Binary RW settings use explicit
> dropdowns" below). "V2
> source must be mandatory in the release gate" now reads: the V2 workbook is
> committed under `protocol/evidence/` and always used, while the private V1
> workbook is optional (see `CLAUDE.md`).

Цей файл фіксує рішення, а не поточний progress. Стан реалізації див. у `PROJECT_STATE.md`. Дати в історичних docs можуть відрізнятися; нижче збережено актуальний зміст рішень.

## Decision: Official JK-PB Modbus V1.1 + verified V2 workbook are the protocol foundation

**Context:** Старий каталог і workbook покривали лише частину `0x1000+` register space. У репозиторії upstream були також PDFs для класичного BLE/UART протоколу `0x79–0xC0`, що спричинило суперечливі аудити.

**Decision:** Первинна register geometry/access походить з `BMS_RS485_Modbus_V1.1.pdf`; нормалізована робоча модель, переклади, ambiguity/status і UI grouping — з `LiFePO4_BMS_Parameters_registers-V2_verified.xlsx`. Current implementation/upstream лише corroborating evidence.

**Reason:** Це єдині доступні джерела саме для JK-PB 16-bit Modbus map.

**Alternatives considered:** старий V1 workbook; `syssi/esphome-jk-bms` docs; current YAML як source of truth.

**Rejected approaches:** BLE/UART `0x79–0xC0` або CAN docs; circular validation implementation проти себе; мовчазне перекриття PDF даними workbook.

**Status:** Active; pipeline migration is not yet implemented.

## Decision: Evidence claims and implementation status are separate

**Context:** Наявність адреси в YAML або успішного write коду помилково подавалась як protocol verification.

**Decision:** Для кожного поля окремо зберігати evidence/provenance, verification status, declared access, effective access, safety class і runtime mapping.

**Reason:** Код доводить лише реалізацію. Без незалежного evidence небезпечний write не стає підтвердженим.

**Alternatives considered:** один `verified: true`; owner override як verification.

**Rejected approaches:** підробляти `verification_status`; рахувати owner risk acceptance protocol proof.

**Status:** Active.

## Decision: Fail closed for uncertain writes

**Context:** Частина RW fields має невідому geometry, enum semantics, model support або небезпечний physical effect.

**Decision:** Declared RW може мати effective R/unsupported. Hazardous, topology, credential, packed або ambiguous writes блокуються до виконання окремого evidence/safety gate.

**Reason:** Помилковий write може вимкнути BMS, пошкодити sibling field або зробити pack configuration небезпечною.

**Alternatives considered:** показати всі RW як editable; owner override для всіх.

**Rejected approaches:** масове розблокування 46/46 лише тому, що mobile app має ці поля.

**Status:** Active.

## Decision: One authoritative generated catalog, not parallel hand-maintained lists

**Context:** `register_catalog.json`, JS maps, YAML entities, mock fixtures та spreadsheets дрейфували.

**Decision:** Після V2 migration одна validated source model генерує runtime/frontend/test projections atomically. Generated files не редагуються вручну.

**Reason:** Виключає address/unit/access/order drift і mixed-generation release.

**Alternatives considered:** продовжити дві canonical JSON + окремий V2 manifest; ручний `SETTING_DEFS`.

**Rejected approaches:** regex/`String.includes()` як доказ повного mapping; кілька незалежних generators без shared release ID.

**Status:** Active as target architecture; current repository is transitional.

## Decision: V2 source must be mandatory in the release gate

**Context:** `test/run_all.sh` може завершитися success, якщо workbook не передано, а pipeline позначено skipped.

**Decision:** Release/Ready suite повинен fail closed, якщо verified V2 workbook або official source fingerprint відсутній, stale чи incompatible.

**Reason:** Зелені unit/mock tests не доводять відповідність актуальному протоколу.

**Alternatives considered:** optional pipeline in developer fast suite.

**Rejected approaches:** називати optional fast suite «All suites passed» або release proof.

**Status:** Decided; not yet working with V2.

## Decision: Preserve SSE-driven live updates

**Context:** Запропонований Stage 5 описував client-side polling для різних cadence.

**Decision:** ESPHome/Modbus scheduler керує polling; browser отримує data через SSE. Browser може робити explicit transaction reads/recovery, але не дублює постійний Modbus cadence.

**Reason:** Один scheduler, менше traffic/races, відповідає ESPHome architecture.

**Alternatives considered:** browser polling every 1–300 s.

**Rejected approaches:** незалежний browser polling як основа freshness.

**Status:** Active.

## Decision: Freshness belongs to each value, not the connection alone

**Context:** EventSource може бути OPEN, коли BMS data stale або окрема entity давно не оновлювалась.

**Decision:** Кожна displayed entity/derived value має source lineage, update timestamp, freshness budget, stale state і explanation. Writable controls fail closed on stale prerequisites.

**Reason:** Transport health і data validity різні.

**Alternatives considered:** global BMS-online badge; 5-second sweep без per-field metadata.

**Rejected approaches:** вважати всі values fresh при SSE open; називати Stage 5 complete при null budgets.

**Status:** Active; partially implemented.

## Decision: Terminal write success requires authoritative readback

**Context:** HTTP 200, ACK або entity update можуть стосуватися старого значення/іншого client.

**Decision:** UI success тільки після exact transaction's fresh readback matches normalized requested raw value. Mismatch restores authoritative readback. Timeout becomes uncertain until recovery resolves it.

**Reason:** Prevent false green success.

**Alternatives considered:** optimistic UI; POST success; any matching SSE value.

**Rejected approaches:** entity SSE equality as terminal proof; fixed sleep then assume success.

**Status:** Active; generic snapshot/recovery implemented, exact request handle still planned.

## Decision: Custom exact transaction API

**Context:** Standard ESPHome set endpoint does not return `tx_id` or generation.

**Decision:** Add authenticated structured endpoint returning accepted/rejected plus exact `tx_id`, key, address, generation/reason; expose versioned terminal snapshot/journal and correlate frontend exclusively by returned identity.

**Reason:** Required for multiple clients, out-of-order events, collision and reconnect correctness.

**Alternatives considered:** infer newest transaction by address/timestamp; one global last-result entity.

**Rejected approaches:** address-only heuristic as final architecture.

**Status:** Planned, P0.

## Decision: Generation-safe callbacks and per-address single flight

**Context:** Late callbacks could mutate a reused slot; concurrent writes to one address could race.

**Decision:** Each slot has generation/tx/address identity; callbacks verify all; one pending transaction per physical address; rejections get durable-enough distinct records.

**Reason:** Prevent stale callback corruption.

**Alternatives considered:** capture slot index only; queue all writes.

**Rejected approaches:** silently reuse terminal slot while callbacks can arrive.

**Status:** Implemented and unit/mock tested; hardware/browser fault proof pending.

## Decision: Timeout is WRITE_UNCERTAIN

**Context:** Lost ACK/readback does not say whether BMS applied the write.

**Decision:** Keep same-address write blocked, perform periodic fresh recovery reads, resolve as recovered-confirmed or recovered-mismatch.

**Reason:** Avoid false positive and false negative.

**Alternatives considered:** immediate red failure; immediate cached restore; optimistic green.

**Rejected approaches:** freeing slot immediately after timeout.

**Status:** Implemented for generic manager and bespoke CellCount; HIL proof pending.

## Decision: Atomic fresh read-modify-write for packed registers

**Context:** Multiple logical fields share a physical register.

**Decision:** Serialize by physical address; fresh pre-read full word; merge target mask only; write; fresh full readback; verify target and sibling preservation.

**Reason:** Cached sibling may be stale and whole-word write may corrupt independent settings.

**Alternatives considered:** cached sibling; mask `-1`; separate subfield writes.

**Rejected approaches:** unlocking packed fields before this exists.

**Status:** Planned, P0; current packed fields remain blocked.

## Decision: CellCount is not the sole topology truth

**Context:** Setting 8 instead of 16 did not consistently update charts, cells, pack voltage or backend state. Trusting configured value can hide real connected/measured channels.

**Decision:** A resolver confirms topology from configured count, connected mask, measured values, freshness and last confirmed state, published as one revisioned atomic snapshot.

**Reason:** Prevent inconsistent UI/aggregates and unsafe reconfiguration.

**Alternatives considered:** immediately use configured CellCount; infer solely from nonzero voltages.

**Rejected approaches:** constant `CELL_COUNT=16` as business logic; `configured CellCount` alone; applying partial multi-entity snapshot.

**Status:** Partially implemented for 16S; full consumer/capability migration planned.

## Decision: 32S support is capability gated

**Context:** Official protocol has 32 voltage/resistance channels, but deployed model is observed as 16S and current code declares 16.

**Decision:** Build topology/catalog to represent protocol maximum, but enable channels only when device model/firmware/capability evidence supports them. Never force 32S on a 16S device.

**Reason:** Protocol capacity is not proof of a particular model's physical topology.

**Alternatives considered:** stay globally 16 forever; blindly expose 32.

**Rejected approaches:** use one constant for protocol max, model max and active count.

**Status:** Planned.

## Decision: Settings and Diagnostics have disjoint semantics

**Context:** BMS register rows, derived state, runtime, Wi-Fi and UI info were mixed and duplicated.

**Decision:** Settings contains complete grouped protocol R/RW/W data; Diagnostics contains only derived ESPHome and ESP32/browser/UI operational data. Classification is generated and DOM-tested.

**Reason:** Makes access semantics and source provenance understandable.

**Alternatives considered:** one generic entity dump; duplicate rows in both tabs.

**Rejected approaches:** manual exclusion lists; headings `ЗНАЧЕННЯ ПАРАМЕТРІВ BMS` and `Фактично отримано від ESPHome`.

**Status:** Active; mostly implemented for old catalog, structurally incomplete for V2 and one orphan key.

## Decision: No separate duplicate Control tab

**Context:** Окрема вкладка містила charge/discharge/balance toggles, які по суті дублювали protocol controls у Settings і створювали два UI шляхи до тих самих BMS actions.

**Decision:** Не підтримувати окрему duplicate Control tab, якщо ті самі controls коректно представлені в grouped Settings з однаковою transaction/safety policy. Поточна navigation має шість sections без окремої Control tab.

**Reason:** Один керований шлях зменшує дублювання, access-policy drift і ризик різної write поведінки.

**Alternatives considered:** лишити швидку control panel; дублювати controls із shared handlers.

**Rejected approaches:** два незалежні редактори/перемикачі для одного register.

**Status:** Active product direction; current absence is implemented, but a dedicated regression/explicit final acceptance is still missing.

## Decision: Settings grouping must be explicit, not inferred

**Context:** Workbook contains 12 proposed groups but register rows have a separate coarse 8-section label and no deterministic foreign key/order.

**Decision:** Add an explicit reviewed per-row group/order mapping to normative data before generating UI groups.

**Reason:** Guessing creates a UI that looks organized but is not traceable to user-approved semantics.

**Alternatives considered:** fuzzy name matching; map 8 sections to 12 groups heuristically.

**Rejected approaches:** populate `ui_order` by row number without group contract.

**Status:** Active, unresolved input/model gap.

## Decision: Preserve protocol precision and one displayed value

**Context:** UI showed duplicated rounded/raw strings such as `3.500 V · 3.5`.

**Decision:** Show one value using protocol/readback precision and one localized unit. Do not append a duplicate raw state.

**Reason:** Removes ambiguity while preserving actual protocol resolution.

**Alternatives considered:** rounded display plus raw debug suffix.

**Rejected approaches:** duplicate value in normal Settings/Diagnostics.

**Status:** Active, implemented for current register rows.

## Decision: Localized units live inside editor suffix

**Context:** Units were mixed in parameter names, values and wrong alphabets.

**Decision:** Parameter name excludes unit; editor wrapper displays localized suffix. Ukrainian uses Ukrainian abbreviations; English uses English abbreviations.

**Reason:** Consistent editable field and language correctness.

**Alternatives considered:** unit after comma in label; unit outside input.

**Rejected approaches:** English Latin unit in Ukrainian where localized symbol is expected; double unit.

**Status:** Active.

## Decision: Two-state settings use confirmed toggles — SUPERSEDED (2026-09-25)

> **Superseded** by "Binary RW settings use explicit dropdowns" below (owner
> decision, 2026-09-25). Kept as historical context only.

**Context:** Two-value dropdowns were slow and visually inconsistent.

**Decision:** Use toggle; changing it opens/enters a confirmation state rather than placing an OK button beside the toggle.

**Reason:** Matches control semantics while preventing accidental BMS writes.

**Alternatives considered:** `<select>` with two values; toggle plus permanent OK.

**Rejected approaches:** immediate write on first tap without confirmation.

**Status:** Superseded on 2026-09-25; never the implemented Settings behaviour after commit `00f43db`.

## Decision: Binary RW settings use explicit dropdowns

**Context:** The generated Settings catalog renders binary (BIT / two-state) RW fields as an explicit two-option dropdown (commit `00f43db`, "BIT-field dropdown rendering"). The owner confirmed this design on 2026-09-25.

**Decision:** Binary RW fields in Settings use an explicit dropdown with localized option labels and the same OK / confirmation / write-transaction path as every other RW field. They are not toggle switches.

**Reason:**
- The selected value is unambiguous: the control shows the value text, not a switch position.
- The draft is visible before submission and is preserved across SSE updates, like any other editor.
- It works with per-value freshness and fail-closed gating: submission is disabled unless the field is `fresh`.
- It avoids an accidental immediate-toggle gesture on a control that writes to the BMS.
- Submission still goes through the existing confirmation and exact-transaction path, with authoritative readback before success.

**Alternatives considered:** a toggle that enters a confirmation state (the superseded decision above); a toggle with a permanent OK button.

**Rejected approaches:** any control that writes on first tap/change without explicit submission.

**Status:** Active; implemented behaviour, covered by `test/protocol_catalog/test_settings_catalog.js`.

## Decision: Numeric write button has deterministic state UX

**Context:** User required visible write/readback lifecycle.

**Decision:** Blue `OK` idle; muted orange `>>` disabled while writing/readback; muted green check about one second on confirmed match; red `×` about one second on mismatch and restore readback; then blue `OK`. Control remains disabled whenever not idle.

**Reason:** Clear result without allowing duplicate submissions.

**Alternatives considered:** spinner/toast only; persistent terminal color.

**Rejected approaches:** button enabled during `>>`; failure without restoring actual BMS value.

**Status:** Implemented in current UI paths, browser/HIL timing proof pending.

## Decision: Preserve input focus and dirty drafts across SSE

**Context:** Cursor disappeared because the register list was rebuilt while typing.

**Decision:** Incremental update where possible; otherwise capture focused element/value/selection/dirty state and restore after rebuild. Authoritative overwrite only on terminal mismatch/rejection policy.

**Reason:** Continuous SSE must not make settings impossible to edit.

**Alternatives considered:** pause all updates while any field focused; rebuild whole list on every event.

**Rejected approaches:** uncontrolled `input.value=` on each SSE.

**Status:** Implemented; E2E regression planned.

## Decision: Setup passcode stays fail closed

**Context:** Vendor extension/address behavior and readback cannot safely verify a credential write; earlier UI exposed a form with HTTP-only outcome.

**Decision:** Remove/disable passcode editor and refuse backend write until a redacted exact transaction policy, model capability evidence and safe hardware validation exist.

**Reason:** Credential secrecy and unverifiable write risk.

**Alternatives considered:** 8-word encoding and “sent—unverified”; store masked result.

**Rejected approaches:** passcode in URL/log/DOM; green success without readback.

**Status:** Active.

## Decision: Demo reuses production frontend

**Context:** Separate demo copy had risk of visual/behavior drift.

**Decision:** Mock server serves root `jk_bms.js`/`jk_bms.css` directly; only backend/dev panel are mock-only.

**Reason:** Browser demo exercises actual production frontend.

**Alternatives considered:** independent demo bundle.

**Rejected approaches:** claim demo proves RS485/hardware.

**Status:** Active.

## Decision: LittleFS A/B persistence only after production migration validation

**Context:** 60-hour history must survive reboot, but partition changes can brick/update-fail a device.

**Decision:** Use CRC-validated A/B committed snapshots; keep PoC isolated until production partition, flash, OTA, recovery, corruption and power-loss tests pass.

**Reason:** Atomic recovery and safe rollback outweigh quick wiring.

**Alternatives considered:** single file overwrite; preferences/NVS; wire PoC immediately.

**Rejected approaches:** call persistence complete after unit tests/compile only.

**Status:** Design/PoC implemented; production integration planned.

## Decision: Trusted LAN/VPN deployment, no direct Internet exposure

**Context:** Current web server is HTTP with Digest; authentication is not transport encryption, and CORS/CSRF model is incomplete.

**Decision:** Deploy only on trusted local network or through VPN/reverse protective boundary. Keep API encryption, OTA/fallback AP/web secrets distinct.

**Reason:** Embedded HTTP stack is not a public Internet security boundary.

**Alternatives considered:** expose port 80 publicly because Digest is enabled.

**Rejected approaches:** treat Digest as encryption.

**Status:** Active; threat model hardening planned.

## Decision: No hardware mutation without an explicit lab plan

**Context:** CellCount and protection settings can affect a live battery pack.

**Decision:** Default audit is read-only. A write requires explicit user authorization, safe field/pack state, pre-state/raw trace, expected outcome, abort criteria and rollback.

**Reason:** Prevent battery/BMS damage and preserve forensic evidence.

**Alternatives considered:** test convenient RW fields on production hardware ad hoc.

**Rejected approaches:** bulk write verification or CellCount transition without physical topology match.

**Status:** Active.

## Decision: `Готово` is an evidence gate, not a prose verdict

**Context:** Earlier reports used broad completion language after compile/mock checks while P0/P1 and hardware work remained.

**Decision:** Ready only with P0=0, P1=0, accepted P2, clean reproducible V2 release, browser E2E, HIL/faults, persistence/security/rollback and 72-hour soak evidence with hashes.

**Reason:** Safety-critical embedded configuration cannot be certified by source inspection alone.

**Alternatives considered:** percentage complete; “ready except hardware.”

**Rejected approaches:** compile/mock/read-only 16S as Ready.

**Status:** Active.

## Decision: Freshness budget = cadence + one absolute scheduling allowance

**Context:** The owner saw the 0x1114 Settings fields briefly turn yellow. A
10-minute read-only hardware observation (2026-09-27) showed the scheduler
does read every "15 s" block about every 15 s (median 15.02 s, p99 15.87 s).
The 30-33 s gaps the page saw carried a revision +2: the device had read the
block on time, and the success event was dropped in transit. ESPHome's SSE
server keeps one deferred event per entity while the socket is backed up,
and every block's success shares the one `read_plan_success` entity. The old
15 s-group budget of 30 s was exactly 2 x cadence, so a genuinely missed
read showed stale for only a few milliseconds.

**Decision:** A scheduler-read block is fresh for its cadence plus
J = (shortest scheduler cadence) / 2 = 7.5 s. This gives 15 → 22.5 s,
75 → 82.5 s and 300 → 307.5 s. `generate_read_plan.js` derives it, rejects any
canonical `freshness_budget_s` that differs, and emits
`kBlockFreshnessBudgetMs`. The UI, the write registry's RMW STALE_RAW gate
and diagnostics all consume that one canonical value. The firmware numbers
every success (`read_plan_success` = `<address>:<revision>:<sequence>`). After
a jump in the sequence (or a skipped block revision) the page re-reads the
read-only `/settings/read-freshness` snapshot, forward-only. It fetches at
most once per 5 s, and nothing unless successes were actually lost.

**Reason:** Scheduling lateness is absolute, because a due block waits behind
other due blocks one 200 ms slot at a time. Measured lateness is at most
+3 s, and the calibrated model gives at most +6 s with write pauses, forced
readbacks or another block's timeout. One missed read makes the next success
arrive one full cadence later, so the budget must stay below 2 x cadence.
The chosen value sits at the midpoint for the fastest group.

**Alternatives considered:** keeping 30 s (a miss is invisible); 1.5 x
cadence for every group (it would loosen the 75 s and 300 s write gates to
112.5 s and 450 s); 15 s → 30 s cadence reclassification (disproved by
hardware: the scheduler meets 15 s); restoring 15 s by a faster scheduler (not
needed: 3.62 reads/s already meets the 3.67/s demand).

**Rejected approaches:** a UI grace period; hiding stale; polling register
data; a time-gap heuristic on the stream (on the demo stream it re-fetched
every 7–15 s, i.e. polling in effect); a per-block digest published every
second (more SSE traffic than the one sequence number).

**Status:** Active. Evidence:
`protocol/evidence/stage1_corrective_evidence/poll_cadence_freshness_20260927.md`.

## Decision: Migrate RS485 reads to wide clusters (approved design, not hardware-proven)

**Context:** today the read path issues one FC03 read per canonical register
address: 103 scheduler blocks plus bespoke readers, ≈ 54 % modelled bus
occupancy, and telemetry every 15 s. Transaction overhead (~110 ms), not
payload bytes, dominates the bus time.

**Decision (2026-09-27, owner + Codex + Claude review):**
- Clusters (geometry SUPERSEDED on 2026-09-28; see "Clustered reads use a
  verified 120-register operational maximum" below):
  - telemetry A1 `0x1200 × 125` + A2 `0x12FA × 10`, target 1 Hz;
  - Settings C1 + C2, background every 300 s, immediate + every 3 s under one
    bounded active-view lease;
  - static S1–S3, at startup and every 300 s;
  - the setup passcode 0x1470–0x147F isolated from every cluster and cache.
- Explicit scheduler priority tiers with phase staggering.
- Writes own the bus while a command is outstanding. At most one read-only
  telemetry read may use a proven write idle window; otherwise use an
  explicit bounded write pause.
- Freshness only from physical cluster success, with evidence-derived
  budgets. RMW gates always use the strict active budget.
- Publish-on-change only after cluster freshness exists.
- Legacy readers kept only as a latched, visible fallback.

The discovery pass found that the agreed C1 `0x1000 × 125` / C2
`0x10FA × 18` boundary cuts the 32-bit register 0x10F8. The proposed
correction is C1 `0x1000 × 124` / C2 `0x10F8 × 19`. The owner accepted it on
2026-09-27 and chose the isolated diagnostic build for the gate
measurements.

**Reason:** measured and modelled evidence shows transaction count, not
bytes, limits the bus. Wide reads promise 1 Hz telemetry at a similar or
lower load (32.8 % to 56.8 % depending on the unmeasured wide-response
latency).

**Alternatives considered:**
- reading the whole 0x1000–0x1507 span every 1–1.5 s (≥ 6 reads, too much
  load, needless configuration traffic);
- trimming read length per cell count (saves ≈ 0.5 % bus, adds dynamic
  lengths).

**Rejected approaches:** guessed geometry, budgets or deadbands; freshness
from value publication; a background budget as a write gate; credential
bytes in shared caches.

**Status:** Approved design, not implemented or hardware-proven. Plan and
gates:
[`RS485_CLUSTERED_READ_MIGRATION_PLAN.md`](RS485_CLUSTERED_READ_MIGRATION_PLAN.md).
The existing "Freshness budget = cadence + one absolute scheduling
allowance" decision stays in force for the current per-address scheduler
until the cluster budgets replace it.

## Decision: Clustered reads use a verified 120-register operational maximum

**Context:** gate A (2026-09-28) was run with the read-only diagnostic build.
- The BMS refused `0x1200 × 125` and `0x1000 × 124` with Modbus exception 2.
- In the boundary run (`e93a5a9`, 20:58), the ×120 clusters and all four
  ×121 controls succeeded with exact lengths, including reads that end on
  half of a U32.
- For the tested ranges, the largest confirmed successful length is 121
  registers and the smallest previously observed failing length is 124.
- The exact global device limit was not determined.

**Decision (2026-09-28, owner):**
- Cluster geometry: A1 `0x1200 × 120`, A2′ `0x12F0 × 15`,
  C1 `0x1000 × 120`, C2′ `0x10F0 × 23`, S1–S3 unchanged.
- 120 registers is the verified conservative operational maximum per read.
  It is a design limit, not a statement of the BMS protocol limit.
- ×122/×123 are not tested.
- Canonical gap words inside clusters stay ignored/unknown. They are not
  uniformly zero.
- Inactive cell channels 17–32 are read with the fixed range and filtered
  after decoding. The all-zero observation comes from one 16S unit and is not
  a protocol guarantee.

**Cadence (owner decision 2026-09-29):**
- A1/A2 every 1 s.
- C1/C2 and S1–S3 every 15 s in the background, so no field updates less
  often than before the migration.
- C1/C2 every 3 s under the active Settings lease.
- Freshness budgets = cadence + J (J = 500 ms).
- Writes merge only into cluster bytes fresher than the strict 3.5 s budget.
  The servicer first reads the owning cluster when they are older (automatic
  pre-read); it never uses the background budget.

**Reason:** 120 is proven on hardware with a margin. ×121 also succeeded,
and no failure was seen below 124. The exact limit does not matter for the
migration, and probing it would add hardware steps without benefit.

**Alternatives considered:**
- determining the exact limit with ×122/×123 and more start addresses;
- the original ×125/×124 geometry, which was refused.

**Rejected approaches:** presenting 120 or [121, 123] as the device's
protocol limit; treating gap words as reserved zeros.

**Status:** Active for the migration plan (M2 onward). Evidence:
`protocol/evidence/stage1_corrective_evidence/diag_probe_gate_a_20260928.md`
§6.
