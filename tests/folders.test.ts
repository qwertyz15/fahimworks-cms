/**
 * Notebook folders against the local Postgres (skipped when it isn't reachable).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { MAX_FOLDER_DEPTH, flatten, moveProblem, pathOf, subtreeIds } from "@/lib/notebook-folders";

process.env.DATABASE_URL ??= "postgresql://portfolio:portfolio@localhost:55432/portfolio?schema=public";

async function reachable() {
  const c = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 1500 });
  try {
    await c.connect();
    const r = await c.query("select to_regclass('public.notebook_folders') as t");
    return Boolean(r.rows[0]?.t);
  } catch {
    return false;
  } finally {
    await c.end().catch(() => {});
  }
}
const up = await reachable();

describe("folder tree helpers", () => {
  const F = [
    { id: "a", parentId: null, name: "A", position: "a0" },
    { id: "b", parentId: "a", name: "B", position: "a0" },
    { id: "c", parentId: "b", name: "C", position: "a0" },
    { id: "d", parentId: null, name: "D", position: "a1" },
  ];
  it("paths, subtrees, flattening", () => {
    expect(pathOf(F, "c").map((f) => f.id)).toEqual(["a", "b", "c"]);
    expect([...subtreeIds(F, "a")].sort()).toEqual(["a", "b", "c"]);
    expect(flatten(F).map((x) => `${x.folder.id}${x.depth}`)).toEqual(["a0", "b1", "c2", "d0"]);
  });
  it("blocks moving a folder into itself or its children, and too deep", () => {
    expect(moveProblem(F, "a", "c")).toMatch(/inside itself/);
    expect(moveProblem(F, "a", "a")).toMatch(/inside itself/);
    expect(moveProblem(F, "c", "d")).toBeNull();
    expect(moveProblem(F, "a", null)).toBeNull();
    const deep = Array.from({ length: MAX_FOLDER_DEPTH }, (_, i) => ({ id: `x${i}`, parentId: i ? `x${i - 1}` : null, name: "x", position: "a0" }));
    expect(moveProblem([...deep, ...F], "a", `x${MAX_FOLDER_DEPTH - 1}`)).toMatch(/nested up to/);
  });
});

describe.skipIf(!up)("notebook folders (Postgres)", async () => {
  const { db } = await import("@/lib/db");
  const svc = await import("@/server/services/folders");
  const { saveEntry } = await import("@/server/services/notebook");
  let userId = "";
  const tag = `t${Date.now()}`;
  const entry = (title: string, folderId: string | null = null, words = true) =>
    saveEntry({ title, subtitle: null, tags: [], slug: null, summary: null, featured: false, coverImage: null, folderId, body: { type: "doc", content: [] }, html: words ? `<p>${title} body text here</p>` : "" }, userId);
  const where = async (id: string) => (await db.content.findUniqueOrThrow({ where: { id }, select: { folderId: true, folderPosition: true, status: true } }));

  beforeAll(async () => {
    const user = await db.user.create({ data: { name: "Folder Test", email: `folders-${Date.now()}@example.test`, passwordHash: "x" } });
    userId = user.id;
  });

  it("creates nested folders with unique slugs, in order", async () => {
    const a = await svc.createFolder({ name: `${tag} Research` }, userId);
    const b = await svc.createFolder({ name: `${tag} Research`, parentId: a.id }, userId);
    const c = await svc.createFolder({ name: `${tag} Zeta`, parentId: null }, userId);
    expect(b.parentId).toBe(a.id);
    expect(b.slug).not.toBe(a.slug);
    expect(a.position < c.position).toBe(true);
    await expect(svc.moveFolder(a.id, { parentId: b.id }, userId)).rejects.toThrow(/inside itself/);
  });

  it("new entries start in their folder, at the end; moves keep a manual order", async () => {
    const f = await svc.createFolder({ name: `${tag} Series` }, userId);
    const e1 = await entry(`${tag} one`, f.id);
    const e2 = await entry(`${tag} two`, f.id);
    const e3 = await entry(`${tag} three`, f.id);
    const p = async () => (await db.content.findMany({ where: { folderId: f.id }, select: { title: true, folderPosition: true } })).sort((x, y) => (x.folderPosition! < y.folderPosition! ? -1 : 1)).map((r) => r.title.replace(`${tag} `, ""));
    expect(await p()).toEqual(["one", "two", "three"]);
    // Drag "three" between "one" and "two".
    await svc.moveEntries([e3.id], { folderId: f.id, afterId: e1.id, beforeId: e2.id });
    expect(await p()).toEqual(["one", "three", "two"]);
    // Move two entries to the top level: they keep their relative order.
    await svc.moveEntries([e1.id, e2.id], { folderId: null });
    expect((await where(e1.id)).folderId).toBeNull();
    expect((await where(e1.id)).folderPosition! < (await where(e2.id)).folderPosition!).toBe(true);
    // A folder that was deleted meanwhile: new entries go to the top level.
    const gone = await svc.createFolder({ name: `${tag} gone` }, userId);
    await svc.deleteFolder(gone.id, "move-up", userId);
    expect((await where((await entry(`${tag} orphan`, gone.id)).id)).folderId).toBeNull();
  });

  it("delete: move contents up, or delete everything inside", async () => {
    const top = await svc.createFolder({ name: `${tag} Top` }, userId);
    const mid = await svc.createFolder({ name: `${tag} Mid`, parentId: top.id }, userId);
    const low = await svc.createFolder({ name: `${tag} Low`, parentId: mid.id }, userId);
    const em = await entry(`${tag} in mid`, mid.id);
    const el = await entry(`${tag} in low`, low.id);
    await svc.deleteFolder(mid.id, "move-up", userId);
    expect((await where(em.id)).folderId).toBe(top.id);
    expect((await db.notebookFolder.findUniqueOrThrow({ where: { id: low.id } })).parentId).toBe(top.id);
    const r = await svc.deleteFolder(top.id, "delete-all", userId);
    expect(r.deletedEntries).toBe(2);
    expect(await db.content.count({ where: { id: { in: [em.id, el.id] } } })).toBe(0);
    expect(await db.notebookFolder.count({ where: { id: { in: [top.id, low.id] } } })).toBe(0);
  });

  it("publish a folder: every entry inside, folder pages on; skipped ones explained; unpublish reverses", async () => {
    const f = await svc.createFolder({ name: `${tag} Book` }, userId);
    const ch = await svc.createFolder({ name: `${tag} Part 1`, parentId: f.id }, userId);
    const a = await entry(`${tag} Intro`, f.id);
    const b = await entry(`${tag} Chapter`, ch.id);
    const empty = await entry(`${tag} Empty`, ch.id, false);
    const r = await svc.publishFolder(f.id, { folderPage: true, slug: `${tag}-the-book` }, userId);
    expect(r.published).toBe(2);
    expect(r.skipped.map((s) => s.id)).toEqual([empty.id]);
    expect(r.skipped[0]!.reason).toMatch(/Write something/);
    expect((await where(a.id)).status).toBe("PUBLISHED");
    expect((await where(b.id)).status).toBe("PUBLISHED");
    const rows = await db.notebookFolder.findMany({ where: { id: { in: [f.id, ch.id] } } });
    expect(rows.every((x) => x.isPublic)).toBe(true);
    expect(rows.find((x) => x.id === f.id)!.slug).toBe(`${tag}-the-book`.toLowerCase());
    expect(await svc.unpublishFolder(f.id, userId)).toBe(2);
    expect((await where(a.id)).status).toBe("DRAFT");
    expect((await db.notebookFolder.findMany({ where: { id: { in: [f.id, ch.id] } } })).some((x) => x.isPublic)).toBe(false);
  });

  it("duplicate a folder: same structure, entries as drafts", async () => {
    const f = await svc.createFolder({ name: `${tag} Original` }, userId);
    const sub = await svc.createFolder({ name: `${tag} Sub`, parentId: f.id }, userId);
    const e = await entry(`${tag} Live one`, sub.id);
    await svc.publishFolder(f.id, { folderPage: true }, userId);
    const copyId = await svc.duplicateFolder(f.id, userId);
    const copy = await db.notebookFolder.findUniqueOrThrow({ where: { id: copyId }, include: { children: true } });
    expect(copy.name).toBe(`${tag} Original (copy)`);
    expect(copy.isPublic).toBe(false);
    expect(copy.children.map((c) => c.name)).toEqual([`${tag} Sub`]);
    const copied = await db.content.findFirstOrThrow({ where: { folderId: copy.children[0]!.id } });
    expect(copied.title).toBe(`${tag} Live one`);
    expect(copied.status).toBe("DRAFT");
    expect(copied.slug).not.toBe((await db.content.findUniqueOrThrow({ where: { id: e.id } })).slug);
  });

  it("rename and duplicate entries", async () => {
    const e = await entry(`${tag} Old name`);
    await svc.renameEntry(e.id, `  ${tag}   New   name `);
    expect((await db.content.findUniqueOrThrow({ where: { id: e.id } })).title).toBe(`${tag} New name`);
    await expect(svc.renameEntry(e.id, "   ")).rejects.toThrow(/empty/);
    const copy = await svc.duplicateEntry(e.id, userId);
    expect((await db.content.findUniqueOrThrow({ where: { id: copy } })).title).toBe(`${tag} New name (copy)`);
  });
});
