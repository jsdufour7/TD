import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import type { ChatMessage } from '@/ai/provider';
import type { ToolSpec } from '@/ai/provider';
import { toolManifest } from '@/tools';

/**
 * Context engine (§24).
 *
 * Context is assembled deliberately rather than by concatenating everything.
 * Each contributor has a token budget, and the result carries provenance —
 * which pieces were included, how many tokens each consumed, and what was
 * dropped — so a bad context decision can be diagnosed instead of guessed at.
 */

export type ContextBudget = {
  /** Hard ceiling for the assembled prompt. */
  maxTokens: number;
  instructions: number;
  memories: number;
  task: number;
  repository: number;
  files: number;
  history: number;
  tools: number;
};

export const DEFAULT_BUDGET: ContextBudget = {
  maxTokens: 24000,
  instructions: 2500,
  memories: 2000,
  task: 1500,
  repository: 1500,
  files: 8000,
  history: 3000,
  tools: 3000,
};

export type ContextProvenance = {
  section: string;
  tokens: number;
  included: boolean;
  note?: string;
};

export type AssembledContext = {
  messages: ChatMessage[];
  tools: ToolSpec[];
  provenance: ContextProvenance[];
  totalTokens: number;
  truncated: boolean;
};

/** ~4 chars per token — coarse, but consistent and cheap. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

type BuildInput = {
  projectId: string;
  agent: {
    name: string;
    role: string;
    systemInstructions: string;
    allowedTools: string[];
    temperature?: string | null;
  };
  project: {
    name: string;
    description?: string | null;
    businessPurpose?: string | null;
    techStack?: Record<string, unknown> | null;
    sandboxPath?: string | null;
  };
  goal?: { title: string; objective: string } | null;
  task?: {
    title: string;
    description?: string | null;
    acceptanceCriteria: string[];
    attemptCount: number;
    blockedReason?: string | null;
  } | null;
  /** File excerpts the caller decided are relevant. */
  fileExcerpts?: Array<{ path: string; content: string; reason?: string }> | null;
  /** Repository inspection summary. */
  repositorySummary?: string | null;
  /** Prior tool outcomes for this task, oldest first. */
  toolHistory?: Array<{ tool: string; summary: string; ok: boolean }> | null;
  budget?: Partial<ContextBudget>;
};

