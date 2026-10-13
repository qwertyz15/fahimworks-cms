import "server-only";
import { randomBytes } from "node:crypto";
import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";
import { db } from "@/lib/db";
import { slugify } from "@/lib/utils";
import { FOLDER_NAME_MAX, MAX_FOLDER_DEPTH, byPosition, moveProblem, pathOf, subtreeIds } from "@/lib/notebook-folders";
import { audit } from "./audit";
import { ContentError } from "./content";
import { uniqueSlug } from "./content-helpers";
import { WorkflowError } from "./workflow";
import { publishEntry, unpublishEntry } from "./notebook";

/**
 * Notebook folders: nested to any depth (up to MAX_FOLDER_DEPTH), ordered by
 * fractional position keys. Entries (WRITTEN content) live in one folder or
 * at the top level. A folder made public gets a page on the timeline.
 */

export class FolderError extends Error {}

export interface FolderRow {
  id: string;
  parentId: string | null;
  name: string;
  icon: string | null;
  description: string | null;
  slug: string;
  position: string;
  isPublic: boolean;
}

const FOLDER_SELECT = { id: true, parentId: true, name: true, icon: true, description: true, slug: true, position: true, isPublic: true } as const;

export async function listFolders(): Promise<FolderRow[]> {
  return (await db.notebookFolder.findMany({ select: FOLDER_SELECT })).sort(byPosition);
}

const cleanName = (name: string) => name.replace(/\s+/g, " ").trim().slice(0, FOLDER_NAME_MAX);

export async function uniqueFolderSlug(name: string, excludeId?: string) {
  const base = slugify(name, 60) || "folder";
  for (let i = 0; i < 6; i++) {
    const candidate = i === 0 ? base : `${base}-${randomBytes(2).toString("hex")}`;
    const clash = await db.notebookFolder.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!clash || clash.id === excludeId) return candidate;
  }
  return `${base}-${randomBytes(5).toString("hex")}`;
}

/** Position after the last sibling. */
async function lastFolderPosition(parentId: string | null) {
  const rows = await db.notebookFolder.findMany({ where: { parentId }, select: { position: true } });
  return rows.map((r) => r.position).sort().at(-1) ?? null;
}
async function lastEntryPosition(folderId: string | null) {
  const rows = await db.content.findMany({ where: { source: "WRITTEN", folderId }, select: { folderPosition: true } });
  return rows.map((r) => r.folderPosition).filter((p): p is string => !!p).sort().at(-1) ?? null;
}
/** A key after the last entry of a folder (new entries go at the end). */
export async function nextEntryPosition(folderId: string | null) {
  return generateKeyBetween(await lastEntryPosition(folderId), null);
}

async function requireFolder(id: string) {
  const f = await db.notebookFolder.findUnique({ where: { id }, select: FOLDER_SELECT });
  if (!f) throw new FolderError("That folder no longer exists.");
  return f;
}

export async function createFolder(input: { name: string; parentId?: string | null; icon?: string | null; description?: string | null }, actorId: string) {
  const name = cleanName(input.name) || "Untitled folder";
  const parentId = input.parentId ?? null;
  if (parentId) {
    await requireFolder(parentId);
    const depth = pathOf(await listFolders(), parentId).length;
    if (depth >= MAX_FOLDER_DEPTH) throw new FolderError(`Folders can be nested up to ${MAX_FOLDER_DEPTH} levels.`);
  }
  const folder = await db.notebookFolder.create({
    data: {
      name,
      parentId,
      icon: input.icon?.slice(0, 16) || null,
      description: input.description?.trim().slice(0, 500) || null,
      slug: await uniqueFolderSlug(name),
      position: generateKeyBetween(await lastFolderPosition(parentId), null),
    },
    select: FOLDER_SELECT,
  });
  await audit({ actorId, action: "folder.created", targetType: "folder", targetId: folder.id, metadata: { name } });
  return folder;
}

