> **ARCHIVED — historical record, not current and not an implementation queue.**
> Moved here in the 2026-09-25 repository cleanup (full pre-move state: branch
> `checkpoint/pre-repository-cleanup-2026-09-25`). Paths, counts and statuses
> below reflect the date written. Current state: [PROJECT_STATE](../../project/PROJECT_STATE.md);
> current plan: [RS485_UNIFIED_PARAMETER_PIPELINE_PLAN](../../project/RS485_UNIFIED_PARAMETER_PIPELINE_PLAN.md);
> archive index: [docs/archive/README.md](../README.md).

# Реєстр відкритих питань — JK BMS

**Стан на 2026-09-10: НЕ ГОТОВО.** Оновлено після повного закриття контентної частини P1-05 (локалізація/сортування/одиниці у Settings/Diagnostics) — один явний критерій (DOM regression test) свідомо залишено відкритим за прямим рішенням користувача. Наявність зелених unit/mock-тестів не скасовує наведені нижче дефекти.

## 2026-09-10 — P1-05 частково закрито: сортування/локалізація опору комірок (eleventh pass)

Корінь: `cellResistanceKeys[i] = "cell_resistance_${index}"` (реальний ключ), але `diagnosticUnit()`/`DIAGNOSTIC_ENTITY_ORDER`/`diagnosticNumberedSeries()`/`diagnosticEntityLabel()` усі очікували `cell_N_wire_resistance` — жодне з чотирьох місць ніколи не спрацьовувало. Наслідок, підтверджений живою перевіркою в Browser pane двома проходами раніше (сесія вже спостерігала цей симптом, не усвідомивши його значення на той момент): рядки опору сортувались лексикографічно (`1, 10…16, 2…9`) без одиниці "мОм" і без українського підпису, навіть в укр. режимі UI.

Виправлено всі 4 місця в `jk_bms.js` на реальний формат ключа. Новий тест у `test_entity_id_collision.js` (тепер 11/11, було 8) статично доводить внутрішню узгодженість — підтверджено, що тест ловить регресію (revert → 3 FAIL). Жива повторна перевірка в Browser pane: `Опір проводу комірки 01`…`16` тепер у правильному порядку з одиницею. `bash test/run_all.sh` — exit 0. `esphome config` — Valid (зміна суто JS).

**Не виправлено цим проходом**: решта P1-05 (англійські підписи `Cell request charge/float voltage`, `Balancing active`, `Device model`, `Runtime`) та browser-рівневий regression-тест на exact order для 1S/4S/8S/16S (потребує інфраструктури P1-09). Жодне RW-поле не розблоковано/заблоковано.

## 2026-09-10 — P1-04 закрито; побічно знайдено й виправлено дефект secret-scan тесту (ninth pass)

Другий самостійно сформульований цільовий прохід (після P0-04). Корінь P1-04: `jk_bms.js`'s `NON_REGISTER_ENTITY_IDS` був ОКРЕМИМ ручним масивом (~41 запис), що з часом розійшовся з реальністю — кілька записів використовували застарілі/неправильні логічні ключі (`charge_status_time_elapsed` замість справжнього `registerEntity()`-ключа `charge_status_time`, `bms_display_name` замість `device_name`, `battery_state_elapsed` замість `battery_state_time`, `battery_state_candidate_direction` замість `battery_state_direction`, `battery_state_candidate_fresh_samples` замість `battery_state_candidate_samples`). `diagnosticObjectId()` завжди повертає ЛОГІЧНИЙ ключ, зареєстрований через `registerEntity()`, — тому ці неправильні назви ніколи нічого не матчили, і відповідні обчислені сутності мовчки протікали у список регістрів Settings. Це точно той самий дефект, що спостерігався на реальному пристрої (`HARDWARE_AUDIT_2026-09-09.md`: "Battery state time", "Charge phase time", "Runtime" у списку регістрів).

- **Виправлення**: `NON_REGISTER_ENTITY_IDS` тепер похідний виключно від уже згенерованого (з першого проходу Stage 1) `PROTOCOL_CATALOG.nonRegisterKeys` — структурно унеможливлює повторний дрейф (немає більше другого джерела істини).
- Новий тест (`test_blocked_write_surface.js`) доводить: похідна конструкція на місці, і всі 6 раніше "протікаючих" ключів тепер коректно у виключеному наборі.
- **Жива перевірка в Browser pane** проти demo mock-сервера: `Battery state time`, `Charge phase time`, `Charge status time`, `Runtime`, `Device name` тепер коректно з'являються в Діагностиці, а НЕ в Settings. `Balancing active`/`Charging active`/`Discharging active` залишились у Settings — підтверджено, що це РЕАЛЬНІ регістри (не частина дефекту, всупереч первинному опису P1-04).
- **Побічно знайдено реальний дефект** у `test/protocol_catalog/test_secret_scan.js`: виключення synthetic-positive fixture (`DEFAULT_EXCLUDED_FILES`) застосовувалось лише в `scanWorktree()`, не в `scanIndex()`/`scanRecentHistory()`. Після попереднього `git push` цього сеансу (коли fixture вперше потрапив у git index/history), `bash test/run_all.sh` почав падати з exit 1 на кроці secret-scan — сам detector коректно "знаходив" фікстуру (вона навмисно детектована), але тест неправильно рахував це реальним витоком. Виправлено (виключення тепер застосовується уніфіковано в усіх трьох сканах); `test_secret_scan.js` — знову `secret-scan PASS`, exit 0.
- Тести: 63/63 (C++, без змін), 171/171, 16/16, 110/110, 98/98 (було 91 — +7 нових перевірок), 7/7, 76/76 (topology, без змін). `bash test/run_all.sh` (справжній `$?` після виправлення pipe-помилки в цьому проході, не exit-код `tail`) — exit 0, "All suites passed."
- `esphome config` — Valid (зміна суто JS/test, YAML не зачіпалась).
- **НЕ виконано**: інші 9 канонічних `nonRegisterKeys`, що не відповідають жодному реальному `registerEntity()`-ключу (`ui_version`/`browser_connection`/`write_result_counters`/`firmware_version` — навмисно browser-only, це нормально; `battery_state`/`min_cell_voltage`/`max_cell_voltage`/`min_voltage_cell`/`max_voltage_cell` — потенційний окремий дрібний гап, не досліджувався глибше цим проходом). Також знайдено, але НЕ виправлено: `registers.canonical.json`'s `esphome_read_entity_id` для `cell_rcv`/`cell_rfv` (мали б бути `cell_request_charge_voltage`/`cell_request_float_voltage`) та `balancing_active` (реальної сутності з такою назвою не існує — ймовірно, це шаблонний сенсор `balancing`) — це catalog-drift дефект, окремий від P1-04, потребує власного, окремого проходу для безпечної перевірки, оскільки зачіпає ВЖЕ РОЗБЛОКОВАНІ (WRITE_VERIFIED) поля.

