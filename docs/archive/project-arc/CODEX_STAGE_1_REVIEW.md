> **ARCHIVED — historical record, not current and not an implementation queue.**
> Moved here in the 2026-09-25 repository cleanup (full pre-move state: branch
> `checkpoint/pre-repository-cleanup-2026-09-25`). Paths, counts and statuses
> below reflect the date written. Current state: [PROJECT_STATE](../../project/PROJECT_STATE.md);
> current plan: [RS485_UNIFIED_PARAMETER_PIPELINE_PLAN](../../project/RS485_UNIFIED_PARAMETER_PIPELINE_PLAN.md);
> archive index: [docs/archive/README.md](../README.md).

# Незалежний критичний аудит результату Claude — Етап 1

Дата аудиту: 2026-09-09  
Проєкт: JK BMS Web UI для ESP32 + ESPHome  
Гілка під час перевірки: `fix/settings-diagnostics-dedup`  
Перевірений HEAD: `ab9f294a798210f058ae8f7a987cfb428e0eba3c`

## 1. Підсумковий висновок

Результат Claude не можна приймати як завершений Етап 1. Загальний статус **PARTIAL / NOT READY** правильний, але перелік причин у звіті неповний, а частина тверджень про доказовість і покриття тестами є завищеною або фактично хибною.

Позитивна частина роботи істотна: створено канонічний каталог, генератор, JSON Schema, семантичні перевірки, ADR, згенеровані артефакти та набір тестів; виправлено кілька одиниць вимірювання; усі наявні тести, які вдалося запустити окремо, проходять. Проте поточні тести переважно доводять внутрішню узгодженість створених файлів, а не правильність каталогу щодо реального протоколу, YAML, UI та BMS.

**Рішення:** не переходити до Етапу 2. Спочатку виконати окремий коригувальний прохід **Stage 1 Remediation**, усунути наведені нижче блокери та повторити незалежний аудит.

## 2. Що перевірено фактично

| Перевірка | Фактичний результат | Примітка |
|---|---:|---|
| `node tools/protocol/generate.js --check` | PASS | Згенеровані файли збігаються з поточним seed-каталогом |
| Валідатор каталогу | 194/194 PASS | Не виявляє низку критичних семантичних помилок |
| Packed-field tests | 16/16 PASS | Перевіряють наявні правила, але не повноту всіх packed-регістрів |
| Negative tests | 38/38 PASS | Не покривають усі обов’язкові класи помилок |
| C++ write transaction tests | 46/46 PASS | Скомпільовано та запущено з output у `/tmp` |
| History tests | 94/94 PASS | Скомпільовано та запущено з output у `/tmp` |
| Topology integration tests | 57/57 PASS | Запущено з окремим локальним портом `19427` |
| `git diff --check` | PASS | Помилок whitespace не виявлено |
| `test/run_all.sh` | FAIL як runner | Скрипт намагається створювати бінарні файли всередині репозиторію; окремі тести після перенесення output у `/tmp` пройшли |

Проходження тестів **не є доказом коректності протоколу**, оскільки в канонічному каталозі вже присутня очевидна помилка, яку валідатор не знаходить.

## 3. Критичні блокери

### P0-1. Неправильна геометрія регістра пароля

У `protocol/registers.canonical.json` для пароля налаштувань вказано:

- `register_width_bits: 128`;
- `word_count: 2`.

Це суперечність: 128 біт дорівнюють восьми 16-бітним словам, тобто `word_count` має дорівнювати `8`. Сам YAML читає і записує 8 слів / 16 байтів. Помилка походить із `tools/protocol/authoring/build_seed.py`, де для будь-якої ширини, відмінної від 16 біт, обираються лише два слова.

Наявний валідатор не перевіряє інваріант:

```text
word_count × 16 == register_width_bits
```

Отже, заявлене зелене тестове покриття пропускає доведену помилку канонічних даних.

### P0-2. Недостовірне призначення Excel як джерела доказів

Незалежна перевірка книги `LiFePO4_BMS_Parameters_registers.xlsx`, аркуш `BMS Parameters`, показала:

- 129 рядків і 113 унікальних адрес у книзі;
- 116 унікальних адрес у канонічному каталозі;
- адреси `0x12A4`, `0x12E6`, `0x12F8` відсутні у книзі, але каталог приписує відповідним полям доказ `workbook`;
- адреса `0x12E4` у книзі присутня в рядку 127 як «Альтернативна напруга батареї», хоча каталог і аудит Claude стверджують, що вона в Excel відсутня.

Поточна модель evidence лише перевіряє непорожній масив рядків. Вона не доводить, що конкретне джерело справді містить адресу, поле, одиницю, масштаб, доступ або семантику.

### P0-3. Помилкова прив’язка до версії прошивки BMS

