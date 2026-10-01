/**
 * Battle — the layer that HOLDS the state of a fight (docs/battle.md).
 *
 * What it does:
 *   - builds the combatants ONCE from a BattleSetup (hero + bonuses, snapshot);
 *   - keeps positions on the hex field, the stack HP pool, shots and the
 *     retaliation counter;
 *   - checks the game rules (who may hit whom, from where, with what);
 *   - calls the PURE formulas (resolveAttack) and writes their result back;
 *   - returns the events that happened.
 *
 * What it deliberately does NOT do:
 *   - calculate damage. That is resolveAttack's job, and resolveAttack knows
 *     nothing about the field, rounds or counters;
 *   - know anything about the transport. The sandbox and the WebSocket layer
 *     only send commands and render events (docs/conventions.md).
 *
 * Refusals are returned as { ok: false, code, message } — never as exceptions:
 * the interface has to be able to show the player WHY a move was rejected.
 *
 * A retaliation is NOT "swapping the two units and reusing the old numbers":
 * it is a full second calculation from the state AFTER the first hit, so a
 * defender that lost part of its stack answers weaker.
 */

import { distance, isInside, isSameHex } from '@de-jija/shared/hex';
import type {
  AttackKind,
  AttackOptions,
  BattleErrorCode,
  BattleEvent,
  BattleSetup,
  BattleSide,
  BattleState,
  BattleUnit,
  CommandResult,
  Hex,
  ValidTarget,
} from '@de-jija/shared';

import { buildCombatant } from '../combat/combatant';
import type { CombatRules } from '../combat/combatRules';
import { aggregateHeroModifiers } from '../combat/heroModifiers';
import { resolveAttack } from '../combat/resolveAttack';
import type { SkillsData } from '../combat/skills';
import type { BattleRules } from './battleRules';

/** Everything Battle needs from the outside; injected so tests are deterministic. */
export type BattleDeps = {
  combatRules: CombatRules;
  skillsData: SkillsData;
  battleRules: BattleRules;
  /** Random source for damage and luck rolls. Defaults to Math.random. */
  random?: () => number;
};

/** A successful command that produced events. */
export type CommandOk = { ok: true; events: BattleEvent[] };

/** Builds a refusal with a stable code (docs/battle.md). */
function refuse(code: BattleErrorCode, message: string) {
  return { ok: false as const, code, message };
}

/**
 * The battle instance. Created by createBattle() and then driven purely by
 * commands (placeUnit / attack / nextRound / getState / getValidTargets).
 */
export class Battle {
  private readonly state: BattleState;

  private readonly units: UnitIndex = new Map();

  private readonly deps: BattleDeps;

  private readonly random: () => number;

  private readonly placementMode: 'free' | 'startZone';

  constructor(
    state: BattleState,
    units: BattleUnit[],
    deps: BattleDeps,
    placementMode: 'free' | 'startZone',
  ) {
    this.state = state;
    this.deps = deps;
    this.placementMode = placementMode;
    this.random = deps.random ?? Math.random;

    for (const unit of units) {
      this.units.set(unit.id, unit);
    }
  }

  /** Current state. Returns a COPY, so a caller can never corrupt the battle. */
  getState(): BattleState {
    return structuredClone(this.state);
  }

