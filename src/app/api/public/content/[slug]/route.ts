import { NextResponse, type NextRequest } from "next/server";
import { publicApiGuard, publicOptions } from "@/lib/http/public-api";
import { getPublishedBySlug, toPublicItem } from "@/server/queries/public";

export const dynamic = "force-dynamic";

/** GET /api/public/content/:slug — a single published item. */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/public/content/[slug]">) {
  const guard = await publicApiGuard(req);
  if (guard instanceof NextResponse) return guard;
  const { slug } = await ctx.params;
  if (slug.length > 120) return NextResponse.json({ error: "Not found" }, { status: 404, headers: guard.headers });
  const item = await getPublishedBySlug(slug);
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404, headers: guard.headers });
  // Notebook entries include their full sanitised body.
  return NextResponse.json(toPublicItem(item, { body: true }), { headers: guard.headers });
}

export const OPTIONS = publicOptions;
