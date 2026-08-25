import { desc, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { requireProject } from '@/auth/guards';
import { notFound } from 'next/navigation';
import { Badge, Card, EmptyState } from '@/components/ui/primitives';
import { timeAgo, formatBytes } from '@/lib/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Artifacts' };

export default async function ArtifactsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  try {
    await requireProject(projectId);
  } catch {
    notFound();
  }

  const db = await getDb();
  const artifacts = await db
    .select()
    .from(schema.artifacts)
    .where(eq(schema.artifacts.projectId, projectId))
    .orderBy(desc(schema.artifacts.createdAt));

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-5">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Artifacts</h1>
        <p className="text-[13px] text-ink-3">
          Finished deliverables, versioned and linked to the run that produced them.
        </p>
      </div>

      {artifacts.length === 0 ? (
        <Card>
          <div className="p-6">
            <EmptyState
              title="No artifacts yet"
              description="Agents store specifications, reports, schemas and documents here using the create_artifact tool."
            />
          </div>
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {artifacts.map((artifact) => (
              <li key={artifact.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="info">{artifact.type}</Badge>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink-1">{artifact.name}</span>
                  <span className="font-mono text-[10.5px] text-ink-4">v{artifact.version}</span>
                  <span className="font-mono text-[10.5px] text-ink-4">{formatBytes(artifact.bytes)}</span>
                  <span className="text-[10.5px] text-ink-4">{timeAgo(artifact.createdAt.toISOString())}</span>
                </div>
                {artifact.description ? (
                  <p className="mt-1 text-[11.5px] text-ink-3">{artifact.description}</p>
                ) : null}
                <p className="mt-1 font-mono text-[10px] text-ink-4">
                  {artifact.storageKey ?? 'no storage reference'} · created by {artifact.createdByAgentKey ?? 'user'}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
