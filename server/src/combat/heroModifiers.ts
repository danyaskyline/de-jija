/**
 * Hero modifiers — the bridge between a hero loadout (DATA: stats + skill levels) and the
 * combat formula. This is server-side logic, NOT a debug tool (docs/decisions.md, 016).
 *
 * Flow:
 *   HeroLoadout (stats + skills)  --aggregateHeroModifiers-->  HeroModifiers
 *   HeroModifiers (attacker & defender)  --applyHeroModifiersToContext-->  AttackContext
 *
 * A skill never touches the formula until its target is supported by resolveAttack; the
 * aggregate reports everything it could not use in `unused` / `notes`, so a stored number
 * can never be mistaken for a working bonus (docs/combat-formula.md).
 */

import { clampLuckLevel, type AttackContext } from './resolveAttack';
import { findSkill, type SkillTarget, type SkillsData } from './skills';

/** A hero's base stats. spellPower and knowledge are placeholders for a future spell system. */
export type HeroStats = {
  attack: number;
  defense: number;
  spellPower: number;
  knowledge: number;
};

/** One learned skill and its level (1 = basic, 2 = advanced, 3 = expert). */
export type HeroSkillSlot = {
  skillId: string;
  level: 1 | 2 | 3;
};

/** What a hero brings to a battle: stats plus up to 6 skills (no repeats). */
export type HeroLoadout = {
  stats: HeroStats;
  skills: HeroSkillSlot[];
};

/** Everything a hero contributes to one attack, already aggregated and clamped. */
export type HeroModifiers = {
  attackBonus: number;
  defenseBonus: number;
  meleeOffenseBonusPercent: number;
  rangedOffenseBonusPercent: number;
  defensiveArmorReductionPercent: number;
  /** Hero "Удача" skill, clamped to -3..3. */
  luckLevel: number;
  /** Hero "Лидерство" skill, clamped to -3..3 (turn-order; not used by resolveAttack yet). */
  moraleLevel: number;
  spellPower: number;
  knowledge: number;
  /** Values that are stored/aggregated but do NOT feed resolveAttack yet (docs/decisions.md, 016). */
  unused: {
    tacticsRows: number;
    spellDamagePercent: number;
    magicResistancePercent: number;
    moraleLevel: number;
    spellPower: number;
    knowledge: number;
  };
  /** Human-readable trace, in English (code language — docs/conventions.md). */
  notes: string[];
};

/** A hero may learn at most this many skills. */
export const MAX_HERO_SKILLS = 6;

/** All-zero modifiers: the "no hero" case (docs/decisions.md, 016). */
export function emptyHeroModifiers(): HeroModifiers {
  return {
    attackBonus: 0,
    defenseBonus: 0,
    meleeOffenseBonusPercent: 0,
    rangedOffenseBonusPercent: 0,
    defensiveArmorReductionPercent: 0,
    luckLevel: 0,
    moraleLevel: 0,
    spellPower: 0,
    knowledge: 0,
    unused: {
      tacticsRows: 0,
      spellDamagePercent: 0,
      magicResistancePercent: 0,
      moraleLevel: 0,
      spellPower: 0,
      knowledge: 0,
    },
    notes: [],
  };
}

/** Validates that every hero stat is a whole number >= 0. */
function validateStats(stats: HeroStats): void {
  const fields: ReadonlyArray<keyof HeroStats> = ['attack', 'defense', 'spellPower', 'knowledge'];

  for (const field of fields) {
    const value = stats?.[field];

    if (!Number.isInteger(value) || (value as number) < 0) {
      throw new Error(
        `stats.${field} героя должно быть целым числом не меньше 0, а получено: ${JSON.stringify(value)}`,
      );
    }
  }
}

/**
 * Turns a hero loadout (stats + up to 6 skills) into one aggregated HeroModifiers object.
 * A null/undefined loadout means "no hero": all zeros (docs/decisions.md, 016).
 *
 * Validation errors are thrown with a readable message (an unknown skill id, a repeat, a
 * bad level or too many skills must never be silently ignored).
 */
