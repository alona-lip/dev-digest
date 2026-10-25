# Аудит токенів: схеми MCP-інструментів і Tool Search

Status: заміри завершено (2026-10-24 – 2026-10-25). Методика — Lab 4. Цифри — з `/context` і `/mcp` у Claude Code.

## Навіщо

Кожен підключений MCP-сервер приносить у контекст схеми своїх інструментів (назва, опис,
JSON Schema аргументів). Без Tool Search усі схеми вантажаться на старті сесії й займають
контекст, навіть якщо інструмент ніколи не викличуть. Tool Search (у Claude Code увімкнений
за замовчуванням) відкладає схеми: модель бачить лише назви і підвантажує схему, коли
інструмент справді потрібен.

Експеримент робимо свідомо: вимикаємо Tool Search (`ENABLE_TOOL_SEARCH=false`), щоб побачити
стару проблему, і порівнюємо з обмеженим GitHub MCP (`GITHUB_TOOLSETS`, `GITHUB_READ_ONLY`).

## Умови

| | |
|---|---|
| Claude Code | v2.1.310 (оновився між етапом 6 і аудитом; для рядків 1–2 версію не зафіксовано) |
| Модель | Opus 5.5 (`claude-opus-5-5`, вікно 1M; підтримує `tool_reference` → Tool Search працює). Сценарій етапу 6 проходив на Sonnet 5 |
| devdigest MCP | `mcp-server/` цього репо, 5 інструментів |
| GitHub MCP | `ghcr.io/github/github-mcp-server` (Docker, stdio, local scope) — **v2.0.3** (образ від 2026-10-21) |
| Інші конектори | `claude.ai Claude Docs` (8 tools) — однаковий у всіх замірах, тому віднімається як константа |
| Запуск | нова сесія `claude` з кореня репо, `/context` одразу після старту. Відхилення: рядки 1–2 знято в сесіях, де вже були повідомлення (Messages 12–20k) |

## Результати

`/context`: рядок **MCP tools** і **Total**. `/mcp`: кількість інструментів сервера.
**Без Messages** = Total − Messages: прибирає шум від того, чи встигли щось написати в сесії
до `/context`, і лишає лише «постійну» частину (system prompt, system tools, MCP tools,
MCP instructions, agents, memory, skills). Порівнюємо саме її.

Константи в усіх замірах: system prompt 3k, custom agents 704, memory 2.6k, skills 7.9k (44).
System tools (Tool Search on): 15.3k на чистому старті, 16k у сесії, де вже була робота
(рядки 1, 2, 6b) — найімовірніше, підвантажився відкладений вбудований інструмент; з `/context`
не видно який. MCP server instructions: 717 (лише Claude Docs) → 2.1k з GitHub `all` → 1.2k з
`repos,pull_requests`: інструкції серверів Tool Search **не** відкладає.

| # | Стан | Tool Search | Інструментів (devdigest / github) | MCP tools, токенів | Total, токенів | Без Messages | Примітка |
|---|---|---|---|---|---|---|---|
| 1 | Базовий: без devdigest і GitHub | on | — / — | 0 (8 tools Claude Docs, on-demand) | 43.1k | 30.9k | Messages 12.2k |
| 2 | Лише devdigest | on | 5 / — | 136 (13 tools, on-demand) | 51k | 31.0k | Messages 20k; +136 ≈ лише назви 5 відкладених інструментів |
| 3 | devdigest + GitHub `all` | on | 5 / 92 | 620 (104 tools, on-demand) | 32.3k | 32.3k | Messages 10; MCP instructions 2.1k (+1.4k від GitHub) |
| 4 | devdigest + GitHub `all` | **off** | 5 / 92 | **44.5k** (104 tools, усі схеми завантажені) | **103.7k** | 103.7k | Messages 10; **System tools 15.3k → 42.9k** — вимкнення Tool Search розгортає й відкладені вбудовані інструменти Claude Code; MCP instructions 2.1k без змін |
| 5 | devdigest + GitHub `repos,pull_requests` + read-only | **off** | 5 / **16** | **11.1k** (29 tools, усі схеми) | 69.4k | 69.4k | Messages 10; System tools 42.9k (Tool Search off); MCP instructions 2.1k → **1.2k**; усі 16 GitHub-інструментів `read-only` (`get_*`/`list_*`/`search_*`, жодного `create`/`merge`/`update`/`push`) |
| 6a | як 5 | on | 5 / 16 | **643** (29 tools, on-demand) | 31.4k | 31.4k | Messages 10; System tools знову 15.3k; MCP instructions 1.2k. On-demand вартість не пропорційна кількості: 104 tools → 620, 29 tools → 643 |
| 6b | як 6a, після одного виклику GitHub | on | 5 / 16 | **1k** (29 tools; +~0.4k — схема викликаного) | 50k | 32.5k | Messages **17.5k** — увесь обмін у сесії (сама JSON-відповідь PR ~30 полів, тобто лише частина); System tools 16k. Інструмент: `github - Get details for a single pull request` (`pull_request_read`, `method:"get"`), «Allowed by auto mode classifier» |

## Висновки

| Що порівнюємо | Рядки | MCP tools | System tools | Total без Messages |
|---|---|---|---|---|
| Ціна повного GitHub MCP без Tool Search | 3 → 4 | 620 → **44.5k** | 15.3k → 42.9k | 32.3k → **103.7k** (×3.2) |
| Обмеження сервера: `repos,pull_requests` + read-only (Tool Search off) | 4 → 5 | 44.5k → **11.1k** (−75%) | без змін | 103.7k → 69.4k (−34.3k) |
| Tool Search на обмеженому наборі | 5 → 6a | 11.1k → **643** (−94%) | 42.9k → 15.3k | 69.4k → **31.4k** (−55%) |
| Перший реальний виклик | 6a → 6b | 643 → 1k (+~0.4k) | 15.3k → 16k | 31.4k → 32.5k; Messages +17.5k |
| devdigest (5 tools) з Tool Search | 1 → 2 | 0 → 136 | — | +0.1k |

