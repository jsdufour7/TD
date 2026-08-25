import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { requireUser } from '@/auth/guards';
import { jsonError, jsonOk, parseBody } from '@/lib/api';
import { ensureProjectSandbox } from '@/lib/sandbox';
import { recordAudit } from '@/lib/audit';
import { AppError } from '@/lib/errors';

const createSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(2000).optional(),
  businessPurpose: z.string().max(2000).optional(),
  applicationType: z.string().max(80).optional(),
  icon: z.string().max(40).optional(),
  /** Optional product/technical instructions captured by the wizard. */
  instructions: z
    .array(z.object({ kind: z.enum(['product', 'technical', 'design', 'workflow']), title: z.string(), content: z.string() }))
    .optional(),
});

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'project'
  );
}

export async function GET(): Promise<Response> {
  try {
    const user = await requireUser();
    const db = await getDb();

    const projects = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.organizationId, user.organizationId))
      .orderBy(desc(schema.projects.updatedAt));

    // Counts come from real tables, not estimates.
    const enriched = await Promise.all(
      projects.map(async (project) => {
        const [runs, tasks, repos] = await Promise.all([
          db.select({ id: schema.agentRuns.id, status: schema.agentRuns.status }).from(schema.agentRuns).where(eq(schema.agentRuns.projectId, project.id)),
          db.select({ id: schema.tasks.id, status: schema.tasks.status }).from(schema.tasks).where(eq(schema.tasks.projectId, project.id)),
          db.select({ id: schema.repositories.id, connectionStatus: schema.repositories.connectionStatus }).from(schema.repositories).where(eq(schema.repositories.projectId, project.id)),
        ]);
        return {
          ...serialiseProject(project),
          stats: {
            runs: runs.length,
            activeRuns: runs.filter((r) => ['running', 'queued', 'paused', 'waiting_for_approval'].includes(r.status)).length,
            tasks: tasks.length,
            openTasks: tasks.filter((t) => !['completed', 'cancelled', 'failed'].includes(t.status)).length,
            repositories: repos.length,
            connectedRepositories: repos.filter((r) => r.connectionStatus === 'connected').length,
          },
        };
      }),
    );

    return jsonOk({ projects: enriched });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const user = await requireUser();
    const body = await parseBody(request, createSchema);
    const db = await getDb();

    const baseSlug = slugify(body.name);
    let slug = baseSlug;
    let suffix = 2;
    // Guarantee uniqueness within the organisation without a race on the index.
    for (;;) {
      const clash = await db
        .select({ id: schema.projects.id })
        .from(schema.projects)
        .where(eq(schema.projects.slug, slug))
        .limit(1);
      if (!clash[0]) break;
      slug = `${baseSlug}-${suffix++}`;
      if (suffix > 100) throw new AppError('conflict', 'Too many projects with this name');
    }

    const [project] = await db
      .insert(schema.projects)
      .values({
        organizationId: user.organizationId,
        name: body.name,
        slug,
        ...(body.description ? { description: body.description } : {}),
        ...(body.businessPurpose ? { businessPurpose: body.businessPurpose } : {}),
        ...(body.applicationType ? { applicationType: body.applicationType } : {}),
        ...(body.icon ? { icon: body.icon } : {}),
        status: 'active',
      })
      .returning();

    // The sandbox is created eagerly so the project has a real workspace
    // immediately, and so path confinement has a root to check against.
    const sandboxPath = ensureProjectSandbox(project!.id);
    await db
      .update(schema.projects)
      .set({ sandboxPath })
      .where(eq(schema.projects.id, project!.id));

    await db.insert(schema.projectMembers).values({
      projectId: project!.id,
      userId: user.id,
      role: 'owner',
    });

    await db.insert(schema.environments).values([
      { projectId: project!.id, key: 'development', name: 'Development', isProduction: false },
      { projectId: project!.id, key: 'preview', name: 'Preview', isProduction: false },
      { projectId: project!.id, key: 'staging', name: 'Staging', isProduction: false },
      { projectId: project!.id, key: 'production', name: 'Production', isProduction: true },
    ]);

    if (body.instructions?.length) {
      await db.insert(schema.projectInstructions).values(
        body.instructions.map((instruction, index) => ({
          projectId: project!.id,
          kind: instruction.kind,
          title: instruction.title,
          content: instruction.content,
          priority: (index + 1) * 10,
        })),
      );
    }

    // Seed canonical memory so the project has durable context from day one.
    await db.insert(schema.memories).values({
      projectId: project!.id,
      kind: 'canonical',
      title: 'Project created',
      content: [
        `Project "${body.name}" was created on ${new Date().toISOString().slice(0, 10)}.`,
        body.businessPurpose ? `Business purpose: ${body.businessPurpose}` : null,
        body.description ? `Description: ${body.description}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
      source: 'project-creation',
      isPinned: true,
      tags: ['project', 'canonical'],
    });

    await recordAudit({
      action: 'project.create',
      organizationId: user.organizationId,
      projectId: project!.id,
      userId: user.id,
      entityType: 'project',
      entityId: project!.id,
    });

    return jsonOk({ project: serialiseProject({ ...project!, sandboxPath }) }, 201);
  } catch (error) {
    return jsonError(error);
  }
}

export function serialiseProject(project: typeof schema.projects.$inferSelect) {
  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    description: project.description,
    businessPurpose: project.businessPurpose,
    status: project.status,
    icon: project.icon,
    applicationType: project.applicationType,
    techStack: project.techStack,
    isDemoData: project.isDemoData,
    hasSandbox: Boolean(project.sandboxPath),
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}
