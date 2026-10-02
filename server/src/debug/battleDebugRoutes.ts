/**
 * DEV-TOOL HTTP API for the battle sandbox (docs/battle.md).
 *
 * This is a developer tool, NOT part of the game: no player authorization, no
 * persistence, no protocol messages in /shared. It is mounted with a single line
 * in index.ts; in production it is simply not mounted.
 *
 * // DEV-TOOL: not mounted in production (docs/conventions.md)
 *
 * THE WHOLE POINT OF THIS FILE: it contains NO GAME RULES. Every route is a thin
 * translation of an HTTP call into a Battle command and back. "Can this unit hit
 * that one?", "is this cell free?" and "does the defender have a retaliation left?"
 * are answered by Battle, never here (docs/conventions.md, decisions 019).
 *
 * Status codes: a REFUSAL BY THE RULES is a normal 200 with { ok: false, code,
 * message } — the caller asked a legal question and got a legal answer. HTTP 400
 * is only for a broken request body, and 404 only for an unknown battle id.
 *
 * Battles live in the memory of this process only: a Map with a hard cap, the
 * oldest one dropped when the cap is reached. Nothing is written to disk or a DB.
 */

import { randomUUID } from 'node:crypto';

import express, { type Router } from 'express';

import type { AttackOptions, BattleEvent, BattleSetup, Hex } from '@de-jija/shared';

import { getCombatRules } from '../combat/combatRules';
import { getSkills } from '../combat/skills';
import { combatFixtures } from '../combat/testFixtures';
import { createBattle, type Battle } from '../battle/battle';
import { getBattleRules } from '../battle/battleRules';

/** How many battles are kept in memory at once. The oldest is dropped beyond this. */
export const MAX_BATTLES = 20;

/** A battle created through this API, with the moment it was created. */
type StoredBattle = {
  battle: Battle;
  createdAt: number;
};

/**
 * In-memory storage of the running battles. A plain Map is enough: the tools that
 * need a battle always have its id, and battles are disposable by design.
 */
const battles = new Map<string, StoredBattle>();

/** Drops the oldest battles until the cap is respected again. */
function enforceLimit(): void {
  while (battles.size > MAX_BATTLES) {
    const oldestId = battles.keys().next().value;

    if (oldestId === undefined) {
      return;
    }
    battles.delete(oldestId);
  }
}

/** Clears every stored battle. Exported for the tests only. */
export function clearBattles(): void {
  battles.clear();
}

/** How many battles are stored right now. Exported for the tests only. */
export function battleCount(): number {
  return battles.size;
}

/** Finds a battle or undefined. */
function findBattle(battleId: string): Battle | undefined {
  return battles.get(battleId)?.battle;
}

/** Reads one hex from a request body. Returns null when it is not a cell. */
function readHex(value: unknown): Hex | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const raw = value as Record<string, unknown>;

  if (typeof raw.x !== 'number' || !Number.isInteger(raw.x)) {
    return null;
  }
  if (typeof raw.y !== 'number' || !Number.isInteger(raw.y)) {
    return null;
  }

  return { x: raw.x, y: raw.y };
}

/** Reads the optional debug switches of an attack. Unknown fields are ignored. */
function readOptions(value: unknown): AttackOptions {
  if (typeof value !== 'object' || value === null) {
    return {};
  }

  const raw = value as Record<string, unknown>;
  const options: AttackOptions = {};

  if (typeof raw.fixedDamageRoll === 'number') {
    options.fixedDamageRoll = raw.fixedDamageRoll;
  }
  if (typeof raw.fixedLuckRoll === 'number') {
    options.fixedLuckRoll = raw.fixedLuckRoll;
  }
  if (raw.moraleExtraAttack === true) {
    options.moraleExtraAttack = true;
  }

  return options;
}

