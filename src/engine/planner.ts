import { and, asc, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { callModel } from '@/ai/router';
import { applyBinding } from '@/ai/bindings';
import type { ChatMessage } from '@/ai/provider';
import { invokeTool } from '@/tools';
import { emitAndNotify } from './events';
import { writeCheckpoint } from './checkpoints';
import { buildToolContext } from './tool-context';
import { inspectRepository, summariseInspection, type RepoInspection } from '@/repo/inspect';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createLogger } from '@/lib/logger';

const log = createLogger('planner');

/**
 * Planning (§4, §16).
 *
 * Two real paths, no third invented one:
 *  1. LLM planning — the COO agent reads the repository and creates tasks with
 *     the `create_task` tool. Used whenever a model provider is reachable.
 *  2. Deterministic planning — a rules-based decomposition derived from the
 *     repository inspection. Used when no provider is configured, and labelled
 *     as such in the run events so nobody mistakes it for model reasoning.
 */

export type PlanResult = {
  mode: 'llm' | 'deterministic';
  taskCount: number;
  note: string;
};

export async function planRun(input: {
  runId: string;
  projectId: string;
  objective: string;
  sandboxRoot: string;
  signal: AbortSignal;
  isCancelled: () => boolean;
}): Promise<PlanResult> {
  const db = await getDb();

  await emitAndNotify({
    runId: input.runId,
    projectId: input.projectId,
    type: 'run.phase',
    actor: 'coo',
    summary: 'Gathering repository context before planning',
    payload: { phase: 'gather_context' },
  });

  // --- Repository inspection is always real, and always first (§36) --------
  let inspection: RepoInspection | null = null;
  try {
    inspection = await inspectRepository(input.sandboxRoot);
  } catch (error) {
    log.warn('repository inspection failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const repoSummary = inspection ? summariseInspection(inspection, path.basename(input.sandboxRoot)) : null;

  if (inspection) {
    await db
      .update(schema.projects)
      .set({
        techStack: {
          languages: inspection.languages,
          frameworks: inspection.frameworks,
          packageManager: inspection.packageManager,
          testFrameworks: inspection.testFrameworks,
          conventions: inspection.conventions,
        },
        updatedAt: new Date(),
      })
      .where(eq(schema.projects.id, input.projectId));

    await emitAndNotify({
      runId: input.runId,
      projectId: input.projectId,
      type: 'repo.inspected',
      actor: 'coo',
      summary: inspection.git.isRepository
        ? `Inspected repository: ${Object.keys(inspection.languages).length} languages, ${inspection.frameworks.length} frameworks, ${inspection.fileCount} files`
        : `Inspected workspace: ${inspection.fileCount} files, no git repository yet`,
      payload: {
        fileCount: inspection.fileCount,
        frameworks: inspection.frameworks,
        languages: inspection.languages,
        warnings: inspection.warnings,
      },
    });
  }

  // --- Try LLM planning first ----------------------------------------------
  try {
    const result = await planWithModel(input, repoSummary);
    if (result.taskCount > 0) return result;
    await emitAndNotify({
      runId: input.runId,
      projectId: input.projectId,
      type: 'run.phase',
      level: 'warning',
      actor: 'coo',
      summary: 'Model planning produced no tasks — falling back to the deterministic planner',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await emitAndNotify({
      runId: input.runId,
      projectId: input.projectId,
      type: 'run.phase',
      level: 'warning',
      actor: 'coo',
      summary: `Model planning unavailable (${message.slice(0, 140)}) — using the deterministic planner`,
    });
  }

  return planDeterministically(input, repoSummary);
}

/**
 * The COO plans by actually calling `create_task`. Tasks therefore exist as rows
 * the moment planning finishes, with dependencies, rather than as prose.
 */
async function planWithModel(
  input: { runId: string; projectId: string; objective: string; sandboxRoot: string; isCancelled: () => boolean },
  repoSummary: string | null,
): Promise<PlanResult> {
  const db = await getDb();
  const definition = await db
    .select()
    .from(schema.agentDefinitions)
    .where(eq(schema.agentDefinitions.key, 'coo'))
    .limit(1);
  const coo = definition[0];
  if (!coo) throw new Error('The COO agent definition is missing from the catalog');

  const [instance] = await db
    .insert(schema.agentInstances)
    .values({
      definitionKey: coo.key,
      projectId: input.projectId,
      runId: input.runId,
      status: 'planning',
      lastAction: 'Decomposing the objective into tasks',
    })
    .returning();

  await emitAndNotify({
    runId: input.runId,
    projectId: input.projectId,
    type: 'agent.started',
    actor: coo.key,
    agentInstanceId: instance!.id,
    summary: `${coo.name} is planning the work`,
  });

  const ctx = await buildToolContext({
    projectId: input.projectId,
    runId: input.runId,
    agentInstanceId: instance!.id,
    sandboxRoot: input.sandboxRoot,
    permissions: new Set(coo.permissions as string[]),
    isCancelled: input.isCancelled,
  });

  const messages: ChatMessage[] = [
    { role: 'system', content: coo.systemInstructions },
    {
      role: 'user',
      content: [
        `# Objective\n${input.objective}`,
        '',
        repoSummary ? `# Repository\n${repoSummary}` : '# Repository\nNo repository is connected yet.',
        '',
        'Decompose this objective into the smallest set of independently verifiable tasks.',
        'Create each task with the create_task tool, including acceptance criteria that can be checked by running something.',
        'Set dependsOnTaskIds so nothing runs before its prerequisites.',
        'When the plan is complete, reply with a one-line summary of the plan.',
      ].join('\n'),
    },
  ];

  let created = 0;
  for (let step = 0; step < 10; step += 1) {
    if (input.isCancelled()) break;

    const bound = await applyBinding(
      { policy: 'BEST' as const },
      { agentKey: 'coo', projectId: input.projectId },
    );

    const response = await callModel({
      policy: bound.policy,
      ...(bound.manualModelId ? { manualModelId: bound.manualModelId } : {}),
      messages,
      tools: [
        {
          name: 'create_task',
          description: 'Create a task in the project task graph with acceptance criteria and dependencies.',
          inputSchema: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              description: { type: 'string' },
              acceptanceCriteria: { type: 'array', items: { type: 'string' } },
              assignedAgentKey: { type: 'string' },
              priority: { type: 'number' },
              dependsOnTaskIds: { type: 'array', items: { type: 'string' } },
            },
            required: ['title'],
          },
        },
      ],
      projectId: input.projectId,
      runId: input.runId,
      agentInstanceId: instance!.id,
      temperature: 0.2,
      timeoutMs: 90_000,
    });

    if (response.toolCalls.length === 0) {
      await emitAndNotify({
        runId: input.runId,
        projectId: input.projectId,
        type: 'plan.created',
        level: 'success',
        actor: coo.key,
        agentInstanceId: instance!.id,
        summary: response.content?.trim() || `Plan created with ${created} task(s)`,
        payload: { mode: 'llm', taskCount: created },
      });
      break;
    }

    messages.push({ role: 'assistant', content: response.content ?? '' });
    for (const call of response.toolCalls) {
      if (call.name !== 'create_task') continue;
      const result = await invokeTool(call.name, call.arguments, {
        ctx,
        allowedTools: coo.allowedTools as string[],
        permissions: new Set(coo.permissions as string[]),
      });
      if (result.ok) created += 1;
      messages.push({
        role: 'tool',
        content: JSON.stringify({ ok: result.ok, summary: result.summary, ...(result.data ?? {}) }),
        toolCallId: call.id,
        name: call.name,
      });
    }
  }

  await db
    .update(schema.agentInstances)
    .set({ status: 'completed', finishedAt: new Date(), summary: `Planned ${created} task(s)` })
    .where(eq(schema.agentInstances.id, instance!.id));

  return { mode: 'llm', taskCount: created, note: 'Planned by the COO agent' };
}

/**
 * Deterministic decomposition. Produces a real, dependency-ordered task graph
 * from the objective and the repository inspection. The event stream states
 * plainly that this is rule-based, not model reasoning.
 */
async function planDeterministically(
  input: { runId: string; projectId: string; objective: string; sandboxRoot: string },
  repoSummary: string | null,
): Promise<PlanResult> {
  const db = await getDb();
  const objective = input.objective.toLowerCase();

  const hasPackageJson = await exists(path.join(input.sandboxRoot, 'package.json'));
  const testFrameworks = /vitest|jest|playwright|cypress/i.test(repoSummary ?? '');
  const wantsUi = /page|screen|ui|component|form|settings|dashboard|onboarding/i.test(objective);
  const wantsTests = /test|spec|coverage/i.test(objective);
  const wantsDocs = /doc|readme|documentation/i.test(objective);
  const wantsDb = /schema|migration|database|table|column/i.test(objective);
  const wantsSecurity = /auth|security|permission|login|password/i.test(objective);

  type Spec = {
    title: string;
    description: string;
    agent: string;
    criteria: string[];
    priority: number;
    dependsOn: number[];
    status: string;
    blockedReason?: string;
  };

  const specs: Spec[] = [];
  let index = 0;
  const add = (spec: Omit<Spec, 'dependsOn'> & { dependsOn?: number[] }): number => {
    specs.push({ dependsOn: [], ...spec });
    return index++;
  };

  add({
    title: 'Inspect the repository and record project context',
    description:
      'Read manifests, detect the framework, languages, test setup and conventions, and store the result as canonical project memory so later work does not repeat it.',
    agent: 'coo',
    criteria: ['Repository inspection is stored on the project', 'Key conventions are recorded in project memory'],
    priority: 1,
    status: 'ready',
  });

  const implementation = wantsUi || wantsDb ? add({
    title: wantsDb ? 'Implement the data model change' : 'Implement the requested interface change',
    description: `Objective: ${input.objective}\n\nFollow the existing conventions detected during inspection. Do not introduce a new pattern where one already exists.`,
    agent: wantsDb ? 'database-engineer' : 'fullstack-engineer',
    criteria: [
      'The change follows the existing project conventions',
      'TypeScript typecheck passes',
      'The changed files appear in the diff review',
    ],
    priority: 1,
    status: 'blocked',
    dependsOn: [0],
    blockedReason:
      'Implementation requires a model provider. Configure one in Settings → Models (a local OpenAI-compatible endpoint works) and re-run.',
  }) : -1;

  const verification = add({
    title: 'Verify the project with its own checks',
    description:
      'Run the project typecheck, lint and test commands that actually exist in the repository. Record real pass/fail counts.',
    agent: 'qa-engineer',
    criteria: [
      'Every verification command that exists in the repository was executed',
      'Results are recorded as test runs with real counts',
    ],
    priority: 2,
    status: hasPackageJson ? 'ready' : 'blocked',
    dependsOn: implementation >= 0 ? [0, implementation] : [0],
    ...(hasPackageJson ? {} : { blockedReason: 'No package.json found in the workspace, so there is nothing to verify yet.' }),
  });

  if (wantsTests || testFrameworks) {
    add({
      title: 'Add or update tests for the change',
      description: 'Write tests that would fail if the change were broken. Assert observable behaviour, not file existence.',
      agent: 'qa-engineer',
      criteria: ['New tests fail when the behaviour is broken', 'The suite passes'],
      priority: 2,
      status: 'blocked',
      dependsOn: implementation >= 0 ? [implementation, verification] : [verification],
      blockedReason: 'Writing tests requires a model provider. Configure one and re-run.',
    });
  }

  if (wantsSecurity) {
    add({
      title: 'Security review of the change',
      description:
        'Check server-side authorization, input validation, secret exposure and any destructive operation in the diff.',
      agent: 'security-reviewer',
      criteria: ['Every finding is recorded with severity and location'],
      priority: 2,
      status: 'blocked',
      dependsOn: implementation >= 0 ? [implementation] : [0],
      blockedReason: 'Review requires a model provider. Configure one and re-run.',
    });
  }

  add({
    title: 'Review the change set',
    description: 'Review the actual diff for correctness, regressions and divergence from project conventions.',
    agent: 'code-reviewer',
    criteria: ['Blocking issues are separated from suggestions'],
    priority: 3,
    status: 'blocked',
    dependsOn: [verification],
    blockedReason: 'Review requires a model provider. Configure one and re-run.',
  });

  if (wantsDocs) {
    add({
      title: 'Update project documentation',
      description: 'Update the existing documents rather than creating duplicates. Document what the code does now.',
      agent: 'documentation-agent',
      criteria: ['Documentation matches the implemented behaviour'],
      priority: 4,
      status: 'blocked',
      dependsOn: [verification],
      blockedReason: 'Documentation requires a model provider. Configure one and re-run.',
    });
  }

  add({
    title: 'Record what was learned',
    description:
      'Store durable project memory: decisions made, what was verified, and anything a future run must not repeat.',
    agent: 'coo',
    criteria: ['Execution memory records the outcome', 'Any decision is recorded with its reason'],
    priority: 5,
    status: 'ready',
    dependsOn: [verification],
  });

  // Persist the plan.
  const createdIds: string[] = [];
  for (const spec of specs) {
    const [task] = await db
      .insert(schema.tasks)
      .values({
        projectId: input.projectId,
        runId: input.runId,
        title: spec.title,
        description: spec.description,
        acceptanceCriteria: spec.criteria,
        status: spec.status,
        priority: spec.priority,
        assignedAgentDefinitionKey: spec.agent,
        origin: 'agent',
        blockedReason: spec.blockedReason ?? null,
        position: createdIds.length,
      })
      .returning();
    createdIds.push(task!.id);
  }

  for (let i = 0; i < specs.length; i += 1) {
    const spec = specs[i]!;
    for (const depIndex of spec.dependsOn) {
      const depId = createdIds[depIndex];
      if (depId && createdIds[i]) {
        await db.insert(schema.taskDependencies).values({ taskId: createdIds[i]!, dependsOnTaskId: depId });
      }
    }
  }

  const blocked = specs.filter((s) => s.status === 'blocked').length;
  const note = blocked > 0
    ? `Deterministic plan: ${specs.length} tasks, ${blocked} blocked pending a model provider`
    : `Deterministic plan: ${specs.length} tasks`;

  await emitAndNotify({
    runId: input.runId,
    projectId: input.projectId,
    type: 'plan.created',
    level: 'info',
    actor: 'coo',
    summary: note,
    payload: { mode: 'deterministic', taskCount: specs.length, blocked },
  });

  // Planning is a phase worth recovering from (§18): if the process dies after
  // the plan is built, the orchestrator must not plan the objective twice.
  await writeCheckpoint(input.runId, input.projectId, 'plan-complete', 'plan', {
    mode: 'deterministic',
    taskCount: specs.length,
  });

  return { mode: 'deterministic', taskCount: specs.length, note };
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

/** Tasks whose dependencies are all satisfied, in priority order. */
export async function readyTasks(projectId: string, runId: string): Promise<Array<typeof schema.tasks.$inferSelect>> {
  const db = await getDb();
  const tasks = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.projectId, projectId), eq(schema.tasks.runId, runId)))
    .orderBy(asc(schema.tasks.priority), asc(schema.tasks.position));

  const byId = new Map(tasks.map((t) => [t.id, t]));
  const deps = await db.select().from(schema.taskDependencies);
  const depsByTask = new Map<string, string[]>();
  for (const dep of deps) {
    const list = depsByTask.get(dep.taskId) ?? [];
    list.push(dep.dependsOnTaskId);
    depsByTask.set(dep.taskId, list);
  }

  return tasks.filter((task) => {
    if (task.status !== 'ready' && task.status !== 'queued' && task.status !== 'backlog') return false;
    const requirements = depsByTask.get(task.id) ?? [];
    return requirements.every((depId) => {
      const dep = byId.get(depId);
      // A blocked dependency does not block forever: the task can still run and
      // report what it could not do. Only running/queued dependencies wait.
      return !dep || dep.status === 'completed' || dep.status === 'blocked' || dep.status === 'cancelled';
    });
  });
}
