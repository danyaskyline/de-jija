import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSecrets } from './secrets.mjs';

// Test fixtures build their "secrets" from parts on purpose: the repository's own
// secret scanner checks tracked files, so a literal token here would be a hit.
const USER_PATH = `/home/${'ivan'}/report.txt`;
const GH_TOKEN = `ghp_${'abcdefghijklmnopqrstuvwxyz0123'}`;

test('good case: ordinary source files pass', () => {
  const files = [{ rel: 'server/src/index.ts', text: 'const port = 3000;\n' }];
  const { errors } = checkSecrets(files);
  assert.deepEqual(errors, []);
});

test('good case: conventions.md examples are exempt', () => {
  const files = [{ rel: 'docs/conventions.md', text: 'not commit `C:\\Users\\...` paths' }];
  const { errors } = checkSecrets(files, ['docs/conventions.md']);
  assert.deepEqual(errors, []);
});

test('bad case: a user home path leaks', () => {
  const files = [{ rel: 'docs/tasks/001.md', text: `report at ${USER_PATH}\n` }];
  const { errors } = checkSecrets(files);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Linux user path/);
  assert.match(errors[0], /001\.md:1/);
  assert.ok(!errors[0].includes('ivan'), 'must not echo the private path');
});

test('bad case: a token leaks', () => {
  const files = [{ rel: 'src/config.ts', text: `const k = "${GH_TOKEN}";` }];
  const { errors } = checkSecrets(files);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /GitHub token/);
  assert.ok(!errors[0].includes('abcdefghij'), 'must not echo the token value');
});

test('bad case: a .env file is tracked', () => {
  const files = [{ rel: '.env', text: 'PORT=3000' }];
  const { errors } = checkSecrets(files);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Tracked env file/);
});