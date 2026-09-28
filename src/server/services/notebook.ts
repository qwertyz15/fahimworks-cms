import "server-only";
import { db } from "@/lib/db";
import { slugify } from "@/lib/utils";
import type { ContentType } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { audit } from "./audit";
import { tagConnect, uniqueSlug } from "./content-helpers";
import { ContentError } from "./content";
import { transition, WorkflowError } from "./workflow";
import { deriveFields, mediaSources, renderNotebookHtml } from "./notebook-html";
import { cleanupUnusedAssets, linkAssets } from "./assets";
import { storagePublicOrigin } from "@/lib/storage";

/**
 * Notebook: posts written in the dashboard editor (source = WRITTEN).
 * One version per entry — each save overwrites the row. Drafts are private;
 * publishing makes the entry public on the timeline and its article page.
 */

export interface SaveEntryInput {
  id?: string;
  title: string;
  subtitle: string | null;
  type: ContentType;
  tags: string[];
  slug: string | null;
  summary: string | null;
  featured: boolean;
  /** Chosen cover image URL (null = none; the first image is used as the thumbnail). */
  coverImage: string | null;
  /** Tiptap JSON document. */
  body: Prisma.InputJsonValue;
  /** Editor HTML — untrusted, re-sanitised here. */
  html: string;
}

export interface SavedEntry {
  id: string;
  slug: string;
  status: string;
  savedAt: string;
  wordCount: number;
  readingMinutes: number;
}

export const UNTITLED = "Untitled";

async function resolveSlug(requested: string | null, title: string, existing?: { id: string; slug: string; status: string }) {
  // Published slugs are frozen so shared links never break.
  if (existing?.status === "PUBLISHED") return existing.slug;
  const wanted = requested ? slugify(requested, 70) : null;
  if (wanted && wanted !== existing?.slug) {
    const clash = await db.content.findUnique({ where: { slug: wanted }, select: { id: true } });
    if (clash && clash.id !== existing?.id) throw new ContentError(`The slug “${wanted}” is already used by another item.`);
    return wanted;
  }
  if (existing) return existing.slug;
  return uniqueSlug(title === UNTITLED ? "untitled" : title);
}

export async function saveEntry(input: SaveEntryInput, actorId: string): Promise<SavedEntry> {
  const title = input.title.trim() || UNTITLED;
  const origin = storagePublicOrigin();
  const contentHtml = renderNotebookHtml(input.html, { imageOrigins: origin ? [origin] : [] });
  const coverImage = safeImageUrl(input.coverImage, origin);
  const derived = deriveFields(contentHtml);

  const data = {
    title,
    subtitle: input.subtitle,
    type: input.type,
    body: input.body,
    contentHtml,
    contentText: derived.contentText,
    wordCount: derived.wordCount,
    readingMinutes: derived.readingMinutes,
    summary: input.summary?.trim() || derived.autoSummary,
    coverImage,
    thumbnail: coverImage ?? derived.firstImage,
    featured: input.featured,
  } satisfies Prisma.ContentUpdateInput;

  if (!input.id) {
    const created = await db.content.create({
      data: {
        ...data,
        source: "WRITTEN",
        slug: await resolveSlug(input.slug, title),
        authorId: actorId,
        extractionStatus: "SUCCEEDED",
        tags: { connectOrCreate: tagConnect(input.tags) },
      },
    });
    await audit({ actorId, action: "content.created", targetType: "content", targetId: created.id, metadata: { source: "WRITTEN" } });
    await linkAssets(created.id, [...mediaSources(contentHtml), ...(coverImage ? [coverImage] : [])]);
    return toSaved(created);
  }

  const existing = await db.content.findUnique({ where: { id: input.id }, select: { id: true, slug: true, status: true, source: true } });
  if (!existing || existing.source !== "WRITTEN") throw new ContentError("Notebook entry not found.");

  const updated = await db.content.update({
    where: { id: existing.id },
    data: {
      ...data,
      slug: await resolveSlug(input.slug, title, existing),
      tags: { set: [], connectOrCreate: tagConnect(input.tags) },
    },
  });
  await linkAssets(updated.id, [...mediaSources(contentHtml), ...(coverImage ? [coverImage] : [])]);
  // Autosave runs every few seconds — deliberately not audited per save.
  return toSaved(updated);
}

/** Accept only https URLs (or the storage origin, e.g. local MinIO) as cover images. */
function safeImageUrl(url: string | null, storageOrigin: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.origin === storageOrigin ? u.href : null;
  } catch {
    return null;
  }
}

function toSaved(row: { id: string; slug: string; status: string; updatedAt: Date; wordCount: number | null; readingMinutes: number | null }): SavedEntry {
  return {
    id: row.id,
    slug: row.slug,
    status: row.status,
    savedAt: row.updatedAt.toISOString(),
    wordCount: row.wordCount ?? 0,
    readingMinutes: row.readingMinutes ?? 0,
  };
}

export async function deleteEntry(id: string, actorId: string) {
  const entry = await db.content.findUnique({ where: { id }, select: { id: true, title: true, source: true } });
  if (!entry || entry.source !== "WRITTEN") throw new ContentError("Notebook entry not found.");
  const assetIds = (await db.asset.findMany({ where: { contentId: id }, select: { id: true } })).map((a) => a.id);
  await db.content.delete({ where: { id } });
  // Remove its images from storage right away (unless another entry uses them).
  if (assetIds.length) await cleanupUnusedAssets({ ids: assetIds, minAgeMs: 0 }).catch((err) => console.error("[notebook] image cleanup failed", err));
  await audit({ actorId, action: "content.deleted", targetType: "content", targetId: id, metadata: { title: entry.title, source: "WRITTEN" } });
}

/** Draft → Published. Needs a real title and some content; sets the publish date if unset. */
export async function publishEntry(id: string, actorId: string) {
  const entry = await db.content.findUnique({
    where: { id },
    select: { id: true, source: true, status: true, title: true, wordCount: true, publishDate: true },
  });
  if (!entry || entry.source !== "WRITTEN") throw new ContentError("Notebook entry not found.");
  if (entry.status === "PUBLISHED") return;
  if (!entry.title.trim() || entry.title === UNTITLED) throw new WorkflowError("Add a title before publishing.");
  if (!entry.wordCount) throw new WorkflowError("Write something before publishing.");
  await transition(id, entry.status, "PUBLISHED", { data: { publishDate: entry.publishDate ?? new Date() } });
  await audit({ actorId, action: "content.approved", targetType: "content", targetId: id, metadata: { source: "WRITTEN" } });
}

/** Published → Draft (removed from the timeline and its article page). */
export async function unpublishEntry(id: string, actorId: string) {
  const entry = await db.content.findUnique({ where: { id }, select: { source: true, status: true } });
  if (!entry || entry.source !== "WRITTEN") throw new ContentError("Notebook entry not found.");
  if (entry.status !== "PUBLISHED") return;
  await transition(id, "PUBLISHED", "DRAFT");
  await audit({ actorId, action: "content.unpublished", targetType: "content", targetId: id, metadata: { source: "WRITTEN" } });
}
