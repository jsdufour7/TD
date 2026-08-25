import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { organizations, users } from './identity';

/**
 * Projects are the central organising unit of AI Core: a persistent intelligence
 * workspace holding instructions, files, memory, conversations, runs and work.
 */

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    businessPurpose: text('business_purpose'),
    /** active | archived | draft */
    status: text('status').notNull().default('active'),
    icon: text('icon'),
    /** Application type used by the bootstrap wizard (§35). */
    applicationType: text('application_type'),
    /** Absolute path of the sandbox root for this project. All tools are confined here. */
    sandboxPath: text('sandbox_path'),
    /** Detected stack / conventions from repository inspection (§36). */
    techStack: jsonb('tech_stack').$type<Record<string, unknown>>(),
    isDemoData: boolean('is_demo_data').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('projects_org_slug_idx').on(t.organizationId, t.slug)],
);

export const projectMembers = pgTable(
  'project_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** owner | maintainer | contributor | viewer */
    role: text('role').notNull().default('contributor'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('project_members_unique_idx').on(t.projectId, t.userId)],
);

/** Product / technical / style instructions injected into agent context. */
export const projectInstructions = pgTable(
  'project_instructions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** product | technical | design | workflow */
    kind: text('kind').notNull().default('technical'),
    title: text('title').notNull(),
    content: text('content').notNull(),
    priority: integer('priority').notNull().default(100),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('project_instructions_project_idx').on(t.projectId)],
);

/** Environments per project (dev/test/staging/production) — §47. */
export const environments = pgTable(
  'environments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    name: text('name').notNull(),
    url: text('url'),
    isProduction: boolean('is_production').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('environments_project_key_idx').on(t.projectId, t.key)],
);

/**
 * Files, uploads and generated outputs. Deliberately distinguishes source file
 * from parsed content, metadata, version and project association (§10).
 */
export const files = pgTable(
  'files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** source | uploaded | generated | artifact */
    kind: text('kind').notNull().default('uploaded'),
    name: text('name').notNull(),
    /** Logical path inside the project, e.g. docs/spec.md */
    path: text('path').notNull(),
    mimeType: text('mime_type'),
    bytes: integer('bytes'),
    version: integer('version').notNull().default(1),
    /** Where the bytes live; driver-dependent (local path or object key). */
    storageKey: text('storage_key'),
    checksum: text('checksum'),
    /** Extracted text for search / context. Parsers: md, txt, json, csv, code. */
    parsedText: text('parsed_text'),
    parseStatus: text('parse_status').notNull().default('pending'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdByRunId: uuid('created_by_run_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('files_project_idx').on(t.projectId, t.kind)],
);

export const knowledgeItems = pgTable(
  'knowledge_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    body: text('body').notNull(),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    fileId: uuid('file_id').references(() => files.id, { onDelete: 'set null' }),
    /**
     * Reserved for semantic retrieval. Null until an embedding model is wired;
     * the context engine falls back to keyword/tag relevance.
     */
    embedding: jsonb('embedding').$type<number[] | null>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('knowledge_project_idx').on(t.projectId)],
);

/**
 * Project memory (§9). One table, five deliberate kinds, because the retrieval
 * strategy differs per kind but the shape is identical.
 */
export const memories = pgTable(
  'memories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** canonical | working | decision | execution | preference */
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    content: text('content').notNull(),
    /** Where this memory came from: run id, user, agent key, tool. */
    source: text('source'),
    runId: uuid('run_id'),
    confidence: integer('confidence').notNull().default(80),
    isPinned: boolean('is_pinned').notNull().default(false),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    /** Working memories can expire; canonical ones do not. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('memories_project_kind_idx').on(t.projectId, t.kind)],
);

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    /**
     * Agent keys convened in this thread (the "meeting room"). Empty means a
     * one-on-one with the COO.
     */
    participants: jsonb('participants').$type<string[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('conversations_project_idx').on(t.projectId)],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** user | agent | system */
    role: text('role').notNull(),
    authorName: text('author_name'),
    agentInstanceId: uuid('agent_instance_id'),
    runId: uuid('run_id'),
    /**
     * Operational summary only. Chain-of-thought is never stored or shown (§5).
     */
    content: text('content').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('messages_conversation_idx').on(t.conversationId, t.createdAt)],
);

export type Project = typeof projects.$inferSelect;
export type ProjectMember = typeof projectMembers.$inferSelect;
export type ProjectInstruction = typeof projectInstructions.$inferSelect;
export type Environment = typeof environments.$inferSelect;
export type FileRecord = typeof files.$inferSelect;
export type KnowledgeItem = typeof knowledgeItems.$inferSelect;
export type Memory = typeof memories.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
