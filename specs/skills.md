# Skills — reusable prompt skills for review agents

Status: implemented (2026-10-16); see "As built" at the end for where the code differs from the plan. Source requirements: Ukrainian brief previously in this README; UI designs: Skill Editor (Config / Preview / Stats / Versions) and Agent editor → Skills tab.


## Context

Агент зараз = один system prompt. Потрібні **скіли**: перевикористовувані текстові блоки
конфігурації (назва, опис, тип, markdown-тіло), які зберігаються в БД, редагуються в UI з історією
версій, прив'язуються до кількох агентів з порядком і перемикачем, і під час рев'ю додаються в
промпт окремими блоками. Скіл — **лише текст**: жодних інструментів, скриптів, виконання.
Мета — контрольним експериментом (Test Quality і API Contract агенти) показати, що скіли змінюють
результат рев'ю, і що це видно в трасі прогону (блоки + додані токени) та в статистиці скіла.

**Що вже є (перевикористовуємо):**
- Таблиці `skills`, `skill_versions(skill_id, version, body, created_at)`, `agent_skills(agent_id, skill_id, order)` — `server/src/db/schema/skills.ts`, `server/src/db/schema/agents.ts:51`.
- `findings.category`, `findings.accepted_at / dismissed_at` (`server/src/db/schema/reviews.ts:37-45`), `reviews.run_id` → `agent_runs` — достатньо для Stats, якщо записувати, які скіли були в прогоні.
- Контракти `Skill`, `SkillType`, `SkillSource`, `AgentSkillLink` — `server/src/vendor/shared/contracts/knowledge.ts:114-224`.
- Репозиторій лінків `linkedSkills / linkSkill / setSkills` — `server/src/modules/agents/repository.ts:231-280`; роути `GET/POST /agents/:id/skills` — `modules/agents/routes.ts:145-161`.
- Слот `skills` у `assemblePrompt` (`reviewer-core/src/prompt.ts:50,96-117`), `ReviewInput.skills` (`reviewer-core/src/review/run.ts:55`) — але `run-executor.ts:189` їх не передає, і зараз вони йдуть у user-повідомлення.
- `PromptAssembly.skills` (`contracts/trace.ts:39`) і блок Skills у `TraceBody.tsx:79` — без токенів.
- UI-примітиви `@devdigest/ui`: `Card`, `Toggle`, `Tabs`, `Badge`, `Dropdown`, `Modal`, `Checkbox`, `FormField{hint}`, `TextInput`, `SelectInput`, `Textarea`, `Markdown`, `EmptyState`, `Skeleton`; `recharts` для донату; `container.tokenizer` (tiktoken) на сервері; i18n `messages/en/skills.json` (є `page.selectPrompt`, `preview.untrustedNotice`, `listItem.type/source.*`) і `agents.json → skills.*`.
- Шаблон master-detail: `client/src/app/agents/[id]/_components/AgentEditorView` (ліва колонка карток + шапка + `Tabs` з `?tab=`).

## Прийняті рішення

| Питання | Рішення | Відхилена альтернатива (причина) |
|---|---|---|
| Увімкнення | Два рівні: `skills.enabled` = глобальний kill-switch (тумблер на картці та в Config); нова `agent_skills.enabled` = для конкретного агента. У промпт: `link.enabled && skill.enabled`. Вкладка агента показує всі скіли, порядок зберігається і для вимкнених | Чекбокс = прив'язати/відв'язати — вимкнений скіл втрачає позицію |
| Місце в промпті | System: промпт агента → `## Skills` з блоками `### Skill: <name>` → `INJECTION_GUARD` останнім | User-повідомлення — суперечить дизайну й змішує конфіг агента з даними PR |
| Навігація | `client/src/vendor/ui/nav.ts`: секція SKILLS LAB = Skills (`g s`) + Agents | — |
| pr-self-review | `disable-model-invocation: true` + Session protocol: агент просить користувача запустити `/pr-self-review` | Лише прапорець — AGENTS.md суперечив би поведінці |
| Імпорт | `.md` або `.zip`; ядро = `SKILL.md` (frontmatter name/description + тіло); решта — список «проігноровано» | `references/*.md` у тіло (роздуває токени); `.tar.gz` (залежність + поверхня атаки) |
| Нові агенти | Test Quality Reviewer і API Contract Reviewer у seed без скілів; тексти скілів у `docs/skills-examples/`, заводяться через UI/імпорт | Сіяти скіли — тоді шлях створення/імпорту ніхто не проходить |
| Stats | Повна: нова таблиця `run_skills` пишеться на кожен прогін; метрики рахуються з неї | Лише «Used by» — не показує ефекту скіла, а це суть уроку |
| Evals | Вкладка Evals і «Run on evals» видимі, але disabled з підказкою «Coming in the Evals lesson» | Приховати — розходиться з дизайном |
| Редактор тіла | Власний `CodeTextarea`: mono textarea + гутер номерів рядків, шапка файлу, бейдж `unsaved`, лічильник токенів; підсвітки немає — її роль виконує вкладка Preview | CodeMirror 6 — важка нова залежність, ризик pnpm 10/12 (client INSIGHTS) |

