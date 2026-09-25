> **ARCHIVED — historical record, not current and not an implementation queue.**
> Moved here in the 2026-09-25 repository cleanup (full pre-move state: branch
> `checkpoint/pre-repository-cleanup-2026-09-25`). Paths, counts and statuses
> below reflect the date written. Current state: [PROJECT_STATE](../../project/PROJECT_STATE.md);
> current plan: [RS485_UNIFIED_PARAMETER_PIPELINE_PLAN](../../project/RS485_UNIFIED_PARAMETER_PIPELINE_PLAN.md);
> archive index: [docs/archive/README.md](../README.md).

# JK BMS Web UI — правила для агентів

Цей файл містить стабільний контекст і обов'язкові правила роботи. Поточний стан, відкриті дефекти та dirty-tree описані у `PROJECT_STATE.md`; короткий старт для нової сесії — у `HANDOFF.md`.

## Позначення достовірності

У документації й звітах використовуйте такі мітки:

- **VERIFIED** — спостережено або перевірено реальною командою/вимірюванням із зафіксованим результатом.
- **IMPLEMENTED** — присутнє в коді, але повний runtime/hardware доказ може бути відсутній.
- **DECIDED** — явно погоджена вимога або архітектурне рішення.
- **PLANNED** — погоджено, але ще не реалізовано.
- **ASSUMED** — обґрунтоване припущення, яке потребує перевірки.
- **UNKNOWN** — доказів недостатньо.

Не підміняйте одну мітку іншою. Компіляція не є hardware-перевіркою, mock не є RS485, а HTTP 200 не є підтвердженням застосування значення BMS.

## Призначення проєкту

Проєкт — локальний Web UI та ESPHome firmware для моніторингу і безпечного налаштування JK BMS серії JK-PB через ESP32 та Modbus RTU/RS485. Основний розгорнутий пристрій спостерігався як `JK-PB2A16S15P`.

Кінцеві очікування користувача:

- згруповано показувати у «Налаштуваннях» усі параметри актуального протоколу;
- постійно оновлювати R і RW значення; R показувати read-only;
- RW змінювати лише через підтверджену транзакцію write → fresh readback;
- W-команди відокремити як небезпечні сервісні дії;
- кількість комірок, карток, стовпчиків, агрегатів і читань визначати за підтвердженою топологією BMS, без phantom cells;
- у «Діагностиці» тримати тільки похідні ESPHome та ESP32/browser/UI дані, не дублікати регістрів BMS;
- забезпечити українську й англійську локалізацію, коректні одиниці та мобільний UI;
- не називати систему «Готово» без автоматичних, hardware, fault-injection, persistence, security і soak доказів.

## Архітектура

### Runtime data flow

1. JK BMS відповідає ESP32 через RS485/Modbus RTU.
2. `batterylifepo4.yaml` описує ESPHome entities, polling, декодування, topology resolver, історію в RAM і backend write logic.
3. `jk_bms.js` та `jk_bms.css` вбудовуються в ESPHome web server і є production frontend без окремого build-step.
4. ESPHome надсилає entity updates через SSE `/events`; UI не повинен вводити паралельний агресивний polling для live даних.
5. Write UI викликає ESPHome HTTP endpoints; backend snapshot повідомляє стадії транзакції. Поточний стандартний endpoint не повертає exact `tx_id`, тому строгий request↔transaction контракт ще не завершений.
6. `demo/mock-server.js` запускає справжні production JS/CSS проти mock HTTP/SSE backend. Він корисний для UI/integration, але не доводить роботу Modbus/RS485.

Схеми поточного data flow і transaction state machine є у `docs/ARCHITECTURE.md`.

### Protocol/evidence flow

Поточний перехідний стан має дві моделі:

- стара canonical-модель: `protocol/registers.canonical.json` + `protocol/non_register_entities.canonical.json`, з якої `tools/protocol/generate.js` формує `register_catalog.json`, generated block у `jk_bms.js` та звіти;
- нова нормативна V2-модель: офіційний `protocol/evidence/BMS_RS485_Modbus_V1.1.pdf` плюс `protocol/evidence/LiFePO4_BMS_Parameters_registers-V2_verified.xlsx`, з яких `build_v2_manifest.py` створює `protocol/generated/bms_v1_1_manifest.json`, а `build_v2_gap_audit.js` — gap audit.

**DECIDED:** V2 workbook і офіційний PDF є основою майбутнього єдиного каталогу. Старий V1 workbook/pipeline не можна вважати остаточним source of truth. Поки міграцію не завершено, не видавайте стару canonical-модель за повне покриття протоколу.

### Write transaction manager

