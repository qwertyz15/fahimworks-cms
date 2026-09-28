import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { ContentStatus, ContentType } from "@/generated/prisma/enums";
import { CONTENT_TYPES } from "@/lib/validation";
import { requireAdmin } from "@/server/auth/guards";
import { writtenPostUrl } from "@/lib/timeline";

export async function getDashboardStats() {
  await requireAdmin();
  const [byType, byTypeStatus, byStatus, recent, activity, pending] = await Promise.all([
    db.content.groupBy({ by: ["type"], _count: { _all: true } }),
    db.content.groupBy({ by: ["type", "status"], _count: { _all: true } }),
    db.content.groupBy({ by: ["status"], _count: { _all: true } }),
    db.content.findMany({
      orderBy: { updatedAt: "desc" },
      take: 6,
      select: { id: true, title: true, url: true, type: true, status: true, updatedAt: true, thumbnail: true },
    }),
    db.auditLog.findMany({
      where: { action: { not: "auth.login_failed" } },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, action: true, targetId: true, targetType: true, createdAt: true, metadata: true },
    }),
    db.content.findMany({
      where: { status: "AWAITING_APPROVAL" },
      orderBy: { updatedAt: "asc" },
      take: 5,
      select: { id: true, title: true, url: true, type: true, updatedAt: true, duplicateWarnings: true },
    }),
  ]);
  const typeCount = (t: ContentType) => byType.find((r) => r.type === t)?._count._all ?? 0;
  const statusCount = (s: ContentStatus) => byStatus.find((r) => r.status === s)?._count._all ?? 0;
  const total = byType.reduce((sum, r) => sum + r._count._all, 0);

  const perType = Object.fromEntries(
    CONTENT_TYPES.map((t) => [
      t,
      {
        total: typeCount(t),
        published: byTypeStatus.find((r) => r.type === t && r.status === "PUBLISHED")?._count._all ?? 0,
      },
    ]),
  ) as Record<ContentType, { total: number; published: number }>;

  return {
    total,
    perType,
    blogs: typeCount("BLOG"),
    tutorials: typeCount("TUTORIAL"),
    articles: typeCount("ARTICLE"),
    projects: typeCount("PROJECT"),
    pendingApprovals: statusCount("AWAITING_APPROVAL"),
    // Legacy verification stages count as drafts.
    drafts: statusCount("DRAFT") + statusCount("VERIFICATION_PENDING") + statusCount("VERIFIED"),
    published: statusCount("PUBLISHED"),
    rejected: statusCount("REJECTED"),
    recent,
    pending,
    activity,
  };
}

/** Personal libraries are small; load them whole so type tabs filter instantly in the browser. */
/** Where an item can be viewed publicly: the original page, or the article page of a published Notebook entry. */
function withPublicUrl<T extends { url: string | null; source: string; status: string; slug?: string }>(item: T) {
  const publicUrl = item.url ?? (item.status === "PUBLISHED" && item.slug ? writtenPostUrl(item.slug) : null);
  return { ...item, publicUrl };
}

export const LIBRARY_LIMIT = 300;

/** Items for the dashboard library (grid / list), optionally filtered by type. */
export async function listLibrary(type?: ContentType) {
  await requireAdmin();
  const where: Prisma.ContentWhereInput = type ? { type } : {};
  const [items, total] = await Promise.all([
    db.content.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: LIBRARY_LIMIT,
      select: {
        id: true,
        title: true,
        url: true,
        source: true,
        slug: true,
        extractionStatus: true,
        type: true,
        status: true,
        thumbnail: true,
        description: true,
        siteName: true,
        publishDate: true,
        updatedAt: true,
        wordCount: true,
        readingMinutes: true,
      },
    }),
    db.content.count({ where }),
  ]);
  return { items: items.map(withPublicUrl), total };
}

export type LibraryItem = Awaited<ReturnType<typeof listLibrary>>["items"][number];

export const SORTS = {
  newest: { createdAt: "desc" },
  oldest: { createdAt: "asc" },
  updated: { updatedAt: "desc" },
  title: { title: "asc" },
} as const satisfies Record<string, Prisma.ContentOrderByWithRelationInput>;

export type ContentListParams = {
  q?: string;
  type?: string;
  status?: string;
  sort?: string;
  page?: number;
};

const STATUSES: ContentStatus[] = ["DRAFT", "VERIFICATION_PENDING", "VERIFIED", "AWAITING_APPROVAL", "PUBLISHED", "REJECTED"];
export const PAGE_SIZE = 20;

export async function listContent(params: ContentListParams) {
  await requireAdmin();
  const where: Prisma.ContentWhereInput = {};
  const q = params.q?.trim().slice(0, 200);
  if (q) {
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { url: { contains: q, mode: "insensitive" } },
      { tags: { some: { name: { contains: q, mode: "insensitive" } } } },
    ];
  }
  if (params.type && (CONTENT_TYPES as readonly string[]).includes(params.type)) where.type = params.type as ContentType;
  if (params.status && STATUSES.includes(params.status as ContentStatus)) where.status = params.status as ContentStatus;

  const orderBy = SORTS[(params.sort as keyof typeof SORTS) ?? "newest"] ?? SORTS.newest;
  const page = Math.max(1, Math.floor(params.page ?? 1));

  const [items, total] = await Promise.all([
    db.content.findMany({
      where,
      orderBy,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        title: true,
        url: true,
        source: true,
        slug: true,
        extractionStatus: true,
        type: true,
        status: true,
        approvalStatus: true,
        createdAt: true,
        publishedAt: true,
        thumbnail: true,
      },
    }),
    db.content.count({ where }),
  ]);
  return { items: items.map(withPublicUrl), total, page, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export async function getContentDetail(id: string) {
  await requireAdmin();
  return db.content.findUnique({
    where: { id },
    include: {
      tags: { orderBy: { name: "asc" } },
      authorRef: { select: { name: true, email: true } },
    },
  });
}

export async function getContentHistory(id: string) {
  await requireAdmin();
  return db.auditLog.findMany({
    where: { targetType: "content", targetId: id },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { actor: { select: { name: true } } },
  });
}

export type ContentDetail = NonNullable<Awaited<ReturnType<typeof getContentDetail>>>;

/** Notebook entries (WRITTEN), newest edits first. */
export async function listNotebook() {
  await requireAdmin();
  return db.content.findMany({
    where: { source: "WRITTEN" },
    orderBy: { updatedAt: "desc" },
    take: 500,
    select: { id: true, title: true, subtitle: true, type: true, status: true, wordCount: true, readingMinutes: true, summary: true, updatedAt: true, publishedAt: true },
  });
}

/** One Notebook entry for the editor. */
export async function getNotebookEntry(id: string) {
  await requireAdmin();
  return db.content.findFirst({
    where: { id, source: "WRITTEN" },
    select: {
      id: true,
      title: true,
      subtitle: true,
      type: true,
      status: true,
      slug: true,
      summary: true,
      featured: true,
      coverImage: true,
      body: true,
      contentHtml: true,
      wordCount: true,
      readingMinutes: true,
      updatedAt: true,
      publishedAt: true,
      tags: { select: { name: true }, orderBy: { name: "asc" } },
    },
  });
}

export type NotebookEntry = NonNullable<Awaited<ReturnType<typeof getNotebookEntry>>>;
