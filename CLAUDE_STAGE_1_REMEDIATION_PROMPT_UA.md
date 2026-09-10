# Промпт для Claude: Stage 1 Remediation — доказово коректний каталог протоколу JK BMS

Ти працюєш безпосередньо з реальним репозиторієм **JK BMS Web UI для ESP32 + ESPHome**.

Працюй одночасно як:

- Senior ESPHome / ESP32 Architect;
- Senior Embedded C++ Engineer;
- JK BMS Protocol Reverse-Engineering Engineer;
- Embedded Security Engineer;
- IoT Network Security Engineer;
- Reliability / Safety Engineer;
- QA and Test Automation Lead;
- Technical Auditor.

## 1. Мета завдання

Виконай **коригувальний прохід Етапу 1**, не переходячи до Етапу 2. Результат має перетворити поточний частково готовий каталог регістрів на відтворювану, доказово коректну й безпечну основу для подальшої реалізації.

Не обмежуйся звітом. Досліди, виправ код і дані, додай потрібні генератори, валідатори та тести, запусти повний набір перевірок, а **останньою дією** виконай всеосяжний аудит фактичного результату.

Не оголошуй `READY`, якщо хоча б один обов’язковий критерій не доведено. Невідоме позначай як невідоме; припущення не перетворюй на факт.

## 2. Поточний контекст і відомі блокери

У репозиторії вже є незакомічені зміни Етапу 1. Вони належать користувачу. Не видаляй, не скидай і не перезаписуй сторонні зміни. Почни з read-only inventory та зафіксуй baseline diff.

Обов’язково прочитай повністю щонайменше:

- `IMPLEMENTATION_ROADMAP.md`;
- `CLAUDE_STAGE_1_IMPLEMENTATION_PROMPT_UA.md`;
- `STAGE_1_IMPLEMENTATION_AUDIT.md`;
- `CODEX_STAGE_1_REVIEW.md`;
- `FINAL_READINESS_REPORT.md`;
- `HARDWARE_VALIDATION_CHECKLIST.md`;
- `HARDWARE_AUDIT_2026-09-09.md`;
- `OPEN_ISSUES.md`;
- `docs/adr/0001-protocol-catalog.md`;
- усі файли в `protocol/`, `tools/protocol/`, `test/protocol_catalog/`, `test/register_catalog/`;
- `batterylifepo4.yaml`;
- `jk_bms.js`;
- `demo/mock-server.js`;
- `register_catalog.json`;
- `test/run_all.sh`;
- workbook `/Users/mykola.krokhmal/Downloads/LiFePO4_BMS_Parameters_registers.xlsx`, якщо він доступний.

Перед редагуванням відтвори поточні перевірки й запиши реальні результати. Не вважай зелені тести доказом правильності джерел.

Відомі дефекти, які необхідно перевірити та виправити, а не просто переписати у звіт:

1. 128-бітний passcode має `word_count: 2`, хоча фактично займає 8 слів / 16 байтів.
2. Каталог помилково приписує workbook evidence адресам `0x12A4`, `0x12E6`, `0x12F8`.
3. Workbook містить `0x12E4` у рядку 127, хоча поточний аудит стверджує протилежне.
4. `v3.0.0` є версією ESPHome/UI-проєкту, а не доведеною версією firmware BMS.
5. Частина unverified/conflict полів формально downgraded у metadata, але фактично може залишатися write-enabled.
6. Source selector fields для LCD buzzer, DRY 1 та DRY 2 мають невідому enum-семантику, але приймають довільне число.
7. YAML/JS mapping перевіряється переважно `includes` і regex, а не точним структурним зв’язком.
8. Semantic validator пропускає важливі geometry, numeric, enum, evidence і policy invariants.
9. Negative fixtures не покривають усі заявлені класи помилок.
10. Generated frontend/C++ artifacts не є реальними споживачами повної конфігурації; YAML і mock значною мірою hand-authored.
11. Повноту протоколу штучно звужено до адрес, які вже читає/пише поточний проєкт.
12. Evidence locators не мають точних рядків/діапазонів, hashes або immutable upstream revisions.
13. Генерація набору артефактів не є атомарною як одна транзакція.
14. `test/run_all.sh` створює build outputs усередині репозиторію.
15. Node/toolchain названо pinned, хоча machine-readable pin не доведений.
16. Неоднозначність/колізія `cell_request_charge_voltage`, `cell_rcv`, internal float ID та wire ID не має залишатися неперевіреною.

