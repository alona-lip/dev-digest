# specs (repo-wide)

Specifications for changes that span several packages or the repo root —
written before the code, recording the rejected alternative with its reason
(root `AGENTS.md`, Session protocol). A change inside one package belongs in
that package's `specs/` instead: [client](../client/specs/README.md) ·
[server](../server/specs/README.md) · [reviewer-core](../reviewer-core/specs/README.md).

## Contents

- [agents-md.md](./agents-md.md) — `AGENTS.md` as the source of agent
  instructions, `CLAUDE.md` as a symlink to it, and `scripts/link-agents.sh`.
- [pr-self-review.md](./pr-self-review.md) — the `pr-self-review` skill: maps
  the local diff to project skills, blocks push / PR on a confirmed CRITICAL.
- [skills.md](./skills.md) — reusable text-only skills: CRUD + versions + stats,
  binding to agents (order, per-agent enabled), import, prompt slot, trace.
- [conventions.md](./conventions.md) — Conventions Extractor: code-only
  sampling, one structured LLM call, a code evidence gate, accept / reject /
  edit triage, and a `repo-conventions` skill linked to an agent.
- [intent-layer.md](./intent-layer.md) — Intent Layer: a cheap model derives a
  PR's intent/scope from title, body, references and hunk headers; stored per
  PR, injected into the review prompt, shown on the Overview tab.
- [blast-radius.md](./blast-radius.md) — Blast Radius: `GET /pulls/:id/blast` over the
  repo-intel index (no LLM), the facade fixes (per-symbol cap, honest `degraded`/`reason`),
  the Overview card with Tree / Graph views and Resync, and the real MCP `get_blast_radius`.

## Repo-wide checks

`./scripts/check-shared.sh` (vendored contracts in sync) and
`./scripts/link-agents.sh --check` (symlinks) run in CI as `repo-checks.yml`.

Ось реквайрменти:
Зберігання і список скілів

Серверний модуль із CRUD над таблицею скілів; база — джерело правди.
UI: сторінка Skills із сіткою карток (назва, тип, опис, перемикач «увімкнено»); клік відкриває прев'ю збоку; кнопка «додати» з вибором «створити / імпортувати».
Редактор скіла

Форма: назва, опис, тип, тіло в markdown.
Опис — інтерфейс скіла, формулюємо директивно; на UI підказуємо це підписом до поля.
Прив'язка до агента

UI: вкладка Skills у редакторі агента — прив'язка, увімкнення/вимкнення, зміна порядку.
Порядок визначає послідовність блоків у промпті.
Імпорт

Завантаження markdown-файлу або архіву; продукт дістає ядро скіла й показує прев'ю.
Збереження лише після підтвердження; виконувані частини архіву не обробляються.
На відео окремо проговорюємо довіру: чужий скіл — це чужі інструкції в промпті агента.
Новий агент

Test Quality Reviewer — перевіряє якість тестів: непокриті гілки, пропущені corner cases, надмірне мокування, флейки.
Кожному агенту прив'язуємо його скіли; принаймні один заводимо через імпорт, щоб пройти весь шлях.
Контрольний експеримент

Test Quality: PR із тестом лише на happy-path → без скілів (пропуск) проти зі скілами (флагує непокриту гілку й межовий випадок).
API Contract: PR зі зміною сигнатури роуту → без скілів (пропуск) проти зі скілами (виявляє breaking change).
Відкриваємо трасу прогону → секцію збірки промпта; бачимо блок скілів і додані токени.
Перевірка наприкінці

pr-self-review існує з вимкненим автовикликом; викликали його вручну й бачили, що він підтягнув і фронтові, і бекендні скіли.
Скіл створюється й редагується в UI.
Обидва нові агенти мають прив'язані скіли.
Увімкнений скіл видно в логах окремим блоком, вимкнений — ні.
Імпорт пройшов через прев'ю, виконуване не запускалось.
Контрольний експеримент відтворюється на обох агентах.

Нам треба реалізувати фічу скілів. Вона схожа на дизайн агентів, але скіли мають перевикористовуватись серед агентів. У юзера має бути змога їх редагувати, апдейтити. Можна переюзати функціонал, який ми маємо в агентах. Скіли не можуть нічого використовувати, тільки текст конфігурації, яку ми зробили. Крім того, треба, щоб ти подивився на реквайрменти і на дизайни і задав питання, якщо вони в тебе є.

Створи нам план, специфікацію по реалізації цієї фічі.