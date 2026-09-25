> **ARCHIVED — historical record, not current and not an implementation queue.**
> Moved here in the 2026-09-25 repository cleanup (full pre-move state: branch
> `checkpoint/pre-repository-cleanup-2026-09-25`). Paths, counts and statuses
> below reflect the date written. Current state: [PROJECT_STATE](../../project/PROJECT_STATE.md);
> current plan: [RS485_UNIFIED_PARAMETER_PIPELINE_PLAN](../../project/RS485_UNIFIED_PARAMETER_PIPELINE_PLAN.md);
> archive index: [docs/archive/README.md](../README.md).

# Послідовний план виправлення та завершення JK BMS Web UI

**Базовий статус:** `НЕ ГОТОВО`  
**Дата базового аудиту:** 2026-09-09  
**Джерела:** `OPEN_ISSUES.md`, `HARDWARE_AUDIT_2026-09-09.md`, `HARDWARE_VALIDATION_CHECKLIST.md`, поточний код і реальна read-only телеметрія ESP32 + JK BMS.

Цей документ є планом виконання, а не декларацією намірів. Етап дозволено закрити лише тоді, коли виконані всі його exit-критерії та збережені перелічені докази. Перехід до наступного контрольного шлюзу при відкритому блокувальному дефекті заборонений.

## 1. Кінцева мета

Побудувати production-систему, у якій:

1. усі BMS-параметри мають підтверджене походження, адресу, тип, scale, unit, access і порядок;
2. жоден запис не вважається успішним за HTTP 200, звичайним SSE entity update або припущенням frontend;
3. кожен запис корелюється з однією конкретною backend-транзакцією;
4. запізнілий ACK/readback не може змінити іншу транзакцію;
5. timeout ніколи не маскується як остаточна невдача або успіх: система входить у явний невизначений стан і відновлює істину читанням;
6. packed-регістр не записується без свіжого pre-read та перевірки збереження sibling bits;
7. кількість активних комірок визначається runtime topology resolver, а не фіксованою константою;
8. усі UI consumers атомарно використовують один підтверджений topology snapshot;
9. Settings містить лише BMS-регістри, Diagnostics — лише ESPHome/ESP32/browser/UI діагностику;
10. 60-годинна історія переживає reboot, OTA, wrap та контрольовану втрату живлення;
11. web/API/OTA мають перевірену модель загроз і негативні security-тести;
12. статус `Готово` підтверджений автоматичними тестами, реальним hardware checklist і тривалим soak-тестом.

## 2. Незмінні правила реалізації

- До закриття етапів 0–8 не виконувати production-записи на робочій батареї.
- Зміна CellCount дозволена лише на лабораторному fixture, фізична топологія якого справді відповідає новому значенню.
- Не змінювати protection thresholds або MOSFET controls під навантаженням без окремої затвердженої процедури та фізичного аварійного відключення.
- `MAX_CELL_COUNT = 16` дозволений лише як перевірена верхня межа буферів. Він не може використовуватися як фактична topology.
- Mock, unit test, compile та HTTP 200 не є заміною реального ACK + forced readback + hardware verification.
- Frontend не приймає safety-рішень. Він відображає versioned snapshots і terminal verdicts backend.
- Секрети не передаються в URL/query string, не логуються, не публікуються через SSE і не потрапляють до diagnostic snapshots.
- Кожен етап завершується оновленням traceability matrix, тестів, документації та evidence log.

## 3. Контрольні шлюзи

| Шлюз | Після етапу | Що дозволяє | Обов'язкова умова |
|---|---:|---|---|
| G0 — Baseline locked | 1 | Почати архітектурну реалізацію | Відтворюваний baseline, каталог джерел і rollback |
| G1 — Write path safe in software | 8 | Перейти до topology/UI integration | Закриті P0-01…P0-06, exact tx tests, packed tests, zero false success |
| G2 — Release candidate for lab | 14 | Прошивати ізольований стенд | Повний software/security/E2E gate, production build artifacts |
| G3 — Hardware candidate | 15 | Почати soak/power-loss validation | Увесь hardware functional/fault checklist PASS, без P0/P1 |
| G4 — Ready | 16 | Статус `Готово` | 72h soak, persistence/security/recovery PASS, підписаний evidence package |

## Етап 0. Замороження небезпечних операцій і фіксація baseline

### Проблема та межі

Поточний frontend має кнопки запису, але P0-дефекти дозволяють хибне підтвердження та невизначений стан. Потрібно зберегти робочий read-only стан і створити контрольовану точку повернення. На цьому етапі firmware behavior не змінюється.

### Оптимальне рішення

Увести формальний режим `AUDIT/READ_ONLY` для development і production-аудиту, зафіксувати git commit, build manifest, поточні BMS-значення та копії конфігурації. Заборона запису має бути backend-рівня, а не лише disabled-кнопкою.

### Роботи

1. Створити release branch/tag для стану 2026-09-09 та зберегти `git status`, commit SHA, hashes JS/CSS, ESPHome/ESP-IDF/toolchain versions.
2. Додати compile-time/runtime прапорець `JK_BMS_WRITE_ENABLED`, default `false` для audit profile.
3. При `false` backend має повертати `403 WRITE_DISABLED`; Modbus write command не формується.
4. UI показує постійний read-only banner і не створює optimistic state.
5. Зняти read-only baseline усіх entities і BMS-регістрів у JSON без секретів.
6. Записати поточні значення RW-регістрів у rollback manifest із timestamp, device model і firmware build ID.
7. Ротувати web-пароль, який використовувався під час аудиту; перевірити, що старий більше не приймається.

### Артефакти

- `docs/BASELINE_2026-09-09.md`;
- `artifacts/baseline-registers-<device>-<timestamp>.json` без secret values;
- audit build profile;
- документована процедура rollback.

