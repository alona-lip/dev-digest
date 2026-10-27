# DevDigest MCP server — рев'ю PR з Claude Code через stdio

Status: implemented (2026-10-25); see "As built" at the end for where the code differs from the plan. Джерело вимог — курсова гілка
`ai-agentic-engineering-neo/dev-digest@lesson-4-lab/mcp-finish`, коміт `687edb5`
(`mcp-server/`, план `docs/plans/mcp-server.md` там). Коміт `64231e1` (blast radius:
`server/modules/blast`, `BlastRadiusCard`) — це домашка, тут не переноситься. Тут — та сама
фіча, перенесена на наші контракти (Lab 2/3) і структуру репо.


## Context

Досі рев'ю запускалося лише з браузера (Studio, `:3000`). Lab 4 додає другу точку входу:
Claude Code у терміналі або будь-який клієнт з MCP. Запит «Зроби ревʼю PR №3 у репозиторії X
агентом Security Reviewer і скажи, чи є критичні знахідки» має пройти
`list_agents → run_agent_on_pr → get_findings` і повернути **фактичні** знахідки DevDigest,
а не здогадки моделі.

`mcp-server/` — п'ятий незалежний пакет: тонкий stdio-клієнт над Fastify API (`:3001`).
Бізнес-логіки в ньому немає: він перетворює людські ідентифікатори (`owner/name`, номер PR,
назва агента) на UUID-и, викликає API і стискає відповідь до того, що потрібно моделі.
Запускається окремою командою; `./scripts/dev.sh` його не стартує.

**Що вже є (перевикористовуємо):**
- `GET /agents` → `AgentListItem[]` — `server/src/modules/agents/routes.ts:75`.
- `GET /repos` → `Repo[]` — `server/src/modules/repos/routes.ts:33`.
- `GET /repos/:id/pulls` → `PrMeta[]`, перед відповіддю синкає PR з GitHub (без токена — віддає збережені) — `server/src/modules/pulls/service.ts:63`.
- `POST /pulls/:id/review {agentId}` → `{pr_id, runs[{run_id, agent_id, agent_name}], reviews}`; рев'ю йде у фоні; rate limit 10/хв — `server/src/modules/reviews/routes.ts:31`.
- `GET /pulls/:id/runs` → `RunSummary[]` (`status: running|done|failed|cancelled|null`) — `reviews/routes.ts:111`.
- `GET /pulls/:id/reviews` → `ReviewRecord[]` (`kind: summary|review`, `run_id`, `verdict`, `summary`, `score`, `findings`) — `reviews/routes.ts:139`.
- `GET /repos/:id/conventions` → `ConventionCandidate[]` (PENDING + ACCEPTED; REJECTED сервер уже ховає) — `server/src/modules/conventions/routes.ts:25`.
- Контракти — `server/src/vendor/shared/contracts/` (`platform.ts`, `review-api.ts`, `trace.ts`, `findings.ts`, `knowledge.ts`).

Нових маршрутів, міграцій і змін у `server/`, `client/`, `reviewer-core/` немає.


## Вимоги

- R1 Локальний MCP-сервер на TypeScript, транспорт stdio, `@modelcontextprotocol/sdk` v1 (`McpServer.registerTool`).
- R2 П'ять інструментів: `list_agents`, `run_agent_on_pr`, `get_findings`, `get_conventions` — робочі; `get_blast_radius` — чесна заглушка (у Lab 4 HW замінена на робочий інструмент, див. «As built»).
- R3 Без префікса в назвах: Claude Code сам додає `mcp__devdigest__`.
- R4 Окремий запуск: `cd mcp-server && pnpm start`; `pnpm inspect` — MCP Inspector; `pnpm call <tool> '<json>'` — виклик без UI. Реєстрація в Claude Code — root `.mcp.json`.
- R5 Для кожного інструмента: опис каже, **коли** його викликати; пласка схема з `.describe()` і прикладом; компактна структурована відповідь; помилка (`isError: true`) підказує наступний крок; читальні — `readOnlyHint: true`.
- R6 Повноваження обмежує код: HTTP-клієнт має лише ті виклики, що потрібні п'яти інструментам (GET-и + один POST тригера рев'ю).
- R7 stdout — лише JSON-RPC; усі логи в stderr.
- R8 Hermetic-тести для `core/` (фейковий клієнт, без мережі).
- R9 `list_prs` / `list_repos` не додаємо — це вже є в `gh` і офіційному GitHub MCP.


