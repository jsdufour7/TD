import { eq } from "drizzle-orm";
import { db } from "@/db";
import { ideas } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { IDEA_STAGES, IDEA_PRIORITIES } from "@/lib/constants";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Non autorisé." }, { status: 401 });
  const { id } = await ctx.params;

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof b.title === "string" && b.title.trim()) patch.title = b.title.trim();
  if (typeof b.description === "string") patch.description = b.description.trim();
  if (typeof b.stage === "string" && (IDEA_STAGES as readonly string[]).includes(b.stage)) patch.stage = b.stage;
  if (typeof b.priority === "string" && (IDEA_PRIORITIES as readonly string[]).includes(b.priority)) patch.priority = b.priority;
  if (typeof b.market === "string") patch.market = b.market.trim();

  const rows = await db.update(ideas).set(patch).where(eq(ideas.id, id)).returning();
  if (!rows.length) return Response.json({ error: "Introuvable." }, { status: 404 });
  return Response.json({ idea: rows[0] });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Non autorisé." }, { status: 401 });
  const { id } = await ctx.params;
  const rows = await db.delete(ideas).where(eq(ideas.id, id)).returning();
  if (!rows.length) return Response.json({ error: "Introuvable." }, { status: 404 });
  return Response.json({ ok: true });
}
