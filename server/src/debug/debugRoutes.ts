/**
 * DEV-TOOL HTTP endpoints for the combat sandbox.
 *
 * This is a developer tool, NOT part of the game: no player authorization, no
 * game state, no protocol messages in /shared. It is mounted with a single line
 * in index.ts; in production it is simply not mounted.
 *
 * // DEV-TOOL: not mounted in production (docs/conventions.md)
 *
 * Why HTTP and not WebSocket: the sandbox is a plain request/response tool
 * ("fill the form -> press the button -> read the breakdown"). HTTP keeps the
 * game protocol clean (WebSocket stays reserved for the real game messages),
 * works with curl for scripted checks and needs no reconnect handling.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express, { type Router } from 'express';

import type { AbilityTag, CombatBonuses, CombatUnit, UnitStats } from '@de-jija/shared';

import { buildCombatant } from '../combat/combatant';
import {
  aggregateHeroModifiers,
  skillAffectsAttackNow,
  type HeroLoadout,
  type HeroModifiers,
} from '../combat/heroModifiers';
import { resolveAttack, type AttackContext } from '../combat/resolveAttack';
import { getSkills } from '../combat/skills';
import { combatFixtures } from '../combat/testFixtures';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

/** The sandbox page: plain HTML, no build step, no PixiJS. */
const SANDBOX_PAGE_PATH = path.resolve(currentDir, '../../debug/combat-sandbox.html');

/** Stats that must be present in a request and must be numbers. */
const STAT_FIELDS = ['hp', 'attack', 'defense', 'speed', 'damageMin', 'damageMax'] as const;

/** Hero stats that must be present in a hero block and must be whole numbers >= 0. */
const HERO_STAT_FIELDS = ['attack', 'defense', 'spellPower', 'knowledge'] as const;

/** Tags the sandbox may send; anything else is dropped instead of trusted. */
const KNOWN_TAGS: readonly AbilityTag[] = [
  'NoRetaliation',
  'AreaAttack',
  'MagicImmune',
  'Piercing',
  'MagicDamage',
];

/**
 * Manual bonus numbers the sandbox may send, split BY ROLE — the same way the heroes
 * are split: attack, offense, luck and damage bonuses come from the attacking side,
 * defense and armor from the defending side. They end up in the combatants'
 * `bonuses` (buildCombatant), not in the attack context.
 */
const ATTACKER_BONUS_FIELDS = [
  'flatDamageBonus',
  'percentDamageBonus',
  'heroAttackBonus',
  'meleeOffenseBonusPercent',
  'rangedOffenseBonusPercent',
  'magicOffenseBonusPercent',
] as const;

/** The same list for the defending side: `heroAttackBonus` is named `attackBonus` there. */
const DEFENDER_BONUS_FIELDS = [
  'heroDefenseBonus',
  'defensiveArmorReductionPercent',
] as const;

/** Maps a manual request field to the bonus field of the combatant. */
const ATTACKER_BONUS_NAMES: Record<(typeof ATTACKER_BONUS_FIELDS)[number], keyof CombatBonuses> =
  {
    flatDamageBonus: 'flatDamageBonus',
    percentDamageBonus: 'percentDamageBonus',
    heroAttackBonus: 'attackBonus',
    meleeOffenseBonusPercent: 'meleeOffenseBonusPercent',
    rangedOffenseBonusPercent: 'rangedOffenseBonusPercent',
    magicOffenseBonusPercent: 'magicOffenseBonusPercent',
  };

const DEFENDER_BONUS_NAMES: Record<(typeof DEFENDER_BONUS_FIELDS)[number], keyof CombatBonuses> = {
  heroDefenseBonus: 'defenseBonus',
  defensiveArmorReductionPercent: 'defensiveArmorReductionPercent',
};

type ParsedRequest = {
  attacker: CombatUnit;
  defender: CombatUnit;
  context: AttackContext;
  /** Manual (non-hero) bonuses of the attacking side, added on top of the hero's ones. */
  attackerBonuses: Partial<CombatBonuses>;
  /** Manual (non-hero) bonuses of the defending side. */
  defenderBonuses: Partial<CombatBonuses>;
  /** Optional hero blocks (docs/decisions.md, 016); absent means "no hero". */
  attackerHero?: HeroLoadout;
  defenderHero?: HeroLoadout;
};
type ParseError = { error: string };

