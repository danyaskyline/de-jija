# START-HERE — входная точка для ИИ-агента

**Правила для веб-ИИ**
- Прочитал этот файл — **остановись** и коротко перескажи автору, где мы сейчас. Ничего не начинай.
- Файлы сам не открывай: ты читаешь целиком и не можешь выбрать диапазон строк.
- Называй нужный файл, зачем он нужен и сколько в нём строк, и **проси ссылку** у автора.
- Не больше 1–2 файлов за раз, без согласия автора.
- Ссылки — только `raw.githubusercontent.com`, не `github.com/.../blob/...`.
- Перед любым проектным решением запроси `docs/conventions.md` — принципы лежат только там.

Читай этот файл **первым** при начале нового чата/сессии. Он короткий и экономит лимит:
дальше открывай только те файлы, которые реально нужны, по ссылкам отсюда и из карты репозитория.

## ЧАСТЬ A. Постоянное (меняется редко)

**Проект в 5 строках**
1. Браузерная MMO в духе Heroesland / HoMM3: тактический бой на гексагональном поле + карта в реальном времени.
2. Своя графика, звук и названия — без ассетов HoMM3/Heroesland.
3. Монолит-монорепо: `/server` (Node.js + TypeScript, Express + ws), `/client` (TypeScript, PixiJS, Vite), `/shared` (типы протокола), `/docs` (источник правды), `/config` (данные правил).
4. **Текущее состояние — в части B ниже.** Репозиторий на время разработки публичный, после — будет закрыт.
5. Проект ведётся соло-автором в связке с ИИ-агентами; автор не программист — код должен быть понятным и с комментариями на ключевых местах.

