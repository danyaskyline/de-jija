# Карта репозитория de-jija

> Файл сгенерирован скриптом `tools/gen-index.mjs` (`npm run map`). Не редактировать вручную.
> Всего файлов: 88. Обновляй карту после добавления/удаления/переименования файлов.

Как читать репо экономно: сначала [`START-HERE.md`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/START-HERE.md), потом сюда — и открывать только нужный файл, а не всё дерево.

## Корень репозитория

- [`.clineignore`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/.clineignore)
- [`.gitattributes`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/.gitattributes)
- [`.gitignore`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/.gitignore)
- [`AGENTS.md`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/AGENTS.md) — de-jija — для ИИ-агентов
- [`package.json`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/package.json) — _данные/конфиг (JSON)_
- [`README.md`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/README.md) — de-jija
- [`START-HERE.md`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/START-HERE.md) — START-HERE — входная точка для ИИ-агента
- [`tsconfig.base.json`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/tsconfig.base.json) — _данные/конфиг (JSON)_

## docs

- [`docs/architecture.md`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/docs/architecture.md) — Architecture
- [`docs/battle.md`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/docs/battle.md) — Battle — модель боя (инстанс боя)
- [`docs/combat-formula.md`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/docs/combat-formula.md) — Формула урона (resolveAttack)
- [`docs/conventions.md`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/docs/conventions.md) — Conventions — правила проекта
- [`docs/decisions.md`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/docs/decisions.md) — Decisions — журнал архитектурных решений
- [`docs/game-design.md`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/docs/game-design.md) — Game Design — MMO в духе Heroesland/HoMM3
- [`docs/tasks/001-turn-queue.md`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/docs/tasks/001-turn-queue.md) — Задача 001: очередь ходов в бою
- [`docs/tasks/002-tie-rule-and-priority-indicator.md`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/docs/tasks/002-tie-rule-and-priority-indicator.md) — Задача 002: правка равной скорости, начальный приоритет и индикатор приоритета
- [`docs/tasks/003-blocking-checks.md`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/docs/tasks/003-blocking-checks.md) — Задача 003: блокирующие проверки, git-хуки и CI
- [`docs/workflow/done.md`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/docs/workflow/done.md) — Done — закрыть шаг или задачу
- [`docs/workflow/handoff.md`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/docs/workflow/handoff.md) — Handoff — передать контекст в новую сессию
- [`docs/workflow/start.md`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/docs/workflow/start.md) — Start — начать или продолжить сессию
- [`docs/workflow/sync.md`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/docs/workflow/sync.md) — Sync — записать решения, полученные вне репозитория

## server

