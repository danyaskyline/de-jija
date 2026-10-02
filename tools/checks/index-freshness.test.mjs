import test from 'node:test';
import assert from 'node:assert/strict';
import { checkIndexFresh } from './index-freshness.mjs';

test('good case: committed map matches regenerated map', () => {
  const { errors } = checkIndexFresh('# Map\n- a.md\n', '# Map\n- a.md\n');
  assert.deepEqual(errors, []);
});

test('bad case: structure changed, map not regenerated', () => {
  const { errors } = checkIndexFresh('# Map\n- a.md\n', '# Map\n- a.md\n- b.md\n');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /out of date/);
  // The message must tell the author the exact command to run.
  assert.match(errors[0], /npm run map/);
});

test('bad case: map file is missing from git', () => {
  const { errors } = checkIndexFresh(null, '# Map\n');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /not committed/);
  assert.match(errors[0], /npm run map/);
});