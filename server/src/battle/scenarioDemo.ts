/**
 * Prints the event log of two scenarios (docs/battle.md, section 11).
 *
 * Run it with: npx tsx server/src/battle/scenarioDemo.ts
 * This is a small development script, not a test and not a game feature.
 */

import type { BattleEvent, BattleSetup, CombatUnit } from '@de-jija/shared';

import { getCombatRules, initCombatRules } from '../combat/combatRules';
import { blackDragon, goblin } from '../combat/testFixtures';
import { createBattle, type Battle } from './battle';
import { loadBattleRules } from './battleRules';
import { initSkills } from '../combat/skills';

initCombatRules();
initSkills();

const BATTLE_RULES = loadBattleRules();

/** A fixed damage roll, so the printed numbers are always the same. */
const OPTIONS = { fixedDamageRoll: 0, fixedLuckRoll: 0 };

/** A copy of a unit that answers several times per round. */
function unitWithRetaliations(base: CombatUnit, count: number): CombatUnit {
  return { ...base, currentHp: 0, retaliationsPerRound: count };
}

function setup(
  left: CombatUnit,
  right: CombatUnit,
  leftStack = 1,
  rightStack = 1,
): BattleSetup {
  return {
    placementMode: 'free',
    sides: {
      left: {
        hero: null,
        units: [{ id: 'l1', unit: { ...left, currentHp: 0 }, stackCount: leftStack, hex: { x: 3, y: 4 } }],
      },
      right: {
        hero: null,
        units: [
          { id: 'r1', unit: { ...right, currentHp: 0 }, stackCount: rightStack, hex: { x: 4, y: 4 } },
        ],
      },
    },
  };
}

function newBattle(setupData: BattleSetup): Battle {
  const created = createBattle(setupData, {
    combatRules: getCombatRules(),
    skillsData: initSkills(),
    battleRules: BATTLE_RULES,
    random: () => 0,
  });

  if (!created.ok) {
    throw new Error(`createBattle failed: ${created.code} ${created.message}`);
  }

  return created.battle;
}

/** One readable line per event. */
function printEvent(event: BattleEvent): void {
  if (event.type === 'UnitPlaced') {
    console.log(`  UnitPlaced      ${event.unitId} -> (${event.hex.x}, ${event.hex.y})`);
    return;
  }
  if (event.type === 'RoundStarted') {
    console.log(`  RoundStarted    раунд ${event.round}`);
    return;
  }
  if (event.type === 'ShotSpent') {
    console.log(`  ShotSpent       ${event.unitId}, осталось выстрелов: ${event.shotsLeft}`);
    return;
  }
  if (event.type === 'UnitDestroyed') {
    console.log(`  UnitDestroyed   ${event.unitId}`);
    return;
  }

  // AttackResolved / RetaliationResolved
  console.log(
    `  ${event.type.padEnd(17)} ${event.attackerId} -> ${event.defenderId} ` +
      `(${event.kind}), урон ${event.damage}; ` +
      `защитник: ${event.defenderAliveBefore}->${event.defenderAliveAfter} юнитов, ` +
      `HP ${event.defenderPoolHpBefore}->${event.defenderPoolHpAfter}`,
  );
}

function run(title: string, battle: Battle): void {
  const result = battle.attack('l1', 'r1', OPTIONS);

  console.log(`\n=== ${title} ===`);
  if (!result.ok) {
    console.log(`  ОТКАЗ: ${result.code} — ${result.message}`);
    return;
  }

  for (const event of result.events) {
    printEvent(event);
  }

  console.log('  итог:');
  for (const unit of battle.getState().units) {
    console.log(
      `    ${unit.id}: живо ${unit.aliveCount}, HP ${unit.poolHp}, ` +
        `выстрелов ${unit.shotsLeft}, ответок ${unit.retaliationsLeft}`,
    );
  }
}

// Scenario 1: two neighbours, one plain exchange with a retaliation.
run('Сценарий 1: два юнита на соседних гексах, удар и ответка', newBattle(setup(goblin, blackDragon)));

// Scenario 2: the hit destroys part of the stack, so the answer is weaker.
// The defender gets 2 retaliations per round, so BOTH answers happen and can be
// compared: 13 damage at full strength, 6 damage once a unit is gone.
const answering = unitWithRetaliations(goblin, 2);
const stack2 = setup(blackDragon, answering, 1, 2);
const battle2 = newBattle(stack2);

console.log('\n=== Сценарий 2: удар убивает часть стека, ответка слабее ===');
for (const label of ['первый удар (стек целый)', 'второй удар (стек теряет юнита)']) {
  const result = battle2.attack('l1', 'r1', OPTIONS);

  console.log(`\n  ${label}:`);
  if (result.ok) {
    for (const event of result.events) {
      printEvent(event);
    }
  }
}
console.log('  итог:');
for (const unit of battle2.getState().units) {
  console.log(`    ${unit.id}: живо ${unit.aliveCount}, HP ${unit.poolHp}`);
}
