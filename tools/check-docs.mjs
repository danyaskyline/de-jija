// Mechanical doc-freshness check. Usage: npm run check.
// Prints WARNINGS only and always exits 0 — it must never block a commit.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkLinks } from './checks/links.mjs';
import { checkIndexFresh } from './checks/index-freshness.mjs';
import { checkActiveTask } from './checks/active-task.mjs';
import { checkAdrNumbers } from './checks/adr-numbers.mjs';
import { checkFormulaDocPairing } from './checks/formula-doc-pairing.mjs';
import { checkConfigKeysInDoc } from './checks/config-keys.mjs';
import { checkSecrets } from './checks/secrets.mjs';
import { checkMutableLinks } from './checks/mutable-links.mjs';
import { renderIndex } from './gen-index.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const warnings = [];
const errors = [];

/** Collect every markdown file under a repo-relative path (file or directory). */
const mdFilesUnder = (rel) => {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isDirectory()) {
    const out = [];
    const walkDir = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const full = join(d, e.name);
        if (e.isDirectory()) walkDir(full);
        else if (e.name.endsWith('.md')) out.push(relative(ROOT, full).split(sep).join('/'));
      }
    };
    walkDir(abs);
    return out;
  }
  return [rel];
};

// Concrete model/tool names that must not leak into the process documentation.
// Kept as one list so it is cheap to keep in sync.
const TOOL_NAMES = [
  'Claude', 'DeepSeek', 'Cline', 'cline', 'ChatGPT', 'GPT-', 'Gemini', 'Copilot',
  'Cursor', 'Windsurf', 'Aider', 'Space Bunny', 'Codex', 'Llama', 'Mistral', 'Grok',
];

// Process files that must stay tool-neutral.
const NEUTRAL_FILES = ['START-HERE.md', 'AGENTS.md', 'docs/conventions.md', 'docs/workflow'];

const warn = (msg) => warnings.push(msg);
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
// Same as read(), but tolerates unreadable/binary files instead of throwing.
const readRaw = (rel) => {
  try {
    return readFileSync(join(ROOT, rel), 'latin1');
  } catch {
    return '';
  }
};
const countLines = (rel) => read(rel).split(/\r?\n/).length - 1;