## 2026-09-10 — P0-04 закрито для generic RW-полів (eighth pass)

Самостійно сформульований і виконаний прохід: єдина, чітко обмежена дія — реалізація generic `WRITE_UNCERTAIN` + recovery probe для всіх 18 ефективно-RW полів (окрім CellCount, який вже мав власний bespoke recovery-механізм). Жодне поле не розблоковано і не заблоковано цим проходом.

- **`components/jk_write_tx/jk_write_tx_core.h`**: додано `RECOVERED_CONFIRMED`(10)/`RECOVERED_MISMATCH`(11) до `Status`; `is_pending()` тепер включає `WRITE_UNCERTAIN`, тож `begin()`'s single-flight guard автоматично блокує повторний запис на адресу, доки recovery не вирішиться. `tick()` не змінено — усі 54 попередні unit-тести лишаються дійсними без модифікацій. +4 нових тести (63 разом).
- **`batterylifepo4.yaml`**: 250ms-сервісер тепер перехоплює `ACK_TIMEOUT`/`READBACK_TIMEOUT` ДО публікації, рекласифікує в `WRITE_UNCERTAIN`, запускає recovery-readback (той самий generation-guard патерн, що й ACK/forced-readback callbacks), порівнює з `compare_mask` і вирішує в `RECOVERED_CONFIRMED`/`RECOVERED_MISMATCH` — той самий патерн, що CellCount вже використовує (`g_topology_recovery_*`).
- **`demo/mock-server.js`**: дзеркальна симуляція (`finishUncertain()`, новий сценарій `applied_ack_lost` для перевірки шляху RECOVERED_CONFIRMED).
- **`jk_bms.js`**: `TX_STATE.UNCERTAIN` (не термінальний — контрол лишається disabled, без передчасного зеленого/червоного); `WTX_TERMINAL_STATUS` більше не вважає сирі 7/8 термінальними, додано 10/11; клієнтський timeout подовжується під час recovery, щоб не перегнати backend.
- **`test/topology/run.js`**: новий `testGenericWriteUncertaintyRecovery` доводить ОБИДВА шляхи (RECOVERED_CONFIRMED і RECOVERED_MISMATCH) на `cell_uvpr` (не CellCount). Під час верифікації сам спіймав і виправив реальну регресію: `resetGenericWrite()` (раніше — фіксований сон 200ms) тепер опитує снапшот до реального звільнення адреси — фіксована затримка залишала іншу адресу `WRITE_UNCERTAIN` і наступний тест на ту саму адресу мовчки відхилявся.
- **Тести**: 63/63 (C++), 171/171 (validate.js), 16/16 (packed_codec), 110/110 (negative_fixtures), 91/91 (blocked_write_surface), 76/76 (topology, було 69). `bash test/run_all.sh` — exit 0. `esphome compile` (2026.8.2) — SUCCESS, RAM 51.4%, Flash 61.4%, без нових попереджень.
- **НЕ виконано цим проходом**: browser-рівневий E2E для цього шляху (P1-09 лишається відкритим); апаратна валідація (mDNS blocker незмінний); CellCount's власний recovery-driver свідомо не чіпали (вже мав цю можливість, рефакторинг був би невиправданим ризиком без потреби).

**P0-04 статус: закрито для generic RW-полів** (18 з 18). CellCount вже мав еквівалент раніше. Критерій закриття з опису нижче виконано на рівні firmware+mock+тестів; лише browser E2E і hardware-підтвердження залишаються поза цим проходом.

## 2026-09-10 — підсумок третього критичного аудиту (transaction architecture hardening)

Ціль цього проходу: виправити архітектуру транзакцій, усунути нечесні/неповні тести, привести protocol pipeline у консистентний стан. Це НЕ прохід масового розблокування записів — жодне поле цього проходу не розблоковано, одне (`balancing`) повернуто до fail-closed.

