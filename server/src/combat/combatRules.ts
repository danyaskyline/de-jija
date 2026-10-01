/**
 * Combat balance rules — loaded from config/combat-rules.json.
 *
 * The file is read ONCE at server startup (see server/src/index.ts) and kept in
 * memory; resolveAttack never touches the file itself (docs/decisions.md, 012).
 * The file is edited by hand and versioned in git — no DB, no hot reload.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

/** <repo root>/config/combat-rules.json — server/src/combat is three levels deep. */
export const DEFAULT_COMBAT_RULES_PATH = path.resolve(
  currentDir,
  '../../../config/combat-rules.json',
);

/** Repo root, used only to print short paths in error messages. */
const REPO_ROOT = path.resolve(currentDir, '../../..');

/** Balance coefficients of the damage formula. Field names match the JSON file. */
export type CombatRules = {
  /** Percent of damage gained per point of (attack - defense), e.g. 5 means +5%. */
  attackAdvantagePercentPerPoint: number;
  /** Upper cap of the attack advantage multiplier in percent, e.g. 400 means x4.0. */
  attackAdvantageCapPercent: number;
  /** Percent of damage lost per point of (defense - attack), e.g. 2.5 means -2.5%. */
  defensePenaltyPercentPerPoint: number;
  /** Lower floor of the attack/defense multiplier in percent, e.g. 30 means x0.3 (original HoMM3). */
  defensePenaltyFloorPercent: number;
  /**
   * Chance of the luck effect triggering, in percent, keyed by |luckLevel| ("1".."3").
   * Luck is a CHANCE, not a smooth multiplier: at level 2 there is only a 25% chance
   * that luckPositiveMultiplier / luckNegativeMultiplier is applied at all.
   */
  luckChanceByLevel: Record<string, number>;
  /** Damage multiplier when positive luck triggers, e.g. 1.5 means +50%. */
  luckPositiveMultiplier: number;
  /** Damage multiplier when negative luck triggers, e.g. 0.75 means -25%. */
  luckNegativeMultiplier: number;
  /**
   * Damage multiplier for a hit that happened THANKS to a morale extra attack
   * (context.isMoraleBonusAttack). Morale itself is a turn-order system (extra attack
   * or skipped turn) and does NOT weaken ordinary attacks.
   */
  moraleBonusAttackMultiplier: number;
  /** The smallest amount of damage a hit may ever deal, e.g. 1. */
  minimumDamage: number;
  /**
   * How the stack damage roll is drawn (docs/decisions.md, 015):
   *   "uniform" — one uniform integer roll over the whole stack range
   *               damageMin*stackCount .. damageMax*stackCount (the flat default);
   *   "sampled" — k = min(stackCount, damageRollSamples) independent per-unit rolls,
   *               summed and scaled (docs/decisions.md, 014).
   */
  damageRollMode: 'uniform' | 'sampled';
  /**
   * How many damage rolls are drawn for a stack in "sampled" mode:
   * k = min(stackCount, damageRollSamples). The k rolls are summed and scaled by
   * stackCount/k, so the roll cost stays constant no matter how big the stack is
   * (docs/decisions.md, 014).
   */
  damageRollSamples: number;
};

/** Fields that must exist and must be finite numbers (9 numbers + 1 object = 10 fields in total). */
const NUMBER_FIELDS: ReadonlyArray<keyof CombatRules> = [
  'attackAdvantagePercentPerPoint',
  'attackAdvantageCapPercent',
  'defensePenaltyPercentPerPoint',
  'defensePenaltyFloorPercent',
  'luckPositiveMultiplier',
  'luckNegativeMultiplier',
  'moraleBonusAttackMultiplier',
  'minimumDamage',
  'damageRollSamples',
];

/** Fields that must exist and must be objects of numbers (keyed by |luckLevel|). */
const OBJECT_FIELDS: ReadonlyArray<keyof CombatRules> = ['luckChanceByLevel'];

/** Luck levels that must be present inside the object field (see CombatUnit.luckLevel). */
const REQUIRED_LUCK_LEVELS = ['1', '2', '3'];

/** Short, readable path for messages: config/combat-rules.json instead of C:\...\config\... */
function displayPath(filePath: string): string {
  const relativePath = path.relative(REPO_ROOT, filePath);

  return relativePath.startsWith('..') ? filePath : relativePath.split(path.sep).join('/');
}

/**
 * Reads and validates the rules file.
 *
 * Throws an Error whose message says exactly what is wrong, so the server can
 * fail fast at startup instead of running with half-loaded balance data.
 */
