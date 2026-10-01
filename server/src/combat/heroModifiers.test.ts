/**
 * Tests for the hero modifier aggregator (docs/decisions.md, 016).
 *
 * These check the DATA -> formula bridge: a loadout (stats + skills) turns into one
 * aggregated object, clamped and validated, and then that object becomes an AttackContext
 * by ROLE (attack/offense/luck from the attacker's hero, defense/armor from the defender's).
 */

import { beforeAll, describe, expect, it } from 'vitest';

import {
  aggregateHeroModifiers,
  applyHeroModifiersToContext,
  emptyHeroModifiers,
  MAX_HERO_SKILLS,
  type HeroLoadout,
} from './heroModifiers';
import { initSkills, type SkillsData } from './skills';

let skills: SkillsData;

beforeAll(() => {
  skills = initSkills(); // loads the real config/skills.json
});

/** Zeros for a hero whose stats do not matter for a given test. */
const zeroStats = { attack: 0, defense: 0, spellPower: 0, knowledge: 0 };

/** A might hero: strong, with offense expert and armorer advanced. */
const mightHero: HeroLoadout = {
  stats: { attack: 10, defense: 10, spellPower: 1, knowledge: 1 },
  skills: [
    { skillId: 'offense', level: 3 },
    { skillId: 'armorer', level: 2 },
  ],
};

describe('aggregateHeroModifiers', () => {
  it('a missing loadout means "no hero": every modifier is 0', () => {
    const mods = aggregateHeroModifiers(null, skills);
    const zero = emptyHeroModifiers();

    // Every numeric modifier is 0; the only difference is the explanatory note.
    expect({ ...mods, notes: [] }).toEqual({ ...zero, notes: [] });
    expect(mods.attackBonus).toBe(0);
    expect(mods.unused).toEqual(zero.unused);
    expect(mods.notes.some((note) => note.includes('no hero loadout'))).toBe(true);
  });

  it('copies stats and transfers skill values for the chosen level', () => {
    const mods = aggregateHeroModifiers(mightHero, skills);

    expect(mods.attackBonus).toBe(10);
    expect(mods.defenseBonus).toBe(10);
    expect(mods.meleeOffenseBonusPercent).toBe(30); // offense expert
    expect(mods.defensiveArmorReductionPercent).toBe(10); // armorer advanced
    expect(mods.luckLevel).toBe(0);
    expect(mods.spellPower).toBe(1);
    expect(mods.knowledge).toBe(1);
    expect(mods.notes.some((note) => note.includes('meleeOffenseBonusPercent += 30'))).toBe(true);
  });

  it('accepts up to 6 skills and sums their effects', () => {
    const loadout: HeroLoadout = {
      stats: zeroStats,
      skills: [
        { skillId: 'offense', level: 3 }, // melee +30
        { skillId: 'archery', level: 1 }, // ranged +10
        { skillId: 'armorer', level: 1 }, // armor 5
        { skillId: 'luck', level: 2 }, // luck 2
        { skillId: 'leadership', level: 3 }, // morale 3
        { skillId: 'tactics', level: 1 }, // tacticsRows 4
      ],
    };

    expect(loadout.skills.length).toBe(MAX_HERO_SKILLS);
    const mods = aggregateHeroModifiers(loadout, skills);

    expect(mods.meleeOffenseBonusPercent).toBe(30);
    expect(mods.rangedOffenseBonusPercent).toBe(10);
    expect(mods.defensiveArmorReductionPercent).toBe(5);
    expect(mods.luckLevel).toBe(2);
    expect(mods.moraleLevel).toBe(3);
    expect(mods.unused.tacticsRows).toBe(4);
  });

  it('rejects more than 6 skills with a clear message', () => {
    const loadout: HeroLoadout = {
      stats: zeroStats,
      skills: [
        { skillId: 'offense', level: 1 },
        { skillId: 'archery', level: 1 },
        { skillId: 'armorer', level: 1 },
        { skillId: 'luck', level: 1 },
        { skillId: 'leadership', level: 1 },
        { skillId: 'tactics', level: 1 },
        { skillId: 'sorcery', level: 1 },
      ],
    };

    expect(() => aggregateHeroModifiers(loadout, skills)).toThrowError(/не больше 6 навыков/);
  });

  it('rejects a repeated skill', () => {
    const loadout: HeroLoadout = {
      stats: zeroStats,
      skills: [
        { skillId: 'offense', level: 1 },
        { skillId: 'offense', level: 2 },
      ],
    };

    expect(() => aggregateHeroModifiers(loadout, skills)).toThrowError(/дважды/);
  });

  it('rejects an unknown skill id', () => {
    const loadout: HeroLoadout = {
      stats: zeroStats,
      skills: [{ skillId: 'not_a_skill', level: 1 }],
    };

    expect(() => aggregateHeroModifiers(loadout, skills)).toThrowError(/Неизвестный навык/);
  });

  it.each([0, 4, 2.5])('rejects skill level %s', (level) => {
    const loadout = {
      stats: zeroStats,
      skills: [{ skillId: 'offense', level }],
    } as unknown as HeroLoadout;

    expect(() => aggregateHeroModifiers(loadout, skills)).toThrowError(/уровень должен быть 1, 2 или 3/);
  });

  it.each([
    ['negative', -1],
    ['fractional', 1.5],
  ])('rejects a %s hero stat', (_label, value) => {
    const loadout = {
      stats: { attack: value, defense: 0, spellPower: 0, knowledge: 0 },
      skills: [],
    } as unknown as HeroLoadout;

    expect(() => aggregateHeroModifiers(loadout, skills)).toThrowError(/stats.attack/);
  });
});

