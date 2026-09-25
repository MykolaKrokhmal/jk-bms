> **ARCHIVED — historical record, not current and not an implementation queue.**
> Moved here in the 2026-09-25 repository cleanup (full pre-move state: branch
> `checkpoint/pre-repository-cleanup-2026-09-25`). Paths, counts and statuses
> below reflect the date written. Current state: [PROJECT_STATE](../../project/PROJECT_STATE.md);
> current plan: [RS485_UNIFIED_PARAMETER_PIPELINE_PLAN](../../project/RS485_UNIFIED_PARAMETER_PIPELINE_PLAN.md);
> archive index: [docs/archive/README.md](../README.md).

# Current State Audit — Етап 0 (baseline)

**Дата:** 2026-09-10 (Europe/Kyiv), цей прохід.
**Мета:** незалежно відтворити baseline, зафіксований у вхідному промпті та в
`JK_BMS_CLAUDE_IMPLEMENTATION_AUDIT_2026-09-10.md`, а не прийняти його на
віру. Кожен рядок нижче — це `claim → команда/дія → фактичний результат →
статус`. Жодне твердження не спирається на власний попередній звіт цієї
сесії.

Source tree під час цього etапу **не редагувався** (Gate 0 вимога) — усі
команди read-only або пишуть лише у тимчасові файли поза репозиторієм
(`/tmp/claude-501/audit0/`).

## 1. Git identity

| Claim | Команда | Результат | Статус |
|---|---|---|---|
| branch `fix/settings-diagnostics-dedup` | `git rev-parse --abbrev-ref HEAD` | `fix/settings-diagnostics-dedup` | PASS |
| HEAD `93b4c1df9003e76072e08915a20614075dac8693` | `git rev-parse HEAD` | `93b4c1df9003e76072e08915a20614075dac8693` | PASS |
| 10 modified tracked files | `git status --porcelain=v1` | Рівно 10 `M` рядків, 0 untracked, 0 staged окремо: `OPEN_ISSUES.md`, `docs/adr/0001-protocol-catalog.md`, `jk_bms.js`, `protocol/generated/.generation-manifest.json`, `protocol/generated/coverage_report.md`, `protocol/registers.canonical.json`, `register_catalog.json`, `test/protocol_catalog/test_blocked_write_surface.js`, `test/protocol_catalog/test_entity_id_collision.js`, `test/protocol_catalog/test_secret_scan.js` | PASS |
| diff stat | `git diff --stat` | `10 files changed, 342 insertions(+), 62 deletions(-)` — точно збігається з незалежним аудитом (§3.1) | PASS |

## 2. Catalog counts (програмний перерахунок)

Команда: `node -e '...'` напряму по `protocol/registers.canonical.json` (без
довіри до жодного markdown-файлу).

| Показник | Заявлено | Фактично | Статус |
|---|---:|---:|---|
| Фізичні регістри | 119 | 119 | PASS |
| Логічні поля | 127 | 127 | PASS |
| Оголошені RW | 46 | 46 | PASS |
| Effective-RW | 18 | 18 | PASS |
| Fail-closed RW | 28 | 28 (7 `unsupported`/NOT_IMPLEMENTED + 21 BLOCKED_CONFLICT) | PASS |
| Усі 18 effective-RW = `implementation_only_unverified` + owner override | — | Перевірено програмно: `verification_status` set = `{implementation_only_unverified}`; усі 18 мають `owner_write_override.authorized === true` | PASS |

## 3. Protocol evidence pipeline