export function loadCombatRules(filePath: string = DEFAULT_COMBAT_RULES_PATH): CombatRules {
  const shownPath = displayPath(filePath);

  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(`${shownPath}: файл не читается (${(error as Error).message})`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${shownPath}: файл не является корректным JSON (${(error as Error).message})`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    const actual = Array.isArray(parsed) ? 'массив' : typeof parsed;
    throw new Error(`${shownPath}: ожидался JSON-объект с настройками, а получено: ${actual}`);
  }

  const source = parsed as Record<string, unknown>;

  for (const field of NUMBER_FIELDS) {
    if (!(field in source)) {
      throw new Error(`${shownPath}: отсутствует обязательное поле ${field}`);
    }

    const value = source[field];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(
        `${shownPath}: поле ${field} должно быть числом, а получено: ${JSON.stringify(value)}`,
      );
    }
  }

  // damageRollSamples needs one extra check: it must be a whole number of samples >= 1,
  // otherwise "k = min(stackCount, samples)" could roll zero times and deal no damage.
  if (!Number.isInteger(source.damageRollSamples) || (source.damageRollSamples as number) < 1) {
    throw new Error(
      `${shownPath}: поле damageRollSamples должно быть целым числом не меньше 1, а получено: ${JSON.stringify(source.damageRollSamples)}`,
    );
  }

  // damageRollMode must be present and be exactly one of the two supported modes.
  if (!('damageRollMode' in source)) {
    throw new Error(`${shownPath}: отсутствует обязательное поле damageRollMode`);
  }
  if (source.damageRollMode !== 'uniform' && source.damageRollMode !== 'sampled') {
    throw new Error(
      `${shownPath}: поле damageRollMode должно быть строкой "uniform" или "sampled", а получено: ${JSON.stringify(source.damageRollMode)}`,
    );
  }

  for (const field of OBJECT_FIELDS) {
    if (!(field in source)) {
      throw new Error(`${shownPath}: отсутствует обязательное поле ${field}`);
    }

    const value = source[field];
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error(
        `${shownPath}: поле ${field} должно быть объектом с числами, а получено: ${JSON.stringify(value)}`,
      );
    }

    const levels = value as Record<string, unknown>;
    for (const level of REQUIRED_LUCK_LEVELS) {
      if (!(level in levels)) {
        throw new Error(`${shownPath}: в поле ${field} отсутствует уровень удачи "${level}"`);
      }
      if (typeof levels[level] !== 'number' || !Number.isFinite(levels[level])) {
        throw new Error(
          `${shownPath}: в поле ${field} значение для уровня "${level}" должно быть числом, а получено: ${JSON.stringify(levels[level])}`,
        );
      }
    }
  }

  // Explicit pick: unknown fields in the JSON are ignored on purpose, so a typo
  // in the file name cannot silently change the formula.
  const luckChances = source.luckChanceByLevel as Record<string, unknown>;

  return {
    attackAdvantagePercentPerPoint: source.attackAdvantagePercentPerPoint as number,
    attackAdvantageCapPercent: source.attackAdvantageCapPercent as number,
    defensePenaltyPercentPerPoint: source.defensePenaltyPercentPerPoint as number,
    defensePenaltyFloorPercent: source.defensePenaltyFloorPercent as number,
    luckChanceByLevel: {
      '1': luckChances['1'] as number,
      '2': luckChances['2'] as number,
      '3': luckChances['3'] as number,
    },
    luckPositiveMultiplier: source.luckPositiveMultiplier as number,
    luckNegativeMultiplier: source.luckNegativeMultiplier as number,
    moraleBonusAttackMultiplier: source.moraleBonusAttackMultiplier as number,
    minimumDamage: source.minimumDamage as number,
    damageRollMode: source.damageRollMode as 'uniform' | 'sampled',
    damageRollSamples: source.damageRollSamples as number,
  };
}

/** In-memory copy of the rules; null until the server (or a test) loads them. */
let currentRules: CombatRules | null = null;

/** Stores the rules loaded at startup. */
export function setCombatRules(rules: CombatRules): void {
  currentRules = rules;
}

/** The rules currently in memory. */
export function getCombatRules(): CombatRules {
  if (currentRules === null) {
    throw new Error(
      'Правила боя не загружены: loadCombatRules()/initCombatRules() должны вызываться один раз при старте сервера (см. server/src/index.ts)',
    );
  }

  return currentRules;
}

/** Loads the rules once and keeps them in memory: the normal startup path. */
export function initCombatRules(filePath: string = DEFAULT_COMBAT_RULES_PATH): CombatRules {
  const rules = loadCombatRules(filePath);
  setCombatRules(rules);

  return rules;
}
