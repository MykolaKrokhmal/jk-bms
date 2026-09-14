# Промпт для Claude: реалізація Етапу 1 — авторитетна модель протоколу та повний каталог R/RW

Ти працюєш безпосередньо з реальним проєктом JK BMS Web UI для ESP32 + ESPHome:

`/Users/mykola.krokhmal/Claude/jk-bms`

Працюй одночасно як:

- Senior ESPHome / ESP32 Architect;
- Senior C++ Engineer;
- JK BMS / Modbus Protocol Analyst;
- Embedded Safety Engineer;
- Data Contract and Schema Engineer;
- Reliability and QA Lead.

Це завдання є реалізацією лише **Етапу 1** з `IMPLEMENTATION_ROADMAP.md`: «Авторитетна модель протоколу та повний каталог R/RW». Не обмежуйся аналізом або рекомендаціями. Проведи аудит, внеси production-зміни, створи всі потрібні схеми, генератори, валідатори, тести й документацію, виконай перевірки та наприкінці зроби всеосяжний аудит фактичного результату.

Не переходь до Етапів 2–16. Якщо для наступного етапу потрібен контракт або metadata, на Етапі 1 створи лише авторитетні дані й стабільні generated interfaces, але не перебудовуй transaction manager, frontend lifecycle, topology resolver, persistence або security architecture.

## 1. Мета Етапу 1

Створити єдину versioned machine-readable модель протоколу, яка повністю й однозначно описує:

1. усі фізичні BMS-регістри, які читає або записує цей проєкт;
2. усі логічні поля всередині цих регістрів;
3. усі read-only і read-write поля;
4. адреси, ширини, endian, signedness, wire type, scale, offset, mask і shift;
5. одиниці, допустимі значення, крок, enum і reserved values;
6. packed siblings та правила overlap;
7. джерело, рівень доказовості й межі застосовності кожного твердження;
8. зв’язок `register -> logical field -> ESPHome entity -> backend key -> UI metadata -> mock fixture`;
9. окремий, явно відмежований набір calculated ESPHome та ESP32/browser/UI сутностей, які не є регістрами BMS;
10. детерміноване генерування похідних metadata й сувору автоматичну перевірку drift.

Етап не вимагає вгадати невідомі поля. Непідтверджене значення повинно бути присутнє в інвентарі з точним статусом доказовості, але його effective access має бути `r` або `unsupported`; воно не повинно отримати write capability.

## 2. Підтверджений стартовий стан

Виходь із фактичного стану проєкту, але перевір його повторно перед змінами:

- `register_catalog.json` містить 47 рядків, усі позначені `access: rw`;
- read-only регістри в каталозі відсутні;
- `device_name_override` помилково розміщений поруч із BMS-регістрами, хоча має `address: null` і є локальною ESPHome-конфігурацією;
- `test/register_catalog/validate.js` використовує переважно substring/regex-перевірки й не доводить точне зіставлення `address <-> entity <-> field metadata`;
- `scp_delay` у каталозі має `unit: s`, тоді як runtime/UI використовує `µs`;
- `rcv_time` і `rfv_time` у каталозі мають `unit: s`, тоді як YAML-коментарі та runtime/UI вказують години;
- `0x111C`, `0x1504`, `0x14E4`, `0x14E6` є packed-регістрами або кандидатами на packed-регістри й потребують доказового опису кожного байта/поля;
- `0x14E6` містить щонайменше поле джерела DRY2 та інше sibling-поле, але точний зміст і access кожної частини треба підтвердити;
- одиниця, scale і range для порогів LCD/DRY залежать від обраного trigger source;
- YAML, `jk_bms.js`, mock і каталог містять дубльовані вручну metadata;
- чинний write path має окремі P0-дефекти, але їх виправлення належить до Етапів 2–8.

Не приймай ці твердження як заміну повторному дослідженню. Вони задають перевірювані гіпотези й відомі дефекти.

