import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { projects } from './project';
import { objectives, plans } from './objectives';

/**
 * The task graph and the run engine. This is the durable heart of AI Core:
 * a run survives a browser refresh and a server restart because its state
 * lives here, not in the browser and not in memory.
 */

export const goals = pgTable(
  'goals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    objective: text('objective').notNull(),
    /** open | in_progress | completed | cancelled */
    status: text('status').notNull().default('open'),
    priority: integer('priority').notNull().default(3),
    createdByUserId: uuid('created_by_user_id'),
    runId: uuid('run_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('goals_project_idx').on(t.projectId, t.status)],
);

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    goalId: uuid('goal_id').references(() => goals.id, { onDelete: 'cascade' }),
    objectiveId: uuid('objective_id').references(() => objectives.id, { onDelete: 'set null' }),
    planId: uuid('plan_id').references(() => plans.id, { onDelete: 'set null' }),
    runId: uuid('run_id'),
    parentTaskId: uuid('parent_task_id'),
    /** user | coo | agent | system */
    createdByType: text('created_by_type').notNull().default('user'),
    generationReason: text('generation_reason'),
    expectedOutcome: text('expected_outcome'),
    verificationStrategy: jsonb('verification_strategy').$type<string[]>().notNull().default([]),
    title: text('title').notNull(),
    description: text('description'),
    /**
     * Acceptance criteria as a list of strings. A task is not "completed"
     * because code exists; it is completed when these are satisfied (§50).
     */
    acceptanceCriteria: jsonb('acceptance_criteria').$type<string[]>().notNull().default([]),
    /**
     * backlog | queued | planning | ready | running | waiting_for_agent |
     * waiting_for_user | waiting_for_approval | testing | reviewing |
     * blocked | failed | completed | cancelled
     */
    status: text('status').notNull().default('backlog'),
    priority: integer('priority').notNull().default(3),
    /** Which agent should own this. Nullable until the COO assigns it. */
    assignedAgentDefinitionKey: text('assigned_agent_definition_key'),
    agentInstanceId: uuid('agent_instance_id'),
    /** Human or agent that created it — kept for the task board (§30). */
    origin: text('origin').notNull().default('agent'),
    attemptCount: integer('attempt_count').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    blockedReason: text('blocked_reason'),
    outputSummary: text('output_summary'),
    position: integer('position').notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('tasks_project_status_idx').on(t.projectId, t.status),
    index('tasks_run_idx').on(t.runId),
    index('tasks_goal_idx').on(t.goalId),
    index('tasks_parent_idx').on(t.parentTaskId),
  ],
);

/** Explicit edges so deployment cannot start before tests finish (§16). */
export const taskDependencies = pgTable(
  'task_dependencies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    dependsOnTaskId: uuid('depends_on_task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
  },
  (t) => [index('task_deps_idx').on(t.taskId)],
);

/**
 * A durable unit of autonomous execution. `phase` records where the lifecycle
 * UNDERSTAND → GATHER CONTEXT → PLAN → EXECUTE → VERIFY → REPAIR → REVIEW →
 * DELIVER → REMEMBER currently is, which is what makes recovery possible (§18).
 */
export const agentRuns = pgTable(
  'agent_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    goalId: uuid('goal_id').references(() => goals.id, { onDelete: 'set null' }),
    objectiveId: uuid('objective_id').references(() => objectives.id, { onDelete: 'set null' }),
    conversationId: uuid('conversation_id'),
    title: text('title').notNull(),
    objective: text('objective').notNull(),
    /**
     * queued | running | paused | waiting_for_approval | waiting_for_user |
     * completed | failed | cancelled
     */
    status: text('status').notNull().default('queued'),
    phase: text('phase').notNull().default('understand'),
    /** Requested control transition, honoured by the worker at a safe boundary. */
    controlSignal: text('control_signal'),
    requestedByUserId: uuid('requested_by_user_id'),
    /** Model routing policy applied to this run (§23). */
    routingPolicy: text('routing_policy').notNull().default('BALANCED'),
    error: text('error'),
    resultSummary: text('result_summary'),
    /** Machine-readable recovery state used by the orchestrator (§18). */
    checkpoint: jsonb('checkpoint').$type<Record<string, unknown>>(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costUsd: text('cost_usd'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('runs_project_idx').on(t.projectId, t.status),
    index('runs_claim_idx').on(t.status, t.createdAt),
  ],
);

/**
 * The live feed is derived from these rows — never from timers or invention (§17).
 * `seq` is a per-run monotonic counter so the SSE stream can resume.
 */
export const runEvents = pgTable(
  'run_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    /** run.created | plan.created | task.created | agent.started | tool.completed | ... */
    type: text('type').notNull(),
    /** info | success | warning | error */
    level: text('level').notNull().default('info'),
    /** agent key, tool name, 'system' or 'user' */
    actor: text('actor').notNull().default('system'),
    agentInstanceId: uuid('agent_instance_id'),
    taskId: uuid('task_id'),
    /** Concise operational summary. Never chain-of-thought. */
    summary: text('summary').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('run_events_run_seq_idx').on(t.runId, t.seq),
    index('run_events_project_idx').on(t.projectId, t.createdAt),
  ],
);

