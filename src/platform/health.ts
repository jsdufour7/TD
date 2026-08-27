import { eq, sql } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { env, redactSecrets } from '@/lib/env';
import { ensurePlatformReady } from '@/platform/boot';

export type PublicHealthReport = {
  ok: boolean;
  status: 'ok' | 'degraded';
  database: { reachable: boolean };
  durationMs: number;
};

export type DetailedHealthReport = {
  ok: boolean;
  app: {
    env: string;
    node: string;
    platform: string;
    serverless: boolean;
    vercel: { env: string | null; region: string | null } | null;
  };
  database: {
    driver: string;
    reachable: boolean;
    error: string | null;
    tables: number;
    migrationsApplied: number;
  };
  bootstrap: {
    organizations: number;
    users: number;
    adminPresent: boolean;
    agentDefinitions: number;
  };
  gateway: { providers: number; providersOnline: number; models: number };
  runEngine: { enabled: boolean; note: string };
  problems: string[];
  durationMs: number;
};

function isServerlessHost(): boolean {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);
}

function safeError(error: unknown): string {
  return redactSecrets(error instanceof Error ? error.message : String(error));
}

function hasKnownProductionMisconfiguration(): boolean {
  return Boolean(
    env.isProduction &&
      (env.database.driver === 'pglite' || (isServerlessHost() && env.runEngine.enabled)),
  );
}

/**
 * Public readiness surface.
 *
 * Deliberately minimal: proves the app can boot and query its DB, without
 * disclosing versions, infrastructure topology, counts, provider configuration,
 * administrator state, or internal error strings.
 */
export async function collectPublicHealthReport(): Promise<PublicHealthReport> {
  const startedAt = Date.now();
  let reachable = false;

  try {
    await ensurePlatformReady();
    const db = await getDb();
    await db.execute(sql`SELECT 1`);
    reachable = true;
  } catch {
    reachable = false;
  }

  const ok = reachable && !hasKnownProductionMisconfiguration();
  return {
    ok,
    status: ok ? 'ok' : 'degraded',
    database: { reachable },
    durationMs: Date.now() - startedAt,
  };
}

/** Full deployment diagnostic. Callers MUST authorize an administrator first. */
export async function collectDetailedHealthReport(): Promise<DetailedHealthReport> {
  const startedAt = Date.now();
  const serverless = isServerlessHost();

  const report: DetailedHealthReport = {
    ok: false,
    app: {
      env: env.appEnv,
      node: process.version,
      platform: process.platform,
      serverless,
      vercel: process.env.VERCEL
        ? { env: process.env.VERCEL_ENV ?? null, region: process.env.VERCEL_REGION ?? null }
        : null,
    },
    database: {
      driver: env.database.driver,
      reachable: false,
      error: null,
      tables: 0,
      migrationsApplied: 0,
    },
    bootstrap: { organizations: 0, users: 0, adminPresent: false, agentDefinitions: 0 },
    gateway: { providers: 0, providersOnline: 0, models: 0 },
    runEngine: {
      enabled: env.runEngine.enabled,
      note: env.runEngine.enabled
        ? 'In-process worker: it only makes progress on a host with a long-lived process. On serverless it freezes with the function.'
        : 'Disabled by RUN_ENGINE_ENABLED=false.',
    },
    problems: [],
    durationMs: 0,
  };

  try {
    await ensurePlatformReady();
  } catch (error) {
    const message = safeError(error);
    report.database.error = message;
    report.problems.push(`Platform boot failed: ${message}`);
  }

  try {
    const db = await getDb();

    const tables = await db.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );
    report.database.tables = Number(tables.rows?.[0]?.count ?? 0);

    const migrations = await db
      .execute<{ count: string }>(sql`SELECT count(*)::text AS count FROM __ai_core_migrations`)
      .catch(() => null);
    report.database.migrationsApplied = Number(migrations?.rows?.[0]?.count ?? 0);
    report.database.reachable = true;

    const [orgs, users, agents, admin] = await Promise.all([
      db.select({ id: schema.organizations.id }).from(schema.organizations),
      db.select({ id: schema.users.id }).from(schema.users),
      db.select({ key: schema.agentDefinitions.key }).from(schema.agentDefinitions),
      db
        .select({ email: schema.users.email })
        .from(schema.users)
        .where(eq(schema.users.email, env.bootstrap.email))
        .limit(1),
    ]);

    report.bootstrap = {
      organizations: orgs.length,
      users: users.length,
      adminPresent: admin.length > 0,
      agentDefinitions: agents.length,
    };

    const providers = await db.select().from(schema.modelProviders);
    const models = await db.select({ id: schema.modelDefinitions.id }).from(schema.modelDefinitions);
    report.gateway = {
      providers: providers.length,
      providersOnline: providers.filter((provider) => provider.healthStatus === 'online').length,
      models: models.length,
    };

    if (report.database.tables < 40) {
      report.problems.push(`Only ${report.database.tables} tables exist â€” migrations did not run.`);
    }
    if (!report.bootstrap.adminPresent) {
      report.problems.push(
        'No bootstrap administrator is present. Set AI_CORE_BOOTSTRAP_EMAIL / AI_CORE_BOOTSTRAP_PASSWORD and redeploy.',
      );
    }
  } catch (error) {
    const message = safeError(error);
    report.database.reachable = false;
    report.database.error = message;
    report.problems.push(`Database unreachable: ${message}`);
  }

  if (env.isProduction) {
    if (env.database.driver === 'pglite') {
      report.problems.push(
        'DATABASE_DRIVER=pglite in production: PGlite writes to the local disk, which is read-only or ephemeral on serverless hosts. Set DATABASE_DRIVER=postgres with a DATABASE_URL.',
      );
    }
    if (serverless && env.runEngine.enabled) {
      report.problems.push(
        'RUN_ENGINE_ENABLED=true on a serverless host: autonomous runs need a long-lived worker. Disable it here and run the worker on a persistent host.',
      );
    }
  }

  report.ok = report.problems.length === 0;
  report.durationMs = Date.now() - startedAt;
  return report;
}
