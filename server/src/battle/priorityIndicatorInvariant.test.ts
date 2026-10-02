/**
 * The priority indicator invariant (task 002, step 4, review fixes).
 *
 * It lives in its OWN small file on purpose: `battleTurns.test.ts` is already
 * over 1600 lines, and this file only checks one thing — that the two priority
 * fields never contradict each other, no matter what command ran.
 *
 * WHY this is a test and not a comment: `nextPrioritySide` is a stored game
 * rule (rule 4b), and the engine produces it through `priorityPair`. That is a
 * convention, not a guarantee — nothing in the type system stops a future
 * writer from touching one field only. This test is what catches it.
 *
 * WHAT it checks:
 *   1. right after `createBattle`, before any command;
 *   2. after EVERY command in a scenario, including the draws that pass the
 *      priority to the other side;
 *   3. the reason in the state equals the reason in the opening `PriorityRolled`;
 *   4. every `PriorityPassed` moves the priority to the opposite side.
 *
 * The expectation comes from the OPPOSITE table below, NOT from the engine: a
 * test that imported `oppositeSide` would be its own oracle and would stay green
 * while the game was wrong.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { BattleSetup, BattleState, CombatUnit } from '@de-jija/shared';

import { getCombatRules, initCombatRules } from '../combat/combatRules';
import { initSkills, type SkillsData } from '../combat/skills';
import { createBattle, type Battle } from './battle';
import type { BattleRules } from './battleRules';

/**
 * Rule 4b written out INDEPENDENTLY of the engine.
 *
 * The engine has its own `oppositeSide`, and a test that imports it would be
 * its own oracle: break `oppositeSide` and the expectation breaks with it, so
 * the test stays green while the game is wrong. This table is the whole point of
 * the file — the expected value comes from the RULE, not from the code.
 */
const OPPOSITE: Record<'left' | 'right', 'left' | 'right'> = {
  left: 'right',
  right: 'left',
};

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

/** A plain unit with the speed a queue test needs. */
function fighter(id: string, speed: number): CombatUnit {
  return {
    id,
    name: id,
    stats: { hp: 100, attack: 10, defense: 5, speed, damageMin: 5, damageMax: 5 },
    tags: [],
    currentHp: 100,
  };
}

function setupOf(left: CombatUnit[], right: CombatUnit[]): BattleSetup {
  const toSetup = (unit: CombatUnit) => ({ id: unit.id, unit, stackCount: 1, hex: null });

  return {
    placementMode: 'free',
    sides: {
      left: { hero: null, units: left.map(toSetup) },
      right: { hero: null, units: right.map(toSetup) },
    },
  };
}

/** A battle with a fixed coin, so both sides of the priority are reachable. */
function makeBattle(setup: BattleSetup, coin: number): Battle {
  const created = createBattle(setup, {
    combatRules: getCombatRules(),
    skillsData: skills,
    battleRules: BATTLE_RULES,
    random: () => coin,
    enforceTurns: true,
  });

  if (!created.ok) {
    throw new Error(`could not create a battle: ${created.code} ${created.message}`);
  }

  return created.battle;
}

/**
 * The invariant itself: the indicator is always the opposite of the priority.
 * Written once so every assertion below states the same law.
 */
function expectIndicatorConsistent(battle: Battle): BattleState {
  const { turns } = battle.getState();

  expect(turns.nextPrioritySide).toBe(OPPOSITE[turns.prioritySide]);

  return battle.getState();
}

