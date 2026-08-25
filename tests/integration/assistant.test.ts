import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, createTestProject, destroyTestDatabase, type TestContext } from '../helpers/db';
import { getDb, schema } from '@/db/client';
import { gatherBrief, deterministicReply } from '@/agents/assistant';

/**
 * The chat / meeting-room assistant must answer from real project data and never
 * fabricate. Without a provider it is deterministic; these tests pin that.
 */
describe('assistant', () => {
  let ctx: TestContext;
  let project: Awaited<ReturnType<typeof createTestProject>>;

  beforeAll(async () => {
    ctx = await createTestDatabase();
    project = await createTestProject(ctx, 'Assistant Demo');

    // Real data the assistant should report.
    const db = await getDb();
    await db.insert(schema.agentRuns).values({
      projectId: project.id,
      title: 'A failed run',
      objective: 'x',
      status: 'failed',
      error: 'typecheck failed with 2 errors',
    });
    await db.insert(schema.tasks).values({
      projectId: project.id,
      title: 'Implement auth',
      status: 'blocked',
      blockedReason: 'Needs a model provider',
      acceptanceCriteria: [],
    });
  }, 180_000);

  afterAll(async () => {
    await destroyTestDatabase(ctx);
  });

  it('gathers a real brief from the database', async () => {
    const brief = await gatherBrief(project.id);
    expect(brief.runs.failed).toBe(1);
    expect(brief.lastFailure?.error).toContain('typecheck failed');
    expect(brief.blockedTasks).toHaveLength(1);
    expect(brief.blockedTasks[0]!.reason).toContain('model provider');
  });

  it('answers status from real data (fr + en)', async () => {
    const brief = await gatherBrief(project.id);
    const fr = deterministicReply('coo', brief, 'Quel est l état du projet?');
    const en = deterministicReply('coo', brief, 'what is the status?');
    expect(fr).toContain('1');
    expect(fr).toContain('bloquée');
    expect(en).toBeTruthy();
  });

  it('explains the last failure with its recorded cause', async () => {
    const brief = await gatherBrief(project.id);
    const reply = deterministicReply('coo', brief, 'pourquoi ça a échoué?');
    expect(reply).toContain('typecheck failed');
  });

  it('reports blocked tasks and their reasons', async () => {
    const brief = await gatherBrief(project.id);
    const reply = deterministicReply('coo', brief, 'what is blocked?');
    expect(reply).toContain('Implement auth');
    expect(reply).toContain('model provider');
  });

  it('returns null (needs a model) for free-form questions', async () => {
    const brief = await gatherBrief(project.id);
    expect(deterministicReply('coo', brief, 'propose une architecture pour le paiement')).toBeNull();
  });
});