### Перевірки

- unit test: write disabled не викликає transport callback;
- integration test: кожен write endpoint повертає 403 у audit profile;
- read endpoints і SSE продовжують працювати;
- baseline JSON проходить schema validation і не містить credential patterns.

### Exit-критерії

- Відомо, який саме код і binary перевіряються.
- Існує відновлюваний snapshot усіх не секретних RW-значень.
- У read-only profile неможливо надіслати Modbus write навіть прямим HTTP-запитом.
- Старі web credentials відкликані.

## Етап 1. Авторитетна модель протоколу та повний каталог R/RW

### Дефекти

Закриває основу P1-03 і P1-07. Чинний `register_catalog.json` має лише 47 RW-рядків, не містить read-only регістрів і має unit drift для `scp_delay`, `rcv_time`, `rfv_time`. Евристичний пошук літерала адреси не доводить правильність зв'язку.

### Оптимальне рішення

Створити єдину versioned machine-readable protocol schema. Джерелами істини мають бути: підтверджена таблиця JK для конкретної PB-моделі/firmware, наданий workbook, поточний YAML, read-only hardware snapshot і контрольований Modbus capture. При конфлікті поле позначається `unverified` та лишається read-only.

### Обов'язкова схема поля

Для кожного фізичного регістра й логічного sub-field зафіксувати:

- `key`, `protocol_family`, `model_scope`, `firmware_scope`;
- `address`, `register_width_bits`, `field_width_bits`, `byte_offset`, `mask`, `shift`;
- endian, signedness, wire type, scale, offset;
- canonical unit і UK/EN display units;
- access `r` або `rw`;
- min, max, step, enum map, reserved values;
- packed siblings та overlap rules;
- read poll group і freshness budget;
- ESPHome entity ID, backend key, UI order, section;
- write safety class: normal, disruptive, topology, credential, unsupported;
- evidence source і verification status.

### Роботи

1. Розібрати всі адреси YAML та workbook у normalized schema.
2. Зіставити кожну entity із конкретним register/sub-field; заборонити many-to-one без packed metadata.
3. Верифікувати `0x111C`, `0x1504`, `0x14E4`, `0x14E6` на рівні byte/mask/sibling.
4. Виправити units: SCP delay — `µs/мкс`; RCV/RFV time — `h/год`, якщо це підтверджено hardware і протоколом.
5. Окремо описати dynamic units DRY/LCD trigger values за source enum.
6. Позначити calculated ESPHome та ESP32/UI fields окремим dataset, не register catalog.
7. Створити JSON Schema і генератор для C++ metadata, ESPHome declarations, frontend labels/order та mock fixtures.
8. Переписати validator: точне AST/structured зіставлення, а не пошук рядків.

### Межі

- Невідома адреса або непідтверджений access не вгадується.
- Поле `unverified` показується read-only і не отримує write endpoint.
- Локальний `device_name_override` не є BMS-регістром і живе в окремому config catalog.

### Перевірки

- 100% YAML BMS entities мають catalog mapping або documented exclusion;
- 100% catalog fields мають source evidence;
- немає overlapping masks поза явно визначеними packed groups;
- round-trip encode/decode tests для boundary/min/max/negative values;
- validator навмисно падає при wrong address, scale, unit, access, mask, order та missing register.

### Exit-критерії

- Каталог містить усі підтверджені R/RW-регістри та не змішує non-register entities.
- Немає unit/address/access drift.
- Усі генератори детерміновані; regenerated tree чистий у git.
- Кожен непідтверджений register явно заблокований для запису.

## Етап 2. Архітектурний контракт транзакцій і даних

### Дефекти

Формує основу закриття P0-01, P0-02, P1-01, P1-02 і P2-05. Нинішній контракт розсипаний між стандартними ESPHome endpoints, entity SSE та короткоживучим snapshot.

### Оптимальне рішення

Затвердити ADR для одного custom backend transaction API поверх `web_server_base`. Стандартні `/number/.../set`, `/select/.../set`, `/text/.../set` не використовуються frontend для BMS writes.

### Контракт

1. `POST /api/v1/bms/writes` приймає JSON `{client_request_id, key, value, catalog_version}`.
2. Успішне прийняття повертає `202` і `{accepted:true, boot_id, tx_id, key, address, state:"QUEUED"}`.
3. Validation failure — `400/422`; write disabled — `403`; address busy — `409`; rate limit — `429`; BMS offline — `503`.
4. `GET /api/v1/bms/transactions/{boot_id}/{tx_id}` повертає поточний/terminal snapshot.
5. SSE публікує versioned transaction events із exact `{boot_id,tx_id}`.
6. `client_request_id` забезпечує idempotency: повторний POST повертає ту саму транзакцію, а не створює новий write.
7. `boot_id` змінюється після reboot і не дозволяє старому tx_id корелюватися з новою сесією.

### Versioned transaction snapshot

Мінімальні поля: schema version, boot ID, transaction ID, client request ID, logical key, physical address, generation, width, mask, requested typed value, requested raw, state, reason code, created/write/ack/readback/finished timestamps, readback typed/raw, recovery attempt, freshness і redaction flag.

### Межі

- Максимальний request body і JSON depth обмежені.
- Жодних passcode values у response/event/log.
- Entity telemetry не є transaction verdict.
- Terminal history відділена від active slot storage.

### Перевірки

- OpenAPI/JSON Schema contract tests;
- duplicate idempotency request;
- two browsers writing different keys;
- two browsers writing packed siblings;
- stale event from old boot ID;
- tx_id wrap test;
- malformed/oversized JSON and unsupported catalog version.

### Exit-критерії

- ADR і схема затверджені до C++ реалізації.
- Для кожного status визначені дозволені переходи й HTTP/SSE representation.
- Відсутній шлях, у якому HTTP 200/202 означає physical success.

