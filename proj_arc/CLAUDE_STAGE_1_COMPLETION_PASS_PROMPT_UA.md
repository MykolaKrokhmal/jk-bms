# Промпт для Claude: Stage 1 Completion Pass

Ти працюєш безпосередньо з реальним проєктом JK BMS Web UI для ESP32 + ESPHome.

Працюй як:

- Senior ESPHome / ESP32 Architect;
- Senior Embedded C++ Engineer;
- Embedded Security Engineer;
- IoT Network Security Engineer;
- Protocol Evidence and Reverse-Engineering Lead;
- Build and Release Engineer;
- Reliability and QA Lead;
- незалежний технічний аудитор.

## 1. Мета

Заверши всі **програмно усувні** дефекти Stage 1 Remediation. Не переходь до Етапу 2. Не обмежуйся звітом: виправ реалізацію, pipeline, policy, тести й документацію, після чого останньою дією проведи всеосяжний аудит кінцевого стану.

Початковий звіт `STAGE_1_REMEDIATION_AUDIT.md` не є доказом готовності. Незалежний аудит `CODEX_STAGE_1_REMEDIATION_RESULT_REVIEW.md` має вищий пріоритет як перелік дефектів цього completion-pass.

Не оголошуй READY через відсутність FAIL у власних тестах. READY дозволений лише за виконання всіх exit gates цього промпту.

## 2. Обов’язкові вхідні матеріали

Прочитай повністю перед редагуванням:

- `IMPLEMENTATION_ROADMAP.md`;
- `CLAUDE_STAGE_1_IMPLEMENTATION_PROMPT_UA.md`;
- `CLAUDE_STAGE_1_REMEDIATION_PROMPT_UA.md`;
- `CODEX_STAGE_1_REVIEW.md`;
- `STAGE_1_IMPLEMENTATION_AUDIT.md`;
- `STAGE_1_REMEDIATION_AUDIT.md`;
- `CODEX_STAGE_1_REMEDIATION_RESULT_REVIEW.md`;
- `FINAL_READINESS_REPORT.md`;
- `HARDWARE_VALIDATION_CHECKLIST.md`;
- `HARDWARE_AUDIT_2026-09-09.md`;
- `OPEN_ISSUES.md`;
- `docs/adr/0001-protocol-catalog.md`;
- `batterylifepo4.yaml`;
- `jk_bms.js`, `jk_bms.css`;
- `demo/mock-server.js`, `demo/panel.js`;
- усі файли `protocol/`, `tools/protocol/`, `test/protocol_catalog/`, `test/register_catalog/`;
- `test/run_all.sh`;
- workbook, якщо доступний через шлях, переданий користувачем або environment/config, але не через новий hardcoded personal path.

Почни з baseline:

- branch і HEAD;
- повний `git status --short`;
- staged/unstaged/untracked inventory;
- tool versions;
- hashes current canonical/evidence/generated artifacts;
- поточні test results;
- список файлів, які вже містять незакомічені зміни користувача.

Не скидай і не видаляй чужі зміни.

## 3. Жорсткі обмеження безпеки

1. Не виконуй жодних записів у реальну BMS.
2. Не прошивай, не reboot і не змінюй ESP32/BMS configuration.
3. Не підключайся до реального device без явного дозволу користувача саме в поточній сесії.
4. Не використовуй облікові дані з попередніх чатів, файлів або логів.
5. Не друкуй, не цитуй і не копіюй exact username/password/token fragments у відповіді, diff summary, tests або audit.
6. Не роби commit, push, PR або history rewrite без прямого дозволу.
7. Не використовуй destructive Git/filesystem operations.
8. Не запускай broad process kills.
9. Не маскуй невиконаний hardware validation mock-тестом.

## 4. Фаза 0 — security incident cleanup

Це перша реалізаційна дія після baseline.

### 4.1. Видалення секретів

`test/protocol_catalog/test_secret_scan.js` містить реальні credential fragments і виключає сам себе зі scan. Видали реальні значення з коду, fixtures, comments, docs, logs і generated artifacts. Не повторюй їх у terminal output.

Перевір:

- working tree;
- staged index;
- tracked files;
- untracked text files в межах repo;
- останні commits, якщо значення могло бути committed;
- generated/build/log artifacts.