export function aggregateHeroModifiers(
  loadout: HeroLoadout | null | undefined,
  skillsData: SkillsData,
): HeroModifiers {
  const result = emptyHeroModifiers();

  if (!loadout) {
    result.notes.push('no hero loadout: all modifiers are 0');

    return result;
  }

  validateStats(loadout.stats);

  result.attackBonus = loadout.stats.attack;
  result.defenseBonus = loadout.stats.defense;
  result.spellPower = loadout.stats.spellPower;
  result.knowledge = loadout.stats.knowledge;

  const skills = loadout.skills ?? [];
  if (skills.length > MAX_HERO_SKILLS) {
    throw new Error(
      `В loadout героя не больше ${MAX_HERO_SKILLS} навыков, а передано: ${skills.length}`,
    );
  }

  const totals: Record<SkillTarget, number> = {
    meleeOffenseBonusPercent: 0,
    rangedOffenseBonusPercent: 0,
    defensiveArmorReductionPercent: 0,
    luckLevel: 0,
    moraleLevel: 0,
    tacticsRows: 0,
    spellDamagePercent: 0,
    magicResistancePercent: 0,
  };

  const seen = new Set<string>();

  for (const slot of skills) {
    if (!slot || typeof slot.skillId !== 'string') {
      throw new Error('В loadout героя каждый навык должен иметь skillId (строку)');
    }
    if (slot.level !== 1 && slot.level !== 2 && slot.level !== 3) {
      throw new Error(
        `Навык "${slot.skillId}": уровень должен быть 1, 2 или 3, а получено: ${JSON.stringify(slot.level)}`,
      );
    }
    if (seen.has(slot.skillId)) {
      throw new Error(`Навык "${slot.skillId}" указан в loadout героя дважды`);
    }
    seen.add(slot.skillId);

    const skill = findSkill(skillsData, slot.skillId);
    if (!skill) {
      throw new Error(`Неизвестный навык "${slot.skillId}" в loadout героя`);
    }

    for (const effect of skill.effects) {
      const value = effect.perLevel[slot.level - 1];
      totals[effect.target] += value;
      result.notes.push(`${skill.name} (уровень ${slot.level}): ${effect.target} += ${value}`);
    }
  }

  result.meleeOffenseBonusPercent = totals.meleeOffenseBonusPercent;
  result.rangedOffenseBonusPercent = totals.rangedOffenseBonusPercent;
  result.defensiveArmorReductionPercent = totals.defensiveArmorReductionPercent;
  result.luckLevel = clampLuckLevel(totals.luckLevel);
  result.moraleLevel = clampLuckLevel(totals.moraleLevel);

  result.notes.push(`attack bonus ${result.attackBonus}, defense bonus ${result.defenseBonus}`);

  if (totals.luckLevel !== result.luckLevel) {
    result.notes.push(
      `luck level clamped from ${totals.luckLevel} to ${result.luckLevel} (range -3..3)`,
    );
  }
  if (totals.moraleLevel !== result.moraleLevel) {
    result.notes.push(
      `morale level clamped from ${totals.moraleLevel} to ${result.moraleLevel} (range -3..3)`,
    );
  }

  result.unused = {
    tacticsRows: totals.tacticsRows,
    spellDamagePercent: totals.spellDamagePercent,
    magicResistancePercent: totals.magicResistancePercent,
    moraleLevel: result.moraleLevel,
    spellPower: result.spellPower,
    knowledge: result.knowledge,
  };

  addUnusedNotes(result.unused, result.notes);

  return result;
}

/** Adds one note per stored-but-unused value, so nothing can look like a working bonus. */
function addUnusedNotes(unused: HeroModifiers['unused'], notes: string[]): void {
  if (unused.tacticsRows !== 0) {
    notes.push(`tacticsRows=${unused.tacticsRows}: needs the hex battlefield — not applied`);
  }
  if (unused.spellDamagePercent !== 0) {
    notes.push(
      `spellDamagePercent=${unused.spellDamagePercent}: belongs to the future resolveSpell — not applied`,
    );
  }
  if (unused.magicResistancePercent !== 0) {
    notes.push(
      `magicResistancePercent=${unused.magicResistancePercent}: belongs to the future resolveSpell — not applied`,
    );
  }
  if (unused.moraleLevel !== 0) {
    notes.push(
      `moraleLevel=${unused.moraleLevel}: morale is a turn-order system — not applied in resolveAttack`,
    );
  }
  if (unused.spellPower !== 0) {
    notes.push(`spellPower=${unused.spellPower}: reserved for the future spell system — not applied`);
  }
  if (unused.knowledge !== 0) {
    notes.push(`knowledge=${unused.knowledge}: reserved for the future spell system — not applied`);
  }
}

/**
 * Builds the AttackContext for ONE side of a battle from the two heroes' modifiers.
 *
 * The bonuses are resolved BY ROLE (docs/decisions.md, 016):
 *   - the ATTACKER's hero provides attack, melee/ranged offense and luck;
 *   - the DEFENDER's hero provides defense and armor.
 *
 * Sources ADD UP instead of overwriting each other (docs/decisions.md, 017): whatever is
 * already in `baseContext` (the manual fields of the sandbox, later items and buffs) is kept
 * and the hero's value is added on top. A hero must never silently cancel a bonus that came
 * from somewhere else.
 *
 * Because the bonuses are role-based, a retaliation needs no special block: it is a full
 * re-invocation with the roles swapped, so the caller simply passes the two modifier
 * objects the other way round (attackerMods <-> defenderMods).
 */
export function applyHeroModifiersToContext(
  baseContext: AttackContext,
  attackerMods: HeroModifiers,
  defenderMods: HeroModifiers,
): AttackContext {
  /** base value from the context + value from the hero. */
  const add = (fromBase: number | undefined, fromHero: number): number => (fromBase ?? 0) + fromHero;

  return {
    ...baseContext,
    heroAttackBonus: add(baseContext.heroAttackBonus, attackerMods.attackBonus),
    heroDefenseBonus: add(baseContext.heroDefenseBonus, defenderMods.defenseBonus),
    meleeOffenseBonusPercent: add(
      baseContext.meleeOffenseBonusPercent,
      attackerMods.meleeOffenseBonusPercent,
    ),
    rangedOffenseBonusPercent: add(
      baseContext.rangedOffenseBonusPercent,
      attackerMods.rangedOffenseBonusPercent,
    ),
    defensiveArmorReductionPercent: add(
      baseContext.defensiveArmorReductionPercent,
      defenderMods.defensiveArmorReductionPercent,
    ),
    // Luck is already additive; the total is clamped because luck has a -3..3 range.
    luckBonus: clampLuckLevel((baseContext.luckBonus ?? 0) + attackerMods.luckLevel),
  };
}
