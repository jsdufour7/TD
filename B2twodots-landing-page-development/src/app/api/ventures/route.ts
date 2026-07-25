import { asc } from "drizzle-orm";
import { db } from "@/db";
import { ventures } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const STATUSES = ["idee", "incubation", "developpement", "lancee"];

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Non autorisé." }, { status: 401 });
  const rows = await db.select().from(ventures).orderBy(asc(ventures.sort), asc(ventures.createdAt));
  return Response.json({ ventures: rows });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Non autorisé." }, { status: 401 });

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = String(b.name ?? "").trim();
  if (!name) return Response.json({ error: "Le nom est requis." }, { status: 400 });

  const rows = await db
    .insert(ventures)
    .values({
      name,
      tagline: String(b.tagline ?? "").trim(),
      description: String(b.description ?? "").trim(),
      status: STATUSES.includes(String(b.status)) ? String(b.status) : "idee",
      category: String(b.category ?? "").trim() || "Produit numérique",
      accent: /^#[0-9a-fA-F]{6}$/.test(String(b.accent)) ? String(b.accent) : "#2563EB",
      year: String(b.year ?? "").trim() || "2026",
      sort: Number(b.sort) || 0,
    })
    .returning();
  return Response.json({ venture: rows[0] }, { status: 201 });
}