Додаткові рішення (підуть у spec):
- **Парсинг імпорту на сервері** (`fflate`, pure JS); клієнт шле файл base64 у JSON (`src/lib/api.ts` без multipart, `bodyLimit` 1 МБ). Відхилено: jszip у браузері — безпекова логіка поза серверними тестами.
- **Прев'ю імпорту stateless**: нічого не пише; збереження = `POST /skills` після підтвердження.
- **Frontmatter вручну** (`key: value`), без `gray-matter`/`js-yaml`.
- **Версії = знімки тіла.** Версія +1 лише коли змінюється `body`; до знімка — необов'язкова нотатка «What changed?» (дефолт: «Initial version» / «Updated body»). **Restore не переписує історію** — створює нову версію зі старим тілом і нотаткою «Restored from vN». Diff — власний чистий `lineDiff` (LCS по рядках, тіло ≤ 20k символів); відхилено: пакет `diff` — зайва залежність для одного екрана.
- **Токени**: сервер рахує `tokens` для збереженого тіла (`container.tokenizer`) і віддає в DTO; поки є незбережені зміни, редактор показує `~N tokens` (наближення chars/4).
- **Stats — кореляція, не причинність**: підпис у UI «Runs where this skill was in the prompt».
  - *Used by* = кількість агентів з `link.enabled`.
  - *Pull frequency* = прогони за 30 днів із цим скілом у промпті / усі завершені прогони агентів, до яких скіл прив'язаний.
  - *Accept rate* = accepted / (accepted + dismissed) findings цих прогонів (`null` → «—»).
  - *Findings (30d)* і донат *by category* — findings цих прогонів (кількості, не $).
- **Імпортований скіл після підтвердження = конфіг агента**, не `<untrusted>` (як у `reviewer-core/docs/prompt-assembly.md`); довіру вирішує людина на прев'ю (банер «чужий скіл = чужі інструкції в промпті»).
- Зміна набору/порядку/enabled лінків **бампить версію агента** зі снапшотом скілів — щоб прогони «без/зі скілами» розрізнялись у `config.version` траси.
- Унікальна назва в межах воркспейсу → 409; прев'ю імпорту показує `name_conflict`.
- Тумблер Enabled на картці і в Config — одна мутація й один кеш (зберігається одразу, не через Save), тож вони не розходяться (client INSIGHTS про два контроли одного стану).

## Фаза 0 — Специфікації (до коду)

- `specs/skills.md` — цей план як spec: мета, рішення + відхилені альтернативи, контракти, критерії приймання (= «Перевірка наприкінці»), out of scope. Вимоги з `specs/README.md:21-59` переносяться сюди, у README лишається рядок індексу.
- `reviewer-core/specs/skills-slot.md` — зміна слота (system замість user, формат блоку).

## Фаза 1 — Контракти (`server/src/vendor/shared/contracts/`, потім `./scripts/check-shared.sh --sync`)