## Етап 3. Перебудова C++ transaction core і generation-safe callbacks

### Дефект

Безпосередньо закриває P0-03. Terminal slot зараз може бути повторно використаний, а callback захоплює лише індекс.

### Оптимальне рішення

Розділити active transaction slots і terminal result ring. Кожен active slot має immutable identity `{boot_id,tx_id,generation,address}`. Callback може змінювати slot лише після повної identity check.

### Роботи

1. Перенести state machine з YAML lambda до окремого C++ component.
2. Увести `TransactionHandle` і `CallbackToken` з generation.
3. Зробити per-physical-address lock; packed siblings мають один lock key.
4. Не звільняти active resources через frontend retention timer. Terminal result копіюється до окремого bounded ring.
5. Late callback після terminal/reuse логувати як `STALE_CALLBACK_DROPPED`, без мутації state.
6. Використовувати wrap-safe unsigned time arithmetic.
7. Усі масиви й JSON buffers — bounded; перевірити RAM budget і fragmentation.

### Стани core

`QUEUED -> PRE_READ -> WRITE_SENT -> ACK_WAIT -> VERIFY_READ -> CONFIRMED | MISMATCH | WRITE_UNCERTAIN | REJECTED`. Recovery переходи реалізуються на етапі 5. Неможливі переходи повинні завершуватися internal error без write retry.

### Перевірки

- deterministic late ACK after slot reuse;
- deterministic late readback after slot reuse;
- wrong generation/address/tx ID callback;
- simultaneous different addresses;
- simultaneous same address;
- slot exhaustion;
- millis wrap;
- reboot/new boot ID;
- sanitizer-enabled host tests.

### Exit-критерії

- Жоден callback без exact identity не змінює транзакцію.
- Single-flight діє за фізичною адресою.
- Unit suite має окремі regression tests для race, а не лише happy path.
- C++ core не залежить від DOM, mock або YAML timing assumptions.

## Етап 4. Реалізація безпечного backend API та явного REJECTED

### Дефекти

Закриває P0-01, P0-02, P1-01 і частину P1-02. Стандартний ESPHome endpoint повертає HTTP success до відомого результату script.

### Оптимальне рішення

Custom handler виконує parse/authorization/validation/allocation синхронно до `202`. Якщо slot не виділено, клієнт одразу отримує правильну помилку. Фізичний результат надходить окремим transaction event.

### Роботи

1. Зареєструвати bounded HTTP handler у перевірений API ESPHome 2026.8.2.
2. Приймати тільки `POST`, `Content-Type: application/json`, допустимий body size і known `Host/Origin`.
3. Виконувати lookup metadata лише за catalog key; client не задає адресу/mask/raw.
4. Validate type/range/step/enum до allocation.
5. Перевіряти BMS freshness та write-enabled policy.
6. Виділяти tx, повертати `202` exact handle, після цього ставити Modbus command у queue.
7. Повертати структуровані reason codes для всіх відмов.
8. Публікувати transaction status окремо від telemetry entity.
9. Вимкнути/видалити frontend використання legacy write endpoints; backend legacy endpoints закрити або не експонувати.

### Перевірки

- HTTP matrix `400/401/403/404/405/409/413/415/422/429/503`;
- busy same-address request ніколи не повертає 200/202;
- accepted response завжди містить exact handle;
- SSE duplicate/out-of-order events не змінюють terminal result;
- звичайний entity poll зі старим requested value не створює false success.

### Exit-критерії

- P0-01, P0-02 і P1-01 мають automated regression tests.
- Клієнт може однозначно відрізнити rejected request від accepted-but-pending.
- Усі BMS writes проходять лише через новий handler.

## Етап 5. `WRITE_UNCERTAIN`, recovery probe та authoritative restore

### Дефект

Закриває P0-04. Timeout не означає, що BMS не застосувала write; автоматичне повернення cached value також не встановлює істину.

### Оптимальне рішення

Після ACK/readback timeout адреса переходить у `WRITE_UNCERTAIN`. Повторний write заборонено. Backend виконує лише незалежні read probes з bounded backoff; ніколи автоматично не повторює write.

### Роботи

1. Додати states `WRITE_UNCERTAIN`, `RECOVERING`, `RECOVERED_CONFIRMED`, `RECOVERED_MISMATCH`, `RECOVERY_FAILED`.
2. Зберігати expected raw, pre-write raw і catalog decode metadata.
3. Запускати read probe після відновлення BMS freshness; backoff і max duration конфігуровані.
4. Якщо actual=requested — recovered confirmed; якщо actual=pre-write/інше — recovered mismatch із authoritative actual.
5. Якщо зв'язок не відновився — persistent unresolved alert, а не синя `OK`.
6. UI тримає editor locked amber до recovery terminal state.
7. Diagnostics показує reason, age, attempts і actual після recovery без secret data.

### Перевірки

- write applied + ACK lost;
- write not applied + ACK lost;
- ACK received + readback lost, applied/not applied;
- BMS offline протягом recovery;
- reboot під час uncertain state;
- ordinary telemetry arrives before recovery probe;
- user retries while address uncertain.

### Exit-критерії

- Немає auto-rewrite після timeout.
- Немає auto-rollback до кешу.
- Кожний timeout завершується authoritative recovered state або явним unresolved alarm.
- Exact tx history зберігає первинний і recovery verdict.

## Етап 6. Атомарний packed-register read-modify-write

### Дефект

Закриває P0-05. Cached sibling і `mask:-1` можуть пошкодити інше логічне поле.

### Оптимальне рішення

Окремий transaction subtype: lock physical address, fresh pre-read повного слова, merge catalog-owned bits, write merged word, ACK, forced full-word readback, перевірка requested bits і sibling invariant.

### Роботи

