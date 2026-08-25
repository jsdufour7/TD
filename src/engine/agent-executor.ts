import { promises as fs } from 'node:fs';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { callModel } from '@/ai/router';
import { applyBinding } from '@/ai/bindings';
import { AppError } from '@/lib/errors';
import { createLogger } from '@/lib/logger';
import type { ChatMessage } from '@/ai/provider';
import { invokeTool } from '@/tools';
import { assembleContext } from '@/context/builder';
import { emitAndNotify } from './events';
import { buildToolContext } from './tool-context';
import { runCommand } from './command-runner';

const log = createLogger('agent-executor');

/**
 * Agent execution loop (§4, §19).
 *
 * Implements IMPLEMENT → TEST → OBSERVE FAILURE → DIAGNOSE → FIX → RETEST with
 * hard safety limits: a step ceiling, a wall-clock budget, repeated-error
 * detection and no-progress detection. An agent that cannot make progress
 * escalates with an explanation instead of burning resources silently.
 */

const MAX_REPEAT_ERRORS = 3;
const MAX_NO_PROGRESS_STEPS = 4;
const DEFAULT_WALL_CLOCK_MS = 15 * 60 * 1000;

export type TaskOutcome = {
  status: 'completed' | 'failed' | 'blocked';
  summary: string;
  toolCalls: number;
  steps: number;
};

export async function executeTask(input: {
  projectId: string;
  runId: string;
  task: typeof schema.tasks.$inferSelect;
  sandboxRoot: string;
  isCancelled: () => boolean;
  signal: AbortSignal;
}): Promise<TaskOutcome> {
  const db = await getDb();
  const task = input.task;

  const definitionKey = task.assignedAgentDefinitionKey ?? 'coo';
  const definitions = await db
    .select()
    .from(schema.agentDefinitions)
    .where(eq(schema.agentDefinitions.key, definitionKey))
    .limit(1);
  const definition = definitions[0];
  if (!definition) {
    return { status: 'failed', summary: `Unknown agent '${definitionKey}'`, toolCalls: 0, steps: 0 };
  }

  await db
    .update(schema.tasks)
    .set({ status: 'running', startedAt: new Date(), attemptCount: task.attemptCount + 1, updatedAt: new Date() })
    .where(eq(schema.tasks.id, task.id));

  const [instance] = await db
    .insert(schema.agentInstances)
    .values({
      definitionKey: definition.key,
      projectId: input.projectId,
      runId: input.runId,
      taskId: task.id,
      status: 'working',
      lastAction: `Starting: ${task.title}`,
    })
    .returning();

  await db
    .update(schema.tasks)
    .set({ agentInstanceId: instance!.id, updatedAt: new Date() })
    .where(eq(schema.tasks.id, task.id));

  await emitAndNotify({
    runId: input.runId,
    projectId: input.projectId,
    type: 'agent.started',
    actor: definition.key,
    agentInstanceId: instance!.id,
    taskId: task.id,
    summary: `${definition.name} started: ${task.title}`,
    payload: { agentKey: definition.key, taskTitle: task.title, attempt: task.attemptCount + 1 },
  });

  const ctx = await buildToolContext({
    projectId: input.projectId,
    runId: input.runId,
    agentInstanceId: instance!.id,
    taskId: task.id,
    sandboxRoot: input.sandboxRoot,
    permissions: new Set(definition.permissions as string[]),
    isCancelled: input.isCancelled,
  });

  let outcome: TaskOutcome;
  try {
    outcome = await runWithModel(input, definition, instance!.id, task, ctx);
  } catch (error) {
    const appError = error instanceof AppError ? error : null;
    if (appError?.code === 'provider_offline' || appError?.code === 'provider_unavailable') {
      // No model available. Execute what is genuinely executable deterministically
      // and mark the rest blocked with a reason the user can act on.
      outcome = await runDeterministic(input, definition, task, ctx, appError.message);
    } else {
      const message = error instanceof Error ? error.message : String(error);
      log.error('agent execution failed', { agent: definition.key, error: message });
      outcome = { status: 'failed', summary: message, toolCalls: 0, steps: 0 };
    }
  }

  const instanceStatus =
    outcome.status === 'completed' ? 'completed' : outcome.status === 'blocked' ? 'blocked' : 'failed';

  await db
    .update(schema.agentInstances)
    .set({
      status: instanceStatus,
      finishedAt: new Date(),
      summary: outcome.summary,
      stepsUsed: outcome.steps,
      toolCalls: outcome.toolCalls,
      ...(outcome.status === 'failed' ? { error: outcome.summary.slice(0, 500) } : {}),
    })
    .where(eq(schema.agentInstances.id, instance!.id));

  const taskStatus =
    outcome.status === 'completed' ? 'completed' : outcome.status === 'blocked' ? 'blocked' : 'failed';

  await db
    .update(schema.tasks)
    .set({
      status: taskStatus,
      outputSummary: outcome.summary.slice(0, 2000),
      blockedReason: outcome.status === 'blocked' ? outcome.summary.slice(0, 500) : null,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.tasks.id, task.id));

  await emitAndNotify({
    runId: input.runId,
    projectId: input.projectId,
    type: outcome.status === 'completed' ? 'task.completed' : outcome.status === 'blocked' ? 'task.blocked' : 'task.failed',
    level: outcome.status === 'completed' ? 'success' : outcome.status === 'failed' ? 'error' : 'warning',
    actor: definition.key,
    agentInstanceId: instance!.id,
    taskId: task.id,
    summary: `${definition.name}: ${outcome.summary}`,
    payload: { status: outcome.status, steps: outcome.steps, toolCalls: outcome.toolCalls },
  });

  return outcome;
}

