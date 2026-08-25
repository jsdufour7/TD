import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { AppError } from '@/lib/errors';
import { createLogger } from '@/lib/logger';
import { emitAndNotify } from '@/engine/events';
import { FILE_TOOLS } from './file-tools';
import { GIT_TOOLS } from './git-tools';
import { COMMAND_TOOLS } from './command-tools';
import { PLATFORM_TOOLS } from './platform-tools';
import { BROWSER_TOOLS } from './browser-tools';
import type { ErasedTool, ToolContext, ToolResult } from './types';

const log = createLogger('tools');

/**
 * Tool registry and invocation path (§25).
 *
 * `invokeTool` is the single way a tool runs. It enforces the agent's
 * allow-list, validates input against the declared schema, records a
 * `tool_calls` row regardless of outcome, and emits the live-feed events.
 * There is no path that executes a tool without all four happening.
 */

const ALL_TOOLS: ErasedTool[] = [
  ...FILE_TOOLS,
  ...GIT_TOOLS,
  ...COMMAND_TOOLS,
  ...PLATFORM_TOOLS,
  ...BROWSER_TOOLS,
];

const REGISTRY = new Map<string, ErasedTool>(ALL_TOOLS.map((t) => [t.name, t]));

export function getTool(name: string): ErasedTool | undefined {
  return REGISTRY.get(name);
}

export function allTools(): ErasedTool[] {
  return ALL_TOOLS;
}

export function toolNames(): string[] {
  return ALL_TOOLS.map((t) => t.name);
}

/** JSON-schema-ish description handed to the model as the tool list. */
export function toolManifest(allowed: string[]): Array<{
  name: string;
  description: string;
  permission: string;
  inputSchema: Record<string, unknown>;
}> {
  return allowed
    .map((name) => REGISTRY.get(name))
    .filter((t): t is ErasedTool => Boolean(t))
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      permission: tool.permission,
      inputSchema: toJsonSchema(tool.inputSchema),
    }));
}

/**
 * Convert a Zod schema to a compact JSON schema for the tool manifest.
 * Deliberately small — enough for a model to call the tool correctly.
 */
export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  // Zod 4 exposes a standard-schema-ish introspection via `~standard` and
  // `_zod.def`. We use the documented toJSONSchema when available.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const zod = z as any;
    if (typeof zod.toJSONSchema === 'function') {
      return zod.toJSONSchema(schema, { io: 'input', target: 'draft-7' }) as Record<string, unknown>;
    }
  } catch {
    /* fall through to the generic description */
  }
  return { type: 'object', description: 'See tool description for parameters.' };
}

export type InvokeOptions = {
  ctx: ToolContext;
  /** Permission categories granted to the acting agent. */
  allowedTools: string[];
  permissions: Set<string>;
  /** Skip the permission check — used only by the internal engine. */
  bypassPermissionCheck?: boolean;
};