1. Підтвердити metadata `0x111C`, `0x1504`, `0x14E4`, `0x14E6` на етапі 1.
2. Заборонити packed write, якщо pre-read failed/stale/short.
3. Обчислювати `merged = (fresh & ~mask) | encoded(value)` лише в C++ backend.
4. Перевіряти повне expected word; окремо класифікувати requested mismatch і sibling changed.
5. Серіалізувати sibling writes одним address lock.
6. Публікувати verified decoded values усіх siblings однією атомарною подією.
7. При зовнішній конкурентній зміні перейти в mismatch/uncertain, не перезаписувати повторно.
8. Для непідтвердженого `0x14E6` лишити поле read-only.

### Перевірки

- кожний sibling змінюється окремо, другий незмінний;
- negative INT8 boundaries для heating;
- low/high byte tests;
- external sibling mutation між pre-read і verify-read;
- two-browser sibling collision;
- short frame, timeout, stale pre-read;
- hardware fixture preservation для кожної packed group.

### Exit-критерії

- Production code реально використовує catalog masks; тест не перевіряє мертву семантику.
- Жоден packed write не використовує cached ESPHome entity як pre-read.
- Hardware-тест підтверджує sibling preservation.

## Етап 7. Уніфікація CellCount і passcode як policy-specific транзакцій

### Дефекти

Закриває P0-06 та залишок P0-01 для CellCount. Дві окремі state machines збільшують розбіжність і не дають єдиного exact contract.

### Оптимальне рішення

Один transaction engine, але різні policy hooks:

- `NORMAL_REGISTER`: ACK + forced register readback;
- `PACKED_REGISTER`: pre-read/merge + ACK + verify;
- `TOPOLOGY_REGISTER`: ACK + CellCount/mask/cell-block readback + resolver confirmation;
- `SECRET_REGISTER`: ACK + server-side verification із повною redaction.

### CellCount роботи

1. Використовувати exact `{boot_id,tx_id}`.
2. Після register readback вимагати один fresh coherent topology snapshot.
3. Успіх лише при `readback=requested`, `topology_state=CONFIRMED`, `effective=requested`, compatible mask і voltage sum.
4. При uncertainty зберігати last confirmed topology, але не називати її поточною підтвердженою.
5. Заборонити CellCount write без lab mode/explicit safety unlock.

### Passcode роботи

1. Передавати secret лише JSON body, не URL.
2. Не зберігати requested/readback raw у snapshot, history або log.
3. Frontend очікує backend terminal status, а не HTTP response.
4. Якщо протокол дозволяє raw readback — compare виконується тільки всередині backend і результат redacted.
5. Якщо raw verify неможливий — показувати точний статус `ACKNOWLEDGED_NOT_VERIFIABLE`, а не `CONFIRMED`.
6. Очистити input і JS references після terminal result; заборонити browser persistence/autocomplete.

### Перевірки

- stale CellCount status з іншого tx;
- CellCount register changed, physical topology inconsistent;
- applied ACK lost і recovery;
- passcode ACK timeout/readback timeout/mismatch;
- перевірка logs/SSE/DOM/URL/heap-oriented dumps на відсутність secret;
- reload і другий браузер під час обох типів транзакцій.

### Exit-критерії

- CellCount і passcode мають той самий transaction identity/lifecycle contract.
- Немає false green для topology або password.
- Секрет не виходить за межі мінімального backend buffer.

## Етап 8. Frontend transaction client і точна UX-машина станів

### Проблема

Чинний frontend паралельно довіряє entity revisions і transaction snapshot, не має exact request identity та неправильно завершує passcode. Це також джерело попередніх дефектів кнопок, відновлення значення і зникнення каретки.

### Оптимальне рішення

Створити один `TransactionClient`, який працює тільки з API етапу 4. Компоненти UI отримують state updates за exact handle і не читають transaction success із telemetry store.

### Роботи

1. Генерувати `client_request_id` для кожної явної дії.
2. Після `202` зберігати exact handle; на reload відновлювати pending status через GET без повторного write.
3. Ігнорувати event з іншим boot ID/tx ID/key/address.
4. Numeric button lifecycle:
   - blue `OK`, enabled;
   - muted orange `>>`, disabled;
   - muted green `✓` рівно 1 секунду після confirmed, disabled;
   - muted red `×` рівно 1 секунду після authoritative mismatch, actual value restored, disabled;
   - persistent amber uncertain/recovering, disabled;
   - потім blue `OK` лише після terminal safe state.
5. Toggle lifecycle: перша дія — amber armed confirmation; друга — send; окрема `OK` відсутня; timeout arm повертає authoritative value.
6. Усі updates виконувати keyed patching без повного `replaceChildren()` для editor list.
7. Не змінювати focused/dirty input із telemetry; після mismatch відновити exact decoded readback.
8. Забезпечити keyboard, screen reader, reduced motion і touch targets.

### Межі

- Frontend не обчислює raw register values.
- Frontend не повторює write автоматично після network error.
- `CONFIRMED` показується лише від transaction engine.

### Перевірки

- cursor/focus не зникає під час SSE/rebuild;
- requested equals old value + lost ACK не дає green;
- mismatch відновлює старе/actual значення;
- кнопка заблокована в усіх non-OK states;
- result state триває 1000 ms із допустимою timer похибкою;
- reload, duplicate SSE, out-of-order SSE, two tabs, offline/reconnect;
- passcode не з'являється в URL/history/log.

### Exit-критерії G1

- Усі P0-01…P0-06 закриті кодом і regression tests.
- Legacy confirmation через entity revision видалена.
- Software fault matrix не має false success, lost update або stale callback.
- Відкритих P0 немає. Тільки після цього дозволено переходити до topology/UI integration.

## Етап 9. Pure C++ topology resolver та атомарний topology snapshot