/** Builds the battle API router. Mounted at /debug in index.ts. */
export function createBattleDebugRouter(): Router {
  const router = express.Router();

  // The debug router already parses JSON bodies; this one is mounted next to it.
  router.use(express.json({ limit: '256kb' }));

  // The current balance, so the sandbox can show it and edit a copy of it.
  router.get('/battle-config', (_request, response) => {
    response.json({
      // combatRules are the DEFAULTS for editing: a battle may override any of
      // them through setup.rules (docs/battle.md, section 4.1).
      combatRules: getCombatRules(),
      battleRules: getBattleRules(),
    });
  });

  // The unit templates for the "add unit" panel. These are the very same fixtures
  // the unit tests use, so a preset can never disagree with the tested numbers.
  router.get('/units', (_request, response) => {
    response.json(combatFixtures);
  });

  // Creates a battle. A bad setup is a normal answer (200 + ok:false), only a
  // request without a setup object is a broken request (400).
  router.post('/battles', (request, response) => {
    const body = request.body as { setup?: unknown } | undefined;

    if (typeof body !== 'object' || body === null || body.setup === undefined) {
      response.status(400).json({ ok: false, code: 'BAD_REQUEST', message: 'Ожидалось поле setup' });
      return;
    }

    const created = createBattle(body.setup as BattleSetup, {
      combatRules: getCombatRules(),
      skillsData: getSkills(),
      battleRules: getBattleRules(),
      // The real random, like in a real battle: the sandbox can freeze the rolls
      // per attack through `options`.
      random: Math.random,
    });

    if (!created.ok) {
      response.status(200).json({ ok: false, code: created.code, message: created.message });
      return;
    }

    const battleId = randomUUID();

    battles.set(battleId, { battle: created.battle, createdAt: Date.now() });
    enforceLimit();

    // The events of a fresh battle: only the units that came with a cell.
    const events: BattleEvent[] = created.battle.getState().log;

    response.status(200).json({
      ok: true,
      battleId,
      state: created.battle.getState(),
      events,
    });
  });

  // The current state of one battle.
  router.get('/battles/:id/state', (request, response) => {
    const battle = findBattle(request.params.id);

    if (battle === undefined) {
      response.status(404).json({ error: 'Бой не найден' });
      return;
    }

    response.json({ state: battle.getState() });
  });

  // Puts a unit on a cell. A refusal by the rules comes back as 200 + ok:false
  // together with the unchanged state, so the caller can redraw immediately.
  router.post('/battles/:id/place', (request, response) => {
    const battle = findBattle(request.params.id);

    if (battle === undefined) {
      response.status(404).json({ error: 'Бой не найден' });
      return;
    }

    const body = (request.body ?? {}) as { unitId?: unknown; hex?: unknown };
    const hex = readHex(body.hex);

    if (typeof body.unitId !== 'string' || hex === null) {
      response.status(400).json({
        ok: false,
        code: 'BAD_REQUEST',
        message: 'Ожидались поля unitId (строка) и hex { x: целое, y: целое }',
      });
      return;
    }

    const result = battle.placeUnit(body.unitId, hex);

    response.status(200).json(
      result.ok
        ? { ok: true, events: result.events, state: battle.getState() }
        : { ...result, state: battle.getState() },
    );
  });

  // One hit (with the retaliation that follows it). Same shape as /place.
  router.post('/battles/:id/attack', (request, response) => {
    const battle = findBattle(request.params.id);

    if (battle === undefined) {
      response.status(404).json({ error: 'Бой не найден' });
      return;
    }

    const body = (request.body ?? {}) as {
      attackerId?: unknown;
      targetId?: unknown;
      options?: unknown;
    };

    if (typeof body.attackerId !== 'string' || typeof body.targetId !== 'string') {
      response.status(400).json({
        ok: false,
        code: 'BAD_REQUEST',
        message: 'Ожидались поля attackerId и targetId (строки)',
      });
      return;
    }

    const result = battle.attack(body.attackerId, body.targetId, readOptions(body.options));

    response.status(200).json(
      result.ok
        ? { ok: true, events: result.events, state: battle.getState() }
        : { ...result, state: battle.getState() },
    );
  });

  // Starts the next round.
  router.post('/battles/:id/next-round', (request, response) => {
    const battle = findBattle(request.params.id);

    if (battle === undefined) {
      response.status(404).json({ error: 'Бой не найден' });
      return;
    }

    const result = battle.nextRound();

    response.status(200).json(
      result.ok
        ? { ok: true, events: result.events, state: battle.getState() }
        : { ...result, state: battle.getState() },
    );
  });

  // The current unit is done: the queue moves on. Thin translation of endTurn()
  // — the rules of when a round ends live in Battle, not here.
  router.post('/battles/:id/end-turn', (request, response) => {
    const battle = findBattle(request.params.id);

    if (battle === undefined) {
      response.status(404).json({ error: 'Бой не найден' });
      return;
    }

    const result = battle.endTurn();

    response.status(200).json(
      result.ok
        ? { ok: true, events: result.events, state: battle.getState() }
        : { ...result, state: battle.getState() },
    );
  });

  // The unit moves to the waiting segment of the current round. Same shape.
  router.post('/battles/:id/wait', (request, response) => {
    const battle = findBattle(request.params.id);

    if (battle === undefined) {
      response.status(404).json({ error: 'Бой не найден' });
      return;
    }

    const body = (request.body ?? {}) as { unitId?: unknown };

    if (typeof body.unitId !== 'string') {
      response.status(400).json({
        ok: false,
        code: 'BAD_REQUEST',
        message: 'Ожидалось поле unitId (строка)',
      });
      return;
    }

    const result = battle.wait(body.unitId);

    response.status(200).json(
      result.ok
        ? { ok: true, events: result.events, state: battle.getState() }
        : { ...result, state: battle.getState() },
    );
  });

  // Changes the current speed of a unit (a haste or a slow). ANY unit may be
  // changed, not only the current one: that is how the sandbox checks rule 5.
  router.post('/battles/:id/speed', (request, response) => {
    const battle = findBattle(request.params.id);

    if (battle === undefined) {
      response.status(404).json({ error: 'Бой не найден' });
      return;
    }

    const body = (request.body ?? {}) as { unitId?: unknown; speed?: unknown };

    if (typeof body.unitId !== 'string' || typeof body.speed !== 'number' || !Number.isFinite(body.speed)) {
      response.status(400).json({
        ok: false,
        code: 'BAD_REQUEST',
        message: 'Ожидались поля unitId (строка) и speed (число)',
      });
      return;
    }

    const result = battle.setUnitSpeed(body.unitId, body.speed);

    response.status(200).json(
      result.ok
        ? { ok: true, events: result.events, state: battle.getState() }
        : { ...result, state: battle.getState() },
    );
  });

  // The targets the sandbox should highlight. WHICH targets those are is decided
  // by Battle; this route only shapes the answer as { targetId, kind }.
  router.get('/battles/:id/targets', (request, response) => {
    const battle = findBattle(request.params.id);

    if (battle === undefined) {
      response.status(404).json({ error: 'Бой не найден' });
      return;
    }

    const unitId = request.query.unitId;

    if (typeof unitId !== 'string') {
      response.status(400).json({
        ok: false,
        code: 'BAD_REQUEST',
        message: 'Ожидался параметр запроса unitId',
      });
      return;
    }

    const result = battle.getValidTargets(unitId);

    if (!result.ok) {
      response.status(200).json({ ok: false, code: result.code, message: result.message });
      return;
    }

    response.json({
      ok: true,
      targets: result.targets.map((target) => ({ targetId: target.unitId, kind: target.kind })),
    });
  });

  // Throws a battle away. The sandbox uses it to start from scratch.
  router.delete('/battles/:id', (request, response) => {
    const removed = battles.delete(request.params.id);

    if (!removed) {
      response.status(404).json({ error: 'Бой не найден' });
      return;
    }

    response.json({ ok: true });
  });

  return router;
}

