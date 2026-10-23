# Intent Layer — PR → `{intent, in_scope, out_of_scope}` → scope-дисципліна рев'ю

Status: implemented (2026-10-23); see "As built" at the end for where the code differs from the plan. Джерело вимог — курсова гілка
`ai-agentic-engineering-neo/dev-digest@lesson-4-lab/mcp-start` (= `lesson-3-lab/intent-layer-finish`,
план `docs/plans/intent-layer.md` там). Тут — та сама фіча, перенесена на нашу архітектуру
(onion + `arch:check`, `UrlFetcher`, `*Deps`-сервіси).


## Context

Агенти рев'ю коментують усе, що бачать у diff, — і те, що автор PR свідомо не чіпав. Intent Layer
дешевою моделлю виводить **мету й межі** PR і дає їх агенту як untrusted-секцію з правилом
«не коментуй поза scope; серйозна проблема поза scope → ОДНА сигнальна знахідка, не двадцять».

Вхід класифікатора — **без тіл змін**: title + body PR, пов'язані issue/PR, документи, на які
посилається body (plans/specs у репо, GitHub issue/PR, https-сторінки), і лише `@@`-заголовки
hunk-ів по кожному змінному файлу. Економія токенів (повний diff vs заголовки) логується.

**Що вже є (перевикористовуємо):**
- Таблиця `pr_intent` + `ReviewRepository.upsertIntent/getIntent` — `server/src/modules/reviews/repository.ts:135`. Міграція не потрібна.
- Контракти `Intent` (`contracts/brief.ts:9`) і `PrIntentRecord` (`contracts/review-api.ts:60`).
- Feature-model `review_intent` — `contracts/platform.ts:54`, `resolveFeatureModel` — `modules/settings/feature-models.ts`.
- `UrlFetcher` / `SafeUrlFetcher` / `MockUrlFetcher` — `adapters/http/safe-fetch.ts`, `container.urlFetcher`.
- `INJECTION_GUARD` уже називає «derived intent/scope» untrusted — `reviewer-core/src/prompt.ts:16`.
- `loadDiff` з fallback на `pr_files` — `modules/reviews/diff-loader.ts`.


## Вимоги

- R1 Класифікатор у модулі `intent`: `llm.completeStructured({schema: Intent})`; вхід — title, body, linked issue, файли + `@@`-заголовки, без `+`/`-` рядків.
- R2 Лог оцінки зекономлених токенів (chars/4, позначено як estimate).
- R3 Зберігання per-PR (`upsertIntent`), перерахунок на вимогу.
- R4 `GET /pulls/:id/intent` — compute-if-absent (лінивий, при відкритті Overview); `POST /pulls/:id/intent/recompute`.
- R5 Review run рахує intent ОДИН раз (якщо нема) і вставляє `## Intent` у промпт кожного агента через `wrapUntrusted`.
- R6 Картка Intent на Overview: цитата, IN SCOPE (✓), OUT OF SCOPE (✗), Recompute з loading.
- R7 Дефолт `review_intent` → `openrouter / deepseek/deepseek-v4-flash` (перевизначається в Settings).
- R8 Hermetic-тести (LLM/GitHub/git/web — моки).
- R9 Мало даних (нема body і issue) → intent усе одно виводиться з title + шляхів + заголовків; ніколи не порожній, не помилка.
- R10 Посилання з body: файли репо (`docs/`, `specs/`, `plans/` → `git.readFile`, без traversal), GitHub (`#N`, `closes #N`, URL issue/pull → `getIssue`/`getPullRequest`), https-URL (`UrlFetcher`). Усе best-effort, обгорнуте `wrapUntrusted('spec:<source>')`, сумарний бюджет із логом обрізання. `EXTERNAL_FETCH_ENABLED=false` вимикає лише URL.


## Прийняті рішення