## 3. Авторитетні джерела та порядок довіри

Повністю прочитай і зістав щонайменше:

1. `IMPLEMENTATION_ROADMAP.md`, повністю, з особливою увагою до Етапу 1 і залежностей Етапів 2, 6 та 11;
2. `OPEN_ISSUES.md`, повністю, з особливою увагою до P1-03, P1-07 і metadata-залежності P0-05;
3. `HARDWARE_AUDIT_2026-09-09.md`;
4. `HARDWARE_VALIDATION_CHECKLIST.md`;
5. `FINAL_READINESS_REPORT.md`, але не використовуй його старі твердження як доказ актуального стану без повторної перевірки;
6. `register_catalog.json`;
7. `batterylifepo4.yaml`, повністю, включно з sensor, binary_sensor, text_sensor, number, select, text, globals, interval, script, Modbus callbacks і custom handlers;
8. `jk_bms.js`, повністю, включно з entity registry, Settings definitions, translation maps, units, ordering, register-address maps і write metadata;
9. `demo/mock-server.js`, `demo/index.html`, `demo/panel.js` і `demo/README.md`;
10. `test/register_catalog/validate.js`, `test/topology/run.js`, `test/jk_write_tx/test_jk_write_tx_core.cpp` і `test/run_all.sh`;
11. усі файли в `components/`, які споживають адреси, masks, widths або write metadata;
12. workbook `/Users/mykola.krokhmal/Downloads/LiFePO4_BMS_Parameters_registers.xlsx`, якщо він доступний у середовищі;
13. наявні локальні JK PB protocol documents, register maps, Modbus captures та read-only hardware snapshots.

Для зовнішньої документації використовуй лише матеріали, які можна точно ідентифікувати за виробником, моделлю, protocol family, firmware applicability, назвою документа, версією та сторінкою/секцією. Не використовуй безіменний форумний допис або чужий код як єдиний доказ write access, масштабу чи packed layout.

Порядок довіри:

1. офіційна документація JK для підтвердженої моделі PB і відповідної firmware/protocol version;
2. контрольований read-only Modbus capture з реального пристрою, зіставлений із відомими фізичними значеннями;
3. workbook із явним походженням та адресами;
4. чинний YAML і код як доказ фактичної реалізації, але не як доказ правильності протоколу;
5. mock і UI як найнижчий рівень доказу, придатний лише для виявлення drift.

При конфлікті джерел не обирай зручний варіант. Зафіксуй конфлікт, applicability кожного джерела, обґрунтуй verdict. Якщо конфлікт неможливо вирішити без write або небезпечного hardware test, поле лишається `unverified` і read-only.

## 4. Безпека й жорсткі межі

На цьому етапі:

- не виконуй жодного запису в реальну JK BMS;
- не змінюй CellCount, protection thresholds, MOSFET controls, balancing controls, passcode або packed-регістри на hardware;
- не прошивай firmware та не перезавантажуй ESP32 без окремої явної потреби й дозволу;
- read-only HTTP/API/Modbus спостереження дозволене лише без зміни стану;
- не публікуй credentials, `secrets.yaml`, auth headers, passcode, Wi-Fi/API/OTA secrets у звітах, fixtures або логах;
- не змінюй production semantics write transaction manager;
- не виправляй UI Settings/Diagnostics на цьому етапі, крім мінімальної адаптації до generated metadata, якщо вона необхідна для усунення дублювання й проходження перевірок;
- не реалізуй dynamic topology, history persistence або security redesign;
- не видаляй наявну функціональність без доказу, що це мертвий дублікат generated metadata;
- не перезаписуй незв’язані зміни користувача;
- не використовуй destructive Git або filesystem-команди;
- перед редагуванням зафіксуй `git status`, branch, commit SHA та diff baseline;
- не коміть і не push зміни, якщо це прямо не дозволено користувачем.

## 5. Обов’язкова модель даних

