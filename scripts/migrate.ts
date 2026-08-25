import { readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { env } from '../src/lib/env';

/**
 * Driver-agnostic migration runner.
 *
 * drizzle-kit emits standard PostgreSQL SQL. This script applies those files in
 * journal order and records what has been applied, so it behaves identically
 * against embedded PGlite and a hosted PostgreSQL server.
 */

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'drizzle');

type SqlExecutor = {
  exec(sql: string): Promise<unknown>;
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  close(): Promise<void>;
};

async function createExecutor(): Promise<SqlExecutor> {
  if (env.database.driver === 'postgres') {
    if (!env.database.url) throw new Error('DATABASE_DRIVER=postgres requires DATABASE_URL');
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: env.database.url });
    return {
      exec: (sql) => pool.query(sql),
      query: async <T>(sql: string, params?: unknown[]) => {
        const res = await pool.query(sql, params as never[]);
        return { rows: res.rows as T[] };
      },
      close: () => pool.end(),
    };
  }

  const { PGlite } = await import('@electric-sql/pglite');
  mkdirSync(env.database.pgliteDataDir, { recursive: true });
  const client = new PGlite(env.database.pgliteDataDir);
  return {
    exec: (sql) => client.exec(sql),
    query: async <T>(sql: string, params?: unknown[]) => {
      const res = await client.query<T>(sql, params as never[]);
      return { rows: res.rows };
    },
    close: () => client.close(),
  };
}

type JournalEntry = { idx: number; tag: string; when: number };

async function main(): Promise<void> {
  if (!existsSync(MIGRATIONS_DIR)) {
    throw new Error(`No migrations directory at ${MIGRATIONS_DIR}. Run: npm run db:generate`);
  }

  const journalPath = path.join(MIGRATIONS_DIR, 'meta', '_journal.json');
  if (!existsSync(journalPath)) {
    throw new Error(`Missing migration journal at ${journalPath}`);
  }

  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: JournalEntry[] };
  const entries = [...journal.entries].sort((a, b) => a.idx - b.idx);

  const exec = await createExecutor();
  try {
    await exec.exec(`
      CREATE TABLE IF NOT EXISTS __ai_core_migrations (
        tag text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    const applied = await exec.query<{ tag: string }>(
      'SELECT tag FROM __ai_core_migrations',
    );
    const appliedTags = new Set(applied.rows.map((r) => r.tag));

    let count = 0;
    for (const entry of entries) {
      if (appliedTags.has(entry.tag)) continue;
      const file = path.join(MIGRATIONS_DIR, `${entry.tag}.sql`);
      if (!existsSync(file)) {
        throw new Error(`Journal references missing migration file: ${file}`);
      }
      const sql = readFileSync(file, 'utf8');
      process.stdout.write(`applying ${entry.tag} ... `);
      await exec.exec(sql);
      await exec.query('INSERT INTO __ai_core_migrations (tag) VALUES ($1)', [entry.tag]);
      process.stdout.write('ok\n');
      count += 1;
    }

    if (count === 0) {
      console.log(`migrations up to date (${entries.length} total)`);
    } else {
      console.log(`applied ${count} migration(s), ${entries.length} total`);
    }

    // Sanity check: report the table count so a "successful" migration that
    // silently created nothing is impossible to miss.
    const tables = await exec.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );
    console.log(`public tables present: ${tables.rows[0]?.count ?? '0'}`);
  } finally {
    await exec.close();
  }

  // List any stray .sql files not in the journal — a real drift signal.
  const journalTags = new Set(entries.map((e) => `${e.tag}.sql`));
  const stray = readdirSync(MIGRATIONS_DIR).filter(
    (f) => f.endsWith('.sql') && !journalTags.has(f),
  );
  if (stray.length > 0) {
    console.warn(`WARNING: ${stray.length} migration file(s) not in journal: ${stray.join(', ')}`);
  }
}

main().catch((error) => {
  console.error('migration failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