У каталозі масово записано `firmware_scope: v3.0.0`, нібито отриману з `manufacturer_device_id` та hardware snapshot. Насправді `v3.0.0` — це версія ESPHome-проєкту з `project.version` і статичний рядок UI. `manufacturer_device_id` за адресою `0x1400` є ідентифікатором/моделлю, а не доведеною версією прошивки BMS.

Поки реальні model/protocol/firmware identifiers не підтверджені, область застосовності протоколу повинна бути `unknown` або описана окремими достовірними полями. Версію UI/ESPHome не можна використовувати як версію BMS.

### P0-4. Непідтверджені поля залишаються фактично доступними для запису

Чотири DRY threshold/recovery поля позначені як `effective_access: r`, але генератор runtime write-map спирається на `declared_access`, тому метадані не гарантують фактичне блокування запису.

Додатково три source-selector поля — LCD buzzer, DRY 1 і DRY 2 trigger source — мають непідтверджену enum-семантику, але залишені `effective_access: rw` і редагуються як довільне число. Це небезпечно: користувач може записати невідомий або зарезервований код.

До підтвердження семантики всі сім пов’язаних полів мають бути runtime-заблоковані для запису на всіх рівнях: generated metadata, UI, backend/endpoint, mock і transaction dispatch.

## 4. Високопріоритетні дефекти архітектури перевірки

### P1-1. Мапінг YAML/JS доводиться пошуком підрядків, а не структурою

`test/register_catalog/validate.js` використовує `includes`, регулярні вирази та пошук адреси будь-де в YAML. Така перевірка не доводить, що конкретний field пов’язаний саме з правильною адресою, entity ID, width, `register_count`, типом, scale, unit, decode lambda або write lambda.

Packed-поля однієї адреси можуть усі пройти тест лише тому, що адреса зустрілася один раз. Регулярний вираз адрес YAML також залежить від конкретного відступу. Твердження, що substring/regex-only доказ усунуто, не відповідає реалізації.

### P1-2. Семантичний валідатор не перевіряє необхідні інваріанти

Серед відсутніх або недостатніх перевірок:

- відповідність `word_count`, `register_width_bits` і byte length;
- відповідність `register_id` фізичній адресі;
- `field_width_bits <= register_width_bits`;
- межі `mask`, `shift`, `byte_offset` відносно регістра;
- перекриття, пропуски й явно зарезервовані біти packed-регістра;
- узгодженість parent access, field access, write function і effective policy;
- `scale != 0`, додатний `step`, узгодженість `precision` зі step/scale;
- представимість min/max відповідно до signedness, width, scale та offset;
- валідність enum keys, дублікати, зарезервовані коди й collision;
- алгоритмічне виведення verification status з незалежних evidence sources;
- фактичне існування exact locator у workbook/upstream/hardware evidence.

У коді навіть обчислюється `fullMask`, але він не використовується як інваріант.

### P1-3. Обов’язкові negative fixtures неповні

В аудиті Claude прямо зазначено, що для десяти класів помилок немає окремих негативних fixture-тестів, але критерій negative testing все одно позначено PASS. Це некоректна оцінка.

Потрібні окремі тести, які мутують коректний каталог і доводять відмову для кожного класу: геометрія регістра, uncovered/overlapping bits, endian/word-order drift, scale/offset drift, canonical/display unit drift, step/precision, enum/reserved collision, UI order gap/duplicate, natural cell ordering, entity/backend collision, wrong dataset classification, false evidence claim і write-policy bypass.

### P1-4. Канонічний каталог ще не є operational single source of truth

- `protocol/generated/protocol_catalog.h` не споживається firmware;
- `protocol/generated/frontend_catalog.generated.js` не є джерелом повної конфігурації UI;
- register geometry у YAML залишається hand-authored;
- labels, order, units і editor definitions у frontend переважно hand-authored;
- mock використовує каталог для generic RW address map, але сутності й значення seed-яться вручну;
- згенерований C++ metadata не містить усіх даних, необхідних для безпечного decode/write.

Тому критерій «single source of truth» справедливо не виконаний, але масштаб розриву у звіті применшено.

### P1-5. Неправильно звужена повнота протоколу

Реалізація вважає адреси upstream, які ще не читає поточний YAML, поза scope. Це змішує дві різні множини:

1. повний каталог підтверджених регістрів для конкретної моделі/варіанта протоколу;
2. підмножина регістрів, уже реалізована firmware/UI.

У каталозі мають бути всі підтверджені source-регістри, а окремий `implementation_status` повинен показувати, чи вони реалізовані, не реалізовані або навмисно не експонуються. Відсутність runtime-споживача не є підставою виключати фізичний регістр із протокольного inventory.

### P1-6. Evidence не відтворюється

