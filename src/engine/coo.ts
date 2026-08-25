import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { createObjective, transitionObjective } from './objectives';
import { createRun } from './run-engine';
import { replyAsAgent, gatherBrief } from '@/agents/assistant';
import type { AutonomyMode } from '@/db/schema/objectives';

/**
 * The COO conversation runtime (§1, §8).
 *
 * A user message is first classified: an *informational* question is answered (from
 * real data, or the model when configured); an *operational* instruction makes the
 * COO create an Objective, a versioned Plan, the Tasks (with dependencies), pick
 * the agents, and hand execution to the existing run engine — then report what it
 * did. The user is only asked when a real decision is required (autonomy modes).
 */

export type CooResult =
  | { kind: 'answer'; content: string; mode: string }
  | {
      kind: 'executed';
      objectiveId: string;
      planId: string;
      runId: string;
      tasks: Array<{ id: string; title: string; agentKey: string }>;
      report: string;
    };

const OPERATIONAL = [
  'termine', 'finis', 'avance', 'continue', 'poursuis', 'implémente', 'implemente', 'implement',
  'corrige', 'fix', 'répare', 'repare', 'repair', 'ajoute', 'add', 'crée', 'creer', 'create',
  'vérifie', 'verifie', 'verify', 'fais', 'make', 'build', 'construis', 'livre', 'ship',
  'inspecte', 'analyse', 'proceed', 'execute', 'exécute',
];

export function classifyIntent(text: string): 'question' | 'operational' {
  const t = text.toLowerCase().trim();
  const isQuestionSyntax = /\?\s*$/.test(t) || /^(où|ou|quel|quelle|quels|quelles|quoi|comment|pourquoi|combien|qui|est-ce|what|where|why|how|who|when)\b/.test(t);
  const hasOperational = OPERATIONAL.some((w) => t.includes(w));
  if (isQuestionSyntax && !hasOperational) return 'question';
  if (hasOperational) return 'operational';
  return 'question';
}

type PlanStep = { title: string; agentKey: string; dependsOn: number[]; verify?: string };

/** Deterministic decomposition of an operational directive into plan steps. */
export function buildPlanSteps(text: string): { steps: PlanStep[]; rationale: string } {
  const t = text.toLowerCase();
  const wantsCode = /(implémente|implemente|implement|ajoute|add|crée|creer|create|corrige|fix|répare|repare|build|construis)/.test(t);
  const wantsTests = /(test|vérifie|verifie|verify)/.test(t);

  const steps: PlanStep[] = [
    {
      title: 'Inspect the project state and repository',
      agentKey: 'coo',
      dependsOn: [],
      verify: 'inspection recorded',
    },
  ];
  if (wantsCode) {
    steps.push({
      title: `Implement the requested change: ${truncate(text)}`,
      agentKey: 'fullstack-engineer',
      dependsOn: [0],
      verify: 'typecheck passes',
    });
  }
  steps.push({
    title: 'Verify with the project typecheck/lint/tests',
    agentKey: 'qa-engineer',
    dependsOn: wantsCode ? [0, 1] : [0],
    verify: 'commands exit 0',
  });
  steps.push({
    title: 'Review the resulting change set',
    agentKey: 'code-reviewer',
    dependsOn: [steps.length - 1],
    verify: 'review recorded',
  });
  steps.push({
    title: 'Record outcome and update project memory',
    agentKey: 'coo',
    dependsOn: [steps.length - 2],
    verify: 'memory recorded',
  });

  const rationale = wantsTests
    ? 'Verify-first: inspect, then change (if requested), then verify, review, remember.'
    : 'Inspect and verify; only change when the directive implies a change.';

  return { steps, rationale };
}

function truncate(s: string, n = 120): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/**
 * Handle one COO message. Honors the autonomy mode:
 *  - manual: only answer/advise, never execute.
 *  - approval/autonomous/mission: execute (the approval gating for high-impact
 *    actions still lives in the permission/approval layer).
 */
