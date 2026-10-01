/**
 * Unit tests for resolveAttack — the pure combat resolution function.
 *
 * docs/architecture.md requires exactly this: the damage formula must be
 * "покрыта юнит-тестами на конкретных парах юнитов". No map, no hex field and no
 * PixiJS is involved anywhere in this file.
 *
 * The real config/combat-rules.json is loaded once in beforeAll, so these tests also
 * prove that the balance file parses and validates. Damage is deterministic because
 * every test injects a fixed random source:
 *   minRoll (0)     -> the smallest roll (damageMin)
 *   maxRoll (0.999) -> the largest roll  (damageMax)
 *
 * NOTE for the author: the expected numbers below are the arithmetic for the CURRENT
 * values in config/combat-rules.json (+5% per attack point, 400% cap, -2.5% per
 * defense point, 30% floor = the original HoMM3, luck 10/25/40%, x1.5 and x0.75,
 * x0.8 morale extra attack, minimum damage 1). If the balance file is tuned, some
 * numbers here will move with it — that is expected. Test 14 proves that the
 * coefficients really come from the rules object and not from the code.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import type { CombatUnit } from '@de-jija/shared';

import { getCombatRules, initCombatRules, type CombatRules } from './combatRules';
import { clampLuckLevel, resolveAttack, roundDamage } from './resolveAttack';
import { antimage, blackDragon, goblin, mage, swordsman } from './testFixtures';

/** Smallest possible damage roll (damageMin). */
const minRoll = (): number => 0;
/** Largest possible damage roll (damageMax). */
const maxRoll = (): number => 0.999;

/** The minimum damage is balance data now: it comes from config/combat-rules.json. */
let MIN_DAMAGE = 1;

/** Same rules as the real config, but with the "sampled" roll mode forced on. */
let sampledRules: CombatRules;

beforeAll(() => {
  initCombatRules(); // loads the real config/combat-rules.json (a config smoke test too)
  MIN_DAMAGE = getCombatRules().minimumDamage;
  sampledRules = { ...getCombatRules(), damageRollMode: 'sampled' };
});

/** Copy of a unit with changed stats, so the tests stay short and readable. */
function withStats(unit: CombatUnit, partial: Partial<CombatUnit['stats']>): CombatUnit {
  return { ...unit, stats: { ...unit.stats, ...partial } };
}

/** Copy of a unit with a changed luck level. */
function withLuck(unit: CombatUnit, luckLevel: number): CombatUnit {
  return { ...unit, luckLevel };
}

