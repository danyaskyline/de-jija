import test from 'node:test';
import assert from 'node:assert/strict';
import { checkFormulaDocPairing } from './formula-doc-pairing.mjs';

const CODE = 'server/src/combat/resolveAttack.ts';
const DOC = 'docs/combat-formula.md';

test('good case: formula code and its doc change together', () => {
  const { errors } = checkFormulaDocPairing([CODE, DOC]);
  assert.deepEqual(errors, []);
});

test('good case: only the doc changes (reverse is not required)', () => {
  const { errors } = checkFormulaDocPairing([DOC]);
  assert.deepEqual(errors, []);
});

test('good case: neither file is touched', () => {
  const { errors } = checkFormulaDocPairing(['README.md']);
  assert.deepEqual(errors, []);
});

test('bad case: formula code changed without its doc', () => {
  const { errors } = checkFormulaDocPairing([CODE, 'server/src/index.ts']);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /resolveAttack\.ts/);
  assert.match(errors[0], /combat-formula\.md/);
  assert.match(errors[0], /Fix:/);
});