export async function handleCooMessage(input: {
  projectId: string;
  text: string;
  userId?: string | null;
  autonomyMode?: AutonomyMode;
  history?: Array<{ role: string; authorName: string | null; content: string }>;
}): Promise<CooResult> {
  const intent = classifyIntent(input.text);
  const mode = input.autonomyMode ?? 'approval';

  if (intent === 'question' || mode === 'manual') {
    const reply = await replyAsAgent({
      agentKey: 'coo',
      projectId: input.projectId,
      userText: input.text,
      history: input.history ?? [],
    });
    return { kind: 'answer', content: reply.content, mode: reply.mode };
  }

  // Operational + allowed to act.
  const brief = await gatherBrief(input.projectId);
  const { steps, rationale } = buildPlanSteps(input.text);

  const objective = await createObjective({
    projectId: input.projectId,
    title: truncate(input.text, 160),
    description: input.text,
    source: 'coo',
    autonomyMode: mode,
    createdByUserId: input.userId ?? null,
    successCriteria: steps.map((s) => s.verify ?? s.title),
  });
  await transitionObjective(objective.id, 'planning', 'coo');

  const db = await getDb();
  const [plan] = await db
    .insert(schema.plans)
    .values({
      objectiveId: objective.id,
      projectId: input.projectId,
      version: 1,
      rationale,
      // Grounded in the real project state gathered above, so the plan records
      // what the COO actually observed before acting.
      assumptions: [
        `runs: ${brief.runs.total} (completed ${brief.runs.completed}, failed ${brief.runs.failed})`,
        `open tasks: ${brief.openTasks}`,
        brief.repository ? `repository: ${brief.repository}` : 'no repository connected',
      ],
      steps: steps.map((s) => ({ title: s.title, agentKey: s.agentKey, dependsOn: s.dependsOn, verify: s.verify })),
      status: 'executing',
    })
    .returning();

  const run = await createRun({
    projectId: input.projectId,
    objective: input.text,
    title: `COO: ${truncate(input.text, 80)}`,
    userId: input.userId ?? undefined,
  });
  await db.update(schema.agentRuns).set({ objectiveId: objective.id }).where(eq(schema.agentRuns.id, run.id));

  // Create the tasks from the plan, linking objective/plan/run and dependencies.
  const createdIds: string[] = [];
  const tasksOut: Array<{ id: string; title: string; agentKey: string }> = [];
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i]!;
    const [task] = await db
      .insert(schema.tasks)
      .values({
        projectId: input.projectId,
        runId: run.id,
        objectiveId: objective.id,
        planId: plan!.id,
        title: step.title,
        status: 'backlog',
        assignedAgentDefinitionKey: step.agentKey,
        createdByType: 'coo',
        generationReason: truncate(input.text, 200),
        expectedOutcome: step.verify ?? null,
        verificationStrategy: step.verify ? [step.verify] : [],
        acceptanceCriteria: step.verify ? [step.verify] : [],
      })
      .returning();
    createdIds.push(task!.id);
    tasksOut.push({ id: task!.id, title: step.title, agentKey: step.agentKey });
  }
  for (let i = 0; i < steps.length; i += 1) {
    for (const dep of steps[i]!.dependsOn) {
      if (createdIds[dep]) {
        await db.insert(schema.taskDependencies).values({ taskId: createdIds[i]!, dependsOnTaskId: createdIds[dep]! });
      }
    }
  }

  await transitionObjective(objective.id, 'active', 'coo');

  const report = [
    `Objective detected: ${objective.title}`,
    `I created a plan (v1, ${steps.length} steps) and ${steps.length} tasks, and started run ${run.id.slice(0, 8)}.`,
    ...tasksOut.map((t) => `• ${t.title} → ${t.agentKey}`),
    'No decision required from you.',
  ].join('\n');

  return {
    kind: 'executed',
    objectiveId: objective.id,
    planId: plan!.id,
    runId: run.id,
    tasks: tasksOut,
    report,
  };
}
