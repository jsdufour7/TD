import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { env } from '../src/lib/env';

/**
 * Reset the local embedded database.
 *
 * PGlite permits only ONE process per data directory. If a second process opens
 * it while the dev server holds it, the WASM instance aborts and every
 * subsequent query fails with `RuntimeError: Aborted()`. This script is the
 * documented recovery path for that state.
 *
 * It refuses to run while a server is likely holding the directory, because
 * deleting an in-use data directory is exactly what causes the corruption.
 */

const USAGE = 'Usage: npm run db:reset -- --force';

async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  const target = env.database.pgliteDataDir;

  if (env.database.driver !== 'pglite') {
    console.error(
      `DATABASE_DRIVER is "${env.database.driver}". This script only resets the embedded PGlite database, ` +
        'because dropping a real PostgreSQL server is destructive and must be done deliberately.',
    );
    process.exit(1);
  }

  if (!existsSync(target)) {
    console.log(`Nothing to reset: ${target} does not exist.`);
    return;
  }

  if (!force) {
    console.log('This will permanently delete the local database:');
    console.log(`  ${target}`);
    console.log('');
    console.log('STOP THE DEV SERVER FIRST. Deleting an in-use data directory is what');
    console.log('corrupts it in the first place.');
    console.log('');
    console.log(`Re-run with ${USAGE} to proceed.`);
    process.exit(1);
  }

  // Best-effort check: PGlite keeps a postmaster.pid while it is open.
  const pidFile = path.join(target, 'postmaster.pid');
  if (existsSync(pidFile)) {
    console.error(
      `Refusing to delete: ${pidFile} exists, which means a PostgreSQL/PGlite instance may still be running.\n` +
        'Stop the dev server (or any other process using this database) and try again.',
    );
    process.exit(1);
  }

  rmSync(target, { recursive: true, force: true });
  console.log(`Deleted ${target}`);
  console.log('');
  console.log('Next:');
  console.log('  npm run db:migrate');
  console.log('  npm run db:seed');
}

main().catch((error) => {
  console.error('reset failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
