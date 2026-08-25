import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { createTestDatabase, createTestProject, destroyTestDatabase, type TestContext } from '../helpers/db';
import { createObjective, transitionObjective, isValidTransition } from '@/engine/objectives';
import { classifyIntent, buildPlanSteps, handleCooMessage } from '@/engine/coo';
import { AppError } from '@/lib/errors';

/**
 * Executive runtime: objectives, plans, autonomy, and the COO conversation.
 */
describe('objective state machine', () => {
  let ctx: TestContext;
  let project: Awaited<ReturnType<typeof createTestProject>>;

  beforeAll(async () => {
    ctx = await createTestDatabase();
    project = await createTestProject(ctx, 'Executive Demo');
  }, 180_000);

  afterAll(async () => {
    await destroyTestDatabase(ctx);
  });

  it('allows legal transitions and rejects illegal ones', () => {
    expect(isValidTransition('draft', 'planning')).toBe(true);
    expect(isValidTransition('active', 'completed')).toBe(true);
    expect(isValidTransition('completed', 'active')).toBe(false);
    expect(isValidTransition('draft', 'completed')).toBe(false);
  });

  it('enforces transitions in the database and throws on invalid', async () => {
    const objective = await createObjective({ projectId: project.id, title: 'Test objective' });
    expect(objective.status).toBe('draft');

    const planning = await transitionObjective(objective.id, 'planning', 'test');
    expect(planning.status).toBe('planning');

    await expect(transitionObjective(objective.id, 'completed')).rejects.toThrowError(AppError);
  });
});

describe('COO intent + planning', () => {
  it('classifies questions vs operational directives', () => {
    expect(classifyIntent('Où en est le projet ?')).toBe('question');
    expect(classifyIntent('what is the status?')).toBe('question');
    expect(classifyIntent('Termine la V1 de AI Core')).toBe('operational');
    expect(classifyIntent('fix the auth bug')).toBe('operational');
  });

  it('builds a dependency-ordered plan', () => {
    const { steps } = buildPlanSteps('Implement a settings page');
    expect(steps.length).toBeGreaterThanOrEqual(3);
    // First step has no dependency; later steps depend on earlier ones.
    expect(steps[0]!.dependsOn).toEqual([]);
    const verify = steps.find((s) => s.agentKey === 'qa-engineer');
    expect(verify).toBeTruthy();
  });
});

describe('COO autonomous execution', () => {
  let ctx: TestContext;
  let project: Awaited<ReturnType<typeof createTestProject>>;

  beforeAll(async () => {
    ctx = await createTestDatabase();
    project = await createTestProject(ctx, 'Coo Demo');
  }, 180_000);

  afterAll(async () => {
    await destroyTestDatabase(ctx);
  });

  it('answers a question without creating work', async () => {
    const result = await handleCooMessage({ projectId: project.id, text: 'Où en est le projet ?' });
    expect(result.kind).toBe('answer');
    const db = await getDb();
    const objectives = await db.select().from(schema.objectives).where(eq(schema.objectives.projectId, project.id));
    expect(objectives.length).toBe(0);
  });

  it('creates objective + plan + linked tasks for an operational directive', async () => {
    const result = await handleCooMessage({
      projectId: project.id,
      text: 'Inspecte et avance sur la priorité.',
      autonomyMode: 'autonomous',
    });
    expect(result.kind).toBe('executed');
    if (result.kind !== 'executed') return;

    const db = await getDb();
    const objective = (await db.select().from(schema.objectives).where(eq(schema.objectives.id, result.objectiveId)).limit(1))[0]!;
    expect(objective.status).toBe('active');
    expect(objective.autonomyMode).toBe('autonomous');

    const tasks = await db.select().from(schema.tasks).where(eq(schema.tasks.runId, result.runId));
    expect(tasks.length).toBe(result.tasks.length);
    // Every task is linked to the objective and plan and marked COO-created.
    for (const task of tasks) {
      expect(task.objectiveId).toBe(result.objectiveId);
      expect(task.planId).toBe(result.planId);
      expect(task.createdByType).toBe('coo');
    }
    // Dependencies were recorded.
    const deps = await db.select().from(schema.taskDependencies);
    expect(deps.length).toBeGreaterThan(0);
  });

  it('manual mode only advises and never executes', async () => {
    const before = await (await getDb()).select().from(schema.objectives).where(eq(schema.objectives.projectId, project.id));
    const result = await handleCooMessage({
      projectId: project.id,
      text: 'Implémente une page de paramètres.',
      autonomyMode: 'manual',
    });
    expect(result.kind).toBe('answer');
    const after = await (await getDb()).select().from(schema.objectives).where(eq(schema.objectives.projectId, project.id));
    expect(after.length).toBe(before.length);
  });
});