const git = (args) => {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

// Same as git(), but keeps the content byte-exact — needed when comparing file
// contents (trim() would eat the trailing newline and never match).
const gitRaw = (args) => {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
};

// Everything below runs inside a try/catch: an unexpected failure must print a
// readable message, never a raw stack trace, and must be distinguishable from a
// normal "errors found" exit (1) — hence exit code 2.
try {

// --- 1. START-HERE.md: total length and part B length ------------------------
const SH_MAX_TOTAL = 90;
const SH_MAX_PART_B = 30;
if (existsSync(join(ROOT, 'START-HERE.md'))) {
  const sh = read('START-HERE.md');
  const total = sh.split(/\r?\n/).length - 1;
  if (total > SH_MAX_TOTAL) warn(`START-HERE.md: ${total} строк, лимит ${SH_MAX_TOTAL}`);

  const bStart = sh.indexOf('## ЧАСТЬ B');
  if (bStart === -1) {
    warn('START-HERE.md: не найдена ЧАСТЬ B');
  } else {
    const partB = sh.slice(bStart).trimEnd().split(/\r?\n/).length;
    // The "> перезаписывается" note is part of the block, count it as-is.
    if (partB > SH_MAX_PART_B) warn(`START-HERE.md часть B: ${partB} строк, лимит ${SH_MAX_PART_B}`);
  }
}

// --- 2. Part B date vs last commit touching game code -----------------------
const m = read('START-HERE.md').match(/\*\*Обновлено:\*\*\s*(\d{4}-\d{2}-\d{2})/);
if (!m) {
  warn('START-HERE.md: в части B нет даты «Обновлено» в формате YYYY-MM-DD');
} else {
  const lastCodeCommit = git(['log', '-1', '--format=%cs', '--', 'server', 'client', 'shared', 'config']);
  if (lastCodeCommit && lastCodeCommit > m[1]) {
    warn(`START-HERE.md: часть B от ${m[1]}, а код менялся ${lastCodeCommit} (позже) — обновить часть B`);
  }
}

// --- 3. docs/INDEX.md size ---------------------------------------------------
const INDEX_MAX_FILES = 150;
if (existsSync(join(ROOT, 'docs', 'INDEX.md'))) {
  const files = (read('docs/INDEX.md').match(/^- \[`/gm) || []).length;
  if (files > INDEX_MAX_FILES) warn(`docs/INDEX.md: ${files} файлов, лимит ${INDEX_MAX_FILES}`);
} else {
  warn('docs/INDEX.md не найден — запусти npm run map');
}

// --- 4. docs/decisions.md size ----------------------------------------------
const ADR_MAX_LINES = 800;
const ADR_MAX_COUNT = 40;
if (existsSync(join(ROOT, 'docs', 'decisions.md'))) {
  const dec = read('docs/decisions.md');
  const lines = dec.split(/\r?\n/).length - 1;
  const adr = (dec.match(/^## \d{3} /gm) || []).length;
  if (lines > ADR_MAX_LINES) warn(`docs/decisions.md: ${lines} строк, лимит ${ADR_MAX_LINES}`);
  if (adr > ADR_MAX_COUNT) warn(`docs/decisions.md: ${adr} ADR, лимит ${ADR_MAX_COUNT}`);
}

// --- 5. README "Статус" section length --------------------------------------
const readme = read('README.md');
const sIdx = readme.indexOf('\n## Статус');
if (sIdx !== -1) {
  const rest = readme.slice(sIdx + 1);
  const nextHeading = rest.indexOf('\n## ', 3);
  const section = (nextHeading === -1 ? rest : rest.slice(0, nextHeading)).split(/\r?\n/).filter((l) => l.trim().length > 0).length;
  if (section > 5) warn(`README.md раздел «Статус»: ${section} непустых строк, лимит 5 (статус живёт в START-HERE.md)`);
}

// --- 6. Long .ts files in the source folders --------------------------------
const TS_MAX_LINES = 400;
const longFiles = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.tsx?$/.test(entry.name)) {
      const lines = readFileSync(full, 'utf8').split(/\r?\n/).length - 1;
      if (lines > TS_MAX_LINES) longFiles.push(`${relative(ROOT, full).split(sep).join('/')} (${lines})`);
    }
  }
};
for (const src of ['server/src', 'client/src', 'shared/src']) {
  const dir = join(ROOT, src);
  if (existsSync(dir)) walk(dir);
}
if (longFiles.length > 0) {
  warn(`файлов .ts длиннее ${TS_MAX_LINES} строк: ${longFiles.length} — ${longFiles.join(', ')}`);
}

// --- 7. Tool neutrality of the process docs --------------------------------
const collectNeutralFiles = () => {
  const found = [];
  for (const rel of NEUTRAL_FILES) {
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) continue;
    if (statSync(abs).isDirectory()) {
      for (const name of readdirSync(abs)) {
        if (name.endsWith('.md')) found.push(`${rel}/${name}`);
      }
    } else {
      found.push(rel);
    }
  }
  return found;
};
for (const rel of collectNeutralFiles()) {
  // Strip repo paths and URLs first: `.clinerules` and similar are legitimate
  // file names, not tool names in the prose.
  const text = read(rel)
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[\w./-]*\.clinerules[\w./-]*/g, '')
    .replace(/\.clineignore/g, '');
  const hits = TOOL_NAMES.filter((name) => text.includes(name));
  if (hits.length > 0) warn(`${rel}: названия конкретных инструментов — ${hits.join(', ')}`);
}

// --- 8. Blocking checks -----------------------------------------------------

// (a) Broken relative links in docs/*.md and START-HERE.md.
{
  const files = ['START-HERE.md', 'docs']
    .flatMap(mdFilesUnder)
    .map((rel) => ({ rel, text: read(rel) }));
  errors.push(...checkLinks(files, (target) => existsSync(join(ROOT, target))).errors);
}

// (b) docs/INDEX.md must match a freshly generated map.
{
  // Compare against the version git knows (staged if there is one, else HEAD),
  // so this check never rewrites the working tree itself.
  const staged = gitRaw(['show', ':docs/INDEX.md']);
  const head = gitRaw(['show', 'HEAD:docs/INDEX.md']);
  const committed = staged !== '' ? staged : head !== '' ? head : null;
  errors.push(...checkIndexFresh(committed, renderIndex()).errors);
}

// (c) The active task named in part B must exist in docs/tasks/.
errors.push(
  ...checkActiveTask(read('START-HERE.md'), (t) => existsSync(join(ROOT, t))).errors,
);

// (d) ADR numbering in docs/decisions.md: no gaps, no duplicates.
{
  const taskFiles = mdFilesUnder('docs/tasks').map((rel) => ({ rel, text: read(rel) }));
  errors.push(...checkAdrNumbers(read('docs/decisions.md'), taskFiles).errors);
}

// (e) The damage formula and its document must change in the same commit.
// Locally we inspect what is about to be committed; CI passes a commit range
// through CHECK_RANGE (e.g. "origin/main..HEAD") so a whole push is covered.
{
  const range = process.env.CHECK_RANGE;
  const changed = range
    ? git(['diff', '--name-only', range]).split('\n').map((s) => s.trim()).filter(Boolean)
    : git(['diff', '--cached', '--name-only']).split('\n').map((s) => s.trim()).filter(Boolean);
  errors.push(...checkFormulaDocPairing(changed).errors);
}

// (f) Config keys named in docs/combat-formula.md must exist in config/*.json.
{
  const configDir = join(ROOT, 'config');
  const keys = [];
  if (existsSync(configDir)) {
    for (const name of readdirSync(configDir)) {
      if (!name.endsWith('.json')) continue;
      const parsed = JSON.parse(read(`config/${name}`));
      for (const k of Object.keys(parsed)) keys.push(k);
    }
  }
  errors.push(...checkConfigKeysInDoc(read('docs/combat-formula.md'), keys).errors);
}

// (g) No secrets and no private local paths in git-tracked files.
// docs/conventions.md is exempt: it quotes these patterns as examples on purpose.
{
  const tracked = git(['ls-files']).split('\n').map((s) => s.trim()).filter(Boolean);
  const files = tracked
    // Skip binaries/dependencies that are generated, not authored.
    .filter((rel) => rel !== 'package-lock.json' && !/\.(png|jpe?g|gif|webp|ico|woff2?|ttf|eot|zip|gz|pdf|mp3|wav|ogg|mp4)$/i.test(rel))
    .map((rel) => ({ rel, text: readRaw(rel) }));
  errors.push(...checkSecrets(files, ['docs/conventions.md']).errors);
}

// (h, WARNING only) Mutable "main" links in docs/ — task 004 will replace them.
{
  const files = mdFilesUnder('docs')
    .filter((rel) => rel !== 'docs/INDEX.md') // generated map, full of such links by design
    .map((rel) => ({ rel, text: read(rel) }));
  warnings.push(...checkMutableLinks(files, ['docs/INDEX.md']).warnings);
}

// --- Output ------------------------------------------------------------------
if (errors.length > 0) {
  console.log(`ERRORS (${errors.length}) — fix these before committing:`);
  for (const e of errors) console.log(`  - ${e}`);
}
if (warnings.length === 0) {
  if (errors.length === 0) console.log('docs OK');
} else {
  console.log(`docs: ${warnings.length} warning(s)`);
  for (const w of warnings) console.log(`  - ${w}`);
}
// Errors block; warnings never do.
process.exit(errors.length > 0 ? 1 : 0);

} catch (err) {
  // The checker itself broke (missing file, unreadable JSON, git unavailable).
  // That is NOT the same as "your docs are wrong", so it gets its own exit code.
  console.error('check-docs crashed — the checker itself failed, your docs may be fine.');
  console.error(`Reason: ${err && err.message ? err.message : String(err)}`);
  console.error('Fix: verify that the repository files exist and git works, then re-run npm run check.');
  process.exit(2);
}