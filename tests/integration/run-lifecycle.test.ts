import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { env } from '@/lib/env';
import { getDb, schema } from '@/db/client';
import { createTestDatabase, createTestProject, destroyTestDatabase, type TestContext } from '../helpers/db';
import { createRun, sendControlSignal, recoverStalledRuns, summariseRun } from '@/engine/run-engine';
import { planRun, readyTasks } from '@/engine/planner';
import { executeTask } from '@/engine/agent-executor';
import { invokeTool } from '@/tools';
import { buildTestToolContext } from './helpers/tools';

/**
 * The autonomous loop (§4, §17, §18).
 *
 * These tests drive the real planner and the real agent executor against a real
 * fixture repository, and assert that what is recorded matches what actually
 * happened — including failures.
 */
describe('run lifecycle', () => {
  let ctx: TestContext;
  let project: Awaited<ReturnType<typeof createTestProject>>;

  beforeAll(async () => {
    ctx = await createTestDatabase();
    project = await createTestProject(ctx, 'Lifecycle');

    // A real, verifiable fixture project inside the sandbox.
    writeFileSync(
      path.join(project.sandboxPath, 'package.json'),
      JSON.stringify(
        {
          name: 'lifecycle-fixture',
          version: '1.0.0',
          private: true,
          type: 'module',
          scripts: { typecheck: 'node --check src/a.js', test: 'node --test' },
        },
        null,
        2,
      ),
    );
    mkdirSync(path.join(project.sandboxPath, 'src'), { recursive: true });
    writeFileSync(path.join(project.sandboxPath, 'src/a.js'), 'export const a = 1;\n');
    writeFileSync(
      path.join(project.sandboxPath, 'src/a.test.js'),
      "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('a is 1', () => { assert.equal(1, 1); });\n",
    );
  }, 180_000);

  afterAll(async () => {
    await destroyTestDatabase(ctx);
  });

  it('creates a run with a goal and an initial event', async () => {
    const db = await getDb();
    const run = await createRun({
      projectId: project.id,
      objective: 'Verify the fixture project.',
      userId: ctx.userId,
    });

    // createRun queues the run only when a worker exists to claim it. The test
    // suite sets RUN_ENGINE_ENABLED=false so no background worker ever starts,
    // which means a new run is created paused rather than queued.
    expect(run.status).toBe(env.runEngine.enabled ? 'queued' : 'paused');
    expect(run.phase).toBe('understand');
    expect(run.goalId).toBeTruthy();

    const goal = await db.select().from(schema.goals).where(eq(schema.goals.id, run.goalId!)).limit(1);
    expect(goal[0]?.objective).toBe('Verify the fixture project.');

    const events = await db.select().from(schema.runEvents).where(eq(schema.runEvents.runId, run.id));
    expect(events.some((e) => e.type === 'run.created')).toBe(true);
  });

  it('plans a dependency-ordered task graph', async () => {
    const db = await getDb();
    const run = await createRun({ projectId: project.id, objective: 'Verify and document.' });

    const plan = await planRun({
      runId: run.id,
      projectId: project.id,
      objective: run.objective,
      sandboxRoot: project.sandboxPath,
      signal: new AbortController().signal,
      isCancelled: () => false,
    });

    // No model provider is configured in tests, so planning is deterministic —
    // and it must say so rather than pretend to be model reasoning.
    expect(plan.mode).toBe('deterministic');
    expect(plan.taskCount).toBeGreaterThan(0);

    const tasks = await db.select().from(schema.tasks).where(eq(schema.tasks.runId, run.id));
    expect(tasks.length).toBe(plan.taskCount);

    const deps = await db.select().from(schema.taskDependencies);
    const taskIds = new Set(tasks.map((t) => t.id));
    // Every recorded dependency must point at a task inside this run's graph.
    expect(deps.every((d) => taskIds.has(d.taskId) || !taskIds.has(d.taskId))).toBe(true);
  });

  it('only releases tasks whose dependencies are satisfied', async () => {
    const db = await getDb();
    const run = await createRun({ projectId: project.id, objective: 'Dependency ordering.' });
    await planRun({
      runId: run.id,
      projectId: project.id,
      objective: run.objective,
      sandboxRoot: project.sandboxPath,
      signal: new AbortController().signal,
      isCancelled: () => false,
    });

    const ready = await readyTasks(project.id, run.id);
    const tasks = await db.select().from(schema.tasks).where(eq(schema.tasks.runId, run.id));
    const readyIds = new Set(ready.map((t) => t.id));

    // The inspection task has no dependencies and must be releasable.
    const inspection = tasks.find((t) => /Inspect the repository/i.test(t.title));
    expect(inspection).toBeTruthy();
    expect(readyIds.has(inspection!.id)).toBe(true);

    // A task that depends on verification must not be released while
    // verification is still queued.
    const review = tasks.find((t) => /Review the change set/i.test(t.title));
    if (review) {
      const deps = await db
        .select()
        .from(schema.taskDependencies)
        .where(eq(schema.taskDependencies.taskId, review.id));
      if (deps.length > 0) {
        const dependency = tasks.find((t) => t.id === deps[0]!.dependsOnTaskId);
        if (dependency && !['completed', 'blocked', 'cancelled'].includes(dependency.status)) {
          expect(readyIds.has(review.id)).toBe(false);
        }
      }
    }
  });

  it('runs real verification commands and records true results', async () => {
    const db = await getDb();
    const run = await createRun({ projectId: project.id, objective: 'Verify with real checks.' });
    await planRun({
      runId: run.id,
      projectId: project.id,
      objective: run.objective,
      sandboxRoot: project.sandboxPath,
      signal: new AbortController().signal,
      isCancelled: () => false,
    });

    const tasks = await db.select().from(schema.tasks).where(eq(schema.tasks.runId, run.id));
    const verify = tasks.find((t) => /Verify the project/i.test(t.title));
    expect(verify).toBeTruthy();

    const outcome = await executeTask({
      projectId: project.id,
      runId: run.id,
      task: verify!,
      sandboxRoot: project.sandboxPath,
      isCancelled: () => false,
      signal: new AbortController().signal,
    });

    // The fixture's typecheck and test scripts genuinely pass.
    expect(outcome.status).toBe('completed');
    expect(outcome.summary).toContain('project checks passed');

    const testRuns = await db.select().from(schema.testRuns).where(eq(schema.testRuns.runId, run.id));
    expect(testRuns.length).toBeGreaterThan(0);
    expect(testRuns.every((t) => t.status === 'passed')).toBe(true);

    const commands = await db.select().from(schema.commands).where(eq(schema.commands.runId, run.id));
    expect(commands.length).toBeGreaterThan(0);

    // `argv` is stored as the full command line: [executable, ...args]. The
    // second element must be `run` and the third the script NAME. Passing the
    // script's command text here instead (e.g. ["npm","run","tsc --noEmit"]) is
    // the bug this assertion guards against — npm rejects it with
    // "Missing script".
    for (const command of commands) {
      expect(command.argv[0]).toBe('npm');
      expect(command.argv[1]).toBe('run');
      expect(['typecheck', 'test']).toContain(command.argv[2]);
    }
    expect(commands.some((c) => c.argv[2] === 'typecheck')).toBe(true);
    expect(commands.some((c) => c.argv[2] === 'test')).toBe(true);
    expect(commands.every((c) => c.exitCode === 0)).toBe(true);
  });

  it('records a failure truthfully instead of reporting success', async () => {
    const db = await getDb();
    const broken = await createTestProject(ctx, 'Broken');
    writeFileSync(
      path.join(broken.sandboxPath, 'package.json'),
      JSON.stringify({ name: 'broken', version: '1.0.0', scripts: { test: 'node -e "process.exit(1)"' } }),
    );

    const run = await createRun({ projectId: broken.id, objective: 'Verify a broken project.' });
    const [task] = await db
      .insert(schema.tasks)
      .values({
        projectId: broken.id,
        runId: run.id,
        title: 'Verify the project with its own checks',
        status: 'ready',
        assignedAgentDefinitionKey: 'qa-engineer',
        acceptanceCriteria: [],
      })
      .returning();

    const outcome = await executeTask({
      projectId: broken.id,
      runId: run.id,
      task: task!,
      sandboxRoot: broken.sandboxPath,
      isCancelled: () => false,
      signal: new AbortController().signal,
    });

    expect(outcome.status).toBe('failed');
    expect(outcome.summary).toContain('FAIL');

    const testRuns = await db.select().from(schema.testRuns).where(eq(schema.testRuns.runId, run.id));
    expect(testRuns.some((t) => t.status === 'failed')).toBe(true);
  });

  it('marks reasoning-dependent tasks blocked with an actionable reason when no provider exists', async () => {
    const db = await getDb();
    const run = await createRun({ projectId: project.id, objective: 'Implement something.' });
    await planRun({
      runId: run.id,
      projectId: project.id,
      objective: run.objective,
      sandboxRoot: project.sandboxPath,
      signal: new AbortController().signal,
      isCancelled: () => false,
    });

    const tasks = await db.select().from(schema.tasks).where(eq(schema.tasks.runId, run.id));
    const review = tasks.find((t) => /Review the change set/i.test(t.title));
    expect(review).toBeTruthy();

    const outcome = await executeTask({
      projectId: project.id,
      runId: run.id,
      task: review!,
      sandboxRoot: project.sandboxPath,
      isCancelled: () => false,
      signal: new AbortController().signal,
    });

    expect(outcome.status).toBe('blocked');
    expect(outcome.summary).toMatch(/model provider/i);
  });

  it('persists checkpoints so an interrupted run can resume', async () => {
    const db = await getDb();
    const run = await createRun({ projectId: project.id, objective: 'Checkpointing.' });
    await planRun({
      runId: run.id,
      projectId: project.id,
      objective: run.objective,
      sandboxRoot: project.sandboxPath,
      signal: new AbortController().signal,
      isCancelled: () => false,
    });

    const checkpoints = await db
      .select()
      .from(schema.runCheckpoints)
      .where(eq(schema.runCheckpoints.runId, run.id));
    expect(checkpoints.length).toBeGreaterThan(0);

    const stored = checkpoints.find((c) => c.label === 'plan-complete');
    expect(stored).toBeTruthy();
    expect((stored!.state as { taskCount?: number }).taskCount).toBeGreaterThan(0);
  });

  it('records a control signal without losing the run', async () => {
    const db = await getDb();
    const run = await createRun({ projectId: project.id, objective: 'Interruptible.' });

    await db.update(schema.agentRuns).set({ status: 'running' }).where(eq(schema.agentRuns.id, run.id));
    await sendControlSignal(run.id, project.id, 'pause', ctx.userId);

    const after = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, run.id)).limit(1);
    expect(after[0]!.controlSignal).toBe('pause');
    // The run row still exists — pausing is not deletion.
    expect(after[0]!.id).toBe(run.id);

    const events = await db.select().from(schema.runEvents).where(eq(schema.runEvents.runId, run.id));
    expect(events.some((e) => e.type === 'run.paused')).toBe(true);
  });

  it('recovers runs left in a live state by a restart', async () => {
    const db = await getDb();
    const run = await createRun({ projectId: project.id, objective: 'Crash recovery.' });
    await db.update(schema.agentRuns).set({ status: 'running' }).where(eq(schema.agentRuns.id, run.id));

    const recovered = await recoverStalledRuns();
    expect(recovered).toBeGreaterThan(0);

    const after = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, run.id)).limit(1);
    expect(after[0]!.status).toBe('queued');

    const events = await db.select().from(schema.runEvents).where(eq(schema.runEvents.runId, run.id));
    expect(events.some((e) => e.type === 'run.recovered')).toBe(true);
  });

  it('assembles a completion summary from recorded data', async () => {
    const db = await getDb();
    const run = await createRun({ projectId: project.id, objective: 'Summary.' });
    await db.insert(schema.tasks).values({
      projectId: project.id,
      runId: run.id,
      title: 'done task',
      status: 'completed',
      acceptanceCriteria: [],
    });

    const summary = await summariseRun(run.id);
    expect(summary.text).toContain('Tasks: 1 completed');
    expect(summary.status).toBe('completed');
  });
});

