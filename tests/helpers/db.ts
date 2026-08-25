import { eq } from 'drizzle-orm';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getDb, closeDb, schema } from '@/db/client';
import { env } from '@/lib/env';
import { AGENT_CATALOG } from '@/agents/catalog';
import { hashPassword } from '@/auth/password';

/**
 * Test database harness.
 *
 * Every test file gets a real, disposable PostgreSQL database (embedded PGlite)
 * with the production migrations applied and the agent catalog seeded. Nothing at
 * the persistence layer is mocked: tests exercise the same schema and the same
 * Drizzle queries as production.
 *
 * Environment configuration happens in `tests/setup.ts`, which Vitest runs before
 * any module is imported. This harness only reads it.
 */

export type TestContext = {
  workDir: string;
  organizationId: string;
  userId: string;
};

export async function createTestDatabase(): Promise<TestContext> {
  const workDir = mkdtempSync(path.join(tmpdir(), 'aicore-case-'));

  // Apply the real migrations with the project's own migrator, so a test can
  // never pass against a schema that production does not have.
  execFileSync(
    process.execPath,
    [
      path.resolve(import.meta.dirname, '../../node_modules/tsx/dist/cli.mjs'),
      '--env-file-if-exists=.env.local',
      path.resolve(import.meta.dirname, '../../scripts/migrate.ts'),
    ],
    { stdio: 'pipe' },
  );

  const db = await getDb();

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [org] = await db
    .insert(schema.organizations)
    .values({ name: 'Test Org', slug: `test-${suffix}` })
    .returning();

  const [user] = await db
    .insert(schema.users)
    .values({
      organizationId: org!.id,
      email: `owner-${suffix}@test.local`,
      name: 'Test Owner',
      role: 'owner',
      passwordHash: hashPassword('test-password'),
    })
    .returning();

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
      })
      .onConflictDoNothing();
  }

  return { workDir, organizationId: org!.id, userId: user!.id };
}

export async function destroyTestDatabase(ctx: TestContext): Promise<void> {
  await closeDb().catch(() => undefined);
  rmSync(ctx.workDir, { recursive: true, force: true });
}

/**
 * Create a project whose sandbox lives under the SAME root the command runner
 * resolves from (`env.sandbox.root`). Using any other root would make the runner
 * look for a working directory that does not exist.
 */
export async function createTestProject(ctx: TestContext, name = 'Test Project') {
  const db = await getDb();
  const [project] = await db
    .insert(schema.projects)
    .values({
      organizationId: ctx.organizationId,
      name,
      slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Math.random().toString(36).slice(2, 7)}`,
      status: 'active',
    })
    .returning();

  const sandboxPath = path.join(env.sandbox.root, project!.id);
  mkdirSync(sandboxPath, { recursive: true });
  await db.update(schema.projects).set({ sandboxPath }).where(eq(schema.projects.id, project!.id));

  return { ...project!, sandboxPath };
}
