/**
 * Attack resolution — a PURE function, independent of the map, the hex field and
 * PixiJS (docs/combat-formula.md, docs/architecture.md).
 *
 * "Pure" means: the result depends only on the arguments (the balance rules are
 * injected; by default they are the in-memory copy loaded once at server startup —
 * see combatRules.ts). Randomness goes through context.random, so tests are fully
 * deterministic.
 *
 * Fixed order of steps (docs/combat-formula.md):
 *   1. attacker tags          — is the attack classified as magical?
 *   2. defender tags          — MagicImmune fully blocks a magical attack
 *   3. stack damage roll      — mode from rules.damageRollMode:
 *                              "uniform": one roll over damageMin*N .. damageMax*N;
 *                              "sampled": k = min(N, damageRollSamples) per-unit rolls,
 *                              summed and scaled by N/k. Not rounded here.
 *   4. flatDamageBonus        — flat damage, applied BEFORE the multiplier
 *   5. attack/defense factor  — +heroAttackBonus / -heroDefenseBonus, then config caps
 *   6. offense skill          — melee/ranged hero skill, PHYSICAL attacks only
 *   7. percentDamageBonus     — applied AFTER the multiplier
 *   8. luck                   — a CHANCE to trigger, not a smooth multiplier
 *   9. armor                  — defensiveArmorReductionPercent, PHYSICAL attacks only
 *  10. morale bonus attack    — only when THIS hit is a morale-driven extra attack
 *  11. round half up          — roundDamage(), then never below rules.minimumDamage
 *  12. apply to the stack HP pool
 *  13. retaliation flag
 *
 * Each percent bonus is a SEPARATE factor, so "+X%" always changes the damage by exactly
 * that share and the order of factors does not matter (docs/decisions.md, 015).
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
   * Flat bonus to the ATTACKER's attack for this calculation only (hero stats,
   * items, ...). The unit objects are never modified — the function stays pure.
   */
  heroAttackBonus?: number;
  /** Flat bonus to the DEFENDER's defense for this calculation only. */
  heroDefenseBonus?: number;

  /**
   * Extra luck levels added to the attacker's OWN luckLevel for this hit only
   * (hero "Удача" skill). resolveAttack adds it, then clamps the total to -3..3 —
   * if the clamp actually changes the value, a note is written.
   */
  luckBonus?: number;

  /**
   * Whether this attack is melee or ranged. It decides WHICH offense skill applies
   * (meleeOffenseBonusPercent vs rangedOffenseBonusPercent). Defaults to "melee" so
   * existing callers and tests keep working unchanged.
   */
  attackKind?: 'melee' | 'ranged';

  /** Hero skill (offense): extra damage for MELEE attacks, in percent. */
  meleeOffenseBonusPercent?: number;
  /** Hero skill (archery): extra damage for RANGED attacks, in percent. */
  rangedOffenseBonusPercent?: number;
  /**
   * TODO (placeholder): extra damage for MAGIC attacks. The source (hero magic
   * mastery) is an open design question, so no logic is implemented for it: a
   * non-zero value is reported in `notes`, never applied (docs/decisions.md, 016).
   */
  magicOffenseBonusPercent?: number;
  /**
   * Hero skill (armorer): reduces incoming PHYSICAL damage (melee + ranged) by this
   * percent. It must NEVER affect a magical attack — a non-zero value on a magic hit
   * is reported in `notes` and not applied.
   */
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
  /** Offense skill applied (melee or ranged), in percent; 0 when none applies. */
  offenseSkillPercentApplied: number;
  afterOffenseSkill: number;
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
  /** Armor reduction applied to this hit, in percent; 0 for magic or when none. */
  armorReductionApplied: number;
  afterArmor: number;
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
  /** The total damage of the whole stack, before any multipliers. */
  total: number;
  /** How many independent rolls were drawn (1 in "uniform" mode). */
  samples: number;
  /** Human-readable note describing the mode and the numbers used. */
  note: string;
};

/**
 * Damage of the whole stack (step 3). The mode comes from rules.damageRollMode
 * (docs/decisions.md, 015):
 *
 *   "uniform" (default) — ONE uniform integer roll over the whole stack range
 *     damageMin*stackCount .. damageMax*stackCount (inclusive, like before 014). The
 *     declared range is honest: every value inside it can really come up.
 *
 *   "sampled" — k = min(stackCount, damageRollSamples) independent per-unit rolls of
 *     damageMin..damageMax, summed and scaled by stackCount/k (docs/decisions.md, 014):
 *     constant roll cost and a relative spread that does not fade on big stacks.
 *
 * NOT rounded here on purpose: the single rounding happens at the very end (step 11),
 * so a fractional total in "sampled" mode is fine and no damage is lost early.
 */
