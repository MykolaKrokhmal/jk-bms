> **ARCHIVED — historical record, not current and not an implementation queue.**
> Moved here in the 2026-09-25 repository cleanup (full pre-move state: branch
> `checkpoint/pre-repository-cleanup-2026-09-25`). Paths, counts and statuses
> below reflect the date written. Current state: [PROJECT_STATE](../../project/PROJECT_STATE.md);
> current plan: [RS485_UNIFIED_PARAMETER_PIPELINE_PLAN](../../project/RS485_UNIFIED_PARAMETER_PIPELINE_PLAN.md);
> archive index: [docs/archive/README.md](../README.md).

# Project State

> **Update (2026-09-14/15, Claude — final preparation pass):** the
> "Нормативний V2 workbook ще не інтегрований у старий release pipeline"
> claim below is resolved — see `codex TROUBLESHOOTING.md`'s updated
> "Current understanding" for "Problem: V2 workbook breaks the old
> evidence pipeline", and root `HANDOFF.md` for current state. The
> uncommitted-tree framing below is also stale: everything through this
> snapshot's HEAD (`93b4c1d`) plus five later commits (including this
> file's own archival) is now committed at `c291106`, and six more commits
> since address the specific gaps that checkpoint commit's own message
> logged as still open (claim-matrix policy gate, self-contained pipeline,
> secret-scan worktree scope, `capacity_remaining` signedness). The
> 119-register/265-parameter catalog split this file identifies as the
> core remaining gap is still real and still open — that has not changed.

**Snapshot date:** 2026-09-12  
**Repository:** `/Users/mykola.krokhmal/Claude/jk-bms`  
**Overall verdict:** **НЕ ГОТОВО**  
**Confidence model:** кожен пункт позначено `VERIFIED`, `IMPLEMENTED`, `DECIDED`, `PLANNED`, `ASSUMED` або `UNKNOWN`.

## Current status

Проєкт має працездатний ESPHome/ESP32 read path, production frontend, demo mock, частково harden-ений generic write manager і значний test suite. Однак він перебуває у великому незакоміченому перехідному стані між старим 119-register canonical catalog та новим офіційним V1.1/V2 manifest на 265 параметрів. Нормативний V2 workbook ще не інтегрований у старий release pipeline, каталог неповний, exact HTTP transaction contract не завершений, packed RMW і повна dynamic topology відсутні, persistence не підключено до production, browser E2E/security/HIL/soak не виконані.

Найсвіжіший незалежний аудит після звіту Claude встановив критичну невідповідність: test suite без workbook проходить, але не виконує evidence pipeline; із поточним V2 workbook старий pipeline падає через hard-coded sheet `BMS Parameters`, тоді як актуальний sheet має назву `Реєстр параметрів`.

## What currently works

### Firmware/read path

- **IMPLEMENTED; COMPILE-VERIFIED HISTORICALLY:** `batterylifepo4.yaml` конфігурує ESP32/ESP-IDF, UART 115200, RS485 flow-control і JK-PB Modbus polling. Останній задокументований compile з ESPHome 2026.8.2 / ESP-IDF 5.5.5 завершився успішно, близько RAM 51.4%, Flash 61.4%. Це не перевірялося повторно під час цього handoff.
- **VERIFIED ON HARDWARE 2026-09-09, READ-ONLY:** реальний пристрій був доступний, віддавав узгоджену 16S телеметрію; Overview/Cells/стани працювали для статичної 16S конфігурації. Цей факт не доводить writes, topology transitions або 32S.
- **IMPLEMENTED:** dedicated cell voltage/resistance block оновлюється приблизно 1 s; загальний Modbus controller — 15 s; config fields із `skip_updates: 20` — повільно.
- **IMPLEMENTED:** поточний YAML має Digest web auth, encrypted native API, OTA password і password fallback AP через secrets.

### Frontend/demo

