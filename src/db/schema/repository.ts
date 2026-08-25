import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { projects } from './project';

/**
 * Repository workspace (§11, §36, §45). A linked repository is a first-class
 * AI Core resource: connection, status, branches, detected stack, commits, PRs.
 */

export const repositories = pgTable(
  'repositories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** github | local */
    provider: text('provider').notNull().default('local'),
    /** Remote clone URL for github; absolute path for local. */
    remoteUrl: text('remote_url'),
    /** Where the working copy lives inside the project sandbox. */
    localPath: text('local_path').notNull(),
    defaultBranch: text('default_branch').notNull().default('main'),
    currentBranch: text('current_branch'),
    headSha: text('head_sha'),
    /** connected | cloning | error | disconnected */
    connectionStatus: text('connection_status').notNull().default('disconnected'),
    connectionError: text('connection_error'),
    /**
     * Result of the initial non-destructive inspection (§36): framework,
     * languages, package manager, test setup, env templates, conventions.
     */
    inspection: jsonb('inspection').$type<Record<string, unknown>>(),
    inspectedAt: timestamp('inspected_at', { withTimezone: true }),
    /** Push is disabled by default — §45: never assume every run should push. */
    allowPush: boolean('allow_push').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('repositories_project_idx').on(t.projectId)],
);

export const branches = pgTable(
  'branches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    headSha: text('head_sha'),
    isDefault: boolean('is_default').notNull().default(false),
    isProtected: boolean('is_protected').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('branches_repo_idx').on(t.repositoryId)],
);

export const commitReferences = pgTable(
  'commit_references',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    runId: uuid('run_id'),
    sha: text('sha').notNull(),
    message: text('message').notNull(),
    author: text('author'),
    branch: text('branch'),
    filesChanged: jsonb('files_changed').$type<string[]>(),
    committedAt: timestamp('committed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('commits_repo_idx').on(t.repositoryId, t.committedAt)],
);

export const pullRequestReferences = pgTable(
  'pull_request_references',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    runId: uuid('run_id'),
    number: text('number').notNull(),
    title: text('title').notNull(),
    url: text('url'),
    headBranch: text('head_branch').notNull(),
    baseBranch: text('base_branch').notNull(),
    /** open | merged | closed */
    state: text('state').notNull().default('open'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('prs_repo_idx').on(t.repositoryId)],
);

export type Repository = typeof repositories.$inferSelect;
export type Branch = typeof branches.$inferSelect;
export type CommitReference = typeof commitReferences.$inferSelect;
export type PullRequestReference = typeof pullRequestReferences.$inferSelect;
