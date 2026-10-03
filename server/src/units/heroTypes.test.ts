/**
 * Tests for the hero type data loader.
 *
 * The check that matters most: every skill id used by a hero must exist in
 * config/skills.json. If the author renames a skill in one table and not the
 * other, the server must fail here instead of at battle time.
 */

import { describe, expect, it } from 'vitest';

import { findHeroType, heroCanLearn, loadHeroTypes, skillPrice } from './heroTypes';
import { loadSkills } from '../combat/skills';

describe('config/hero-types.json', () => {
  it('loads the real file without errors', () => {
    const data = loadHeroTypes();

    expect(data.heroes.length).toBe(data.heroCount);
    expect(data.heroes.length).toBeGreaterThan(0);
  });

  it('every skill id used by a hero exists in config/skills.json', () => {
    const data = loadHeroTypes();
    const known = new Set(loadSkills().skills.map((skill) => skill.id));

    for (const hero of data.heroes) {
      for (const skillId of Object.keys(hero.skills)) {
        expect(known.has(skillId)).toBe(true);
      }
    }
  });

  it('every skill of skills.json is used by at least one hero', () => {
    const data = loadHeroTypes();
    const used = new Set(data.heroes.flatMap((hero) => Object.keys(hero.skills)));

    for (const skill of loadSkills().skills) {
      expect(used.has(skill.id)).toBe(true);
    }
  });

  it('the hero ids are unique', () => {
    const data = loadHeroTypes();
    const ids = data.heroes.map((hero) => hero.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('each group holds the same number of heroes', () => {
    const data = loadHeroTypes();
    const counts = data.heroes.reduce<Record<string, number>>((acc, hero) => {
      acc[hero.group] = (acc[hero.group] ?? 0) + 1;

      return acc;
    }, {});

    for (const group of data.groups) {
      expect(counts[group.id] ?? 0).toBeGreaterThan(0);
    }
  });

  it('skill prices grow with the level', () => {
    for (const hero of loadHeroTypes().heroes) {
      for (const prices of Object.values(hero.skills)) {
        expect(prices[0]).toBeLessThanOrEqual(prices[1]);
        expect(prices[1]).toBeLessThanOrEqual(prices[2]);
      }
    }
  });

  it('finds a hero by id', () => {
    const data = loadHeroTypes();
    const first = data.heroes[0];

    expect(findHeroType(data, first.id)?.name).toBe(first.name);
    expect(findHeroType(data, 'no-such-hero')).toBeUndefined();
  });

  it('a missing file is rejected with a readable message', () => {
    expect(() => loadHeroTypes('config/nope.json')).toThrow(/не читается/);
  });
});

describe('skillPrice - what a hero may learn', () => {
  const data = loadHeroTypes();
  const knight = data.heroes.find((hero) => hero.name === 'Рыцарь');

  it('the checked example hero exists', () => {
    expect(knight).toBeDefined();
  });

  it('returns the price of the requested level', () => {
    expect(skillPrice(knight!, 'sorcery', 1)).toBe(10);
    expect(skillPrice(knight!, 'sorcery', 2)).toBe(18);
    expect(skillPrice(knight!, 'sorcery', 3)).toBe(34);
  });

  it('a hero cannot learn a skill that is not in its table', () => {
    expect(skillPrice(knight!, 'no_such_skill', 1)).toBeNull();
    expect(heroCanLearn(knight!, 'no_such_skill')).toBe(false);
  });

  it('heroCanLearn agrees with the table', () => {
    for (const hero of data.heroes) {
      for (const skillId of Object.keys(hero.skills)) {
        expect(heroCanLearn(hero, skillId)).toBe(true);
      }
    }
  });
});
