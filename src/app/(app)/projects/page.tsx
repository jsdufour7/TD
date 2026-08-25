import Link from 'next/link';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { getCurrentUser } from '@/auth/session';
import { Badge, Card, EmptyState } from '@/components/ui/primitives';
import { FolderKanban } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { timeAgo, toneFor } from '@/lib/ui';
import { NewProjectDialog } from '@/components/work/new-project-dialog';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Projets' };

export default async function ProjectsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const db = await getDb();
  const projects = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.organizationId, user.organizationId))
    .orderBy(desc(schema.projects.updatedAt));

  const ids = projects.map((p) => p.id);
  const hasProjects = ids.length > 0;

  const [runs, tasks, repos, memories] = await Promise.all([
    hasProjects
      ? db.select().from(schema.agentRuns).where(inArray(schema.agentRuns.projectId, ids))
      : Promise.resolve([]),
    hasProjects ? db.select().from(schema.tasks).where(inArray(schema.tasks.projectId, ids)) : Promise.resolve([]),
    hasProjects
      ? db.select().from(schema.repositories).where(inArray(schema.repositories.projectId, ids))
      : Promise.resolve([]),
    hasProjects ? db.select().from(schema.memories).where(inArray(schema.memories.projectId, ids)) : Promise.resolve([]),
  ]);

  const byProject = <T extends { projectId: string }>(rows: T[]) => {
    const map = new Map<string, T[]>();
    for (const row of rows) {
      const list = map.get(row.projectId) ?? [];
      list.push(row);
      map.set(row.projectId, list);
    }
    return map;
  };

  const runsBy = byProject(runs);
  const tasksBy = byProject(tasks);
  const reposBy = byProject(repos);
  const memoriesBy = byProject(memories);

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-5 lg:p-7">
      <PageHeader
        icon={<FolderKanban className="size-4" />}
        title="Projets"
        subtitle="Chaque projet est un espace persistant : dépôt, mémoire, fichiers, tâches et runs. L’isolation est appliquée côté serveur."
        action={<NewProjectDialog />}
      />

      {projects.length === 0 ? (
        <Card>
          <div className="p-6">
            <EmptyState
              title="No projects yet"
              description="Create a project to give AI Core a persistent workspace: instructions, a repository, memory and a task graph."
              action={<NewProjectDialog />}
            />
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => {
            const projectRuns = runsBy.get(project.id) ?? [];
            const projectTasks = tasksBy.get(project.id) ?? [];
            const projectRepos = reposBy.get(project.id) ?? [];
            const projectMemories = memoriesBy.get(project.id) ?? [];
            const active = projectRuns.filter((r) =>
              ['running', 'queued', 'paused', 'waiting_for_approval'].includes(r.status),
            );
            const stack = project.techStack as { frameworks?: string[] } | null;

            return (
              <Link
                key={project.id}
                href={`/projects/${project.id}/work`}
                className="group rounded-lg border border-line bg-surface-1 p-4 transition-colors hover:border-line-strong hover:bg-surface-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-medium text-ink-1">{project.name}</h2>
                    <p className="truncate font-mono text-[11px] text-ink-4">{project.slug}</p>
                  </div>
                  {project.isDemoData ? <Badge tone="warn">demo</Badge> : null}
                  {active.length > 0 ? (
                    <Badge tone="accent" dot>
                      {active.length} active
                    </Badge>
                  ) : null}
                </div>

                {project.description ? (
                  <p className="mt-2 line-clamp-2 text-xs text-ink-3">{project.description}</p>
                ) : (
                  <p className="mt-2 text-xs text-ink-4 italic">No description yet</p>
                )}

                {stack?.frameworks?.length ? (
                  <div className="mt-2.5 flex flex-wrap gap-1">
                    {stack.frameworks.slice(0, 3).map((framework) => (
                      <span
                        key={framework}
                        className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-ink-3"
                      >
                        {framework.split(' ')[0]}
                      </span>
                    ))}
                  </div>
                ) : null}

                <dl className="mt-3 grid grid-cols-4 gap-2 border-t border-line pt-3 text-center">
                  <Metric label="Runs" value={projectRuns.length} />
                  <Metric label="Tasks" value={projectTasks.filter((t) => !['completed', 'cancelled'].includes(t.status)).length} />
                  <Metric label="Repos" value={projectRepos.filter((r) => r.connectionStatus === 'connected').length} />
                  <Metric label="Memory" value={projectMemories.length} />
                </dl>

                {projectRepos[0] ? (
                  <div className="mt-2.5 flex items-center gap-1.5">
                    <Badge tone={toneFor(projectRepos[0].connectionStatus)}>
                      {projectRepos[0].connectionStatus}
                    </Badge>
                    <span className="truncate font-mono text-[10.5px] text-ink-4">
                      {projectRepos[0].currentBranch ?? projectRepos[0].defaultBranch}
                    </span>
                  </div>
                ) : (
                  <p className="mt-2.5 text-[11px] text-ink-4">No repository connected</p>
                )}

                <p className="mt-2 text-[10.5px] text-ink-4">Updated {timeAgo(project.updatedAt.toISOString())}</p>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-[9.5px] tracking-wide text-ink-4 uppercase">{label}</dt>
      <dd className="font-mono text-sm text-ink-1">{value}</dd>
    </div>
  );
}

export { and };