| Claim | Команда | Результат | Статус |
|---|---|---|---|
| Повний pipeline з workbook падає з `IMPLEMENTATION_SOURCE_FINGERPRINT_MISMATCH` | `JK_BMS_WORKBOOK_PATH=.../LiFePO4_BMS_Parameters_registers.xlsx node tools/protocol/pipeline.js check --workbook ...` | stdout: `IMPLEMENTATION_SOURCE_FINGERPRINT_MISMATCH`; **реальний** exit code (не exit code `tail`/pipe) = `1` | PASS (проблема відтворена) |
| `test/run_all.sh` без workbook друкує `All suites passed.`, хоча pipeline `NOT EXECUTED` | `bash test/run_all.sh` (без `JK_BMS_WORKBOOK_PATH`) | Реальний exit=`0`; рядок `NOT EXECUTED — set JK_BMS_WORKBOOK_PATH...` для pipeline-кроку; в кінці `All suites passed.` | PASS (дефект підтверджено — це і є `test/run_all.sh:96` та P1 "Release test runner допускає All suites passed без evidence pipeline") |
| `test/run_all.sh` з workbook: чи теж друкує `All suites passed`? | `JK_BMS_WORKBOOK_PATH=... bash test/run_all.sh` | **Реальний exit=`1`**, скрипт зупиняється рівно на кроці pipeline check (`set -euo pipefail` у `test/run_all.sh:14` коректно перериває виконання) — "All suites passed." **не друкується** у цьому режимі | **УТОЧНЕННЯ до незалежного аудиту**: `run_all.sh`'s "false All suites passed" — це дефект ЛИШЕ без-workbook режиму (pipeline мовчки `NOT EXECUTED`, а фінальний рядок все одно звучить як повний success). При наявності workbook скрипт коректно fail-closed завершується з exit 1 і НЕ друкує "All suites passed" — незалежний аудит не стверджував протилежного прямо, але варто зафіксувати цю різницю явно для Етапу 1 |

## 4. ESPHome build (щойно, цей прохід)

| Показник | Незалежний аудит (§3.2) | Цей прохід | Збіг |
|---|---|---|---|
| ESPHome | 2026.8.2 | 2026.8.2 | так |
| ESP-IDF | 5.5.5 | 5.5.5 | так |
| config_hash | `0x57e41d84` | **`0xe8f5a0d5`** | **НІ** — інший |
| RAM | не вказано в цьому полі промпту (independent audit цитує з іншого проходу `51.4%`) | 51.4% (92824/180736 B) | — |
| Flash | — | 61.4% (1127099/1835008 B) | — |
| `total_runtime` null-address warning | присутній | **присутній**, той самий рядок (`batterylifepo4.yaml:4980:11`, `-Waddress`) | так |
| Успішна компіляція | так | так, `Successfully compiled program.` | так |

**Пояснення розбіжності config_hash**: очікувано. `config_hash` — детермінована
похідна від вмісту `batterylifepo4.yaml`/C++ codegen. Між знімком
незалежного аудиту (`0x57e41d84`, зафіксований до якогось із проходів цієї
сесії) і зараз відбулись реальні зміни `batterylifepo4.yaml` й
`components/jk_write_tx/jk_write_tx_core.h` (generation-token, WRITE_UNCERTAIN
recovery, REJECTED ring buffer — усі три вже в поточному diff відносно
HEAD). Різний hash — очікуваний, коректний наслідок, не аномалія.

Артефакти (SHA-256, зібрано щойно):

```text
firmware.factory.bin  1ff54081f599e193c1665f1edd40f8c086578beb3a1632e4fa3efd4f2c8adbd6
firmware.ota.bin      5ce45bf1ed73184beac9ea47f8fe950d6248904be1c038939e65cdb0937efe71
jk-bms.bin             5ce45bf1ed73184beac9ea47f8fe950d6248904be1c038939e65cdb0937efe71
```

Build виконано з audit-only placeholder secrets (не реальні credentials, не
записані нікуди за межі тимчасового shell env цього виклику). Цей артефакт
**не придатний для прошивки production-пристрою**.

## 5. Automated test suites (цей прохід, реальні exit codes)

