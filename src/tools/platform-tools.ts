import { z } from 'zod';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { env } from '@/lib/env';
import { emitAndNotify } from '@/engine/events';
import { defineTool, ok, fail, denied, type ErasedTool } from './types';

/**
 * Platform tools: memory, tasks, artifacts, approvals, deployment, network and
 * database access. These are the tools that let an agent participate in the
 * platform itself rather than only touching files.
 */

export const recordMemoryTool = defineTool({
  name: 'record_memory',
  description:
    'Store a durable project memory. Use kind=canonical for stable facts, decision for architectural choices, execution for what was done, preference for user preferences. Working memory is for temporary task context.',
  permission: 'write',
  inputSchema: z.object({
    kind: z.enum(['canonical', 'working', 'decision', 'execution', 'preference']),
    title: z.string().min(3).max(200),
    content: z.string().min(3),
    tags: z.array(z.string()).default([]),
    confidence: z.number().int().min(0).max(100).default(80),
  }),
  async execute(input, ctx) {
    const db = await getDb();
    const [memory] = await db
      .insert(schema.memories)
      .values({
        projectId: ctx.projectId,
        kind: input.kind,
        title: input.title,
        content: input.content,
        source: ctx.agentInstanceId ? 'agent' : 'system',
        runId: ctx.runId,
        tags: input.tags,
        confidence: input.confidence,
        isPinned: input.kind === 'canonical',
      })
      .returning();

    await ctx.emit({
      type: 'memory.recorded',
      summary: `Recorded ${input.kind} memory: ${input.title}`,
      payload: { memoryId: memory!.id, kind: input.kind },
    });

    return ok(`Stored ${input.kind} memory: ${input.title}`, { memoryId: memory!.id });
  },
});

export const readMemoryTool = defineTool({
  name: 'read_memory',
  description:
    'Read project memory. Filter by kind to fetch only what the current operation needs instead of loading everything.',
  permission: 'read',
  inputSchema: z.object({
    kinds: z.array(z.enum(['canonical', 'working', 'decision', 'execution', 'preference'])).default([
      'canonical',
      'decision',
    ]),
    limit: z.number().int().min(1).max(100).default(25),
  }),
  async execute(input, ctx) {
    const db = await getDb();
    const rows = await db
      .select()
      .from(schema.memories)
      .where(and(eq(schema.memories.projectId, ctx.projectId), inArray(schema.memories.kind, input.kinds)))
      .orderBy(desc(schema.memories.isPinned), desc(schema.memories.updatedAt))
      .limit(input.limit);

    return ok(`Retrieved ${rows.length} memory item(s)`, {
      memories: rows.map((m) => ({
        id: m.id,
        kind: m.kind,
        title: m.title,
        content: m.content,
        tags: m.tags,
        updatedAt: m.updatedAt.toISOString(),
      })),
    });
  },
});

export const createTaskTool = defineTool({
  name: 'create_task',
  description:
    'Create a task in the project task graph. Always include acceptance criteria that can be checked by running something. Set dependsOnTaskIds so nothing runs before its prerequisites.',
  permission: 'read',
  inputSchema: z.object({
    title: z.string().min(3).max(300),
    description: z.string().optional(),
    acceptanceCriteria: z.array(z.string()).default([]),
    assignedAgentKey: z.string().optional().describe('Agent catalog key, e.g. fullstack-engineer'),
    priority: z.number().int().min(1).max(5).default(3),
    dependsOnTaskIds: z.array(z.string()).default([]),
    parentTaskId: z.string().optional(),
    status: z.string().default('backlog'),
  }),
  async execute(input, ctx) {
    const db = await getDb();

    // A task may only depend on tasks in the same project. Enforced here so a
    // compromised or confused agent cannot wire Project A to Project B's graph.
    if (input.dependsOnTaskIds.length > 0) {
      const valid = await db
        .select({ id: schema.tasks.id })
        .from(schema.tasks)
        .where(and(eq(schema.tasks.projectId, ctx.projectId), inArray(schema.tasks.id, input.dependsOnTaskIds)));
      const validIds = new Set(valid.map((v) => v.id));
      const foreign = input.dependsOnTaskIds.filter((id) => !validIds.has(id));
      if (foreign.length > 0) {
        return fail(`Refusing to depend on ${foreign.length} task(s) outside this project`);
      }
    }

    const [task] = await db
      .insert(schema.tasks)
      .values({
        projectId: ctx.projectId,
        runId: ctx.runId,
        parentTaskId: input.parentTaskId ?? null,
        title: input.title,
        description: input.description ?? null,
        acceptanceCriteria: input.acceptanceCriteria,
        status: input.status,
        priority: input.priority,
        assignedAgentDefinitionKey: input.assignedAgentKey ?? null,
        origin: 'agent',
      })
      .returning();

    for (const depId of input.dependsOnTaskIds) {
      await db.insert(schema.taskDependencies).values({ taskId: task!.id, dependsOnTaskId: depId });
    }

    await ctx.emit({
      type: 'task.created',
      summary: `Task created: ${input.title}${input.assignedAgentKey ? ` → ${input.assignedAgentKey}` : ''}`,
      taskId: task!.id,
      payload: { taskId: task!.id, assignedAgentKey: input.assignedAgentKey ?? null },
    });

    return ok(`Created task: ${input.title}`, {
      taskId: task!.id,
      dependencies: input.dependsOnTaskIds.length,
    });
  },
});

