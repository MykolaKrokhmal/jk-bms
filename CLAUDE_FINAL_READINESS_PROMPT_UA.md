# Фінальний промпт для Claude: JK BMS — безпечна динамічна топологія і production readiness

Ти працюєш безпосередньо в проєкті:

`/Users/mykola.krokhmal/Claude/jk-bms`

Твоя роль — senior embedded/ESPHome engineer, frontend engineer, QA engineer і safety reviewer в одній особі. Не обмежуйся аналізом або звітом: внеси потрібні зміни, виконай перевірки й залиш проєкт у перевіреному стані. Не заявляй «Готово» на підставі читання коду, HTTP 200, симуляції замість реального коду чи неповного набору тестів.

## 1. Кінцева мета

Довести систему до безпечної динамічної топології 1S–16S і достовірного керування всіма RW-регістрами JK BMS. Кількість комірок має походити з BMS, але вважатися фізичною правдою лише після узгодженої перевірки конфігурації, маски підключення, валідних напруг, суми напруг і прямої напруги батареї. Будь-який запис має завершуватися підтвердженим читанням з BMS; інтерфейс не має показувати успіх на підставі лише HTTP-відповіді або випадкового SSE-оновлення.

Статус `Готово` дозволений лише після виконання всіх критеріїв у розділі 11. Якщо немає доступу до ESP32 + реальної JK BMS, фінальний статус повинен бути `Програмно готово; апаратна верифікація очікується`, а не `Готово`.

## 2. Підтверджений стартовий стан — не повторюй і не відкатуй

У поточній версії вже виконано таке:

- дубльовану вкладку «Виходи/Керування» видалено;
- єдина точка зміни `charging`, `discharging`, `balancing` — вкладка «Налаштування»;
- «Огляд» показує ці стани лише для читання; натискання відкриває «Налаштування» та фокусує відповідний перемикач;
- у навігації залишено: Огляд, Комірки, Електрика, Стан, Налаштування, Діагностика;
- `UI_VERSION = 2026.09.08-v4`;
- браузерна перевірка на 390 px не виявила горизонтального переповнення;
- `node --check jk_bms.js` і `node --check demo/mock-server.js` проходять;
- `node test/topology/run.js` у чистому одиночному запуску дає `45 checks run, 0 failed`;
- демо на `http://localhost:8321/` віддає саме поточні `jk_bms.js` і `jk_bms.css`.

Не відновлюй окрему вкладку керування. Не створюй другу точку запису тих самих BMS-регістрів. Не замінюй безпечний fallback показом непідтвердженої кількості комірок.

## 3. Обов’язковий аудит перед змінами

Спочатку прочитай повністю щонайменше:

- `batterylifepo4.yaml`;
- `jk_bms.js`;
- `jk_bms.css`;
- `demo/mock-server.js`;
- `demo/panel.js`;
- `test/topology/run.js`;
- `components/jk_charge_history/*`;
- `docs/AUTH_AND_HISTORY.md`;
- реєстровий перелік/документацію, які вже є в проєкті.

Склади карту потоку даних: Modbus-регістр → ESPHome entity/template → SSE/HTTP → нормалізований ключ UI → компонент/графік/редактор. Для кожного RW-параметра зафіксуй адресу, ширину, signedness, масштаб, допустимий діапазон, крок, одиницю, спосіб кодування, write endpoint, forced-readback register і точний comparator.

Не покладайся на коментар «faithful port». Порівняй реальну C++/ESPHome-логіку з mock-реалізацією та тестами.

## 4. Невирішені критичні питання, які треба закрити

### 4.1. Єдиний backend transaction manager для всіх RW-регістрів

Зараз спеціальний write → ACK → forced readback → resolve існує лише для CellCount. Більшість інших RW-параметрів викликають `write_bms_u32`/`write_bms_u16`, а frontend очікує перше нове SSE-значення до приблизно 6 секунд. Це не є доказом запису: штатне опитування має `skip_updates`, може тривати значно довше й може принести старий snapshot.

Реалізуй один backend transaction manager для **кожного** RW-параметра, включно з numeric, select/toggle, текстовими й packed-register полями. Обов’язкові стани:

`IDLE → ACCEPTED/SENDING → ACK_WAIT → READBACK_WAIT → CONFIRMED | MISMATCH | ACK_TIMEOUT | READBACK_TIMEOUT | REJECTED | ERROR | WRITE_UNCERTAIN`.

Вимоги:

- команда має унікальний монотонний `tx_id`;
- одночасно для одного register key дозволено лише одну транзакцію; політика для різних регістрів має бути явно визначена;
- ACK від Modbus не є успіхом;
- після ACK запускається справжній позачерговий Modbus readback потрібного регістра/блоку, а не очікування звичайного poll;
- для packed-регістра повторно читається ціле слово, перевіряється лише цільове поле/маска, а сусідні біти не пошкоджуються;
- terminal result публікується атомарно як один snapshot/JSON з `tx_id`, `key`, `requested_raw`, `requested_display`, `readback_raw`, `readback_display`, `status`, `reason`, `started_at`, `finished_at`;
- жодне застаріле чи паралельне SSE-оновлення не може підтвердити іншу транзакцію;
- після timeout стан позначається невизначеним і автоматично перевіряється recovery probe;
- frontend відновлює активну/останню транзакцію після reload або SSE reconnect, а не втрачає її разом із JS-пам’яттю.

Не залишай `cellcount_tx_id` декоративним: клієнт мусить зіставляти terminal result саме з `tx_id`, отриманим для своєї команди. Окремі entity-події без атомарного зв’язку не повинні утворювати «успіх» зі значень різних snapshot.

### 4.2. CellCount і динамічна топологія

Збережи та посили чинний resolver. Єдиним дозволеним джерелом `activeCellCount()` є підтверджений topology snapshot.

Перевір усі споживачі кількості комірок:

- картки 01…N;
- обидва bar chart;
- CSS grid tracks і підписи осі;
- min/max/average/delta;
- балансувальна «іскорка» та визначення активних каналів;
- wire resistance;
- модальні графіки й історія комірок;
- підзаголовки та pluralization;
- target pack voltage (`target_per_cell × confirmed_count`);
- BMS total voltage має залишатися прямим вимірюванням, а не сумою комірок;
- diagnostics/topology banner;
- усі масиви, цикли, fallback і mock fixtures.

Поведінка станів:

- `CONFIRMED`: використовувати лише підтверджене `effective_cell_count`;
- `PENDING`: показувати останню підтверджену топологію, не запитану нову;
- `LOADING/MISMATCH/INVALID/OFFLINE/WRITE_UNCERTAIN`: fail-safe, не приховувати потенційно реальні канали, показати чітку причину й заборонити небезпечний повторний запис;
- після відновлення зв’язку resolver має сам відновити узгоджений стан;
- CellCount вважається успішним лише якщо одночасно: raw readback дорівнює запиту, topology = `CONFIRMED`, effective count дорівнює запиту, tx_id збігається.

Винеси resolver у чистий повторно використовуваний C++ модуль/функцію, яку викликає firmware і яку можна тестувати напряму. Не підтримуй дві незалежні «однакові» реалізації без contract/fixture tests, що доводять їхню еквівалентність.

### 4.3. Демо не повинно скасовувати підтверджені записи

Виявлений конкретний дефект: у сценарії `normal` mock `tick()` щосекунди примусово встановлює Charge/Discharge у `On`. Через це UI може показати `Збережено`, а наступний tick повертає перемикач у `On`. Відокрем сценарні forced values від writable persistent demo state. Після `confirm` записане значення має залишатися до явної зміни сценарію/скидання. Для сценаріїв, які навмисно перезаписують виходи, UI та тест повинні отримувати явну причину external override, а не мовчазний «успіх».

Додай сценарії для всіх типів RW-полів: confirm, mismatch, ACK timeout, readback timeout, HTTP error, SSE-before-HTTP, stale replay, duplicated event, reconnect, reload mid-transaction, external override після confirm.

### 4.4. Персистентна 60-годинна історія

Поточний 60-годинний буфер зберігається в RAM і губиться при reboot/power loss. Реалізуй production persistence на flash з урахуванням ресурсу запису, atomicity і пошкоджених/неповних записів.

Вимоги:

- кільцева/сегментна схема, CRC, schema version, sequence number;
- checkpointing із явно обґрунтованою частотою та write-amplification;
- відновлення після power loss посеред запису;
- міграція/безпечна partition strategy без мовчазного руйнування OTA;
- у метаданих історії зберігати `confirmed_cell_count` і `topology_revision`, щоб зміна 16S→8S не змішувала несумісні сегменти;
- `/charge_history.json/<offset>` повертає узгоджені сторінки без дублювання, пропусків і вигаданих даних;
- RAM-only короткі тренди мають бути явно відокремлені від персистентної 60h історії.

### 4.5. Безпека HTTP-керування

