/**
 * Builds config/units.json from the author's spreadsheet export.
 *
 * ONE-TIME GENERATOR, not part of the running server. It reads the CSV the
 * author downloaded from Google Sheets and writes our own JSON data file.
 *
 * Source format - one cell per unit, fields separated by a backslash:
 *   Name \ Attack \ Defense \ Shots \ Min-Max \ HP \ Speed \ Charisma \
 *   Ratio \ PackSize \ Description
 *
 * Run from the repo root:
 *   node tools/build-units-data.mjs "C:\path\fackU - units.csv"
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_CSV = 'C:/Users/janud/Downloads/fackU - units.csv';
const OUTPUT = path.resolve(process.cwd(), 'config/units.json');

const ROW_GROUPS = [
  { row: 19, group: 'light', faction: 'castle' },
  { row: 20, group: 'light', faction: 'stronghold' },
  { row: 21, group: 'light', faction: 'tower' },
  { row: 22, group: 'neutral', faction: 'citadel' },
  { row: 24, group: 'neutral', faction: 'conjunction' },
  { row: 25, group: 'dark', faction: 'inferno' },
  { row: 26, group: 'dark', faction: 'necropolis' },
  { row: 27, group: 'dark', faction: 'dungeon' },
];

const SKIPPED = [
  { row: 23, faction: 'fortress', reason: 'duplicates the citadel row in the source table' },
];

const SUPPORTED_TAGS = ['NoRetaliation', 'MagicImmune', 'MagicDamage'];

const FACTION_NAMES = {
  castle: 'Замок',
  stronghold: 'Оплот',
  tower: 'Башня',
  citadel: 'Цитадель',
  fortress: 'Крепость',
  conjunction: 'Сопряжение',
  inferno: 'Инферно',
  necropolis: 'Некрополис',
  dungeon: 'Темница',
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

function quotedCells(line) {
  const cells = [];

  for (const m of line.matchAll(/"((?:[^"]|"")*)"/g)) {
    cells.push(m[1].replace(/""/g, '"'));
  }

  return cells;
}

function num(value, label, context) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(context + ': field "' + label + '" is not a number: ' + value);
  }

  return parsed;
}

/** Parses one spreadsheet cell into a unit record. Throws on a malformed cell. */
function parseUnit(raw, context) {
  const fields = raw.split('\\');

  if (fields.length < 10) {
    throw new Error(
      context + ': expected at least 10 fields, got ' + fields.length + ': ' + raw,
    );
  }

  const name = fields[0];
  const description = fields.slice(10).join('\\').trim();
  const damageParts = fields[4].split('-');
  const where = context + ' (unit "' + name + '")';

  const damageMin = num(damageParts[0], 'min damage', where);
  const damageMax = num(damageParts[1], 'max damage', where);

  // "-" means "no ranged shots", not zero: the key is simply absent.
  const shots = fields[3];
  const hasShots = shots !== '-' && Number(shots) > 0;

  // Retaliation count comes from the description - the sheet has no column
  // for it. "they answer all attacks" = unlimited, "two attacks per round" = 2.
  let retaliationsPerRound;

  if (/отвечают на все атаки/i.test(description)) {
    retaliationsPerRound = 'unlimited';
  } else if (/две атаки за раунд/i.test(description)) {
    retaliationsPerRound = 2;
  }

  // Only abilities the engine really applies become tags. Everything else stays
  // in the description, so the UI can say "not applied" honestly instead of
  // pretending a unit has a power it does not have (ADR 027).
  const tags = [];

  if (/не может ответить|противник не отвечает|не отвечает на атаку/i.test(description)) {
    tags.push('NoRetaliation');
  }

  if (/иммунитет.*маги|иммунн.*магии|отразить магию/i.test(description)) {
    tags.push('MagicImmune');
  }

  const unit = {
    id: slugify(name),
    name,
    stats: {
      hp: num(fields[5], 'hp', where),
      attack: num(fields[1], 'attack', where),
      defense: num(fields[2], 'defense', where),
      speed: num(fields[6], 'speed', where),
      damageMin,
      damageMax,
    },
    charisma: num(fields[7], 'charisma', where),
    charismaRatio: num(fields[8].replace(',', '.'), 'ratio', where),
    packSize: num(fields[9], 'pack size', where),
  };

  if (hasShots) {
    unit.shots = num(shots, 'shots', where);
  }

  if (retaliationsPerRound !== undefined) {
    unit.retaliationsPerRound = retaliationsPerRound;
  }

  if (tags.length > 0) {
    unit.tags = tags;
  }

  if (description && description !== '-') {
    unit.description = description;
  }

  return unit;
}

function main() {
  const csvPath = process.argv[2] ?? DEFAULT_CSV;
  const lines = readFileSync(csvPath, 'utf8').split(/\r?\n/);

  const races = [];
  const units = [];
  const seenIds = new Map();

  for (const entry of ROW_GROUPS) {
    const line = lines[entry.row];

    if (line === undefined) {
      throw new Error('row ' + entry.row + ' is missing from the export');
    }

    const cells = quotedCells(line);

    if (cells.length !== 14) {
      throw new Error(
        'row ' + entry.row + ' (' + entry.faction + '): expected 14 units, got ' + cells.length,
      );
    }

    races.push({
      id: entry.faction,
      group: entry.group,
      nameRu: FACTION_NAMES[entry.faction] ?? entry.faction,
      unitCount: cells.length,
    });

    cells.forEach((cell, index) => {
      const unit = parseUnit(cell, 'row ' + entry.row + ', unit ' + (index + 1));
      const clash = seenIds.get(unit.id);

      if (clash) {
        throw new Error(
          'row ' + entry.row + ', unit ' + (index + 1) + ': id "' + unit.id +
            '" is already taken by "' + clash + '"',
        );
      }

      seenIds.set(unit.id, unit.name);
      unit.raceId = entry.faction;
      units.push(unit);
    });
  }

  const output = {
    $comment:
      'Generated by tools/build-units-data.mjs from the author table. Edit the ' +
      'table and regenerate; do not edit this file. Abilities the engine does ' +
      'not understand stay in description and are NOT applied in battle - ' +
      'see docs/game-design.md and ADR 027.',
    unitCount: units.length,
    raceCount: races.length,
    supportedTags: SUPPORTED_TAGS,
    skippedRows: SKIPPED,
    races,
    units,
  };

  writeFileSync(OUTPUT, JSON.stringify(output, null, 2) + '\n', 'utf8');

  console.log('Wrote ' + OUTPUT);
  console.log(
    'Units: ' + units.length + ', factions: ' + races.length +
      ', skipped rows: ' + SKIPPED.length,
  );
}

main();
