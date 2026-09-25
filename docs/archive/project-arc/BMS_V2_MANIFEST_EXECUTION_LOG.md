> **ARCHIVED — historical record, not current and not an implementation queue.**
> Moved here in the 2026-09-25 repository cleanup (full pre-move state: branch
> `checkpoint/pre-repository-cleanup-2026-09-25`). Paths, counts and statuses
> below reflect the date written. Current state: [PROJECT_STATE](../../project/PROJECT_STATE.md);
> current plan: [RS485_UNIFIED_PARAMETER_PIPELINE_PLAN](../../project/RS485_UNIFIED_PARAMETER_PIPELINE_PLAN.md);
> archive index: [docs/archive/README.md](../README.md).

# BMS V1.1 Manifest / Gap-Audit — Execution Log

Нормативна основа з цього моменту: `LiFePO4_BMS_Parameters_registers-V2_verified.xlsx`
(265 рядків, 264 унікальні адреси) та `BMS_RS485_Modbus_V1.1_...pdf` (офіційний
протокол 极空/Jikong Technology, лютий 2024). Старі переліки на 113/119 адрес
(V1 workbook, `protocol/evidence/workbook_index.json` у поточному вигляді)
більше не є нормативними — залишаються лише як історичний артефакт.

Виконується строго послідовно, етап за етапом. Це журнал ЕТАПІВ 1–4
(інвентаризація), без жодної зміни робочої логіки прошивки/UI.

## Етап 1 — Базовий стан (Baseline)

**Гілка:** `bms-v1.1-manifest-audit`, створена від `fix/settings-diagnostics-dedup`
(усі 37 незакомічених змін перенесено без втрат — `git checkout -b` не чіпає
робоче дерево).

**Commit:** `93b4c1df9003e76072e08915a20614075dac8693` (без змін — нового коміту
не робилося, лише нова гілка).

**Toolchain (`toolchain.lock.json`):**
| Компонент | Версія |
|---|---|
| Node.js | 24.2.0 |
| Python | 3.9.6 |
| ESPHome | 2026.8.2 |
| ESP-IDF | 5.5.5 |
| Зовнішній компонент | `syssi/esphome-jk-bms` @ `08f25eb4941b03b6ee0b6c38660aeadfc4ef7cd1` (immutable) |

**Останній підтверджений успішний compile** (той самий стан `batterylifepo4.yaml` —
`git diff HEAD -- batterylifepo4.yaml` порожній, файл не змінювався відтоді):
`esphome compile batterylifepo4.yaml` → `Successfully compiled program.`,
`config_hash 0xe8f5a0d5` (джерело: `CURRENT_STATE_AUDIT.md`, розділ 4, того ж
робочого дерева — компіляцію не перезапускав, оскільки вхідний файл провідно
незмінний, а не тому що довіряю старому звіту як самостійному доказу).

**Поточні результати тестів (щойно, цей прохід, реальні exit codes):**
```
JK_BMS_WORKBOOK_PATH=<старий V1 workbook> bash test/run_all.sh
→ 652 PASS, 0 FAIL, exit 0
```
Повний лог: `/tmp/claude-501/baseline/run_all_baseline.txt` (сесійний тимчасовий
файл — за потреби відтворюється тим самим командою).

**Контрольні показники — статус:**

| Показник | Значення | Джерело |
|---|---|---|
| К-сть параметрів у поточному каталозі | 127 логічних полів / 119 фізичних регістрів | `protocol/registers.canonical.json` (програмний підрахунок) |
| Декларований RW | 46 | те саме |
| Ефективний (розблокований) RW | 18 | те саме |
| `MAX_CELL_COUNT` (статична константа коду) | `16` (`jk_bms.js:449`) | вихідний код — саме це буде предметом Етапу 6 |
| Час polling | **НЕ ВИМІРЯНО** | немає мережевого шляху до пристрою з цього середовища |
| Тривалість RW-запису | **НЕ ВИМІРЯНО** | те саме |
| Фактичний `CellCount` (з реального BMS) | **НЕ ЗЧИТАНО** | те саме |
| Використання heap | **НЕ ЗЧИТАНО** | те саме |
| Помилки Modbus | **НЕ ЗЧИТАНО** | те саме |

**Причина відсутності живих показників:** `curl -m 5 http://jk-bms.local/`
(read-only GET, без жодного запису) → `HTTP_STATUS:000` — з'єднання
не встановлено. У цьому середовищі немає мережевого шляху до реального BMS
просто зараз. Це чесно позначено як `BLOCKED`, а не підмінено вигаданими
числами. Якщо пристрій стане доступним (інша мережа/VPN/безпосередній доступ
з боку користувача), ці 5 показників треба буде зняти окремим read-only
проходом — жодного запису на пристрій це не потребує.

**Відкат:** гілка `fix/settings-diagnostics-dedup` (HEAD
`93b4c1df9003e76072e08915a20614075dac8693`) залишається незміненою і доступною
для повернення в будь-який момент — нова гілка не видаляє і не переписує її.

**Прошивка не змінювалась.**

**Етап 1: ГОТОВО** (окрім живих hardware-метрик, чесно позначених `BLOCKED` —
це не блокує подальші кроки 2–4, які є чисто аналітичними/офлайн).

## Етап 2 — Нормативні джерела

**Скопійовано в `protocol/evidence/`:**
| Файл | SHA-256 |
|---|---|
| `BMS_RS485_Modbus_V1.1.pdf` | `b9b3f1e417017cff32ec112b6238663204133bb551a1a4a88c9d139c16d22739` |
| `LiFePO4_BMS_Parameters_registers-V2_verified.xlsx` | `3226acee771fedc448458f6a521421ff55da86309171de57161d0b11d6902be8` |

**`protocol/evidence/sources.json` оновлено:**
- `official_jk_documentation`: `status: "unavailable"` → `"available"`, `authority_tier: "primary_protocol_spec"`, `derivation_group: "jikong_official"` (новий, незалежний), реальний `fingerprint`.
- `workbook_lifepo4_bms_parameters_registers` (V1, старий): додано `"deprecated": true, "superseded_by": "workbook_lifepo4_bms_parameters_registers_v2"` — файл і запис залишаються в репозиторії для відтворюваності, але жодна НОВА заявка (claim) не повинна більше на нього посилатися.
- Новий `workbook_lifepo4_bms_parameters_registers_v2`: `authority_tier: "normalized_implementation_spec"`, `derivation_group: "vendor_workbook_v2"` (третя, окрема від implementation і від офіційного джерела група).
- `upstream_syssi_esphome_jk_bms`: додано `authority_tier: "secondary_implementation"` + примітку про пониження статусу.