`knowledge.ts`:
- `SkillSource` += `'imported_file'`; `Skill` += `tokens: int`, `created_at`.
- `SkillListItem = Skill & { agent_count, pull_rate: number|null, accept_rate: number|null }` — для карток.
- `AgentSkillLink` += `enabled`.
- `CreateSkillInput { name(1..80), description(1..500), type, body(1..20000), enabled?, source?: 'manual'|'imported_file' }`; `UpdateSkillInput` = partial без `source` + `change_note?: string(≤200)`.
- `SkillVersion { version, body, message, created_at, current: boolean }`.
- `SkillStats { used_by: { agent_id, name, enabled }[], pull_rate, accept_rate, findings_30d, findings_by_category: { category, count }[] }`.
- `SetAgentSkillsInput { skills: { skill_id, enabled }[] (≤50) }` — порядок масиву = порядок у промпті.
- `SkillImportRequest { filename, content_base64 }`; `SkillImportPreview { name, description, type, body, source_file, ignored_files: { path, reason: 'executable'|'not_core'|'binary'|'too_large' }[], warnings, name_conflict }`.

`trace.ts`: `PromptAssembly.skill_blocks?: { skill_id, name, version, text, tokens }[] | null`.

## Фаза 2 — reviewer-core

- `src/prompt.ts`: `PromptParts.skills?: PromptSkill[]` (`{ name, body }`); експорт `renderSkillBlock()`; system = агент → `## Skills` → блоки → `INJECTION_GUARD`; прибрати `## Skills / rules` з user; `assembly.skills` = відрендерений блок. INJECTION_GUARD не чіпаємо.
- `src/review/run.ts`: тип `ReviewInput.skills`; перевірити, що map-reduce прокидає skills у кожен чанк. `src/index.ts`: експорти.
- `test/prompt.test.ts` + оновити `docs/prompt-assembly.md`.

## Фаза 3 — Server

**Міграція 0011** (`pnpm db:generate`): `agent_skills.enabled bool not null default true`; unique `(workspace_id, name)` на `skills`; `skill_versions.message text not null default ''`; нова таблиця `run_skills(run_id → agent_runs cascade, skill_id → skills cascade, skill_version int, order int, tokens int, PK(run_id, skill_id))` + індекс по `skill_id`; `'imported_file'` у TS-enum `source`.

**Модуль `server/src/modules/skills/`** (шаблон `modules/agents`, реєстрація в `modules/index.ts`, `container.skillsRepo`):
- `routes.ts` — див. Додаток B.
- `service.ts`: CRUD з workspace-скоупом; версії (create → v1 «Initial version»; body змінився → v+1 з `change_note`); restore; 409 на назву; `tokens` через `container.tokenizer`.
- `repository/skill.repo.ts`, `repository/skill-stats.repo.ts` — агрегати для `SkillListItem` і `SkillStats` (одним запитом на список, без N+1; шаблон rollup — `test/pulls-list.it.test.ts` за INSIGHTS).
- `helpers.ts` (чисті): `parseSkillMarkdown`, `previewFromZip` (`fflate.unzipSync` з `filter`: розпаковується лише `SKILL.md` з кореня або однієї теки, `originalSize` перевіряється до розпакування; ліміти: архів ≤ 512 КБ, ≤ 200 записів, SKILL.md ≤ 64 КБ; решта → `ignored_files`), `rate(num, den)`. `pnpm add fflate`.

**Agents module:** `PUT /agents/:id/skills` (перевірка воркспейсу всіх skill_id — закриває наявну tenancy-дірку; заміна лінків + bump версії агента в одній транзакції за патерном `repository.update`); `GET` повертає `enabled`; `activeSkillsForRun(agentId)` → `{id, name, body, version}[]`.

**Run executor** (`modules/reviews/run-executor.ts`):
- перед `reviewPullRequest`: активні скіли → `tokens = tokenizer.count(renderSkillBlock(s))` → `runLog.step('Skills: N attached (+T tokens)')` + `runLog.info` на кожен увімкнений (вимкнені не логуються);
- передати `skills`; у трейс `prompt_assembly: { ...outcome.assembly, skill_blocks }`;
- записати `run_skills` у транзакції `persistCompletedRun` (обережно з INSIGHTS-гочою про поле-за-полем копію в `completeAgentRun`).

**Seed** (`db/seed.ts`, `db/seed-prompts.ts`, дзеркало в `docs/agent-prompts/`): Test Quality Reviewer, API Contract Reviewer — навмисно загальні промпти.

## Фаза 4 — Client

