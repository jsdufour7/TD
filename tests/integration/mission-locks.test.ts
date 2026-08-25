import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { createTestDatabase, createTestProject, destroyTestDatabase, type TestContext } from '../helpers/db';
import { tryAcquireLock, releaseLock, withIdempotency } from '@/engine/locks';
import { superviseObjective } from '@/engine/mission';
import { createObjective, transitionObjective } from '@/engine/objectives';

describe('concurrency safeguards', () => {
  let ctx: TestContext;
  let project: Awaited<ReturnType<typeof createTestProject>>;

  beforeAll(async () => {
    ctx = await createTestDatabase();
    project = await createTestProject(ctx, 'Locks Demo');
  }, 180_000);

  afterAll(async () => {
    await destroyTestDatabase(ctx);
  });

  it('an exclusive lock blocks a second holder, then frees', () => {
    const name = `file:src/a.ts-${Date.now()}`;
    expect(tryAcquireLock(project.id, name)).toBe(true);
    expect(tryAcquireLock(project.id, name)).toBe(false); // second holder refused
    releaseLock(project.id, name);
    expect(tryAcquireLock(project.id, name)).toBe(true); // freed
    releaseLock(project.id, name);
  });

  it('withIdempotency runs at most once per key', async () => {
    let calls = 0;
    const key = `task-x-${Date.now()}`;
    const first = await withIdempotency(project.id, key, async () => {
      calls += 1;
      return { done: true };
    });
    const second = await withIdempotency(project.id, key, async () => {
      calls += 1;
      return { done: true };
    });
    expect(first.ran).toBe(true);
    expect(second.ran).toBe(false);
    expect(calls).toBe(1);
  });
});

describe('mission mode supervisor', () => {
  let ctx: TestContext;
  let project: Awaited<ReturnType<typeof createTestProject>>;

  beforeAll(async () => {
    ctx = await createTestDatabase();
    project = await createTestProject(ctx, 'Mission Demo');
  }, 180_000);

  afterAll(async () => {
    await destroyTestDatabase(ctx);
  });

  async function addRun(objectiveId: string) {
    const db = await getDb();
    const [run] = await db
      .insert(schema.agentRuns)
      .values({ projectId: project.id, objectiveId, title: 'run', objective: 'x', status: 'completed' })
      .returning();
    return run!;
  }

  it('completes the objective when all tasks are completed', async () => {
    const objective = await createObjective({ projectId: project.id, title: 'All done', autonomyMode: 'mission' });
    await transitionObjective(objective.id, 'planning');
    await transitionObjective(objective.id, 'active');
    await addRun(objective.id);
    const db = await getDb();
    await db.insert(schema.tasks).values({ projectId: project.id, objectiveId: objective.id, title: 't', status: 'completed', acceptanceCriteria: [] });

    const result = await superviseObjective(objective.id);
    expect(result?.action).toBe('completed');
    const after = (await db.select().from(schema.objectives).where(eq(schema.objectives.id, objective.id)).limit(1))[0]!;
    expect(after.status).toBe('completed');
  });

  it('surfaces a human decision when a task is blocked on a provider', async () => {
    const objective = await createObjective({ projectId: project.id, title: 'Needs provider', autonomyMode: 'mission' });
    await transitionObjective(objective.id, 'planning');
    await transitionObjective(objective.id, 'active');
    await addRun(objective.id);
    const db = await getDb();
    await db.insert(schema.tasks).values({
      projectId: project.id,
      objectiveId: objective.id,
      title: 'implement',
      status: 'blocked',
      blockedReason: 'Needs a model provider',
      acceptanceCriteria: [],
    });

    const result = await superviseObjective(objective.id);
    expect(result?.action).toBe('awaiting_user');
    const after = (await db.select().from(schema.objectives).where(eq(schema.objectives.id, objective.id)).limit(1))[0]!;
    expect(after.status).toBe('awaiting_user');
  });

  it('replans into a corrective run when a task failed (not human-blocked)', async () => {
    const objective = await createObjective({ projectId: project.id, title: 'Retry loop', autonomyMode: 'mission' });
    await transitionObjective(objective.id, 'planning');
    await transitionObjective(objective.id, 'active');
    await addRun(objective.id);
    const db = await getDb();
    await db.insert(schema.tasks).values({
      projectId: project.id,
      objectiveId: objective.id,
      title: 'flaky',
      status: 'failed',
      acceptanceCriteria: [],
    });

    const runsBefore = (await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.objectiveId, objective.id))).length;
    const result = await superviseObjective(objective.id);
    expect(result?.action).toBe('continue');

    const runsAfter = (await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.objectiveId, objective.id))).length;
    expect(runsAfter).toBe(runsBefore + 1); // a corrective run was launched

    // The corrective run carries a "Retry:" task.
    const tasks = await db.select().from(schema.tasks).where(eq(schema.tasks.objectiveId, objective.id));
    expect(tasks.some((t) => t.title.startsWith('Retry:'))).toBe(true);
  });

  it('ignores objectives not in an autonomous mode', async () => {
    const objective = await createObjective({ projectId: project.id, title: 'Manual', autonomyMode: 'manual' });
    const result = await superviseObjective(objective.id);
    expect(result).toBeNull();
  });
});
