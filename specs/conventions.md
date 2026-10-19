# Conventions Extractor — repo → кандидати → скіл `repo-conventions`

Status: implemented (2026-10-19); see "As built" at the end for where the code differs from the plan. Батьківська спека — [skills.md](./skills.md): результат екстрактора — звичайний скіл.
Джерело вимог — бриф ДЗ (Lab 2 / HW 2, критерії 38–53) і два дизайни: сторінка «Conventions in <repo>»
та модалка «Create skill from conventions».


## Context

Юзер хоче, щоб рев'ю-агенти знали **house rules** конкретного репозиторію — правила, які код уже
дотримується, але які ніде не записані (async/await замість `.then()`, typed `Result<T, ApiError>` у
публічних хендлерах, Redis тільки через синглтон). Фіча:

1. запускає аналіз репозиторію на конвенції;
2. показує всіх знайдених кандидатів — правило, файл:рядки, код-доказ, впевненість;
3. дає Accept / Reject / Edit (inline) для кожного кандидата;
4. з прийнятих відкриває модалку, де редагується тіло майбутнього скіла й метадані;
5. зберігає скіл `repo-conventions` і лінкує його до агента — або відміняє.

Принцип: **модель лише пропонує**. Які файли читати, вирішує код; чи існує доказ, перевіряє код.
Кандидат без доказу у файлі не доходить до юзера.

**Що вже є (перевикористовуємо):**
- Таблиця `conventions` — `server/src/db/schema/knowledge.ts:31` (rule, evidence_path, evidence_snippet, confidence, accepted); нею ніхто не користується.
- Контракт `ConventionCandidate` — `server/src/vendor/shared/contracts/knowledge.ts:224`; ніде не імпортується.
- Feature-model `conventions` — `contracts/platform.ts:73`, `resolveFeatureModel` — `server/src/modules/settings/feature-models.ts`.
- Settings → Feature Models уже рендерить рядок Conventions із `SearchableSelect` по живому списку моделей — `client/src/app/settings/[section]/_components/SettingsView/_components/SettingsModels/SettingsModels.tsx` (**критерій 53 виконано**, міняється лише дефолт).
- `repoIntel.getConventionSamples(repoId, n)` — `server/src/modules/repo-intel/service.ts:632`: топ-N шляхів за рангом без тестів/конфігів/міграцій. **Лише шляхи**, без вмісту; конфіги свідомо відфільтровано.
- Приватний `readClone(clonePath, file)` — `repo-intel/service.ts:769`: читання з клону з realpath-guard.
- `MockLLMProvider.structuredBySchema` — `server/src/adapters/mocks.ts:49`.
- `SkillsService.create/update` (версії тіла) — `server/src/modules/skills/service.ts:65,89`; `agentsRepo.linkSkill` (additive upsert) — `server/src/modules/agents/repository.ts:352`.
- i18n `client/messages/en/conventions.json`; `activeKeyFor('/conventions')` — `client/src/components/app-shell/helpers.ts:31`.
- Клієнтський кит форми скіла `client/src/components/skill-form/` (`SkillBodyField` + `CodeTextarea`, `validateSkillForm`, `SKILL_TYPES`).


## Прийняті рішення

