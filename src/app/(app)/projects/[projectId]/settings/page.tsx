import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { requireProject } from '@/auth/guards';
import { notFound } from 'next/navigation';
import { Badge, Card, EmptyState } from '@/components/ui/primitives';
import { toneFor } from '@/lib/ui';
import { ProjectSettingsForm } from '@/components/work/project-settings-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Settings' };

export default async function ProjectSettingsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  let project;
  try {
    project = await requireProject(projectId);
  } catch {
    notFound();
  }

  const db = await getDb();
  const [instructions, environments, repository] = await Promise.all([
    db.select().from(schema.projectInstructions).where(eq(schema.projectInstructions.projectId, projectId)),
    db.select().from(schema.environments).where(eq(schema.environments.projectId, projectId)),
    db.select().from(schema.repositories).where(eq(schema.repositories.projectId, projectId)).limit(1),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-5">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Project settings</h1>
        <p className="text-[13px] text-ink-3">
          Identity, instructions and environments. Instructions are injected into every agent prompt.
        </p>
      </div>

      <ProjectSettingsForm
        project={{
          id: project.id,
          name: project.name,
          slug: project.slug,
          description: project.description,
          businessPurpose: project.businessPurpose,
          sandboxPath: project.sandboxPath,
        }}
        instructions={instructions.map((i) => ({
          id: i.id,
          kind: i.kind,
          title: i.title,
          content: i.content,
          isActive: i.isActive,
        }))}
      />

      <Card title="Environments" description="Deployments target one of these; production always requires approval">
        <ul className="divide-y divide-line">
          {environments.map((environment) => (
            <li key={environment.id} className="flex items-center gap-2 px-4 py-2">
              <Badge tone={environment.isProduction ? 'danger' : 'idle'}>{environment.key}</Badge>
              <span className="min-w-0 flex-1 text-[12.5px] text-ink-1">{environment.name}</span>
              <span className="font-mono text-[10.5px] text-ink-4">{environment.url ?? 'no url'}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Isolation" description="How this project is separated from every other project">
        <div className="space-y-2 p-4 text-[12px] text-ink-2">
          <p>
            <span className="text-ink-4">Sandbox root:</span>{' '}
            <code className="font-mono text-[11px] text-accent">{project.sandboxPath ?? 'not created'}</code>
          </p>
          <p>
            Every file tool path and every command working directory is resolved against this root and
            rejected if it escapes — including through <code className="font-mono">..</code> or symlinks.
          </p>
          <p>
            Every API route loads this project through an organisation-scoped query. A project id
            belonging to another organisation returns 403 before any of its data is read.
          </p>
          <p className="text-ink-3">
            This is V1 path-confinement sandboxing, not container isolation. See SECURITY.md for the
            exact boundary and what still requires hardening.
          </p>
        </div>
      </Card>

      <Card title="Repository">
        {repository[0] ? (
          <div className="space-y-2 p-4 text-[12px] text-ink-2">
            <p>
              <span className="text-ink-4">Name:</span> {repository[0].name}
            </p>
            <p>
              <span className="text-ink-4">Status:</span>{' '}
              <Badge tone={toneFor(repository[0].connectionStatus)}>{repository[0].connectionStatus}</Badge>
            </p>
            <p>
              <span className="text-ink-4">Push:</span>{' '}
              {repository[0].allowPush ? (
                <span className="text-ok">permitted</span>
              ) : (
                <span className="text-ink-3">
                  disabled — AI Core commits locally and requests approval before any remote action
                </span>
              )}
            </p>
          </div>
        ) : (
          <div className="p-4">
            <EmptyState compact title="No repository connected" />
          </div>
        )}
      </Card>
    </div>
  );
}
