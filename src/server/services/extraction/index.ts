import "server-only";
import { db } from "@/lib/db";
import { SafeFetchError, safeFetch } from "@/lib/http/safe-fetch";
import { normalizeText, sha256, simhash } from "@/lib/similarity";
import { sameSite } from "@/lib/url";
import type { ContentType } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { audit } from "../audit";
import { findSimilar } from "../duplicates";
import { getSettings } from "../settings";
import { summarize } from "../summary";
import { transition, WorkflowError } from "../workflow";
import { tagConnect, uniqueSlug } from "../content-helpers";
import { checkMeaningful, extractDocument, type ExtractedDocument } from "./parse";

export * from "./parse";

export interface FetchedDocument {
  doc: ExtractedDocument;
  finalUrl: string;
}

/** Fetch an HTML page (same-site redirects only) and extract it. */
export async function fetchAndExtract(url: string): Promise<FetchedDocument> {
  const origin = new URL(url);
  const res = await safeFetch(url, {
    accept: ["text/html", "application/xhtml+xml"],
    onRedirect: (_from, to) => {
      if (!sameSite(origin, to)) {
        throw new SafeFetchError("CROSS_SITE_REDIRECT", `The page redirects to a different site (${to.hostname}).`);
      }
    },
  });
  return { doc: extractDocument(res.body, res.finalUrl.href), finalUrl: res.finalUrl.href };
}

export function minWordsFor(type: ContentType, minWordCount: number) {
  // Project pages (READMEs, landing pages) are legitimately shorter.
  return type === "PROJECT" ? Math.max(50, Math.round(minWordCount / 3)) : minWordCount;
}

export function meaningfulFor(doc: ExtractedDocument, type: ContentType, minWordCount: number) {
  const check = checkMeaningful(type === "PROJECT" ? { ...doc, linkDensity: 0 } : doc, minWordsFor(type, minWordCount));
  return check;
}

/**
 * Extract content for a verified item. On success moves VERIFIED →
 * AWAITING_APPROVAL (or refreshes data in place for items already past that
 * stage). On failure the error is recorded and the stage is unchanged.
 */
export async function runExtraction(contentId: string, actorId: string): Promise<{ ok: boolean; message: string }> {
  const [content, settings] = await Promise.all([
    db.content.findUnique({ where: { id: contentId }, include: { tags: true } }),
    getSettings(),
  ]);
  if (!content) throw new WorkflowError("Content not found.");
  if (!["VERIFIED", "AWAITING_APPROVAL", "PUBLISHED"].includes(content.status)) {
    throw new WorkflowError("Content can only be extracted after ownership is verified.");
  }

  const fail = async (message: string) => {
    await db.content.update({
      where: { id: contentId },
      data: { extractionStatus: "FAILED", extractionError: message, extractedAt: new Date() },
    });
    await audit({ actorId, action: "content.extraction_failed", targetType: "content", targetId: contentId, metadata: { reason: message } });
    return { ok: false, message };
  };

  let fetched: FetchedDocument;
  try {
    fetched = await fetchAndExtract(content.url);
  } catch (err) {
    if (err instanceof SafeFetchError) return fail(`Could not fetch the page: ${err.message}`);
    console.error("[extraction] unexpected error", err);
    return fail("Unexpected error while extracting the page.");
  }

  const { doc, finalUrl } = fetched;
  const meaningful = meaningfulFor(doc, content.type, settings.minWordCount);
  if (!meaningful.ok) return fail(`Rejected: ${meaningful.reason}`);

  const normalizedText = normalizeText(doc.contentText);
  const contentHash = sha256(normalizedText);
  const hash = simhash(doc.contentText);
  const title = doc.title ?? content.title;
  const [warnings, summary] = await Promise.all([
    findSimilar({ title, contentHash, simhash: hash }, contentId),
    summarize({ title, description: doc.description, text: doc.contentText }),
  ]);

  const slug = content.status === "PUBLISHED" ? content.slug : await uniqueSlug(title, contentId);
  const data: Prisma.ContentUpdateManyMutationInput = {
    title,
    slug,
    description: doc.description,
    thumbnail: doc.thumbnail,
    author: doc.author,
    publishDate: doc.publishDate,
    siteName: doc.siteName,
    language: doc.language,
    canonicalUrl: doc.canonicalUrl,
    finalUrl,
    summary,
    contentText: doc.contentText,
    contentHtml: doc.contentHtml,
    wordCount: doc.wordCount,
    readingMinutes: doc.readingMinutes,
    images: doc.images,
    metadata: doc.metadata as Prisma.InputJsonValue,
    contentHash,
    simhash: hash,
    duplicateWarnings: warnings as unknown as Prisma.InputJsonValue,
    extractionStatus: "SUCCEEDED",
    extractionError: null,
    extractedAt: new Date(),
  };

  const existingTags = content.tags.map((t) => t.name);
  const mergedTags = [...existingTags, ...doc.tags.filter((t) => !existingTags.some((e) => e.toLowerCase() === t.toLowerCase()))].slice(0, 20);

  await db.$transaction(async (tx) => {
    const to = content.status === "VERIFIED" ? "AWAITING_APPROVAL" : content.status;
    await transition(contentId, content.status, to, { data }, tx);
    await tx.content.update({ where: { id: contentId }, data: { tags: { set: [], connectOrCreate: tagConnect(mergedTags) } } });
  });

  await audit({
    actorId,
    action: "content.extracted",
    targetType: "content",
    targetId: contentId,
    metadata: { wordCount: doc.wordCount, duplicates: warnings.length },
  });
  return {
    ok: true,
    message: warnings.length
      ? `Content extracted. ${warnings.length} possible duplicate(s) found — review before approving.`
      : "Content extracted and ready for review.",
  };
}
