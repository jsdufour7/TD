import Link from 'next/link';
import { asc, desc, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { getDb, schema } from '@/db/client';
import { getCurrentUser } from '@/auth/session';
import { requireUser } from '@/auth/guards';
import { CooExecutive } from '@/components/coo/coo-executive';
import { Sparkles } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'COO' };

/**
 * Global COO. The COO is the primary entry point everywhere on the platform:
 * pick a project and talk to its COO without navigating into the project first.
 * The conversation is the same persistent thread as the project's Chat page.
 */
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
  if (!projectId) notFound();

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
      ).map((m) => ({
        id: m.id,
        role: m.role,
        authorName: m.authorName,
        agentKey: (m.metadata as { agentKey?: string } | null)?.agentKey ?? null,
        mode: (m.metadata as { mode?: string } | null)?.mode ?? null,
        runId: (m.metadata as { runId?: string } | null)?.runId ?? null,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      }))
    : [];

  const objectives = await db
    .select()
    .from(schema.objectives)
    .where(eq(schema.objectives.projectId, projectId))
    .orderBy(desc(schema.objectives.createdAt));

  return (
    <div className="space-y-4 p-5">
      <PageHeader
        icon={<Sparkles className="size-4" />}
        title="COO"
        subtitle="Le COO est votre point d'entrée partout : parlez-lui, il comprend, planifie et exécute."
        action={
          <nav className="flex max-w-full flex-wrap gap-1" aria-label="Projets">
            {projects.map((p) => (
              <Link
                key={p.id}
                href={`/coo?project=${p.id}`}
                className={
                  p.id === projectId
                    ? 'rounded border border-accent/40 bg-accent/15 px-2 py-1 text-[11px] text-accent'
                    : 'rounded border border-line px-2 py-1 text-[11px] text-ink-3 hover:text-ink-1'
                }
              >
                {p.name}
              </Link>
            ))}
          </nav>
        }
      />
      <CooExecutive
        projectId={projectId}
        initialMessages={initialMessages}
        initialObjectives={objectives.map((o) => ({
          id: o.id,
          title: o.title,
          status: o.status,
          autonomyMode: o.autonomyMode,
        }))}
      />
    </div>
  );
}
