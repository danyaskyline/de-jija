/**
 * Attack resolution — a PURE function, independent of the map, the hex field and
 * PixiJS (docs/architecture.md, "Формулы урона").
 *
 * "Pure" means: the result depends only on the arguments (the balance rules are
 * injected; by default they are the in-memory copy loaded once at server startup
 * — see combatRules.ts). Randomness goes through context.random, so tests are
 * fully deterministic.
 *
 * Fixed order of steps (docs/architecture.md):
 *   1. attacker tags         — magic attack or physical?
 *   2. defender tags         — MagicImmune is a FULL block (unlike magic resist)
 *   3. stack damage roll     — damageMin..damageMax per unit, times stackCount
 *   4. flatDamageBonus       — flat damage, applied BEFORE the multiplier
 *   5. attack/defense factor — coefficients from config/combat-rules.json
 *   6. percentDamageBonus    — applied AFTER the multiplier
 *   7. magicResistPercent    — PARTIAL reduction of magic damage, never a block
 *   8. morale penalty        — rules.moralePenaltyMultiplier when penalized
 *   9. minimum damage        — never below rules.minimumDamage, rounded down
 *  10. retaliation           — may the defender answer?
 *
 * Everything deliberately not implemented yet is reported in `notes` instead of
 * being silently ignored. The minimum damage is balance data, not code: it lives
 * in config/combat-rules.json (minimumDamage) and is loaded once at startup.
 */

import type { AbilityTag, CombatUnit } from '@de-jija/shared';

import { getCombatRules, type CombatRules } from './combatRules';

export type AttackContext = {
  /** True when this attack is itself a retaliation (stops endless counter-chains). */
  isRetaliation?: boolean;
  /** Random source, injectable so tests are deterministic. Defaults to Math.random. */
  random?: () => number;

  /** Flat damage added to the stack roll BEFORE the attack/defense multiplier. */
  flatDamageBonus?: number;
  /** Percent damage applied AFTER the attack/defense multiplier (50 means +50%). */
  percentDamageBonus?: number;
  /** Partial reduction of the damage of a MAGIC attack, in percent (25 means -25%). */
  magicResistPercent?: number;
  /** When true the result is multiplied by rules.moralePenaltyMultiplier. */
  isMoralePenalized?: boolean;

  /**
   * Flat bonus to the ATTACKER's attack for this calculation only (hero items,
   * skill tree, ...). The unit objects are never modified — the function stays pure.
   */
  heroAttackBonus?: number;
  /** Flat bonus to the DEFENDER's defense for this calculation only. */
  heroDefenseBonus?: number;

  // --- TODO: hero battle masteries. Always 0 for now, because the source
  // (skill tree / items / something else) is an open design question. No logic
  // is implemented for them: a non-zero value is reported in `notes`, so the
  // placeholder can never be mistaken for a working bonus.
  /** TODO: extra damage for melee attacks (not wired into the formula yet). */
  meleeOffenseBonusPercent?: number;
  /** TODO: extra damage for ranged attacks (not wired into the formula yet). */
  rangedOffenseBonusPercent?: number;
  /** TODO: extra damage for magic attacks (not wired into the formula yet). */
  magicOffenseBonusPercent?: number;
  /** TODO: reduces PHYSICAL damage only (melee + ranged); must NEVER affect magic damage. */
  defensiveArmorReductionPercent?: number;
};

/** Every intermediate value of the formula, exposed for debugging (see the sandbox). */
export type DamageBreakdown = {
  stackRoll: number;
  flatBonusApplied: number;
  afterFlatBonus: number;
  /** Attack used for the multiplier, after heroAttackBonus. */
  effectiveAttack: number;
  /** Defense used for the multiplier, after heroDefenseBonus. */
  effectiveDefense: number;
  attackDefenseMultiplier: number;
  afterAttackDefense: number;
  percentBonusApplied: number;
  afterPercentBonus: number;
  /** Percent of magic resistance actually applied (0 for physical attacks). */
  magicResistApplied: number;
  afterMagicResist: number;
  /** Morale multiplier actually applied (1 when there is no morale penalty). */
  moraleApplied: number;
  finalDamage: number;
};

