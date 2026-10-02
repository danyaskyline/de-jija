/**
 * Check (h, WARNING only): docs/ should not point at mutable refs.
 * raw.githubusercontent.com/.../main/... can serve a stale copy from cache;
 * task 004 replaces these with commit-hash links, so this is transitional.
 *
 * `skip` lists files that are generated (the map) or intentionally exempt.
 */
export function checkMutableLinks(files, skip = []) {
  const warnings = [];
  const skipped = new Set(skip);
  const re = /https:\/\/raw\.githubusercontent\.com\/[^\s)]+\/main\//g;
  for (const { rel, text } of files) {
    if (skipped.has(rel)) continue;
    const count = [...text.matchAll(re)].length;
    if (count === 0) continue;
    warnings.push(
      `docs/ links to the mutable ref "main" (${count}x in ${rel}); a cached copy may be stale.\n` +
        `  Task 004 will replace these with commit-hash links. Nothing to fix yet.`,
    );
  }
  return { errors: [], warnings };
}