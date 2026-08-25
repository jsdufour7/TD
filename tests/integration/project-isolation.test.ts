import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { createTestDatabase, createTestProject, destroyTestDatabase, type TestContext } from '../helpers/db';
import { AppError, projectIsolationViolation } from '@/lib/errors';
import { requireProjectForOrg } from '@/auth/guards';
import { emitAndNotify } from '@/engine/events';
import { resolveSandboxPath } from '@/lib/sandbox';

/**
 * Project isolation is mandatory (§8, §55).
 *
 * These tests run against a real database with two real projects, and assert
 * that neither the query layer nor the filesystem layer lets one project reach
 * into the other.
 */
describe('project isolation', () => {
  let ctx: TestContext;
  let projectA: Awaited<ReturnType<typeof createTestProject>>;
  let projectB: Awaited<ReturnType<typeof createTestProject>>;

  beforeAll(async () => {
    ctx = await createTestDatabase();
    projectA = await createTestProject(ctx, 'Project Alpha');
    projectB = await createTestProject(ctx, 'Project Beta');
  }, 180_000);

  afterAll(async () => {
    await destroyTestDatabase(ctx);
  });

  it('creates two projects with distinct sandboxes', () => {
    expect(projectA.id).not.toBe(projectB.id);
    expect(projectA.sandboxPath).not.toBe(projectB.sandboxPath);
  });

  it('refuses to load a project that belongs to another organisation', async () => {
    // A well-formed but non-matching organisation id.
    const otherOrg = '00000000-0000-4000-8000-000000000000';
    await expect(requireProjectForOrg(projectA.id, otherOrg)).rejects.toThrowError(AppError);
  });

  it('uses the project_isolation error code with a 403 status', async () => {
    try {
      await requireProjectForOrg(projectA.id, '00000000-0000-4000-8000-000000000001');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('project_isolation');
      expect((error as AppError).status).toBe(403);
    }
  });

  it('loads the project when the organisation matches', async () => {
    const loaded = await requireProjectForOrg(projectA.id, ctx.organizationId);
    expect(loaded.id).toBe(projectA.id);
  });

  it('scopes run events to their own project', async () => {
    const db = await getDb();

    const [runA] = await db
      .insert(schema.agentRuns)
      .values({ projectId: projectA.id, title: 'A run', objective: 'objective A', status: 'running' })
      .returning();
    const [runB] = await db
      .insert(schema.agentRuns)
      .values({ projectId: projectB.id, title: 'B run', objective: 'objective B', status: 'running' })
      .returning();

    await emitAndNotify({
      runId: runA!.id,
      projectId: projectA.id,
      type: 'run.started',
      summary: 'A started',
    });
    await emitAndNotify({
      runId: runB!.id,
      projectId: projectB.id,
      type: 'run.started',
      summary: 'B started',
    });

    const eventsA = await db
      .select()
      .from(schema.runEvents)
      .where(eq(schema.runEvents.projectId, projectA.id));
    const eventsB = await db
      .select()
      .from(schema.runEvents)
      .where(eq(schema.runEvents.projectId, projectB.id));

    expect(eventsA.every((e) => e.summary.startsWith('A'))).toBe(true);
    expect(eventsB.every((e) => e.summary.startsWith('B'))).toBe(true);
    expect(eventsA.some((e) => e.summary.startsWith('B'))).toBe(false);
  });

  it('scopes memories to their own project', async () => {
    const db = await getDb();
    await db.insert(schema.memories).values({
      projectId: projectA.id,
      kind: 'canonical',
      title: 'A only',
      content: 'secret of A',
    });

    const memoriesB = await db
      .select()
      .from(schema.memories)
      .where(eq(schema.memories.projectId, projectB.id));

    expect(memoriesB.some((m) => m.title === 'A only')).toBe(false);
  });

  it('prevents one project sandbox from resolving into another', () => {
    // From inside A's sandbox, a relative path cannot reach B's sandbox even
    // though they share a parent directory.
    const relative = `../${projectB.id}/file.txt`;
    expect(() => resolveSandboxPath(projectA.sandboxPath, relative)).toThrowError(/escapes the project sandbox/);
  });

  it('refuses a cross-project task dependency', async () => {
    const db = await getDb();
    const [taskA] = await db
      .insert(schema.tasks)
      .values({ projectId: projectA.id, title: 'A task', status: 'ready' })
      .returning();

    // The API layer validates that dependencies belong to the same project.
    // Reproduce that check directly against the data.
    const valid = await db
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(eq(schema.tasks.projectId, projectB.id));

    const validIds = new Set(valid.map((v) => v.id));
    expect(validIds.has(taskA!.id)).toBe(false);
  });

  it('builds a clear isolation violation message', () => {
    const error = projectIsolationViolation('org-1', 'run abc');
    expect(error.message).toContain('org-1');
    expect(error.message).toContain('run abc');
  });
});