Спочатку створи короткий ADR, який фіксує архітектуру каталогу, джерела, generation flow, правила доказовості й compatibility. Каталог повинен відділяти фізичний регістр від логічного поля. Один запис на logical field без окремої сутності physical register недостатній для packed fields.

### 5.1. Metadata фізичного регістра

Для кожного фізичного регістра зафіксуй:

- стабільний `register_id`;
- `protocol_family`;
- `model_scope`;
- `firmware_scope`;
- `address` у canonical hex format;
- address space/register type, якщо протокол розрізняє типи;
- `register_width_bits` і кількість 16-bit words;
- byte order і word order;
- read command/function semantics;
- write command/function semantics, якщо підтверджено;
- declared access і effective access;
- poll group;
- freshness budget;
- atomicity/locking group;
- список logical fields;
- evidence references;
- verification status;
- safety notes.

### 5.2. Metadata логічного поля

Для кожного logical field зафіксуй:

- стабільний `key`;
- parent `register_id`;
- `field_width_bits`;
- `byte_offset` або bit offset;
- `mask`;
- `shift`;
- signedness;
- wire type;
- enum/raw representation;
- scale;
- offset;
- canonical engineering unit;
- українську display unit;
- англійську display unit;
- decimal precision;
- minimum;
- maximum;
- step;
- reserved/raw-invalid values;
- nullable/availability semantics;
- packed siblings;
- overlap rule;
- `access` і `effective_access`;
- write safety class: `normal`, `disruptive`, `topology`, `credential`, `unsupported`;
- ESPHome domain та entity ID;
- backend key;
- frontend label keys UK/EN;
- UI section;
- exact UI order;
- editor kind: read-only, number, toggle, enum/select, text, password або unsupported;
- dynamic unit/range dependency, якщо є;
- source evidence;
- verification status;
- documented exclusion reason, якщо поле не експонується.

### 5.3. Допустимі verification statuses

Визнач точний enum і правила переходів. Мінімально потрібні:

- `confirmed_official`;
- `confirmed_hardware_read`;
- `confirmed_multiple_sources`;
- `implemented_unverified`;
- `conflict`;
- `unknown`.

Поле зі статусом `implemented_unverified`, `conflict` або `unknown` не може мати effective write access незалежно від того, що чинний YAML уже має write lambda.

### 5.4. Окремі datasets

Фізично й логічно розділи:

1. BMS physical registers та fields;
2. calculated ESPHome fields;
3. ESP32 runtime/network fields;
4. browser/UI session fields;
5. local ESPHome configuration fields, включно з `device_name_override`.

Для non-register entity збережи ключ, клас, джерело, тип, units, entity ID і UI destination, але не вигадуй address/access. Вони не повинні рахуватися як BMS register coverage.

## 6. Повна інвентаризація без пропусків

Побудуй машинну інвентаризацію з кожного шару окремо:

1. усі Modbus addresses, ranges, response offsets і write call sites у YAML/C++;
2. усі BMS-sourced ESPHome entities;
3. усі template/calculated entities;
4. усі JS entity registrations, Settings definitions, control definitions, units, labels і ordering;
5. усі mock entities, handlers, register maps і fixtures;
6. усі рядки workbook;
7. усі поля підтвердженої protocol документації;
8. усі поля read-only hardware snapshot/capture.

Потім сформуй coverage matrix із взаємно виключними результатами для кожного елемента:

- mapped exactly;
- intentionally excluded with reason;
- source-only, not implemented;
- implementation-only, not confirmed;
- conflict;
- duplicate;
- unreachable/dead metadata.

Вимоги повноти:

- кожна BMS entity у YAML має рівно один logical field mapping або явний documented exclusion;
- кожний register/field каталогу має physical source mapping;
- кожний RW UI editor має рівно один catalog field;
- кожний mock register/entity має catalog mapping або mock-only marker;
- кожний workbook BMS row має mapping або documented exclusion;
- жодне calculated/local/browser поле не маскується під BMS register;
- жодний unknown register не зникає через те, що UI його не показує.

