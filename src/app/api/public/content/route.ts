import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { CONTENT_TYPES } from "@/lib/validation";
import { publicApiGuard, publicOptions } from "@/lib/http/public-api";
import { listPublished, toPublicItem } from "@/server/queries/public";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  type: z.enum(CONTENT_TYPES).optional(),
  tag: z.string().trim().max(60).optional(),
  featured: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(64).optional(),
});

/** GET /api/public/content — published portfolio items (read-only). */
export async function GET(req: NextRequest) {
  const guard = await publicApiGuard(req);
  if (guard instanceof NextResponse) return guard;

  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query", issues: parsed.error.issues.map((i) => i.message) }, { status: 400, headers: guard.headers });
  }
  const { type, tag, featured, limit, cursor } = parsed.data;
  try {
    const result = await listPublished({ type, tag, featured: featured === "true", limit, cursor });
    return NextResponse.json({ ...result, items: result.items.map((i) => toPublicItem(i)) }, { headers: guard.headers });
  } catch {
    // An unknown cursor id makes Prisma throw — treat as bad request.
    return NextResponse.json({ error: "Invalid cursor" }, { status: 400, headers: guard.headers });
  }
}

export const OPTIONS = publicOptions;
