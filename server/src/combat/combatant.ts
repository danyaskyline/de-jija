/**
 * Combatant assembly — the ONE place where a unit's total bonuses are collected.
 *
 * Flow (docs/decisions.md, 018):
 *   HeroModifiers + extra bonuses (items, buffs, manual sandbox input)
 *     --buildCombatant-->  CombatUnit with a filled `bonuses`
 *
 * The bonuses are a SNAPSHOT taken once, when the battle is created: from then on
 * resolveAttack only READS the numbers off the combatants and never gathers
 * anything itself. A retaliation is a full re-invocation with the roles swapped,
 * so the answering combatant automatically brings its own bonuses.
 *
 * Stacking rules between sources (docs/decisions.md, 017/018):
 *   - flat points and percent points (attack, defense, offense %, armor %, flat
 *     damage) simply ADD UP;
 *   - percentDamageBonus is combined by MULTIPLICATION, so two +10% sources give
 *     +21% and not +20% ("+X% should feel like +X%");
 *   - luck is summed and clamped to -3..3 ONCE at the end; the unit's OWN
 *     luckLevel is not part of this sum and is added by the formula later.
 *
 * The input unit is never mutated: a COPY with the filled `bonuses` is returned.
 */

import type { CombatBonuses, CombatUnit } from '@de-jija/shared';

import type { HeroModifiers } from './heroModifiers';
import { clampLuckLevel } from './resolveAttack';

/** All-zero bonuses: the "no bonuses at all" case (a unit with no hero). */
export function emptyCombatBonuses(): CombatBonuses {
  return {
    attackBonus: 0,
    defenseBonus: 0,
    meleeOffenseBonusPercent: 0,
    rangedOffenseBonusPercent: 0,
    defensiveArmorReductionPercent: 0,
    luckLevel: 0,
    flatDamageBonus: 0,
    percentDamageBonus: 0,
    magicOffenseBonusPercent: 0,
  };
}

/** The bonuses a hero brings, read from its aggregated modifiers (same-named fields). */
function heroBonuses(heroModifiers: HeroModifiers): Partial<CombatBonuses> {
  return {
    attackBonus: heroModifiers.attackBonus,
    defenseBonus: heroModifiers.defenseBonus,
    meleeOffenseBonusPercent: heroModifiers.meleeOffenseBonusPercent,
    rangedOffenseBonusPercent: heroModifiers.rangedOffenseBonusPercent,
    defensiveArmorReductionPercent: heroModifiers.defensiveArmorReductionPercent,
    luckLevel: heroModifiers.luckLevel,
    // flatDamageBonus / percentDamageBonus / magicOffenseBonusPercent are NOT hero
    // modifiers yet — they arrive with items (a later step).
  };
}

/**
 * Combines two percent-damage bonuses by MULTIPLICATION: +10% and +10% give +21%,
 * not +20% — the same principle as the separate multipliers of the formula
 * ("+X% should feel like +X%", docs/decisions.md, 015).
 */
export function combinePercentBonuses(first: number, second: number): number {
  return ((1 + first / 100) * (1 + second / 100) - 1) * 100;
}

/**
 * Returns a COPY of `unit` with `bonuses` filled from the hero and the extra
 * bonuses. The original object is never modified.
 *
 * `extraBonuses` stands for every source that is not the hero: items, set
 * bonuses, buffs and (for now) the manual fields of the combat sandbox. A
 * missing field (or `null` instead of a hero) counts as 0.
 */
export function buildCombatant(
  unit: CombatUnit,
  heroModifiers: HeroModifiers | null,
  extraBonuses: Partial<CombatBonuses> = {},
): CombatUnit {
  const hero = heroModifiers === null ? {} : heroBonuses(heroModifiers);
  const other = extraBonuses;

  // Two percent-damage sources MULTIPLY, so +10% and +10% give +21% (docs/015).
  const percentDamageBonus = combinePercentBonuses(
    hero.percentDamageBonus ?? 0,
    other.percentDamageBonus ?? 0,
  );

  // Luck is summed first and clamped ONCE, after every source has been added.
  const rawLuckLevel = (hero.luckLevel ?? 0) + (other.luckLevel ?? 0);
  const luckLevel = clampLuckLevel(Math.trunc(rawLuckLevel));

  if (heroModifiers !== null && rawLuckLevel !== luckLevel) {
    heroModifiers.notes.push(
      `luck level clamped from ${rawLuckLevel} to ${luckLevel} (range -3..3)`,
    );
  }

  return {
    ...unit,
    bonuses: {
      attackBonus: (hero.attackBonus ?? 0) + (other.attackBonus ?? 0),
      defenseBonus: (hero.defenseBonus ?? 0) + (other.defenseBonus ?? 0),
      meleeOffenseBonusPercent:
        (hero.meleeOffenseBonusPercent ?? 0) + (other.meleeOffenseBonusPercent ?? 0),
      rangedOffenseBonusPercent:
        (hero.rangedOffenseBonusPercent ?? 0) + (other.rangedOffenseBonusPercent ?? 0),
      defensiveArmorReductionPercent:
        (hero.defensiveArmorReductionPercent ?? 0) + (other.defensiveArmorReductionPercent ?? 0),
      luckLevel,
      // No hero source for these yet — they come with items (a later step).
      flatDamageBonus: other.flatDamageBonus ?? 0,
      percentDamageBonus,
      magicOffenseBonusPercent: other.magicOffenseBonusPercent ?? 0,
    },
  };
}
