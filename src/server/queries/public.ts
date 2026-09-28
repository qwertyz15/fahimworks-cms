import "server-only";
import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { ContentType } from "@/generated/prisma/enums";

/** Fields safe to expose publicly. Never include tokens, raw HTML or internal state. */
export const publicSelect = {
  id: true,
  slug: true,
  title: true,
  url: true,
  type: true,
  description: true,
  summary: true,
  thumbnail: true,
  author: true,
  publishDate: true,
  publishedAt: true,
  siteName: true,
  readingMinutes: true,
  featured: true,
  tags: { select: { name: true, slug: true }, orderBy: { name: "asc" } },
} satisfies Prisma.ContentSelect;

export type PublicContent = Prisma.ContentGetPayload<{ select: typeof publicSelect }>;

export async function listPublished(opts: { type?: ContentType; tag?: string; featured?: boolean; limit: number; cursor?: string }) {
  const where: Prisma.ContentWhereInput = { status: "PUBLISHED" };
  if (opts.type) where.type = opts.type;
  if (opts.tag) where.tags = { some: { slug: opts.tag } };
  if (opts.featured) where.featured = true;

  const rows = await db.content.findMany({
    where,
    select: publicSelect,
    orderBy: [{ publishDate: { sort: "desc", nulls: "last" } }, { publishedAt: "desc" }, { id: "desc" }],
    take: opts.limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > opts.limit;
  const items = hasMore ? rows.slice(0, opts.limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
}

export function getPublishedBySlug(slug: string) {
  return db.content.findFirst({ where: { slug, status: "PUBLISHED" }, select: publicSelect });
}

export const TIMELINE_TAG = "timeline";

/** Everything the public timeline shows. Cached; invalidated by updateTag(TIMELINE_TAG) on changes. */
export const getTimelineItems = unstable_cache(
  async () =>
    db.content.findMany({
      where: { status: "PUBLISHED" },
      select: publicSelect,
      orderBy: [{ publishDate: { sort: "desc", nulls: "last" } }, { publishedAt: "desc" }, { id: "desc" }],
      take: 500,
    }),
  ["timeline-items"],
  { tags: [TIMELINE_TAG], revalidate: 3600 },
);

export type TimelineItem = Awaited<ReturnType<typeof getTimelineItems>>[number];