Не використовуй простий пошук hex-літерала як доказ mapping. Наприклад, наявність `0x1504` у YAML не доводить, що конкретний logical field має правильний byte offset, mask, scale або unit.

## 7. Обов’язкова верифікація packed-регістрів

Окремо досліди `0x111C`, `0x1504`, `0x14E4`, `0x14E6`.

Для кожного створи таблицю:

- physical width;
- word/byte order;
- high-byte field;
- low-byte field;
- signedness кожного поля;
- mask;
- shift;
- raw examples із decode;
- scale/unit;
- access кожного поля;
- reserved values;
- sibling relationship;
- evidence source;
- verification verdict;
- write eligibility.

Перевір такі чинні припущення, не приймаючи їх автоматично:

- `0x111C`: два INT8 temperature fields;
- `0x1504`: RCV і RFV як два UINT8, scale 0.1 та unit hours;
- `0x14E4`: LCD buzzer trigger source і DRY1 trigger source;
- `0x14E6`: DRY2 trigger source та protocol-library/version sibling.

Перевір симетричність packed metadata, однакову parent address, відсутність overlap, повне покриття відомих бітів і явний статус невідомих/reserved bits. Не приписуй full-register `mask` окремому logical field.

Додай тести encode/decode для minimum, maximum, zero, negative INT8, high-byte, low-byte, reserved values та round-trip. На цьому етапі тести перевіряють metadata/codec, а не виконують BMS write.

## 8. Одиниці, scale, bounds і dynamic semantics

Нормалізуй wire representation окремо від presentation:

- canonical units мають бути стабільними й не залежати від UI language;
- UK display units використовують українські літери там, де це мовна одиниця: `В`, `А`, `Ом`, `мОм`, `мкс`, `с`, `год`, `А·год`;
- EN display units: `V`, `A`, `Ω`, `mΩ`, `µs`, `s`, `h`, `Ah`;
- символи `°C`, `%` і `Ω` можуть бути спільними, якщо це закріплено glossary;
- не змінюй wire scale при перекладі одиниці;
- precision має походити зі scale/step, а не з випадкового форматування UI;
- min/max повинні відповідати protocol field width і domain safety, а не `2147483647` за замовчуванням без доказу.

Обов’язково розв’яжи або чесно класифікуй:

1. `scp_delay`: `µs/мкс` проти помилкового `s`;
2. `rcv_time`, `rfv_time`: `h/год` проти помилкового `s`;
3. cell wire resistance: physical raw scale і canonical/display unit;
4. температурні signed fields;
5. current/capacity scales;
6. trigger/recovery values LCD/DRY.

Для LCD/DRY створи data-driven dependency table:

`trigger source raw enum -> semantic quantity -> canonical unit -> UK unit -> EN unit -> scale -> min -> max -> step -> valid/unsupported`.

Якщо хоча б для одного source mapping немає достатнього доказу, цей source/threshold editor повинен мати metadata `unsupported` або `read_only_until_verified`. Не залишай порожню unit як мовчазну норму.

## 9. Schema, generator і generated artifacts

Реалізуй versioned canonical source та JSON Schema. Обери чітку структуру каталогів, зафіксуй її в ADR і не підтримуй дві ручні копії істини.

Обов’язкові класи артефактів:

1. canonical protocol source;
2. JSON Schema з `additionalProperties: false` для контрольованих об’єктів;
3. окремий non-register entity catalog;
4. generated normalized `register_catalog.json`, збережений у backward-compatible місці або з атомарною міграцією всіх consumers;
5. generated C++ metadata для майбутнього transaction core;
6. generated ESPHome entity/register mapping metadata;
7. generated frontend label/order/unit/editor metadata;
8. generated mock register/entity fixtures;
9. generated human-readable coverage/evidence report;
10. documented generator command і `--check` mode.

