import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAdrHistoryPreserved } from './adr-history.mjs';

const cur = (...heads) => heads.map((h) => `## ${h}`).join('\n\n');

test('good case: only a new ADR was appended', () => {
  const { errors } = checkAdrHistoryPreserved([1, 2], cur('001 — A', '002 — B', '003 — C'));
  assert.deepEqual(errors, []);
});

test('good case: the text of an existing ADR was edited', () => {
  const before = '## 002 — B\n\n**Решение**: старое.';
  const after = '## 002 — B\n\n**Решение**: новое, уточнённое.';
  const { errors } = checkAdrHistoryPreserved([1, 2], cur('001 — A', '002 — B') + '\n' + after);
  assert.deepEqual(errors, []);
});

test('good case: no base commit given -> check does nothing locally', () => {
  const { errors } = checkAdrHistoryPreserved([], cur('001 — A'));
  assert.deepEqual(errors, []);
});

test('good case: an empty base list (CI sets CHECK_BASE to an empty string) disables the check', () => {
  // This is what the caller passes when CHECK_BASE is empty or unset: the gate
  // itself lives in check-docs.mjs (`(process.env.CHECK_BASE || '').trim()`),
  // which keeps the empty string from being treated as a commit name.
  const { errors } = checkAdrHistoryPreserved([], cur('001 — A', '002 — B'));
  assert.deepEqual(errors, []);
});

test('bad case: an ADR was removed', () => {
  const { errors } = checkAdrHistoryPreserved([1, 2, 3], cur('001 — A', '003 — C'));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /ADR 002 existed before/);
  assert.match(errors[0], /Fix:/);
});

test('bad case: an ADR was renumbered', () => {
  const { errors } = checkAdrHistoryPreserved([2], cur('003 — B renamed'));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /ADR 002/);
});