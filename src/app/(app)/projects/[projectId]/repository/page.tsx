import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { requireProject } from '@/auth/guards';
import { notFound } from 'next/navigation';
import { Badge, Card, EmptyState } from '@/components/ui/primitives';
import { toneFor, timeAgo } from '@/lib/ui';
import { ConnectRepository } from '@/components/work/connect-repository';
import { summariseInspection, type RepoInspection } from '@/repo/inspect';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Repository' };

export default async function RepositoryPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  try {
    await requireProject(projectId);
  } catch {
    notFound();
  }

  const db = await getDb();
  const repositories = await db
    .select()
    .from(schema.repositories)
    .where(eq(schema.repositories.projectId, projectId));

  const repository = repositories[0];
  const inspection = repository?.inspection as RepoInspection | null;

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Repository</h1>
          <p className="text-[13px] text-ink-3">
            Inspection is read-only and always runs before anything is modified.
          </p>
        </div>
        <ConnectRepository projectId={projectId} hasRepository={Boolean(repository)} />
      </div>

      {!repository ? (
        <Card>
          <div className="p-6">
            <EmptyState
              title="No repository connected"
              description="Connect a remote repository or initialise a git repository in this project's sandbox. AI Core inspects the manifest, framework, languages, test setup and conventions before making any change."
            />
          </div>
        </Card>
      ) : (
        <>
          <Card title={repository.name} description={repository.remoteUrl ?? 'Local working copy'}>
            <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
              <Fact label="Status" value={<Badge tone={toneFor(repository.connectionStatus)}>{repository.connectionStatus}</Badge>} />
              <Fact label="Branch" value={<span className="font-mono text-[12px]">{repository.currentBranch ?? repository.defaultBranch}</span>} />
              <Fact label="HEAD" value={<span className="font-mono text-[12px]">{repository.headSha?.slice(0, 10) ?? '—'}</span>} />
              <Fact
                label="Push"
                value={
                  repository.allowPush ? (
                    <span className="text-[12px] text-ok">permitted</span>
                  ) : (
                    <span className="text-[12px] text-ink-3">disabled by default</span>
                  )
                }
              />
            </div>
            {repository.connectionError ? (
              <pre className="border-t border-line p-3 font-mono text-[11px] text-danger">{repository.connectionError}</pre>
            ) : null}
            <p className="border-t border-line px-4 py-2 text-[11px] text-ink-4">
              {repository.inspectedAt ? `Last inspected ${timeAgo(repository.inspectedAt.toISOString())}` : 'Never inspected'}
            </p>
          </Card>

          {inspection ? (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card title="Detected stack">
                  <div className="space-y-3 p-4">
                    <Fact label="Files" value={<span className="font-mono text-[12px]">{inspection.fileCount}</span>} />
                    <div>
                      <p className="text-[11px] text-ink-4">Languages</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {Object.entries(inspection.languages)
                          .sort((a, b) => b[1] - a[1])
                          .map(([name, count]) => (
                            <span key={name} className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10.5px] text-ink-2">
                              {name} · {count}
                            </span>
                          ))}
                      </div>
                    </div>
                    {inspection.frameworks.length > 0 ? (
                      <div>
                        <p className="text-[11px] text-ink-4">Frameworks</p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {inspection.frameworks.map((framework) => (
                            <span key={framework} className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10.5px] text-ink-2">
                              {framework}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    <Fact
                      label="Package manager"
                      value={<span className="font-mono text-[12px]">{inspection.packageManager ?? 'unknown'}</span>}
                    />
                    {inspection.conventions.length > 0 ? (
                      <p className="text-[11.5px] text-ink-3">{inspection.conventions.join(' · ')}</p>
                    ) : null}
                  </div>
                </Card>

                <Card title="Scripts & tests" description="What AI Core is allowed to run for verification">
                  <div className="space-y-3 p-4">
                    {Object.keys(inspection.scripts).length > 0 ? (
                      <div>
                        <p className="text-[11px] text-ink-4">npm scripts</p>
                        <ul className="mt-1 space-y-0.5">
                          {Object.entries(inspection.scripts).map(([name, command]) => (
                            <li key={name} className="flex gap-2 font-mono text-[11px]">
                              <span className="text-accent">{name}</span>
                              <span className="min-w-0 flex-1 truncate text-ink-3">{command}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <p className="text-[11.5px] text-ink-4">No scripts declared</p>
                    )}
                    <div>
                      <p className="text-[11px] text-ink-4">Test frameworks</p>
                      <p className="font-mono text-[11.5px] text-ink-2">
                        {inspection.testFrameworks.length > 0 ? inspection.testFrameworks.join(', ') : 'none detected'}
                      </p>
                    </div>
                    {inspection.databaseHints.length > 0 ? (
                      <div>
                        <p className="text-[11px] text-ink-4">Database</p>
                        <p className="text-[11.5px] text-ink-2">{inspection.databaseHints.join('; ')}</p>
                      </div>
                    ) : null}
                    {inspection.envTemplates.length > 0 ? (
                      <div>
                        <p className="text-[11px] text-ink-4">Env templates</p>
                        <p className="font-mono text-[11.5px] text-ink-2">{inspection.envTemplates.join(', ')}</p>
                      </div>
                    ) : null}
                  </div>
                </Card>
              </div>

              {inspection.warnings.length > 0 ? (
                <Card title="Inspection warnings">
                  <ul className="space-y-1 p-4">
                    {inspection.warnings.map((warning) => (
                      <li key={warning} className="text-[12px] text-warn">
                        ⚠ {warning}
                      </li>
                    ))}
                  </ul>
                </Card>
              ) : null}

              <Card title="Git history" description="Most recent commits at inspection time">
                {inspection.git.recentCommits.length === 0 ? (
                  <div className="p-4">
                    <EmptyState compact title="No commits" description="The working copy has no history yet." />
                  </div>
                ) : (
                  <ul className="divide-y divide-line">
                    {inspection.git.recentCommits.map((commit) => (
                      <li key={commit.sha} className="flex items-center gap-3 px-4 py-2">
                        <span className="font-mono text-[11px] text-accent">{commit.sha.slice(0, 7)}</span>
                        <span className="min-w-0 flex-1 truncate text-[12px] text-ink-1">{commit.message}</span>
                        <span className="shrink-0 text-[10.5px] text-ink-4">{commit.author}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card title="Summary stored as project memory" description="This is what agents see as repository context">
                <pre className="overflow-x-auto p-4 font-mono text-[11px] leading-relaxed text-ink-2">
                  {summariseInspection(inspection, repository.name)}
                </pre>
              </Card>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10.5px] tracking-wide text-ink-4 uppercase">{label}</p>
      <div className="mt-0.5">{value}</div>
    </div>
  );
}
