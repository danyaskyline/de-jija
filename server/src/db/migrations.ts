/**
 * Database schema (migrations).
 *
 * Migrations are plain SQL, numbered, and applied once in order. They are the
 * history of the database structure: never edit an applied one, add a new file.
 *
 * The first migration creates what the arena needs:
 *  - players   - one row per account (ADR 027);
 *  - invites   - one-time registration links the author hands out.
 *
 * Passwords are NOT stored here: only a hash (see server/src/auth/password.ts).
 */

import { query } from './db';

/** Applied migrations are remembered by number, so nothing runs twice. */
const MIGRATIONS: { id: number; name: string; sql: string }[] = [
  {
    id: 1,
    name: 'players and invites',
    sql: `
      CREATE TABLE IF NOT EXISTS players (
        id            SERIAL PRIMARY KEY,
        -- Lowercase email: "Bob@Mail.ru" and "bob@mail.ru" are the same account.
        email         TEXT NOT NULL UNIQUE,
        -- scrypt hash and its salt. The password itself is never stored.
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        -- Chosen hero template id from config/hero-types.json.
        hero_type_id  TEXT,
        -- Charisma pool the player can spend on hiring units.
        charisma      INTEGER NOT NULL DEFAULT 0,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS invites (
        -- The token itself is what the author hands out, so it is the primary key.
        token       TEXT PRIMARY KEY,
        -- Optional note for the author: who this invite was meant for.
        note        TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        -- NULL = still open, set when somebody registers with it.
        used_at     TIMESTAMPTZ,
        used_by     INTEGER REFERENCES players(id)
      );

      CREATE INDEX IF NOT EXISTS invites_open_idx ON invites (created_at) WHERE used_at IS NULL;
    `,
  },
];

/** Creates the bookkeeping table. Safe to call every time. */
async function ensureMigrationsTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          INTEGER PRIMARY KEY,
      name        TEXT NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

/** Applies every migration that has not run yet, in order. */
export async function runMigrations(): Promise<number[]> {
  await ensureMigrationsTable();

  const rows = await query<{ id: number }>('SELECT id FROM schema_migrations');
  const applied = new Set(rows.map((row) => row.id));
  const justApplied: number[] = [];

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) {
      continue;
    }

    await query(migration.sql);
    await query('INSERT INTO schema_migrations (id, name) VALUES ($1, $2)', [
      migration.id,
      migration.name,
    ]);
    justApplied.push(migration.id);
  }

  return justApplied;
}

/** How many migrations the code knows about, and how many the database has. */
export async function migrationStatus(): Promise<{ total: number; applied: number }> {
  const rows = await query<{ count: string }>(
    'SELECT count(*)::text AS count FROM schema_migrations',
  );

  return { total: MIGRATIONS.length, applied: Number(rows[0]?.count ?? 0) };
}

/** Drops everything the migrations created. Only for tests. */
export async function dropAll(): Promise<void> {
  await query('DROP TABLE IF EXISTS invites');
  await query('DROP TABLE IF EXISTS players');
  await query('DROP TABLE IF EXISTS schema_migrations');
}