Generated artifacts повинні мати header із generator version і canonical source hash, але не містити machine-specific absolute paths або timestamps, які руйнують детермінізм.

Генерація повинна бути детермінованою:

- два послідовні запуски на тих самих inputs дають byte-identical outputs;
- `generate --check` завершується non-zero при drift;
- invalid canonical source не генерує часткові outputs;
- outputs пишуться атомарно;
- порядок визначений schema/UI order/address правилами, а не випадковим порядком object keys;
- generated файли не редагуються вручну.

Не вбудовуй у generated frontend metadata secret values або hardware-specific runtime state.

## 10. Заміна слабкого валідатора

Перепиши `test/register_catalog/validate.js` або заміни його на еквівалентний строгий validator. Рядкові `includes()` та regex по випадкових hex-літералах не можуть бути основним доказом correctness.

Оптимальна стратегія:

1. canonical schema є єдиною ручною metadata source;
2. C++/YAML/JS/mock metadata генерується з неї;
3. validator перевіряє schema, semantic invariants і byte-identical regeneration;
4. для залишкових hand-authored YAML/C++ write/read call sites використовується structured extraction із точним location-aware mapping;
5. кожне виключення оформлене machine-readable allowlist entry з reason і evidence, а не пропущене умовою в коді.

Validator зобов’язаний виявляти:

- missing register;
- missing logical field;
- duplicate key/register ID;
- duplicate address без packed/alias declaration;
- unknown parent register;
- invalid width/mask/shift;
- overlapping masks;
- asymmetric sibling relation;
- uncovered known bits;
- signedness drift;
- endian/word-order drift;
- scale/offset drift;
- canonical/display unit drift;
- access/effective-access drift;
- invalid min/max/step/precision;
- enum duplicate/reserved collision;
- UI order duplicate або gap, якщо gap не дозволений;
- неправильний natural order cell voltage/resistance `01..N`;
- entity ID/backend key collision;
- BMS register у non-register dataset;
- calculated/local/browser entity у register catalog;
- RW field без підтвердженого evidence;
- unverified field із write-enabled metadata;
- source reference без існуючого документа/locator;
- generated artifact drift;
- unknown property, заборонену JSON Schema.

Створи negative fixtures/tests для кожного класу помилки. Тест повинен доводити, що validator справді завершується non-zero і дає точне location-aware повідомлення, а не лише тестувати happy path.

## 11. Compatibility та межі інтеграції

Збережи поточну працездатність проєкту:

- existing entity IDs і HTTP endpoints не перейменовуй без migration map;
- Stage 1 не повинен змінювати wire write behavior;
- якщо generated metadata замінює JS/YAML/mock масив, забезпеч backward-compatible keys;
- відмінність між control register і live status sensor має бути явною, зокрема для charging, discharging і balancing;
- `device_name_override` перенеси до local configuration dataset без ламання його чинного UI behavior;
- не вважай mock підтвердженням protocol truth;
- не додавай до firmware великі runtime JSON parsers, якщо те саме можна згенерувати compile-time;
- оціни flash/RAM delta generated C++ metadata;
- не дублюй українські/англійські labels у кількох ручних масивах після генерації.

Якщо повна генерація конкретного ESPHome YAML fragment технічно несумісна з ESPHome substitutions/`!lambda`, зафіксуй це в ADR і створи структурований manifest/include або exact parser-based validator. Не повертайся до substring evidence.

## 12. Обов’язкові тести й команди перевірки

Перед змінами запусти baseline tests і збережи точний результат. Після змін виконай щонайменше:

