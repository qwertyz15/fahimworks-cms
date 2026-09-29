import "server-only";
import { db } from "@/lib/db";
import { deleteObjects } from "@/lib/storage";
import { mediaSources } from "./notebook-html";

/**
 * Bookkeeping for uploads (images, videos, attachments). An asset is "used"
 * when its URL appears in any entry's HTML or as a cover image; unused ones
 * can be cleaned up.
 */

export async function recordAsset(input: { key: string; url: string; contentType: string; size: number; filename: string | null; uploadedById: string; contentId?: string | null; pageId?: string | null }) {
  return db.asset.create({ data: { ...input, contentId: input.contentId ?? null, pageId: input.pageId ?? null } });
}

/** Attach the assets referenced by an entry to it (called on every save). */
export async function linkAssets(contentId: string, urls: string[]) {
  const unique = [...new Set(urls)];
  if (unique.length === 0) return;
  await db.asset.updateMany({ where: { url: { in: unique } }, data: { contentId } });
}

/** Every upload URL still in use: Notebook entries, workspace pages (bodies, covers, Files values) and database covers. */
async function referencedUrls(): Promise<Set<string>> {
  const [entries, pages, databases] = await Promise.all([
    db.content.findMany({ where: { source: "WRITTEN" }, select: { contentHtml: true, coverImage: true } }),
    db.page.findMany({ select: { contentHtml: true, coverImage: true, values: true } }),
    db.database.findMany({ where: { coverImage: { not: null } }, select: { coverImage: true } }),
  ]);
  const refs = new Set<string>();
  for (const r of [...entries, ...pages]) {
    if (r.coverImage) refs.add(r.coverImage);
    for (const url of mediaSources(r.contentHtml ?? "")) refs.add(url);
  }
  // Files & media property values: [{ url, name, … }]
  for (const p of pages) {
    for (const v of Object.values((p.values ?? {}) as Record<string, unknown>)) {
      if (Array.isArray(v)) for (const f of v) if (f && typeof f === "object" && typeof (f as { url?: unknown }).url === "string") refs.add((f as { url: string }).url);
    }
  }
  for (const d of databases) if (d.coverImage) refs.add(d.coverImage);
  return refs;
}

/**
 * Delete assets no entry uses any more. Only files older than `minAgeMs` are
 * touched, so an image uploaded moments ago (not yet autosaved) is never lost.
 */
export async function cleanupUnusedAssets(opts: { ids?: string[]; minAgeMs?: number } = {}) {
  const cutoff = new Date(Date.now() - (opts.minAgeMs ?? 60 * 60 * 1000));
  const candidates = await db.asset.findMany({
    where: { ...(opts.ids ? { id: { in: opts.ids } } : {}), createdAt: { lte: cutoff } },
    select: { id: true, key: true, url: true },
  });
  if (candidates.length === 0) return { deleted: 0, bytes: 0 };
  const refs = await referencedUrls();
  const unused = candidates.filter((a) => !refs.has(a.url));
  if (unused.length === 0) return { deleted: 0, bytes: 0 };
  await deleteObjects(unused.map((a) => a.key));
  const sizes = await db.asset.aggregate({ where: { id: { in: unused.map((a) => a.id) } }, _sum: { size: true } });
  await db.asset.deleteMany({ where: { id: { in: unused.map((a) => a.id) } } });
  return { deleted: unused.length, bytes: sizes._sum.size ?? 0 };
}

export async function assetStats() {
  const [count, size] = await Promise.all([db.asset.count(), db.asset.aggregate({ _sum: { size: true } })]);
  return { count, bytes: size._sum.size ?? 0 };
}
