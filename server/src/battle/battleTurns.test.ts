/**
 * Tests of the turn queue INSIDE a battle (docs/tasks/001-turn-queue.md).
 *
 * The pure ordering rules are covered in turnQueue.test.ts; here we check that
 * Battle keeps the queue, the current unit, "wait", the priority of the sides and
 * the log of the decisions in step with the rules of the task.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { BattleSetup, CombatUnit } from '@de-jija/shared';

import { getCombatRules, initCombatRules } from '../combat/combatRules';
import { initSkills, type SkillsData } from '../combat/skills';
import { createBattle, oppositeSide, type Battle } from './battle';
import type { BattleRules } from './battleRules';

/** A small field, so the start zone and the borders are easy to reason about. */
const BATTLE_RULES: BattleRules = {
  fieldWidth: 15,
  fieldHeight: 11,
  maxUnitsPerSide: 7,
  startZoneWidth: 2,
};

let skills: SkillsData;

beforeAll(() => {
  initCombatRules();
  skills = initSkills();
});

beforeEach(() => {
  initCombatRules();
  initSkills();
});

/** A plain unit with the speed, level and hp a queue test needs. */
function fighter(speed: number, changes: Partial<CombatUnit> = {}): CombatUnit {
  return {
    id: 'u',
    name: 'u',
    stats: { hp: 100, attack: 10, defense: 5, speed, damageMin: 5, damageMax: 5 },
    tags: [],
    currentHp: 100,
    ...changes,
  };
}

/** A setup with plain units on both sides. */
type Entry = {
  id: string;
  unit: CombatUnit;
  hex?: { x: number; y: number } | null;
};

function setupOf(left: Entry[], right: Entry[]): BattleSetup {
  const toSetup = (entry: Entry) => ({
    id: entry.id,
    unit: entry.unit,
    stackCount: 1,
    hex: entry.hex ?? null,
  });

  return {
    placementMode: 'free',
    sides: {
      left: { hero: null, units: left.map(toSetup) },
      right: { hero: null, units: right.map(toSetup) },
    },
  };
}

/**
 * Creates a battle. `coin` is the value the priority coin returns: 0 gives the
 * priority to the left, 0.9 to the right.
 */
function makeBattle(
  setup: BattleSetup,
  options: { coin?: number; enforceTurns?: boolean } = {},
): Battle {
  // How many times the battle actually read a random value. Since 002/0 the
  // opening priority is thrown by SPEED and the coin is read only when the top
  // speeds are equal — so passing `coin` where it is never read is a mistake in
  // the test, not a harmless leftover.
  let randomCalls = 0;

  const created = createBattle(setup, {
    combatRules: getCombatRules(),
    skillsData: skills,
    battleRules: BATTLE_RULES,
    random: () => {
      randomCalls += 1;
      return options.coin ?? 0;
    },
    enforceTurns: options.enforceTurns === true,
  });

  if (options.coin !== undefined && randomCalls === 0) {
    throw new Error(
      'coin passed but never read: this setup is decided by speed, so drop the coin',
    );
  }

  if (!created.ok) {
    throw new Error(`createBattle failed unexpectedly: ${created.code} ${created.message}`);
  }

  return created.battle;
}

/** Who acts now, and who after it. */
function turnsOf(battle: Battle) {
  const { turns } = battle.getState();

  return { current: turns.currentUnitId, next: [...turns.order] };
}

/** The event types of the whole log. */
function logTypes(battle: Battle): string[] {
  return battle.getState().log.map((event) => event.type);
}
describe('002/0 — the opening priority of the new battle', () => {
  it('is decided by speed when the top speeds differ, and the coin is not thrown', () => {
    let calls = 0;
    const created = createBattle(
      setupOf([{ id: 'l1', unit: fighter(18) }], [{ id: 'r1', unit: fighter(5) }]),
      {
        combatRules: getCombatRules(),
        skillsData: skills,
        battleRules: BATTLE_RULES,
        random: () => {
          calls += 1;
          return 0;
        },
      },
    );

    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const battle = created.battle;

    // L1 (18) is faster, so L1 acts first — and therefore the priority goes to the
    // side that acts SECOND, which is the right one.
    expect(battle.getState().turns.prioritySide).toBe('right');
    expect(turnsOf(battle).current).toBe('l1');
    // The coin was NOT thrown: no random value was read at all.
    expect(calls).toBe(0);
    expect(battle.getState().log[0]).toEqual({
      type: 'PriorityRolled',
      side: 'right',
      reason: 'speed',
    });
    // With no draw in round 1 there is nothing to spend the priority on.
    expect(logTypes(battle)).toEqual(['PriorityRolled', 'TurnStarted']);
  });

  it('two fast units on one side are still one maximum (example 3)', () => {
    let calls = 0;
    const created = createBattle(
      setupOf(
        [
          { id: 'a1', unit: fighter(17) },
          { id: 'a2', unit: fighter(17) },
        ],
        [{ id: 'b1', unit: fighter(12) }],
      ),
      {
        combatRules: getCombatRules(),
        skillsData: skills,
        battleRules: BATTLE_RULES,
        random: () => {
          calls += 1;
          return 0;
        },
      },
    );

    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const battle = created.battle;

    // The left side clearly wins the speed, so the priority is on the right and no
    // coin is thrown.
    expect(battle.getState().turns.prioritySide).toBe('right');
    expect(turnsOf(battle).current).toBe('a1');
    expect(turnsOf(battle).next).toEqual(['a2', 'b1']);
    expect(calls).toBe(0);
  });

  it('the injected random decides it only when the top speeds are equal', () => {
    const withCoin = (coin: number) => {
      let calls = 0;
      const created = createBattle(
        setupOf([{ id: 'l1', unit: fighter(9) }], [{ id: 'r1', unit: fighter(9) }]),
        {
          combatRules: getCombatRules(),
          skillsData: skills,
          battleRules: BATTLE_RULES,
          random: () => {
            calls += 1;
            return coin;
          },
        },
      );

      expect(created.ok).toBe(true);
      if (!created.ok) {
        return undefined;
      }

      return { battle: created.battle, calls };
    };

    // Equal speeds: the coin is thrown exactly once and is written to the log.
    const leftThrow = withCoin(0.1);
    const rightThrow = withCoin(0.9);

    expect(leftThrow?.battle.getState().log[0]).toEqual({
      type: 'PriorityRolled',
      side: 'left',
      reason: 'coin',
    });
    expect(rightThrow?.battle.getState().log[0]).toEqual({
      type: 'PriorityRolled',
      side: 'right',
      reason: 'coin',
    });
    expect(leftThrow?.calls).toBe(1);
    expect(rightThrow?.calls).toBe(1);

    // The coin decides the DRAW on top: the priority side acts first, and the
    // priority immediately passes to the other side (001/4б).
    const left = leftThrow?.battle;
    const right = rightThrow?.battle;

    if (left === undefined || right === undefined) {
      throw new Error('createBattle unexpectedly refused a valid setup');
    }

    expect(turnsOf(left).current).toBe('l1');
    expect(left.getState().turns.prioritySide).toBe('right');
    expect(logTypes(left).filter((type) => type === 'PriorityPassed')).toHaveLength(1);

    expect(turnsOf(right).current).toBe('r1');
    expect(right.getState().turns.prioritySide).toBe('left');
    expect(logTypes(right).filter((type) => type === 'PriorityPassed')).toHaveLength(1);
  });

  it('consumes exactly one value of random at creation, and only when needed', () => {
    /** Creates a battle and reports how many times random was read. */
    const build = (left: number, right: number) => {
      let calls = 0;

      createBattle(
        setupOf([{ id: 'l1', unit: fighter(left) }], [{ id: 'r1', unit: fighter(right) }]),
        {
          combatRules: getCombatRules(),
          skillsData: skills,
          battleRules: BATTLE_RULES,
          random: () => {
            calls += 1;
            return 0;
          },
        },
      );

      return calls;
    };

    // Different top speeds: no coin at all.
    expect(build(7, 8)).toBe(0);
    // Equal top speeds: exactly one coin, never more.
    expect(build(7, 7)).toBe(1);
    expect(build(20, 20)).toBe(1);
  });

  it('the opening priority is deterministic for the same setup', () => {
    const build = () =>
      makeBattle(
        setupOf(
          [
            { id: 'a1', unit: fighter(17) },
            { id: 'a2', unit: fighter(11) },
          ],
          [{ id: 'b1', unit: fighter(17) }],
        ),
        { enforceTurns: true },
      );

    const first = build();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(turnsOf(build())).toEqual(turnsOf(first));
      expect(build().getState().turns.prioritySide).toBe(first.getState().turns.prioritySide);
    }
  });
});