/** Reads one unit sent by the sandbox form. Returns a readable error instead of throwing. */
function parseUnit(value: unknown, role: string): { unit: CombatUnit } | ParseError {
  if (typeof value !== 'object' || value === null) {
    return { error: `${role}: ожидался объект с полями юнита` };
  }

  const raw = value as Record<string, unknown>;
  const rawStats = raw.stats;

  if (typeof rawStats !== 'object' || rawStats === null) {
    return { error: `${role}: отсутствует объект stats` };
  }

  const statsSource = rawStats as Record<string, unknown>;
  const stats: UnitStats = { hp: 0, attack: 0, defense: 0, speed: 0, damageMin: 0, damageMax: 0 };

  for (const field of STAT_FIELDS) {
    const fieldValue = statsSource[field];

    if (typeof fieldValue !== 'number' || !Number.isFinite(fieldValue)) {
      return { error: `${role}.stats.${field}: ожидалось число` };
    }

    stats[field] = fieldValue;
  }

  const tags = Array.isArray(raw.tags)
    ? raw.tags.filter((tag): tag is AbilityTag => KNOWN_TAGS.includes(tag as AbilityTag))
    : [];

  const stackCount =
    typeof raw.stackCount === 'number' && raw.stackCount >= 1 ? Math.trunc(raw.stackCount) : 1;

  const currentHp =
    typeof raw.currentHp === 'number' && Number.isFinite(raw.currentHp) ? raw.currentHp : stats.hp;

  // Luck level: -3..3, 0 by default (resolveAttack clamps it anyway).
  const luckLevel =
    typeof raw.luckLevel === 'number' && Number.isFinite(raw.luckLevel)
      ? Math.max(-3, Math.min(3, Math.trunc(raw.luckLevel)))
      : 0;

  return {
    unit: {
      id: typeof raw.id === 'string' ? raw.id : role,
      name: typeof raw.name === 'string' ? raw.name : role,
      stats,
      tags,
      currentHp,
      stackCount,
      luckLevel,
    },
  };
}

/**
 * Reads the hit context (what THIS strike is) and the manual bonus numbers, which
 * are returned separately BY ROLE and later become the combatants' `bonuses`.
 * Unknown or non-numeric values are ignored.
 */
function parseContext(value: unknown): {
  context: AttackContext;
  attackerBonuses: Partial<CombatBonuses>;
  defenderBonuses: Partial<CombatBonuses>;
} {
  const attackerBonuses: Partial<CombatBonuses> = {};
  const defenderBonuses: Partial<CombatBonuses> = {};

  if (typeof value === 'object' && value !== null) {
    const raw = value as Record<string, unknown>;

    const readBonus = (field: string): number | undefined =>
      typeof raw[field] === 'number' && Number.isFinite(raw[field] as number) &&
        raw[field] !== 0
        ? (raw[field] as number)
        : undefined;

    for (const field of ATTACKER_BONUS_FIELDS) {
      const bonus = readBonus(field);

      if (bonus !== undefined) {
        attackerBonuses[ATTACKER_BONUS_NAMES[field]] = bonus;
      }
    }
    for (const field of DEFENDER_BONUS_FIELDS) {
      const bonus = readBonus(field);

      if (bonus !== undefined) {
        defenderBonuses[DEFENDER_BONUS_NAMES[field]] = bonus;
      }
    }
  }

  const context: AttackContext = {};
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;

  // Zero used to be treated as "not sent" by the old parser — keep that contract.
  if (typeof raw.fixedLuckRoll === 'number' && Number.isFinite(raw.fixedLuckRoll) && raw.fixedLuckRoll !== 0) {
    context.fixedLuckRoll = raw.fixedLuckRoll;
  }

  if (raw.attackKind === 'melee' || raw.attackKind === 'ranged') {
    context.attackKind = raw.attackKind;
  }

  if (raw.isMoraleBonusAttack === true) {
    context.isMoraleBonusAttack = true;
  }
  if (raw.isRetaliation === true) {
    context.isRetaliation = true;
  }

  // Handy for checking the arithmetic by hand: freeze the random roll.
  const fixedRoll = raw.fixedRandomValue;
  if (typeof fixedRoll === 'number' && fixedRoll >= 0 && fixedRoll < 1) {
    context.random = () => fixedRoll;
  }

  return { context, attackerBonuses, defenderBonuses };
}

/**
 * Reads an optional hero block (HeroLoadout). Deep validation (unknown skill, repeat,
 * level, stat range) is done by aggregateHeroModifiers, whose readable errors the route
 * turns into HTTP 400 (docs/decisions.md, 016).
 */
function parseHero(value: unknown, role: string): { loadout: HeroLoadout } | ParseError {
  if (typeof value !== 'object' || value === null) {
    return { error: `${role}: ожидался объект-герой (HeroLoadout)` };
  }

  const raw = value as Record<string, unknown>;
  const rawStats = raw.stats;

  if (typeof rawStats !== 'object' || rawStats === null) {
    return { error: `${role}: отсутствует объект stats у героя` };
  }

  const statsSource = rawStats as Record<string, unknown>;
  const stats: HeroLoadout['stats'] = { attack: 0, defense: 0, spellPower: 0, knowledge: 0 };

  for (const field of HERO_STAT_FIELDS) {
    const fieldValue = statsSource[field];

    if (typeof fieldValue !== 'number' || !Number.isInteger(fieldValue) || fieldValue < 0) {
      return { error: `${role}.stats.${field}: ожидалось целое число не меньше 0` };
    }

    stats[field] = fieldValue;
  }

  const rawSkills = Array.isArray(raw.skills) ? raw.skills : [];
  const skills = rawSkills.map((slot) => {
    const slotRaw = (typeof slot === 'object' && slot !== null ? slot : {}) as Record<
      string,
      unknown
    >;

    return {
      skillId: typeof slotRaw.skillId === 'string' ? slotRaw.skillId : '',
      level: (typeof slotRaw.level === 'number' ? slotRaw.level : 0) as 1 | 2 | 3,
    };
  });

  return { loadout: { stats, skills } };
}

