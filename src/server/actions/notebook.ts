"use server";

import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@/generated/prisma/client";
import { idSchema, saveEntrySchema } from "@/lib/validation";
import { TIMELINE_TAG } from "@/server/queries/public";
import { deleteEntry, saveEntry, type SavedEntry } from "@/server/services/notebook";
import { adminAction, type ActionResult } from "./result";

/**
 * Save a Notebook entry (creates it on first save). Called by the editor's
 * autosave and by Ctrl+S / the Save button. Takes a plain object, not FormData.
 */
export async function saveEntryAction(payload: unknown): Promise<ActionResult<SavedEntry>> {
  return adminAction(async (user) => {
    const input = saveEntrySchema.parse(payload);
    // Store only a plain JSON copy of the document (rejects anything that isn't pure data).
    let body: Prisma.InputJsonValue;
    try {
      body = JSON.parse(JSON.stringify(input.body)) as Prisma.InputJsonValue;
    } catch {
      return { ok: false, error: "The editor document could not be read. Reload the page and try again." };
    }
    const saved = await saveEntry({ ...input, body }, user.id);
    // No revalidatePath here: it would make the router re-render the page and remount
    // the editor mid-typing (losing keystrokes after the first save). Dashboard pages
    // are dynamic and load fresh data on every navigation anyway.
    // A published entry's changes are live immediately.
    if (saved.status === "PUBLISHED") updateTag(TIMELINE_TAG);
    return { ok: true, data: saved };
  });
}

export async function deleteEntryAction(entryId: string): Promise<ActionResult> {
  const result = await adminAction<undefined>(async (user) => {
    await deleteEntry(idSchema.parse(entryId), user.id);
    return { ok: true };
  });
  if (!result.ok) return result;
  revalidatePath("/dashboard", "layout");
  updateTag(TIMELINE_TAG);
  redirect("/dashboard/notebook?deleted=1");
}
