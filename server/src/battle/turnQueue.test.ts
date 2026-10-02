/**
 * Tests of the pure turn queue (docs/tasks/001-turn-queue.md, rules 1 and 3).
 *
 * No Battle, no log, no random: only the ordering rules and their numbers.
 */

import { describe, expect, it } from 'vitest';

import type { BattleSide } from '@de-jija/shared';

import {
  buildTurnOrder,
  compareEqualSpeed,
  levelRank,
  type TurnQueueUnit,
} from './turnQueue';

/** One unit of the queue with only the fields that matter for the order. */
function queueUnit(
  id: string,
  side: BattleSide,
  slot: number,
  currentSpeed: number,
  changes: Partial<TurnQueueUnit> = {},
): TurnQueueUnit {
  return { id, side, slot, currentSpeed, hasWaitedThisRound: false, ...changes };
}

/** The order of the ids, the thing every test really looks at. */
function orderOf(units: TurnQueueUnit[], prioritySide: BattleSide = 'left'): string[] {
  return buildTurnOrder(units, { prioritySide }).unitIds;
}

describe('levelRank — the level scale as a number', () => {
  it('follows the HoMM3 scale: 1 < 1+ < 2 < 2+ < 3 < 3+', () => {
    expect(levelRank(1, false)).toBeLessThan(levelRank(1, true));
    expect(levelRank(1, true)).toBeLessThan(levelRank(2, false));
    expect(levelRank(2, false)).toBeLessThan(levelRank(2, true));
    expect(levelRank(2, true)).toBeLessThan(levelRank(3, false));
    expect(levelRank(3, true)).toBeLessThan(levelRank(4, false));
  });

  it('a unit without a level is the lowest one and never fails', () => {
    expect(levelRank(undefined, undefined)).toBe(levelRank(1, false));
    expect(levelRank(undefined, true)).toBe(levelRank(1, true));
  });

  it('2 is higher than 1+, and 3 is higher than 2+', () => {
    expect(levelRank(2, false)).toBeGreaterThan(levelRank(1, true));
    expect(levelRank(3, false)).toBeGreaterThan(levelRank(2, true));
  });
});

describe('rule 1 — the two segments of a round', () => {
  it('units that did not wait act first, by DESCENDING speed', () => {
    const order = orderOf([
      queueUnit('slow', 'left', 0, 5),
      queueUnit('fast', 'left', 1, 18),
      queueUnit('middle', 'right', 0, 11),
    ]);

    expect(order).toEqual(['fast', 'middle', 'slow']);
  });

  it('waiting units act after everyone else, by ASCENDING speed', () => {
    const order = orderOf([
      queueUnit('normal', 'left', 0, 3),
      queueUnit('archdevil', 'right', 0, 17, { hasWaitedThisRound: true }),
      queueUnit('phoenix', 'left', 1, 21, { hasWaitedThisRound: true }),
    ]);

    expect(order).toEqual(['normal', 'archdevil', 'phoenix']);
  });

  it('the worked example: Phoenix 21 and Arch Devil 17, both waiting', () => {
    // The Arch Devil acts first even though it pressed "wait" later — it is
    // SLOWER, and the waiting segment sorts by ASCENDING speed.
    const order = orderOf([
      queueUnit('phoenix', 'left', 0, 21, { hasWaitedThisRound: true }),
      queueUnit('archdevil', 'right', 0, 17, { hasWaitedThisRound: true }),
    ]);

    expect(order).toEqual(['archdevil', 'phoenix']);
  });

  it('a waiting unit is behind a normal unit even when it is much faster', () => {
    const order = orderOf([
      queueUnit('waited', 'left', 0, 30, { hasWaitedThisRound: true }),
      queueUnit('notWaited', 'right', 0, 2),
    ]);

    expect(order).toEqual(['notWaited', 'waited']);
  });
});
describe('rule 3a — the higher level acts earlier at equal speed', () => {
  it('the level decides regardless of the side', () => {
    const order = orderOf([
      queueUnit('leftPlain', 'left', 0, 10),
      queueUnit('rightUpgraded', 'right', 0, 10, { tier: 1, upgraded: true }),
    ]);

    expect(order).toEqual(['rightUpgraded', 'leftPlain']);
  });

  it('2 is higher than 1+, 1+ is higher than 1', () => {
    const order = orderOf([
      queueUnit('one', 'left', 0, 10, { tier: 1 }),
      queueUnit('onePlus', 'right', 0, 10, { tier: 1, upgraded: true }),
      queueUnit('two', 'left', 1, 10, { tier: 2 }),
    ]);

    expect(order).toEqual(['two', 'onePlus', 'one']);
  });

  it('the level is compared inside one speed only — speed still rules', () => {
    const order = orderOf([
      queueUnit('fastLow', 'left', 0, 12, { tier: 1 }),
      queueUnit('slowHigh', 'right', 0, 9, { tier: 5 }),
    ]);

    expect(order).toEqual(['fastLow', 'slowHigh']);
  });
});