export const runCheckpoints = pgTable(
  'run_checkpoints',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    phase: text('phase').notNull(),
    /** Snapshot of task statuses, changed files and verification results. */
    state: jsonb('state').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('checkpoints_run_idx').on(t.runId, t.createdAt)],
);

export const agentDefinitions = pgTable(
  'agent_definitions',
  {
    /** Stable key, e.g. 'coo', 'fullstack-engineer'. Not a uuid: catalog identity. */
    key: text('key').primaryKey(),
    name: text('name').notNull(),
    role: text('role').notNull(),
    description: text('description').notNull(),
    systemInstructions: text('system_instructions').notNull(),
    /** Tool names this agent may call (§15 permissions). */
    allowedTools: jsonb('allowed_tools').$type<string[]>().notNull().default([]),
    /** Tool permission categories it may exercise without approval. */
    permissions: jsonb('permissions').$type<string[]>().notNull().default([]),
    modelPolicy: text('model_policy').notNull().default('BALANCED'),
    temperature: text('temperature'),
    maxSteps: integer('max_steps').notNull().default(12),
    /** Can the COO instantiate more than one of these at once? */
    maxConcurrency: integer('max_concurrency').notNull().default(1),
    /** Relative cost/latency budget hint used by the router. */
    budgetTier: text('budget_tier').notNull().default('balanced'),
    accentColor: text('accent_color').notNull().default('sky'),
    icon: text('icon').notNull().default('bot'),
    sortOrder: integer('sort_order').notNull().default(100),
    isActive: boolean('is_active').notNull().default(true),
  },
);

