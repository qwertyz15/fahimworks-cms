import "server-only";
import * as cheerio from "cheerio";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { mergesInto, prunable, type RevisionReason } from "@/lib/revisions";
import { storagePublicOrigin } from "@/lib/storage";
import { deriveFields, renderNotebookHtml } from "./notebook-html";
import { ContentError } from "./content";

/**
 * Version history for Notebook entries and database pages. Every save calls
 * recordRevision(); the newest version always matches what's saved.
 */

export type RevisionTarget = { contentId: string } | { pageId: string };

const whereOf = (t: RevisionTarget) => ("contentId" in t ? { contentId: t.contentId } : { pageId: t.pageId });

export interface RevisionState {
  title: string;
  subtitle?: string | null;
  body: unknown;
  contentHtml: string | null;
  wordCount: number;
}

/** Save a version (or update the latest one within its window). Never throws: history must not break saving. */
export async function recordRevision(target: RevisionTarget, state: RevisionState, reason: RevisionReason, actorId: string | null, opts: { published?: boolean } = {}) {
  try {
    const now = new Date();
    const latest = await db.revision.findFirst({ where: whereOf(target), orderBy: { updatedAt: "desc" }, select: { id: true, updatedAt: true, reason: true, published: true, title: true, subtitle: true, contentHtml: true } });
    const data = {
      title: state.title.slice(0, 300),
      subtitle: state.subtitle ?? null,
      body: (state.body ?? null) as Prisma.InputJsonValue,
      contentHtml: state.contentHtml,
      wordCount: state.wordCount,
    };
    const unchanged = latest && latest.title === data.title && (latest.subtitle ?? null) === data.subtitle && (latest.contentHtml ?? null) === (data.contentHtml ?? null);
    if (latest && unchanged) {
      // Same content: just mark it published (or leave it).
      if (opts.published && !latest.published) await db.revision.update({ where: { id: latest.id }, data: { published: true, reason: "publish" } });
      return;
    }
    if (mergesInto(latest, reason, now)) {
      await db.revision.update({ where: { id: latest!.id }, data: { ...data, reason: reason === "save" ? "save" : latest!.reason } });
    } else {
      await db.revision.create({ data: { ...whereOf(target), ...data, reason, published: Boolean(opts.published), createdById: actorId } });
    }
    await pruneRevisions(target, now);
  } catch (err) {
    console.error("[revisions] could not record a version", err);
  }
}

export async function pruneRevisions(target: RevisionTarget, now = new Date()) {
  const all = await db.revision.findMany({ where: whereOf(target), select: { id: true, updatedAt: true, reason: true, published: true } });
  const drop = prunable(all, now);
  if (drop.length) await db.revision.deleteMany({ where: { id: { in: drop } } });
}

export interface RevisionSummary {
  id: string;
  title: string;
  reason: string;
  published: boolean;
  wordCount: number;
  savedAt: string;
  current: boolean;
}

export async function listRevisions(target: RevisionTarget): Promise<RevisionSummary[]> {
  const rows = await db.revision.findMany({ where: whereOf(target), orderBy: { updatedAt: "desc" }, take: 400, select: { id: true, title: true, reason: true, published: true, wordCount: true, updatedAt: true } });
  return rows.map((r, i) => ({ id: r.id, title: r.title, reason: r.reason, published: r.published, wordCount: r.wordCount, savedAt: r.updatedAt.toISOString(), current: i === 0 }));
}

