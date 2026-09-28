"use server";

import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { CONTENT_TYPES, createContentSchema, idSchema, updateContentSchema, urlSchema } from "@/lib/validation";
import {
  publishContent,
  createContent,
  deleteContent,
  previewUrl,
  rejectContent,
  reopenContent,
  unpublishContent,
  updateContent,
  type UrlPreview,
} from "@/server/services/content";
import { runExtraction } from "@/server/services/extraction";
import { publishEntry, unpublishEntry } from "@/server/services/notebook";
import { db } from "@/lib/db";
import { TIMELINE_TAG } from "@/server/queries/public";
import { adminAction, formString, type ActionResult } from "./result";

function refresh(id?: string) {
  revalidatePath("/dashboard", "layout");
  // Any content change may affect the public timeline.
  updateTag(TIMELINE_TAG);
  if (id) revalidatePath(`/dashboard/content/${id}`);
}

export async function previewUrlAction(_prev: ActionResult<UrlPreview>, form: FormData): Promise<ActionResult<UrlPreview>> {
  return adminAction(
    async () => {
      const url = urlSchema.parse(formString(form, "url"));
      const type = z.enum(CONTENT_TYPES).parse(formString(form, "type") || "BLOG");
      const data = await previewUrl(url, type);
      return { ok: true, data };
    },
    { rateLimit: { key: "fetch", rule: RATE_LIMITS.fetch } },
  );
}

/**
 * Add a URL that was analysed on the Add page: create it, extract its content
 * and, with intent "publish" (the default), publish it straight away.
 * Intent "review" stops at "Waiting for approval" instead.
 */
export async function createContentAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  let target: string | undefined;
  const result = await adminAction<undefined>(
    async (user) => {
      const input = createContentSchema.parse({
        url: formString(form, "url"),
        type: formString(form, "type"),
        tags: formString(form, "tags"),
        intent: formString(form, "intent") || undefined,
        acknowledgeDuplicates: formString(form, "acknowledgeDuplicates") === "on",
      });
      if (formString(form, "hasWarnings") === "true" && !input.acknowledgeDuplicates) {
        return { ok: false, error: "Confirm that you want to add this item despite the similar content warnings." };
      }
      const content = await createContent({ ...input, titleHint: formString(form, "title").slice(0, 300) }, user.id);

      const extraction = await runExtraction(content.id, user.id);
      let outcome: "published" | "review" | "failed" = extraction.ok ? "review" : "failed";
      if (extraction.ok && input.intent === "publish") {
        await publishContent(content.id, user.id);
        outcome = "published";
      }
      target = `/dashboard/content/${content.id}?added=${outcome}`;
      return { ok: true };
    },
    { rateLimit: { key: "fetch", rule: RATE_LIMITS.fetch } },
  );
  if (!result.ok || !target) return result;
  refresh();
  redirect(target);
}

export async function reextractAction(contentId: string): Promise<ActionResult> {
  return adminAction(
    async (user) => {
      const id = idSchema.parse(contentId);
      const res = await runExtraction(id, user.id);
      refresh(id);
      return res.ok ? { ok: true, message: res.message } : { ok: false, error: res.message };
    },
    { rateLimit: { key: "fetch", rule: RATE_LIMITS.fetch } },
  );
}

/** Publish any item: Notebook entries and imported items (which need a successful extraction). */
export async function publishAction(contentId: string): Promise<ActionResult> {
  return adminAction(async (user) => {
    const id = idSchema.parse(contentId);
    const item = await db.content.findUnique({ where: { id }, select: { source: true } });
    if (!item) return { ok: false, error: "Content not found." };
    if (item.source === "WRITTEN") await publishEntry(id, user.id);
    else await publishContent(id, user.id);
    refresh(id);
    return { ok: true, message: "Published to your portfolio." };
  });
}

export async function rejectAction(contentId: string, reason: string): Promise<ActionResult> {
  return adminAction(async (user) => {
    const id = idSchema.parse(contentId);
    const why = z.string().trim().max(500).parse(reason ?? "");
    await rejectContent(id, why || null, user.id);
    refresh(id);
    return { ok: true, message: "Content rejected." };
  });
}

/** Unpublish any item: it leaves the timeline, API and RSS and becomes a draft again. */
export async function unpublishAction(contentId: string): Promise<ActionResult> {
  return adminAction(async (user) => {
    const id = idSchema.parse(contentId);
    const item = await db.content.findUnique({ where: { id }, select: { source: true } });
    if (!item) return { ok: false, error: "Content not found." };
    if (item.source === "WRITTEN") await unpublishEntry(id, user.id);
    else await unpublishContent(id, user.id);
    refresh(id);
    return { ok: true, message: "Unpublished — it's a draft again." };
  });
}

export async function reopenAction(contentId: string): Promise<ActionResult> {
  return adminAction(async (user) => {
    const id = idSchema.parse(contentId);
    await reopenContent(id, user.id);
    refresh(id);
    return { ok: true, message: "Item reopened." };
  });
}

export async function updateContentAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  let id: string | undefined;
  let urlChanged = false;
  const result = await adminAction<undefined>(async (user) => {
    const input = updateContentSchema.parse({
      id: formString(form, "id"),
      url: formString(form, "url"),
      title: formString(form, "title"),
      type: formString(form, "type"),
      description: formString(form, "description"),
      summary: formString(form, "summary"),
      thumbnail: formString(form, "thumbnail"),
      author: formString(form, "author"),
      publishDate: formString(form, "publishDate"),
      tags: formString(form, "tags"),
      featured: formString(form, "featured") || "false",
    });
    const res = await updateContent(input, user.id);
    id = input.id;
    urlChanged = res.urlChanged;
    return { ok: true };
  });
  if (!result.ok || !id) return result;
  refresh(id);
  redirect(`/dashboard/content/${id}?${urlChanged ? "urlChanged=1" : "saved=1"}`);
}

export async function deleteContentAction(contentId: string, redirectToList = false): Promise<ActionResult> {
  const result = await adminAction<undefined>(async (user) => {
    const id = idSchema.parse(contentId);
    await deleteContent(id, user.id);
    return { ok: true, message: "Content deleted." };
  });
  if (!result.ok) return result;
  refresh();
  // Redirect server-side so the client never re-renders the deleted item's page.
  if (redirectToList) redirect("/dashboard/content?deleted=1");
  return result;
}
