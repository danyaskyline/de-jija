/**
 * Unit tests for resolveAttack — the pure combat resolution function.
 *
 * docs/architecture.md requires exactly this: the damage formula must be
 * "покрыта юнит-тестами на конкретных парах юнитов". No map, no hex field and
 * no PixiJS is involved anywhere in this file.
 *
 * The real config/combat-rules.json is loaded once in beforeAll, so these tests
 * also prove that the balance file parses and validates. Damage is deterministic
 * because every test injects a fixed random source:
 *   minRoll (0)     -> the smallest roll (damageMin)
 *   maxRoll (0.999) -> the largest roll  (damageMax)
 *
 * NOTE for the author: the expected numbers below are the arithmetic for the
 * CURRENT values in config/combat-rules.json (+5% per attack point, 400% cap,
 * -2.5% per defense point, 80% floor, x0.9 morale). If the balance file is
 * tuned, some numbers here will move with it — that is expected. Test 14 proves
 * that the coefficients really come from the rules object and not from the code.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import type { CombatUnit } from '@de-jija/shared';

import { getCombatRules, initCombatRules, type CombatRules } from './combatRules';
import { attackDefenseMultiplier, resolveAttack } from './resolveAttack';
import { antimage, blackDragon, goblin, mage, swordsman } from './testUnits';

/** Smallest possible damage roll (damageMin). */
const minRoll = (): number => 0;
/** Largest possible damage roll (damageMax). */
const maxRoll = (): number => 0.999;

/** The minimum damage is balance data now: it comes from config/combat-rules.json. */
let MIN_DAMAGE = 1;

beforeAll(() => {
  initCombatRules(); // loads the real config/combat-rules.json (a config smoke test too)
  MIN_DAMAGE = getCombatRules().minimumDamage;
});