/** Text with one line per block (paragraph, heading, list item…), for the diff. */
export function blockText(html: string): string {
  const $ = cheerio.load(html);
  $("pre[data-mermaid]").each((_, el) => {
    $(el).replaceWith(`[Diagram] ${$(el).text().replace(/\s+/g, " ")}`);
  });
  $('[data-type="inline-math"], [data-type="block-math"]').each((_, el) => {
    $(el).text(` ${$(el).attr("data-latex") ?? ""} `);
  });
  $("img").each((_, el) => {
    $(el).replaceWith(`[Image${$(el).attr("alt") ? `: ${$(el).attr("alt")}` : ""}]`);
  });
  $("p, h1, h2, h3, h4, li, blockquote, pre, td, th, figcaption, summary, aside, hr, figure, div[data-board-column]").after("\n");
  $("br").replaceWith("\n");
  return $.root()
    .text()
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** One version: its HTML (sanitised when saved) and plain text, for preview and diff. */
export async function getRevision(id: string, target: RevisionTarget) {
  const r = await db.revision.findFirst({ where: { id, ...whereOf(target) }, select: { id: true, title: true, subtitle: true, contentHtml: true, wordCount: true, updatedAt: true, reason: true, published: true } });
  if (!r) throw new ContentError("That version no longer exists.");
  return { ...r, savedAt: r.updatedAt.toISOString(), text: blockText(r.contentHtml ?? "") };
}

/** Put an old version back. The current state is kept as a version first, so this can be undone. */
export async function restoreNotebookRevision(contentId: string, revisionId: string, actorId: string) {
  const entry = await db.content.findFirst({ where: { id: contentId, source: "WRITTEN" }, select: { id: true, title: true, subtitle: true, body: true, contentHtml: true, wordCount: true, status: true } });
  if (!entry) throw new ContentError("Notebook entry not found.");
  const rev = await db.revision.findFirst({ where: { id: revisionId, contentId } });
  if (!rev) throw new ContentError("That version no longer exists.");
  // Make sure the current state is in the history (it normally already is).
  await recordRevision({ contentId }, { title: entry.title, subtitle: entry.subtitle, body: entry.body, contentHtml: entry.contentHtml, wordCount: entry.wordCount ?? 0 }, "save", actorId);
  const origin = storagePublicOrigin();
  // Re-sanitise with today's rules.
  const contentHtml = renderNotebookHtml(rev.contentHtml ?? "", { imageOrigins: origin ? [origin] : [] });
  const derived = deriveFields(contentHtml);
  await db.content.update({
    where: { id: contentId },
    data: {
      title: rev.title,
      subtitle: rev.subtitle,
      body: (rev.body ?? { type: "doc", content: [] }) as Prisma.InputJsonValue,
      contentHtml,
      contentText: derived.contentText,
      wordCount: derived.wordCount,
      readingMinutes: derived.readingMinutes,
    },
  });
  await recordRevision({ contentId }, { title: rev.title, subtitle: rev.subtitle, body: rev.body, contentHtml, wordCount: derived.wordCount }, "restore", actorId);
  return { live: entry.status === "PUBLISHED" };
}

/** Put an old version of a database page back (title and body). */
export async function restorePageRevision(pageId: string, revisionId: string, actorId: string, save: (input: { body: Prisma.InputJsonValue; html: string }) => Promise<{ words: number }>) {
  const page = await db.page.findUnique({ where: { id: pageId }, select: { title: true, body: true, contentHtml: true, contentText: true } });
  if (!page) throw new ContentError("Page not found.");
  const rev = await db.revision.findFirst({ where: { id: revisionId, pageId } });
  if (!rev) throw new ContentError("That version no longer exists.");
  await recordRevision({ pageId }, { title: page.title, body: page.body, contentHtml: page.contentHtml, wordCount: deriveFields(page.contentHtml ?? "").wordCount }, "save", actorId);
  await db.page.update({ where: { id: pageId }, data: { title: rev.title } });
  // Through the page's own save: sanitising, search text, thumbnail, image links.
  const saved = await save({ body: (rev.body ?? { type: "doc", content: [] }) as Prisma.InputJsonValue, html: rev.contentHtml ?? "" });
  await recordRevision({ pageId }, { title: rev.title, body: rev.body, contentHtml: rev.contentHtml, wordCount: saved.words }, "restore", actorId);
}

/** All versions of these entries (when they're deleted for good). */
export async function deleteRevisionsOf(contentIds: string[]) {
  if (contentIds.length) await db.revision.deleteMany({ where: { contentId: { in: contentIds } } });
}