### Дефекти

Закриває software-частину P1-10 і зменшує ризик розбіжності YAML/mock. Поточний resolver — велика YAML lambda; consumers читають кілька entities, які можуть належати різним моментам часу.

### Оптимальне рішення

Перенести resolver у pure C++ library з immutable input snapshot і одним versioned output `TopologySnapshot`. Mock використовує незалежну reference model, а не копію production algorithm.

### Snapshot

Містить epoch/revision, state/reason, configured count, connected count/mask, measured count, effective count, last confirmed count, pack voltage, active cell sum, per-cell validity bitmap, source timestamps і freshness.

### Роботи

1. Визначити coherent sampling boundary для CellCount + mask + cell block + total voltage.
2. Заборонити змішування даних різних poll cycles.
3. Залишити fixed buffers на 16 channels, але всі loops/consumers використовують `effective_count` лише при confirmed snapshot.
4. Публікувати один atomic JSON/binary snapshot; окремі sensor mirrors — лише presentation.
5. При `LOADING/OFFLINE/MISMATCH/INVALID/WRITE_UNCERTAIN` застосовувати документовану safe display policy.
6. Підвищувати `topology_epoch` лише після підтвердженої зміни topology.
7. Прив'язати history segmentation до epoch.

### Перевірки

- 1S, 4S, 8S, 16S;
- invalid 0/17;
- contiguous/non-contiguous mask;
- active-range gap, NaN, stale cell;
- extra phantom voltage;
- pack sum mismatch tolerance boundaries;
- reboot/reconnect/mixed-generation inputs;
- CellCount change mid-sample;
- property tests із випадковими masks/values.

### Exit-критерії

- Один production resolver, одна documented reference model, жодної ручної JS-копії як доказу.
- Consumers не збирають topology з окремих несинхронних entities.
- Topology epoch стабільний і змінюється тільки після підтвердження.

## Етап 10. Повна адаптація всіх consumers до dynamic topology

### Проблема

Статичний 16S hardware snapshot працює, але реальний 16↔8 transition не перевірений. Історично cards, bars, voltage target і totals оновлювалися неузгоджено.

### Оптимальне рішення

Усі залежні значення отримують один `TopologySnapshot` revision і перераховуються в одній render transaction.

### Повний перелік consumers

1. cell voltage bars і labels;
2. resistance bars і labels;
3. cell cards;
4. min/max/average/delta та highlighted cells;
5. min-max flow/particle geometry;
6. modal history selector;
7. active cells voltage sum;
8. pack-vs-cell-sum diagnostics;
9. charge/float target voltage;
10. chart domains, grid widths і responsive layout;
11. Settings rows cell voltage/resistance;
12. history payload/epoch/window;
13. accessibility labels і counts;
14. offline/mismatch placeholders.

### Роботи

1. Створити selector/view-model, який приймає тільки confirmed topology snapshot.
2. При epoch change атомарно очистити старі N-dependent arrays і сформувати нові.
3. Не показувати channels `N+1…16`; не використовувати їх у статистиці.
4. Target: `effective_count × phase-specific per-cell target`; при невідомій phase/target — явне `Н/Д` із reason, не stale value.
5. Particle існує лише при `balancing_active=true`, meaningful delta, fresh confirmed topology і motion allowed.
6. Перевірити, що ліва вертикальна межа поля «СЕРЕДНЄ» відсутня.

### Перевірки

- DOM snapshot 16→8→16 без reload;
- exact counts для всіх 14 consumers;
- target voltage 8S/16S для charge і float;
- min/max indexes після зменшення topology;
- stale channels не впливають на статистику;
- animation starts/stops лише за actual balancing state;
- desktop/tablet/mobile portrait/landscape.

### Exit-критерії

- Один topology revision приводить весь UI до одного N у тому самому frame.
- Немає phantom bars/cards/rows/values.
- Немає старого voltage target після epoch change.
- Mock E2E 1/4/8/16 PASS; hardware transition лишається gate етапу 15.

## Етап 11. Розділення Settings/Diagnostics, порядок, переклад і одиниці

### Дефекти

Закриває P1-04, P1-05, P1-06, P1-07, P2-02 та UI-регресії попередніх ітерацій.

### Оптимальне рішення

UI будується з каталогів, а не з евристик raw SSE object IDs.

### Settings

- Джерело — тільки protocol catalog.
- Рівно один рядок на logical field.
- `r` — value only; `rw` — editor/toggle за policy.
- Порядок — catalog `ui_order`, включно з `Cell voltage 01…N`, потім `Cell wire resistance 01…N`.
- Non-register ESPHome/ESP32/UI fields відсутні.
- Units знаходяться всередині input mask; UK використовує `В`, `А`, `Ом`, `мОм`, `мкс`, `с`, `год`, `А·год`; EN — `V`, `A`, `Ω`, `mΩ`, `µs`, `s`, `h`, `Ah`.
- Dynamic DRY/LCD unit/range визначаються source metadata; unknown source блокує editor.
- Passcode field має окрему width policy і не стискається разом із numeric fields.

### Diagnostics

- Секція «Розраховано ESPHome»: phase, candidate, direction, duration, communication quality, topology state/reason/freshness.
- Секція «ESP32 / браузер / UI»: Wi-Fi, IP, firmware/build/UI/catalog versions, browser connection, command statistics.
- BMS register values відсутні.
- Видалити заголовки «Значення параметрів BMS» і «Фактично отримано від ESPHome».
- Backend transaction log показує redacted exact results; browser-session counters чітко позначені або видалені.

### Локалізація

1. Усі labels, enum values, reason codes, units, aria-labels мають UK/EN entries.
2. Заборонити fallback до raw English у production; missing key помітний у CI.
3. Короткі назви мають однозначно описувати фізичний зміст.