## 3. Жорсткі обмеження безпеки

1. **Не виконуй жодних записів у реальну BMS.**
2. Не змінюй charge/discharge/balancer state на реальному пристрої.
3. Не прошивай ESP32 і не перезавантажуй production device без окремого прямого дозволу користувача.
4. Дозволені лише read-only hardware/network inspections, якщо доступні й безпечні.
5. Не друкуй credentials, secrets, cookies, authorization headers або passcode у logs/reports.
6. Не запускай broad process kills і не зупиняй чужі процеси.
7. Не використовуй `git reset --hard`, destructive checkout, clean або видалення незнайомих файлів.
8. Не роби commit/push/PR, якщо користувач прямо цього не просив.
9. Не починай функціональність Етапу 2; дозволені лише мінімальні runtime-зміни, потрібні для виконання безпеки та exact mapping Етапу 1.

## 4. Визначення scope, яке не можна звужувати

Розділяй три незалежні поняття:

### 4.1. Protocol inventory

Усі фізичні регістри й логічні поля, підтверджені versioned evidence set для конкретного JK BMS model/protocol variant, незалежно від того, чи вже використовує їх поточний YAML/UI.

### 4.2. Implementation mapping

Чи реалізований конкретний register/field у ESPHome YAML, C++ runtime, wire API, UI та mock.

### 4.3. Verification and safety policy

Наскільки підтверджено address/width/type/scale/unit/access/enum semantics і чи дозволений фактичний запис.

Додай machine-readable `implementation_status` або еквівалентну модель, щонайменше:

- `implemented`;
- `partially_implemented`;
- `source_only_unimplemented`;
- `implementation_only_unverified`;
- `intentionally_not_exposed`.

Не виключай source-регістр із каталогу лише тому, що він ще не має entity у YAML. Не вигадуй «повний протокол», якщо доступні джерела цього не доводять. Явно зафіксуй variant scope і межі доказової повноти.

## 5. Обов’язкова реалізація

### Крок A. Baseline та контроль робочого дерева

1. Зафіксуй branch, HEAD, `git status --short`, список змінених/нових файлів і tool versions.
2. Запусти поточні генератори, валідатори, unit/integration tests та ESPHome compile.
3. Не маскуй failures. Розрізняй defect продукту, defect runner і обмеження середовища.
4. Створи короткий baseline section у новому аудиті.

### Крок B. Виправлення моделі geometry

1. Виправ генерацію 128-бітного passcode: 128 bits = 16 bytes = 8 Modbus words.
2. Не використовуй формулу виду `16 ? 1 : 2`. Обчислюй word count математично й відхиляй нецілі/непідтримувані widths.
3. Додай універсальні інваріанти:
   - `register_width_bits > 0`;
   - width кратний 8;
   - для 16-бітних Modbus words `word_count * 16 == register_width_bits`;
   - byte length, read count і write payload length узгоджені;
   - multiword order/endian policy задані явно.
4. Додай позитивний тест для 128-bit/8-word passcode і негативні тести для помилкових 2/4/7 words.
5. Перевір, що YAML read/write geometry і forced read-back використовують ту саму canonical geometry.

### Крок C. Відтворювана evidence model

Створи machine-readable evidence manifest, наприклад `protocol/evidence/sources.json`, і normalized extracts, якщо це ліцензійно допустимо.

Для кожного source повинні бути:

- стабільний `source_id`;
- type: official document, workbook, upstream implementation, current implementation, hardware read, hardware identity тощо;
- immutable version: commit SHA, document revision, file SHA-256 або snapshot hash;
- exact locator: path + line/range, sheet + row/cell range, register response frame/field range;
- acquisition date;
- provenance;
- independence group — похідні копії одного джерела не рахуються як незалежні;
- які саме claims джерело підтверджує: address, width, signedness, scale, unit, access, enum, model applicability тощо.

Валідатор повинен перевіряти, що кожен evidence reference існує, exact locator валідний, а claim справді присутній у normalized source index. Непорожній рядок не є доказом.

Для workbook:

1. Обчисли SHA-256.
2. Зчитай sheet `BMS Parameters` структуровано.
3. Побудуй нормалізований index `address -> row(s) -> claims`.
4. Зафіксуй, що workbook має 113 унікальних адрес, якщо повторна перевірка це підтвердить.
5. Не приписуй workbook evidence `0x12A4`, `0x12E6`, `0x12F8`, якщо адреси справді відсутні.
6. Признач коректний locator для `0x12E4` у рядку 127 і виправ попередній звіт.
7. Додай regression tests на ці чотири адреси.

Для upstream:

1. Зафіксуй точний repository URL і commit SHA/tag.
2. Не використовуй mutable `main` як доказ без resolved commit.
3. Збережи exact file/line або machine-generated source index.
4. Визнач, чи upstream і workbook незалежні, а не походять один від одного.

Для hardware evidence:

1. Розділи факт відповіді регістра, identity/model, protocol version і BMS firmware version.
2. Не вважай валідне число підтвердженням семантики/масштабу/доступу без окремого доказу.
3. Hardware read не підтверджує RW сам по собі.

### Крок D. Правильна модель версій і застосовності

Прибери неправдиве `firmware_scope: v3.0.0` із BMS register fields.

Моделюй окремо:

- ESPHome project version;
- web UI version;
- ESPHome framework/version;
- external component revision;
- BMS model/hardware identity;
- BMS protocol variant/revision;
- BMS firmware version, тільки якщо її реально отримано з документованого поля;
- catalog evidence-set version.

Якщо BMS firmware/protocol applicability не підтверджена — значення має бути `unknown`, а не припущення. Додай тест, який забороняє використовувати UI/project version як firmware scope BMS.

### Крок E. Повне source reconciliation

1. Побудуй множини адрес/полів для кожного незалежного джерела та current implementation.
2. Згенеруй machine-readable reconciliation report:
   - source intersection;
   - source-only;
   - implementation-only;
   - address/width/type/scale/unit/access/enum conflicts;
   - unresolved variant-dependent items.
3. Додай до canonical catalog усі підтверджені source-only регістри з `implementation_status`, не створюючи автоматично небезпечних runtime endpoints.
4. Для implementation-only fields вимагай точний implementation locator і чесний unverified status.
5. Якщо офіційна документація недоступна, зафіксуй це як evidence gap; не підмінюй її workbook або upstream без пояснення provenance.

### Крок F. Формальний алгоритм verification status

Verification status не повинен бути вручну довільним. Реалізуй детерміноване правило, яке враховує:

- кількість незалежних evidence groups;
- набір підтверджених claim types;
- conflicts;
- hardware read;
- official source availability;
- model/protocol applicability.

Мінімально розрізняй:

- `confirmed`;
- `corroborated_with_limitations`;
- `single_source`;
- `implementation_only_unverified`;
- `conflict`;
- `unknown_variant`.

Статус RW дозволений лише коли окремо підтверджено write semantics, payload geometry, allowed domain і safety policy. Read response або наявність address не доводить RW.

### Крок G. Безпечне effective access та реальне блокування запису

1. `effective_access` має бути policy output, а не декоративне поле.
2. Generated write maps, UI editor availability, backend routes/commands, mock behavior і transaction dispatch повинні спиратися лише на `effective_access == rw` та додатковий safety gate.
3. Field із `conflict`, `single_source` без write proof, unknown enum або unknown variant повинен бути фактично non-writable.
4. Заблокуй end-to-end щонайменше чотири непідтверджені DRY threshold/recovery fields.
5. Досліди exact enum semantics для:
   - LCD buzzer trigger source;
   - DRY 1 trigger source;
   - DRY 2 trigger source.
6. Якщо повний enum mapping з reserved/unknown codes не підтверджений, заблокуй запис і для цих трьох source selectors. Не залишай raw numeric editor для невідомого enum.
7. UI повинен ясно показувати read-only/verification reason, але не розкривати внутрішні секрети.
8. Додай тести, що direct HTTP/API/JS invocation не обходить UI lock.
9. Не виконуй реального hardware write для перевірки.

### Крок H. Каталог як operational source of truth

Забезпеч один авторитетний шлях даних. Допустимі два підходи або їх безпечна комбінація:

1. Генерувати точні marker-delimited blocks у YAML/JS/mock/C++ із canonical catalog; або
2. Створити структурований exact mapping manifest і parser, який перевіряє кожен параметр без substring-only евристики.

Обов’язкові результати:

- для кожного YAML entity доводяться exact address, word count, width, value type, signedness, scale, offset, canonical unit, read/decode logic та write logic;
- packed sibling fields пов’язуються з parent register і власними mask/shift/width;
- frontend labels, order, unit, editor kind, constraints, enum options, read-only reason та key походять із generated metadata або exact validated mapping;
- mock генерує/споживає metadata для всіх R і RW fields, а не лише generic RW addresses;
- C++ generated metadata реально споживається відповідним кодом або його існування не подається як runtime authority;
- generated metadata містить достатньо інформації для наступних етапів: register width, word count, endian/word order, field geometry, numeric transform, bounds, step, unit, enum, access, effective policy, safety class, atomicity/parent relation, implementation status і verification status.

Не намагайся парсити повний ESPHome YAML наївним regex. Якщо стандартний YAML parser не підтримує `!lambda`/ESPHome tags, додай безпечний custom loader або генеровані декларативні marker blocks.

### Крок I. Повний semantic validator

Реалізуй і протестуй щонайменше такі інваріанти:

#### Register geometry

- address format і uniqueness у межах variant;
- `register_id` відповідає canonical address;
- positive supported widths;
- `word_count * 16 == register_width_bits`;
- endian і word order задані для multiword values;
- read/write payload lengths узгоджені.

#### Field geometry

- positive field width;
- field width не перевищує register width;
- mask не виходить за register width;
- shift/byte offset у межах;
- mask bit count узгоджений із field width;
- siblings не перекриваються без явного alias rule;
- uncovered bits або описані як reserved, або викликають помилку відповідно до policy;
- full-mask calculation реально використовується.

#### Numeric semantics

- scale finite і non-zero;
- offset finite;
- step finite та positive;
- precision узгоджена зі scale/step;
- min/max упорядковані;
- bounds представимі wire width/signedness після inverse transform;
- unit canonical, display unit і conversion policy не суперечать одне одному;
- conversion round-trip перевіряється на boundary values.

#### Enum/bitfield semantics

- raw enum keys мають правильний тип і range;
- canonical values не дублюються без alias rule;
- reserved values не перетинаються з active values;
- unknown code behavior заданий;
- boolean/enum editors не створюються без повної підтвердженої семантики.

#### Access and safety

- parent/field declared access узгоджені;
- write function не існує для effective read-only field;
- generated write address map не містить blocked fields;
- UI/backend/mock/transaction policy однакова;
- sensitive fields мають окремий safety classification;
- passcode ніколи не потрапляє у log/report/test snapshot відкритим текстом.

#### Mapping

- protocol key, YAML internal ID, wire entity ID, frontend key і mock key унікальні у своїх namespaces;
- collision та alias дозволені лише явно;
- exact mapping address/scale/unit/access доведений;
- dataset classification коректна;
- cell indexes мають natural numeric ordering, не lexicographic;
- UI order унікальний, без gaps, відповідно до заявленої policy.

#### Evidence

- source reference існує;
- hash/revision відповідає manifest;
- exact locator існує;
- address/claim справді присутні в source index;
- verification status відповідає формальному алгоритму;
- одне похідне джерело не рахується двічі як незалежне.

### Крок J. Exhaustive negative and mutation tests

Для кожного нижченаведеного класу створи окремий fixture або deterministic mutation test, який спочатку доводить, що baseline проходить, потім вносить одну помилку і доводить очікуваний fail із точним diagnostic code:

1. wrong word count/register width;
2. wrong payload byte length;
3. duplicate address/register ID mismatch;
4. field outside register bounds;
5. overlapping fields;
6. uncovered non-reserved bits;
7. endian/word-order drift;
8. scale drift;
9. offset drift;
10. canonical/display unit drift;
11. invalid/nonpositive step;
12. precision mismatch;
13. nonrepresentable bounds;
14. duplicate enum value;
15. reserved enum collision;
16. missing unknown-code policy;
17. wrong declared/effective access;
18. blocked field leaked into write map;
19. UI order duplicate/gap;
20. natural cell order regression (`1, 2, …, 10`, не `1, 10, 2`);
21. entity/internal/wire/backend ID collision;
22. wrong dataset classification;
23. false workbook evidence;
24. missing/bad hash or stale upstream revision;
25. source-only register silently dropped;
26. YAML address/scale/unit mapping drift;
27. frontend/mock metadata drift;
28. unverified enum rendered writable;
29. passcode/log secret leakage;
30. partial generated artifact set/hash mismatch.

