"use server";

import { updateTag } from "next/cache";
import { z } from "zod";
import { TIMELINE_TAG } from "@/server/queries/public";
import { getRevision, listRevisions, restoreNotebookRevision, restorePageRevision, type RevisionSummary, type RevisionTarget } from "@/server/services/revisions";
import { emptyTrash, purgeTrash, restoreTrash } from "@/server/services/trash";
import { requirePage, savePageBody } from "@/server/databases/service";
import { db } from "@/lib/db";
import { ContentError } from "@/server/services/content";
import { adminAction, type ActionResult } from "./result";

/*
 * Version history (Notebook entries and database pages) and the Notebook
 * trash. Each action re-checks the session; database pages also check
 * workspace access.
 */

const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const target = z.object({ kind: z.enum(["notebook", "page"]), id });

async function resolveTarget(userId: string, t: z.infer<typeof target>): Promise<RevisionTarget> {
  if (t.kind === "page") {
    await requirePage(userId, t.id);
    return { pageId: t.id };
  }
  const entry = await db.content.findFirst({ where: { id: t.id, source: "WRITTEN" }, select: { id: true } });
  if (!entry) throw new ContentError("Notebook entry not found.");
  return { contentId: t.id };
}

export async function listRevisionsAction(payload: unknown): Promise<ActionResult<RevisionSummary[]>> {
  return adminAction(async (user) => {
    const t = target.parse(payload);
    return { ok: true, data: await listRevisions(await resolveTarget(user.id, t)) };
  });
}

export async function getRevisionAction(payload: unknown): Promise<ActionResult<Awaited<ReturnType<typeof getRevision>>>> {
  return adminAction(async (user) => {
    const input = target.extend({ revisionId: id }).parse(payload);
    return { ok: true, data: await getRevision(input.revisionId, await resolveTarget(user.id, input)) };
  });
}

export async function restoreRevisionAction(payload: unknown): Promise<ActionResult> {
  return adminAction(async (user) => {
    const input = target.extend({ revisionId: id }).parse(payload);
    await resolveTarget(user.id, input);
    if (input.kind === "notebook") {
      const r = await restoreNotebookRevision(input.id, input.revisionId, user.id);
      if (r.live) updateTag(TIMELINE_TAG);
    } else {
      await restorePageRevision(input.id, input.revisionId, user.id, (body) => savePageBody(user.id, input.id, { ...body, saveKind: "save" }));
    }
    return { ok: true, message: "Version restored. The previous one is in the history if you need it back." };
  });
}

// ── Trash ──

export async function restoreTrashAction(payload: unknown): Promise<ActionResult<{ folderId: string | null; entryId: string | null }>> {
  return adminAction(async (user) => {
    const r = await restoreTrash(z.object({ id }).parse(payload).id, user.id);
    return { ok: true, data: { folderId: r.folderId, entryId: r.entryId }, message: r.kind === "folder" ? "Folder restored (its entries are drafts)." : "Entry restored as a draft." };
  });
}

export async function purgeTrashAction(payload: unknown): Promise<ActionResult<number>> {
  return adminAction(async (user) => {
    const n = await purgeTrash(z.object({ ids: z.array(id).min(1).max(500) }).parse(payload).ids, user.id);
    return { ok: true, data: n, message: `Deleted ${n === 1 ? "1 item" : `${n} items`} for good.` };
  });
}

export async function emptyTrashAction(): Promise<ActionResult<number>> {
  return adminAction(async (user) => {
    const n = await emptyTrash(user.id);
    return { ok: true, data: n, message: n ? `Trash emptied (${n} ${n === 1 ? "item" : "items"}).` : "The trash was already empty." };
  });
}
