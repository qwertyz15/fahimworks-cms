import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { ContentStatus, ContentType } from "@/generated/prisma/enums";
import { CONTENT_TYPES } from "@/lib/validation";
import { requireAdmin } from "@/server/auth/guards";

export async function getDashboardStats() {
  await requireAdmin();
  const [byType, byStatus, verified, recent, activity] = await Promise.all([
    db.content.groupBy({ by: ["type"], _count: { _all: true } }),
    db.content.groupBy({ by: ["status"], _count: { _all: true } }),
    db.content.count({ where: { verificationStatus: "VERIFIED" } }),
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
  ]);
  const typeCount = (t: ContentType) => byType.find((r) => r.type === t)?._count._all ?? 0;
  const statusCount = (s: ContentStatus) => byStatus.find((r) => r.status === s)?._count._all ?? 0;
  const total = byType.reduce((sum, r) => sum + r._count._all, 0);

  const pending = await db.content.findMany({
    where: { status: "AWAITING_APPROVAL" },
    orderBy: { updatedAt: "asc" },
    take: 5,
    select: { id: true, title: true, url: true, type: true, updatedAt: true, duplicateWarnings: true },
  });

  return {
    total,
    blogs: typeCount("BLOG"),
    tutorials: typeCount("TUTORIAL"),
    articles: typeCount("ARTICLE"),
    projects: typeCount("PROJECT"),
    verified,
    pendingApprovals: statusCount("AWAITING_APPROVAL"),
    pendingVerification: statusCount("VERIFICATION_PENDING") + statusCount("DRAFT"),
    published: statusCount("PUBLISHED"),
    rejected: statusCount("REJECTED"),
    recent,
    pending,
    activity,
  };
}

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
        type: true,
        status: true,
        verificationStatus: true,
        approvalStatus: true,
        createdAt: true,
        publishedAt: true,
        thumbnail: true,
      },
    }),
    db.content.count({ where }),
  ]);
  return { items, total, page, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export async function getContentDetail(id: string) {
  await requireAdmin();
  return db.content.findUnique({
    where: { id },
    include: {
      tags: { orderBy: { name: "asc" } },
      authorRef: { select: { name: true, email: true } },
      verificationTokens: { orderBy: { createdAt: "desc" }, take: 5 },
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