export async function updateFolder(id: string, patch: { name?: string; icon?: string | null; description?: string | null; slug?: string }, actorId: string) {
  const folder = await requireFolder(id);
  let slug: string | undefined;
  if (patch.slug !== undefined) {
    const wanted = slugify(patch.slug, 60);
    if (!wanted) throw new FolderError("The address needs some letters or numbers.");
    const clash = await db.notebookFolder.findUnique({ where: { slug: wanted }, select: { id: true } });
    if (clash && clash.id !== id) throw new FolderError(`The address “${wanted}” is already used by another folder.`);
    slug = wanted;
  }
  const updated = await db.notebookFolder.update({
    where: { id },
    data: {
      ...(patch.name !== undefined ? { name: cleanName(patch.name) || folder.name } : {}),
      ...(patch.icon !== undefined ? { icon: patch.icon?.slice(0, 16) || null } : {}),
      ...(patch.description !== undefined ? { description: patch.description?.trim().slice(0, 500) || null } : {}),
      ...(slug ? { slug } : {}),
    },
    select: FOLDER_SELECT,
  });
  await audit({ actorId, action: "folder.updated", targetType: "folder", targetId: id });
  return updated;
}

/** Between two siblings (ids, or null for an end) under `parentId`. */
async function positionBetween(model: "folder" | "entry", parentId: string | null, beforeId?: string | null, afterId?: string | null) {
  if (!beforeId && !afterId) return model === "folder" ? generateKeyBetween(await lastFolderPosition(parentId), null) : nextEntryPosition(parentId);
  const ids = [afterId, beforeId].filter((x): x is string => !!x);
  const pos =
    model === "folder"
      ? new Map((await db.notebookFolder.findMany({ where: { id: { in: ids }, parentId }, select: { id: true, position: true } })).map((r) => [r.id, r.position as string | null]))
      : new Map((await db.content.findMany({ where: { id: { in: ids }, folderId: parentId }, select: { id: true, folderPosition: true } })).map((r) => [r.id, r.folderPosition]));
  const a = afterId ? (pos.get(afterId) ?? null) : null;
  let b = beforeId ? (pos.get(beforeId) ?? null) : null;
  if (a && b && a >= b) b = null;
  if (!a && !b) return model === "folder" ? generateKeyBetween(await lastFolderPosition(parentId), null) : nextEntryPosition(parentId);
  return generateKeyBetween(a, b);
}

export async function moveFolder(id: string, to: { parentId: string | null; beforeId?: string | null; afterId?: string | null }, actorId: string) {
  await requireFolder(id);
  const problem = moveProblem(await listFolders(), id, to.parentId);
  if (problem) throw new FolderError(problem);
  const position = await positionBetween("folder", to.parentId, to.beforeId, to.afterId);
  await db.notebookFolder.update({ where: { id }, data: { parentId: to.parentId, position } });
  await audit({ actorId, action: "folder.moved", targetType: "folder", targetId: id, metadata: { parentId: to.parentId } });
}

/** Move entries into a folder (null: top level). One entry can be placed between two others. */
export async function moveEntries(ids: string[], to: { folderId: string | null; beforeId?: string | null; afterId?: string | null }) {
  if (to.folderId) await requireFolder(to.folderId);
  const entries = await db.content.findMany({ where: { id: { in: ids }, source: "WRITTEN" }, select: { id: true } });
  if (!entries.length) throw new ContentError("Nothing to move.");
  const order = ids.filter((id) => entries.some((e) => e.id === id));
  if (order.length === 1 && (to.beforeId || to.afterId)) {
    const position = await positionBetween("entry", to.folderId, to.beforeId, to.afterId);
    await db.content.update({ where: { id: order[0] }, data: { folderId: to.folderId, folderPosition: position } });
    return 1;
  }
  const keys = generateNKeysBetween(await lastEntryPosition(to.folderId), null, order.length);
  await db.$transaction(order.map((id, i) => db.content.update({ where: { id }, data: { folderId: to.folderId, folderPosition: keys[i] } })));
  return order.length;
}

