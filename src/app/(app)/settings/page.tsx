import { getDb, schema } from '@/db/client';
import { getCurrentUser } from '@/auth/session';
import { Badge, Card } from '@/components/ui/primitives';
import { toneFor } from '@/lib/ui';
import { PageHeader } from '@/components/layout/page-header';
import { env } from '@/lib/env';
import { liveCommandCount } from '@/engine/command-runner';
import { browserCapability } from '@/tools/browser-tools';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Settings' };

/**
 * Platform settings and an honest capability report.
 *
 * This page states plainly what is configured and what is not, rather than
 * presenting an interface that looks operational but does nothing (§49).
 */
export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const db = await getDb();
  const [integrations, providers, orgs] = await Promise.all([
    db.select().from(schema.integrations),
    db.select().from(schema.modelProviders),
    db.select().from(schema.organizations),
  ]);

  const browser = await browserCapability();
  const usableProviders = providers.filter((p) => p.isEnabled && p.healthStatus !== 'offline');

  const capabilities: Array<{ name: string; state: 'ready' | 'partial' | 'missing'; detail: string }> = [
    {
      name: 'Persistent runs & recovery',
      state: 'ready',
      detail: 'Runs, tasks, events and checkpoints are stored in PostgreSQL. A refresh or restart resumes from the last checkpoint.',
    },
    {
      name: 'Repository & file tools',
      state: 'ready',
      detail: 'Read, write, patch, search, list, git status/diff/branch/commit — confined to the project sandbox.',
    },
    {
      name: 'Command execution',
      state: 'ready',
      detail: 'spawn() with an argv array and no shell, so shell metacharacters cannot inject commands. Timeout, cancellation and full output capture.',
    },
    {
      name: 'Model gateway',
      state: usableProviders.length > 0 ? 'ready' : 'missing',
      detail:
        usableProviders.length > 0
          ? `${usableProviders.length} provider(s) available for routing.`
          : 'No provider is configured. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or LOCAL_MODEL_BASE_URL for a local endpoint.',
    },
    {
      name: 'Browser verification',
      state: browser.available ? 'ready' : 'missing',
      detail: browser.reason,
    },
    {
      name: 'Live preview',
      state: 'partial',
      detail: 'Dev-server URL detection and an embedded preview work. Console and network error capture need the browser runtime above.',
    },
    {
      name: 'Deployment adapters',
      state: 'missing',
      detail: 'Vercel and Cloudflare adapters are not implemented in V1. The deploy tool records an explicit error instead of faking success.',
    },
    {
      name: 'Web search',
      state: 'missing',
      detail: 'No search provider is configured. fetch_url works for known URLs with an SSRF guard.',
    },
    {
      name: 'Container isolation',
      state: 'missing',
      detail: 'Sandboxing is path-confinement only. True isolation needs containers — see SECURITY.md.',
    },
  ];

  const TONE: Record<string, string> = { ready: 'ok', partial: 'warn', missing: 'idle' };

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-5 lg:p-7">
      <PageHeader title="Settings" subtitle="Platform configuration and an honest report of what this installation can actually do." />

      <Card title="Account">
        <dl className="grid gap-3 p-4 text-[12px] sm:grid-cols-2">
          <div>
            <dt className="text-[10px] tracking-wide text-ink-4 uppercase">Signed in as</dt>
            <dd className="text-ink-1">{user.name}</dd>
            <dd className="font-mono text-[11px] text-ink-3">{user.email}</dd>
          </div>
          <div>
            <dt className="text-[10px] tracking-wide text-ink-4 uppercase">Organisation</dt>
            <dd className="text-ink-1">{orgs.find((o) => o.id === user.organizationId)?.name ?? '—'}</dd>
            <dd className="text-[11px] text-ink-3">role: {user.role}</dd>
          </div>
          <div>
            <dt className="text-[10px] tracking-wide text-ink-4 uppercase">Environment</dt>
            <dd className="font-mono text-ink-1">{env.appEnv}</dd>
          </div>
          <div>
            <dt className="text-[10px] tracking-wide text-ink-4 uppercase">Database</dt>
            <dd className="font-mono text-ink-1">{env.database.driver}</dd>
            <dd className="text-[11px] text-ink-3">
              {env.database.driver === 'pglite' ? 'embedded PostgreSQL engine' : 'node-postgres'}
            </dd>
          </div>
        </dl>
      </Card>

      <Card title="Capability report" description="What is genuinely operational in this installation">
        <ul className="divide-y divide-line">
          {capabilities.map((capability) => (
            <li key={capability.name} className="flex items-start gap-3 px-4 py-2.5">
              <Badge tone={TONE[capability.state]}>{capability.state}</Badge>
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] text-ink-1">{capability.name}</p>
                <p className="text-[11.5px] text-ink-3">{capability.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Integrations" description="Adapter registry">
        <ul className="divide-y divide-line">
          {integrations.map((integration) => (
            <li key={integration.id} className="flex items-center gap-2 px-4 py-2">
              <Badge tone={toneFor(integration.status)}>{integration.status.replace(/_/g, ' ')}</Badge>
              <span className="min-w-0 flex-1 text-[12.5px] text-ink-1">{integration.name}</span>
              <span className="text-[11px] text-ink-4">{integration.message}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Runtime">
        <dl className="grid gap-3 p-4 text-[12px] sm:grid-cols-3">
          <div>
            <dt className="text-[10px] tracking-wide text-ink-4 uppercase">Run engine</dt>
            <dd className="text-ink-1">{env.runEngine.enabled ? 'enabled' : 'disabled'}</dd>
            <dd className="font-mono text-[11px] text-ink-3">concurrency {env.runEngine.concurrency}</dd>
          </div>
          <div>
            <dt className="text-[10px] tracking-wide text-ink-4 uppercase">Live commands</dt>
            <dd className="font-mono text-ink-1">{liveCommandCount()}</dd>
          </div>
          <div>
            <dt className="text-[10px] tracking-wide text-ink-4 uppercase">Sandbox root</dt>
            <dd className="break-all font-mono text-[10.5px] text-ink-3">{env.sandbox.root}</dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}
