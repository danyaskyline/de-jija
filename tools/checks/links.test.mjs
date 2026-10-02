import test from 'node:test';
import assert from 'node:assert/strict';
import { checkLinks, findRelativeLinks, resolveRelative } from './links.mjs';

test('findRelativeLinks picks only relative links', () => {
  const text = '[a](./one.md) [b](../two.md) [c](https://x.dev/y) [d](/abs)';
  assert.deepEqual(findRelativeLinks(text), ['./one.md', '../two.md']);
});

test('resolveRelative resolves against the containing file', () => {
  assert.equal(resolveRelative('docs/battle.md', './INDEX.md'), 'docs/INDEX.md');
  assert.equal(resolveRelative('docs/tasks/001.md', '../battle.md'), 'docs/battle.md');
  assert.equal(resolveRelative('START-HERE.md', './docs/x.md'), 'docs/x.md');
});

test('good case: every link exists -> no errors', () => {
  const files = [{ rel: 'docs/battle.md', text: 'see [index](./INDEX.md)' }];
  const { errors } = checkLinks(files, (t) => t === 'docs/INDEX.md');
  assert.deepEqual(errors, []);
});

test('bad case: a link to a missing file -> clear error', () => {
  const files = [{ rel: 'docs/battle.md', text: 'see [gone](./GONE.md)' }];
  const { errors } = checkLinks(files, () => false);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /docs\/battle\.md/);
  assert.match(errors[0], /GONE\.md/);
  assert.match(errors[0], /Fix:/);
});