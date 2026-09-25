## Відкладене питання: GPS Heartbeat на JK_PB1A16S15P (2026-09-23)

- Після виправлення повідомлення про readback (`912f2e3`) власник повторив
  перевірку через реальний UI: `gps_heartbeat=0` показує «Збережено»;
  `gps_heartbeat=1` завершується MISMATCH із фактичним повідомленням
  «BMS повідомляє Ні. Не підтверджено». Перед записом `1` preflight мав
  `current_raw=12864`, `merged_raw=12868`, `mask=0x0004` (bit 2
  регістра `0x1114`). Отже, успіх напряму `1` **не доведено**.
- Чотири інші live-поля цього Stage 4 проходили UI-перевірки; зокрема
  інші біти того самого `0x1114` записувалися. Це зменшує ймовірність
  загальної помилки FC16/RMW, але не доводить причину відмови bit 2.
- Модель у збережених апаратних логах — `JK_PB1A16S15P`. Гіпотеза для
  фінального етапу: GPS Heartbeat присутній у спільній карті протоколу,
  але не підтримується або не дозволений прошивкою цієї PB-моделі.
  Документованої умови, яка саме блокує ввімкнення, наразі **не знайдено**;
  відсутність GPS-модуля сама по собі не доведена як причина MISMATCH.
- Рішення власника: **відкласти розбір до прикінцевих етапів**; не
  блокувати ним решту реалізації, не повторювати запис `1` заради цього
  питання. За потреби тоді порівняти read-only стан у штатному JK app,
  уточнити версію BMS firmware та підтримку GPS саме для цієї моделі.
  У жодному звіті не називати напрям `1` hardware-verified. Поточний
  Stage 4 inventory (`23 hardware-verified / 37 software-ready / 37
  blocked`) і write-політики цим записом не змінюються.

---

## Сесія: 2026-09-22 (Claude — Stage 4 closure, перехід до Stage 5)

**Stage 4 (write registry: fail-closed HTTP→main-loop handoff, async
accepted/request_id/status-poll contract, register-write UI) статус
закрито цим проходом.** Точні, обов'язкові до збереження формулювання:

- **Stage 4 software/runtime implementation: COMPLETE.**
- **Deployment/read-only runtime integration: VERIFIED on hardware at
  `025ad01`** (`/0.js` byte-identical до локального `jk_bms.js`; BMS
  `LIVE`; topology `CONFIRMED`; 16S UI коректний; write registry DOM
  відповідає generated inventory; 6 хв стабільної роботи без reboot;
  reset diagnostics без нового crash marker).
- **18 pre-existing full-width полів: `write-hardware-verified`**
  (незмінені цим Stage — full-width `write_bms_u32/u16` dispatch той
  самий).
- **42 нових Stage 4 полів: `write-software-ready`** (реальний
  production endpoint, повний backend/frontend async contract,
  targeted+TSan+`run_all.sh` зелені; апаратно НЕ верифіковані як група).
- **`gps_heartbeat`: partial hardware smoke only.** Один прямий no-op
  POST (`gps_heartbeat=0&submit_policy=live`) прийнято HTTP 200,
  `request_id=8`, status endpoint повернув `accepted`/`tx_id=8`; raw
  `0x1114` до/після лишився `12864`, цільовий bit2 лишився `0`, sibling
  bits незмінні, reboot/crash/telemetry regression не було. Terminal
  ACK/readback snapshot-подія для `tx_id=8` не була вчасно спостережена
  до expiry (методологічний пропуск тестування, а не firmware defect) —
  тому поле **лишається `write-software-ready`**, НЕ переводиться у
  `write-hardware-verified`. Подальша UI-driven спроба не створила POST
  через відхилений native `window.confirm()` у headless browser
  automation — це обмеження тестового інструмента, не дефект прошивки;
  повторну спробу свідомо не виконано.
- **37 blocked полів: intentionally fail-closed**, кожне з явним
  `blocked_reason` + `blocker_closure_criterion` у
  `protocol/evidence/protocol_blockers.json` / `stage4_rw_inventory.json`.
- Немає вимоги апаратно верифікувати всі 42 нових поля перед стартом
  Stage 5 — такої вимоги немає в жодному authoritative plan-документі
  цього репозиторію; не вигадана цим проходом.

**Базова матриця (перевірена проти живих generated artifacts, не
задокументована "на слово"):** 97 manifest RW rows = 18
write-hardware-verified + 42 write-software-ready + 37 blocked; write
registry = 42 entries = 5 live + 37 authorization_required. Новий
машинний доказ: `test/protocol_catalog/test_stage4_closure_invariants.js`
(9/9) — 97=18+42+37, 42=5+37, кожен hardware-verified row має реальний
`hardware_verification_provenance`, кожен software-ready row має
реальний `current_write_endpoint`, жоден blocked row не має production
endpoint, кожен blocked row має reason+closure criterion,
`gps_heartbeat` не позначений hardware-verified, frontend live-submit
surface точно дорівнює 5 live-ключам без жодного
authorization_required/blocked leak.

