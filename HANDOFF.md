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
- **ESPHome `config`/`compile` не виконано в цьому середовищі** — немає
  локального esphome CLI, немає venv із закріпленим Python 3.9.6, Docker
  daemon не запущений, PyYAML відсутній. Мережевих встановлень без
  окремого дозволу не виконував. YAML-зміна (`capacity_remaining`'s
  `value_type: S_DWORD`) підтверджена непрямо: `test/register_catalog/
  validate.js` (звіряє кожен `address:` проти каталогу) і тим, що
  `S_DWORD` — вже існуючий, робочий тип у цьому самому файлі (`charge_otp`,
  0x104C).
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