**Дані** — `client/src/lib/hooks/skills.ts` (приватна фабрика `keys`; в barrel `hooks/index.ts`): `useSkills`, `useSkill`, `useCreateSkill`, `useUpdateSkill`, `useDeleteSkill`, `useSkillVersions`, `useRestoreSkillVersion`, `useSkillStats`, `useImportSkillPreview`. У `hooks/agents.ts`: `useAgentSkills`, `useSetAgentSkills` (оптимістично). Інвалідація: зміна скіла → `skills`, `skill/:id`, `skill-versions/:id`, префікс `agent-skills`.

**Маршрути** (master-detail, як Agents; ліва колонка спільна через `layout.tsx`):
- `client/src/app/skills/layout.tsx` → `_components/SkillsListPane/`: заголовок «Skills», `Dropdown` «+ Add Skill» (Create / Import), пошук, список `SkillCard`.
- `app/skills/page.tsx` → права частина: `EmptyState` «Select a skill» (`skills.page.selectPrompt`).
- `app/skills/new/page.tsx` → `SkillEditorView` у режимі створення (вкладки Config + Preview).
- `app/skills/[id]/page.tsx` → `<Suspense>` + `SkillEditorView` з `?tab=config|preview|evals|stats|versions` (патерн `parseTabParam`).
- Спільне (`client/src/components/skill-card/`): `SkillCard` (іконка за типом, mono-назва, `Toggle` зі stopPropagation, опис у 1 рядок, `SkillTypeBadge`, `SkillSourceBadge` Manual/Imported/Extracted/Community, футер «N agents · X% pull · Y% accept»), `SkillTypeBadge` (також для вкладки агента).