describe('resolveAttack — pure combat resolution', () => {
  it('1. antimage attacks the dragon: physical hit lands, no retaliation (NoRetaliation)', () => {
    const result = resolveAttack(antimage, blackDragon, { random: minRoll });

    // attack 12 vs defense 12 -> multiplier 1; roll 40 per unit, stack of 1
    expect(result.blockedByImmunity).toBe(false);
    expect(result.breakdown.attackDefenseMultiplier).toBe(1);
    expect(result.breakdown.stackRoll).toBe(40);
    expect(result.damageDealt).toBe(40);
    expect(result.defenderHpAfter).toBe(blackDragon.stats.hp - 40);
    expect(result.stackAliveCount).toBe(1);
    expect(result.frontUnitHp).toBe(blackDragon.stats.hp - 40);
    // The antimage carries NoRetaliation, so the dragon never hits back.
    expect(result.retaliationTriggered).toBe(false);

    expect(result.notes).toContain('attack type: physical');
    expect(result.notes).toContain(
      'AreaAttack: requires hex positioning, not implemented in this pure-function stage',
    );
  });

  it('2. mage (MagicDamage) attacks the dragon: MagicImmune blocks it completely', () => {
    const result = resolveAttack(mage, blackDragon, { random: minRoll });

    expect(result.blockedByImmunity).toBe(true);
    expect(result.damageDealt).toBe(0);
    expect(result.defenderHpAfter).toBe(blackDragon.currentHp);
    expect(result.notes).toContain(
      'MagicImmune on Чёрный дракон: magical attack fully blocked, damage 0',
    );

    // Nothing was rolled, so every step is zero (neutral multipliers stay 1).
    expect(result.breakdown.stackRoll).toBe(0);
    expect(result.breakdown.attackDefenseMultiplier).toBe(0);
    expect(result.breakdown.moraleMultiplier).toBe(1);
    expect(result.breakdown.finalDamage).toBe(0);

    // The retaliation rule is applied uniformly to every attack, blocked or not
    // (docs/decisions.md, 011).
    expect(result.retaliationTriggered).toBe(true);
  });

  it('2b. even the largest roll is blocked, so immunity cannot be bypassed by luck', () => {
    const result = resolveAttack(mage, blackDragon, { random: maxRoll });

    expect(result.damageDealt).toBe(0);
    expect(result.blockedByImmunity).toBe(true);
  });

  it('3. dragon attacks the antimage: attack advantage x1.35 applies', () => {
    const result = resolveAttack(blackDragon, antimage, { random: minRoll });

    // attack 15 vs defense 8 -> 1 + 0.05*7 = 1.35; roll 30 -> 40.5 -> round half up 41
    expect(result.blockedByImmunity).toBe(false);
    expect(result.breakdown.attackDefenseMultiplier).toBeCloseTo(1.35);
    expect(result.breakdown.afterAttackDefense).toBeCloseTo(40.5);
    expect(result.damageDealt).toBe(41);
    expect(result.retaliationTriggered).toBe(true);
  });

  it('3b. a retaliation is a full attack: no special weakening, and no counter-counter', () => {
    // The antimage answers the dragon. The call goes through the whole formula again —
    // there is no global "retaliation is weaker" coefficient.
    const result = resolveAttack(antimage, blackDragon, { isRetaliation: true, random: minRoll });

    expect(result.blockedByImmunity).toBe(false);
    expect(result.damageDealt).toBe(40); // exactly the same as a normal attack
    expect(result.retaliationTriggered).toBe(false); // isRetaliation: no counter-counter
  });

  it('4. plain exchange with no special tags: damage is dealt and retaliation is triggered', () => {
    const result = resolveAttack(swordsman, goblin, { random: minRoll });

    // attack 6 vs defense 3 -> 1 + 0.05*3 = 1.15; roll 10 -> 11.5 -> round half up 12
    expect(result.breakdown.attackDefenseMultiplier).toBeCloseTo(1.15);
    expect(result.damageDealt).toBe(12);
    expect(result.blockedByImmunity).toBe(false);
    expect(result.retaliationTriggered).toBe(true);
  });

  it('5. the stack roll covers the whole damageMin..damageMax range', () => {
    const lowest = resolveAttack(swordsman, goblin, { random: minRoll });
    const highest = resolveAttack(swordsman, goblin, { random: maxRoll });

    expect(lowest.breakdown.stackRoll).toBe(swordsman.stats.damageMin); // 10
    expect(highest.breakdown.stackRoll).toBe(swordsman.stats.damageMax); // 14
    expect(lowest.damageDealt).toBe(12); // 10 * 1.15 = 11.5 -> round half up 12
    expect(highest.damageDealt).toBe(16); // 14 * 1.15 = 16.1 -> 16
  });

  it('6. the roll scales with stackCount; an omitted stackCount means a stack of 1', () => {
    const single: CombatUnit = antimage; // no stackCount -> 1
    const triple: CombatUnit = { ...antimage, stackCount: 3 };

    const singleHit = resolveAttack(single, blackDragon, { random: minRoll });
    const tripleHit = resolveAttack(triple, blackDragon, { random: minRoll });

    expect(singleHit.breakdown.stackRoll).toBe(40);
    expect(tripleHit.breakdown.stackRoll).toBe(120); // 40 per unit * 3
    expect(tripleHit.damageDealt).toBe(120);
    expect(tripleHit.defenderHpAfter).toBe(blackDragon.stats.hp - 120);
  });

  it('7. damage never falls below MIN_DAMAGE, even with the weakest possible attacker', () => {
    // attack 1 vs defense 12 -> 1 - 0.025*11 = 0.725 (the 30% floor is NOT reached);
    // roll 1 -> 0.725 -> floor 0 -> clamped up to the minimum.
    const weakling = withStats(swordsman, { attack: 1, damageMin: 1, damageMax: 1 });
    const result = resolveAttack(weakling, blackDragon, { random: minRoll });

    expect(result.breakdown.attackDefenseMultiplier).toBeCloseTo(0.725);
    expect(result.damageDealt).toBe(MIN_DAMAGE);
    expect(
      result.notes.some((note) => note.startsWith('damage clamped up to minimumDamage')),
    ).toBe(true);
    // 0.725 is above the floor, so the "floored" note must NOT appear here.
    expect(result.notes.some((note) => note.includes('defense penalty is floored'))).toBe(false);
  });

  it('8. flatDamageBonus is applied BEFORE the multiplier and percentDamageBonus AFTER it', () => {
    const result = resolveAttack(swordsman, goblin, {
      random: minRoll,
      flatDamageBonus: 4,
      percentDamageBonus: 50,
    });

    // roll 10 -> +4 = 14 -> *1.15 = 16.1 -> *1.5 = 24.15 -> floor 24
    expect(result.breakdown.stackRoll).toBe(10);
    expect(result.breakdown.flatBonusApplied).toBe(4);
    expect(result.breakdown.afterFlatBonus).toBe(14);
    expect(result.breakdown.afterAttackDefense).toBeCloseTo(16.1);
    expect(result.breakdown.percentBonusApplied).toBe(50);
    expect(result.breakdown.afterPercentBonus).toBeCloseTo(24.15);
    expect(result.damageDealt).toBe(24);

    // If the order were reversed the result would be ((10 * 1.5) + 4) * 1.15 = 21.
    expect(result.damageDealt).not.toBe(21);
  });

  it('9. a huge attack advantage is capped (attackAdvantageCapPercent = 400 -> x4)', () => {
    const strongAttacker = withStats(swordsman, { attack: 200 });
    const result = resolveAttack(strongAttacker, goblin, { random: minRoll });

    expect(result.breakdown.attackDefenseMultiplier).toBe(4); // 400 / 100
    expect(result.damageDealt).toBe(40); // roll 10 * 4
    expect(result.notes.some((note) => note.includes('attack advantage is capped at x4'))).toBe(true);
  });

  it('10. a huge defense advantage stops at the 30% floor (the original HoMM3 value)', () => {
    const weakAttacker = withStats(goblin, { attack: 1 });
    const veryArmoredDefender = withStats(blackDragon, { defense: 500 });
    const result = resolveAttack(weakAttacker, veryArmoredDefender, { random: minRoll });

    expect(result.breakdown.attackDefenseMultiplier).toBeCloseTo(0.3); // 30 / 100
    expect(result.damageDealt).toBe(2); // roll 8 * 0.3 = 2.4 -> floor 2
    expect(result.notes.some((note) => note.includes('defense penalty is floored at x0.3'))).toBe(
      true,
    );
  });

  it('11. luck is a CHANCE: luckLevel 2 with a roll inside the 25% window triggers x1.5', () => {
    const lucky = withLuck(swordsman, 2);
    const result = resolveAttack(lucky, goblin, { random: minRoll, fixedLuckRoll: 0.1 });

    expect(result.breakdown.luckLevel).toBe(2);
    expect(result.breakdown.luckTriggerChancePercent).toBe(25);
    expect(result.breakdown.luckTriggered).toBe(true);
    expect(result.breakdown.luckMultiplierApplied).toBe(1.5);
    expect(result.breakdown.afterLuck).toBeCloseTo(17.25); // 11.5 * 1.5
    expect(result.damageDealt).toBe(17);
    expect(result.notes.some((note) => note.includes('luck bonus triggered'))).toBe(true);
  });

  it('11b. the same luckLevel does NOT trigger when the roll is outside the chance', () => {
    const unlucky = withLuck(swordsman, -3);
    const result = resolveAttack(unlucky, goblin, { random: minRoll, fixedLuckRoll: 0.9 });

    expect(result.breakdown.luckTriggerChancePercent).toBe(40);
    expect(result.breakdown.luckTriggered).toBe(false);
    expect(result.breakdown.luckMultiplierApplied).toBe(1);
    expect(result.damageDealt).toBe(12); // 10 * 1.15 = 11.5 -> round half up
    expect(result.notes.some((note) => note.includes('luck did not trigger'))).toBe(true);
  });

  it('11c. negative luck that triggers applies x0.75', () => {
    const unlucky = withLuck(swordsman, -2);
    const result = resolveAttack(unlucky, goblin, { random: minRoll, fixedLuckRoll: 0.2 }); // 25%

    expect(result.breakdown.luckTriggered).toBe(true);
    expect(result.breakdown.luckMultiplierApplied).toBe(0.75);
    expect(result.damageDealt).toBe(9); // 11.5 * 0.75 = 8.625 -> round half up 9
    expect(result.notes.some((note) => note.includes('luck malus triggered'))).toBe(true);
  });

  it('11d. luckLevel 0 never triggers, whatever the roll is', () => {
    const result = resolveAttack(swordsman, goblin, { random: minRoll, fixedLuckRoll: 0 });

    expect(result.breakdown.luckLevel).toBe(0);
    expect(result.breakdown.luckTriggerChancePercent).toBe(0);
    expect(result.breakdown.luckTriggered).toBe(false);
    expect(result.breakdown.luckMultiplierApplied).toBe(1);
    expect(result.damageDealt).toBe(12);
    expect(result.notes).toContain('no luck: luckLevel is 0');
  });

  it('11e. without fixedLuckRoll the luck roll uses the same random source as the damage roll', () => {
    const lucky = withLuck(swordsman, 3);
    const result = resolveAttack(lucky, goblin, { random: () => 0.1 });

    // damage roll: 10 + floor(0.1 * 5) = 10; luck roll 0.1 < 0.4 -> triggers
    expect(result.breakdown.stackRoll).toBe(10);
    expect(result.breakdown.luckTriggered).toBe(true);
    expect(result.damageDealt).toBe(17); // 10 * 1.15 = 11.5, * 1.5 = 17.25 -> 17
  });

  it('12. morale only touches a hit that IS a morale extra attack', () => {
    const ordinary = resolveAttack(swordsman, goblin, { random: minRoll });
    const moraleHit = resolveAttack(swordsman, goblin, {
      random: minRoll,
      isMoraleBonusAttack: true,
    });

    // An ordinary attack has no morale modifier at all (morale is a turn-order system).
    expect(ordinary.breakdown.moraleBonusAttackApplied).toBe(false);
    expect(ordinary.breakdown.moraleMultiplier).toBe(1);
    expect(ordinary.damageDealt).toBe(12);

    expect(moraleHit.breakdown.moraleBonusAttackApplied).toBe(true);
    expect(moraleHit.breakdown.moraleMultiplier).toBe(0.8);
    expect(moraleHit.breakdown.afterMoraleBonus).toBeCloseTo(9.2); // 11.5 * 0.8
    expect(moraleHit.damageDealt).toBe(9);
    expect(moraleHit.notes.some((note) => note.includes('morale extra attack'))).toBe(true);
  });

  it('13. breakdown is complete and logically consistent for a fully modified attack', () => {
    const result = resolveAttack(mage, swordsman, {
      random: minRoll,
      flatDamageBonus: 2,
      percentDamageBonus: 10,
      isMoraleBonusAttack: true,
    });
    const { breakdown } = result;

    // Every step must be present (and be a finite number).
    expect(Object.keys(breakdown).sort()).toEqual([
      'afterArmor',
      'afterAttackDefense',
      'afterFlatBonus',
      'afterLuck',
      'afterMoraleBonus',
      'afterOffenseSkill',
      'afterPercentBonus',
      'armorReductionApplied',
      'attackDefenseMultiplier',
      'effectiveAttack',
      'effectiveDefense',
      'finalDamage',
      'flatBonusApplied',
      'luckLevel',
      'luckMultiplierApplied',
      'luckTriggerChancePercent',
      'luckTriggered',
      'moraleBonusAttackApplied',
      'moraleMultiplier',
      'offenseSkillPercentApplied',
      'percentBonusApplied',
      'stackRoll',
    ]);
    for (const [name, value] of Object.entries(breakdown)) {
      if (typeof value === 'number') {
        expect(Number.isFinite(value), `${name} is not a finite number`).toBe(true);
      }
    }
    // The two flags in the breakdown must really be booleans.
    expect(typeof breakdown.luckTriggered).toBe('boolean');
    expect(typeof breakdown.moraleBonusAttackApplied).toBe('boolean');

    // Each step must follow from the previous one.
    expect(breakdown.stackRoll).toBe(20);
    expect(breakdown.afterFlatBonus).toBe(breakdown.stackRoll + breakdown.flatBonusApplied); // 22
    expect(breakdown.afterAttackDefense).toBeCloseTo(
      breakdown.afterFlatBonus * breakdown.attackDefenseMultiplier,
    ); // 26.4
    expect(breakdown.afterPercentBonus).toBeCloseTo(
      breakdown.afterAttackDefense * (1 + breakdown.percentBonusApplied / 100),
    ); // 29.04
    expect(breakdown.afterLuck).toBeCloseTo(
      breakdown.afterPercentBonus * breakdown.luckMultiplierApplied,
    ); // luckLevel 0 -> x1
    expect(breakdown.afterMoraleBonus).toBeCloseTo(
      breakdown.afterLuck * breakdown.moraleMultiplier,
    ); // 29.04 * 0.8 = 23.232
    expect(breakdown.finalDamage).toBe(
      Math.max(MIN_DAMAGE, roundDamage(breakdown.afterMoraleBonus)),
    ); // 23.232 -> 23
    expect(result.damageDealt).toBe(breakdown.finalDamage);
  });

  it('14. coefficients really come from the injected rules (nothing is hardcoded)', () => {
    const customRules: CombatRules = {
      ...getCombatRules(),
      attackAdvantagePercentPerPoint: 10,
      attackAdvantageCapPercent: 200,
      defensePenaltyPercentPerPoint: 5,
      defensePenaltyFloorPercent: 50,
      moraleBonusAttackMultiplier: 0.5,
    };

    // attack 15 vs defense 8 -> 1 + 0.10*7 = 1.7 (with the default rules it would be 1.35)
    const stronger = resolveAttack(blackDragon, antimage, { random: minRoll }, customRules);
    expect(stronger.breakdown.attackDefenseMultiplier).toBeCloseTo(1.7);
    expect(stronger.damageDealt).toBe(51); // 30 * 1.7

    // Custom floor of 50% instead of the default 30%.
    const weakling = withStats(swordsman, { attack: 1 });
    const floored = resolveAttack(weakling, blackDragon, { random: minRoll }, customRules);
    expect(floored.breakdown.attackDefenseMultiplier).toBeCloseTo(0.5);

    // Custom morale multiplier for a morale extra attack.
    const moraleHit = resolveAttack(
      swordsman,
      goblin,
      { random: minRoll, isMoraleBonusAttack: true },
      customRules,
    );
    expect(moraleHit.breakdown.moraleMultiplier).toBe(0.5);
    // With the custom +10% per point the multiplier is 1.3, not the default 1.15:
    // roll 10 * 1.3 = 13, then * 0.5 = 6.5 -> round half up 7
    expect(moraleHit.damageDealt).toBe(7);
  });

  it('15. magicOffenseBonusPercent is still a placeholder; melee/ranged/armor now apply', () => {
    // Magic mastery is the ONLY remaining placeholder: reported, never applied.
    const withMagicStub = resolveAttack(swordsman, goblin, {
      random: minRoll,
      magicOffenseBonusPercent: 30,
    });
    const plainAttack = resolveAttack(swordsman, goblin, { random: minRoll });

    expect(withMagicStub.damageDealt).toBe(plainAttack.damageDealt);
    expect(withMagicStub.breakdown).toEqual(plainAttack.breakdown);
    expect(
      withMagicStub.notes.filter((note) => note.includes('is a placeholder')).length,
    ).toBe(1);
    expect(
      withMagicStub.notes.some((note) => note.includes('magicOffenseBonusPercent=30')),
    ).toBe(true);

    // ...whereas the offense skill and armor are real now (see their dedicated tests).
    const withOffense = resolveAttack(swordsman, goblin, {
      random: minRoll,
      meleeOffenseBonusPercent: 30,
      defensiveArmorReductionPercent: 10,
    });
    expect(withOffense.breakdown.offenseSkillPercentApplied).toBe(30);
    expect(withOffense.breakdown.armorReductionApplied).toBe(10);
    expect(withOffense.damageDealt).not.toBe(plainAttack.damageDealt);
  });

  it('16. declared-but-unimplemented abilities are reported instead of silently ignored', () => {
    const piercer: CombatUnit = { ...swordsman, tags: ['Piercing'] };
    const result = resolveAttack(piercer, goblin, { random: minRoll });

    expect(result.notes.some((note) => note.startsWith('Piercing: not implemented'))).toBe(true);
  });

  it('17. a retaliation does not provoke another retaliation (no endless chain)', () => {
    const result = resolveAttack(swordsman, goblin, { isRetaliation: true, random: minRoll });

    expect(result.retaliationTriggered).toBe(false);
  });

  it('18. a defender killed by the hit cannot retaliate, and its HP is clamped to 0', () => {
    const weakenedGoblin: CombatUnit = { ...goblin, currentHp: 5 };
    const result = resolveAttack(swordsman, weakenedGoblin, { random: minRoll }); // 11 damage vs 5 hp

    expect(result.defenderHpAfter).toBe(0); // never negative
    expect(result.stackAliveCount).toBe(0);
    expect(result.frontUnitHp).toBe(0);
    expect(result.defenderDefeated).toBe(true);
    expect(result.retaliationTriggered).toBe(false);
  });

  it('18b. overkill damage far above the total HP stays at 0 and still stops the retaliation', () => {
    // 5 dragons (roll 30 * 5 = 150) vs a goblin: attack 15 vs defense 3 -> x1.6 -> 240 damage
    // against 50 HP. The raw difference is -190 — that is the value that used to leak out.
    const dragonStack: CombatUnit = { ...blackDragon, stackCount: 5, currentHp: 1000 };
    const result = resolveAttack(dragonStack, goblin, { random: minRoll });

    expect(result.breakdown.stackRoll).toBe(150);
    expect(result.damageDealt).toBe(240);
    expect(result.defenderHpAfter).toBe(0); // clamped, not -190
    expect(result.stackAliveCount).toBe(0);
    expect(result.frontUnitHp).toBe(0);
    expect(result.defenderDefeated).toBe(true);
    // The dragon has no NoRetaliation, so only defenderDefeated stops the retaliation.
    expect(result.retaliationTriggered).toBe(false);
    expect(result.notes.some((note) => note.includes('the stack is destroyed'))).toBe(true);
  });

  it('19. the function does not mutate its inputs (it is pure)', () => {
    const attackerBefore = structuredClone(antimage);
    const defenderBefore = structuredClone(blackDragon);

    resolveAttack(antimage, blackDragon, { random: minRoll });

    expect(antimage).toEqual(attackerBefore);
    expect(blackDragon).toEqual(defenderBefore);
  });

  it('20. stack HP pool: 5 units of 200 HP (pool 1000), damage 300 -> 4 alive, front unit 100 HP', () => {
    const bigStack: CombatUnit = { ...blackDragon, stackCount: 5, currentHp: 1000 }; // 200 * 5
    // Fixed roll of 100 per unit; attack 12 vs defense 12 -> multiplier exactly x1.0.
    const attacker: CombatUnit = {
      ...withStats(antimage, { attack: 12, damageMin: 100, damageMax: 100 }),
      stackCount: 3,
    };

    const result = resolveAttack(attacker, bigStack, { random: minRoll });

    expect(result.damageDealt).toBe(300);
    expect(result.defenderHpAfter).toBe(700); // the pool
    expect(result.stackAliveCount).toBe(4); // ceil(700 / 200)
    expect(result.frontUnitHp).toBe(100); // 700 - 3 * 200
    expect(result.defenderDefeated).toBe(false);
  });

  it('21. the same stack, damage 950 -> 1 unit alive with 50 HP left', () => {
    const bigStack: CombatUnit = { ...blackDragon, stackCount: 5, currentHp: 1000 };
    const attacker: CombatUnit = {
      ...withStats(antimage, { attack: 12, damageMin: 100, damageMax: 100 }),
      stackCount: 9,
    };

    const result = resolveAttack(attacker, bigStack, { random: minRoll, flatDamageBonus: 50 });

    expect(result.damageDealt).toBe(950); // 900 rolled + 50 flat, x1.0
    expect(result.defenderHpAfter).toBe(50);
    expect(result.stackAliveCount).toBe(1); // ceil(50 / 200) — a wounded unit is still alive
    expect(result.frontUnitHp).toBe(50);
    expect(result.defenderDefeated).toBe(false);
  });

  it('22. damage that wipes the pool exactly (1000) -> no units left and no retaliation', () => {
    const bigStack: CombatUnit = { ...blackDragon, stackCount: 5, currentHp: 1000 };
    const attacker: CombatUnit = {
      ...withStats(antimage, { attack: 12, damageMin: 100, damageMax: 100 }),
      stackCount: 10,
    };

    const result = resolveAttack(attacker, bigStack, { random: minRoll });

    expect(result.damageDealt).toBe(1000);
    expect(result.defenderHpAfter).toBe(0);
    expect(result.stackAliveCount).toBe(0);
    expect(result.frontUnitHp).toBe(0);
    expect(result.defenderDefeated).toBe(true);
    // The dragon has no NoRetaliation, so only defenderDefeated stops the retaliation.
    expect(result.retaliationTriggered).toBe(false);
  });

  it('23. heroAttackBonus is added to the attack for the multiplier only (5 + 10 = 15)', () => {
    const weakHero = withStats(swordsman, { attack: 5 }); // against goblin defense 3

    const withoutBonus = resolveAttack(weakHero, goblin, { random: minRoll });
    const withBonus = resolveAttack(weakHero, goblin, { random: minRoll, heroAttackBonus: 10 });

    expect(withoutBonus.breakdown.effectiveAttack).toBe(5);
    expect(withoutBonus.breakdown.attackDefenseMultiplier).toBeCloseTo(1.1); // 1 + 0.05 * 2
    expect(withBonus.breakdown.effectiveAttack).toBe(15);
    expect(withBonus.breakdown.effectiveDefense).toBe(3); // untouched
    expect(withBonus.breakdown.attackDefenseMultiplier).toBeCloseTo(1.6); // 1 + 0.05 * 12
    expect(withBonus.damageDealt).toBe(16); // roll 10 * 1.6
    // Purity: the unit object itself is not modified.
    expect(weakHero.stats.attack).toBe(5);
  });

  it('24. heroDefenseBonus raises the defense used by the multiplier', () => {
    const result = resolveAttack(swordsman, goblin, { random: minRoll, heroDefenseBonus: 10 });

    expect(result.breakdown.effectiveAttack).toBe(6);
    expect(result.breakdown.effectiveDefense).toBe(13); // 3 + 10
    expect(result.breakdown.attackDefenseMultiplier).toBeCloseTo(1 - 0.025 * 7); // 0.825
    expect(goblin.stats.defense).toBe(3); // not mutated
  });

  it('25. luck applies to a retaliation too (the answering unit has its own luck)', () => {
    // The dragon answers: it carries the luck now, so a triggered malus/bonus is applied
    // through the whole formula — a retaliation is a full re-invocation.
    const luckyDragon = withLuck(blackDragon, 2);
    const result = resolveAttack(luckyDragon, antimage, { isRetaliation: true, random: minRoll, fixedLuckRoll: 0.1 });

    expect(result.breakdown.luckLevel).toBe(2);
    expect(result.breakdown.luckTriggered).toBe(true);
    // roll 30 -> 30 * 1.35 = 40.5, then * 1.5 = 60.75 -> round half up 61
    expect(result.damageDealt).toBe(61);
  });
});