- **`balancing` рекласифіковано `disruptive`** (було помилково `normal` у `registers.canonical.json`, що суперечило власному коментарю `batterylifepo4.yaml`, який ще з першого проходу завжди групував charging/discharging/balancing як disruptive разом). `owner_write_override` знято, `effective_access` повернуто до `"r"`. Тепер 0 control-select полів лишаються unlocked. Баланс змінився: 18 WRITE_VERIFIED (було 19), 21 BLOCKED_CONFLICT (було 20) — `RW_REGISTER_VERIFICATION_MATRIX.md` перегенеровано.
- **P1-01 закрито повністю для REJECTED**: одинарний глобальний "last rejected" запис замінено на 4-слотовий ring buffer (`g_wtx_rejected_addr/tx_id/ms[4]` + `g_wtx_rejected_next_slot`) — друге одночасне відхилення більше не втрачається; кожне відхилення має власний tx_id. Другий запит на ту саму адресу отримує REJECTED без очікування timeout (підтверджено `testGenericWriteRejectedOnCollision`).
- **P0-03 (slot-reuse race) частково закрито**: додано generation token (`Slot::generation`, монотонний лічильник, що інкрементується при кожному `begin()`) — ACK-callback і forced-readback callback тепер захоплюють immutable `{idx, tx_id, address, generation}` і звіряють усі поля перед будь-якою мутацією; застарілий callback відкидається без ефекту. Це закриває late-callback race для slot reuse на рівні C++ unit tests (3 нових тести, 54/54 pass), АЛЕ не є повною реалізацією P0-03 критерію закриття — немає browser-рівневого integration-тесту з реальним HTTP+SSE stale-callback сценарієм.
- **P0-02 закрито для generic-write шляху**: `writeTransaction()` у `jk_bms.js` тепер підтверджує CONFIRMED/MISMATCH ВИКЛЮЧНО через `write_tx_snapshot`, keyed за exact `tx_id`, коли адреса відома (це всі поточні виклики) — стара логіка "будь-яка нова ревізія entity завершує транзакцію" залишена лише як defensive fallback для недосяжного (наразі) випадку `cfg.address == null`. Це усуває конкретний сценарій хибного зеленого успіху з P0-02 (requested value == old value, ACK втрачено — зеленої галочки більше немає).
- **P0-06 (setup_passcode) UI повністю прибрано вдруге**: редактор паролю (input field, save button, JS handlers `sendPasscodeWrite`/`initSetupPasscodeField`, i18n ключі) видалено з app-settings modal; backend endpoint лишається заблокованим (refusal stub, без змін цього проходу). Секрет ніде не з'являється в URL/логах/DOM, бо форми для нього більше не існує.
- Самостійно знайдено і виправлено реальний баг у власному тесті `test_blocked_write_surface.js`: regex для `CONTROL_DEFS` неправильно матчився повз порожній `Object.freeze({});`, захоплюючи чужі ключі з пізнішого блоку файлу (`PROTOCOL_CATALOG`) як хибні "frontend" записи.
- Самостійно знайдено і виправлено застарілий тест `testControlRegisterWriteConfirmed` у `test/topology/run.js`, який усе ще очікував, що `balancing` успішно записується (200) — після reclassification він мав очікувати 409. Замінено на розширену `testControlRegisterChargingDischargingBlocked`, яка тепер перевіряє всі три control-select (`charging`/`discharging`/`balancing`) як заблоковані.
- **НЕ виконано цього проходу** (явно, з причинами — повні деталі в ADR addendum "seventh pass"):
  - **Пункт 2 (повна перебудова protocol pipeline з реальним workbook)** — workbook недоступний у цьому середовищі; `pipeline.js check` не запущено проти реального workbook. `quick`/`full` режими і real overall timeout не реалізовані.
  - **Пункт 3 (кастомний JSON write endpoint `{accepted, tx_id, key, address, generation, reason}`)** — це новий `AsyncWebHandler`-компонент, значний обсяг роботи; існуючий ESPHome `number`/`select` REST endpoint (`/number/.../set`) залишається єдиним write шляхом і повертає лише HTTP-статус, без структурованого JSON body. **P0-01 (строга tx_id-кореляція з боку HTTP-відповіді) залишається відкритим.**
  - **Пункт 7 (generic WRITE_UNCERTAIN + recovery probe)** — CellCount вже має recovery probe (з попередніх проходів); generic write manager (звичайні RW-поля) досі просто звільняє slot після ACK_TIMEOUT/READBACK_TIMEOUT без recovery readback чи явного WRITE_UNCERTAIN стану. **P0-04 лишається відкритим.**
  - **Пункти 11/12 (browser E2E: два клієнти, race conditions, точний 1-секундний green/red, reload під час транзакції)** — інфраструктури Playwright/еквівалента в репозиторії немає; це значний новий testing-стек, не доданий цього проходу. **P1-09 лишається відкритим.**
  - **Пункт 14 (passive RS485 trace plan + список safe reversible test fields)** — план надано окремо у фінальному звіті користувачу; апаратна валідація НЕ виконувалась (mDNS blocker незмінний, окремого дозволу на hardware-дії не було).
- Повний `esphome compile` пройдено вдруге проти закріпленої версії 2026.8.2 після всіх змін цього проходу — RAM 51.3%, Flash 61.2%, `Successfully compiled program.`
- `test/run_all.sh` (unit/integration/mock/topology, без workbook) — усі перевірки, включно з виправленим `testControlRegisterChargingDischargingBlocked`, проходять чисто.

## 2026-09-10 — підсумок другого критичного аудиту