/**
 * The real tool loop. Runs whenever a model provider is reachable.
 */
async function runWithModel(
  input: { projectId: string; runId: string; sandboxRoot: string; isCancelled: () => boolean; signal: AbortSignal },
  definition: typeof schema.agentDefinitions.$inferSelect,
  agentInstanceId: string,
  task: typeof schema.tasks.$inferSelect,
  ctx: Awaited<ReturnType<typeof buildToolContext>>,
): Promise<TaskOutcome> {
  const db = await getDb();

  const repository = await db
    .select()
    .from(schema.repositories)
    .where(eq(schema.repositories.projectId, input.projectId))
    .limit(1);
  const repoSummary = repository[0]?.inspection
    ? JSON.stringify(repository[0].inspection, null, 2).slice(0, 4000)
    : null;

  const assembled = await assembleContext({
    projectId: input.projectId,
    agent: {
      name: definition.name,
      role: definition.role,
      systemInstructions: definition.systemInstructions,
      allowedTools: definition.allowedTools as string[],
      temperature: definition.temperature,
    },
    project: {
      name: (await db.select({ name: schema.projects.name }).from(schema.projects).where(eq(schema.projects.id, input.projectId))).at(0)?.name ?? 'Project',
    },
    task: {
      title: task.title,
      description: task.description,
      acceptanceCriteria: task.acceptanceCriteria as string[],
      attemptCount: task.attemptCount,
      blockedReason: task.blockedReason,
    },
    ...(repoSummary ? { repositorySummary: repoSummary } : {}),
  });

  await emitAndNotify({
    runId: input.runId,
    projectId: input.projectId,
    type: 'context.assembled',
    actor: definition.key,
    agentInstanceId,
    taskId: task.id,
    summary: `Context assembled: ${assembled.totalTokens} tokens from ${assembled.provenance.filter((p) => p.included).length} sources`,
    payload: { provenance: assembled.provenance, totalTokens: assembled.totalTokens },
  });

  const messages: ChatMessage[] = [...assembled.messages];
  messages.push({
    role: 'user',
    content:
      'Complete this task now. Use tools to inspect and change the workspace. Verify your work by running the relevant commands. When you are done, reply with a concise operational summary of what you changed and what you verified.',
  });

  const allowedTools = definition.allowedTools as string[];
  const permissions = new Set(definition.permissions as string[]);
  const maxSteps = definition.maxSteps;
  const startedAt = Date.now();
  const errorSignatures = new Map<string, number>();
  let noProgressSteps = 0;
  let toolCallCount = 0;
  let lastSummary = '';

  for (let step = 0; step < maxSteps; step += 1) {
    if (input.isCancelled()) {
      return { status: 'blocked', summary: 'Cancelled by the user', toolCalls: toolCallCount, steps: step };
    }
    if (Date.now() - startedAt > DEFAULT_WALL_CLOCK_MS) {
      return {
        status: 'blocked',
        summary: `Stopped after ${Math.round(DEFAULT_WALL_CLOCK_MS / 60000)} minutes without completing`,
        toolCalls: toolCallCount,
        steps: step,
      };
    }

    await db
      .update(schema.agentInstances)
      .set({ status: 'working', stepsUsed: step, lastAction: `Step ${step + 1} of ${maxSteps}` })
      .where(eq(schema.agentInstances.id, agentInstanceId));

    // Operator assignment (Models → Agent models) overrides the default policy.
    const bound = await applyBinding(
      { policy: definition.modelPolicy as never },
      { agentKey: definition.key, projectId: input.projectId },
    );

    const response = await callModel({
      policy: bound.policy,
      ...(bound.manualModelId ? { manualModelId: bound.manualModelId } : {}),
      messages,
      tools: assembled.tools,
      temperature: definition.temperature ? Number.parseFloat(definition.temperature) : 0.2,
      projectId: input.projectId,
      runId: input.runId,
      agentInstanceId,
      signal: input.signal,
      timeoutMs: 120_000,
    });

    await emitAndNotify({
      runId: input.runId,
      projectId: input.projectId,
      type: 'model.called',
      actor: definition.key,
      agentInstanceId,
      taskId: task.id,
      summary: `${response.providerKey}/${response.modelKey} responded in ${response.durationMs}ms${response.fellBack ? ' (fallback model)' : ''}`,
      payload: {
        provider: response.providerKey,
        model: response.modelKey,
        tokens: response.usage.inputTokens + response.usage.outputTokens,
        costUsd: response.costUsd,
        toolCalls: response.toolCalls.length,
      },
    });

    if (response.toolCalls.length === 0) {
      lastSummary = response.content?.trim() || 'Completed without a summary';
      noProgressSteps = 0;
      break;
    }

    messages.push({ role: 'assistant', content: response.content ?? '' });

    let madeProgress = false;
    for (const call of response.toolCalls) {
      if (input.isCancelled()) break;

      await db
        .update(schema.agentInstances)
        .set({ status: 'using_tool', lastAction: `${call.name}`, toolCalls: toolCallCount + 1 })
        .where(eq(schema.agentInstances.id, agentInstanceId));

      const result = await invokeTool(call.name, call.arguments, {
        ctx,
        allowedTools,
        permissions,
      });
      toolCallCount += 1;

      if (result.ok) madeProgress = true;
      else {
        // Repeated identical failures are a loop, not progress (§19).
        const signature = `${call.name}:${(result.error ?? '').slice(0, 120)}`;
        const count = (errorSignatures.get(signature) ?? 0) + 1;
        errorSignatures.set(signature, count);
        if (count >= MAX_REPEAT_ERRORS) {
          return {
            status: 'blocked',
            summary: `Stopped: the same failure occurred ${count} times — ${result.error}`,
            toolCalls: toolCallCount,
            steps: step,
          };
        }
      }

      messages.push({
        role: 'tool',
        name: call.name,
        toolCallId: call.id,
        content: JSON.stringify({
          ok: result.ok,
          summary: result.summary,
          ...(result.data ?? {}),
        }).slice(0, 24000),
      });
    }

    if (madeProgress) noProgressSteps = 0;
    else {
      noProgressSteps += 1;
      if (noProgressSteps >= MAX_NO_PROGRESS_STEPS) {
        return {
          status: 'blocked',
          summary: `Stopped after ${noProgressSteps} steps without progress. Last tool failures are recorded in the run feed.`,
          toolCalls: toolCallCount,
          steps: step,
        };
      }
    }
  }

  return {
    status: 'completed',
    summary: lastSummary || `Completed in ${toolCallCount} tool call(s)`,
    toolCalls: toolCallCount,
    steps: maxSteps,
  };
}