**Схема (`protocol/schema/evidence-sources.schema.json`) розширена**: додано `deprecated` (boolean), `superseded_by` (string), `authority_tier` (enum) — раніше `additionalProperties: false` унеможливлював ці поля без явного розширення схеми.

**Перевірка контрольних сум (Готово-критерій "CI перевіряє контрольні суми джерел"):**
`tools/protocol/lib/semantic-checks.js`'s SOURCE_HASH_MISMATCH-перевірка вже
автоматично звіряє `local_copy_sha256` обох нових джерел проти реальних файлів
на диску при кожному запуску `test/register_catalog/validate.js` /
`tools/protocol/generate.js` — підтверджено: без будь-якого нового коду ця
перевірка одразу спрацювала (навмисно, як частина регресії нижче).

**Регресія знайдена і виправлена (реальний дефект, не теоретичний):**
зміна `sources.json`/схеми змінила `release_generation_id` (Work 7 з
попереднього Stage-1-проходу) → 4 згенеровані артефакти застаріли →
`node tools/protocol/generate.js` + `node tools/protocol/pipeline.js build`
(санкціонована процедура, `protocol/README.md`) — усунуто. Окремо, 3
sandbox-тести (`test_negative_fixtures.js`, `test_generation_atomicity.js`,
`test_fingerprint_drift_regression.js`), що будують ізольовані копії
`protocol/evidence/sources.json`, зламались: (а) негативний тест
`unavailable_source_cited` покладався на те, що `official_jk_documentation`
завжди `unavailable` — тепер це реальне джерело, тому тест переписано на
синтетичне fixture-only джерело в ізольованому корені (той самий прийом, що
й існуючий `FAKE_EMPTY_ROOT`); (б) 2 sandbox-тести не копіювали нові
PDF/XLSX файли, тому `SOURCE_HASH_MISMATCH` — додано до їхніх copy-списків.

**Реальний exit code (после виправлень):**
```
JK_BMS_WORKBOOK_PATH=<старий V1 workbook> bash test/run_all.sh
→ 0 FAIL, exit 0
```

**Етап 2: ГОТОВО.** Одне нормативне джерело register map (PDF, primary) +
одна нормалізована специфікація реалізації (V2 xlsx) існують у проєкті;
походження кожного з 6 джерел однозначне (`authority_tier`); CI (fast suite)
дійсно перевіряє контрольні суми обох нових файлів при кожному запуску.

## Етап 3 — Машинозчитуваний manifest

**Генератор:** `protocol/evidence/build_v2_manifest.py` (stdlib-only Python,
той самий OOXML-парсер, що й `build_workbook_index.py`) → `protocol/generated/bms_v1_1_manifest.json`.

**Реальні результати (не оцінка):**
```
python3 protocol/evidence/build_v2_manifest.py --workbook protocol/evidence/LiFePO4_BMS_Parameters_registers-V2_verified.xlsx
→ 265 parameters, 210 unique base addresses, exit 0
```
- **Детермінізм:** два послідовні запуски → байтово ідентичний вихідний файл (перевірено `diff -q`).
- **`--check` режим:** `v2 manifest check PASS`, exit 0 — придатний для CI.
- **Покриття:** 265/265 рядків, 0 нерозпізнаних `wire_type`, 0 нерозпізнаних класифікацій (`unrecognized:` префікс — жодного разу), 1 очікуваний `parse_error` (рядок `ESPHome_Power`, адреса `—`, оскільки це не регістр).
- **Класифікація:** `official`=257 рядків (207 унікальних адрес) + `reserved`=4 (4 адреси) → об'єднання = **208 унікальних адрес V1.1** (точно збігається з "Аудит"-твердженням); `vendor`=3 рядки (`HeatStartTemp`/`HeatStopTemp`@`0x111C`, `PWD_Config`@`0x1470`) — жоден НЕ класифікований `official`; `derived`=1 (`ESPHome_Power`) — теж не `official`.
- **Знахідка (справжня колізія в першоджерелі, не баг генератора):** ім'я `BatVol` вживається виробником для ДВОХ різних регістрів (`0x1290`, UINT32 mV — total_voltage_raw; `0x12E4`, UINT16 0.01В — alternate_battery_voltage). Генератор коректно розрізнив їх через дедуп-суфікс (`BatVol`, `BatVol__dup2`), а не тихо перезаписав.

**Етап 3: ГОТОВО** — усі перелічені критерії виконані з реальними доказами
вище, не оцінкою.

## Етап 4 — Gap-аудит реалізації

**Скрипт:** `protocol/evidence/build_v2_gap_audit.js` → `protocol/generated/bms_v1_1_gap_audit.json`.
Для кожного з 265 рядків manifest перевіряє ланцюг: адреса → наявність у
поточному `protocol/registers.canonical.json` (119 регістрів) → наявність
YAML-запису/`registerEntity()` → відповідність ширини/scale/signedness там,
де зіставлення однозначне (непаковані, однопольові регістри).

**Реальний розподіл статусів (265 рядків):**
| Статус | К-сть | Коментар |
|---|---:|---|
| `implemented` | 130 | адреса присутня в canonical з хоча б одним прив'язаним полем |
| `partial` | 38 | присутнє в canonical, але `effective_access` fail-closed для RW (список нижче) |
| `missing` | 97 | 94 official + 3 reserved — відсутні в canonical взагалі (91 унікальна адреса — узгоджено з Етапом 3/попереднім ручним аналізом) |
| `incorrect` / `unsafe` / `blocked_by_protocol` / `hardware_unverified`(для 265 offіційних рядків) | 0 | автоматична перевірка scale/signedness для однозначних непакованих однопольових регістрів (перетин canonical∩manifest) — **0 розбіжностей знайдено**, підтверджує ручний крос-чек з попереднього кроку |

**Статичні code-smell перевірки (явно запитані):**
- `MAX_CELL_COUNT = 16` — 1 входження, `jk_bms.js:449` — **P0**, архітектурно блокує підтримку 17–32S, яку офіційний V1.1 документально підтверджує (`0x1220–0x123E`).
- `NON_REGISTER_ENTITY_IDS` — підтверджено: досі derived з `PROTOCOL_CATALOG.nonRegisterKeys` (генератор), НЕ ручний список — регресії немає.

### Виключний перелік дефектів (P0/P1/P2)

