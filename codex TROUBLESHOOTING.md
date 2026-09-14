# Troubleshooting and Investigation History

Цей файл зберігає відтворені симптоми, невдалі підходи та наступні діагностичні кроки. Не кожен історичний дефект досі активний; див. `Current understanding`.

## Problem: V2 workbook breaks the old evidence pipeline

**Symptoms**

`test/run_all.sh` із `LiFePO4_BMS_Parameters_registers-V2_verified.xlsx` завершується з `KeyError: 'BMS Parameters'`.

**Investigation**

Поточний workbook має sheet `Реєстр параметрів`; старий `build_workbook_index.py` hard-code-ить `BMS Parameters`. Окремий V2 manifest builder читає новий workbook успішно.

**Attempts**

Claude запускав pipeline зі старим V1 workbook і повідомив PASS. Independent run у temp copy використав саме current V2 hash `3226…` і відтворив failure.

**Result**

Старий green run не є доказом current normative source compatibility.

**Current understanding**

Це P0 architecture gap: паралельно існують V1 canonical pipeline і V2 audit pipeline.

**Recommended next step**

Спочатку додати fixture/schema tests для V2 sheets/columns/hash, потім мігрувати index/generator/release atomically. Release без V2 має fail closed.

## Problem: `All suites passed` although evidence pipeline was skipped

**Symptoms**

`bash test/run_all.sh` без `JK_BMS_WORKBOOK_PATH` виходить 0 і друкує загальний success, хоча лог містить `NOT EXECUTED`/skip для pipeline.

**Investigation**

Independent run: exit 0, 814 lines, pipeline skipped. З workbook script fail-closed і не доходить до success line.

**Attempts**

Розрізняли fast developer suite та release suite, додавались release runner tests, але current V2 integration все ще broken.

**Result**

No-workbook run корисний як regression suite, але не release proof.

**Current understanding**

Назва/повідомлення runner перебільшує coverage.

**Recommended next step**

Ввести явні `fast` і `release` profiles. `release` завжди вимагає V2 sources, source hashes, generator/pipeline freshness і clean generation ID.

## Problem: Wrong `0x79–0xC0` register audit

**Symptoms**

Попередній аудит стверджував, що CellCount/FET мають single-byte addresses на кшталт `0x8A`, `0xB1`, `0xB2`, які суперечать project `0x1000+` map.

**Investigation**

Переглянуті PDFs/markdown у upstream `docs/`: вони описують classic JK BLE/UART GPS-style protocol або CAN, не JK-PB Modbus RTU.

**Attempts**

Пошук цих адрес у workbook, upstream PB example, YAML і hardware evidence не знайшов відповідності.

**Result**

Це інший protocol family; висновок спростовано.

**Current understanding**

Project uses 16-bit Modbus addresses, primarily `0x1000–0x1612` у повному V1.1 manifest, а current runtime subset переважно `0x1000–0x1504`.

**Recommended next step**

Перед прийняттям документації перевіряти product family, frame format і address width; фіксувати source hash.

## Problem: RW edit `16 → 8` ends with `>>`, then `×`, value returns to 16

**Symptoms**

На реальному hardware CellCount change чекала 3–4 s, закінчувалась mismatch/error, BMS лишалась 16. У ранній demo iteration input іноді не відновлював 16.

**Investigation**

HTTP acceptance не доводить Modbus write. Backend/readback eventually returned 16; UI red `×` is correct when requested 8 is not authoritative. Root wire rejection was not captured. CellCount має bespoke flow and topology safety logic.

**Attempts**

Demo write modes Confirm/Mismatch/Timeout; authoritative restore logic; `WRITE_UNCERTAIN` recovery; topology simulation. Це не встановило physical BMS rejection cause.

**Result**

UI restore was improved, але actual hardware write success is still unproven.

**Current understanding**

Possible causes include invalid/safety-rejected topology change, wrong wire encoding/address/timing, BMS firmware policy, endpoint-to-tx correlation or stale readback. **UNKNOWN without raw trace.** 3–4 s corresponds to designed ACK/readback timeouts, not necessarily normal RS485 latency.

**Recommended next step**

Не повторювати на live pack ad hoc. Add exact API/trace IDs, passive RS485 capture, record request/raw command/ACK/readback/timestamps, select lab-safe topology and rollback. Optimize latency only after separating actual response from timeout.

## Problem: Cursor/focus disappears while editing

**Symptoms**

