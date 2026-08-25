import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit generates standard SQL migrations against the PostgreSQL dialect.
 * The same migration files are applied by scripts/migrate.ts to either driver.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  strict: true,
  verbose: false,
});
