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
  /**
   * How many shots (ranged attacks) the unit has left in this battle.
   * Absent or 0 = not a shooter (it can only attack in melee).
   */
  shots?: number;
  /**
   * How many retaliations the unit may make per round. Absent = 1.
   * 'unlimited' = no limit (e.g. Royal Griffins). Reset by the next round.
   */
  retaliationsPerRound?: number | 'unlimited';
  /**
   * LEVEL of the unit as a plain number (1, 2, 3, …): the higher the level, the
   * earlier the unit acts among units of the SAME speed (docs/battle.md,
   * "Очередь ходов", rule 3a). Optional — a unit without a tier is treated as
   * the lowest level, it never fails.
   */
  tier?: number;
  /**
   * UPGRADED marker of the unit: the "+" in the level scale (1 < 1+ < 2 < 2+).
   * Optional — absent or false means a plain unit. Compared together with
   * `tier` as a number, so the order is the HoMM3 one without string sorting.
   */
  upgraded?: boolean;
};

/* -------------------------------------------------------------------------- *
 * Battle domain types (docs/battle.md).
 *
 * A Battle is the layer that HOLDS the state of a fight: positions on the
 * hex field, hit points, shots, retaliation counters. It only ORCHESTRATES the
 * pure formulas (resolveAttack and, later, resolveSpell) — it never calculates
 * damage itself. Transport (sandbox / WebSocket) sends commands and renders the
 * events that come back; game rules live here and in the formulas only.
 * -------------------------------------------------------------------------- */

/** One cell of the hex field. x = column, y = row (odd-r offset layout). */
export type Hex = { x: number; y: number };

/** Which side of the field a unit fights for. */
export type BattleSide = 'left' | 'right';

/**
 * Why a side got the priority when the battle was created (002, rule 0).
 *
 * It lives HERE, not in the server: the reason is both a battle-state field and
 * an event payload, and two separate unions would drift apart.
 */
export type InitialPriorityReason = 'speed' | 'coin';

/** How units may be put on the field before the first hit. */
export type PlacementMode = 'free' | 'startZone';

/** One unit as described by the setup (plain JSON, no behaviour). */
export type UnitSetup = {
  /** Unique within one battle. */
  id: string;
  /** Base stats of the unit; Battle never mutates this object. */
  unit: CombatUnit;
  /** How many units in the stack; a whole number >= 1. */
  stackCount: number;
  /** Where to put it; null = not placed yet. */
  hex: Hex | null;
  /** Manual bonus sources (sandbox) — added on top of the hero's bonuses. */
  extraBonuses?: Partial<CombatBonuses>;
};

/**
 * A hero's base stats. spellPower and knowledge are placeholders for a future spell
 * system. The type lives in /shared so the same one describes a hero in the setup
 * (BattleSetup) and in the server aggregator (aggregateHeroModifiers).
 */
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

/** Everything one side brings into the battle. */
export type SideSetup = {
  /** null = a mob side with no hero. */
  hero: HeroLoadout | null;
  units: UnitSetup[];
};

/** The full description of a battle: plain data, easy to save and replay. */
export type BattleSetup = {
  placementMode: PlacementMode;
  sides: { left: SideSetup; right: SideSetup };
  /** Optional per-battle override of the balance rules (combat-rules). */
  rules?: Partial<Record<string, unknown>>;
};

/** A unit inside a running battle: base unit + its current state. */
export type BattleUnit = {
  id: string;
  side: BattleSide;
  /** Base stats, immutable; bonuses were already collected on it. */
  unit: CombatUnit;
  /** How many units of the stack are still alive. */
  aliveCount: number;
  /** The hit point pool of the WHOLE stack (HoMM3 style). */
  poolHp: number;
  /** Occupied cells; always exactly one in version 1, a list for later. */
  hexes: Hex[];
  /** Shots left; 0 = not a shooter or out of shots. */
  shotsLeft: number;
  /** Retaliations left this round; reset by nextRound(). */
  retaliationsLeft: number | 'unlimited';
  /**
   * Slot in the army, fixed ONCE when the battle is created (the order of the
   * unit in BattleSetup.sides[side].units). Among units of the same side, the
   * LEFT slot acts earlier (docs/battle.md, "Очередь ходов", rule 3b).
   */
  slot: number;
  /**
   * The speed the unit acts with RIGHT NOW. It starts as unit.stats.speed and
   * changes when a haste-like effect changes it — so the base stat stays
   * immutable and a speed change can be recalculated from this value alone.
   */
  currentSpeed: number;
  /**
   * True once the unit has pressed "wait" in THIS battle. A unit may wait at
   * most once per battle (rule 2).
   */
  hasWaitedThisBattle: boolean;
  /**
   * True once the unit has pressed "wait" in the CURRENT round — that is what
   * puts it into the waiting segment (rule 1). Reset when a new round starts.
   */
  hasWaitedThisRound: boolean;
  /**
   * True once the unit has finished its turn in the CURRENT round. A unit that
   * already acted does not come back into the queue of that round, not even
   * after a speed change (rule 5). Reset when a new round starts.
   */
  hasActedThisRound: boolean;
};

/** How a unit attacks a given target right now. */
export type AttackKind = 'melee' | 'ranged';

/** A target the unit is allowed to hit, with the way it would be hit. */
export type ValidTarget = {
  unitId: string;
  kind: AttackKind;
  distance: number;
};

