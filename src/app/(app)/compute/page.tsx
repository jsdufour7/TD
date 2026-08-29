import Link from 'next/link';
import { and, eq, inArray } from 'drizzle-orm';
import {
  Activity,
  Cable,
  CheckCircle2,
  CircleDollarSign,
  Cloud,
  Cpu,
  Gauge,
  HardDrive,
  ServerCog,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react';
import { getCurrentUser } from '@/auth/session';
import { getDb, schema } from '@/db/client';
import { usageSummary } from '@/ai/router';
import { PageHeader } from '@/components/layout/page-header';
import { Badge, Card, Notice } from '@/components/ui/primitives';
import { formatCost } from '@/lib/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Compute' };

const MARKETPLACES = [
  {
    name: 'Vast.ai',
    description: 'Marketplace GPU multi-hÃ´tes. Adaptateur de provisioning Ã  brancher.',
    strength: 'Prix / diversitÃ©',
  },
  {
    name: 'GPU.ai',
    description: 'Catalogue GPU hÃ©bergÃ©. Adaptateur de provisioning Ã  brancher.',
    strength: 'SimplicitÃ© / disponibilitÃ©',
  },
  {
    name: 'Xesktop',
    description: 'Instances Ã  forte VRAM. Adaptateur de provisioning Ã  brancher.',
    strength: 'Gros modÃ¨les / VRAM',
  },
] as const;

const ACTIVE_RUN_STATUSES = ['running', 'queued', 'paused', 'waiting_for_approval'] as const;

function Metric({
  label,
  value,
  hint,
  icon,
  tone = 'accent',
}: {
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
    <div className="rounded-lg border border-line bg-surface-1 p-4 shadow-card edge-top">
      <div className={`mb-3 grid size-8 place-items-center rounded-md border ${tones[tone]}`}>{icon}</div>
      <p className="text-[10px] font-semibold tracking-[0.08em] text-ink-4 uppercase">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-ink-1">{value}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-ink-4">{hint}</p>
    </div>
  );
}