Якщо секрет є в commit history, не переписуй history самостійно. Зафіксуй blocker і точну безпечну процедуру для користувача. Рекомендуй ротацію, але не змінюй реальний пароль без прямого дозволу.

### 4.2. Безпечний scanner

Перероби scanner так, щоб він:

- сканував самого себе;
- охоплював усі релевантні tracked та untracked text files репозиторію;
- не містив реальних secret literals;
- виявляв credential assignments, Authorization headers, private keys, tokens, Wi-Fi/API/OTA/web credentials;
- мав allowlist лише для безпечних placeholder patterns на кшталт `!secret variable_name` і example placeholders;
- не друкував повне знайдене значення, а лише file, line, detector ID та redacted fingerprint;
- мав synthetic positive fixture з вигаданим значенням і negative fixture для `!secret` reference;
- повертав non-zero exit при витоку;
- не сканував binary blobs як UTF-8 текст, але окремо повідомляв skipped binary files.

### 4.3. Exit gate фази 0

- жодного реального secret literal у current files;
- scanner ловить synthetic leak;
- scanner не ловить valid placeholder/reference;
- scanner сканує себе й основні YAML/JS/demo/audit files;
- audit не містить secret value.

## 5. Фаза 1 — одна authoritative evidence model

### 5.1. Усунь source alias split

Canonical evidence повинне посилатися на exact `source_id` із `protocol/evidence/sources.json`, а не на окремий hardcoded enum aliases.

Вимоги:

- schema перевіряє source reference через machine-generated allowed source IDs або validator foreign-key check;
- `reconcile_evidence` завантажує й реально використовує `status`, `claims_supported`, `independence_group`, provenance і hash/revision із manifest;
- невідомий source ID — hard failure;
- unavailable source не може бути evidence;
- tier/trust не дублюється вручну в field citation, а походить із source manifest;
- source manifest сам має schema та negative tests.

### 5.2. Перейди від address evidence до claim-level evidence

Для кожного register/field моделюй окремі claims:

- address;
- register width;
- word count;
- byte order;
- word order;
- field width;
- mask/shift/byte offset;
- signedness;
- wire type;
- scale;
- offset;
- canonical unit;
- declared access;
- write function;
- raw encode/decode transform;
- minimum/maximum/step;
- enum mapping/reserved/unknown-code policy;
- packed atomicity/preserve-sibling behavior;
- model/protocol applicability;
- observed decoded value;
- observed raw frame, якщо існує.

Evidence citation повинна містити:

- `source_id`;
- exact locator ID;
- список claim types;
- normalized values цих claims;
- source hash/revision;
- confidence/applicability;
- derivation group.

Address presence не підтверджує scale, unit, access або write transform.

### 5.3. Exact locators

Для workbook:

- source path передається CLI argument/config/environment;
- identity визначається SHA-256, не personal absolute path;
- locator: sheet + exact row/cell range;
- parsed claims містять address, qualifier, label, observed value, displayed unit, access;
- parser не приписує compound row усім sibling fields без explicit mapping rule;
- source hash звіряється з manifest і mismatch блокує pipeline.

Для upstream:

- exact commit SHA і local snapshot hash;
- exact line/range;
- comment-table row парситься у структуровані columns, а не лише address + raw text;
- YAML entity block прив’язується до address, type, filters/lambda, unit, access/write action;
- comment-only і implemented-upstream мають різні claim capabilities.

Для implementation:

- exact entity block locator;
- address, register_count, response_size, value_type, filters/lambda, unit, internal ID, exposed name/object ID, set_action/write function;
- block-read mapping містить base address, byte offsets і exact decode locator;
- regex address presence без entity association не зараховується.

Для hardware audit:

- hash документа;
- exact table row/field locator;
- не приписувати address/scale/access, якщо немає raw request/response frame;
- decoded SSE/API value підтверджує лише deployment-observed entity value і plausibility;
- ручний allowlist без machine-checkable locator не дозволений.

### 5.4. Provenance та незалежність

Не вважай джерела незалежними за різними іменами.

Введи:

- `provenance_status`: known / partially_known / unknown;
- `derivation_group`;
- `independence_status` для кожної пари або claim;
- правило: unknown provenance не рахується незалежним підтвердженням;
- current implementation та upstream мають спільну derivation group, якщо implementation походить від upstream;
- workbook не рахується незалежним, доки provenance цього не доведено;
- decoded hardware entity не є незалежним доказом mapping, створеного implementation.

