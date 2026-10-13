"use server";

import { updateTag } from "next/cache";
import { z } from "zod";
import { TIMELINE_TAG } from "@/server/queries/public";
import * as svc from "@/server/services/folders";
import { publishEntry, unpublishEntry, deleteEntry } from "@/server/services/notebook";
import { WorkflowError } from "@/server/services/workflow";
import { ContentError } from "@/server/services/content";
import { adminAction, type ActionResult } from "./result";

/*
 * Notebook folder actions. Each re-checks the session (adminAction) and
 * validates its input; the dashboard refreshes its data afterwards. Anything
 * that can change what's public refreshes the timeline cache.
 */

const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const ids = z.array(id).min(1).max(500);
const parent = id.nullable();
const name = z.string().max(200);

/** Service errors are messages for the user. */
async function run<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof svc.FolderError || err instanceof ContentError || err instanceof WorkflowError) return { ok: false, error: err.message };
    throw err;
  }
}

export async function createFolderAction(payload: unknown): Promise<ActionResult<svc.FolderRow>> {
  return adminAction((user) =>
    run(async () => {
      const input = z.object({ name, parentId: parent.default(null), icon: z.string().max(16).nullable().optional(), description: z.string().max(500).nullable().optional() }).parse(payload);
      return { ok: true, data: await svc.createFolder(input, user.id) };
    }),
  );
}

export async function updateFolderAction(payload: unknown): Promise<ActionResult<svc.FolderRow>> {
  return adminAction((user) =>
    run(async () => {
      const input = z.object({ id, name: name.optional(), icon: z.string().max(16).nullable().optional(), description: z.string().max(500).nullable().optional(), slug: z.string().max(80).optional() }).parse(payload);
      const folder = await svc.updateFolder(input.id, input, user.id);
      if (folder.isPublic) updateTag(TIMELINE_TAG);
      return { ok: true, data: folder };
    }),
  );
}

export async function moveFolderAction(payload: unknown): Promise<ActionResult> {
  return adminAction((user) =>
    run(async () => {
      const input = z.object({ id, parentId: parent, beforeId: id.nullable().optional(), afterId: id.nullable().optional() }).parse(payload);
      await svc.moveFolder(input.id, input, user.id);
      updateTag(TIMELINE_TAG);
      return { ok: true };
    }),
  );
}

export async function deleteFolderAction(payload: unknown): Promise<ActionResult<{ deletedEntries: number }>> {
  return adminAction((user) =>
    run(async () => {
      const input = z.object({ id, mode: z.enum(["move-up", "delete-all"]) }).parse(payload);
      const r = await svc.deleteFolder(input.id, input.mode, user.id);
      updateTag(TIMELINE_TAG);
      return { ok: true, data: r, message: input.mode === "delete-all" ? `Folder deleted with ${r.deletedEntries} ${r.deletedEntries === 1 ? "entry" : "entries"}.` : "Folder deleted; its contents moved up." };
    }),
  );
}

export async function duplicateFolderAction(payload: unknown): Promise<ActionResult<{ id: string }>> {
  return adminAction((user) =>
    run(async () => {
      const folderId = await svc.duplicateFolder(z.object({ id }).parse(payload).id, user.id);
      return { ok: true, data: { id: folderId }, message: "Folder duplicated (its entries are drafts)." };
    }),
  );
}

export async function publishFolderAction(payload: unknown): Promise<ActionResult<svc.PublishFolderResult>> {
  return adminAction((user) =>
    run(async () => {
      const input = z.object({ id, folderPage: z.boolean().default(true), slug: z.string().max(80).optional() }).parse(payload);
      const r = await svc.publishFolder(input.id, input, user.id);
      updateTag(TIMELINE_TAG);
      return { ok: true, data: r };
    }),
  );
}

export async function unpublishFolderAction(payload: unknown): Promise<ActionResult<number>> {
  return adminAction((user) =>
    run(async () => {
      const n = await svc.unpublishFolder(z.object({ id }).parse(payload).id, user.id);
      updateTag(TIMELINE_TAG);
      return { ok: true, data: n, message: `Unpublished ${n} ${n === 1 ? "entry" : "entries"} and hid the folder page.` };
    }),
  );
}

export async function setFolderPageAction(payload: unknown): Promise<ActionResult> {
  return adminAction((user) =>
    run(async () => {
      const input = z.object({ id, isPublic: z.boolean() }).parse(payload);
      await svc.setFolderPage(input.id, input.isPublic, user.id);
      updateTag(TIMELINE_TAG);
      return { ok: true, message: input.isPublic ? "The folder page is live." : "The folder page is hidden." };
    }),
  );
}

// ── Entries ──

export async function moveEntriesAction(payload: unknown): Promise<ActionResult<number>> {
  return adminAction(() =>
    run(async () => {
      const input = z.object({ ids, folderId: parent, beforeId: id.nullable().optional(), afterId: id.nullable().optional() }).parse(payload);
      const n = await svc.moveEntries(input.ids, input);
      updateTag(TIMELINE_TAG);
      return { ok: true, data: n };
    }),
  );
}

export async function renameEntryAction(payload: unknown): Promise<ActionResult> {
  return adminAction(() =>
    run(async () => {
      const input = z.object({ id, title: z.string().max(300) }).parse(payload);
      if (await svc.renameEntry(input.id, input.title)) updateTag(TIMELINE_TAG);
      return { ok: true };
    }),
  );
}

export async function duplicateEntryAction(payload: unknown): Promise<ActionResult<{ id: string }>> {
  return adminAction((user) =>
    run(async () => {
      const copy = await svc.duplicateEntry(z.object({ id }).parse(payload).id, user.id);
      return { ok: true, data: { id: copy }, message: "Duplicated as a draft." };
    }),
  );
}

/** Publish / unpublish / delete several entries; failures are reported per entry. */
export async function bulkEntriesAction(payload: unknown): Promise<ActionResult<{ done: number; failed: { id: string; reason: string }[] }>> {
  return adminAction((user) =>
    run(async () => {
      const input = z.object({ ids, op: z.enum(["publish", "unpublish", "delete"]) }).parse(payload);
      let done = 0;
      const failed: { id: string; reason: string }[] = [];
      for (const entryId of input.ids) {
        try {
          if (input.op === "publish") await publishEntry(entryId, user.id);
          else if (input.op === "unpublish") await unpublishEntry(entryId, user.id);
          else await deleteEntry(entryId, user.id);
          done++;
        } catch (err) {
          if (!(err instanceof WorkflowError || err instanceof ContentError)) throw err;
          failed.push({ id: entryId, reason: err.message });
        }
      }
      updateTag(TIMELINE_TAG);
      return { ok: true, data: { done, failed } };
    }),
  );
}
