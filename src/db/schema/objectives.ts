import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  index,
} from 'drizzle-orm/pg-core';
import { projects } from './project';

/**
 * Executive layer (§5 of the executive-runtime spec).
 *
 * An Objective is a high-level intention ("make AI Core production-ready"). A Plan
 * is the COO's versioned strategy to reach it. Tasks and Runs hang off both, so
 * the user steers with intent and the COO decomposes it — not the other way
 * around.
 *
 * These are added on top of the existing goals/tasks/runs; nothing existing is
 * removed, so prior functionality is preserved.
 */

export const OBJECTIVE_STATUSES = [
  'draft',
  'planning',
  'active',
  'paused',
  'blocked',
  'awaiting_user',
  'completed',
  'failed',
  'cancelled',
] as const;
export type ObjectiveStatus = (typeof OBJECTIVE_STATUSES)[number];

export const AUTONOMY_MODES = ['manual', 'approval', 'autonomous', 'mission'] as const;
export type AutonomyMode = (typeof AUTONOMY_MODES)[number];

export const objectives = pgTable(
  'objectives',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    /** user | coo | agent | system */
    source: text('source').notNull().default('user'),
    status: text('status').notNull().default('draft'),
    priority: integer('priority').notNull().default(3),
    autonomyMode: text('autonomy_mode').notNull().default('approval'),
    createdByUserId: uuid('created_by_user_id'),
    successCriteria: jsonb('success_criteria').$type<string[]>().notNull().default([]),
    constraints: jsonb('constraints').$type<string[]>().notNull().default([]),
    /** Optional USD ceiling; null = unbounded within governor defaults. */
    budgetUsd: text('budget_usd'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('objectives_project_status_idx').on(t.projectId, t.status)],
);

export const plans = pgTable(
  'plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    objectiveId: uuid('objective_id')
      .notNull()
      .references(() => objectives.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** Plans are versioned; a replan creates version+1 rather than mutating. */
    version: integer('version').notNull().default(1),
    rationale: text('rationale'),
    assumptions: jsonb('assumptions').$type<string[]>().notNull().default([]),
    steps: jsonb('steps')
      .$type<Array<{ title: string; agentKey: string; dependsOn?: number[]; verify?: string }>>()
      .notNull()
      .default([]),
    risks: jsonb('risks').$type<string[]>().notNull().default([]),
    /** proposed | approved | executing | superseded | rejected */
    status: text('status').notNull().default('proposed'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('plans_objective_idx').on(t.objectiveId, t.version)],
);

export type Objective = typeof objectives.$inferSelect;
export type Plan = typeof plans.$inferSelect;