`components/jk_write_tx/jk_write_tx_core.h` — host-testable C++ state machine для generic RW. Відомі стани: `IDLE`, `SENDING`, `ACK_WAIT`, `READBACK_WAIT`, `CONFIRMED`, `MISMATCH`, `WRITE_UNCERTAIN`, `ACK_TIMEOUT`, `READBACK_TIMEOUT`, `REJECTED`, `RECOVERED_CONFIRMED`, `RECOVERED_MISMATCH`.

Поточні safety invariants:

- один незавершений write на адресу; конфліктний write відхиляється;
- callback перевіряє slot/generation/tx/address перед мутацією;
- timeout є `WRITE_UNCERTAIN`, а не автоматичним failure/success;
- recovery probe має встановити authoritative current value;
- terminal success можливий лише після matching readback;
- усі non-OK стани блокують кнопку/контрол;
- packed RW не можна розблоковувати без fresh pre-read + atomic masked RMW + sibling-preservation readback.

CellCount поки має окремий bespoke шлях. Уніфікація з generic exact transaction API запланована.

### Topology

Топологія не дорівнює сліпо configured CellCount. Підтверджений resolver повинен враховувати configured count, connected mask, measured channels, свіжість даних і останній confirmed snapshot. У невизначеному стані система має fail-safe зберігати останню підтверджену топологію й явно показувати uncertainty.

Поточний production/mock frontend фізично обмежений 16 каналами. Офіційний V1.1 manifest містить 32 cell voltages і 32 wire resistances. Розширення до 32S дозволено лише після model/capability gating; розгорнутий 16S пристрій не є доказом підтримки 32S.

### History/storage

- короткі trend-графіки та 60-hour charge history зараз живуть у RAM і губляться після reboot;
- `components/jk_history/*` реалізує A/B LittleFS format/store та має unit/PoC compile evidence;
- production YAML не інстанціює `jk_history:` і не має затвердженої hardware-validated partition migration;
- не підключайте persistence до production без flash/OTA/rollback/power-loss плану і реального стенду.

## Hardware та середовище

### VERIFIED/IMPLEMENTED configuration

- ESP32 board: `esp32dev`.
- Framework: ESP-IDF через ESPHome.
- UART: 115200 baud, TX `GPIO22`, RX `GPIO21`, RX buffer 384.
- RS485 flow-control: `GPIO17`.
- Modbus slave address: `1`; single-pack DIP assumption — address `0x01`. Не змінювати без синхронізації всіх custom commands і фізичних DIP.
- Modbus controller interval: 15 s.
- Configuration registers із `skip_updates: 20` фактично повільніші; окремий cell block читається приблизно щосекунди.
- RS485 turnaround time: 50 ms.
- Web server: port 80, ESPHome web version 2, Digest authentication у поточному YAML.
- Native ESPHome API має encryption key; OTA і fallback AP мають окремі secrets.
- External JK component pinned: `github://syssi/esphome-jk-bms@08f25eb4941b03b6ee0b6c38660aeadfc4ef7cd1`.
- Спостережуваний production access: локальна мережа/VPN; не прямий Internet.

### Toolchain snapshot

- `.node-version`: Node 24.2.0.
- Останній зафіксований Python: 3.9.6 для системних scripts; ESPHome може працювати у своєму venv.
- Остання успішна production compile була з ESPHome 2026.8.2 / ESP-IDF 5.5.5.

Версії є snapshot, а не довічний pin, якщо вони не зафіксовані конфігурацією. Завжди записуйте фактичний `--version` у новий audit.

### Secrets

Ніколи не комітьте, не цитуйте і не переносіть реальні credentials. `secrets.yaml.example` очікує:

- `JK_BMS_WIFI_SSID`
- `JK_BMS_WIFI_PASSWORD`
- `JK_BMS_API_KEY`
- `JK_BMS_AP_PASSWORD`
- `JK_BMS_OTA_PASSWORD`
- `JK_BMS_WEB_USERNAME`
- `JK_BMS_WEB_PASSWORD`

Будь-які credentials, які колись з'являлись у чаті, вважати такими, що потребують ротації; не повторювати їх у файлах або відповідях.

## Джерела істини та рівні довіри

Застосовуйте такий порядок:

1. **Official protocol PDF** для JK-PB Modbus V1.1 — первинне джерело адрес/layout/access.
2. **Verified V2 workbook** — нормалізована робоча модель, переклади, статуси невизначеності й запропоноване UI grouping. Його твердження не можуть мовчки перекривати PDF.
3. **Controlled raw hardware capture** — модель/firmware-specific verification, особливо ambiguity/vendor extension.
4. **Pinned upstream implementation** — корисне незалежне community підтвердження, але не виробник.
5. **Current project implementation** — доказ того, що щось реалізовано, не доказ правильності протоколу.