- [`server/debug/battle-sandbox.html`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/server/debug/battle-sandbox.html) — _HTML-страница_
- [`server/debug/combat-sandbox.html`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/server/debug/combat-sandbox.html) — _HTML-страница_
- [`server/package.json`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/server/package.json) — _данные/конфиг (JSON)_
- [`server/src/battle/battle.test.ts`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/server/src/battle/battle.test.ts) — _без экспортов_
- [`server/src/battle/battle.ts`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/server/src/battle/battle.ts) — экспорты: BattleDeps, CommandOk, Battle, createBattle
- [`server/src/battle/battleRules.test.ts`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/server/src/battle/battleRules.test.ts) — _без экспортов_
- [`server/src/battle/battleRules.ts`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/server/src/battle/battleRules.ts) — экспорты: DEFAULT_BATTLE_RULES_PATH, BattleRules, parseBattleRules, loadBattleRules, setBattleRules, getBattl…
- [`server/src/battle/battleTurns.test.ts`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/server/src/battle/battleTurns.test.ts) — _без экспортов_
- [`server/src/battle/hex.test.ts`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/server/src/battle/hex.test.ts) — _без экспортов_
- [`server/src/battle/turnQueue.test.ts`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/server/src/battle/turnQueue.test.ts) — _без экспортов_
- [`server/src/battle/turnQueue.ts`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/server/src/battle/turnQueue.ts) — экспорты: TurnQueueUnit, TurnGroup, levelRank, InitialPriorityReason, InitialPriority, decideInitialPriority,…
- [`server/src/combat/combatant.test.ts`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/server/src/combat/combatant.test.ts) — _без экспортов_
- [`server/src/combat/combatant.ts`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/server/src/combat/combatant.ts) — экспорты: emptyCombatBonuses, combinePercentBonuses, buildCombatant
- [`server/src/combat/combatRules.test.ts`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/server/src/combat/combatRules.test.ts) — _без экспортов_
- [`server/src/combat/combatRules.ts`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/server/src/combat/combatRules.ts) — экспорты: DEFAULT_COMBAT_RULES_PATH, CombatRules, loadCombatRules, setCombatRules, getCombatRules, initCombat…
- [`server/src/combat/heroModifiers.test.ts`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/server/src/combat/heroModifiers.test.ts) — _без экспортов_
- [`server/src/combat/heroModifiers.ts`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/server/src/combat/heroModifiers.ts) — экспорты: HeroModifiers, MAX_HERO_SKILLS, ATTACK_TARGETS_IN_USE, skillAffectsAttackNow, emptyHeroModifiers, a…
- [`server/src/combat/resolveAttack.test.ts`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/server/src/combat/resolveAttack.test.ts) — _без экспортов_
- [`server/src/combat/resolveAttack.ts`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/server/src/combat/resolveAttack.ts) — экспорты: AttackContext, DamageBreakdown, AttackResult, LUCK_LEVEL_MIN, LUCK_LEVEL_MAX, clampLuckLevel, …
- [`server/src/combat/skills.test.ts`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/server/src/combat/skills.test.ts) — _без экспортов_
- [`server/src/combat/skills.ts`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/server/src/combat/skills.ts) — экспорты: DEFAULT_SKILLS_PATH, SkillTarget, SKILL_TARGETS, SkillEffect, Skill, SkillsData, …
- [`server/src/combat/testFixtures.ts`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/server/src/combat/testFixtures.ts) — экспорты: CombatFixture, combatFixtures, getFixture, fixtureToUnit, antimage, swordsman, …
- [`server/src/debug/battleDebugRoutes.test.ts`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/server/src/debug/battleDebugRoutes.test.ts) — _без экспортов_
- [`server/src/debug/battleDebugRoutes.ts`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/server/src/debug/battleDebugRoutes.ts) — экспорты: MAX_BATTLES, clearBattles, battleCount, createBattleDebugRouter
- [`server/src/debug/battleSandboxPage.smoke.test.ts`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/server/src/debug/battleSandboxPage.smoke.test.ts) — _без экспортов_
- [`server/src/debug/debugRoutes.test.ts`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/server/src/debug/debugRoutes.test.ts) — _без экспортов_
- [`server/src/debug/debugRoutes.ts`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/server/src/debug/debugRoutes.ts) — экспорты: createDebugRouter
- [`server/src/index.ts`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/server/src/index.ts) — _без экспортов_
- [`server/tsconfig.json`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/server/tsconfig.json) — _данные/конфиг (JSON)_

## client

- [`client/index.html`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/client/index.html) — _HTML-страница_
- [`client/package.json`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/client/package.json) — _данные/конфиг (JSON)_
- [`client/src/main.ts`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/client/src/main.ts) — _без экспортов_
- [`client/tsconfig.json`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/client/tsconfig.json) — _данные/конфиг (JSON)_

## shared

- [`shared/package.json`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/shared/package.json) — _данные/конфиг (JSON)_
- [`shared/src/hex.ts`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/shared/src/hex.ts) — экспорты: toCube, distance, neighbors, isInside, isSameHex
- [`shared/src/index.ts`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/shared/src/index.ts) — экспорты: PingMessage, PongMessage, ClientMessage, ServerMessage, UnitStats, AbilityTag, …
- [`shared/tsconfig.json`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/shared/tsconfig.json) — _данные/конфиг (JSON)_

