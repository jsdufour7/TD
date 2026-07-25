import { eq } from "drizzle-orm";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Non autorisé." }, { status: 401 });
  const { id } = await ctx.params;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  if (typeof b.read === "boolean") patch.read = b.read;

  const rows = await db.update(messages).set(patch).where(eq(messages.id, id)).returning();
  if (!rows.length) return Response.json({ error: "Introuvable." }, { status: 404 });
  return Response.json({ message: rows[0] });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Non autorisé." }, { status: 401 });
  const { id } = await ctx.params;
  const rows = await db.delete(messages).where(eq(messages.id, id)).returning();
  if (!rows.length) return Response.json({ error: "Introuvable." }, { status: 404 });
  return Response.json({ ok: true });
}
