/**
 * Hero skill data — loaded from config/skills.json.
 *
 * Skills are DATA, not code (docs/conventions.md, "Данные vs код"): adding a skill
 * is adding a JSON entry. The file is read ONCE at server startup (see
 * server/src/index.ts) and kept in memory; resolveAttack / heroModifiers never touch
 * the file themselves (docs/decisions.md, 012 and 016).
 *
 * The file is edited by hand and versioned in git — no DB, no hot reload.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

/** <repo root>/config/skills.json — server/src/combat is three levels deep. */
export const DEFAULT_SKILLS_PATH = path.resolve(currentDir, '../../../config/skills.json');

/** Repo root, used only to print short paths in error messages. */
const REPO_ROOT = path.resolve(currentDir, '../../..');

/**
 * The numeric effects a skill may carry. Only four of them feed resolveAttack right
 * now (meleeOffenseBonusPercent, rangedOffenseBonusPercent, defensiveArmorReductionPercent,
 * luckLevel); the rest are stored as data and reported as "not applied yet"
 * (docs/decisions.md, 016).
 */
export type SkillTarget =
  | 'meleeOffenseBonusPercent'
  | 'rangedOffenseBonusPercent'
  | 'defensiveArmorReductionPercent'
  | 'luckLevel'
  | 'moraleLevel'
  | 'tacticsRows'
  | 'spellDamagePercent'
  | 'magicResistancePercent';

/** Every target a skill entry is allowed to name. Anything else fails the load. */
export const SKILL_TARGETS: readonly SkillTarget[] = [
  'meleeOffenseBonusPercent',
  'rangedOffenseBonusPercent',
  'defensiveArmorReductionPercent',
  'luckLevel',
  'moraleLevel',
  'tacticsRows',
  'spellDamagePercent',
  'magicResistancePercent',
];

/** One numeric effect of a skill: a target and its value at levels 1 / 2 / 3. */
export type SkillEffect = {
  target: SkillTarget;
  /** [basic, advanced, expert] — index 0 is level 1. */
  perLevel: [number, number, number];
};

/** A single hero skill (data only — no behaviour lives here). */
export type Skill = {
  /** Latin id, referenced by HeroLoadout.skills[].skillId. */
  id: string;
  /** Russian display name ("Нападение", "Магия Воды", ...). */
  name: string;
  /** Russian descriptions of the three levels: [basic, advanced, expert]. */
  levels: [string, string, string];
  /** Numeric effects. Empty for skills with no numbers yet (the four magic schools). */
  effects: SkillEffect[];
};

/** The whole file: a list of skills. */
export type SkillsData = {
  skills: Skill[];
};

/** Short, readable path for messages: config/skills.json instead of C:\...\config\... */
function displayPath(filePath: string): string {
  const relativePath = path.relative(REPO_ROOT, filePath);

  return relativePath.startsWith('..') ? filePath : relativePath.split(path.sep).join('/');
}

/** Finds a skill by id, or undefined. */
export function findSkill(skillsData: SkillsData, skillId: string): Skill | undefined {
  return skillsData.skills.find((skill) => skill.id === skillId);
}

/**
 * Reads and validates the skills file.
 *
 * Throws an Error whose message says exactly what is wrong, so the server can fail
 * fast at startup instead of running with half-loaded skill data.
 */
export function loadSkills(filePath: string = DEFAULT_SKILLS_PATH): SkillsData {
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

  if (!('skills' in source)) {
    throw new Error(`${shownPath}: отсутствует обязательное поле skills`);
  }
  if (!Array.isArray(source.skills)) {
    throw new Error(
      `${shownPath}: поле skills должно быть массивом навыков, а получено: ${JSON.stringify(source.skills)}`,
    );
  }

  const skills = source.skills.map((entry, index) => parseSkill(entry, index, shownPath));

  const seenIds = new Set<string>();
  for (const skill of skills) {
    if (seenIds.has(skill.id)) {
      throw new Error(`${shownPath}: навык с id "${skill.id}" объявлен дважды`);
    }
    seenIds.add(skill.id);
  }

  return { skills };
}