export async function renameEntry(id: string, title: string) {
  const t = title.replace(/\s+/g, " ").trim().slice(0, 300);
  if (!t) throw new ContentError("A title can't be empty.");
  const entry = await db.content.findFirst({ where: { id, source: "WRITTEN" }, select: { id: true, status: true } });
  if (!entry) throw new ContentError("Notebook entry not found.");
  await db.content.update({ where: { id }, data: { title: t } });
  return entry.status === "PUBLISHED";
}

/** A draft copy of an entry (same folder unless given), placed after it or at the end. */
export async function duplicateEntry(id: string, actorId: string, opts: { folderId?: string | null; position?: string; keepTitle?: boolean } = {}) {
  const src = await db.content.findFirst({ where: { id, source: "WRITTEN" }, include: { tags: { select: { id: true } } } });
  if (!src) throw new ContentError("Notebook entry not found.");
  const folderId = opts.folderId !== undefined ? opts.folderId : src.folderId;
  const title = opts.keepTitle ? src.title : `${src.title} (copy)`.slice(0, 300);
  const copy = await db.content.create({
    data: {
      source: "WRITTEN",
      type: "NOTEBOOK",
      status: "DRAFT",
      title,
      subtitle: src.subtitle,
      slug: await uniqueSlug(title),
      body: src.body ?? undefined,
      contentHtml: src.contentHtml,
      contentText: src.contentText,
      wordCount: src.wordCount,
      readingMinutes: src.readingMinutes,
      summary: src.summary,
      coverImage: src.coverImage,
      thumbnail: src.thumbnail,
      featured: false,
      extractionStatus: "SUCCEEDED",
      authorId: actorId,
      folderId,
      folderPosition: opts.position ?? (await nextEntryPosition(folderId)),
      tags: { connect: src.tags.map((t) => ({ id: t.id })) },
    },
    select: { id: true },
  });
  await audit({ actorId, action: "content.created", targetType: "content", targetId: copy.id, metadata: { source: "WRITTEN", duplicateOf: id } });
  return copy.id;
}

/** Copy a folder with its subfolders and entries (as drafts), next to the original. */
export async function duplicateFolder(id: string, actorId: string) {
  const root = await requireFolder(id);
  const folders = await listFolders();
  const ids = subtreeIds(folders, id);
  const map = new Map<string, string>();
  // Parents before children.
  const ordered = folders.filter((f) => ids.has(f.id)).sort((a, b) => pathOf(folders, a.id).length - pathOf(folders, b.id).length || byPosition(a, b));
  for (const f of ordered) {
    const isRoot = f.id === root.id;
    const name = isRoot ? `${f.name} (copy)`.slice(0, FOLDER_NAME_MAX) : f.name;
    const parentId = isRoot ? f.parentId : map.get(f.parentId!)!;
    const position = isRoot ? generateKeyBetween(f.position, folders.filter((x) => x.parentId === f.parentId && x.position > f.position).map((x) => x.position).sort()[0] ?? null) : f.position;
    const made = await db.notebookFolder.create({ data: { name, parentId, icon: f.icon, description: f.description, slug: await uniqueFolderSlug(name), position, isPublic: false }, select: { id: true } });
    map.set(f.id, made.id);
  }
  const entries = await db.content.findMany({ where: { source: "WRITTEN", folderId: { in: [...ids] } }, select: { id: true, folderId: true, folderPosition: true } });
  for (const e of entries) await duplicateEntry(e.id, actorId, { folderId: map.get(e.folderId!)!, position: e.folderPosition ?? undefined, keepTitle: true });
  await audit({ actorId, action: "folder.created", targetType: "folder", targetId: map.get(id), metadata: { duplicateOf: id } });
  return map.get(id)!;
}

/**
 * Delete a folder (to the trash). "move-up": its subfolders and entries go
 * to the parent folder first, so only the empty folder is trashed.
 * "delete-all": the folder and everything inside go to the trash together.
 */