function rollStackDamage(
  attacker: CombatUnit,
  stackCount: number,
  random: () => number,
  rules: CombatRules,
): StackDamageRoll {
  const { damageMin, damageMax } = attacker.stats;

  if (rules.damageRollMode === 'uniform') {
    const lowest = damageMin * stackCount;
    const highest = damageMax * stackCount;
    const span = highest - lowest + 1;
    const total = lowest + Math.floor(random() * span);

    return { total, samples: 1, note: `damage roll: uniform over ${lowest}..${highest}` };
  }

  const spread = damageMax - damageMin + 1;
  const samples = Math.min(stackCount, Math.max(1, Math.trunc(rules.damageRollSamples)));

  let sum = 0;
  for (let i = 0; i < samples; i++) {
    sum += damageMin + Math.floor(random() * spread);
  }

  const scale = stackCount / samples;

  return {
    total: sum * scale,
    samples,
    note: `damage roll: ${samples} sample(s), scaled x${scale}`,
  };
}

/** Luck and morale levels are always kept inside this range (docs/decisions.md, 015). */
export const LUCK_LEVEL_MIN = -3;
export const LUCK_LEVEL_MAX = 3;

/** Clamps a luck/morale level to the -3..3 range. */
export function clampLuckLevel(value: number): number {
  return Math.max(LUCK_LEVEL_MIN, Math.min(LUCK_LEVEL_MAX, value));
}

/** Luck level of the attacker, clamped to -3..3 (0 = no luck). */
function readLuckLevel(attacker: CombatUnit): number {
  return clampLuckLevel(Math.trunc(attacker.luckLevel ?? 0));
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

/**
 * The single rounding of the whole formula: round half up, "mathematically"
 * (docs/decisions.md, 015). The tiny epsilon compensates for float error in values
 * that are mathematically exactly .5 (e.g. 2.4999999999999996 -> 3, not 2).
 */
export function roundDamage(value: number): number {
  return Math.round(value + 1e-9);
}

/**
 * Offense skill (step 6): the melee or ranged hero skill, in percent. Only a PHYSICAL
 * attack gets it; a magical attack never does. A non-zero value that does NOT fit the
 * hit is reported in `notes` ("not applied: ...") instead of being silently dropped.
 */
function resolveOffenseSkillPercent(
  context: AttackContext,
  isMagicAttack: boolean,
  notes: string[],
): number {
  const melee = context.meleeOffenseBonusPercent ?? 0;
  const ranged = context.rangedOffenseBonusPercent ?? 0;

  if (isMagicAttack) {
    if (melee !== 0 || ranged !== 0) {
      notes.push('offense skill (melee/ranged) not applied: magical attack');
    }

    return 0;
  }

  const attackKind = context.attackKind ?? 'melee';

  if (attackKind === 'melee') {
    if (ranged !== 0) {
      notes.push(`rangedOffenseBonusPercent=${ranged} not applied: melee attack`);
    }

    return melee;
  }

  if (melee !== 0) {
    notes.push(`meleeOffenseBonusPercent=${melee} not applied: ranged attack`);
  }

  return ranged;
}

/**
 * Armor (step 9): armorer reduces incoming PHYSICAL damage only. Against a magical
 * attack a non-zero value is reported in `notes` and never applied
 * (docs/decisions.md, 015 and 016).
 */
function resolveArmorReductionPercent(
  context: AttackContext,
  isMagicAttack: boolean,
  notes: string[],
): number {
  const armor = context.defensiveArmorReductionPercent ?? 0;

  if (armor === 0) {
    return 0;
  }

  if (isMagicAttack) {
    notes.push(
      `defensiveArmorReductionPercent=${armor} not applied: magical attack (armor reduces physical damage only)`,
    );

    return 0;
  }

  return armor;
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
    offenseSkillPercentApplied: 0,
    afterOffenseSkill: 0,
    percentBonusApplied: 0,
    afterPercentBonus: 0,
    luckLevel: 0,
    luckTriggerChancePercent: 0,
    luckTriggered: false,
    luckMultiplierApplied: 1,
    afterLuck: 0,
    armorReductionApplied: 0,
    afterArmor: 0,
    moraleBonusAttackApplied: false,
    moraleMultiplier: 1,
    afterMoraleBonus: 0,
    finalDamage: 0,
  };
}

