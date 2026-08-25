import { z } from 'zod';
import type { RunEventType, EventLevel } from '@/engine/events';

/**
 * Tool system (§25).
 *
 * Tools are registered capabilities, not code embedded in agents. Each declares
 * a name, a description the model sees, a Zod input schema, a permission
 * category and an execution handler. Every invocation produces a `tool_calls`
 * row, so what an agent actually did is inspectable after the fact.
 */

export type ToolPermission = 'read' | 'write' | 'execute' | 'network' | 'destructive' | 'approval';

export type ToolContext = {
  projectId: string;
  /** Absolute sandbox root for this project. All paths resolve inside it. */
  sandboxRoot: string;
  runId: string | null;
  agentInstanceId: string | null;
  taskId: string | null;
  /** Permission categories granted to the acting agent. */
  permissions: Set<string>;
  /** Append a run event (the live feed is built from these). */
  emit: (input: {
    type: RunEventType;
    summary: string;
    level?: EventLevel;
    actor?: string;
    taskId?: string | null;
    payload?: Record<string, unknown>;
  }) => Promise<void>;
  /** Record a file mutation so the Diff/Review Center can show it. */
  recordFileChange: (input: {
    changeType: 'added' | 'modified' | 'deleted' | 'renamed';
    path: string;
    beforeContent: string | null;
    afterContent: string | null;
  }) => Promise<void>;
  /** Block until a human decides. Resolves with the decision. */
  requestApproval: (input: {
    category: string;
    title: string;
    description: string;
    risk: 'low' | 'medium' | 'high' | 'critical';
    action: Record<string, unknown>;
    environmentKey?: string;
  }) => Promise<{ status: 'approved' | 'rejected' | 'edited'; note?: string; editedInstruction?: string }>;
  /** Signal that the run should stop at the next safe boundary. */
  isCancelled: () => boolean;
};

export type ToolResult = {
  ok: boolean;
  /** Short operational summary for the live feed. */
  summary: string;
  /** Structured payload returned to the agent. */
  data?: Record<string, unknown>;
  /** Error message when ok === false. */
  error?: string;
  /** If the tool needed an approval that was denied. */
  denied?: boolean;
};

export type ToolDefinition<Schema extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  permission: ToolPermission;
  inputSchema: Schema;
  /** Whether the tool mutates repository state (shown in review UI). */
  mutatesRepository?: boolean;
  execute: (input: z.infer<Schema>, ctx: ToolContext) => Promise<ToolResult>;
};

/**
 * A tool as the registry stores it: the concrete input type is erased, because a
 * heterogeneous collection cannot preserve it. The single cast lives here and is
 * sound — `invokeTool` validates against `inputSchema` before `execute` is ever
 * reached, so the value passed in always satisfies the original schema.
 */
export type ErasedTool = Omit<ToolDefinition, 'execute'> & {
  inputSchema: z.ZodType;
  execute: (input: unknown, ctx: ToolContext) => Promise<ToolResult>;
};

/** Wrap a tool definition so its `execute` receives a fully typed input. */
export function defineTool<Schema extends z.ZodType>(definition: ToolDefinition<Schema>): ErasedTool {
  return {
    name: definition.name,
    description: definition.description,
    permission: definition.permission,
    inputSchema: definition.inputSchema,
    ...(definition.mutatesRepository !== undefined
      ? { mutatesRepository: definition.mutatesRepository }
      : {}),
    execute: (input: unknown, ctx: ToolContext) =>
      definition.execute(input as z.infer<Schema>, ctx),
  };
}

/** Convenience helpers so tool handlers stay short and consistent. */
export const ok = (summary: string, data?: Record<string, unknown>): ToolResult => ({
  ok: true,
  summary,
  data,
});

export const fail = (error: string, data?: Record<string, unknown>): ToolResult => ({
  ok: false,
  summary: error,
  error,
  data,
});

export const denied = (reason: string): ToolResult => ({
  ok: false,
  summary: reason,
  error: reason,
  denied: true,
});
