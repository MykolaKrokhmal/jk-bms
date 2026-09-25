> **ARCHIVED — historical record, not current and not an implementation queue.**
> Moved here in the 2026-09-25 repository cleanup (full pre-move state: branch
> `checkpoint/pre-repository-cleanup-2026-09-25`). Paths, counts and statuses
> below reflect the date written. Current state: [PROJECT_STATE](../../project/PROJECT_STATE.md);
> current plan: [RS485_UNIFIED_PARAMETER_PIPELINE_PLAN](../../project/RS485_UNIFIED_PARAMETER_PIPELINE_PLAN.md);
> archive index: [docs/archive/README.md](../README.md).

# Незалежний аудит результату Stage 1 Remediation від Claude

Дата: 2026-09-09  
Репозиторій: JK BMS Web UI для ESP32 + ESPHome  
Перевірений branch: `fix/settings-diagnostics-dedup`  
Перевірений HEAD: `ab9f294a798210f058ae8f7a987cfb428e0eba3c`

## 1. Вердикт

Результат є помітним технічним покращенням, але його не можна приймати як завершений коригувальний прохід Етапу 1.

**Фактичний статус: NOT READY.**

Причина не обмежується відсутністю офіційної документації JK. У реалізації залишилися програмно усувні дефекти, зокрема один критичний витік секретів, недоказова модель evidence, хибна оцінка write safety, невиправлена ID-колізія, неатомарна генерація, неповний pipeline і 11 невиконаних або лише позитивно перевірених mutation-класів.

Твердження аудиту Claude `Software infrastructure readiness: PASS` не відповідає фактичному стану. Для software infrastructure правильний статус — **FAIL**, доки не усунуто P0/P1 дефекти цього документа.

## 2. Що справді виправлено

1. Геометрію 128-бітних `setup_passcode` і `device_model` виправлено до 8 Modbus-слів.
2. Адреси `0x12A4`, `0x12E6`, `0x12F8` більше не отримують неправдиве workbook evidence.
3. `0x12E4` правильно знайдено в workbook у рядку 127.
4. Помилковий BMS `firmware_scope: v3.0.0` прибрано з регістрів.
5. Сім невизначених LCD/DRY полів виключено з generated generic write-map і позначено read-only у UI.
6. Додано кілька важливих geometry/numeric/enum/policy checks.
7. Розширено negative fixtures.
8. C++ test binaries перенесено до тимчасової директорії.
9. Upstream snapshot прив’язано до конкретного commit SHA.
10. Workbook index відтворює підтверджені незалежною перевіркою показники: 129 рядків, 117 рядків з адресним полем, 113 унікальних адрес.

Ці зміни треба зберегти, але допрацювати їхню архітектуру та доказовість.

## 3. Незалежно виконані перевірки

| Перевірка | Результат |
|---|---:|
| `node tools/protocol/generate.js --check` | PASS |
| `node test/register_catalog/validate.js` | 189/189 PASS |
| `node test/protocol_catalog/test_negative_fixtures.js` | 70/70 PASS |
| `node test/protocol_catalog/test_entity_id_collision.js` | 5/5 PASS, але тест доводить наявність дефекту |
| `node test/protocol_catalog/test_secret_scan.js` | 3/3 PASS, але тест виключає файл, що містить реальні секрети |
| `git diff --check` | PASS |
| Незалежна read-only перевірка workbook SHA/count/address set | PASS |

Повний `test/run_all.sh` навмисно не запускався під час незалежного аудиту: `test_generation_atomicity.js`, який входить до suite, змінює реальні файли репозиторію та запускає генератор у write-mode. Для read-only аудиту це неприпустимо і саме по собі є дефектом runner.

## 4. Критичні дефекти

### P0-1. Secret scan сам записав реальні облікові дані до репозиторію

`test/protocol_catalog/test_secret_scan.js` містить два реальні credential fragments, після чого спеціально виключає власний файл зі сканування. Через це тест повідомляє PASS, хоча секрет уже присутній у файлі тесту.