Документи класичного JK BLE/UART з однобайтовими IDs `0x79–0xC0` та CAN docs описують інші протоколи. Не застосовуйте їх до JK-PB Modbus `0x1000+`.

Актуальні source hashes на момент handoff:

- official PDF: `b9b3f1e417017cff32ec112b6238663204133bb551a1a4a88c9d139c16d22739`;
- verified V2 workbook: `3226acee771fedc448458f6a521421ff55da86309171de57161d0b11d6902be8`.

Перед змінами перевіряйте hashes знову. Не приймайте workbook з тією самою назвою, але іншим content hash без review.

## Важливі файли

- `batterylifepo4.yaml` — production firmware/configuration, Modbus entities, custom handlers, write/recovery, topology, history.
- `jk_bms.js`, `jk_bms.css` — production UI.
- `demo/` — mock server, demo HTML і dev panel; не production backend.
- `components/jk_write_tx/` — generic write transaction core.
- `components/jk_history/` — LittleFS persistence implementation/format, ще не wired у production.
- `protocol/registers.canonical.json` — старий перехідний canonical physical catalog.
- `protocol/non_register_entities.canonical.json` — non-register entity catalog.
- `protocol/evidence/` — PDF/workbook, source manifests/indexers/reviews.
- `protocol/generated/` — generated artifacts; не редагувати вручну.
- `tools/protocol/` — generator, fingerprint, release/pipeline tooling.
- `test/` — C++, catalog, topology/mock, release, history та PoC checks.
- `IMPLEMENTATION_ROADMAP.md` — gate-based roadmap; корисний, але окремі baseline counts історичні.
- `OPEN_ISSUES.md`, `CURRENT_STATE_AUDIT.md`, execution logs — датовані audit trails, не є автоматично актуальним snapshot.
- `PROJECT_STATE.md` — поточний консолідований snapshot, який треба оновлювати після кожного значного етапу.

## Coding conventions

- Мінімізуйте ручне дублювання protocol metadata. Generated artifacts змінюються тільки generator/pipeline.
- Кожне поле має мати стабільний key/entity mapping, адресу, access, wire type, length, signedness, scale, unit, localization, poll/freshness policy та safety classification.
- Packed fields описуються mask/shift/byte order; ніколи не робіть whole-word write для одного subfield.
- Невідоме або суперечливе поле — fail-closed. `owner_write_override` є прийняттям ризику, а не підтвердженням протоколу.
- Секрети не логуються; password/passcode не передається в URL і не зберігається в DOM/telemetry після використання.
- JS має лишатися dependency-light і працювати як embedded asset. Не вводьте framework/bundler без окремого рішення.
- Зберігайте SSE-driven architecture. Freshness вимірюється від реального update timestamp кожної сутності, а не від факту browser connection.
- Не перезаписуйте активне/dirty input поле новими SSE значеннями. Зберігайте focus, selection/caret і draft при rebuild.
- Тести мають включати positive, negative, boundary, timeout, out-of-order і stale-callback сценарії.
- Не довіряйте stdout-фразі `All suites passed` без перевірки exit code і того, що обов'язковий evidence pipeline справді виконувався.

## UI/design rules

- Поточний UI — світла/темна тема з CSS tokens; не робіть випадковий редизайн.
- Мінімалістична щільність, тонкі borders, без яскравих decorative gradients/heavy shadows.
- Typography, row rhythm, input widths і responsive breakpoints у поточному CSS є user-tuned baseline.
- Числове значення показується один раз, без дубля `state · raw`, з точністю протоколу та локалізованою одиницею.
- Українські одиниці використовують українські скорочення (`В`, `А`, `Вт`, `с`, `год`, `мкс`, `мОм`); англійські — `V`, `A`, `W`, `s`, `h`, `µs`, `mΩ`.
- У settings input одиниця розташована всередині видимого input wrapper як suffix; не дублювати її в назві параметра.
- Двостанові RW поля — toggle, не select. Зміна toggle потребує окремого confirm interaction, без постійної кнопки OK поруч.
- Numeric RW: синя `OK`; під час write/readback muted orange `>>` і disabled; matching readback — muted green check приблизно 1 s; mismatch — red `×` приблизно 1 s, input повертає authoritative readback; потім знову blue `OK`.
- Контрол disabled у кожному стані, відмінному від idle/OK.
- Setup passcode input, якщо колись безпечно повернеться, має бути приблизно на третину ширшим за звичайне поле. Наразі UI passcode навмисно відсутній/fail-closed.
- Cell voltages і wire resistances сортуються чисельно `01…N`, не лексикографічно.
- Chart columns мають рівномірно використовувати ширину відповідно до effective N.
- Navigation та accessibility labels мають бути локалізовані.

