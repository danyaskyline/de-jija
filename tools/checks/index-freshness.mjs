/**
 * Check (b): docs/INDEX.md must match what `npm run map` generates.
 * We compare the committed version (git show) with a freshly generated one, so
 * running the check never rewrites the working tree.
 */
export function checkIndexFresh(committed, regenerated) {
  const errors = [];
  if (committed === null) {
    errors.push(
      'docs/INDEX.md is not committed yet.\n' +
        '  Fix: run npm run map and commit the result.',
    );
    return { errors, warnings: [] };
  }
  if (committed !== regenerated) {
    errors.push(
      'docs/INDEX.md is out of date: it does not match the repository structure.\n' +
        '  Fix: run npm run map and commit the updated file.',
    );
  }
  return { errors, warnings: [] };
}