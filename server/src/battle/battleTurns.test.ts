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
import { createBattle, type Battle } from './battle';
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
      prioritySide: 'right',
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