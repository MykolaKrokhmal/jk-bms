# Детальний аудит реального ESP32 + JK BMS — 2026-09-09

## Висновок

**Статус: НЕ ГОТОВО.** Реальний пристрій працює, віддає свіжу узгоджену телеметрію, а статична 16S-топологія правильно відображається в основних віджетах. Проте read-only hardware-аудит не закриває небезпечні write-path сценарії, а статичний аналіз виявив шість P0-дефектів у кореляції транзакцій, slot lifecycle, timeout recovery, packed register RMW та passcode flow. Повний реєстр: `OPEN_ISSUES.md`.

## Межі й безпека аудиту

- Ціль: реальний пристрій за `jk-bms.local` (фактичний IP під час сесії `192.168.27.43`).
- Режим: лише GET/SSE, DOM/візуальний огляд і TCP-connect до відомих портів.
- Не виконувалися POST/записи, зміна CellCount, порогів, MOSFET/балансування, пароля, reboot, OTA, розрив Wi-Fi/RS485, навантаження, зарядний стенд або protection trip.
- Облікові дані не записувалися до репозиторію чи звітів. Після завершення всього аудиту рекомендована ротація web-пароля.

## Ідентичність розгорнутої версії

- UI повідомляє `2026.09.08-v5`, firmware label — `v3.0.0`.
- Deployed `/0.js` SHA-256 точно збігається з локальним `jk_bms.js`: `959612065520b53608dc42bcea4e7aa40e062705926db945c1c5556ceb7c70d0`.
- Deployed `/0.css` SHA-256 точно збігається з локальним `jk_bms.css`: `cae05024a50c377e447f3b49f2da2ad2391afa964014f2c1eec6cb462f75131b`.
- Отже браузерний аудит стосується саме поточного локального frontend-коду. Ідентичність повного firmware binary/config hash через UI не доведена: такого build-id runtime не публікує.

## Доступ, auth і мережа

| Перевірка | Результат |
|---|---|
| `/`, `/0.js`, `/0.css`, `/events`, `/history.json`, `/charge_history.json/0` без auth | `401` для кожного — PASS для read endpoints |
| Тип web auth | Digest, відповідає production YAML |
| Authenticated JSON | `200`, `Content-Type: application/json` |
| CORS | `Access-Control-Allow-Origin: *` — ризик потребує threat-model/Origin tests |
| Порт 80 | open |
| ESPHome API 6053 | open; encryption handshake не перевірявся |
| OTA 3232 | open; password enforcement не перевірявся |
| mDNS | спочатку працював, потім були resolver timeouts; direct IP стабільний |

Digest — це автентифікація, не шифрування: HTTP-трафік і команди лишаються видимими для мережевого спостерігача. Перевірка unauthenticated POST свідомо не виконувалася, бо audit був без записів; її слід робити на ізольованому стенді.

## Runtime snapshot реального BMS

Знято з authenticated `/events`; 202 унікальні state entities у вибірці, BMS update age приблизно `0.4–1.4 с`, topology freshness приблизно `0.7–1.6 с`.

| Параметр | Спостереження |
|---|---|
| Topology | `CONFIRMED`, reason `OK` |
| Configured / connected / measured / effective / last confirmed | `16 / 16 / 16 / 16 / 16` |
| Connected mask | `65535` (`0xFFFF`) |
| Напруга батареї | приблизно `55.156 В` |
| Сума 16 cell voltages | `55.156 В`; збігається з total voltage у знятому snapshot |
| Cell min / max / delta | `3.444 / 3.451 В / 7 мВ` |
| Cell average | `3.44725 В` |
| SOC / SOH | `99% / 100%` |
| Залишок / номінальна ємність | приблизно `277.1 / 280 А·год` |
| Струм / балансування | `0.00 А / 0.00 А` |
| Charge / discharge permission | увімкнено |
| Balancing permission / actual activity | увімкнено / неактивне |
| Тривоги | активних немає |
| Wi-Fi | приблизно `-57…-60 dBm` |

Усі 16 cell voltages були послідовні `01…16`; min/max/delta та загальна напруга математично узгоджені. Порожні `cellcount tx id/status`, `passcode tx status` і `write tx snapshot` очікувані, бо в audit-сесії записів не було.

## UI-аудит на реальній телеметрії

### Огляд — PASS з зауваженнями

- SOC, стадія, напруга, струм, потужність, cell delta, temperature та alarms відображаються.
- Charge/discharge permission показані як увімкнені.
- Balancing permission увімкнене, але activity lamp неактивна; іскорка відсутня. Це коректно для `balancing_active=false`, але рух іскорки при реальному active balancing не перевірений.

### Комірки — PASS для поточної 16S-топології