/** A cheap "skeleton" unit with 1..3 damage per unit — the roll tests use it. */
function skeletonUnit(stackCount: number): CombatUnit {
  return {
    id: 'skeleton',
    name: 'Скелет',
    stats: { hp: 1, attack: 1, defense: 0, speed: 1, damageMin: 1, damageMax: 3 },
    tags: [],
    currentHp: stackCount,
    stackCount,
  };
}

/** Replays a fixed random sequence and counts how many times it was read. */
function sequenceRandom(values: number[]): { random: () => number; calls: () => number } {
  let index = 0;

  return {
    random: () => {
      const value = values[index % values.length];
      index += 1;

      return value;
    },
    calls: () => index,
  };
}

/** The random value that makes a unit with damageMin..damageMax roll exactly `damage`. */
function randomForDamage(damage: number, damageMin: number, damageMax: number): number {
  return (damage - damageMin + 0.5) / (damageMax - damageMin + 1);
}

/** Seeded PRNG (mulberry32) so the statistics test can never be flaky. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('stack damage roll — limited samples with scaling', () => {
  it('N = 1: exactly one roll, scale 1, result equals a single unit roll', () => {
    const source = sequenceRandom([0.9]);
    const result = resolveAttack(skeletonUnit(1), swordsman, { random: source.random }, sampledRules);

    expect(source.calls()).toBe(1);
    expect(result.breakdown.stackRoll).toBe(3);
    expect(result.notes).toContain('damage roll: 1 sample(s), scaled x1');
  });

  it('N = 10 (== damageRollSamples): ten rolls, scale 1', () => {
    // damages 1,2,3,1,2,3,2,1,3,2 -> sum 20
    const source = sequenceRandom([0, 0.5, 0.9, 0, 0.5, 0.9, 0.5, 0, 0.9, 0.5]);
    const result = resolveAttack(skeletonUnit(10), swordsman, { random: source.random }, sampledRules);

    expect(source.calls()).toBe(10);
    expect(result.breakdown.stackRoll).toBe(20);
    expect(result.notes).toContain('damage roll: 10 sample(s), scaled x1');
  });

  it('N = 11: still exactly ten rolls, scale 1.1, so the total can be fractional', () => {
    const source = sequenceRandom([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]); // ten rolls of 1
    const result = resolveAttack(skeletonUnit(11), swordsman, { random: source.random }, sampledRules);

    expect(source.calls()).toBe(10);
    expect(result.breakdown.stackRoll).toBe(11); // sum 10 * (11 / 10)
    expect(result.notes).toContain('damage roll: 10 sample(s), scaled x1.1');
  });

  it('N = 1000: exactly ten rolls, scale 100, exact total for a known sequence', () => {
    const rolls = [2, 1, 3, 3, 2, 2, 1, 3, 2, 2]; // sum 21
    const source = sequenceRandom(rolls.map((damage) => randomForDamage(damage, 1, 3)));
    const result = resolveAttack(skeletonUnit(1000), swordsman, { random: source.random }, sampledRules);

    expect(source.calls()).toBe(10);
    expect(result.breakdown.stackRoll).toBe(2100); // 21 * 100
    expect(result.notes).toContain('damage roll: 10 sample(s), scaled x100');
  });

  it('damageMin == damageMax: always damageMin * stackCount, whatever random returns', () => {
    const fixedDamage = withStats(skeletonUnit(7), { damageMin: 4, damageMax: 4 });

    for (const value of [0, 0.5, 0.999]) {
      const result = resolveAttack(fixedDamage, swordsman, { random: () => value }, sampledRules);

      expect(result.breakdown.stackRoll).toBe(4 * 7);
    }
  });

  it('boundaries: random() = 0 rolls damageMin, random() = 0.999 rolls damageMax', () => {
    const lowest = resolveAttack(skeletonUnit(3), swordsman, { random: () => 0 }, sampledRules);
    const highest = resolveAttack(skeletonUnit(3), swordsman, { random: () => 0.999 }, sampledRules);

    expect(lowest.breakdown.stackRoll).toBe(3); // 1 per unit * 3
    expect(highest.breakdown.stackRoll).toBe(9); // 3 per unit * 3
  });

  it('worked example: 100 skeletons of 1..3 with rolls [2,1,3,3,2,2,1,3,2,2] -> 21 * 10 = 210', () => {
    const rolls = [2, 1, 3, 3, 2, 2, 1, 3, 2, 2];
    const source = sequenceRandom(rolls.map((damage) => randomForDamage(damage, 1, 3)));
    const result = resolveAttack(skeletonUnit(100), swordsman, { random: source.random }, sampledRules);

    expect(result.breakdown.stackRoll).toBe(210);
  });

  it('statistics (seeded, 20000 attacks): mean ~200 and sigma ~26 for 100 skeletons of 1..3', () => {
    const random = seededRandom(20260930);
    const attacker = skeletonUnit(100);
    const attacks = 20000;
    let sum = 0;
    let sumOfSquares = 0;

    for (let i = 0; i < attacks; i++) {
      const roll = resolveAttack(attacker, swordsman, { random }, sampledRules).breakdown.stackRoll;
      sum += roll;
      sumOfSquares += roll * roll;
    }

    const mean = sum / attacks;
    const sigma = Math.sqrt(sumOfSquares / attacks - mean * mean);

    expect(mean).toBeGreaterThan(200 * 0.98);
    expect(mean).toBeLessThan(200 * 1.02);
    expect(sigma).toBeGreaterThan(26 * 0.85);
    expect(sigma).toBeLessThan(26 * 1.15);
  });
});

describe('damage roll mode (uniform is the default — decisions 015)', () => {
  it('uniform: random() = 0 rolls the lowest value damageMin * stackCount', () => {
    const result = resolveAttack(skeletonUnit(5), swordsman, { random: () => 0 });

    expect(result.breakdown.stackRoll).toBe(5); // 1 * 5
    expect(result.notes).toContain('damage roll mode: uniform');
    expect(result.notes.some((note) => note.includes('uniform over 5..15'))).toBe(true);
  });

  it('uniform: random() = 0.999 rolls the highest value damageMax * stackCount (small span)', () => {
    // swordsman 10..14, stack 1 -> span 5, floor(0.999 * 5) = 4 -> 14
    const result = resolveAttack(swordsman, goblin, { random: () => 0.999 });

    expect(result.breakdown.stackRoll).toBe(swordsman.stats.damageMax);
  });

  it('uniform: the whole range is covered (1, 2 and 3 for a single skeleton)', () => {
    const cases: ReadonlyArray<[number, number]> = [
      [0, 1],
      [0.4, 2],
      [0.9, 3],
    ];

    for (const [value, expected] of cases) {
      const result = resolveAttack(skeletonUnit(1), swordsman, { random: () => value });

      expect(result.breakdown.stackRoll).toBe(expected);
    }
  });

  it('sampled mode is chosen by the config and reports itself in notes', () => {
    const result = resolveAttack(skeletonUnit(1), swordsman, { random: () => 0.9 }, sampledRules);

    expect(result.notes).toContain('damage roll mode: sampled');
  });

  it('damageMin == damageMax gives damageMin * stackCount in BOTH modes', () => {
    const fixed = withStats(skeletonUnit(6), { damageMin: 7, damageMax: 7 });

    expect(resolveAttack(fixed, swordsman, { random: () => 0 }).breakdown.stackRoll).toBe(42);
    expect(
      resolveAttack(fixed, swordsman, { random: () => 0.5 }, sampledRules).breakdown.stackRoll,
    ).toBe(42);
  });
});

describe('roundDamage — one "mathematical" rounding at the very end', () => {
  it.each([
    [0.49, 0],
    [0.5, 1],
    [2.4999999999999996, 3],
    [2.4, 2],
    [2.5, 3],
    [23.232, 23],
  ])('roundDamage(%s) = %s', (input, expected) => {
    expect(roundDamage(input)).toBe(expected);
  });

  it('clampLuckLevel keeps luck/morale inside -3..3', () => {
    expect(clampLuckLevel(5)).toBe(3);
    expect(clampLuckLevel(-5)).toBe(-3);
    expect(clampLuckLevel(2)).toBe(2);
  });
});

/** Units whose attack/defense produce an exactly known attack/defense multiplier. */
function unitsForMultiplier(multiplier: number): { attacker: CombatUnit; defender: CombatUnit } {
  const base = withStats(swordsman, { attack: 10, damageMin: 100, damageMax: 100 });
  const target = withStats(goblin, { defense: 10 });

  if (multiplier >= 1) {
    // +5% per attack point, capped at x4.
    return { attacker: withStats(base, { attack: 10 + (multiplier - 1) / 0.05 }), defender: target };
  }

  // -2.5% per defense point, floored at x0.3.
  return { attacker: base, defender: withStats(target, { defense: 10 + (1 - multiplier) / 0.025 }) };
}

