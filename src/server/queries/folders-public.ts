import "server-only";
import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import { byPosition } from "@/lib/notebook-folders";
import { TIMELINE_TAG, timelineDate } from "./public";

/**
 * Public folder pages (/c/<slug>) and an article's place in its folder.
 * Only public folders and published entries are ever returned. Cached with
 * the timeline; every change refreshes TIMELINE_TAG.
 */

const ENTRY = { id: true, slug: true, title: true, subtitle: true, summary: true, readingMinutes: true, publishDate: true, publishedAt: true, folderPosition: true } as const;
type Entry = { id: string; slug: string; title: string; subtitle: string | null; summary: string | null; readingMinutes: number | null; publishDate: Date | null; publishedAt: Date | null; folderPosition: string | null };

const byFolderPosition = (a: Entry, b: Entry) => {
  const pa = a.folderPosition ?? "~";
  const pb = b.folderPosition ?? "~";
  return pa < pb ? -1 : pa > pb ? 1 : (timelineDate(a)?.getTime() ?? 0) - (timelineDate(b)?.getTime() ?? 0);
};

export interface PublicFolderSection {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
  description: string | null;
  entries: Entry[];
  sections: PublicFolderSection[];
}

export interface PublicFolder extends PublicFolderSection {
  /** Public ancestors, top down. */
  trail: { slug: string; name: string; icon: string | null }[];
  total: number;
  minutes: number;
}

export const getPublicFolder = unstable_cache(
  async (slug: string): Promise<PublicFolder | null> => {
    const folders = await db.notebookFolder.findMany({ select: { id: true, parentId: true, name: true, icon: true, description: true, slug: true, position: true, isPublic: true } });
    const root = folders.find((f) => f.slug === slug && f.isPublic);
    if (!root) return null;
    const entries = await db.content.findMany({ where: { source: "WRITTEN", status: "PUBLISHED", folderId: { not: null } }, select: { ...ENTRY, folderId: true } });
    const build = (id: string, depth: number): PublicFolderSection | null => {
      const f = folders.find((x) => x.id === id)!;
      const own = entries.filter((e) => e.folderId === id).sort(byFolderPosition);
      const sections = depth > 20 ? [] : folders.filter((x) => x.parentId === id && x.isPublic).sort(byPosition).map((x) => build(x.id, depth + 1)).filter((s): s is PublicFolderSection => !!s);
      if (!own.length && !sections.length && id !== root.id) return null;
      return { id: f.id, slug: f.slug, name: f.name, icon: f.icon, description: f.description, entries: own, sections };
    };
    const tree = build(root.id, 0)!;
    const all: Entry[] = [];
    const walk = (s: PublicFolderSection) => (all.push(...s.entries), s.sections.forEach(walk));
    walk(tree);
    const trail: PublicFolder["trail"] = [];
    for (let p = root.parentId ? folders.find((x) => x.id === root.parentId) : undefined; p && trail.length < 20; p = p.parentId ? folders.find((x) => x.id === p!.parentId) : undefined) {
      if (p.isPublic) trail.unshift({ slug: p.slug, name: p.name, icon: p.icon });
    }
    return { ...tree, trail, total: all.length, minutes: all.reduce((s, e) => s + (e.readingMinutes ?? 0), 0) };
  },
  ["public-folder"],
  { tags: [TIMELINE_TAG], revalidate: 3600 },
);

export interface ArticleSeries {
  folder: { slug: string; name: string; icon: string | null };
  index: number;
  total: number;
  prev: { slug: string; title: string } | null;
  next: { slug: string; title: string } | null;
}

/** "Part of …" with previous / next, when the article's folder is public. */
export const getArticleSeries = unstable_cache(
  async (contentId: string): Promise<ArticleSeries | null> => {
    const entry = await db.content.findUnique({ where: { id: contentId }, select: { folderId: true } });
    if (!entry?.folderId) return null;
    const folder = await db.notebookFolder.findUnique({ where: { id: entry.folderId }, select: { slug: true, name: true, icon: true, isPublic: true } });
    if (!folder?.isPublic) return null;
    const siblings = (await db.content.findMany({ where: { source: "WRITTEN", status: "PUBLISHED", folderId: entry.folderId }, select: ENTRY })).sort(byFolderPosition);
    const i = siblings.findIndex((s) => s.id === contentId);
    if (i < 0) return null;
    const link = (e?: Entry) => (e ? { slug: e.slug, title: e.title } : null);
    return { folder: { slug: folder.slug, name: folder.name, icon: folder.icon }, index: i + 1, total: siblings.length, prev: link(siblings[i - 1]), next: link(siblings[i + 1]) };
  },
  ["article-series"],
  { tags: [TIMELINE_TAG], revalidate: 3600 },
);
