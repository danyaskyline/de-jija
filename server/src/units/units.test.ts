/**
 * Tests for the unit data loader and the charisma hiring curve.
 *
 * The charisma examples are the author's own check values from the source table
 * (unit "Бесы", first = 38, ratio = 1.0160), so a regression in the formula
 * fails here instead of quietly changing every price in the game.
 */

import { describe, expect, it } from 'vitest';

import {
  findRace,
  findUnit,
  getUnits,
  initUnits,
  loadUnits,
  stackCost,
  unitsOfRace,
} from './units';

describe('config/units.json', () => {
  it('loads the real file without errors', () => {
    const data = loadUnits();

    expect(data.units.length).toBeGreaterThan(0);
    expect(data.units.length).toBe(data.unitCount);
    expect(data.races.length).toBe(data.raceCount);
  });

  it('every faction holds the same number of units', () => {
    const data = loadUnits();

    for (const race of data.races) {
      expect(unitsOfRace(data, race.id).length).toBe(race.unitCount);
    }
  });

  it('the unit ids are unique', () => {
    const data = loadUnits();
    const ids = data.units.map((unit) => unit.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('damage range is never inverted', () => {
    for (const unit of loadUnits().units) {
      expect(unit.stats.damageMax).toBeGreaterThanOrEqual(unit.stats.damageMin);
      expect(unit.stats.hp).toBeGreaterThan(0);
      expect(unit.stats.speed).toBeGreaterThan(0);
    }
  });

  it('the recruitment price grows, so ratio is always above 1', () => {
    for (const unit of loadUnits().units) {
      expect(unit.charismaRatio).toBeGreaterThan(1);
    }
  });

  it('finds units and factions by id', () => {
    const data = loadUnits();
    const first = data.units[0];

    expect(findUnit(data, first.id)?.name).toBe(first.name);
    expect(findRace(data, first.raceId)?.id).toBe(first.raceId);
    expect(findUnit(data, 'no-such-unit')).toBeUndefined();
  });

  it('the fortress row is skipped and reported, not silently dropped', () => {
    const data = loadUnits();

    expect(data.skippedRows.length).toBeGreaterThan(0);
    expect(data.races.some((race) => race.id === 'fortress')).toBe(false);
  });

  it('a broken file is rejected with a readable message', () => {
    expect(() => loadUnits('config/does-not-exist.json')).toThrow(/не читается/);
  });
});

describe('stackCost - hiring curve', () => {
  const data = loadUnits();
  const imps = data.units.find((unit) => unit.name === 'Бесы');

  it('the checked example unit exists', () => {
    expect(imps).toBeDefined();
    expect(imps?.charisma).toBe(38);
    expect(imps?.charismaRatio).toBeCloseTo(1.016, 5);
  });

  it('zero units cost nothing', () => {
    expect(stackCost(imps!, 0)).toBe(0);
  });

  it('one unit costs exactly the first price', () => {
    expect(stackCost(imps!, 1)).toBe(38);
  });

  it('reproduces the author check values', () => {
    expect(stackCost(imps!, 2)).toBe(77);
    expect(stackCost(imps!, 6)).toBe(238);
    expect(stackCost(imps!, 14)).toBe(592);
    expect(stackCost(imps!, 38)).toBe(1967);
    expect(stackCost(imps!, 56)).toBe(3403);
    expect(stackCost(imps!, 80)).toBe(6081);
    expect(stackCost(imps!, 106)).toBe(10402);
  });

  it('the price never goes down when more units are hired', () => {
    let previous = 0;

    for (let n = 1; n <= 60; n += 1) {
      const cost = stackCost(imps!, n);

      expect(cost).toBeGreaterThan(previous);
      previous = cost;
    }
  });

  it('a negative count is refused', () => {
    expect(() => stackCost(imps!, -1)).toThrow();
  });
});

describe('in-memory copy', () => {
  it('initUnits fills the copy and getUnits returns it', () => {
    const loaded = initUnits();

    expect(getUnits().units.length).toBe(loaded.units.length);
  });
});
