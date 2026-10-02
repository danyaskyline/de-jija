/**
 * Tests of the pure turn queue (docs/tasks/001-turn-queue.md, rules 1 and 3).
 *
 * No Battle, no log, no random: only the ordering rules and their numbers.
 */

import { describe, expect, it } from 'vitest';

import type { BattleSide } from '@de-jija/shared';

import {
  buildTurnOrder,
  compareWithinSide,
  decideInitialPriority,
  levelRank,
  orderEqualSpeedGroup,
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
  it('the level does NOT decide BETWEEN the sides — the priority does (rule 1b)', () => {
    // Task 002 correction: the left unit is level 1 and the right one is 1+, but
    // the priority is on the left, so the LEFT unit acts first. In task 001 the
    // level was compared first and the right unit used to win here.
    const order = orderOf(
      [
        queueUnit('leftPlain', 'left', 0, 10),
        queueUnit('rightUpgraded', 'right', 0, 10, { tier: 1, upgraded: true }),
      ],
      'left',
    );

    expect(order).toEqual(['leftPlain', 'rightUpgraded']);

    // And with the priority on the right it is the other way round, still
    // ignoring the level.
    const flipped = orderOf(
      [
        queueUnit('leftPlain', 'left', 0, 10),
        queueUnit('rightUpgraded', 'right', 0, 10, { tier: 1, upgraded: true }),
      ],
      'right',
    );

    expect(flipped).toEqual(['rightUpgraded', 'leftPlain']);
  });

  it('inside ONE side the level decides, and then the slot', () => {
    const order = orderOf([
      queueUnit('a1', 'left', 0, 10, { tier: 1 }),
      queueUnit('a3', 'left', 2, 10, { tier: 3 }),
      queueUnit('a2', 'left', 1, 10, { tier: 2 }),
    ]);

    // 2 > 1+ > 1 and, at the same level, the leftmost slot acts first.
    expect(order).toEqual(['a3', 'a2', 'a1']);
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

  it('all units of the same speed are ONE group, whatever their level', () => {
    const built = buildTurnOrder(
      [
        queueUnit('high', 'left', 0, 11, { tier: 4 }),
        queueUnit('low', 'right', 0, 11, { tier: 1 }),
      ],
      { prioritySide: 'left' },
    );

    // Task 002: the level no longer splits the group — the group is the whole
    // run of equal speed, so this draw is really one draw.
    expect(built.groups).toHaveLength(1);
    expect(built.groups[0].unitIds).toEqual(['high', 'low']);
    expect(built.groups[0].isCrossSide).toBe(true);
  });

  it('3 against 1, priority on A: A by level, B1, then the rest of A', () => {
    const built = buildTurnOrder(
      [
        queueUnit('a1', 'left', 0, 17, { tier: 1 }),
        queueUnit('a2', 'left', 1, 17, { tier: 3 }),
        queueUnit('a3', 'left', 2, 17, { tier: 2 }),
        queueUnit('b1', 'right', 0, 17, { tier: 1 }),
      ],
      { prioritySide: 'left' },
    );

    // Inside A: level, then slot -> A2 (3), A3 (2), A1 (1). The sides alternate
    // from the priority side, and the leftover of one side goes as a block.
    expect(built.unitIds).toEqual(['a2', 'b1', 'a3', 'a1']);

    // ONE group: one draw, so the priority is spent exactly once (001/4b).
    expect(built.groups).toHaveLength(1);
    expect(built.groups[0].isCrossSide).toBe(true);
  });

  it('3 against 1, priority on B: B1 first, then all of A by level and slot', () => {
    const built = buildTurnOrder(
      [
        queueUnit('a1', 'left', 0, 17, { tier: 1 }),
        queueUnit('a2', 'left', 1, 17, { tier: 3 }),
        queueUnit('a3', 'left', 2, 17, { tier: 2 }),
        queueUnit('b1', 'right', 0, 17, { tier: 1 }),
      ],
      { prioritySide: 'right' },
    );

    // The priority side starts; A has no other unit to alternate with afterwards,
    // so all three of its units follow each other by level.
    expect(built.unitIds).toEqual(['b1', 'a2', 'a3', 'a1']);
    expect(built.groups).toHaveLength(1);
  });

  it('inside a side with equal levels the slot decides', () => {
    const built = buildTurnOrder(
      [
        queueUnit('a2', 'left', 1, 17, { tier: 2 }),
        queueUnit('a1', 'left', 0, 17, { tier: 2 }),
        queueUnit('b1', 'right', 0, 17, { tier: 2 }),
      ],
      { prioritySide: 'left' },
    );

    // Same level everywhere: the slots order the left side, and the sides still
    // alternate from the priority.
    expect(built.unitIds).toEqual(['a1', 'b1', 'a2']);
  });

  it('the worked example: priority on A, A2 (level 3), A1 (level 1), B1 — A2, B1, A1', () => {
    const built = buildTurnOrder(
      [
        queueUnit('a1', 'left', 0, 17, { tier: 1 }),
        queueUnit('b1', 'right', 0, 17, { tier: 1 }),
        queueUnit('a2', 'left', 1, 17, { tier: 3 }),
      ],
      { prioritySide: 'left' },
    );

    // Inside the left side the level decides (A2 before A1), the sides alternate
    // from the priority side.
    expect(built.unitIds).toEqual(['a2', 'b1', 'a1']);
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

describe('compareWithinSide — the order inside ONE side', () => {
  it('the level first, then the slot (002/1(а))', () => {
    const a1 = queueUnit('a1', 'left', 0, 10, { tier: 1 });
    const a2 = queueUnit('a2', 'left', 1, 10, { tier: 1 });
    const a2plus = queueUnit('a2plus', 'left', 1, 10, { tier: 2, upgraded: true });
    const a4 = queueUnit('a4', 'left', 2, 10, { tier: 4 });

    // The higher level acts earlier …
    expect(compareWithinSide(a2plus, a2)).toBeLessThan(0);
    expect(compareWithinSide(a4, a2plus)).toBeLessThan(0);
    // … and at the same level the leftmost slot acts first.
    expect(compareWithinSide(a1, a2)).toBeLessThan(0);
    expect(compareWithinSide(a2, a1)).toBeGreaterThan(0);
  });
});

describe('orderEqualSpeedGroup — the equal-speed rule (002/1)', () => {
  it('the sides alternate from the priority side; the level is not looked at', () => {
    const group = [
      queueUnit('a1', 'left', 0, 17, { tier: 1 }),
      queueUnit('b1', 'right', 0, 17, { tier: 9 }),
    ];

    // B1 has a much higher level, but between the sides the PRIORITY decides.
    expect(orderEqualSpeedGroup(group, 'left')).toEqual(['a1', 'b1']);
    expect(orderEqualSpeedGroup(group, 'right')).toEqual(['b1', 'a1']);
  });

  it('inside each side the level, then the slot', () => {
    const group = [
      queueUnit('a1', 'left', 0, 17, { tier: 1 }),
      queueUnit('a2', 'left', 1, 17, { tier: 3 }),
      queueUnit('b1', 'right', 0, 17, { tier: 1 }),
      queueUnit('b2', 'right', 1, 17, { tier: 2 }),
    ];

    expect(orderEqualSpeedGroup(group, 'left')).toEqual(['a2', 'b2', 'a1', 'b1']);
  });

  it('a group of one side only keeps the level and slot order', () => {
    const group = [
      queueUnit('a1', 'left', 0, 17, { tier: 1 }),
      queueUnit('a2', 'left', 1, 17, { tier: 3 }),
    ];

    expect(orderEqualSpeedGroup(group, 'right')).toEqual(['a2', 'a1']);
  });
});
describe('decideInitialPriority — the opening priority (002/0)', () => {
  /** A coin that records whether it was thrown, and which side it returned. */
  function countedCoin(result: 'left' | 'right') {
    let calls = 0;

    return {
      flip: () => {
        calls += 1;
        return result;
      },
      calls: () => calls,
    };
  }

  it('different top speeds: the priority goes to the side that acts second, no coin', () => {
    const coin = countedCoin('left');

    // Example 1: A's fastest is 21, B's is 17.
    const first = decideInitialPriority(
      [queueUnit('a1', 'left', 0, 21), queueUnit('b1', 'right', 0, 17)],
      coin.flip,
    );

    expect(first).toEqual({ prioritySide: 'right', reason: 'speed' });
    expect(coin.calls()).toBe(0);

    // The other way round: now B is faster, so the priority is on the left.
    const mirrored = decideInitialPriority(
      [queueUnit('a1', 'left', 0, 17), queueUnit('b1', 'right', 0, 21)],
      countedCoin('right').flip,
    );

    expect(mirrored).toEqual({ prioritySide: 'left', reason: 'speed' });
  });

  it('two fast units on one side are still one maximum (example 3)', () => {
    const coin = countedCoin('left');

    const result = decideInitialPriority(
      [
        queueUnit('a1', 'left', 0, 17),
        queueUnit('a2', 'left', 1, 17),
        queueUnit('b1', 'right', 0, 12),
      ],
      coin.flip,
    );

    expect(result).toEqual({ prioritySide: 'right', reason: 'speed' });
    expect(coin.calls()).toBe(0);
  });

  it('equal top speeds: the coin is thrown exactly once and decides (example 2)', () => {
    const left = countedCoin('left');
    const right = countedCoin('right');
    const units = [queueUnit('a1', 'left', 0, 17), queueUnit('b1', 'right', 0, 17)];

    expect(decideInitialPriority(units, left.flip)).toEqual({
      prioritySide: 'left',
      reason: 'coin',
    });
    expect(left.calls()).toBe(1);

    expect(decideInitialPriority(units, right.flip)).toEqual({
      prioritySide: 'right',
      reason: 'coin',
    });
    expect(right.calls()).toBe(1);
  });

  it('the level does not affect the opening priority', () => {
    const coin = countedCoin('left');

    // The top speeds are EQUAL here, so the only thing that can decide is the coin.
    // The left unit has a much higher level — if the function ever started to look
    // at levels, this test would fail instead of passing by accident.
    const result = decideInitialPriority(
      [
        queueUnit('a1', 'left', 0, 17, { tier: 9 }),
        queueUnit('b1', 'right', 0, 17, { tier: 1 }),
      ],
      coin.flip,
    );

    expect(result).toEqual({ prioritySide: 'left', reason: 'coin' });
    expect(coin.calls()).toBe(1);
  });

  it('a side without units counts as speed 0', () => {
    const coin = countedCoin('left');

    // One side empty, the other has units: the empty side acts second, so it has
    // the priority — and no coin is needed.
    const oneEmpty = decideInitialPriority([queueUnit('b1', 'right', 0, 7)], coin.flip);

    expect(oneEmpty).toEqual({ prioritySide: 'left', reason: 'speed' });
    expect(coin.calls()).toBe(0);

    // Both sides empty: both maxima are 0, so it is a coin.
    const bothEmpty = decideInitialPriority([], countedCoin('right').flip);

    expect(bothEmpty).toEqual({ prioritySide: 'right', reason: 'coin' });
  });

  it('the same armies and the same coin always give the same answer', () => {
    const units = [
      queueUnit('a1', 'left', 0, 17),
      queueUnit('a2', 'left', 1, 11),
      queueUnit('b1', 'right', 0, 17),
    ];

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(decideInitialPriority(units, () => 'left')).toEqual({
        prioritySide: 'left',
        reason: 'coin',
      });
      expect(decideInitialPriority(units, () => 'right')).toEqual({
        prioritySide: 'right',
        reason: 'coin',
      });
    }
  });
});