Додатково scan roots не охоплюють увесь репозиторій. Зокрема не скануються основний YAML, основний frontend JS, demo, hardware audit, readiness reports та інші потенційні місця витоку.

Це не просто слабкий тест. Це security incident у робочому дереві.

Обов’язкові дії:

- негайно видалити реальні значення з тесту й усіх generated/log/report artifacts;
- не повторювати значення в аудиті, diff summary або console output;
- замінити exact-secret allowlist на generic detection і, за потреби, зовнішні неперсистентні fingerprints;
- сканувати весь релевантний tracked/untracked text set, включно із самим scanner;
- перевірити Git history/index, якщо файл був staged або committed;
- рекомендувати користувачу ротацію облікових даних, але не виконувати її без прямого дозволу.

### P0-2. `confirmed` не означає підтвердження небезпечних write claims

Поточна модель evidence переважно доводить лише наявність адреси в workbook/upstream. Вона не доводить для кожного field:

- register width і word count;
- field width/mask/shift/byte order/word order;
- signedness і wire type;
- scale/offset/unit;
- raw encode/write transform;
- allowed range/step/reserved values;
- RW semantics і функцію запису;
- packed read-modify-write atomicity;
- applicability до exact BMS variant.

Незважаючи на це, 39 полів залишаються `effective_access: rw`. Два heating-поля мають лише `corroborated_with_limitations`, але все одно write-enabled. Інші 37 отримують `confirmed` на підставі груп джерел, чия незалежність та claim coverage не доведені.

Для безпечної системи запис має бути fail-closed: відсутність підтвердження будь-якого safety-critical write claim повинна автоматично давати `effective_access: r`.

### P0-3. Незалежність джерел пораховано без доказу

- Provenance workbook прямо позначено як невідоме, але його рахують незалежним від upstream/current implementation.
- Поточна реалізація залежить від `syssi/esphome-jk-bms`, тому implementation і upstream не можна автоматично вважати незалежними.
- Hardware audit спостерігає вже декодовані API/SSE entities, а не raw Modbus frames. Він може підтвердити поведінку deployment і plausibility, але не незалежно довести address/scale mapping, який створила та сама implementation.

Тому поточні 110 `confirmed` є завищеною оцінкою.

### P0-4. Сім «заблокованих» endpoint-ів не відхиляють команду на backend-рівні

У YAML поля залишаються `number` entities із публічними `/number/.../set` endpoint-ами. Їхній `set_action` замінено на no-op logging. Це захищає від Modbus write, але HTTP/API command може бути прийнята як успішна без реального застосування.

Вимога end-to-end блокування означає:

- write endpoint відсутній; або
- backend явно повертає rejection/non-success;
- жодна UI, direct HTTP, API або internal invocation не отримує false success.

У `jk_bms.js` також залишилися stale `SETTING_DEFS` із write endpoint-ами. UI-гейт робить їх недоступними у звичайному rendering path, але це не є authoritative backend policy.

### P0-5. ID-колізію не виправлено

`test_entity_id_collision.js` проходить саме тоді, коли `sensor-cell_rcv` і `sensor-cell_rfv` продовжують резолвитися до пізнішої реєстрації, а `cell_request_charge_voltage` / `cell_request_float_voltage` можуть не отримувати live updates.

Тест, який фіксує наявність дефекту, не є «формальним керуванням» дефектом. Колізію треба усунути або реалізувати реальний backward-compatible alias fan-out із тестами обох споживачів.

## 5. Високопріоритетні дефекти evidence і pipeline

### P1-1. Evidence manifest фактично не керує evidence

`sources.json` заявляє, що всі citations використовують його `source_id`, але canonical evidence використовує інші короткі значення: `implementation`, `workbook`, `upstream_reference`, `hardware_read`.

`semantic-checks.js` не завантажує `sources.json`. `reconcile_evidence.py` завантажує його у змінну, але не використовує для derivation; independence groups визначаються окремим hardcoded mapping.

Отже, manifest зараз декларативний текст, а не foreign-keyed source of truth.

### P1-2. Exact locator не перевіряється

