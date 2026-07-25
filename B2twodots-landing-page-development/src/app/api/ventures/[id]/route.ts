import { eq } from "drizzle-orm";
import { db } from "@/db";
import { ventures } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const STATUSES = ["idee", "incubation", "developpement", "lancee"];

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Non autorisé." }, { status: 401 });
  const { id } = await ctx.params;

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof b.name === "string" && b.name.trim()) patch.name = b.name.trim();
  if (typeof b.tagline === "string") patch.tagline = b.tagline.trim();
  if (typeof b.description === "string") patch.description = b.description.trim();
  if (typeof b.status === "string" && STATUSES.includes(b.status)) patch.status = b.status;
  if (typeof b.category === "string") patch.category = b.category.trim();
  if (typeof b.accent === "string" && /^#[0-9a-fA-F]{6}$/.test(b.accent)) patch.accent = b.accent;
  if (typeof b.year === "string") patch.year = b.year.trim();
  if (typeof b.sort === "number") patch.sort = b.sort;

  const rows = await db.update(ventures).set(patch).where(eq(ventures.id, id)).returning();
  if (!rows.length) return Response.json({ error: "Introuvable." }, { status: 404 });
  return Response.json({ venture: rows[0] });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Non autorisé." }, { status: 401 });
  const { id } = await ctx.params;
  const rows = await db.delete(ventures).where(eq(ventures.id, id)).returning();
  if (!rows.length) return Response.json({ error: "Introuvable." }, { status: 404 });
  return Response.json({ ok: true });
}
