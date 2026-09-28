import "server-only";
import { db } from "@/lib/db";
import { SafeFetchError } from "@/lib/http/safe-fetch";
import { normalizeText, sha256, simhash } from "@/lib/similarity";
import { normalizeUrl, parseSubmittedUrl } from "@/lib/url";
import type { ContentType } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { audit } from "./audit";
import { findSimilar, findUrlDuplicate, type DuplicateWarning } from "./duplicates";
import { fetchAndExtract, meaningfulFor } from "./extraction";
import { getSettings } from "./settings";
import { tagConnect, uniqueSlug } from "./content-helpers";
import { transition, WorkflowError } from "./workflow";

export class ContentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentError";
  }
}

// ───────────────────────── Pre-add analysis ─────────────────────────

export interface UrlPreview {
  url: string;
  finalUrl: string;
  title: string | null;
  description: string | null;
  thumbnail: string | null;
  siteName: string | null;
  author: string | null;
  wordCount: number;
  suggestedTags: string[];
  meaningful: { ok: boolean; reason?: string };
  warnings: DuplicateWarning[];
}

/**
 * Analyse a URL before it is added: blocks exact URL duplicates, fetches the
 * page, and reports title/content similarity plus whether the page looks like
 * meaningful content. Nothing is persisted.
 */
export async function previewUrl(rawUrl: string, type: ContentType): Promise<UrlPreview> {
  const parsed = parseSubmittedUrl(rawUrl);
  if (!parsed.ok) throw new ContentError(parsed.error);
  const normalizedUrl = normalizeUrl(parsed.url);

  const existing = await findUrlDuplicate(normalizedUrl);
  if (existing) throw new ContentError(`This URL has already been added as “${existing.title}”.`);

  let fetched;
  try {
    fetched = await fetchAndExtract(parsed.url.href);
  } catch (err) {
    if (err instanceof SafeFetchError) throw new ContentError(`The page could not be loaded: ${err.message}`);
    throw err;
  }
  const { doc, finalUrl } = fetched;

  // A redirect can land on a URL that is already in the system.
  const finalNormalized = normalizeUrl(finalUrl);
  if (finalNormalized !== normalizedUrl) {
    const redirectDup = await findUrlDuplicate(finalNormalized);
    if (redirectDup) throw new ContentError(`This URL redirects to one already added as “${redirectDup.title}”.`);
  }

  const settings = await getSettings();
  const warnings = await findSimilar({
    title: doc.title,
    contentHash: doc.contentText ? sha256(normalizeText(doc.contentText)) : null,
    simhash: doc.contentText ? simhash(doc.contentText) : null,
  });

  return {
    url: parsed.url.href,
    finalUrl,
    title: doc.title,
    description: doc.description,
    thumbnail: doc.thumbnail,
    siteName: doc.siteName,
    author: doc.author,
    wordCount: doc.wordCount,
    suggestedTags: doc.tags,
    meaningful: meaningfulFor(doc, type, settings.minWordCount),
    warnings,
  };
}

// ───────────────────────── Create / update / delete ─────────────────────────

export interface CreateContentInput {
  url: string;
  type: ContentType;
  tags: string[];
  titleHint?: string | null;
}

