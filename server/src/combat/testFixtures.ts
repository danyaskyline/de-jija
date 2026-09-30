/**
 * TEST-ONLY unit fixtures.
 *
 * Single source of truth for both:
 *   - the unit tests (resolveAttack.test.ts),
 *   - the preset dropdown of the combat sandbox (GET /debug/fixtures).
 *
 * These are NOT game content. Real units will live as DATA (JSON files / DB rows)
 * and be read by id, never hardcoded in the code
 * (docs/conventions.md, "Данные vs код").
 */

import type { AbilityTag, CombatUnit, UnitStats } from '@de-jija/shared';

/** A ready-made unit used by tests and by the sandbox preset list. */
export type CombatFixture = {
  id: string;
  name: string;
  /** Group for the preset dropdown ("Ближний бой", "Магия", ...). */
  category: string;
  stats: UnitStats;
  tags: AbilityTag[];
  stackCount: number;
  /** Optional luck level for the sandbox presets (0 = no luck, the common case). */
  luckLevel?: number;
};

/** All fixtures in one place. */
export const combatFixtures: CombatFixture[] = [
  {
    id: 'antimage',
    name: 'Антимаг (ап)',
    category: 'Ближний бой',
    stats: { hp: 90, attack: 12, defense: 8, speed: 5, damageMin: 40, damageMax: 60 },
    tags: ['NoRetaliation', 'AreaAttack'],
    stackCount: 1,
  },
  {
    id: 'swordsman',
    name: 'Мечник',
    category: 'Ближний бой',
    stats: { hp: 60, attack: 6, defense: 6, speed: 5, damageMin: 10, damageMax: 14 },
    tags: [],
    stackCount: 1,
  },
  {
    id: 'goblin',
    name: 'Гоблин',
    category: 'Ближний бой',
    stats: { hp: 50, attack: 4, defense: 3, speed: 5, damageMin: 8, damageMax: 12 },
    tags: [],
    stackCount: 1,
  },
  {
    id: 'mage',
    name: 'Маг',
    category: 'Магия',
    stats: { hp: 70, attack: 10, defense: 6, speed: 5, damageMin: 20, damageMax: 30 },
    tags: ['MagicDamage'],
    stackCount: 1,
  },
  {
    id: 'black_dragon',
    name: 'Чёрный дракон',
    category: 'Магия',
    stats: { hp: 200, attack: 15, defense: 12, speed: 5, damageMin: 30, damageMax: 45 },
    tags: ['MagicImmune'],
    stackCount: 1,
  },
];

/** Finds a fixture by id (throws — a typo must not silently produce an empty unit). */
export function getFixture(id: string): CombatFixture {
  const fixture = combatFixtures.find((item) => item.id === id);

  if (!fixture) {
    throw new Error(`Не найден тестовый юнит с id "${id}"`);
  }

  return fixture;
}

/**
 * Turns a fixture into a CombatUnit.
 * currentHp is the pool of the whole stack: stats.hp * stackCount by default.
 */
export function fixtureToUnit(fixture: CombatFixture, currentHp?: number): CombatUnit {
  return {
    id: fixture.id,
    name: fixture.name,
    stats: fixture.stats,
    tags: fixture.tags,
    currentHp: currentHp ?? fixture.stats.hp * fixture.stackCount,
    stackCount: fixture.stackCount,
  };
}

function fixtureUnit(id: string): CombatUnit {
  return fixtureToUnit(getFixture(id));
}

export const antimage = fixtureUnit('antimage');
export const swordsman = fixtureUnit('swordsman');
export const goblin = fixtureUnit('goblin');
export const mage = fixtureUnit('mage');
export const blackDragon = fixtureUnit('black_dragon');