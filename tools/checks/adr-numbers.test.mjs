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
  assert.match(errors[0], /missing between 001 and 003/);
  assert.match(errors[0], /002/);
  assert.match(errors[0], /Зарезервированный ADR/);
});

test('bad case: a huge gap is reported once, not once per number', () => {
  const { errors } = checkAdrNumbers(dec('001 — A', '099 — Z'), []);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /\(97 numbers\)/);
});

test('bad case: duplicate numbers', () => {
  const { errors } = checkAdrNumbers(dec('001 — A', '001 — B', '002 — C'), []);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /duplicate ADR number 001/);
});