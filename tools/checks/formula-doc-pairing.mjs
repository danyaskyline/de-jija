/**
 * Check (e): when the damage formula code changes, the formula document must
 * change in the same commit (docs/conventions.md, "Архитектурные границы").
 * The reverse is not required: the doc may be edited without code changes.
 *
 * `changedFiles` is the list of paths touched by the commit under inspection.
 */
export function checkFormulaDocPairing(changedFiles) {
  const errors = [];
  const has = (p) => changedFiles.includes(p);
  const CODE = 'server/src/combat/resolveAttack.ts';
  const DOC = 'docs/combat-formula.md';

  if (has(CODE) && !has(DOC)) {
    errors.push(
      `${CODE} was changed without ${DOC} in the same commit.\n` +
        `  Fix: update ${DOC} in the same commit (order of steps, config keys, ` +
        `source of each value, covering test name), or move the code change to its own commit after the doc.`,
    );
  }
  return { errors, warnings: [] };
}