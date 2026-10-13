import "server-only";
import { generateKeyBetween } from "fractional-indexing";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { byPosition, pathOf, subtreeIds } from "@/lib/notebook-folders";
import { audit } from "./audit";
import { cleanupUnusedAssets } from "./assets";
import { ContentError } from "./content";
import { tagConnect, uniqueSlug } from "./content-helpers";
import { deleteRevisionsOf } from "./revisions";
import { uniqueFolderSlug } from "./folders";

/**
 * Notebook trash. Deleting an entry (or a folder with everything inside)
 * stores a snapshot here and removes the rows, so nothing that lists entries
 * can show a deleted one. Restore rebuilds them with the same ids (version
 * history and database-page links line up again), as drafts. Items are
 * deleted for good after TRASH_DAYS; only then are their images removed.
 */

export const TRASH_DAYS = 30;

const ENTRY_FIELDS = {
  id: true,
  slug: true,
  title: true,
  subtitle: true,
  type: true,
  body: true,
  contentHtml: true,
  contentText: true,
  wordCount: true,
  readingMinutes: true,
  summary: true,
  coverImage: true,
  thumbnail: true,
  featured: true,
  publishDate: true,
  folderId: true,
  folderPosition: true,
  authorId: true,
  createdAt: true,
  status: true,
  tags: { select: { name: true } },
} as const;

type EntryRow = Prisma.ContentGetPayload<{ select: typeof ENTRY_FIELDS }>;

interface EntrySnapshot {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  type: string;
  body: unknown;
  contentHtml: string | null;
  contentText: string | null;
  wordCount: number | null;
  readingMinutes: number | null;
  summary: string | null;
  coverImage: string | null;
  thumbnail: string | null;
  featured: boolean;
  publishDate: string | null;
  folderId: string | null;
  folderPosition: string | null;
  authorId: string;
  createdAt: string;
  wasPublished: boolean;
  tags: string[];
  assetIds: string[];
}

interface FolderSnapshot {
  id: string;
  parentId: string | null;
  name: string;
  icon: string | null;
  description: string | null;
  slug: string;
  position: string;
}

interface Snapshot {
  folders: FolderSnapshot[];
  entries: EntrySnapshot[];
}

async function snapshotEntries(rows: EntryRow[]): Promise<EntrySnapshot[]> {
  const assets = rows.length ? await db.asset.findMany({ where: { contentId: { in: rows.map((r) => r.id) } }, select: { id: true, contentId: true } }) : [];
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    subtitle: r.subtitle,
    type: r.type,
    body: r.body,
    contentHtml: r.contentHtml,
    contentText: r.contentText,
    wordCount: r.wordCount,
    readingMinutes: r.readingMinutes,
    summary: r.summary,
    coverImage: r.coverImage,
    thumbnail: r.thumbnail,
    featured: r.featured,
    publishDate: r.publishDate?.toISOString() ?? null,
    folderId: r.folderId,
    folderPosition: r.folderPosition,
    authorId: r.authorId,
    createdAt: r.createdAt.toISOString(),
    wasPublished: r.status === "PUBLISHED",
    tags: r.tags.map((t) => t.name),
    assetIds: assets.filter((a) => a.contentId === r.id).map((a) => a.id),
  }));
}

/** Move one entry to the trash. Returns whether it was live (the timeline changes). */
export async function trashEntry(id: string, actorId: string) {
  const row = await db.content.findFirst({ where: { id, source: "WRITTEN" }, select: ENTRY_FIELDS });
  if (!row) throw new ContentError("Notebook entry not found.");
  const [snap] = await snapshotEntries([row]);
  await db.$transaction([
    db.trashItem.create({ data: { kind: "entry", title: row.title, snapshot: { folders: [], entries: [snap] } as unknown as Prisma.InputJsonValue, entryCount: 1, deletedById: actorId } }),
    db.content.delete({ where: { id } }),
  ]);
  await audit({ actorId, action: "content.deleted", targetType: "content", targetId: id, metadata: { title: row.title, source: "WRITTEN", trash: true } });
  return { wasPublished: snap!.wasPublished };
}

