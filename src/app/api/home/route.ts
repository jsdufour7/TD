import { and, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { getDb, schema } from '@/db/client';
import { requireUser } from '@/auth/guards';
import { jsonError, jsonOk } from '@/lib/api';

/**
 * Command center aggregate (§27).
 *
 * Every number here comes from a real query. There are no vanity charts: each
 * figure answers a question the operator actually has.
 */
export async function GET(): Promise<Response> {
  try {
    const user = await requireUser();
    const db = await getDb();

    const projects = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.organizationId, user.organizationId))
      .orderBy(desc(schema.projects.updatedAt))
      .limit(12);
    const projectIds = projects.map((p) => p.id);

    const [runs, activeRuns, pendingApprovals, recentEvents, agentInstances, failures, artifacts, providers] =
      await Promise.all([
        db
          .select()
          .from(schema.agentRuns)
          .where(inArrayOrNone(schema.agentRuns.projectId, projectIds))
          .orderBy(desc(schema.agentRuns.createdAt))
          .limit(200),
        db
          .select()
          .from(schema.agentRuns)
          .where(
            and(
              inArrayOrNone(schema.agentRuns.projectId, projectIds),
              inArray(schema.agentRuns.status, ['running', 'queued', 'paused', 'waiting_for_approval', 'waiting_for_user']),
            ),
          )
          .orderBy(desc(schema.agentRuns.updatedAt)),
        db
          .select()
          .from(schema.approvalRequests)
          .where(
            and(
              inArrayOrNone(schema.approvalRequests.projectId, projectIds),
              eq(schema.approvalRequests.status, 'pending'),
            ),
          )
          .orderBy(desc(schema.approvalRequests.requestedAt)),
        db
          .select()
          .from(schema.runEvents)
          .where(inArrayOrNone(schema.runEvents.projectId, projectIds))
          .orderBy(desc(schema.runEvents.createdAt))
          .limit(60),
        db
          .select()
          .from(schema.agentInstances)
          .where(
            and(
              inArrayOrNone(schema.agentInstances.projectId, projectIds),
              inArray(schema.agentInstances.status, ['working', 'planning', 'using_tool', 'testing', 'reviewing', 'waiting', 'blocked']),
            ),
          )
          .orderBy(desc(schema.agentInstances.startedAt))
          .limit(30),
        db
          .select()
          .from(schema.agentRuns)
          .where(
            and(
              inArrayOrNone(schema.agentRuns.projectId, projectIds),
              eq(schema.agentRuns.status, 'failed'),
            ),
          )
          .orderBy(desc(schema.agentRuns.finishedAt))
          .limit(10),
        db
          .select()
          .from(schema.artifacts)
          .where(inArrayOrNone(schema.artifacts.projectId, projectIds))
          .orderBy(desc(schema.artifacts.createdAt))
          .limit(10),
        db.select().from(schema.modelProviders),
      ]);

    const definitions = await db.select().from(schema.agentDefinitions);
    const definitionByKey = new Map(definitions.map((d) => [d.key, d]));

    const usage = await db
      .select({
        calls: sql<number>`count(*)::int`,
        input: sql<number>`COALESCE(SUM(${schema.modelUsages.inputTokens}), 0)::int`,
        output: sql<number>`COALESCE(SUM(${schema.modelUsages.outputTokens}), 0)::int`,
      })
      .from(schema.modelUsages);

    const projectById = new Map(projects.map((p) => [p.id, p]));

    return jsonOk({
      counts: {
        projects: projects.length,
        activeRuns: activeRuns.length,
        queuedRuns: activeRuns.filter((r) => r.status === 'queued').length,
        completedRuns: runs.filter((r) => r.status === 'completed').length,
        failedRuns: runs.filter((r) => r.status === 'failed').length,
        pendingApprovals: pendingApprovals.length,
        workingAgents: agentInstances.length,
      },
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        status: p.status,
        isDemoData: p.isDemoData,
        updatedAt: p.updatedAt.toISOString(),
      })),
      activeRuns: activeRuns.map((r) => ({
        id: r.id,
        projectId: r.projectId,
        projectName: projectById.get(r.projectId)?.name ?? 'Unknown',
        title: r.title,
        status: r.status,
        phase: r.phase,
        updatedAt: r.updatedAt.toISOString(),
      })),
      pendingApprovals: pendingApprovals.map((a) => ({
        id: a.id,
        projectId: a.projectId,
        projectName: projectById.get(a.projectId)?.name ?? 'Unknown',
        title: a.title,
        category: a.category,
        risk: a.risk,
        requestedAt: a.requestedAt.toISOString(),
      })),
      failures: failures.map((r) => ({
        id: r.id,
        projectId: r.projectId,
        projectName: projectById.get(r.projectId)?.name ?? 'Unknown',
        title: r.title,
        error: r.error,
        finishedAt: r.finishedAt?.toISOString() ?? null,
      })),
      workingAgents: agentInstances.map((i) => ({
        id: i.id,
        projectId: i.projectId,
        projectName: projectById.get(i.projectId)?.name ?? 'Unknown',
        name: definitionByKey.get(i.definitionKey)?.name ?? i.definitionKey,
        role: definitionByKey.get(i.definitionKey)?.role ?? '',
        status: i.status,
        lastAction: i.lastAction,
        providerKey: i.providerKey,
        startedAt: i.startedAt?.toISOString() ?? null,
      })),
      recentEvents: recentEvents.map((e) => ({
        id: e.id,
        projectId: e.projectId,
        projectName: projectById.get(e.projectId)?.name ?? 'Unknown',
        runId: e.runId,
        seq: e.seq,
        type: e.type,
        level: e.level,
        actor: e.actor,
        summary: e.summary,
        createdAt: e.createdAt.toISOString(),
      })),
      recentArtifacts: artifacts.map((a) => ({
        id: a.id,
        projectId: a.projectId,
        name: a.name,
        type: a.type,
        version: a.version,
        createdAt: a.createdAt.toISOString(),
      })),
      providers: providers.map((p) => ({
        key: p.key,
        name: p.name,
        healthStatus: p.healthStatus,
        isEnabled: p.isEnabled,
        isLocal: p.isLocal,
      })),
      usage: {
        calls: usage[0]?.calls ?? 0,
        inputTokens: usage[0]?.input ?? 0,
        outputTokens: usage[0]?.output ?? 0,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * IN clause that degrades to "no rows" for an empty list instead of producing
 * invalid SQL or throwing.
 */
function inArrayOrNone(column: AnyPgColumn, ids: string[]): SQL {
  if (ids.length === 0) return sql`false`;
  return inArray(column, ids);
}

export { isNull };