1. **Без Tool Search стара проблема реальна.** 92 інструменти GitHub `all` разом з devdigest
   і Claude Docs (104) займають 44.5k ще до першого промпту, у середньому ~430 токенів на схему.
   До того ж `ENABLE_TOOL_SEARCH=false` розгортає і відкладені вбудовані інструменти Claude Code
   (+27.6k), тож разом +71.4k.
2. **Обмеження на боці сервера працює навіть без Tool Search**: 92 → 16 інструментів, −75% вартості
   схем і −0.9k інструкцій. Це також єдиний крок, що прибирає інструменти запису.
3. **Tool Search дає найбільшу економію**: 104 інструменти коштують 620 токенів, 29 — 643. Відкладена
   вартість майже не залежить від кількості інструментів, тож Tool Search і обмеження toolsets не
   конкурують, а доповнюють одне одного.
4. **Інструкції серверів Tool Search не відкладає** (717 → 2.1k → 1.2k залежно від toolsets) —
   це постійна ціна кожного підключеного сервера.
5. **Схема одного інструмента — дрібниця порівняно з розмовою.** Після виклику `pull_request_read`
   MCP tools зросли лише на ~0.4k, а Messages — на 17.5k (увесь обмін; з `/context` його не
   розкласти). Розмір відповідей Tool Search не скорочує — це робота сервера, тому devdigest
   віддає компактні форми з `limit` і `response_format`.
6. **devdigest дешевий у будь-якому режимі**: 5 інструментів, +136 токенів з Tool Search.

Головне, незалежно від цифр:
- **Tool Search зменшує вартість схем, але не обмежує повноваження.** Відкладений інструмент
  запису лишається доступним — модель знайде й викличе його.
- **Read-only — детермінований бар'єр.** З `GITHUB_READ_ONLY=1` сервер узагалі не реєструє
  інструменти запису; їх немає в `/mcp`, і жоден промпт їх не викличе. На демо GitHub MCP
  працює саме так.
- У devdigest ту саму роль виконує `http/client.ts`: у ньому немає жодного виклику видалення
  чи зміни налаштувань (див. [specs/mcp-server.md](../specs/mcp-server.md#повноваження)).

## Коли Tool Search може не спрацювати

- **Модель без `tool_reference`.** Потрібні Sonnet 4+ або Opus 4+; Haiku не підтримує —
  схеми вантажаться повністю.
- **Vertex AI або сторонній `ANTHROPIC_BASE_URL`.** Поведінка за замовчуванням інша через
  сумісність проксі — перевіряти `/context`, а не припускати.
- **Додатковий крок.** Перше звернення до відкладеного інструмента — це спершу пошук, потім виклик.
- **Хибний промах.** Нечітка назва чи опис → пошук не знаходить потрібний інструмент. Тому
  описи devdigest кажуть, *коли* викликати інструмент (`list_agents`: «Call this FIRST…»).
- **Великі відповіді не скорочує.** Tool Search економить лише на схемах; розмір результату —
  відповідальність сервера (у devdigest — компактні форми, `limit`, `response_format`).
- **`alwaysLoad`.** Інструменти, потрібні майже на кожному кроці, можна завантажувати завжди;
  решту — на вимогу. Для devdigest не потрібно: 5 інструментів, викликаються лише в сценарії рев'ю.

## Фасад і Code Mode — не те саме, що Tool Search

- **Tool Search** — на боці клієнта: сервер не змінюється, схеми просто відкладаються.
- **Фасад** — на боці сервера: кілька близьких операцій під одним стабільним інтерфейсом.
- **Code Mode** — агент шукає по великому API і виконує коротку програму в пісочниці.

Для ~2500 ендпоінтів Cloudflare фасад із Code Mode виправданий. Для п'яти різних
можливостей devdigest він сховав би важливі відмінності (один інструмент пише, чотири
читають — `readOnlyHint` на рівні інструмента зник би) і погіршив би пошук. Рішення
зафіксоване в [specs/mcp-server.md](../specs/mcp-server.md#прийняті-рішення).

## Як відтворити

```bash
# GitHub MCP — local scope (токен не потрапляє в репо)
claude mcp add github -s local \
  -e GITHUB_PERSONAL_ACCESS_TOKEN=<PAT> -e GITHUB_TOOLSETS=all \
  -- docker run -i --rm -e GITHUB_PERSONAL_ACCESS_TOKEN -e GITHUB_TOOLSETS -e GITHUB_READ_ONLY \
     ghcr.io/github/github-mcp-server

# Обмежений + read-only
claude mcp remove github -s local
claude mcp add github -s local \
  -e GITHUB_PERSONAL_ACCESS_TOKEN=<PAT> -e GITHUB_TOOLSETS=repos,pull_requests -e GITHUB_READ_ONLY=1 \
  -- docker run -i --rm -e GITHUB_PERSONAL_ACCESS_TOKEN -e GITHUB_TOOLSETS -e GITHUB_READ_ONLY \
     ghcr.io/github/github-mcp-server

# Без Tool Search — лише для заміру, потім просто `claude`
ENABLE_TOOL_SEARCH=false claude
```