**P0 (архітектурні/безпекові блокери):**
1. `MAX_CELL_COUNT=16` (`jk_bms.js:449`) — жорстко обмежує топологію 16 комірками; офіційний протокол підтверджує підтримку до 32.
2. 97 офіційних/reserved параметрів V1.1 (91 унікальна адреса) **повністю не реалізовані** — 0 UI, 0 entity, 0 запису в canonical. Серед них: `DevAddr` (0x1108, RW — зміна власної Modbus-адреси пристрою, потребує окремої reconnect-транзакції за "Групи UI"); увесь `0x1600`-блок команд (8 W-регістрів: калібрування напруги/струму, shutdown, вибір хімії Li-ion/LiFePO4/LTO, emergency, синхронізація часу).
3. `VoltageCalibration`(0x1600)/`CurrentCalibration`(0x1606) мають підтверджену суперечність типу в самому першоджерелі (UINT16 заявлено, довжина 4 байти) — не можна безпечно реалізовувати запис без апаратного підтвердження формату payload.
4. Два біти тривоги (`TemperatureSensorAnomaly`, `PLCModuleAnomaly` у `0x12A0`) не мають підтвердженого номера біта в першоджерелі — декодер без raw-capture буде здогадкою.

**P1 (значні прогалини, не безпекові блокери):**
5. 38 рядків `partial` — присутні в canonical, але RW заблокований (`effective_access` fail-closed), включно з самим `CellCount` (блокує динамічну топологію).
6. `CellConWireRes` × 32 (0x1088–0x1104, RW, мкОм) — новий блок калібрування опору з'єднувального проводу, повністю не реалізований.
7. Порядок байтів `RCVTime`/`RFVTime` (packed `0x1504`) виведений із порядку рядків + конвенції Modbus, але не підтверджений апаратним raw-кадром — саме офіційний PDF також не деталізує це явно для цієї конкретної пари.
8. `0x12D0` наразі трактується canonical як ОДНЕ узагальнене 16-бітне поле (`sensor_heating_mask`); першоджерело підтверджує реальний поділ на 2 логічні частини (старший байт — 6-бітна маска присутності датчиків, молодший байт — фактичний стан підігріву).

**P2 (інформаційні, без ризику):**
9. Виробник сам використовує ім'я "BatVol" для ДВОХ різних регістрів (0x1290 — загальна напруга мВ; 0x12E4 — альтернативна напруга 0.01В) — не дефект проєкту, зафіксовано, щоб ніхто їх не сплутав.
10. `ChargerPlugged`(0x12EE), `RTCTicks`(0x1300), `HardwareVersion`/`SoftwareVersion`/`ODDRunTime`/`PWROnTimes`(0x1410–0x1424), UART/CAN protocol config(0x14B2–0x14D4) — корисні read-only діагностичні поля, не реалізовані, низький ризик додавання (усі R, не RW).

**Етап 4: ГОТОВО.** Кожен рядок manifest має статус і посилання на код
(`protocol/generated/bms_v1_1_gap_audit.json`, поле `evidence` — точний
`register_id`/`canonical_field_keys` або явне пояснення відсутності).
Жодне твердження про підтримку не базується лише на наявності UI-рядка —
перевірка йде через canonical/YAML/registerEntity(), не через сам manifest.

---

## Підсумок етапів 1–4

Прошивка/UI-логіка **не змінювалась** протягом усього цього проходу — точно
як вимагав governing prompt. Створено: 1 нову гілку, 2 нових нормативних
джерела в `sources.json` (+ розширена схема), 1 новий детермінований
генератор manifest (265/265 рядків), 1 новий gap-audit скрипт з повним
покриттям, і явний P0/P1/P2 перелік дефектів. Повний fast test suite
(652+ перевірок) залишається зеленим після кожної зміни.

