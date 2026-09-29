import "server-only";
import { db } from "@/lib/db";
import { isComputedError, valueText, type PropertyValue } from "@/lib/db-properties";
import type { DocNode, ExportContext, ExportMeta } from "@/lib/export/document";
import { writtenPostUrl } from "@/lib/timeline";
import { getDatabase, requirePage } from "@/server/databases/service";
import { relatedPages } from "@/server/databases/relations";

/**
 * What an export needs, for a Notebook entry or a database page: the stored
 * editor document, its sanitised HTML, the header fields, and where
 * [[note links]] point (their published article, if any).
 */

export interface ExportSource {
  doc: DocNode | null;
  html: string;
  meta: ExportMeta;
  ctx: ExportContext;
}

export class ExportNotFound extends Error {}

function noteLinkIds(nodes: DocNode[] | undefined, out: Set<string>) {
  for (const n of nodes ?? []) {
    if (n.type === "noteLink" && typeof n.attrs?.id === "string") out.add(n.attrs.id);
    noteLinkIds(n.content, out);
  }
}

async function linkContext(doc: DocNode | null): Promise<ExportContext> {
  const ids = new Set<string>();
  noteLinkIds(doc?.content, ids);
  const published = ids.size ? await db.content.findMany({ where: { id: { in: [...ids] }, source: "WRITTEN", status: "PUBLISHED" }, select: { id: true, slug: true } }) : [];
  const urls = new Map(published.map((c) => [c.id, writtenPostUrl(c.slug)]));
  return { linkFor: (id) => urls.get(id) ?? null };
}

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const asDoc = (v: unknown): DocNode | null => (v && typeof v === "object" && (v as DocNode).type === "doc" ? (v as DocNode) : null);

/** A Notebook entry (the caller has checked the user is an admin). */
export async function notebookSource(id: string): Promise<ExportSource> {
  const entry = await db.content.findFirst({
    where: { id, source: "WRITTEN" },
    select: { title: true, subtitle: true, body: true, contentHtml: true, coverImage: true, publishDate: true, updatedAt: true, tags: { select: { name: true }, orderBy: { name: "asc" } } },
  });
  if (!entry) throw new ExportNotFound();
  const doc = asDoc(entry.body);
  return {
    doc,
    html: entry.contentHtml ?? "",
    meta: { title: entry.title, subtitle: entry.subtitle, date: day(entry.publishDate ?? entry.updatedAt), tags: entry.tags.map((t) => t.name), coverImage: entry.coverImage },
    ctx: await linkContext(doc),
  };
}

/** A database page, with its properties as text (workspace access is checked). */
export async function pageSource(userId: string, id: string): Promise<ExportSource> {
  const page = await requirePage(userId, id, "VIEWER").catch(() => null);
  if (!page) throw new ExportNotFound();
  const doc = asDoc(page.body);
  const properties: { name: string; value: string }[] = [];
  if (page.databaseId) {
    const { properties: defs, people } = await getDatabase(userId, page.databaseId);
    const values = (page.values ?? {}) as Record<string, PropertyValue>;
    const related = await relatedPages(db, defs, [{ values }]);
    for (const d of defs) {
      if (d.isTitle) continue;
      const v = values[d.id];
      let text = "";
      if (d.type === "CREATED_TIME") text = day(page.createdAt) ?? "";
      else if (d.type === "LAST_EDITED_TIME") text = day(page.updatedAt) ?? "";
      else if (v === undefined || v === null || isComputedError(v)) continue;
      else if (d.type === "RELATION") text = (v as string[]).map((r) => related[r]?.title || "Untitled").join(", ");
      else if (d.type === "PERSON") text = (v as string[]).map((p) => people.find((x) => x.id === p)?.name ?? "").filter(Boolean).join(", ");
      else text = valueText(d, v);
      if (text) properties.push({ name: d.name, value: text });
    }
  }
  return {
    doc,
    html: page.contentHtml ?? "",
    meta: { title: page.title, date: day(page.updatedAt), coverImage: page.coverImage, properties },
    ctx: await linkContext(doc),
  };
}
