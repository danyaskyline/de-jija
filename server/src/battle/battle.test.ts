/**
 * Tests for the Battle layer (docs/battle.md, section 14).
 *
 * Battle owns the game rules; the damage numbers come from the pure formula.
 * Every test injects a fixed random source, so each result is exact.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { BattleSetup, CombatBonuses, CombatUnit, Hex } from '@de-jija/shared';

import { getCombatRules, initCombatRules } from '../combat/combatRules';
import { initSkills, type SkillsData } from '../combat/skills';
import { antimage, archer, blackDragon, goblin, swordsman } from '../combat/testFixtures';
import type { BattleRules } from './battleRules';
import { createBattle, type Battle } from './battle';

/** A small field, so the start zone and the borders are easy to reason about. */
const BATTLE_RULES: BattleRules = {
  fieldWidth: 15,
  fieldHeight: 11,
  maxUnitsPerSide: 7,
  startZoneWidth: 2,
};

/** The smallest possible damage roll. */
const minRoll = (): number => 0;

let skills: SkillsData;

beforeAll(() => {
  initCombatRules();
  skills = initSkills();
});

beforeEach(() => {
  initCombatRules();
  initSkills();
});

/** Copy of a fixture unit, so each test owns its own object. */
function unit(base: CombatUnit, changes: Partial<CombatUnit> = {}): CombatUnit {
  return { ...base, currentHp: 0, ...changes };
}

/** A simple two-sided setup; every unit starts unplaced. */
function setupWith(
  left: {
    id: string;
    unit: CombatUnit;
    stackCount?: number;
    hex?: Hex | null;
    extraBonuses?: Partial<CombatBonuses>;
  }[],
  right: {
    id: string;
    unit: CombatUnit;
    stackCount?: number;
    hex?: Hex | null;
    extraBonuses?: Partial<CombatBonuses>;
  }[],
  placementMode: 'free' | 'startZone' = 'free',
): BattleSetup {
  const toUnitSetup = (entry: {
    id: string;
    unit: CombatUnit;
    stackCount?: number;
    hex?: Hex | null;
    extraBonuses?: Partial<CombatBonuses>;
  }): BattleSetup['sides']['left']['units'][number] => ({
    id: entry.id,
    unit: entry.unit,
    stackCount: entry.stackCount ?? 1,
    hex: entry.hex ?? null,
    ...(entry.extraBonuses === undefined ? {} : { extraBonuses: entry.extraBonuses }),
  });

  return {
    placementMode,
    sides: {
      left: { hero: null, units: left.map(toUnitSetup) },
      right: { hero: null, units: right.map(toUnitSetup) },
    },
  };
}

/** Creates a battle or fails loudly — for tests that expect it to work. */
function makeBattle(setup: BattleSetup, random: () => number = minRoll): Battle {
  const created = createBattle(setup, {
    combatRules: getCombatRules(),
    skillsData: skills,
    battleRules: BATTLE_RULES,
    random,
  });

  if (!created.ok) {
    throw new Error(`createBattle failed unexpectedly: ${created.code} ${created.message}`);
  }

  return created.battle;
}

/** Puts both units on neighbouring cells and returns the battle. */
function duel(
  attacker: { id: string; unit: CombatUnit; stackCount?: number },
  defender: { id: string; unit: CombatUnit; stackCount?: number },
  attackerHex: Hex = { x: 3, y: 4 },
  defenderHex: Hex = { x: 4, y: 4 },
): Battle {
  return makeBattle(
    setupWith(
      [{ ...attacker, hex: attackerHex }],
      [{ ...defender, hex: defenderHex }],
    ),
  );
}

/** Reads one unit out of the battle state. */
function stateOf(battle: Battle, unitId: string) {
  const found = battle.getState().units.find((item) => item.id === unitId);

  if (found === undefined) {
    throw new Error(`unit ${unitId} is not in the state`);
  }

  return found;
}

