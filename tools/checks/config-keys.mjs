/**
 * Check (f): every config key named in docs/combat-formula.md must exist in
 * config/*.json.
 *
 * Only the "Ключ конфига" column of the formula table is treated as a claim
 * about the config; the other columns legitimately mention code identifiers
 * (attackKind, isRetaliation, ...) that are not config keys at all.
 *
 * `configKeys` is the union of top-level keys across config/*.json.
 */
export function checkConfigKeysInDoc(docText, configKeys) {
  const errors = [];
  const known = new Set(configKeys);
  const claimed = new Set();

  for (const line of docText.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    // Row shape: | # | Шаг | Формула | Ключ конфига | Источник | Статус | Тест |
    const keyCell = cells[4];
    if (!keyCell || keyCell === '—' || keyCell === '-') continue;
    for (const m of keyCell.matchAll(/`([A-Za-z][A-Za-z0-9_]*)`/g)) claimed.add(m[1]);
  }

  for (const key of [...claimed].sort()) {
    if (known.has(key)) continue;
    errors.push(
      `docs/combat-formula.md claims a config key that does not exist in config/*.json: ${key}\n` +
        `  Fix: add the key to the matching config/*.json, or correct the name in the document.`,
    );
  }
  return { errors, warnings: [] };
}