| Питання | Рішення | Відхилена альтернатива (причина) |
|---|---|---|
| Виконання скану | Синхронний `POST /repos/:id/conventions/extract`: семпл → один structured-виклик → gate → запис; відповідь містить кандидатів і статистику | JobRunner + 202 + polling (як `resync`) — забагато механіки для одного дешевого виклику; лишається в roadmap, якщо скан стане багатокроковим |
| Відбір зразків | Чистий код: `CONFIG_FILES` (package.json, tsconfig, eslint, prettier, editorconfig) + `getConventionSamples(repoId, 12)`; вміст читає новий facade-метод `repoIntel.readRepoFile` | Двокроковий діалог «модель обирає файли» — суперечить критерію 39; `container.git.readFile` — немає захисту від `..`/symlink |
| Gate доказів | Код: (1) файл є серед прочитаних, (2) рядки в межах файлу, (3) сніпет (нормалізовані пробіли) є у файлі в межах ±3 рядків від цитованих — тоді рядки виправляються на фактичні; інакше — drop. Сніпет для UI вирізається **з файлу** | Другий LLM-виклик «перевір» — модель перевіряє модель; «low confidence» замість drop — вигаданий доказ лишився б у UI |
| Тріаж | Два статуси: `ACCEPTED / REJECTED` замість булевого `accepted`. Новий кандидат — `ACCEPTED` (як на дизайні: «3 of 3 accepted» одразу після скану); Reject → `REJECTED`, Accept повертає назад; «Deselect all» → усі `REJECTED` | Третій статус `PENDING` — зайвий стан для юзера, дизайн показує кандидатів одразу прийнятими; новий = `REJECTED` (opt-in) — не відрізнити «відхилено за замовчуванням» від свідомого Reject |
| Re-scan | Існуючі рядки не чіпає; додає лише нові правила, яких ще немає в списку (дедуп з усіма ACCEPTED і REJECTED за нормалізованим текстом правила), тож відхилене не повертається (критерій 48) | Повна заміна — юзер втрачає тріаж і inline-правки; заміна лише ACCEPTED — губляться відредаговані прийняті правила |
| Збирання скіла | Сервер: `GET …/conventions/skill-draft` будує тіло з ACCEPTED pure-хелпером; модалка лише редагує | Клієнтський хелпер — критерій 42 вимагає збирання на бекенді, формат скіла має належати серверу |
| Один чи кілька скілів | Один скіл, ім'я за замовчуванням `repo-conventions` (редаговане) | Скіл на категорію — більше UI, не вимагається критеріями; у roadmap |
| Повторний Create | Якщо скіл з таким ім'ям є — нова версія тіла (історія + restore); футер модалки показує «Saved as v{N}» | 409 + перейменування — ламає цикл «re-scan → оновити скіл» |
| Лінк до агента | Пікер «Link to agent» у модалці, за замовчуванням General Reviewer; сервер лінкує additive (`agentsRepo.linkSkill`) у тому ж запиті | `PUT /agents/:id/skills` — замінює весь список і стирає інші скіли агента; авто-лінк до всіх агентів — неочікуваний вплив на всі рев'ю |
| Модель | `FEATURE_MODELS.conventions.defaultModel` = `gpt-4o-mini` (CHEAP із `platform/model-router.ts`); override у Settings → Feature Models | Залишити `gpt-5.4` — бриф просить дешеву модель; захардкодити в сервісі — суперечить критерію 53 |
| Доступ до skills з conventions | Новий `server/src/modules/skills/index.ts` (публічний `SkillsService`) + `SkillsService.upsertByName` | Імпорт `skills/service.ts` напряму — `no-cross-module-internals`; дублювати вставку скіла в conventions-репозиторії — дві реалізації версіонування |
| Enum на дроті | `UPPER_CASE` (`ConventionCategory`, `ConventionStatus`) — репо-правило для wire-enum | lowercase як у `SkillType` — історичний виняток, не зразок |


## Фаза 0 — Специфікація

Цей файл + рядок у `specs/README.md`.

## Фаза 1 — Контракти (`server/src/vendor/shared/contracts/`, потім `./scripts/check-shared.sh --sync`)

- `ConventionCategory` = `NAMING | STRUCTURE | ERROR_HANDLING | ASYNC | TYPING | IMPORTS | TESTING | STYLE | OTHER`.
- `ConventionStatus` = `ACCEPTED | REJECTED`.
- `ConventionCandidate` = `{ id, repo_id, category, rule, evidence_path, evidence_start_line, evidence_end_line, evidence_snippet, confidence, status, created_at }` (поле `accepted` прибрано).
- `UpdateConventionInput` = `{ rule?, category?, status? }` (мін. одне поле).
- `BulkConventionStatusInput` = `{ ids: uuid[], status }`.
- `ExtractConventionsResult` = `{ candidates, stats: { sampled_files, proposed, dropped_ungrounded, dropped_duplicate }, model, cost_usd }`.
- `ConventionSkillDraft` = `{ name, description, type, enabled, body, accepted_count, existing_skill: { id, version } | null }`.
- `CreateConventionSkillInput` = `CreateSkillInput.omit({ source })` + `agent_id: uuid`.
- `FEATURE_MODELS.conventions.defaultModel` → `gpt-4o-mini` (+ дзеркало `client/src/lib/feature-models.ts`).

## Фаза 2 — Server