export type AttackResult = {
  damageDealt: number;
  /** HP left in the whole stack pool, never negative. */
  defenderHpAfter: number;
  /** How many units of the stack are still alive after the hit (0 = stack is gone). */
  stackAliveCount: number;
  /** HP of the front (wounded) unit: from 1 to stats.hp, or 0 when nothing is alive. */
  frontUnitHp: number;
  /** True when no unit of the stack survived this hit (stackAliveCount === 0). */
  defenderDefeated: boolean;
  retaliationTriggered: boolean;
  blockedByImmunity: boolean;
  /** Step-by-step numbers behind damageDealt, for debugging. */
  breakdown: DamageBreakdown;
  /** Human-readable trace of what happened and what was skipped (code language: English). */
  notes: string[];
};

/** True if the unit carries the given ability tag. */
function hasTag(unit: CombatUnit, tag: AbilityTag): boolean {
  return unit.tags.includes(tag);
}

/** Damage of a stack: damageMin..damageMax per unit (inclusive), times stack size. */
function rollStackDamage(attacker: CombatUnit, stackCount: number, random: () => number): number {
  const minRoll = attacker.stats.damageMin * stackCount;
  const maxRoll = attacker.stats.damageMax * stackCount;
  const spread = maxRoll - minRoll + 1;

  return minRoll + Math.floor(random() * spread);
}

/**
 * Attack/defense factor, computed from the balance rules (no hardcoded numbers):
 *   attack > defense: 1 + attackAdvantagePercentPerPoint/100 * (attack - defense), capped
 *   attack < defense: max(floor, 1 - defensePenaltyPercentPerPoint/100 * (defense - attack))
 *   equal:            1
 */
export function attackDefenseMultiplier(
  attack: number,
  defense: number,
  rules: CombatRules,
): number {
  const difference = attack - defense;

  if (difference > 0) {
    const bonus = (rules.attackAdvantagePercentPerPoint / 100) * difference;
    const cap = rules.attackAdvantageCapPercent / 100;

    return Math.min(cap, 1 + bonus);
  }

  if (difference < 0) {
    const penalty = (rules.defensePenaltyPercentPerPoint / 100) * -difference;
    const floor = rules.defensePenaltyFloorPercent / 100;

    return Math.max(floor, 1 - penalty);
  }

  return 1;
}

/** Neutral breakdown used when an attack is fully blocked: nothing was rolled. */
function emptyBreakdown(): DamageBreakdown {
  return {
    stackRoll: 0,
    flatBonusApplied: 0,
    afterFlatBonus: 0,
    effectiveAttack: 0,
    effectiveDefense: 0,
    attackDefenseMultiplier: 0,
    afterAttackDefense: 0,
    percentBonusApplied: 0,
    afterPercentBonus: 0,
    magicResistApplied: 0,
    afterMagicResist: 0,
    moraleApplied: 1,
    finalDamage: 0,
  };
}

/** Result of the damage pipeline (steps 3-9) together with its notes. */
type DamagePipeline = {
  breakdown: DamageBreakdown;
  notes: string[];
};

