import test from 'node:test';
import assert from 'node:assert/strict';
import { checkMutableLinks } from './mutable-links.mjs';

const MAIN_LINK = 'https://raw.githubusercontent.com/danyaskyline/de-jija/main/docs/battle.md';
const HASH_LINK = 'https://raw.githubusercontent.com/danyaskyline/de-jija/abc123/docs/battle.md';

test('good case: hash links produce no warning', () => {
  const { warnings } = checkMutableLinks([{ rel: 'docs/a.md', text: HASH_LINK }]);
  assert.deepEqual(warnings, []);
});

test('good case: generated map is skipped', () => {
  const { warnings } = checkMutableLinks([{ rel: 'docs/INDEX.md', text: MAIN_LINK }], ['docs/INDEX.md']);
  assert.deepEqual(warnings, []);
});

test('warn case: a docs file links to main', () => {
  const { errors, warnings } = checkMutableLinks([{ rel: 'docs/a.md', text: `${MAIN_LINK}\n${MAIN_LINK}` }]);
  assert.deepEqual(errors, [], 'this check must never be blocking');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /main/);
  assert.match(warnings[0], /2x in docs\/a\.md/);
});