describe('002/4 — the indicator never contradicts the priority', () => {
  it('holds immediately after createBattle, before any command', () => {
    const battle = makeBattle(setupOf([fighter('a1', 11)], [fighter('b1', 11)]), 0.2);

    expectIndicatorConsistent(battle);
  });

  it('holds when the opening priority came from speed, not from the coin', () => {
    // Different top speeds: the coin is never read, so the state must be right
    // without any randomness being involved.
    const battle = makeBattle(setupOf([fighter('a1', 9)], [fighter('b1', 11)]), 0.2);
    const state = expectIndicatorConsistent(battle);

    expect(state.turns.initialPriorityReason).toBe('speed');
  });

  it('holds after every command, including the draws that pass the priority', () => {
    // Three units per side so that a group of 3+ appears: rule 4v says one such
    // group is ONE situation and shifts the priority exactly once.
    const battle = makeBattle(
      setupOf(
        [fighter('a1', 11), fighter('a2', 11), fighter('a3', 11)],
        [fighter('b1', 11), fighter('b2', 11), fighter('b3', 11)],
      ),
      0.2,
    );

    expectIndicatorConsistent(battle);

    // Play the whole round, checking after every single command. nextRound keeps
    // prioritySide but clears the group memory, so it is included too.
    for (let guard = 0; guard < 12; guard += 1) {
      if (battle.getState().turns.currentUnitId === null) break;

      battle.endTurn();
      expectIndicatorConsistent(battle);
    }

    battle.nextRound();
    expectIndicatorConsistent(battle);
  });

  it('holds after a mid-round speed change (rule 5 keeps the current unit)', () => {
    const battle = makeBattle(setupOf([fighter('a1', 11)], [fighter('b1', 11)]), 0.2);

    battle.setUnitSpeed('b1', 17);
    expectIndicatorConsistent(battle);

    battle.setUnitSpeed('a1', 17);
    expectIndicatorConsistent(battle);
  });

  it('holds after a wait, which moves the unit to the waiting segment', () => {
    const battle = makeBattle(setupOf([fighter('a1', 11)], [fighter('b1', 11)]), 0.2);
    const current = battle.getState().turns.currentUnitId;

    expect(current).not.toBeNull();
    battle.wait(current as string);
    expectIndicatorConsistent(battle);
  });

  it('the reason in the state is the reason of the opening PriorityRolled event', () => {
    const battle = makeBattle(setupOf([fighter('a1', 11)], [fighter('b1', 11)]), 0.2);
    const state = expectIndicatorConsistent(battle);
    const rolled = state.log.find((event) => event.type === 'PriorityRolled');

    if (rolled?.type !== 'PriorityRolled') throw new Error('PriorityRolled expected');

    // Only the REASON is compared. The side is not: `PriorityRolled` records the
    // opening decision, while `prioritySide` may already have passed to the other
    // side by the time the queue is built — so equal values would be a bug.
    expect(state.turns.initialPriorityReason).toBe(rolled.reason);
  });

  it('the opening PriorityRolled came from the coin when the top speeds are equal', () => {
    const battle = makeBattle(setupOf([fighter('a1', 11)], [fighter('b1', 11)]), 0.2);
    const state = expectIndicatorConsistent(battle);
    const rolled = state.log.find((event) => event.type === 'PriorityRolled');

    if (rolled?.type !== 'PriorityRolled') throw new Error('PriorityRolled expected');

    expect(rolled.reason).toBe('coin');
  });

  it('every PriorityPassed moves the priority to the opposite side', () => {
    // Plain rule 4b on the journal: no indicator involved. The expectation comes
    // from the OPPOSITE table above, not from the engine.
    const battle = makeBattle(
      setupOf(
        [fighter('a1', 11), fighter('a2', 11), fighter('a3', 11)],
        [fighter('b1', 11), fighter('b2', 11), fighter('b3', 11)],
      ),
      0.2,
    );

    const passes = battle
      .getState()
      .log.filter((event) => event.type === 'PriorityPassed');

    // The opening cross-side group already passed the priority once, otherwise
    // this test would prove nothing.
    expect(passes.length).toBeGreaterThan(0);

    for (const event of passes) {
      if (event.type !== 'PriorityPassed') continue;

      expect(event.to).toBe(OPPOSITE[event.from]);
      expect(event.to).not.toBe(event.from);
    }
  });

  it('rule 4b with explicit sides: the priority passes from left to right and back', () => {
    // Written out literally, with no table and no engine helper: the priority
    // starts on the left, the first real draw hands it to the right, the next one
    // hands it back. A break anywhere in rule 4b makes this fail by name.
    const battle = makeBattle(
      setupOf(
        [fighter('a1', 11), fighter('a2', 11)],
        [fighter('b1', 11), fighter('b2', 11)],
      ),
      0.2,
    );

    const passes = battle
      .getState()
      .log.filter((event) => event.type === 'PriorityPassed')
      .map((event) => (event.type === 'PriorityPassed' ? { from: event.from, to: event.to } : null))
      .filter((event): event is { from: 'left' | 'right'; to: 'left' | 'right' } => event !== null);

    expect(passes.length).toBeGreaterThan(0);
    expect(passes[0].from).toBe('left');
    expect(passes[0].to).toBe('right');

    // The next draw must hand it back — the alternation of rule 4b.
    if (passes.length > 1) {
      expect(passes[1].from).toBe('right');
      expect(passes[1].to).toBe('left');
    }
  });
});
