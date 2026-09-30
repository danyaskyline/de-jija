/**
 * TEST-ONLY unit fixtures (used by resolveAttack.test.ts).
 *
 * These are NOT game content. Real units will live as DATA (JSON files / DB rows)
 * and be read by id, never hardcoded in the code
 * (docs/conventions.md, "Данные vs код"). They are kept in one place so the tests
 * stay readable and are easy to extend.
 */

import type { AbilityTag, CombatUnit, UnitStats } from '@de-jija/shared';

/** Fills in neutral numbers, so each fixture below only states what matters for it. */
function makeStats(partial: Partial<UnitStats>): UnitStats {
  return { hp: 100, attack: 5, defense: 5, speed: 5, damageMin: 10, damageMax: 15, ...partial };
}

/** Builds a full-health CombatUnit from partial stats. */
function makeUnit(
  id: string,
  name: string,
  tags: AbilityTag[],
  partial: Partial<UnitStats>,
): CombatUnit {
  const stats = makeStats(partial);

  return { id, name, stats, tags, currentHp: stats.hp };
}

/** High damage, hits physically, cannot be retaliated against, and hits an area. */
export const antimage = makeUnit('antimage', 'Антимаг (ап)', ['NoRetaliation', 'AreaAttack'], {
  hp: 90,
  attack: 12,
  defense: 8,
  damageMin: 40,
  damageMax: 60,
});

/** Immune to magic, retaliates normally (no NoRetaliation tag). */
export const blackDragon = makeUnit('black_dragon', 'Чёрный дракон', ['MagicImmune'], {
  hp: 200,
  attack: 15,
  defense: 12,
  damageMin: 30,
  damageMax: 45,
});

/** Casts magic attacks — this is the case MagicImmune must block. */
export const mage = makeUnit('mage', 'Маг', ['MagicDamage'], {
  hp: 70,
  attack: 10,
  defense: 6,
  damageMin: 20,
  damageMax: 30,
});

/** Plain unit, no special tags: the "ordinary exchange" case. */
export const swordsman = makeUnit('swordsman', 'Мечник', [], {
  hp: 60,
  attack: 6,
  defense: 6,
  damageMin: 10,
  damageMax: 14,
});

/** Second plain unit with different numbers, so tests do not look copy-pasted. */
export const goblin = makeUnit('goblin', 'Гоблин', [], {
  hp: 50,
  attack: 4,
  defense: 3,
  damageMin: 8,
  damageMax: 12,
});