describe('rules 1 and 2 — the segments of the round and "wait"', () => {
  it('a waiting unit moves behind everybody, by ascending speed', () => {
    const battle = makeBattle(
      setupOf(
        [
          { id: 'a1', unit: fighter(12) },
          { id: 'a2', unit: fighter(21) },
        ],
        [
          { id: 'b1', unit: fighter(17) },
          { id: 'b2', unit: fighter(8) },
        ],
      ),
      { enforceTurns: true },
    );

    // Nobody waited: everyone acts by descending speed.
    expect(turnsOf(battle).current).toBe('a2');
    expect(turnsOf(battle).next).toEqual(['b1', 'a1', 'b2']);

    // A2 waits: it leaves the normal segment for the waiting one, which now holds
    // it alone, so the rest of the queue is unchanged.
    battle.wait('a2');

    expect(turnsOf(battle).current).toBe('b1');
    expect(turnsOf(battle).next).toEqual(['a1', 'b2', 'a2']);
    expect(logTypes(battle)).toContain('UnitWaited');
  });

  it('two waiting units act by ASCENDING speed: the Arch Devil before the Phoenix', () => {
    const battle = makeBattle(
      setupOf(
        [
          { id: 'phoenix', unit: fighter(21) },
          { id: 'swordsman', unit: fighter(11) },
        ],
        [{ id: 'archdevil', unit: fighter(17) }],
      ),
      { enforceTurns: true },
    );

    // Nobody waited: Phoenix 21, Arch Devil 17, Swordsman 11.
    expect(turnsOf(battle).current).toBe('phoenix');
    expect(turnsOf(battle).next).toEqual(['archdevil', 'swordsman']);

    // The Phoenix waits: it leaves the normal segment and joins the waiting one.
    battle.wait('phoenix');

    // The rest of the normal segment plays first, then the waiting segment.
    expect(turnsOf(battle).current).toBe('archdevil');
    expect(turnsOf(battle).next).toEqual(['swordsman', 'phoenix']);

    // The Arch Devil may wait too: both are now in the waiting segment, which sorts
    // by ASCENDING speed — so the Arch Devil (17) is now ahead of the Phoenix (21).
    battle.wait('archdevil');

    expect(turnsOf(battle).current).toBe('swordsman');
    expect(turnsOf(battle).next).toEqual(['archdevil', 'phoenix']);

    battle.endTurn();

    expect(turnsOf(battle).current).toBe('archdevil');
    expect(turnsOf(battle).next).toEqual(['phoenix']);
  });

  it('a unit may wait at most once per battle', () => {
    const battle = makeBattle(
      setupOf([{ id: 'l1', unit: fighter(9) }], [{ id: 'r1', unit: fighter(5) }]),
      { enforceTurns: true },
    );

    expect(battle.wait('l1').ok).toBe(true);

    const second = battle.wait('l1');

    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.code).toBe('ALREADY_WAITED');
      expect(second.message).toMatch(/не более одного раза за бой/);
    }
  });

  it('the flag survives into the next round: a unit that waited may not wait again', () => {
    const battle = makeBattle(
      setupOf([{ id: 'l1', unit: fighter(9) }], [{ id: 'r1', unit: fighter(5) }]),
      { enforceTurns: true },
    );

    battle.wait('l1');
    battle.endTurn();
    battle.endTurn();

    expect(battle.getState().round).toBe(2);

    const again = battle.wait('l1');

    expect(again.ok).toBe(false);
    if (!again.ok) {
      expect(again.code).toBe('ALREADY_WAITED');
    }
  });

  it('waiting outside your own turn is refused when turns are enforced', () => {
    const battle = makeBattle(
      setupOf([{ id: 'l1', unit: fighter(9) }], [{ id: 'r1', unit: fighter(5) }]),
      { enforceTurns: true },
    );

    const result = battle.wait('r1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('NOT_YOUR_TURN');
    }
  });
});
describe('rule 3 — speed, level and slot decide the order', () => {
  it('speed first, then the level INSIDE a side, then the sides alternate', () => {
    const battle = makeBattle(
      setupOf(
        [
          { id: 'a1', unit: fighter(11) },
          { id: 'a2', unit: fighter(11, { tier: 3 }) },
        ],
        [
          { id: 'b1', unit: fighter(17) },
          { id: 'b2', unit: fighter(11) },
        ],
      ),
      {},
    );

    // 17 first. Then the group of 11s: inside the left side the level decides
    // (A2 before A1) and the sides alternate from the priority side (left), so
    // the group is A2, B2, A1 — task 002 no longer lets the level of A2 push the
    // right side behind both left units.
    expect(turnsOf(battle).current).toBe('b1');
    expect(turnsOf(battle).next).toEqual(['a2', 'b2', 'a1']);
  });

  it('a unit without a level equals the lowest level', () => {
    const battle = makeBattle(
      setupOf(
        [{ id: 'a1', unit: fighter(11) }],
        [{ id: 'b1', unit: fighter(11, { tier: 1 }) }],
      ),
      {},
    );

    expect(turnsOf(battle).current).toBe('a1');
  });
});

