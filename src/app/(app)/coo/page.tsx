import Link from 'next/link';
import { asc, desc, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { getCurrentUser } from '@/auth/session';
import { requireUser } from '@/auth/guards';
import { CooExecutive } from '@/components/coo/coo-executive';
import { FolderPlus, Sparkles } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Card, EmptyState } from '@/components/ui/primitives';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'COO' };

export default async function CooPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  await requireUser();
  const { project: projectIdParam } = await searchParams;
  const db = await getDb();
  const user = await getCurrentUser();

  const projects = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.organizationId, user!.organizationId))
    .orderBy(desc(schema.projects.updatedAt));

  const projectId = projectIdParam ?? projects[0]?.id;

  if (!projectId) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 p-5 lg:p-7">
        <PageHeader
          icon={<Sparkles className="size-4" />}
          title="COO"
          subtitle="Votre orchestrateur autonome. Créez un premier projet pour lui donner un contexte de travail persistant."
        />
        <Card>
          <div className="p-5">
            <EmptyState
              title="Le COO attend son premier projet"
              description="Un projet rassemble les instructions, fichiers, mémoire, conversations, tâches et runs que le COO utilisera pour travailler avec vous."
              icon={<Sparkles className="size-5" />}
              action={
                <Link href="/projects" className="inline-flex h-9 items-center gap-2 rounded-md bg-accent px-4 text-xs font-semibold text-accent-ink hover:bg-accent-hover">
                  <FolderPlus className="size-4" />
                  Créer un projet
                </Link>
              }
            />
          </div>
        </Card>
      </div>
    );
  }

  const threads = await db
    .select()
    .from(schema.conversations)
    .where(eq(schema.conversations.projectId, projectId))
    .orderBy(asc(schema.conversations.createdAt));
  const firstThreadId = threads[0]?.id ?? null;

  const initialMessages = firstThreadId
    ? (
        await db
          .select()
          .from(schema.messages)
          .where(eq(schema.messages.conversationId, firstThreadId))
          .orderBy(asc(schema.messages.createdAt))
      ).map((message) => ({
        id: message.id,
        role: message.role,
        authorName: message.authorName,
        agentKey: (message.metadata as { agentKey?: string } | null)?.agentKey ?? null,
        mode: (message.metadata as { mode?: string } | null)?.mode ?? null,
        runId: (message.metadata as { runId?: string } | null)?.runId ?? null,
        content: message.content,
        createdAt: message.createdAt.toISOString(),
      }))
    : [];

  const objectives = await db
    .select()
    .from(schema.objectives)
    .where(eq(schema.objectives.projectId, projectId))
    .orderBy(desc(schema.objectives.createdAt));

  return (
    <div className="mx-auto max-w-[1480px] space-y-4 p-5 lg:p-7">
      <PageHeader
        icon={<Sparkles className="size-4" />}
        title="COO"
        subtitle="Parlez-lui naturellement : il comprend, planifie, délègue, exécute et vous rapporte l’état réel."
        action={
          <nav className="flex max-w-full flex-wrap gap-1" aria-label="Projets">
            {projects.map((project) => (
              <Link
                key={project.id}
                href={`/coo?project=${project.id}`}
                className={
                  project.id === projectId
                    ? 'rounded-md border border-accent/40 bg-accent/15 px-2.5 py-1.5 text-[11px] text-accent'
                    : 'rounded-md border border-line bg-surface-1 px-2.5 py-1.5 text-[11px] text-ink-3 hover:text-ink-1'
                }
              >
                {project.name}
              </Link>
            ))}
          </nav>
        }
      />
      <CooExecutive
        projectId={projectId}
        initialMessages={initialMessages}
        initialObjectives={objectives.map((objective) => ({
          id: objective.id,
          title: objective.title,
          status: objective.status,
          autonomyMode: objective.autonomyMode,
        }))}
      />
    </div>
  );
}
