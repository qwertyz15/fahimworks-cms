"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { CONTENT_TYPES, VERIFICATION_METHODS, createContentSchema, idSchema, updateContentSchema, urlSchema } from "@/lib/validation";
import {
  approveContent,
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
import { issueVerificationToken, runVerification } from "@/server/services/verification";
import { adminAction, formString, type ActionResult } from "./result";

function refresh(id?: string) {
  revalidatePath("/dashboard", "layout");
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

export async function createContentAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  let id: string | undefined;
  const result = await adminAction<undefined>(async (user) => {
    const input = createContentSchema.parse({
      url: formString(form, "url"),
      type: formString(form, "type"),
      method: formString(form, "method") || undefined,
      tags: formString(form, "tags"),
      acknowledgeDuplicates: formString(form, "acknowledgeDuplicates") === "on",
    });
    if (formString(form, "hasWarnings") === "true" && !input.acknowledgeDuplicates) {
      return { ok: false, error: "Confirm that you want to add this item despite the similar content warnings." };
    }
    const content = await createContent({ ...input, titleHint: formString(form, "title").slice(0, 300) }, user.id);
    id = content.id;
    return { ok: true };
  });
  if (!result.ok || !id) return result;
  refresh();
  redirect(`/dashboard/content/${id}?added=1`);
}

export async function issueTokenAction(contentId: string, method: string): Promise<ActionResult> {
  return adminAction(async (user) => {
    const id = idSchema.parse(contentId);
    await issueVerificationToken(id, z.enum(VERIFICATION_METHODS).parse(method), user.id);
    refresh(id);
    return { ok: true, message: "New verification token generated." };
  });
}

export async function verifyOwnershipAction(contentId: string): Promise<ActionResult> {
  return adminAction(
    async (user) => {
      const id = idSchema.parse(contentId);
      const outcome = await runVerification(id, user.id);
      if (!outcome.ok) {
        refresh(id);
        return { ok: false, error: outcome.message };
      }
      // Ownership proven — extract immediately so the item lands in review.
      const extraction = await runExtraction(id, user.id);
      refresh(id);
      return extraction.ok
        ? { ok: true, message: `Ownership verified. ${extraction.message}` }
        : { ok: false, error: `Ownership verified, but extraction failed: ${extraction.message}` };
    },
    { rateLimit: { key: "verify", rule: RATE_LIMITS.verify } },
  );
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

export async function approveAction(contentId: string): Promise<ActionResult> {
  return adminAction(async (user) => {
    const id = idSchema.parse(contentId);
    await approveContent(id, user.id);
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

export async function unpublishAction(contentId: string): Promise<ActionResult> {
  return adminAction(async (user) => {
    const id = idSchema.parse(contentId);
    await unpublishContent(id, user.id);
    refresh(id);
    return { ok: true, message: "Removed from your portfolio. The item is back in review." };
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
