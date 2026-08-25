import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { callModel } from '@/ai/router';
import { AppError } from '@/lib/errors';
import { getAgentDefinition } from './catalog';
import type { ChatMessage } from '@/ai/provider';

/**
 * Assistant replies for the chat / meeting room.
 *
 * Two honest modes:
 *  1. With a reachable model provider: the agent answers in its role using the
 *     project's real context (instructions, memory, repository summary, recent
 *     run events) plus the conversation history.
 *  2. Without one: a deterministic "project intelligence" assistant answers the
 *     questions that can be answered from real data — state, failures, blocked
 *     tasks, cost, memory — and says plainly when free-form reasoning needs a
 *     provider. No fabrication in either mode.
 */

export type ProjectBrief = {
  projectName: string;
  runs: { total: number; completed: number; failed: number; active: number };
  lastFailure: { title: string; error: string } | null;
  blockedTasks: Array<{ title: string; reason: string | null }>;
  openTasks: number;
  usage: { calls: number; inputTokens: number; outputTokens: number; costUsd: number };
  memories: Array<{ kind: string; title: string }>;
  repository: string | null;
  objectives: Array<{ title: string; status: string; autonomyMode: string }>;
  tasksByStatus: Array<{ status: string; items: Array<{ title: string; agent: string | null; reason: string | null }> }>;
  lastRun: { title: string; status: string; summary: string; tests: Array<{ suite: string; status: string; passed: number; failed: number }> } | null;
  recentEvents: Array<{ type: string; summary: string }>;
};

export async function gatherBrief(projectId: string): Promise<ProjectBrief> {
  const db = await getDb();

  const project = (await db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).limit(1))[0];
  const runs = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.projectId, projectId));
  const tasks = await db.select().from(schema.tasks).where(eq(schema.tasks.projectId, projectId));
  const usageRows = await db.select().from(schema.modelUsages).where(eq(schema.modelUsages.projectId, projectId));
  const memories = await db.select().from(schema.memories).where(eq(schema.memories.projectId, projectId));
  const repo = (await db.select().from(schema.repositories).where(eq(schema.repositories.projectId, projectId)).limit(1))[0];

  const objectives = await db.select().from(schema.objectives).where(eq(schema.objectives.projectId, projectId));
  const testRuns = await db.select().from(schema.testRuns).where(eq(schema.testRuns.projectId, projectId));
  const events = await db.select().from(schema.runEvents).where(eq(schema.runEvents.projectId, projectId));

  const failedRuns = runs.filter((r) => r.status === 'failed');
  const lastFailed = failedRuns.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  const lastRunRow = [...runs].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

  const byStatus = new Map<string, typeof tasks>();
  for (const t of tasks) {
    const list = byStatus.get(t.status) ?? [];
    list.push(t);
    byStatus.set(t.status, list);
  }

  return {
    projectName: project?.name ?? 'Projet',
    runs: {
      total: runs.length,
      completed: runs.filter((r) => r.status === 'completed').length,
      failed: failedRuns.length,
      active: runs.filter((r) => ['running', 'queued', 'paused', 'waiting_for_approval'].includes(r.status)).length,
    },
    lastFailure: lastFailed ? { title: lastFailed.title, error: lastFailed.error ?? lastFailed.resultSummary ?? '' } : null,
    blockedTasks: tasks
      .filter((t) => t.status === 'blocked')
      .map((t) => ({ title: t.title, reason: t.blockedReason })),
    openTasks: tasks.filter((t) => !['completed', 'cancelled', 'failed'].includes(t.status)).length,
    usage: {
      calls: usageRows.length,
      inputTokens: usageRows.reduce((s, u) => s + u.inputTokens, 0),
      outputTokens: usageRows.reduce((s, u) => s + u.outputTokens, 0),
      costUsd: usageRows.reduce((s, u) => s + (Number.parseFloat(u.costUsd) || 0), 0),
    },
    memories: memories.slice(0, 10).map((m) => ({ kind: m.kind, title: m.title })),
    repository: repo ? `${repo.name} @ ${repo.currentBranch ?? repo.defaultBranch} (${repo.connectionStatus})` : null,
    objectives: objectives.map((o) => ({ title: o.title, status: o.status, autonomyMode: o.autonomyMode })),
    tasksByStatus: [...byStatus.entries()].map(([status, items]) => ({
      status,
      items: items.slice(0, 8).map((t) => ({
        title: t.title,
        agent: t.assignedAgentDefinitionKey,
        reason: t.blockedReason,
      })),
    })),
    lastRun: lastRunRow
      ? {
          title: lastRunRow.title,
          status: lastRunRow.status,
          summary: lastRunRow.resultSummary ?? '',
          tests: testRuns
            .filter((t) => t.runId === lastRunRow.id)
            .map((t) => ({ suite: t.suite, status: t.status, passed: t.passed, failed: t.failed })),
        }
      : null,
    recentEvents: events
      .slice(-12)
      .map((e) => ({ type: e.type, summary: e.summary })),
  };
}

