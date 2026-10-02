import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAdrNumbers } from './adr-numbers.mjs';

const dec = (...heads) => heads.map((h) => `## ${h}`).join('\n\n');

test('good case: continuous numbering', () => {
  const { errors } = checkAdrNumbers(dec('001 — A', '002 — B', '003 — C'), []);
  assert.deepEqual(errors, []);
});

test('good case: a gap declared as reserved in a task file is allowed', () => {
  const tasks = [{ rel: 'docs/tasks/002-x.md', text: 'Зарезервированный ADR: 022.' }];
  const { errors } = checkAdrNumbers(dec('021 — A', '023 — B'), tasks);
  assert.deepEqual(errors, []);
});

test('bad case: an undeclared gap', () => {
  const { errors } = checkAdrNumbers(dec('001 — A', '003 — B'), []);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /002 is missing/);
  assert.match(errors[0], /Зарезервированный ADR/);
});

test('bad case: duplicate numbers', () => {
  const { errors } = checkAdrNumbers(dec('001 — A', '001 — B', '002 — C'), []);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /duplicate ADR number 001/);
});