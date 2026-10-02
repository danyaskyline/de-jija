# START-HERE — входная точка для ИИ-агента

Читай этот файл **первым** при начале нового чата/сессии. Он короткий и экономит лимит:
дальше открывай только те файлы, которые реально нужны, по ссылкам отсюда и из карты репозитория.

## ЧАСТЬ A. Постоянное (меняется редко)

**Проект в 5 строках**
1. Браузерная MMO в духе Heroesland / HoMM3: тактический бой на гексагональном поле + карта в реальном времени.
2. Своя графика, звук и названия — без ассетов HoMM3/Heroesland.
3. Монолит-монорепо: `/server` (Node.js + TypeScript, Express + ws), `/client` (TypeScript, PixiJS, Vite), `/shared` (типы протокола), `/docs` (источник правды), `/config` (данные правил).
4. Готов walking skeleton: WS-связка (ping/pong), карта, размещение юнитов, очередь ходов. Не сделано: БД, авторизация, поход, интерфейс боя в клиенте.
5. Проект ведётся соло-автором в связке с ИИ-агентами; автор не программист — код должен быть понятным и с комментариями на ключевых местах.

Подробности: [README.md](https://raw.githubusercontent.com/danyaskyline/de-jija/main/README.md)
Правила агентов: [`.clinerules/`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/.clinerules/01-workflow.md), процедуры — [`workflows/`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/.clinerules/workflows/continue.md).

**Карта репозитория** (что где лежит, с полными ссылками и однострочными описаниями):
[docs/INDEX.md](https://raw.githubusercontent.com/danyaskyline/de-jija/main/docs/INDEX.md)
Регенерируется командой `npm run map` — запускай её после добавления/удаления файлов.

**Главные правила** (полный список — [docs/conventions.md](https://raw.githubusercontent.com/danyaskyline/de-jija/main/docs/conventions.md))
1. Источник правды по дизайну и архитектуре — `/docs`, не код и не память агента.
2. Проект ведётся по задачам в `docs/tasks/`; сначала читаешь «Прогресс» активной задачи, не начинаешь заново.
3. **Данные vs код:** юниты, предметы, способности, рецепты — это данные (JSON/таблицы БД), а не классы и не захардкоженные условия. Дублировать значения вместо ссылки по id — ошибка.
4. **Сервер авторитетен:** клиент только визуализирует подтверждённое сервером; не рассылать полное состояние всем (нужны чанки/AOI).
5. **Границы:** логика карты и логика боя разделены; игровые правила боя живут только в `Battle` и чистых формулах — песочница и интерфейс правил не содержат.
6. Узкие проверяемые шаги, а не большая система сразу. Значимое архитектурное решение — сначала в `decisions.md` (ADR), потом код.
7. Git: коммит с понятным сообщением (Conventional Commits) и push в `origin/main`; `--force` запрещён без отдельного явного разрешения.

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

- **Активная задача:** [docs/tasks/002-tie-rule-and-priority-indicator.md](https://raw.githubusercontent.com/danyaskyline/de-jija/main/docs/tasks/002-tie-rule-and-priority-indicator.md) — на паузе, сделано шагов 0–3 из 7.
- **Цель:** правка равной скорости в очереди ходов, начальный приоритет и индикатор приоритета в бою.
- **Сделано:** шаг 1 — каскад равной скорости (`orderEqualSpeedGroup`); шаг 2 — начальный приоритет `decideInitialPriority`; шаг 3 — правило 2 «новичок в уже разрешённой группе» (память групп `ResolvedGroup` в `server/src/battle/battle.ts`, приоритет тратится по параметру `keepCurrent`, не по `state.turns.currentUnitId`).
- **В процессе:** ничего — остановлено на границе шагов. Мета-настройка репо для ИИ-агентов доделана: `START-HERE.md`, `AGENTS.md`, `.clinerules/` (+ `workflows/`), `docs/INDEX.md`, `tools/gen-index.mjs`, `npm run map`.
- **Следующий шаг:** **шаг 4 — индикатор приоритета** (`nextPrioritySide`, `initialPriorityReason`). Затем шаг 5 — транспорт (`wait` / `end-turn` / `speed`), шаг 6 — боевая песочница в `battle-sandbox.html`, шаг 7 — `docs/battle.md`, ADR 022, строка статуса в 021, раздел «Итог», финальный push.
- **Тронутые файлы (002, шаги 1–3):** `server/src/battle/battle.ts`, `server/src/battle/turnQueue.ts`, `server/src/battle/battleTurns.test.ts`, `server/src/battle/battle.test.ts`, `server/src/battle/turnQueue.test.ts`, `docs/tasks/002-…md`. Мета-файлы: `START-HERE.md`, `AGENTS.md`, `.clineignore`, `.clinerules/01-workflow.md`, `.clinerules/handoff.md`, `.clinerules/workflows/{handoff,continue,sync}.md`, `docs/INDEX.md`, `tools/gen-index.mjs`, `README.md`, `docs/conventions.md`, `package.json`.
- **Как проверить:** `npm test` и `npm run typecheck` из корня; песочница боя — `npm run dev:server` + `http://127.0.0.1:3000/debug/battle-sandbox`; карта репо — `npm run map`.
- **Тесты:** зелёные — `npm test`: 13 файлов, 356 тестов passed (battleTurns 43, battle 77, resolveAttack 69, turnQueue 38, T6-фаззинг 200 случайных боёв). `npm run typecheck` чистый.
- **Подводные камни:** T1 на шаге 3 усилен третьим юнитом группы (иначе не доказывал ветку (а)); T3 не отличает ветку (в) от (б) — их доказывают существующие тесты и T6; T6 ловит почти любое отключение, это ожидаемо. `config/*.json` читается один раз при старте сервера — после правки нужен рестарт.
- **Открытые вопросы:** нет.
- **Обновлено:** 2026-10-02, модель Cline (handoff без новых правок кода).