Подробности: [README.md](https://raw.githubusercontent.com/danyaskyline/de-jija/main/README.md)
Правила проекта: [docs/conventions.md](https://raw.githubusercontent.com/danyaskyline/de-jija/main/docs/conventions.md) · процедуры: [docs/workflow/](https://raw.githubusercontent.com/danyaskyline/de-jija/main/docs/workflow/start.md) · адаптеры инструмента: [`.clinerules/`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/.clinerules/01-workflow.md)

**Карта репозитория** (что где лежит, с полными ссылками и однострочными описаниями):
[docs/INDEX.md](https://raw.githubusercontent.com/danyaskyline/de-jija/main/docs/INDEX.md)
Регенерируется командой `npm run map` — запускай её после добавления/удаления файлов.

**Как устроен процесс**
- Роли: **автор** — человек, ставит задачи и принимает решения; **веб-ИИ** — обсуждение, дизайн, ревью, пишет постановки задач; **CLI-агент** — реализация в репозитории.
- Кирпичи: вход (`START-HERE.md`), состояние (его часть B), задачи (`docs/tasks/`), решения (`docs/decisions.md`), карта (`docs/INDEX.md`), процедуры (`docs/workflow/`), адаптеры (`.clinerules/`).
- Принцип: один кирпич — один файл, одна задача; кирпичи общаются только через файлы репозитория; всё инструментозависимое живёт лишь в тонких адаптерах.

**Главные принципы** — в `docs/conventions.md`, хранятся там одни и не дублируются здесь: источник правды, данные vs код, авторитетность сервера, границы, язык, тесты, публичность репозитория.

**Какие файлы нужны для темы** (ссылки простым текстом — их можно скопировать в чат с веб-ИИ):
- Бой и очередь ходов:
  https://raw.githubusercontent.com/danyaskyline/de-jija/main/docs/battle.md
  https://raw.githubusercontent.com/danyaskyline/de-jija/main/server/src/battle/turnQueue.ts
- Формула урона:
  https://raw.githubusercontent.com/danyaskyline/de-jija/main/docs/combat-formula.md
  https://raw.githubusercontent.com/danyaskyline/de-jija/main/server/src/combat/resolveAttack.ts
- Архитектура и сеть:
  https://raw.githubusercontent.com/danyaskyline/de-jija/main/docs/architecture.md
- Игровой дизайн:
  https://raw.githubusercontent.com/danyaskyline/de-jija/main/docs/game-design.md
- Решения и ADR:
  https://raw.githubusercontent.com/danyaskyline/de-jija/main/docs/decisions.md
- Текущая задача:
  https://raw.githubusercontent.com/danyaskyline/de-jija/main/docs/tasks/002-tie-rule-and-priority-indicator.md

**Для чтения в новом чате используй ссылку с хэшем коммита, а не `main` (`main` может отдавать устаревшую копию из кэша).**

**Если часть B старше последнего коммита — верь `git log -5` и `git status`.**

**Как читать репо экономно**
- Сначала эта страница → потом один конкретный файл по прямой ссылке, а не файл целиком, если нужен только фрагмент.
- Нужен фрагмент — читай диапазон строк или используй поиск по тексту, а не весь файл.
- Не перечитывай то, что уже прочитано в этой сессии.
- Перед чтением более 5 файлов сразу напиши, зачем ты их читаешь.
- Не исследуй код «на всякий случай». Не открывай `package-lock.json`.
- Не читай код игры целиком в поисках контекста: контекст задаётся документацией и разделом «Прогресс» задачи.

---

## ЧАСТЬ B. Текущее состояние

> Эта часть **перезаписывается целиком** при каждом handoff, а не дописывается. Не больше 30 строк.

- **Активная задача:** [docs/tasks/002-tie-rule-and-priority-indicator.md](https://raw.githubusercontent.com/danyaskyline/de-jija/main/docs/tasks/002-tie-rule-and-priority-indicator.md) — на паузе, сделано шаги 0–3 из 7.
- **Цель:** правка равной скорости в очереди ходов, начальный приоритет и индикатор приоритета в бою.
- **Сделано:** шаг 1 — каскад равной скорости (`orderEqualSpeedGroup`); шаг 2 — начальный приоритет `decideInitialPriority`; шаг 3 — правило «новичок в уже разрешённой группе» (память групп `ResolvedGroup` в `server/src/battle/battle.ts`; приоритет тратится по параметру `keepCurrent`, не по `state.turns.currentUnitId`).
- **В процессе:** ничего — остановлено на границе шагов 3 и 4.
- **Следующий шаг:** **шаг 4 — индикатор приоритета** (`nextPrioritySide`, `initialPriorityReason`). Далее: шаг 5 — транспорт (`wait` / `end-turn` / `speed`), шаг 6 — боевая песочница в `battle-sandbox.html`, шаг 7 — `docs/battle.md`, ADR 022 (номер зарезервирован под эту задачу), строка статуса в 021, раздел «Итог», финальный push.
- **Тронутые файлы (002, шаги 1–3):** `server/src/battle/battle.ts`, `server/src/battle/turnQueue.ts`, `server/src/battle/battleTurns.test.ts`, `server/src/battle/battle.test.ts`, `server/src/battle/turnQueue.test.ts`, `docs/tasks/002-tie-rule-and-priority-indicator.md`.
- **Как проверить:** `npm test` и `npm run typecheck` из корня; песочница — `npm run dev:server` и `http://127.0.0.1:3000/debug/battle-sandbox`; карта репо — `npm run map`; актуальность доков — `npm run check`.
- **Тесты:** см. `npm test` — должен быть зелёным; `npm run typecheck` — чистым. Число тестов здесь не записывается.
- **Подводные камни:** T1 на шаге 3 усилен третьим юнитом группы (иначе не доказывал ветку (а)); T3 не отличает ветку (в) от (б) — их доказывают существующие тесты и T6; T6 ловит почти любое отключение, это ожидаемо. `config/*.json` читается один раз при старте сервера — после правки нужен рестарт.
- **Открытые вопросы:** нет. Внутренние цифры из `docs/game-design.md` оставлены как есть, решение принято автором.
- **Обновлено:** 2026-10-02, роль CLI-агент (аудит репозитория перед закрытием: из задачи 002 убран локальный путь; цифры в `docs/game-design.md` оставлены по решению автора; задача 002 на паузе между шагами 3 и 4).