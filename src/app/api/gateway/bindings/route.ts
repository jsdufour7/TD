import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { requireAdmin, requireUser } from '@/auth/guards';
import { jsonError, jsonOk, parseBody } from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import { ROUTING_POLICIES } from '@/ai/router';
import { setBinding, type Binding } from '@/ai/bindings';
import { getAssignmentsView } from '@/ai/assignments-view';

/**
 * Agent → model assignment (§23).
 *
 * GET returns everything the assignment UI needs in one call: the agents, the
 * models grouped by provider (with health), the current bindings, and a live
 * gateway diagnosis. PUT assigns (or unassigns) a model for one agent.
 */

export async function GET(): Promise<Response> {
  try {
    const user = await requireUser();
    return jsonOk(await getAssignmentsView(user.organizationId));
  } catch (error) {
    return jsonError(error);
  }
}

const putSchema = z.object({
  agentKey: z.string().min(1).max(80),
  /** null clears the assignment (the routing policy decides again). */
  modelId: z.string().uuid().nullable(),
  policy: z.enum(ROUTING_POLICIES).optional(),
});

export async function PUT(request: Request): Promise<Response> {
  try {
    const admin = await requireAdmin();
    const body = await parseBody(request, putSchema);

    // A modelId that does not exist would silently disable the agent's model —
    // reject it here instead of storing a dead reference.
    if (body.modelId) {
      const db = await getDb();
      const found = await db
        .select({ id: schema.modelDefinitions.id })
        .from(schema.modelDefinitions)
        .where(eq(schema.modelDefinitions.id, body.modelId))
        .limit(1);
      if (!found[0]) return jsonError(new Error(`Unknown model id: ${body.modelId}`));
    }

    const binding: Binding = await setBinding({
      organizationId: admin.organizationId,
      agentKey: body.agentKey,
      modelId: body.modelId,
      ...(body.policy ? { policy: body.policy } : {}),
    });

    await recordAudit({
      action: 'gateway.binding.set',
      organizationId: admin.organizationId,
      userId: admin.id,
      entityType: 'agent_model_binding',
      entityId: binding.agentKey,
      metadata: {
        agentKey: binding.agentKey,
        modelId: binding.modelId,
        model: binding.model ? `${binding.model.providerKey}/${binding.model.modelKey}` : null,
        policy: binding.policy,
      },
    });

    return jsonOk({ binding });
  } catch (error) {
    return jsonError(error);
  }
}