| Питання | Рішення | Відхилена альтернатива (причина) |
|---|---|---|
| Fetch зовнішніх URL | Перевикористати `UrlFetcher` (`container.urlFetcher`) | Новий порт `WebFetchClient` як в upstream — дублював би `SafeUrlFetcher` зі слабшим захистом (регексп по hostname замість перевірки IP у `lookup`, без перевірки редиректів) |
| Як executor (reviews) дістає intent | `container.intent` — lazy getter у composition root (як `repoIntel`); intent бере `loadDiff` з нового фасаду `reviews/index.ts` | Прямі імпорти `reviews/run-executor → intent/service → reviews/diff-loader` як в upstream — порушують `no-cross-module-internals` і `no-circular` (`server/.dependency-cruiser.cjs`) |
| Форма сервісу | `IntentService(deps: IntentDeps)` + `createIntentService(container)` | `new IntentService(container)` — тести мусили б будувати весь контейнер; у нас патерн `ConventionsDeps` |
| Де чиста логіка | `helpers.ts` (парсер посилань, побудова повідомлення, бюджет, економія, рендер блоку) — domain ring, без I/O | Окремі `classifier.ts`/`references.ts` з I/O всередині — змішують кільця, гірше тестуються |
| Системний промпт класифікатора | `src/prompts/intent.system.md` + `renderPrompt` | Рядок у коді — у нас інструкції живуть у `src/prompts/` |
| Коли рахувати | Лінивий GET + Recompute + review run (як upstream) | Лише кнопка/run — користувач обрав upstream-поведінку; кеш у `pr_intent` робить це одноразовим |
| Staleness | Intent вважається свіжим, поки він є; оновлення — Recompute | Перерахунок при зміні `head_sha` — потрібна нова колонка/міграція; поза scope |
| Де правило «ONE signal finding» | Trusted-константа `INTENT_SCOPE_RULE` у reviewer-core, одразу ПІСЛЯ `<untrusted source="intent">` | Всередині untrusted-блоку, як в upstream — `INJECTION_GUARD` наказує ігнорувати інструкції в untrusted, тож правило там мертве |
| Видимість у trace | Адитивне `PromptAssembly.intent` (nullish) | Не показувати — upstream так зробив, але тоді в RunTraceDrawer не видно, що агент отримав |
| Збій intent у run | try/catch → run іде далі без секції (як callers/repoMap) | Фейлити run — intent лише enrichment |


## Фази

1. **reviewer-core** — `PromptParts.intent?`, секція `## Intent` між Callers і Diff (omit-when-empty), `assembly.intent`; `ReviewInput.intent?` → `assemblePrompt`. Тест.
2. **Контракти** (`server/src/vendor/shared`, потім `./scripts/check-shared.sh --sync`) — дефолт `review_intent`, `PromptAssembly.intent`; дзеркало `client/src/lib/feature-models.ts`.
3. **Server: платформа** — `EXTERNAL_FETCH_ENABLED` → `config.externalFetchEnabled`; `container.intent` + `ContainerOverrides.intent`; `modules/reviews/index.ts` (`loadDiff`).
4. **Server: модуль `intent/`** — `constants.ts`, `helpers.ts`, `service.ts`, `routes.ts`, `index.ts`, реєстрація в `modules/index.ts`, `prompts/intent.system.md`.
5. **Server: run-executor** — один `Deriving PR intent` крок після diff, блок у кожен `reviewPullRequest`.
6. **Client** — `lib/hooks/intent.ts`, `_components/IntentCard/`, `OverviewTab` + `PrDetailView` передають `prId`, i18n `prReview.intent.*`.
7. **Тести** — `server/test/intent-helpers.test.ts`, `server/test/intent-service.test.ts`, `reviewer-core/test/prompt-intent.test.ts`, `IntentCard.test.tsx`.
8. **Завершення** — insights, `/pr-self-review` (вручну, користувачем).


## Карта API

| Метод | Шлях | Відповідь |
|---|---|---|
| GET | `/pulls/:id/intent` | `PrIntentRecord` — збережений або щойно обчислений |
| POST | `/pulls/:id/intent/recompute` | `PrIntentRecord` (rate limit 10/хв) |