export async function deleteFolder(id: string, mode: "move-up" | "delete-all", actorId: string) {
  const folder = await requireFolder(id);
  const { trashFolder } = await import("./trash");
  if (mode === "move-up") {
    const folders = await listFolders();
    const subs = folders.filter((f) => f.parentId === id).sort(byPosition);
    const subKeys = generateNKeysBetween(await lastFolderPosition(folder.parentId), null, subs.length);
    const entries = (await db.content.findMany({ where: { source: "WRITTEN", folderId: id }, select: { id: true, folderPosition: true } })).sort((a, b) => ((a.folderPosition ?? "~") < (b.folderPosition ?? "~") ? -1 : 1));
    const entryKeys = generateNKeysBetween(await lastEntryPosition(folder.parentId), null, entries.length);
    await db.$transaction([
      ...subs.map((f, i) => db.notebookFolder.update({ where: { id: f.id }, data: { parentId: folder.parentId, position: subKeys[i] } })),
      ...entries.map((e, i) => db.content.update({ where: { id: e.id }, data: { folderId: folder.parentId, folderPosition: entryKeys[i] } })),
    ]);
    await trashFolder(id, actorId);
    return { deletedEntries: 0, wasPublished: false };
  }
  const r = await trashFolder(id, actorId);
  return { deletedEntries: r.entries, wasPublished: r.wasPublished };
}

/** Entries in a folder and all its subfolders. */
async function entriesIn(id: string) {
  const ids = subtreeIds(await listFolders(), id);
  return { folderIds: ids, entries: await db.content.findMany({ where: { source: "WRITTEN", folderId: { in: [...ids] } }, select: { id: true, title: true, status: true } }) };
}

export interface PublishFolderResult {
  published: number;
  alreadyLive: number;
  skipped: { id: string; title: string; reason: string }[];
}

/** Publish every entry inside (subfolders too) and, optionally, the folder pages. */
export async function publishFolder(id: string, opts: { folderPage: boolean; slug?: string }, actorId: string): Promise<PublishFolderResult> {
  await requireFolder(id);
  if (opts.slug !== undefined) await updateFolder(id, { slug: opts.slug }, actorId);
  const { folderIds, entries } = await entriesIn(id);
  const result: PublishFolderResult = { published: 0, alreadyLive: 0, skipped: [] };
  for (const e of entries) {
    if (e.status === "PUBLISHED") {
      result.alreadyLive++;
      continue;
    }
    try {
      await publishEntry(e.id, actorId);
      result.published++;
    } catch (err) {
      if (!(err instanceof WorkflowError || err instanceof ContentError)) throw err;
      result.skipped.push({ id: e.id, title: e.title, reason: err.message });
    }
  }
  if (opts.folderPage) await db.notebookFolder.updateMany({ where: { id: { in: [...folderIds] } }, data: { isPublic: true } });
  await audit({ actorId, action: "folder.published", targetType: "folder", targetId: id, metadata: { published: result.published, skipped: result.skipped.length, folderPage: opts.folderPage } });
  return result;
}

/** Unpublish every entry inside and hide the folder pages. */
export async function unpublishFolder(id: string, actorId: string) {
  await requireFolder(id);
  const { folderIds, entries } = await entriesIn(id);
  let n = 0;
  for (const e of entries) {
    if (e.status !== "PUBLISHED") continue;
    await unpublishEntry(e.id, actorId);
    n++;
  }
  await db.notebookFolder.updateMany({ where: { id: { in: [...folderIds] } }, data: { isPublic: false } });
  await audit({ actorId, action: "folder.unpublished", targetType: "folder", targetId: id, metadata: { unpublished: n } });
  return n;
}

/** Show or hide just the folder page (entries keep their status). */
export async function setFolderPage(id: string, isPublic: boolean, actorId: string) {
  await requireFolder(id);
  await db.notebookFolder.update({ where: { id }, data: { isPublic } });
  await audit({ actorId, action: isPublic ? "folder.published" : "folder.unpublished", targetType: "folder", targetId: id, metadata: { folderPageOnly: true } });
}
