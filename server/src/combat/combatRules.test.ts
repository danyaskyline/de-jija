/**
 * Tests for the balance-config loader (config/combat-rules.json).
 *
 * The server must fail at startup with a clear message when the balance file is
 * broken, misses a field or has a field of the wrong type — never keep running
 * with half-loaded data. Most tests here write throwaway files into a temp
 * folder, so they do not depend on the content of the real config.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_COMBAT_RULES_PATH,
  getCombatRules,
  initCombatRules,
  loadCombatRules,
} from './combatRules';

let tempDir: string;

beforeAll(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), 'de-jija-combat-rules-'));
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

/** A valid set of rules; the broken variants below are built from it. */
const validRules = {
  attackAdvantagePercentPerPoint: 5,
  attackAdvantageCapPercent: 400,
  defensePenaltyPercentPerPoint: 2.5,
  defensePenaltyFloorPercent: 30,
  luckChanceByLevel: { '1': 10, '2': 25, '3': 40 },
  luckPositiveMultiplier: 1.5,
  luckNegativeMultiplier: 0.75,
  moraleBonusAttackMultiplier: 0.8,
  minimumDamage: 1,
};

/** Writes a file into the temp folder and returns its full path. */
function writeRulesFile(name: string, content: string): string {
  const filePath = path.join(tempDir, name);
  writeFileSync(filePath, content, 'utf8');

  return filePath;
}

/** The valid rules without one field, for "missing field" tests. */
function rulesWithout(field: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(validRules).filter(([key]) => key !== field));
}

describe('combat rules loader', () => {
  it('loads the real config/combat-rules.json that ships with the repository', () => {
    const rules = loadCombatRules();

    expect(rules.attackAdvantagePercentPerPoint).toBe(5);
    expect(rules.attackAdvantageCapPercent).toBe(400);
    expect(rules.defensePenaltyPercentPerPoint).toBe(2.5);
    expect(rules.defensePenaltyFloorPercent).toBe(30); // the original HoMM3 value
    expect(rules.luckChanceByLevel).toEqual({ '1': 10, '2': 25, '3': 40 });
    expect(rules.luckPositiveMultiplier).toBe(1.5);
    expect(rules.luckNegativeMultiplier).toBe(0.75);
    expect(rules.moraleBonusAttackMultiplier).toBe(0.8);
    expect(rules.minimumDamage).toBe(1);
    expect(DEFAULT_COMBAT_RULES_PATH.endsWith(path.join('config', 'combat-rules.json'))).toBe(true);
  });

  it('reads a valid file and ignores unknown extra fields', () => {
    const filePath = writeRulesFile(
      'extra-field.json',
      JSON.stringify({ ...validRules, someFutureTuning: 123 }),
    );

    const rules = loadCombatRules(filePath);

    expect(rules).toEqual(validRules);
    expect('someFutureTuning' in rules).toBe(false);
  });

  it.each(['attackAdvantageCapPercent', 'minimumDamage'])(
    'reports a missing required number field "%s" by name',
    (field) => {
      const filePath = writeRulesFile(`missing-${field}.json`, JSON.stringify(rulesWithout(field)));

      expect(() => loadCombatRules(filePath)).toThrowError(
        new RegExp(`отсутствует обязательное поле ${field}`),
      );
    },
  );

  it('reports a number field that is not a number', () => {
    const filePath = writeRulesFile(
      'bad-number.json',
      JSON.stringify({ ...validRules, defensePenaltyFloorPercent: '80' }),
    );

    expect(() => loadCombatRules(filePath)).toThrowError(
      /поле defensePenaltyFloorPercent должно быть числом/,
    );
  });

  it('reports a missing luck level inside luckChanceByLevel', () => {
    const filePath = writeRulesFile(
      'missing-luck-level.json',
      JSON.stringify({ ...validRules, luckChanceByLevel: { '1': 10, '2': 25 } }),
    );

    expect(() => loadCombatRules(filePath)).toThrowError(
      /в поле luckChanceByLevel отсутствует уровень удачи "3"/,
    );
  });

  it('reports a luck chance that is not a number', () => {
    const filePath = writeRulesFile(
      'bad-luck-chance.json',
      JSON.stringify({ ...validRules, luckChanceByLevel: { '1': 'ten', '2': 25, '3': 40 } }),
    );

    expect(() => loadCombatRules(filePath)).toThrowError(
      /значение для уровня "1" должно быть числом/,
    );
  });

  it('reports a field that must be an object of numbers but is not', () => {
    const filePath = writeRulesFile(
      'bad-luck-object.json',
      JSON.stringify({ ...validRules, luckChanceByLevel: 25 }),
    );

    expect(() => loadCombatRules(filePath)).toThrowError(
      /поле luckChanceByLevel должно быть объектом с числами/,
    );
  });

  it('reports a file that is not valid JSON', () => {
    const filePath = writeRulesFile('broken.json', '{ "attackAdvantageCapPercent": 400, ');

    expect(() => loadCombatRules(filePath)).toThrowError(/не является корректным JSON/);
  });

  it('reports a JSON file that is not an object', () => {
    const filePath = writeRulesFile('array.json', '[1, 2, 3]');

    expect(() => loadCombatRules(filePath)).toThrowError(/ожидался JSON-объект с настройками/);
  });

  it('reports an unreadable file and shortens the path inside the repository', () => {
    const missingInsideRepo = path.resolve(DEFAULT_COMBAT_RULES_PATH, '..', 'does-not-exist.json');

    expect(() => loadCombatRules(missingInsideRepo)).toThrowError(
      /^config\/does-not-exist\.json: файл не читается/,
    );
  });
});

describe('combat rules in memory (loaded once at startup)', () => {
  it('getCombatRules() explains clearly that nothing was loaded yet', async () => {
    // A fresh module instance, i.e. the state of a server that forgot to load the file.
    vi.resetModules();
    const freshModule = await import('./combatRules');

    expect(() => freshModule.getCombatRules()).toThrowError(/Правила боя не загружены/);
  });

  it('initCombatRules() puts the rules in memory for the battle module', async () => {
    vi.resetModules();
    const freshModule = await import('./combatRules');

    const loaded = freshModule.initCombatRules();

    expect(freshModule.getCombatRules()).toEqual(loaded);
    expect(freshModule.getCombatRules().attackAdvantageCapPercent).toBe(400);
  });

  it('the rules used by default are exactly the ones loaded at startup', () => {
    const loaded = initCombatRules();

    expect(getCombatRules()).toEqual(loaded);
  });
});
