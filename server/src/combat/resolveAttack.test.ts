/**
 * Unit tests for resolveAttack — the pure combat resolution function.
 *
 * docs/architecture.md asks for exactly this: the damage formula must be
 * "покрыта юнит-тестами на конкретных парах юнитов". No map, no hex field and
 * no PixiJS is involved anywhere in this file.
 *
 * Every test injects a fixed random source, so damage is deterministic:
 *   random: minRoll (0)     -> the smallest roll (damageMin)
 *   random: maxRoll (0.999) -> the largest roll  (damageMax)
 */

import { describe, expect, it } from 'vitest';

import type { CombatUnit } from '@de-jija/shared';

import { MIN_DAMAGE, resolveAttack } from './resolveAttack';
import { antimage, blackDragon, goblin, mage, swordsman } from './testUnits';

/** Smallest possible damage roll (damageMin). */
const minRoll = (): number => 0;
/** Largest possible damage roll (damageMax). */
const maxRoll = (): number => 0.999;

describe('resolveAttack — pure combat resolution', () => {
  it('1. antimage attacks the dragon: physical hit lands, no retaliation (NoRetaliation)', () => {
    const result = resolveAttack(antimage, blackDragon, { random: minRoll });

    // MagicImmune must not stop a physical attack.
    expect(result.blockedByImmunity).toBe(false);
    expect(result.damageDealt).toBe(antimage.stats.damageMin - blackDragon.stats.defense); // 40 - 12 = 28
    expect(result.defenderHpAfter).toBe(blackDragon.stats.hp - 28);
    // The antimage carries NoRetaliation, so the dragon never hits back.
    expect(result.retaliationTriggered).toBe(false);

    expect(result.notes).toContain('attack type: physical');
    expect(result.notes).toContain(
      'AreaAttack: requires hex positioning, not implemented in this pure-function stage',
    );
  });

  it('2. mage (MagicDamage) attacks the dragon: 0 damage, blockedByImmunity = true', () => {
    const result = resolveAttack(mage, blackDragon, { random: minRoll });

    expect(result.blockedByImmunity).toBe(true);
    expect(result.damageDealt).toBe(0);
    expect(result.defenderHpAfter).toBe(blackDragon.currentHp);
    expect(result.notes).toContain('MagicImmune on Чёрный дракон: magic attack fully blocked, damage 0');

    // The retaliation rule is applied uniformly to every attack, including a fully
    // blocked one. This is a decision candidate for docs/decisions.md
    // (alternative: a blocked attack must not provoke a hit back).
    expect(result.retaliationTriggered).toBe(true);
  });

  it('2b. even the largest magic roll is blocked, so immunity cannot be bypassed by luck', () => {
    const result = resolveAttack(mage, blackDragon, { random: maxRoll });

    expect(result.damageDealt).toBe(0);
    expect(result.blockedByImmunity).toBe(true);
  });

  it('3. dragon attacks the antimage: physical damage lands, dragon retaliates', () => {
    const result = resolveAttack(blackDragon, antimage, { random: minRoll });

    // The dragon's own MagicImmune is irrelevant here: it only guards against
    // incoming magic, it neither blocks an outgoing attack nor its retaliation.
    expect(result.blockedByImmunity).toBe(false);
    expect(result.damageDealt).toBe(blackDragon.stats.damageMin - antimage.stats.defense); // 30 - 8 = 22
    expect(result.retaliationTriggered).toBe(true);
  });

  it('3b. a retaliation against the dragon is not weakened by the dragon own MagicImmune', () => {
    // The antimage answers the dragon. This is a physical attack, so the
    // dragon's MagicImmune does not reduce it — it never blocks physical damage.
    const result = resolveAttack(antimage, blackDragon, { isRetaliation: true, random: minRoll });

    expect(result.blockedByImmunity).toBe(false);
    expect(result.damageDealt).toBe(28);
    // isRetaliation: an answer to an answer must not happen.
    expect(result.retaliationTriggered).toBe(false);
  });

  it('4. plain exchange with no special tags: damage is dealt and retaliation is triggered', () => {
    const result = resolveAttack(swordsman, goblin, { random: minRoll });

    expect(result.damageDealt).toBe(swordsman.stats.damageMin - goblin.stats.defense); // 10 - 3 = 7
    expect(result.blockedByImmunity).toBe(false);
    expect(result.retaliationTriggered).toBe(true);
    // No ability should have been reported for two plain units.
    expect(
      result.notes.some((note) => note.startsWith('AreaAttack') || note.startsWith('Piercing')),
    ).toBe(false);
  });

  it('5. the damage roll covers the whole damageMin..damageMax range', () => {
    const lowest = resolveAttack(swordsman, goblin, { random: minRoll });
    const highest = resolveAttack(swordsman, goblin, { random: maxRoll });

    expect(lowest.damageDealt).toBe(swordsman.stats.damageMin - goblin.stats.defense); // 7
    expect(highest.damageDealt).toBe(swordsman.stats.damageMax - goblin.stats.defense); // 11
  });

  it('6. damage never falls below MIN_DAMAGE, even when defense beats the roll', () => {
    // Goblin roll 8 vs dragon defense 12 would give -4 without a floor.
    const result = resolveAttack(goblin, blackDragon, { random: minRoll });

    expect(result.damageDealt).toBe(MIN_DAMAGE);
    expect(result.defenderHpAfter).toBe(blackDragon.stats.hp - MIN_DAMAGE);
    expect(result.notes.some((note) => note.startsWith('damage clamped up to MIN_DAMAGE'))).toBe(true);
  });

  it('7. a retaliation does not provoke another retaliation (no endless chain)', () => {
    const result = resolveAttack(swordsman, goblin, { isRetaliation: true, random: minRoll });

    expect(result.retaliationTriggered).toBe(false);
  });

  it('8. a defender killed by the hit cannot retaliate', () => {
    const weakenedGoblin: CombatUnit = { ...goblin, currentHp: 5 };
    const result = resolveAttack(swordsman, weakenedGoblin, { random: minRoll }); // 7 damage vs 5 hp

    expect(result.defenderHpAfter).toBeLessThanOrEqual(0);
    expect(result.retaliationTriggered).toBe(false);
  });

  it('9. declared-but-unimplemented abilities are reported instead of silently ignored', () => {
    const piercer: CombatUnit = { ...swordsman, tags: ['Piercing'] };
    const result = resolveAttack(piercer, goblin, { random: minRoll });

    expect(result.notes.some((note) => note.startsWith('Piercing: not implemented'))).toBe(true);
  });

  it('10. the function does not mutate its inputs (it is pure)', () => {
    const attackerBefore = structuredClone(antimage);
    const defenderBefore = structuredClone(blackDragon);

    resolveAttack(antimage, blackDragon, { random: minRoll });

    expect(antimage).toEqual(attackerBefore);
    expect(blackDragon).toEqual(defenderBefore);
  });
});