describe('createBattle — the initial snapshot', () => {
  it('starts at round 1 with full stacks and empty hexes', () => {
    const battle = makeBattle(
      setupWith(
        [{ id: 'l1', unit: unit(swordsman), stackCount: 3 }],
        [{ id: 'r1', unit: unit(goblin) }],
      ),
    );
    const state = battle.getState();

    expect(state.round).toBe(1);
    expect(state.attacksStarted).toBe(false);
    // Nothing has happened yet: the log holds only the coin flip of the new battle
    // and the opening of the queue — no placements, no hits. (Both units have the
    // same speed and level, so the opening draw of rule 3v is resolved right away.)
    expect(state.log.map((event) => event.type)).toEqual([
      'PriorityRolled',
      'PriorityPassed',
      'TurnStarted',
    ]);

    // poolHp = hp per unit * stackCount; shots and retaliations start full.
    expect(stateOf(battle, 'l1').aliveCount).toBe(3);
    expect(stateOf(battle, 'l1').poolHp).toBe(60 * 3);
    expect(stateOf(battle, 'l1').hexes).toEqual([]);
    expect(stateOf(battle, 'l1').shotsLeft).toBe(0);
    expect(stateOf(battle, 'l1').retaliationsLeft).toBe(1);
  });

  it('a unit that starts on a cell is already placed and logged', () => {
    const battle = makeBattle(
      setupWith(
        [{ id: 'l1', unit: unit(swordsman), hex: { x: 1, y: 0 } }],
        [{ id: 'r1', unit: unit(goblin), hex: { x: 5, y: 0 } }],
      ),
    );

    expect(stateOf(battle, 'l1').hexes).toEqual([{ x: 1, y: 0 }]);
    expect(battle.getState().log.map((event) => event.type)).toEqual([
      'PriorityRolled',
      'UnitPlaced',
      'UnitPlaced',
      'PriorityPassed',
      'TurnStarted',
    ]);
  });

  it('the hero of a side reaches every one of its units', () => {
    const setup = setupWith(
      [
        { id: 'l1', unit: unit(swordsman) },
        { id: 'l2', unit: unit(goblin) },
      ],
      [{ id: 'r1', unit: unit(blackDragon) }],
    );
    // Hero with attack 10 and offense expert (+30%).
    setup.sides.left.hero = {
      stats: { attack: 10, defense: 0, spellPower: 0, knowledge: 0 },
      skills: [{ skillId: 'offense', level: 3 }],
    };

    const battle = makeBattle(setup);
    const first = stateOf(battle, 'l1').unit.bonuses;
    const second = stateOf(battle, 'l2').unit.bonuses;

    expect(first?.attackBonus).toBe(10);
    expect(first?.meleeOffenseBonusPercent).toBe(30);
    // The very same totals on the second unit: one aggregation, all units.
    expect(second?.attackBonus).toBe(10);
    expect(second?.meleeOffenseBonusPercent).toBe(30);
  });

  it('extraBonuses from the setup are added to the hero ones', () => {
    const setup = setupWith([{ id: 'l1', unit: unit(swordsman) }], [
      { id: 'r1', unit: unit(goblin) },
    ]);
    setup.sides.left.hero = {
      stats: { attack: 10, defense: 0, spellPower: 0, knowledge: 0 },
      skills: [],
    };
    setup.sides.left.units[0].extraBonuses = { attackBonus: 5 };

    const battle = makeBattle(setup);

    expect(stateOf(battle, 'l1').unit.bonuses?.attackBonus).toBe(15);
  });

  it('never mutates the CombatUnit the setup gave it', () => {
    const original = unit(swordsman);
    const before = structuredClone(original);

    makeBattle(setupWith([{ id: 'l1', unit: original }], [{ id: 'r1', unit: unit(goblin) }]));

    expect(original).toEqual(before);
    expect(original.bonuses).toBeUndefined();
  });

  it('the same setup always produces the same initial state', () => {
    const setup = setupWith(
      [{ id: 'l1', unit: unit(swordsman), stackCount: 2 }],
      [{ id: 'r1', unit: unit(goblin) }],
    );

    expect(makeBattle(setup).getState()).toEqual(makeBattle(setup).getState());
  });

  it('getState returns a COPY: changing it must not change the battle', () => {
    const battle = makeBattle(
      setupWith([{ id: 'l1', unit: unit(swordsman) }], [{ id: 'r1', unit: unit(goblin) }]),
    );

    const snapshot = battle.getState();

    snapshot.round = 99;
    snapshot.units[0].aliveCount = 0;
    snapshot.units[0].poolHp = 1;
    snapshot.units[0].hexes.push({ x: 9, y: 9 });
    snapshot.log.push({ type: 'RoundStarted', round: 42 });

    const fresh = battle.getState();

    expect(fresh.round).toBe(1);
    expect(fresh.units[0].aliveCount).toBe(1);
    expect(fresh.units[0].poolHp).toBe(60);
    expect(fresh.units[0].hexes).toEqual([]);
    // The caller changed a COPY of the log, so the battle still holds nothing
    // but its own opening events in it.
    expect(fresh.log.map((event) => event.type)).toEqual([
      'PriorityRolled',
      'PriorityPassed',
      'TurnStarted',
    ]);
  });

  it('a flat damage bonus in the setup changes the hit', () => {
    const normal = duel(
      { id: 'l1', unit: unit(swordsman) },
      { id: 'r2', unit: unit(goblin) },
    ).attack('l1', 'r2', { fixedDamageRoll: 0, fixedLuckRoll: 0 });

    const buffedSetup = setupWith(
      [{ id: 'l1', unit: unit(swordsman), hex: { x: 3, y: 4 } }],
      [{ id: 'r2', unit: unit(goblin), hex: { x: 4, y: 4 } }],
    );
    buffedSetup.sides.left.units[0].extraBonuses = { flatDamageBonus: 100 };
    const buffed = makeBattle(buffedSetup).attack('l1', 'r2', {
      fixedDamageRoll: 0,
      fixedLuckRoll: 0,
    });

    expect(normal.ok).toBe(true);
    expect(buffed.ok).toBe(true);
    if (normal.ok && buffed.ok) {
      const first = normal.events[0] as { damage: number };
      const second = buffed.events[0] as { damage: number };

      // Flat damage goes in BEFORE the multiplier, so +100 is worth 115 here:
      // (10 + 100) * 1.15 = 126.5 -> 127, against (10) * 1.15 = 11.5 -> 12.
      expect(first.damage).toBe(12);
      expect(second.damage).toBe(127);
    }
  });

  it('a rules override is applied on top of the global combat rules', () => {
    const setup = setupWith(
      [{ id: 'l1', unit: unit(swordsman), hex: { x: 3, y: 4 } }],
      [{ id: 'r1', unit: unit(goblin), hex: { x: 4, y: 4 } }],
    );
    // Make the attack advantage much stronger for this battle only.
    setup.rules = { attackAdvantagePercentPerPoint: 20 };

    const result = makeBattle(setup).attack('l1', 'r1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      const event = result.events[0] as { damage: number; breakdown: { effectiveAttack: number } };

      expect(event.breakdown.effectiveAttack).toBe(6);
      // attack 6 vs defense 3 -> 1 + 0.20 * 3 = 1.6; roll 10 -> 16
      expect(event.damage).toBe(16);
    }
  });
});

