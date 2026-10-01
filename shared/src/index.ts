/**
 * Shared protocol types between the game server and the client.
 *
 * Walking skeleton stage: only the ping/pong heartbeat exists, so that we can
 * prove the transport works. No game protocol (movement, battles) here yet.
 */

/** Sent by the client to check that the connection is alive. */
export type PingMessage = {
  type: 'ping';
  /** Client clock (Date.now()) at the moment the message was created. */
  timestamp: number;
};

/** Sent by the server in reply to a PingMessage. */
export type PongMessage = {
  type: 'pong';
  /** Echo of the client timestamp, so the client can measure round-trip time. */
  timestamp: number;
  /** Server clock (Date.now()) at the moment the reply was produced. */
  serverTime: number;
};

/** Everything the client is allowed to send to the server (grows later). */
export type ClientMessage = PingMessage;

/** Everything the server is allowed to send to the client (grows later). */
export type ServerMessage = PongMessage;

/* -------------------------------------------------------------------------- *
 * Combat domain types (combat stage of the walking skeleton).
 *
 * These describe a unit for the battle engine only: no map, no hex field and
 * no position here — positioning arrives later as a separate layer
 * (see docs/architecture.md, "Бой — модель инстанса").
 * -------------------------------------------------------------------------- */

/** The numbers that describe a unit in battle. */
export type UnitStats = {
  /** Maximum hit points (the current value lives on CombatUnit.currentHp). */
  hp: number;
  attack: number;
  defense: number;
  speed: number;
  /** Damage roll range, inclusive on both ends. */
  damageMin: number;
  damageMax: number;
};

/**
 * Special abilities are TAGS, not separate classes (docs/decisions.md, 004).
 * The battle engine reads them in a fixed order.
 *
 * Implemented in the current iteration: NoRetaliation, MagicImmune, MagicDamage.
 * Declared but NOT implemented yet: AreaAttack (needs hex positioning),
 * Piercing (no damage-type interaction yet).
 */
export type AbilityTag =
  | 'NoRetaliation'
  | 'AreaAttack'
  | 'MagicImmune'
  | 'Piercing'
  | 'MagicDamage';

/**
 * Every bonus a combatant brings to its own attacks, in total.
 *
 * It is the TOTAL from the hero (stats + skills + items + set bonuses + buffs);
 * built once at battle creation by `buildCombatant` (server/src/combat/combatant.ts)
 * and stored on the combatant, so resolveAttack never gathers anything itself.
 * A missing field (or a missing `bonuses` object) means 0.
 */
export type CombatBonuses = {
  /** Flat bonus to this combatant's attack. */
  attackBonus: number;
  /** Flat bonus to this combatant's defense. */
  defenseBonus: number;
  /** Extra damage in percent for a MELEE attack. */
  meleeOffenseBonusPercent: number;
  /** Extra damage in percent for a RANGED attack. */
  rangedOffenseBonusPercent: number;
  /** Reduces incoming PHYSICAL damage by this percent. */
  defensiveArmorReductionPercent: number;
  /** Luck levels the hero adds on top of the unit's own luckLevel (-3..3). */
  luckLevel: number;
  /** Flat damage added to the stack roll BEFORE the attack/defense multiplier. */
  flatDamageBonus: number;
  /** Percent damage applied AFTER the attack/defense multiplier (50 means +50%). */
  percentDamageBonus: number;
  /**
   * TODO (placeholder): extra damage for MAGIC attacks. No logic is implemented
   * for it — a non-zero value is reported in `notes` and never applied
   * (docs/decisions.md, 016).
   */
  magicOffenseBonusPercent: number;
};

/** A unit as the battle engine sees it: plain data, no behaviour. */
export type CombatUnit = {
  id: string;
  name: string;
  stats: UnitStats;
  tags: AbilityTag[];
  /**
   * Remaining hit points of the WHOLE stack (the "pool").
   *
   * It starts at stats.hp * stackCount and is spent by damage, so it is the
   * current truth during a battle — not the maximum recomputed every time.
   * Individual units are derived from the pool: how many are still alive and how
   * much HP the front (wounded) unit has left (see resolveAttack).
   */
  currentHp: number;
  /**
   * Optional luck level of the unit at the moment of the attack, from -3 to 3.
   * 0 (default) means no luck. Luck is a CHANCE to trigger an effect, not a smooth
   * multiplier — see rules.luckChanceByLevel (docs/architecture.md, "Формулы урона").
   */
  luckLevel?: number;
  /**
   * Number of units in this stack. The damage roll is per unit
   * (damageMin..damageMax), so the stack roll is multiplied by this value.
   * Optional — omitted means a stack of 1.
   */
  stackCount?: number;
  /**
   * Total bonuses of this combatant, collected ONCE when the battle is created
   * (see CombatBonuses and server/src/combat/combatant.ts). resolveAttack only
   * READS these numbers. Optional: a missing object or field means 0.
   */
  bonuses?: Partial<CombatBonuses>;
};