describe('level clamp (luck and morale stay inside -3..3)', () => {
  const bigLuck: SkillsData = {
    skills: [
      {
        id: 'luck_a',
        name: 'Удача A',
        levels: ['+4', '+4', '+4'],
        effects: [{ target: 'luckLevel', perLevel: [4, 4, 4] }],
      },
      {
        id: 'luck_b',
        name: 'Удача B',
        levels: ['+4', '+4', '+4'],
        effects: [{ target: 'luckLevel', perLevel: [4, 4, 4] }],
      },
    ],
  };

  it('clamps a luck total above 3 down to 3 and says so', () => {
    const mods = aggregateHeroModifiers(
      {
        stats: zeroStats,
        skills: [
          { skillId: 'luck_a', level: 1 },
          { skillId: 'luck_b', level: 1 },
        ],
      },
      bigLuck,
    );

    expect(mods.luckLevel).toBe(3);
    expect(mods.notes.some((note) => note.includes('luck level clamped'))).toBe(true);
  });

  it('clamps a morale total below -3 up to -3', () => {
    const badMorale: SkillsData = {
      skills: [
        {
          id: 'bad_morale',
          name: 'Плохая мораль',
          levels: ['-4', '-4', '-4'],
          effects: [{ target: 'moraleLevel', perLevel: [-4, -4, -4] }],
        },
      ],
    };

    const mods = aggregateHeroModifiers(
      { stats: zeroStats, skills: [{ skillId: 'bad_morale', level: 1 }] },
      badMorale,
    );

    expect(mods.moraleLevel).toBe(-3);
    expect(mods.unused.moraleLevel).toBe(-3);
    expect(mods.notes.some((note) => note.includes('morale level clamped'))).toBe(true);
  });
});

describe('aggregateHeroModifiers — values stored but not used yet', () => {
  it('reports spellPower, knowledge, tactics, morale, sorcery and resistance in `unused`', () => {
    const loadout: HeroLoadout = {
      stats: { attack: 0, defense: 0, spellPower: 10, knowledge: 7 },
      skills: [
        { skillId: 'tactics', level: 3 }, // tacticsRows 6
        { skillId: 'sorcery', level: 2 }, // spellDamagePercent 20
        { skillId: 'resistance', level: 1 }, // magicResistancePercent 5
        { skillId: 'leadership', level: 2 }, // moraleLevel 2
      ],
    };

    const mods = aggregateHeroModifiers(loadout, skills);

    expect(mods.unused).toEqual({
      tacticsRows: 6,
      spellDamagePercent: 20,
      magicResistancePercent: 5,
      moraleLevel: 2,
      spellPower: 10,
      knowledge: 7,
    });
    expect(mods.notes.some((note) => note.includes('tacticsRows=6'))).toBe(true);
    expect(mods.notes.some((note) => note.includes('spellDamagePercent=20'))).toBe(true);
    expect(mods.notes.some((note) => note.includes('moraleLevel=2'))).toBe(true);
  });
});

describe('applyHeroModifiersToContext', () => {
  const luckHero: HeroLoadout = {
    stats: zeroStats,
    skills: [{ skillId: 'luck', level: 2 }], // +2 luck
  };

  it('attack/offense/luck come from the attacker hero; defense/armor from the defender hero', () => {
    const attackerMods = aggregateHeroModifiers(mightHero, skills); // attack 10, offense 30, armor 10
    const defenderMods = aggregateHeroModifiers(
      {
        stats: { attack: 0, defense: 7, spellPower: 0, knowledge: 0 },
        skills: [{ skillId: 'armorer', level: 3 }],
      },
      skills,
    );

    const context = applyHeroModifiersToContext({ attackKind: 'melee' }, attackerMods, defenderMods);

    expect(context.heroAttackBonus).toBe(10);
    expect(context.heroDefenseBonus).toBe(7);
    expect(context.meleeOffenseBonusPercent).toBe(30);
    expect(context.rangedOffenseBonusPercent).toBe(0);
    expect(context.defensiveArmorReductionPercent).toBe(15); // the defender's armorer
    expect(context.attackKind).toBe('melee'); // base context kept
  });

  it('adds the attacker hero luck on top of the base context luck and clamps to 3', () => {
    const attackerMods = aggregateHeroModifiers(luckHero, skills); // +2 luck

    const context = applyHeroModifiersToContext(
      { luckBonus: 3 },
      attackerMods,
      emptyHeroModifiers(),
    );

    expect(context.luckBonus).toBe(3); // 3 + 2 clamped down to 3
  });

  it('a retaliation is the same call with the roles swapped', () => {
    const attackerMods = aggregateHeroModifiers(mightHero, skills); // attack 10, offense 30, armor 10
    const defenderMods = aggregateHeroModifiers(
      {
        stats: { attack: 3, defense: 4, spellPower: 0, knowledge: 0 },
        skills: [{ skillId: 'offense', level: 1 }],
      },
      skills,
    );

    const retaliationContext = applyHeroModifiersToContext(
      { isRetaliation: true },
      defenderMods,
      attackerMods,
    );

    // The original defender now answers: ITS hero provides attack/offense, the other hero defends.
    expect(retaliationContext.heroAttackBonus).toBe(3);
    expect(retaliationContext.meleeOffenseBonusPercent).toBe(10);
    expect(retaliationContext.heroDefenseBonus).toBe(10);
    expect(retaliationContext.defensiveArmorReductionPercent).toBe(10);
    expect(retaliationContext.isRetaliation).toBe(true);
  });
});
