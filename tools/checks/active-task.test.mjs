import test from 'node:test';
import assert from 'node:assert/strict';
import { checkActiveTask } from './active-task.mjs';

const partB = (task) => `## ЧАСТЬ B. Текущее состояние\n\n- **Активная задача:** [${task}](x) — начата.`;

test('good case: the active task exists', () => {
  const { errors } = checkActiveTask(partB('docs/tasks/003-x.md'), (t) => t === 'docs/tasks/003-x.md');
  assert.deepEqual(errors, []);
});

test('bad case: the active task file is missing', () => {
  const { errors } = checkActiveTask(partB('docs/tasks/004-gone.md'), () => false);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /004-gone\.md/);
  assert.match(errors[0], /Fix:/);
});

test('bad case: part B is missing entirely', () => {
  const { errors } = checkActiveTask('# START-HERE\n\njust part A', () => true);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /ЧАСТЬ B/);
});

test('bad case: part B references no task at all', () => {
  const { errors } = checkActiveTask('## ЧАСТЬ B. Текущее состояние\n\n- ничего', () => true);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /no task file/);
});