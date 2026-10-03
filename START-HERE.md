# START-HERE — входная точка для ИИ-агента

**Правила для веб-ИИ**
- Материалы приходят одним пакет-файлом, приложенным к чату (`docs/workflow/web-ai.md`); репозиторий закрыт, ссылок нет. Прочитал пакет — отвечай по формату ОТВЕТ ВЕБ-ИИ. Если пакета нет и автор просто начал чат — прочитай, где мы, и жди.

**Для CLI-агента**
- Читай этот файл **первым** при начале нового чата/сессии: часть A — постоянные правила, часть B — текущее состояние.
- Дальше открывай только те файлы, которые реально нужны, по ссылкам отсюда и из карты репозитория.
- **Если часть B старше последнего коммита — верь `git log -5` и `git status`.**
- Веб-ИИ — **консультант по сложному**, а не обязательный этап: обращайся при новом игровом правиле, новой архитектурной границе, изменении формата данных в `/shared`, тупике или неоднозначности. Мелкое, описанное в документах, делай сам и фиксируй в «Прогресс» (ADR 029, `docs/workflow/web-ai.md`).

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
- Роли: **автор** — человек, ставит задачи и принимает решения; **CLI-агент** — реализация в репозитории; **веб-ИИ** — консультант по сложному: архитектура, дизайн игровых правил, разбор тупиков; репозиторий не видит, работает по пакет-файлу ([`docs/workflow/web-ai.md`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/docs/workflow/web-ai.md)).
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

---


- **Активная задача:** [docs/tasks/004-arena.md](https://raw.githubusercontent.com/danyaskyline/de-jija/main/docs/tasks/004-arena.md) — арена. Блоки 1–3 выполнены, блоки 4–9 не начаты.
- **Цель:** играбельная арена целиком на клиенте и сервере, где бой **всегда начинается и всегда заканчивается**.
- **Сделано:** Блок 1 — задача 004, ADR 027/028/029, `game-design.md` переписан, часть A `START-HERE.md` восстановлена. Блок 2 — `config/units.json` (112 юнитов в 8 фракциях) и `config/hero-types.json` (18 героев, 12 навыков с ценами) + генераторы + загрузчики `server/src/units/`. **Блок 3 — аккаунты готовы и проверены на живой БД:** `server/src/db/` (db.ts, migrations.ts), `server/src/auth/` (password.ts — scrypt, accounts.ts — регистрация только по одноразовому инвайту в одной транзакции), 18 тестов проходят.
- **В процессе:** ничего.
- **Сделано:** Блок 1 — задача 004, ADR 027/028/029, `game-design.md` переписан, часть A `START-HERE.md` восстановлена. Блок 2 — `config/units.json` (112 юнитов в 8 фракциях) и `config/hero-types.json` (18 героев, 12 навыков с ценами) + генераторы + загрузчики `server/src/units/`. **Блок 3 — аккаунты готовы и проверены на живой БД:** `server/src/db/` (db.ts, migrations.ts), `server/src/auth/` (password.ts — scrypt, accounts.ts — регистрация только по одноразовому инвайту в одной транзакции), 18 тестов проходят.
- **Тронутые файлы (004):** `docs/tasks/004-arena.md`, `docs/decisions.md`, `docs/game-design.md`, `docs/INDEX.md`, `START-HERE.md`, `config/units.json`, `server/src/units/units.ts`, `server/src/units/units.test.ts`, `server/src/index.ts`, `tools/build-units-data.mjs`.
- **Как проверить:** `npm test`, `npm run typecheck`, `npm run check`; сервер — `npm run dev:server`, в логе должно быть `[config] 112 units in 8 factions`.
- **Тесты:** зелёные — `npm test`: **17 файлов, 430 тестов**, ни одного пропущенного (тесты аккаунтов идут по живой PostgreSQL); `npm run typecheck` чистый; `npm run check` без ошибок.
- **Подводные камни:** PostgreSQL запускается только как СЛУЖБА (PowerShell от админа, `Start-Service postgresql-x64-18`); запуск через `pg_ctl` падает с `0xC0000142`. `pg_hba.conf` переведён на `trust` локально (бэкап `pg_hba.conf.bak-2026-10-03`), при хостинге вернуть к паролю. `.gitignore:39` содержит `data/` и перехватывает `server/src/data/` — код туда класть нельзя, отсюда папка `server/src/units/`. Генератор читает CSV автора по номерам строк (19–27) — при правке таблицы съедут. Битый `config/units.json` роняет сервер — намеренно.
- **Открытые вопросы:** (1) `pg_hba.conf` переведён на `trust` локально — при хостинге вернуть пароль; (2) состав «Крепости» в таблице дублирует «Цитадель», жду автора; (3) способности юнитов — поддержано 4 из ~20, консультация веб-ИИ; (4) артефактов нет в таблице, отложены.
- **Обновлено:** 2026-10-03, роль CLI-агент (блоки 1–3 задачи 004 закрыты, 430 тестов зелёные).