/** Steps 3-9: turns unit stats and modifiers into finalDamage. */
function calculateDamage(
  attacker: CombatUnit,
  defender: CombatUnit,
  context: AttackContext,
  rules: CombatRules,
  stackCount: number,
  isMagicAttack: boolean,
  random: () => number,
): DamagePipeline {
  const notes: string[] = [];

  // Step 3 — stack damage roll: damageMin..damageMax per unit, times stack size.
  const stackRoll = rollStackDamage(attacker, stackCount, random);

  // Step 4 — flat bonus in damage units, applied BEFORE the multiplier.
  const flatBonusApplied = context.flatDamageBonus ?? 0;
  const afterFlatBonus = stackRoll + flatBonusApplied;

  // Step 5 — attack/defense multiplier from config/combat-rules.json.
  // Hero bonuses (items, skill tree) are added HERE and only here: the unit objects
  // themselves are never modified, so resolveAttack stays a pure function.
  const effectiveAttack = attacker.stats.attack + (context.heroAttackBonus ?? 0);
  const effectiveDefense = defender.stats.defense + (context.heroDefenseBonus ?? 0);
  const attackDefenseFactor = attackDefenseMultiplier(effectiveAttack, effectiveDefense, rules);
  const afterAttackDefense = afterFlatBonus * attackDefenseFactor;

  if ((context.heroAttackBonus ?? 0) !== 0 || (context.heroDefenseBonus ?? 0) !== 0) {
    notes.push(
      `hero bonuses: attack +${context.heroAttackBonus ?? 0} (${attacker.stats.attack} -> ${effectiveAttack}), defense +${context.heroDefenseBonus ?? 0} (${defender.stats.defense} -> ${effectiveDefense})`,
    );
  }

  const advantageCap = rules.attackAdvantageCapPercent / 100;
  const penaltyFloor = rules.defensePenaltyFloorPercent / 100;

  if (attackDefenseFactor === advantageCap) {
    notes.push(
      `attack advantage is capped at x${advantageCap} (attackAdvantageCapPercent=${rules.attackAdvantageCapPercent})`,
    );
  }
  if (effectiveAttack < effectiveDefense && attackDefenseFactor === penaltyFloor) {
    notes.push(
      `defense penalty is floored at x${penaltyFloor} (defensePenaltyFloorPercent=${rules.defensePenaltyFloorPercent})`,
    );
  }

  // Step 6 — percent bonus, applied AFTER the multiplier.
  const percentBonusApplied = context.percentDamageBonus ?? 0;
  const afterPercentBonus = afterAttackDefense * (1 + percentBonusApplied / 100);

  // Step 7 — magic resist: a PARTIAL reduction of magic damage (never a block).
  // MagicImmune (step 2) stays a separate, full block.
  const requestedMagicResist = context.magicResistPercent ?? 0;
  const magicResistApplied = isMagicAttack ? Math.min(100, Math.max(0, requestedMagicResist)) : 0;
  const afterMagicResist = afterPercentBonus * (1 - magicResistApplied / 100);

  if (magicResistApplied > 0) {
    notes.push(
      `magic resist reduced magic damage by ${magicResistApplied}% (partial reduction, not a block)`,
    );
  }
  if (!isMagicAttack && requestedMagicResist > 0) {
    notes.push(`magicResistPercent=${requestedMagicResist} ignored: the attack is physical`);
  }
  if (rules.magicResistIsPercentReduction === false) {
    notes.push(
      'magicResistIsPercentReduction=false is not implemented yet: the percent reduction branch is used',
    );
  }

  // Step 8 — morale penalty (a single multiplier taken from the config).
  const moraleApplied = context.isMoralePenalized === true ? rules.moralePenaltyMultiplier : 1;
  const afterMorale = afterMagicResist * moraleApplied;

  if (moraleApplied !== 1) {
    notes.push(
      `morale penalty applied: x${moraleApplied} (moralePenaltyMultiplier=${rules.moralePenaltyMultiplier})`,
    );
  }

  // Step 9 — round down, but never below the minimum from the balance config.
  const finalDamage = Math.max(rules.minimumDamage, Math.floor(afterMorale));

  if (afterMorale < rules.minimumDamage) {
    notes.push(
      `damage clamped up to minimumDamage=${rules.minimumDamage} (computed ${afterMorale.toFixed(2)})`,
    );
  }

  return {
    breakdown: {
      stackRoll,
      flatBonusApplied,
      afterFlatBonus,
      effectiveAttack,
      effectiveDefense,
      attackDefenseMultiplier: attackDefenseFactor,
      afterAttackDefense,
      percentBonusApplied,
      afterPercentBonus,
      magicResistApplied,
      afterMagicResist,
      moraleApplied,
      finalDamage,
    },
    notes,
  };
}

/**
 * Abilities and masteries that this pure function deliberately does not
 * implement yet. They are reported in `notes`, so a placeholder can never be
 * mistaken for an effect that actually happened.
 */