- **IMPLEMENTED; STATIC-VERIFIED:** production UI — `jk_bms.js`/`jk_bms.css`, без bundler. Demo server напряму віддає ці файли, тому UI-код не копіюється.
- **IMPLEMENTED; MOCK-TESTED:** demo підтримує SSE, write outcomes, connection/staleness scenarios і topology fixtures 1S/4S/8S/16S/invalid-17 у частині test suite.
- **IMPLEMENTED:** numeric values у register table більше не мають дубля `formatted · raw`; одиниці й локалізація суттєво допрацьовані.
- **IMPLEMENTED; STATIC/MANUAL DEMO EVIDENCE:** cell resistance і temperature numbering виправлялися з lexical/wrong-key pattern на numeric `01…N`; labels UK/EN значно розширені.
- **IMPLEMENTED:** active input/draft/focus preservation існує для rebuild path, щоб SSE не стирав редагування.
- **IMPLEMENTED:** шість navigation sections (`Overview`, `Cells`, `Electrical`, `Health`, `Configuration`, `Diagnostics`); окрема duplicate control tab у поточному JS не виявлена.

### Generic write manager

- **IMPLEMENTED; UNIT/MOCK-TESTED:** C++ manager має 6 slots, per-address single-flight, generation tokens і 4-slot rejected ring.
- **IMPLEMENTED; UNIT/MOCK-TESTED:** ACK/readback timeouts переходять у `WRITE_UNCERTAIN`, recovery probes можуть завершитися `RECOVERED_CONFIRMED` або `RECOVERED_MISMATCH`.
- **IMPLEMENTED:** UI не вважає raw ACK/readback timeout terminal success і тримає control disabled під час uncertain recovery.
- **IMPLEMENTED; POLICY:** старий canonical catalog має 46 declared RW fields, але лише 18 effective RW; 28 fail-closed. Hazard/topology/credential/unsupported classes не enabled.
- **PARTIALLY VERIFIED:** all 18 enabled fields — normal, unpacked; це уникає активного packed-RMW corruption path, але не вирішує потребу реалізувати packed writes.

### Protocol evidence

- **VERIFIED:** official PDF hash: `b9b3f1e417017cff32ec112b6238663204133bb551a1a4a88c9d139c16d22739`.
- **VERIFIED:** project V2 workbook і Downloads copy ідентичні; SHA-256 `3226acee771fedc448458f6a521421ff55da86309171de57161d0b11d6902be8`.
- **VERIFIED:** V2 workbook має sheets `Реєстр параметрів` (265 data rows), `Групи UI` (12 curated groups у 27-row sheet), `Аудит`.
- **VERIFIED:** V2 manifest check проходить окремо: 265 parameters, 210 unique base addresses; 208 official V1.1 + 2 vendor extensions.
- **VERIFIED:** gap audit: 130 implemented, 97 missing, 38 partial.
- **VERIFIED:** access distribution workbook: 159 R, 97 RW, 8 W, 1 calculated.

### Tests/tools

- **VERIFIED 2026-09-12 IN TEMP COPY:** `node --check jk_bms.js`, `node --check tools/protocol/generate.js`, `node tools/protocol/generate.js --check`, `node tools/protocol/fingerprint.js check` passed.
- **VERIFIED 2026-09-12 IN TEMP COPY:** `bash test/run_all.sh` without workbook exited 0 (814 output lines), but explicitly skipped pipeline. Це лише partial success.
- **VERIFIED 2026-09-12 IN TEMP COPY:** `build_v2_manifest.py --check` against current Downloads workbook passed; `build_v2_gap_audit.js` remained deterministic.
- **IMPLEMENTED:** release/fingerprint/atomicity/mixed-generation/port-allocation tests and tooling exist in dirty tree. Their presence does not by itself prove a complete V2 release path.

## What does NOT work

### P0: V2 source is not integrated into the authoritative pipeline

**Symptom:**

`test/run_all.sh` with `/Users/mykola.krokhmal/Downloads/LiFePO4_BMS_Parameters_registers-V2_verified.xlsx` exits 1:

```text
KeyError: 'BMS Parameters'
```

**Known cause:** `protocol/evidence/build_workbook_index.py` and the old pipeline expect the old sheet `BMS Parameters`; V2 uses `Реєстр параметрів` and a different schema.

**Already tried:** Claude reported a green run using an old V1 workbook path. Independent reproduction against the required V2 workbook disproved that as a current release proof.