### Перевірки

- catalog-to-DOM exact row/order test;
- жодного computed key у Settings;
- жодного register key у Diagnostics software sections;
- 100% translation coverage;
- numeric natural sort `01…16`;
- focused/dirty fields переживають live updates;
- input widths на 320/375/768/1280 px;
- visual regression light/dark UK/EN.

### Exit-критерії

- Hardware UI не містить змішаних або англомовних рядків в українському режимі.
- Послідовність і одиниці точно відповідають catalog/workbook.
- Усі раніше заявлені UI-вимоги мають automated regression test.

## Етап 12. Production persistence 60-годинної історії

### Дефект

Закриває P1-08. Поточна історія RAM-only; LittleFS PoC не підключений до production.

### Оптимальне рішення

Не записувати повний A/B snapshot щохвилини. Використати bounded segmented append journal у LittleFS із CRC кожного запису/segment, dual metadata/superblock, sequence number і topology epoch. До вибору cadence розрахувати flash wear budget.

### Роботи

1. Зафіксувати record schema, розмір, cadence, maximum 60h records і partition size.
2. Розрахувати worst-case writes/day, erase cycles/year та запас ресурсу flash.
3. Зберігати voltage/current/power/SOC/stage й topology epoch; cell arrays — лише якщо підтверджена потреба та бюджет.
4. Commit metadata атомарно; incomplete tail після power loss ігнорується.
5. На boot сканувати/валідувати CRC, відновлювати останню послідовність без boot loop.
6. На topology epoch change закривати segment; endpoint не змішує incompatible topology в одному series без явної межі.
7. Зберегти API `/history.json` і `/charge_history.json/<offset>` versioned та backward-compatible або оновити frontend одночасно.
8. Додати storage health diagnostics: mount state, recovered records, CRC failures, last commit age, wear estimate.

### Межі

- Storage failure не блокує BMS telemetry/control, але створює persistent diagnostic alarm.
- Corrupt data ніколи не видається як valid history.
- Partition table не прошивається на production pack до USB recovery test.

### Перевірки

- format unit/property tests;
- empty/full/wrap ring;
- truncated record, bad CRC, bad metadata, sequence wrap;
- reboot/OTA/power cut at each commit phase;
- topology change mid-history;
- 60h+ generated dataset;
- RAM/flash latency та watchdog budget;
- hardware LittleFS mount/read/write recovery.

### Exit-критерії

- Історія переживає reboot, OTA і контрольовану втрату живлення.
- Після corruption відновлюється останній valid prefix.
- 60h wrap і topology epochs коректні.
- Wear budget документований і прийнятний для заявленого строку служби.

## Етап 13. Security hardening web/API/OTA/network

### Дефект

Закриває P1-12 і security-частину P1-09. Digest працює, але HTTP не шифрує трафік, CORS wildcard активний, negative write/security matrix не виконана.

### Оптимальне рішення

Прийняти documented trusted-LAN/VPN threat model, мінімізувати attack surface ESP32 і зробити write API non-simple та same-origin. Якщо пристрій доступний поза trusted segment, потрібен TLS-terminating reverse proxy/VPN; прямий exposure в Internet заборонений.

### Роботи

1. Видалити wildcard CORS; default — same-origin без CORS.
2. Перевіряти `Host`, `Origin` і `Content-Type` для state-changing requests.
3. Додати boot/session CSRF token після authenticated GET; вимагати custom header.
4. Приймати лише JSON; query-string write endpoints вимкнути.
5. Rate limit per IP, per identity і per physical register address; bounded concurrent transactions.
6. Встановити request size/time limits, strict parsing і uniform errors без stack/internal data.
7. Перевірити Digest replay behavior, nonce lifetime і credential rotation procedure.
8. Підтвердити ESPHome native API encryption реальним unauthorized/authorized client test.
9. Підтвердити OTA password і відмову без нього; документувати USB recovery.
10. Не логувати secrets/raw passcode/auth headers; redaction tests.
11. Додати security headers, `Cache-Control: no-store` для API та sensitive UI.
12. Задокументувати VLAN/firewall rules: дозволені 80/6053/3232 лише management network; OTA порт закритий, коли не потрібен, якщо платформа дозволяє.

### Перевірки

- unauthenticated GET/POST;
- invalid/expired Digest nonce;
- cross-origin form POST і fetch;
- missing/wrong CSRF;
- wrong method/media type/body size;
- replayed client request ID;
- brute/rate-limit behavior;
- API client without encryption key;
- OTA without/with password;
- secret scan repository/build/log/SSE/DOM/network capture.

### Exit-критерії

- Усі negative status tests мають очікувані 401/403/405/409/413/415/422/429/503.
- Cross-origin write неможливий.
- API encryption й OTA auth підтверджені на hardware.
- Threat model, residual risks і deployment rules затверджені.

## Етап 14. Повна автоматизація QA, build reproducibility та observability

### Дефекти

Закриває software-частину P1-09, P2-01, P2-03, P2-05 і готує G2. Чинні 615 перевірок не покривають знайдені P0 race/contract defects; firmware version жорстко задана; документація суперечлива.

### Оптимальне рішення

Єдиний clean CI pipeline із traceability до кожного requirement/defect і відтворюваним build manifest.

### Обов'язкові suite

1. C++ unit + property/model tests transaction core.
2. Packed encode/decode/RMW tests.
3. Topology resolver unit/property tests.
4. History format/storage fault tests.
5. HTTP contract/security integration tests.
6. Modbus transport emulator із delayed/duplicate/lost/short/out-of-order frames.
7. Independent reference oracle; mock не копіює production state transitions рядок у рядок.
8. Playwright E2E для UK/EN, light/dark, desktop/mobile, keyboard/touch.
9. Accessibility suite та manual screen-reader checklist.
10. Visual regression для всіх вкладок і topology 1/4/8/16.
11. Static analysis, warnings review, host sanitizers, JS lint/type checks.
12. ESPHome config/compile на pinned production version і контрольній compatibility version.

