/**
 * Tests for the skills loader (config/skills.json).
 *
 * The server must fail at startup with a clear message when the skills file is broken,
 * misses a field or has a field of the wrong type (docs/decisions.md, 016). Most tests
 * here write throwaway files into a temp folder, so they do not depend on the real config.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SKILLS_PATH, findSkill, getSkills, initSkills, loadSkills } from './skills';

let tempDir: string;

beforeAll(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), 'de-jija-skills-'));
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

/** A valid skill; the broken variants below are built from it. */
const validSkill = {
  id: 'offense',
  name: 'Нападение',
  levels: ['a', 'b', 'c'],
  effects: [{ target: 'meleeOffenseBonusPercent', perLevel: [10, 20, 30] }],
};

/** Writes a file into the temp folder and returns its full path. */
function writeSkillsFile(name: string, content: string): string {
  const filePath = path.join(tempDir, name);
  writeFileSync(filePath, content, 'utf8');

  return filePath;
}

/** Wraps a list of skills into the file shape { skills: [...] }. */
function skillsFile(skills: unknown): string {
  return JSON.stringify({ skills });
}

describe('skills loader', () => {
  it('loads the real config/skills.json that ships with the repository', () => {
    const data = loadSkills();

    expect(data.skills.length).toBe(12);

    const offense = findSkill(data, 'offense');
    expect(offense?.name).toBe('Нападение');
    expect(offense?.effects).toEqual([
      { target: 'meleeOffenseBonusPercent', perLevel: [10, 20, 30] },
    ]);
    expect(offense?.levels.length).toBe(3);

    // The four magic schools carry no numbers yet, only descriptions.
    const fire = findSkill(data, 'fire_magic');
    expect(fire?.effects).toEqual([]);

    expect(DEFAULT_SKILLS_PATH.endsWith(path.join('config', 'skills.json'))).toBe(true);
  });

  it('reads a valid file and ignores unknown extra fields', () => {
    const filePath = writeSkillsFile('valid.json', skillsFile([{ ...validSkill, extra: 1 }]));

    const data = loadSkills(filePath);

    expect(data.skills.length).toBe(1);
    expect('extra' in data.skills[0]).toBe(false);
  });

  it('reports a missing skills field', () => {
    const filePath = writeSkillsFile('no-skills.json', JSON.stringify({ other: 1 }));

    expect(() => loadSkills(filePath)).toThrowError(/отсутствует обязательное поле skills/);
  });

  it('reports skills that is not an array', () => {
    const filePath = writeSkillsFile('bad-skills.json', JSON.stringify({ skills: 5 }));

    expect(() => loadSkills(filePath)).toThrowError(/поле skills должно быть массивом/);
  });

  it('reports a skill that is not an object', () => {
    const filePath = writeSkillsFile('bad-entry.json', skillsFile(['nope']));

    expect(() => loadSkills(filePath)).toThrowError(/должен быть JSON-объектом/);
  });

  it('reports an empty id', () => {
    const filePath = writeSkillsFile('empty-id.json', skillsFile([{ ...validSkill, id: '' }]));

    expect(() => loadSkills(filePath)).toThrowError(/поле id должно быть непустой строкой/);
  });

  it.each([
    ['too few', ['a', 'b']],
    ['wrong type', ['a', 5, 'c']],
  ])('reports bad levels (%s)', (_label, levels) => {
    const filePath = writeSkillsFile(
      `bad-levels-${_label.replace(/\s+/g, '-')}.json`,
      skillsFile([{ ...validSkill, levels }]),
    );

    expect(() => loadSkills(filePath)).toThrowError(/levels/);
  });

  it('reports an unknown effect target', () => {
    const filePath = writeSkillsFile(
      'bad-target.json',
      skillsFile([{ ...validSkill, effects: [{ target: 'nope', perLevel: [1, 2, 3] }] }]),
    );

    expect(() => loadSkills(filePath)).toThrowError(/неизвестный target/);
  });

  it('reports a perLevel that is not three numbers', () => {
    const filePath = writeSkillsFile(
      'bad-perlevel.json',
      skillsFile([{ ...validSkill, effects: [{ target: 'luckLevel', perLevel: [1, 2] }] }]),
    );

    expect(() => loadSkills(filePath)).toThrowError(/perLevel/);
  });

  it('reports a duplicate skill id', () => {
    const filePath = writeSkillsFile('dupe.json', skillsFile([validSkill, validSkill]));

    expect(() => loadSkills(filePath)).toThrowError(/объявлен дважды/);
  });

  it('reports a file that is not valid JSON', () => {
    const filePath = writeSkillsFile('broken.json', '{ "skills": [ ');

    expect(() => loadSkills(filePath)).toThrowError(/не является корректным JSON/);
  });

  it('reports a JSON file that is not an object', () => {
    const filePath = writeSkillsFile('array.json', '[1, 2, 3]');

    expect(() => loadSkills(filePath)).toThrowError(/ожидался JSON-объект/);
  });
});

describe('skills in memory (loaded once at startup)', () => {
  it('getSkills() explains clearly that nothing was loaded yet', async () => {
    // A fresh module instance, i.e. the state of a server that forgot to load the file.
    vi.resetModules();
    const freshModule = await import('./skills');

    expect(() => freshModule.getSkills()).toThrowError(/Данные навыков не загружены/);
  });

  it('initSkills() puts the skills in memory', async () => {
    vi.resetModules();
    const freshModule = await import('./skills');

    const loaded = freshModule.initSkills();

    expect(freshModule.getSkills()).toEqual(loaded);
    expect(freshModule.getSkills().skills.length).toBe(12);
  });

  it('the skills used by default are exactly the ones loaded at startup', () => {
    const loaded = initSkills();

    expect(getSkills()).toEqual(loaded);
  });
});
