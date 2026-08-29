import Link from 'next/link';
import { and, eq, inArray } from 'drizzle-orm';
import { Activity, Cable, CheckCircle2, CircleDollarSign, Cloud, Cpu, Gauge, HardDrive, ServerCog, ShieldCheck, Sparkles, Zap } from 'lucide-react';
import { getCurrentUser } from '@/auth/session';
import { getDb, schema } from '@/db/client';
import { usageSummary } from '@/ai/router';
import { PageHeader } from '@/components/layout/page-header';
import { Badge, Card, Notice } from '@/components/ui/primitives';
import { formatCost } from '@/lib/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Compute' };

const MARKETPLACES = [
  { name: 'Vast.ai', description: 'Marketplace GPU multi-hôtes. Adaptateur de provisioning à brancher.', strength: 'Prix / diversité' },
  { name: 'GPU.ai', description: 'Catalogue GPU hébergé. Adaptateur de provisioning à brancher.', strength: 'Simplicité / disponibilité' },
  { name: 'Xesktop', description: 'Instances à forte VRAM. Adaptateur de provisioning à brancher.', strength: 'Gros modèles / VRAM' },
] as const;

const ACTIVE_RUN_STATUSES = ['running', 'queued', 'paused', 'waiting_for_approval'] as const;

function Metric({ label, value, hint, icon, tone = 'accent' }: {
  label: string;
  value: string | number;
  hint: string;
  icon: React.ReactNode;
  tone?: 'accent' | 'ok' | 'info' | 'warn';
}) {
  const tones = {
    accent: 'text-accent bg-accent/12 border-accent/22',
    ok: 'text-ok bg-ok/10 border-ok/20',
    info: 'text-info bg-info/10 border-info/20',
    warn: 'text-warn bg-warn/10 border-warn/20',
  };
  return (
    <div className="rounded-xl border border-line bg-surface-1 p-4 shadow-card edge-top">
      <div className={`mb-3 grid size-9 place-items-center rounded-lg border ${tones[tone]}`}>{icon}</div>
      <p className="text-[9.5px] font-bold tracking-[0.11em] text-ink-4 uppercase">{label}</p>
      <p className="mt-1 text-[1.65rem] font-semibold tracking-tight text-ink-1">{value}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-ink-4">{hint}</p>
    </div>
  );
}