/** Keyword intents answered purely from real data. Returns null when the
 *  question needs free-form reasoning (and thus a provider). */
export function deterministicReply(agentKey: string, brief: ProjectBrief, text: string): string | null {
  const t = text.toLowerCase();
  const has = (...words: string[]) => words.some((w) => t.includes(w));

  if (has('état', 'status', 'etat', 'avance', 'progress', 'où en')) {
    return [
      `Voici l'état réel de « ${brief.projectName} » :`,
      `• Runs : ${brief.runs.total} au total — ${brief.runs.completed} terminés, ${brief.runs.failed} échoués, ${brief.runs.active} actifs.`,
      `• Tâches : ${brief.openTasks} ouvertes.`,
      brief.repository ? `• Dépôt : ${brief.repository}.` : '• Aucun dépôt connecté.',
      brief.blockedTasks.length ? `• ${brief.blockedTasks.length} tâche(s) bloquée(s).` : '• Aucune tâche bloquée.',
    ].join('\n');
  }

  if (has('échec', 'echec', 'échou', 'echou', 'fail', 'erreur', 'error', 'cassé', 'casse', 'broken', 'pourquoi')) {
    if (!brief.lastFailure) return `Aucun échec enregistré pour « ${brief.projectName} ».`;
    return [
      `Dernier échec : « ${brief.lastFailure.title} ».`,
      brief.lastFailure.error ? `Cause enregistrée : ${brief.lastFailure.error.slice(0, 400)}` : '',
      'Je peux relancer une vérification depuis la surface Work.',
    ]
      .filter(Boolean)
      .join('\n');
  }

  if (has('bloqué', 'bloque', 'blocked', 'attend')) {
    if (brief.blockedTasks.length === 0) return 'Aucune tâche bloquée en ce moment.';
    return brief.blockedTasks
      .map((b, i) => `${i + 1}. ${b.title}${b.reason ? ` — ${b.reason}` : ''}`)
      .join('\n');
  }

  if (has('coût', 'cout', 'cost', 'token', 'dépense', 'depense', 'usage')) {
    return [
      `Usage réel de « ${brief.projectName} » :`,
      `• ${brief.usage.calls} appel(s) modèle.`,
      `• ${brief.usage.inputTokens.toLocaleString('fr-CA')} jetons entrants, ${brief.usage.outputTokens.toLocaleString('fr-CA')} sortants.`,
      `• Coût estimé : $${brief.usage.costUsd.toFixed(4)}.`,
    ].join('\n');
  }

  if (has('mémoire', 'memoire', 'memory', 'souviens', 'contexte')) {
    if (brief.memories.length === 0) return 'Aucune mémoire enregistrée pour ce projet.';
    return brief.memories.map((m) => `• [${m.kind}] ${m.title}`).join('\n');
  }

  if (has('aide', 'help', 'peux-tu', 'que peux', 'capable', 'quoi faire')) {
    return [
      'Je peux répondre sans modèle à partir des données réelles du projet : état, échecs, tâches bloquées, coûts, mémoire, dépôt.',
      'Pour le raisonnement libre (planifier, expliquer un choix, proposer du code), configurez une passerelle dans Models → Gestion de la passerelle.',
    ].join('\n');
  }

  // Needs free-form reasoning → caller falls back to the model, or reports.
  return null;
}

/**
 * Omniscient COO conversation prompt. Deliberately separate from the COO's
 * orchestration instructions so a question like « où en sommes-nous ? » gets a
 * concise, grounded answer — never a planning template.
 */