/** Result of the damage pipeline (steps 3-11) together with its notes. */
type DamagePipeline = {
  breakdown: DamageBreakdown;
  notes: string[];
};

/** Steps 3-11: turns unit stats and modifiers into finalDamage. */
function calculateDamage(
  attacker: CombatUnit,
  defender: CombatUnit,
  context: AttackContext,
  rules: CombatRules,
  stackCount: number,
  luckLevel: number,
  isMagicAttack: boolean,
  random: () => number,
): DamagePipeline {
  const notes: string[] = [];

  // Step 3 — stack damage roll. The mode (uniform / sampled) comes from the config.
  const stackDamage = rollStackDamage(attacker, stackCount, random, rules);
  const stackRoll = stackDamage.total;

  notes.push(`damage roll mode: ${rules.damageRollMode}`);
  notes.push(stackDamage.note);

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

  // Step 6 — offense skill (melee or ranged): only a PHYSICAL attack gets it. It is a
  // SEPARATE factor, so "+X%" changes the damage by exactly that share (decisions 015).
  const offenseSkillPercentApplied = resolveOffenseSkillPercent(context, isMagicAttack, notes);
  const afterOffenseSkill = afterAttackDefense * (1 + offenseSkillPercentApplied / 100);

  // Step 7 — percent bonus, applied AFTER the multiplier.
  const percentBonusApplied = context.percentDamageBonus ?? 0;
  const afterPercentBonus = afterOffenseSkill * (1 + percentBonusApplied / 100);

  // Step 8 — luck is a CHANCE to trigger, not a smooth multiplier. The chance comes
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

  // Step 9 — armor: armorer reduces PHYSICAL damage only; a magic hit gets nothing.
  const armorReductionApplied = resolveArmorReductionPercent(context, isMagicAttack, notes);
  const afterArmor = afterLuck * (1 - armorReductionApplied / 100);

  // Step 10 — morale. ONLY a hit that IS a morale extra attack is weakened; an ordinary
  // attack has no morale modifier at all (morale is a turn-order system, not a damage buff).
  const moraleBonusAttackApplied = context.isMoraleBonusAttack === true;
  const moraleMultiplier = moraleBonusAttackApplied ? rules.moraleBonusAttackMultiplier : 1;
  const afterMoraleBonus = afterArmor * moraleMultiplier;

  if (moraleBonusAttackApplied) {
    notes.push(
      `morale extra attack: damage x${moraleMultiplier} (moraleBonusAttackMultiplier=${rules.moraleBonusAttackMultiplier})`,
    );
  }

  // Step 11 — ONE rounding for the whole formula: round half up (015), then the minimum.
  const finalDamage = Math.max(rules.minimumDamage, roundDamage(afterMoraleBonus));

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
      offenseSkillPercentApplied,
      afterOffenseSkill,
      percentBonusApplied,
      afterPercentBonus,
      luckLevel,
      luckTriggerChancePercent,
      luckTriggered,
      luckMultiplierApplied,
      afterLuck,
      armorReductionApplied,
      afterArmor,
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
    ['magicOffenseBonusPercent', context.magicOffenseBonusPercent],
  ];

  for (const [name, value] of masteryStubs) {
    if (typeof value === 'number' && value !== 0) {
      notes.push(
        `${name}=${value} is a placeholder (TODO: hero magic mastery source is an open design question) — not applied`,
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

  // Luck = the unit's own level + any hero luck bonus, always clamped to -3..3 (015).
  // If the clamp really changed the value, say so instead of silently trimming it.
  const rawLuckLevel = readLuckLevel(attacker) + Math.trunc(context.luckBonus ?? 0);
  const luckLevel = clampLuckLevel(rawLuckLevel);
  if (rawLuckLevel !== luckLevel) {
    notes.push(`luck level clamped from ${rawLuckLevel} to ${luckLevel} (range -3..3)`);
  }

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
    // Steps 3-11.
    pipeline = calculateDamage(
      attacker,
      defender,
      context,
      rules,
      stackCount,
      luckLevel,
      isMagicAttack,
      random,
    );
  }

  notes.push(...pipeline.notes);
  const { breakdown } = pipeline;

  // Step 12 (apply) — HoMM3-style stack model. `currentHp` is the POOL of hit points of
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

  // Step 13 (retaliation) — a retaliation is a FULL re-invocation of resolveAttack done by
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