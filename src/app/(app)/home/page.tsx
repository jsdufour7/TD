import Link from 'next/link';
import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Cpu,
  FolderKanban,
  Package,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { getDb, schema } from '@/db/client';
import { getCurrentUser } from '@/auth/session';
import { Badge, Button, Card, EmptyState, Stat, toneTextClass } from '@/components/ui/primitives';
import { toneFor, timeAgo } from '@/lib/ui';
import { MissionHero } from '@/components/layout/mission-hero';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Mission Control' };

/**
 * Mission Control (§27).
 *
 * Answers six questions, each with a real query: what projects exist, what is
 * running, who is working, what needs my attention, what failed recently, and
 * what was delivered. No decorative charts — every number is a count.
 */
export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const db = await getDb();
  const projects = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.organizationId, user.organizationId))
    .orderBy(desc(schema.projects.updatedAt));
  const projectIds = projects.map((p) => p.id);
  const projectById = new Map(projects.map((p) => [p.id, p]));

  const hasProjects = projectIds.length > 0;
  const scope = <T,>(fallback: T[], query: () => Promise<T[]>) => (hasProjects ? query() : Promise.resolve(fallback));

  const [runs, approvals, instances, events, artifacts, providers, definitions, blockedTasks] = await Promise.all([
    scope([], () =>
      db
        .select()
        .from(schema.agentRuns)
        .where(inArray(schema.agentRuns.projectId, projectIds))
        .orderBy(desc(schema.agentRuns.createdAt))
        .limit(300),
    ),
    scope([], () =>
      db
        .select()
        .from(schema.approvalRequests)
        .where(and(inArray(schema.approvalRequests.projectId, projectIds), eq(schema.approvalRequests.status, 'pending')))
        .orderBy(desc(schema.approvalRequests.requestedAt)),
    ),
    scope([], () =>
      db
        .select()
        .from(schema.agentInstances)
        .where(
          and(
            inArray(schema.agentInstances.projectId, projectIds),
            inArray(schema.agentInstances.status, ['working', 'planning', 'using_tool', 'testing', 'reviewing', 'waiting', 'blocked']),
          ),
        )
        .orderBy(desc(schema.agentInstances.startedAt))
        .limit(20),
    ),
    scope([], () =>
      db
        .select()
        .from(schema.runEvents)
        .where(inArray(schema.runEvents.projectId, projectIds))
        .orderBy(desc(schema.runEvents.createdAt))
        .limit(40),
    ),
    scope([], () =>
      db
        .select()
        .from(schema.artifacts)
        .where(inArray(schema.artifacts.projectId, projectIds))
        .orderBy(desc(schema.artifacts.createdAt))
        .limit(8),
    ),
    db.select().from(schema.modelProviders),
    db.select().from(schema.agentDefinitions),
    scope([], () =>
      db
        .select({ id: schema.tasks.id })
        .from(schema.tasks)
        .where(and(inArray(schema.tasks.projectId, projectIds), eq(schema.tasks.status, 'blocked'))),
    ),
  ]);

  const definitionByKey = new Map(definitions.map((d) => [d.key, d]));
  const activeRuns = runs.filter((r) =>
    ['running', 'queued', 'paused', 'waiting_for_approval', 'waiting_for_user'].includes(r.status),
  );
  const failures = runs.filter((r) => r.status === 'failed').slice(0, 5);
  const completed = runs.filter((r) => r.status === 'completed').slice(0, 5);
  const online = providers.filter((p) => p.healthStatus === 'online').length;

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-5 lg:p-7">
      <MissionHero
        userName={user.name}
        canWork={hasProjects}
        attention={{
          approvals: approvals.length,
          failedRuns: failures.length,
          blockedTasks: blockedTasks.length,
        }}
      />

      {!hasProjects ? (
        <Card>
          <div className="p-6">
            <EmptyState
              icon={<FolderKanban className="size-5" />}
              title="Aucun projet"
              description="Un projet est un espace d’intelligence persistant : instructions, fichiers, mémoire, conversations, runs et tâches. Créez-en un pour donner du travail au COO."
              action={
                <Link href="/projects">
                  <Button variant="primary" size="md">
                    Créer un projet
                  </Button>
                </Link>
              }
            />
          </div>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Projets" value={projects.length} icon={<FolderKanban className="size-3.5" />} />
        <Stat
          label="Runs actifs"
          value={activeRuns.length}
          tone={activeRuns.length > 0 ? 'accent' : 'idle'}
          icon={<Activity className="size-3.5" />}
        />
        <Stat
          label="Agents au travail"
          value={instances.length}
          tone={instances.length > 0 ? 'accent' : 'idle'}
          icon={<Bot className="size-3.5" />}
        />
        <Stat
          label="Approbations"
          value={approvals.length}
          tone={approvals.length > 0 ? 'warn' : 'idle'}
          icon={<ShieldCheck className="size-3.5" />}
        />
        <Stat
          label="Échecs"
          value={failures.length}
          tone={failures.length > 0 ? 'danger' : 'idle'}
          icon={<XCircle className="size-3.5" />}
        />
        <Stat
          label="Terminés"
          value={runs.filter((r) => r.status === 'completed').length}
          tone="ok"
          icon={<CheckCircle2 className="size-3.5" />}
        />
      </div>

      {approvals.length > 0 ? (
        <Card
          title="Nécessite votre décision"
          description="Ces opérations sont bloquées tant que vous n’avez pas tranché"
          action={
            <Link href="/approvals">
              <Button size="sm" variant="outline">
                Tout voir
              </Button>
            </Link>
          }
        >
          <ul className="divide-y divide-line">
            {approvals.map((approval) => (
              <li key={approval.id}>
                <Link
                  href={`/approvals?highlight=${approval.id}`}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2"
                >
                  <Badge tone={approval.risk === 'critical' ? 'danger' : approval.risk === 'high' ? 'warn' : 'info'}>
                    {approval.risk}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] text-ink-1">{approval.title}</p>
                    <p className="truncate text-[11px] text-ink-4">
                      {projectById.get(approval.projectId)?.name ?? 'Inconnu'} · {approval.category} ·{' '}
                      {timeAgo(approval.requestedAt.toISOString())}
                    </p>
                  </div>
                  <span className="text-[11px] font-medium text-accent">Décider</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="En cours d’exécution" description="Runs actifs en ce moment">
          {activeRuns.length === 0 ? (
            <div className="p-4">
              <EmptyState
                compact
                icon={<Activity className="size-4" />}
                title="Rien ne tourne"
                description="Ouvrez un projet et donnez un objectif au COO pour lancer un run."
              />
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {activeRuns.slice(0, 8).map((run) => (
                <li key={run.id}>
                  <Link
                    href={`/projects/${run.projectId}/runs/${run.id}`}
                    className="block px-4 py-2.5 transition-colors hover:bg-surface-2"
                  >
                    <div className="flex items-center gap-2">
                      <Badge tone={toneFor(run.status)} dot>
                        {run.status.replace(/_/g, ' ')}
                      </Badge>
                      <span className="truncate text-[13px] text-ink-1">{run.title}</span>
                    </div>
                    <p className="mt-1 truncate text-[11px] text-ink-4">
                      {projectById.get(run.projectId)?.name} · phase {run.phase} · {timeAgo(run.updatedAt.toISOString())}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Agents au travail" description="Instances avec état vivant">
          {instances.length === 0 ? (
            <div className="p-4">
              <EmptyState compact icon={<Bot className="size-4" />} title="Aucun agent actif" description="Le COO instancie les agents à la demande." />
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {instances.map((instance) => (
                <li key={instance.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="grid size-7 shrink-0 place-items-center rounded-md border border-line bg-surface-2 font-mono text-[10px] text-ink-2">
                    {(definitionByKey.get(instance.definitionKey)?.name ?? instance.definitionKey)
                      .split(' ')
                      .map((w) => w[0])
                      .join('')
                      .slice(0, 2)
                      .toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] text-ink-1">
                      {definitionByKey.get(instance.definitionKey)?.name ?? instance.definitionKey}
                    </p>
                    <p className="truncate text-[11px] text-ink-4">
                      {instance.lastAction ?? instance.status} · {projectById.get(instance.projectId)?.name}
                    </p>
                  </div>
                  <Badge tone={toneFor(instance.status)} dot={instance.status === 'working' || instance.status === 'using_tool'}>
                    {instance.status.replace(/_/g, ' ')}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Activité en direct" description="Issue des événements réels des runs" className="lg:col-span-2">
          {events.length === 0 ? (
            <div className="p-4">
              <EmptyState compact title="Aucune activité" description="Les événements apparaissent dès qu’un run démarre." />
            </div>
          ) : (
            <ul className="max-h-96 divide-y divide-line overflow-y-auto">
              {events.map((event) => (
                <li key={event.id} className="flex gap-3 px-4 py-2">
                  <span
                    className={`mt-1.5 size-1.5 shrink-0 rounded-full bg-current ${toneTextClass(
                      toneFor(
                        event.level === 'error'
                          ? 'failed'
                          : event.level === 'success'
                            ? 'completed'
                            : event.level === 'warning'
                              ? 'paused'
                              : 'running',
                      ),
                    )}`}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] leading-relaxed text-ink-1">{event.summary}</p>
                    <p className="mt-0.5 text-[10.5px] text-ink-4">
                      <span className="font-mono">{event.type}</span> · {event.actor} ·{' '}
                      {projectById.get(event.projectId)?.name} · {timeAgo(event.createdAt.toISOString())}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-4">
          <Card title="Livrables récents" description="Artefacts produits par les runs">
            {artifacts.length === 0 ? (
              <div className="p-4">
                <EmptyState compact icon={<Package className="size-4" />} title="Aucun artefact" description="Les sorties finalisées sont archivées ici avec leur run." />
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {artifacts.map((artifact) => (
                  <li key={artifact.id} className="px-4 py-2">
                    <p className="truncate text-[12.5px] text-ink-1">{artifact.name}</p>
                    <p className="text-[10.5px] text-ink-4">
                      {artifact.type} · v{artifact.version} · {timeAgo(artifact.createdAt.toISOString())}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Échecs récents" description="Runs qui n’ont pas passé la vérification">
            {failures.length === 0 ? (
              <div className="p-4">
                <EmptyState compact icon={<CheckCircle2 className="size-4" />} title="Aucun échec récent" />
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {failures.map((run) => (
                  <li key={run.id} className="px-4 py-2">
                    <Link href={`/projects/${run.projectId}/runs/${run.id}`} className="block">
                      <p className="truncate text-[12.5px] text-ink-1">{run.title}</p>
                      <p className="mt-0.5 flex items-start gap-1 truncate text-[10.5px] text-danger">
                        <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                        <span className="truncate">{run.error ?? 'Aucune erreur enregistrée'}</span>
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card
            title="Passerelle de modèles"
            description="État au dernier contrôle"
            action={
              <Link href="/models" className="text-[11px] text-ink-3 transition-colors hover:text-accent">
                Configurer
              </Link>
            }
          >
            {providers.length === 0 ? (
              <div className="p-4">
                <EmptyState compact icon={<Cpu className="size-4" />} title="Aucune passerelle" description="Ajoutez llama.cpp ou Ollama dans Modèles." />
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {providers.map((provider) => (
                  <li key={provider.id} className="flex items-center gap-2 px-4 py-2">
                    <Badge tone={toneFor(provider.healthStatus)} dot={provider.healthStatus === 'online'}>
                      {provider.healthStatus}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-1">{provider.name}</span>
                    {provider.isLocal ? <span className="text-[10px] text-ink-4">local</span> : null}
                  </li>
                ))}
              </ul>
            )}
            {providers.length > 0 ? (
              <p className="border-t border-line px-4 py-2 text-[11px] text-ink-4">
                {online}/{providers.length} en ligne
              </p>
            ) : null}
          </Card>

          {completed.length > 0 ? (
            <Card title="Récemment terminés">
              <ul className="divide-y divide-line">
                {completed.map((run) => (
                  <li key={run.id} className="px-4 py-2">
                    <Link href={`/projects/${run.projectId}/runs/${run.id}`} className="block">
                      <p className="truncate text-[12.5px] text-ink-1">{run.title}</p>
                      <p className="text-[10.5px] text-ink-4">
                        {projectById.get(run.projectId)?.name} · {timeAgo(run.finishedAt?.toISOString())}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