export function buildCooChatSystem(brief: ProjectBrief): string {
  const taskLines = brief.tasksByStatus
    .map((g) => `${g.status} (${g.items.length}): ${g.items.map((i) => i.title).join(' · ')}`)
    .join('\n');
  const objectiveLines = brief.objectives
    .map((o) => `[${o.status}] ${o.title} (${o.autonomyMode})`)
    .join('\n');

  return [
    `Tu es le COO de TwoDots AI Core, conseiller omniscient du projet « ${brief.projectName} ».`,
    'Réponds dans la langue de l’utilisateur. Sois direct, concis, précis. Jamais de remplissage.',
    'Appuie-toi EXCLUSIVEMENT sur l’état réel ci-dessous. N’invente JAMAIS de nom, d’agent, de tâche, de chiffre ou de statut.',
    'N’utilise JAMAIS de gabarit de planification : pas de « Objective Restated », « Tasks Decomposed », « Specialist X », « Request Approval », ni liste markdown de plan.',
    '',
    'Pour une question d’état (« où en sommes-nous », « status ») : donne en ≤ 8 lignes :',
    '  • Avancement : tâches complétées / totales, runs réussis/échoués.',
    '  • Ce qui est fait (2-3 puces réelles).',
    '  • Ce qui bloque et POURQUOI (raison réelle), s’il y a lieu.',
    '  • Prochaine étape concrète.',
    'Pour « plus en détail » : développe avec les vraies tâches par statut, les résultats de tests et les coûts ci-dessous. Reste factuel.',
    'Si une donnée manque (pas de provider, pas de dépôt), dis-le clairement et indique l’action pour la débloquer.',
    '',
    '# État réel du projet',
    `Objectives:\n${objectiveLines || '(aucun)'}`,
    `Tâches par statut:\n${taskLines || '(aucune)'}`,
    brief.lastRun
      ? `Dernier run: [${brief.lastRun.status}] ${brief.lastRun.title}${brief.lastRun.summary ? ` — ${brief.lastRun.summary}` : ''}` +
        (brief.lastRun.tests.length ? `\nTests: ${brief.lastRun.tests.map((t) => `${t.suite} ${t.status} (${t.passed}/${t.passed + t.failed})`).join(', ')}` : '')
      : 'Dernier run: (aucun)',
    brief.lastFailure ? `Dernier échec: ${brief.lastFailure.title} — ${brief.lastFailure.error}` : '',
    brief.blockedTasks.length ? `Bloqués: ${brief.blockedTasks.map((b) => `${b.title} (${b.reason ?? 'raison inconnue'})`).join(' · ')}` : '',
    `Usage: ${brief.usage.calls} appels, $${brief.usage.costUsd.toFixed(4)}.`,
    brief.repository ? `Dépôt: ${brief.repository}` : 'Dépôt: aucun connecté.',
    brief.memories.length ? `Mémoire: ${brief.memories.slice(0, 5).map((m) => m.title).join(' · ')}` : '',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/**
 * Produce a reply for an agent in a thread. Tries the model first; falls back to
 * the deterministic assistant; and if neither can answer, says so plainly.
 */
export async function replyAsAgent(input: {
  agentKey: string;
  projectId: string;
  userText: string;
  history: Array<{ role: string; authorName: string | null; content: string }>;
}): Promise<{ content: string; mode: 'model' | 'deterministic' | 'unavailable'; providerKey?: string }> {
  const brief = await gatherBrief(input.projectId);
  const definition = getAgentDefinition(input.agentKey);
  const role = definition?.name ?? input.agentKey;

  const deterministic = deterministicReply(input.agentKey, brief, input.userText);

  try {
    // The COO in conversation uses a dedicated omniscient advisor prompt — NOT its
    // orchestration/planning instructions — so it answers questions concisely from
    // real state instead of regurgitating plan templates. Other agents keep theirs.
    const system =
      input.agentKey === 'coo'
        ? buildCooChatSystem(brief)
        : [
            definition?.systemInstructions ?? 'You are a helpful project assistant.',
            '',
            `You are ${role}, answering inside the TwoDots AI Core meeting room for the project "${brief.projectName}".`,
            'Ground every answer in the real project state below. Do not invent. Be concise.',
            '',
            '# Project state (real)',
            JSON.stringify(brief, null, 2),
          ].join('\n');

    const messages: ChatMessage[] = [
      { role: 'system', content: system },
      ...input.history.slice(-8).map((h) => ({
        role: (h.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: `${h.authorName ? `[${h.authorName}] ` : ''}${h.content}`,
      })),
      { role: 'user', content: input.userText },
    ];

    const result = await callModel({
      policy: (definition?.modelPolicy as never) ?? 'BALANCED',
      messages,
      maxTokens: 800,
    });

    const content = (result.content ?? '').trim();
    if (content) return { content, mode: 'model', providerKey: result.providerKey };
  } catch (error) {
    // Provider absent or failed — fall through to deterministic.
    if (!(error instanceof AppError)) throw error;
  }

  if (deterministic) return { content: deterministic, mode: 'deterministic' };

  return {
    content:
      `Je n'ai pas de passerelle modèle joignable et cette question demande du raisonnement libre. ` +
      `Configurez-en une dans Models → Gestion de la passerelle (llama.cpp / Ollama). ` +
      `En attendant, essayez : « état », « échecs », « bloqué », « coût » ou « mémoire ».`,
    mode: 'unavailable',
  };
}