1. JSON Schema positive validation canonical source;
2. усі negative schema/semantic fixtures;
3. generator normal mode;
4. generator `--check` mode;
5. подвійний generation determinism test із hash comparison;
6. coverage validator;
7. packed codec round-trip tests;
8. unit/scale/bounds/enum tests;
9. exact mapping та exclusions test;
10. `node --check jk_bms.js`;
11. `node --check demo/mock-server.js`;
12. `node --check demo/panel.js`;
13. `TEST_PORT=<вільний порт> node test/topology/run.js`;
14. `test/run_all.sh` із контрольованим вільним портом і гарантованим teardown;
15. `esphome config batterylifepo4.yaml` на production ESPHome version;
16. `esphome compile batterylifepo4.yaml` на ESPHome 2026.8.2 або фактичній зафіксованій production version;
17. `git diff --check`;
18. secret scan змінених/generated файлів;
19. перевірку, що повторна генерація не змінює git tree;
20. звіт RAM/flash до та після, якщо generated C++ metadata потрапляє у firmware.

Не маскуй `EADDRINUSE` повторним використанням невідомого процесу. Знайди вільний порт або керуй точним PID процесу, який сам запустив. Не використовуй broad `pkill`.

Кожна команда у фінальному аудиті має містити:

- exact command;
- cwd;
- tool/version;
- exit code;
- кількість PASS/FAIL/SKIP;
- посилання на збережений log або стислий фактичний output;
- пояснення, що саме ця команда доводить і чого вона не доводить.

SKIP, unavailable tool, unavailable workbook, unavailable hardware або unavailable authoritative document не є PASS. Це окремий blocker або обмеження доказовості.

## 13. Обов’язкові артефакти результату

Залиш у репозиторії щонайменше:

1. ADR архітектури protocol catalog і generation flow;
2. canonical versioned protocol source;
3. JSON Schema;
4. non-register entity catalog;
5. generator і `--check` mode;
6. усі generated artifacts;
7. строгий validator;
8. positive і negative test fixtures;
9. packed encode/decode tests;
10. coverage/evidence report;
11. актуалізовану інструкцію запуску генерації та тестів;
12. `STAGE_1_IMPLEMENTATION_AUDIT.md` із повним аудитом за розділом 15 цього промпту.

Якщо назви файлів відрізняються, у ADR і фінальному аудиті наведи точне зіставлення кожного обов’язкового класу артефакту з реальним шляхом.

## 14. Критерії завершення Етапу 1

Статус `Етап 1: ГОТОВО` дозволено встановити лише якщо одночасно виконано все:

1. 100% BMS-sourced YAML entities мають exact catalog mapping або documented exclusion.
2. 100% catalog fields мають physical parent register і source evidence.
3. 100% підтверджених R і RW полів доступного protocol scope присутні в canonical source.
4. Read-only регістри більше не відсутні як клас.
5. Non-register ESPHome/ESP32/browser/UI/local fields фізично відокремлені від BMS catalog.
6. Немає duplicate logical keys, недекларованих address collisions або overlapping masks.
7. `0x111C`, `0x1504`, `0x14E4`, `0x14E6` мають повну доказову packed matrix; непідтверджені частини заблоковані для запису.
8. `scp_delay`, `rcv_time`, `rfv_time` не мають unit drift.
9. LCD/DRY trigger-dependent metadata описана data-driven; unknown mapping блокує editor/write metadata.
10. Access, effective access і safety class узгоджені; unverified field не може бути write-enabled.
11. Canonical source проходить JSON Schema і semantic validation.
12. Усі negative fixtures гарантовано падають із правильним reason/location.
13. Generator outputs детерміновані й `--check` не знаходить drift.
14. C++/ESPHome/frontend/mock artifacts мають один canonical source, а не незалежні ручні копії.
15. Cell voltage і resistance ordering природний та перевірений для `01..16`.
16. Повний test suite проходить без FAIL і без прихованих обов’язкових SKIP.
17. ESPHome config і production-version compile проходять після змін.
18. Немає нових secrets, write behavior changes або unrelated regressions.
19. Документація описує реальні файли, команди, scope і відомі uncertainty.
20. `git diff --check` чистий, а повний diff вручну перевірений на випадкові зміни.

Якщо хоча б один критерій не доведено, статус повинен бути `Етап 1: НЕ ГОТОВО` або `Етап 1: ЧАСТКОВО ВИКОНАНО`, із точним blocker, ризиком і наступною безпечною дією.