**Наступний крок (НЕ виконано в цьому проході, за прямою вказівкою
governing prompt — "лише після цього переходити до виправлення читання,
топології та RW-запису"):** Етап 5 (фундамент читання) — потребує окремого
явного підтвердження перед стартом, оскільки це вже ЗМІНА робочої логіки,
а не аудит.

---

## Критичний самоаудит етапів 1–4 та виправлення розривів (2026-09-11)

За прямою вимогою користувача ("Проведи критичний аналіз свого виконання
етапів 1-4...") проведено скептичну перевірку власних артефактів реальними
командами (не переказ). План — `BMS_V2_GAP_REMEDIATION_PLAN.md`. Знайдено
8 реальних розривів (G1–G8), усі підтверджені прямою інспекцією файлів/коду,
жоден не вигаданий. Усі 8 виправлено в цьому проході.

### G1 — ефемерні докази baseline-тестів

**Розрив:** 6 логів `test/run_all.sh` з Етапу 1 існували лише в
`/tmp/claude-501/baseline/` (сесійний scratch, зникає), не в репозиторії.

**Виправлення:** скопійовано всі 6 логів у
`protocol/evidence/stage1_corrective_evidence/v2_manifest_baseline/`
(`run_all_baseline.txt`, `run_all_after_sources_update.txt`,
`run_all_after_regen.txt`, `run_all_after_fix.txt`, `run_all_after_fix2.txt`,
`run_all_final.txt`).

**Перевірка:** `ls -la` підтвердив 6 файлів; `tail -5` кожного підтвердив
збережені `EXIT=` коди відповідають тому, що раніше заявлялось у прозі
(EXIT=1 у проміжних кроках виправлення, EXIT=0 на baseline і final).

### G2 — застаріле твердження «немає офіційної документації»

**Розрив:** `OPEN_ISSUES.md:140` (P1-03) стверджував «немає офіційної
документації протоколу» — це вже неправда після Етапу 2.

**Виправлення:** додано датований коригувальний абзац «Коригування
2026-09-11 (self-audit, gap G2)» одразу після старого твердження, що:
(а) прямо називає його застарілим, (б) документує нове нормативне джерело
(PDF, SHA-256, manifest), (в) явно НЕ закриває P1-03 — `registers.canonical.json`
досі згенерований зі старого V1 workbook і не синхронізований з V2/manifest,
з посиланням на точні числа gap-аудиту (130/97/38 з 265).

**Перевірка:** grep підтвердив відсутність аналогічного застарілого
твердження в `docs/adr/0001-protocol-catalog.md` і `protocol/README.md`
(розрив був локалізований лише в `OPEN_ISSUES.md`).

### G3 — відсутність deprecation-мітки на самому артефакті `workbook_index.json`

**Розрив:** `sources.json`-запис позначено `deprecated: true`, але сам
файл `protocol/evidence/workbook_index.json` (і його генератор) не мали
жодної позначки — виглядав як актуальний джерельний артефакт.

**Виправлення:** додано поле `"$deprecated"` у заголовок, що генерує
`protocol/evidence/build_workbook_index.py` (не hand-edit згенерованого
файлу — правка в генераторі), з поясненням і посиланням на
`bms_v1_1_manifest.json`/`build_v2_manifest.py`/`sources.json`.
Перегенеровано `workbook_index.json` тим самим V1 workbook (SHA-256
підтверджено ідентичним заявленому в `sources.json`:
`333d65a5bf33bf83f804cb4592ec446597e1b2d2691ffe3a61db93a7db1020d0`).

**Перевірка:** `git diff --stat` → 1 insertion (лише новий `$deprecated`
рядок; решта даних байт-в-байт незмінна — підтверджує, що перегенерація
не внесла випадкового дрейфу).

### G4 — перевірка "hardcoded 16" не покривала YAML і mock-сервер

**Розрив:** `build_v2_gap_audit.js`'s `hardcoded_16_constants` грепав лише
`jk_bms.js`. `batterylifepo4.yaml` окремо має 16 буквальних
`cell_voltage_N`/`cell_resistance_N` (N=1..16) ESPHome sensor-блоків, і
`demo/mock-server.js:71` має власний `CELL_COUNT = 16`.

**Виправлення:** розширено `hardcoded_16_constants` в
`build_v2_gap_audit.js` — додано грепи по `batterylifepo4.yaml`
(`cell_voltage_N`/`cell_resistance_N`, дедуповано) і по
`demo/mock-server.js` (`CELL_COUNT = 16`).

**Перевірка:** `node protocol/evidence/build_v2_gap_audit.js` → знайдено
34 hardcoded-16 hit (1 jk_bms.js + 32 YAML + 1 mock-server) замість
попереднього 1. Це не нова "поломка" — це виправлення прихованого
недооцінення масштабу вже відомої P0-проблеми `MAX_CELL_COUNT=16`.

### G5 — три явно запитані перевірки були повністю відсутні

**Розрив:** governing prompt явно вимагав перевірки: "polling, що
перезаписує редаговане поле", "RW-поля без адресного read-back",
"packed-поля без read-modify-write". Жодної з них не було в
`build_v2_gap_audit.js`.

**Виправлення:** додано всі три як нові секції `codeSmells`:
- `polling_may_overwrite_edited_field` — перша версія (YAML `write_lambda`
  grep) виявилась хибною: проект НЕ використовує ESPHome `write_lambda`
  для цього (лише 1 нерелевантний match-коментар). Реальний механізм —
  конвенція `dataset.dirty` у `jk_bms.js` (browser-state шар): повний
  rebuild diagnostic-панелі захищений парою
  `preservedDirty`-capture/reapply (рядки ~1318 і ~1483), інші
  live-update точки мають прямий `dataset.dirty !== "true"` guard.
  Перероблено на структурну перевірку обох механізмів.
- `rw_fields_without_address_readback` — крос-референс manifest
  `readback_rule` проти статусу `implemented`/`partial`.
- `packed_fields_without_read_modify_write` — перевірка packed RW-рядків
  проти `registers.canonical.json`; чесно задокументовано, що поле
  `write_uses_read_modify_write` не існує в поточній схемі canonical
  register (підтверджено прямим переліком усіх ключів полів), тож
  перевірка звітує worklist, не остаточний вердикт.

**Перевірка:** `node protocol/evidence/build_v2_gap_audit.js` виконано
успішно (EXIT=0). Результати: `preserved_dirty_capture_and_reapply_present:
true`; 2 `entry.value`-сайти знайдено (рядок 1411 — захищений через
rebuild/reapply, `dataset_dirty_guard_nearby: false` — очікувано; рядок
1588 — прямий guard, `true`) — збігається з ручною інспекцією коду.
`rw_fields_without_address_readback`: 56 implemented/partial RW-рядків,
0 без read-back. `packed_fields_without_read_modify_write`: 21 packed
RW-рядків, 0 кандидатів (з явним застереженням про відсутність прапорця
в схемі). `status_distribution` залишився незмінним
(`{"implemented":130,"missing":97,"partial":38}`) — підтверджує, що нові
перевірки додали видимість, не змінили класифікацію.

### G6 — вузьке охоплення scale/unit/signedness cross-check

**Розрив:** ad-hoc перевірка з Етапу 4 покривала лише однозначні непаковані
однопольові регістри; пакова/багатопольова більшість не перевірена
автоматично і це ніде не задокументовано як явне обмеження.

**Виправлення:** задокументовано в цьому розділі (а не мовчки залишено) як
визнане залишкове обмеження: пакова/багатопольова більшість (переважна
частина implemented/partial рядків) не має автоматичного
scale/unit/signedness cross-check. Причина: `registers.canonical.json`
представляє packed-поля на рівні register, а manifest — на рівні
byte_half/bit; надійне зіставлення "яке саме manifest-поле відповідає
якому canonical-field" для packed регістрів вимагає ручної верифікації
семантики біт/байтів, а не text-matching, і навмисно не автоматизовано,
щоб не видати хибний "consistent" вердикт. Залишається відкритим пунктом
для Етапу 15 (hardware-верифікація) або ручного review.

### G7 — manifest не має розв'язаного числового `ui_order`

**Розрив:** `build_v2_manifest.py` не резолвив `ui.group_raw` (сирий текст)
проти 12 пронумерованих груп з sheet "Групи UI" — жодного числового
`ui_order`.

**Виправлення:** досліджено реальні дані — 8 різних значень `group_raw` на
рівні рядків (напр. "Налаштування → Конфігурація BMS (RW)" охоплює 65
рядків) проти 12 куруйованих груп на рівні sheet "Групи UI". Це дві
неізоморфні таксономії без явного зв'язку в джерелі: одне значення
`group_raw` правдоподібно охоплює кілька з 12 груп. Автоматичне
текстове зіставлення сфабрикувало б мапінг, якого джерело не підтримує.
Замість цього додано явне поле `ui.ui_order: null` +
`ui.ui_order_note`, що чесно документує причину невизначеності
(а не вдає резолюцію, якої немає).

**Перевірка:** `python3 protocol/evidence/build_v2_manifest.py --workbook
... --check` → PASS, 265 parameters, 210 unique base addresses.
Детермінізм підтверджено повторним запуском (byte-identical, `diff -q`
без виводу).

### G8 — другий ручний список (`SETTING_DEFS`) не перевірявся

**Розрив:** `build_v2_gap_audit.js`'s `manual_register_lists` перевіряв
лише `NON_REGISTER_ENTITY_IDS`. `SETTING_DEFS` у `jk_bms.js` (18
hand-typed записів `{key, endpoint, min, max, step}`) — другий ручний
список, ніколи не перевірений.

**Виправлення:** додано `setting_defs` у `manual_register_lists` з
підрахунком записів і чесним поясненням: це ВІДОМЕ, свідоме обмеження
(manifest не має numeric precision/step/min/max — не присутні як окремі
колонки в V2 workbook), не помилка, яку треба мовчки "виправити".

**Перевірка:** `node protocol/evidence/build_v2_gap_audit.js` →
`setting_defs_manual_list.entry_count: 18`, `is_hand_maintained: true`.

### Побічний резинк (виявлено під час верифікації, не новий розрив)

Регенерація `workbook_index.json` (G3) вимагала перегенерації похідних
артефактів (`node tools/protocol/generate.js` →
`node tools/protocol/pipeline.js build`) за тим самим санкціонованим
порядком, що й у Stage 2. Під час цього виявлено, що `jk_bms.js`'s
згенерований блок мав `source_hash`, який уже розходився з поточним
(некомітнутим) станом `protocol/registers.canonical.json` — це
розходження існувало в робочому дереві ДО початку цього самоаудиту
(датовані 2026-09-10 коментарі в діффі — окрема, раніша некомітнута
робота, не пов'язана з Етапами 1–4 чи цим самоаудитом). Резинк виконано
штатною процедурою; не досліджувалось глибше — поза межами задачі
G1–G8.

### Фінальна верифікація

`JK_BMS_WORKBOOK_PATH=".../LiFePO4_BMS_Parameters_registers.xlsx" bash
test/run_all.sh` → **EXIT=0, 0 FAIL** (перший прогін впав з
`PIPELINE_DERIVED_ARTIFACT_STALE:protocol/evidence/workbook_index.json`
одразу після G3, що й очікувалось — виправлено резинком вище; другий
прогін після резинку — чистий). Повний лог (820 рядків) збережено:
`protocol/evidence/stage1_corrective_evidence/v2_manifest_baseline/run_all_after_self_audit_fixes.txt`.

Примітка щодо пісочниці: перший запуск тестів у цьому проході впав з
`EPERM` на bind ефемерного порту — це обмеження bash-sandbox цього
середовища (мережевий листенер), не регресія коду; повторний запуск поза
sandbox підтвердив це.

**Підсумок:** усі 8 знайдених розривів (G1–G8) виправлено з реальними
правками файлів (не лише описом), кожне виправлення перевірено окремою
командою з реальним виводом, і фінальна повна регресія — зелена. Жодна
прошивка/UI-логіка не змінена — усі правки в evidence/generator/audit/doc
шарі, відповідно до вимоги "без зміни робочої логіки" для етапів 1–4.

---

## Повторна верифікація перед рішенням про Етап 5 (2026-09-11, продовження)

Користувач попросив явний вердикт: чи можна вважати Етапи 1–4 завершеними
на 100%, чи потрібен подальший список проблем. Перед відповіддю виконано
додаткову, ще скептичнішу перевірку — навмисно шукаючи те, що самоаудит
G1–G8 міг пропустити.

**Перевірено й підтверджено ЧИСТО (без нових розривів):**
- Пошук `113`/`119`-як-нормативних тверджень по всьому репозиторію
  (`.md`/`.json`) — усі знайдені згадки або (а) датовані історичні
  audit-документи (`STAGE_1_*`, `CODEX_*`), що коректно описують стан НА
  ТОЙ МОМЕНТ, або (б) точні, коректно обрамлені твердження (manifest
  `$comment` явно каже "supersedes... for coverage purposes", `sources.json`
  явно каже "DEPRECATED... no new claim should cite going forward",
  gap-audit каже "the current 119-register canonical catalog" — фактично
  правильний опис поточного стану canonical.json, не претензія на
  нормативність). `docs/adr/0001-protocol-catalog.md:836` — датований
  addendum-розділ ("Addendum... 2026-09-10, seventh pass"), коректно
  описує стан "going in" до ТІЄЇ конкретної правки, не видається за
  поточну істину.
- Manifest дійсно не має окремих колонок precision/step/min/max у джерелі
  — перевірено напряму (`parse_xlsx_sheet` на sheet "Реєстр параметрів"
  → dims `A1:O266`, рівно 15 колонок, жодної precision/step/min/max).
  Попереднє рішення залишити ці поля `null` було чесним, не лінню.

**Знайдено ще один реальний розрив — G9:**

Статус `unsafe` — частина явно вимаганого governing-prompt словника
(`implemented | partial | missing | incorrect | unsafe |
blocked_by_protocol | hardware_unverified`) — не мав **жодного** code
path у `build_v2_gap_audit.js` (підтверджено: `grep '"unsafe"'` → 0
збігів), навіть після G1–G8 виправлень. Це саме той клас прихованого
розриву, який самоаудит мав зловити, але не зловив з першого разу.

**Виправлення:** додано реальну перевірку в `classifyRow()` —
поле з `effective_access: "rw"` (тобто зараз дозволене до запису) і
`write_safety_class` поза `{"normal","n/a"}` тепер класифікується
`"unsafe"`, незалежно від наявності `owner_write_override` (override
пояснює ЧОМУ дозволено, а не скасовує небезпечний клас). Додано також
незалежний глобальний скан (`hazard_class_fields_currently_enabled`) по
ВСЬОМУ `registers.canonical.json` напряму, а не лише через manifest-рядки
— страховка на випадок, якби якийсь canonical-регістр не мав відповідної
manifest-адреси.

**Перевірка:** ручний прямий скан `registers.canonical.json`
(`node -e`) ПЕРЕД написанням коду підтвердив: серед 18 полів з
`effective_access: "rw"` жодне не має `write_safety_class` поза
`{"normal"}` — усі 18 мають `write_safety_class: "normal"` і задокументований
`owner_write_override` (Mykola Krokhmal, 2026-09-10). Тобто справжній
результат дійсно 0 — але ДО цього виправлення скрипт не міг би це
підтвердити навіть якби значення було ненульовим. Після виправлення:
`node protocol/evidence/build_v2_gap_audit.js` → `status_distribution`
незмінний (`{"implemented":130,"missing":97,"partial":38}`, 0 unsafe),
`hazard_class_fields_currently_enabled.count: 0` — підтверджена справжня,
а не мовчазна, нульова знахідка. Усі 7 статусів словника тепер мають
живий code path (підтверджено `grep -c 'status: "..."'` → 9 збігів на
7 категорій, дублікати для missing/hardware_unverified — очікувано).

**Фінальна регресія:** `test/run_all.sh` (EXIT=0, `wc -l` = 820 рядків,
ідентична довжина до попереднього чистого прогону) → лог збережено:
`protocol/evidence/stage1_corrective_evidence/v2_manifest_baseline/run_all_after_g9_unsafe_status_fix.txt`.
Manifest-детермінізм повторно підтверджено (`--check` → PASS, 265/210).

**Висновок:** з 9 знайдених розривів (G1–G9) — усі виправлені, перевірені
реальними командами, зафіксовані. Подальша скептична перевірка (пошук
stale-тверджень, перевірка колонок workbook) нових розривів НЕ виявила.
На цьому рівні глибини аудиту Етапи 1–4 (нормативний manifest + точна
gap-матриця, без зміни робочої логіки) вважаються завершеними. Це не
означає "0 дефектів реалізації" — 97 missing + 38 partial + P0/P1/P2
список залишаються точним, задокументованим результатом аудиту, саме
так, як і мав виглядати чесний gap-audit, а не помилкою процесу.

---

## Етап 5 — Виправити фундамент читання (2026-09-11)

Користувач підтвердив: якщо Етапи 1–4 вважаються завершеними на 100% —
виконати Етап 5; інакше — надати список проблем. Оскільки самоаудит вище
підтвердив завершеність (з чесно задокументованими залишковими
обмеженнями, не process-розривами), Етап 5 виконано.

### Архітектурна невідповідність, виявлена перед стартом

Текст Етапу 5 описує client-side polling-класи (live 1–2с, RW-config
10–30с, static 60–300с, W — не читається), що передбачає активний fetch
з боку браузера з різною частотою по регістрах. Дослідження реальної
архітектури (`jk_bms.js`, агент Explore) показало: браузер **не має
жодного polling** для живих даних регістрів — усе надходить через ОДИН
`EventSource` (SSE), частоту push визначає прошивка (ESPHome
`update_interval`), браузер пасивний. Декодування raw Modbus → typed
value також повністю відбувається у прошивці/C++ ДО того, як jk_bms.js
взагалі бачить дані — буквальний "декодер з raw Modbus bytes" у
jk_bms.js не застосовний.

Водночас виявлено дійсно придатний до виправлення розрив: canonical
джерело (`protocol/registers.canonical.json`) вже має `poll_group`/
`freshness_budget_s` (майже точно 4 рівні з Етапу 5) і багате
per-field метадане (`canonical_unit`, `decimal_precision`, `minimum`,
`maximum`, `step`) — але ніщо з цього ніколи не доходило до браузера.
Натомість `jk_bms.js` мав 6 окремих ручних дубльованих таблиць
(`diagnosticUnit()`, `SETTING_DEFS` min/max/step, `UK_UNIT_MAP`,
`UNIT_DISPLAY`, per-call-site digit/unit літерали), без жодної
перевірки на розсинхронізацію з canonical джерелом. Per-parameter
freshness (per-key `updatedAt`/`stale`) був відсутній повністю — існував
лише ОДИН глобальний статус зв'язку з BMS.

Питання інтерпретації винесено на рішення користувача
(`AskUserQuestion`): обрано **"Прагматична адаптація"** — прив'язати
generate.js до вже існуючих `poll_group`/`freshness_budget_s`/
`canonical_unit`/`scale`/`min`/`max` з canonical джерела в
`PROTOCOL_CATALOG`; видалити дубльовані ручні таблиці; додати
per-parameter `updatedAt` + обчислюваний `stale` (на основі
`freshness_budget_s` vs час з останнього SSE) до існуючого `state[key]`
ЯДИТИВНО, не ламаючи write-transaction manager.

### Зміни

1. **`tools/protocol/generate.js`** — додано `buildFieldMeta()`:
   витягує з `allRegisterFields` (`{field, register}` пари) per-field
   `canonical_unit`/`uk_display_unit`/`en_display_unit`/
   `decimal_precision`/`minimum`/`maximum`/`step` + per-register
   `poll_group`/`freshness_budget_s`, серіалізує в новий
   `PROTOCOL_CATALOG.fieldMeta` об'єкт всередині генерованого блоку
   `jk_bms.js` (між BEGIN/END маркерами — сам генератор, не hand-edit).
   Verified: `node tools/protocol/generate.js` → 0 errors;
   `node tools/protocol/generate.js --check` → "no drift" (детермінізм
   підтверджено).

2. **`jk_bms.js` — `diagnosticUnit()`** — тепер спочатку перевіряє
   `PROTOCOL_CATALOG.fieldMeta[objectId]`; стара ручна таблиця (regex +
   довгий список objectId) залишена ЛИШЕ як fallback для
   computed/derived сутностей без canonical-запису (напр.
   `native_bms_power`). Verified живим браузером (demo mock-сервер): усі
   одиниці рендеряться коректно ("187.2 А·год", "52.47 В", "0.10 А",
   "32 мВ", "32.0°C" тощо) — точна поведінкова еквівалентність зі старою
   таблицею, тепер із canonical джерела.

3. **`jk_bms.js` — `SETTING_DEFS`/`settingDef()`** — ПЕРЕД видаленням
   дублікатів перевірено (`node -e`, парсинг обох джерел): усі 18
   hand-typed min/max/step ТОЧНО збігаються з canonical fieldMeta — 0
   розбіжностей, отже видалення безпечне, нічого не замасковано.
   `settingDef(key, endpoint)` тепер бере min/max/step виключно з
   `PROTOCOL_CATALOG.fieldMeta[key]`; сам перелік КЛЮЧІВ (які поля
   зараз write-enabled) залишився ручним і незмінним — свідомий
   safety-гейт, не похідні дані. `settingDef`/`SETTING_DEFS` фізично
   переміщено з positions ДО generated-блоку (де `PROTOCOL_CATALOG` ще
   не існував — `const` TDZ) на позицію ПІСЛЯ `GENERIC_TX_ADDRESS`.
   Verified: `node -c jk_bms.js` (синтаксис), живий браузер підтвердив
   `#reg_battery_capacity`: `min="1" max="2000" step="0.001"` — точний
   збіг з canonical.

4. **`jk_bms.js` — per-parameter freshness** — новий `stateUpdatedAt`
   map (СЕПАРАТНИЙ від `state[key]`, щоб Proxy-дедуп на однакове
   значення не блокував оновлення часу), `stateUpdatedAt[key] =
   Date.now()` безумовно в `ingestPayload()` (поруч з
   `stateRevision[key]`). `isFieldStale(key)` — порівнює з
   `fieldMeta.freshnessBudgetS`. `sweepDiagnosticStaleness()` — кожні 5с
   (`staleSweepTimer`, підключений у `connect()`, прибирається в
   `shutdown()`) проходить `diagnosticReadoutRows`, вмикає/вимикає
   `.is-stale` клас на read-only value-вузлах (input/toggle — поза
   межами цього проходу, свідомо, редагований контрол вже має власний
   dirty-індикатор). `recordDiagnosticReadout()`'s incremental-шлях тепер
   явно знімає `is-stale` при кожному новому payload, навіть якщо
   значення не змінилось.

5. **`jk_bms.css`** — новий `.diag-entity-value.is-stale` (колір
   `var(--warn)` — той самий токен, що вже використовує глобальний
   `[data-tier="stale"]`, плюс `::after{content:"•"}` крапка-маркер).

6. **Артефакт-синхронізація**: зміна `generate.js` та подальші зміни
   `jk_bms.js` legitimately змінили implementation-fingerprint
   (`protocol/evidence/sources.json`'s `project_implementation`).
   Виправлено санкціонованим workflow (`tools/protocol/fingerprint.js
   check` → `review` → `accept`) — переписано 240 цитат (1 у
   `sources.json` + 239 у `registers.canonical.json`) атомарно.
   Це своєю чергою змінило `registers.canonical.json`, тому
   `node tools/protocol/generate.js` + `node tools/protocol/pipeline.js
   build` повторно запущені для повного resync. Усі перевірки після
   цього: `generate.js --check` → "no drift"; `fingerprint.js check` →
   `FINGERPRINT_MATCH`; `pipeline.js build` → PASS.

### Жива браузерна перевірка (не лише unit-тести)

Запущено `demo/mock-server.js` через `.claude/launch.json`, відкрито в
Browser pane. Перевірено:
- 0 console errors при завантаженні сторінки з новим `jk_bms.js`.
- Overview-панель: усі одиниці коректні (canonical-джерело працює).
- Настройки: `battery_capacity` input має `min="1" max="2000"
  step="0.001"` (з `PROTOCOL_CATALOG.fieldMeta`, не з видаленого
  hand-typed літералу).
- **Staleness end-to-end**: перемкнуто demo-сценарій на "Bms Stale",
  зачекано 10с → `document.querySelectorAll('.diag-entity-value.is-stale')`
  повернув 24 з 138 зареєстрованих значень (ті, чий `freshness_budget_s`
  вже минув). Скріншот підтвердив візуальний рендер: "Заряд активний
  Увімк •" в амбер-кольорі (`var(--warn)`) з крапкою-маркером.

### Фінальна регресія

`JK_BMS_WORKBOOK_PATH=".../-------LiFePO4_BMS_Parameters_registers.xlsx"
bash test/run_all.sh` → **EXIT=0, 0 FAIL**, 821 рядків логу, включно з
повною write-transaction/topology матрицею (найбільш чутливою до форми
`state[key]` — підтверджено НЕ зламаною, оскільки `updatedAt` зберігається
в окремому `stateUpdatedAt`, а не embedded у сам `state[key]` об'єкт).
Лог збережено:
`protocol/evidence/stage1_corrective_evidence/v2_manifest_baseline/run_all_stage5_read_foundation.txt`.

### Свідомо не охоплено цим проходом (задокументовано, не приховано)

- Staleness-візуалізація для editable input/toggle-вузлів (лише
  read-only value-вузли отримали `.is-stale`) — редагований контрол уже
  має власний dirty-індикатор, різне занепокоєння.
- `UK_UNIT_MAP`/`UNIT_DISPLAY`/`DIAGNOSTIC_ENTITY_LABELS` — три інші
  ручні таблиці, згадані в аналізі агента Explore, не консолідовані
  цим проходом (нижчий пріоритет, ніж unit/bounds/freshness).
- `registerEntity()` (~130 hand-written call sites) залишається ручним,
  без drift-перевірки проти canonical `esphome_read_entity_id`/
  `backend_key` — окрема, більша робота (Explore agent's finding),
  поза межами Етапу 5's "Готово, коли" критеріїв.

---

## Критичний самоаудит Етапу 5 (2026-09-11, продовження)

За прямою вимогою користувача проведено скептичну перевірку власного
Етапу 5 реальними командами — той самий метод, що й для Етапів 1–4.
Знайдено 6 реальних проблем (S5-1…S5-6), усі підтверджені прямою
інспекцією коду/живим браузером, жодна не вигадана. Усі виправлено.

### S5-1 (значуща) — freshness не сягала Overview/Electrical панелей

**Проблема:** `isFieldStale`/`.is-stale` були підключені ЛИШЕ до
низькорівневої таблиці регістрів у Diagnostics. Критерій "Готово, коли:
UI бачить freshness **кожного** значення" явно не обмежений
Diagnostics — а Overview/Electrical (`bindText`-driven "НАПРУГА",
"СТРУМ", "ПОТУЖНІСТЬ", "ТЕРМО" тощо) є основною поверхнею, яку
користувач реально бачить першою. Попередній запис у цьому лозі згадував
лише виключення input/toggle-вузлів, не цей набагато істотніший розрив.

**Виправлення:** `MEASUREMENT_BINDINGS` — реєстр `{key, id}` пар,
заповнюється в `bindText()`; `setMeasurement(id, rawValue, digits, unit,
key)` тепер приймає ключ і застосовує `.is-stale`/title одразу при
рендері; `sweepDiagnosticStaleness()` розширено — проходить і
Diagnostics-рядки, і всі `MEASUREMENT_BINDINGS`.

**Перевірка (жива, в браузері):** сценарій демо "Browser Disconnected"
дійсно зупиняє SSE-з'єднання сторінки (на відміну від "Bms Stale", який
лише міняє глобальний `bms_health`, а окремі сенсори продовжують
надходити — підтверджено окремим debug-listener'ом, зафіксовано в
`window.__debugEvents`). Після ~35–40с: `#metricVoltage` →
`classList.contains("is-stale") === true`, колір амбер + крапка,
`title === "Немає оновлення 41 с (очікувалось не рідше ніж раз на 30
с)"`. Після повернення сценарію на "Normal" і ~3с: `stale === false`,
`title === ""` — коректне відновлення.

### S5-2 (реальна, помірна) — 43/47 записів старої fallback-таблиці мертві

**Проблема:** `diagnosticUnit()`'s ручна objectId→unit таблиця (47
записів) лишилась у коді "як fallback", але перевірка (`node -e`,
крос-звірка з `PROTOCOL_CATALOG.fieldMeta`) показала: 43 з 47 (91%) вже
затінені fieldMeta-пошуком і НІКОЛИ не виконуються — мертвий код,
залишений неприбраним.

**Побічна знахідка:** 2 записи (`disacharge_ocpr_left`,
`disacharge_scpr_left`) мали одруківку в старій таблиці ("disacharge"
замість "discharge") — вони НІКОЛИ не спрацьовували навіть до Етапу 5,
справжній латентний дефект, який fieldMeta (правильне написання з
canonical) автоматично усунув.

**Виправлення:** видалено всю ручну гілку `if/else if` (43+2+2=47
записів); залишено лише generic regex-fallback для випадку, якого не
повинно існувати для зареєстрованої сутності (захист в глибину).

### S5-3 (реальна, UX/доступність) — `.is-stale` без пояснення

**Проблема:** амбер-крапка не мала жодного title/tooltip, що пояснює
ПРИЧИНУ — на відміну від власного паттерну проєкту (`register-blocked-
badge` явно пояснює "Запис заблоковано: <причина>").

**Виправлення:** `staleTitle(key)` — формує "Немає оновлення N с
(очікувалось не рідше ніж раз на M с)" / англ. еквівалент; підключено у
всіх 4 місцях, де `.is-stale` застосовується (row-creation, incremental
update, обидві гілки sweep). Для Diagnostics-рядків title коректно
повертається до value-echo при відновленні свіжості (а не лишається
"завислим" з попереднього stale-стану).

### S5-4 — виявлено при cross-check: fieldMeta не покривав non-register сутності

**Проблема:** з 4 записів старої таблиці, що НЕ були затінені (`
total_voltage`, `current`, `disacharge_ocpr_left`→typo, `disacharge_
scpr_left`→typo), перші два виявились дійсними, окремими canonical
сутностями (`protocol/non_register_entities.canonical.json`,
`category: calculated_esphome`) — з власними unit-даними, які
`buildFieldMeta()` просто ніколи не включав.

**Виправлення:** `buildFieldMeta()` розширено — тепер ітерує і
`allRegisterFields`, і `nonRegisterDoc.entities`; перевірено відсутність
колізій ключів між двома джерелами (0 колізій, підтверджено `node -e`)
перед merge.

### S5-5 (реальна, точність) — 5с sweep проти 3с мінімального freshness budget

**Проблема:** `STALE_SWEEP_INTERVAL_MS = 5000`, тоді як мінімальний
`freshnessBudgetS` у canonical джерелі — 3 (tier `cell_block_1s`) —
до 2 зайвих секунд затримки виявлення "мовчання" для найшвидшого рівня.

**Виправлення:** інтервал звужено до 1000ms — з запасом нижче
найменшого budget (3000ms) для всіх існуючих tier'ів.

### S5-6 — non-register похідні сутності назавжди "не застарівають"

**Проблема:** після S5-4 `total_voltage`/`current` отримали unit-дані,
але `freshnessBudgetS: null` для ВСІХ non-register сутностей — а це
рівно ті два ключі, що керують НАПРУГА/СТРУМ на Overview (найпомітніші
метрики). Вони НІКОЛИ не показали б staleness, незалежно від того, як
довго реальний регістр мовчить.

**Виправлення:** новий опціональний `derived_from_register_key` у
`protocol/schema/non-register-source.schema.json` +
`non_register_entities.canonical.json` (застосовано для `total_voltage`
→`total_voltage_raw`, `current`→`current_raw`; `power` свідомо
лишився без прив'язки — чистий client-side add V×I двох різних
регістрів, немає єдиного "справжнього" джерела). `buildFieldMeta()`
успадковує `pollGroup`/`freshnessBudgetS` від referenced register-key;
`generate.js` кидає explicit помилку
(`NON_REGISTER_DERIVED_FROM_UNKNOWN_REGISTER_KEY`) якщо посилання
некоректне — жодного мовчазного fallback/здогадки.

### Побічний резинк

Кожна зміна `jk_bms.js`-вручну-написаної частини легітимно змінювала
implementation-fingerprint — виправлено санкціонованим workflow
(`tools/protocol/fingerprint.js check/review/accept`) двічі протягом
цього проходу (після S5-1..S5-3, і після S5-4..S5-6 окремо для
generate.js+canonical-джерел). Кожного разу — повний resync
(`generate.js` → `pipeline.js build`) і повторна перевірка `--check`.

### Регресія від самого self-audit процесу

Повний прогін `test/run_all.sh` ПІСЛЯ видалення dead code (S5-2) виявив
**2 реальні FAIL** у `test/protocol_catalog/test_entity_id_collision.js`
— обидва static-text guard'и з Етапу P1-05 (2026-09-10), що грепали
буквальний текст старої hardcoded-таблиці, яку я щойно видалив. Це НЕ
регресія функціональності (fieldMeta коректно несе ті самі дані, іншим,
надійнішим механізмом) — а застарілий тест, що перевіряв правильний
намір неправильним способом. Обидва тести переписано перевіряти НОВИЙ
механізм (`PROTOCOL_CATALOG.fieldMeta` замість видаленого hardcoded
рядка) — verified: `node test/protocol_catalog/test_entity_id_collision.js`
→ 16/16 PASS.

### Фінальна верифікація

`test/run_all.sh` (workbook path) → **EXIT=0, 0 FAIL**, 822 рядки, лог:
`protocol/evidence/stage1_corrective_evidence/v2_manifest_baseline/run_all_stage5_self_audit_fixes.txt`.
`generate.js --check` / `fingerprint.js check` / `pipeline.js build` —
усі чисті. Жива браузерна перевірка (Browser Disconnected сценарій) —
staleness тепер коректно проявляється і відновлюється на Overview-панелі,
не лише в Diagnostics.

**Підсумок:** 6 реальних проблем (S5-1…S5-6) знайдено й виправлено, +
2 тести оновлено (не видалено) до нового механізму. Кожне виправлення
перевірено реальною командою або живим браузером з конкретним
спостережуваним результатом (screenshot/JSON dump), не лише описом.
