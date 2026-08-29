import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { getCurrentUser } from '@/auth/session';
import { requireUser } from '@/auth/guards';
import { DrivingMode } from '@/components/coo/driving-mode';
import { Car, FolderPlus } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Card, EmptyState } from '@/components/ui/primitives';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Mode Voiture' };

export default async function DrivePage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  await requireUser();
  const { project: projectIdParam } = await searchParams;
  const user = await getCurrentUser();
  const db = await getDb();

  const projects = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.organizationId, user!.organizationId))
    .orderBy(desc(schema.projects.updatedAt));

  const projectId = projectIdParam ?? projects[0]?.id;

  if (!projectId) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 p-5 lg:p-7">
        <PageHeader
          icon={<Car className="size-4" />}
          title="Mode Voiture"
          subtitle="Conversation mains libres avec le COO. Un projet est requis pour conserver le contexte et les actions."
        />
        <Card>
          <div className="p-5">
            <EmptyState
              title="Aucun projet à piloter en mode voiture"
              description="Créez d’abord un projet; le mode voix utilisera ensuite exactement le même contexte persistant que le COO."
              icon={<Car className="size-5" />}
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

  return (
    <div className="mx-auto max-w-[1480px] space-y-4 p-4 lg:p-6">
      <PageHeader
        icon={<Car className="size-4" />}
        title="Mode Voiture"
        subtitle="Mains libres : parlez, le COO répond à voix haute. « Stop » ou « Attends » coupe net et vous redonne la parole."
        action={
          <nav className="flex max-w-full flex-wrap gap-1" aria-label="Projets">
            {projects.map((project) => (
              <Link
                key={project.id}
                href={`/drive?project=${project.id}`}
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
      <DrivingMode projectId={projectId} />
    </div>
  );
}