/** Copy of a unit with changed stats, so the tests stay short and readable. */
function withStats(unit: CombatUnit, partial: Partial<CombatUnit['stats']>): CombatUnit {
  return { ...unit, stats: { ...unit.stats, ...partial } };
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
    expect(result.defenderDefeated).toBe(false);
    // The antimage carries NoRetaliation, so the dragon never hits back.
    expect(result.retaliationTriggered).toBe(false);

    expect(result.notes).toContain('attack type: physical');
    expect(result.notes).toContain(
      'AreaAttack: requires hex positioning, not implemented in this pure-function stage',
    );
  });

  it('2. mage (MagicDamage) attacks the dragon: full block by MagicImmune, breakdown stays at zero', () => {
    const result = resolveAttack(mage, blackDragon, { random: minRoll });

    expect(result.blockedByImmunity).toBe(true);
    expect(result.damageDealt).toBe(0);
    expect(result.defenderHpAfter).toBe(blackDragon.currentHp);
    expect(result.notes).toContain('MagicImmune on Чёрный дракон: magic attack fully blocked, damage 0');

    // Nothing was rolled, so every step is zero (moraleApplied is a neutral x1).
    expect(result.breakdown.stackRoll).toBe(0);
    expect(result.breakdown.attackDefenseMultiplier).toBe(0);
    expect(result.breakdown.finalDamage).toBe(0);
    expect(result.breakdown.moraleApplied).toBe(1);

    // The retaliation rule is applied uniformly to every attack, blocked or not
    // (docs/decisions.md, 011).
    expect(result.retaliationTriggered).toBe(true);
  });

  it('2b. even the largest magic roll is blocked, so immunity cannot be bypassed by luck', () => {
    const result = resolveAttack(mage, blackDragon, { random: maxRoll });

    expect(result.damageDealt).toBe(0);
    expect(result.blockedByImmunity).toBe(true);
  });

  it('3. dragon attacks the antimage: attack advantage x1.35 applies', () => {
    const result = resolveAttack(blackDragon, antimage, { random: minRoll });

    // attack 15 vs defense 8 -> 1 + 5%/100 * 7 = 1.35; roll 30 -> 40.5 -> floor 40
    expect(result.blockedByImmunity).toBe(false);
    expect(result.breakdown.attackDefenseMultiplier).toBeCloseTo(1.35);
    expect(result.breakdown.afterAttackDefense).toBeCloseTo(40.5);
    expect(result.damageDealt).toBe(40);
    expect(result.retaliationTriggered).toBe(true);
  });

  it('3b. a retaliation against the dragon is not weakened by the dragon own MagicImmune', () => {
    // The antimage answers the dragon: a physical attack, so the dragon's
    // MagicImmune does not reduce it — it never blocks physical damage.
    const result = resolveAttack(antimage, blackDragon, { isRetaliation: true, random: minRoll });

    expect(result.blockedByImmunity).toBe(false);
    expect(result.damageDealt).toBe(40);
    // isRetaliation: an answer to an answer must not happen.
    expect(result.retaliationTriggered).toBe(false);
  });

  it('4. plain exchange with no special tags: damage is dealt and retaliation is triggered', () => {
    const result = resolveAttack(swordsman, goblin, { random: minRoll });

    // attack 6 vs defense 3 -> 1 + 0.05*3 = 1.15; roll 10 -> 11.5 -> floor 11
    expect(result.breakdown.attackDefenseMultiplier).toBeCloseTo(1.15);
    expect(result.damageDealt).toBe(11);
    expect(result.blockedByImmunity).toBe(false);
    expect(result.retaliationTriggered).toBe(true);
  });

  it('5. the stack roll covers the whole damageMin..damageMax range', () => {
    const lowest = resolveAttack(swordsman, goblin, { random: minRoll });
    const highest = resolveAttack(swordsman, goblin, { random: maxRoll });

    expect(lowest.breakdown.stackRoll).toBe(swordsman.stats.damageMin); // 10
    expect(highest.breakdown.stackRoll).toBe(swordsman.stats.damageMax); // 14
    expect(lowest.damageDealt).toBe(11); // 10 * 1.15 -> floor 11
    expect(highest.damageDealt).toBe(16); // 14 * 1.15 -> floor 16
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
    // attack 1 vs defense 12 -> multiplier at its floor (0.8); roll 1 -> 0.8 -> floor 0 -> clamp to 1
    const weakling = withStats(swordsman, { attack: 1, damageMin: 1, damageMax: 1 });
    const result = resolveAttack(weakling, blackDragon, { random: minRoll });

    expect(result.breakdown.attackDefenseMultiplier).toBeCloseTo(0.8);
    expect(result.damageDealt).toBe(MIN_DAMAGE);
    expect(
      result.notes.some((note) => note.startsWith('damage clamped up to minimumDamage')),
    ).toBe(true);
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

  it('10. a huge defense advantage stops at the floor (defensePenaltyFloorPercent = 80 -> x0.8)', () => {
    const weakAttacker = withStats(goblin, { attack: 1 });
    const veryArmoredDefender = withStats(blackDragon, { defense: 500 });
    const result = resolveAttack(weakAttacker, veryArmoredDefender, { random: minRoll });

    expect(result.breakdown.attackDefenseMultiplier).toBeCloseTo(0.8); // 80 / 100
    expect(result.damageDealt).toBe(6); // roll 8 * 0.8 = 6.4 -> floor 6
    expect(result.notes.some((note) => note.includes('defense penalty is floored at x0.8'))).toBe(true);
  });

  it('11. magicResistPercent reduces magic damage partially — it is NOT a block', () => {
    const result = resolveAttack(mage, swordsman, { random: minRoll, magicResistPercent: 25 });

    // attack 10 vs defense 6 -> 1.2; roll 20 -> 24 -> -25% -> 18
    expect(result.blockedByImmunity).toBe(false);
    expect(result.breakdown.magicResistApplied).toBe(25);
    expect(result.breakdown.afterMagicResist).toBeCloseTo(18);
    expect(result.damageDealt).toBe(18);
    expect(
      result.notes.some((note) => note.includes('magic resist reduced magic damage by 25%')),
    ).toBe(true);

    // Contrast with MagicImmune, which is a full block (test 2).
    const immuneTarget = resolveAttack(mage, blackDragon, { random: minRoll, magicResistPercent: 25 });
    expect(immuneTarget.blockedByImmunity).toBe(true);
    expect(immuneTarget.damageDealt).toBe(0);
  });

  it('11b. magicResistPercent is ignored for a physical attack', () => {
    const result = resolveAttack(swordsman, goblin, { random: minRoll, magicResistPercent: 50 });

    expect(result.breakdown.magicResistApplied).toBe(0);
    expect(result.damageDealt).toBe(11); // same as without the parameter
    expect(result.notes.some((note) => note.includes('ignored: the attack is physical'))).toBe(true);
  });

  it('11c. even 100% magic resist is a reduction, not a block', () => {
    const result = resolveAttack(mage, swordsman, { random: minRoll, magicResistPercent: 100 });

    expect(result.blockedByImmunity).toBe(false); // still not "blocked"
    expect(result.breakdown.afterMagicResist).toBe(0);
    expect(result.damageDealt).toBe(MIN_DAMAGE); // clamped, never exactly 0
  });

  it('12. a morale penalty multiplies the result by moralePenaltyMultiplier', () => {
    const withoutPenalty = resolveAttack(swordsman, goblin, { random: minRoll });
    const penalized = resolveAttack(swordsman, goblin, {
      random: minRoll,
      isMoralePenalized: true,
    });

    expect(penalized.breakdown.moraleApplied).toBe(0.9); // current config value
    expect(penalized.damageDealt).toBe(10); // 11.5 * 0.9 = 10.35 -> floor 10
    expect(penalized.damageDealt).toBeLessThan(withoutPenalty.damageDealt);
    expect(penalized.notes.some((note) => note.includes('morale penalty applied: x0.9'))).toBe(true);
  });

  it('13. breakdown is complete and logically consistent for a fully modified attack', () => {
    const result = resolveAttack(mage, swordsman, {
      random: minRoll,
      flatDamageBonus: 2,
      percentDamageBonus: 10,
      magicResistPercent: 20,
      isMoralePenalized: true,
    });
    const { breakdown } = result;

    // Every step must be present (and be a finite number).
    expect(Object.keys(breakdown).sort()).toEqual([
      'afterAttackDefense',
      'afterFlatBonus',
      'afterMagicResist',
      'afterPercentBonus',
      'attackDefenseMultiplier',
      'finalDamage',
      'flatBonusApplied',
      'magicResistApplied',
      'moraleApplied',
      'percentBonusApplied',
      'stackRoll',
    ]);
    for (const [name, value] of Object.entries(breakdown)) {
      expect(Number.isFinite(value), `${name} is not a finite number`).toBe(true);
    }

    // Each step must follow from the previous one.
    expect(breakdown.stackRoll).toBe(20);
    expect(breakdown.afterFlatBonus).toBe(breakdown.stackRoll + breakdown.flatBonusApplied); // 22
    expect(breakdown.afterAttackDefense).toBeCloseTo(
      breakdown.afterFlatBonus * breakdown.attackDefenseMultiplier,
    ); // 26.4
    expect(breakdown.afterPercentBonus).toBeCloseTo(
      breakdown.afterAttackDefense * (1 + breakdown.percentBonusApplied / 100),
    ); // 29.04
    expect(breakdown.afterMagicResist).toBeCloseTo(
      breakdown.afterPercentBonus * (1 - breakdown.magicResistApplied / 100),
    ); // 23.232
    expect(breakdown.finalDamage).toBe(
      Math.max(MIN_DAMAGE, Math.floor(breakdown.afterMagicResist * breakdown.moraleApplied)),
    ); // 20.9088 -> 20
    expect(result.damageDealt).toBe(breakdown.finalDamage);
  });

  it('14. coefficients really come from the injected rules (nothing is hardcoded)', () => {
    const customRules: CombatRules = {
      ...getCombatRules(),
      attackAdvantagePercentPerPoint: 10,
      attackAdvantageCapPercent: 200,
      defensePenaltyPercentPerPoint: 5,
      defensePenaltyFloorPercent: 50,
      moralePenaltyMultiplier: 0.5,
    };

    // attack 15 vs defense 8 -> 1 + 0.10*7 = 1.7 (with the default rules it would be 1.35)
    const stronger = resolveAttack(blackDragon, antimage, { random: minRoll }, customRules);
    expect(stronger.breakdown.attackDefenseMultiplier).toBeCloseTo(1.7);
    expect(stronger.damageDealt).toBe(51); // 30 * 1.7

    // Custom floor of 50% instead of the default 80%.
    const weakling = withStats(swordsman, { attack: 1 });
    const floored = resolveAttack(weakling, blackDragon, { random: minRoll }, customRules);
    expect(floored.breakdown.attackDefenseMultiplier).toBeCloseTo(0.5);

    // Custom morale multiplier of 0.5 instead of the default 0.9.
    const penalized = resolveAttack(
      swordsman,
      goblin,
      { random: minRoll, isMoralePenalized: true },
      customRules,
    );
    expect(penalized.breakdown.moraleApplied).toBe(0.5);
    expect(penalized.damageDealt).toBe(6); // roll 10 * 1.3 (custom +10%/point) = 13, * 0.5 = 6.5 -> floor 6
  });

  it('15. the four mastery/armor placeholders are reported but never applied', () => {
    const attackWithPlaceholders = resolveAttack(swordsman, goblin, {
      random: minRoll,
      meleeOffenseBonusPercent: 10,
      rangedOffenseBonusPercent: 20,
      magicOffenseBonusPercent: 30,
      defensiveArmorReductionPercent: 15,
    });
    const plainAttack = resolveAttack(swordsman, goblin, { random: minRoll });

    // Nothing changes: the placeholders are documented TODOs, not implemented logic.
    expect(attackWithPlaceholders.damageDealt).toBe(plainAttack.damageDealt);
    expect(attackWithPlaceholders.breakdown).toEqual(plainAttack.breakdown);

    // ...but they cannot be missed either.
    expect(attackWithPlaceholders.notes.filter((note) => note.includes('is a placeholder')).length).toBe(4);
    expect(attackWithPlaceholders.notes.some((note) => note.includes('meleeOffenseBonusPercent=10'))).toBe(true);
    expect(attackWithPlaceholders.notes.some((note) => note.includes('defensiveArmorReductionPercent=15'))).toBe(true);
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
    expect(result.defenderDefeated).toBe(true);
    expect(result.retaliationTriggered).toBe(false);
  });

  it('18b. overkill damage far above the total HP stays at 0 and still stops the retaliation', () => {
    // 5 dragons (roll 30 * 5 = 150) vs a goblin: attack 15 vs defense 3 -> x1.6 -> 240 damage
    // against 50 HP. The raw difference is -190 — that is the value that used to leak out.
    const dragonStack: CombatUnit = { ...blackDragon, stackCount: 5 };
    const result = resolveAttack(dragonStack, goblin, { random: minRoll });

    expect(result.breakdown.stackRoll).toBe(150);
    expect(result.damageDealt).toBe(240);
    expect(result.defenderHpAfter).toBe(0); // clamped, not -190
    expect(result.defenderDefeated).toBe(true);
    // A destroyed stack never hits back — decided by the flag, not by the raw number.
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
});