**Affected:** `build_workbook_index.py`, `tools/protocol/pipeline.js`, release runner/tests, source manifests, generated indices/claim matrix/canonical generation.

**Required result:** one deterministic pipeline consumes the verified V2 workbook + official PDF model, validates source hashes, generates the authoritative canonical/runtime projections atomically, and fails release if skipped or stale.

### P0: Catalog/runtime coverage is incomplete

**Symptom:** V2 gap audit reports 97 missing and 38 partial rows. Old canonical holds only 119 physical registers/127 logical fields, far below V2 manifest.

**Known cause:** old catalog was designed from a narrower V1 workbook/community implementation and is still hand-maintained separately from V2 manifest.

**Required result:** migrate all implementable R/RW/W rows with explicit evidence, safety/access, grouping, entity IDs, units, freshness and UI behavior. Reserved/ambiguous fields remain explicit and fail-closed, not silently omitted.

### P0: Exact request-to-transaction correlation is unfinished

**Symptom/risk:** standard ESPHome `/number|select|text/.../set` response gives only HTTP status and no structured `{accepted, tx_id, address, generation, reason}`. Frontend later observes a snapshot by address/newer transaction rather than a handle returned by the request.

**Consequence:** multi-client and out-of-order safety is not fully proven; P0-01 remains open even though old entity-SSE false-success was mitigated.

**Required result:** authenticated custom write endpoint returning exact transaction identity, versioned snapshot/journal, exact frontend correlation, collision status and two-client regression tests.

### P0: Packed RW is not safely implemented

**Symptom:** packed register fields are blocked. No schema flag/test proves fresh pre-read RMW.

**Risk:** using cached sibling or whole-word write can corrupt another field.

**Required result:** pre-read physical word from BMS immediately before write, merge only target mask, write combined word, readback full word, verify target and preservation; generation lock and fault tests. Only then may individual packed fields become effective RW.

### P0: Dynamic topology is incomplete

**Symptom:** `jk_bms.js` hardcodes `MAX_CELL_COUNT = 16`; mock hardcodes `CELL_COUNT = 16`; YAML declares exactly 16 voltage and 16 resistance entities. CSS has some dynamic `--cell-count`, but data sources remain fixed. Gap audit found 34 hardcoded-16 sites.

**Consequence:** 16→8 may hide some bars/cards while pack voltage, aggregates, masks, history, polling and all consumers are not guaranteed to update atomically. 17–32S official channels are absent.

**Additional inconsistency:** `cell_connected_mask` is conceptually 32-bit but current frontend metadata max is 65535.

**Required result:** capability-gated max, pure resolver + atomic snapshot, all consumers use effective confirmed N, tests at 1/4/8/16 and supported 32, invalid/stale/mismatch cases, then real lab transition.

### P0: No complete real-hardware write proof

No current evidence demonstrates successful controlled RW change, mismatch restore, ACK-loss recovery, collision, reboot, disconnect or rollback on the actual BMS. Earlier user symptom was input `16→8`, button `>>`, then `×`, restoring 16: this correctly indicated no confirmed change but does not explain the wire failure without raw RS485/backend trace.

Hardware writes must remain gated until software P0s and lab safety conditions are met.

### P1: Settings grouping/order cannot yet be derived

V2 workbook has 12 curated groups, but the register sheet uses a separate coarse 8-value `Розділ UI` taxonomy and lacks a deterministic per-row link to the 12 groups. `bms_v1_1_manifest.json` therefore sets `ui.ui_order = null` for all rows. Do not guess mapping.

Required: add/approve explicit per-row group/order mapping in the normative source or a reviewed mapping artifact, validate uniqueness/completeness, then generate Settings sections.

### P1: Settings/Diagnostics separation has one known structural leak

`control_override_reason` is registered and labeled in JS/mock but absent from both canonical sources. Because non-register filtering derives from `nonRegisterKeys`, this mock-only key can be treated as a BMS register in Settings when received. It was the only literal `registerEntity()` key found outside both canonical sets in the latest audit.

Required: classify it in the authoritative non-register model or remove the orphan mapping, and add catalog-to-DOM E2E coverage.

