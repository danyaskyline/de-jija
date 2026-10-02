/**
 * Check (d): ADR numbering in docs/decisions.md must have no gaps and no duplicates.
 * A gap is allowed only when a task file in docs/tasks/ declares it reserved
 * (e.g. "Зарезервированный ADR: 022").
 *
 * `taskFiles` are { rel, text } pairs of docs/tasks/*.md.
 */
export function checkAdrNumbers(decisionsText, taskFiles) {
  const errors = [];
  const numbers = [...decisionsText.matchAll(/^## (\d{3})\b/gm)].map((m) => Number(m[1]));
  if (numbers.length === 0) {
    errors.push('docs/decisions.md: no ADR headings (## NNN) found.\n  Fix: keep the existing ADR format "## 001 — Title".');
    return { errors, warnings: [] };
  }

  const seen = new Set();
  for (const n of numbers) {
    if (seen.has(n)) errors.push(`docs/decisions.md: duplicate ADR number ${pad(n)}.\n  Fix: give one of them the next free number.`);
    seen.add(n);
  }

  // A reserved number must be declared by a task file; otherwise a gap is a mistake.
  const reserved = new Set();
  for (const { rel, text } of taskFiles) {
    for (const m of text.matchAll(/Зарезервированный ADR:\s*(\d{3})/g)) {
      reserved.add(Number(m[1]));
      void rel;
    }
  }

  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    const missing = sorted[i] - sorted[i - 1];
    if (missing > 1) {
      for (let n = sorted[i - 1] + 1; n < sorted[i]; n++) {
        if (reserved.has(n)) continue;
        errors.push(
          `docs/decisions.md: ADR ${pad(n)} is missing between ${pad(sorted[i - 1])} and ${pad(sorted[i])}.\n` +
            `  Fix: restore that ADR, or — if it is reserved on purpose — add a line ` +
            `"Зарезервированный ADR: ${pad(n)}" to the relevant task file in docs/tasks/.`,
        );
      }
    }
  }
  return { errors, warnings: [] };
}

const pad = (n) => String(n).padStart(3, '0');