Upstream-джерело не має commit SHA/tag/hash і точних line/range locators. Посилання на Excel містить абсолютний шлях і цілий аркуш, але не SHA-256, рядок/діапазон і нормалізований extract. `external_components_source` використовує mutable `main`.

Потрібен versioned evidence manifest: source ID, тип, hash/commit/version, exact locator, provenance, independence group, дата отримання та відтворюваний normalized extract.

### P1-7. Згенерований C++ metadata недостатній

Header не містить register width/word count, endian/word order, bounds, step, unit, safety class, atomicity/parent relation, enum/dynamic dependency, implementation status і evidence/verification status. У такому вигляді він не може бути авторитетною основою для наступних етапів.

### P1-8. Генерація не є транзакційно атомарною для всього набору файлів

Кожен файл замінюється окремо через temp+rename, але весь набір публікується послідовно. Аварія між файлами може залишити змішане покоління артефактів. Потрібні staging, повна перевірка й hash-manifest перед publish або еквівалентна recoverable схема.

### P1-9. Невирішена неоднозначність entity/wire ID

Колізія між `cell_request_charge_voltage` / `cell_rcv` та їх float/internal представленнями залишається відкритою. Каталог повинен окремо моделювати protocol field key, ESPHome internal ID, wire entity ID і UI key та блокувати collisions валідатором.

## 5. Дефекти інструментів і звітування

### P2-1. Test runner забруднює робоче дерево

`test/run_all.sh` компілює тимчасові executables у репозиторій. Runner має використовувати `mktemp -d`, `trap` для cleanup, перевірений вільний порт або caller-provided port із collision check і гарантоване завершення дочірнього server process.

### P2-2. Заявлена фіксація toolchain не підтверджена

У репозиторії немає package manifest/lock або іншого machine-readable pin для Node/toolchain, хоча аудит посилається на «project’s pinned runtime». Або runtime треба справді зафіксувати, або формулювання прибрати.

### P2-3. Аудит Claude містить внутрішньо суперечливі оцінки

- адреса `0x12E4` помилково названа відсутньою в Excel;
- адресам `0x12A4`, `0x12E6`, `0x12F8` помилково приписано workbook evidence;
- критерій negative fixtures позначено PASS попри визнані пропуски;
- «all 194 pass» подається як сильніше підтвердження, ніж воно є;
- `PASS with caveat` не відповідає бінарному exit gate;
- твердження про source completeness спирається на штучно звужений scope.

## 6. Що в роботі Claude варто зберегти

- поділ на authoring source, canonical catalog і generated artifacts;
- deterministic `--check` режим;
- JSON Schema та окремий semantic validator;
- моделювання packed fields;
- розрізнення declared/effective access як ідея;
- ADR із правилами ownership;
- окремі packed і negative test suites;
- консервативний фінальний статус PARTIAL, а не неправдиве READY;
- відсутність небезпечних hardware writes під час аудиту.

Це добра основа, яку доцільно виправити, а не переписувати без потреби.

## 7. Обов’язковий exit gate коригувального проходу

Етап 1 можна визнати завершеним лише якщо одночасно виконано все нижче:

1. Геометрія кожного регістра математично узгоджена й перевіряється тестом.
2. Кожен evidence claim посилається на реальний exact locator у versioned/hashed source.
3. BMS model/protocol/firmware scope не змішується з версією UI/ESPHome.
4. Повнота каталогу визначена щодо явно зафіксованого набору джерел і variant scope.
5. Source-only та implementation-only елементи не приховуються, а мають явний status.
6. Непідтверджені або conflict write-поля фактично заблоковані end-to-end.
7. YAML, firmware metadata, frontend і mock мають exact machine-checkable mapping до catalog або генеруються з нього.
8. Валідатор перевіряє всі геометричні, числові, enum, mapping, evidence і policy invariants.
9. Для кожного обов’язкового класу помилки існує негативний mutation/fixture test.
10. Генератор і test runner не залишають частково оновлених файлів або build artifacts.
11. Повний compile/test suite проходить у чистому середовищі без ручних винятків.
12. Новий аудит не містить `PASS with caveat`: кожен критерій має лише PASS, FAIL або BLOCKED із доказом.

Якщо офіційної документації немає, це не дозволяє вигадувати підтвердження. Невідомі поля мають залишатися чесно позначеними та безпечно read-only/blocked. Якщо без джерела неможливо довести повноту exact BMS variant, загальний статус повинен залишатися **NOT READY**, навіть коли програмна інфраструктура вже коректна.

## 8. Рекомендований наступний крок

Виконати лише **Stage 1 Remediation** за окремим промптом `CLAUDE_STAGE_1_REMEDIATION_PROMPT_UA.md`. До Етапу 2, розширення write manager або змін реального BMS переходити лише після нового незалежного PASS-аудиту.