### P1: Freshness is incomplete

Stage 5 added meaningful budgets for old physical register fields and some UI treatment. But 51 of 53 non-register entities currently have `freshnessBudgetS: null`. `power` is displayed via `bindText` with no budget. Thus the claim «кожне UI значення має freshness» is false.

Required: derive budgets/lineage for all displayed source and derived values; stale controls fail closed; visible age/reason; recovery on fresh data; browser E2E.

### P1: Browser E2E is missing

No checked-in Playwright/equivalent suite proves exact 1-second green/red states, disabled states, focus/caret preservation, exact ordering across 1S/4S/8S/16S, reconnect, multi-client transactions, responsive layout or accessibility. Manual demo observations are useful but not a release gate.

### P1: Persistence is not in production

RAM history is lost on reboot. LittleFS A/B format/store and isolated PoC exist and compiled historically, but production YAML has no `jk_history:` block and no hardware-tested partition migration, checkpoint/restore or power-loss validation.

### P1: Security hardening incomplete

Digest authenticates but does not encrypt HTTP. CORS wildcard is present on mock and current threat-model/Origin/CSRF/rate-limit/API/OTA negative matrix is incomplete. Deployment assumption is trusted LAN/VPN only. Custom write API must be included in auth and security tests.

### P1: Protocol ambiguities remain

- alarm bit assignments for two named alarms;
- `0x1504` RCV/RFV time byte order;
- `0x1600`/`0x1606` UINT16 vs length 4;
- vendor extensions `0x111C`/`0x1470` and their supported model/firmware range;
- DRY1 trigger second-byte access;
- source-dependent units/ranges for DRY/LCD thresholds.

### P2: Documentation/tooling debt

- `docs/AUTH_AND_HISTORY.md` still says Basic auth/ESPHome 2026.6.5; code says Digest/2026.8.2.
- `protocol/README.md` describes old canonical/V1 pipeline as final source of truth and contains obsolete generated-output narrative in its historical sections.
- `OPEN_ISSUES.md`, `CURRENT_STATE_AUDIT.md` and execution logs combine old claims with later corrections. Treat them as audit trail.
- `tools/protocol/generate.js` contains one literal NUL byte at offset around 4146; Node accepts it, but Git/`rg` treat the file as binary. Replace with escaped source representation under a tested maintenance change.
- firmware/UI version labels need build-derived metadata rather than stale literals.
- navigation accessibility label `Sections` may still require localization verification.
- persistent backend redacted transaction counters/journal are incomplete.
- mDNS reliability on the real network is not established.

## Work currently in progress

### Latest user request

Prepare an extremely complete repository handoff so a new Codex thread can continue without the long prior conversation. Create/update `AGENTS.md`, `PROJECT_STATE.md`, `DECISIONS.md`, `TROUBLESHOOTING.md`, `HANDOFF.md`; inspect and validate against code; do not change application behavior.

### Immediately preceding technical task

The user supplied Claude's latest Stage 5 report and requested an independent synchronization audit. The audit was performed against the actual dirty checkout and a temporary copy for tests.

### Current findings from that audit

1. Stage 5 syntax/generator/fingerprint checks pass.
2. Fast/full-ish suite without workbook passes but skips the evidence pipeline.
3. Current V2 workbook makes the old pipeline fail on sheet name/schema.
4. V2 manifest/gap audit separately pass and report 265 / 210 and 130 implemented / 97 missing / 38 partial.
5. Freshness coverage is not comprehensive.
6. `control_override_reason` is outside both canonical models.
7. Live browser DOM could not be independently repeated in the last audit because the Mac/browser surface was locked/unavailable.

### Next logical action after handoff

Do not start by adding more register rows ad hoc. First turn the verified V2 workbook and official PDF-derived manifest into the only authoritative pipeline input and release gate. The migration must preserve current safe read behavior and keep all unverified/hazardous writes fail-closed.

## TODO

### P0 — blocking / critical