- **Міграція** `0012_*` (`pnpm db:generate`): `conventions` + `category`, `evidence_start_line`, `evidence_end_line`, `status` (`not null default 'ACCEPTED'`), `created_at`, `updated_at`; drop `accepted`; індекс `(repo_id, status)`. `ConventionRow` у `src/db/rows.ts`.
- **repo-intel**: `readRepoFile(repoId, path)` у facade (`types.ts`, `service.ts`) поверх `readClone`; не гейтиться `REPO_INTEL_ENABLED`.
- **skills**: `index.ts` + `SkillsService.upsertByName(workspaceId, input, changeNote)`.
- **`src/modules/conventions/`**: `constants.ts`, `schema.ts` (LLM-схема `ConventionExtraction`, критерій 40), `helpers.ts` (`renderSample`, `verifyEvidence`, `dedupeRules`, `buildSkillDraft`, `toConventionDto`), `repository/convention.repo.ts`, `service.ts`, `routes.ts`; промпт `src/prompts/conventions.system.md`; вміст файлів — через `wrapUntrusted`.

Помилки: чужий/неіснуючий репо → 404; репо без клону → 422 «clone the repo first»; жодного прочитаного файлу → 422 до виклику моделі; draft/create без ACCEPTED → 422; чужий агент → 404.

## Фаза 3 — Client

- `vendor/ui/nav.ts`: пункт Conventions у секції SKILLS LAB (критерій 44), `href: /repos/:repoId/conventions`.
- `src/lib/hooks/conventions.ts`: `useConventions`, `useExtractConventions`, `useUpdateConvention` (optimistic), `useBulkConventionStatus`, `useConventionSkillDraft`, `useCreateConventionSkill`.
- `src/app/repos/[repoId]/conventions/page.tsx` → `_components/ConventionsView`, `ConventionCard`, `EvidenceBlock`, `CreateSkillFromConventionsModal`.
- Розширити `messages/en/conventions.json`.

## Фаза 4 — Тести, e2e

Див. «Verification». e2e: `e2e/specs/09-conventions.flow.json`.

## Фаза 5 — pr-self-review, insights

Юзер запускає `/pr-self-review`; після — `engineering-insights` для `server` і `client`.


## Додаток A — Карта критеріїв

| # | Критерій | Де реалізовано |
|---|---|---|
| 38 | `POST /repos/:id/conventions/extract` запускає аналіз, результат персистентний | `conventions/service.ts#extract` → `insertNew` (лише недубльовані); `GET /repos/:id/conventions` |
| 39 | Відбір зразків без моделі: конфіги + топ-12 через `getConventionSamples` | `CONFIG_FILES` + `getConventionSamples(repoId, 12)` + `readRepoFile` |
| 40 | Кандидат від моделі `{категорія, правило, evidence: файл+рядок, впевненість}` | `conventions/schema.ts` (`ConventionExtraction`) |
| 41 | Модалка: редагування тіла й метаданих | `CreateSkillFromConventionsModal` (`SkillBodyField`, name/description/type/enabled) |
| 42 | Accepted → один скіл `repo-conventions`, прилінкований до агента | `GET …/skill-draft`, `POST …/skill` → `upsertByName` + `agentsRepo.linkSkill` |
| 44 | Conventions у SKILLS LAB | `vendor/ui/nav.ts` |
| 45 | Окремі кнопки Run Scan і Re-scan | `ConventionsView`: Run Scan в empty state, Re-scan у хедері |
| 46 | Картка: правило, файл, % впевненості | `ConventionCard` + `EvidenceBlock` |
| 47 | Accept / Reject / Edit на картці | `ConventionCard` |
| 48 | Reject зберігається, не повертається, не йде в скіл | `status = REJECTED`; re-scan не чіпає існуючих і дедуплікує з REJECTED; draft бере лише ACCEPTED |
| 49 | Edit inline | `ConventionCard` edit-режим → `PATCH /conventions/:id` |
| 50 | Create skill з'являється при ≥ 1 accepted | `ConventionsView` |
| 51 | Модалка пояснює «створення з конвенцій», Name/Description, Cancel/Create | `CreateSkillFromConventionsModal` (банер) |
| 52 | Новий скіл видно на сторінці Skills | `useCreateConventionSkill` інвалідує `skills` |
| 53 | Settings → Models → Conventions, модель не захардкоджена | уже є; сервіс бере модель через `resolveFeatureModel` |

