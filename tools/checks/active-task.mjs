/**
 * Check (c): the task named in part B of START-HERE.md must exist as a file.
 * `isReal` is injected for testing.
 */
export function checkActiveTask(startHereText, isReal) {
  const errors = [];
  const bStart = startHereText.indexOf('## ЧАСТЬ B');
  if (bStart === -1) {
    errors.push('START-HERE.md: part B ("ЧАСТЬ B") is missing.\n  Fix: restore the section heading "## ЧАСТЬ B. Текущее состояние".');
    return { errors, warnings: [] };
  }
  const partB = startHereText.slice(bStart);
  const m = partB.match(/docs\/tasks\/[\w.-]+\.md/);
  if (!m) {
    errors.push(
      'START-HERE.md part B: no task file is referenced.\n' +
        '  Fix: add a link to the active task, e.g. docs/tasks/003-example.md',
    );
    return { errors, warnings: [] };
  }
  if (!isReal(m[0])) {
    errors.push(
      `START-HERE.md part B references a task that does not exist: ${m[0]}\n` +
        `  Fix: create that file in docs/tasks/, or point part B to the real active task.`,
    );
  }
  return { errors, warnings: [] };
}