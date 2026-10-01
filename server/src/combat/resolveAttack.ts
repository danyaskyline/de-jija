/**
 * Attack resolution — a PURE function, independent of the map, the hex field and
 * PixiJS (docs/architecture.md, "Формулы урона").
 *
 * "Pure" means: the result depends only on the arguments (the balance rules are
 * injected; by default they are the in-memory copy loaded once at server startup —
 * see combatRules.ts). Randomness goes through context.random, so tests are fully
 * deterministic.
 *
 * Fixed order of steps (docs/architecture.md):
 *   1. attacker tags          — is the attack classified as magical?
 *   2. defender tags          — MagicImmune fully blocks a magical attack
 *   3. stack damage roll      — k = min(stackCount, rules.damageRollSamples) independent rolls of
 *                              damageMin..damageMax, summed and scaled by stackCount/k.
 *                              Not rounded here: Math.floor happens once in step 9.
 *   4. flatDamageBonus        — flat damage, applied BEFORE the multiplier
 *   5. attack/defense factor  — +heroAttackBonus / -heroDefenseBonus, then config
 *   6. percentDamageBonus     — applied AFTER the multiplier
 *   7. luck                   — a CHANCE to trigger, not a smooth multiplier
 *   8. morale bonus attack    — only when THIS hit is a morale-driven extra attack
 *   9. minimum damage         — never below rules.minimumDamage, rounded down
 *  10. apply to the stack HP pool
 *  11. retaliation flag
 *
 * Magic damage is a SIMPLIFIED TEST ABSTRACTION at this stage: the `MagicDamage` tag
 * only classifies an attack as magical, and `MagicImmune` fully blocks such an attack.
 * It is NOT a spell system — spells, spell power and magic resistance belong to a
 * future resolveSpell, which is deliberately out of scope here.
 *
 * Everything deliberately not implemented yet is reported in `notes` instead of being
 * silently ignored. Balance numbers live in config/combat-rules.json, loaded once.
 */

import type { AbilityTag, CombatUnit } from '@de-jija/shared';

import { getCombatRules, type CombatRules } from './combatRules';