## Out of scope

- Перерахунок при зміні head SHA.
- Окремий intent per-file у map-reduce: один блок іде в кожен chunk (як callers/repoMap).
- Захист від того, що автор PR «звузить» scope, щоб сховати дефект: `INJECTION_GUARD` уже каже, що stated intent не скасовує реальних дефектів.


## Verification

- `reviewer-core`: `npm run typecheck && npm test`.
- `server`: `pnpm typecheck && pnpm test:unit && pnpm arch:check`.
- `client`: `pnpm typecheck && pnpm lint && pnpm test`; `./scripts/check-shared.sh`.
- Вручну: Overview показує картку; Recompute; Live Log має `Deriving PR intent` і рядок економії; Run Trace → `## Intent`; PR без body → непорожній intent; `EXTERNAL_FETCH_ENABLED=false` → URL пропущено.


## As built (2026-10-23) — відмінності від плану

- **Файли-посилання читаються через `repoIntel.readRepoFile`, а не `git.readFile`.** `SimpleGitClient.readFile` просто робить `join(clone, path)` — symlink, закомічений у репо (`docs/plan.md → /etc/passwd`), вивів би читання за межі клону. `readRepoFile` має realpath-guard і не залежить від `REPO_INTEL_ENABLED`. `isSafeRepoPath` у `helpers.ts` лишається першим (синтаксичним) фільтром.
- **Правило scope — trusted-константа `INTENT_SCOPE_RULE` у `reviewer-core/src/prompt.ts`**, сервер передає лише `Intent: … / In scope / Out of scope` (`renderIntentBlock`).
- **Посилання на файли ширші за upstream:** голі шляхи під `docs/`, `specs/`, `plans/` на будь-якій глибині (`server/specs/x.md` — наша конвенція) і same-repo `github.com/<o>/<r>/blob/<ref>/<path>` URL.
- **HTML-сторінки** (Google Docs тощо) грубо перетворюються в текст (`htmlToText`); не-`text/*` відповіді пропускаються.
- **Пустий intent від моделі** замінюється title PR (`normalizeIntent`) — R9 гарантовано кодом, не лише промптом.
- **RunTraceDrawer** показує блок «PR intent & scope» (`prompt_assembly.intent`).
- **Після `/pr-self-review` (2026-10-23):** лінивий `GET /pulls/:id/intent` теж може коштувати model call, тож отримав власний ліміт 20/хв (POST recompute — 10/хв; глобальний — 120/хв). 20, а не 10: GET — це ще й дешеве читання при кожному відкритті PR, і швидкий перегляд кількох PR не має ловити 429. Паралельні виклики для одного PR (дві вкладки, Overview + review run) ділять одне обчислення (`IntentService.inflight`); збій не кешується. Зовнішні URL на лінивому GET лишено ON свідомо (рішення користувача) — `EXTERNAL_FETCH_ENABLED=false` вимикає.
- **Інтеграційні тести** (`reviews.it`, `skills.it`) тепер підставляють `openrouter`-мок: без нього run тягнувся б по справжній ключ розробника з `~/.devdigest/secrets.json`.

Файли: `server/src/modules/intent/{constants,helpers,service,routes,index}.ts`, `server/src/prompts/intent.system.md`, `server/src/modules/reviews/index.ts`, `server/src/platform/{config,container}.ts`, `server/src/modules/reviews/run-executor.ts`, `reviewer-core/src/{prompt.ts,review/run.ts}`, `client/src/lib/hooks/intent.ts`, `client/src/app/repos/[repoId]/pulls/[number]/_components/IntentCard/`. Тести: `server/test/intent-{helpers,service}.test.ts`, `reviewer-core/test/prompt-intent.test.ts`, `IntentCard.test.tsx`, `RunTraceDrawer.test.tsx`, `reviews.it.test.ts`.