describe('principle: "+X%" is a separate factor, so it changes the damage by exactly that share', () => {
  it.each([0.3, 0.75, 1.0, 1.5, 4.0])(
    'multiplier %s: expert offense (+30%) multiplies afterOffenseSkill by exactly 1.3',
    (multiplier) => {
      const { attacker, defender } = unitsForMultiplier(multiplier);
      const plain = resolveAttack(attacker, defender, { random: () => 0 });
      const withOffense = resolveAttack(attacker, defender, {
        random: () => 0,
        meleeOffenseBonusPercent: 30,
      });

      expect(plain.breakdown.attackDefenseMultiplier).toBeCloseTo(multiplier);
      expect(plain.breakdown.afterAttackDefense).toBeCloseTo(100 * multiplier);
      expect(withOffense.breakdown.afterOffenseSkill).toBeCloseTo(
        plain.breakdown.afterAttackDefense * 1.3,
      );
    },
  );

  it('percentDamageBonus is a separate factor (x1.5 at +50%)', () => {
    const { attacker, defender } = unitsForMultiplier(1.0);
    const plain = resolveAttack(attacker, defender, { random: () => 0 });
    const withPercent = resolveAttack(attacker, defender, {
      random: () => 0,
      percentDamageBonus: 50,
    });

    expect(withPercent.breakdown.afterPercentBonus).toBeCloseTo(
      plain.breakdown.afterOffenseSkill * 1.5,
    );
  });

  it('armor is a separate factor (x0.85 at 15%)', () => {
    const { attacker, defender } = unitsForMultiplier(1.0);
    const plain = resolveAttack(attacker, defender, { random: () => 0 });
    const withArmor = resolveAttack(attacker, defender, {
      random: () => 0,
      defensiveArmorReductionPercent: 15,
    });

    expect(withArmor.breakdown.afterArmor).toBeCloseTo(plain.breakdown.afterLuck * 0.85);
  });
});