function pushNotImplementedNotes(
  attacker: CombatUnit,
  context: AttackContext,
  notes: string[],
): void {
  if (hasTag(attacker, 'AreaAttack')) {
    notes.push('AreaAttack: requires hex positioning, not implemented in this pure-function stage');
  }
  if (hasTag(attacker, 'Piercing')) {
    notes.push('Piercing: not implemented in this pure-function stage (no damage-type interaction yet)');
  }

  const masteryStubs: ReadonlyArray<[string, number | undefined]> = [
    ['meleeOffenseBonusPercent', context.meleeOffenseBonusPercent],
    ['rangedOffenseBonusPercent', context.rangedOffenseBonusPercent],
    ['magicOffenseBonusPercent', context.magicOffenseBonusPercent],
    ['defensiveArmorReductionPercent', context.defensiveArmorReductionPercent],
  ];

  for (const [name, value] of masteryStubs) {
    if (typeof value === 'number' && value !== 0) {
      notes.push(
        `${name}=${value} is a placeholder (TODO: hero mastery source is an open design question) — not applied`,
      );
    }
  }
}

export function resolveAttack(
  attacker: CombatUnit,
  defender: CombatUnit,
  context: AttackContext = {},
  rules: CombatRules = getCombatRules(),
): AttackResult {
  const notes: string[] = [];
  const random = context.random ?? Math.random;
  const stackCount = Math.max(1, Math.trunc(attacker.stackCount ?? 1));

  // Step 1 (attacker tags): there is no damage-type system yet, so MagicDamage
  // on the attacker means a magic attack, otherwise a physical one.
  const isMagicAttack = hasTag(attacker, 'MagicDamage');
  notes.push(isMagicAttack ? 'attack type: magic' : 'attack type: physical');
  notes.push(`stack size: ${stackCount}`);

  // Step 2 (defender tags): MagicImmune fully blocks incoming MAGIC. It is not
  // the same thing as magicResistPercent (a partial reduction any unit may have)
  // and it never protects the immune unit's own attacks or retaliations.
  const blockedByImmunity = hasTag(defender, 'MagicImmune') && isMagicAttack;

  let pipeline: DamagePipeline = { breakdown: emptyBreakdown(), notes: [] };

  if (blockedByImmunity) {
    notes.push(`MagicImmune on ${defender.name}: magic attack fully blocked, damage 0`);
  } else {
    // Steps 3-9.
    pipeline = calculateDamage(
      attacker,
      defender,
      context,
      rules,
      stackCount,
      isMagicAttack,
      random,
    );
  }

  notes.push(...pipeline.notes);
  const { breakdown } = pipeline;

  // Step 10 (apply) — HoMM3-style stack model. `currentHp` is the POOL of hit points of
  // the whole stack (it starts at stats.hp * stackCount), so damage eats whole units and
  // the front (wounded) unit carries whatever is left of the pool.
  const unitMaxHp = defender.stats.hp > 0 ? defender.stats.hp : 1;
  const poolBefore = Math.max(0, defender.currentHp);
  const defenderHpAfter = Math.max(0, poolBefore - breakdown.finalDamage);
  const stackAliveCount = defenderHpAfter === 0 ? 0 : Math.ceil(defenderHpAfter / unitMaxHp);
  const frontUnitHp =
    defenderHpAfter === 0 ? 0 : defenderHpAfter - (stackAliveCount - 1) * unitMaxHp;
  const defenderDefeated = stackAliveCount === 0;

  if (defenderDefeated && breakdown.finalDamage > poolBefore) {
    notes.push(
      `damage (${breakdown.finalDamage}) exceeded the stack pool (${poolBefore} HP): the stack is destroyed`,
    );
  }

  // Step 11 (retaliation), one uniform rule for every attack:
  //   - the attacker must not carry NoRetaliation;
  //   - the defender must still be alive — checked through defenderDefeated, so a
  //     stack reduced to 0 HP can never hit back;
  //   - this attack must not itself be a retaliation (no counter-to-the-counter).
  const retaliationTriggered =
    !hasTag(attacker, 'NoRetaliation') && !defenderDefeated && context.isRetaliation !== true;

  if (blockedByImmunity && retaliationTriggered) {
    notes.push(
      'blocked attack still provoked a retaliation (uniform rule, see docs/decisions.md 011)',
    );
  }

  pushNotImplementedNotes(attacker, context, notes);

  return {
    damageDealt: breakdown.finalDamage,
    defenderHpAfter,
    stackAliveCount,
    frontUnitHp,
    defenderDefeated,
    retaliationTriggered,
    blockedByImmunity,
    breakdown,
    notes,
  };
}