Валідатор перевіряє лише факт наявності адреси в address index. Він не перевіряє:

- що `row 127` справді існує у locator;
- що locator відповідає конкретному field/byte qualifier;
- що label/value/access у locator збігаються з index;
- що exact upstream line належить потрібному field claim;
- що source підтримує claim type, який йому приписано.

In-memory mutation `workbook locator -> row 999999` пройшла semantic validation без помилки.

### P1-3. Indexes є address indexes, а не claim indexes

Workbook і upstream indexers витягують address presence і текст рядка. Вони не нормалізують та не порівнюють повний набір protocol claims. Для packed register рядок без qualifier може бути автоматично застосований до всіх sibling fields.

`claims_supported` у `sources.json` ширші за фактичну структуру index-файлів. Наприклад, upstream оголошує scale/unit/access support, але validator не звіряє ці значення з canonical field.

### P1-4. Verification status не є повністю детермінованим

`reconcile_evidence.py` зберігає попередній `conflict` вручну, а не виводить його з normalized conflicting claims. Це означає, що status залежить від старого значення canonical file.

Підроблений `verification_status: confirmed` із лише implementation evidence проходить semantic validation.

### P1-5. Hardware evidence є ручним allowlist без exact raw evidence

`HARDWARE_READ_ELIGIBLE` вручну перелічує fields і додає однаковий locator до runtime-snapshot table. Немає hash документа, exact row/range, raw register request/response frame або machine-readable field capture.

Такий evidence не може підтверджувати address, width, signedness, scale або RW. Він може підтверджувати лише спостережений entity value/behavior у конкретному deployment.

### P1-6. Implementation index не доводить implementation mapping

`build_implementation_index.py` regex-ом знаходить лише literal `address:` keys. Він не пов’язує адресу з entity ID, register count, response size, type, lambda decode, scale, unit або write action.

Для block-read fields reconciler підставляє загальну фразу про documented multi-register block. Це не exact locator.

`build_reconciliation_report.py` завантажує `implementation_index.json`, але не використовує його для множини implementation. Замість цього catalog set називається implementation set, хоча це різні поняття.

### P1-7. Один відтворюваний pipeline відсутній

Є щонайменше чотири окремі write-процеси:

1. `build_seed.py` перезаписує canonical files;
2. index builders перезаписують evidence indexes;
3. `reconcile_evidence.py` повторно змінює canonical file;
4. `generate.js` пише runtime/generated artifacts.

`test/run_all.sh` не запускає index builders, reconciliation або їхній `--check`. `generate.js --check` не виявляє stale evidence indexes і stale reconciliation report.

`build_seed.py` названо «one-time», але він залишається executable та містить застарілі ручні evidence tuples і фактично хибне твердження про відсутність `project.version`.

### P1-8. Absolute workbook path робить pipeline непереносним

`build_workbook_index.py` жорстко фіксує локальний шлях користувача. Source identity має визначатися hash/source ID, а шлях повинен передаватися аргументом або environment variable без потрапляння персонального home path у canonical artifacts.

Залежність `openpyxl` також не зафіксована machine-readably. Порада `pip install --user` не є відтворюваним toolchain.

## 6. Дефекти versioning, generator і runner

### P1-9. Version context знову містить фактичну помилку

Canonical catalog стверджує, що `batterylifepo4.yaml` не має `project.version`. Насправді YAML містить:

```yaml
project:
  name: "syssi.esphome-jk-bms"
  version: 3.0.0
```

Правильне виправлення: зберегти `3.0.0` як ESPHome project version, але ніколи не використовувати його як BMS firmware version.

### P1-10. Реальний build усе ще залежить від mutable `@main`

Evidence snapshot pinned до commit, але `external_components_source` у firmware YAML залишається `github://syssi/esphome-jk-bms@main`. Тому compile сьогодні й наступний compile можуть використовувати різний component code, не тотожний evidence snapshot.

### P1-11. Generation manifest неповний

Manifest не охоплює:

- evidence source manifest;
- workbook/upstream/implementation indexes;
- reconciliation report;
- reconciliation algorithm/version;
- toolchain/dependency versions.

`--check` порівнює лише `file_hashes`, але не перевіряє повну тотожність `generation_id`, `catalog_version` і `source_hash`. Label `jk_bms.js (generated block only)` фактично містить hash усього JS-файлу.

### P1-12. Генерація не є атомарною

Файли stage-яться, але потім перейменовуються послідовно без lock, rollback або atomic current-generation pointer. Crash між `rename` залишає mixed state. Аудит Claude сам визнає це.

Тест atomicity не інжектує failure між rename operations. Він лише:

- навмисно псує один уже згенерований файл;
- видаляє manifest;
- перевіряє, що наступний `--check` помічає пошкодження.

Це тест post-failure detection, а не atomic publication.

### P1-13. Test runner не є read-only/clean-safe

`test_generation_atomicity.js` змінює справжні файли репозиторію і запускає generator у write-mode. `finally` не захищає від process kill, machine crash або filesystem failure.

`test/run_all.sh` заявляє overall timeout, але не реалізує його. Cleanliness section перевіряє лише untracked files і не доводить незмінність modified/staged files.

### P1-14. Toolchain не відтворюваний

Node лише recorded, не pinned. Python/openpyxl не pinned. ESPHome virtual environment згадується через ephemeral `/private/tmp` path. Це не дозволяє повторити 487 checks в іншому чистому середовищі з тим самим toolchain.

## 7. Доведені пропуски валідатора

Незалежний in-memory mutation-аудит показав, що всі наведені мутації проходять із нульовою кількістю semantic errors:

1. non-zero scale drift;
2. precision drift;
3. `field_width_bits` більше за `register_width_bits` для unmasked field;
4. enum raw key поза representable range;
5. fabricated workbook row locator;
6. forged `verification_status: confirmed` без достатнього evidence.

Додатково в аудиті Claude чесно зазначено, що 11 із 30 обов’язкових класів не мають негативного доказу або покриті лише позитивною перевіркою. Тому критерій `Full semantic validator` не може мати PASS.

## 8. Внутрішні суперечності звіту Claude

1. `Software infrastructure readiness: PASS`, хоча критерії exact mapping і negative coverage мають BLOCKED.
2. «Усі 16 дефектів закриті або керовані», хоча generated consumers не підключені, exact mapping не реалізовано, ID collision існує, 11 mutation classes не виконано.
3. `set_action removed`, хоча фактично встановлено no-op `set_action`.
4. `full end-to-end blocked`, хоча public set endpoints можуть приймати команду без явної відмови.
5. `verification status computed deterministically`, хоча conflict status успадковується вручну.
6. `sources.json resolves citations`, хоча validator його не завантажує.
7. `exact evidence references`, хоча перевіряється лише address presence.
8. `atomic generation`, хоча забезпечено лише подальше виявлення mixed state.
9. `entity collision formally managed`, хоча тест вимагає, щоб дефект залишався.
10. `esphome_project_version: unknown`, хоча YAML явно задає `3.0.0`.
11. Generated reconciliation note стверджує, що source-only addresses не додані, тоді як counts і audit стверджують, що їх додано.

## 9. Рекомендований наступний крок

Виконати **Stage 1 Completion Pass** за файлом `CLAUDE_STAGE_1_COMPLETION_PASS_PROMPT_UA.md`.

Порядок пріоритетів:

1. Security cleanup без повторного розкриття секретів.
2. Claim-level evidence та коректна provenance/independence model.
3. Fail-closed write policy для всіх недостатньо підтверджених write claims.
4. Реальна backend-відмова для blocked fields.
5. Усунення ID collision.
6. Єдиний deterministic pipeline із portable inputs.
7. Exact mapping та всі missing mutation tests.
8. Справді recoverable/atomic generation і немутуючий runner.
9. Reproducible toolchain та immutable external component.
10. Новий незалежний аудит.

До завершення цих пунктів не переходити до Етапу 2 і не виконувати жодних реальних BMS writes.