  /** Puts a unit on a cell (docs/battle.md, section 7). */
  placeUnit(unitId: string, hex: Hex): CommandResult<CommandOk> {
    const unit = this.units.get(unitId);

    if (unit === undefined) {
      return refuse('UNIT_NOT_FOUND', `Боец "${unitId}" не найден в этом бою`);
    }
    if (unit.aliveCount <= 0) {
      return refuse('UNIT_DEAD', `Боец "${unitId}" уже уничтожен и не может быть поставлен`);
    }

    const { fieldWidth, fieldHeight, startZoneWidth } = this.deps.battleRules;

    if (!isInside(hex, fieldWidth, fieldHeight)) {
      return refuse(
        'HEX_OUT_OF_FIELD',
        `Гекс (${hex.x}, ${hex.y}) вне поля ${fieldWidth}x${fieldHeight}`,
      );
    }
    if (this.state.units.some((other) => other.hexes.some((cell) => isSameHex(cell, hex)))) {
      return refuse('HEX_OCCUPIED', `Гекс (${hex.x}, ${hex.y}) уже занят`);
    }

    // 'free' is the sandbox mode (units may be dragged around at any time).
    // 'startZone' is the real rule: own zone, and only before the first hit.
    if (this.placementMode === 'startZone') {
      if (this.state.attacksStarted) {
        return refuse(
          'PLACEMENT_FORBIDDEN',
          'После первого удара расстановка закрыта: в этом режиме бойцов ставят в стартовой зоне до начала боя',
        );
      }
      if (!this.isInStartZone(unit.side, hex)) {
        return refuse(
          'PLACEMENT_FORBIDDEN',
          `Гекс (${hex.x}, ${hex.y}) вне стартовой зоны стороны "${unit.side}" (${startZoneWidth} столб${startZoneWidth === 1 ? 'ец' : 'ца'} у края поля)`,
        );
      }
    }

    // Moving frees the old cell first, so a unit may be dragged around.
    unit.hexes = [{ x: hex.x, y: hex.y }];

    return this.finish([{ type: 'UnitPlaced', unitId: unit.id, hex: { ...hex } }]);
  }
  /** One hit plus, if it applies, the retaliation (docs/battle.md, section 6). */
  attack(
    attackerId: string,
    targetId: string,
    options: AttackOptions = {},
  ): CommandResult<CommandOk> {
    const events: BattleEvent[] = [];

    // --- 1. Checks (no exceptions: every refusal carries a stable code). ---
    const attacker = this.units.get(attackerId);
    const defender = this.units.get(targetId);

    if (attacker === undefined || defender === undefined) {
      const missing = attacker === undefined ? attackerId : targetId;

      return refuse('UNIT_NOT_FOUND', `Боец "${missing}" не найден в этом бою`);
    }
    if (attacker.aliveCount <= 0) {
      return refuse('UNIT_DEAD', `Атакующий "${attackerId}" уже уничтожен и не может бить`);
    }
    if (defender.aliveCount <= 0) {
      return refuse('UNIT_DEAD', `Защитник "${targetId}" уже уничтожен: бить некого`);
    }
    if (attacker.side === defender.side) {
      return refuse('SAME_SIDE', 'Огонь по своим не поддерживается');
    }
    if (attacker.hexes.length === 0 || defender.hexes.length === 0) {
      return refuse(
        'NOT_PLACED',
        'Бить можно только расставленных бойцов (у обоих должен быть гекс)',
      );
    }

    // --- 2. Attack kind: a neighbour is melee, anything further is ranged. ---
    const cellDistance = distance(attacker.hexes[0], defender.hexes[0]);
    const kind: AttackKind = cellDistance === 1 ? 'melee' : 'ranged';

    if (kind === 'ranged' && attacker.shotsLeft <= 0) {
      // A unit that never had shots is not a shooter at all: for it the target
      // is simply too far away.
      return attacker.unit.shots
        ? refuse(
            'NO_SHOTS',
            `У бойца "${attackerId}" кончились выстрелы (${attacker.shotsLeft})`,
          )
        : refuse(
            'TOO_FAR',
            `Цель в ${cellDistance} гексах, а "${attackerId}" не стрелок: он бьёт только в ближнем бою`,
          );
    }

    // --- 3-5. Calculate with the pure formula and write the result back. ---
    const hit = this.resolveAndApply(attacker, defender, kind, false, options);

    events.push(...hit.events);

    // A shot is spent by a real ranged hit (Battle owns this, not the formula).
    if (kind === 'ranged') {
      attacker.shotsLeft -= 1;
      events.push({ type: 'ShotSpent', unitId: attacker.id, shotsLeft: attacker.shotsLeft });
    }

    // --- 6. Retaliation: a full second calculation from the NEW state. ---
    if (kind === 'melee') {
      events.push(...this.resolveRetaliation(attacker, defender, hit.retaliationTriggered, options));
    }

    this.state.attacksStarted = true;

    return this.finish(events);
  }

  /** New round: round + 1 and retaliation counters back to full (section 9). */
  nextRound(): CommandResult<CommandOk> {
    this.state.round += 1;

    for (const unit of this.state.units) {
      if (unit.aliveCount <= 0) {
        continue;
      }
      // Shots are NOT restored: they are a whole-battle resource.
      unit.retaliationsLeft = unit.unit.retaliationsPerRound ?? 1;
    }

    return this.finish([{ type: 'RoundStarted', round: this.state.round }]);
  }

