/**
 * The TURN QUEUE — the pure core of who acts when (docs/tasks/001-turn-queue.md,
 * docs/battle.md, "Очередь ходов").
 *
 * It is a pure function of the CURRENT state of the living units: no Battle, no
 * log, no random. Battle owns the state and calls it; this file only decides
 * the order. That is what makes the whole rule set testable without a battle and
 * cheap to change later.
 *
 * The rules, in the order they are applied:
 *   1. SEGMENT (001/1). Units that did NOT wait go first, by DESCENDING speed;
 *      then the units that did wait, by ASCENDING speed. The rule for equal
 *      speeds is the SAME in both segments — only the direction of the speed sort
 *      is mirrored.
 *   2. EQUAL SPEED (002/1) — the rule lives in `orderEqualSpeedGroup`, and it is
 *      the only place where it is decided:
 *        (а) inside one side: the LEVEL, then the SLOT — `compareWithinSide`;
 *        (б) between the sides: the level is NOT looked at, the priority decides,
 *            and the sides alternate starting from the priority side.
 *   3. GROUPS (002/1). All units of the same speed inside one segment form ONE
 *      group. A group with units of both sides is a real DRAW: it is resolved by
 *      the priority side and the priority then passes to the other side
 *      (001/4б). A group of three or more counts as ONE situation, so the priority
 *      is spent exactly once for it.
 *
 * Task 002 corrected 001/3: the level used to be compared BEFORE the side, so a
 * higher level on the other side could overtake the priority side.
 *
 * Everything here is deterministic: the same input always gives the same order.
 */

import type { BattleSide } from '@de-jija/shared';

/** What the queue needs to know about one unit. Battle passes it as is. */
export type TurnQueueUnit = {
  id: string;
  side: BattleSide;
  /** Slot in the army, fixed once when the battle was created. */
  slot: number;
  /** The speed the unit acts with RIGHT NOW (a haste-like effect may change it). */
  currentSpeed: number;
  /** Level of the unit; absent = the lowest one. */
  tier?: number;
  /** The "+" of the level scale; absent = a plain unit. */
  upgraded?: boolean;
  /** True when the unit pressed "wait" in the current round. */
  hasWaitedThisRound: boolean;
};

/**
 * One group of units that share the same speed inside ONE segment. A group with
 * units of both sides is a draw that is decided by the priority side.
 */
export type TurnGroup = {
  /** Which segment of the round the group belongs to. */
  segment: 'normal' | 'waiting';
  /** The speed all units of the group share. */
  speed: number;
  /** The units of the group IN THE ORDER THEY WILL ACT. */
  unitIds: string[];
  /** True when the group has units of both sides — a real draw (rule 1). */
  isCrossSide: boolean;
};
/**
 * The LEVEL scale as a plain number: 1 < 1+ < 2 < 2+ < 3 < 3+ …
 *
 * tier * 2 gives every number room for its "+", so a plain comparison of the
 * numbers IS the level comparison — no string sorting and no special cases.
 * A unit without a tier is the lowest level, so it never fails.
 */
export function levelRank(tier: number | undefined, upgraded: boolean | undefined): number {
  return (tier ?? 1) * 2 + (upgraded === true ? 1 : 0);
}

/** The level rank of one unit of the queue. */
function rankOf(unit: TurnQueueUnit): number {
  return levelRank(unit.tier, unit.upgraded);
}

/** Why the side got the priority when the battle was created (002/0). */
export type InitialPriorityReason = 'speed' | 'coin';

/** The result of the opening priority decision of task 002, rule 0. */
export type InitialPriority = {
  /** The side that wins an equal-speed draw from now on. */
  prioritySide: BattleSide;
  /** Whether the speed decided it or the coin flip did. */
  reason: InitialPriorityReason;
};

/**
 * THE OPENING PRIORITY — 002/0. Which side has the priority at the start of the
 * battle, decided ONCE, by createBattle.
 *
 * The rule: the side whose fastest ALIVE unit is faster acts first in round 1, so
 * the priority goes to the OTHER side — the coin is not thrown at all. Only when
 * both sides have the same top speed is it a real draw, and then the coin decides.
 *
 * It is a PURE function: it never reads a random source itself. `flipCoin` is
 * called ONLY when the coin is really needed — that is why the number of random
 * values a battle consumes now depends on the armies (002/8: a debt for the seed
 * task).
 */
export function decideInitialPriority(
  units: TurnQueueUnit[],
  flipCoin: () => BattleSide,
): InitialPriority {
  // The fastest alive unit of each side. A side without units simply has 0, which
  // is below any real speed.
  let topLeft = 0;
  let topRight = 0;

  for (const unit of units) {
    if (unit.side === 'left') {
      topLeft = Math.max(topLeft, unit.currentSpeed);
    } else {
      topRight = Math.max(topRight, unit.currentSpeed);
    }
  }

  // Different top speeds: no coin is needed, and the side that acts SECOND wins
  // the draws.
  if (topLeft > topRight) {
    return { prioritySide: 'right', reason: 'speed' };
  }
  if (topRight > topLeft) {
    return { prioritySide: 'left', reason: 'speed' };
  }

  // Equal: a real draw at the very top, so the coin decides — and the draw itself
  // is then resolved by the normal queue rule (001/4б passes the priority on).
  return { prioritySide: flipCoin(), reason: 'coin' };
}

