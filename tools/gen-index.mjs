// Generates docs/INDEX.md — a map of the repository for AI agents.
// Usage: npm run map. Links are raw: they can be fetched directly without the GitHub UI.
// Ignores: node_modules, dist, .git, package-lock.json, client/dist
// Also exports renderIndex(), so `npm run check` can generate the expected content
// in memory and compare it with the committed file without touching the work tree.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const RAW = 'https://raw.githubusercontent.com/danyaskyline/de-jija/main';
const OUT = join(ROOT, 'docs', 'INDEX.md');

const IGNORED_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'coverage']);
const IGNORED_FILES = new Set(['package-lock.json', 'INDEX.md']);

/** Walk the repo and return repo-relative posix paths of all indexable files. */
function walk(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = relative(ROOT, full).split(sep).join('/');
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      walk(full, acc);
    } else {
      if (IGNORED_FILES.has(entry.name) || IGNORED_FILES.has(rel)) continue;
      if (rel.endsWith('.log')) continue;
      acc.push(rel);
    }
  }
  return acc;
}

const truncate = (text, max) => (text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text);

/** One-line description: heading/first line for .md, exported names for .ts/.tsx. */
function describe(absPath) {
  const ext = absPath.slice(absPath.lastIndexOf('.'));
  let text = '';
  try {
    text = readFileSync(absPath, 'utf8');
  } catch {
    return '_не удалось прочитать_';
  }

  if (ext === '.md' || ext === '.markdown') {
    const lines = text.split(/\r?\n/);
    const heading = lines.find((l) => /^#\s+\S/.test(l));
    if (heading) return truncate(heading.replace(/^#\s+/, ''), 110);
    const first = lines.find((l) => l.trim().length > 0);
    return first ? truncate(first.replace(/^#+\s*/, ''), 110) : '_пусто_';
  }

  if (ext === '.ts' || ext === '.tsx' || ext === '.mjs' || ext === '.js') {
    const names = [];
    const re = /^export\s+(?:async\s+)?(?:declare\s+)?(?:abstract\s+)?(?:default\s+)?(?:class|function|interface|type|enum|const|let)\s+([A-Za-z0-9_$]+)/gm;
    let m;
    while ((m = re.exec(text)) !== null && names.length < 6) {
      if (!names.includes(m[1])) names.push(m[1]);
    }
    if (names.length === 0) return '_без экспортов_';
    const more = text.split('\n').filter((l) => /^export\s/.test(l)).length > names.length;
    return truncate(`экспорты: ${names.join(', ')}${more ? ', …' : ''}`, 110);
  }

  if (ext === '.json') return '_данные/конфиг (JSON)_';
  if (ext === '.html') return '_HTML-страница_';
  if (ext === '.css') return '_стили_';
  if (ext === '.yml' || ext === '.yaml') return '_конфиг YAML_';
  return '';
}

/**
 * Build the INDEX.md content in memory.
 * Used both by `npm run map` (which writes it) and by `npm run check`
 * (which only compares, so the working tree is never modified).
 */
export function renderIndex() {
  const files = walk(ROOT).sort((a, b) => a.localeCompare(b, 'en'));

  // Group by top-level folder; root files come first as "(корень)".
  const groups = new Map();
  for (const rel of files) {
    const top = rel.includes('/') ? rel.slice(0, rel.indexOf('/')) : '(корень)';
    if (!groups.has(top)) groups.set(top, []);
    groups.get(top).push(rel);
  }

  const ORDER = ['(корень)', 'docs', 'server', 'client', 'shared', 'config', 'tools'];
  const sortedGroups = [...groups.keys()].sort((a, b) => {
    const ia = ORDER.indexOf(a);
    const ib = ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b, 'en');
  });

  const out = [];
  out.push('# Карта репозитория de-jija');
  out.push('');
  out.push('> Файл сгенерирован скриптом `tools/gen-index.mjs` (`npm run map`). Не редактировать вручную.');
  out.push(`> Всего файлов: ${files.length}. Обновляй карту после добавления/удаления/переименования файлов.`);
  out.push('');
  out.push('Как читать репо экономно: сначала [`START-HERE.md`](https://raw.githubusercontent.com/danyaskyline/de-jija/main/START-HERE.md), потом сюда — и открывать только нужный файл, а не всё дерево.');
  out.push('');

  for (const g of sortedGroups) {
    out.push(`## ${g === '(корень)' ? 'Корень репозитория' : g}`);
    out.push('');
    for (const rel of groups.get(g)) {
      const desc = describe(join(ROOT, rel));
      out.push(`- [\`${rel}\`](${RAW}/${rel})${desc ? ` — ${desc}` : ''}`);
    }
    out.push('');
  }

  return out.join('\n');
}

// When run directly as a script, write the file. When imported, only export.
if (process.argv[1] && process.argv[1].endsWith('gen-index.mjs')) {
  const content = renderIndex();
  writeFileSync(OUT, content, 'utf8');
  const count = (content.match(/^- \[`/gm) || []).length;
  console.log(`docs/INDEX.md: ${count} файлов -> ${relative(ROOT, OUT)}`);
}