## Контракт інструментів

| Tool | Аргументи | Відповідь | readOnly | idempotent | openWorld |
|---|---|---|---|---|---|
| `list_agents` | — | `{agents:[{id, name, description, enabled, model}]}` | ✅ | ✅ | ❌ |
| `run_agent_on_pr` | `repo`, `pr`, `agent` | готово: `{run_id, agent, verdict, score, summary, counts, total, returned, findings[]}` (≤ 20, найважчі першими); не встигло за 120 с: `{status:"running", run_id, repo, pr, next}` | ❌ | ❌ | ✅ |
| `get_findings` | `repo`, `pr`, `run_id?`, `agent?`, `all_runs?`, `response_format?`, `offset?`, `limit?` | `{repo, pr, total_findings, reviews:[{run_id, agent, verdict, score, summary, counts, total, returned, offset, findings[]}]}`, новіші рев'ю першими | ✅ | ✅ | ❌ |
| `get_conventions` | `repo` | `{repo, conventions:[{rule, category, status, file, confidence}]}`, ACCEPTED першими | ✅ | ✅ | ❌ |
| `get_blast_radius` | `repo`, `pr` | `{repo, pr, summary, degraded, reason, changed_symbols:["name@file"], downstream:[{symbol, callers[{name,file,line}], endpoints_affected, crons_affected}]}` (той самий `GET /pulls/:id/blast`, що й блок в UI) | ✅ | ✅ | ❌ |

`destructiveHint: false` у всіх. `openWorldHint: true` лише в `run_agent_on_pr`: він запускає
LLM і ходить у GitHub; решта читають тільки локальну БД DevDigest.

**Аргументи.**
- `repo: string` — `'owner/name'` (напр. `'octocat/hello'`) або лише `name`, якщо однозначно.
- `pr: int` — номер PR на GitHub (напр. `3`), не внутрішній id.
- `agent: string` — id з `list_agents`; як запасний варіант приймається точна назва без урахування регістру (`'Security Reviewer'`).
- `run_id?: string` — обрати конкретний прогін (той, що повернув `run_agent_on_pr`); без нього — найновіше рев'ю.
- `response_format?: 'concise' | 'detailed'` (default `concise`), `offset?: int ≥ 0` (default 0), `limit?: int ≥ 1` (default 10 concise / 20 detailed).

**Форми відповіді.**
- Знахідка `concise`: `{severity, title, file, line, rationale}` (`line` = `start_line`).
  `detailed` додає `end_line`, `suggestion`, `confidence`, `category`, `id`.
- `counts: {CRITICAL, WARNING, SUGGESTION}` — завжди по всьому набору, до пагінації
  (ключі як wire-enum `SeverityCounts`, `contracts/platform.ts`).
- Сортування CRITICAL → WARNING → SUGGESTION.
- Без UUID-ів репо/PR, без системних промптів, без `evidence_snippet`.

**Помилки ведуть вперед** (`isError: true`, текст `{error}`):

| Ситуація | Повідомлення підказує |
|---|---|
| API не відповідає (мережа) | `DevDigest API unreachable at <url> — start it with ./scripts/dev.sh` |
| repo не знайдено | список доступних `full_name` + «pass owner/name» |
| repo неоднозначний | які `full_name` збіглися + «pass owner/name» |
| PR не знайдено | кілька наявних номерів + «check `gh pr list -R owner/name`; the repo may need a refresh in DevDigest» |
| агента не знайдено | усі `id (name)` + «call list_agents» |
| рев'ю ще немає | «call run_agent_on_pr first» |
| `run_id` не належить цьому PR | доступні `run_id` цього PR |
| прогін `failed`/`cancelled` | помилка з `RunSummary.error` + «retry run_agent_on_pr» |
| HTTP 429 | «rate limit 10/min on reviews — wait a minute, then retry» |
| HTTP 404 / інше 4xx/5xx | що саме не знайдено / текст помилки сервера |

