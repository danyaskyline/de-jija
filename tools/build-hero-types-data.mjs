/**
 * Builds config/hero-types.json from the author's "hero types" sheet.
 *
 * Same idea as tools/build-units-data.mjs: the spreadsheet is the source, this
 * script turns it into our own JSON so the server reads validated data.
 *
 * Source layout (the second half of the author's skills sheet):
 *   row 14      - header: Тип героя, then one column per skill
 *   row 15      - "Фракция «Хорошие»"
 *   rows 16-21  - six heroes of that faction
 *   row 22      - "Фракция «Нейтралы»"
 *   rows 23-28  - six heroes
 *   row 29      - "Фракция «Плохие»"
 *   rows 30-35  - six heroes
 *
 * Each price cell is "basic/advanced/expert" in some skill point currency, e.g.
 * "10/18/34". An empty cell means the hero does not learn that skill at all.
 *
 * Run from the repo root:
 *   node tools/build-hero-types-data.mjs "C:\path\fackU - naviki.csv"
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_CSV = 'C:/Users/janud/Downloads/fackU - naviki.csv';
const OUTPUT = path.resolve(process.cwd(), 'config/hero-types.json');

const HEADER_ROW = 14;

const FACTION_SECTIONS = [
  { markerRow: 15, group: 'good', firstHeroRow: 16 },
  { markerRow: 22, group: 'neutral', firstHeroRow: 23 },
  { markerRow: 29, group: 'evil', firstHeroRow: 30 },
];

const GROUP_NAMES = {
  good: 'Хорошие',
  neutral: 'Нейтралы',
  evil: 'Плохие',
};

function slugify(name) {
  const map = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
    и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
    с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh',
    щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  };

  let out = '';

  for (const char of name.toLowerCase()) {
    out += /[a-z0-9]/.test(char) ? char : (map[char] ?? '_');
  }

  return out.replace(/_+/g, '_').replace(/^_|_$/g, '');
}

/** Skill name from the sheet header -> the id used in config/skills.json. */
const SKILL_IDS = {
  'Волшебство': 'sorcery',
  'Доспехи': 'armorer',
  'Лидерство': 'leadership',
  'Магия Воды': 'water_magic',
  'Магия Воздуха': 'air_magic',
  'Магия Земли': 'earth_magic',
  'Магия Огня': 'fire_magic',
  'Нападение': 'offense',
  'Сопротивление': 'resistance',
  'Стрельба': 'archery',
  'Тактика': 'tactics',
  'Удача': 'luck',
};

/** "10/18/34" -> [10, 18, 34]; "" -> null (the hero does not learn it). */
function parsePrices(cell, heroName, skillName) {
  const trimmed = cell.trim();

  if (trimmed === '') {
    return null;
  }

  const parts = trimmed.split('/');

  if (parts.length !== 3) {
    throw new Error(
      'герой "' + heroName + '", навык "' + skillName + '": ожидалось три числа, получено "' + trimmed + '"',
    );
  }

  const prices = parts.map((p) => {
    const value = Number(p);

    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(
        'герой "' + heroName + '", навык "' + skillName + '": цена не число: "' + p + '"',
      );
    }

    return value;
  });

  if (prices[0] > prices[1] || prices[1] > prices[2]) {
    throw new Error(
      'герой "' + heroName + '", навык "' + skillName + '": цены должны расти по уровням, получено ' + trimmed,
    );
  }

  return prices;
}

function main() {
  const csvPath = process.argv[2] ?? DEFAULT_CSV;
  const lines = readFileSync(csvPath, 'utf8').split(/\r?\n/);

  // The header row tells us the skill order, so we never hardcode the column count.
  const headerCells = (lines[HEADER_ROW] ?? '').split(',').map((c) => c.trim());
  const skillNames = headerCells.slice(1).filter((c) => c !== '');

  if (skillNames.length === 0) {
    throw new Error('строка ' + HEADER_ROW + ': в шапке не найдено ни одного навыка');
  }

  for (const name of skillNames) {
    if (!SKILL_IDS[name]) {
      throw new Error('навык из шапки "' + name + '" не сопоставлен с id из config/skills.json');
    }
  }

  const heroes = [];
  const seenIds = new Map();

  for (const section of FACTION_SECTIONS) {
    const marker = lines[section.markerRow] ?? '';

    if (!marker.includes('Фракция')) {
      throw new Error('строка ' + section.markerRow + ': ожидалась метка «Фракция ...», получено: ' + marker.trim());
    }

    for (let i = 0; i < 6; i += 1) {
      const row = section.firstHeroRow + i;
      const line = lines[row];

      if (line === undefined) {
        throw new Error('строка ' + row + ' отсутствует в выгрузке');
      }

      const cells = line.split(',').map((c) => c.trim());
      const name = cells[0];

      if (name === '') {
        throw new Error('строка ' + row + ': пустое имя героя');
      }

      const prices = cells.slice(1).filter((c) => c !== '');

      if (prices.length !== skillNames.length) {
        throw new Error(
          'строка ' + row + ' (герой "' + name + '"): ожидалось ' + skillNames.length +
            ' цен навыков, получено ' + prices.length,
        );
      }

      const id = slugify(name);

      if (seenIds.has(id)) {
        throw new Error('повторяющийся id героя: ' + id);
      }

      seenIds.set(id, name);

      const skills = {};

      skillNames.forEach((skillName, index) => {
        const parsed = parsePrices(prices[index], name, skillName);

        if (parsed) {
          skills[SKILL_IDS[skillName]] = parsed;
        }
      });

      heroes.push({
        id,
        name,
        group: section.group,
        groupNameRu: GROUP_NAMES[section.group],
        /** price per skill level: [basic, advanced, expert]; absent = not learnable. */
        skills,
      });
    }
  }

  const output = {
    $comment:
      'Generated by tools/build-hero-types-data.mjs from the author table. Edit the ' +
      'table and regenerate; do not edit this file. Skill ids match ' +
      'config/skills.json. A skill missing from a hero means "not learnable", not "free".',
    heroCount: heroes.length,
    skillCount: skillNames.length,
    skillIds: skillNames.map((n) => SKILL_IDS[n]),
    groups: Object.entries(GROUP_NAMES).map(([id, nameRu]) => ({ id, nameRu })),
    heroes,
  };

  writeFileSync(OUTPUT, JSON.stringify(output, null, 2) + '\n', 'utf8');

  console.log('Wrote ' + OUTPUT);
  console.log('Heroes: ' + heroes.length + ', skills per hero: ' + skillNames.length);
}

main();
