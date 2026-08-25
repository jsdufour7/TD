import { desc, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { getDb, schema } from '@/db/client';
import { requireProject } from '@/auth/guards';
import { getCurrentUser } from '@/auth/session';
import { AGENT_CATALOG } from '@/agents/catalog';
import { MeetingRoom } from '@/components/chat/meeting-room';
import { CooExecutive } from '@/components/coo/coo-executive';
import { PageHeader } from '@/components/layout/page-header';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Discussion' };

/**
 * Chat with the COO / meeting room.
 *
 * One-on-one with the COO by default; convene any agents to turn a thread into a
 * meeting where each agent answers in role and sees the prior contributions.
 */
export default async function ChatPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  let project;
  try {
    project = await requireProject(projectId);
  } catch {
    notFound();
  }
  const user = await getCurrentUser();

  const db = await getDb();
  const threads = await db
    .select()
    .from(schema.conversations)
    .where(eq(schema.conversations.projectId, projectId))
    .orderBy(desc(schema.conversations.updatedAt));

  // The first thread's messages are rendered server-side so the initial paint is
  // complete; subsequent threads load in event handlers on the client.
  const objectives = await db
    .select()
    .from(schema.objectives)
    .where(eq(schema.objectives.projectId, projectId))
    .orderBy(desc(schema.objectives.createdAt));

  const firstThreadId = threads[0]?.id ?? null;
  const initialMessages = firstThreadId
    ? (
        await db
          .select()
          .from(schema.messages)
          .where(eq(schema.messages.conversationId, firstThreadId))
          .orderBy(schema.messages.createdAt)
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

  return (
    <div className="space-y-4 p-5">
      <PageHeader
        title="Discussion & salle de réunion"
        subtitle="Clavardez avec le COO à volonté, ou convoquez les agents nécessaires. Sans passerelle modèle, le COO répond à partir des données réelles du projet."
      />
      <CooExecutive
        projectId={project.id}
        initialMessages={initialMessages}
        initialObjectives={objectives.map((o) => ({
          id: o.id,
          title: o.title,
          status: o.status,
          autonomyMode: o.autonomyMode,
        }))}
      />

      <MeetingRoom
        projectId={project.id}
        selfName={user?.name ?? 'Vous'}
        agents={AGENT_CATALOG.map((a) => ({ key: a.key, name: a.name, role: a.role, accentColor: a.accentColor }))}
        initialThreads={threads.map((t) => ({
          id: t.id,
          title: t.title,
          participants: t.participants,
          updatedAt: t.updatedAt.toISOString(),
        }))}
        initialMessages={initialMessages}
      />
    </div>
  );
}