export async function assembleContext(input: BuildInput): Promise<AssembledContext> {
  const budget: ContextBudget = { ...DEFAULT_BUDGET, ...(input.budget ?? {}) };
  const db = await getDb();
  const provenance: ContextProvenance[] = [];
  let usedTokens = 0;
  let truncated = false;

  const take = (section: string, text: string, limit: number): string => {
    const tokens = estimateTokens(text);
    if (tokens <= limit) {
      provenance.push({ section, tokens, included: true });
      usedTokens += tokens;
      return text;
    }
    // Keep the head and tail: instructions matter at the start, recent detail
    // at the end.
    const half = Math.floor(limit / 2);
    const chars = half * 4;
    const clipped = `${text.slice(0, chars)}\n…[context trimmed]…\n${text.slice(-chars)}`;
    provenance.push({
      section,
      tokens: limit,
      included: true,
      note: `trimmed from ${tokens} to ${limit} tokens`,
    });
    usedTokens += limit;
    truncated = true;
    return clipped;
  };

  const skip = (section: string, note: string) => {
    provenance.push({ section, tokens: 0, included: false, note });
  };

  // --- 1. Project instructions (highest-value stable context) -------------
  const instructions = await db
    .select()
    .from(schema.projectInstructions)
    .where(and(eq(schema.projectInstructions.projectId, input.projectId), eq(schema.projectInstructions.isActive, true)))
    .orderBy(schema.projectInstructions.priority);

  const instructionText = instructions.map((i) => `## ${i.title} (${i.kind})\n${i.content}`).join('\n\n');
  const instructionBlock = instructionText
    ? take('projectInstructions', instructionText, budget.instructions)
    : (skip('projectInstructions', 'none configured'), '');

  // --- 2. Memory, selected by kind ----------------------------------------
  // Canonical + decision + preference are always relevant. Working and
  // execution memory are only pulled for the current run, keeping the prompt
  // from accumulating stale discoveries.
  const memoryKinds: Array<'canonical' | 'decision' | 'preference' | 'working' | 'execution'> = [
    'canonical',
    'decision',
    'preference',
  ];
  if (input.task) memoryKinds.push('working', 'execution');

  const memories = await db
    .select()
    .from(schema.memories)
    .where(and(eq(schema.memories.projectId, input.projectId), inArray(schema.memories.kind, memoryKinds)))
    .orderBy(desc(schema.memories.isPinned), desc(schema.memories.updatedAt))
    .limit(40);

  const memoryText = memories
    .map((m) => `- [${m.kind}] ${m.title}: ${m.content}`)
    .join('\n');
  const memoryBlock = memoryText
    ? take('memory', memoryText, budget.memories)
    : (skip('memory', 'no stored memory'), '');

  // --- 3. Goal and task ----------------------------------------------------
  let taskBlock = '';
  if (input.goal) {
    taskBlock += take('goal', `# Objective\n${input.goal.title}\n${input.goal.objective}`, budget.task);
  }
  if (input.task) {
    const criteria = input.task.acceptanceCriteria.length
      ? input.task.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')
      : '(no explicit acceptance criteria — derive them from the objective)';
    const attemptNote =
      input.task.attemptCount > 0
        ? `\n\nThis is attempt ${input.task.attemptCount + 1}. Previous attempts did not satisfy the acceptance criteria. Do not repeat an approach that already failed.`
        : '';
    taskBlock += take(
      'task',
      `# Current task\n${input.task.title}\n${input.task.description ?? ''}\n\n## Acceptance criteria\n${criteria}${attemptNote}`,
      budget.task,
    );
  }
  if (!input.goal && !input.task) skip('task', 'no goal or task supplied');

  // --- 4. Repository summary ----------------------------------------------
  const repoBlock = input.repositorySummary
    ? take('repository', input.repositorySummary, budget.repository)
    : (skip('repository', 'no repository connected or inspected'), '');

  // --- 5. Relevant file excerpts ------------------------------------------
  const excerpts = input.fileExcerpts ?? [];
  let filesBlock = '';
  if (excerpts.length > 0) {
    const rendered = excerpts
      .map((f) => `### ${f.path}${f.reason ? ` (${f.reason})` : ''}\n\`\`\`\n${f.content}\n\`\`\``)
      .join('\n\n');
    filesBlock = take('files', rendered, budget.files);
  } else {
    skip('files', 'no file excerpts supplied — the agent can read files with tools');
  }

  // --- 6. Prior tool outcomes for this task --------------------------------
  let historyBlock = '';
  const history = input.toolHistory ?? [];
  if (history.length > 0) {
    const rendered = history
      .slice(-25)
      .map((h) => `- ${h.ok ? '✓' : '✗'} ${h.tool}: ${h.summary}`)
      .join('\n');
    historyBlock = take('toolHistory', rendered, budget.history);
  } else {
    skip('toolHistory', 'no prior tool activity for this task');
  }

  // --- 7. Tools -------------------------------------------------------------
  const tools = toolManifest(input.agent.allowedTools).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
  const toolTokens = estimateTokens(JSON.stringify(tools));
  if (toolTokens > budget.tools) {
    provenance.push({
      section: 'tools',
      tokens: toolTokens,
      included: true,
      note: `tool manifest is ${toolTokens} tokens, over the ${budget.tools} budget`,
    });
    truncated = true;
  } else {
    provenance.push({ section: 'tools', tokens: toolTokens, included: true });
  }
  usedTokens += toolTokens;

  // --- Assemble --------------------------------------------------------------
  const projectHeader = [
    `You are working inside the TwoDots AI Core project "${input.project.name}".`,
    input.project.description ? `Description: ${input.project.description}` : null,
    input.project.businessPurpose ? `Business purpose: ${input.project.businessPurpose}` : null,
    input.project.techStack ? `Detected stack: ${JSON.stringify(input.project.techStack)}` : null,
    `Workspace root: ${input.project.sandboxPath ?? '(sandboxed)'} — all paths are relative to it.`,
  ]
    .filter(Boolean)
    .join('\n');

  const system = [
    input.agent.systemInstructions,
    '',
    '---',
    projectHeader,
    instructionBlock,
    memoryBlock ? `# Project memory\n${memoryBlock}` : '',
    repoBlock ? `# Repository\n${repoBlock}` : '',
  ]
    .filter((s) => s.trim().length > 0)
    .join('\n\n');

  const userParts = [taskBlock, filesBlock, historyBlock ? `# Recent tool activity\n${historyBlock}` : '']
    .filter((s) => s.trim().length > 0)
    .join('\n\n');

  const messages: ChatMessage[] = [{ role: 'system', content: system }];
  if (userParts.trim().length > 0) messages.push({ role: 'user', content: userParts });

  const totalTokens = usedTokens;
  if (totalTokens > budget.maxTokens) {
    truncated = true;
    provenance.push({
      section: 'total',
      tokens: totalTokens,
      included: true,
      note: `assembled context (${totalTokens} tokens) exceeds the ${budget.maxTokens} ceiling`,
    });
  }

  return { messages, tools, provenance, totalTokens, truncated };
}