## 15. Всеосяжний аудит наприкінці виконання

Після завершення кодування і тестів не пиши коротке резюме замість аудиту. Створи `STAGE_1_IMPLEMENTATION_AUDIT.md`, потім у фінальній відповіді відтворюй його висновки без суперечностей.

Аудит повинен містити всі наведені розділи.

### 15.1. Фінальний статус

Перший рядок:

- `Етап 1: ГОТОВО`, або
- `Етап 1: ЧАСТКОВО ВИКОНАНО`, або
- `Етап 1: НЕ ГОТОВО`.

Після статусу наведи одне доказове речення. Не використовуй відсоток готовності без формули й повної матриці критеріїв.

### 15.2. Scope і baseline

- commit SHA, branch, pre-existing dirty files;
- production ESPHome/toolchain versions;
- перелік файлів, прочитаних як джерела;
- baseline counts: physical registers, logical fields, R, RW, unverified, non-register entities;
- baseline test commands/results;
- підтвердження, що hardware writes не виконувалися.

### 15.3. Реально виконані зміни

Таблиця:

`Файл | Зміна | Причина | Який дефект/критерій закриває | Generated чи hand-authored`.

Не включай заплановане як виконане.

### 15.4. Архітектура істини та generation graph

Покажи точний потік:

`authoritative evidence -> canonical source -> schema/semantic validator -> generator -> C++/ESPHome/JS/mock/docs artifacts -> tests`.

Для кожної стрілки наведи реальний файл і команду.

### 15.5. Підсумкова кількісна інвентаризація

Наведи точні counts:

- physical registers;
- logical fields;
- R;
- RW;
- effective R;
- effective RW;
- unsupported;
- verification statuses;
- packed groups;
- aliases;
- calculated ESPHome;
- ESP32;
- browser/UI;
- local configuration;
- exclusions;
- conflicts;
- unmapped source rows.

Суми категорій повинні бути математично узгоджені. Поясни поля, які можуть входити до кількох ортогональних категорій.

### 15.6. Evidence coverage matrix

Для кожного logical field або для повного generated додатка, включеного до аудиту, наведи:

`key | address | field mask/shift | R/RW | effective access | scale | canonical unit | evidence source+locator | verification status | implementation mapping | verdict`.

Не замінюй повний перелік вибіркою. Якщо таблиця велика, згенеруй її як окремий versioned artifact і в аудиті наведи hash, count та перевірку повноти.

### 15.7. Packed-register audit

Окрема повна таблиця для `0x111C`, `0x1504`, `0x14E4`, `0x14E6`, включно з unknown/reserved bits, конфліктами, codec tests і write eligibility.

### 15.8. Unit/scale/range audit

Окрема таблиця всіх знайдених drift:

`field | before | authoritative evidence | after | test | verdict`.

Обов’язково включи SCP delay, RCV/RFV, resistance, temperatures, capacity/current та всі LCD/DRY dynamic cases.

### 15.9. Coverage та exclusions

Наведи:

- кожну source-only сутність;
- кожну implementation-only сутність;
- кожне documented exclusion;
- кожний conflict/unverified field;
- причину, ризик, effective access і точну дію для зняття uncertainty.

Нульовий список потрібно підтвердити командою/звітом, а не твердженням.

### 15.10. Validator і negative tests

Матриця всіх обов’язкових failure classes із назвою fixture/test, очікуваним reason, фактичним exit code та verdict. Доведи, що старий substring/regex-only доказ більше не є основним механізмом.

### 15.11. Детермінізм generated artifacts

- generator version;
- canonical source hash;
- hashes усіх outputs;
- результат двох послідовних генерацій;
- результат `--check`;
- підтвердження відсутності timestamps/absolute paths у deterministic outputs;
- git tree result після повторної генерації.

### 15.12. Повна матриця виконаних команд

