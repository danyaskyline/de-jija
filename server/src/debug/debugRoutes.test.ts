/**
 * Tests for the DEV-TOOL combat sandbox routes (docs/decisions.md, 016/017).
 *
 * A real HTTP server is started on an ephemeral port and hit with fetch, so the router is
 * exercised exactly as the browser would. No extra dependency is needed: express and the
 * global fetch are already there.
 *
 * The browser UI itself is NOT covered here (see the report) — only the server contract the
 * page relies on: GET /debug/heroes and POST /debug/attack.
 */

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { CombatUnit } from '@de-jija/shared';

import { initCombatRules } from '../combat/combatRules';
import type { HeroModifiers } from '../combat/heroModifiers';
import { resolveAttack } from '../combat/resolveAttack';
import { initSkills } from '../combat/skills';
import { createDebugRouter } from './debugRoutes';

let server: Server;
let baseUrl = '';

beforeAll(async () => {
  initCombatRules(); // resolveAttack needs the balance rules in memory
  initSkills(); // GET /debug/heroes reads the skill data from memory

  const app = express();
  app.use('/debug', createDebugRouter());

  server = await new Promise<Server>((resolve) => {
    const started = app.listen(0, '127.0.0.1', () => resolve(started));
  });

  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/debug`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** The skill list as the browser receives it. */
type SkillDto = {
  id: string;
  name: string;
  levels: string[];
  affectsAttackNow: boolean;
};

/** Only the parts of the attack result these tests look at. */
type AttackResponse = {
  damageDealt: number;
  breakdown: {
    effectiveAttack: number;
    effectiveDefense: number;
    offenseSkillPercentApplied: number;
  };
  aggregatedModifiers?: { attacker: HeroModifiers; defender: HeroModifiers };
};

async function getJson(path: string): Promise<{ status: number; body: SkillDto[] }> {
  const response = await fetch(baseUrl + path);
  const body = (await response.json()) as SkillDto[];

  return { status: response.status, body };
}

async function postJson(
  path: string,
  payload: unknown,
): Promise<{ status: number; body: AttackResponse & { error?: string } }> {
  const response = await fetch(baseUrl + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = (await response.json()) as AttackResponse & { error?: string };

  return { status: response.status, body };
}

/** Plain melee units; the fixed damage roll keeps the result deterministic. */
const swordsman = {
  id: 'swordsman',
  name: 'Мечник',
  stats: { hp: 60, attack: 6, defense: 6, speed: 5, damageMin: 10, damageMax: 14 },
  tags: [],
  stackCount: 1,
  currentHp: 60,
};

const goblin = {
  id: 'goblin',
  name: 'Гоблин',
  stats: { hp: 50, attack: 4, defense: 3, speed: 5, damageMin: 8, damageMax: 12 },
  tags: [],
  stackCount: 1,
  currentHp: 50,
};

describe('GET /debug/heroes', () => {
  it('returns all 12 skills with a Russian name and three level descriptions', async () => {
    const { status, body } = await getJson('/heroes');

    expect(status).toBe(200);
    expect(body.length).toBe(12);

    const byId = new Map(body.map((skill) => [skill.id, skill]));

    expect(byId.get('offense')?.name).toBe('Нападение');
    expect(byId.get('offense')?.levels.length).toBe(3);
    expect(byId.get('fire_magic')?.levels.length).toBe(3);
  });

  it('affectsAttackNow is true exactly for offense, archery, armorer and luck', async () => {
    const { body } = await getJson('/heroes');

    const affecting = body.filter((skill) => skill.affectsAttackNow).map((skill) => skill.id).sort();

    expect(affecting).toEqual(['archery', 'armorer', 'luck', 'offense']);

    const NOT_affecting = [
      'leadership',
      'tactics',
      'sorcery',
      'resistance',
      'water_magic',
      'air_magic',
      'earth_magic',
      'fire_magic',
    ];

    for (const id of NOT_affecting) {
      const skill = body.find((item) => item.id === id);

      expect(skill, `skill ${id} must exist`).toBeDefined();
      expect(skill?.affectsAttackNow, `skill ${id} must not affect the attack`).toBe(false);
    }
  });
});

describe('POST /debug/attack', () => {
  it('without hero blocks it behaves exactly as before: no aggregatedModifiers', async () => {
    const context = { fixedRandomValue: 0 };

    const { status, body } = await postJson('/attack', {
      attacker: swordsman,
      defender: goblin,
      context,
    });
    const expected = resolveAttack(swordsman as CombatUnit, goblin as CombatUnit, {
      random: () => 0,
    });

    expect(status).toBe(200);
    expect(body.damageDealt).toBe(expected.damageDealt);
    expect(body.breakdown.effectiveAttack).toBe(expected.breakdown.effectiveAttack);
    expect(body.breakdown.effectiveDefense).toBe(expected.breakdown.effectiveDefense);
    // The old contract: the key only appears when a hero block was sent.
    expect('aggregatedModifiers' in body).toBe(false);
  });

  it('a manual heroAttackBonus and the hero attack ADD UP (decisions 017)', async () => {
    const { status, body } = await postJson('/attack', {
      attacker: swordsman,
      defender: goblin,
      context: { fixedRandomValue: 0, attackKind: 'melee', heroAttackBonus: 1 },
      attackerHero: {
        stats: { attack: 10, defense: 0, spellPower: 0, knowledge: 0 },
        skills: [{ skillId: 'offense', level: 3 }],
      },
    });

    expect(status).toBe(200);
    // unit attack 6 + manual 1 + hero 10
    expect(body.breakdown.effectiveAttack).toBe(17);
    expect(body.breakdown.offenseSkillPercentApplied).toBe(30);
    expect(body.aggregatedModifiers?.attacker.attackBonus).toBe(10);
    expect(body.aggregatedModifiers?.attacker.meleeOffenseBonusPercent).toBe(30);
  });

  it('a hero with skills that do not reach resolveAttack is accepted and reported', async () => {
    const { status, body } = await postJson('/attack', {
      attacker: swordsman,
      defender: goblin,
      context: { fixedRandomValue: 0 },
      defenderHero: {
        stats: { attack: 0, defense: 0, spellPower: 5, knowledge: 7 },
        skills: [
          { skillId: 'tactics', level: 3 },
          { skillId: 'sorcery', level: 2 },
        ],
      },
    });

    expect(status).toBe(200);
    expect(body.aggregatedModifiers?.defender.unused.tacticsRows).toBe(6);
    expect(body.aggregatedModifiers?.defender.unused.spellDamagePercent).toBe(20);
    expect(body.breakdown.effectiveDefense).toBe(3); // stored, but not applied
  });

  it('rejects a repeated skill with a readable 400 error', async () => {
    const { status, body } = await postJson('/attack', {
      attacker: swordsman,
      defender: goblin,
      context: { fixedRandomValue: 0 },
      attackerHero: {
        stats: { attack: 0, defense: 0, spellPower: 0, knowledge: 0 },
        skills: [
          { skillId: 'offense', level: 1 },
          { skillId: 'offense', level: 2 },
        ],
      },
    });

    expect(status).toBe(400);
    expect(body.error).toMatch(/дважды/);
  });

  it('rejects an unknown skill id with a readable 400 error', async () => {
    const { status, body } = await postJson('/attack', {
      attacker: swordsman,
      defender: goblin,
      context: { fixedRandomValue: 0 },
      attackerHero: {
        stats: { attack: 0, defense: 0, spellPower: 0, knowledge: 0 },
        skills: [{ skillId: 'not_a_skill', level: 1 }],
      },
    });

    expect(status).toBe(400);
    expect(body.error).toMatch(/Неизвестный навык/);
  });
});