export default async function ComputePage() {
  const user = await getCurrentUser();
  if (!user) return null;
  const db = await getDb();

  const projects = await db.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.organizationId, user.organizationId));
  const projectIds = projects.map((project) => project.id);

  const [providers, models, activeRuns, usage] = await Promise.all([
    db.select().from(schema.modelProviders),
    db.select().from(schema.modelDefinitions),
    projectIds.length
      ? db.select({ id: schema.agentRuns.id, status: schema.agentRuns.status }).from(schema.agentRuns).where(
          and(inArray(schema.agentRuns.projectId, projectIds), inArray(schema.agentRuns.status, [...ACTIVE_RUN_STATUSES])),
        )
      : Promise.resolve([] as Array<{ id: string; status: string }>),
    usageSummary(),
  ]);

  const enabledProviders = providers.filter((provider) => provider.isEnabled);
  const onlineProviders = enabledProviders.filter((provider) => provider.healthStatus === 'online');
  const localProviders = enabledProviders.filter((provider) => provider.isLocal);
  const localProviderIds = new Set(localProviders.map((provider) => provider.id));
  const localModels = models.filter((model) => localProviderIds.has(model.providerId));
  const onlineLocal = localProviders.filter((provider) => provider.healthStatus === 'online');
  const running = activeRuns.filter((run) => run.status === 'running').length;

  return (
    <div className="mx-auto max-w-[1480px] space-y-4 p-4 lg:p-6">
      <PageHeader
        title="Compute"
        subtitle="Gestion intelligente des ressources GPU et environnements d’exécution. Les données locales sont réelles; les marketplaces externes restent explicitement non connectées jusqu’à l’activation de leurs adaptateurs."
        icon={<ServerCog className="size-4" />}
        meta={
          <>
            <Badge tone={onlineLocal.length ? 'ok' : 'idle'} dot={onlineLocal.length > 0}>
              {onlineLocal.length ? `${onlineLocal.length} local en ligne` : 'local hors ligne'}
            </Badge>
            <Badge tone={activeRuns.length ? 'accent' : 'idle'}>{activeRuns.length} run(s) actif(s)</Badge>
          </>
        }
        action={
          <Link href="/models" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line-strong bg-surface-1 px-3 text-xs font-medium text-ink-1 hover:bg-surface-2">
            <Cable className="size-3.5" /> Configurer les passerelles
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Runs AI Core" value={activeRuns.length} hint={`${running} en exécution · ${activeRuns.length - running} en attente, pause ou approbation`} icon={<Activity className="size-4" />} tone={activeRuns.length ? 'ok' : 'accent'} />
        <Metric label="Passerelles modèles" value={`${onlineProviders.length}/${enabledProviders.length}`} hint={`${models.length} modèles enregistrés dans la gateway`} icon={<Cpu className="size-4" />} tone={onlineProviders.length ? 'info' : 'warn'} />
        <Metric label="Compute local" value={onlineLocal.length} hint={`${localModels.length} modèle(s) local(aux) découvert(s)`} icon={<HardDrive className="size-4" />} tone={onlineLocal.length ? 'ok' : 'warn'} />
        <Metric label="Coût modèles enregistré" value={formatCost(usage.totalCostUsd)} hint={`${usage.totalCalls} appel(s) réels comptabilisés`} icon={<CircleDollarSign className="size-4" />} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <Card title="GPU Fleet" description="Local et futurs fournisseurs dans une seule vue. Aucun prix n’est présenté comme live avant connexion de l’API." action={<Badge tone="info">Compute V1</Badge>}>
            <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl border border-accent/30 bg-accent/7 p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="grid size-9 place-items-center rounded-lg border border-accent/25 bg-accent/12 text-accent"><HardDrive className="size-4.5" /></div>
                  <Badge tone={onlineLocal.length ? 'ok' : 'idle'}>{onlineLocal.length ? 'disponible' : 'non connecté'}</Badge>
                </div>
                <p className="mt-3 text-sm font-semibold text-ink-1">Local / privé</p>
                <p className="mt-1 min-h-10 text-[11px] leading-relaxed text-ink-3">
                  {localProviders.length ? `${localProviders.length} passerelle(s), ${localModels.length} modèle(s).` : 'Ajoutez llama.cpp, Ollama ou une passerelle compatible.'}
                </p>
                <p className="mt-3 border-t border-line pt-3 text-[10px] text-ink-4">Location externe : aucune</p>
              </div>

              {MARKETPLACES.map((marketplace) => (
                <div key={marketplace.name} className="rounded-xl border border-line bg-surface-2/65 p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="grid size-9 place-items-center rounded-lg border border-line bg-surface-3 text-ink-2"><Cloud className="size-4.5" /></div>
                    <Badge tone="idle">adapter requis</Badge>
                  </div>
                  <p className="mt-3 text-sm font-semibold text-ink-1">{marketplace.name}</p>
                  <p className="mt-1 min-h-10 text-[11px] leading-relaxed text-ink-3">{marketplace.description}</p>
                  <div className="mt-3 border-t border-line pt-3">
                    <p className="text-[9.5px] font-bold tracking-wide text-ink-4 uppercase">Force visée</p>
                    <p className="mt-0.5 text-[11px] font-medium text-ink-2">{marketplace.strength}</p>
                    <p className="mt-1 text-[10px] text-ink-4">Prix live : non connecté</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Router & Orchestration" description="Le COO décidera du compute selon contraintes, coût et disponibilité dès que les adapters seront branchés.">
            <div className="grid gap-3 p-4 md:grid-cols-3">
              {[
                [Gauge, 'Contraintes', 'VRAM, modèle, durée, confidentialité, localisation et budget.', 'text-accent'],
                [Sparkles, 'Choix COO', 'Comparaison uniquement sur des données réellement disponibles.', 'text-info'],
                [ShieldCheck, 'Approbation', 'Toute location payante passe par le garde-fou d’approbation.', 'text-ok'],
              ].map(([Icon, title, body, color]) => {
                const C = Icon as typeof Gauge;
                return (
                  <div key={String(title)} className="rounded-lg border border-line bg-surface-2 p-3.5">
                    <div className={`flex items-center gap-2 ${String(color)}`}><C className="size-4" /><p className="text-xs font-semibold">{String(title)}</p></div>
                    <p className="mt-2 text-[11px] leading-relaxed text-ink-3">{String(body)}</p>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card title="Passerelles locales" description="État lu directement depuis la gateway AI Core.">
            {localProviders.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-left text-[11.5px]">
                  <thead className="border-b border-line bg-surface-2 text-[10px] tracking-wide text-ink-4 uppercase">
                    <tr><th className="px-4 py-2">Passerelle</th><th className="px-4 py-2">Endpoint</th><th className="px-4 py-2">État</th><th className="px-4 py-2">Modèles</th></tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {localProviders.map((provider) => (
                      <tr key={provider.id}>
                        <td className="px-4 py-2.5 font-medium text-ink-1">{provider.name}</td>
                        <td className="max-w-[360px] truncate px-4 py-2.5 font-mono text-[10.5px] text-ink-3">{provider.baseUrl}</td>
                        <td className="px-4 py-2.5"><Badge tone={provider.healthStatus === 'online' ? 'ok' : provider.healthStatus === 'offline' ? 'danger' : 'idle'} dot={provider.healthStatus === 'online'}>{provider.healthStatus}</Badge></td>
                        <td className="px-4 py-2.5 font-mono text-ink-2">{models.filter((model) => model.providerId === provider.id).length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-4"><Notice tone="info" title="Aucune passerelle locale enregistrée">Ajoutez llama.cpp ou Ollama dans Modèles pour faire apparaître son état réel ici.</Notice></div>
            )}
          </Card>
        </div>

        <aside className="space-y-4">
          <Card title="Recommandation COO" description="Basée uniquement sur ce que la plateforme sait réellement.">
            <div className="p-4">
              {onlineLocal.length ? (
                <div className="rounded-xl border border-ok/30 bg-ok/8 p-3.5">
                  <div className="flex items-center gap-2 text-ok"><CheckCircle2 className="size-4" /><p className="text-xs font-semibold">Compute local disponible</p></div>
                  <p className="mt-2 text-[11px] leading-relaxed text-ink-2">{onlineLocal.length} passerelle(s) locale(s) répondent.</p>
                </div>
              ) : (
                <div className="rounded-xl border border-warn/30 bg-warn/8 p-3.5">
                  <div className="flex items-center gap-2 text-warn"><Zap className="size-4" /><p className="text-xs font-semibold">Backend Compute requis</p></div>
                  <p className="mt-2 text-[11px] leading-relaxed text-ink-2">Aucun backend local n’est en ligne et aucun marketplace GPU n’est encore connecté. Aucun prix n’est inventé.</p>
                </div>
              )}
            </div>
          </Card>
          <Card title="Roadmap Compute">
            <div className="space-y-2 p-4 text-[11px] text-ink-3">
              <p>1. Catalogue GPU live</p><p>2. Devis normalisés</p><p>3. Approbation d’achat</p><p>4. Provisioning & health</p><p>5. Arrêt et coût final</p>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