- **Розблоковано (owner_write_override) 46/46 RW-полів, потім повернуто fail-closed для 27** (усі `disruptive`/`topology`/`credential`/unresolved-dynamic-dependency/packed поля) — `owner_write_override` є прийняттям ризику власником, а не протокольною верифікацією; це не мало трактуватись як коректний базовий стан. 19 полів (`normal`, непаковані, з повністю вирішеною залежністю) лишаються розблокованими.
- **P1-01 частково закрито**: `begin_write_tx`'s busy-rejection тепер публікує реальний `REJECTED(9)` запис у `write_tx_snapshot` (раніше — лише `ESP_LOGW`, HTTP 200 без жодного сигналу клієнту; той самий дефект існував і в `demo/mock-server.js`, теж виправлено). Frontend розпізнає статус 9 (`TX_STATE.REJECTED`, `WTX_TERMINAL_STATUS` розширено). **Це НЕ закриває P0-01/P0-03 повністю** — кореляція досі за адресою, не за строгим `tx_id`-first матчингом з перевіркою key/address/mask; late-callback race (P0-03) не адресовано.
- **P0-05 (packed RMW) залишається відкритим і тепер explicit prerequisite**: усі packed-поля (heating pair, `rcv_time`/`rfv_time`, `lcd_buzzer_trigger`/`dry_contact_1/2_trigger_source`) повернуто до fail-closed саме тому, що (а) sibling читається з кешованого `id(...).state`, не свіжим pre-read, і (б) `findWriteTxEntry(address)` не розрізняє два поля одного регістра. Жодне packed-поле не повинно розблоковуватись знову, доки обидва не виправлені і не покриті окремим тестом.
- **`protocol/generated/claim_matrix.json` був застарілим** (`write_ready: 0` при 46 effective-RW) — генерується лише `pipeline.js build` (потребує workbook, недоступний у цьому середовищі), `generate.js --check` цей файл не перевіряє. Залишається відкритою структурною прогалиною.
- **`sources.json`'s fingerprint для `project_implementation` був застарілим** відносно сьогоднішніх правок YAML/JS — перерахований і застампований у всіх 239 цитат. Виправлено.
- **Повний `esphome compile` пройдено** проти точно закріпленої версії 2026.8.2 (не замінник) — RAM 51.3%, Flash 61.2%, `Successfully compiled program.` Це перше реальне підтвердження компіляції в цій сесії (не лише `esphome config`).
- **Апаратна верифікація (Етап 9 запиту користувача) заблокована середовищем**: це sandboxed-середовище не може дістатись до `http://jk-bms.local/` — mDNS `.local`-резолвінг не працює навіть з вимкненим sandbox. Потрібна пряма IP-адреса пристрою АБО користувач сам виконує перевірочні команди й надсилає результат.

Наведені нижче P0/P1 з 2026-09-09 **залишаються переважно відкритими** — сьогоднішній прохід закрив лише вузьку частину P1-01 (REJECTED-сигнал), не P0-01 (строга tx_id-кореляція), не P0-03 (slot-reuse race), не P0-04 (WRITE_UNCERTAIN + recovery probe для generic-полів — CellCount вже має, generic-поля — ні), не P0-05 (packed atomic RMW), не P0-06 (passcode тепер знову заблокований, тож сам дефект неактивний, але не виправлений).

Послідовність реалізації, залежності та критерії закриття: `IMPLEMENTATION_ROADMAP.md`.

Позначення: **P0** — можливий хибний успіх, пошкодження/перезапис регістра або невизначений стан BMS; **P1** — функціональна, діагностична, безпекова чи тестова прогалина; **P2** — документація, локалізація або експлуатаційна якість.

## P0 — блокують будь-який статус «Готово»

### P0-01. Frontend не корелює відповідь POST з точним `tx_id`

- `postCommand()` перевіряє лише HTTP-код і відкидає тіло відповіді (`jk_bms.js:3158-3165`).
- `writeTransaction()` приймає будь-який terminal snapshot тієї ж адреси з `tx_id > startTxId`, а не конкретну транзакцію, створену цим запитом (`jk_bms.js:3297-3305`).
- `sendCellCountWrite()` стежить лише за новою ревізією status entity і не зіставляє `cellcount_tx_id` з командою (`jk_bms.js:3615-3693`).
- Особливо небезпечно для двох логічних полів одного packed-регістра та для кількох браузерів/клієнтів.

Критерій закриття: backend повертає структуровану відповідь з прийнятим `tx_id`, ключем і адресою; frontend очікує terminal result лише для цього exact `tx_id`; старі, чужі, дубльовані та out-of-order події ігноруються. Є browser/integration тести з двома клієнтами та packed siblings.

### P0-02. Звичайна SSE-публікація entity може дати хибний зелений успіх

Після POST frontend спочатку дозволяє будь-якій новій ревізії цільової entity завершити транзакцію (`jk_bms.js:3335-3354`). Періодичне опитування зі значенням, яке вже дорівнює requested, може показати `CONFIRMED` до authoritative ACK + forced readback snapshot або навіть при невдалому записі.

Критерій закриття: для всіх BMS RW-полів єдиним джерелом terminal verdict є backend transaction snapshot exact `tx_id`; entity SSE оновлює відображення, але не підтверджує запис. Тест: requested дорівнює старому значенню, ACK/readback штучно втрачені — зеленої галочки немає.

### P0-03. Повторне використання slot допускає late-callback race

`jk_write_tx::begin()` одразу повторно використовує terminal slot тієї ж адреси (`components/jk_write_tx/jk_write_tx_core.h:114-139`), а ACK та readback callback захоплюють лише індекс slot (`batterylifepo4.yaml:1133-1147`, `3498-3503`). Запізнілий callback попередньої транзакції може змінити вже нову транзакцію у тому самому slot.