### 5.5. Детермінований verification verdict

Verification status виводиться лише з claim matrix. Не зберігай старий `conflict` вручну.

Для кожного field створи machine-readable verdict:

- confirmed claims;
- conflicting claims;
- missing claims;
- dependent/derivative evidence;
- exact applicability;
- read readiness;
- write readiness;
- reason codes.

Мутація evidence/status без зміни source claims повинна бути відхилена.

## 6. Фаза 2 — fail-closed write safety

### 6.1. Визнач required write claims

Для `effective_access: rw` обов’язково мають бути підтверджені:

- exact address;
- full register/payload geometry;
- field geometry;
- signedness/wire type;
- byte/word order;
- scale/offset;
- raw encode transform;
- allowed raw and physical domain;
- declared RW semantics;
- write function;
- readback function і comparator;
- packed sibling preservation/atomicity;
- model/protocol applicability;
- safety class;
- enum/reserved semantics для enum/boolean;
- dynamic unit dependency для залежних полів.

Відсутність будь-якого required write claim автоматично встановлює:

- `effective_access: r` або `unsupported`;
- generated reason code;
- відсутність write entity/endpoint;
- відсутність generic/bespoke dispatch;
- read-only UI.

Не залишай 39 RW лише тому, що адреса присутня у двох таблицях. Перерахуй policy після claim-level reconciliation. Безпечне тимчасове блокування краще за непідтверджений запис.

### 6.2. Сім LCD/DRY fields

No-op `set_action` не є backend rejection. Реалізуй compile-valid read-only representation:

- не публікуй writable `number` endpoint; або
- backend повинен явно відхиляти set command без false-success response.

Перевір direct request, API invocation і UI:

- endpoint відсутній або повертає non-success/rejected;
- Modbus write не викликається;
- frontend не показує editor/OK;
- mock поводиться так само;
- повідомлення пояснює причину блокування;
- stale `SETTING_DEFS`/endpoint definitions видалені або генеруються тільки для effective RW.

Не виконуй real hardware write.

### 6.3. Інші RW fields

Застосуй той самий policy до всіх полів, включно з heating thresholds. Поле з `corroborated_with_limitations` не може бути writable без окремого доведеного write-readiness verdict.

### 6.4. Policy bypass tests

Додай тести для:

- UI editor absence;
- direct API rejection;
- mock rejection;
- dispatch map absence;
- ESPHome entity/domain absence;
- stale SETTING_DEFS cannot re-enable;
- forged `effective_access` rejected by derived-policy validator;
- no false green confirmation для rejected/no-op command.

## 7. Фаза 3 — усунення ID collision

Не залишай тест, який проходить завдяки наявності колізії.

Побудуй exact mapping:

```text
protocol field key
-> YAML internal id
-> exposed ESPHome name/object_id
-> SSE/API wire id
-> frontend state key
-> mock key
-> aliases/legacy consumers
```

Для RCV і RFV:

- обери один canonical live state key;
- усунь duplicate `registerEntity` ownership одного wire ID;
- якщо потрібна backward compatibility, реалізуй явний one-to-many alias fan-out без last-registration-wins;
- усі chart/timeline/settings/readback consumers мають отримувати те саме live value;
- mock і real mapping однакові;
- додай negative duplicate-owner test;
- додай positive live-update fan-out test;
- онови ADR та safety notes;
- видали тест, який очікує збереження дефекту, або перероби його так, щоб він вимагав відсутність колізії.

## 8. Фаза 4 — єдиний deterministic pipeline

### 8.1. Прибери dual/multi truth

Зараз `build_seed.py`, index builders, `reconcile_evidence.py` і `generate.js` можуть послідовно перезаписувати різні рівні. Побудуй одну явну модель:

```text
immutable/versioned source artifacts
+ human-authored protocol definitions
-> normalized claim indexes
-> reconciled resolved catalog
-> runtime/generated projections
-> manifest
```

Визнач і задокументуй, які файли:

- source inputs;
- human-authored inputs;
- generated intermediates;
- generated runtime outputs.