Після click у input caret зникав або typed value відновлювався з SSE.

**Investigation**

Register/diagnostics list rebuild replaced DOM nodes on incoming updates. Direct `input.value` writes ignored dirty state.

**Attempts**

Звичайне re-render; then capture focused key/value/selection/dirty state and reapply after rebuild; guard updates for dirty fields.

**Result**

Current code contains preservation logic; static/mock checks support it.

**Current understanding**

Likely fixed for known rebuild path, but no real browser E2E across all SSE/full rebuild cases.

**Recommended next step**

Playwright test: type slowly while SSE updates, assert activeElement, selectionStart/End, draft, no overwrite; then mismatch must intentionally restore authoritative readback.

## Problem: Input width did not change, then became too narrow

**Symptoms**

CSS width edits initially had no visible effect; later fields clipped values such as `3,300`; user requested +25%, and setup passcode +33% separately.

**Investigation**

Grid column sizing, flex `min-width:auto`, selector specificity, wrapper/input sizing and mobile media rules interacted. Unit suffix/spinner also consumed width.

**Attempts**

Changing input width alone; narrowing columns; later wrapper/grid rules and specific passcode override.

**Result**

Current baseline uses `.register-editor` columns `108px 54px`, total mobile width around 179px, and passcode editor `144px 54px`/215px. Unit wrapper removes native number spinner.

**Current understanding**

User-tuned baseline, not a mathematically universal size. It must be visually tested at Ukrainian decimal formatting and narrow screens.

**Recommended next step**

Do not casually change. Add responsive screenshots/DOM bounding-box assertions at supported widths, long units and max-length values.

## Problem: Duplicate value format such as `3.500 V · 3.5`

**Symptoms**

Table showed formatted state plus raw/native value separated by a dot.

**Investigation**

UI combined entity state and parsed value as two representations.

**Attempts**

Keep rounded plus raw for transparency; user rejected duplication.

**Result**

Current requirement and implementation show one protocol-precision value plus one unit.

**Current understanding**

Debug raw data belongs in trace/evidence, not normal value cell.

**Recommended next step**

Regression test no `formatted · raw` in Settings/Diagnostics and precision comes from canonical wire scale.

## Problem: Cell voltage/resistance rows sort incorrectly

**Symptoms**

Rows appeared `1, 10, 11…16, 2…`; resistance lacked unit/translation.

**Investigation**

Actual keys were `cell_resistance_N`, while label/unit/order code expected `cell_N_wire_resistance`; lexical sorting amplified it. Similar wrong regex occurred for temperature sensors.

**Attempts**

Hard-coded ordering under wrong key format failed silently. Fixed regex/key conventions and numeric series extraction in several sites.

**Result**

Static regression and manual demo evidence reported correct `01…16` order and localized `mΩ/мОм`.

**Current understanding**

Fixed for 16 current entities, but V2 32-channel migration can reintroduce drift.

**Recommended next step**

Generate numbered-series metadata; browser E2E exact order for 1/4/8/16 and supported 32.

## Problem: Ukrainian labels leak English text

**Symptoms**

Examples included `Control override reason`, topology/transaction bookkeeping labels, request charge/float voltage and temperature series.

**Investigation**

Three roots: stale dictionary keys, missing entries, regex expecting wrong entity IDs. `control_override_reason` was mock-only and not canonical.

**Attempts**

Rewrote label block, mirrored missing EN/UK entries, fixed numbered regex, added static dictionary completeness test.

**Result**

Content gaps observed then were fixed; `Причина перевизначення контролю` appeared in manual demo.

**Current understanding**

Label translation and source classification are separate. `control_override_reason` still needs canonical non-register classification. Accessibility/nav strings may remain.

**Recommended next step**

Generate labels from one model and add DOM test that switches locales and rejects unknown/raw English in Ukrainian mode, except whitelisted protocol/model tokens.

## Problem: Non-register entities leak into Settings

**Symptoms**

Battery-state timing, runtime/device-name and other ESPHome-derived entities appeared as if BMS registers.

**Investigation**

`NON_REGISTER_ENTITY_IDS` was a separate manual list with stale names. It was changed to derive from `PROTOCOL_CATALOG.nonRegisterKeys`.

**Attempts**

Manual exclusions; generated canonical list.

**Result**

Most known leaks fixed. Later `control_override_reason` was registered without canonical entry and reintroduced one structural hole.

**Current understanding**

P1-04 is not fully closed until every registered entity belongs to exactly one source class and DOM sections are tested.