  /** Alive, placed enemies the unit may hit right now, with the kind of hit. */
  getValidTargets(unitId: string): CommandResult<{ targets: ValidTarget[] }> {
    const unit = this.units.get(unitId);

    if (unit === undefined) {
      return refuse('UNIT_NOT_FOUND', `Боец "${unitId}" не найден в этом бою`);
    }
    if (unit.aliveCount <= 0) {
      return refuse('UNIT_DEAD', `Боец "${unitId}" уже уничтожен и не может бить`);
    }
    if (unit.hexes.length === 0) {
      return refuse('NOT_PLACED', `Боец "${unitId}" ещё не поставлен на поле`);
    }

    const targets: ValidTarget[] = [];

    for (const other of this.state.units) {
      if (other.side === unit.side || other.aliveCount <= 0 || other.hexes.length === 0) {
        continue;
      }

      const cellDistance = distance(unit.hexes[0], other.hexes[0]);
      const kind: AttackKind = cellDistance === 1 ? 'melee' : 'ranged';

      // A target that cannot actually be reached is not a valid target.
      if (kind === 'ranged' && unit.shotsLeft <= 0) {
        continue;
      }

      targets.push({ unitId: other.id, kind, distance: cellDistance });
    }

    return { ok: true, targets };
  }

  /* ---------------------------------------------------------------- *
   * Internals
   * ---------------------------------------------------------------- */

  /** True when the cell is inside the starting zone of that side. */
  private isInStartZone(side: BattleSide, hex: Hex): boolean {
    const { fieldWidth, startZoneWidth } = this.deps.battleRules;

    return side === 'left' ? hex.x < startZoneWidth : hex.x >= fieldWidth - startZoneWidth;
  }

  /**
   * One calculation: build the "views" of both combatants with their CURRENT
   * stack state, call resolveAttack, write the new poolHp/aliveCount back and
   * build the event. The formula stays pure — it never sees the battle.
   *
   * `retaliationTriggered` of the formula is passed back to the caller: it is the
   * flag that already knows about NoRetaliation and about the defender's fate.
   */
  private resolveAndApply(
    attacker: BattleUnit,
    defender: BattleUnit,
    kind: AttackKind,
    isRetaliation: boolean,
    options: AttackOptions,
  ): { events: BattleEvent[]; retaliationTriggered: boolean } {
    const poolHpBefore = defender.poolHp;
    const aliveBefore = defender.aliveCount;

    const result = resolveAttack(
      this.viewOf(attacker),
      this.viewOf(defender),
      this.contextFor(kind, isRetaliation, options),
      this.deps.combatRules,
    );

    // The formula already returns the defender's state AFTER the hit, so Battle
    // only writes it down — it never recomputes the stack arithmetic itself.
    defender.poolHp = result.defenderHpAfter;
    defender.aliveCount = result.stackAliveCount;

    // The event always names the roles the way the player sees them: who hit
    // whom THIS time. In a retaliation the formula's roles are swapped, so the
    // answering unit is the attacker of the event.
    const payload = {
      round: this.state.round,
      attackerId: attacker.id,
      defenderId: defender.id,
      kind,
      damage: result.damageDealt,
      defenderPoolHpBefore: poolHpBefore,
      defenderPoolHpAfter: defender.poolHp,
      defenderAliveBefore: aliveBefore,
      defenderAliveAfter: defender.aliveCount,
      breakdown: result.breakdown,
      notes: result.notes,
    };

    const events: BattleEvent[] = [
      isRetaliation
        ? { type: 'RetaliationResolved', ...payload }
        : { type: 'AttackResolved', ...payload },
    ];

    if (defender.aliveCount === 0) {
      events.push({ type: 'UnitDestroyed', unitId: defender.id });
    }

    return { events, retaliationTriggered: result.retaliationTriggered };
  }

  /**
   * The retaliation. Every condition is listed in docs/battle.md, section 6:
   * a melee hit, the defender still alive, the formula's own
   * `retaliationTriggered` flag (it owns NoRetaliation), and a left counter.
   *
   * There is no extra "trial" call of the formula: the flag of the hit that
   * already happened IS the answer to "may the defender answer?".
   */
  private resolveRetaliation(
    attacker: BattleUnit,
    defender: BattleUnit,
    hitTriggered: boolean,
    options: AttackOptions,
  ): BattleEvent[] {
    if (defender.aliveCount <= 0) {
      return []; // the stack was destroyed — nobody answers
    }
    if (defender.retaliationsLeft === 0) {
      return []; // the counter for this round is spent
    }
    if (!hitTriggered) {
      return []; // the attacker carries NoRetaliation
    }

    if (defender.retaliationsLeft !== 'unlimited') {
      defender.retaliationsLeft -= 1;
    }

    // The state AFTER the first hit is already written into both units, so this
    // is genuinely a new calculation: a weakened stack answers weaker.
    return this.resolveAndApply(defender, attacker, 'melee', true, options).events;
  }

