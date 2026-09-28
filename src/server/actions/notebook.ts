"use server";

import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@/generated/prisma/client";
import { idSchema, saveEntrySchema, urlSchema } from "@/lib/validation";
import { fetchAndExtract } from "@/server/services/extraction";
import { SafeFetchError } from "@/lib/http/safe-fetch";
import { TIMELINE_TAG } from "@/server/queries/public";
import { deleteEntry, publishEntry, saveEntry, searchLinkTargets, unpublishEntry, type LinkTarget, type SavedEntry } from "@/server/services/notebook";
import { adminAction, type ActionResult } from "./result";
import { z } from "zod";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { presignUpload, type PresignedUpload } from "@/lib/storage";
import { cleanupUnusedAssets, recordAsset } from "@/server/services/assets";

/** Validate a save payload and store it; returns the saved entry or an error message. */
async function saveFromPayload(payload: unknown, userId: string): Promise<SavedEntry | string> {
  const input = saveEntrySchema.parse(payload);
  // Store only a plain JSON copy of the document (rejects anything that isn't pure data).
  let body: Prisma.InputJsonValue;
  try {
    body = JSON.parse(JSON.stringify(input.body)) as Prisma.InputJsonValue;
  } catch {
    return "The editor document could not be read. Reload the page and try again.";
  }
  return saveEntry({ ...input, body }, userId);
}

/*
 * No revalidatePath() in these actions: it makes the router re-render the page
 * and can remount the editor mid-typing. Dashboard pages are dynamic and load
 * fresh data on navigation; the public timeline/article cache is refreshed via
 * updateTag(TIMELINE_TAG).
 */

/**
 * Save a Notebook entry (creates it on first save). Called by the editor's
 * autosave and by Ctrl+S / the Save button. Takes a plain object, not FormData.
 */
export async function saveEntryAction(payload: unknown): Promise<ActionResult<SavedEntry>> {
  return adminAction(async (user) => {
    const saved = await saveFromPayload(payload, user.id);
    if (typeof saved === "string") return { ok: false, error: saved };
    // A published entry's changes are live immediately.
    if (saved.status === "PUBLISHED") updateTag(TIMELINE_TAG);
    return { ok: true, data: saved };
  });
}

/** Save the current editor state, then publish it (one click → live). */
export async function publishEntryAction(payload: unknown): Promise<ActionResult<SavedEntry>> {
  return adminAction(async (user) => {
    const saved = await saveFromPayload(payload, user.id);
    if (typeof saved === "string") return { ok: false, error: saved };
    await publishEntry(saved.id, user.id);
    updateTag(TIMELINE_TAG);
    return { ok: true, message: "Published to your timeline.", data: { ...saved, status: "PUBLISHED" } };
  });
}

export async function unpublishEntryAction(entryId: string): Promise<ActionResult> {
  return adminAction(async (user) => {
    await unpublishEntry(idSchema.parse(entryId), user.id);
    updateTag(TIMELINE_TAG);
    return { ok: true, message: "Unpublished — it's a private draft again." };
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

const uploadSchema = z.object({
  kind: z.enum(["image", "video", "audio", "file"]).default("image"),
  filename: z.string().trim().min(1).max(200),
  contentType: z.string().max(100),
  size: z.number().int().positive(),
  contentId: z.string().min(1).max(64).nullable().optional(),
});

/** A short-lived signed upload URL for one image / video / file (admin only, rate limited). */
export async function createUploadAction(payload: unknown): Promise<ActionResult<PresignedUpload>> {
  return adminAction(
    async (user) => {
      const input = uploadSchema.parse(payload);
      const upload = await presignUpload(input);
      await recordAsset({
        key: upload.key,
        url: upload.publicUrl,
        contentType: input.contentType,
        size: input.size,
        filename: input.filename,
        uploadedById: user.id,
        contentId: input.contentId ?? null,
      });
      return { ok: true, data: upload };
    },
    { rateLimit: { key: "upload", rule: RATE_LIMITS.upload } },
  );
}

/** Settings → "Remove unused images": deletes uploads no entry uses (older than 1 hour). */
export async function cleanupImagesAction(): Promise<ActionResult> {
  return adminAction(async () => {
    const { deleted, bytes } = await cleanupUnusedAssets({ minAgeMs: 60 * 60 * 1000 });
    return {
      ok: true,
      message: deleted ? `Removed ${deleted} unused image${deleted === 1 ? "" : "s"} (${(bytes / (1024 * 1024)).toFixed(1)} MB).` : "No unused images to remove.",
    };
  });
}

const linkSearchSchema = z.object({ query: z.string().max(100).default(""), excludeId: z.string().max(64).nullable().optional() });

/** Items for the "[[" internal-link picker (admin only, rate limited). */
export async function searchLinkTargetsAction(payload: unknown): Promise<ActionResult<LinkTarget[]>> {
  return adminAction(
    async () => {
      const input = linkSearchSchema.parse(payload);
      return { ok: true, data: await searchLinkTargets(input.query, input.excludeId) };
    },
    { rateLimit: { key: "linkSearch", rule: RATE_LIMITS.linkSearch } },
  );
}

export interface LinkPreview {
  url: string;
  title: string;
  description: string | null;
  image: string | null;
  site: string;
}

const clip = (v: string | null | undefined, max: number) => {
  const t = (v ?? "").replace(/\s+/g, " ").trim();
  return t ? (t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t) : null;
};

/** Title, description, image and site name for a link card (SSRF-safe fetch; admin only, rate limited). */
export async function fetchLinkPreviewAction(payload: unknown): Promise<ActionResult<LinkPreview>> {
  return adminAction(
    async () => {
      const url = urlSchema.parse(z.object({ url: z.string().max(2000) }).parse(payload).url);
      try {
        const { doc, finalUrl } = await fetchAndExtract(url);
        const host = new URL(finalUrl).hostname.replace(/^www\./, "");
        let image: string | null = null;
        try {
          const u = doc.thumbnail ? new URL(doc.thumbnail, finalUrl) : null;
          image = u?.protocol === "https:" ? u.href : null;
        } catch {
          image = null;
        }
        return {
          ok: true,
          data: { url: finalUrl, title: clip(doc.title, 200) ?? host, description: clip(doc.description, 300), image, site: clip(doc.siteName, 80) ?? host },
        };
      } catch (err) {
        if (err instanceof SafeFetchError) return { ok: false, error: `Couldn't load that page: ${err.message}` };
        throw err;
      }
    },
    { rateLimit: { key: "fetch", rule: RATE_LIMITS.fetch } },
  );
}