/**
 * Deterministic execution. Used when no model provider is reachable.
 *
 * This does real work where real work is possible — running the project's own
 * typecheck, lint, test and build commands and recording the true results — and
 * refuses to pretend where it is not. Implementation work that needs a model is
 * marked blocked with an actionable reason rather than faked.
 */
async function runDeterministic(
  input: { projectId: string; runId: string; sandboxRoot: string; isCancelled: () => boolean },
  definition: typeof schema.agentDefinitions.$inferSelect,
  task: typeof schema.tasks.$inferSelect,
  ctx: Awaited<ReturnType<typeof buildToolContext>>,
  providerMessage: string,
): Promise<TaskOutcome> {
  const db = await getDb();

  await emitAndNotify({
    runId: input.runId,
    projectId: input.projectId,
    type: 'agent.progress',
    level: 'warning',
    actor: definition.key,
    taskId: task.id,
    summary: `No model provider reachable (${providerMessage.slice(0, 120)}). Running in deterministic mode.`,
  });

  const isVerificationTask =
    definition.key === 'qa-engineer' || /verify|verification|check/i.test(task.title);
  const isMemoryTask = /record what was learned|memory/i.test(task.title);

  // --- Verification: genuinely executable without a model -------------------
  if (isVerificationTask) {
    const pkg = await readPackageJson(input.sandboxRoot);
    if (!pkg) {
      return {
        status: 'blocked',
        summary: 'No package.json in the workspace, so there are no project checks to run.',
        toolCalls: 0,
        steps: 1,
      };
    }

    const scripts = pkg.scripts ?? {};
    /**
     * Map a verification concern to the NAME of a script that exists in
     * package.json.
     *
     * The name is what `npm run` takes. Passing the script's command instead
     * produces `npm run "tsc --noEmit"`, which npm rejects with
     * "Missing script" — the script name and the script command are different
     * things, and only the name belongs on the command line.
     */
    const candidates: Array<[label: string, scriptName: string | null]> = [
      ['typecheck', scripts.typecheck ? 'typecheck' : scripts['type-check'] ? 'type-check' : null],
      ['lint', scripts.lint ? 'lint' : null],
      ['test', scripts.test ? 'test' : null],
      ['build', scripts.build ? 'build' : null],
    ];
    const runnable = candidates.filter(
      (entry): entry is [string, string] => entry[1] !== null,
    );

    if (runnable.length === 0) {
      return {
        status: 'blocked',
        summary: 'The project declares no typecheck, lint, test or build scripts, so there is nothing to verify.',
        toolCalls: 0,
        steps: 1,
      };
    }

    const results: string[] = [];
    let failures = 0;
    let toolCalls = 0;

    for (const [label, scriptName] of runnable) {
      if (input.isCancelled()) break;

      const command = pkg.packageManager === 'pnpm' ? 'pnpm' : pkg.packageManager === 'yarn' ? 'yarn' : 'npm';
      // npm, pnpm and yarn all take `run <script-name>`.
      const argv = ['run', scriptName];

      await ctx.emit({
        type: 'command.started',
        summary: `Running project ${label}: ${command} ${argv.join(' ')}`,
      });

      const result = await runCommand({
        projectId: input.projectId,
        runId: input.runId,
        toolCallId: null,
        command,
        argv,
        cwd: '.',
        label: `${label} (${command} ${argv.join(' ')})`,
        kind: 'one-shot',
        timeoutMs: 10 * 60 * 1000,
      });
      toolCalls += 1;

      const succeeded = result.status === 'succeeded';
      if (!succeeded) failures += 1;
      results.push(`${succeeded ? 'PASS' : 'FAIL'} ${label}: exit ${result.exitCode ?? 'none'}`);

      await db.insert(schema.testRuns).values({
        projectId: input.projectId,
        runId: input.runId,
        suite: label,
        framework: command,
        status: succeeded ? 'passed' : 'failed',
        total: 1,
        passed: succeeded ? 1 : 0,
        failed: succeeded ? 0 : 1,
        output: `${result.stdout}\n${result.stderr}`.slice(0, 100000),
        durationMs: result.durationMs,
        finishedAt: new Date(),
      });

      await ctx.emit({
        type: succeeded ? 'test.passed' : 'test.failed',
        level: succeeded ? 'success' : 'error',
        summary: succeeded
          ? `${label} passed in ${result.durationMs}ms`
          : `${label} failed (exit ${result.exitCode ?? 'none'})`,
        payload: { label, exitCode: result.exitCode, stderrTail: result.stderr.slice(-1500) },
      });
    }

    const summary = `${runnable.length - failures}/${runnable.length} project checks passed. ${results.join('; ')}`;
    return {
      status: failures === 0 ? 'completed' : 'failed',
      summary,
      toolCalls,
      steps: runnable.length,
    };
  }

  // --- Memory: genuinely executable without a model --------------------------
  if (isMemoryTask) {
    const tasks = await db
      .select({ title: schema.tasks.title, status: schema.tasks.status, output: schema.tasks.outputSummary })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.projectId, input.projectId), eq(schema.tasks.runId, input.runId)));

    const body = tasks
      .map((t) => `- [${t.status}] ${t.title}${t.output ? ` — ${t.output.slice(0, 200)}` : ''}`)
      .join('\n');

    await db.insert(schema.memories).values({
      projectId: input.projectId,
      kind: 'execution',
      title: `Run outcome: ${task.title}`,
      content: body || 'No task outcomes recorded.',
      source: 'deterministic-executor',
      runId: input.runId,
      tags: ['run-outcome'],
    });

    await ctx.emit({
      type: 'memory.recorded',
      level: 'success',
      summary: `Recorded execution memory for ${tasks.length} task outcome(s)`,
    });

    return { status: 'completed', summary: `Recorded execution memory covering ${tasks.length} task(s)`, toolCalls: 0, steps: 1 };
  }

  // --- Everything else genuinely needs a model -------------------------------
  return {
    status: 'blocked',
    summary:
      'This task needs a model provider and none is reachable. Configure one in Settings → Models — a local OpenAI-compatible endpoint (LOCAL_MODEL_BASE_URL) works without an external account — then retry the run.',
    toolCalls: 0,
    steps: 0,
  };
}

async function readPackageJson(
  root: string,
): Promise<{ scripts?: Record<string, string>; packageManager?: string } | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
      packageManager?: string;
    };
  } catch {
    return null;
  }
}