Аудит не знайшов production correctness gaps — усі перелічені інваріанти
вже трималися на momент аудиту; єдина зміна цього проходу — новий
closure-proof тест вище (жодних змін safety class/range/access/UI/API).

Наступний крок: **Stage 5** (`W`-команди — `declared_access:"w"` схема,
service-action registry, evidence resolution для 2 неоднозначних команд,
lab-safe implementation для решти 6). Реалізація Stage 5 цим проходом
НЕ розпочата.

---

## Сесія: 2026-09-14/15 (Claude — фінальна підготовка репозиторію)

> Попередній запис цього файлу (сесія 2026-09-12) описував активний
> конфлікт із паралельною Codex-сесією на тому самому working tree,
> незакомічене дерево 67+ файлів, і зламаний старий release pipeline проти
> V2 workbook. Усе це вирішено цією сесією (див. нижче) — повний текст
> попереднього запису доступний у git history (`git log -p -- HANDOFF.md`)
> та в checkpoint-коміті `c291106`, не переписаний, а замінений.

### Що зроблено цим проходом

Комплексний завершальний прохід підготовки репозиторію (від checkpoint
`c291106` до поточного `HEAD`):

1. **Інтегровано `4c691b7`** (`fix/claim-matrix-owner-override-check`) —
   claim-matrix policy gate тепер owner-override-aware і реально
   enforced у `pipeline.js` (раніше — dead code). Merge commit `736225b`,
   2 текстові конфлікти вирішено вручну (обидва боки збережено).
2. **`CLAIM_MATRIX_STALE`/`WORKBOOK_V2_INDEX_STALE` усунено структурно** —
   5 генераторів (`build_claim_matrix.js`, `build_workbook_index.py`,
   `build_workbook_v2_index.py`, `build_upstream_index.py`,
   `build_implementation_index.py`) тепер ігнорують pipeline-owned
   `release_generation_id` metadata у власному standalone `--check`,
   перевіряючи лише свій payload; `pipeline.js`'s власний `check` і далі
   строго звіряє повні байти включно з release_generation_id. Commit
   `a53e7c4`.