## Додаток B — Карта API

| Метод і шлях | Що робить | Хук → екран |
|---|---|---|
| `GET /repos/:id/conventions` | кандидати репо (усі статуси), новіші першими | `useConventions` → сторінка |
| `POST /repos/:id/conventions/extract` | семпл → LLM → gate → додати нові (недубльовані) як ACCEPTED | `useExtractConventions` → Run Scan / Re-scan |
| `PATCH /repos/:id/conventions` | масова зміна статусу (`ids`, `status`) | `useBulkConventionStatus` → Deselect all (→ REJECTED) |
| `PATCH /conventions/:id` | accept / reject / edit rule + category | `useUpdateConvention` → картка |
| `GET /repos/:id/conventions/skill-draft` | тіло й метадані скіла з ACCEPTED, нічого не пише | `useConventionSkillDraft` → модалка |
| `POST /repos/:id/conventions/skill` | create або нова версія `repo-conventions` + лінк агента | `useCreateConventionSkill` → модалка |


## Критичні файли

- server: `src/vendor/shared/contracts/{knowledge,platform}.ts`, `src/db/schema/knowledge.ts`, `src/db/rows.ts`, `src/modules/repo-intel/{types,service}.ts`, `src/modules/skills/{index,service}.ts`, `src/modules/conventions/**` (новий), `src/modules/index.ts`, `src/prompts/conventions.system.md`
- client: `src/vendor/shared/**` (sync), `src/vendor/ui/nav.ts`, `src/lib/feature-models.ts`, `src/lib/hooks/{conventions,index}.ts`, `src/app/repos/[repoId]/conventions/**` (новий), `messages/en/conventions.json`
- repo: `specs/conventions.md`, `specs/README.md`, `e2e/specs/09-conventions.flow.json`

## Out of scope

Скіл на категорію; фоновий скан і планове пересканування; частота патерну через ripgrep як сигнал впевненості; пошук контрприкладів; навчання на відхилених; тести/спеки як джерело зразків (`getConventionSamples` їх відфільтровує); видалення кандидатів (є Reject).


## Verification

- server: `pnpm db:generate` (0012 містить лише очікуване), `pnpm db:migrate`, `pnpm typecheck && pnpm test:unit && pnpm arch:check`, `pnpm test:integration`:
  - `test/conventions-helpers.test.ts` — гуттер і бюджет; gate: немає файлу, рядок поза межами, вигаданий сніпет, зсунутий рядок (кандидат лишається з виправленими рядками); dedupe; `buildSkillDraft`;
  - `test/conventions.it.test.ts` — вигаданий кандидат відкинуто; новий кандидат має статус ACCEPTED; GET після extract повертає збережене; re-scan не змінює існуючі рядки (зокрема відредаговані), додає лише нові й не повертає відхилене; bulk → REJECTED; PATCH edit; draft лише з ACCEPTED; skill: v1 + лінк, повторно — v2; 422 (без клону, нічого не accepted); 404 (чужий репо/агент).
- client: `pnpm typecheck && pnpm lint && pnpm test` — `ConventionCard` (Accept/Reject/Edit inline), `ConventionsView` (Run Scan vs Re-scan, видимість Create skill), модалка (prefill з draft, payload з `agent_id`).
- `./scripts/check-shared.sh`, `./scripts/e2e.sh`.
- Вручну (`./scripts/dev.sh`): додати реальний репо (клон + індекс) → Conventions → Run Scan → Accept/Reject/Edit → reload (стан збережено) → Create skill → `/skills` показує `repo-conventions` v1 (convention, extracted), прив'язаний до General Reviewer → Re-scan → Create → v2 → рев'ю PR → блок скіла в трасі → Settings → Models → Conventions: інша модель використовується.


## As built (2026-10-19) — відмінності від плану

