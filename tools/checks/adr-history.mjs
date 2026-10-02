/**
 * Check (CI only): ADRs are append-only — no ADR may disappear or be renumbered.
 *
 * Editing the text of an existing ADR (a status line, a clarification) is allowed;
 * only the SET of ADR numbers must grow, never shrink or change.
 *
 * `baseNumbers` are the ADR numbers found in docs/decisions.md at the base commit.
 * Returns errors only for numbers that existed before and are now gone.
 */
export function checkAdrHistoryPreserved(baseNumbers, currentText) {
  const errors = [];
  if (!Array.isArray(baseNumbers) || baseNumbers.length === 0) return { errors, warnings: [] };

  const current = new Set(
    [...currentText.matchAll(/^## (\d{3})\b/gm)].map((m) => Number(m[1])),
  );

  for (const n of [...new Set(baseNumbers)].sort((a, b) => a - b)) {
    if (current.has(n)) continue;
    errors.push(
      `docs/decisions.md: ADR ${pad(n)} existed before this change and is now missing.\n` +
        `  Fix: restore ADR ${pad(n)}. Decisions are append-only — to correct an existing ` +
        `record, add a new ADR with the next free number; editing the text is allowed, ` +
        `removing or renumbering the heading is not.`,
    );
  }
  return { errors, warnings: [] };
}

const pad = (n) => String(n).padStart(3, '0');