3. **Pipeline тепер самодостатній** — `node tools/protocol/pipeline.js
   check` (без `--workbook`) проходить на будь-якому checkout, лише на
   закомiченому, SHA-256-звіреному V2 workbook. Легасі V1 workbook —
   опціональна додаткова ревалідація. `test/run_all.sh`/`test/release/steps.js`
   більше не мають false-green шляху (раніше: "NOT EXECUTED" → "All
   suites passed" без критичної pipeline-перевірки). Commit `a53e7c4`.
4. **Secret-scan false positive усунено структурно** —
   `scanWorktree()` тепер git-aware (`git ls-files` tracked + `git
   ls-files --others --exclude-standard`), а не сирий filesystem walk із
   хардкодженим directory blacklist. Ігнорований nested worktree більше
   ніколи не потрапить у скан — не через фізичну відсутність worktree
   (worktree на момент фіксу ще фізично існував). Commit `33f81d6`.
5. **`capacity_remaining` (0x12A8) signed/unsigned виправлено** —
   офіційний PDF, V2 workbook і upstream-коментар незалежно кажуть
   signed INT32; canonical.json та YAML помилково використовували
   unsigned. Виправлено (wire signedness ≠ domain bounds — min/max 0/2000
   Ah лишились незмінними). Commit `248b440` + resync `74aea05`.
6. **Corrective worktree та обидві тимчасові гілки прибрано** штатними
   git-командами (`git worktree remove`, `git branch -d ×2`) — обидві
   безпечно видалені лише після підтвердження git, що вони fully merged/
   reachable.
7. **Документація узгоджена**: `OPEN_ISSUES.md` P2-01 (auth-docs
   staleness) позначено закритим; `docs/adr/0001-protocol-catalog.md`'s
   top diagram більше не згадує 2 давно видалені generated-файли;
   `codex HANDOFF.md`/`codex PROJECT_STATE.md`/`codex TROUBLESHOOTING.md`
   отримали короткі "superseded"-примітки без видалення історичного
   змісту; `proj_arc/README.md` — новий короткий evidence-індекс
   (що збережено/чому, що видалено як підтверджений дублікат, де повна
   історія). 3 підтверджено-надлишкові evidence-логи видалені (strict
   subset пари в `stage1_corrective_evidence/`, підтверджено diff'ом,
   нуль вхідних посилань).

### Перевірка

- `test/run_release.sh` (self-contained, без `JK_BMS_WORKBOOK_PATH`) —
  **ALL PASS**, non-mutation guard PASS, 25/25 кроків EXECUTED.
- `node tools/protocol/pipeline.js check` — PASS і з, і без `--workbook`,
  ідемпотентно (build двічі → байт-у-байт ідентичний вивід).
- `node tools/protocol/fingerprint.js check` — `FINGERPRINT_MATCH`.
- `node tools/protocol/generate.js --check` — no drift.
- `node test/register_catalog/validate.js` — 171/171.
- `node test/protocol_catalog/test_negative_fixtures.js` — 112/112.
- `node test/protocol_catalog/test_secret_scan.js` — `secret-scan PASS`
  (без "known acceptable false positive").
- **V2 workbook row accounting підтверджено:** аркуш `Реєстр параметрів`
  має 266 фізичних рядків (`A1:O266`): 1 рядок заголовка + 265 рядків
  параметрів, що відповідає `parameter_count=265`; параметри охоплюють
  210 унікальних фізичних адрес. Розбіжності між 265 і 266 немає.
- **ESPHome compile gate закрито 2026-09-15:** ізольований ESPHome
  `2026.8.2` на Python `3.12.11` успішно виконав `config` і повний
  `compile` поточного `batterylifepo4.yaml` з ESP-IDF `5.5.5`. RAM:
  92 824/180 736 B (51.4%); Flash: 1 132 559/1 835 008 B (61.7%);
  `config_hash=0x70df83bb`; OTA binary SHA-256:
  `82b2acfc0d5cc7f6ad23184d4e8a9d4493633bb745b04a4939db3141231361ac`.
  Усі 3 compiler warnings збігаються з попереднім baseline: 2
  `-Wempty-body` у generated ESPHome `modbus_controller.cpp` і 1
  `-Waddress` у `total_runtime` lambda; нових warnings немає. Pin
  `08f25eb4941b03b6ee0b6c38660aeadfc4ef7cd1` незмінно записаний у YAML
  та `toolchain.lock.json` як upstream evidence revision; поточний YAML
  не має активного `external_components:` block і компілюється на
  вбудованому ESPHome `modbus_controller`, тому runtime Git-resolve цього
  pin під час build не відбувається. Build-cache і тимчасовий venv після
  фіксації результатів видалено; пристрій не прошивався.
- Повний перелік нових/оновлених regression-тестів і точні числа —
  у відповідних commit-повідомленнях (`git log c291106..HEAD`).

### Що НЕ зроблено цим проходом (свідомо, з причин)

- **Не мігрував `registers.canonical.json` на 265-параметрову V2-модель.**
  Це й далі центральний архітектурний розрив цього проєкту (119
  register/127 field модель vs. 265 параметрів/210 адрес офіційного
  V1.1+V2). Це велика, окрема робота — НЕ preparation blocker, майбутня
  функціональна розробка. Детально: `docs/adr/0001-protocol-catalog.md`
  (addenda), `proj_arc/BMS_V2_MANIFEST_EXECUTION_LOG.md`.
- **`charge_otp` (0x104C) можлива signed/unsigned розбіжність** — знайдено
  побіжно під час фіксу `capacity_remaining`, явно НЕ виправлено (інший
  регістр, інший access class `rw` замість `r`, потребує окремої
  перевірки). Заведено окремим завданням (`spawn_task`, `task_4ad5bbbd`).
- **Функціональні P0/P1/P2-пункти з `OPEN_ISSUES.md` не чіпав** — це
  hardware-верифікація й майбутня продуктова розробка, поза межами
  "preparation" цього проходу (окрім P2-01, закритого як prep-doc fix).
### Активні файли для орієнтації нової сесії

1. `CLAUDE.md` — build/test команди, архітектурні конвенції, робочий
   стиль (незмінний цим проходом).
2. `OPEN_ISSUES.md` — реєстр ФУНКЦІОНАЛЬНИХ відкритих питань (P0-P2);
   заголовок "НЕ ГОТОВО" стосується hardware/production readiness, не
   preparation-стану репозиторію.
3. `docs/adr/0001-protocol-catalog.md` — архітектурні рішення,
   addenda по проходах (найновіший — integration note цього проходу).
4. `proj_arc/README.md` — новий: що заархівовано і чому, canonical-версії.
5. `codex *.md` (5 файлів у корені) — знімок паралельної Codex-сесії від
   2026-09-12/13; кожен, що описував стан, тепер має коротку
   "superseded"-примітку вгорі, вказуючи на поточний стан. `codex
   DECISIONS.md`/`codex AGENTS.md` лишились без приміток — це записи
   рішень/правил, а не знімки стану, досі релевантні.

### Git-стан на кінець цього проходу

Гілка `bms-v1.1-manifest-audit`; safety-checkpoint `checkpoint/pre-cleanup-2026-09-14`
→ `c291106` — незмінний. Повний перелік нових комітів: `git log --oneline
c291106..HEAD`. Нічого не запушено.