**Recommended next step**

Enforce XOR invariant: each entity key exists exactly once in register or non-register model; unknown received entities go to explicit unknown diagnostics, never Settings.

## Problem: Diagnostics has stale headings/raw duplicates

**Symptoms**

Historical live audit saw `ЗНАЧЕННЯ ПАРАМЕТРІВ BMS`, `Фактично отримано від ESPHome`, raw `CONFIRMED`/`OK`, raw seconds, duplicate runtime/IP/Wi-Fi.

**Investigation**

Top cards and generic entity dump both rendered overlapping sources; status formatting/localization was inconsistent.

**Attempts**

Move register rows to Settings; dictionary/formatting work; remove old headings.

**Result**

Code changed substantially after the dated audit, but final handoff did not independently re-open the browser to certify every duplicate/header absent.

**Current understanding**

Static code suggests progress; current DOM truth is partially unverified.

**Recommended next step**

Playwright section-membership snapshot in both locales using all entities; assert no duplicate semantic IDs, raw enum leaks or forbidden captions.

## Problem: Toggle/OK feedback not visible or control remained enabled

**Symptoms**

Earlier feedback states did not reliably show one-second green/red; user required disabled state whenever button not `OK`.

**Investigation**

Backend snapshot timing, terminal cleanup and frontend timers could skip/overwrite transient presentation. Toggle initially still used select or separate OK.

**Attempts**

Added transaction states, terminal visual timer, disable logic, two-step toggle confirmation, uncertain state handling.

**Result**

Implemented in current paths and mock-tested in parts, but exact real-browser 1-second timing is not automated.

**Current understanding**

Source-level claims are insufficient; race/reconnect/multi-client may still alter UX.

**Recommended next step**

E2E with fake clock/network timing: assert orange `>>` disabled, no double click, green/red visible 1000±tolerance ms, mismatch restore, reload/reconnect behavior.

## Problem: Stage 5 freshness says complete but derived values never stale

**Symptoms**

Many Overview/Diagnostics values remain visually fresh indefinitely. Static scan found 51/53 non-register entries with `freshnessBudgetS: null`; `power` lacks budget.

**Investigation**

First implementation covered old physical register metadata. Later patches added some overview hooks, but generated non-register metadata retained null budgets.

**Attempts**

5-second sweep, then 1-second sweep; `.is-stale` classes and title explanations; partial field metadata extension.

**Result**

Sweep frequency was improved, but lack of budget/source lineage means most derived values are skipped by `isEntryStale()`.

**Current understanding**

Freshness is partial, not closed.

**Recommended next step**

Add explicit derived freshness policy: `min(source budgets)` or semantic budget per derived entity; test source staleness propagates and recovery clears it.

## Problem: Demo BMS Stale scenario may not actually stale each value

**Symptoms**

Global health says stale while individual entity events may continue, so per-field timers reset.

**Investigation**

Mock scenario controls health/age directly but may keep normal publish loop.

**Attempts**

Use `Browser Disconnected` to force EventSource drop; this tests transport staleness but not BMS-stale-with-browser-connected.

**Result**

The two cases are not cleanly separated in all fixtures.

**Current understanding**

Mock fidelity gap.

**Recommended next step**

Add deterministic fixture that leaves SSE open while suppressing selected BMS entity publishes; keep browser-only signals fresh.

## Problem: `smart_sleep` mismatch report could not be reproduced

**Symptoms**

One audit claimed `3.500 → 3.501 → ✓ → 3.5`. Later three runs retained 3.501/3.502, including after reload.

**Investigation**

Mock resolves target to `sensor-smart_sleep`, the same entity UI reads; no `number-set_smart_sleep` entity exists.

**Attempts**

Repeated exact scenario and reload.

**Result**

Bug not reproduced in newer state.

**Current understanding**

Likely report from an older code revision or another write mode. Do not close all readback bugs based on this one non-reproduction.

**Recommended next step**

Keep invariant test for every RW field: confirmed mock updates authoritative read entity; mismatch returns different value; no endpoint/read-entity split.

## Problem: Setup passcode path cannot be safely verified

**Symptoms**

Earlier editor encoded 1–16 ASCII into registers and could only report sent/unverified; docs/demo still mention it.

**Investigation**

Address `0x1470` is a vendor extension absent in official V1.1; secret readback is masked/unavailable; normal HTTP path lacks exact secure terminal result.

**Attempts**