/** Validates the whole sandbox request body. */
function parseRequestBody(body: unknown): ParsedRequest | ParseError {
  if (typeof body !== 'object' || body === null) {
    return { error: 'тело запроса должно быть JSON-объектом' };
  }

  const raw = body as Record<string, unknown>;
  const attacker = parseUnit(raw.attacker, 'attacker');
  if ('error' in attacker) {
    return attacker;
  }

  const defender = parseUnit(raw.defender, 'defender');
  if ('error' in defender) {
    return defender;
  }

  const attackerHero =
    raw.attackerHero === undefined ? null : parseHero(raw.attackerHero, 'attackerHero');
  if (attackerHero && 'error' in attackerHero) {
    return attackerHero;
  }

  const defenderHero =
    raw.defenderHero === undefined ? null : parseHero(raw.defenderHero, 'defenderHero');
  if (defenderHero && 'error' in defenderHero) {
    return defenderHero;
  }

  const hit = parseContext(raw.context);

  return {
    attacker: attacker.unit,
    defender: defender.unit,
    context: hit.context,
    attackerBonuses: hit.attackerBonuses,
    defenderBonuses: hit.defenderBonuses,
    attackerHero: attackerHero ? attackerHero.loadout : undefined,
    defenderHero: defenderHero ? defenderHero.loadout : undefined,
  };
}

/** Builds the debug router. Mounted at /debug in index.ts. */
export function createDebugRouter(): Router {
  const router = express.Router();

  // Only the debug router parses JSON bodies: the game routes stay untouched.
  router.use(express.json({ limit: '64kb' }));

  // The sandbox page itself.
  router.get('/combat-sandbox', (_request, response) => {
    response.sendFile(SANDBOX_PAGE_PATH);
  });

  // Preset units for the sandbox dropdown: the very same fixtures the unit tests use,
  // so the presets can never drift away from the tested numbers.
  router.get('/fixtures', (_request, response) => {
    response.json(combatFixtures);
  });

  // The skill list for the hero panels: id, Russian name, the three level descriptions and
  // whether the skill actually reaches resolveAttack today. The "affectsAttackNow" flag is
  // computed HERE, on the server, so the browser never keeps its own copy of the target list.
  router.get('/heroes', (_request, response) => {
    const skills = getSkills();

    response.json(
      skills.skills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        levels: skill.levels,
        affectsAttackNow: skillAffectsAttackNow(skill),
      })),
    );
  });

  // Resolves one attack and returns the full breakdown: the tool behind the page.
  router.post('/attack', (request, response) => {
    const parsed = parseRequestBody(request.body);

    if ('error' in parsed) {
      response.status(400).json({ error: parsed.error });
      return;
    }

    // The combatants are built HERE, once per request: the hero (stats + skills) and
    // the manual bonus numbers of the sandbox are merged into each combatant's
    // `bonuses` (docs/decisions.md, 018). resolveAttack then only reads them.
    const context = parsed.context;
    let attackerCombatant = buildCombatant(
      parsed.attacker,
      null,
      parsed.attackerBonuses,
    );
    let defenderCombatant = buildCombatant(
      parsed.defender,
      null,
      parsed.defenderBonuses,
    );
    let aggregatedModifiers: { attacker: HeroModifiers; defender: HeroModifiers } | undefined;

    // Optional hero blocks: a hero without a block simply means "no hero" (all zeros).
    if (parsed.attackerHero || parsed.defenderHero) {
      try {
        const skills = getSkills();
        const attackerMods = aggregateHeroModifiers(parsed.attackerHero, skills);
        const defenderMods = aggregateHeroModifiers(parsed.defenderHero, skills);

        attackerCombatant = buildCombatant(
          parsed.attacker,
          attackerMods,
          parsed.attackerBonuses,
        );
        defenderCombatant = buildCombatant(
          parsed.defender,
          defenderMods,
          parsed.defenderBonuses,
        );
        aggregatedModifiers = { attacker: attackerMods, defender: defenderMods };
      } catch (error) {
        response
          .status(400)
          .json({ error: error instanceof Error ? error.message : String(error) });
        return;
      }
    }

    console.log(
      `[debug] attack: ${attackerCombatant.name} (${attackerCombatant.tags.join(', ') || 'no tags'}) -> ${defenderCombatant.name}`,
    );

    const result = resolveAttack(attackerCombatant, defenderCombatant, context);

    response.json(aggregatedModifiers ? { ...result, aggregatedModifiers } : result);
  });

  return router;
}