describe('createBattle — a bad setup is refused, never thrown', () => {
  /** Creates a battle and returns the refusal, failing loudly if it succeeded. */
  function refuseOf(setup: BattleSetup) {
    const created = createBattle(setup, {
      combatRules: getCombatRules(),
      skillsData: skills,
      battleRules: BATTLE_RULES,
      random: minRoll,
    });

    if (created.ok) {
      throw new Error('createBattle unexpectedly succeeded');
    }

    return created;
  }

  it('rejects a repeated unit id', () => {
    const refusal = refuseOf(
      setupWith(
        [
          { id: 'same', unit: unit(swordsman) },
          { id: 'same', unit: unit(goblin) },
        ],
        [{ id: 'r1', unit: unit(goblin) }],
      ),
    );

    expect(refusal.code).toBe('SETUP_INVALID');
    expect(refusal.message).toMatch(/повторяющийся id "same"/);
  });

  it('rejects more units on a side than maxUnitsPerSide', () => {
    const many = Array.from({ length: 8 }, (_item, index) => ({
      id: `l${index}`,
      unit: unit(swordsman),
    }));

    const refusal = refuseOf(setupWith(many, [{ id: 'r1', unit: unit(goblin) }]));

    expect(refusal.code).toBe('SETUP_INVALID');
    expect(refusal.message).toMatch(/юнитов 8, а максимум 7/);
  });

  it('rejects a cell outside the field', () => {
    const refusal = refuseOf(
      setupWith(
        [{ id: 'l1', unit: unit(swordsman), hex: { x: 99, y: 0 } }],
        [{ id: 'r1', unit: unit(goblin) }],
      ),
    );

    expect(refusal.code).toBe('SETUP_INVALID');
    expect(refusal.message).toMatch(/вне поля 15x11/);
  });

  it('rejects two units on the same cell', () => {
    const refusal = refuseOf(
      setupWith(
        [{ id: 'l1', unit: unit(swordsman), hex: { x: 3, y: 4 } }],
        [{ id: 'r1', unit: unit(goblin), hex: { x: 3, y: 4 } }],
      ),
    );

    expect(refusal.code).toBe('SETUP_INVALID');
    expect(refusal.message).toMatch(/уже занят другим бойцом/);
  });

  it.each([0, -3, 1.5])('rejects stackCount = %s', (stackCount) => {
    const setup = setupWith(
      [{ id: 'l1', unit: unit(swordsman), stackCount }],
      [{ id: 'r1', unit: unit(goblin) }],
    );

    const refusal = refuseOf(setup);

    expect(refusal.code).toBe('SETUP_INVALID');
    expect(refusal.message).toMatch(/stackCount/);
  });

  it('rejects a bad hero loadout and keeps the aggregator message', () => {
    const setup = setupWith(
      [{ id: 'l1', unit: unit(swordsman) }],
      [{ id: 'r1', unit: unit(goblin) }],
    );
    setup.sides.left.hero = {
      stats: { attack: 10, defense: 0, spellPower: 0, knowledge: 0 },
      skills: [{ skillId: 'offense', level: 9 as unknown as 3 }],
    };

    const refusal = refuseOf(setup);

    expect(refusal.code).toBe('SETUP_INVALID');
    expect(refusal.message).toMatch(/уровень должен быть 1, 2 или 3/);
  });

  it('rejects an unknown key in the rules override', () => {
    const setup = setupWith(
      [{ id: 'l1', unit: unit(swordsman) }],
      [{ id: 'r1', unit: unit(goblin) }],
    );
    setup.rules = { notARule: 1 };

    expect(refuseOf(setup).message).toMatch(/неизвестный ключ правил/);
  });

  it('a rules override is applied on top of the global combat rules', () => {
    const setup = setupWith(
      [{ id: 'l1', unit: unit(swordsman), hex: { x: 3, y: 4 } }],
      [{ id: 'r1', unit: unit(goblin), hex: { x: 4, y: 4 } }],
    );
    // Make the attack advantage much stronger for this battle only.
    setup.rules = { attackAdvantagePercentPerPoint: 20 };

    const result = makeBattle(setup).attack('l1', 'r1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      const event = result.events[0] as { damage: number; breakdown: { effectiveAttack: number } };

      expect(event.breakdown.effectiveAttack).toBe(6);
      // attack 6 vs defense 3 -> 1 + 0.20 * 3 = 1.6; roll 10 -> 16
      expect(event.damage).toBe(16);
    }
  });

  // Every key of CombatRules. Each is overridden ALONE and a real hit is resolved.
  //
  // The exchange below is deliberately simple (one unit, min roll, no luck, no armor,
  // no morale, no hero): only a few keys can change ITS number. The rest must leave
  // the damage exactly as it is — that is the real proof that an override of one key
  // does not silently touch the other ten.
  it.each([
    // key                              value                  changes this hit?
    ['attackAdvantagePercentPerPoint', 20, true],
    ['attackAdvantageCapPercent', 800, false], // the cap is x4 and is not reached here
    ['defensePenaltyPercentPerPoint', 5, false], // attack > defense: unused
    ['defensePenaltyFloorPercent', 50, false], // the floor is not reached here
    ['luckChanceByLevel', { '1': 50, '2': 60, '3': 70 }, false], // luckLevel is 0
    ['luckPositiveMultiplier', 2, false], // luck never triggers at level 0
    ['luckNegativeMultiplier', 0.5, false], // same
    ['moraleBonusAttackMultiplier', 0.5, false], // not a morale extra attack
    ['minimumDamage', 7, false], // this hit already deals more than 7
    ['damageRollMode', 'sampled', false], // one unit: both modes roll the same range
    ['damageRollSamples', 3, false], // k = min(1, 3) = 1: identical
  ] as const)('overriding %s alone changes only what it should', (key, value, changesHit) => {
    const build = (): BattleSetup =>
      setupWith(
        [{ id: 'l1', unit: unit(swordsman), hex: { x: 3, y: 4 } }],
        [{ id: 'r1', unit: unit(goblin), hex: { x: 4, y: 4 } }],
      );

    // The baseline: no override at all.
    const plain = makeBattle(build()).attack('l1', 'r1', {
      fixedDamageRoll: 0,
      fixedLuckRoll: 0,
    });

    // The same fight with exactly ONE key overridden.
    const tweakedSetup = build();
    tweakedSetup.rules = { [key]: value };
    const tweaked = makeBattle(tweakedSetup).attack('l1', 'r1', {
      fixedDamageRoll: 0,
      fixedLuckRoll: 0,
    });

    expect(plain.ok).toBe(true);
    expect(tweaked.ok).toBe(true);
    if (!plain.ok || !tweaked.ok) {
      return;
    }

    const plainHit = plain.events[0] as { damage: number; breakdown: unknown };
    const tweakedHit = tweaked.events[0] as { damage: number; breakdown: unknown };

    // Baseline: roll 10, attack 6 vs defense 3 -> 1.15 -> 11.5 -> 12.
    expect(plainHit.damage).toBe(12);

    if (changesHit) {
      // attack 6 vs defense 3 -> 1 + 0.20 * 3 = 1.6 -> 16
      expect(tweakedHit.damage).toBe(16);
      expect(tweakedHit.damage).not.toBe(plainHit.damage);
    } else {
      // The key was accepted, but it has no business changing THIS hit.
      expect(tweakedHit.damage).toBe(plainHit.damage);
      expect(tweakedHit.breakdown).toEqual(plainHit.breakdown);
    }
  });
});