describe('rule 3b — inside one side the leftmost slot acts earlier', () => {
  it('slots decide when the level is the same', () => {
    const order = orderOf([
      queueUnit('l3', 'left', 2, 10),
      queueUnit('l1', 'left', 0, 10),
      queueUnit('l2', 'left', 1, 10),
    ]);

    expect(order).toEqual(['l1', 'l2', 'l3']);
  });
});

describe('rule 3v — a draw between the sides is decided by the priority', () => {
  it('with the priority on the left, the left unit acts first', () => {
    const order = orderOf(
      [queueUnit('r1', 'right', 0, 10), queueUnit('l1', 'left', 0, 10)],
      'left',
    );

    expect(order).toEqual(['l1', 'r1']);
  });

  it('with the priority on the right, the right unit acts first', () => {
    const order = orderOf(
      [queueUnit('l1', 'left', 0, 10), queueUnit('r1', 'right', 0, 10)],
      'right',
    );

    expect(order).toEqual(['r1', 'l1']);
  });

  it('a unit without a level equals the lowest level, it is not below it', () => {
    const order = orderOf([
      queueUnit('noLevel', 'left', 0, 10),
      queueUnit('plainOne', 'right', 0, 10, { tier: 1 }),
    ]);

    // Same level (the lowest) and different sides -> the priority decides.
    expect(order).toEqual(['noLevel', 'plainOne']);
  });
});
describe('rule 4v — a group is ONE situation, the sides alternate', () => {
  it('three equal units of two sides: A1, B1, A2 — the sides alternate', () => {
    const order = orderOf(
      [
        queueUnit('a2', 'left', 1, 10),
        queueUnit('b1', 'right', 0, 10),
        queueUnit('a1', 'left', 0, 10),
      ],
      'left',
    );

    expect(order).toEqual(['a1', 'b1', 'a2']);
  });

  it('the same group with the priority on the right: B1, A1, B2', () => {
    const order = orderOf(
      [
        queueUnit('a1', 'left', 0, 10),
        queueUnit('b2', 'right', 1, 10),
        queueUnit('b1', 'right', 0, 10),
      ],
      'right',
    );

    expect(order).toEqual(['b1', 'a1', 'b2']);
  });

  it('four equal units: one block, slots decide inside each side', () => {
    const built = buildTurnOrder(
      [
        queueUnit('a1', 'left', 0, 10),
        queueUnit('a2', 'left', 1, 10),
        queueUnit('b1', 'right', 0, 10),
        queueUnit('b2', 'right', 1, 10),
      ],
      { prioritySide: 'left' },
    );

    expect(built.unitIds).toEqual(['a1', 'b1', 'a2', 'b2']);
    // ONE group for the whole four — so the priority shifts exactly once.
    expect(built.groups).toHaveLength(1);
    expect(built.groups[0].isCrossSide).toBe(true);
  });

  it('a group of one side only is not a draw at all', () => {
    const built = buildTurnOrder(
      [queueUnit('a1', 'left', 0, 10), queueUnit('a2', 'left', 1, 10)],
      { prioritySide: 'left' },
    );

    expect(built.groups[0].isCrossSide).toBe(false);
  });
});
describe('the groups of the order', () => {
  it('the group list tells Battle where a real draw is', () => {
    const built = buildTurnOrder(
      [
        queueUnit('fast', 'left', 0, 17),
        queueUnit('a1', 'left', 1, 11),
        queueUnit('b1', 'right', 0, 11),
      ],
      { prioritySide: 'left' },
    );

    expect(built.groups.map((group) => group.unitIds)).toEqual([['fast'], ['a1', 'b1']]);
    expect(built.groups.map((group) => group.isCrossSide)).toEqual([false, true]);
  });

  it('different levels of the same speed are different groups', () => {
    const built = buildTurnOrder(
      [
        queueUnit('high', 'left', 0, 11, { tier: 4 }),
        queueUnit('low', 'right', 0, 11, { tier: 1 }),
      ],
      { prioritySide: 'left' },
    );

    expect(built.groups).toHaveLength(2);
    expect(built.groups.map((group) => group.levelRank)).toEqual([
      levelRank(4, false),
      levelRank(1, false),
    ]);
  });

  it('the cascade is NOT mirrored in the waiting segment', () => {
    // Both waiting, equal speed, priority on the right: the priority side still
    // acts first — only the speed direction is mirrored (rule 3).
    const built = buildTurnOrder(
      [
        queueUnit('a1', 'left', 0, 12, { hasWaitedThisRound: true }),
        queueUnit('b1', 'right', 0, 12, { hasWaitedThisRound: true }),
      ],
      { prioritySide: 'right' },
    );

    expect(built.unitIds).toEqual(['b1', 'a1']);
  });

  it('the order does not depend on the order of the input array', () => {
    const units = [
      queueUnit('a1', 'left', 0, 11),
      queueUnit('b1', 'right', 0, 11),
      queueUnit('c1', 'left', 1, 9),
      queueUnit('a2', 'left', 2, 14),
    ];

    const straight = orderOf(units, 'left');
    const shuffled = orderOf([units[2], units[3], units[0], units[1]], 'left');

    expect(shuffled).toEqual(straight);
  });

  it('the same input always gives the same order (deterministic)', () => {
    const units = [
      queueUnit('a1', 'left', 0, 11, { tier: 2 }),
      queueUnit('b1', 'right', 0, 11),
      queueUnit('b2', 'right', 1, 11, { tier: 2 }),
      queueUnit('c1', 'left', 1, 7, { hasWaitedThisRound: true }),
    ];

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(orderOf(units, 'left')).toEqual(['a1', 'b2', 'b1', 'c1']);
    }
  });
});

describe('compareEqualSpeed — the cascade is one function', () => {
  it('orders units exactly as rules 3a/3b/3v say', () => {
    const a1 = queueUnit('a1', 'left', 0, 10, { tier: 1 });
    const a2 = queueUnit('a2', 'left', 1, 10, { tier: 1 });
    const a2plus = queueUnit('a2plus', 'left', 1, 10, { tier: 2, upgraded: true });
    const b1 = queueUnit('b1', 'right', 0, 10, { tier: 1 });

    // (a) the level first
    expect(compareEqualSpeed(a2plus, a2, 'left')).toBeLessThan(0);
    // (b) the slot inside one side
    expect(compareEqualSpeed(a1, a2, 'left')).toBeLessThan(0);
    // (c) the priority side between the sides
    expect(compareEqualSpeed(a1, b1, 'left')).toBeLessThan(0);
    expect(compareEqualSpeed(a1, b1, 'right')).toBeGreaterThan(0);
  });
});