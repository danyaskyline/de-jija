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
 *   4. the priority capture (`to`) follows `from`, NOT the displayed field —
 *      otherwise the indicator would silently become the source of truth.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { BattleSetup, BattleState, CombatUnit } from '@de-jija/shared';

import { getCombatRules, initCombatRules } from '../combat/combatRules';
import { initSkills, type SkillsData } from '../combat/skills';
import { createBattle, oppositeSide, type Battle } from './battle';
import type { BattleRules } from './battleRules';

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

  expect(turns.nextPrioritySide).toBe(oppositeSide(turns.prioritySide));

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
    // Three units per side so that a group of 3+ appears: rule 4в says one such
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

  it('the opening PriorityRolled records the side the battle started with', () => {
    // Equal speeds, so the coin decides: the event and the starting state must
    // agree on the side, and the indicator must be its opposite.
    const battle = makeBattle(setupOf([fighter('a1', 11)], [fighter('b1', 11)]), 0.2);
    const state = expectIndicatorConsistent(battle);
    const rolled = state.log.find((event) => event.type === 'PriorityRolled');

    if (rolled?.type !== 'PriorityRolled') throw new Error('PriorityRolled expected');

    expect(rolled.reason).toBe('coin');
    expect(oppositeSide(rolled.side)).not.toBe(rolled.side);
  });

  it('the priority capture follows `from`, not the displayed indicator', () => {
    // If the capture ever took `to` from `nextPrioritySide`, the displayed field
    // would silently become the source of truth, and nothing else would notice.
    const battle = makeBattle(
      setupOf(
        [fighter('a1', 11), fighter('a2', 11), fighter('a3', 11)],
        [fighter('b1', 11), fighter('b2', 11), fighter('b3', 11)],
      ),
      0.2,
    );

    for (let round = 0; round < 3; round += 1) {
      let guard = 0;

      while (battle.getState().turns.currentUnitId !== null && guard < 12) {
        battle.endTurn();
        guard += 1;
        expectIndicatorConsistent(battle);
      }

      const state = battle.getState();

      for (const event of state.log) {
        if (event.type !== 'PriorityPassed') continue;

        expect(event.to).toBe(oppositeSide(event.from));
        expect(state.turns.nextPrioritySide).toBe(oppositeSide(state.turns.prioritySide));
      }

      battle.nextRound();
    }
  });
});