Basic Auth по HTTP допустимий лише для явно задокументованої довіреної LAN/VPN-моделі. Для всіх custom write endpoints забезпеч:

- POST-only;
- ту саму автентифікацію, що й UI;
- перевірку `Origin`/same-origin або еквівалентний CSRF-захист;
- коректний `Content-Type`, schema validation, межі, step, signedness, довжину ASCII-пароля;
- відмову від невідомого register key;
- rate limiting/command throttling і single-flight;
- відсутність секретів у логах та UI;
- негативні тести 401/403/405/415/422/429.

Не додавай HTTPS як фіктивну вимогу, якщо конкретна ESP32-збірка його надійно не підтримує; натомість чесно задокументуй мережеву модель загроз і рекомендований VPN/reverse proxy.

## 5. Frontend і доступність

Виправ і протестуй:

- динамічні input/toggle повинні мати програмний accessible name (`label for`, `aria-labelledby` або точний `aria-label`);
- `role=table/row` має мати коректні cell roles або використовуй семантичну таблицю/список;
- `aria-label="Sections"` локалізувати;
- поле пароля має мати пов’язану назву, правила формату й доступне повідомлення помилки;
- видимий focus, повна клавіатурна робота, `aria-live` без дублювання;
- при незбереженій зміні не можна мовчки втратити значення через навігацію/reload; додай dirty-state guard;
- активний запис не повинен втрачати DOM-посилання через rebuild списку;
- кнопка ОК заблокована в усіх станах, крім початкового ОК; `>>`, `✓`, `×` мають правильні кольори, доступні текстові назви й односекундну terminal індикацію;
- input відновлює фактичне BMS-значення при mismatch/timeout після recovery readback;
- одиниці локалізуються лише на presentation layer; wire values, ключі, масштаби й обчислення не перекладаються;
- українська та англійська локалізації повні, без змішаних raw labels; технічні скорочення залишаються за затвердженим glossary;
- мінімальний touch target — 44×44 CSS px, без горизонтального overflow на 320/360/390 px.

Видали або інтегруй мертвий legacy-код без викликів (`settingField()`, `submitSettings()` та пов’язані стилі/коментарі), але лише після статичного підтвердження, що він справді недосяжний.

## 6. Єдине джерело правди для реєстрів

Замість розрізнених масивів у YAML, JS, mock і spreadsheet створи один машинозчитуваний register catalog. З нього або за допомогою перевірки проти нього мають формуватися:

- ESPHome entity/endpoint mapping;
- UI order, label keys, unit, editor kind, input mask;
- address/access `R`/`RW`, width, signedness, scale, min/max/step;
- mock entities/handlers;
- fixture matrix і coverage report.

CI/test має падати, якщо RW-регістр є в одному шарі й відсутній в іншому, якщо порядок напруг/опорів 01…16 порушено або якщо є дубльовані/невідомі адреси.

## 7. Автоматизовані тести, яких зараз бракує

Поточні 45 тести керують mock напряму через HTTP+SSE і не виконують production `jk_bms.js` у браузері. Коментар «verified by code review» не є тестом.

Додай:

1. Unit tests реального pure C++ topology resolver.
2. Contract tests C++ resolver ↔ mock fixtures.
3. Browser E2E (Playwright або еквівалент), які завантажують реальні `jk_bms.js`/`jk_bms.css` з mock server.
4. E2E для 1S, 4S, 8S, 16S; exact/non-contiguous/extra-bit mask; NaN/gap; pack-sum mismatch; offline/reconnect; 16→8→16.
5. E2E кожного editor kind і кожного terminal write outcome, включно з reload/reconnect mid-flight.
6. Візуальні/DOM assertions для кількості карток, bar tracks, target voltage, units, min/max, hidden channels, навігації без вкладки «Виходи».
7. Accessibility checks: axe + клавіатурні сценарії.
8. Persistence tests: reboot, power-cut injection, CRC corruption, wraparound, schema migration, topology change inside history.
9. Firmware compile exact board/config, memory report і перевірка розміру partition/OTA slot.

Тести повинні використовувати випадковий вільний port або надійний lifecycle із teardown. `EADDRINUSE` не повинен спричиняти хибні падіння чи взаємний вплив паралельних запусків.

## 8. Апаратна верифікація

На реальному ESP32 + JK BMS виконай і задокументуй:

- boot/cold boot, reconnect Wi‑Fi, reconnect BMS;
- read-only telemetry для 1S/4S/8S/16S або безпечних лабораторних еквівалентів;
- контрольований 16→8→16 CellCount лише за дозволеної лабораторної конфігурації;
- ACK, forced readback, mismatch, timeout, power loss під час write;
- charge/discharge/balance toggle з повторним читанням;
- усі класи RW-регістрів, особливо packed fields;
- 60h persistence, reboot і power interruption;
- відсутність приховування активних каналів у невизначеному topology state.

Ніколи не змінюй захисні пороги, CellCount або силові MOSFET на підключеній робочій батареї без явного лабораторного плану, безпечного навантаження й можливості апаратного відключення.

## 9. Робоча дисципліна

- Проєкт зараз не є Git-репозиторієм. Перед змінами створи датований backup/manifest тільки потрібних файлів; не використовуй broad `pkill`, `rm -rf`, `git reset --hard` або перезапис усього каталогу.
- Сервер зупиняй лише після визначення PID, port і cwd; не вбивай сторонні Node-процеси.
- Не вбудовуй тестові backdoor endpoints у production firmware.
- Не маскуй помилки збільшенням timeout без доказу правильного lifecycle.
- Не змінюй BMS total voltage на суму комірок.
- Не використовуй `MAX_CELL_COUNT = 16` як активну топологію; це лише межа протоколу/розмір буфера/fail-safe.
- Після кожного етапу запускай мінімальні тести; наприкінці — повний clean run.

## 10. Обов’язкові артефакти результату

Залиш у проєкті:

- код реалізації;
- register catalog і coverage validator;
- browser E2E, resolver unit/contract tests, persistence tests;
- інструкцію одного clean test command;
- актуальну документацію архітектури write transaction/topology/history/security;
- `FINAL_READINESS_REPORT.md` з таблицею кожної вимоги: статус, доказ, команда, результат, файл/рядок;
- `HARDWARE_VALIDATION_CHECKLIST.md` з фактичними результатами, а не лише порожніми checkbox.

## 11. Критерії приймання і правило фінального статусу

Статус `Готово` дозволений лише якщо одночасно виконано все:

1. У UI немає вкладки/панелі «Виходи/Керування»; єдина write surface — «Налаштування».
2. Усі R/RW-регістри мають однозначний mapping і 100% catalog coverage.
3. Кожен RW-запис має tx_id, Modbus ACK, forced readback і атомарний terminal result.
4. Stale/duplicate/out-of-order SSE, reload і reconnect не можуть дати хибний успіх або підтвердити чужу транзакцію.
5. 1S/4S/8S/16S і 16→8→16 повністю перебудовують усі UI-споживачі тільки після `CONFIRMED`.
6. Непідтверджена топологія завжди fail-safe; жоден потенційно реальний канал не приховується.
7. Target voltage використовує протокольний phase target × підтверджену кількість комірок; total voltage залишається прямим BMS-вимірюванням.
8. 60-годинна історія переживає reboot/power loss, має CRC/version і topology metadata.
9. Browser E2E виконує production JS/CSS; unit/contract/persistence/security/a11y suites проходять clean run з нульовим fail/skip для обов’язкових сценаріїв.
10. Exact ESPHome firmware compile проходить; memory/partition/OTA budget задокументовано й у допустимих межах.
11. Апаратний checklist виконано на реальному ESP32 + JK BMS без відкритих P0/P1 дефектів.
12. Українська/англійська локалізація, keyboard/focus/labels/touch targets і 320–desktop responsive checks проходять.
13. Демо не скасовує підтверджені записи сценарним tick і відтворює всі failure modes детерміновано.
14. Документація відповідає коду, UI version/build і команди відтворювані.

Якщо хоча б один пункт не доведений:

- не пиши `Готово`;
- вкажи `Не готово` або `Програмно готово; апаратна верифікація очікується`;
- наведи точний blocker, ризик, доказ і наступну дію.

## 12. Формат фінальної відповіді

Почни з одного статусу: `Готово`, `Програмно готово; апаратна верифікація очікується` або `Не готово`.

Далі коротко подай:

1. що реально змінено;
2. які інваріанти безпеки тепер забезпечені;
3. повну таблицю виконаних команд і результатів;
4. матрицю criteria 1–14 з доказами;
5. відкриті питання/ризики, якщо вони існують;
6. точні файли й рядки;
7. окремо — що перевірено mock/browser, що compiled, а що перевірено фізично.

Заборонені формулювання без доказів: «має працювати», «ймовірно виправлено», «перевірено код-рев’ю», «production ready» після лише mock-тестів, «Готово» при відсутній апаратній верифікації.
