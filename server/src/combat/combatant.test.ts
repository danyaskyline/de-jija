/**
 * Tests for combatant assembly (docs/decisions.md, 018).
 *
 * buildCombatant is the ONLY place where bonuses are collected: hero + extra
 * sources -> a COPY of the unit with a filled `bonuses`. These tests pin the
 * stacking rules (adding vs multiplying, one luck clamp) and prove the input
 * unit is never modified.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import type { CombatBonuses, CombatUnit } from '@de-jija/shared';

import { buildCombatant, combinePercentBonuses, emptyCombatBonuses } from './combatant';
import {
  aggregateHeroModifiers,
  emptyHeroModifiers,
  type HeroLoadout,
  type HeroModifiers,
} from './heroModifiers';
import { initSkills, type SkillsData } from './skills';
import { swordsman } from './testFixtures';

let skills: SkillsData;

beforeAll(() => {
  skills = initSkills(); // loads the real config/skills.json
});

const zeroStats = { attack: 0, defense: 0, spellPower: 0, knowledge: 0 };

/** A might hero: attack 10, defense 10, offense expert (+30%), armorer advanced (+10%). */
const mightHero: HeroLoadout = {
  stats: { attack: 10, defense: 10, spellPower: 1, knowledge: 1 },
  skills: [
    { skillId: 'offense', level: 3 },
    { skillId: 'armorer', level: 2 },
  ],
};

/** A hero whose only interesting value is a hand-made one (no skills.json needed). */
function fakeHero(partial: Partial<HeroModifiers>): HeroModifiers {
  return { ...emptyHeroModifiers(), ...partial };
}

describe('buildCombatant', () => {
  it('without a hero every bonus is 0', () => {
    const combatant = buildCombatant(swordsman, null);

    expect(combatant.bonuses).toEqual(emptyCombatBonuses());
  });

  it('takes the hero values by same-named field', () => {
    const hero = aggregateHeroModifiers(mightHero, skills); // attack 10, defense 10, melee 30, armor 10
    const combatant = buildCombatant(swordsman, hero);

    expect(combatant.bonuses).toEqual({
      attackBonus: 10,
      defenseBonus: 10,
      meleeOffenseBonusPercent: 30,
      rangedOffenseBonusPercent: 0,
      defensiveArmorReductionPercent: 10,
      luckLevel: 0,
      flatDamageBonus: 0,
      percentDamageBonus: 0,
      magicOffenseBonusPercent: 0,
    });
  });

  it('keeps the flat points and the flat damage as they are', () => {
    const combatant = buildCombatant(swordsman, null, {
      attackBonus: 3,
      defenseBonus: 4,
      flatDamageBonus: 7,
      meleeOffenseBonusPercent: 10,
      rangedOffenseBonusPercent: 20,
      defensiveArmorReductionPercent: 5,
    });

    expect(combatant.bonuses?.attackBonus).toBe(3);
    expect(combatant.bonuses?.defenseBonus).toBe(4);
    expect(combatant.bonuses?.flatDamageBonus).toBe(7);
    expect(combatant.bonuses?.meleeOffenseBonusPercent).toBe(10);
    expect(combatant.bonuses?.rangedOffenseBonusPercent).toBe(20);
    expect(combatant.bonuses?.defensiveArmorReductionPercent).toBe(5);
  });

  it('two percent damage bonuses of 10% multiply into 21%, not 20%', () => {
    // The hero has no percent-damage source yet (it comes with items), so the rule itself
    // is pinned on the helper and then through buildCombatant.
    expect(combinePercentBonuses(10, 10)).toBeCloseTo(21);
    expect(combinePercentBonuses(10, 10)).not.toBeCloseTo(20);

    const combatant = buildCombatant(swordsman, null, { percentDamageBonus: 10 });

    expect(combatant.bonuses?.percentDamageBonus).toBeCloseTo(10);
  });

  it('sums the luck of both sources and clamps the total to +/-3 with a note', () => {
    const hero = fakeHero({ luckLevel: 2 });
    const combatant = buildCombatant(swordsman, hero, { luckLevel: 3 });

    expect(combatant.bonuses?.luckLevel).toBe(3);
    expect(hero.notes.some((note) => note.includes('luck level clamped from 5 to 3'))).toBe(true);
  });

  it('clamps a negative luck total too', () => {
    const combatant = buildCombatant(swordsman, fakeHero({ luckLevel: -1 }), { luckLevel: -3 });

    expect(combatant.bonuses?.luckLevel).toBe(-3);
  });

  it('never mutates the unit it was given', () => {
    const before = structuredClone(swordsman);
    const combatant = buildCombatant(swordsman, aggregateHeroModifiers(mightHero, skills));

    expect(swordsman).toEqual(before);
    expect(swordsman.bonuses).toBeUndefined();
    expect(combatant).not.toBe(swordsman);
  });

  it('adds the hero bonuses and the extra bonuses instead of replacing them', () => {
    const hero = fakeHero({ attackBonus: 10, defenseBonus: 7, meleeOffenseBonusPercent: 30 });
    const combatant = buildCombatant(swordsman, hero, {
      attackBonus: 1,
      defenseBonus: 2,
      meleeOffenseBonusPercent: 3,
    });

    expect(combatant.bonuses?.attackBonus).toBe(11);
    expect(combatant.bonuses?.defenseBonus).toBe(9);
    expect(combatant.bonuses?.meleeOffenseBonusPercent).toBe(33);
  });

  it('a missing field in the extra bonuses counts as 0', () => {
    const combatant = buildCombatant(swordsman, fakeHero({ attackBonus: 10 }));

    expect(combatant.bonuses?.attackBonus).toBe(10);
  });

  it('two combatants are built independently — the answering one brings its own bonuses', () => {
    // A retaliation is the same build with the roles swapped, so each combatant only
    // ever sees ITS OWN hero and extras — never the opponent's.
    const attacker = buildCombatant(swordsman, aggregateHeroModifiers(mightHero, skills));
    const defender = buildCombatant(
      { ...swordsman, id: 'goblin', stats: { ...swordsman.stats, attack: 4, defense: 3 } },
      fakeHero({ attackBonus: 4, meleeOffenseBonusPercent: 10 }),
    );
    const retaliation = buildCombatant(defender, fakeHero({ attackBonus: 4 }), {
      meleeOffenseBonusPercent: 5,
    });

    // Original attacker: attack 10, offense 30, armor 10 (the might hero).
    expect(attacker.bonuses?.attackBonus).toBe(10);
    expect(attacker.bonuses?.meleeOffenseBonusPercent).toBe(30);

    // The answering combatant is built from ITS OWN hero (attack 4, no offense skill)
    // plus the extra source (+5 offense) — and nothing of the opponent.
    expect(retaliation.bonuses?.attackBonus).toBe(4);
    expect(retaliation.bonuses?.meleeOffenseBonusPercent).toBe(5);
    expect(retaliation.bonuses?.defensiveArmorReductionPercent).toBe(0);
  });

  it('the produced object is a full CombatUnit with every bonus field filled', () => {
    const combatant: CombatUnit = buildCombatant(swordsman, null);
    const bonuses = combatant.bonuses as Partial<CombatBonuses>;

    for (const field of Object.keys(emptyCombatBonuses()) as (keyof CombatBonuses)[]) {
      expect(typeof bonuses[field], field).toBe('number');
    }
  });
});