### Обов'язкові UI regression cases

- немає лівої вертикальної лінії поля «СЕРЕДНЄ»;
- particle рухається тільки при actual balancing active і зупиняється при false/stale/offline;
- voltage target показує реальне phase target × effective cells;
- inputs мають узгоджену ширину, passcode field — окрему збільшену;
- unit усередині input mask і локалізована;
- binary dropdowns відсутні, використовуються confirmed toggles;
- кнопка `OK -> >> -> ✓/× -> OK` з блокуванням;
- mismatch відновлює readback;
- курсор/dirty value не зникає від SSE;
- Settings/Diagnostics classification/order/translation exact;
- dynamic topology перебудовує всі consumers без reload.

### Build/observability роботи

1. Пінувати ESPHome/ESP-IDF/toolchain dependencies.
2. Генерувати firmware version, git SHA, config hash, catalog schema version і build time у runtime entity/UI.
3. Замінити hardcoded `v3.0.0` build metadata.
4. Backend metrics: tx counts by terminal reason, stale callbacks dropped, uncertain/recovery, Modbus errors, queue depth, storage health, reboot reason.
5. Оновити `docs/AUTH_AND_HISTORY.md`; прибрати суперечності Basic/Digest і старі compile claims.
6. Перевірити mDNS на macOS/iOS/Android/Windows; відокремити client resolver problem від firmware issue.

### Exit-критерії G2

- Clean checkout одним documented command генерує каталог, запускає всі suite і збирає firmware.
- Нуль test failures, нуль unreviewed warnings, нуль catalog drift.
- Кожний P0/P1 має test ID та evidence.
- Build ID у UI відповідає прошитому binary.
- Release candidate дозволено переносити лише на ізольований lab fixture.

## Етап 15. Hardware-in-the-loop функціональна та fault validation

### Проблема

Закриває P1-10, P1-11 і hardware-частину інших дефектів. Поточний реальний аудит довів лише read-only 16S.

### Оптимальне рішення

Перевіряти release candidate не на робочій батареї, а на ізольованому керованому стенді з відтворюваними електричними режимами, транспортними відмовами й незалежним фізичним вимірюванням. Кожну операцію запису виконувати як завершений цикл `baseline -> write -> ACK -> forced readback -> physical check -> restore -> restore verification`; fault injection проводити тільки контрольованими засобами стенда, а не випадковим розривом робочої системи.

### Передумови

- G2 PASS;
- ізольований BMS fixture/bench pack із фізичним breaker;
- вимірювальні прилади та контрольовані charge/load sources;
- збережені original register values;
- USB recovery і rollback binary;
- письмова test procedure з abort conditions.

### Послідовність hardware tests

1. Flash/boot/build-ID/rollback verification.
2. Cold boot, watchdog, repeated reboot.
3. Wi-Fi AP loss/reconnect та mDNS на кількох клієнтах.
4. RS485 disconnect >30s/reconnect, resolver `OFFLINE -> CONFIRMED`.
5. Plain numeric RW: no-op write, changed write, restore original.
6. Control toggle: charge/discharge/balance permission, actual BMS behavior, restore.
7. Packed groups: змінити один sub-field у safe range, довести sibling preservation, restore.
8. ACK loss/readback loss/short frame/delay/duplicate callback fault injection.
9. `WRITE_UNCERTAIN -> recovery` applied і not-applied cases.
10. Two browser clients і idempotent retry.
11. Passcode transaction redaction/terminal result у контрольованій процедурі.
12. Dynamic topology на fixture: 16→8→16 або інші фізично валідні переходи.
13. Перевірити всі topology consumers, target, history epoch після кожного переходу.
14. Real balancing active: sensor, lamp, current і particle synchronization.
15. Charge/discharge under controlled load.
16. Safe protection event із перевіркою alarm/override без зміни control register.
17. API encryption, OTA auth, unauthenticated/cross-origin writes.

### Для кожного тесту записати

- firmware/build/catalog IDs;
- original/requested/readback values;
- boot ID, tx ID і timestamps;
- physical measurement;
- screenshot/log/network trace без секретів;
- PASS/FAIL і rollback result.

### Abort conditions

- unexpected MOSFET state;
- pack/cell voltage поза lab limits;
- BMS/ESP32 temperature rise;
- topology mismatch на підключеному pack;
- write uncertain, який не відновився у визначений budget;
- неможливість підтвердити rollback;
- будь-який P0 symptom.

### Exit-критерії G3

- Увесь `HARDWARE_VALIDATION_CHECKLIST.md` виконаний фактично, а не за mock.
- Усі значення відновлені до approved baseline.
- Немає відкритих P0/P1 або невирішених uncertain transactions.
- Evidence package дозволяє незалежно повторити кожний результат.

## Етап 16. 72-годинний soak, power-loss campaign і фінальний release gate

### Проблема

Коротка функціональна перевірка не доводить reliability, flash endurance, memory stability та 60h history wrap.

### Оптимальне рішення

Безперервний 72-годинний hardware soak із контрольованими topology/telemetry profiles, reconnects і power interruptions. 72 години дають повний 60h retention window і запас для wrap/recovery.

### Роботи

1. Логувати heap, largest free block, reboot reason, watchdog, queue depth, Modbus latency/errors, SSE reconnects, storage commits/CRC і history sample counts.
2. Виконати заплановані Wi-Fi/RS485 interruptions.
3. Виконати power cut у кожній storage commit phase на окремій campaign або programmable relay.
4. Перевірити OTA з наявною history та rollback.
5. Перевірити history oldest/newest boundaries після 60h і wrap.
6. Провести final security scan і secret scan.
7. Повторити smoke tests на телефоні та desktop після soak.
8. Сформувати immutable release manifest і остаточний readiness report.