  /**
   * The CombatUnit "view" of a battle unit: the base unit with the CURRENT stack
   * state, so the formula sees aliveCount and poolHp as they are right now.
   */
  private viewOf(unit: BattleUnit) {
    return {
      ...unit.unit,
      stackCount: unit.aliveCount,
      currentHp: unit.poolHp,
    };
  }

  /** The context of one hit: only the facts of the blow, no bonuses at all. */
  private contextFor(kind: AttackKind, isRetaliation: boolean, options: AttackOptions) {
    const fixedDamageRoll = options.fixedDamageRoll;

    return {
      attackKind: kind,
      isRetaliation,
      // A frozen roll is the same wrapper the debug endpoint uses: the formula
      // asks `random` for a value and always gets the same one.
      random: typeof fixedDamageRoll === 'number' ? () => fixedDamageRoll : this.random,
      ...(options.fixedLuckRoll === undefined ? {} : { fixedLuckRoll: options.fixedLuckRoll }),
      ...(options.moraleExtraAttack === true ? { isMoraleBonusAttack: true } : {}),
    };
  }

  /** Appends the events to the log and returns them. */
  private finish(events: BattleEvent[]): CommandResult<CommandOk> {
    for (const event of events) {
      this.state.log.push(event);
    }

    return { ok: true, events };
  }
}

/* ------------------------------------------------------------------ *
 * Creation
 * ------------------------------------------------------------------ */

/** Reads a per-battle balance override on top of the global combat rules. */
function applyRulesOverride(base: CombatRules, override: BattleSetup['rules']): CombatRules {
  if (override === undefined) {
    return base;
  }

  // Only fields the base rules actually have may be overridden: an unknown key
  // would be a typo and must not silently change the formula.
  for (const key of Object.keys(override)) {
    if (!(key in base)) {
      throw new Error(`неизвестный ключ правил: "${key}"`);
    }
  }

  return { ...base, ...(override as Partial<CombatRules>) };
}

/**
 * Checks the whole setup BEFORE anything is built. Returns null when the setup
 * is fine, or a SETUP_INVALID refusal naming the first problem found.
 */
