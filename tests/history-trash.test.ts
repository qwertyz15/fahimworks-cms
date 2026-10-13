/**
 * Version history, trash and error grouping. The rules are unit-tested; the
 * services run against the local Postgres (skipped when it isn't reachable).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { AUTO_WINDOW_MS, MAX_REVISIONS, diffText, mergesInto, prunable } from "@/lib/revisions";

process.env.DATABASE_URL ??= "postgresql://portfolio:portfolio@localhost:55432/portfolio?schema=public";
// Storage config reads the validated environment (image cleanup).
process.env.AUTH_SECRET ??= "test-secret-for-history-trash-tests-0123456789";

const DAY = 86_400_000;
const now = new Date("2026-10-13T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const rev = (id: string, age: number, extra: { reason?: string; published?: boolean } = {}) => ({ id, updatedAt: ago(age), reason: extra.reason ?? "auto", published: extra.published ?? false });

describe("version rules", () => {
  it("autosaves merge within 10 minutes; publish, restore and older ones don't", () => {
    expect(mergesInto(rev("a", 60_000), "auto", now)).toBe(true);
    expect(mergesInto(rev("a", AUTO_WINDOW_MS + 1), "auto", now)).toBe(false);
    expect(mergesInto(rev("a", 60_000, { published: true }), "auto", now)).toBe(false);
    expect(mergesInto(rev("a", 60_000, { reason: "restore" }), "auto", now)).toBe(false);
    expect(mergesInto(rev("a", 60_000), "publish", now)).toBe(false);
    expect(mergesInto(rev("a", 30_000), "save", now)).toBe(true);
    expect(mergesInto(rev("a", 120_000), "save", now)).toBe(false);
    expect(mergesInto(rev("a", 30_000, { reason: "save" }), "auto", now)).toBe(false);
    expect(mergesInto(null, "auto", now)).toBe(false);
  });
  it("keeps the last 7 days, one a day to 90, published forever, the newest always", () => {
    const list = [
      rev("now", 0),
      rev("d1", 1 * DAY),
      rev("d6", 6 * DAY),
      rev("d10a", 10 * DAY),
      rev("d10b", 10 * DAY + 3_600_000),
      rev("d40", 40 * DAY),
      rev("old", 120 * DAY),
      rev("oldPub", 200 * DAY, { published: true }),
    ];
    expect(prunable(list, now).sort()).toEqual(["d10b", "old"]);
    // The only version is never pruned, however old.
    expect(prunable([rev("x", 400 * DAY)], now)).toEqual([]);
  });
  it("caps unpublished versions", () => {
    const many = Array.from({ length: MAX_REVISIONS + 20 }, (_, i) => rev(`r${i}`, i * 1000));
    const pub = rev("pub", 5 * DAY, { published: true });
    const drop = prunable([...many, pub], now);
    expect(drop.length).toBe(20);
    expect(drop).not.toContain("pub");
    expect(drop).not.toContain("r0");
  });
  it("diff: unchanged paragraphs, word changes inside a paragraph, added and removed paragraphs", () => {
    const d = diffText("Intro stays.\nThe quick brown fox.\nGone paragraph.", "Intro stays.\nThe quick red fox jumps.\nNew paragraph.");
    expect(d[0]).toEqual([{ kind: "same", text: "Intro stays." }]);
    const words = d[1]!;
    expect(words.filter((p) => p.kind === "del").map((p) => p.text.trim())).toContain("brown");
    expect(words.filter((p) => p.kind === "add").map((p) => p.text).join("")).toContain("red");
    expect(d.flat().some((p) => p.kind === "del" && p.text.includes("Gone"))).toBe(true);
    expect(d.flat().some((p) => p.kind === "add" && p.text.includes("New"))).toBe(true);
    // Removed words come before added ones.
    expect(words.findIndex((p) => p.kind === "del")).toBeLessThan(words.findIndex((p) => p.kind === "add"));
    expect(diffText("Same.", "Same.")).toEqual([[{ kind: "same", text: "Same." }]]);
    // Unrelated paragraphs aren't diffed word by word.
    expect(diffText("Alpha beta gamma delta.", "Totally different words here now.")).toEqual([[{ kind: "del", text: "Alpha beta gamma delta." }], [{ kind: "add", text: "Totally different words here now." }]]);
  });
});

async function reachable() {
  const c = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 1500 });
  try {
    await c.connect();
    const r = await c.query("select to_regclass('public.revisions') as t");
    return Boolean(r.rows[0]?.t);
  } catch {
    return false;
  } finally {
    await c.end().catch(() => {});
  }
}
const up = await reachable();

describe.skipIf(!up)("history, trash, errors (Postgres)", async () => {
  const { db } = await import("@/lib/db");
  const { saveEntry, publishEntry } = await import("@/server/services/notebook");
  const revs = await import("@/server/services/revisions");
  const trash = await import("@/server/services/trash");
  const folders = await import("@/server/services/folders");
  const errors = await import("@/server/services/errors");
  const { cleanupUnusedAssets } = await import("@/server/services/assets");
  let userId = "";
  const tag = `h${Date.now()}`;
  const save = (input: { id?: string; title: string; html: string; folderId?: string | null; saveKind?: "auto" | "save"; tags?: string[] }) =>
    saveEntry({ subtitle: null, tags: input.tags ?? [], slug: null, summary: null, featured: false, coverImage: null, body: { type: "doc", content: [] }, ...input }, userId);
  const versions = async (contentId: string) => db.revision.findMany({ where: { contentId }, orderBy: { updatedAt: "desc" } });

  beforeAll(async () => {
    userId = (await db.user.create({ data: { name: "History Test", email: `history-${Date.now()}@example.test`, passwordHash: "x" } })).id;
  });

  it("saves make versions: autosaves merge, Ctrl+S and publish are kept, no duplicates", async () => {
    const e = await save({ title: `${tag} Story`, html: "<p>First draft words.</p>" });
    expect((await versions(e.id)).length).toBe(1);
    await save({ id: e.id, title: `${tag} Story`, html: "<p>First draft words, more.</p>" });
    expect((await versions(e.id)).length).toBe(1); // merged into the same 10-minute window
    expect((await versions(e.id))[0]!.contentHtml).toContain("more");
    await save({ id: e.id, title: `${tag} Story`, html: "<p>First draft words, more.</p>" });
    expect((await versions(e.id)).length).toBe(1); // identical: nothing new
    // Age the window, then autosave again: a new version.
    await db.revision.updateMany({ where: { contentId: e.id }, data: { updatedAt: ago(AUTO_WINDOW_MS * 2) } });
    await save({ id: e.id, title: `${tag} Story`, html: "<p>Second pass.</p>" });
    expect((await versions(e.id)).length).toBe(2);
    await publishEntry(e.id, userId);
    const v = await versions(e.id);
    expect(v[0]!.published).toBe(true);
    expect(v[0]!.reason).toBe("publish");
    expect(v.length).toBe(2);
  });

  it("restore brings an old version back and keeps the current one in the history", async () => {
    const e = await save({ title: `${tag} Restore me`, html: "<p>Version one text.</p>", saveKind: "save" });
    await db.revision.updateMany({ where: { contentId: e.id }, data: { updatedAt: ago(AUTO_WINDOW_MS * 2) } });
    await save({ id: e.id, title: `${tag} Restore me v2`, html: "<p>Version two text.</p>", saveKind: "save" });
    const [latest, first] = await versions(e.id);
    expect(latest!.title).toBe(`${tag} Restore me v2`);
    const view = await revs.getRevision(first!.id, { contentId: e.id });
    expect(view.text).toBe("Version one text.");
    await revs.restoreNotebookRevision(e.id, first!.id, userId);
    const row = await db.content.findUniqueOrThrow({ where: { id: e.id } });
    expect(row.title).toBe(`${tag} Restore me`);
    expect(row.contentText).toContain("Version one text.");
    const after = await versions(e.id);
    expect(after[0]!.reason).toBe("restore");
    expect(after.some((x) => x.title === `${tag} Restore me v2`)).toBe(true);
  });

  it("trash an entry and restore it: same id, folder, tags, images, history; as a draft", async () => {
    const f = await folders.createFolder({ name: `${tag} Box` }, userId);
    const e = await save({ title: `${tag} Trashable`, html: "<p>Keep me safe.</p>", folderId: f.id, tags: [`${tag}-t`] });
    await publishEntry(e.id, userId);
    const asset = await db.asset.create({ data: { key: `test/${tag}.png`, url: `https://cdn.test/${tag}.png`, contentType: "image/png", size: 10, contentId: e.id, uploadedById: userId, createdAt: ago(DAY) } });
    const before = (await versions(e.id)).length;
    const r = await trash.trashEntry(e.id, userId);
    expect(r.wasPublished).toBe(true);
    expect(await db.content.count({ where: { id: e.id } })).toBe(0);
    expect((await trash.listTrash()).some((t) => t.title === `${tag} Trashable` && t.from === `${tag} Box`)).toBe(true);
    const item = await db.trashItem.findFirstOrThrow({ where: { title: `${tag} Trashable` } });
    const back = await trash.restoreTrash(item.id, userId);
    expect(back.entryId).toBe(e.id);
    const row = await db.content.findUniqueOrThrow({ where: { id: e.id }, include: { tags: true } });
    expect(row.status).toBe("DRAFT");
    expect(row.folderId).toBe(f.id);
    expect(row.tags.map((t) => t.name)).toEqual([`${tag}-t`]);
    expect((await db.asset.findUniqueOrThrow({ where: { id: asset.id } })).contentId).toBe(e.id);
    expect((await versions(e.id)).length).toBe(before);
  });

  it("trash a folder with everything inside, restore it whole", async () => {
    const top = await folders.createFolder({ name: `${tag} Book` }, userId);
    const ch = await folders.createFolder({ name: `${tag} Chapter`, parentId: top.id }, userId);
    const a = await save({ title: `${tag} In top`, html: "<p>a</p>", folderId: top.id });
    const b = await save({ title: `${tag} In chapter`, html: "<p>b</p>", folderId: ch.id });
    const r = await folders.deleteFolder(top.id, "delete-all", userId);
    expect(r.deletedEntries).toBe(2);
    expect(await db.notebookFolder.count({ where: { id: { in: [top.id, ch.id] } } })).toBe(0);
    const item = await db.trashItem.findFirstOrThrow({ where: { title: `${tag} Book` } });
    expect(item.entryCount).toBe(2);
    expect(item.folderCount).toBe(2);
    await trash.restoreTrash(item.id, userId);
    expect((await db.notebookFolder.findUniqueOrThrow({ where: { id: ch.id } })).parentId).toBe(top.id);
    expect((await db.content.findUniqueOrThrow({ where: { id: b.id } })).folderId).toBe(ch.id);
    expect((await db.content.findUniqueOrThrow({ where: { id: a.id } })).folderId).toBe(top.id);
  });

  it("restoring into a folder that's gone lands at the top level", async () => {
    const f = await folders.createFolder({ name: `${tag} Temp` }, userId);
    const e = await save({ title: `${tag} Orphan`, html: "<p>o</p>", folderId: f.id });
    await trash.trashEntry(e.id, userId);
    await folders.deleteFolder(f.id, "move-up", userId);
    await trash.purgeTrash([(await db.trashItem.findFirstOrThrow({ where: { title: `${tag} Temp` } })).id], userId);
    await trash.restoreTrash((await db.trashItem.findFirstOrThrow({ where: { title: `${tag} Orphan` } })).id, userId);
    expect((await db.content.findUniqueOrThrow({ where: { id: e.id } })).folderId).toBeNull();
  });

  it("images in old versions and in the trash survive cleanup; purge deletes for good", async () => {
    const e = await save({ title: `${tag} Pics`, html: `<p>x</p><figure><img src="https://cdn.test/${tag}-old.png"></figure>` });
    const a = await db.asset.create({ data: { key: `test/${tag}-old.png`, url: `https://cdn.test/${tag}-old.png`, contentType: "image/png", size: 5, contentId: e.id, uploadedById: userId, createdAt: ago(DAY) } });
    // The image is removed from the entry, but an old version still shows it.
    await db.revision.updateMany({ where: { contentId: e.id }, data: { updatedAt: ago(AUTO_WINDOW_MS * 2) } });
    await save({ id: e.id, title: `${tag} Pics`, html: "<p>no image now</p>" });
    await cleanupUnusedAssets({ ids: [a.id], minAgeMs: 0 });
    expect(await db.asset.count({ where: { id: a.id } })).toBe(1);
    // Trash it; still kept. Purge it: versions go, and then so does the image.
    await trash.trashEntry(e.id, userId);
    await cleanupUnusedAssets({ ids: [a.id], minAgeMs: 0 });
    expect(await db.asset.count({ where: { id: a.id } })).toBe(1);
    const item = await db.trashItem.findFirstOrThrow({ where: { title: `${tag} Pics` } });
    await trash.purgeTrash([item.id], userId);
    expect(await db.revision.count({ where: { contentId: e.id } })).toBe(0);
    expect(await db.asset.count({ where: { id: a.id } })).toBe(0);
  });

  it("items older than 30 days are deleted for good", async () => {
    const e = await save({ title: `${tag} Old trash`, html: "<p>old</p>" });
    await trash.trashEntry(e.id, userId);
    await db.trashItem.updateMany({ where: { title: `${tag} Old trash` }, data: { deletedAt: ago(31 * DAY) } });
    expect(await trash.purgeExpiredTrash()).toBeGreaterThanOrEqual(1);
    expect(await db.trashItem.count({ where: { title: `${tag} Old trash` } })).toBe(0);
  });

  it("the Next.js error hook records server errors and ignores redirects / 404s", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    const { onRequestError } = await import("@/instrumentation");
    const word = Array.from({ length: 10 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("");
    const req = { path: "/dashboard/x", method: "GET", headers: {} };
    const ctx = { routerKind: "App Router", routePath: "/dashboard/x", routeType: "render", revalidateReason: undefined } as const;
    await onRequestError(new Error(`Hook ${word} broke`), req, ctx);
    await onRequestError(Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" }), req, ctx);
    await onRequestError(Object.assign(new Error("NEXT_HTTP_ERROR_FALLBACK;404"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" }), req, ctx);
    const rows = await db.errorEvent.findMany({ where: { message: { contains: word } } });
    expect(rows.map((r) => [r.source, r.route])).toEqual([["server", "GET /dashboard/x (render)"]]);
    expect(await db.errorEvent.count({ where: { message: { startsWith: "NEXT_" }, lastSeen: { gt: ago(60_000) } } })).toBe(0);
  });

  it("errors are grouped by fingerprint; resolved ones come back on repeat", async () => {
    // Letters only: numbers are stripped when grouping, so a numeric tag would match earlier runs.
    const word = Array.from({ length: 10 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("");
    const msg = `Test ${word} failed for user cmabcdefghijklmnopqrst at 1234`;
    await errors.recordError({ source: "server", message: msg, route: "GET /x (render)" });
    await errors.recordError({ source: "server", message: msg.replace("1234", "9999").replace("cmabcdefghijklmnopqrst", "cmzzzzzzzzzzzzzzzzzzzz"), route: "GET /x (render)" });
    const fp = errors.fingerprintOf("server", msg, null, "GET /x (render)");
    const row = await db.errorEvent.findUniqueOrThrow({ where: { fingerprint: fp } });
    expect(row.count).toBe(2);
    await errors.resolveError(row.id);
    await errors.recordError({ source: "server", message: msg, route: "GET /x (render)" });
    expect((await db.errorEvent.findUniqueOrThrow({ where: { fingerprint: fp } })).resolvedAt).toBeNull();
  });
});