/** Move a folder and everything inside (subfolders, entries) to the trash as one item. */
export async function trashFolder(id: string, actorId: string) {
  const folders = await db.notebookFolder.findMany({ select: { id: true, parentId: true, name: true, icon: true, description: true, slug: true, position: true } });
  const root = folders.find((f) => f.id === id);
  if (!root) throw new ContentError("That folder no longer exists.");
  const ids = subtreeIds(folders, id);
  const inside = folders.filter((f) => ids.has(f.id));
  const rows = await db.content.findMany({ where: { source: "WRITTEN", folderId: { in: [...ids] } }, select: ENTRY_FIELDS });
  const entries = await snapshotEntries(rows);
  // Deepest folders first (a folder can't go while it has subfolders).
  const order = [...ids].sort((a, b) => pathOf(folders, b).length - pathOf(folders, a).length);
  await db.$transaction([
    db.trashItem.create({ data: { kind: "folder", title: root.name, snapshot: { folders: inside, entries } as unknown as Prisma.InputJsonValue, entryCount: entries.length, folderCount: inside.length, deletedById: actorId } }),
    db.content.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } }),
    ...order.map((fid) => db.notebookFolder.delete({ where: { id: fid } })),
  ]);
  await audit({ actorId, action: "folder.deleted", targetType: "folder", targetId: id, metadata: { name: root.name, entries: entries.length, folders: inside.length, trash: true } });
  return { entries: entries.length, wasPublished: entries.some((e) => e.wasPublished) };
}

export interface TrashRow {
  id: string;
  kind: "entry" | "folder";
  title: string;
  entryCount: number;
  folderCount: number;
  deletedAt: string;
  purgeAt: string;
  /** Where it was (folder path), when that folder still exists. */
  from: string | null;
}

export async function listTrash(): Promise<TrashRow[]> {
  const [items, folders] = await Promise.all([db.trashItem.findMany({ orderBy: { deletedAt: "desc" }, take: 500 }), db.notebookFolder.findMany({ select: { id: true, parentId: true, name: true, position: true } })]);
  return items.map((t) => {
    const snap = t.snapshot as unknown as Snapshot;
    const origin = t.kind === "folder" ? (snap.folders.find((f) => f.id === snap.folders[0]?.id)?.parentId ?? null) : (snap.entries[0]?.folderId ?? null);
    const path = origin ? pathOf(folders, origin).map((f) => f.name).join(" / ") : "";
    return {
      id: t.id,
      kind: t.kind === "folder" ? "folder" : "entry",
      title: t.title,
      entryCount: t.entryCount,
      folderCount: t.folderCount,
      deletedAt: t.deletedAt.toISOString(),
      purgeAt: new Date(t.deletedAt.getTime() + TRASH_DAYS * 86_400_000).toISOString(),
      from: origin ? path || null : "Notebook",
    };
  });
}

async function nextPosition(model: "folder" | "entry", parentId: string | null) {
  const keys =
    model === "folder"
      ? (await db.notebookFolder.findMany({ where: { parentId }, select: { position: true } })).map((r) => r.position)
      : (await db.content.findMany({ where: { source: "WRITTEN", folderId: parentId }, select: { folderPosition: true } })).map((r) => r.folderPosition).filter((x): x is string => !!x);
  return generateKeyBetween(keys.sort().at(-1) ?? null, null);
}