1. **Unify protocol pipeline on V2.** Teach indexing/generation/release to consume the verified V2 schema, validate both source hashes, remove/explicitly deprecate the old V1 pipeline, and make `test/run_release.sh` fail if workbook evidence is absent/skipped/stale.
2. **Define exact generated model.** Map all 265 manifest rows to physical registers/logical fields/reserved/derived records with stable IDs, collision detection, access and evidence lineage.
3. **Resolve grouping contract.** Obtain an explicit per-row 12-group/order mapping from the workbook/user; no heuristic assignment.
4. **Rebuild canonical/runtime read foundation.** Add 97 missing and resolve 38 partial records safely; verify addresses, length/type, byte order, scale, unit, read entity and poll/freshness.
5. **Implement exact write API.** Structured accepted/rejected response with exact tx identity and versioned terminal journal; frontend must use only returned handle.
6. **Implement atomic packed RMW.** Fresh pre-read, mask merge, full readback, sibling preservation; keep fields blocked until tests and hardware proof.
7. **Complete topology architecture.** Model/capability-gated 16/32 channel maximum, atomic resolver snapshot, update every consumer; no blind CellCount trust.
8. **Perform controlled HIL write/fault validation.** Only after preceding software gates; capture raw Modbus frames and rollback evidence.

### P1 — important next work

1. Generate complete grouped Settings for all R/RW/W, with live values and correct editors/policies.
2. Complete Settings/Diagnostics separation; classify `control_override_reason`; remove raw register duplicates and stale historical captions.
3. Define freshness lineage/budgets for every rendered value and control.
4. Add browser E2E infrastructure and cases for write UX, order, focus, stale/reconnect, two clients, responsive/accessibility.
5. Resolve DRY/LCD units, enum dependencies and input masks/ranges from evidence/hardware capture.
6. Wire LittleFS A/B persistence under safe partition migration; execute reboot/corruption/power-loss/60-hour wrap tests.
7. Complete threat model and negative tests for Digest/HTTP, Origin/CSRF/CORS, rate limiting, native API, OTA and recovery.
8. Execute full charge/discharge/balance/topology hardware behavior and fault checklist.

### P2 — improvements

1. Remove literal NUL from `generate.js` with regression test.
2. Consolidate stale audit/docs into current-state + historical archive; correct auth/history docs.
3. Source firmware/UI/build versions from generated build metadata.
4. Retest mDNS and document direct-IP fallback without hardcoding private addresses.
5. Add persistent redacted transaction/audit counters.
6. Finish accessibility/localization coverage including navigation labels and status enums.

### P3 — ideas / future work

1. Optional protocol capture/replay fixtures from sanitized real frames for each supported model/firmware.
2. Capability registry for multiple JK-PB variants instead of scattered conditions.
3. Signed release evidence bundle and reproducible containerized build.
4. Long-term trend export/backup after persistence is proven safe.

## Known technical debt

- Two protocol truth pipelines coexist (old canonical and V2 manifest).
- `SETTING_DEFS` is a manual 18-entry frontend list because V2 lacks normalized min/max/step columns consumable by current generator.
- CellCount has a bespoke transaction driver separate from generic manager.
- YAML contains large embedded C++ lambdas and repeated entity declarations.
- Topology and mock mirror logic are duplicated rather than consuming one pure model.
- Some docs assert results from earlier source/tool versions.
- Generated source block in JS and hand-authored UI code remain coupled in one file.
- Demo README contains stale passcode behavior text even though passcode UI/backend is fail-closed.
- Browser-only stats are not a durable backend audit journal.

## Known bugs and edge cases

- V2 workbook sheet mismatch breaks old pipeline.
- Release without workbook can print success while pipeline is skipped.
- Literal NUL in generator harms text tooling.
- 51 non-register entities lack freshness budgets.
- `control_override_reason` can leak into Settings classification.
- 32-bit connected-cell mask metadata is limited to 65535.
- 32S official channels are absent from runtime.
- Packed writes remain blocked; do not workaround by whole-register writes.
- Passcode feature is intentionally unavailable; older demo/docs may say otherwise.
- `total_runtime` previously emitted a compile warning involving a null-address check; verify on next compile.
- Demo `BMS Stale` may still emit individual entity updates depending on scenario; `Browser Disconnected` is the reliable transport-stale fixture until fixed.
- mDNS may fail while direct address works.
- Input focus preservation must be tested when full diagnostics/settings lists rebuild during typing.

