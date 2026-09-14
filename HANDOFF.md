## Сесія: 2026-09-12 (Claude)

> Звірено з `codex HANDOFF.md` 2026-09-12: розбіжності: так — див.
> "Розбіжності з codex HANDOFF.md" нижче.

### Завершено

- Нормативні джерела протоколу додано й задокументовано: офіційний PDF V1.1
  (`protocol/evidence/BMS_RS485_Modbus_V1.1.pdf`) + верифікований V2 workbook
  (`protocol/evidence/LiFePO4_BMS_Parameters_registers-V2_verified.xlsx`),
  зареєстровані в `protocol/evidence/sources.json`; старий V1 workbook і
  `protocol/evidence/workbook_index.json` позначені deprecated (сам генератор
  `protocol/evidence/build_workbook_index.py` тепер пише `$deprecated` у
  вихідний файл).
- Детермінований manifest на 265 параметрів /210 унікальних базових адрес:
  `protocol/generated/bms_v1_1_manifest.json`, генератор
  `protocol/evidence/build_v2_manifest.py` (`--check` підтверджує
  детермінізм).
- Повний gap-аудит по всьому ланцюгу регістр→…→UI:
  `protocol/evidence/build_v2_gap_audit.js` →
  `protocol/generated/bms_v1_1_gap_audit.json` (усі 7 статусів словника
  мають реальний code path, включно з `unsafe`/`blocked_by_protocol`, які
  спершу були "мертвими").
- "Етап 5" (фундамент читання) реалізовано прагматично під реальну SSE-push
  архітектуру (не client-side polling, якого нема): `PROTOCOL_CATALOG.fieldMeta`
  (генерується в `tools/protocol/generate.js`) несе `canonical_unit`/
  `precision`/`min`/`max`/`step`/`poll_group`/`freshness_budget_s` для КОЖНОГО
  реєстрового і non-register поля; `jk_bms.js` тепер має per-parameter
  staleness (`isFieldStale`/`staleTitle`/`sweepDiagnosticStaleness`,
  1-секундний sweep), підключений і до Diagnostics, і до Overview/Electrical
  (`MEASUREMENT_BINDINGS`). Живо перевірено в браузері (demo mock-сервер,
  сценарій "Browser Disconnected"): маркер з'являється й коректно зникає.
- Два самоаудити цієї роботи (по 9 і по 6 знайдених реальних розривів
  відповідно) виконано й закрито — деталі, повний перелік розривів і команди
  перевірки для кожного: `BMS_V2_MANIFEST_EXECUTION_LOG.md` (у корені або в
  `proj_archive docs/` — див. "Ризики" нижче щодо переміщення файлів).
- Housekeeping: старі одноразові аудити/промпти Stage 1 (13 tracked + 3
  untracked `.md`) впорядковано — але див. "Ризики" нижче: паралельна сесія
  Codex перемістила їх ще раз, за іншою схемою.
- `CLAUDE.md` створено (вперше для цього проєкту) — build/test команди,
  архітектурні конвенції, робочий стиль.
- `CLAUDE.local.md` створено (в .gitignore) — особистий шлях до workbook на
  цій машині, нотатка про `$TMPDIR`/sandbox quirk.
- Auto memory (4 файли + індекс) — див. підсумок у відповіді асистента.

### Прийняті рішення

- **SSE-push, не polling** — "Stage 5"-текст описував client-side
  polling-класи (live/RW-config/static), але реальна архітектура — суто
  push через один `EventSource`. Причина: firmware сам вирішує каденс через
  ESPHome `update_interval`; додавання client-side fetch-циклу боролося б із
  робочою, протестованою архітектурою. Підтверджено користувачем явно
  (`AskUserQuestion` → обрано "Прагматична адаптація").
- **`stateUpdatedAt` — окрема мапа, не поле всередині `state[key]`** —
  причина: Proxy-дедуп на незмінне значення лишає старий об'єкт на місці;
  timestamp усередині нього ніколи б не оновлювався для стабільного
  значення, хоча воно й далі активно підтверджується.
- **`derived_from_register_key` — явне схемне поле, не text-parsing нотатки**
  — причина: проєктна дисципліна "не вигадуй похідну, коли джерело
  неоднозначне" (див. `[[feedback-no-fabricated-derivations]]` в auto
  memory) — краще явна, валідована схема, ніж regex по вільному тексту.
- **`SETTING_DEFS` лишається ручним переліком ключів (safety-гейт), але
  min/max/step тепер з `fieldMeta`** — причина: WHICH keys are write-enabled
  — свідоме рішення власника ризику, не похідні дані; але дублювання ЗНАЧЕНЬ
  було чистим джерелом дрейфу, усунене.
