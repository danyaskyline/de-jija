/**
 * Battle field rules — loaded from config/battle-rules.json.
 *
 * This is a SEPARATE file from combat-rules.json on purpose: the damage
 * formula and the size of the battlefield are different kinds of balance and
 * are tuned by different people at different times (docs/battle.md, 019).
 *
 * The file is read ONCE at server startup (see server/src/index.ts) and kept in
 * memory, exactly like the combat rules (docs/decisions.md, 012). Battle reads
 * the values from memory and never touches the file itself.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

/** <repo root>/config/battle-rules.json — server/src/battle is three levels deep. */
export const DEFAULT_BATTLE_RULES_PATH = path.resolve(
  currentDir,
  '../../../config/battle-rules.json',
);

/** Repo root, used only to print short paths in error messages. */
const REPO_ROOT = path.resolve(currentDir, '../../..');

/** The battlefield itself (docs/battle.md, section 12). */
export type BattleRules = {
  /** How many columns the field has. */
  fieldWidth: number;
  /** How many rows the field has. */
  fieldHeight: number;
  /** Maximum number of unit stacks on ONE side. */
  maxUnitsPerSide: number;
  /** Width of the starting zone, in columns, at each edge of the field. */
  startZoneWidth: number;
};

/** Fields that must exist, be whole numbers and be at least 1. */
const NUMBER_FIELDS: ReadonlyArray<keyof BattleRules> = [
  'fieldWidth',
  'fieldHeight',
  'maxUnitsPerSide',
  'startZoneWidth',
];

/** Short, readable path for messages: config/battle-rules.json instead of C:\... */
function displayPath(filePath: string): string {
  const relativePath = path.relative(REPO_ROOT, filePath);

  return relativePath.startsWith('..') ? filePath : relativePath.split(path.sep).join('/');
}

/** Builds the parsed-and-checked rules; throws with a readable Russian message. */
export function parseBattleRules(source: Record<string, unknown>, shownPath: string): BattleRules {
  for (const field of NUMBER_FIELDS) {
    if (!(field in source)) {
      throw new Error(`${shownPath}: отсутствует обязательное поле ${field}`);
    }

    const value = source[field];

    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
      throw new Error(
        `${shownPath}: поле ${field} должно быть целым числом не меньше 1, а получено: ${JSON.stringify(value)}`,
      );
    }
  }

  // A start zone wider than half the field would make the two zones overlap,
  // and the two sides could then be placed on top of each other.
  const startZoneWidth = source.startZoneWidth as number;
  const fieldWidth = source.fieldWidth as number;

  if (startZoneWidth * 2 > fieldWidth) {
    throw new Error(
      `${shownPath}: поле startZoneWidth (${startZoneWidth}) не может быть больше половины fieldWidth (${fieldWidth}): зоны старта двух сторон не должны пересекаться`,
    );
  }

  // Explicit pick: unknown fields in the JSON are ignored on purpose, so a typo
  // in the file cannot silently change the battlefield.
  return {
    fieldWidth,
    fieldHeight: source.fieldHeight as number,
    maxUnitsPerSide: source.maxUnitsPerSide as number,
    startZoneWidth,
  };
}

/**
 * Reads and validates the battlefield rules file.
 *
 * Throws an Error whose message says exactly what is wrong, so the server can
 * fail fast at startup instead of starting with a broken field.
 */
export function loadBattleRules(filePath: string = DEFAULT_BATTLE_RULES_PATH): BattleRules {
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

  return parseBattleRules(parsed as Record<string, unknown>, shownPath);
}

/** In-memory copy of the rules; null until the server (or a test) loads them. */
let currentRules: BattleRules | null = null;

/** Stores the rules loaded at startup. */
export function setBattleRules(rules: BattleRules): void {
  currentRules = rules;
}

/** The battlefield rules currently in memory. */
export function getBattleRules(): BattleRules {
  if (currentRules === null) {
    throw new Error(
      'Правила поля боя не загружены: loadBattleRules()/initBattleRules() должны вызываться один раз при старте сервера (см. server/src/index.ts)',
    );
  }

  return currentRules;
}

/** Loads the rules once and keeps them in memory: the normal startup path. */
export function initBattleRules(filePath: string = DEFAULT_BATTLE_RULES_PATH): BattleRules {
  const rules = loadBattleRules(filePath);
  setBattleRules(rules);

  return rules;
}