## Testing status

### Most recent independent checks

Performed in a temporary copy so the dirty checkout stayed untouched:

- JS syntax/generation/fingerprint: PASS.
- `test/run_all.sh` without workbook: exit 0, but pipeline skipped — partial only.
- `test/run_all.sh` with current V2 workbook: exit 1, `KeyError: 'BMS Parameters'` — P0 reproduced.
- V2 manifest `--check`: PASS, 265 rows / 210 base addresses.
- V2 gap audit deterministic: PASS, 130/97/38.

### Historical tests with credible evidence

- ESPHome config/compile with 2026.8.2: PASS after transaction changes; exact binary/config hash varies by code state.
- C++ transaction tests, catalog validator, negative fixtures, packed codec, mock/topology tests: passed in previous runs; counts evolved over time and should be re-run rather than copied.
- LittleFS format unit suite and isolated PoC compile: PASS historically.
- Real hardware read-only stable 16S: PASS 2026-09-09.

### Not tested / not sufficient

- No full V2 release pipeline PASS.
- No current clean-checkout reproducibility: working tree is dirty and uncommitted.
- No checked-in real browser E2E.
- No exact multi-client write API test because API is absent.
- No real packed RMW.
- No real controlled RW success/mismatch/timeout/recovery trace on BMS.
- No real dynamic 16↔8 transition proof; no 32S hardware proof.
- No production LittleFS flash/OTA/power-loss test.
- No full security negative matrix.
- No 72-hour soak.
- Last browser DOM claim from Claude was not independently repeated during the final audit because no active unlocked browser surface was available.

## Build/deployment status

### Local validation

```bash
node --check jk_bms.js
node tools/protocol/generate.js --check
node tools/protocol/fingerprint.js check
bash test/run_all.sh
esphome config batterylifepo4.yaml
esphome compile batterylifepo4.yaml
```

`test/run_all.sh` without V2 evidence is not a release proof. Current V2 command is expected to expose the known failure until P0 pipeline migration:

```bash
JK_BMS_WORKBOOK_PATH=/Users/mykola.krokhmal/Downloads/LiFePO4_BMS_Parameters_registers-V2_verified.xlsx \
  bash test/run_all.sh
```

### Demo

```bash
node demo/mock-server.js
# open http://localhost:8321/
```

No npm dependencies/build step are required for current demo.

### Flash/deployment

```bash
esphome run batterylifepo4.yaml                  # first USB flash or interactive OTA
esphome upload batterylifepo4.yaml --device IP  # OTA when reachable
```

Do not flash the current dirty tree or test-build with placeholder secrets to production without a reviewed release artifact, backup, safe rollback and explicit user authorization. `secrets.yaml` is required locally and gitignored.

## Current Git state

- **VERIFIED:** branch `bms-v1.1-manifest-audit`.
- **VERIFIED:** HEAD `93b4c1df9003e76072e08915a20614075dac8693` — `Add illustrated architecture overview (docs/ARCHITECTURE.md)`.
- **VERIFIED:** all work after this commit is uncommitted at handoff time.
- **IMPORTANT:** do not reset/clean/checkout/discard. Changes belong to the user/Claude workstream.

Tracked modifications/deletion before adding handoff docs:

```text
.gitignore
CLAUDE_FINAL_READINESS_PROMPT_UA.md (deleted)
OPEN_ISSUES.md
docs/adr/0001-protocol-catalog.md
jk_bms.css
jk_bms.js
protocol/README.md
protocol/evidence/build_workbook_index.py
protocol/evidence/implementation_index.json
protocol/evidence/sources.json
protocol/evidence/upstream_index.json
protocol/evidence/workbook_index.json
protocol/generated/.generation-manifest.json
protocol/generated/.pipeline-manifest.json
protocol/generated/claim_matrix.json
protocol/generated/coverage_report.md
protocol/non_register_entities.canonical.json
protocol/registers.canonical.json
protocol/schema/evidence-sources.schema.json
protocol/schema/non-register-source.schema.json
register_catalog.json
test/protocol_catalog/test_blocked_write_surface.js
test/protocol_catalog/test_entity_id_collision.js
test/protocol_catalog/test_generation_atomicity.js
test/protocol_catalog/test_negative_fixtures.js
test/protocol_catalog/test_secret_scan.js
test/run_all.sh
tools/protocol/generate.js
tools/protocol/pipeline.js
```