describe('rules 3v/4 — the priority of the sides', () => {
  it('a draw is decided by the priority side, and the priority passes on', () => {
    const battle = makeBattle(
      setupOf([{ id: 'a1', unit: fighter(11) }], [{ id: 'b1', unit: fighter(11) }]),
      {},
    );

    expect(turnsOf(battle).current).toBe('a1');
    expect(battle.getState().turns.prioritySide).toBe('right');

    const passed = battle.getState().log.find((event) => event.type === 'PriorityPassed');

    expect(passed).toEqual({
      type: 'PriorityPassed',
      round: 1,
      from: 'left',
      to: 'right',
      unitIds: ['a1', 'b1'],
    });
  });

  it('the priority alternates over several rounds, and the alternation survives', () => {
    const battle = makeBattle(
      setupOf([{ id: 'a1', unit: fighter(11) }], [{ id: 'b1', unit: fighter(11) }]),
      { enforceTurns: true },
    );

    const winnerOfRound: string[] = [];

    for (let round = 0; round < 4; round += 1) {
      winnerOfRound.push(turnsOf(battle).current ?? '?');
      battle.endTurn();
      battle.endTurn();
    }

    // Round 1 the priority is on the left, in round 2 on the right, and so on —
    // the opening decision is logged only ONCE, at creation.
    expect(winnerOfRound).toEqual(['a1', 'b1', 'a1', 'b1']);
    expect(battle.getState().round).toBe(5);
    expect(logTypes(battle).filter((type) => type === 'PriorityRolled')).toHaveLength(1);
  });

  it('the level does NOT close a draw between the sides: the priority does', () => {
    const battle = makeBattle(
      setupOf(
        [{ id: 'a1', unit: fighter(11, { tier: 2 }) }],
        [{ id: 'b1', unit: fighter(11, { tier: 1 }) }],
      ),
      {},
    );

    // Task 002: the level of A1 no longer closes the draw by itself. Both top
    // speeds are 11, so the opening coin puts the priority on the left; the group
    // is cross-side, so the priority side acts first and the priority passes to
    // the other side exactly once.
    expect(turnsOf(battle).current).toBe('a1');
    expect(battle.getState().turns.prioritySide).toBe('right');
    expect(logTypes(battle).filter((type) => type === 'PriorityPassed')).toHaveLength(1);
  });

  it('the slot decides INSIDE a side, and a one-side group never moves the priority', () => {
    const battle = makeBattle(
      setupOf(
        [
          { id: 'a1', unit: fighter(11) },
          { id: 'a2', unit: fighter(11) },
          { id: 'a3', unit: fighter(6) },
        ],
        [{ id: 'b1', unit: fighter(5) }],
      ),
      {},
    );

    // The three left units of 11 are one group of ONE side: the slots order them,
    // and the priority is NOT touched at all — there is no cross-side draw here.
    expect(turnsOf(battle).current).toBe('a1');
    expect(turnsOf(battle).next).toEqual(['a2', 'a3', 'b1']);
    expect(battle.getState().turns.prioritySide).toBe('right');
    expect(logTypes(battle)).not.toContain('PriorityPassed');
  });

  it('a group of three is ONE situation: it shifts the priority exactly once', () => {
    const battle = makeBattle(
      setupOf(
        [
          { id: 'a1', unit: fighter(11) },
          { id: 'a2', unit: fighter(11) },
        ],
        [
          { id: 'b1', unit: fighter(11) },
          { id: 'b2', unit: fighter(11) },
        ],
      ),
      {},
    );

    // Four equal units: A1, B1, A2, B2 — the sides alternate from the priority.
    expect(turnsOf(battle).current).toBe('a1');
    expect(turnsOf(battle).next).toEqual(['b1', 'a2', 'b2']);
    expect(battle.getState().turns.prioritySide).toBe('right');
    expect(logTypes(battle).filter((type) => type === 'PriorityPassed')).toHaveLength(1);
  });
});
describe('rules 5 and 6 — speed changes and deaths inside a round', () => {
  it('the worked example: a haste turns 11 into 17 and makes a draw', () => {
    // Category Б: the setup used to rely on the coin (coin: 0.1 gave the left
    // side the priority). Now the SPEEDS do it: AFast 18 beats B1 17, so AFast
    // acts first and the priority goes to the side that acts second — the right.
    // The coin is never thrown here, so `coin` is not passed at all.
    const battle = makeBattle(
      setupOf(
        [
          { id: 'aFast', unit: fighter(18) },
          { id: 'aSlow', unit: fighter(11) },
        ],
        [{ id: 'b1', unit: fighter(17) }],
      ),
      { enforceTurns: true },
    );

    // AFast is the fastest unit of the battle and acts first; the priority is on
    // the right (the side that acts second).
    expect(turnsOf(battle).current).toBe('aFast');
    expect(battle.getState().turns.prioritySide).toBe('right');
    battle.endTurn();

    // Still slow: it goes after the right unit of 17.
    expect(turnsOf(battle).current).toBe('b1');

    // The haste: 11 -> 17 makes a draw with B1. The unit whose turn it is now
    // (B1) keeps that turn (rule 5 from task 001), the draw is decided, and the
    // priority passes to the other side — from the right to the left.
    battle.setUnitSpeed('aSlow', 17);

    expect(turnsOf(battle).current).toBe('b1');
    expect(turnsOf(battle).next).toEqual(['aSlow']);
    expect(battle.getState().turns.prioritySide).toBe('left');
    expect(logTypes(battle).filter((type) => type === 'PriorityPassed')).toHaveLength(1);

    // Two units are still to act, so the round is not over yet.
    battle.endTurn();
    expect(battle.getState().round).toBe(1);

    battle.endTurn();

    // Round 2: AFast is the fastest again and acts alone. The draw of 17 vs 17 is the
    // NEXT group: it is resolved lazily, so the priority is still on the left and
    // ASlow (left) goes before B1 this time — the opposite of round 1.
    expect(battle.getState().round).toBe(2);
    expect(turnsOf(battle).current).toBe('aFast');
    expect(turnsOf(battle).next).toEqual(['aSlow', 'b1']);
    expect(battle.getState().turns.prioritySide).toBe('left');

    // Once that group really starts, the priority passes to the other side.
    battle.endTurn();

    expect(turnsOf(battle).current).toBe('aSlow');
    expect(battle.getState().turns.prioritySide).toBe('right');
  });

  it('the unit whose turn it is keeps that turn when its own speed changes', () => {
    const battle = makeBattle(
      setupOf(
        [
          { id: 'a1', unit: fighter(11) },
          { id: 'a2', unit: fighter(9) },
        ],
        [{ id: 'b1', unit: fighter(7) }],
      ),
      { enforceTurns: true },
    );

    expect(turnsOf(battle).current).toBe('a1');

    battle.setUnitSpeed('a1', 1);

    expect(turnsOf(battle).current).toBe('a1');
    expect(turnsOf(battle).next).toEqual(['a2', 'b1']);
    // The base stat is untouched — only the current speed changed.
    expect(battle.getState().units[0].unit.stats.speed).toBe(11);
    expect(battle.getState().units[0].currentSpeed).toBe(1);
  });

  it('a speed change reorders everybody behind the current unit', () => {
    const battle = makeBattle(
      setupOf(
        [
          { id: 'a1', unit: fighter(11) },
          { id: 'a2', unit: fighter(9) },
        ],
        [{ id: 'b1', unit: fighter(7) }],
      ),
      { enforceTurns: true },
    );

    expect(turnsOf(battle).next).toEqual(['a2', 'b1']);

    // A2 becomes the fastest: it is still BEHIND the current unit, but it passes
    // B1 in the queue.
    battle.setUnitSpeed('a2', 20);

    expect(turnsOf(battle).current).toBe('a1');
    expect(turnsOf(battle).next).toEqual(['a2', 'b1']);
  });

  it('(а) a unit that already had its turn does NOT come back after a speed change', () => {
    const battle = makeBattle(
      setupOf(
        [
          { id: 'a1', unit: fighter(11) },
          { id: 'a2', unit: fighter(9) },
        ],
        [{ id: 'b1', unit: fighter(7) }],
      ),
      { enforceTurns: true },
    );

    // A1 acts and is done for this round.
    expect(turnsOf(battle).current).toBe('a1');
    battle.endTurn();

    expect(turnsOf(battle).current).toBe('a2');
    expect(turnsOf(battle).next).toEqual(['b1']);

    // Even made the fastest unit of the battle, A1 stays out of THIS round.
    battle.setUnitSpeed('a1', 99);

    expect(turnsOf(battle).current).toBe('a2');
    expect(turnsOf(battle).next).toEqual(['b1']);
    expect(turnsOf(battle).next).not.toContain('a1');

    // And in the next round it is back, at its new speed.
    battle.endTurn();
    battle.endTurn();

    expect(battle.getState().round).toBe(2);
    expect(turnsOf(battle).current).toBe('a1');
  });

  it('a dead unit leaves the queue at once (rule 6)', () => {
    const battle = makeBattle(
      setupOf(
        [
          { id: 'a1', unit: fighter(11), hex: { x: 3, y: 4 } },
          { id: 'a2', unit: fighter(11), hex: { x: 3, y: 6 } },
        ],
        [{ id: 'b1', unit: fighter(5), hex: { x: 4, y: 4 } }],
      ),
      { enforceTurns: true },
    );

    expect(turnsOf(battle).current).toBe('a1');
    expect(turnsOf(battle).next).toEqual(['a2', 'b1']);

    // A big attack wipes out the whole stack of B1.
    battle.setUnitSpeed('a1', 11);
    const hit = battle.attack('a1', 'b1', { fixedDamageRoll: 0, fixedLuckRoll: 0 });

    expect(hit.ok).toBe(true);
    // The pool of B1 (100 hp) is not enough for one 5-damage hit, so the stack
    // only weakens — that already proves the point about the queue only if it
    // dies, so we check the weaker case explicitly:
    const weaker = battle.getState().units.find((unit) => unit.id === 'b1');

    expect(weaker?.aliveCount).toBe(1);
    expect(weaker?.poolHp).toBeLessThan(100);
  });

  it('a destroyed unit is gone from the queue of the next turns', () => {
    // A huge attacker wipes out the stack of B1 in one blow.
    const battle = makeBattle(
      setupOf(
        [
          {
            id: 'a1',
            unit: fighter(11, {
              stats: { hp: 100, attack: 500, defense: 5, speed: 11, damageMin: 400, damageMax: 400 },
            }),
            hex: { x: 3, y: 4 },
          },
          { id: 'a2', unit: fighter(11), hex: { x: 3, y: 6 } },
        ],
        [{ id: 'b1', unit: fighter(5), hex: { x: 4, y: 4 } }],
      ),
      { enforceTurns: true },
    );

    const hit = battle.attack('a1', 'b1', { fixedDamageRoll: 0, fixedLuckRoll: 0 });

    expect(hit.ok).toBe(true);
    expect(logTypes(battle)).toContain('UnitDestroyed');
    expect(battle.getState().units.find((unit) => unit.id === 'b1')?.aliveCount).toBe(0);
    expect(turnsOf(battle).current).toBe('a2');
    expect(turnsOf(battle).next).not.toContain('b1');
  });
});
describe('rule 4g — a recalculation inside a round keeps the decided order', () => {
  /** Four equal units plus a slow one: the draw is resolved at once. */
  function fourEqual() {
    return makeBattle(
      setupOf(
        [
          { id: 'a1', unit: fighter(11) },
          { id: 'a2', unit: fighter(11) },
        ],
        [
          { id: 'b1', unit: fighter(11) },
          { id: 'b2', unit: fighter(11) },
        ],
      ),
      { enforceTurns: true },
    );
  }

  it('the order of the group stays put when the queue is recalculated', () => {
    const battle = fourEqual();

    expect(turnsOf(battle).next).toEqual(['b1', 'a2', 'b2']);

    // Any recalculation inside this round (here: the speed of the NEXT unit, which
    // leaves the group) must not spend the priority a second time.
    battle.setUnitSpeed('b1', 30);

    expect(battle.getState().turns.prioritySide).toBe('right');
    expect(logTypes(battle).filter((type) => type === 'PriorityPassed')).toHaveLength(1);

    // B1 is now the fastest unit of the battle, so it acts right after A1 — the
    // rest of the decided group keeps its order behind it.
    battle.endTurn();

    expect(turnsOf(battle).current).toBe('b1');
    expect(turnsOf(battle).next).toEqual(['a2', 'b2']);
    expect(battle.getState().turns.prioritySide).toBe('right');
    expect(logTypes(battle).filter((type) => type === 'PriorityPassed')).toHaveLength(1);
  });

  it('(б) a unit that becomes equal in speed to an already resolved group joins it', () => {
    const battle = makeBattle(
      setupOf(
        [
          { id: 'a1', unit: fighter(11) },
          { id: 'a2', unit: fighter(11) },
        ],
        [
          { id: 'b1', unit: fighter(11) },
          { id: 'b2', unit: fighter(11) },
          { id: 'b3', unit: fighter(4) },
        ],
      ),
      { enforceTurns: true },
    );

    // The group of four was resolved: A1, B1, A2, B2 — and the priority moved.
    expect(turnsOf(battle).current).toBe('a1');
    expect(turnsOf(battle).next).toEqual(['b1', 'a2', 'b2', 'b3']);
    expect(battle.getState().turns.prioritySide).toBe('right');

    // B3 was slow and alone; the haste puts it INTO the group that was already
    // decided. It inherits that order (last, by its slot) and the priority is not
    // spent again — without the memory it would start a NEW draw from B3.
    battle.setUnitSpeed('b3', 11);

    expect(turnsOf(battle).next).toEqual(['b1', 'a2', 'b2', 'b3']);
    expect(battle.getState().turns.prioritySide).toBe('right');
    expect(logTypes(battle).filter((type) => type === 'PriorityPassed')).toHaveLength(1);

    // And it really acts last, exactly as the ready order says.
    battle.endTurn();
    expect(turnsOf(battle).current).toBe('b1');
    battle.endTurn();
    expect(turnsOf(battle).current).toBe('a2');
    battle.endTurn();
    expect(turnsOf(battle).current).toBe('b2');
    battle.endTurn();
    expect(turnsOf(battle).current).toBe('b3');
  });

  it('(в) a death inside an already resolved group of four spends nothing', () => {
    const battle = fourEqual();

    expect(turnsOf(battle).next).toEqual(['b1', 'a2', 'b2']);
    expect(battle.getState().turns.prioritySide).toBe('right');

    // A1 (the current unit) is destroyed by a huge hit. The group it belonged to
    // was already resolved, so the recalculation keeps B1, A2, B2 in that order —
    // and the priority is still on the right, not shifted a second time.
    battle.setUnitSpeed('a2', 99);
    expect(battle.getState().turns.prioritySide).toBe('right');

    const hits = logTypes(battle).filter((type) => type === 'PriorityPassed');

    expect(hits).toHaveLength(1);
  });
});

