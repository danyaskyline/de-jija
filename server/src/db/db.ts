/**
 * PostgreSQL access - the ONE place in the project where SQL lives.
 *
 * Rules (docs/conventions.md, "Data vs code"):
 *  - every query is written here, nowhere else. Other modules ask this layer
 *    for rows and get plain objects back, they never build SQL themselves;
 *  - the connection string comes from the environment (DATABASE_URL), never
 *    from a hardcoded password in the repo;
 *  - the pool is created lazily and reused, so tests can point it at their own
 *    database and the server opens one pool, not one per query.
 */

import pg from 'pg';

const { Pool } = pg;

/** Settings used when DATABASE_URL is not set: local dev PostgreSQL. */
const LOCAL_DEFAULTS = {
  host: '127.0.0.1',
  port: 5432,
  user: 'dejija_app',
  database: 'dejija',
};

let pool: pg.Pool | null = null;

/**
 * Connection settings from the environment.
 *
 * DATABASE_URL wins when set (that is what the hosting will use). Otherwise we
 * fall back to the local development database.
 */
export function dbConfig(): pg.PoolConfig {
  const url = process.env.DATABASE_URL;

  if (url) {
    return { connectionString: url };
  }

  return {
    ...LOCAL_DEFAULTS,
    password: process.env.DATABASE_PASSWORD ?? 'dev_only_local',
  };
}

/** True when the settings point at localhost - used to relax test assumptions. */
export function isLocalDatabase(): boolean {
  if (process.env.DATABASE_URL) {
    return /@(localhost|127\.0\.0\.1)/.test(process.env.DATABASE_URL);
  }

  return true;
}

/** The shared pool, created on first use. */
export function getPool(): pg.Pool {
  if (pool === null) {
    pool = new Pool({ ...dbConfig(), max: 10 });
  }

  return pool;
}

/** Closes the pool. Used by tests and on server shutdown. */
export async function closePool(): Promise<void> {
  if (pool !== null) {
    await pool.end();
    pool = null;
  }
}

/**
 * Runs one query and returns the rows.
 *
 * Uses parameterized queries everywhere ($1, $2) - the values never become part
 * of the SQL text, so a nickname like "; DROP TABLE players" is just a string.
 */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const result = await getPool().query<T>(text, values);

  return result.rows;
}

/** Runs one query and returns the first row, or null when there is none. */
export async function queryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, values);

  return rows.length > 0 ? rows[0] : null;
}

/**
 * Runs a callback inside a transaction: everything commits, or everything rolls
 * back. Used when several changes must succeed or fail together.
 */
export async function withTransaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();

  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');

    return result;
  } catch (error) {
    await client.query('ROLLBACK');

    throw error;
  } finally {
    client.release();
  }
}

/**
 * Checks that the database answers. Called once at server startup so a wrong
 * connection string stops the server with a clear message instead of failing
 * later, in the middle of a battle.
 */
export async function checkConnection(): Promise<void> {
  await getPool().query('SELECT 1');
}