describe('placeUnit', () => {
  it('puts a unit on a free cell and writes a UnitPlaced event', () => {
    const battle = makeBattle(
      setupWith([{ id: 'l1', unit: unit(swordsman) }], [{ id: 'r1', unit: unit(goblin) }]),
    );

    const result = battle.placeUnit('l1', { x: 3, y: 4 });

    expect(result.ok).toBe(true);
    expect(stateOf(battle, 'l1').hexes).toEqual([{ x: 3, y: 4 }]);
    // The log opens the battle (the opening priority, the draw of the two equal-speed
    // units, the first turn) and then records this placement. The two units have
    // the SAME speed, so the priority came from the coin.
    expect(battle.getState().log).toEqual([
      { type: 'PriorityRolled', side: 'left', reason: 'coin' },
      { type: 'PriorityPassed', round: 1, from: 'left', to: 'right', unitIds: ['l1', 'r1'] },
      { type: 'TurnStarted', round: 1, unitId: 'l1' },
      { type: 'UnitPlaced', unitId: 'l1', hex: { x: 3, y: 4 } },
    ]);
  });

  it('refuses an unknown unit', () => {
    const battle = makeBattle(
      setupWith([{ id: 'l1', unit: unit(swordsman) }], [{ id: 'r1', unit: unit(goblin) }]),
    );

    const result = battle.placeUnit('nobody', { x: 1, y: 1 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('UNIT_NOT_FOUND');
    }
  });

  it('refuses a cell outside the field', () => {
    const battle = makeBattle(
      setupWith([{ id: 'l1', unit: unit(swordsman) }], [{ id: 'r1', unit: unit(goblin) }]),
    );

    const result = battle.placeUnit('l1', { x: 15, y: 0 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('HEX_OUT_OF_FIELD');
    }
  });

  it('refuses an occupied cell', () => {
    const battle = makeBattle(
      setupWith(
        [{ id: 'l1', unit: unit(swordsman) }, { id: 'l2', unit: unit(goblin) }],
        [{ id: 'r1', unit: unit(goblin) }],
      ),
    );
    battle.placeUnit('l1', { x: 3, y: 4 });

    const result = battle.placeUnit('l2', { x: 3, y: 4 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('HEX_OCCUPIED');
    }
  });

  it('in free mode a unit may be moved at any time, even after a hit', () => {
    const battle = duel({ id: 'l1', unit: unit(swordsman) }, { id: 'r1', unit: unit(goblin) });
    battle.attack('l1', 'r1');

    expect(battle.placeUnit('l1', { x: 9, y: 9 }).ok).toBe(true);
    expect(stateOf(battle, 'l1').hexes).toEqual([{ x: 9, y: 9 }]);
  });

  it("in startZone mode a unit may only be placed in its OWN zone", () => {
    const battle = makeBattle(
      setupWith(
        [{ id: 'l1', unit: unit(swordsman) }, { id: 'l2', unit: unit(goblin) }],
        [{ id: 'r1', unit: unit(goblin) }],
        'startZone',
      ),
    );

    // startZoneWidth = 2, so the left side owns columns 0..1.
    expect(battle.placeUnit('l1', { x: 1, y: 4 }).ok).toBe(true);

    const outside = battle.placeUnit('l1', { x: 5, y: 4 });

    expect(outside.ok).toBe(false);
    if (!outside.ok) {
      expect(outside.code).toBe('PLACEMENT_FORBIDDEN');
      expect(outside.message).toMatch(/стартовой зоны/);
    }
  });

  it('in startZone mode placement closes after the first hit', () => {
    const battle = makeBattle(
      setupWith(
        [
          { id: 'l1', unit: unit(swordsman), hex: { x: 0, y: 4 } },
          { id: 'l2', unit: unit(goblin) },
        ],
        [{ id: 'r1', unit: unit(goblin), hex: { x: 1, y: 4 } }],
        'startZone',
      ),
    );

    // (0,4) and (1,4) really are one step apart, so this is a legal melee hit.
    battle.attack('l1', 'r1');
    expect(battle.getState().attacksStarted).toBe(true);

    const result = battle.placeUnit('l2', { x: 1, y: 5 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('PLACEMENT_FORBIDDEN');
      expect(result.message).toMatch(/После первого удара/);
    }
  });
});

describe('attack — the rules of the hit', () => {
  it('a neighbour is a melee hit that writes the result into the defender', () => {
    const battle = duel({ id: 'l1', unit: unit(swordsman) }, { id: 'r1', unit: unit(goblin) });

    const result = battle.attack('l1', 'r1', { fixedDamageRoll: 0, fixedLuckRoll: 0 });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const hit = result.events[0] as {
      type: string;
      kind: string;
      damage: number;
      defenderPoolHpBefore: number;
      defenderPoolHpAfter: number;
      defenderAliveBefore: number;
      defenderAliveAfter: number;
    };

    // swordsman roll 10, attack 6 vs defense 3 -> x1.15 -> 11.5 -> 12
    expect(hit.type).toBe('AttackResolved');
    expect(hit.kind).toBe('melee');
    expect(hit.damage).toBe(12);
    expect(hit.defenderPoolHpBefore).toBe(50);
    expect(hit.defenderPoolHpAfter).toBe(38);
    expect(hit.defenderAliveBefore).toBe(1);
    expect(hit.defenderAliveAfter).toBe(1);

    expect(stateOf(battle, 'r1').poolHp).toBe(38);
  });

  it('the hit and the retaliation both reach the log, in order', () => {
    const battle = duel({ id: 'l1', unit: unit(swordsman) }, { id: 'r1', unit: unit(goblin) });

    const result = battle.attack('l1', 'r1', { fixedDamageRoll: 0, fixedLuckRoll: 0 });

    expect(result.ok).toBe(true);
    // Both units started on cells, so their placement is already in the log.
    expect(battle.getState().log.map((event) => event.type)).toEqual([
      'PriorityRolled',
      'UnitPlaced',
      'UnitPlaced',
      'PriorityPassed',
      'TurnStarted',
      'AttackResolved',
      'RetaliationResolved',
      'TurnStarted',
    ]);
  });

  it('refuses friendly fire', () => {
    const battle = makeBattle(
      setupWith(
        [
          { id: 'l1', unit: unit(swordsman), hex: { x: 3, y: 4 } },
          { id: 'l2', unit: unit(goblin), hex: { x: 4, y: 4 } },
        ],
        [{ id: 'r1', unit: unit(goblin), hex: { x: 10, y: 4 } }],
      ),
    );

    const result = battle.attack('l1', 'l2');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('SAME_SIDE');
    }
  });

  it('refuses an unknown unit on either side', () => {
    const battle = duel({ id: 'l1', unit: unit(swordsman) }, { id: 'r1', unit: unit(goblin) });

    const noAttacker = battle.attack('ghost', 'r1');
    const noDefender = battle.attack('l1', 'ghost');

    expect(noAttacker.ok).toBe(false);
    expect(noDefender.ok).toBe(false);
    if (!noAttacker.ok) {
      expect(noAttacker.code).toBe('UNIT_NOT_FOUND');
    }
    if (!noDefender.ok) {
      expect(noDefender.code).toBe('UNIT_NOT_FOUND');
    }
  });

  it('refuses a hit from or at a unit that is not on the field', () => {
    const battle = makeBattle(
      setupWith(
        [{ id: 'l1', unit: unit(swordsman) }],
        [{ id: 'r1', unit: unit(goblin), hex: { x: 4, y: 4 } }],
      ),
    );

    const result = battle.attack('l1', 'r1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('NOT_PLACED');
    }
  });

  it('any unit may hit any number of times per round (there is no turn queue)', () => {
    // The dragon survives many exchanges: 200 HP, 48 damage per exchange.
    const battle = duel({ id: 'l1', unit: unit(blackDragon) }, { id: 'r1', unit: unit(blackDragon) });

    for (let hit = 0; hit < 3; hit++) {
      expect(battle.attack('l1', 'r1', { fixedDamageRoll: 0, fixedLuckRoll: 0 }).ok).toBe(true);
    }

    expect(battle.getState().round).toBe(1);
    expect(battle.getState().log.filter((e) => e.type === 'AttackResolved')).toHaveLength(3);
  });

  it('a destroyed stack stays in the state but can neither be hit nor hit', () => {
    // The antimage rolls 40 and hits for 58, more than the goblin's 50 HP.
    const battle = duel({ id: 'l1', unit: unit(antimage) }, { id: 'r1', unit: unit(goblin) });

    battle.attack('l1', 'r1', { fixedDamageRoll: 0, fixedLuckRoll: 0 });

    expect(stateOf(battle, 'r1').aliveCount).toBe(0);
    expect(stateOf(battle, 'r1').poolHp).toBe(0);

    const again = battle.attack('l1', 'r1');
    const deadAttacker = battle.attack('r1', 'l1');

    expect(again.ok).toBe(false);
    if (!again.ok) {
      expect(again.code).toBe('UNIT_DEAD');
    }
    expect(deadAttacker.ok).toBe(false);
    if (!deadAttacker.ok) {
      expect(deadAttacker.code).toBe('UNIT_DEAD');
    }
  });

  it('reports UnitDestroyed and skips the retaliation of a dead stack', () => {
    // A 1-unit stack of 50 HP is wiped out by the antimage's 58 damage.
    const battle = duel({ id: 'l1', unit: unit(antimage) }, { id: 'r1', unit: unit(goblin) });

    const result = battle.attack('l1', 'r1', { fixedDamageRoll: 0, fixedLuckRoll: 0 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const types = result.events.map((event) => event.type);

      expect(types).toContain('UnitDestroyed');
      expect(types).not.toContain('RetaliationResolved');
    }
  });
});

describe('ranged attacks and shots', () => {
  /** An archer (12 shots) against a goblin two cells away. */
  function shooting(): Battle {
    return makeBattle(
      setupWith(
        [{ id: 'l1', unit: unit(archer), hex: { x: 3, y: 4 } }],
        [{ id: 'r1', unit: unit(goblin), hex: { x: 5, y: 4 } }],
      ),
    );
  }

  it('a target further than one cell is a ranged hit and costs one shot', () => {
    const battle = shooting();

    const result = battle.attack('l1', 'r1', { fixedDamageRoll: 0, fixedLuckRoll: 0 });

    expect(stateOf(battle, 'l1').shotsLeft).toBe(11);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const hit = result.events[0] as { kind: string; damage: number };

      expect(hit.kind).toBe('ranged');
      // archer roll 5, attack 5 vs defense 3 -> 1 + 0.05 * 2 = 1.1 -> 5.5 -> 6
      expect(hit.damage).toBe(6);
      expect(result.events.map((event) => event.type)).toContain('ShotSpent');
    }
  });

  it('a shot never provokes a retaliation', () => {
    const battle = shooting();

    const result = battle.attack('l1', 'r1', { fixedDamageRoll: 0, fixedLuckRoll: 0 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.events.map((event) => event.type)).not.toContain('RetaliationResolved');
    }
    // The goblin still has its one retaliation for this round.
    expect(stateOf(battle, 'r1').retaliationsLeft).toBe(1);
  });

  it('a shooter hitting a neighbour fights in melee and spends no shot', () => {
    const battle = makeBattle(
      setupWith(
        [{ id: 'l1', unit: unit(archer), hex: { x: 3, y: 4 } }],
        [{ id: 'r1', unit: unit(goblin), hex: { x: 4, y: 4 } }],
      ),
    );

    const result = battle.attack('l1', 'r1', { fixedDamageRoll: 0, fixedLuckRoll: 0 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.events[0] as { kind: string }).kind).toBe('melee');
    }
    expect(stateOf(battle, 'l1').shotsLeft).toBe(12);
  });

  it('a unit that is not a shooter cannot reach a distant target at all', () => {
    const battle = makeBattle(
      setupWith(
        [{ id: 'l1', unit: unit(swordsman), hex: { x: 3, y: 4 } }],
        [{ id: 'r1', unit: unit(goblin), hex: { x: 6, y: 4 } }],
      ),
    );

    const result = battle.attack('l1', 'r1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('TOO_FAR');
    }
  });

  it('a shooter out of shots gets NO_SHOTS, not TOO_FAR', () => {
    // The dragon (200 HP) survives: 12 shots x 6 damage = 72, so the archer really
    // runs out of shots instead of running out of a target.
    const battle = makeBattle(
      setupWith(
        [{ id: 'l1', unit: unit(archer), hex: { x: 3, y: 4 } }],
        [{ id: 'r1', unit: unit(blackDragon), hex: { x: 5, y: 4 } }],
      ),
    );

    for (let shot = 0; shot < 12; shot++) {
      expect(battle.attack('l1', 'r1', { fixedDamageRoll: 0, fixedLuckRoll: 0 }).ok).toBe(true);
    }
    expect(stateOf(battle, 'l1').shotsLeft).toBe(0);

    const result = battle.attack('l1', 'r1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('NO_SHOTS');
    }
  });

  it('nextRound does NOT restore shots', () => {
    const battle = shooting();

    battle.attack('l1', 'r1', { fixedDamageRoll: 0, fixedLuckRoll: 0 });
    expect(stateOf(battle, 'l1').shotsLeft).toBe(11);

    battle.nextRound();

    expect(stateOf(battle, 'l1').shotsLeft).toBe(11);
  });
});

describe('retaliation', () => {
  it('a defender answers with a full calculation and its counter goes down', () => {
    const battle = duel({ id: 'l1', unit: unit(swordsman) }, { id: 'r1', unit: unit(goblin) });

    const result = battle.attack('l1', 'r1', { fixedDamageRoll: 0, fixedLuckRoll: 0 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const back = result.events[1] as {
        type: string;
        attackerId: string;
        defenderId: string;
        kind: string;
        damage: number;
      };

      expect(back.type).toBe('RetaliationResolved');
      // The event names the roles the way the player sees them.
      expect(back.attackerId).toBe('r1');
      expect(back.defenderId).toBe('l1');
      expect(back.kind).toBe('melee');
      // goblin roll 8, attack 4 vs swordsman defense 6 -> 1 - 0.025 * 2 = 0.95
      // -> 7.6 -> round half up 8
      expect(back.damage).toBe(8);
    }
    expect(stateOf(battle, 'r1').retaliationsLeft).toBe(0);
    // The swordsman really took the hit.
    expect(stateOf(battle, 'l1').poolHp).toBe(60 - 8);
  });

  it('a stack that lost units answers WEAKER than the same stack at full strength', () => {
    // The dragon hits for 48. A 2-goblin stack has 100 HP: after the first hit
    // 52 HP are left, so BOTH units are still standing and the answer is the
    // full-strength one (16 roll -> 16 * 0.8 = 12.8 -> 13). After the second
    // hit only 4 HP are left = 1 unit, and the answer is a NEW, weaker
    // calculation (8 roll -> 8 * 0.8 = 6.4 -> 6).
    const both = (): Battle =>
      duel(
        { id: 'l1', unit: unit(blackDragon, { retaliationsPerRound: 2 }) },
        { id: 'r1', unit: unit(goblin, { retaliationsPerRound: 2 }), stackCount: 2 },
      );

    const first = both();
    const strongHit = first.attack('l1', 'r1', { fixedDamageRoll: 0, fixedLuckRoll: 0 });

    expect(stateOf(first, 'r1').aliveCount).toBe(2);
    expect(strongHit.ok).toBe(true);
    if (strongHit.ok) {
      expect((strongHit.events[1] as { damage: number }).damage).toBe(13);
    }

    // The same fight, one more exchange: the stack is down to a single unit.
    const hurt = both();
    hurt.attack('l1', 'r1', { fixedDamageRoll: 0, fixedLuckRoll: 0 });
    const weakHit = hurt.attack('l1', 'r1', { fixedDamageRoll: 0, fixedLuckRoll: 0 });

    expect(stateOf(hurt, 'r1').aliveCount).toBe(1);
    expect(weakHit.ok).toBe(true);
    if (weakHit.ok) {
      const weakAnswer = (weakHit.events[1] as { damage: number }).damage;

      expect(weakAnswer).toBe(6);
      // This is the point of the whole rule: the answer is a new calculation
      // from the new state, not a replay of the numbers from before the hit.
      expect(weakAnswer).toBeLessThan(13);
    }
  });

  it('NoRetaliation on the attacker stops the answer', () => {
    const battle = duel({ id: 'l1', unit: unit(antimage) }, { id: 'r1', unit: unit(blackDragon) });

    const result = battle.attack('l1', 'r1', { fixedDamageRoll: 0, fixedLuckRoll: 0 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.events.map((event) => event.type)).not.toContain('RetaliationResolved');
    }
    // The defender keeps its counter: nothing was used.
    expect(stateOf(battle, 'r1').retaliationsLeft).toBe(1);
  });

  it('a unit with 2 retaliations per round answers twice in a round', () => {
    // A tanky goblin (2000 HP) so the stack never dies and the COUNTER is the
    // only thing that can stop the third answer.
    const tank = unit(goblin, {
      stats: { ...goblin.stats, hp: 2000 },
      retaliationsPerRound: 2,
    });
    const battle = duel({ id: 'l1', unit: unit(swordsman) }, { id: 'r1', unit: tank });

    expect(stateOf(battle, 'r1').retaliationsLeft).toBe(2);

    const first = battle.attack('l1', 'r1', { fixedDamageRoll: 0, fixedLuckRoll: 0 });
    expect(stateOf(battle, 'r1').retaliationsLeft).toBe(1);

    const second = battle.attack('l1', 'r1', { fixedDamageRoll: 0, fixedLuckRoll: 0 });
    expect(stateOf(battle, 'r1').retaliationsLeft).toBe(0);

    // Both hits were answered, the third one is not: the counter is spent.
    const third = battle.attack('l1', 'r1', { fixedDamageRoll: 0, fixedLuckRoll: 0 });

    expect(first.ok && second.ok && third.ok).toBe(true);
    if (first.ok && second.ok && third.ok) {
      expect(first.events.map((e) => e.type)).toContain('RetaliationResolved');
      expect(second.events.map((e) => e.type)).toContain('RetaliationResolved');
      expect(third.events.map((e) => e.type)).not.toContain('RetaliationResolved');
    }
    expect(stateOf(battle, 'r1').aliveCount).toBe(1);
  });

  it("'unlimited' retaliations never run out", () => {
    // A tanky royal griffin: 2000 HP, so it survives every exchange and only the
    // 'unlimited' rule can explain why it keeps answering.
    const royal = unit(goblin, {
      stats: { ...goblin.stats, hp: 2000 },
      retaliationsPerRound: 'unlimited',
    });
    const battle = duel({ id: 'l1', unit: unit(swordsman) }, { id: 'r1', unit: royal });

    for (let hit = 0; hit < 4; hit++) {
      const result = battle.attack('l1', 'r1', { fixedDamageRoll: 0, fixedLuckRoll: 0 });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.events.map((e) => e.type)).toContain('RetaliationResolved');
      }
    }

    expect(stateOf(battle, 'r1').retaliationsLeft).toBe('unlimited');
    expect(stateOf(battle, 'r1').aliveCount).toBe(1);
  });

  it('a retaliation can destroy the original attacker', () => {
    // A frail attacker (30 HP) against the dragon, which answers for 44.
    // The attacker deals 9 first (30 - 9 = 21 left), and the answer kills it.
    const frail = unit(swordsman, { stats: { ...swordsman.stats, hp: 30 } });
    const battle = duel({ id: 'l1', unit: frail }, { id: 'r1', unit: unit(blackDragon) });

    const result = battle.attack('l1', 'r1', { fixedDamageRoll: 0, fixedLuckRoll: 0 });

    expect(result.ok).toBe(true);
    expect(stateOf(battle, 'l1').aliveCount).toBe(0);
    expect(stateOf(battle, 'l1').poolHp).toBe(0);
    if (result.ok) {
      const types = result.events.map((event) => event.type);

      expect(types).toContain('RetaliationResolved');
      // UnitDestroyed names the unit that died — here the original attacker.
      expect(types).toContain('UnitDestroyed');
    }
  });
});

describe('nextRound', () => {
  it('starts a new round, resets the counters and logs the event', () => {
    const battle = duel({ id: 'l1', unit: unit(swordsman) }, { id: 'r1', unit: unit(goblin) });

    battle.attack('l1', 'r1', { fixedDamageRoll: 0, fixedLuckRoll: 0 });
    expect(stateOf(battle, 'r1').retaliationsLeft).toBe(0);

    const result = battle.nextRound();

    expect(result.ok).toBe(true);
    expect(battle.getState().round).toBe(2);
    expect(stateOf(battle, 'r1').retaliationsLeft).toBe(1);

    const log = battle.getState().log;

    expect(log).toContainEqual({ type: 'RoundStarted', round: 2 });
  });

  it('a unit with 2 retaliations gets its own number back', () => {
    const battle = duel(
      { id: 'l1', unit: unit(blackDragon) },
      { id: 'r1', unit: unit(goblin, { retaliationsPerRound: 2 }) },
    );

    battle.attack('l1', 'r1', { fixedDamageRoll: 0, fixedLuckRoll: 0 });
    expect(stateOf(battle, 'r1').retaliationsLeft).toBe(1);

    battle.nextRound();

    expect(stateOf(battle, 'r1').retaliationsLeft).toBe(2);
  });

  it("'unlimited' stays 'unlimited' after a round", () => {
    const battle = duel(
      { id: 'l1', unit: unit(blackDragon) },
      { id: 'r1', unit: unit(goblin, { retaliationsPerRound: 'unlimited' }) },
    );

    battle.nextRound();

    expect(stateOf(battle, 'r1').retaliationsLeft).toBe('unlimited');
  });

  it('a dead unit is skipped by the reset', () => {
    const battle = duel({ id: 'l1', unit: unit(antimage) }, { id: 'r1', unit: unit(goblin) });

    battle.attack('l1', 'r1', { fixedDamageRoll: 0, fixedLuckRoll: 0 });
    battle.nextRound();

    expect(stateOf(battle, 'r1').aliveCount).toBe(0);
  });
});

describe('getValidTargets', () => {
  it('lists only alive, placed enemies and never a friendly unit', () => {
    const battle = makeBattle(
      setupWith(
        [
          { id: 'l1', unit: unit(swordsman), hex: { x: 3, y: 4 } },
          { id: 'l2', unit: unit(goblin), hex: { x: 3, y: 5 } },
        ],
        [
          { id: 'r1', unit: unit(goblin), hex: { x: 4, y: 4 } }, // neighbour
          { id: 'r2', unit: unit(goblin), hex: { x: 9, y: 9 } }, // far away
        ],
      ),
    );

    const result = battle.getValidTargets('l1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Own side (l2) is never a target; the far goblin is unreachable without
      // shots, so only the neighbour is listed.
      expect(result.targets).toEqual([{ unitId: 'r1', kind: 'melee', distance: 1 }]);
    }
  });

  it('a shooter with shots sees the distant enemy as a ranged target', () => {
    const battle = makeBattle(
      setupWith(
        [{ id: 'l1', unit: unit(archer), hex: { x: 3, y: 4 } }],
        [{ id: 'r1', unit: unit(goblin), hex: { x: 6, y: 4 } }],
      ),
    );

    const result = battle.getValidTargets('l1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.targets).toEqual([{ unitId: 'r1', kind: 'ranged', distance: 3 }]);
    }
  });

  it('a shooter out of shots sees no distant target', () => {
    const battle = makeBattle(
      setupWith(
        [{ id: 'l1', unit: unit(archer), hex: { x: 3, y: 4 } }],
        [{ id: 'r1', unit: unit(goblin), hex: { x: 6, y: 4 } }],
      ),
    );

    for (let shot = 0; shot < 12; shot++) {
      battle.attack('l1', 'r1', { fixedDamageRoll: 0, fixedLuckRoll: 0 });
    }

    const result = battle.getValidTargets('l1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.targets).toEqual([]);
    }
  });

  it('a shooter sees a neighbour as melee and a distant one as ranged AT THE SAME TIME', () => {
    const battle = makeBattle(
      setupWith(
        [{ id: 'l1', unit: unit(archer), hex: { x: 3, y: 4 } }],
        [
          { id: 'near', unit: unit(goblin), hex: { x: 4, y: 4 } }, // distance 1
          { id: 'far', unit: unit(goblin), hex: { x: 6, y: 4 } }, // distance 3
        ],
      ),
    );

    const result = battle.getValidTargets('l1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      const byId = new Map(result.targets.map((target) => [target.unitId, target]));

      // The neighbour is a melee target (and costs no shot), the far one ranged.
      expect(byId.get('near')).toEqual({ unitId: 'near', kind: 'melee', distance: 1 });
      expect(byId.get('far')).toEqual({ unitId: 'far', kind: 'ranged', distance: 3 });
    }
  });

  it('a shooter sees several distant targets at their own distances', () => {
    const battle = makeBattle(
      setupWith(
        [{ id: 'l1', unit: unit(archer), hex: { x: 3, y: 4 } }],
        [
          { id: 'd2', unit: unit(goblin), hex: { x: 5, y: 4 } }, // distance 2
          { id: 'd3', unit: unit(goblin), hex: { x: 6, y: 4 } }, // distance 3
          { id: 'd9', unit: unit(goblin), hex: { x: 9, y: 9 } }, // distance 9
        ],
      ),
    );

    const result = battle.getValidTargets('l1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Ranged reach is not limited in version 1: every living enemy is a target,
      // each with its real distance.
      expect(result.targets).toEqual([
        { unitId: 'd2', kind: 'ranged', distance: 2 },
        { unitId: 'd3', kind: 'ranged', distance: 3 },
        { unitId: 'd9', kind: 'ranged', distance: 9 },
      ]);
    }
  });

  it('a shooter out of shots still sees the neighbour, but no distant target', () => {
    // A tanky target, so the archer really runs out of shots instead of the target dying.
    const battle = makeBattle(
      setupWith(
        [{ id: 'l1', unit: unit(archer), hex: { x: 3, y: 4 } }],
        [
          { id: 'near', unit: unit(blackDragon), hex: { x: 4, y: 4 } },
          { id: 'far', unit: unit(blackDragon), hex: { x: 6, y: 4 } },
        ],
      ),
    );

    for (let shot = 0; shot < 12; shot++) {
      battle.attack('l1', 'far', { fixedDamageRoll: 0, fixedLuckRoll: 0 });
    }
    expect(stateOf(battle, 'l1').shotsLeft).toBe(0);

    const result = battle.getValidTargets('l1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Without shots the far enemy is unreachable, the neighbour still is: it is
      // a melee fight that costs nothing.
      expect(result.targets).toEqual([{ unitId: 'near', kind: 'melee', distance: 1 }]);
    }
  });

  it('never lists a dead or an unplaced enemy', () => {
    const battle = makeBattle(
      setupWith(
        // An archer with a big flat bonus: it kills the neighbour goblin in one
        // melee hit (50 damage over its 50 HP) and still has shots for the far one.
        [{ id: 'l1', unit: unit(archer), hex: { x: 3, y: 4 }, extraBonuses: { flatDamageBonus: 45 } }],
        [
          { id: 'dies', unit: unit(goblin), hex: { x: 4, y: 4 } },
          { id: 'unplaced', unit: unit(goblin), hex: null },
          { id: 'alive', unit: unit(goblin), hex: { x: 6, y: 4 } },
        ],
      ),
    );

    battle.attack('l1', 'dies', { fixedDamageRoll: 0, fixedLuckRoll: 0 });
    expect(stateOf(battle, 'dies').aliveCount).toBe(0);

    const result = battle.getValidTargets('l1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      // 'dies' is destroyed and 'unplaced' has no cell, so neither can be a target.
      expect(result.targets).toEqual([{ unitId: 'alive', kind: 'ranged', distance: 3 }]);
    }
  });

  it('a dead enemy is not a target anymore', () => {
    const battle = duel({ id: 'l1', unit: unit(antimage) }, { id: 'r1', unit: unit(goblin) });

    battle.attack('l1', 'r1', { fixedDamageRoll: 0, fixedLuckRoll: 0 });

    const result = battle.getValidTargets('l1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.targets).toEqual([]);
    }
  });

  it('refuses an unknown, unplaced or dead unit', () => {
    const battle = duel({ id: 'l1', unit: unit(antimage) }, { id: 'r1', unit: unit(goblin) });

    const unknown = battle.getValidTargets('ghost');
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) {
      expect(unknown.code).toBe('UNIT_NOT_FOUND');
    }

    // The goblin is dead after this exchange, so it can ask for no targets.
    battle.attack('l1', 'r1', { fixedDamageRoll: 0, fixedLuckRoll: 0 });
    const dead = battle.getValidTargets('r1');
    expect(dead.ok).toBe(false);
    if (!dead.ok) {
      expect(dead.code).toBe('UNIT_DEAD');
    }
  });

  it('refuses a unit that is not on the field yet', () => {
    const battle = makeBattle(
      setupWith([{ id: 'l1', unit: unit(swordsman) }], [
        { id: 'r1', unit: unit(goblin), hex: { x: 4, y: 4 } },
      ]),
    );

    const result = battle.getValidTargets('l1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('NOT_PLACED');
    }
  });
});

