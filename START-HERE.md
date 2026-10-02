# START-HERE — входная точка для ИИ-агента

**Правила для веб-ИИ**
- Материалы приходят одним пакет-файлом, приложенным к чату (`docs/workflow/web-ai.md`); репозиторий закрыт, ссылок нет. Прочитал пакет — отвечай по формату ОТВЕТ ВЕБ-ИИ. Если пакета нет и автор просто начал чат — прочитай, где мы, и жди.

**Для CLI-агента**
- Читай этот файл **первым** при начале нового чата/сессии: часть A — постоянные правила, часть B — текущее состояние.
- Дальше открывай только те файлы, которые реально нужны, по ссылкам отсюда и из карты репозитория.
- **Если часть B старше последнего коммита — верь `git log -5` и `git status`.**
- Архитектура, дизайн правил, ревью и тупики — через пакет для веб-ИИ, см. `docs/workflow/web-ai.md`; обращение обязательно по триггерам.

## ЧАСТЬ A. Постоянное (меняется редко)

**Проект в 5 строках**
1. Браузерная MMO в духе Heroesland / HoMM3: тактический бой на гексагональном поле + карта в реальном времени.
2. Своя графика, звук и названия — без ассетов HoMM3/Heroesland.
3. Монолит-монорепо на Node.js + TypeScript — структура папок и их назначение в `docs/conventions.md`, раздел «Структура репозитория».
4. **Текущее состояние — в части B ниже.** Репозиторий приватный.
5. Проект ведётся соло-автором в связке с ИИ-агентами; автор не программист — код должен быть понятным и с комментариями на ключевых местах.

Подробности: [README.md](https://raw.githubusercontent.com/danyaskyline/de-jija/main/README.md)
Правила проекта: [docs/conventions.md](https://raw.githubusercontent.com/danyaskyline/de-jija/main/docs/conventions.md) · процедуры: [docs/workflow/](https://raw.githubusercontent.com/danyaskyline/de-jija/main/docs/workflow/start.md) · адаптеры инструмента: [`.clinerules/`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/.clinerules/01-workflow.md)

**Карта репозитория** (что где лежит, с полными ссылками и однострочными описаниями):
[docs/INDEX.md](https://raw.githubusercontent.com/danyaskyline/de-jija/main/docs/INDEX.md)
Регенерируется командой `npm run map` — запускай её после добавления/удаления файлов.

**Как устроен процесс**
- Роли: **автор** — человек, ставит задачи и принимает решения; **CLI-агент** — реализация в репозитории; **веб-ИИ** — архитектура, дизайн, ревью и разбор тупиков, репозиторий не видит, работает по пакет-файлу ([`docs/workflow/web-ai.md`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/docs/workflow/web-ai.md)).
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

---

## ЧАСТЬ B. Текущее состояние

> Эта часть **перезаписывается целиком** при каждом handoff, а не дописывается. Не больше 30 строк.

- **Активная задача:** [docs/tasks/002-tie-rule-and-priority-indicator.md](https://raw.githubusercontent.com/danyaskyline/de-jija/main/docs/tasks/002-tie-rule-and-priority-indicator.md) — **закрыта полностью, шаги 0-7.**
- **Цель:** правка равной скорости, начальный приоритет и индикатор приоритета - достигнута.
- **Сделано:** шаг 1 - каскад равной скорости (`orderEqualSpeedGroup`); шаг 2 - начальный приоритет `decideInitialPriority`; шаг 3 - правило "новичок в уже разрешённой группе" (память `ResolvedGroup`); шаг 4 - индикатор (`nextPrioritySide`, `initialPriorityReason`, `oppositeSide`, единая запись `setPrioritySide`); шаг 5 - три маршрута песочницы (`/end-turn`, `/wait`, `/speed`); шаг 6 - панель очереди с двумя сегментами, индикатором и кнопками хода; шаг 7 - `docs/battle.md` (15.6-15.7), ADR 022, строка статуса в 021, "Итог".
- **В процессе:** ничего.
- **Следующий шаг:** новую задачу выбирает автор. Предлагаемая: аудит и разбиение `battle.ts` (1269 строк) и `battleTurns.test.ts` (1609) - после того как поведение зафиксировано тестами и описано в `docs/battle.md`.
- **Тронутые файлы (002, все шаги):** `server/src/battle/battle.ts`, `turnQueue.ts`, `battleTurns.test.ts`, `turnQueue.test.ts`, `server/src/debug/battleDebugRoutes.ts`, `battleDebugRoutes.test.ts`, `battleSandboxPage.smoke.test.ts`, `server/debug/battle-sandbox.html`, `shared/src/index.ts`, `docs/battle.md`, `docs/architecture.md`, `docs/decisions.md`.
- **Как проверить:** `npm test`, `npm run typecheck`, `npm run check`; песочница - `npm run dev:server` и `http://127.0.0.1:3000/debug/battle-sandbox` (панель "Очередь ходов", кнопки "Завершить ход" и "Ждать").
- **Тесты:** зелёные - `npm test`: 13 файлов, 373 теста passed; `npm run typecheck` чистый; `npm run check` - одно прежнее предупреждение про 9 длинных `.ts` файлов.
- **Подводные камни:** при равных скоростях текущий юнит случаен (решает монетка) - тесты не должны хардкодить стороны. `enforceTurns` по умолчанию `false`, поэтому `wait` не-текущим юнитом разрешён и не крадёт очередь. Правило 4б сдвигает приоритет один раз на межстороновую группу, а не на каждый ход.
- **Открытые вопросы:** долг из ADR 022 - переименовать `PriorityRolled` вместе с задачей про сид RNG.
- **Обновлено:** 2026-10-02, роль CLI-агент (задача 002 закрыта полностью: шаги 4-7 сделаны, 373 теста зелёные).