**`SkillEditorView/_components/`:**
- шапка: іконка, назва, `SkillTypeBadge`, бейдж `v5`, кнопка «Run on evals» (disabled + tooltip).
- `ConfigTab`: «Configuration» + `vN`, тумблер Enabled; Name*, Description (hint: «Пишіть директивно: коли і що агент має робити — це інтерфейс скіла»), Type, Skill body* у `CodeTextarea` (шапка `<name>.md`, бейдж `unsaved`, `166 tokens` / `~N tokens`), поле «What changed?» (з'являється, коли body змінено), Save / Cancel.
- `PreviewTab`: «Rendered as the reviewing agent receives it.» → `Markdown` тіла.
- `EvalsTab`: disabled-заглушка.
- `StatsTab`: 4 KPI-плитки (Used by, Pull frequency, Accept rate з кільцем, Findings 30d), «Agents using this skill» (рядки з «Open» → `/agents/:id?tab=skills`), «Findings by category» — recharts-донат + легенда з кількостями (перед написанням завантажити скіл `dataviz`). Порожні дані → «—» і пояснення.
- `VersionsTab`: «Version history · N versions», підпис про відтворюваність; рядки `vN` + нотатка + дата; на поточній — бейдж Current; на інших — Diff (розгортає inline-diff vN → поточна через `helpers.lineDiff`) і Restore (підтвердження → `useRestoreSkillVersion`).
- `ImportSkillModal` (на рівні layout): файл `.md/.zip` → base64 → прев'ю (редаговані поля, Markdown тіла, ignored files, банер довіри, конфлікт назви) → Save → `router.push('/skills/<id>')`.

**Вкладка Skills агента** (`/agents/[id]?tab=skills`, як на дизайні): `VALID_TABS`/`TABS` += skills; `AgentEditor/_components/SkillsTab/` — «{linked} of {total} enabled», фільтр, рядки (ручка `GripVertical`, `Checkbox`, mono-назва, `SkillTypeBadge`, глобально вимкнений — приглушений); нативний HTML5 DnD + ↑/↓ з клавіатури; кожна зміна → `PUT /agents/:id/skills`. `helpers.ts`: `mergeSkillRows`, `moveRow`.

**Траса**: `PromptBlock` += проп `tokens`; `TraceBody` — блок на кожен елемент `skill_blocks` + сума «+N tokens»; fallback на `skills` для старих трас.

**Навігація**: `vendor/ui/nav.ts` — SKILLS LAB (Skills `Sparkles` `g s`, Agents); `SHORTCUTS += g s`.

**i18n**: `messages/en/skills.json` += `editor.*`, `tabs.*`, `stats.*`, `versions.*`, `import.*`, `descriptionHint`.

## Фаза 5 — Приклади, експеримент, e2e

- `docs/skills-examples/`: `test-quality/branch-coverage.md`, `test-quality/corner-cases.md`, `api-contract/route-breaking-change.md`, `api-contract/zod-contract-compat.md`, тека `test-quality/test-smells/` (`SKILL.md` + `scripts/run.sh` + `references/extra.md`) з інструкцією `zip -r` — для проходження імпорту.
- `docs/skills-experiment.md`: ручний сценарій контрольного експерименту (результат залежить від LLM).
- `e2e/specs/08-skills.flow.json`: /skills → Create → Save → картка в списку → вкладка Versions показує v1 → агент `?tab=skills` → скіл у списку.

## Фаза 6 — pr-self-review

`.claude/skills/pr-self-review/SKILL.md`: `disable-model-invocation: true`; корінь `AGENTS.md` (Session protocol) — «попроси користувача запустити `/pr-self-review`»; датований розділ у `specs/pr-self-review.md`; перевірити `scripts/git-hooks/pre-push`.

## Додаток A — Карта екранів

| Екран | URL | Статус |
|---|---|---|
| Сайдбар | усюди | змінено: секція SKILLS LAB |
| Ліва колонка скілів + «Select a skill» | `/skills` | нове |
| Створення скіла | `/skills/new` | нове |
| Скіл: Config / Preview / Evals (disabled) / Stats / Versions | `/skills/[id]?tab=…` | нове |
| Модалка імпорту (файл → прев'ю → Save) | поверх `/skills*` | нове |
| Вкладка Skills агента | `/agents/[id]?tab=skills` | нова вкладка |
| Траса → Prompt assembly | дровер на сторінці PR | змінено: блок на скіл + токени |

## Додаток B — Карта API

| Метод і шлях | Що робить | Хук → екран | Статус |
|---|---|---|---|
| `GET /skills` | список + `agent_count`, `pull_rate`, `accept_rate`, `tokens` | `useSkills` → ліва колонка, вкладка агента | новий |
| `GET /skills/:id` | один скіл | `useSkill` → шапка, Config, Preview | новий |
| `POST /skills` | створити (також Save після імпорту) → v1 | `useCreateSkill` → `/skills/new`, імпорт | новий |
| `PUT /skills/:id` | змінити; новий body → нова версія з `change_note` | `useUpdateSkill` → Config, тумблери | новий |
| `DELETE /skills/:id` | видалити (зникає з усіх агентів) | `useDeleteSkill` → Config | новий |
| `GET /skills/:id/versions` | історія знімків тіла | `useSkillVersions` → Versions | новий |
| `POST /skills/:id/versions/:version/restore` | нова версія зі старим тілом | `useRestoreSkillVersion` → Versions | новий |
| `GET /skills/:id/stats` | Used by, pull, accept, findings 30d, за категоріями | `useSkillStats` → Stats | новий |
| `POST /skills/import/preview` | розбирає .md/.zip, **нічого не зберігає** | `useImportSkillPreview` → імпорт | новий |
| `GET /agents/:id/skills` | прив'язки агента (+ `enabled`) | `useAgentSkills` → вкладка агента | змінено |
| `PUT /agents/:id/skills` | зберегти весь список: порядок + чекбокси | `useSetAgentSkills` → вкладка агента | новий |
| `GET /runs/:id/trace` | траса, тепер із `skill_blocks` | `useRunTrace` → дровер траси | змінено (вміст) |

Без роуту: run-executor бере активні скіли з БД, передає в reviewer-core, пише `run_skills` і `skill_blocks`.

## Критичні файли

- reviewer-core: `src/prompt.ts`, `src/review/run.ts`, `src/index.ts`, `test/prompt.test.ts`, `docs/prompt-assembly.md`
- server: `src/vendor/shared/contracts/{knowledge,trace}.ts`, `src/db/schema/{skills,agents,runs}.ts`, `src/modules/skills/**` (новий), `src/modules/index.ts`, `src/platform/container.ts`, `src/modules/agents/{routes,service,repository}.ts`, `src/modules/reviews/{run-executor.ts,repository/run.repo.ts}`, `src/db/seed.ts`, `src/db/seed-prompts.ts`
- client: `src/app/skills/**` (новий), `src/components/skill-card/` (новий), `src/app/agents/[id]/_components/{AgentEditorView,AgentEditor}/**`, `src/lib/hooks/{skills,agents,index}.ts`, `RunTraceDrawer/_components/{TraceBody,PromptBlock}`, `src/vendor/ui/nav.ts`, `messages/en/skills.json`
- repo: `specs/skills.md`, `specs/README.md`, `reviewer-core/specs/skills-slot.md`, `docs/skills-examples/**`, `docs/skills-experiment.md`, `e2e/specs/08-skills.flow.json`, `.claude/skills/pr-self-review/SKILL.md`, `AGENTS.md`

## Out of scope

Логіка евалів (вкладка й кнопка лише disabled); `skill_count` на `AgentCard` (rollup у `GET /agents`); імпорт за URL/community; скіли в CI-маніфесті; детектор-прогони (`run-executor.ts:425` лишає `skills: null`); секції сайдбару Conventions / Eval Dashboard / Memory тощо з дизайну (інші уроки).

## Verification

- reviewer-core: `npm run typecheck && npm test`.
- server: `pnpm db:generate` (0011 містить лише очікуване), `pnpm db:migrate && pnpm db:seed`, `pnpm typecheck && pnpm test:unit && pnpm arch:check`, `pnpm test:integration`:
  - `test/skills.it.test.ts` — CRUD, версії (body → v+1, інше → без бампу), restore створює нову версію, 409, чужий воркспейс;
  - `test/skills-import.test.ts` — md, zip (корінь/тека), без SKILL.md → 422, ліміти, executable у ignored;
  - `test/skills-stats.it.test.ts` — pull/accept/category на зібраних прогонах;
  - розширити `test/reviews.it.test.ts` — у system лише увімкнені скіли по порядку, `skill_blocks` з токенами, `run_skills` записано, вимкненого немає ні в трасі, ні в `log`.
- client: `pnpm typecheck && pnpm lint && pnpm test` — `SkillCard`, `SkillsListPane`, `ConfigTab` (unsaved, hint, change note), `VersionsTab` (Diff/Restore), `StatsTab` (порожні дані → «—»), `ImportSkillModal`, `SkillsTab` агента, `helpers.test.ts` (`lineDiff`, `mergeSkillRows`, `moveRow`), `TraceBody` з `skill_blocks`, інвалідація в `hooks/skills.test.tsx`.
- `./scripts/check-shared.sh`, `./scripts/link-agents.sh --check`, `./scripts/e2e.sh`.
- Вручну (`./scripts/dev.sh`): створити й відредагувати скіл (v1 → v2, Diff, Restore → v3); імпорт `test-smells.zip` (скрипт у ignored); прив'язати скіли до обох нових агентів, один вимкнути; рев'ю → у трасі блоки увімкнених скілів із токенами; Stats показує прогін; експеримент за `docs/skills-experiment.md`.
- Наприкінці: попросити користувача запустити `/pr-self-review` (лише вручну) і переконатися, що задіяні Frontend- і Backend-бакети; потім `engineering-insights`.


## As built (2026-10-16) — differences from the plan above

- **Editor location.** `SkillEditorView` (and its tabs) live in `client/src/components/skill-editor/`, not under `app/skills/_components/`: `/skills/new` and `/skills/[id]` are sibling routes, and the lint rule forbids importing another route's `_components`. The list pane, layout and import modal stay under `app/skills/_components/`.
- **Hooks.** `useAgentSkills` / `useSetAgentSkills` are in `lib/hooks/skills.ts` (not `agents.ts`) so every skill mutation can invalidate the `["agent-skills"]` prefix from one private `keys` factory.
- **No `container.skillsRepo`.** `SkillsService` builds its own repositories like `AgentsService`; the run executor reads active skills through the existing `container.agentsRepo.activeSkillsForRun`.
- **Agent skill links** switched on a globally-disabled skill do not bump the agent version (only a change of the *active* ordered ids does).
- **Evals tab / "Run on evals"** render but are disabled ("Coming in the Evals lesson").
- **Stats donut** is a small recharts `PieChart` with a count legend (the shared `Donut` formats values as money).
- **e2e** `08-skills.flow.json` is read-only (flow contract); create / edit / import / bind are covered by `server/test/skills*.test.ts` and the client component tests. Prose: `e2e/docs/specs/skills.md`.
- **`pr-self-review`** is manual-only; the protocol now says "ask the user to run it" ([pr-self-review.md](./pr-self-review.md), 2026-10-16).
- **Not done / by design:** the control experiment itself is manual ([../docs/skills-experiment.md](../docs/skills-experiment.md)) because its outcome depends on a live model.

### Review follow-up (2026-10-17) — `/pr-self-review` WARNINGs

- **`SkillCard` moved** to `client/src/app/skills/_components/SkillCard/`: its only consumer is the Skills list pane, so it did not belong in shared `components/` ("promote, don't predict"). `SkillTypeBadge` stays shared (card, editor header, agent Skills tab).
- **Stats queries are typed Drizzle**, not raw SQL: `skill-stats.repo.ts` reads other modules' tables (`agent_runs`, `reviews`, `findings`), and a renamed column now fails `tsc` instead of failing at runtime. Same public API, same numbers (the stats integration test is unchanged).
- **Agent editor tests** now cover the Skills tab (`AgentEditor.test.tsx`) and `?tab=skills` parsing (`AgentEditorView/helpers.test.ts`).
- **Migration `0011` is not changed.** It adds `UNIQUE(workspace_id, name)` without a dedupe step. *Rejected:* editing / regenerating `0011` (applied migrations are immutable; dev DBs already ran it), a new `0012` (`0011` fails first), and a `pr-self-review` waiver (only works on CRITICAL). Risk is theoretical: nothing created skills before `0011`. The WARNING stays visible in review reports as accepted.


## Gaps (2026-10-19) — доробка за критеріями ДЗ

Аудит за критеріями ДЗ знайшов прогалини в UI. Конвенції (38–42) і контрольний експеримент (17–18) свідомо відкладено.

| Критерій | Рішення | Відхилена альтернатива (причина) |
|---|---|---|
| 11, 12 — створення скіла | «Add Skill → Create» відкриває `CreateSkillModal` (name, description, type, body з Edit/Preview); маршрут `/skills/new` і create-режим `SkillEditorView` прибрано; спільне для модалки й Config-вкладки (`SkillBodyField` + `CodeTextarea`, `validateSkillForm`, ліміти, `SKILL_TYPES`) винесено в `components/skill-form/`; `skill-editor/index.ts` експортує лише редактор | Лишити `/skills/new` поряд із модалкою — два шляхи створення, один з яких мертвий |
| 22 — картка скіла | Показує `v{version}` поруч із типом | Версію лише в шапці редактора — на списку не видно, яка версія жива |
| 23, 24, 34 — видалення | Кнопка Delete на картці скіла й плитці агента; підтвердження — спільний `components/confirm-dialog/ConfirmDialog` на `Modal` (✕ / Cancel / Delete, Esc; фокус на Cancel при відкритті, Tab по колу всередині, повернення фокусу на кнопку-відкривач — kit `Modal` цього не робить) | `window.confirm` — без хрестика, без i18n, блокує потік, не тестується RTL |
| 31 — drag&drop | Тягнути/↑↓ можна лише увімкнені прив'язані скіли (`isOrderable`). Вимкнений лишається на своєму місці (на нього можна кинути увімкнений), тож рішення «порядок зберігається і для вимкнених» не порушено | (а) Дозволити тягати й вимкнені — їхня позиція не впливає на промпт, рух нічого не змінює й плутає; (б) переносити вимкнений у кінець прив'язаних — губить позицію, суперечить рішенню вище |
| 32 — плитка агента | `GET /agents` повертає `AgentListItem = Agent & { skill_count }` (прив'язки з `agent_skills.enabled`, без урахування глобального тумблера — як `agent_count` на картці скіла); плитка показує `provider · model` | Рахувати на клієнті через `useAgentSkills` на кожну плитку — N запитів; (раніше було в «Out of scope») |