export const updateTaskTool = defineTool({
  name: 'update_task',
  description:
    'Update a task: change status, record why it is blocked, or write its output summary.',
  permission: 'read',
  inputSchema: z.object({
    taskId: z.string().uuid(),
    status: z.string().optional(),
    blockedReason: z.string().optional(),
    outputSummary: z.string().optional(),
    attemptIncrement: z.boolean().optional(),
  }),
  async execute(input, ctx) {
    const db = await getDb();
    const existing = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.id, input.taskId), eq(schema.tasks.projectId, ctx.projectId)))
      .limit(1);
    const task = existing[0];
    if (!task) return fail('Task not found in this project');

    const isTerminal = input.status === 'completed' || input.status === 'failed' || input.status === 'cancelled';
    await db
      .update(schema.tasks)
      .set({
        ...(input.status ? { status: input.status } : {}),
        ...(input.blockedReason !== undefined ? { blockedReason: input.blockedReason || null } : {}),
        ...(input.outputSummary !== undefined ? { outputSummary: input.outputSummary } : {}),
        ...(input.attemptIncrement ? { attemptCount: task.attemptCount + 1 } : {}),
        ...(input.status === 'running' && !task.startedAt ? { startedAt: new Date() } : {}),
        ...(isTerminal ? { finishedAt: new Date() } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.tasks.id, task.id));

    await ctx.emit({
      type:
        input.status === 'failed'
          ? 'task.failed'
          : input.status === 'blocked'
            ? 'task.blocked'
            : input.status === 'completed'
              ? 'task.completed'
              : 'task.updated',
      level: input.status === 'failed' || input.status === 'blocked' ? 'warning' : 'info',
      summary: `Task "${task.title}" → ${input.status ?? 'updated'}`,
      taskId: task.id,
      payload: { status: input.status ?? null, blockedReason: input.blockedReason ?? null },
    });

    return ok(`Task "${task.title}" updated`, { taskId: task.id, status: input.status ?? task.status });
  },
});

export const createArtifactTool = defineTool({
  name: 'create_artifact',
  description:
    'Store a finished deliverable (document, report, schema, CSV, spec) as a versioned project artifact.',
  permission: 'write',
  inputSchema: z.object({
    type: z.enum([
      'spec',
      'architecture',
      'schema',
      'report',
      'csv',
      'document',
      'code_package',
      'test_report',
    ]),
    name: z.string().min(3),
    content: z.string().min(1),
    description: z.string().optional(),
    filename: z.string().optional(),
  }),
  async execute(input, ctx) {
    const db = await getDb();
    const storageKey = `projects/${ctx.projectId}/artifacts/${Date.now()}-${slug(input.name)}.txt`;
    const absolute = path.join(env.storage.localDir, storageKey);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, input.content, 'utf8');

    const previous = await db
      .select({ version: schema.artifacts.version })
      .from(schema.artifacts)
      .where(and(eq(schema.artifacts.projectId, ctx.projectId), eq(schema.artifacts.name, input.name)))
      .orderBy(desc(schema.artifacts.version))
      .limit(1);

    const [artifact] = await db
      .insert(schema.artifacts)
      .values({
        projectId: ctx.projectId,
        runId: ctx.runId,
        type: input.type,
        name: input.name,
        description: input.description ?? null,
        version: (previous[0]?.version ?? 0) + 1,
        storageKey,
        mimeType: 'text/plain',
        bytes: Buffer.byteLength(input.content, 'utf8'),
        createdByAgentKey: ctx.agentInstanceId ? 'agent' : null,
        metadata: input.filename ? { filename: input.filename } : {},
      })
      .returning();

    await ctx.emit({
      type: 'artifact.created',
      level: 'success',
      summary: `Artifact created: ${input.name} (v${artifact!.version})`,
      payload: { artifactId: artifact!.id, type: input.type },
    });

    return ok(`Stored artifact ${input.name} v${artifact!.version}`, {
      artifactId: artifact!.id,
      storageKey,
      version: artifact!.version,
    });
  },
});