export type AttackContext = {
  /** True when this attack is itself a retaliation (stops endless counter-chains). */
  isRetaliation?: boolean;
  /** Random source, injectable so tests are deterministic. Defaults to Math.random. */
  random?: () => number;
  /**
   * Fixes the luck roll (0..0.99) so the chance-based luck can be tested
   * deterministically. It does NOT affect the damage roll.
   */
  fixedLuckRoll?: number;

  /** Flat damage added to the stack roll BEFORE the attack/defense multiplier. */
  flatDamageBonus?: number;
  /** Percent damage applied AFTER the attack/defense multiplier (50 means +50%). */
  percentDamageBonus?: number;
  /**
   * True ONLY when this hit is the result of a morale-driven extra attack.
   * Morale itself is a turn-order system (extra attack or skipped turn) and does
   * NOT weaken ordinary attacks, so an ordinary hit has no morale modifier at all.
   */
  isMoraleBonusAttack?: boolean;

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
  /** Luck level of the attacker at the moment of the attack (-3..3, 0 = no luck). */
  luckLevel: number;
  /** Chance the luck effect had to trigger, in percent (0 when luckLevel is 0). */
  luckTriggerChancePercent: number;
  /** True when the luck roll succeeded. */
  luckTriggered: boolean;
  /** Luck multiplier actually applied (1 when luck did not trigger). */
  luckMultiplierApplied: number;
  afterLuck: number;
  /** True when this hit happened thanks to a morale extra attack. */
  moraleBonusAttackApplied: boolean;
  /** Morale multiplier actually applied (1 for an ordinary attack). */
  moraleMultiplier: number;
  afterMoraleBonus: number;
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

type StackDamageRoll = {
  /** The scaled total: sum of the samples times stackCount / samples. */
  total: number;
  /** How many independent rolls were actually drawn: k = min(stackCount, maxSamples). */
  samples: number;
  /** stackCount / samples — exactly 1 for stacks up to maxSamples (no scaling). */
  scale: number;
};

/**
 * Damage of a stack, drawn with a LIMITED number of samples and then scaled
 * (docs/decisions.md, 014):
 *   k     = min(stackCount, maxSamples)
 *   sum   = k independent rolls of damageMin..damageMax (inclusive), like for one unit
 *   total = sum * (stackCount / k)
 *
 * Two properties this buys us:
 *   - constant roll cost: 10 rolls for a 1000-unit stack instead of 1000 rolls;
 *   - a relative spread that does not fade away on big stacks the way an honest
 *     per-unit roll would (fewer samples = noisier result, same idea as HoMM3).
 *
 * NOT rounded here on purpose: Math.floor happens once in step 9, so a fractional
 * total is fine and no damage is lost before the attack/defense multiplier.
 */
function rollStackDamage(
  attacker: CombatUnit,
  stackCount: number,
  random: () => number,
  maxSamples: number,
): StackDamageRoll {
  const { damageMin, damageMax } = attacker.stats;
  const spread = damageMax - damageMin + 1;
  const samples = Math.min(stackCount, Math.max(1, Math.trunc(maxSamples)));

  let sum = 0;
  for (let i = 0; i < samples; i++) {
    sum += damageMin + Math.floor(random() * spread);
  }

  return { total: sum * (stackCount / samples), samples, scale: stackCount / samples };
}

/** Luck level of the attacker, clamped to -3..3 (0 = no luck). */
function readLuckLevel(attacker: CombatUnit): number {
  const level = Math.trunc(attacker.luckLevel ?? 0);

  return Math.max(-3, Math.min(3, level));
}

/**
 * Attack/defense factor, computed from the balance rules (no hardcoded numbers):
 *   attack > defense: 1 + attackAdvantagePercentPerPoint/100 * (attack - defense), capped
 *   attack < defense: max(floor, 1 - defensePenaltyPercentPerPoint/100 * (defense - attack))
 *   equal:            1
 * The floor is defensePenaltyFloorPercent — 30% (x0.3) in the original HoMM3.
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
    luckLevel: 0,
    luckTriggerChancePercent: 0,
    luckTriggered: false,
    luckMultiplierApplied: 1,
    afterLuck: 0,
    moraleBonusAttackApplied: false,
    moraleMultiplier: 1,
    afterMoraleBonus: 0,
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
  luckLevel: number,
  random: () => number,
): DamagePipeline {
  const notes: string[] = [];

  // Step 3 — stack damage roll: k = min(stackCount, damageRollSamples) independent rolls
  // of damageMin..damageMax, summed and scaled by stackCount/k (docs/decisions.md, 014).
  const stackDamage = rollStackDamage(attacker, stackCount, random, rules.damageRollSamples);
  const stackRoll = stackDamage.total;

  notes.push(`damage roll: ${stackDamage.samples} sample(s), scaled x${stackDamage.scale}`);

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

  // Step 7 — luck is a CHANCE to trigger, not a smooth multiplier. The chance comes
  // from luckChanceByLevel by |luckLevel|; only on a trigger the matching multiplier
  // (positive or negative) is applied to the damage accumulated so far.
  const luckTriggerChancePercent =
    luckLevel === 0 ? 0 : (rules.luckChanceByLevel[String(Math.abs(luckLevel))] ?? 0);
  let luckTriggered = false;
  let luckMultiplierApplied = 1;

  if (luckLevel === 0) {
    notes.push('no luck: luckLevel is 0');
  } else {
    const roll = context.fixedLuckRoll ?? random();
    luckTriggered = roll < luckTriggerChancePercent / 100;

    if (luckTriggered) {
      luckMultiplierApplied =
        luckLevel > 0 ? rules.luckPositiveMultiplier : rules.luckNegativeMultiplier;
      notes.push(
        `luck ${luckLevel > 0 ? 'bonus' : 'malus'} triggered (chance ${luckTriggerChancePercent}%, roll ${roll.toFixed(2)}): x${luckMultiplierApplied}`,
      );
    } else {
      notes.push(`luck did not trigger (chance ${luckTriggerChancePercent}%, roll ${roll.toFixed(2)})`);
    }
  }

  const afterLuck = afterPercentBonus * luckMultiplierApplied;

  // Step 8 — morale. ONLY a hit that IS a morale extra attack is weakened; an ordinary
  // attack has no morale modifier at all (morale is a turn-order system, not a damage buff).
  const moraleBonusAttackApplied = context.isMoraleBonusAttack === true;
  const moraleMultiplier = moraleBonusAttackApplied ? rules.moraleBonusAttackMultiplier : 1;
  const afterMoraleBonus = afterLuck * moraleMultiplier;

  if (moraleBonusAttackApplied) {
    notes.push(
      `morale extra attack: damage x${moraleMultiplier} (moraleBonusAttackMultiplier=${rules.moraleBonusAttackMultiplier})`,
    );
  }

  // Step 9 — round down, but never below the minimum from the balance config.
  const finalDamage = Math.max(rules.minimumDamage, Math.floor(afterMoraleBonus));

  if (afterMoraleBonus < rules.minimumDamage) {
    notes.push(
      `damage clamped up to minimumDamage=${rules.minimumDamage} (computed ${afterMoraleBonus.toFixed(2)})`,
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
      luckLevel,
      luckTriggerChancePercent,
      luckTriggered,
      luckMultiplierApplied,
      afterLuck,
      moraleBonusAttackApplied,
      moraleMultiplier,
      afterMoraleBonus,
      finalDamage,
    },
    notes,
  };
}

/**
 * Abilities and masteries that this pure function deliberately does not implement yet.
 * They are reported in `notes`, so a placeholder can never be mistaken for an effect
 * that actually happened.
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
  const luckLevel = readLuckLevel(attacker);

  // Step 1 (attacker tags): there is no spell system here — MagicDamage only classifies
  // the attack as magical so that MagicImmune (step 2) has something to block.
  const isMagicAttack = hasTag(attacker, 'MagicDamage');
  notes.push(isMagicAttack ? 'attack type: magical' : 'attack type: physical');
  notes.push(`stack size: ${stackCount}`);

  // Step 2 (defender tags): MagicImmune fully blocks an incoming MAGICAL attack. It never
  // protects the immune unit's own attacks or its retaliations.
  const blockedByImmunity = hasTag(defender, 'MagicImmune') && isMagicAttack;

  let pipeline: DamagePipeline = { breakdown: emptyBreakdown(), notes: [] };

  if (blockedByImmunity) {
    notes.push(`MagicImmune on ${defender.name}: magical attack fully blocked, damage 0`);
  } else {
    // Steps 3-9.
    pipeline = calculateDamage(attacker, defender, context, rules, stackCount, luckLevel, random);
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

  // Step 11 (retaliation) — a retaliation is a FULL re-invocation of resolveAttack done by
  // the caller (roles swapped, isRetaliation: true): it goes through the whole formula with
  // all modifiers, including the luck of the unit that answers. There is deliberately NO
  // global "a retaliation is weaker" coefficient anywhere.
  //
  // TODO (known future case, NOT implemented): in the original, a ranged unit forced into
  // melee answers with a WEAKENED melee attack instead of its normal damage. That will be a
  // separate ability tag (e.g. WeakMeleeRetaliation) later — see docs/architecture.md.
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