| Що | Як зроблено | Чому |
|---|---|---|
| Міграція | Дві, а не одна: `0012_vengeful_slapstick.sql` (нові колонки + індекс) і `0013_melodic_network.sql` (NOT NULL на доказах + drop `accepted`) | drizzle-kit інтерактивно питає «rename?», коли в одній зміні колонки й додаються, і видаляються; без TTY генерація зависає (server INSIGHTS) |
| Збірка клієнта | `resolve.extensionAlias` (`.js` → `.ts`) у `client/next.config.mjs` | `ConventionCard` бере категорії з `ConventionCategory.options` — перший value-імпорт із `@devdigest/shared` у клієнті; без alias Next не резолвив `./contracts/*.js` і падав увесь застосунок (client INSIGHTS). Відхилено: дублювати список категорій у клієнті |
| Wiring сервісу | `ConventionsService` з вузькими залежностями + фабрика `createConventionsService(container)` у `service.ts`; нові фасади `skills/index.ts`, `settings/index.ts` | роут не може імпортувати репозиторій; модуль не може імпортувати чужі внутрішні файли (`arch:check`) |
| Хук збереження скіла | `useCreateConventionSkill` у `client/src/lib/hooks/skills.ts`, а не в `conventions.ts` | використовує приватні query-ключі скілів (`skillChanged`); draft не інвалідовується — `useConventionSkillDraft` має `staleTime: 0, gcTime: 0` і перезапитується при кожному відкритті модалки |
| Сайдбар | пункт Conventions зі шорткатом `g c` | — |
| e2e | `09-conventions` пройшов 2 з 3 герметичних прогонів; у тих же прогонах раз упав і наявний `02` | причина не встановлена, див. e2e INSIGHTS → Open Questions |

Тести: server — `test/conventions-helpers.test.ts` (19), `test/conventions.it.test.ts` (10); client — `ConventionCard` + `helpers`, `EvidenceBlock`, `ConventionsView`, `CreateSkillFromConventionsModal`, `SkillDraftForm` + `helpers`, `hooks/conventions` (37).

### Review follow-up (2026-10-19) — `/pr-self-review` WARNINGs

- **Гонка двох сканів одного репо.** «Прочитати наявні правила → дедуп → вставити» в `ConventionsService.extract` тепер в одній транзакції під `pg_advisory_xact_lock` на `repo_id` (`ConventionRepository.lockRepo`). Друге перекриття чекає і бачить рядки першого, тож те саме правило не вставляється двічі. Виклик моделі лишається поза транзакцією — з'єднання не тримається ~хвилину. *Відхилено:* унікальний індекс на `(repo_id, rule)` — дедуп іде за нормалізованим ключем (`ruleKey`: регістр, пунктуація, бектики), а не за точним текстом, і індекс по виразу дублював би `ruleKey` у SQL; транзакція без блокування — на READ COMMITTED обидва скани однаково бачать «до». Перевірено тестом `two overlapping scans insert a new rule once`, який без блокування падає.
- **Міграції `0012`/`0013` безпечні лише на порожній `conventions`.** `0013` робить `SET NOT NULL` на `evidence_*` / `confidence` без backfill і видаляє `accepted` без перенесення в `status`; на таблиці з хоча б одним рядком вона впаде з `column contains null values`. Свідомо прийнято: до цієї фічі таблицю лише оголошено (`0000_init`), жоден код у неї не писав, а `seed.ts` лишає її порожньою — тож рядків у ній немає ні в dev-, ні в e2e-, ні в CI-базах. `0013` уже застосована локально, тому не переписується (застосовані міграції незмінні). Якщо колись знайдеться база з даними в `conventions` — перед `pnpm db:migrate` очистити таблицю (`DELETE FROM conventions;`): старі рядки без доказів і рядків файлу все одно не пройшли б evidence gate.
- **Тести.** Додано `CreateSkillFromConventionsModal.test.tsx` (skeleton до завантаження draft **і** агентів, передача обох у форму, помилка → Retry перезапитує обидва, Cancel під час завантаження) і в `ConventionsView.test.tsx` — стани завантаження й помилки списку з Retry.
- **Розміщення.** `lineRange` і `COPY_FEEDBACK_MS` перенесено з `ConventionCard/` у `ConventionCard/_components/EvidenceBlock/` — їх використовує лише `EvidenceBlock`.
- **Колір смужки впевненості** рахується з того самого округленого відсотка, що й підпис (пороги 85/65 у відсотках, як у `ConfidenceNum`): раніше `0.846` показувалось як «85%» з жовтою смужкою.
- **Copy в `EvidenceBlock`**: кнопка після копіювання має доступне ім'я «Copied» (зворотний зв'язок і для скрінрідерів), покрито `EvidenceBlock.test.tsx` (буфер обміну, підтвердження, скидання через `COPY_FEEDBACK_MS`, однорядковий діапазон).