export async function createContent(input: CreateContentInput, actorId: string) {
  const parsed = parseSubmittedUrl(input.url);
  if (!parsed.ok) throw new ContentError(parsed.error);
  const normalizedUrl = normalizeUrl(parsed.url);
  if (await findUrlDuplicate(normalizedUrl)) throw new ContentError("This URL has already been added.");

  const title = input.titleHint?.trim().slice(0, 300) || `${parsed.url.hostname}${parsed.url.pathname}`;
  let content;
  try {
    content = await db.content.create({
      data: {
        url: parsed.url.href,
        normalizedUrl,
        type: input.type,
        title,
        slug: await uniqueSlug(title),
        authorId: actorId,
        tags: { connectOrCreate: tagConnect(input.tags) },
      },
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") throw new ContentError("This URL has already been added.");
    throw err;
  }

  await audit({ actorId, action: "content.created", targetType: "content", targetId: content.id, metadata: { url: content.url } });
  return content;
}

export interface UpdateContentInput {
  id: string;
  url: string;
  title: string;
  type: ContentType;
  description: string | null;
  summary: string | null;
  thumbnail: string | null;
  author: string | null;
  publishDate: Date | null;
  tags: string[];
  featured: boolean;
}

export async function updateContent(input: UpdateContentInput, actorId: string) {
  const content = await db.content.findUnique({ where: { id: input.id } });
  if (!content) throw new ContentError("Content not found.");

  const parsed = parseSubmittedUrl(input.url);
  if (!parsed.ok) throw new ContentError(parsed.error);
  const normalizedUrl = normalizeUrl(parsed.url);
  const urlChanged = normalizedUrl !== content.normalizedUrl;
  if (urlChanged && (await findUrlDuplicate(normalizedUrl, content.id))) {
    throw new ContentError("Another item already uses this URL.");
  }

  const data: Prisma.ContentUpdateInput = {
    title: input.title,
    type: input.type,
    description: input.description,
    summary: input.summary,
    thumbnail: input.thumbnail,
    author: input.author,
    publishDate: input.publishDate,
    featured: input.featured,
    tags: { set: [], connectOrCreate: tagConnect(input.tags) },
  };
  if (content.status !== "PUBLISHED" && input.title !== content.title) {
    data.slug = await uniqueSlug(input.title, content.id);
  }

  await db.$transaction(async (tx) => {
    if (urlChanged) {
      // Extracted data belongs to the old URL — back to draft until re-extracted.
      const resetData = {
        url: parsed.url.href,
        normalizedUrl,
        extractionStatus: "NOT_STARTED" as const,
        extractionError: null,
        finalUrl: null,
      };
      if (content.status === "DRAFT") await tx.content.update({ where: { id: content.id }, data: resetData });
      else await transition(content.id, content.status, "DRAFT", { data: resetData }, tx);
    }
    await tx.content.update({ where: { id: content.id }, data });
  });

  await audit({ actorId, action: "content.updated", targetType: "content", targetId: content.id, metadata: { urlChanged } });
  return { urlChanged };
}

export async function deleteContent(id: string, actorId: string) {
  const content = await db.content.findUnique({ where: { id }, select: { id: true, title: true, url: true } });
  if (!content) throw new ContentError("Content not found.");
  await db.content.delete({ where: { id } });
  await audit({ actorId, action: "content.deleted", targetType: "content", targetId: id, metadata: { title: content.title, url: content.url } });
}

// ───────────────────────── Editorial decisions ─────────────────────────

async function load(id: string) {
  const content = await db.content.findUnique({ where: { id } });
  if (!content) throw new ContentError("Content not found.");
  return content;
}

export async function approveContent(id: string, actorId: string) {
  const content = await load(id);
  if (content.status !== "AWAITING_APPROVAL") throw new WorkflowError("Only items waiting for approval can be published.");
  if (content.extractionStatus !== "SUCCEEDED") {
    throw new WorkflowError("Extract the content before publishing.");
  }
  await transition(id, "AWAITING_APPROVAL", "PUBLISHED");
  await audit({ actorId, action: "content.approved", targetType: "content", targetId: id });
}

export async function rejectContent(id: string, reason: string | null, actorId: string) {
  const content = await load(id);
  if (content.status !== "AWAITING_APPROVAL" && content.status !== "VERIFIED") {
    throw new WorkflowError("Only items waiting for approval can be rejected. Unpublish published items first.");
  }
  await transition(id, content.status, "REJECTED", { rejectionReason: reason });
  await audit({ actorId, action: "content.rejected", targetType: "content", targetId: id, metadata: { reason } });
}

export async function unpublishContent(id: string, actorId: string) {
  const content = await load(id);
  if (content.status !== "PUBLISHED") throw new WorkflowError("This item is not published.");
  await transition(id, "PUBLISHED", "AWAITING_APPROVAL");
  await audit({ actorId, action: "content.unpublished", targetType: "content", targetId: id });
}

/** Rejected items return to review when their extraction is valid, otherwise to draft. */
export async function reopenContent(id: string, actorId: string) {
  const content = await load(id);
  if (content.status !== "REJECTED") throw new WorkflowError("Only rejected items can be reopened.");
  const to = content.extractionStatus === "SUCCEEDED" ? "AWAITING_APPROVAL" : "DRAFT";
  await transition(id, "REJECTED", to);
  await audit({ actorId, action: "content.reopened", targetType: "content", targetId: id });
}