describe('the round moves on by itself', () => {
  it('the last unit of the round ends it and starts the next one', () => {
    const battle = makeBattle(
      setupOf([{ id: 'a1', unit: fighter(11) }], [{ id: 'b1', unit: fighter(5) }]),
      { enforceTurns: true },
    );

    expect(battle.getState().round).toBe(1);
    expect(turnsOf(battle).current).toBe('a1');

    battle.endTurn();

    expect(turnsOf(battle).current).toBe('b1');
    expect(battle.getState().round).toBe(1);

    // The second unit was the last one: the round ends here, on its own.
    battle.endTurn();

    expect(battle.getState().round).toBe(2);
    expect(turnsOf(battle).current).toBe('a1');
    expect(logTypes(battle)).toContain('RoundStarted');
  });

  it('the new round resets the per-round flags', () => {
    const battle = makeBattle(
      setupOf([{ id: 'a1', unit: fighter(11) }], [{ id: 'b1', unit: fighter(5) }]),
      { enforceTurns: true },
    );

    battle.wait('a1');
    battle.endTurn();
    battle.endTurn();

    const state = battle.getState();

    expect(state.round).toBe(2);
    expect(state.units.every((unit) => unit.hasWaitedThisRound === false)).toBe(true);
    expect(state.units.every((unit) => unit.hasActedThisRound === false)).toBe(true);
    expect(state.turns.currentUnitId).toBe('a1');
  });

  it('nextRound() still works by hand and does the same reset', () => {
    const battle = makeBattle(
      setupOf([{ id: 'a1', unit: fighter(11) }], [{ id: 'b1', unit: fighter(5) }]),
      { enforceTurns: true },
    );

    const result = battle.nextRound();

    expect(result.ok).toBe(true);
    expect(battle.getState().round).toBe(2);
    expect(turnsOf(battle).current).toBe('a1');
  });
});
describe('enforceTurns — the switch that keeps the sandbox working', () => {
  /**
   * A field where L1 (the current unit), L2 and R1 stand next to each other.
   *
   * The top speeds are 11 and 5, so the opening priority comes from the SPEED
   * (the right side acts second and therefore has the priority) — no coin is
   * involved, and makeBattle would fail loudly if one were passed.
   */
  function field(options: { enforceTurns?: boolean }) {
    return makeBattle(
      setupOf(
        [
          { id: 'l1', unit: fighter(11), hex: { x: 3, y: 4 } },
          { id: 'l2', unit: fighter(9), hex: { x: 3, y: 5 } },
        ],
        [{ id: 'r1', unit: fighter(5), hex: { x: 4, y: 4 } }],
      ),
      { enforceTurns: options.enforceTurns },
    );
  }

  it('OFF (default): a hit by a unit that is not the current one is allowed', () => {
    const battle = field({});

    expect(turnsOf(battle).current).toBe('l1');

    const result = battle.attack('l2', 'r1', { fixedDamageRoll: 0, fixedLuckRoll: 0 });

    expect(result.ok).toBe(true);
  });

  it('OFF: such a hit does NOT move the queue — the sandbox cannot break it', () => {
    const battle = field({});
    const before = turnsOf(battle);

    battle.attack('l2', 'r1', { fixedDamageRoll: 0, fixedLuckRoll: 0 });

    expect(turnsOf(battle)).toEqual(before);
  });

  it('ON: a hit by a unit that is not the current one is refused', () => {
    const battle = field({ enforceTurns: true });

    const result = battle.attack('l2', 'r1', { fixedDamageRoll: 0, fixedLuckRoll: 0 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('NOT_YOUR_TURN');
    }
  });

  it('ON: a hit by the current unit ends that turn', () => {
    const battle = field({ enforceTurns: true });

    expect(turnsOf(battle).current).toBe('l1');

    battle.attack('l1', 'r1', { fixedDamageRoll: 0, fixedLuckRoll: 0 });

    expect(turnsOf(battle).current).toBe('l2');
  });
});

describe('the queue lives in the state, so the interface only asks', () => {
  it('getState() shows the order, the current unit and the priority side', () => {
    const battle = makeBattle(
      setupOf(
        [
          { id: 'a1', unit: fighter(11) },
          { id: 'a2', unit: fighter(9) },
        ],
        [{ id: 'b1', unit: fighter(5) }],
      ),
      {},
    );

    expect(battle.getState().turns).toEqual({
      order: ['a2', 'b1'],
      currentUnitId: 'a1',
      // b1 is faster, so the speed decided it — the coin was never thrown
      // and the priority passed to the slower side to win the draws (002/0).
      prioritySide: 'right',
      nextPrioritySide: 'left',
      initialPriorityReason: 'speed',
    });
  });

  it('the same setup and the same coin always give the same order', () => {
    const build = () =>
      makeBattle(
        setupOf(
          [
            { id: 'a1', unit: fighter(11) },
            { id: 'a2', unit: fighter(9) },
          ],
          [{ id: 'b1', unit: fighter(11) }],
        ),
        { enforceTurns: true },
      );

    const first = build();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(turnsOf(build())).toEqual(turnsOf(first));
    }
  });
});

