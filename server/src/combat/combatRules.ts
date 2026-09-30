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
  /** Lower floor of the attack/defense multiplier in percent, e.g. 80 means x0.8. */
  defensePenaltyFloorPercent: number;
  /** Reserved switch: true = magic resist is a percent reduction (implemented),
   *  false = a future binary resist (NOT implemented yet). */
  magicResistIsPercentReduction: boolean;
  /** Morale penalty multiplier used when isMoralePenalized is true, e.g. 0.9 = -10%. */
  moralePenaltyMultiplier: number;
  /** The smallest amount of damage a hit may ever deal, e.g. 1. */
  minimumDamage: number;
};

/** Fields that must exist and must be finite numbers (6 numbers + 1 boolean = 7 fields in total). */
const NUMBER_FIELDS: ReadonlyArray<keyof CombatRules> = [
  'attackAdvantagePercentPerPoint',
  'attackAdvantageCapPercent',
  'defensePenaltyPercentPerPoint',
  'defensePenaltyFloorPercent',
  'moralePenaltyMultiplier',
  'minimumDamage',
];

/** Fields that must exist and must be booleans. */
const BOOLEAN_FIELDS: ReadonlyArray<keyof CombatRules> = ['magicResistIsPercentReduction'];

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

  for (const field of BOOLEAN_FIELDS) {
    if (!(field in source)) {
      throw new Error(`${shownPath}: отсутствует обязательное поле ${field}`);
    }

    const value = source[field];
    if (typeof value !== 'boolean') {
      throw new Error(
        `${shownPath}: поле ${field} должно быть true или false, а получено: ${JSON.stringify(value)}`,
      );
    }
  }

  // Explicit pick: unknown fields in the JSON are ignored on purpose, so a typo
  // in the file name cannot silently change the formula.
  return {
    attackAdvantagePercentPerPoint: source.attackAdvantagePercentPerPoint as number,
    attackAdvantageCapPercent: source.attackAdvantageCapPercent as number,
    defensePenaltyPercentPerPoint: source.defensePenaltyPercentPerPoint as number,
    defensePenaltyFloorPercent: source.defensePenaltyFloorPercent as number,
    magicResistIsPercentReduction: source.magicResistIsPercentReduction as boolean,
    moralePenaltyMultiplier: source.moralePenaltyMultiplier as number,
    minimumDamage: source.minimumDamage as number,
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