Не називай файл одночасно hand-maintained canonical і output `reconcile_evidence.py`.

### 8.2. `build_seed.py`

Один із допустимих результатів:

- видалити executable one-time script після перенесення потрібного rationale в ADR/source data; або
- перетворити його на актуальний авторитетний builder, output якого byte-identical current source і який входить у pipeline/check.

Застарілий executable script, запуск якого повертає хибні evidence/version facts, заборонений.

### 8.3. Один orchestrator

Створи один command, наприклад:

```text
protocol pipeline build
protocol pipeline check
```

`check` повинен у temp directory повністю повторити:

- source hash verification;
- workbook/upstream/implementation/hardware index build;
- claim reconciliation;
- status/write-policy derivation;
- resolved catalog build;
- schema/semantic validation;
- runtime projection generation;
- reconciliation report;
- manifest;
- byte comparison з repository outputs.

Stale index, stale report, stale canonical/resolved catalog або stale generated artifact мають давати non-zero exit.

### 8.4. Portable inputs і dependencies

- workbook path не hardcoded;
- personal home path не потрапляє в generated files;
- source file визначається CLI/config і перевіряється hash;
- Python dependencies pinned у machine-readable lock/requirements із documented installation path;
- Node version зафіксована `.nvmrc`, `.node-version`, `mise.toml` або еквівалентом;
- ESPHome/PlatformIO/ESP-IDF versions machine-readable;
- runner перевіряє versions і відмовляється або явно позначає unsupported toolchain;
- жодного `pip install --user` як частини production procedure.

### 8.5. Immutable external component

Замінити mutable `github://syssi/esphome-jk-bms@main` на exact tested commit/tag, який відповідає evidence snapshot. Після зміни виконати config/compile і зафіксувати resolved revision.

## 9. Фаза 5 — exact mapping

Заміни substring/regex-presence перевірку структурним або generated mapping.

Допустимі підходи:

- generated marker-delimited declarative metadata blocks у YAML/JS;
- custom YAML loader, що підтримує ESPHome tags і зберігає line locators;
- explicit mapping manifest, згенерований разом із YAML entity declarations;
- комбінація цих підходів.

Обов’язково доведи для кожного implemented field:

- exact YAML entity block;
- address/base address;
- register count/response size;
- byte offset/mask/shift;
- value type/signedness;
- scale/offset/unit;
- read/decode path;
- write/encode path;
- entity IDs і wire IDs;
- frontend metadata;
- mock metadata;
- effective write policy.

Коментар, інша entity з тією самою адресою або address string в іншому місці не повинні задовольняти перевірку.

Generated frontend/C++ artifacts мають або реально споживатися, або бути видалені як оманливі non-runtime outputs. Не генеруй артефакт лише заради звіту.

## 10. Фаза 6 — повний validator і mutation suite

Закрий усі пропуски, доведені незалежним аудитом.

### 10.1. Обов’язкові нові semantic rules

- `field_width_bits <= register_width_bits` навіть без mask;
- byte offset і shifted field range у межах register;
- exact word/payload byte geometry;
- non-zero scale недостатньо: scale/offset звіряються з claim matrix;
- precision узгоджена зі scale і step;
- min/max/step inverse-transform дають representable та допустимі raw values;
- enum raw keys мають правильний numeric type і representable range;
- enum aliases/reserved/unknown policy повні;
- UI order має uniqueness і заявлену gap policy;
- natural numeric order;
- exact field locator;
- source hash/revision equality;
- claim type дозволений `claims_supported` source;
- verification status дорівнює заново обчисленому verdict;
- effective access дорівнює derived write policy;
- dataset classification;
- all ID namespaces and alias ownership;
- source-only register cannot disappear;
- generated manifest covers every derived artifact.

### 10.2. Обов’язкові mutation tests

Реалізуй окремий adversarial test для кожного класу:

1. wrong word count;
2. wrong payload byte length;
3. duplicate address/register ID mismatch;
4. field width larger than register;
5. field mask/offset outside register;
6. overlapping fields;
7. uncovered non-reserved bits;
8. endian drift;
9. word-order drift;
10. non-zero scale drift;
11. offset drift;
12. canonical/display unit drift;
13. invalid step;
14. precision mismatch;
15. nonrepresentable bound;
16. enum key out of raw range;
17. duplicate enum value;
18. reserved enum collision;
19. missing unknown-code policy;
20. wrong declared/effective access;
21. blocked field leaked into any write path;
22. UI order duplicate;
23. UI order gap policy violation;
24. natural cell/resistance order regression;
25. internal/wire/frontend/mock ID collision;
26. wrong dataset classification;
27. false source ID;
28. false workbook address;
29. false workbook row/cell locator;
30. false upstream line locator;
31. unsupported claim type for source;
32. bad workbook hash;
33. bad upstream hash;
34. stale upstream revision;
35. unknown provenance counted independent;
36. derivative sources double-counted;
37. forged verification status;
38. forged effective RW policy;
39. source-only register silently dropped;
40. YAML address mapping drift;
41. YAML scale/offset drift;
42. YAML unit drift;
43. YAML write-transform drift;
44. frontend metadata drift;
45. mock metadata drift;
46. unverified enum rendered writable;
47. synthetic secret leak;
48. self-excluding secret scanner;
49. partial generated artifact set;
50. manifest metadata corruption;
51. crash/failure during N-th publish operation;
52. concurrent generator invocation;
53. RCV/RFV duplicate owner;
54. blocked endpoint returns false success;
55. mutable external component revision.

Кожен mutant повинен:

- стартувати з valid baseline;
- змінювати одну умову;
- завершуватися non-zero;
- повертати стабільний diagnostic code;
- доводити, що саме ця мутація спричинила failure.

Не зараховуй positive check як negative fixture.

## 11. Фаза 7 — generation publication і runner

### 11.1. Справжня recoverability/atomicity

Послідовні `rename` без rollback не називай атомарністю.

Реалізуй один із безпечних варіантів:

- immutable generation directory + atomically switched `current` pointer, а consumers читають тільки active generation;
- journaled publish із backups, fsync, rollback і lock;
- інший доведений механізм, за якого consumer не приймає mixed generation.

Обов’язково:

- process lock;
- crash injection перед і після кожного publish step;
- rollback/recovery test;
- concurrent invocation test;
- manifest written and verified as part of the same publication contract;
- full manifest equality check, не лише `file_hashes`;
- correct distinction between hash of full `jk_bms.js` і generated block hash.

### 11.2. Немутуючий test runner

`test/run_all.sh` не повинен змінювати real repo files.

- atomicity tests працюють у temp clone/worktree або через configurable output root;
- generator write tests не пишуть у source tree;
- `mktemp -d` + cleanup trap;
- реалізований suite timeout;
- child server teardown;
- port collision handling;
- before/after comparison для staged, unstaged і untracked state;
- forced interruption test доводить cleanup;
- suite придатний для read-only mounted source tree з writable temp directory.

## 12. Фаза 8 — version context і документація

Виправ version model:

- ESPHome project version = фактичне значення `project.version` із YAML;
- UI version = `UI_VERSION`;
- ESPHome framework version = pinned/verified toolchain value;
- external component revision = immutable resolved commit;
- BMS model identity = окремо;
- BMS protocol variant = unknown, доки немає доказу;
- BMS firmware version = unknown, доки немає доказу;
- UART protocol/library version = окремий observed field, не автоматично firmware version.

Validator повинен звіряти project/UI/external-component versions із реальними source locators, а не лише блокувати два відомі bad strings.

Виправ stale/contradictory тексти:

- reconciliation report note;
- `build_seed.py` comments або сам script;
- ADR;
- audits;
- readiness report;
- open issues;
- hardware checklist.

Історичні audits не переписуй без позначення superseded. Створи новий `STAGE_1_COMPLETION_AUDIT.md`.

## 13. Обов’язкова фінальна перевірка

Запусти й наведи exact commands, versions, exit codes та counts:

1. security scan з synthetic positive/negative fixtures;
2. evidence manifest schema/FK validation;
3. source hash/revision verification;
4. workbook claim index build/check;
5. upstream claim index build/check;
6. implementation structured mapping build/check;
7. hardware evidence document locator/hash check;
8. provenance/independence validation;
9. reconciliation і derived verification policy;
10. schema validation;
11. full semantic validation;
12. усі 55 mutation classes;
13. protocol pipeline deterministic build twice у temp;
14. pipeline `--check` у read-only source tree;
15. failure injection для кожного publish boundary;
16. concurrent generator test;
17. runner interruption/cleanup test;
18. C++ write-transaction tests;
19. history tests;
20. packed codec tests;
21. exact YAML/frontend/mock mapping tests;
22. blocked direct-endpoint tests;
23. RCV/RFV live-update/alias tests;
24. topology integration tests;
25. JS syntax tests;
26. `git diff --check`;
27. before/after full Git state comparison;
28. ESPHome config;
29. ESPHome compile з immutable external component;
30. read-only demo UI smoke test для settings/read-only rows, якщо browser environment доступний.

Не запускай real hardware writes. Hardware test, який потребує запису, познач `NOT EXECUTED — REQUIRES EXPLICIT HARDWARE AUTHORIZATION`.

## 14. Exit gates

### 14.1. Software infrastructure readiness = PASS лише якщо

- security incident cleanup завершено;
- claim-level evidence реалізовано;
- source independence не завищується;
- write policy derived і fail-closed;
- blocked backend endpoints реально відхиляються/відсутні;
- ID collision усунено;
- один portable deterministic pipeline;
- exact mapping;
- 55/55 mutation classes PASS;
- generator recoverable/consumer-safe;
- test runner не змінює repo;
- toolchain та external component immutable;
- full suite і compile PASS;
- документація відповідає фактам.

### 14.2. Protocol evidence completeness

Якщо офіційної документації або exact BMS variant evidence немає, статус може залишатися `BLOCKED_EXTERNAL_EVIDENCE`. Це не виправдовує software FAIL.

Не вигадуй джерело і не підвищуй confidence. Чітко відокрем:

- software infrastructure readiness;
- read catalog readiness;
- write catalog readiness;
- protocol evidence completeness;
- hardware validation readiness;
- overall Stage 1 status.

### 14.3. Перехід до Етапу 2

Не дозволений, якщо:

- software infrastructure не PASS;
- хоча б один недостатньо підтверджений write path активний;
- є secret leak;
- exact mapping не доведений;
- ID collision лишилася;
- обов’язковий mutation test відсутній;
- runner або generator змінює repo неконтрольовано;
- compile не відтворюється;
- overall independent audit не PASS.

## 15. Формат `STAGE_1_COMPLETION_AUDIT.md`

Аудит повинен містити:

1. Executive verdict.
2. Baseline branch/HEAD/Git state/tool versions.
3. Security incident result без secret literals.
4. Повний список змінених/створених/видалених файлів.
5. Таблицю кожного дефекту з before/change/test/status.
6. Source manifest і provenance/independence matrix.
7. Claim coverage matrix для кожного field.
8. Counts physical registers/logical fields/read-ready/write-ready/blocked.
9. Список усіх blocked fields із reason codes.
10. Exact mapping coverage YAML/C++/wire/frontend/mock.
11. ID collision proof після виправлення.
12. Version context proof.
13. Pipeline dependency graph.
14. Generator publication/recovery proof.
15. Усі test commands, versions, counts, exit codes.
16. 55-row mutation-test matrix.
17. Git before/after cleanliness proof.
18. ESPHome config/compile result і resolved component revision.
19. Hardware actions: окремо підтвердити, що writes не виконувалися.
20. Residual external blockers.
21. Binary checklist: PASS / FAIL / BLOCKED / NOT EXECUTED.
22. Однозначне рішення щодо Етапу 2.

Для PASS потрібен machine-verifiable evidence. Власне твердження, comment у коді або зелений self-consistency test без adversarial mutation не є достатнім доказом.

## 16. Фінальна відповідь

Після останнього повторного аудиту дай українською:

- фактичний загальний статус;
- software/read/write/evidence/hardware statuses окремо;
- що виправлено;
- скільки полів залишилися write-enabled і чому кожне з них безпечне;
- tests/compile summary;
- security cleanup summary без секретів;
- чи були hardware actions;
- blockers;
- посилання на `STAGE_1_COMPLETION_AUDIT.md`.

Не пиши «Готово», якщо хоча б один обов’язковий software gate не виконано. Не переходь до Етапу 2.

**Остання дія перед фінальною відповіддю — повний аудит уже кінцевого стану, включно з повторним security scan і перевіркою незмінності Git state після test suite.**
