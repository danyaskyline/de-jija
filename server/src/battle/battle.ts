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
import {
  buildTurnOrder,
  compareWithinSide,
  decideInitialPriority,
  orderEqualSpeedGroup,
  type TurnGroup,
  type TurnQueueUnit,
} from './turnQueue';

/** Everything Battle needs from the outside; injected so tests are deterministic. */
export type BattleDeps = {
  combatRules: CombatRules;
  skillsData: SkillsData;
  battleRules: BattleRules;
  /** Random source for damage, luck and the priority coin. Defaults to Math.random. */
  random?: () => number;
  /**
   * Refuses acting out of turn (code NOT_YOUR_TURN). OFF by default, because the
   * sandbox and /debug/battles know nothing about the queue yet; the real game
   * turns it on in one place. The queue itself is built and maintained either
   * way — this switch only turns the CHECK on (docs/tasks/001-turn-queue.md).
   */
  enforceTurns?: boolean;
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
/**
 * The other side of the battle — the one and only implementation of rule 4b
 * ("after a draw the priority passes to the opposite side", 002/4b).
 *
 * It is exported so the tests can state the same rule without reaching into
 * private methods, and so nobody re-implements the flip by hand.
 */
export const oppositeSide = (side: BattleSide): BattleSide =>
  side === 'left' ? 'right' : 'left';

/**
 * A group of equal speed whose draw was already decided in this round
 * (002/2, and the protection 4g of task 001).
 *
 * The record belongs to the GROUP, not to a unit — that is what makes it robust:
 * a unit may leave the group (death, a speed change) and a newcomer may join it,
 * and the record still says exactly what this group was decided as.
 */
type ResolvedGroup = {
  /** The full membership at the moment the draw was decided. */
  memberIds: string[];
  /** The ready order that was decided. */
  order: string[];
  /** The side that had the priority BEFORE the switch (002/4g firstSide). */
  firstSide: BattleSide;
  /** The speed of the group — a unit only counts as its member at this speed. */
  speed: number;
  /** The segment of the round the group belongs to. */
  segment: 'normal' | 'waiting';
};

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

  /** True when acting out of turn must be refused (see BattleDeps.enforceTurns). */
  private readonly enforceTurns: boolean;

  /**
 * The draws already decided in the CURRENT round. Cleared when a new round
 * starts — the next round resolves its draws from scratch, while the priority
 * keeps alternating (001/4б).
 */
  private readonly resolvedGroups: ResolvedGroup[] = [];

  /** The groups of the current order, kept so the head can be resolved lazily. */
  private groups: TurnGroup[] = [];

  /**
   * The only method that changes `prioritySide`, so it writes `nextPrioritySide`
   * next to it and the indicator follows the real priority.
   *
   * Rule 4b ("after a draw the priority passes to the OTHER side") lives in
   * `oppositeSide` and nowhere else — not in the sandbox, not in the client.
   *
   * This is NOT a guarantee that the two fields can never disagree: `createBattle`
   * starts the state with a literal that `rollPriority` overwrites right after.
   * Two writers exist; an invariant test is what checks them, not this comment.
   */
  private setPrioritySide(side: BattleSide): void {
    this.state.turns.prioritySide = side;
    this.state.turns.nextPrioritySide = oppositeSide(side);
  }

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
    this.enforceTurns = deps.enforceTurns === true;

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
    // With enforceTurns on, only the unit whose turn it is may act at all. With
    // it off (the sandbox) the hit is allowed, but such a hit must NOT move the
    // queue — see finishTurnOf.
    if (this.enforceTurns && this.state.turns.currentUnitId !== attackerId) {
      return this.refuseOutOfTurn(attackerId, 'Атаковать');
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

    // A hit by the unit whose turn it IS ends that turn and moves the queue; a
    // hit by anybody else (sandbox, enforceTurns off) leaves the queue alone.
    return this.finish(this.finishTurnOf(attackerId, events));
  }

  /**
   * The unit that acts now finishes its turn without doing anything: the queue
   * moves on, and the round starts by itself when it was the last one (rule 2).
   */
  endTurn(): CommandResult<CommandOk> {
    return this.finish(this.endCurrentTurn());
  }

  /**
   * "Wait": the unit moves to the waiting segment of the CURRENT round right away
   * (rule 2). At most once per battle, and never again inside the waiting segment.
   */
  wait(unitId: string): CommandResult<CommandOk> {
    const unit = this.units.get(unitId);

    if (unit === undefined) {
      return refuse('UNIT_NOT_FOUND', `Боец "${unitId}" не найден в этом бою`);
    }
    if (unit.aliveCount <= 0) {
      return refuse('UNIT_DEAD', `Боец "${unitId}" уже уничтожен и не может ждать`);
    }
    if (unit.hasWaitedThisBattle) {
      return refuse(
        'ALREADY_WAITED',
        `Боец "${unitId}" уже ждал в этом бою: ждать можно не более одного раза за бой`,
      );
    }
    if (this.enforceTurns && this.state.turns.currentUnitId !== unitId) {
      return this.refuseOutOfTurn(unitId, 'Ждать');
    }

    unit.hasWaitedThisBattle = true;
    unit.hasWaitedThisRound = true;

    const event: BattleEvent = { type: 'UnitWaited', unitId: unit.id, round: this.state.round };

    // The unit that waited does NOT finish its turn: it is moved into the waiting
    // segment and will act there later in this very round. With enforceTurns off
    // and a unit that is not the current one, the queue stays as it is (the
    // sandbox must not break it).
    if (this.state.turns.currentUnitId !== unitId) {
      return this.finish([event]);
    }

    this.rebuildQueue();

    return this.finish([event, ...this.turnHeadToFirst()]);
  }

  /**
   * Changes the speed a unit acts with right now (the way a haste-like effect
   * will do it). The base stat stays untouched, the queue is recalculated, and the
   * unit whose turn it is now keeps that turn (rule 5).
   */
  setUnitSpeed(unitId: string, speed: number): CommandResult<CommandOk> {
    const unit = this.units.get(unitId);

    if (unit === undefined) {
      return refuse('UNIT_NOT_FOUND', `Боец "${unitId}" не найден в этом бою`);
    }
    if (!Number.isFinite(speed)) {
      return refuse(
        'SETUP_INVALID',
        `Скорость юнита "${unitId}" должна быть числом, а получено: ${JSON.stringify(speed)}`,
      );
    }

    const current = this.state.turns.currentUnitId;

    unit.currentSpeed = speed;

    // The unit whose turn it IS keeps that turn (rule 5); only the rest of the
    // queue is recalculated.
    if (current === unitId) {
      return this.finish([]);
    }

    this.rebuildQueue(current);

    return this.finish(this.turnHeadToFirst(current));
  }

  /**
   * Starts the next round by hand: the sandbox uses it, and it stays for
   * compatibility. The queue normally moves on by ITSELF when the round runs out
   * (see endCurrentTurn); this command does exactly the same thing.
   */
  nextRound(): CommandResult<CommandOk> {
    return this.finish(this.startNextRound());
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

  /* ---------------------------------------------------------------- *
   * The turn queue (docs/battle.md, "Очередь ходов")
   * ---------------------------------------------------------------- */

  /**
   * Rebuilds the order of the current round from the CURRENT state of the units
   * and moves the pointer to the next one.
   *
   * Only alive units that have NOT acted in this round take part: a dead unit
   * leaves the queue at once (rule 6), and a unit that already had its turn does
   * not come back even after a speed change (rule 5).
   */
  private rebuildQueue(keepCurrent: string | null = null): void {
    const actors: TurnQueueUnit[] = [];

    // The unit whose turn it is now keeps its place at the head of the queue
    // even when the rest of it is recalculated (rule 5).
    if (keepCurrent !== null) {
      const current = this.units.get(keepCurrent);
      if (current !== undefined && current.aliveCount > 0) {
        actors.push({
          id: current.id,
          side: current.side,
          slot: current.slot,
          currentSpeed: current.currentSpeed,
          tier: current.unit.tier,
          upgraded: current.unit.upgraded,
          hasWaitedThisRound: current.hasWaitedThisRound,
        });
      }
    }

    for (const unit of this.state.units) {
      // The unit that keeps its turn was already pushed above: pushing it twice
      // would duplicate it in the order and in the PriorityPassed log.
      if (unit.aliveCount <= 0 || unit.hasActedThisRound) {
        continue;
      }

      // The unit that keeps its turn was already pushed above: pushing it twice
      // would duplicate it in the order and in the PriorityPassed log.
      if (unit.id === keepCurrent) {
        continue;
      }

      actors.push({
        id: unit.id,
        side: unit.side,
        slot: unit.slot,
        currentSpeed: unit.currentSpeed,
        tier: unit.unit.tier,
        upgraded: unit.unit.upgraded,
        hasWaitedThisRound: unit.hasWaitedThisRound,
      });
    }

    const order = buildTurnOrder(actors, { prioritySide: this.state.turns.prioritySide });

    // The groups are only BUILT here; the head (and the draw in it, if any) is
    // resolved by turnHeadToFirst(), which also reports the events.
    this.groups = order.groups;
    this.applyResolvedOrders(keepCurrent);
  }

  /**
   * RULE 2 (002/2) - a unit that became equal in speed to a group which was already
   * decided in this round.
   *
   * Three cases, and the first two only fire when there really is a newcomer:
   *   (a) nobody of the group has acted yet (the current unit may be inside):
   *       rebuild the WHOLE group by rule 1 with the saved firstSide. The current
   *       unit keeps its turn, the priority is NOT spent.
   *   (b) somebody of the group has already acted: keep the SIDE PATTERN of the
   *       remaining part, and give the newcomer a place at the END of its own side's
   *       places. So a newcomer overtakes only units of its OWN side.
   *   (c) there is no newcomer (a unit left: death or a speed change): the saved
   *       order minus the departed units, as before.
   *
   * "Has somebody acted?" can only be answered from the SAVED order: a unit that has
   * acted is not in the queue at all, so asking the fresh group would always say no.
   */
  private applyResolvedOrders(keepCurrent: string | null = null): void {
    for (const group of this.groups) {
      const stored = this.storedFor(group);
      if (stored === null) {
        continue;
      }

      // Only units that are still here and still belong to this group.
      const stillIn = (unitId: string): boolean => {
        if (!group.unitIds.includes(unitId)) {
          return false;
        }
        const unit = this.units.get(unitId);
        return unit !== undefined && unit.aliveCount > 0 && !unit.hasActedThisRound;
      };

      const newcomers = group.unitIds.filter((unitId) => !stored.order.includes(unitId));

      if (newcomers.length === 0) {
        // (c) Nobody new: the saved order minus the departed units.
        group.unitIds = stored.order.filter(stillIn);
        continue;
      }

      const somebodyActed = stored.order.some(
        (unitId) => this.units.get(unitId)?.hasActedThisRound === true,
      );

      if (!somebodyActed) {
        // (a) Rebuild the whole group by rule 1, from the side it started with.
        group.unitIds = orderEqualSpeedGroup(
          group.unitIds.map((unitId) => this.queueUnitOf(unitId)),
          stored.firstSide,
        );
        stored.order = [...group.unitIds];
        continue;
      }

      // (b) Keep the side pattern and slot the newcomer into its own side's places.
      group.unitIds = this.patternWithNewcomers(stored, group, keepCurrent, stillIn, newcomers);
    }
  }

  /**
 * (b) The side pattern is kept: the newcomer takes a place at the end of its own
 * side's places, and every side is refilled by level and then by slot.
 */
  private patternWithNewcomers(
    stored: ResolvedGroup,
    group: TurnGroup,
    keepCurrent: string | null,
    stillIn: (unitId: string) => boolean,
    newcomers: string[],
  ): string[] {
    // The pattern: the saved order without the departed units and without the
    // current unit (it keeps its turn and is not part of the remainder).
    const currentId = this.currentUnitIn(group, keepCurrent);
    const pattern = stored.order
      .filter((unitId) => stillIn(unitId) && unitId !== currentId)
      .map((unitId) => this.sideOf(unitId));

    // A newcomer adds one place at the END of its own side's places.
    for (const unitId of newcomers) {
      const side = this.sideOf(unitId);
      let lastPlaceOfSide = -1;

      pattern.forEach((patternSide, index) => {
        if (patternSide === side) {
          lastPlaceOfSide = index;
        }
      });

      pattern.splice(lastPlaceOfSide + 1, 0, side);
    }

    // Fill every place with the units of that side, by level and then by slot.
    const placesBySide: Record<BattleSide, string[]> = { left: [], right: [] };

    for (const unitId of group.unitIds) {
      if (unitId === currentId) {
        continue;
      }
      placesBySide[this.sideOf(unitId)].push(unitId);
    }

    for (const side of ['left', 'right'] as const) {
      placesBySide[side].sort((a, b) => this.compareWithinSideOf(a, b));
    }

    return pattern.map((side) => placesBySide[side].shift() as string);
  }

  /**
   * The unit of this group whose turn it is - only ever `keepCurrent`, the unit the
   * caller is really recalculating for.
   *
   * It is NOT read from the state on purpose: the state only learns who acts when
   * the head is set, so at the start of a new round it still names the unit that
   * acted last round - alive and free to act again, which must decide nothing.
   */
  private currentUnitIn(group: TurnGroup, keepCurrent: string | null): string | null {
    return keepCurrent !== null && group.unitIds.includes(keepCurrent) ? keepCurrent : null;
  }

  /** The queue view of a battle unit, for the pure ordering function. */
  private queueUnitOf(unitId: string): TurnQueueUnit {
    const unit = this.units.get(unitId) as BattleUnit;

    return {
      id: unit.id,
      side: unit.side,
      slot: unit.slot,
      currentSpeed: unit.currentSpeed,
      tier: unit.unit.tier,
      upgraded: unit.unit.upgraded,
      hasWaitedThisRound: unit.hasWaitedThisRound,
    };
  }

  /** The side of a unit, 'left' when the unit is somehow unknown. */
  private sideOf(unitId: string): BattleSide {
    return this.units.get(unitId)?.side ?? 'left';
  }

  /** Compares two units INSIDE one side: level, then slot (002/1(а)). */
  private compareWithinSideOf(a: string, b: string): number {
    return compareWithinSide(this.queueUnitOf(a), this.queueUnitOf(b));
  }

  /**
   * The record that applies to this group, or null when the group was never
   * decided in this round.
   *
   * A record only counts if one of its members is REALLY still in this group at the
   * record's speed — a unit that slowed down or sped up is no longer a member of
   * that group, and must not make the record look applicable to another one.
   */
  private storedFor(group: TurnGroup): ResolvedGroup | null {
    return (
      this.resolvedGroups.find(
        (record) =>
          record.segment === group.segment &&
          record.speed === group.speed &&
          record.memberIds.some(
            (unitId) =>
              group.unitIds.includes(unitId) &&
              this.units.get(unitId)?.currentSpeed === record.speed,
          ),
      ) ?? null
    );
  }

  /** The slot of a unit in its army (used to order the newcomers). */
  private slotOf(unitId: string): number {
    return this.units.get(unitId)?.slot ?? 0;
  }

  /**
   * Points the queue at its first unit and writes it into the state.
   *
   * THE DRAW IS RESOLVED HERE, LAZILY (002/2, 001/4б): when the queue reaches a
   * group with units of both sides, that is the moment the priority is really
   * needed.
   *
   * Two details that matter:
   *  - the group is the one AROUND THE CURRENT UNIT, not blindly groups[0]: if
   *    somebody is faster than the unit that acts, groups[0] is another group;
   *  - the priority passes ONLY when the side that HAS the priority really acts
   *    first in this draw. If the current unit belongs to the other side, the
   *    priority is left alone (no PriorityPassed) and the group is remembered
   *    anyway, with firstSide = the side that had the priority.
   */
  private turnHeadToFirst(keepCurrent: string | null = null): BattleEvent[] {
    const events: BattleEvent[] = [];
    const currentId = this.currentUnitIn(this.groups[0] ?? EMPTY_GROUP, keepCurrent);
    const head =
      currentId === null
        ? this.groups[0]
        : (this.groups.find((group) => group.unitIds.includes(currentId)) ?? this.groups[0]);

    if (head !== undefined && head.isCrossSide && this.storedFor(head) === null) {
      const from = this.state.turns.prioritySide;
      const to: BattleSide = oppositeSide(from);

      // The group is remembered either way (002/2): firstSide is the side that had
      // the priority, so a later rebuild of this group starts from the same side.
      this.resolvedGroups.push({
        memberIds: [...head.unitIds],
        order: [...head.unitIds],
        firstSide: from,
        speed: head.speed,
        segment: head.segment,
      });

      // Who really acts first in this draw: the current unit if it is in the
      // group (it keeps its turn), otherwise the head of the ready order.
      const reallyFirst = this.currentUnitIn(head, keepCurrent) ?? head.unitIds[0];

      if (this.sideOf(reallyFirst) !== from) {
        // The priority side does NOT go first, so nothing is spent: the priority
        // stays and will pass at the next draw where it really goes first.
        this.state.turns.currentUnitId = reallyFirst;
      } else {
        this.setPrioritySide(to);
        events.push({
          type: 'PriorityPassed',
          round: this.state.round,
          from,
          to,
          unitIds: [...head.unitIds],
        });
      }
    }

    const all = this.groups.flatMap((group) => group.unitIds);

    // A recalculation with `keepCurrent` never starts a new turn and never writes
    // a TurnStarted event — the unit that is already acting stays acting, even when
    // rule 2(b) rebuilt the group without it (it holds its turn, not a place in the
    // remainder).
    if (keepCurrent !== null) {
      const unit = this.units.get(keepCurrent);

      if (unit !== undefined && unit.aliveCount > 0 && !unit.hasActedThisRound) {
        this.state.turns.currentUnitId = keepCurrent;
        this.state.turns.order = all.filter((unitId) => unitId !== keepCurrent);

        return events;
      }
    }

    this.state.turns.currentUnitId = all[0] ?? null;
    this.state.turns.order = all.slice(1);

    if (all[0] !== undefined) {
      events.push({ type: 'TurnStarted', round: this.state.round, unitId: all[0] });
    }

    return events;
  }

  /**
   * Ends the turn of the unit that acts now: it has acted, the queue is rebuilt
   * from the new state, and when the round is over the next one starts by itself
   * (the same reset nextRound() does).
   */
  private endCurrentTurn(): BattleEvent[] {
    const current = this.units.get(this.state.turns.currentUnitId ?? '');

    if (current !== undefined && current.aliveCount > 0) {
      current.hasActedThisRound = true;
    }

    if (this.countPendingActors() === 0) {
      return this.startNextRound();
    }

    this.rebuildQueue();

    return this.turnHeadToFirst();
  }

  /** How many alive units have not acted yet this round. */
  private countPendingActors(): number {
    return this.state.units.filter((unit) => unit.aliveCount > 0 && !unit.hasActedThisRound)
      .length;
  }

  /**
   * Starts the next round: round + 1, retaliation counters back to full (shots
   * are NOT restored), the draw memory of the round is dropped — the next round
   * resolves its draws from scratch, while the priority KEEPS alternating.
   */
  private startNextRound(): BattleEvent[] {
    this.state.round += 1;

    for (const unit of this.state.units) {
      unit.hasWaitedThisRound = false;
      unit.hasActedThisRound = false;

      if (unit.aliveCount <= 0) {
        continue;
      }
      unit.retaliationsLeft = unit.unit.retaliationsPerRound ?? 1;
    }

    this.resolvedGroups.length = 0;
    this.rebuildQueue();

    return [{ type: 'RoundStarted', round: this.state.round }, ...this.turnHeadToFirst()];
  }

  /**
   * THE OPENING PRIORITY — 002/0. Decided once, when the battle is created.
   *
   * The fastest alive unit of each side decides who acts first in round 1, and the
   * priority goes to the side that acts SECOND. Only when the top speeds are equal
   * the coin is thrown — through the injected random, never `Math.random` directly,
   * so a test stays deterministic.
   *
   * The rule itself lives in the pure `decideInitialPriority`, so it can be checked
   * without a battle at all; this method only supplies the coin and writes the result
   * into the state and the log.
   */
  private rollPriority(): BattleEvent {
    const actors: TurnQueueUnit[] = [];

    // Only ALIVE units take part in the opening decision: a destroyed stack cannot
    // be the fastest one. At creation every unit is alive, but the filter keeps the
    // rule honest for any later call.
    for (const unit of this.state.units) {
      if (unit.aliveCount <= 0) {
        continue;
      }

      actors.push({
        id: unit.id,
        side: unit.side,
        slot: unit.slot,
        currentSpeed: unit.currentSpeed,
        tier: unit.unit.tier,
        upgraded: unit.unit.upgraded,
        hasWaitedThisRound: unit.hasWaitedThisRound,
      });
    }

    const decision = decideInitialPriority(actors, () =>
      this.random() < 0.5 ? 'left' : 'right',
    );

    this.setPrioritySide(decision.prioritySide);
    this.state.turns.initialPriorityReason = decision.reason;

    return {
      type: 'PriorityRolled',
      side: decision.prioritySide,
      reason: decision.reason,
    };
  }

  /**
   * The turn of `unitId` ends only when it really IS the current unit. With
   * enforceTurns off the sandbox may hit with anybody, and such a hit must not
   * move the queue (docs/tasks/001-turn-queue.md).
   */
  private finishTurnOf(unitId: string, events: BattleEvent[]): BattleEvent[] {
    if (!this.enforceTurns && this.state.turns.currentUnitId !== unitId) {
      return events;
    }

    return [...events, ...this.endCurrentTurn()];
  }

  /** Refuses an action of a unit that is not the one whose turn it is. */
  private refuseOutOfTurn(unitId: string, action: string) {
    const current = this.state.turns.currentUnitId;

    return refuse(
      'NOT_YOUR_TURN',
      `${action} может сделать только тот, чей сейчас ход (сейчас ходит "${current ?? 'никто'}", команда от "${unitId}")`,
    );
  }

  /**
   * Opens the fight: throws the priority coin and builds the queue of round 1.
   * Called once, by createBattle. The coin goes to the TOP of the log (it is the
   * first thing that happened), the queue events to the end.
   */
  openQueue(): void {
    this.state.log.unshift(this.rollPriority());

    this.rebuildQueue();
    this.finish(this.turnHeadToFirst());
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

      // The LEVEL is optional data, but if it is given it must be a whole
      // number >= 1 — otherwise the level scale would be nonsense (rule 3a).
      const { tier, upgraded } = unitSetup.unit;

      if (tier !== undefined && (!Number.isInteger(tier) || tier < 1)) {
        return refuse(
          'SETUP_INVALID',
          `${where}: tier юнита "${unitSetup.id}" должен быть целым числом не меньше 1, а получено: ${JSON.stringify(tier)}`,
        );
      }
      if (upgraded !== undefined && typeof upgraded !== 'boolean') {
        return refuse(
          'SETUP_INVALID',
          `${where}: upgraded юнита "${unitSetup.id}" должен быть true или false, а получено: ${JSON.stringify(upgraded)}`,
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
        // The slot in the army IS the order of the unit in the setup, fixed once
        // here and never changed afterwards (docs/battle.md, "Очередь ходов").
        slot: units.length,
        // The speed is a separate COPY: a haste-like effect changes currentSpeed
        // and leaves the base stat of the unit untouched.
        currentSpeed: combatant.stats.speed,
        hasWaitedThisBattle: false,
        hasWaitedThisRound: false,
        hasActedThisRound: false,
      });
    }
  }

  // A setup may already carry positions: those count as placed events too, so
  // the log tells the whole story from the very first moment.
  const log: BattleEvent[] = units
    .filter((unit) => unit.hexes.length > 0)
    .map((unit) => ({ type: 'UnitPlaced', unitId: unit.id, hex: { ...unit.hexes[0] } }));

  const state: BattleState = {
    round: 1,
    units,
    attacksStarted: false,
    log,
    // The queue itself is built by the turn queue module (step 2); here the
    // battle only carries a complete starting shape.
    // PLACEHOLDERS: openQueue() runs immediately after this and overwrites both
    // with the real values. They are here only so the state shape is complete
    // and no reader has to wonder what a missing field means (002, step 4).
    turns: {
      order: [],
      currentUnitId: null,
      prioritySide: 'left',
      nextPrioritySide: 'right',
      initialPriorityReason: 'speed',
    },
  };
  const battle = new Battle(state, units, { ...deps, combatRules }, setup.placementMode);

  // The coin flip is the FIRST thing in the log (rules 4a/7), then the units that
  // came with a cell, then the opening of the queue (a draw resolved at once and
  // the first turn).
  battle.openQueue();

  return { ok: true, battle };
}




/** An empty group, used only to ask "who is the current unit here" safely. */
const EMPTY_GROUP: TurnGroup = {
  segment: 'normal',
  speed: 0,
  unitIds: [],
  isCrossSide: false,
};

type UnitIndex = Map<string, BattleUnit>;