Порожній список (агентів, конвенцій, знахідок) — це результат, не помилка.


## Прийняті рішення

| Питання | Рішення | Відхилена альтернатива (причина) |
|---|---|---|
| Як MCP дістає дані | HTTP до `localhost:3001` через `http/client.ts` | In-process: імпорт `Container`/сервісів server — дубль композиції, прямий доступ до БД і секретів, MCP-процес мусить мати `DATABASE_URL` |
| Структура | `tools/` (Zod-схема, MCP-конверт) → `core/` (resolve, findings, run-review — функції над клієнтом) → `http/client.ts`; один composition root `src/index.ts` | Логіка прямо в handler-ах — не тестується без MCP-транспорту |
| Контракти | Лише `import type` з `@devdigest/shared` через `paths` → `../server/src/vendor/shared` | Третя vendor-копія (як `client/`) — ще один дрейф; runtime-імпорт — пакет перестав би бути незалежним. Типи стираються при компіляції |
| Що вертає `run_agent_on_pr` | Результат (тригер + polling до 120 с + знахідки) | Окремі `start_review`/`get_run_status` — модель мусить сама полити, більше кроків і токенів |
| Довге рев'ю | Після 120 с `{status:"running", run_id, next}` — не помилка | Чекати безкінечно — Claude Code обриває виклик за `MCP_TOOL_TIMEOUT` (ставимо 150 с у `.claude/settings.json`) |
| Назви інструментів | `list_agents`… без префікса | `devdigest_list_agents` (upstream) — у Claude Code виходить `mcp__devdigest__devdigest_list_agents` |
| `get_conventions` | ACCEPTED + PENDING зі `status` і `category`, ACCEPTED першими; опис: «лише ACCEPTED — підтверджені правила» | Тільки ACCEPTED — агент не побачить кандидатів, яких ще не розглянули |
| Вимкнений агент | Запускаємо, як і сервер (`ReviewService.resolveTargets`: явно обраний агент працює навіть вимкненим); `enabled` видно в `list_agents` | Окрема помилка в MCP — це нове бізнес-правило поза доменом |
| Мапінг HTTP-помилок | За `ApiError.status` (0 / 404 / 429 / інше) | Один `catch` «API unreachable» (upstream) — хибна підказка на 404/429 |
| `openWorldHint` | `true` лише для `run_agent_on_pr` | `true` усім (upstream) — читальні інструменти не виходять за межі локальної БД |
| `MCP_TOOL_TIMEOUT` | `.claude/settings.json` → `env` | `.mcp.json` → `env` сервера (upstream) — це змінна Claude Code, серверу вона нічого не дає |
| `ENABLE_TOOL_SEARCH` | Не задаємо в репо (default = on) | `"true"` у settings (upstream) — заважав би аудиту з `ENABLE_TOOL_SEARCH=false` |
| Фасад / Code Mode | П'ять окремих інструментів | Один фасад або Code Mode (пошук по API + виконання програми) виправданий для тисяч ендпоінтів (Cloudflare, ~2500). Для п'яти різних можливостей він сховав би відмінності (один пише, чотири читають), погіршив би описи для Tool Search і зламав би `readOnlyHint` на рівні інструмента |
| `list_prs` / `list_repos` | Не додаємо | Дублюють `gh` і GitHub MCP — ще дві схеми в контексті без нової цінності. `list_agents` лишається: конфігурацію рев'юерів знає тільки DevDigest |
| Blast radius | Заглушка `not_implemented` з порадою «продовжуй без нього» | Відсутній інструмент — модель шукала б обхідні шляхи; помилка — модель вважала б збій |
| Менеджер пакетів | pnpm (як `client`/`server`) | npm — у репо npm лише для `reviewer-core`/`e2e` |


