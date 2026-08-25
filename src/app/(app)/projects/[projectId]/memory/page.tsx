import { desc, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { requireProject } from '@/auth/guards';
import { notFound } from 'next/navigation';
import { Badge, Card, EmptyState } from '@/components/ui/primitives';
import { timeAgo } from '@/lib/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Memory' };

const KINDS = [
  { key: 'canonical', label: 'Canonical', hint: 'Stable facts: stack, positioning, constraints' },
  { key: 'decision', label: 'Decisions', hint: 'Architectural and product decisions with reasons' },
  { key: 'preference', label: 'Preferences', hint: 'How you want things implemented' },
  { key: 'execution', label: 'Execution', hint: 'What agents changed, tested, failed and fixed' },
  { key: 'working', label: 'Working', hint: 'Temporary context for the current task' },
] as const;

/**
 * Project memory (§9).
 *
 * Deliberately separated by kind. The context engine retrieves selectively:
 * canonical, decision and preference memory are always candidates, while working
 * and execution memory are only pulled when there is an active task.
 */
export default async function MemoryPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  try {
    await requireProject(projectId);
  } catch {
    notFound();
  }

  const db = await getDb();
  const memories = await db
    .select()
    .from(schema.memories)
    .where(eq(schema.memories.projectId, projectId))
    .orderBy(desc(schema.memories.isPinned), desc(schema.memories.updatedAt));

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-5">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Project memory</h1>
        <p className="text-[13px] text-ink-3">
          {memories.length} item(s). Context is assembled selectively — AI Core does not dump every
          memory into every prompt.
        </p>
      </div>

      {memories.length === 0 ? (
        <Card>
          <div className="p-6">
            <EmptyState
              title="No memories recorded"
              description="Memories are created when a project is created, when a repository is inspected, and when runs finish. You can also add canonical facts here."
            />
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {KINDS.map((kind) => {
            const items = memories.filter((m) => m.kind === kind.key);
            return (
              <Card
                key={kind.key}
                title={kind.label}
                description={kind.hint}
                action={<span className="font-mono text-[10px] text-ink-4">{items.length}</span>}
              >
                {items.length === 0 ? (
                  <div className="p-3">
                    <EmptyState compact title="Nothing recorded" />
                  </div>
                ) : (
                  <ul className="divide-y divide-line">
                    {items.map((memory) => (
                      <li key={memory.id} className="px-4 py-2.5">
                        <div className="flex items-start gap-2">
                          {memory.isPinned ? <Badge tone="accent">pinned</Badge> : null}
                          <div className="min-w-0 flex-1">
                            <p className="text-[12.5px] font-medium text-ink-1">{memory.title}</p>
                            <p className="mt-0.5 whitespace-pre-wrap text-[11.5px] text-ink-3">{memory.content}</p>
                            <p className="mt-1 font-mono text-[10px] text-ink-4">
                              {memory.source ?? 'unknown'} · confidence {memory.confidence} ·{' '}
                              {timeAgo(memory.updatedAt.toISOString())}
                            </p>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
