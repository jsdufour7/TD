import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { env } from '@/lib/env';
import { hashPassword } from '@/auth/password';
import { AGENT_CATALOG } from '@/agents/catalog';
import { createLogger } from '@/lib/logger';

const log = createLogger('bootstrap');

/**
 * First-run bootstrap.
 *
 * Runs migrations, then guarantees the platform has an organisation, an
 * administrator, the agent catalog and the integration registry. This is what
 * makes `npm run dev` produce a usable product with no manual setup step.
 *
 * It is idempotent and never writes demo project data.
 */

export async function bootstrapDatabase(): Promise<void> {
  await runMigrations();

  const db = await getDb();

  const orgs = await db
    .select()
    .from(schema.organizations)
    .where(eq(schema.organizations.slug, env.bootstrap.organizationSlug))
    .limit(1);

  let organization = orgs[0];
  if (!organization) {
    const created = await db
      .insert(schema.organizations)
      .values({ name: env.bootstrap.organizationName, slug: env.bootstrap.organizationSlug })
      .returning();
    organization = created[0];
    if (!organization) throw new Error('Failed to create the bootstrap organization');
    log.info(`created organization ${organization.slug}`);
  }

  const users = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, env.bootstrap.email))
    .limit(1);

  if (!users[0]) {
    await db.insert(schema.users).values({
      organizationId: organization.id,
      email: env.bootstrap.email,
      name: env.bootstrap.name,
      role: 'owner',
      passwordHash: hashPassword(env.bootstrap.password),
    });
    log.info(`created bootstrap administrator ${env.bootstrap.email}`);
  }

  for (const agent of AGENT_CATALOG) {
    await db
      .insert(schema.agentDefinitions)
      .values({
        key: agent.key,
        name: agent.name,
        role: agent.role,
        description: agent.description,
        systemInstructions: agent.systemInstructions,
        allowedTools: agent.allowedTools,
        permissions: agent.permissions,
        modelPolicy: agent.modelPolicy,
        temperature: agent.temperature,
        maxSteps: agent.maxSteps,
        maxConcurrency: agent.maxConcurrency,
        budgetTier: agent.budgetTier,
        accentColor: agent.accentColor,
        icon: agent.icon,
        sortOrder: agent.sortOrder,
        isActive: true,
      })
      .onConflictDoUpdate({
        target: schema.agentDefinitions.key,
        set: {
          name: agent.name,
          role: agent.role,
          description: agent.description,
          systemInstructions: agent.systemInstructions,
          allowedTools: agent.allowedTools,
          permissions: agent.permissions,
          modelPolicy: agent.modelPolicy,
          temperature: agent.temperature,
          maxSteps: agent.maxSteps,
          maxConcurrency: agent.maxConcurrency,
          budgetTier: agent.budgetTier,
          accentColor: agent.accentColor,
          icon: agent.icon,
          sortOrder: agent.sortOrder,
        },
      });
  }

  const integrations = await db.select({ key: schema.integrations.key }).from(schema.integrations);
  if (integrations.length === 0) {
    await db.insert(schema.integrations).values([
      {
        key: 'github',
        name: 'GitHub',
        status: env.github.token ? 'connected' : 'not_configured',
        message: env.github.token ? 'Token present' : 'Set GITHUB_TOKEN to connect',
      },
      {
        key: 'local_fs',
        name: 'Local Filesystem / Dev Bridge',
        status: 'connected',
        message: 'Always available. Confined to the project sandbox.',
      },
      {
        key: 'vercel',
        name: 'Vercel',
        status: 'not_configured',
        message: 'Deployment adapters are not implemented in V1 — see IMPLEMENTATION_STATUS.md',
      },
    ]);
  }

  log.info('database bootstrap complete');
}

/**
 * Apply any pending SQL migrations. Shares the journal-ordered logic with
 * scripts/migrate.ts but runs against the already-open client.
 */
async function runMigrations(): Promise<void> {
  const { readFileSync, readdirSync, existsSync, mkdirSync } = await import('node:fs');
  const path = await import('node:path');

  const migrationsDir = path.resolve(process.cwd(), 'drizzle');
  if (!existsSync(migrationsDir)) {
    log.warn('no migrations directory — run `npm run db:generate`');
    return;
  }

  const db = await getDb();
  const { sql } = await import('drizzle-orm');

  await db.execute(
    sql`CREATE TABLE IF NOT EXISTS __ai_core_migrations (tag text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
  );

  const applied = await db.execute<{ tag: string }>(sql`SELECT tag FROM __ai_core_migrations`);
  const appliedTags = new Set((applied.rows ?? []).map((r) => r.tag));

  const journalPath = path.join(migrationsDir, 'meta', '_journal.json');
  if (!existsSync(journalPath)) return;

  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: Array<{ idx: number; tag: string }>;
  };

  const entries = [...journal.entries].sort((a, b) => a.idx - b.idx);
  const journalTags = new Set(entries.map((e) => `${e.tag}.sql`));
  const stray = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql') && !journalTags.has(f));
  if (stray.length > 0) {
    log.warn(`migration files missing from the journal: ${stray.join(', ')}`);
  }

  for (const entry of entries) {
    if (appliedTags.has(entry.tag)) continue;
    const file = path.join(migrationsDir, `${entry.tag}.sql`);
    if (!existsSync(file)) {
      log.error(`journal references missing migration file: ${file}`);
      continue;
    }
    // Migration SQL is generated by drizzle-kit from our own schema. The driver
    // executes one statement per prepared call, so split on drizzle's breakpoint
    // marker and run each statement individually (a multi-statement prepared
    // statement fails with "cannot insert multiple commands").
    const statements = readFileSync(file, 'utf8')
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const statement of statements) {
      await db.execute(sql.raw(statement));
    }
    await db.execute(sql`INSERT INTO __ai_core_migrations (tag) VALUES (${entry.tag})`);
    log.info(`applied migration ${entry.tag}`);
  }

  if (env.database.driver === 'pglite') {
    mkdirSync(env.database.pgliteDataDir, { recursive: true });
  }
}