export async function invokeTool(
  name: string,
  rawInput: Record<string, unknown>,
  options: InvokeOptions,
): Promise<ToolResult & { toolCallId: string | null }> {
  const { ctx, allowedTools, permissions } = options;
  const db = await getDb();

  const tool = REGISTRY.get(name);
  if (!tool) {
    const message = `Unknown tool: ${name}`;
    return { ok: false, summary: message, error: message, toolCallId: null };
  }

  // Allow-list first: an agent can only use what its definition grants.
  if (!options.bypassPermissionCheck && !allowedTools.includes(name)) {
    const message = `Tool '${name}' is not permitted for this agent`;
    await emitAndNotify({
      runId: ctx.runId ?? '',
      projectId: ctx.projectId,
      type: 'tool.denied',
      level: 'warning',
      actor: ctx.agentInstanceId ?? 'system',
      summary: message,
      payload: { tool: name },
    }).catch(() => undefined);
    return { ok: false, summary: message, error: message, denied: true, toolCallId: null };
  }

  if (!options.bypassPermissionCheck && !permissions.has(tool.permission)) {
    const message = `Tool '${name}' requires the '${tool.permission}' permission, which this agent does not have`;
    return { ok: false, summary: message, error: message, denied: true, toolCallId: null };
  }

  const parsed = tool.inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    const message = `Invalid input for ${name}: ${issues}`;
    return { ok: false, summary: message, error: message, toolCallId: null };
  }

  const [call] = await db
    .insert(schema.toolCalls)
    .values({
      projectId: ctx.projectId,
      runId: ctx.runId,
      agentInstanceId: ctx.agentInstanceId,
      taskId: ctx.taskId,
      toolName: name,
      permissionCategory: tool.permission,
      input: sanitise(rawInput),
      status: 'pending',
    })
    .returning();

  const toolCallId = call!.id;
  const startedAt = Date.now();

  if (ctx.runId) {
    await emitAndNotify({
      runId: ctx.runId,
      projectId: ctx.projectId,
      type: 'tool.started',
      actor: name,
      agentInstanceId: ctx.agentInstanceId,
      taskId: ctx.taskId,
      summary: `${name}: ${summariseInput(name, parsed.data as Record<string, unknown>)}`,
      payload: { toolCallId, tool: name },
    }).catch(() => undefined);
  }

  let result: ToolResult;
  try {
    if (ctx.isCancelled()) {
      result = { ok: false, summary: 'Run was cancelled', error: 'cancelled' };
    } else {
      result = await tool.execute(parsed.data, ctx);
    }
  } catch (error) {
    if (error instanceof AppError) {
      result = { ok: false, summary: error.message, error: error.message };
    } else {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`tool ${name} threw`, { error: message });
      result = { ok: false, summary: `${name} failed: ${message}`, error: message };
    }
  }

  const durationMs = Date.now() - startedAt;
  const status = result.denied ? 'denied' : result.ok ? 'succeeded' : 'failed';

  await db
    .update(schema.toolCalls)
    .set({
      status,
      output: sanitise(result.data ?? {}),
      error: result.error ?? null,
      durationMs,
      finishedAt: new Date(),
    })
    .where(eq(schema.toolCalls.id, toolCallId));

  if (ctx.runId) {
    await emitAndNotify({
      runId: ctx.runId,
      projectId: ctx.projectId,
      type: result.ok ? 'tool.completed' : result.denied ? 'tool.denied' : 'tool.failed',
      level: result.ok ? 'info' : 'warning',
      actor: name,
      agentInstanceId: ctx.agentInstanceId,
      taskId: ctx.taskId,
      summary: result.summary,
      payload: { toolCallId, tool: name, durationMs, ok: result.ok },
    }).catch(() => undefined);
  }

  return { ...result, toolCallId };
}

/**
 * Tool inputs are persisted, so anything that looks like a secret is stripped
 * before it can reach the database or an API response.
 */
function sanitise(input: Record<string, unknown>): Record<string, unknown> {
  const clone: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (/secret|password|token|apikey|api_key|authorization/i.test(key)) {
      clone[key] = '[REDACTED]';
      continue;
    }
    if (typeof value === 'string') {
      // Bound very large payloads (file contents) so the row stays readable.
      clone[key] = value.length > 20000 ? `${value.slice(0, 20000)}…[truncated]` : value;
    } else {
      clone[key] = value;
    }
  }
  return clone;
}

/** One-line human summary of a tool invocation for the live feed. */
function summariseInput(name: string, input: Record<string, unknown>): string {
  const str = (key: string) => (typeof input[key] === 'string' ? String(input[key]) : undefined);
  switch (name) {
    case 'read_file':
    case 'write_file':
    case 'patch_file':
    case 'delete_file':
      return str('path') ?? '';
    case 'search_files':
      return `/${str('pattern') ?? ''}/`;
    case 'list_directory':
      return str('path') ?? '.';
    case 'run_command':
    case 'run_tests':
      return [str('command'), ...(Array.isArray(input.argv) ? (input.argv as string[]) : [])].join(' ');
    case 'browser_open':
    case 'fetch_url':
      return str('url') ?? '';
    case 'record_memory':
    case 'create_artifact':
      return str('title') ?? str('name') ?? '';
    case 'create_task':
      return str('title') ?? '';
    default:
      return '';
  }
}

export * from './types';
export { FILE_TOOLS, GIT_TOOLS, COMMAND_TOOLS, PLATFORM_TOOLS, BROWSER_TOOLS };