## Behavioral requirements

### Settings and diagnostics

- Settings: усі protocol R/RW/W parameters у нормативних групах і порядку; R live read-only; RW safe editor; W окремі dangerous service actions.
- Diagnostics: тільки ESPHome-derived phase/state/direction/duration/quality і ESP32/browser/UI Wi-Fi/IP/version/connection/command stats.
- Не повертати заголовки `ЗНАЧЕННЯ ПАРАМЕТРІВ BMS` або `Фактично отримано від ESPHome`.
- Підпис таблиці: `Сутність` / `Значення розділу` (локалізований еквівалент англійською).
- Не допускати BMS register entity до Diagnostics і non-register entity до Settings. Класифікація має походити з canonical source і перевірятись DOM test.

### Dynamic topology

- UI/aggregates/charts/history/alarms/settings/read schedule повинні використовувати один atomic confirmed topology snapshot.
- Перехід 16→8 не може лише сховати картки: pack voltage, averages, min/max, masks, charts, history і polling мають стати узгодженими.
- Непідтверджена, stale або неможлива топологія не повинна застосовуватись.
- Не тестувати небезпечну CellCount зміну на реальній батареї без lab-safe plan, відповідного pack і rollback.

### Freshness/connectivity

- `EventSource.OPEN` означає browser transport, не свіжість BMS.
- Кожне displayed value має budget, stale visual state та пояснення/age.
- Writable control зі stale source state має блокувати write або вимагати fresh read згідно policy.
- Reconnect не повинен породжувати duplicate event handlers або втрачати pending transaction correlation.

## Невирішені protocol ambiguities

Не «виправляти» припущенням:

- два alarm names у V2 не мають підтверджених bit numbers;
- byte order `RCVTime`/`RFVTime` у `0x1504` потребує raw capture;
- `0x1600`/`0x1606` мають суперечність `UINT16` vs length 4; W-команди залишаються disabled;
- `0x111C` і `0x1470` — vendor/model extensions, яких немає в official V1.1; потрібен capability gate;
- second-byte access для `DRY1Trigger` неоднозначний;
- workbook містить 12 curated UI groups, але register rows не мають однозначного per-row mapping на них; mapping не можна вгадувати.

## Обов'язковий workflow

1. Перед роботою прочитайте `AGENTS.md`, `PROJECT_STATE.md`, `HANDOFF.md`, потім перевірте `git status` і не знищуйте dirty changes.
2. Відтворіть relevant baseline власними командами; не довіряйте старому звіту без звірки з кодом.
3. Для protocol work звіряйте official PDF, verified V2 workbook, manifest, canonical і YAML; перелічуйте розбіжності.
4. Спочатку failing test, потім мінімальна implementation, потім regression/fault tests і docs.
5. Запускайте `node tools/protocol/generate.js --check`, fingerprint checks і релевантні suites. Повний release gate має включати саме V2 workbook; зараз це відомий P0 gap.
6. Firmware change: `esphome config` і `esphome compile`; записуйте versions, exit codes, RAM/flash і binary hashes.
7. Hardware writes — тільки після явного safety plan/дозволу, з pre-state, raw trace, expected result, abort condition і rollback.
8. Після етапу оновіть `PROJECT_STATE.md` та issue/evidence docs. Не оголошуйте етап закритим без усіх exit criteria.

## Заборони для майбутніх агентів

- Не змінювати GPIO, baud, Modbus address, external-component pin або security secrets «для зручності».
- Не прошивати реальний пристрій і не писати BMS register лише тому, що endpoint доступний.
- Не розблоковувати hazardous/topology/credential/packed/ambiguous RW без evidence і safety gate.
- Не використовувати cached sibling для packed RMW.
- Не трактувати entity SSE equality як terminal write confirmation.
- Не довіряти configured CellCount як єдиному джерелу топології.
- Не генерувати 32S UI без model/capability gate.
- Не редагувати generated JSON/JS blocks вручну.
- Не замінювати V2 workbook старим V1 файлом і не використовувати BLE `0x79…` docs.
- Не повторювати й не комітити credentials із чатів/logs.
- Не називати `Ready/Готово` compile-, unit-, mock- або read-only hardware-результат.
- Не clean/reset/revert dirty worktree без окремої згоди користувача.

## Критерій `Готово`

Статус дозволений лише коли: P0=0, P1=0, P2 письмово прийняті або закриті; clean reproducible full suite з V2 evidence; exact transaction contract; packed preservation; dynamic topology; browser E2E; production persistence; security matrix; повний HIL checklist; rollback; 72-hour soak/power-loss campaign; зафіксовані build/catalog/source hashes. Інакше статус — `Не готово` з точними межами доказу.