/** Debug-only switches of the `attack` command. They never change game rules. */
export type AttackOptions = {
  /** Freezes the damage roll to this value (0..0.99), for reproducible tests. */
  fixedDamageRoll?: number;
  /** Freezes the luck roll (0..0.99). */
  fixedLuckRoll?: number;
  /** Marks the hit as a morale extra attack (damage x moraleBonusAttackMultiplier). */
  moraleExtraAttack?: boolean;
};

/** Stable reason codes of a refused command (docs/battle.md). */
export type BattleErrorCode =
  | 'UNIT_NOT_FOUND'
  | 'UNIT_DEAD'
  | 'SAME_SIDE'
  | 'NOT_PLACED'
  | 'TOO_FAR'
  | 'NO_SHOTS'
  | 'HEX_OUT_OF_FIELD'
  | 'HEX_OCCUPIED'
  | 'PLACEMENT_FORBIDDEN'
  | 'SETUP_INVALID'
  | 'NOT_YOUR_TURN'
  | 'ALREADY_WAITED';

/**
 * Result of any command: either it worked (and says which events it produced)
 * or it was refused with a stable code and a human-readable reason.
 * There are no exceptions for "you cannot do that" — the UI must show the reason.
 */
export type CommandResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: BattleErrorCode; message: string };

/** Events are the only way the outside world learns what happened in a battle. */
export type BattleEvent =
  | { type: 'UnitPlaced'; unitId: string; hex: Hex }
  | {
      type: 'AttackResolved';
      round: number;
      attackerId: string;
      defenderId: string;
      kind: AttackKind;
      damage: number;
      defenderPoolHpBefore: number;
      defenderPoolHpAfter: number;
      defenderAliveBefore: number;
      defenderAliveAfter: number;
      breakdown: unknown;
      notes: string[];
    }
  | {
      type: 'RetaliationResolved';
      round: number;
      attackerId: string;
      defenderId: string;
      kind: AttackKind;
      damage: number;
      defenderPoolHpBefore: number;
      defenderPoolHpAfter: number;
      defenderAliveBefore: number;
      defenderAliveAfter: number;
      breakdown: unknown;
      notes: string[];
    }
  | { type: 'ShotSpent'; unitId: string; shotsLeft: number }
  | { type: 'UnitDestroyed'; unitId: string }
  | { type: 'RoundStarted'; round: number }
  /**
   * Начальный приоритет, пишется один раз при создании боя. `reason: 'speed'` —
   * решила скорость, монетка не бросалась; `reason: 'coin'` — максимальные
   * скорости сторон равны, монетку бросали (docs/tasks/002, правило 0).
   */
  | { type: 'PriorityRolled'; side: BattleSide; reason: InitialPriorityReason }
  /**
   * The equal-speed group was ordered by rule 3v (the priority side acts first),
   * and the priority has passed to the OTHER side (rules 4b/4v). One event per
   * situation, so a group of three shifts the priority exactly once.
   */
  | {
      type: 'PriorityPassed';
      round: number;
      /** Who had the priority before. */
      from: BattleSide;
      /** Who has it now. */
      to: BattleSide;
      /** Units of the resolved group, in the order they will act. */
      unitIds: string[];
    }
  /** The unit pressed "wait": it moves to the waiting segment of this round. */
  | { type: 'UnitWaited'; unitId: string; round: number }
  /** The unit whose turn it is now. */
  | { type: 'TurnStarted'; round: number; unitId: string };

/**
 * The turn queue of the current round (docs/battle.md, "Очередь ходов").
 *
 * It lives INSIDE the battle state, so the interface can show who acts next
 * without calculating anything itself.
 */
export type TurnQueueState = {
  /**
   * Unit ids in the order they will act, NOT counting the unit whose turn it is
   * now (it is named in `currentUnitId`). Dead units and units that already
   * acted in this round are never in here.
   */
  order: string[];
  /** Whose turn it is now; null while the queue is empty. */
  currentUnitId: string | null;
  /**
   * The side that wins an equal-speed draw (rule 3v). Thrown by a coin flip when
   * the battle is created and passed to the other side after every draw that
   * really needed it (rules 4a/4b).
   */
  prioritySide: BattleSide;
  /**
   * Which side the priority will pass to after the next draw between the sides
   * — always the opposite of `prioritySide` (rule 4b).
   *
   * It is stored rather than calculated by the interface: rule 4b is a GAME
   * RULE, and game rules live only in the battle engine, never in the sandbox or
   * the client. It is written through `setPrioritySide` in `battle.ts` — the one
   * place that changes the priority — plus a literal when the battle is created,
   * which `rollPriority` immediately overwrites with the real value. Two writers
   * exist, so this is not a guarantee: an invariant test checks that the two
   * fields stay opposite after creation and after every command.
   */
  nextPrioritySide: BattleSide;
  /**
   * Why the priority was given the way it was when the battle was created:
   * the speeds decided it, or the coin was flipped. Shown next to the indicator
   * so the player understands where the advantage came from (002, step 4).
   */
  initialPriorityReason: InitialPriorityReason;
};

/** The whole state of a battle at one moment. */
export type BattleState = {
  /** Starts at 1. */
  round: number;
  units: BattleUnit[];
  /** True after the first hit (matters for the startZone placement rule). */
  attacksStarted: boolean;
  /** Full event log, in order. */
  log: BattleEvent[];
  /** Who acts when, and which side has the priority. */
  turns: TurnQueueState;
};
