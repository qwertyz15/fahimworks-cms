import "server-only";
import JSZip from "jszip";
import { db } from "@/lib/db";
import { fileNameFor } from "@/lib/export/document";
import { toMarkdown } from "@/lib/export/markdown";
import { byPosition, subtreeIds } from "@/lib/notebook-folders";
import { ExportNotFound, notebookSource } from "./source";

/**
 * A folder as a .zip of Markdown files, keeping the folder structure
 * (subfolders become directories). Entries are numbered in their folder's
 * order so the files sort the same way.
 */
export async function folderZip(folderId: string): Promise<{ name: string; data: Buffer }> {
  const folders = await db.notebookFolder.findMany({ select: { id: true, parentId: true, name: true, position: true } });
  const root = folders.find((f) => f.id === folderId);
  if (!root) throw new ExportNotFound();
  const ids = subtreeIds(folders, folderId);
  const entries = await db.content.findMany({ where: { source: "WRITTEN", folderId: { in: [...ids] } }, select: { id: true, title: true, folderId: true, folderPosition: true } });
  const zip = new JSZip();
  const dirName = (name: string) => fileNameFor(name, "x").slice(0, -2);

  const add = async (id: string, dir: JSZip) => {
    const own = entries.filter((e) => e.folderId === id).sort((a, b) => ((a.folderPosition ?? "~") < (b.folderPosition ?? "~") ? -1 : 1));
    const width = String(own.length).length;
    const used = new Set<string>();
    for (const [i, e] of own.entries()) {
      const src = await notebookSource(e.id);
      let name = `${String(i + 1).padStart(Math.max(2, width), "0")}-${fileNameFor(e.title, "md")}`;
      while (used.has(name)) name = name.replace(/\.md$/, "-2.md");
      used.add(name);
      dir.file(name, toMarkdown(src.doc, src.meta, src.ctx));
    }
    const subs = folders.filter((f) => f.parentId === id).sort(byPosition);
    const usedDirs = new Set<string>();
    for (const s of subs) {
      let d = dirName(s.name);
      while (usedDirs.has(d)) d = `${d}-2`;
      usedDirs.add(d);
      await add(s.id, dir.folder(d)!);
    }
  };
  const top = dirName(root.name);
  await add(folderId, zip.folder(top)!);
  const data = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return { name: `${top}.zip`, data };
}