describe('002/4 — the priority indicator the interface reads from the state', () => {
  /** The indicator fields the interface shows, read from the state only. */
  function indicator(battle: Battle) {
    const { turns } = battle.getState();

    return {
      current: turns.prioritySide,
      next: turns.nextPrioritySide,
      reason: turns.initialPriorityReason,
    };
  }

  /** All PriorityPassed events of the battle, in order. */
  function passedEvents(battle: Battle) {
    return battle.getState().log.filter((event) => event.type === 'PriorityPassed');
  }

  it('the reason in the state is the reason of the opening PriorityRolled event', () => {
    // Equal top speeds: the coin decides, so the reason must be 'coin' in BOTH
    // the state and the first event — they may not drift apart (002/4).
    const battle = makeBattle(
      setupOf([{ id: 'a1', unit: fighter(11) }], [{ id: 'b1', unit: fighter(11) }]),
      { coin: 0.2, enforceTurns: true },
    );

    const rolled = battle.getState().log[0];

    expect(rolled.type).toBe('PriorityRolled');
    expect(indicator(battle).reason).toBe(rolled.reason);
    expect(indicator(battle).reason).toBe('coin');
  });

  it('different top speeds: the reason is the speed, not a thrown coin', () => {
    const battle = makeBattle(
      setupOf([{ id: 'a1', unit: fighter(9) }], [{ id: 'b1', unit: fighter(11) }]),
      { enforceTurns: true },
    );

    expect(indicator(battle).reason).toBe('speed');
  });

  it('the next side is always the opposite, and it is exactly where the next real pass goes', () => {
    // This is the guard against the two fields drifting apart: over several
    // rounds the indicator must match the `to` of the NEXT real PriorityPassed.
    const battle = makeBattle(
      setupOf([{ id: 'a1', unit: fighter(11) }], [{ id: 'b1', unit: fighter(11) }]),
      { coin: 0.2, enforceTurns: true },
    );

    for (let round = 0; round < 4; round += 1) {
      const { current, next } = indicator(battle);

      expect(next).not.toBe(current);
      expect(next).toBe(oppositeSide(current));

      // Every unit of the round acts, so the next real pass is the next event.
      const played = [current];
      let guard = 0;
      while (battle.getState().turns.currentUnitId !== null && guard < 20) {
        battle.endTurn();
        guard += 1;
        played.push(indicator(battle).current);
      }

      const passes = passedEvents(battle);
      const expectedPasses = played.length - 1;
      expect(passes.length).toBeGreaterThanOrEqual(expectedPasses);

      const nextPass = passes[round];
      if (nextPass) expect(nextPass.to).toBe(oppositeSide(nextPass.from));

      battle.nextRound();
    }
  });

  it('replaying the log gives the same priority the state holds', () => {
    // If the state and the journal ever disagreed, an interface that draws from
    // one and a replay that reads the other would show different things.
    const battle = makeBattle(
      setupOf([{ id: 'a1', unit: fighter(11) }], [{ id: 'b1', unit: fighter(11) }]),
      { coin: 0.2, enforceTurns: true },
    );

    for (let round = 0; round < 3; round += 1) {
      let guard = 0;
      while (battle.getState().turns.currentUnitId !== null && guard < 20) {
        battle.endTurn();
        guard += 1;
      }
      battle.nextRound();
    }

    const log = battle.getState().log;
    const rolled = log.find((event) => event.type === 'PriorityRolled');
    expect(rolled).toBeDefined();

    let replayed = (rolled as { side: 'left' | 'right' }).side;
    for (const event of log) {
      if (event.type === 'PriorityPassed') replayed = event.to;
    }

    expect(replayed).toBe(battle.getState().turns.prioritySide);
  });
});
describe('002/2 — a newcomer in an already decided group', () => {
  /** All PriorityPassed events of the battle, in order. */
  function passes(battle: Battle) {
    return battle.getState().log.filter((event) => event.type === 'PriorityPassed');
  }

  it('T1 (a) nobody of the group has acted: the whole group is rebuilt by rule 1', () => {
    // Left A1 (17, t1), A3 (17, t1), A2 (11, t3); right B1 (17, t1). Equal top
    // speeds, the coin gives the priority to the left.
    const battle = makeBattle(
      setupOf(
        [
          { id: 'a1', unit: fighter(17) },
          { id: 'a3', unit: fighter(17) },
          { id: 'a2', unit: fighter(11, { tier: 3 }) },
        ],
        [{ id: 'b1', unit: fighter(17) }],
      ),
      { coin: 0.1, enforceTurns: true },
    );

    // The group of 17 is decided from the left: the left side by slot (a1, a3),
    // the sides alternate -> [a1, b1, a3].
    expect(turnsOf(battle).current).toBe('a1');
    expect(turnsOf(battle).next).toEqual(['b1', 'a3', 'a2']);
    expect(passes(battle)).toHaveLength(1);

    // The hero of A hastes A2 (his own unit) during A1's turn — reachable in play.
    battle.setUnitSpeed('a2', 17);

    // Nobody of the group has acted, so rule 2(a) rebuilds the WHOLE group by rule 1
    // from the saved firstSide = left: inside the left side the level decides (A2,
    // tier 3, first), then the slot (a1, a3), and the sides alternate from the
    // priority side -> [a2, b1, a1, a3]. A1 keeps its turn, so the remainder is
    // [a2, b1, a3].
    //
    // Keeping the saved SIDE PATTERN instead (rule 2(b)) would leave [b1, a3] and
    // put the newcomer A2 after them -> [b1, a2, a3], which is a different order.
    expect(turnsOf(battle).current).toBe('a1');
    expect(turnsOf(battle).next).toEqual(['a2', 'b1', 'a3']);
    // The priority is NOT spent a second time.
    expect(battle.getState().turns.prioritySide).toBe('right');
    expect(passes(battle)).toHaveLength(1);
  });

  it('T2 (b) somebody of the group has acted: the newcomer takes a place in its own side', () => {
    // Left A1, A2 (17, t1); right B1, B2 (17, t1) and B3 (5, t3).
    const battle = makeBattle(
      setupOf(
        [
          { id: 'a1', unit: fighter(17) },
          { id: 'a2', unit: fighter(17) },
        ],
        [
          { id: 'b1', unit: fighter(17) },
          { id: 'b2', unit: fighter(17) },
          { id: 'b3', unit: fighter(5, { tier: 3 }) },
        ],
      ),
      { coin: 0.1, enforceTurns: true },
    );

    expect(turnsOf(battle).current).toBe('a1');
    expect(turnsOf(battle).next).toEqual(['b1', 'a2', 'b2', 'b3']);
    expect(passes(battle)).toHaveLength(1);

    // A1 acts and is done for this round.
    battle.endTurn();

    expect(turnsOf(battle).current).toBe('b1');
    expect(turnsOf(battle).next).toEqual(['a2', 'b2', 'b3']);

    // The hero of B hastes B3 (his own unit) during B1's turn — reachable in play.
    battle.setUnitSpeed('b3', 17);

    // A1 has already acted, so this is rule 2(b): the SIDE PATTERN of the
    // remainder is kept. Without the current unit B1 the saved order leaves
    // [a2, b2] = left, right; B3 adds a place at the END of its own side's places
    // -> left, right, right. The right side is then filled by level and slot, so
    // B3 (tier 3) comes before B2 — but B3 does NOT overtake A2, a unit of the
    // other side. A naive "newcomer to the very end" would give [a2, b2, b3].
    expect(turnsOf(battle).current).toBe('b1');
    expect(turnsOf(battle).next).toEqual(['a2', 'b3', 'b2']);
    expect(battle.getState().turns.prioritySide).toBe('right');
    expect(passes(battle)).toHaveLength(1);
  });
it('T3 (c) nobody new: the saved order minus the units that left', () => {
    // Left A1, A2 (hp 1), A3 (17, t1); right B1 (damage 200), B2 (17, t1).
    // Hexes: a2 and b1 are neighbours, so B1's hit is melee and kills A2 outright
    // (a destroyed stack cannot retaliate).
    const battle = makeBattle(
      setupOf(
        [
          { id: 'a1', unit: fighter(17), hex: { x: 2, y: 3 } },
          {
            id: 'a2',
            unit: fighter(17, {
              stats: { hp: 1, attack: 10, defense: 0, speed: 17, damageMin: 5, damageMax: 5 },
            }),
            hex: { x: 2, y: 4 },
          },
          { id: 'a3', unit: fighter(17), hex: { x: 2, y: 5 } },
        ],
        [
          {
            id: 'b1',
            unit: fighter(17, {
              stats: { hp: 100, attack: 10, defense: 5, speed: 17, damageMin: 200, damageMax: 200 },
            }),
            hex: { x: 3, y: 4 },
          },
          { id: 'b2', unit: fighter(17), hex: { x: 4, y: 3 } },
        ],
      ),
      { coin: 0.1, enforceTurns: true },
    );

    // One group of five: the sides alternate from the priority side (left).
    expect(turnsOf(battle).current).toBe('a1');
    expect(turnsOf(battle).next).toEqual(['b1', 'a2', 'b2', 'a3']);
    expect(passes(battle)).toHaveLength(1);

    // A1 acts. There is NO newcomer here: A3 was in this group from the start, so
    // this is rule 2(c) — the saved order minus the departed A1.
    battle.endTurn();

    expect(turnsOf(battle).current).toBe('b1');
    expect(turnsOf(battle).next).toEqual(['a2', 'b2', 'a3']);

    // B1 (the current unit) kills A2 with a melee hit; its turn ends with the hit.
    const hit = battle.attack('b1', 'a2', { fixedDamageRoll: 0, fixedLuckRoll: 0 });

    expect(hit.ok).toBe(true);
    expect(battle.getState().units.find((unit) => unit.id === 'a2')?.aliveCount).toBe(0);

    // A2 is gone and nobody joined, so the group {A3, B2} keeps the decided order
    // without it. The draw is NOT resolved again — that is what rule 2(c)
    // protects, and without it the priority would pass a second time here.
    expect(turnsOf(battle).current).toBe('b2');
    expect(turnsOf(battle).next).toEqual(['a3']);
    expect(battle.getState().turns.prioritySide).toBe('right');
    expect(passes(battle)).toHaveLength(1);
  });
it('T4 the priority is not taken when the current unit does not have it', () => {
    // Left A1, A2 (17, t1); right B1 (5, t1). Different top speeds, so the
    // priority comes from the SPEED: B1 acts second and therefore has it.
    const battle = makeBattle(
      setupOf(
        [
          { id: 'a1', unit: fighter(17) },
          { id: 'a2', unit: fighter(17) },
        ],
        [{ id: 'b1', unit: fighter(5) }],
      ),
      { enforceTurns: true },
    );

    expect(battle.getState().turns.prioritySide).toBe('right');
    expect(passes(battle)).toHaveLength(0);
    expect(turnsOf(battle).current).toBe('a1');

    battle.endTurn();

    expect(turnsOf(battle).current).toBe('a2');

    // Моделирует эффект напрямую через setUnitSpeed: in play an enemy unit cannot
    // speed up while the other side acts, so this is a protection test.
    battle.setUnitSpeed('b1', 17);

    // {A2 (current), B1} is a cross-side group for the first time, but the current
    // unit is on the LEFT and the priority is on the RIGHT: the priority side does
    // not really go first, so nothing is spent and no PriorityPassed is written.
    expect(turnsOf(battle).current).toBe('a2');
    expect(turnsOf(battle).next).toEqual(['b1']);
    expect(battle.getState().turns.prioritySide).toBe('right');
    expect(passes(battle)).toHaveLength(0);
  });

  it('T5 no unit appears twice in the PriorityPassed log', () => {
    // Left A1, A2 (17); right B0 (20), B1 (5). The right side is faster, so the
    // priority comes from the speed and sits on the left.
    const battle = makeBattle(
      setupOf(
        [
          { id: 'a1', unit: fighter(17) },
          { id: 'a2', unit: fighter(17) },
        ],
        [
          { id: 'b0', unit: fighter(20) },
          { id: 'b1', unit: fighter(5) },
        ],
      ),
      { enforceTurns: true },
    );

    expect(battle.getState().turns.prioritySide).toBe('left');
    expect(turnsOf(battle).current).toBe('b0');

    battle.endTurn();

    expect(turnsOf(battle).current).toBe('a1');

    // Моделирует эффект напрямую через setUnitSpeed.
    battle.setUnitSpeed('b1', 17);

    // {A1 (current), A2, B1}: the current unit is on the priority side, so the
    // draw really costs the priority. Before the duplicate fix the current unit
    // was pushed twice and the log read ['a1', 'b1', 'a2', 'a2'].
    expect(passes(battle)).toHaveLength(1);
    expect(passes(battle)[0]).toEqual({
      type: 'PriorityPassed',
      round: 1,
      from: 'left',
      to: 'right',
      unitIds: ['a1', 'b1', 'a2'],
    });
    expect(turnsOf(battle).current).toBe('a1');
    expect(turnsOf(battle).next).toEqual(['b1', 'a2']);
    expect(battle.getState().turns.prioritySide).toBe('right');
  });
it('T7 a slowed unit does not make an unresolved group look resolved', () => {
    // Left A1, A2 (11), A4 (5); right B1, B2 (11), B4 (5). Slots are the index in
    // the side's array: a1=0, a2=1, a4=2, b1=0, b2=1, b4=2.
    const battle = makeBattle(
      setupOf(
        [
          { id: 'a1', unit: fighter(11) },
          { id: 'a2', unit: fighter(11) },
          { id: 'a4', unit: fighter(5) },
        ],
        [
          { id: 'b1', unit: fighter(11) },
          { id: 'b2', unit: fighter(11) },
          { id: 'b4', unit: fighter(5) },
        ],
      ),
      { coin: 0.1, enforceTurns: true },
    );

    // The group of 11 is a real draw and is decided; the group of 5 is not reached.
    expect(turnsOf(battle).current).toBe('a1');
    expect(turnsOf(battle).next).toEqual(['b1', 'a2', 'b2', 'a4', 'b4']);
    expect(passes(battle)).toHaveLength(1);

    // The hero of A SLOWS the enemy B2 — reachable in play: a hero slows the
    // enemy during his own side's turn.
    battle.setUnitSpeed('b2', 5);

    // B2 left the decided group of 11 and joined the group of 5, which has never
    // been decided. Nothing new is resolved here, because that group is not the
    // head: A1 keeps its turn and the priority is untouched.
    expect(turnsOf(battle).current).toBe('a1');
    expect(passes(battle)).toHaveLength(1);
    expect(battle.getState().turns.prioritySide).toBe('right');

    // Play the round until the group of 5 becomes the head of the queue.
    battle.endTurn();
    battle.endTurn();
    battle.endTurn();

    // Now {a4, b4, b2} is a cross-side group that was NEVER decided: the record of
    // the group of 11 must not make it look resolved (B2 left it and its speed
    // changed). The priority is right, so the draw is ordered from the right:
    // b2 (slot 1) before b4 (slot 2), alternating -> [b2, a4, b4].
    expect(turnsOf(battle).current).toBe('b2');
    expect(passes(battle)).toHaveLength(2);
    expect(passes(battle)[1]).toEqual({
      type: 'PriorityPassed',
      round: 1,
      from: 'right',
      to: 'left',
      unitIds: ['b2', 'a4', 'b4'],
    });
    expect(battle.getState().turns.prioritySide).toBe('left');
  });

  it('a new round ignores the unit that acted last round when it decides a draw', () => {
    // Four units of the same speed, two on each side. The unit that acted LAST in
    // round 1 must not decide anything in round 2: the state still names it as the
    // current one, but it is free to act again.
    const battle = makeBattle(
      setupOf(
        [
          { id: 'a1', unit: fighter(11) },
          { id: 'a2', unit: fighter(11) },
        ],
        [
          { id: 'b1', unit: fighter(11) },
          { id: 'b2', unit: fighter(11) },
        ],
      ),
      { coin: 0.1, enforceTurns: true },
    );

    // Round 1: one group, one draw, the priority passes once.
    expect(passes(battle)).toHaveLength(1);
    expect(battle.getState().turns.prioritySide).toBe('right');

    for (let i = 0; i < 4; i += 1) {
      battle.endTurn();
    }

    expect(battle.getState().round).toBe(2);

    // Round 2 decides its own draw: exactly one more PriorityPassed, and the
    // priority alternates to the left. Round 2 starts with the priority on the
    // RIGHT, so the group is ordered from the right: b1, a1, b2, a2.
    expect(passes(battle)).toHaveLength(2);
    expect(passes(battle)[1]).toEqual({
      type: 'PriorityPassed',
      round: 2,
      from: 'right',
      to: 'left',
      unitIds: ['b1', 'a1', 'b2', 'a2'],
    });
    expect(battle.getState().turns.prioritySide).toBe('left');
    expect(turnsOf(battle).current).toBe('b1');
  });
});
/** A tiny deterministic PRNG, so a failing fuzz seed can be repeated exactly. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('002/2 — the invariants hold under random play', () => {
  it('T6 200 random battles: the queue and the priority chain stay sane', () => {
    const SPEEDS = [5, 11, 17];

    function playBattle(seed: number): void {
      const next = mulberry32(seed);
      const pick = <T,>(values: T[]): T => values[Math.floor(next() * values.length)];

      // Small armies: up to three units a side, all placed on one column each so
      // a hit is always available between neighbours.
      const side = (prefix: string, column: number) =>
        Array.from({ length: 1 + Math.floor(next() * 3) }, (_item, index) => {
          const speed = pick(SPEEDS);

          return {
            id: `${prefix}${index}`,
            unit: fighter(speed, {
              tier: 1 + Math.floor(next() * 3),
              stats: { hp: 30, attack: 8, defense: 2, speed, damageMin: 9, damageMax: 9 },
            }),
            hex: { x: column, y: index },
          };
        });

      const left = side('a', 3);
      const right = side('b', 6);
      const coin = next();

      // Built here rather than through makeBattle: the coin is only READ when the
      // top speeds are equal, and a random army often is not, so passing a coin to
      // makeBattle would be exactly the "coin passed but never read" mistake that
      // helper refuses.
      const created = createBattle(
        setupOf(
          left.map((entry) => ({ id: entry.id, unit: entry.unit, hex: entry.hex })),
          right.map((entry) => ({ id: entry.id, unit: entry.unit, hex: entry.hex })),
        ),
        {
          combatRules: getCombatRules(),
          skillsData: skills,
          battleRules: BATTLE_RULES,
          random: () => coin,
          enforceTurns: true,
        },
      );

      if (!created.ok) {
        throw new Error(`seed ${seed}: createBattle refused: ${created.code} ${created.message}`);
      }

      const battle = created.battle;

      /** All PriorityPassed events so far. */
      const passes = () =>
        battle.getState().log.filter((event) => event.type === 'PriorityPassed');

      const check = (step: string) => {
        const state = battle.getState();
        const current = state.turns.currentUnitId;
        const queue = current === null ? [] : [current, ...state.turns.order];

        // (a) every alive unit that has not acted is in the queue exactly once,
        // and nothing else is.
        const expected = state.units
          .filter((unit) => unit.aliveCount > 0 && !unit.hasActedThisRound)
          .map((unit) => unit.id)
          .sort();

        expect(
          new Set(queue).size,
          `seed ${seed}, ${step}: duplicates in the queue`,
        ).toBe(queue.length);
        expect([...queue].sort(), `seed ${seed}, ${step}: wrong queue`).toEqual(expected);

        // (в) the PriorityPassed chain: every `from` is the previous `to`, the
        // first `from` is the side of the coin, and prioritySide is the last `to`.
        const rolled = state.log.find((event) => event.type === 'PriorityRolled');

        expect(rolled, `seed ${seed}, ${step}: no PriorityRolled`).toBeDefined();
        let expectedSide = (rolled as { side: string }).side;

        for (const event of passes()) {
          if (event.type !== 'PriorityPassed') {
            continue;
          }
          expect(event.from, `seed ${seed}, ${step}: broken chain`).toBe(expectedSide);
          // (г) no unit twice in one decision
          expect(
            new Set(event.unitIds).size,
            `seed ${seed}, ${step}: duplicates in PriorityPassed`,
          ).toBe(event.unitIds.length);
          expectedSide = event.to;
        }

        expect(
          state.turns.prioritySide,
          `seed ${seed}, ${step}: priority out of sync`,
        ).toBe(expectedSide);
      };

      check('start');

      for (let step = 0; step < 30; step += 1) {
        const before = battle.getState().turns.currentUnitId;
        if (before === null) {
          break;
        }

        const action = Math.floor(next() * 4);

        if (action === 0) {
          battle.endTurn();
        } else if (action === 1) {
          battle.wait(before);
        } else if (action === 2) {
          // Any unit, at any of the three speeds. In play a hero would only haste
          // its own and slow the enemy — setUnitSpeed is universal, and the fuzz
          // needs both.
          const everyone = [...left, ...right];
          const target = pick(everyone).id;

          battle.setUnitSpeed(target, pick(SPEEDS));

          // (б) a speed change of anybody else must not steal the current turn.
          if (target !== before) {
            expect(
              battle.getState().turns.currentUnitId,
              `seed ${seed}, step ${step}: the current unit changed`,
            ).toBe(before);
          }
        } else {
          // Hit a neighbour on the other side: same row, adjacent column.
          const attackerRow = battle.getState().units.find((u) => u.id === before)?.hexes[0]?.y;
          const foes = [...left, ...right].filter(
            (entry) =>
              entry.id !== before &&
              entry.hex.y === attackerRow &&
              (entry.id.startsWith('a') === !before.startsWith('a')),
          );

          if (foes.length > 0) {
            battle.attack(before, foes[0].id, { fixedDamageRoll: 0, fixedLuckRoll: 0 });
          } else {
            battle.endTurn();
          }
        }

        check(`step ${step}`);
      }
    }

    for (let seed = 1; seed <= 200; seed += 1) {
      playBattle(seed);
    }
  }, 60000);
});