export const requestApprovalTool = defineTool({
  name: 'request_approval',
  description:
    'Ask the human to approve, reject or edit a proposed high-impact action. Blocks until a decision is made.',
  permission: 'approval',
  inputSchema: z.object({
    category: z.string().min(1),
    title: z.string().min(3),
    description: z.string().min(3),
    risk: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
    action: z.record(z.string(), z.unknown()).default({}),
  }),
  async execute(input, ctx) {
    const decision = await ctx.requestApproval({
      category: input.category,
      title: input.title,
      description: input.description,
      risk: input.risk,
      action: input.action as Record<string, unknown>,
    });
    if (decision.status === 'approved') {
      return ok(`Approved: ${input.title}`, { decision: decision.status });
    }
    return denied(`${input.title} was ${decision.status}${decision.note ? `: ${decision.note}` : ''}`);
  },
});

export const deployTool = defineTool({
  name: 'deploy',
  description:
    'Deploy the project to an environment. Production deployments always require explicit approval.',
  permission: 'execute',
  inputSchema: z.object({
    environmentKey: z.enum(['development', 'preview', 'staging', 'production']),
    provider: z.enum(['vercel', 'cloudflare', 'local']).default('vercel'),
  }),
  async execute(input, ctx) {
    const db = await getDb();

    const [record] = await db
      .insert(schema.deployments)
      .values({
        projectId: ctx.projectId,
        provider: input.provider,
        environmentKey: input.environmentKey,
        status: 'queued',
        createdByRunId: ctx.runId,
      })
      .returning();

    // Production and staging always require a human decision (§46).
    if (input.environmentKey === 'production' || input.environmentKey === 'staging') {
      const decision = await ctx.requestApproval({
        category: 'deploy_production',
        title: `Deploy to ${input.environmentKey} via ${input.provider}`,
        description: `AI Core will deploy the current state of this project to the ${input.environmentKey} environment.`,
        risk: input.environmentKey === 'production' ? 'critical' : 'high',
        action: { tool: 'deploy', provider: input.provider, environment: input.environmentKey },
        environmentKey: input.environmentKey,
      });
      if (decision.status !== 'approved') {
        await db
          .update(schema.deployments)
          .set({ status: 'cancelled', result: `Deployment ${decision.status}`, finishedAt: new Date() })
          .where(eq(schema.deployments.id, record!.id));
        return fail(`Deployment was ${decision.status}`);
      }
    }

    // No provider is wired in V1. The honest outcome is an explicit error,
    // never a fabricated success. See IMPLEMENTATION_STATUS.md.
    await db
      .update(schema.deployments)
      .set({
        status: 'error',
        result: `Deployment provider '${input.provider}' is not configured in this AI Core installation.`,
        finishedAt: new Date(),
      })
      .where(eq(schema.deployments.id, record!.id));

    return fail(
      `Deployment provider '${input.provider}' is not configured. Deployment recorded as error rather than faked.`,
      { deploymentId: record!.id, providerConfigured: false },
    );
  },
});

