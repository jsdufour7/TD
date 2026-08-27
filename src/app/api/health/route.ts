import { eq, sql } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { env } from '@/lib/env';
import { jsonOk } from '@/lib/api';
import { ensurePlatformReady } from '@/platform/boot';

/**
 * Deployment health — the first URL to open when a hosted install misbehaves.
 *
 * Deliberately unauthenticated and deliberately boring: counts, booleans and
 * non-secret configuration only. A hosted deployment that cannot reach its
 * database is otherwise indistinguishable from a broken button, and the only way
 * to tell them apart from the outside is an endpoint that says so. No credential,
 * connection string or user data is ever included.
 */
export const dynamic = 'force-dynamic';

type Report = {
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

export async function GET(): Promise<Response> {
  const startedAt = Date.now();

  const report: Report = {
    ok: false,
    app: {
      env: env.appEnv,
      node: process.version,
      platform: process.platform,
      // Serverless hosts define at least one of these.
      serverless: Boolean(
        process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY,
      ),
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
    const message = error instanceof Error ? error.message : String(error);
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
      providersOnline: providers.filter((p) => p.healthStatus === 'online').length,
      models: models.length,
    };

    if (report.database.tables < 40) {
      report.problems.push(`Only ${report.database.tables} tables exist — migrations did not run.`);
    }
    if (!report.bootstrap.adminPresent) {
      report.problems.push(
        `No administrator at ${env.bootstrap.email}. Set AI_CORE_BOOTSTRAP_EMAIL / AI_CORE_BOOTSTRAP_PASSWORD and redeploy.`,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
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
    if (report.app.serverless && env.runEngine.enabled) {
      report.problems.push(
        'RUN_ENGINE_ENABLED=true on a serverless host: autonomous runs need a long-lived worker. Disable it here and run the worker on a persistent host.',
      );
    }
  }

  report.ok = report.problems.length === 0;
  report.durationMs = Date.now() - startedAt;

  return jsonOk(report);
}