Не зараховуй позитивну перевірку як negative fixture. У фінальному аудиті наведи назву кожного тесту та доказ, що mutant справді відхиляється.

### Крок K. Атомарна й детермінована генерація

1. Генеруй повний набір у staging directory.
2. Перевір schema, semantics, cross-file mapping і hashes до publish.
3. Публікуй набір атомарно/recoverably або використовуй generation manifest із generation ID та fail-safe recovery.
4. `--check` повинен виявляти stale, missing, mixed-generation та manually-edited artifacts.
5. Два послідовні generation runs мають давати byte-identical output.
6. Simulated failure посеред генерації не повинен залишати valid-looking mixed state.

### Крок L. Чистий та надійний test runner

Виправ `test/run_all.sh` і пов’язані runners:

- build outputs лише у `mktemp -d`;
- cleanup через `trap` для normal exit, failure і signal;
- жодних executables/logs у working tree;
- локальний порт або виділяється безпечно, або caller-supplied port перевіряється до запуску;
- дочірній mock server гарантовано завершується;
- timeout та зрозумілий failure diagnostic;
- runner працює з read-only source tree, якщо build temp writable;
- після suite `git status --short` не має нових build artifacts.

Якщо toolchain називається pinned — додай реальний machine-readable version manifest/lock і перевірку версій. Інакше зміни звіт на «recorded, not pinned».

### Крок M. Усунення ID collision

Побудуй повну таблицю:

```text
protocol field key -> YAML internal id -> wire/API entity id -> frontend key -> mock key
```

Перевір `cell_request_charge_voltage`, `cell_rcv` та всі float/internal twins. Усунь колізію мінімальною backward-compatible зміною або введи явний alias/migration mapping. Додай regression tests, які доводять, що:

- немає duplicate registration;
- wire clients бачать однозначне значення;
- history/UI не отримують два різні поля під одним ID;
- compatibility behavior задокументований.

Не використовуй цю задачу як привід для широкого redesign поза Етапом 1.

### Крок N. Оновлення документації та аудитів

1. Онови ADR відповідно до фактичної реалізації, а не наміру.
2. Не переписуй історичний аудит мовчки. Створи `STAGE_1_REMEDIATION_AUDIT.md`; у старому аудиті додай коротку примітку, що він superseded, із посиланням на новий.
3. Виправ хибні твердження про `0x12E4`, workbook coverage, negative tests, scope і pinned runtime.
4. Онови `OPEN_ISSUES.md`, `FINAL_READINESS_REPORT.md` та checklist лише на основі виконаних перевірок.
5. Документація повинна розрізняти source truth, implementation mapping, runtime policy та hardware validation.

## 6. Обов’язкова перевірка результату

Після реалізації виконай у чистому стані й зафіксуй точні команди, versions, exit codes і counts:

1. schema validation;
2. semantic validation;
3. evidence manifest/hash/locator validation;
4. workbook reconciliation regression;
5. generator determinism test;
6. generator `--check`;
7. simulated partial-generation failure test;
8. усі positive protocol tests;
9. усі 30 класів negative/mutation tests;
10. C++ unit tests;
11. history tests;
12. generic write transaction tests;
13. topology integration tests;
14. UI/mock catalog consistency tests;
15. policy bypass tests для blocked writes;
16. ID collision tests;
17. secret leakage scan;
18. `git diff --check`;
19. `git status --short` до й після tests;
20. ESPHome config validation і compile з project-pinned/recorded ESPHome version;
21. за наявності безпечного доступу — лише read-only comparison з реальним device; жодних write operations.

Тест, який неможливо виконати, познач `NOT EXECUTED`, поясни точну причину й вплив. Не замінюй hardware validation mock-тестом.

## 7. Критерії завершення

### 7.1. Критерії, які мають бути PASS