- 16 bars, 16 labels і 16 cards; phantom cells немає.
- Послідовність `01…16` правильна.
- Min/max cards, графік і статистика узгоджені.
- Опори на cell cards показані для всіх 16 каналів.

Це доводить лише статичний 16S-випадок. Зміну topology у реальному BMS не виконано.

### Електрика / ціль — частковий PASS

- Для стадії підтримки ціль у DOM була `53.60 В`, що відповідає `16 × 3.35 В` (RFV).
- Live electrical values відображаються.
- У CUA-аудитному браузері history chart лишався порожнім, бо це середовище не надає page `fetch`; водночас обидва authenticated history endpoints напряму повертають валідний JSON. Тому це **обмеження інструмента аудиту**, а не доведений production-дефект браузера.
- `/history.json`: 30-секундний interval, 10 точок у вибірці. `/charge_history.json/0`: 60-секундний interval, 6 points, 1 available window.

### Стан — PASS для read-only відображення

- П'ять наявних температурних каналів і MOSFET temperature відображаються.
- UI явно повідомляє про відсутній T3 у карті Modbus.
- Активних protection alarms у момент аудиту не було.

### Налаштування — FAIL

- Список містить не лише BMS registers, а й derived/presentation entities.
- Є англійські назви в українському UI.
- Cell resistances у цьому списку фактично впорядковані `1, 10…16, 2…9`, а не `01…16`.
- Частина dry contact threshold/recovery значень показана без одиниць.
- RW editors і toggle controls рендеряться, але їх write lifecycle на hardware не тестувався з міркувань безпеки.

### Діагностика — FAIL

- Досі присутні заголовки «Значення параметрів BMS» і «Фактично отримано від ESPHome».
- Таблиця змішує derived ESPHome, topology, Wi-Fi/IP та transaction fields.
- Частина назв/enum не локалізована: `Active cells voltage sum`, `Topology state`, `CONFIRMED`, `NA`, `Write tx snapshot` тощо.
- Browser-session counters не є backend audit log.

## Статичний аудит write path

Read-only runtime не може безпечно проявити write-race, тому код перевірено окремо. Підтверджені блокери:

1. немає exact POST→`tx_id` correlation;
2. ordinary entity SSE може завершити write до authoritative transaction verdict;
3. late callback може потрапити у reused slot;
4. generic timeout не має `WRITE_UNCERTAIN` recovery;
5. packed fields використовують cached sibling, а не fresh pre-read;
6. passcode UI завершується по HTTP 200, не по backend terminal status;
7. REJECTED лишається firmware log, а клієнт отримує HTTP 200;
8. snapshot схема та retention недостатні для надійного recovery/audit.

Деталі й критерії виправлення наведені в `OPEN_ISSUES.md`.

## Автоматичні перевірки, повторно запущені 2026-09-09

| Suite | Результат |
|---|---|
| `jk_write_tx_core` | 46/46 PASS |
| `jk_history_format` | 94/94 PASS |
| register catalog validator | 418/418 PASS |
| topology + mock integration | 57/57 PASS |
| Разом | **615/615 PASS** |
| `node --check jk_bms.js` | PASS |
| `node --check demo/mock-server.js` | PASS |

Останній наявний compile log: SUCCESS, RAM 28.2%, Flash 59.9%, config hash `0xaf454b9d`. Окремий попередній звіт містить compile 2026.8.2. Жоден із цих результатів не доводить відсутність знайдених concurrency/transaction дефектів: відповідні сценарії не закодовані в чинних тестах.

## Що реально доведено, а що ні

**Доведено:** актуальний frontend розгорнутий; read endpoints gated auth; SSE жива; поточна 16S topology узгоджена; усі 16 комірок правильно споживаються основними UI components; ціль напруги для поточної float/support stage розрахована з effective 16S; read-only UI працює.

**Не доведено:** безпечні RW transactions; packed sibling preservation; dynamic topology transition; timeout recovery; multi-client correlation; balancing particle under actual balancing; reconnect/fault/protection behavior; 60h persistence; OTA/API security; power-loss recovery; mobile hardware browser E2E.

## Рекомендований порядок наступної реалізації

1. Заморозити hardware writes до виправлення P0-01…P0-06.
2. Побудувати один backend transaction API з exact `tx_id`, generation-safe callbacks та recovery state.
3. Перевести packed registers на atomic fresh-pre-read RMW.
4. Зробити каталог повним джерелом усіх R/RW метаданих і генерувати з нього UI/validators.
5. Розділити Settings/Diagnostics за походженням даних, завершити локалізацію/order/units.
6. Додати browser E2E + security negative tests.
7. Лише на ізольованому стенді виконати write/fault/dynamic-topology checklist і 60h soak.

До завершення цих кроків статус «Готово» є технічно необґрунтованим.
