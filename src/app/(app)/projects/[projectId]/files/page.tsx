import { promises as fs } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { requireProject } from '@/auth/guards';
import { notFound } from 'next/navigation';
import { Badge, Card, EmptyState } from '@/components/ui/primitives';
import { formatBytes } from '@/lib/ui';
import { ensureProjectWorkspaceSandbox, isIgnoredSegment, toRelativePath } from '@/lib/sandbox';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Files' };

/**
 * Project files (§10).
 *
 * Shows the real sandbox contents plus the file records AI Core tracks. Paths
 * are read through the sandbox guard, so this view can never display anything
 * outside the project.
 */
export default async function FilesPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  let project;
  try {
    project = await requireProject(projectId);
  } catch {
    notFound();
  }

  const db = await getDb();
  const root = project.sandboxPath ?? (await ensureProjectWorkspaceSandbox(projectId));

  const entries: Array<{ path: string; type: 'file' | 'dir'; bytes: number | null }> = [];
  async function walk(dir: string, depth: number) {
    if (depth > 4 || entries.length > 1500) return;
    const items = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const item of items.sort((a, b) => a.name.localeCompare(b.name))) {
      if (isIgnoredSegment(item.name)) continue;
      const full = path.join(dir, item.name);
      const relative = toRelativePath(root, full);
      if (item.isDirectory()) {
        entries.push({ path: relative, type: 'dir', bytes: null });
        await walk(full, depth + 1);
      } else {
        const stat = await fs.stat(full).catch(() => null);
        entries.push({ path: relative, type: 'file', bytes: stat?.size ?? null });
      }
    }
  }
  await walk(root, 1);

  const fileRecords = await db
    .select()
    .from(schema.files)
    .where(eq(schema.files.projectId, projectId));

  const totalBytes = entries.reduce((sum, e) => sum + (e.bytes ?? 0), 0);

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-5">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Files</h1>
        <p className="text-[13px] text-ink-3">
          {entries.length} entries · {formatBytes(totalBytes)} in the project sandbox
        </p>
      </div>

      {entries.length === 0 ? (
        <Card>
          <div className="p-6">
            <EmptyState
              title="The sandbox is empty"
              description="Connect a repository, upload a reference file, or let AI Core create files during a run."
            />
          </div>
        </Card>
      ) : (
        <Card title="Sandbox contents" description="node_modules, .git and build output are hidden">
          <ul className="divide-y divide-line font-mono text-[11.5px]">
            {entries.map((entry) => (
              <li key={entry.path} className="flex items-center gap-2 px-4 py-1">
                <span className={entry.type === 'dir' ? 'text-accent' : 'text-ink-4'}>
                  {entry.type === 'dir' ? '▸' : '·'}
                </span>
                <span className="min-w-0 flex-1 truncate text-ink-2">{entry.path}</span>
                <span className="shrink-0 text-[10.5px] text-ink-4">{formatBytes(entry.bytes)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card
        title="Tracked file records"
        description="Uploads, generated outputs and artifacts with parsed content and version history"
      >
        {fileRecords.length === 0 ? (
          <div className="p-4">
            <EmptyState
              compact
              title="No tracked files yet"
              description="Files created by the artifact tool or uploaded through the UI are recorded here with their parsed text, so agents can retrieve relevant content without loading whole documents."
            />
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {fileRecords.map((file) => (
              <li key={file.id} className="flex items-center gap-2 px-4 py-2">
                <Badge tone={file.kind === 'artifact' ? 'info' : file.kind === 'generated' ? 'accent' : 'idle'}>
                  {file.kind}
                </Badge>
                <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-2">{file.path}</span>
                <span className="font-mono text-[10px] text-ink-4">v{file.version}</span>
                <span className="text-[10.5px] text-ink-4">{formatBytes(file.bytes)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
