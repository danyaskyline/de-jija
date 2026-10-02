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

- **Активная задача:** [docs/tasks/002-tie-rule-and-priority-indicator.md](https://raw.githubusercontent.com/danyaskyline/de-jija/main/docs/tasks/002-tie-rule-and-priority-indicator.md) — шаги 0-7 и обе сессии ревью выполнены; решение по индикатору **ратифицировано** (ADR 025), задача готова к закрытию автором.
- **Цель:** правка равной скорости, начальный приоритет и индикатор приоритета - достигнута.
- **Сделано:** шаги 0-7 кодом и документами; ревью пакетов 002/003/004 обработано полностью: исправлены неверные формулировки, добавлены два триггера (консультация до кода / ревью после) и колонка "Консультация", записана первая строка "Решений без консультации"; по пакету 004 введена функция `priorityPair`, новый файл `priorityIndicatorInvariant.test.ts` (8 тестов) и три теста на счёт сдвигов приоритета; правило 4а исправлено по решению автора.
- **В процессе:** ничего; осталось закрытие задачи автором и пакет финального ревью.
- **Следующий шаг:** финальное ревью задачи 002 пакетом (diff, зелёные тесты, "Прогресс" и "Итог", часть B) - по правилу "ревью перед закрытием". После него задача закрывается.
- **Тронутые файлы (002):** `server/src/battle/battle.ts`, `turnQueue.ts`, `battleTurns.test.ts`, `priorityIndicatorInvariant.test.ts`, `turnQueue.test.ts`, `server/src/debug/battleDebugRoutes.ts`, `battleDebugRoutes.test.ts`, `battleSandboxPage.smoke.test.ts`, `server/debug/battle-sandbox.html`, `shared/src/index.ts`, `docs/battle.md`, `docs/architecture.md`, `docs/decisions.md`, `docs/workflow/web-ai.md`, `docs/tasks/002-...md`, `START-HERE.md`.
- **Как проверить:** `npm test`, `npm run typecheck`, `npm run check`; песочница - `npm run dev:server` и `http://127.0.0.1:3000/debug/battle-sandbox`.
- **Тесты:** зелёные - `npm test`: **14 файлов, 384 теста passed**; `npm run typecheck` чистый.
- **Подводные камни:** при равных скоростях текущий юнит случаен (решает монетка) - тесты не должны хардкодить стороны. Раунд переключается **автоматически**, поэтому тесты на счёт сдвигов обязаны останавливаться по смене номера раунда, иначе считают следующий раунд. `PriorityRolled` хранит сторону **на начало** боя, а `prioritySide` к моменту чтения уже мог смениться - их нельзя сравнивать, только причину.
- **Открытые вопросы:** долг из ADR 022 - переименовать `PriorityRolled` вместе с задачей про сид RNG; уточнение правила 4в для случая, когда одна сторона в группе кончилась раньше (необязательно, требует подтверждения автора); мутация "to читается из nextPrioritySide" неотличима от корректного кода, пока держится инвариант.
- **Обновлено:** 2026-10-02, роль CLI-агент (сессия 2 ревью завершена: ратификация ADR 025, priorityPair, 11 новых тестов, 384 теста зелёные).