/**
 * Compares two units INSIDE ONE side at equal speed — 002/1(а).
 *
 * It knows nothing about the other side and nothing about the priority: inside one
 * side the only order is the LEVEL first (1 < 1+ < 2 < 2+ …), then the SLOT (the
 * leftmost slot of the army acts first).
 *
 * What happens BETWEEN the sides is NOT here — that lives in orderEqualSpeedGroup,
 * the one place where the whole equal-speed rule is decided (002/1). Keeping the
 * two apart is deliberate: mixing them is what made the rule of task 001 hard to
 * change, and it also left the cross-side branch of a comparator unused in battle.
 */
export function compareWithinSide(a: TurnQueueUnit, b: TurnQueueUnit): number {
  const rankA = rankOf(a);
  const rankB = rankOf(b);

  // The higher level acts earlier.
  if (rankA !== rankB) {
    return rankB - rankA;
  }

  // Same level: the leftmost slot in the army acts first.
  return a.slot - b.slot;
}

/**
 * THE RULE FOR EQUAL SPEED — 002/1. This is where a group of equal speed is put in
 * order, and it is the ONLY place:
 *   - 002/1(а) inside one side: the level, then the slot (`compareWithinSide`);
 *   - 002/1(б) between the sides: the level is NOT looked at, the side with the
 *     priority acts first;
 *   - the sides then ALTERNATE, starting from the priority side, and the leftover
 *     of one side goes as a block: A1, B1, A2, A3 for three units of A and one of B;
 *   - the whole group stays ONE situation, so the priority is spent once (001/4б).
 *
 * Exported for tests: this is a rule, and it is tested directly.
 */
export function orderEqualSpeedGroup(
  group: TurnQueueUnit[],
  prioritySide: BattleSide,
): string[] {
  const otherSide: BattleSide = prioritySide === 'left' ? 'right' : 'left';

  // 002/1(а): each side by level, then by slot.
  const ofPriority = group
    .filter((unit) => unit.side === prioritySide)
    .sort(compareWithinSide);
  const ofOther = group
    .filter((unit) => unit.side === otherSide)
    .sort(compareWithinSide);

  // 002/1(б): the sides alternate from the priority side; when one side runs out,
  // the rest of the other one follows as a block.
  const ordered: string[] = [];
  let priorityIndex = 0;
  let otherIndex = 0;

  while (priorityIndex < ofPriority.length || otherIndex < ofOther.length) {
    if (priorityIndex < ofPriority.length) {
      ordered.push(ofPriority[priorityIndex].id);
      priorityIndex += 1;
    }
    if (otherIndex < ofOther.length) {
      ordered.push(ofOther[otherIndex].id);
      otherIndex += 1;
    }
  }

  return ordered;
}

/** Options of buildTurnOrder: which side has the priority right now. */
export type BuildTurnOrderOptions = {
  prioritySide: BattleSide;
};

/** The whole order of a round. */
export type TurnOrder = {
  /** Every acting unit in order, the normal segment first. */
  unitIds: string[];
  /** The same order split into groups — Battle needs them to spot a draw. */
  groups: TurnGroup[];
};
 /**
 * Builds the order of a round from the CURRENT units (pure, deterministic).
 *
 * The caller filters: a dead unit or a unit that has already acted in this round
 * must not be passed here — Battle owns that, this function only sorts.
 */
export function buildTurnOrder(units: TurnQueueUnit[], options: BuildTurnOrderOptions): TurnOrder {
  const { prioritySide } = options;

  // Rule 1: two segments. The normal one first (by DESCENDING speed), the
  // waiting one after it (by ASCENDING speed). The cascade is NOT mirrored: it
  // is the very same function for both segments.
  const normal = units
    .filter((unit) => !unit.hasWaitedThisRound)
    .sort((a, b) => b.currentSpeed - a.currentSpeed);
  const waiting = units
    .filter((unit) => unit.hasWaitedThisRound)
    .sort((a, b) => a.currentSpeed - b.currentSpeed);

  const groups: TurnGroup[] = [];

  for (const [segment, list] of [
    ['normal', normal],
    ['waiting', waiting],
  ] as const) {
    // Walk the segment by speed: every run of equal speed is ONE group — that is
    // what a draw between the sides is about (rule 1). Inside it the cascade
    // decides the order.
    let index = 0;

    while (index < list.length) {
      const speed = list[index].currentSpeed;
      let end = index;

      while (end < list.length && list[end].currentSpeed === speed) {
        end += 1;
      }

      const cell = list.slice(index, end);

      groups.push({
        segment,
        speed,
        unitIds: orderEqualSpeedGroup(cell, prioritySide),
        isCrossSide: cell.some((unit) => unit.side !== cell[0].side),
      });

      index = end;
    }
  }

  return { unitIds: groups.flatMap((group) => group.unitIds), groups };
}