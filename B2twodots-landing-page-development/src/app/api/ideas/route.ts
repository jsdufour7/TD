import { desc } from "drizzle-orm";
import { db } from "@/db";
import { ideas } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";

import { IDEA_STAGES, IDEA_PRIORITIES } from "@/lib/constants";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Non autorisé." }, { status: 401 });
  const rows = await db.select().from(ideas).orderBy(desc(ideas.createdAt));
  return Response.json({ ideas: rows });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Non autorisé." }, { status: 401 });

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const title = String(b.title ?? "").trim();
  if (!title) return Response.json({ error: "Le titre est requis." }, { status: 400 });

  const rows = await db
    .insert(ideas)
    .values({
      title,
      description: String(b.description ?? "").trim(),
      stage: (IDEA_STAGES as readonly string[]).includes(String(b.stage)) ? String(b.stage) : "exploration",
      priority: (IDEA_PRIORITIES as readonly string[]).includes(String(b.priority)) ? String(b.priority) : "moyenne",
      market: String(b.market ?? "").trim(),
    })
    .returning();
  return Response.json({ idea: rows[0] }, { status: 201 });
}