## Повноваження

Доменна межа — `http/client.ts`. Він має рівно ці виклики: `GET /agents`, `GET /repos`,
`GET /repos/:id/pulls`, `GET /pulls/:id/runs`, `GET /pulls/:id/reviews`,
`GET /repos/:id/conventions` і один запис `POST /pulls/:id/review {agentId}`. Ні видалення,
ні редагування агентів/скілів/налаштувань, ні секретів — навіть якщо модель «захоче», такого
виклику немає. Агент перевіряється за живим списком до тригера. Серверний rate limit
(10/хв) і workspace-скоупінг (`getContext`) лишаються в силі. Конфіг читає лише
`DEVDIGEST_API_URL` — жодних токенів.

Tool Search у Claude Code лише відкладає схеми; він не обмежує повноваження. Для GitHub MCP на
демо — `GITHUB_READ_ONLY=1`: сервер узагалі не реєструє інструменти запису.


## Фази

1. **Спека** — цей файл.
2. **Каркас** — `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`, `src/{config,log,format}.ts`, `src/http/client.ts`; `AGENTS.md` + `CLAUDE.md` → симлінк, `mcp-server` у `scripts/link-agents.sh`.
3. **Core + тести** — `src/core/{resolve,findings,run-review}.ts`, `test/*.test.ts` (vitest).
4. **Tools + запуск** — `src/tools/*.ts`, `src/index.ts`, `scripts/call.mjs`; root `.mcp.json`, `.claude/settings.json`, root `AGENTS.md`, `engineering-insights` skill, `docs/architecture.md`.
5. **Inspector** — 5 інструментів, схеми, annotations, помилкові агент/PR.
6. **Claude Code** — `/mcp`; сценарій про PR №3 і Security Reviewer.
7. **Аудит токенів** — `docs/token-audit.md`.
8. **Завершення** — `README.md`, `INSIGHTS.md`, `/pr-self-review`.


## Out of scope

- ~~Реальний blast radius (домашка; upstream `64231e1`).~~ Зроблено 2026-10-25 — [../../specs/blast-radius.md](../../specs/blast-radius.md).
- Будь-які зміни в `server/`, `client/`, `reviewer-core/`, `e2e/`.
- HTTP/SSE-транспорт MCP, авторизація, віддалений запуск.
- Інструменти запису, крім тригера рев'ю.


## Verification

- `cd mcp-server && pnpm typecheck && pnpm test` — зелені.
- `pnpm start </dev/null 2>/dev/null | wc -c` → `0`; `grep -rn "console.log(" src` — порожньо.
- `./scripts/link-agents.sh --check` — ✓ для `mcp-server/CLAUDE.md`.
- `./scripts/dev.sh` окремо → `pnpm call list_agents` повертає seeded-агентів.
- `pnpm inspect`: видно 5 інструментів з коректними схемами й annotations; `run_agent_on_pr` з `agent:"nope"` і `pr:9999` → `isError` з підказкою.
- Claude Code з кореня: `/mcp` → `devdigest` connected, 5 tools; сценарій проходить `list_agents → run_agent_on_pr → get_findings`, у відповіді — знахідки з `file:line` з DevDigest.


## As built (2026-10-25) — відмінності від плану

- **Вимкнений агент дозволений.** План мав помилку «агент вимкнений»; прибрано ще на етапі спеки —
  `ReviewService.resolveTargets` явно запускає обраного агента незалежно від `enabled`
  (`server/src/modules/reviews/service.ts:50`). MCP не додає власних бізнес-правил.
- **`run_agent_on_pr` повертає більше, ніж у таблиці:** `repo`, `pr`, `agent`, `summary`, `total`,
  `returned` і `more` (підказка, з якого `offset` гортати `get_findings`), коли знахідок > 20.
