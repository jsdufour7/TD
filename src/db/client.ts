import { mkdirSync } from 'node:fs';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import type { PGlite } from '@electric-sql/pglite';
import { env } from '@/lib/env';
import * as schema from './schema';

/**
 * Database access.
 *
 * Two drivers, one schema. `pglite` runs a genuine PostgreSQL 18 engine compiled
 * to WebAssembly — real SQL, relations, constraints and transactions — with no
 * external service. `postgres` connects to a real server via node-postgres.
 *
 * The Drizzle schema is authored against `pg-core` in both cases, so moving from
 * embedded to hosted is a driver flag, not a rewrite. See ARCHITECTURE.md §4.
 */

export type Database = ReturnType<typeof drizzlePglite<typeof schema>>;
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

type State = {
  db: Database | null;
  pglite: PGlite | null;
  pending: Promise<Database> | null;
};

const globalState = globalThis as unknown as { __aiCoreDb?: State };
const state: State = (globalState.__aiCoreDb ??= { db: null, pglite: null, pending: null });

/**
 * PGlite allows exactly one process-level connection per data directory, and its
 * construction is async. Every caller therefore goes through this promise so a
 * burst of concurrent requests cannot open competing connections.
 */
export async function getDb(): Promise<Database> {
  if (state.db) return state.db;
  if (state.pending) return state.pending;

  state.pending = createDb().finally(() => {
    state.pending = null;
  });
  return state.pending;
}

async function createDb(): Promise<Database> {
  if (env.database.driver === 'postgres') {
    if (!env.database.url) {
      throw new Error('DATABASE_DRIVER=postgres requires DATABASE_URL to be set.');
    }
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: env.database.url, max: 10 });
    const db = drizzlePg(pool, { schema, logger: false }) as unknown as Database;
    state.db = db;
    return db;
  }

  const dir = env.database.pgliteDataDir;
  mkdirSync(dir, { recursive: true });

  const { PGlite } = await import('@electric-sql/pglite');
  // IMPORTANT: this path must match the one used by scripts/migrate.ts, which
  // reads the same env value. Both resolve env.database.pgliteDataDir verbatim.
  const pglite = new PGlite(dir, {
    // WAL keeps crash recovery; fsync on checkpoint keeps it honest.
    relaxedDurability: false,
  });
  state.pglite = pglite;

  const db = drizzlePglite(pglite, { schema, logger: false });
  state.db = db;
  return db;
}

/** Transaction helper that yields a Drizzle transaction and always settles. */
export async function withTransaction<T>(
  work: (tx: Tx) => Promise<T>,
): Promise<T> {
  const db = await getDb();
  return db.transaction(async (tx) => work(tx as Tx));
}

export async function closeDb(): Promise<void> {
  if (state.pglite) {
    await state.pglite.close();
    state.pglite = null;
  }
  state.db = null;
}

export { schema };
