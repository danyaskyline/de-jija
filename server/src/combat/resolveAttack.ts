/**
 * Attack resolution — a PURE function, deliberately independent of the map,
 * the hex field and PixiJS (docs/architecture.md, "Формулы урона").
 *
 * "Pure" means: the result depends only on the arguments. Randomness is
 * injected through context.random, so tests are fully deterministic.
 *
 * Fixed order of steps, as required by docs/architecture.md
 * ("теги атакующего → теги защитника → базовый расчёт по статам → ... → применение"):
 *
 *   Step 1. Attacker tags   — is this attack magical at all?
 *   Step 2. Defender tags   — MagicImmune blocks incoming magic completely.
 *   Step 3. Base damage     — roll damageMin..damageMax, subtract defender defense.
 *   Step 4. Apply           — currentHp - damage.
 *   Step 5. Retaliation     — may the defender answer?
 *   Step 6. Not implemented — report what still needs the real battle layer.
 *
 * Morale/luck modifiers from docs/architecture.md are NOT here yet (no such
 * stats exist in this iteration).
 */

import type { AbilityTag, CombatUnit } from '@de-jija/shared';

/**
 * A hit always deals at least this much damage, even when the defender's defense
 * is higher than the damage roll.
 *
 * Why a floor at all: without it a high-defense unit becomes literally immortal
 * against cheap units — the "spiral of invincibility" that docs/game-design.md
 * wants to avoid (newcomers must stay able to touch veterans).
 */
export const MIN_DAMAGE = 1;

export type AttackContext = {
  /** True when this attack is itself a retaliation (stops endless counter-chains). */
  isRetaliation?: boolean;
  /** Random source, injectable so tests are deterministic. Defaults to Math.random. */
  random?: () => number;
};

export type AttackResult = {
  damageDealt: number;
  defenderHpAfter: number;
  retaliationTriggered: boolean;
  blockedByImmunity: boolean;
  /** Human-readable trace of what happened and what was skipped (English, code language). */
  notes: string[];
};

/** True if the unit carries the given ability tag. */
function hasTag(unit: CombatUnit, tag: AbilityTag): boolean {
  return unit.tags.includes(tag);
}

/** Rolls raw damage between damageMin and damageMax (both ends inclusive). */
function rollBaseDamage(attacker: CombatUnit, random: () => number): number {
  const { damageMin, damageMax } = attacker.stats;
  const spread = damageMax - damageMin + 1;

  return damageMin + Math.floor(random() * spread);
}

export function resolveAttack(
  attacker: CombatUnit,
  defender: CombatUnit,
  context: AttackContext = {},
): AttackResult {
  const notes: string[] = [];
  const random = context.random ?? Math.random;

  // Step 1 (attacker tags): there is no damage-type system yet, so the rule is
  // simple — MagicDamage on the attacker means a magic attack, otherwise physical.
  const isMagicAttack = hasTag(attacker, 'MagicDamage');
  notes.push(isMagicAttack ? 'attack type: magic' : 'attack type: physical');

  // Step 2 (defender tags): MagicImmune blocks incoming MAGIC completely.
  // It does not stop physical attacks, and it never protects the magic-immune
  // unit's own attacks or retaliations (we only ever look at the defender here).
  const blockedByImmunity = hasTag(defender, 'MagicImmune') && isMagicAttack;

  // Step 3 (base damage from stats) — skipped entirely when the attack is blocked.
  let damageDealt = 0;

  if (blockedByImmunity) {
    notes.push(`MagicImmune on ${defender.name}: magic attack fully blocked, damage 0`);
  } else {
    const roll = rollBaseDamage(attacker, random);
    const afterDefense = roll - defender.stats.defense;
    damageDealt = Math.max(MIN_DAMAGE, afterDefense);

    if (afterDefense < MIN_DAMAGE) {
      notes.push(
        `damage clamped up to MIN_DAMAGE=${MIN_DAMAGE} (roll ${roll} - defense ${defender.stats.defense})`,
      );
    }
  }

  // Step 4 (apply).
  const defenderHpAfter = defender.currentHp - damageDealt;

  // Step 5 (retaliation), one uniform rule for every attack:
  //   - the attacker must not carry NoRetaliation;
  //   - the defender must still be alive;
  //   - this attack must not itself be a retaliation (no counter-to-the-counter).
  const retaliationTriggered =
    !hasTag(attacker, 'NoRetaliation') && defenderHpAfter > 0 && context.isRetaliation !== true;

  if (blockedByImmunity && retaliationTriggered) {
    // Documented on purpose: a fully blocked attack still provokes a retaliation
    // in the current iteration. This is a decision candidate for docs/decisions.md.
    notes.push('blocked attack still provoked a retaliation (uniform rule, pending author decision)');
  }

  // Step 6 — deliberately NOT implemented in this pure function:
  if (hasTag(attacker, 'AreaAttack')) {
    notes.push('AreaAttack: requires hex positioning, not implemented in this pure-function stage');
  }
  if (hasTag(attacker, 'Piercing')) {
    notes.push('Piercing: not implemented in this pure-function stage (no damage-type interaction yet)');
  }

  return { damageDealt, defenderHpAfter, retaliationTriggered, blockedByImmunity, notes };
}