export const agentInstances = pgTable(
  'agent_instances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    definitionKey: text('definition_key')
      .notNull()
      .references(() => agentDefinitions.key, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    runId: uuid('run_id').references(() => agentRuns.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id'),
    /** idle | planning | working | using_tool | testing | reviewing | waiting | blocked | completed | failed */
    status: text('status').notNull().default('idle'),
    modelId: text('model_id'),
    providerKey: text('provider_key'),
    /** Last operational summary shown in the Agents view (§28). */
    lastAction: text('last_action'),
    stepsUsed: integer('steps_used').notNull().default(0),
    toolCalls: integer('tool_calls').notNull().default(0),
    error: text('error'),
    summary: text('summary'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('agent_instances_run_idx').on(t.runId)],
);

/** Every tool invocation is recorded (§25). */
export const toolCalls = pgTable(
  'tool_calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    runId: uuid('run_id').references(() => agentRuns.id, { onDelete: 'cascade' }),
    agentInstanceId: uuid('agent_instance_id'),
    taskId: uuid('task_id'),
    toolName: text('tool_name').notNull(),
    /** read | write | execute | network | destructive */
    permissionCategory: text('permission_category').notNull().default('read'),
    input: jsonb('input').$type<Record<string, unknown>>().notNull(),
    /** Result is stored trimmed; full command output lives in `commands`. */
    output: jsonb('output').$type<Record<string, unknown>>(),
    /** pending | succeeded | failed | denied | cancelled */
    status: text('status').notNull().default('pending'),
    error: text('error'),
    durationMs: integer('duration_ms'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('tool_calls_run_idx').on(t.runId, t.startedAt)],
);

/**
 * Command executions (§12). stdout/stderr are stored so the UI can render
 * history after a refresh instead of relying on a live socket.
 */
export const commands = pgTable(
  'commands',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    runId: uuid('run_id').references(() => agentRuns.id, { onDelete: 'set null' }),
    toolCallId: uuid('tool_call_id'),
    /** Short label, e.g. 'npm run build' */
    label: text('label').notNull(),
    argv: jsonb('argv').$type<string[]>().notNull(),
    cwd: text('cwd').notNull(),
    /** interactive | one-shot | dev-server */
    kind: text('kind').notNull().default('one-shot'),
    /** queued | running | succeeded | failed | cancelled | timeout */
    status: text('status').notNull().default('queued'),
    exitCode: integer('exit_code'),
    stdout: text('stdout'),
    stderr: text('stderr'),
    pid: integer('pid'),
    /** For dev servers: the URL that was detected and is being previewed. */
    previewUrl: text('preview_url'),
    timeoutMs: integer('timeout_ms'),
    durationMs: integer('duration_ms'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('commands_project_idx').on(t.projectId, t.startedAt)],
);

export const testRuns = pgTable(
  'test_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    runId: uuid('run_id').references(() => agentRuns.id, { onDelete: 'set null' }),
    suite: text('suite').notNull(),
    framework: text('framework'),
    /** running | passed | failed | error */
    status: text('status').notNull().default('running'),
    total: integer('total').notNull().default(0),
    passed: integer('passed').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    skipped: integer('skipped').notNull().default(0),
    failures: jsonb('failures').$type<Array<{ name: string; message: string }>>(),
    output: text('output'),
    durationMs: integer('duration_ms'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('test_runs_project_idx').on(t.projectId, t.startedAt)],
);

/** Files touched by a run — the Diff / Review Center is built from this (§31). */
export const gitChanges = pgTable(
  'git_changes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    repositoryId: uuid('repository_id'),
    runId: uuid('run_id').references(() => agentRuns.id, { onDelete: 'set null' }),
    taskId: uuid('task_id'),
    agentInstanceId: uuid('agent_instance_id'),
    /** added | modified | deleted | renamed */
    changeType: text('change_type').notNull(),
    path: text('path').notNull(),
    previousPath: text('previous_path'),
    additions: integer('additions').notNull().default(0),
    deletions: integer('deletions').notNull().default(0),
    /** Snapshot of the file before the change, for diffing after the fact. */
    beforeContent: text('before_content'),
    afterContent: text('after_content'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('git_changes_run_idx').on(t.runId), index('git_changes_project_idx').on(t.projectId)],
);

/**
 * High-impact operations block here until a human decides (§20).
 * The run's status becomes waiting_for_approval and the worker parks it.
 */
export const approvalRequests = pgTable(
  'approval_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    runId: uuid('run_id').references(() => agentRuns.id, { onDelete: 'set null' }),
    taskId: uuid('task_id'),
    toolCallId: uuid('tool_call_id'),
    /** file_delete | db_destructive | deploy_production | git_push | pr_merge | secret_change | dangerous_command | high_cost | infra_delete | external_purchase */
    category: text('category').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    risk: text('risk').notNull().default('medium'),
    environmentKey: text('environment_key'),
    /** What will actually be executed once approved. */
    action: jsonb('action').$type<Record<string, unknown>>().notNull(),
    /** pending | approved | rejected | edited | expired | cancelled */
    status: text('status').notNull().default('pending'),
    requestedByAgentKey: text('requested_by_agent_key'),
    decidedByUserId: uuid('decided_by_user_id'),
    decisionNote: text('decision_note'),
    /** When 'edited', the human-supplied replacement instruction. */
    editedInstruction: text('edited_instruction'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (t) => [index('approvals_project_idx').on(t.projectId, t.status)],
);

/** Finished deliverables, software or otherwise (§32). */
export const artifacts = pgTable(
  'artifacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    runId: uuid('run_id').references(() => agentRuns.id, { onDelete: 'set null' }),
    /** application | code_package | spec | architecture | schema | report | csv | spreadsheet | presentation | pdf | image | deployment | test_report */
    type: text('type').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    version: integer('version').notNull().default(1),
    storageKey: text('storage_key'),
    mimeType: text('mime_type'),
    bytes: integer('bytes'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdByAgentKey: text('created_by_agent_key'),
    createdByUserId: uuid('created_by_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('artifacts_project_idx').on(t.projectId, t.type)],
);

export const deployments = pgTable(
  'deployments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    environmentId: uuid('environment_id'),
    /** vercel | cloudflare | local */
    provider: text('provider').notNull(),
    environmentKey: text('environment_key').notNull(),
    /** queued | building | ready | error | cancelled */
    status: text('status').notNull().default('queued'),
    url: text('url'),
    gitRevision: text('git_revision'),
    result: text('result'),
    approvalRequestId: uuid('approval_request_id'),
    createdByRunId: uuid('created_by_run_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('deployments_project_idx').on(t.projectId, t.createdAt)],
);

export type Goal = typeof goals.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type TaskDependency = typeof taskDependencies.$inferSelect;
export type AgentRun = typeof agentRuns.$inferSelect;
export type RunEvent = typeof runEvents.$inferSelect;
export type RunCheckpoint = typeof runCheckpoints.$inferSelect;
export type AgentDefinition = typeof agentDefinitions.$inferSelect;
export type AgentInstance = typeof agentInstances.$inferSelect;
export type ToolCall = typeof toolCalls.$inferSelect;
export type Command = typeof commands.$inferSelect;
export type TestRun = typeof testRuns.$inferSelect;
export type GitChange = typeof gitChanges.$inferSelect;
export type ApprovalRequest = typeof approvalRequests.$inferSelect;
export type Artifact = typeof artifacts.$inferSelect;
export type Deployment = typeof deployments.$inferSelect;
