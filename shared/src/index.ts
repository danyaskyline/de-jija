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

/** A unit as the battle engine sees it: plain data, no behaviour. */
export type CombatUnit = {
  id: string;
  name: string;
  stats: UnitStats;
  tags: AbilityTag[];
  /** Current hit points; may be <= 0 for a dead unit. */
  currentHp: number;
};
