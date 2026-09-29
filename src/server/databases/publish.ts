import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { PropertyValue } from "@/lib/db-properties";
import { deleteEntry, publishEntry, saveEntry, unpublishEntry } from "@/server/services/notebook";
import { DatabaseError, getDatabase, requirePage } from "./service";

/**
 * Publish a database row page as a Notebook article on the timeline. The
 * article is a normal WRITTEN Content row (so sanitising, assets, caching
 * and the public page work unchanged), linked by Page.contentId. Autosave
 * never touches it; "Update live" copies the page over explicitly.
 */

export interface PublishState {
  contentId: string;
  slug: string;
  status: string;
  /** The page changed after it was last published / updated. */
  outdated: boolean;
}

const EMPTY_DOC = { type: "doc", content: [] } as Prisma.InputJsonValue;

export async function publishState(pageId: string): Promise<PublishState | null> {
  const page = await db.page.findUnique({ where: { id: pageId }, select: { contentId: true, updatedAt: true } });
  if (!page?.contentId) return null;
  const c = await db.content.findUnique({ where: { id: page.contentId }, select: { id: true, slug: true, status: true, updatedAt: true } });
  if (!c) return null;
  // Allow a second of slack: publishing itself touches both rows.
  return { contentId: c.id, slug: c.slug, status: c.status, outdated: page.updatedAt.getTime() - c.updatedAt.getTime() > 1000 };
}

/** Tags from a Multi-select property of the row (option names). */
async function tagsFrom(userId: string, page: { databaseId: string | null; values: Prisma.JsonValue }, propertyId?: string | null): Promise<string[]> {
  if (!propertyId || !page.databaseId) return [];
  const { properties } = await getDatabase(userId, page.databaseId);
  const def = properties.find((p) => p.id === propertyId && p.type === "MULTI_SELECT");
  const ids = ((page.values ?? {}) as Record<string, PropertyValue>)[propertyId];
  if (!def || !Array.isArray(ids)) return [];
  return (ids as string[]).map((id) => def.config.options?.find((o) => o.id === id)?.name).filter((n): n is string => Boolean(n)).slice(0, 20);
}

/** Create or update the linked article from the page, then publish it. */
export async function publishPage(userId: string, pageId: string, opts: { slug?: string | null; tagsFrom?: string | null } = {}) {
  const page = await requirePage(userId, pageId);
  if (!page.title.trim()) throw new DatabaseError("Add a title before publishing.");
  const existing = page.contentId ? await db.content.findUnique({ where: { id: page.contentId }, select: { id: true } }) : null;
  const saved = await saveEntry(
    {
      id: existing?.id,
      title: page.title,
      subtitle: null,
      tags: await tagsFrom(userId, page, opts.tagsFrom),
      slug: opts.slug?.trim() || null,
      summary: null,
      featured: false,
      coverImage: page.coverImage,
      body: (page.body as Prisma.InputJsonValue | null) ?? EMPTY_DOC,
      html: page.contentHtml ?? "",
    },
    userId,
  );
  await publishEntry(saved.id, userId);
  if (page.contentId !== saved.id) await db.page.update({ where: { id: pageId }, data: { contentId: saved.id } });
  // Mark "up to date": the page counts as unchanged since this publish.
  await db.content.update({ where: { id: saved.id }, data: { updatedAt: new Date() } });
  return publishState(pageId);
}

/** Copy the page's current version to the live article. */
export async function updateLive(userId: string, pageId: string) {
  const page = await requirePage(userId, pageId);
  if (!page.contentId) throw new DatabaseError("This page isn't published.");
  const content = await db.content.findUnique({ where: { id: page.contentId }, select: { slug: true, tags: { select: { name: true } } } });
  if (!content) throw new DatabaseError("The article no longer exists.");
  await saveEntry(
    {
      id: page.contentId,
      title: page.title || "Untitled",
      subtitle: null,
      tags: content.tags.map((t) => t.name),
      slug: content.slug,
      summary: null,
      featured: false,
      coverImage: page.coverImage,
      body: (page.body as Prisma.InputJsonValue | null) ?? EMPTY_DOC,
      html: page.contentHtml ?? "",
    },
    userId,
  );
  await db.content.update({ where: { id: page.contentId }, data: { updatedAt: new Date() } });
  return publishState(pageId);
}

export async function unpublishPage(userId: string, pageId: string) {
  const page = await requirePage(userId, pageId);
  if (!page.contentId) return null;
  await unpublishEntry(page.contentId, userId);
  return publishState(pageId);
}

/** Delete the articles published from these pages (before the pages are deleted). */
export async function deleteArticlesOf(userId: string, where: Prisma.PageWhereInput) {
  const pages = await db.page.findMany({ where: { ...where, contentId: { not: null } }, select: { contentId: true } });
  for (const p of pages) {
    try {
      await deleteEntry(p.contentId!, userId);
    } catch {
      /* already gone */
    }
  }
  return pages.length;
}

/** The page an article was published from (Notebook editor shows a notice). */
export async function sourcePageOf(contentId: string) {
  return db.page.findFirst({ where: { contentId }, select: { id: true, title: true, database: { select: { id: true, title: true, icon: true } } } });
}