1. Correct register geometry, включно з 128-bit passcode.
2. Exact evidence references без неправдивих source claims.
3. Version/applicability model не змішує ESPHome/UI та BMS firmware.
4. Protocol inventory не обмежений лише current implementation.
5. Source-only та implementation-only differences явно представлені.
6. Verification status обчислюється детерміновано.
7. Unverified/conflict/unknown-enum writes заблоковані end-to-end.
8. Exact YAML/firmware/frontend/mock mapping machine-checkable.
9. Generated artifacts реально споживаються або чесно позначені як non-runtime.
10. Повний semantic validator реалізований.
11. Усі обов’язкові negative/mutation classes доведені.
12. Generator deterministic і захищений від mixed-generation state.
13. Test runner чистий, portable і cleanup-safe.
14. Entity/internal/wire/frontend/mock ID collision усунено або формально керовано.
15. Full software suite та ESPHome compile проходять.
16. Документація відповідає фактам.

### 7.2. Коли статус все одно NOT READY

Загальний статус має бути `NOT READY`, якщо:

- exact model/protocol variant scope не встановлено;
- заявляється повнота протоколу без визначеного versioned evidence set;
- хоч один непідтверджений field доступний для запису;
- є false evidence claim;
- YAML/UI/mock можуть непомітно розійтися з catalog;
- generator допускає змішане покоління;
- відсутній обов’язковий negative test;
- compile або будь-який обов’язковий software test падає;
- секрет потрапляє в артефакти/логи;
- аудит містить `PASS with caveat` замість однозначного статусу.

Відсутність офіційного документа не є дозволом вигадати підтвердження. Якщо software safety gates повністю реалізовані, але повноту exact protocol variant об’єктивно неможливо довести, чітко розділи:

- `Software infrastructure readiness`;
- `Protocol evidence completeness`;
- `Hardware validation readiness`;
- `Overall Stage 1 status`.

## 8. Формат фінального всеосяжного аудиту

Файл `STAGE_1_REMEDIATION_AUDIT.md` повинен містити:

1. Executive verdict: `READY` або `NOT READY`.
2. Baseline branch/HEAD/dirty-state/tool versions.
3. Scope і exact BMS model/protocol applicability.
4. Повний список змінених/створених файлів із призначенням.
5. Таблицю кожного дефекту з `before -> change -> evidence -> status`.
6. Source/evidence inventory з hashes, revisions і exact locators.
7. Workbook/upstream/implementation/hardware reconciliation counts і списки розбіжностей.
8. Register/field/access totals:
   - physical registers;
   - logical fields;
   - declared R/RW;
   - effective R/RW;
   - blocked writes;
   - verification status counts;
   - implementation status counts.
9. Таблицю всіх unresolved/conflict/unknown fields із фактичним runtime policy.
10. Доказ passcode geometry.
11. Доказ, що blocked fields відсутні в усіх write paths.
12. Mapping coverage для YAML, C++, wire API, frontend і mock.
13. Таблицю всіх test suites з командами, versions, counts, exit codes.
14. Таблицю всіх negative mutation classes та expected diagnostics.
15. Compile result.
16. Git cleanliness/build-artifact result.
17. Hardware actions: окремо вкажи, що було лише прочитано і що **жодного запису не виконано**.
18. Залишкові ризики та blockers без евфемізмів.
19. Бінарний checklist усіх критеріїв: лише PASS / FAIL / BLOCKED / NOT EXECUTED.
20. Однозначний висновок, чи дозволений перехід до Етапу 2.

Для кожного PASS наведи machine-verifiable evidence: file/line, command output, generated hash або test name. Слова «реалізовано», «готово», «перевірено» без доказу не зараховуються.

## 9. Очікувана фінальна відповідь у чаті

Після завершення дай стислий підсумок українською:

- фактичний статус;
- що саме виправлено;
- кількість регістрів/полів і R/RW/effective RW;
- tests/compile summary;
- чи були hardware writes;
- unresolved blockers;
- посилання на `STAGE_1_REMEDIATION_AUDIT.md`.

Не пиши «Готово», якщо критерії не виконані. Правильний негативний результат кращий за неправдиву готовність.

**Остання дія перед фінальною відповіддю — повторний всеосяжний аудит уже кінцевого стану репозиторію, а не проміжної реалізації.**