Критерій закриття: callback захоплює immutable `{slot, tx_id, address, generation}` і перед мутацією звіряє всі поля; terminal slot не перевикористовується, доки старі callbacks не можуть бути прийняті, або застосовано generation token. Є детермінований unit/integration тест late ACK і late readback після reuse.

### P0-04. Generic timeout не переводиться у безпечний `WRITE_UNCERTAIN` і не має recovery probe

**ЗАКРИТО 2026-09-10 (eighth pass)** для firmware/mock/тестового рівня — див. підсумок на початку цього файлу та ADR addendum "generic WRITE_UNCERTAIN + recovery probe". Generic manager тепер реклассифікує `ACK_TIMEOUT`/`READBACK_TIMEOUT` у `WRITE_UNCERTAIN`, блокує повторний запис на ту саму адресу (через `jk_write_tx::is_pending`), запускає recovery-readback кожні 2с і вирішує в `RECOVERED_CONFIRMED`/`RECOVERED_MISMATCH`. Доведено тестом `testGenericWriteUncertaintyRecovery` для обох шляхів на реальному (не CellCount) полі. **Залишається відкритим**: browser-рівневий E2E цього шляху (P1-09) і hardware-підтвердження реальної затримки/поведінки recovery-проби — 2-секундний інтервал повтору є судженням розробника, не верифікованим апаратно значенням.

~~Generic manager завершує `ACK_TIMEOUT`/`READBACK_TIMEOUT`, через приблизно 3 секунди звільняє slot і не виконує незалежне відновлювальне читання. На відміну від CellCount, фактично застосований, але непідтверджений запис не самовідновлюється до авторитетного стану.~~ (первинний опис дефекту, збережено для контексту)

Критерій закриття: timeout означає `WRITE_UNCERTAIN`; UI блокує повторний запис цієї адреси та не відновлює кеш як істину; backend періодично робить незалежний recovery readback до `RECOVERED_CONFIRMED`/`RECOVERED_MISMATCH` або явної операторської ескалації. Є тести `applied_ack_lost` і `applied_readback_lost` для generic-регістрів.

### P0-05. Packed read-modify-write не є атомарним і використовує кешований sibling

Для `0x111C`, `0x1504`, `0x14E4` та `0x14E6` нове слово збирається зі стану ESPHome entity, а не зі свіжого pre-read безпосередньо перед записом. Production-шляхи передають `mask: -1`; отже тестована masked-семантика не є реальною production-семантикою. Код прямо визнає, що publish verified readback для packed полів не реалізовано (`batterylifepo4.yaml:1165-1170`).

Критерій закриття: packed transaction виконує `fresh pre-read -> merge only owned bits -> write -> ACK -> forced readback`; compare mask, shift, signedness і sibling preservation беруться з єдиного каталогу; конкурентний запис sibling серіалізується за фізичною адресою. Hardware-тест підтверджує, що зміна одного поля не змінює друге.

### P0-06. Запис пароля UI завершує як `SENT_UNVERIFIED` одразу після HTTP 200

Firmware має ACK/readback status для passcode, однак frontend навмисно завершує операцію відразу після HTTP 200 (`jk_bms.js:3315-3320`, `3561-3585`). Користувач не бачить фактичного backend terminal result.

Критерій закриття: значення пароля ніколи не публікується, але frontend очікує exact passcode transaction id/status і показує підтвердження лише після backend ACK + безпечної перевірки; timeout/error не маскуються як відправлення. Секрет не потрапляє у URL, логи, snapshot або DOM після завершення.

## P1 — обов'язкові до завершення релізу

### P1-01. Backend `REJECTED` не доходить до HTTP-клієнта

При зайнятому slot або конфлікті адреси script лише пише warning і повертається; стандартний ESPHome endpoint вже відповідає HTTP 200. Frontend чекає timeout або може прийняти чужий результат.

Критерій: command endpoint повертає 409/429 і JSON `{accepted:false, reason, key, address}`; UI негайно відновлює authoritative value.

### P1-02. Transaction snapshot недостатній для аудиту та відновлення

Snapshot містить лише `{addr, tx_id, status, req, rb}` і через 3 секунди зникає. Немає logical key, reason/error, created/ack/readback/finished timestamps, generation, mask/width, recovery status.

Критерій: версійована схема, документований lifecycle, timestamps і reason codes; останній terminal result доступний достатньо довго або через окремий endpoint журналу.

### P1-03. `register_catalog.json` не є каталогом усіх R/RW-регістрів

Файл має 47 рядків, усі `access: rw`; адресованих BMS-рядків 46. Read-only регістри відсутні. Твердження про «single source of truth for every register» не відповідає фактичному scope. Validator перевіряє переважно самосумісність рядків та наявність літералів, але не доводить повноту протоколу, правильний зв'язок address↔entity↔endpoint, unit, scale, signedness, bounds, masks і UI order.

Виявлений drift: `scp_delay` у каталозі має `s`, тоді як runtime/UI — `µs`; `rcv_time` і `rfv_time` у каталозі мають `s`, тоді як runtime/UI — години.

Критерій: один машинозчитуваний каталог для всіх R/RW-полів протоколу з джерелом істини/версією BMS; генерація YAML/UI/mock/tests з нього; validator перевіряє точне зіставлення всіх метаданих і падає на пропуску/дублікаті/drift.