export default async function ComputePage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const db = await getDb();
  const projects = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(eq(schema.projects.organizationId, user.organizationId));

  const projectIds = projects.map((project) => project.id);

  const [providers, models, activeRuns, usage] = await Promise.all([
    db.select().from(schema.modelProviders),
    db.select().from(schema.modelDefinitions),
    projectIds.length
      ? db
          .select({ id: schema.agentRuns.id, status: schema.agentRuns.status })
          .from(schema.agentRuns)
          .where(
            and(
              inArray(schema.agentRuns.projectId, projectIds),
              inArray(schema.agentRuns.status, [...ACTIVE_RUN_STATUSES]),
            ),
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
  const waiting = activeRuns.length - running;

  return (
    <div className="mx-auto max-w-[1480px] space-y-4 p-4 lg:p-6 xl:p-7">
      <PageHeader
        title="Compute"
        subtitle="Centre de commande des ressources dâ€™exÃ©cution. Lâ€™Ã©tat local est rÃ©el; les marketplaces GPU restent explicitement non connectÃ©es tant que leurs adaptateurs ne sont pas implÃ©mentÃ©s."
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
          <Link
            href="/models"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong bg-surface-2 px-3 text-xs font-medium text-ink-1 transition-colors hover:bg-surface-3"
          >
            <Cable className="size-3.5" />
            Configurer les passerelles
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Runs AI Core"
          value={activeRuns.length}
          hint={`${running} en exÃ©cution Â· ${waiting} en file, pause ou approbation`}
          icon={<Activity className="size-4" />}
          tone={activeRuns.length ? 'ok' : 'accent'}
        />
        <Metric
          label="Passerelles modÃ¨les"
          value={`${onlineProviders.length}/${enabledProviders.length}`}
          hint={`${models.length} modÃ¨les enregistrÃ©s dans la gateway`}
          icon={<Cpu className="size-4" />}
          tone={onlineProviders.length ? 'info' : 'warn'}
        />
        <Metric
          label="Compute local"
          value={onlineLocal.length}
          hint={`${localModels.length} modÃ¨le(s) local(aux) dÃ©couvert(s)`}
          icon={<HardDrive className="size-4" />}
          tone={onlineLocal.length ? 'ok' : 'warn'}
        />
        <Metric
          label="CoÃ»t modÃ¨les enregistrÃ©"
          value={formatCost(usage.totalCostUsd)}
          hint={`${usage.totalCalls} appel(s) rÃ©els comptabilisÃ©s`}
          icon={<CircleDollarSign className="size-4" />}
          tone="accent"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
        <div className="space-y-4">
          <Card
            title="GPU Fleet"
            description="Une seule vue pour le local et les futurs fournisseurs GPU. Aucun tarif nâ€™est affichÃ© comme live avant connexion de lâ€™API correspondante."
            action={<Badge tone="info">Compute V1</Badge>}
          >
            <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg border border-accent/30 bg-accent/6 p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="grid size-9 place-items-center rounded-md border border-accent/25 bg-accent/12 text-accent">
                    <HardDrive className="size-4.5" />
                  </div>
                  <Badge tone={onlineLocal.length ? 'ok' : 'idle'} dot={onlineLocal.length > 0}>
                    {onlineLocal.length ? 'disponible' : 'non connectÃ©'}
                  </Badge>
                </div>
                <p className="mt-3 text-sm font-semibold text-ink-1">Local / passerelles privÃ©es</p>
                <p className="mt-1 min-h-10 text-[11px] leading-relaxed text-ink-3">
                  {localProviders.length
                    ? `${localProviders.length} passerelle(s) locale(s), ${localModels.length} modÃ¨le(s) enregistrÃ©(s).`
                    : 'Ajoutez llama.cpp, Ollama ou une passerelle OpenAI-compatible dans ModÃ¨les.'}
                </p>
                <div className="mt-3 border-t border-line pt-3">
                  <p className="text-[10px] font-semibold tracking-wide text-ink-4 uppercase">CoÃ»t plateforme</p>
                  <p className="mt-0.5 text-sm font-medium text-ink-2">Local Â· pas de location GPU externe</p>
                </div>
              </div>

              {MARKETPLACES.map((marketplace) => (
                <div key={marketplace.name} className="rounded-lg border border-line bg-surface-2/60 p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="grid size-9 place-items-center rounded-md border border-line bg-surface-3 text-ink-2">
                      <Cloud className="size-4.5" />
                    </div>
                    <Badge tone="idle">adapter requis</Badge>
                  </div>
                  <p className="mt-3 text-sm font-semibold text-ink-1">{marketplace.name}</p>
                  <p className="mt-1 min-h-10 text-[11px] leading-relaxed text-ink-3">{marketplace.description}</p>
                  <div className="mt-3 border-t border-line pt-3">
                    <p className="text-[10px] font-semibold tracking-wide text-ink-4 uppercase">Forces visÃ©es</p>
                    <p className="mt-0.5 text-sm font-medium text-ink-2">{marketplace.strength}</p>
                    <p className="mt-1 text-[10px] text-ink-4">Prix live : non connectÃ©</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card
            title="Routage & orchestration"
            description="La gateway modÃ¨le fonctionne dÃ©jÃ . Le prochain Ã©tage Compute ajoute le provisioning GPU externe sans mÃ©langer prix estimÃ©s et donnÃ©es rÃ©elles."
          >
            <div className="grid gap-3 p-4 md:grid-cols-3">
              <div className="rounded-md border border-line bg-surface-2 p-3">
                <div className="flex items-center gap-2 text-accent">
                  <Gauge className="size-4" />
                  <p className="text-xs font-semibold">1 Â· Contraintes</p>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
                  VRAM, modÃ¨le, durÃ©e, confidentialitÃ©, localisation et budget doivent devenir les entrÃ©es du sÃ©lecteur.
                </p>
              </div>
              <div className="rounded-md border border-line bg-surface-2 p-3">
                <div className="flex items-center gap-2 text-info">
                  <Sparkles className="size-4" />
                  <p className="text-xs font-semibold">2 Â· Choix COO</p>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
                  Tant que les APIs GPU ne sont pas branchÃ©es, le COO ne prÃ©tend pas connaÃ®tre le meilleur prix ou la disponibilitÃ©.
                </p>
              </div>
              <div className="rounded-md border border-line bg-surface-2 p-3">
                <div className="flex items-center gap-2 text-ok">
                  <ShieldCheck className="size-4" />
                  <p className="text-xs font-semibold">3 Â· Approbation</p>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
                  Toute location payante devra passer par le garde-fou dâ€™approbation avant provisioning.
                </p>
              </div>
            </div>
          </Card>

          <Card
            title="Ã‰tat des passerelles locales"
            description="DonnÃ©es lues de la gateway actuelle; elles ne sont pas simulÃ©es."
          >
            {localProviders.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-left text-[11.5px]">
                  <thead className="border-b border-line bg-surface-2 text-[10px] tracking-wide text-ink-4 uppercase">
                    <tr>
                      <th className="px-4 py-2 font-medium">Passerelle</th>
                      <th className="px-4 py-2 font-medium">Endpoint</th>
                      <th className="px-4 py-2 font-medium">Ã‰tat</th>
                      <th className="px-4 py-2 font-medium">ModÃ¨les</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {localProviders.map((provider) => (
                      <tr key={provider.id}>
                        <td className="px-4 py-2.5 font-medium text-ink-1">{provider.name}</td>
                        <td className="max-w-[360px] truncate px-4 py-2.5 font-mono text-[10.5px] text-ink-3">
                          {provider.baseUrl}
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge tone={provider.healthStatus === 'online' ? 'ok' : provider.healthStatus === 'offline' ? 'danger' : 'idle'} dot={provider.healthStatus === 'online'}>
                            {provider.healthStatus}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-ink-2">
                          {models.filter((model) => model.providerId === provider.id).length}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-4">
                <Notice
                  tone="info"
                  title="Aucune passerelle locale enregistrÃ©e"
                  action={
                    <Link href="/models" className="text-[11px] font-medium text-accent hover:underline">
                      Ouvrir ModÃ¨les
                    </Link>
                  }
                >
                  Compute peut dÃ©jÃ  reflÃ©ter les passerelles locales existantes. Ajoutez llama.cpp/Ollama pour faire apparaÃ®tre lâ€™Ã©tat rÃ©el ici.
                </Notice>
              </div>
            )}
          </Card>
        </div>

        <aside className="space-y-4">
          <Card
            title="Recommandation COO"
            description="BasÃ©e uniquement sur ce que la plateforme sait rÃ©ellement aujourdâ€™hui."
          >
            <div className="p-4">
              {onlineLocal.length ? (
                <div className="rounded-lg border border-ok/30 bg-ok/8 p-3.5">
                  <div className="flex items-center gap-2 text-ok">
                    <CheckCircle2 className="size-4" />
                    <p className="text-xs font-semibold">Compute local disponible</p>
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-ink-2">
                    {onlineLocal.length} passerelle(s) locale(s) rÃ©pondent. Le COO peut router les modÃ¨les compatibles sans location externe.
                  </p>
                </div>
              ) : (
                <div className="rounded-lg border border-warn/30 bg-warn/8 p-3.5">
                  <div className="flex items-center gap-2 text-warn">
                    <Zap className="size-4" />
                    <p className="text-xs font-semibold">Backend Compute requis</p>
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-ink-2">
                    Aucun backend local nâ€™est actuellement en ligne et aucun marketplace GPU nâ€™est encore connectÃ©. Aucune recommandation de prix nâ€™est inventÃ©e.
                  </p>
                </div>
              )}

              <div className="mt-4 space-y-2">
                {[
                  ['Gateway modÃ¨les', enabledProviders.length > 0, `${enabledProviders.length} configurÃ©e(s)`],
                  ['Compute local', onlineLocal.length > 0, `${onlineLocal.length} en ligne`],
                  ['Vast.ai adapter', false, 'Ã  construire'],
                  ['GPU.ai adapter', false, 'Ã  construire'],
                  ['Xesktop adapter', false, 'Ã  construire'],
                  ['Provisioning / billing', false, 'Ã  construire'],
                ].map(([label, ready, detail]) => (
                  <div key={String(label)} className="flex items-center gap-2 rounded-md border border-line bg-surface-2 px-2.5 py-2">
                    <span className={`size-1.5 rounded-full ${ready ? 'bg-ok' : 'bg-idle'}`} />
                    <span className="min-w-0 flex-1 text-[11px] text-ink-2">{String(label)}</span>
                    <span className="text-[10px] text-ink-4">{String(detail)}</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <Card title="Ce que Compute ne simule pas">
            <div className="space-y-2 p-4 text-[11px] leading-relaxed text-ink-3">
              <p>â€¢ Aucun faux prix GPU ou faux score de fiabilitÃ©.</p>
              <p>â€¢ Aucun worker prÃ©sentÃ© Â« actif Â» sans provisioning rÃ©el.</p>
              <p>â€¢ Aucun coÃ»t GPU confondu avec les coÃ»ts dâ€™API modÃ¨le.</p>
              <p>â€¢ Aucun bouton Â« Lancer Â» avant lâ€™existence de lâ€™adapter et du garde-fou dâ€™achat.</p>
            </div>
          </Card>

          <Card title="Prochaine Ã©tape Compute">
            <div className="p-4">
              <p className="text-[11px] leading-relaxed text-ink-3">
                ImplÃ©menter une interface commune de marketplace : catalogue live â†’ devis â†’ approbation â†’ provisioning â†’ health â†’ arrÃªt â†’ coÃ»t final.
              </p>
              <Link
                href="/approvals"
                className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong bg-surface-2 px-3 text-xs font-medium text-ink-1 transition-colors hover:bg-surface-3"
              >
                <ShieldCheck className="size-3.5" />
                Voir les approbations
              </Link>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