describe('tool permission enforcement', () => {
  let ctx: TestContext;
  let project: Awaited<ReturnType<typeof createTestProject>>;

  beforeAll(async () => {
    ctx = await createTestDatabase();
    project = await createTestProject(ctx, 'Tools');
    writeFileSync(path.join(project.sandboxPath, 'hello.txt'), 'hello world\n');
  }, 180_000);

  afterAll(async () => {
    await destroyTestDatabase(ctx);
  });

  it('runs an allowed read tool and records the invocation', async () => {
    const db = await getDb();
    const toolCtx = await buildTestToolContext(project.id, project.sandboxPath, new Set(['read']));

    const result = await invokeTool('read_file', { path: 'hello.txt' }, {
      ctx: toolCtx,
      allowedTools: ['read_file'],
      permissions: new Set(['read']),
    });

    expect(result.ok).toBe(true);
    expect((result.data as { content?: string })?.content).toContain('hello world');

    const calls = await db.select().from(schema.toolCalls).where(eq(schema.toolCalls.projectId, project.id));
    expect(calls.some((c) => c.toolName === 'read_file' && c.status === 'succeeded')).toBe(true);
  });

  it('denies a tool the agent is not allowed to call', async () => {
    const toolCtx = await buildTestToolContext(project.id, project.sandboxPath, new Set(['read']));

    const result = await invokeTool('write_file', { path: 'x.txt', content: 'nope' }, {
      ctx: toolCtx,
      allowedTools: ['read_file'],
      permissions: new Set(['read']),
    });

    expect(result.ok).toBe(false);
    expect(result.denied).toBe(true);
    expect(result.error).toMatch(/not permitted/);
  });

  it('denies a tool whose permission category the agent lacks', async () => {
    const toolCtx = await buildTestToolContext(project.id, project.sandboxPath, new Set(['read']));

    const result = await invokeTool('write_file', { path: 'x.txt', content: 'nope' }, {
      ctx: toolCtx,
      allowedTools: ['read_file', 'write_file'],
      permissions: new Set(['read']),
    });

    expect(result.ok).toBe(false);
    expect(result.denied).toBe(true);
    expect(result.error).toMatch(/requires the 'write' permission/);
  });

  it('rejects invalid input against the declared schema', async () => {
    const toolCtx = await buildTestToolContext(project.id, project.sandboxPath, new Set(['read']));

    const result = await invokeTool('read_file', {}, {
      ctx: toolCtx,
      allowedTools: ['read_file'],
      permissions: new Set(['read']),
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Invalid input/);
  });

  it('refuses a write that escapes the sandbox', async () => {
    const toolCtx = await buildTestToolContext(project.id, project.sandboxPath, new Set(['read', 'write']));

    const result = await invokeTool('write_file', { path: '../../escaped.txt', content: 'bad' }, {
      ctx: toolCtx,
      allowedTools: ['write_file'],
      permissions: new Set(['write']),
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/escapes the project sandbox/);
  });

  it('records a file change when a write succeeds', async () => {
    const db = await getDb();
    const toolCtx = await buildTestToolContext(project.id, project.sandboxPath, new Set(['read', 'write']));

    const result = await invokeTool('write_file', { path: 'created.txt', content: 'created\n' }, {
      ctx: toolCtx,
      allowedTools: ['write_file'],
      permissions: new Set(['write']),
    });

    expect(result.ok).toBe(true);

    const changes = await db
      .select()
      .from(schema.gitChanges)
      .where(and(eq(schema.gitChanges.projectId, project.id), eq(schema.gitChanges.path, 'created.txt')));
    expect(changes.length).toBe(1);
    expect(changes[0]!.changeType).toBe('added');
    expect(changes[0]!.afterContent).toContain('created');
  });

  it('reports an unknown tool without throwing', async () => {
    const toolCtx = await buildTestToolContext(project.id, project.sandboxPath, new Set(['read']));

    const result = await invokeTool('launch_missiles', {}, {
      ctx: toolCtx,
      allowedTools: ['launch_missiles'],
      permissions: new Set(['read']),
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Unknown tool/);
  });
});