Untracked functional/evidence files before adding handoff docs:

```text
BMS_V2_GAP_REMEDIATION_PLAN.md
BMS_V2_MANIFEST_EXECUTION_LOG.md
CURRENT_STATE_AUDIT.md
IMPLEMENTATION_EXECUTION_LOG.md
protocol/evidence/BMS_RS485_Modbus_V1.1.pdf
protocol/evidence/IMPLEMENTATION_DRIFT_REVIEW.md
protocol/evidence/LiFePO4_BMS_Parameters_registers-V2_verified.xlsx
protocol/evidence/build_v2_gap_audit.js
protocol/evidence/build_v2_manifest.py
protocol/evidence/stage1_corrective_evidence/
protocol/generated/bms_v1_1_gap_audit.json
protocol/generated/bms_v1_1_manifest.json
test/protocol_catalog/test_claim_matrix_invariant.js
test/protocol_catalog/test_fingerprint_drift_regression.js
test/protocol_catalog/test_mixed_generation_rejection.js
test/protocol_catalog/test_port_allocation.js
test/protocol_catalog/test_release_runner.js
test/regenerate_protocol_artifacts.sh
test/release/
test/run_release.sh
tools/protocol/fingerprint.js
tools/protocol/lib/fingerprint.js
tools/protocol/lib/release-id.js
```

This handoff adds `AGENTS.md`, `PROJECT_STATE.md`, `DECISIONS.md`, `TROUBLESHOOTING.md`, `HANDOFF.md` as documentation-only untracked files unless the user later commits them.

## Unresolved contradictions / uncertainties

1. **Auth docs vs code:** `docs/AUTH_AND_HISTORY.md` says Basic auth / ESPHome 2026.6.5; current YAML explicitly uses Digest and comments/compile evidence cite 2026.8.2. Code is newer; verify runtime 401/auth behavior on hardware.
2. **Old ADR/README vs V2:** ADR/protocol README call old canonical catalog the single source of truth; newer V2 artifacts and user decision make verified V2 workbook + official PDF the intended foundation. Migration is incomplete, so neither model alone describes both intent and runtime.
3. **Stage 5 “all tests passed” vs V2:** Claude's run used/skipped old workbook semantics; current V2 reproducibly fails the old indexer. The newer independent test is authoritative for current workbook compatibility.
4. **Freshness claim:** Stage 5 prose says UI-wide freshness; code has null budgets for most non-register/derived values. Code is authoritative: coverage is partial.
5. **P1-04 closure claim:** older `OPEN_ISSUES.md` says closed; current orphan `control_override_reason` reopens structural completeness for at least one key.
6. **Workbook grouping:** 12 curated groups exist, but no deterministic row mapping. Ask user/source owner rather than infer.
7. **Cell capability:** official V1.1 describes 32 channels; observed device is 16S and runtime is 16-bound. Whether this exact deployed firmware/model safely supports >16 is UNKNOWN.
8. **Vendor extensions:** `0x111C`/`0x1470` appear in workbook/implementation but not official V1.1. Supported firmware/model set is UNKNOWN.
9. **Write failure root cause on real hardware:** UI mismatch/restore behavior is known, but raw wire trace for the failed `16→8` attempt was not captured; protocol rejection, timing, safety validation or endpoint behavior remain UNKNOWN.
10. **Latest live DOM:** Claude reported manual demo success; final independent audit could not repeat it due unavailable browser surface. Static and mock tests support parts of the claim, not all visual behavior.
11. **Docs counts/hashes:** historical reports list different test counts and config hashes from different code revisions. Always regenerate; do not select one as universally current.
12. **Control tab removal:** current navigation appears to have no separate Control tab, consistent with the user preference, but no explicit recent acceptance test documents this as final product decision.