- **`title` у кожного інструмента** — людська назва для Inspector/`/mcp`; у плані не було.
- **`get_findings` з `run_id` без рев'ю** розрізняє три випадки (`loadReview`): прогін ще йде →
  `{status:"running"}` (не помилка), прогін failed/cancelled → його помилка, `run_id` чужий →
  список `run_id` цього PR. Upstream мовчки віддавав найновіше рев'ю замість чужого `run_id`.
- **Порядок `done` → рев'ю гарантований сервером:** `persistCompletedRun` комітить рев'ю і статус
  `done` в одній транзакції (`server/src/modules/reviews/repository.ts:184`), тож чекати, поки
  рядок рев'ю «з'явиться», не треба. Але сам GET рев'ю після `done` може впасти (мережа): його
  повторюємо до дедлайну, а потім відповідаємо `running` з `run_id` — інакше модель отримала б
  «API down, retry» і запустила б новий платний прогін (знахідка `/pr-self-review`, 2026-10-25).
- **Невалідні аргументи** (`pr: 0`) відхиляє сам SDK текстом `MCP error -32602: Input validation
  error …` — не JSON; `scripts/call.mjs` друкує такі відповіді як є.
- **`scripts/call.mjs`** написаний на `Client` + `StdioClientTransport` з SDK, а не ручним JSON-RPC
  (як в upstream); без аргументів друкує список інструментів з annotations.
- **Inspector** показує червоні `ERROR` для `resources/list` / `prompts/list` — сервер оголошує лише
  `tools`, SDK відповідає `-32601`. Очікувано; порожні resources/prompts не додаємо.
- **`.mcp.json`:** `npx --no-install --prefix mcp-server tsx mcp-server/src/index.ts` — запуск із
  кореня репо; `--no-install` падає одразу, якщо пакет не встановлено, замість завантаження `tsx`.
- **Сценарій у Claude Code** (2026-10-24, Sonnet 5): `list_agents → run_agent_on_pr`, без
  `get_findings` — рев'ю завершилося за 46 с і мало 2 знахідки, тож усе повернулося одним викликом.
  `get_findings` потрібен, коли прогін довший за 120 с, знахідок > 20 або просять `detailed`.
  Відповідь звірено з API: прогін `502f3625`, `comment`, score 76, 2 × WARNING.
- **Аудит токенів** — [docs/token-audit.md](../docs/token-audit.md): 5 інструментів devdigest з
  Tool Search коштують 136 токенів.


- **`get_blast_radius` більше не заглушка (2026-10-25).** Інструмент читає `GET /pulls/:id/blast`
  (`core/blast.ts`, обов'язкові `repo`/`pr`); деталі — [../../specs/blast-radius.md](../../specs/blast-radius.md).

- **Зауваження рев'ю (2026-10-27).**
  - `list_agents` віддає `description`: за ним агент-клієнт обирає рев'юера, не відкриваючи кожного.
  - `get_findings` повертає `{total_findings, reviews[]}`, де знахідки вкладені в своє рев'ю, замість одного плаского списку з `total`.
  - Нові `agent?` (через `resolveAgent`, фільтр за `agent_id`) і `all_runs?` (усі завершені рев'ю, новіші першими; без нього лише останнє).
  - `run_id` разом з `all_runs` дає помилку. `run_id` чужого агента дає помилку з назвою власника.
  - `offset`/`limit` діють на кожне рев'ю окремо.
  - `run_agent_on_pr` лишається пласким (один прогін). Його підказка `more` тепер містить `run_id`, бо без нього `get_findings` відповідає останнім рев'ю, яке може бути іншим.

  | Рішення | Вибір | Відхилена альтернатива (причина) |
  |---|---|---|
  | Paging при `all_runs` | `offset`/`limit` на кожне рев'ю | Глобальний offset по всіх рев'ю: зсув перетинає межі рев'ю, і модель губить, якому прогону належить знахідка |
  | Фільтр за агентом | Параметр `agent` у `get_findings` | Тільки `all_runs` по всіх агентах: модель мусила б сама відсіювати `reviews[].agent` і тягнути зайві знахідки в контекст |
