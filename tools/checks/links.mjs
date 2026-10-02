// Individual doc checks. Pure functions over plain strings/arrays, so they can be
// unit-tested without touching the real repository.
//
// A check returns { errors: string[], warnings: string[] }.
// Errors block a commit (exit code 1); warnings never do.
//
// All messages are in English on purpose: they are read in a terminal.

/** Files whose relative markdown links we verify (docs + the entry page). */
export const LINK_SCAN_FILES = ['START-HERE.md', 'docs'];

/** Extract relative markdown links: [text](./path) or [text](../path). */
export function findRelativeLinks(text) {
  const links = [];
  const re = /\]\((\.{1,2}\/[^)#\s]+)\)/g;
  let m;
  while ((m = re.exec(text)) !== null) links.push(m[1]);
  return links;
}

/**
 * Check (a): relative markdown links must point to files that exist.
 * `isReal(relFilePath)` is injected so the test can supply a fake filesystem.
 */
export function checkLinks(files, isReal) {
  const errors = [];
  for (const { rel, text } of files) {
    for (const link of findRelativeLinks(text)) {
      const target = resolveRelative(rel, link);
      if (!isReal(target)) {
        errors.push(
          `Broken relative link in ${rel}: ${link}\n` +
            `  Resolves to: ${target}\n` +
            `  Fix: point the link at an existing file, or delete the link.`,
        );
      }
    }
  }
  return { errors, warnings: [] };
}

/** Resolve a relative link against the file that contains it, POSIX style. */
export function resolveRelative(fromFile, link) {
  const base = fromFile.split('/').slice(0, -1);
  for (const part of link.split('/')) {
    if (part === '.') continue;
    if (part === '..') base.pop();
    else base.push(part);
  }
  return base.join('/');
}