**Оновлення 2026-09-09 (Stage 1 + Stage 1 Remediation):** `protocol/registers.canonical.json` тепер містить 119 регістрів / 127 логічних полів (81 R, 46 RW), з версійованим evidence manifest, детермінованим генератором (`tools/protocol/generate.js`) і строгим semantic-валідатором. `scp_delay`/`rcv_time`/`rfv_time` unit drift виправлено й покрито regression-тестами. Незалежний аудит (`CODEX_STAGE_1_REVIEW.md`) знайшов і виправлено додаткові дефекти (хибні workbook-evidence claims, невірна geometry 128-бітного passcode, декоративний `effective_access`). Повний, чесний статус на той момент — NOT READY (немає офіційної документації протоколу, 4 поля залишаються заблокованими для запису через невідому enum-семантику) — див. `STAGE_1_REMEDIATION_AUDIT.md`.

**Коригування 2026-09-11 (self-audit, gap G2):** твердження «немає офіційної документації протоколу» вище — **застаріле й більше не відповідає дійсності**. Офіційна документація виробника (極空/Jikong) `極空BMS RS485 Modbus通用協議(V1.1)` отримана й додана як нормативне джерело (`protocol/evidence/BMS_RS485_Modbus_V1.1.pdf`, SHA-256 `b9b3f1e417017cff32ec112b6238663204133bb551a1a4a88c9d139c16d22739`, `sources.json` → `official_jk_documentation`, `authority_tier: primary_protocol_spec`), разом із нормалізованим верифікованим workbook (`LiFePO4_BMS_Parameters_registers-V2_verified.xlsx`, 265 рядків, 208 V1.1-адрес) і машинозчитуваним manifest (`protocol/generated/bms_v1_1_manifest.json`, генератор `protocol/evidence/build_v2_manifest.py`). Це **не закриває P1-03 автоматично** — `protocol/registers.canonical.json` (119 регістрів) все ще генерується зі старого V1 workbook і НЕ синхронізований з новим V2/офіційним manifest; exhaustive gap-аудит цього розриву — `protocol/generated/bms_v1_1_gap_audit.json` (130 implemented, 97 missing, 38 partial з 265 нормативних параметрів). Деталі й повний список розривів/виправлень — `BMS_V2_MANIFEST_EXECUTION_LOG.md`. P1-03 залишається офіційно відкритим — причина зміщується з «немає документації» на «є документація, реалізація ще не наздогнала її».

### P1-04. «Налаштування» змішують регістри, derived ESPHome та presentation entities

**ЗАКРИТО 2026-09-10** — див. підсумок на початку файлу. `NON_REGISTER_ENTITY_IDS` тепер похідний виключно від `PROTOCOL_CATALOG.nonRegisterKeys` (єдине джерело істини), а не окремий ручний масив. Підтверджено живою перевіркою в браузері проти demo mock-сервера: `Battery state time`, `Charge phase time`, `Charge status time`, `Runtime`, `Device name` тепер коректно в Diagnostics, не в Settings.