describe('offense skill: melee vs ranged, physical only', () => {
  it('melee uses meleeOffenseBonusPercent and reports the ranged one as not applied', () => {
    const result = resolveAttack(swordsman, goblin, {
      random: () => 0,
      meleeOffenseBonusPercent: 30,
      rangedOffenseBonusPercent: 50,
    });

    expect(result.breakdown.offenseSkillPercentApplied).toBe(30);
    expect(
      result.notes.some((note) =>
        note.includes('rangedOffenseBonusPercent=50 not applied: melee attack'),
      ),
    ).toBe(true);
  });

  it('ranged uses rangedOffenseBonusPercent and reports the melee one as not applied', () => {
    const result = resolveAttack(swordsman, goblin, {
      random: () => 0,
      attackKind: 'ranged',
      meleeOffenseBonusPercent: 30,
      rangedOffenseBonusPercent: 50,
    });

    expect(result.breakdown.offenseSkillPercentApplied).toBe(50);
    expect(
      result.notes.some((note) =>
        note.includes('meleeOffenseBonusPercent=30 not applied: ranged attack'),
      ),
    ).toBe(true);
  });

  it('a magical attack gets NO offense skill and the note says so', () => {
    const result = resolveAttack(mage, swordsman, {
      random: () => 0,
      meleeOffenseBonusPercent: 30,
      rangedOffenseBonusPercent: 50,
    });

    expect(result.breakdown.offenseSkillPercentApplied).toBe(0);
    expect(
      result.notes.some((note) =>
        note.includes('offense skill (melee/ranged) not applied: magical attack'),
      ),
    ).toBe(true);
  });
});