## config

- [`config/battle-rules.json`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/config/battle-rules.json) — _данные/конфиг (JSON)_
- [`config/combat-rules.json`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/config/combat-rules.json) — _данные/конфиг (JSON)_
- [`config/skills.json`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/config/skills.json) — _данные/конфиг (JSON)_

## tools

- [`tools/check-docs.mjs`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/tools/check-docs.mjs) — _без экспортов_
- [`tools/checks/active-task.mjs`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/tools/checks/active-task.mjs) — экспорты: checkActiveTask
- [`tools/checks/active-task.test.mjs`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/tools/checks/active-task.test.mjs) — _без экспортов_
- [`tools/checks/adr-numbers.mjs`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/tools/checks/adr-numbers.mjs) — экспорты: checkAdrNumbers
- [`tools/checks/adr-numbers.test.mjs`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/tools/checks/adr-numbers.test.mjs) — _без экспортов_
- [`tools/checks/config-keys.mjs`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/tools/checks/config-keys.mjs) — экспорты: checkConfigKeysInDoc
- [`tools/checks/config-keys.test.mjs`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/tools/checks/config-keys.test.mjs) — _без экспортов_
- [`tools/checks/formula-doc-pairing.mjs`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/tools/checks/formula-doc-pairing.mjs) — экспорты: checkFormulaDocPairing
- [`tools/checks/formula-doc-pairing.test.mjs`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/tools/checks/formula-doc-pairing.test.mjs) — _без экспортов_
- [`tools/checks/index-freshness.mjs`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/tools/checks/index-freshness.mjs) — экспорты: checkIndexFresh
- [`tools/checks/index-freshness.test.mjs`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/tools/checks/index-freshness.test.mjs) — _без экспортов_
- [`tools/checks/links.mjs`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/tools/checks/links.mjs) — экспорты: LINK_SCAN_FILES, findRelativeLinks, checkLinks, resolveRelative
- [`tools/checks/links.test.mjs`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/tools/checks/links.test.mjs) — _без экспортов_
- [`tools/checks/mutable-links.mjs`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/tools/checks/mutable-links.mjs) — экспорты: checkMutableLinks
- [`tools/checks/mutable-links.test.mjs`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/tools/checks/mutable-links.test.mjs) — _без экспортов_
- [`tools/checks/secrets.mjs`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/tools/checks/secrets.mjs) — экспорты: checkSecrets
- [`tools/checks/secrets.test.mjs`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/tools/checks/secrets.test.mjs) — _без экспортов_
- [`tools/gen-index.mjs`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/tools/gen-index.mjs) — экспорты: renderIndex

## .clinerules

- [`.clinerules/01-workflow.md`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/.clinerules/01-workflow.md) — Правила работы над проектом de-jija
- [`.clinerules/handoff.md`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/.clinerules/handoff.md) — Процедуры — в `docs/workflow/` (start, handoff, sync, done). Адаптеры этого инструмента — в `.clinerules/`.
- [`.clinerules/workflows/continue.md`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/.clinerules/workflows/continue.md) — Адаптер: Continue
- [`.clinerules/workflows/done.md`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/.clinerules/workflows/done.md) — Адаптер: Done
- [`.clinerules/workflows/handoff.md`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/.clinerules/workflows/handoff.md) — Адаптер: Handoff
- [`.clinerules/workflows/start.md`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/.clinerules/workflows/start.md) — Адаптер: Start
- [`.clinerules/workflows/sync.md`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/.clinerules/workflows/sync.md) — Адаптер: Sync

## .githooks

- [`.githooks/pre-commit`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/.githooks/pre-commit)
- [`.githooks/pre-push`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/.githooks/pre-push)