/** Put a trash item back where it was (or at the top level if that folder is gone), as drafts. */
export async function restoreTrash(itemId: string, actorId: string) {
  const item = await db.trashItem.findUnique({ where: { id: itemId } });
  if (!item) throw new ContentError("That item is no longer in the trash.");
  const snap = item.snapshot as unknown as Snapshot;
  const existing = new Set((await db.notebookFolder.findMany({ select: { id: true } })).map((f) => f.id));
  const restored = new Set<string>();
  // Folders, parents first.
  const byDepth = [...snap.folders].sort((a, b) => pathOf(snap.folders, a.id).length - pathOf(snap.folders, b.id).length || byPosition(a, b));
  const isRoot = (f: FolderSnapshot) => !f.parentId || !snap.folders.some((x) => x.id === f.parentId);
  for (const f of byDepth) {
    const parentId = isRoot(f) ? (f.parentId && existing.has(f.parentId) ? f.parentId : null) : f.parentId;
    const slugTaken = await db.notebookFolder.findUnique({ where: { slug: f.slug }, select: { id: true } });
    await db.notebookFolder.create({
      data: {
        id: f.id,
        parentId,
        name: f.name,
        icon: f.icon,
        description: f.description,
        slug: slugTaken ? await uniqueFolderSlug(f.name) : f.slug,
        position: isRoot(f) ? await nextPosition("folder", parentId) : f.position,
        isPublic: false,
      },
    });
    restored.add(f.id);
    existing.add(f.id);
  }
  for (const e of snap.entries) {
    const inRestored = e.folderId ? restored.has(e.folderId) : false;
    const folderId = e.folderId && (inRestored || existing.has(e.folderId)) ? e.folderId : null;
    const slugTaken = await db.content.findUnique({ where: { slug: e.slug }, select: { id: true } });
    await db.content.create({
      data: {
        id: e.id,
        source: "WRITTEN",
        type: e.type as "NOTEBOOK",
        status: "DRAFT",
        slug: slugTaken ? await uniqueSlug(e.title) : e.slug,
        title: e.title,
        subtitle: e.subtitle,
        body: (e.body ?? undefined) as Prisma.InputJsonValue | undefined,
        contentHtml: e.contentHtml,
        contentText: e.contentText,
        wordCount: e.wordCount,
        readingMinutes: e.readingMinutes,
        summary: e.summary,
        coverImage: e.coverImage,
        thumbnail: e.thumbnail,
        featured: e.featured,
        publishDate: e.publishDate ? new Date(e.publishDate) : null,
        folderId,
        folderPosition: inRestored && e.folderPosition ? e.folderPosition : await nextPosition("entry", folderId),
        authorId: (await db.user.findUnique({ where: { id: e.authorId }, select: { id: true } })) ? e.authorId : actorId,
        createdAt: new Date(e.createdAt),
        extractionStatus: "SUCCEEDED",
        tags: { connectOrCreate: tagConnect(e.tags) },
      },
    });
    if (e.assetIds.length) await db.asset.updateMany({ where: { id: { in: e.assetIds } }, data: { contentId: e.id } });
  }
  await db.trashItem.delete({ where: { id: itemId } });
  await audit({ actorId, action: item.kind === "folder" ? "folder.created" : "content.created", targetType: item.kind === "folder" ? "folder" : "content", targetId: snap.folders[0]?.id ?? snap.entries[0]?.id, metadata: { restoredFromTrash: true, title: item.title } });
  return { kind: item.kind, folderId: item.kind === "folder" ? (snap.folders[0]?.id ?? null) : (snap.entries[0]?.folderId ?? null), entryId: item.kind === "entry" ? (snap.entries[0]?.id ?? null) : null };
}

/** Delete trash items for good: their versions and (now unused) images go too. */
export async function purgeTrash(itemIds: string[], actorId: string | null) {
  const items = await db.trashItem.findMany({ where: { id: { in: itemIds } } });
  if (!items.length) return 0;
  const entries = items.flatMap((t) => (t.snapshot as unknown as Snapshot).entries);
  await db.trashItem.deleteMany({ where: { id: { in: items.map((t) => t.id) } } });
  await deleteRevisionsOf(entries.map((e) => e.id));
  const assetIds = entries.flatMap((e) => e.assetIds);
  if (assetIds.length) await cleanupUnusedAssets({ ids: assetIds, minAgeMs: 0 }).catch((err) => console.error("[trash] image cleanup failed", err));
  for (const t of items) await audit({ actorId, action: t.kind === "folder" ? "folder.deleted" : "content.deleted", targetType: t.kind === "folder" ? "folder" : "content", metadata: { title: t.title, permanently: true } });
  return items.length;
}

export async function emptyTrash(actorId: string) {
  const ids = (await db.trashItem.findMany({ select: { id: true } })).map((t) => t.id);
  return purgeTrash(ids, actorId);
}

/** Items past their 30 days (daily job, and whenever the trash is opened). */
export async function purgeExpiredTrash(now = new Date()) {
  const cutoff = new Date(now.getTime() - TRASH_DAYS * 86_400_000);
  const ids = (await db.trashItem.findMany({ where: { deletedAt: { lt: cutoff } }, select: { id: true } })).map((t) => t.id);
  return ids.length ? purgeTrash(ids, null) : 0;
}
