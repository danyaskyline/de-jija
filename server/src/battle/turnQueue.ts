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
 *   1. SEGMENT. Units that did NOT wait go first, by DESCENDING speed; then the
 *      units that did wait, by ASCENDING speed. The cascade for equal speeds is
 *      the SAME in both segments — only the direction of the speed sort is
 *      mirrored (rules 1/3).
 *   2. CASCADE for equal speed — one single function, compareEqualSpeed():
 *        a) the higher LEVEL acts earlier: 1 < 1+ < 2 < 2+ < 3 …;
 *        b) same level, SAME side: the leftmost slot in the army acts earlier;
 *        c) same level, DIFFERENT sides: the side with the priority acts earlier.
 *   3. GROUPS. Units with the same speed AND the same level form one group. A
 *      group that has units of both sides is a real DRAW: it is resolved by the
 *      priority side and the priority then passes to the other side (rules
 *      4b/4v). A group of three or more counts as ONE situation: inside it the
 *      sides alternate, starting from the priority side.
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
 * One group of units that share the same speed AND the same level. A group with
 * units of both sides is a draw that is decided by the priority side.
 */
export type TurnGroup = {
  /** Which segment of the round the group belongs to. */
  segment: 'normal' | 'waiting';
  /** The speed all units of the group share. */
  speed: number;
  /** The level rank all units of the group share. */
  levelRank: number;
  /** The units of the group IN THE ORDER THEY WILL ACT. */
  unitIds: string[];
  /** True when the group has units of both sides — a real draw (rule 3v). */
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

/**
 * THE CASCADE FOR EQUAL SPEED — rules 3a/3b/3v, and nothing else.
 *
 * It is deliberately one small function: changing the equal-speed rule later
 * must be a change HERE, not a hunt through the sorting code. Returns a negative
 * number when `a` acts before `b`, a positive one when after.
 */
export function compareEqualSpeed(
  a: TurnQueueUnit,
  b: TurnQueueUnit,
  prioritySide: BattleSide,
): number {
  // (a) The higher level acts earlier.
  const rankA = rankOf(a);
  const rankB = rankOf(b);

  if (rankA !== rankB) {
    return rankB - rankA;
  }

  // (b) Same level and the same side: the leftmost slot in the army acts first.
  if (a.side === b.side) {
    return a.slot - b.slot;
  }

  // (c) Same level, different sides: the side with the priority acts first.
  return a.side === prioritySide ? -1 : 1;
}

/** Slot order inside one side: the leftmost slot of the army acts first. */
function bySlot(a: TurnQueueUnit, b: TurnQueueUnit): number {
  return a.slot - b.slot;
}

/**
 * Orders ONE group of equal-speed, equal-level units — rule 4v.
 *
 * Inside one side the slots decide (left slot first); the sides then ALTERNATE,
 * starting from the priority side. A group of three or more is therefore
 * A1, B1, A2, B2 … — and the whole group stays ONE situation.
 */
function orderGroupUnits(group: TurnQueueUnit[], prioritySide: BattleSide): string[] {
  const otherSide: BattleSide = prioritySide === 'left' ? 'right' : 'left';

  const ofPriority = group.filter((unit) => unit.side === prioritySide).sort(bySlot);
  const ofOther = group.filter((unit) => unit.side === otherSide).sort(bySlot);

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
    // Walk the segment by speed: every run of equal speed is one speed group,
    // and inside a speed run the units of one level form a group — a group is a
    // cell of "same speed AND same level", which is exactly what a draw is about.
    let index = 0;

    while (index < list.length) {
      const speed = list[index].currentSpeed;
      let end = index;

      while (end < list.length && list[end].currentSpeed === speed) {
        end += 1;
      }

      // Inside one speed the units are put in order by the CASCADE — the very
      // same function both segments use — and then split into groups of one
      // level: a group is a cell of "same speed AND same level", which is
      // exactly what a draw (rule 3v) is about.
      const bySpeed = list.slice(index, end).sort((a, b) => compareEqualSpeed(a, b, prioritySide));
      let inner = 0;

      while (inner < bySpeed.length) {
        const rank = rankOf(bySpeed[inner]);
        let innerEnd = inner;

        while (innerEnd < bySpeed.length && rankOf(bySpeed[innerEnd]) === rank) {
          innerEnd += 1;
        }

        const cell = bySpeed.slice(inner, innerEnd);

        groups.push({
          segment,
          speed,
          levelRank: rank,
          unitIds: orderGroupUnits(cell, prioritySide),
          isCrossSide: cell.some((unit) => unit.side !== cell[0].side),
        });

        inner = innerEnd;
      }

      index = end;
    }
  }

  return { unitIds: groups.flatMap((group) => group.unitIds), groups };
}