- **Ніколи не редагувати згенерований блок вручну** (`jk_bms.js` між
  BEGIN/END маркерами, `register_catalog.json`, `protocol/generated/*`) —
  причина: єдине джерело істини — генератор; ручна правка згенерованого
  виводу неминуче розійдеться при наступному запуску.

### Відкриті TODO (наступна сесія)

- [ ] **Центральний розрив**: `protocol/registers.canonical.json`
  (119-регістрова модель, яку реально читає `tools/protocol/generate.js`)
  досі НЕ синхронізований з новим 265-параметровим V2 manifest —
  `protocol/generated/bms_v1_1_gap_audit.json`: 130 implemented / 97 missing
  / 38 partial. Немає єдиного file:line — це архітектурний розрив між двома
  паралельними каталогами. **Незалежно підтверджено паралельною
  Codex-сесією** (`codex PROJECT_STATE.md`/`codex HANDOFF.md`, розділ
  "Unresolved contradictions": "Old docs call
  `protocol/registers.canonical.json` the source of truth; newer user
  decision makes official PDF + verified V2 workbook the foundation.
  Migration is not complete.") — обидві сесії незалежно дійшли того самого
  висновку. Codex пропонує як перший крок: єдиний fail-closed,
  детермінований pipeline/release-контракт навколо V2 workbook + офіційного
  PDF, ЗАМІСТЬ точкового дописування старого `registers.canonical.json`
  (`codex HANDOFF.md`, п. 4 "What should the next agent do first?").
- [ ] `ui_order` — `protocol/evidence/build_v2_manifest.py:345-346` — поле
  свідомо `None` (дві неізоморфні UI-таксономії в джерелі без явного
  зв'язку). Потрібне або нове поле у workbook, або ручна курація для Stage
  10 ("Побудувати Settings із груп Excel").
- [ ] `write_uses_read_modify_write` — прапорець відсутній у схемі
  `protocol/registers.canonical.json`; перевірка в
  `protocol/evidence/build_v2_gap_audit.js:256-261` може лише побудувати
  worklist, не підтвердити RMW-відповідність. Треба або додати прапорець у
  схему й генератор, або дочекатись hardware-верифікації (Stage 9).
  Прапорець `write_uses_read_modify_write` для packed RW-регістрів
  (`0x1114`, `0x1118`, `0x1248`, `0x12A6`, `0x12B8`, `0x12C0`, `0x12D0`,
  `0x12EE`, `0x130C`, `0x14B2`, `0x14D4`, `0x14E4`, `0x14E6`, `0x1504`,
  `0x1506` — список пріоритетних адрес зі стадії 8 оригінального 14-етапного
  плану).
- [ ] `registerEntity()` — `jk_bms.js:845` (~130 hand-written call-сайтів
  нижче) — без автоматичної drift-перевірки проти canonical
  `esphome_read_entity_id`/`backend_key`. Окрема, більша робота.
- [ ] `MAX_CELL_COUNT = 16` — `jk_bms.js:449` і `CELL_COUNT = 16` —
  `demo/mock-server.js:71` — стеля на 16 комірок все ще захардкожена в JS І
  в `batterylifepo4.yaml` (32 статичні `cell_voltage_N`/`cell_resistance_N`
  сенсор-блоки, N=1..16). Динамічна топологія 1-32S (Stage 6) вимагатиме
  зміни обох шарів.
- [ ] `BatVol`/`BatVol__dup2` — `protocol/generated/bms_v1_1_manifest.json`
  (`BatVol` @ 0x1290, UINT32, мВ, "загальна напруга" vs `BatVol__dup2` @
  0x12E4, UINT16, 0.01В) — справжня неоднозначність у документі виробника,
  не помилка парсера. Потребує hardware-верифікації (Stage 9).
- [ ] `UK_UNIT_MAP`/`UNIT_DISPLAY`/`DIAGNOSTIC_ENTITY_LABELS` у `jk_bms.js`
  — ще три ручні таблиці (знайдені Explore-агентом), не консолідовані в
  `PROTOCOL_CATALOG.fieldMeta` цього разу — свідомо поза межами.
- [ ] Staleness-візуалізація для editable input/toggle-контролів у
  Diagnostics — лише read-only value-вузли отримали `.is-stale` цього разу.
- [ ] Stages 6–14 з оригінального 14-етапного плану взагалі не почато:
  динамічна топологія 1-32S, universal RW transaction manager під новий
  manifest, packed RMW (список адрес вище), hardware-верифікація
  неоднозначностей (`0x1600`/`0x1606` UINT16-vs-Length4, `0x111C`/`0x1470`
  vendor-регістри, 2 ненумеровані alarm-біти, `RCVTime`/`RFVTime` byte
  order), Settings UI з груп Excel, ізоляція W-команд (`0x1600–0x1612`),
  автоматична тестова система, реальна hardware-валідація, фінальний аудит
  готовності.
- [ ] **TBD / потребує підтвердження**: паралельна сесія Codex (див.
  "Ризики" нижче) стверджує у власному `codex PROJECT_STATE.md` ТА
  `codex HANDOFF.md` (розділ "Unresolved contradictions" — "current V2
  workbook causes `KeyError: 'BMS Parameters'` in the old pipeline";
  розділ "Recommended first actions", п. 3 — пропонує відтворити цю помилку
  як перший крок), що старий release pipeline (`build_workbook_index.py`)
  падає з `KeyError: 'BMS Parameters'` при вказівці на V2 workbook (реальний
  sheet називається `Реєстр параметрів`, не `BMS Parameters`). Це
  твердження тепер присутнє у ДВОХ окремих Codex-документах (внутрішньо
  узгоджене всередині Codex-сесії), але я особисто НЕ виконував
  `test/run_all.sh`/`pipeline.js build --workbook <V2 path>` у цій сесії —
  мій "EXIT=0, 0 FAIL" стосувався ЛИШЕ V1 workbook (див. "Стан перевірки"
  нижче). Тобто це не суперечить моїм власним результатам (я просто ніколи
  не перевіряв цю саме комбінацію), але й не підтверджено мною незалежно —
  перш ніж вважати фактом, варто самостійно відтворити.

### Розбіжності з codex HANDOFF.md

Порівняно повний вміст `codex HANDOFF.md` (7945 байт, останнє
оновлення 2026-09-12 15:45) з цим документом. Список нижче — фактичні
точки тертя, не спроба вирішити яка сторона права:

1. **"Broad green result" ≠ "V2 workbook протестовано".** `codex HANDOFF.md`,
   розділ 3: *"Claude reported all suites passing... The audit found that
   Claude's broad green result did not include a successful run against the
   current V2 workbook."* Розділ "Unresolved contradictions" того ж файлу:
   *"Claude reported all suites passing; current V2 workbook causes
   `KeyError: 'BMS Parameters'` in the old pipeline. No-workbook suite
   passes only by skipping it."* — Це прочитується як натяк, що мій
   "EXIT=0, 0 FAIL" видавався за наскрізну перевірку V2 workbook. Я такого
   явно не стверджував (мій `JK_BMS_WORKBOOK_PATH` завжди вказував на V1
   workbook для `test/run_all.sh`/`pipeline.js`; V2 перевірявся окремим
   інструментом `build_v2_manifest.py --check`) — але формулювання в моєму
   попередньому підсумку цієї сесії дійсно не уточнювало, ЯКИЙ саме
   workbook стояв за зеленим результатом, що могло створити це враження.
   Уточнено вище в "Стан перевірки".
2. **Ступінь завершеності freshness на Stage 5.** Мій запис вище: Stage 5
   "підключений і до Diagnostics, і до Overview/Electrical". `codex
   HANDOFF.md`, "Unresolved contradictions": *"Stage 5 claims UI-wide
   freshness; current code leaves most non-register budgets null."* — Обидва
   твердження одночасно правильні, але з різним акцентом: я підключив
   freshness для ВСІХ реєстрових полів і для 2 явно прив'язаних похідних
   (`total_voltage`, `current` — через нове поле `derived_from_register_key`
   у схемі), і це живо перевірено в браузері. Але дійсно: з ~51 інших
   non-register/обчислюваних сутностей (`power`, `state_of_charge`,
   `wifi_signal`, тощо) більшість досі мають `freshnessBudgetS: null` —
   свідомо, бо для них немає єдиного "справжнього" джерела-регістра
   (наприклад `power = V × I` з двох різних регістрів). Я це задокументував
   як "свідомо не охоплено" у `BMS_V2_MANIFEST_EXECUTION_LOG.md`, але не
   повторив цей нюанс у стислому підсумку цієї сесії — з боку Codex це
   читається як "твердження про Stage 5 перебільшене". Обидва описи
   технічно точні; розбіжність — лише в акценті "що саме означає
   'зроблено'" для Stage 5.

### Ризики / відкриті питання

- **Паралельна сесія працює над тим самим working tree — активний ризик
  конфлікту ЗАРАЗ, не лише історичний факт.** Виявлено безпосередньо: інший
  AI-агент ("Codex", судячи з назв файлів і змісту `codex HANDOFF.md`)
  одночасно редагує цей самий репозиторій — видалив/перейменував мої
  щойно-створені `AGENTS.md`/`DECISIONS.md`/`HANDOFF.md`/`PROJECT_STATE.md`/
  `TROUBLESHOOTING.md` на варіанти з префіксом `codex `, і переніс вміст
  моєї `proj_arc/` (плюс `OPEN_ISSUES.md`, який я explicitно вирішив
  залишити активним) у власну теку `proj_archive docs/`. Дані не втрачені
  (перевірено — вміст файлів ідентичний), але git-індекс зараз у
  неузгодженому стані: 13 файлів застейджені як rename у `proj_arc/`, але
  фізично видалені з диска (є під `proj_archive docs/` замість цього). **Я
  свідомо НЕ чіпав це** — вирішувати, яку схему архівації лишити, має
  користувач, не автоматичний merge двома агентами.

  **Де саме перетин можливий** (файли, які редагували ОБИДВІ сесії за
  однаковими цілями цього самого дня, 2026-09-12): протокольні артефакти
  `protocol/evidence/sources.json`, `protocol/registers.canonical.json`,
  `protocol/non_register_entities.canonical.json`,
  `protocol/generated/bms_v1_1_manifest.json`/`bms_v1_1_gap_audit.json`,
  `protocol/evidence/build_v2_manifest.py`; згенеровані `jk_bms.js`/
  `register_catalog.json`; і сама документація верхнього рівня
  (`.md`-файли в корені). Codex-сесія за власним `codex HANDOFF.md`
  планує наступним кроком чіпати старий release pipeline
  (`protocol/evidence/build_workbook_index.py`, `tools/protocol/pipeline.js`,
  `test/run_all.sh`) — точно ті файли, workflow яких задокументовано в
  `CLAUDE.md`.

  **Що зробити перед продовженням роботи над спільними файлами:**
  1. `git status --short` і `git diff` перед будь-якою правкою — переконатись,
     що Codex не змінив той самий файл з часу цього запису.
  2. Прочитати актуальний `codex PROJECT_STATE.md`/`codex HANDOFF.md`
     заново (не покладатись на копію в цьому документі — вона може бути
     застарілою вже до прочитання).
  3. Не запускати `git checkout`/`reset`/`clean` без попереднього `git stash`
     — робоче дерево може містити незбережені зміни ОБОХ сесій одночасно.
  4. Не вирішувати одноосібно конфлікт `proj_arc/` vs `proj_archive docs/`
     — питати користувача.
- Тому: `OPEN_ISSUES.md` (P1-03 та інші пункти) зараз відсутній у корені —
  шукати вміст у `proj_archive docs/OPEN_ISSUES.md`, якщо потрібен.
- `docs/adr/0001-protocol-catalog.md` показаний як modified у git status,
  але зміст цієї конкретної модифікації я в цій сесії не перевіряв (могла
  бути внесена паралельною сесією).
- Гілка `bms-v1.1-manifest-audit` — нова, HEAD той самий commit
  (`93b4c1d`), що й на `fix/settings-diagnostics-dedup`; перехід гілки
  відбувся МІЖ моїми turn'ами, не мною ініційований.

### Стан перевірки

- **Тести:** востаннє реально запускались (`test/run_all.sh`) ДО світчу
  гілки й появи паралельної сесії — EXIT=0, 0 FAIL (822-рядковий лог,
  `protocol/evidence/stage1_corrective_evidence/v2_manifest_baseline/run_all_stage5_self_audit_fixes.txt`).
  **Важливе уточнення (щоб не читати це як "V2 workbook протестовано
  наскрізь"):** `JK_BMS_WORKBOOK_PATH` для цього прогону вказував на
  СТАРИЙ V1 workbook (`test/run_all.sh`/`pipeline.js build` завжди
  запускались із ним) — це те, що реально читає старий release pipeline.
  V2 workbook (`LiFePO4_BMS_Parameters_registers-V2_verified.xlsx`)
  перевірявся ОКРЕМИМ, самостійним інструментом
  (`protocol/evidence/build_v2_manifest.py --workbook <V2 path> --check`),
  не через `test/run_all.sh`/`pipeline.js`. Я ніколи не запускав старий
  pipeline проти V2 workbook — тож "EXIT=0, 0 FAIL" НЕ підтверджує і не
  спростовує твердження про `KeyError: 'BMS Parameters'` (див. TBD-пункт
  вище й "Розбіжності" нижче).
  **НЕ перезапускались у цій сесії після світчу гілки/змін від Codex** —
  синтаксис `jk_bms.js` підтверджено (`node -c`), але повний прогін
  потрібен перед тим, як довіряти поточному стану.
- **Білд:** проєкт без build-кроку (Node/Python stdlib, немає
  package.json/бандлера) — N/A.
- **Git:** гілка `bms-v1.1-manifest-audit`, останній commit `93b4c1d` ("Add
  illustrated architecture overview"). Велике незакомічене дерево (67+
  файлів) — нічого не закомічено й не запушено цієї сесії, як і раніше.