Rebuilt editor/backend, then repeatedly removed it after security audits.

**Result**

Current intended state: UI absent, backend fail-closed.

**Current understanding**

Older `demo/README.md` text is stale. Re-enabling now would regress security.

**Recommended next step**

Require manufacturer/model evidence, no URL/log exposure, redacted exact transaction receipt and explicit hardware security test before any UI restoration.

## Problem: 16→8 UI only partially reconfigures

**Symptoms**

Eight bars could appear while 16 cell cards remained; bars did not redistribute; pack voltage remained ~52 V; resistance graph/state inconsistent.

**Investigation**

Different consumers read configured count, fixed arrays, masks or original pack entities independently. Constants exist in JS, YAML and mock.

**Attempts**

CSS `--cell-count`, hide extra cells, topology resolver simulations.

**Result**

Presentation partially adapts, but system-wide atomic dynamic topology is not complete.

**Current understanding**

Hiding UI is not topology. Pack voltage from real BMS may legitimately stay 16S if physical pack/config did not change.

**Recommended next step**

Inventory all consumers, introduce one revisioned snapshot, make computations/history/polling/UI consume it, and test transition as a transaction.

## Problem: Literal NUL makes `generate.js` look binary

**Symptoms**

Git diff and `rg` classify `tools/protocol/generate.js` as binary.

**Investigation**

One actual NUL byte exists around byte offset 4146 in a hash concatenation separator. Node syntax/check accepts it.

**Attempts**

No production fix applied during final audit because handoff task was documentation-only.

**Result**

Functional generator checks pass, maintainability/tooling remains degraded.

**Current understanding**

Source should contain escaped `"\0"`/equivalent, not literal byte, if hashing behavior is kept identical.

**Recommended next step**

Add byte-level regression test forbidding NUL in source, patch representation, prove generated hashes/artifacts unchanged or intentionally regenerated.

## Problem: Workbook with same name had different hash

**Symptoms**

Earlier verified/output copy had a different SHA from later Downloads/project copy.

**Investigation**

Downloads file was updated later; project copy now matches it exactly at SHA-256 `3226…`.

**Attempts**

Compared content hashes rather than trusting filename.

**Result**

Current pair is synchronized.

**Current understanding**

Old hashes are historical, not necessarily tampering.

**Recommended next step**

Pipeline pins content hash and records source timestamp/provenance. Never select by filename alone.

## Problem: Auth documentation contradicts runtime config

**Symptoms**

`docs/AUTH_AND_HISTORY.md` says Basic auth/ESPHome 2026.6.5; YAML explicitly has `auth.type: digest` and cites 2026.8.2.

**Investigation**

Read current YAML and dated doc.

**Attempts**

No historical doc rewrite during handoff; contradiction documented.

**Result**

Code appears newer.

**Current understanding**

Digest availability is compile-supported, but real endpoint auth and security behavior still need current hardware negative tests.

**Recommended next step**

Update doc after testing unauthenticated/authenticated UI, `/events`, history, write API, OTA/API; note HTTP remains plaintext.

## Problem: mDNS host is intermittent/unavailable

**Symptoms**

`jk-bms.local` sometimes fails while device may still be reachable by direct local address.

**Investigation**

Historical hardware audit used local network; later sessions had mDNS blocker.

**Attempts**

Direct address and browser checks in prior sessions; no final systematic network capture.

**Result**

Reliability remains unknown.

**Current understanding**

Could be multicast/network segmentation, device offline or address change; not sufficient evidence of firmware failure.

**Recommended next step**

Record DHCP lease, ping/direct HTTP, `.local` resolution from two clients/VLANs, mDNS packets and reconnect time; do not hardcode private IP in source/docs.

## Problem: LittleFS persistence passes PoC but is absent in production

**Symptoms**

History disappears after reboot; production YAML has no `jk_history:` block.

**Investigation**

Pure format had namespace collision with `esphome::jk_history`; it was renamed to `jk_history_format`. Unit tests and isolated ESPHome compile passed historically.

**Attempts**

Prepared A/B CRC format, store component, PoC YAML and candidate partition CSV. Deliberately did not apply production partition.

**Result**

Safe staged implementation, not completed feature.

**Current understanding**

Compile cannot prove mount/commit/recovery under power loss or OTA partition compatibility.

**Recommended next step**

Review flash size/current partition, execute sacrificial-device migration/OTA/USB rollback, corruption and power-cut campaign, then wire production incrementally.