/** Validates one skill entry; `index` is used only to point at a readable position. */
function parseSkill(entry: unknown, index: number, shownPath: string): Skill {
  const where = `навык №${index + 1}`;

  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    throw new Error(`${shownPath}: ${where} должен быть JSON-объектом`);
  }

  const raw = entry as Record<string, unknown>;

  if (typeof raw.id !== 'string' || raw.id.length === 0) {
    throw new Error(`${shownPath}: ${where}: поле id должно быть непустой строкой (латиницей)`);
  }
  const id = raw.id;

  if (typeof raw.name !== 'string' || raw.name.length === 0) {
    throw new Error(`${shownPath}: ${where} ("${id}"): поле name должно быть непустой строкой`);
  }

  const levels = parseLevels(raw.levels, id, shownPath);
  const effects = parseEffects(raw.effects, id, shownPath);

  return { id, name: raw.name, levels, effects };
}

/** The three Russian level descriptions: [basic, advanced, expert]. */
function parseLevels(value: unknown, id: string, shownPath: string): [string, string, string] {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error(
      `${shownPath}: навык "${id}": поле levels должно быть массивом из трёх описаний (начальный/продвинутый/экспертный)`,
    );
  }

  for (const [position, text] of value.entries()) {
    if (typeof text !== 'string' || text.length === 0) {
      throw new Error(
        `${shownPath}: навык "${id}": описание уровня ${position + 1} должно быть непустой строкой`,
      );
    }
  }

  return [value[0] as string, value[1] as string, value[2] as string];
}

/** The numeric effects of a skill (an empty array is allowed). */
function parseEffects(value: unknown, id: string, shownPath: string): SkillEffect[] {
  if (!Array.isArray(value)) {
    throw new Error(
      `${shownPath}: навык "${id}": поле effects должно быть массивом (может быть пустым)`,
    );
  }

  return value.map((effect, index) => {
    if (typeof effect !== 'object' || effect === null || Array.isArray(effect)) {
      throw new Error(
        `${shownPath}: навык "${id}": эффект №${index + 1} должен быть JSON-объектом`,
      );
    }

    const raw = effect as Record<string, unknown>;

    if (typeof raw.target !== 'string' || !SKILL_TARGETS.includes(raw.target as SkillTarget)) {
      throw new Error(
        `${shownPath}: навык "${id}": неизвестный target ${JSON.stringify(raw.target)} (допустимо: ${SKILL_TARGETS.join(', ')})`,
      );
    }

    const perLevel = parsePerLevel(raw.perLevel, id, raw.target);

    return { target: raw.target as SkillTarget, perLevel };
  });
}

/** The [basic, advanced, expert] trio of numbers. */
function parsePerLevel(value: unknown, id: string, target: string): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error(
      `config/skills.json: навык "${id}": perLevel для ${target} должен быть массивом из трёх чисел`,
    );
  }

  for (const [position, numberValue] of value.entries()) {
    if (typeof numberValue !== 'number' || !Number.isFinite(numberValue)) {
      throw new Error(
        `config/skills.json: навык "${id}": perLevel для ${target}, значение уровня ${position + 1} должно быть числом`,
      );
    }
  }

  return [value[0] as number, value[1] as number, value[2] as number];
}

/** In-memory copy of the skills; null until the server (or a test) loads them. */
let currentSkills: SkillsData | null = null;

/** Stores the skills loaded at startup. */
export function setSkills(skillsData: SkillsData): void {
  currentSkills = skillsData;
}

/** The skills currently in memory. */
export function getSkills(): SkillsData {
  if (currentSkills === null) {
    throw new Error(
      'Данные навыков не загружены: loadSkills()/initSkills() должны вызываться один раз при старте сервера (см. server/src/index.ts)',
    );
  }

  return currentSkills;
}

/** Loads the skills once and keeps them in memory: the normal startup path. */
export function initSkills(filePath: string = DEFAULT_SKILLS_PATH): SkillsData {
  const skillsData = loadSkills(filePath);
  setSkills(skillsData);

  return skillsData;
}
