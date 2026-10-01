/**
 * Tests for the battlefield config loader (docs/battle.md, section 12).
 *
 * The rules are DATA, not code: a broken file must stop the server with a
 * readable message instead of letting it start with a half-loaded field.
 */

import { unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadBattleRules, parseBattleRules } from './battleRules';

const VALID = {
  fieldWidth: 15,
  fieldHeight: 11,
  maxUnitsPerSide: 7,
  startZoneWidth: 2,
};

describe('parseBattleRules', () => {
  it('accepts the real config values', () => {
    expect(parseBattleRules({ ...VALID }, 'test')).toEqual(VALID);
  });

  it('rejects a missing field with a readable message', () => {
    const { maxUnitsPerSide: _dropped, ...withoutSide } = VALID;

    expect(() => parseBattleRules(withoutSide, 'battle-rules.json')).toThrowError(
      /отсутствует обязательное поле maxUnitsPerSide/,
    );
  });

  it.each([0, -1, 1.5, 'ten', null])('rejects %s as a field size', (value) => {
    expect(() => parseBattleRules({ ...VALID, fieldWidth: value }, 'battle-rules.json')).toThrowError(
      /fieldWidth должно быть целым числом не меньше 1/,
    );
  });

  it('rejects a start zone wider than half the field (the zones would overlap)', () => {
    expect(() =>
      parseBattleRules({ ...VALID, fieldWidth: 3, startZoneWidth: 2 }, 'battle-rules.json'),
    ).toThrowError(/startZoneWidth \(2\) не может быть больше половины fieldWidth \(3\)/);
  });

  it('allows a start zone of exactly half the field', () => {
    expect(parseBattleRules({ ...VALID, fieldWidth: 4, startZoneWidth: 2 }, 't').startZoneWidth).toBe(
      2,
    );
  });

  it('ignores unknown fields instead of trusting them', () => {
    const parsed = parseBattleRules({ ...VALID, whatIsThis: 99 }, 'battle-rules.json');

    expect(parsed).toEqual(VALID);
    expect('whatIsThis' in parsed).toBe(false);
  });
});

describe('loadBattleRules', () => {
  it('reads the real config/battle-rules.json of the project', () => {
    expect(loadBattleRules()).toEqual(VALID);
  });

  it('says clearly that the file cannot be read', () => {
    expect(() => loadBattleRules('config/there-is-no-such-file.json')).toThrowError(
      /файл не читается/,
    );
  });

  it('says clearly that the file is not valid JSON', () => {
    // A temp file with broken content, so the test needs no fixture in the repo.
    const broken = path.join(os.tmpdir(), `battle-rules-broken-${process.pid}.json`);

    writeFileSync(broken, '{ this is not json');
    try {
      expect(() => loadBattleRules(broken)).toThrowError(/не является корректным JSON/);
    } finally {
      unlinkSync(broken);
    }
  });
});