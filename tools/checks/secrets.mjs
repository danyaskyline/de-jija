// Secret and private-path patterns. The repository is public, so nothing here
// may ever be committed.
const SECRET_PATTERNS = [
  { name: 'Windows user path', re: /[A-Za-z]:\\Users\\[^\\\s"']+/g },
  { name: 'Linux user path', re: /\/home\/[A-Za-z0-9._-]+\//g },
  { name: 'GitHub token', re: /\bghp_[A-Za-z0-9]{20,}/g },
  { name: 'GitHub fine-grained token', re: /\bgithub_pat_[A-Za-z0-9_]{20,}/g },
  { name: 'OpenAI-style secret key', re: /\bsk-[A-Za-z0-9]{20,}/g },
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}/g },
  { name: 'Private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { name: 'Database connection string', re: /\b(?:postgres|postgresql|mysql|mongodb\+srv|redis):\/\/[^\s"']+/g },
];

// Files that must never be tracked at all.
const FORBIDDEN_TRACKED = [
  { name: 'env file', re: /(^|\/)\.env(\..+)?$/ },
  { name: 'private key file', re: /\.(pem|key|p12|pfx)$/i },
];

/**
 * Check (g): no secrets and no private local paths in tracked files.
 * `files` are { rel, text } pairs of git-tracked files; `skip` lists exempt files.
 */
export function checkSecrets(files, skip = []) {
  const errors = [];
  const skipped = new Set(skip);

  for (const { rel } of files) {
    if (skipped.has(rel)) continue;
    const name = FORBIDDEN_TRACKED.find((f) => f.re.test(rel));
    if (name) {
      errors.push(
        `Tracked ${name.name} must not be in the repository: ${rel}\n` +
          `  Fix: remove it from git (git rm --cached ${rel}); the file stays on disk.`,
      );
    }
  }

  for (const { rel, text } of files) {
    if (skipped.has(rel)) continue;
    for (const { name, re } of SECRET_PATTERNS) {
      const hits = [...text.matchAll(re)];
      if (hits.length === 0) continue;
      // Report the location and the kind, never the value itself.
      const line = text.slice(0, hits[0].index).split('\n').length;
      errors.push(
        `Possible ${name} in tracked file ${rel}:${line}\n` +
          `  Fix: remove the value (or reference it via an ignored local file). The value is not shown.`,
      );
    }
  }
  return { errors, warnings: [] };
}