function validateSetup(
  setup: BattleSetup,
  rules: BattleRules,
): { ok: false; code: BattleErrorCode; message: string } | null {
  if (setup === null || typeof setup !== 'object') {
    return refuse('SETUP_INVALID', 'setup должен быть объектом');
  }
  if (setup.placementMode !== 'free' && setup.placementMode !== 'startZone') {
    return refuse(
      'SETUP_INVALID',
      `setup.placementMode должен быть "free" или "startZone", а получено: ${JSON.stringify(setup.placementMode)}`,
    );
  }
  if (typeof setup.sides !== 'object' || setup.sides === null) {
    return refuse('SETUP_INVALID', 'setup.sides должен содержать стороны left и right');
  }

  const seenIds = new Set<string>();
  const seenHexes: Hex[] = [];

  for (const side of ['left', 'right'] as const) {
    const sideSetup = setup.sides[side];
    const where = `setup.sides.${side}.units`;

    if (typeof sideSetup !== 'object' || sideSetup === null) {
      return refuse('SETUP_INVALID', `setup.sides.${side} должен быть объектом`);
    }
    if (!Array.isArray(sideSetup.units)) {
      return refuse('SETUP_INVALID', `${where} должен быть массивом`);
    }
    if (sideSetup.units.length > rules.maxUnitsPerSide) {
      return refuse(
        'SETUP_INVALID',
        `Сторона "${side}": юнитов ${sideSetup.units.length}, а максимум ${rules.maxUnitsPerSide}`,
      );
    }

    for (const unitSetup of sideSetup.units) {
      if (typeof unitSetup !== 'object' || unitSetup === null) {
        return refuse('SETUP_INVALID', `${where}: каждый юнит должен быть объектом`);
      }
      if (typeof unitSetup.id !== 'string' || unitSetup.id.length === 0) {
        return refuse('SETUP_INVALID', `${where}: у юнита должен быть непустой id (строкой)`);
      }
      if (seenIds.has(unitSetup.id)) {
        return refuse(
          'SETUP_INVALID',
          `${where}: повторяющийся id "${unitSetup.id}" (id должны быть уникальны в пределах боя)`,
        );
      }
      seenIds.add(unitSetup.id);

      if (typeof unitSetup.unit !== 'object' || unitSetup.unit === null) {
        return refuse(
          'SETUP_INVALID',
          `${where}: у юнита "${unitSetup.id}" должно быть поле unit со статами`,
        );
      }
      if (!Number.isInteger(unitSetup.stackCount) || unitSetup.stackCount < 1) {
        return refuse(
          'SETUP_INVALID',
          `${where}: stackCount юнита "${unitSetup.id}" должен быть целым числом не меньше 1, а получено: ${JSON.stringify(unitSetup.stackCount)}`,
        );
      }

      if (unitSetup.hex !== null && unitSetup.hex !== undefined) {
        const hex = unitSetup.hex;

        if (!isInside(hex, rules.fieldWidth, rules.fieldHeight)) {
          return refuse(
            'SETUP_INVALID',
            `${where}: гекс (${hex.x}, ${hex.y}) юнита "${unitSetup.id}" вне поля ${rules.fieldWidth}x${rules.fieldHeight}`,
          );
        }
        if (seenHexes.some((other) => isSameHex(other, hex))) {
          return refuse(
            'SETUP_INVALID',
            `${where}: гекс (${hex.x}, ${hex.y}) юнита "${unitSetup.id}" уже занят другим бойцом`,
          );
        }
        seenHexes.push({ x: hex.x, y: hex.y });
      }
    }
  }

  return null;
}

/**
 * Creates a battle from a setup (docs/battle.md, sections 4 and 8).
 *
 * Everything is validated up front: a bad setup is a normal refusal
 * (SETUP_INVALID), never an exception. The battle works on a SNAPSHOT — the
 * hero of a side is aggregated ONCE and every combatant is built ONCE, so
 * anything that changes in the hero or the items afterwards does not affect it.
 */
export function createBattle(
  setup: BattleSetup,
  deps: BattleDeps,
): CommandResult<{ battle: Battle }> {
  const invalid = validateSetup(setup, deps.battleRules);

  if (invalid !== null) {
    return invalid;
  }

  let combatRules: CombatRules;
  try {
    combatRules = applyRulesOverride(deps.combatRules, setup.rules);
  } catch (error) {
    return refuse(
      'SETUP_INVALID',
      `Некорректное переопределение правил боя: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const units: BattleUnit[] = [];

  for (const side of ['left', 'right'] as const) {
    // The hero of a side is aggregated ONCE and shared by all of its units.
    let heroMods = null;
    try {
      heroMods = aggregateHeroModifiers(setup.sides[side].hero, deps.skillsData);
    } catch (error) {
      return refuse(
        'SETUP_INVALID',
        `Герой стороны "${side}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    for (const unitSetup of setup.sides[side].units) {
      const combatant = buildCombatant(unitSetup.unit, heroMods, unitSetup.extraBonuses);
      const unitHp = Math.max(1, combatant.stats.hp);

      units.push({
        id: unitSetup.id,
        side,
        unit: combatant,
        aliveCount: unitSetup.stackCount,
        poolHp: unitHp * unitSetup.stackCount,
        hexes: unitSetup.hex === null ? [] : [{ x: unitSetup.hex.x, y: unitSetup.hex.y }],
        shotsLeft: combatant.shots ?? 0,
        retaliationsLeft: combatant.retaliationsPerRound ?? 1,
      });
    }
  }

  // A setup may already carry positions: those count as placed events too, so
  // the log tells the whole story from the very first moment.
  const log: BattleEvent[] = units
    .filter((unit) => unit.hexes.length > 0)
    .map((unit) => ({ type: 'UnitPlaced', unitId: unit.id, hex: { ...unit.hexes[0] } }));

  const state: BattleState = { round: 1, units, attacksStarted: false, log };
  const battle = new Battle(state, units, { ...deps, combatRules }, setup.placementMode);

  return { ok: true, battle };
}




type UnitIndex = Map<string, BattleUnit>;
