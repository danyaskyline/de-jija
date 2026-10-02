// Mechanical doc-freshness check. Usage: npm run check.
// Prints WARNINGS only and always exits 0 — it must never block a commit.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const warnings = [];

const warn = (msg) => warnings.push(msg);
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const countLines = (rel) => read(rel).split(/\r?\n/).length - 1;

const git = (args) => {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

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

// --- Output ------------------------------------------------------------------
if (warnings.length === 0) {
  console.log('docs OK');
} else {
  console.log(`docs: ${warnings.length} предупреждени(й)`);
  for (const w of warnings) console.log(`  - ${w}`);
}
process.exit(0);