| Suite | Команда | Результат |
|---|---|---|
| C++ transaction core | `g++ ... test_jk_write_tx_core.cpp && run` | **63/63 PASS** |
| `test/run_all.sh` (no workbook) | — | реальний exit=0, "All suites passed." (76/76 topology, 98/98 blocked-write-surface, 16/16 entity-collision, 171/171 validate.js, 110/110 negative fixtures, 31/31 generation atomicity, secret-scan PASS — усі суб-suite числа незмінні відносно попереднього стану цієї сесії, перевірено повторним запуском, не взято з пам'яті) |
| `test/run_all.sh` (with workbook) | — | реальний exit=1, зупиняється на pipeline check (див. §3) |
| ESPHome config | `esphome config batterylifepo4.yaml` (placeholder secrets) | `Configuration is valid!` |
| ESPHome compile | `esphome compile batterylifepo4.yaml` | `Successfully compiled program.`, config_hash `0xe8f5a0d5` |

## 6. Browser/demo verification (Browser pane, живий demo mock-сервер)

### 6.1. `control_override_reason` Settings-leak — **НОВИЙ, ПІДТВЕРДЖЕНИЙ дефект**

Незалежний аудит (§8.2) стверджує: `registerEntity("control_override_reason", ...)`
додано в попередньому проході цієї сесії, але ключ не додано у
`protocol/non_register_entities.canonical.json`, тому він не потрапляє у
`PROTOCOL_CATALOG.nonRegisterKeys`, і як наслідок — не виключається зі
Settings.

Перевірено напряму (не через DOM, через статичний код — і додатково
підтверджено відсутністю рядка в живому Diagnostics dump, див. §6.2):

```js
grep control_override_reason protocol/non_register_entities.canonical.json
// exit code 1 — рядка немає

PROTOCOL_CATALOG.nonRegisterKeys.includes("control_override_reason") === false
```

**Статус: PASS (дефект підтверджений, реальний, це регресія самого Claude з
попереднього проходу цієї ж сесії — P1-04 знову відкрита для цього одного
ключа).**

### 6.2. Diagnostics — стара семантика (заголовки, raw коди, дублікати)

Жива перевірка вкладки «Діагностика» проти демо (localhost, Browser pane),
повний `get_page_text()`:

| Claim незалежного аудиту | Підтверджено live |
|---|---|
| Заголовок `ЗНАЧЕННЯ ПАРАМЕТРІВ BMS` | **так**, присутній дослівно |
| Caption `Фактично отримано від ESPHome` | **так**, присутній дослівно |
| Raw enum `CONFIRMED` (topology_state) | **так** — `Стан топології: CONFIRMED` (не локалізовано) |
| Raw reason `OK` (topology_reason) | **так** — `Причина стану топології: OK` |
| Raw unformatted seconds замість тривалості | **так** — `Тривалість стану: 63`, `Тривалість фази: 63`, `Тривалість стану заряду: 5486`, і другий `Час роботи: 367920` (замість "1 хв 3 с" формату) |
| Дублікат `Час роботи` (3 входження) | **так** — раз у верхній картці (`102 г 12 хв 0 с`, system_uptime), раз у списку як `runtime` (`4d 6h 12m`), раз як raw `battery_state_time` (`367920`) |
| Дублікат IP-адреси (2 входження) | **так** |
| Дублікат Wi-Fi рівня (2 входження, з різним форматуванням `Wi-Fi`/`Wi‑Fi`) | **так** |
| `control_override_reason` **відсутній** у Diagnostics (бо неправильно класифікований у Settings) | **так**, підтверджено відсутністю в повному dump |

**Статус: PASS (усі перелічені claims незалежного аудиту підтверджено
живою перевіркою в цьому проході, не взято на віру).**

### 6.3. `smart_sleep` mock write→readback — **НЕ ВІДТВОРЕНО, розбіжність із незалежним аудитом**

Незалежний аудит (§6) стверджує сценарій:
`3.500 → введено 3.501 → ✓ → UI повертається до 3.5`.

Відтворено буквально (той самий field, ті самі значення), тричі:

1. `reg_smart_sleep`: `3.500` → typed `3.501` → click OK → через 3с
   `value="3.501"`, через 8с (два+ poll-цикли) `value="3.501"`, `dirty=false`.
2. Reload сторінки (нове SSE-з'єднання, новий client) — `reg_smart_sleep`
   показує `3.501` (сервер-side стан справді змінився, не client-side
   ілюзія).
3. Другий незалежний write: `3.501 → 3.502` → через 4с `value="3.502"`,
   `dirty=false`, без `invalid` класу.

Статичний аналіз коду підтверджує ЧОМУ: `demo/mock-server.js:1135`
обчислює `wireId` як `entities["number-set_smart_sleep"]`, якщо ця
сутність існує, інакше `sensor-${targetObjectId}`. Перевірено:
`entities["number-set_smart_sleep"]` **не існує** в mock — жодна лінія
`setEntity("number-set_smart_sleep", ...)` в demo/mock-server.js. Отже
`wireId` фактично резолвиться в `sensor-smart_sleep` — ТУ САМУ сутність,
яку читає UI. Генерик write-транзакція публікує підтверджене значення
саме туди.

**Статус: FAIL щодо самого відтворення незалежного аудиту — конкретний
описаний баг не підтверджується в поточному стані repository.** Це НЕ
означає "clean" — це задокументована, чесна розбіжність, яку Етап 2
повинен або (a) пояснити (можливо, аудит фіксував стан ДО якогось фіксу
цієї сесії), або (b) знайти інший, досі не виявлений сценарій, де
readback справді розходиться (наприклад, інше поле, інший `writeMode`,
race з `mismatch`/`timeout` сценарієм — не перевірено цим проходом).
Незалежно від причини, Етап 2 цього промпту (правдива mock-модель,
invariant tests) виконується повністю, а не скорочується через цю
розбіжність.

## 7. Документація — застарілість (підтверджено)

| Файл | Claim | Перевірено |
|---|---|---|
| `docs/AUTH_AND_HISTORY.md` | Досі описує Basic auth / ESPHome 2026.6.5 | **так** — рядок 39-42: "this ESPHome version — 2026.6.5 ... Digest is not available here, so this is Basic auth" — production YAML фактично використовує Digest/2026.8.2 |
| `FINAL_READINESS_REPORT.md` | Старий config_hash | **так** — `0xc0614563`, не збігається з жодним свіжим build |
| `HARDWARE_VALIDATION_CHECKLIST.md` | Старий config_hash | **так** — `0xaf454b9d`, третє різне значення |
| `docs/AUTH_AND_HISTORY.md` | history persistence не в production | **так** — `jk_history:` блок відсутній у `batterylifepo4.yaml` (перевірено grep) |

## 8. Розбіжності між цим проходом і вхідним промптом/незалежним аудитом — зведення

1. **config_hash**: аудит цитує `0x57e41d84`; зараз `0xe8f5a0d5`. Пояснено
   реальними змінами `batterylifepo4.yaml`/`jk_write_tx_core.h` між
   знімками. Не аномалія.
2. **`test/run_all.sh` "All suites passed" з workbook**: підтверджено, що
   в режимі З workbook скрипт коректно НЕ друкує цей рядок (fail-closed
   спрацьовує). Дефект існує лише в без-workbook режимі. Уточнення для
   Етапу 1.
3. **`smart_sleep` readback bug**: НЕ відтворено емпірично в поточному
   стані, на відміну від явного твердження незалежного аудиту. Задокумен-
   товано як відкрите питання для Етапу 2, не приховано і не "виправлено
   тихцем" без пояснення.
4. **`control_override_reason` Settings-leak**: НОВИЙ, підтверджений,
   раніше не зафіксований у жодному з файлів openissues.md цієї сесії
   (це регресія, внесена в межах цієї ж сесії, не зафіксована в
   `OPEN_ISSUES.md`). Додається як окремий пункт для Етапу 5.

## 9. Інструменти/версії (для розділу 8.1 фінального аудиту пізніше)

```text
node --version           → v24.2.0 (.node-version: 24.2.0, збіг)
python3 --version        → Python 3.9.6 (системний; ESPHome використовує окремий venv, python 3.12)
esphome --version         → 2026.8.2
ESP-IDF                   → 5.5.5
```

## 10. Gate 0 — перевірка виконання

| Вимога Gate 0 | Статус |
|---|---|
| Baseline повністю відтворений | PASS — усі числові/git claims підтверджено §1-2 |
| Кожна запущена команда має exit code | PASS — реальні exit codes зафіксовані окремо від `tail`/pipe artifacts |
| Немає тверджень, заснованих лише на документації | PASS — кожен claim або підтверджено командою/live-перевіркою, або позначено як розбіжність |
| Усі розбіжності між документацією й runtime перелічені | PASS — розділ 7-8 |
| Source tree не змінений до завершення baseline capture | PASS — `git status` не змінювався протягом цього етапу (перевірено повторно наприкінці) |

**Gate 0: PASS.**