describe('armor: physical only', () => {
  it('reduces physical damage', () => {
    const plain = resolveAttack(swordsman, goblin, { random: () => 0 });
    const armored = resolveAttack(swordsman, goblin, {
      random: () => 0,
      defensiveArmorReductionPercent: 20,
    });

    expect(armored.breakdown.armorReductionApplied).toBe(20);
    expect(armored.damageDealt).toBeLessThan(plain.damageDealt);
  });

  it('never touches a magical attack and reports it as not applied', () => {
    const result = resolveAttack(mage, swordsman, {
      random: () => 0,
      defensiveArmorReductionPercent: 20,
    });

    expect(result.breakdown.armorReductionApplied).toBe(0);
    expect(
      result.notes.some((note) =>
        note.includes('defensiveArmorReductionPercent=20 not applied: magical attack'),
      ),
    ).toBe(true);
  });
});

describe('luck level is clamped inside resolveAttack', () => {
  it('unit luck (3) + context luckBonus (2) is clamped to 3 and noted', () => {
    const lucky = withLuck(swordsman, 3);
    const result = resolveAttack(lucky, goblin, { random: () => 0, luckBonus: 2 });

    expect(result.breakdown.luckLevel).toBe(3);
    expect(result.notes.some((note) => note.includes('luck level clamped from 5 to 3'))).toBe(true);
  });
});