describe('unit level data (tier / upgraded)', () => {
  /** Creates a battle and returns the refusal, failing loudly if it succeeded. */
  function refuseOf(setup: BattleSetup) {
    const created = createBattle(setup, {
      combatRules: getCombatRules(),
      skillsData: skills,
      battleRules: BATTLE_RULES,
      random: minRoll,
    });

    if (created.ok) {
      throw new Error('createBattle unexpectedly succeeded');
    }

    return created;
  }

  it('accepts a valid tier and keeps it on the combatant', () => {
    const battle = makeBattle(
      setupWith(
        [{ id: 'l1', unit: unit(swordsman, { tier: 3, upgraded: true }) }],
        [{ id: 'r1', unit: unit(goblin) }],
      ),
    );

    expect(stateOf(battle, 'l1').unit.tier).toBe(3);
    expect(stateOf(battle, 'l1').unit.upgraded).toBe(true);
  });

  it('accepts a unit without a level at all (it is simply the lowest)', () => {
    const battle = makeBattle(
      setupWith([{ id: 'l1', unit: unit(swordsman) }], [{ id: 'r1', unit: unit(goblin) }]),
    );

    expect(stateOf(battle, 'l1').unit.tier).toBeUndefined();
    expect(stateOf(battle, 'l1').unit.upgraded).toBeUndefined();
  });

  it('rejects a tier that is not a whole number >= 1', () => {
    for (const tier of [0, -2, 1.5, '2']) {
      const refusal = refuseOf(
        setupWith(
          [{ id: 'l1', unit: unit(swordsman, { tier: tier as number }) }],
          [{ id: 'r1', unit: unit(goblin) }],
        ),
      );

      expect(refusal.code).toBe('SETUP_INVALID');
      expect(refusal.message).toMatch(/tier юнита "l1"/);
    }
  });

  it('rejects an upgraded flag that is not a boolean', () => {
    const refusal = refuseOf(
      setupWith(
        [{ id: 'l1', unit: unit(swordsman, { upgraded: 'yes' as unknown as boolean }) }],
        [{ id: 'r1', unit: unit(goblin) }],
      ),
    );

    expect(refusal.code).toBe('SETUP_INVALID');
    expect(refusal.message).toMatch(/upgraded юнита "l1"/);
  });

  it('gives every unit its own slot in the army and a separate current speed', () => {
    const battle = makeBattle(
      setupWith(
        [
          { id: 'l1', unit: unit(swordsman) },
          { id: 'l2', unit: unit(goblin) },
        ],
        [{ id: 'r1', unit: unit(archer) }],
      ),
    );

    // The slot is the order in the setup, fixed once (rule 3b).
    expect(stateOf(battle, 'l1').slot).toBe(0);
    expect(stateOf(battle, 'l2').slot).toBe(1);
    expect(stateOf(battle, 'r1').slot).toBe(2);

    // The current speed starts as the base speed, but it is its own copy.
    expect(stateOf(battle, 'r1').currentSpeed).toBe(6);
    expect(stateOf(battle, 'r1').unit.stats.speed).toBe(6);
    expect(stateOf(battle, 'l1').currentSpeed).toBe(5);
  });

  it('starts with nobody having waited and nobody having acted', () => {
    const battle = makeBattle(
      setupWith([{ id: 'l1', unit: unit(swordsman) }], [{ id: 'r1', unit: unit(goblin) }]),
    );

    expect(stateOf(battle, 'l1').hasWaitedThisBattle).toBe(false);
    expect(stateOf(battle, 'l1').hasWaitedThisRound).toBe(false);
    expect(stateOf(battle, 'l1').hasActedThisRound).toBe(false);
  });
});


