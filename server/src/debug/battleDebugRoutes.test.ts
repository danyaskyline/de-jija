/**
 * Tests for the DEV-TOOL battle API (server/src/debug/battleDebugRoutes.ts).
 *
 * A real HTTP server is started on an ephemeral port and hit with fetch, so the
 * router is exercised exactly as the browser (or curl) would.
 *
 * The important thing checked here is not the damage numbers — those belong to the
 * Battle tests — but the CONTRACT: a refusal by the rules is a normal 200 with
 * { ok: false, code }, only a broken body is 400 and only an unknown battle is 404.
 */

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import express from 'express';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { BattleSetup, BattleState, Hex, UnitSetup } from '@de-jija/shared';

import { initBattleRules } from '../battle/battleRules';
import { initCombatRules } from '../combat/combatRules';
import { initSkills } from '../combat/skills';
import {
  battleCount,
  clearBattles,
  createBattleDebugRouter,
  MAX_BATTLES,
} from './battleDebugRoutes';

let server: Server;
let baseUrl = '';

beforeAll(async () => {
  initCombatRules();
  initSkills();
  initBattleRules();

  const app = express();
  app.use('/debug', createBattleDebugRouter());

  server = await new Promise<Server>((resolve) => {
    const started = app.listen(0, '127.0.0.1', () => resolve(started));
  });

  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/debug`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => {
  clearBattles();
});

/** The parts of a battle response these tests look at. */
type BattleResponse = {
  ok: boolean;
  battleId?: string;
  code?: string;
  message?: string;
  state?: BattleState;
  events?: { type: string; [key: string]: unknown }[];
  targets?: { targetId: string; kind: string }[];
  error?: string;
};

async function get(path: string): Promise<{ status: number; body: BattleResponse }> {
  const response = await fetch(baseUrl + path);
  const body = (await response.json()) as BattleResponse;

  return { status: response.status, body };
}

async function post(
  path: string,
  payload?: unknown,
  method = 'POST',
): Promise<{ status: number; body: BattleResponse }> {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const body = (await response.json()) as BattleResponse;

  return { status: response.status, body };
}

/** A unit that is ready to be put on the field. */
function ready(
  id: string,
  attack: number,
  defense: number,
  hex: Hex | null,
): UnitSetup {
  return {
    id,
    unit: {
      id,
      name: id,
      stats: { hp: 60, attack, defense, speed: 5, damageMin: 2, damageMax: 2 },
      tags: [],
      currentHp: 60,
    },
    stackCount: 1,
    hex,
  };
}


describe('GET /debug/battle-config and GET /debug/units', () => {
  it('returns the current balance so the sandbox can edit a copy of it', async () => {
    const response = await fetch(baseUrl + '/battle-config');
    const body = (await response.json()) as {
      combatRules: Record<string, unknown>;
      battleRules: Record<string, number>;
    };

    expect(response.status).toBe(200);
    expect(body.combatRules.attackAdvantagePercentPerPoint).toBe(5);
    expect(body.combatRules.damageRollMode).toBe('uniform');
    expect(body.battleRules).toEqual({
      fieldWidth: 15,
      fieldHeight: 11,
      maxUnitsPerSide: 7,
      startZoneWidth: 2,
    });
  });

  it('returns the unit templates (the same fixtures the unit tests use)', async () => {
    const response = await fetch(baseUrl + '/units');
    const body = (await response.json()) as { id: string }[];

    expect(response.status).toBe(200);
    expect(body.map((item) => item.id)).toContain('swordsman');
    expect(body.map((item) => item.id)).toContain('archer');
  });
});

describe('POST /debug/battles', () => {
  it('creates a battle and returns its id, state and events', async () => {
    const { status, body } = await post('/battles', { setup: duelSetup() });

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.battleId).toBe('string');
    expect(body.state?.round).toBe(1);
    expect(body.state?.units).toHaveLength(2);
    // Both units came with a cell, so both placements are already in the log.
    expect(body.events?.map((event) => event.type)).toEqual([
      'PriorityRolled',
      'UnitPlaced',
      'UnitPlaced',
      'PriorityPassed',
      'TurnStarted',
    ]);
  });

  it('a bad setup is a normal 200 answer with SETUP_INVALID, not an HTTP error', async () => {
    const { status, body } = await post('/battles', {
      setup: {
        placementMode: 'free',
        sides: {
          left: { hero: null, units: [ready('a', 5, 5, { x: 3, y: 4 })] },
          // The same id twice: the setup is wrong, and the answer says so.
          right: { hero: null, units: [ready('a', 5, 5, { x: 4, y: 4 })] },
        },
      },
    });

    expect(status).toBe(200);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('SETUP_INVALID');
    expect(body.battleId).toBeUndefined();
  });

  it('a request without a setup is a broken request: 400', async () => {
    const { status, body } = await post('/battles', { notASetup: true });

    expect(status).toBe(400);
    expect(body.code).toBe('BAD_REQUEST');
  });
});

describe('GET /debug/battles/:id/state', () => {
  it('returns the current state', async () => {
    const battleId = await newBattle();

    const { status, body } = await get(`/battles/${battleId}/state`);

    expect(status).toBe(200);
    expect(body.state?.units.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('an unknown battle id is 404', async () => {
    const { status } = await get('/battles/no-such-battle/state');

    expect(status).toBe(404);
  });
});

describe('POST /debug/battles/:id/place', () => {
  it('places a unit and returns the event and the new state', async () => {
    const battleId = await newBattle({
      placementMode: 'free',
      sides: {
        left: { hero: null, units: [ready('a', 5, 5, null)] },
        right: { hero: null, units: [ready('b', 5, 5, null)] },
      },
    });

    const { status, body } = await post(`/battles/${battleId}/place`, {
      unitId: 'a',
      hex: { x: 7, y: 2 },
    });

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.events?.[0].type).toBe('UnitPlaced');
    expect(body.state?.units.find((item) => item.id === 'a')?.hexes).toEqual([{ x: 7, y: 2 }]);
  });

  it('a refusal by the rules is 200 + ok:false + the unchanged state', async () => {
    const battleId = await newBattle();

    // (99, 99) is outside the 15x11 field: Battle refuses with HEX_OUT_OF_FIELD.
    const { status, body } = await post(`/battles/${battleId}/place`, {
      unitId: 'a',
      hex: { x: 99, y: 99 },
    });

    expect(status).toBe(200);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('HEX_OUT_OF_FIELD');
    // The state comes back anyway, so the caller can redraw without another request.
    expect(body.state?.round).toBe(1);
  });

  it('a body without unitId or hex is a broken request: 400', async () => {
    const battleId = await newBattle();

    const noUnit = await post(`/battles/${battleId}/place`, { hex: { x: 1, y: 1 } });
    const badHex = await post(`/battles/${battleId}/place`, { unitId: 'a', hex: { x: 'one', y: 1 } });

    expect(noUnit.status).toBe(400);
    expect(badHex.status).toBe(400);
  });

  it('an unknown battle id is 404', async () => {
    const { status } = await post('/battles/no-such-battle/place', {
      unitId: 'a',
      hex: { x: 1, y: 1 },
    });

    expect(status).toBe(404);
  });
});

describe('POST /debug/battles/:id/attack', () => {
  it('a successful hit returns the events and the state after it', async () => {
    const battleId = await newBattle();

    const { status, body } = await post(`/battles/${battleId}/attack`, {
      attackerId: 'a',
      targetId: 'b',
      // Freeze the rolls so the test is deterministic.
      options: { fixedDamageRoll: 0, fixedLuckRoll: 0 },
    });

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    // A melee hit between neighbours: the hit and the retaliation.
    //
    // Queue events (TurnStarted / PriorityPassed) are NOT asserted here on purpose:
    // this route uses the REAL Math.random for the priority coin, so whether the
    // hit ends the turn depends on whose turn it happened to be. Asserting them
    // would make this test flaky. The queue itself is covered by battleTurns.test.ts.
    const hitEvents = (body.events ?? []).map((event) => event.type).filter(
      (type) => type === 'AttackResolved' || type === 'RetaliationResolved',
    );

    expect(hitEvents).toEqual(['AttackResolved', 'RetaliationResolved']);

    const defender = body.state?.units.find((item) => item.id === 'b');

    expect(defender?.poolHp).toBeLessThan(60);
    expect(defender?.aliveCount).toBe(1);
  });

  it('a target too far away is a normal 200 answer with TOO_FAR', async () => {
    const battleId = await newBattle({
      placementMode: 'free',
      sides: {
        left: { hero: null, units: [ready('a', 5, 5, { x: 3, y: 4 })] },
        // Three cells away, and 'a' is not a shooter: it simply cannot reach it.
        right: { hero: null, units: [ready('b', 5, 5, { x: 6, y: 4 })] },
      },
    });

    const { status, body } = await post(`/battles/${battleId}/attack`, {
      attackerId: 'a',
      targetId: 'b',
      options: { fixedDamageRoll: 0, fixedLuckRoll: 0 },
    });

    expect(status).toBe(200);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('TOO_FAR');
    // Nothing happened: the defender is untouched.
    expect(body.state?.units.find((item) => item.id === 'b')?.poolHp).toBe(60);
  });

  it('a body without attackerId or targetId is a broken request: 400', async () => {
    const battleId = await newBattle();

    const { status, body } = await post(`/battles/${battleId}/attack`, { attackerId: 'a' });

    expect(status).toBe(400);
    expect(body.code).toBe('BAD_REQUEST');
  });

  it('an unknown battle id is 404', async () => {
    const { status } = await post('/battles/no-such-battle/attack', {
      attackerId: 'a',
      targetId: 'b',
    });

    expect(status).toBe(404);
  });
});

describe('POST /debug/battles/:id/next-round', () => {
  it('starts the next round and returns the event and the state', async () => {
    const battleId = await newBattle();

    const { status, body } = await post(`/battles/${battleId}/next-round`);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.events?.[0].type).toBe('RoundStarted');
    expect(body.state?.round).toBe(2);
  });

  it('an unknown battle id is 404', async () => {
    const { status } = await post('/battles/no-such-battle/next-round');

    expect(status).toBe(404);
  });
});

describe('GET /debug/battles/:id/targets', () => {
  it('returns the target list as { targetId, kind }', async () => {
    const battleId = await newBattle();

    const { status, body } = await get(`/battles/${battleId}/targets?unitId=a`);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.targets).toEqual([{ targetId: 'b', kind: 'melee' }]);
  });

  it('a refusal by the rules is 200 + ok:false', async () => {
    const battleId = await newBattle();

    const { status, body } = await get(`/battles/${battleId}/targets?unitId=ghost`);

    expect(status).toBe(200);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('UNIT_NOT_FOUND');
  });

  it('a missing unitId query parameter is a broken request: 400', async () => {
    const battleId = await newBattle();

    const { status } = await get(`/battles/${battleId}/targets`);

    expect(status).toBe(400);
  });

  it('an unknown battle id is 404', async () => {
    const { status } = await get('/battles/no-such-battle/targets?unitId=a');

    expect(status).toBe(404);
  });
});

describe('DELETE /debug/battles/:id', () => {
  it('throws a battle away, and it is really gone', async () => {
    const battleId = await newBattle();

    const deleted = await post(`/battles/${battleId}`, undefined, 'DELETE');
    const afterDelete = await get(`/battles/${battleId}/state`);

    expect(deleted.status).toBe(200);
    expect(deleted.body.ok).toBe(true);
    expect(afterDelete.status).toBe(404);
  });

  it('deleting an unknown battle is 404', async () => {
    const { status } = await post('/battles/no-such-battle', undefined, 'DELETE');

    expect(status).toBe(404);
  });
});

describe('the in-memory limit', () => {
  it(`keeps at most ${MAX_BATTLES} battles and drops the OLDEST one`, async () => {
    const ids: string[] = [];

    // One more than the cap, created strictly one after another.
    for (let index = 0; index <= MAX_BATTLES; index++) {
      ids.push(await newBattle());
    }

    expect(battleCount()).toBe(MAX_BATTLES);

    // The first battle was pushed out by the newest one.
    expect((await get(`/battles/${ids[0]}/state`)).status).toBe(404);
    expect((await get(`/battles/${ids[ids.length - 1]}/state`)).status).toBe(200);
  });
describe('the turn commands: /end-turn, /wait, /speed (002, step 5)', () => {
  it('end-turn moves the queue on and returns the new state', async () => {
    const battleId = await newBattle();
    const before = (await get(`/battles/${battleId}/state`)).body.state;

    const { status, body } = await post(`/battles/${battleId}/end-turn`);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.state?.turns.currentUnitId).not.toBe(before?.turns.currentUnitId);
    expect(body.state?.turns.order).not.toEqual(before?.turns.order);
  });

  it('end-turn needs no body at all — the current unit is whoever it is', async () => {
    const battleId = await newBattle();

    const { status, body } = await post(`/battles/${battleId}/end-turn`, { nonsense: true });

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('wait moves the current unit into the waiting segment of the round', async () => {
    const battleId = await newBattle();
    const before = (await get(`/battles/${battleId}/state`)).body.state;
    const current = before?.turns.currentUnitId;

    // Equal speeds: the coin decided who is current, so the test must NOT
    // hardcode a side — it asks the state which unit it is.
    expect(typeof current).toBe('string');

    const { status, body } = await post(`/battles/${battleId}/wait`, { unitId: current });

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.state?.units.find((unit) => unit.id === current)?.hasWaitedThisRound).toBe(true);
    expect(body.events?.map((event) => event.type)).toContain('UnitWaited');
  });

  it('a wait without a unitId is a broken request: 400', async () => {
    const battleId = await newBattle();

    const { status, body } = await post(`/battles/${battleId}/wait`, {});

    expect(status).toBe(400);
    expect(body.code).toBe('BAD_REQUEST');
  });

  it('a wait by an unknown unit is REFUSED, and that is a normal 200', async () => {
    const battleId = await newBattle();

    const { status, body } = await post(`/battles/${battleId}/wait`, { unitId: 'nobody' });

    expect(status).toBe(200);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('UNIT_NOT_FOUND');
  });

  it('a second wait in the same battle is REFUSED — once per battle, by any route', async () => {
    const battleId = await newBattle();
    const current = (await get(`/battles/${battleId}/state`)).body.state?.turns.currentUnitId;

    expect((await post(`/battles/${battleId}/wait`, { unitId: current })).body.ok).toBe(true);
    const { status, body } = await post(`/battles/${battleId}/wait`, { unitId: current });

    expect(status).toBe(200);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('ALREADY_WAITED');
  });

  it('a non-current unit may wait too when the turn check is off (the default)', async () => {
    // enforceTurns is OFF by default so the sandbox keeps working: waiting is
    // NOT a stolen turn, it only moves the unit into the waiting segment, and
    // the queue keeps its head.
    const battleId = await newBattle();
    const before = (await get(`/battles/${battleId}/state`)).body.state;
    const current = before?.turns.currentUnitId;
    const other = before?.units.find((unit) => unit.id !== current)?.id;

    const { status, body } = await post(`/battles/${battleId}/wait`, { unitId: other });

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.state?.turns.currentUnitId).toBe(current);
  });

  it('speed changes the current speed of ANY unit, not only the current one', async () => {
    const battleId = await newBattle();
    const before = (await get(`/battles/${battleId}/state`)).body.state;
    const current = before?.turns.currentUnitId;
    const other = before?.units.find((unit) => unit.id !== current)?.id;

    // The other unit is NOT current: changing a non-current unit is exactly
    // what rule 5 must survive, and the sandbox needs it for a hero's haste.
    const { status, body } = await post(`/battles/${battleId}/speed`, { unitId: other, speed: 17 });

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.state?.units.find((unit) => unit.id === other)?.currentSpeed).toBe(17);
  });

  it('the current unit keeps its turn when ITS speed changes (rule 5)', async () => {
    const battleId = await newBattle();
    const before = (await get(`/battles/${battleId}/state`)).body.state;
    const current = before?.turns.currentUnitId;

    const body = (await post(`/battles/${battleId}/speed`, { unitId: current, speed: 1 })).body;

    // The current unit does not lose the turn to a unit that is now faster:
    // the queue is not rebuilt behind its back.
    expect(body.ok).toBe(true);
    expect(body.state?.turns.currentUnitId).toBe(current);
    expect(body.state?.turns.order).toEqual(before?.turns.order);
  });

  it('a speed change of a unit behind the current one keeps the turn and rebuilds the queue', async () => {
    const battleId = await newBattle();
    const before = (await get(`/battles/${battleId}/state`)).body.state;
    const current = before?.turns.currentUnitId;
    const other = before?.units.find((unit) => unit.id !== current)?.id;

    // Slow the unit behind down: it must drop behind everybody else.
    const body = (await post(`/battles/${battleId}/speed`, { unitId: other, speed: 1 })).body;

    expect(body.state?.turns.currentUnitId).toBe(current);
    expect(body.state?.turns.order.at(-1)).toBe(other);
  });

  it('a speed that is not a number is a broken request: 400', async () => {
    const battleId = await newBattle();

    const { status, body } = await post(`/battles/${battleId}/speed`, { unitId: 'a', speed: 'fast' });

    expect(status).toBe(400);
    expect(body.code).toBe('BAD_REQUEST');
  });

  it('all three commands answer 404 for an unknown battle', async () => {
    for (const path of ['/end-turn', '/wait', '/speed']) {
      const { status, body } = await post(`/battles/no-such-battle${path}`, { unitId: 'a', speed: 9 });

      expect(status).toBe(404);
      expect(body.error).toBe('Бой не найден');
    }
  });
});
});

/** Two swordsmen (no hero) standing next to each other. */
function duelSetup(): BattleSetup {
  return {
    placementMode: 'free',
    sides: {
      left: { hero: null, units: [ready('a', 5, 5, { x: 3, y: 4 })] },
      right: { hero: null, units: [ready('b', 5, 5, { x: 4, y: 4 })] },
    },
  };
}

/** Creates a battle and returns its id, failing loudly if that does not work. */
async function newBattle(setup: BattleSetup = duelSetup()): Promise<string> {
  const { status, body } = await post('/battles', { setup });

  if (status !== 200 || body.ok !== true || body.battleId === undefined) {
    throw new Error(`could not create a battle: ${status} ${JSON.stringify(body)}`);
  }

  return body.battleId;
}