~~На реальному пристрої у списку присутні `Balancing active`, `Battery state time`, `Charge phase time`, `Charge status time`, `Charging active`, `Discharging active`, `Runtime` тощо. Це не редаговані BMS-регістри й вони не повинні потрапляти до цього переліку. Фільтр `NON_REGISTER_ENTITY_IDS` є ручним і неповним.~~ (первинний опис; уточнення: `Balancing active`/`Charging active`/`Discharging active` виявились РЕАЛЬНИМИ регістрами (`balancing_active` 0x12A6 тощо, `READ_ONLY_UNVERIFIED`), тому їхня присутність у списку коректна — не частина цього дефекту.

Критерій: Settings будується лише з каталогу протоколу; R — read-only, RW — editor; жодне computed/UI поле не потрапляє туди через евристику SSE object id. **Виконано** для non-register entity filtering.

### P1-05. Неповна українська локалізація і неправильна послідовність

**КОНТЕНТ ПОВНІСТЮ ВИПРАВЛЕНО 2026-09-10 (дванадцятий прохід); залишається один явний, свідомо відкритий критерій.** Рішення користувача (прямо запитано і підтверджено 2026-09-10): контентну частину закрито, вимогу "checked-in browser/DOM regression test" залишено ВІДКРИТОЮ саме під P1-05 (не об'єднано з P1-09).

**Що виправлено (одинадцятий+дванадцятий проходи):**
- Корінь #1 (сортування/одиниця опору комірок): реальний ключ `cell_resistance_${N}` (`jk_bms.js:638`, збігається з `registers.canonical.json`), але ЧОТИРИ місця (`diagnosticUnit()`, `DIAGNOSTIC_ENTITY_ORDER`, `diagnosticNumberedSeries()`, `diagnosticEntityLabel()`) помилково очікували `cell_N_wire_resistance`. Виправлено всі 4.
- Корінь #2 (той самий клас багу для температурних датчиків): реальні ключі `temperature_1`/`temperature_2`/`temperature_4`/`temperature_5` (без "_sensor_", без датчика 3), але ті самі 3 місця очікували `temperature_sensor_N`. Виправлено.
- Корінь #3 (застарілі/неправильні ключі в `DIAGNOSTIC_ENTITY_LABELS`, той самий клас багу, що й P1-04, тепер і тут): `manufacturer_device_id`→`device_model`, `total_runtime_formatted`→`runtime`, `bms_display_name`→`device_name`, `charge_status_time_elapsed`→`charge_status_time`, `charge_phase_elapsed`→`charge_phase_time`, `battery_state_elapsed`→`battery_state_time`, `total_charging_cycle_capacity`→`cycle_capacity` (і в `diagnosticUnit()`'s unit-list, і в `DIAGNOSTIC_ENTITY_ORDER`). Виправлено всюди (both EN and UK).
- Корінь #4 (просто відсутні записи): `charging_active`/`discharging_active`/`balancing_active` (3 live-status binary sensors, окремі від control-register readbacks) + 13 topology/write-tx bookkeeping ключів (`connected_cell_count`, `topology_state`, `cellcount_tx_id` тощо) — додано в обидва словники (EN раніше мав суттєво менше записів, ніж UK — вирівняно, +16 EN-записів для повної UK/EN симетрії, включно з `heating_activation_temperature`, `dry_contact_*`, `rcv_time`/`rfv_time` тощо, які раніше існували лише в UK).
- Корінь #5 (знайдено під час живої перевірки, поза оригінальним описом): `control_override_reason` не мав `registerEntity()`-реєстрації взагалі (лише mock/тести, не production YAML) — додано реєстрацію + обидва підписи, щоб не протікало англійською де б не з'явилось.
- Новий permanent regression-тест (`test_entity_id_collision.js`, тепер 16/16, було 8): доводить (a) усі 3 numbered-series regex-и використовують реальний формат ключа, (b) `cycle_capacity` узгоджено всюди, (c) **кожен досяжний `registerEntity()`-ключ має і EN, і UK запис у `DIAGNOSTIC_ENTITY_LABELS`** — перевірено, що тест ловить регресію (тимчасовий revert → 8 FAIL).
- Жива перевірка в Browser pane (двічі, до і після останнього фіксу) проти demo mock-сервера підтверджує: `Опір проводу комірки 01…16`, `Температура 1/2/4/5`, `Балансування активне`, `Заряд активний`, `Розряд активний`, `Модель BMS`, `Усього віддано`, `Причина перевизначення контролю` — усе тепер коректно українською, у правильному порядку, з одиницями.
- `bash test/run_all.sh` — реальний exit 0, "All suites passed." `esphome config` — Valid (зміна суто JS).

**Свідомо залишено відкритим (за прямим рішенням користувача, не моїм вибором обсягу):** "regression DOM test перевіряє exact order для 1S/4S/8S/16S" — буквально вимагає реальної E2E-інфраструктури (`jk_bms.js` авто-завантажує повний застосунок через `EventSource`/`fetch`/`matchMedia`/`requestAnimationFrame` при завантаженні; jsdom із коробки жодного з цих API не надає). Перевірено технічну можливість (`npm install jsdom` працює в цьому середовищі), але побудова робочого полу-філа — це той самий обсяг роботи, що вже track-иться як P1-09 (навмисно відкладений протягом усього аудиту як велика інфраструктурна інвестиція). Користувачу прямо запропоновано: (1) вважати P1-05 закритим, (2) побудувати jsdom-інфраструктуру зараз, або (3) залишити цей один критерій відкритим під P1-05. Обрано (3).

Критерій: усі назви/enum/reason codes мають UK/EN словник; напруги та опори строго `01…N`; regression DOM test перевіряє exact order для 1S/4S/8S/16S. **Виконано**: словник (усі 100+ досяжних ключів, EN+UK, з permanent-тестом), нумерація `01…N` (комірки за напругою й опором). **НЕ виконано**: checked-in DOM/browser regression test.

### P1-06. «Діагностика» має неправильну семантику й заголовки

Реальний UI досі показує «ЗНАЧЕННЯ ПАРАМЕТРІВ BMS» і «Фактично отримано від ESPHome», хоча таблиця містить суміш resolver, topology, Wi-Fi/IP та transaction fields; частина назв і значень не локалізована (`Topology state`, `CONFIRMED`, `NA`, `Write tx snapshot`).

Критерій: окремі секції «Розраховано ESPHome» та «ESP32 / браузер / UI»; жодних BMS register rows; короткі локалізовані назви та локалізовані enum/reason values.

### P1-07. Одиниці DRY/LCD-порогів не визначаються за обраним trigger source

На hardware UI числові threshold/recovery поля сухих контактів показані без одиниць. Їхня фізична величина залежить від джерела тригера.

Критерій: каталог містить enum source та залежну unit/scale/range mask; UI динамічно показує правильну одиницю й валідує діапазон; невідомий source блокує запис.

### P1-08. 60-годинна історія не має production persistence

Поточні `/history.json` і `/charge_history.json/0` читаються, але buffer RAM-only. Після reboot/power loss історія втрачається; LittleFS PoC не підключений до production.

Критерій: production A/B LittleFS storage, CRC/recovery, topology epoch, реальні reboot/OTA/power-loss/wrap тести та 60+ годин hardware soak.

### P1-09. Немає відтворюваного browser E2E та повного security test suite

Немає CI-набору для фокуса/каретки, двотактного toggle confirm, exact tx correlation, green/red 1-second states, reload/out-of-order SSE, responsive/mobile, accessibility. Не перевірені CSRF/Origin, rate limiting і негативні 401/403/405/415/422/429 сценарії.

Критерій: Playwright/еквівалент у репозиторії + security integration tests, що працюють і проти mock, і в hardware-safe профілі.

### P1-10. Реальна динамічна зміна топології ще не перевірена

На hardware підтверджено лише стабільний 16S стан. 1S/4S/8S/16S проходять mock-тести, але не реальну послідовність write→ACK→readback→resolver→усі UI consumers.

Критерій: лабораторний fixture, безпечна зміна 16↔8 або інші підтримані конфігурації; cards/bars/min/max/target voltage/history epoch та всі обчислення оновлюються атомарно; повернення до 16S підтверджене.

### P1-11. Не виконані hardware fault/behavior тести

Не перевірені: Wi-Fi reconnect, BMS disconnect/reconnect, ACK/readback loss, protection trip, реальний balancing active та рух іскорки, charge/discharge under load, native API encryption, OTA password, power-loss recovery.

Критерій: `HARDWARE_VALIDATION_CHECKLIST.md` виконаний на стенді без відкритих P0/P1.

### P1-12. HTTP transport і CORS потребують оформленої моделі загроз

Digest auth реально захищає всі перевірені GET endpoints, але HTTP не шифрує телеметрію/команди; відповіді мають `Access-Control-Allow-Origin: *`; порти web/API/OTA доступні у LAN. Це може бути прийнятно лише для trusted LAN/VPN зі строгими секретами й мережевою сегментацією.

Критерій: задокументована threat model; Origin/CSRF policy для write endpoints; wildcard CORS прибраний або обґрунтований; перевірені API encryption й OTA auth; credential rotation після аудиту.

### P1-13. `registers.canonical.json`'s `esphome_read_entity_id` розійшовся з реальними сутностями

**ЗАКРИТО 2026-09-10 (десятий прохід)** — див. підсумок на початку файлу.

~~Знайдено побічно під час закриття P1-04 (2026-09-10), не виправлено цим проходом. Canonical каталог заявляє `cell_rcv -> esphome_read_entity_id: "cell_rcv"` та `cell_rfv -> "cell_rfv"`, але в `batterylifepo4.yaml` немає сутностей з такими іменами взагалі — реальні (`registerEntity()`-зареєстровані) сутності називаються `cell_request_charge_voltage`/`cell_request_float_voltage`~~ — **ЦЕ БУЛО ПОМИЛКОВИМ ТВЕРДЖЕННЯМ**, виправлено в наступному проході: `cell_rcv`/`cell_rfv` насправді КОРЕКТНІ (методологічна помилка — я звіряв внутрішній YAML `id:` замість справжнього `name:`-похідного wire-імені; `name: "cell RCV"` дійсно слагіфікується у `cell_rcv`). Це вже незалежно доведено окремим тестом `test_entity_id_collision.js` ("Крок M"), який існував до цього проходу.

Реальні, підтверджені прямою звіркою розбіжності (виправлено): `balancing_active -> esphome_read_entity_id` мав бути `"balancing"` (не `"balancing_active"`; реальна сутність — шаблонний сенсор `id: balancing`, `registerEntity("balancing_active", "binary_sensor", "balancing", "balancing")` підтверджує це напряму); `temperature_5 -> esphome_read_entity_id` мав бути `"temperature_sensor_5"` (не `"jkbms_bat_temp4"` — це внутрішній YAML `id:`, а не реальне `name:`-похідне wire-ім'я; `name: "temperature sensor 5"` слагіфікується у `temperature_sensor_5`).

Підтверджено: `esphome_read_entity_id` НЕ споживається жодним згенерованим артефактом (`register_catalog.json`, `PROTOCOL_CATALOG` у `jk_bms.js`) — суто документаційне поле каталогу, тому виправлення не мало жодного впливу на runtime-поведінку.

Виправлено: обидва значення в `protocol/registers.canonical.json`; перегенеровано похідні артефакти (`node tools/protocol/generate.js`); новий permanent regression-тест у `test/protocol_catalog/test_entity_id_collision.js`, що звіряє КОЖЕН `esphome_read_entity_id` з відповідним реальним `registerEntity()`-викликом (не проти сирих YAML `id:`) — підтверджено, що тест справді ловить обидва баги (тимчасовий revert → `FAIL ... mismatches=2`).

Критерій закриття: звірити КОЖЕН `esphome_read_entity_id`/`esphome_write_entity_id` у `registers.canonical.json` проти реальних `registerEntity()`-викликів у `jk_bms.js`. **Виконано для `esphome_read_entity_id`.** `esphome_write_entity_id` має власний (окремий) валідатор у `test/register_catalog/validate.js`, не перевірявся цим проходом.

## P2 — якість та експлуатація

- **P2-01: ЗАКРИТО 2026-09-14 (Фінальна підготовка, Phase 2B).** `docs/AUTH_AND_HISTORY.md`'s "What changed in batterylifepo4.yaml" section now explicitly distinguishes a **Historical note** (ESPHome 2026.6.5, no `type:` key, Basic auth implicitly) from **Current state** (ESPHome 2026.8.2 per `toolchain.lock.json`, `type: digest` explicit at `batterylifepo4.yaml:310-328`, with that block's own in-line comment quoted as the reasoning) — was: `docs/AUTH_AND_HISTORY.md` досі описує Basic auth/ESPHome 2026.6.5, тоді як production YAML і hardware використовують Digest/2026.8.2. Commit `ad2282d10dfabaf4fe54844ce53240b690370202` ("docs: align authentication history with current configuration").
- **P2-02:** навігаційний accessibility label `Sections` не локалізований.
- **P2-03:** firmware string `v3.0.0` жорстко заданий у JS, а не отриманий з build metadata.
- **P2-04:** mDNS під час аудиту працював нестабільно; прямий IP був стабільний. Потрібен повторний тест з іншого клієнта/телефона перед висновком, що дефект саме у firmware.
- **P2-05:** лічильники результатів запису існують лише у поточній browser session і не є журналом backend-транзакцій.

## Правило початку реалізації

Спочатку закрити P0-01…P0-06 архітектурно та тестами. Лише після цього переходити до UI-cleanup/P1. Жодна реалізація не може отримати статус «Готово», доки реальний hardware checklist, fault injection, packed-register preservation та dynamic topology transition не пройдені без відкритих P0/P1.