Для кожної команди: exact command, cwd, version, exit code, PASS/FAIL/SKIP counts, log/evidence, межа доказу.

### 15.13. Build і resource impact

- ESPHome config result;
- compile result;
- RAM/flash before/after/delta;
- warnings before/after;
- пояснення кожного нового warning;
- підтвердження, що generated metadata не створила неприйнятного runtime parser або memory cost.

### 15.14. Safety і security audit

- підтвердження відсутності hardware writes;
- підтвердження відсутності secret leakage;
- список write-capability змін, якщо metadata effective access було знижено до R;
- підтвердження, що transaction behavior не змінювався;
- residual safety risks, що переходять до Етапів 2–8.

### 15.15. Матриця 20 критеріїв завершення

Повна таблиця критеріїв 1–20 з колонками:

`№ | PASS/FAIL/BLOCKED | Доказ | Команда/файл | Залишковий ризик`.

`BLOCKED` не дорівнює PASS. Усі 20 рядків обов’язкові.

### 15.16. Відкриті питання та наступний безпечний крок

Для кожного відкритого питання:

`ID | Невідоме | Чому не вирішено | Ризик | Що потрібно | Чи блокує Етап 1 | Заборонена дія до вирішення`.

Не починай Етап 2. Лише вкажи, чи виконані передумови для нього.

### 15.17. Остаточний висновок

Повтори той самий статус, що на початку аудиту. Статус `Етап 1: ГОТОВО` допустимий лише при 20/20 PASS, нульових обов’язкових FAIL/SKIP, відсутності неврахованих fields і clean deterministic generation.

## 16. Заборонені способи оголошення успіху

Не вважай Етап 1 завершеним лише тому, що:

- JSON парситься;
- старі 418 validator checks проходять;
- hex address зустрічається в YAML;
- mock містить такий самий key;
- існуючий write lambda використовує адресу;
- UI показує значення;
- `esphome compile` успішний;
- один protocol document частково збігається;
- workbook має рядок без підтвердженого applicability;
- hardware read-only snapshot виглядає правдоподібно;
- всі відомі RW editors внесені, але R fields відсутні;
- conflict приховано вибором одного джерела;
- generated output створений один раз без determinism check;
- negative validator cases не запускалися;
- невідоме поле назване RW за аналогією.

## 17. Робоча дисципліна

1. Спочатку аудит і failing tests, потім мінімальна архітектурна зміна, потім генерація, positive/negative tests, full regression, compile і фінальний аудит.
2. Працюй малими логічними change sets, але не залишай часткову міграцію з двома джерелами істини.
3. Не приховуй pre-existing dirty state й не відкатуй чужі зміни.
4. Не редагуй generated files вручну.
5. Не змінюй значення лише для проходження тесту без protocol evidence.
6. Якщо потрібний документ або workbook недоступний, продовжуй безпечну частину реалізації, позначай поля `unverified`, але не оголошуй недоведений критерій PASS.
7. Якщо наближається ліміт контексту, збережи стан у репозиторному audit/worklog і продовжуй реалізацію з нього; не скорочуй обов’язкові таблиці й не замінюй код описом.
8. Фінальна відповідь повинна містити лише фактичні результати, точні шляхи, команди, числа, blockers і статус. Не пиши `Готово`, якщо аудит не доводить кожний критерій.

## 18. Остання обов’язкова дія

Після всіх змін, генерацій, тестів, compile і перевірки diff останньою дією виконай **всеосяжний аудит результату** за розділом 15. Спочатку запиши повний аудит у `STAGE_1_IMPLEMENTATION_AUDIT.md`, перевір його внутрішню узгодженість, counts, hashes, paths, commands і статуси 20 критеріїв, а потім надай фінальну відповідь. Не завершуй роботу до створення цього документа. Фінальний статус у відповіді, на початку аудиту й у його остаточному висновку має бути однаковим та підтверджуватися наведеною evidence matrix.