export const databaseQueryTool = defineTool({
  name: 'database_query',
  description:
    'Run a read-only SQL query against AI Core\'s own database to inspect runs, tasks, events and usage. Writes are refused.',
  permission: 'read',
  inputSchema: z.object({
    sql: z.string().min(5).describe('A single read-only SELECT statement'),
    projectIdScope: z.boolean().default(true).describe('Automatically restrict results to this project where possible'),
  }),
  async execute(input, ctx) {
    const trimmed = input.sql.trim().replace(/;+\s*$/, '');
    // Only a single read-only statement is accepted. Anything else is refused
    // before it reaches the database, so an agent cannot mutate platform state.
    if (!/^select\b/i.test(trimmed) && !/^with\b/i.test(trimmed)) {
      return fail('Only SELECT (or WITH ... SELECT) statements are permitted');
    }
    if (/;/.test(trimmed)) return fail('Multiple statements are not permitted');
    const forbidden = /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|copy)\b/i;
    if (forbidden.test(trimmed)) {
      return fail('Statement contains a write or DDL keyword and was refused');
    }

    try {
      const db = await getDb();
      // `trimmed` has already been restricted above to a single statement that
      // begins with SELECT/WITH and contains no write or DDL keyword, and this
      // is the only place in the codebase that executes agent-supplied SQL.
      const rows = await db.execute<Record<string, unknown>>(sql.raw(trimmed));
      const list = Array.isArray(rows) ? rows : (rows.rows ?? []);
      const scoped = input.projectIdScope
        ? list.filter(
            (r) =>
              !('project_id' in r) ||
              r.project_id === null ||
              r.project_id === ctx.projectId,
          )
        : list;
      return ok(`Query returned ${scoped.length} row(s)`, { rows: scoped.slice(0, 200), total: scoped.length });
    } catch (error) {
      return fail(`Query failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
});

export const fetchUrlTool = defineTool({
  name: 'fetch_url',
  description: 'Fetch a URL over HTTP(S) and return the text body. Private/internal addresses are blocked.',
  permission: 'network',
  inputSchema: z.object({
    url: z.string().url(),
    maxBytes: z.number().int().min(1000).max(1000000).default(200000),
    timeoutMs: z.number().int().min(1000).max(60000).default(15000),
  }),
  async execute(input) {
    // SSRF guard: agents must not be able to point this tool at the metadata
    // service, localhost or a private range and read the response.
    let parsed: URL;
    try {
      parsed = new URL(input.url);
    } catch {
      return fail('Invalid URL');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return fail('Only http and https URLs are permitted');
    }
    const host = parsed.hostname.toLowerCase();
    const blockedHosts = ['localhost', 'metadata.google.internal', 'metadata'];
    const blockedPatterns = [
      /^127\./,
      /^10\./,
      /^192\.168\./,
      /^172\.(1[6-9]|2\d|3[01])\./,
      /^169\.254\./,
      /^0\.0\.0\.0$/,
      /^\[?::1\]?$/,
      /^\[?f[cd][0-9a-f]{2}:/i,
    ];
    if (blockedHosts.includes(host) || blockedPatterns.some((p) => p.test(host))) {
      return fail(`Refusing to fetch a private or internal address: ${host}`);
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), input.timeoutMs);
      const response = await fetch(parsed.toString(), {
        signal: controller.signal,
        redirect: 'error',
        headers: { 'user-agent': 'TwoDots-AI-Core/0.1' },
      });
      clearTimeout(timer);

      const contentType = response.headers.get('content-type') ?? '';
      if (!response.ok) return fail(`HTTP ${response.status} from ${host}`);
      if (!/text|json|xml|javascript|markdown/i.test(contentType)) {
        return fail(`Unsupported content type: ${contentType || 'unknown'}`);
      }
      const text = await response.text();
      const truncated = text.length > input.maxBytes;
      return ok(`Fetched ${host} (${response.status}, ${text.length} bytes)`, {
        url: parsed.toString(),
        status: response.status,
        contentType,
        body: truncated ? text.slice(0, input.maxBytes) : text,
        truncated,
      });
    } catch (error) {
      return fail(`Fetch failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
});

export const webSearchTool = defineTool({
  name: 'web_search',
  description:
    'Search the web for referenced information. Requires a search provider to be configured; otherwise reports that honestly instead of inventing results.',
  permission: 'network',
  inputSchema: z.object({
    query: z.string().min(3),
    maxResults: z.number().int().min(1).max(10).default(5),
  }),
  async execute() {
    return fail(
      'No web search provider is configured in this AI Core installation. Configure a search provider or use fetch_url with a known URL.',
      { configured: false },
    );
  },
});

function slug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'artifact';
}

export const PLATFORM_TOOLS: ErasedTool[] = [
  recordMemoryTool,
  readMemoryTool,
  createTaskTool,
  updateTaskTool,
  createArtifactTool,
  requestApprovalTool,
  deployTool,
  databaseQueryTool,
  fetchUrlTool,
  webSearchTool,
];

/** Re-exported for tests that assert isolation behaviour. */
export { emitAndNotify };