### Метрики прийняття

- 0 unexpected reboot/watchdog/deadlock;
- 0 false confirmed transaction;
- 0 lost/overwritten sibling field;
- 0 unresolved uncertain state;
- 0 corrupt history exposed as valid;
- 0 memory trend/fragmentation, що загрожує 72h роботі;
- history retention не менше 60h і коректний wrap;
- recovery після кожного planned interruption у встановлений budget;
- усі auth/security negative tests PASS;
- UI після reconnect/OTA показує актуальний build і authoritative state.

### Exit-критерії G4

Статус `Готово` дозволений лише якщо одночасно:

1. P0 = 0;
2. P1 = 0;
3. P2 або закриті, або письмово прийняті як не функціональні residual issues;
4. усі automated suites PASS із clean checkout;
5. G0, G1, G2, G3 і soak metrics мають evidence;
6. hardware повернуто у затверджену конфігурацію;
7. security threat model і deployment rules виконані;
8. фінальний report містить exact firmware/build/catalog hashes.

Якщо хоча б один пункт не виконаний, фінальний статус — `Не готово` або конкретний обмежений статус, але не `Готово`.

## 4. Матриця дефект → етап → доказ закриття

| Дефект | Основний етап | Додатковий етап | Обов'язковий доказ |
|---|---:|---:|---|
| P0-01 exact tx correlation | 2, 4 | 7, 8 | two-client/out-of-order exact-handle tests |
| P0-02 false success від entity SSE | 4 | 8 | old-value + lost-ACK regression |
| P0-03 late callback slot race | 3 | 15 | generation tests + hardware fault injection |
| P0-04 no generic recovery | 5 | 15 | applied/not-applied recovery matrix |
| P0-05 unsafe packed RMW | 6 | 15 | fresh pre-read + sibling preservation |
| P0-06 passcode HTTP-only result | 7 | 13, 15 | redacted exact terminal result |
| P1-01 REJECTED hidden by HTTP 200 | 4 | 13 | 409/429 contract tests |
| P1-02 weak snapshot | 2, 4 | 14 | versioned schema + terminal journal |
| P1-03 incomplete catalog | 1 | 14 | full R/RW schema and strict validator |
| P1-04 mixed Settings | 11 | 14 | catalog-to-DOM classification test |
| P1-05 translation/order | 11 | 14 | UK/EN coverage + 01…N DOM order |
| P1-06 mixed Diagnostics | 11 | 14 | section membership test |
| P1-07 dynamic units | 1, 11 | 15 | source-dependent unit/range test |
| P1-08 RAM-only history | 12 | 16 | reboot/power-loss/60h wrap evidence |
| P1-09 missing E2E/security suite | 13, 14 | 15 | CI artifacts + hardware-safe profile |
| P1-10 unverified dynamic topology | 9, 10 | 15 | real valid topology transition |
| P1-11 missing hardware faults | 15 | 16 | completed checklist |
| P1-12 HTTP/CORS threat model | 13 | 15 | negative security matrix |
| P2-01 stale auth/history docs | 14 | 16 | documentation review against runtime |
| P2-02 untranslated accessibility | 11 | 14 | axe + translation coverage |
| P2-03 hardcoded firmware version | 14 | 15 | runtime build ID match |
| P2-04 unstable mDNS observation | 14 | 15 | multi-client network evidence |
| P2-05 browser-only counters | 2, 11 | 14 | backend redacted transaction journal |

## 5. Оцінювання виконання кожного етапу

Кожний етап оцінюється не відсотком написаного коду, а п'ятьма двійковими ознаками:

| Ознака | PASS означає |
|---|---|
| Scope | Виконані всі роботи етапу; немає прихованого перенесення обов'язкових пунктів |
| Correctness | Позитивні, негативні, boundary і fault tests PASS |
| Safety | Немає write/rollback/secret/topology ризику поза визначеною policy |
| Evidence | Є commit, test log, build hash і hardware evidence, якщо етап hardware-залежний |
| Regression | Повний попередній suite лишається зеленим |

Етап закритий лише при `5/5 PASS`. `4/5` — етап відкритий.

## 6. Формат звіту після кожного етапу

1. Назва й commit SHA.
2. Закриті defect IDs.
3. Файли та архітектурні рішення.
4. Що свідомо не входило в етап.
5. Команди тестів і точні результати.
6. Firmware/RAM/flash metrics, якщо збиралася прошивка.
7. Hardware procedure і вимірювання, якщо застосовувалося.
8. Нові ризики або regression defects.
9. Rollback result.
10. Висновок `5/5 PASS` або `етап не закритий`.

## 7. Заборонені критерії «готовності»

Не вважаються доказом завершення:

- «код виглядає правильно»;
- HTTP 200/202 без exact transaction terminal result;
- entity value, що випадково збігається з requested;
- PASS mock без тесту production C++ path;
- compile success без runtime test;
- hardware read-only 16S як доказ dynamic topology;
- одна зелена галочка UI без backend trace;
- відсутність видимої помилки без fault injection;
- manual browser check без відтворюваного E2E;
- storage unit tests без power-loss hardware campaign;
- Digest auth без Origin/CSRF/API/OTA tests;
- частковий checklist або непідтверджений rollback.

## 8. Рекомендований робочий ритм

Реалізовувати один етап за один логічний change set. Усередині етапу спочатку додати failing regression/contract tests, потім мінімальну production-реалізацію, після цього negative/fault tests, документацію і clean full run. Не об'єднувати архітектурну зміну transaction core, UI redesign і storage partition update в одну прошивку: це унеможливлює локалізацію hardware regression і безпечний rollback.
