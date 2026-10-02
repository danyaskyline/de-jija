import test from 'node:test';
import assert from 'node:assert/strict';
import { checkConfigKeysInDoc } from './config-keys.mjs';

const KEYS = ['minimumDamage', 'attackAdvantageCapPercent', 'luckPositiveMultiplier'];

const row = (key) => `| 11 | Округление | \`roundDamage(x)\` | \`${key}\` | конфиг | готово | T9 |`;

test('good case: every claimed config key exists', () => {
  const { errors } = checkConfigKeysInDoc(row('minimumDamage'), KEYS);
  assert.deepEqual(errors, []);
});

test('good case: code identifiers in other columns are not config keys', () => {
  const doc = '| 6 | Навык | `× (1 + навык/100)`; `attackKind` | `minimumDamage` | конфиг | готово | T4 |';
  const { errors } = checkConfigKeysInDoc(doc, KEYS);
  assert.deepEqual(errors, []);
});

test('good case: a row without a key claims nothing', () => {
  const doc = '| 9 | Доспехи | `× (1 − доспехи/100)` | — | боец | готово | T7 |';
  const { errors } = checkConfigKeysInDoc(doc, KEYS);
  assert.deepEqual(errors, []);
});

test('bad case: the table claims a key that is not in the config', () => {
  const { errors } = checkConfigKeysInDoc(row('totallyMadeUpKey'), KEYS);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /totallyMadeUpKey/);
  assert.match(errors[0], /Fix:/);
});