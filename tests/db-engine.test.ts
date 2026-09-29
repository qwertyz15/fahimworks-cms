/**
 * Integration tests for the workspace database engine against a real
 * Postgres (the local test DB). Skipped when it isn't reachable.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

process.env.DATABASE_URL ??= "postgresql://portfolio:portfolio@localhost:55432/portfolio?schema=public";

async function reachable() {
  const c = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 1500 });
  try {
    await c.connect();
    const r = await c.query("select to_regclass('public.pages') as t");
    return Boolean(r.rows[0]?.t);
  } catch {
    return false;
  } finally {
    await c.end().catch(() => {});
  }
}
const up = await reachable();

describe.skipIf(!up)("database engine (Postgres)", async () => {
  const { db } = await import("@/lib/db");
  const svc = await import("@/server/databases/service");
  let userId = "";
  let dbId = "";
  const P: Record<string, string> = {};
  let opts: Record<string, string> = {};
  const today = "2026-09-29";

  beforeAll(async () => {
    const user = await db.user.create({ data: { name: "Engine Test", email: `engine-${Date.now()}@example.test`, passwordHash: "x" } });
    userId = user.id;
    const database = await svc.createDatabase(userId, { title: "Tasks" });
    dbId = database.id;
    P.priority = (await svc.addProperty(userId, dbId, { name: "Priority", type: "SELECT", config: { options: [{ id: "hi", name: "High", color: "red" }, { id: "md", name: "Medium", color: "yellow" }, { id: "lo", name: "Low", color: "gray" }] } })).id;
    const status = await svc.addProperty(userId, dbId, { name: "Status", type: "STATUS" });
    P.status = status.id;
    opts = Object.fromEntries((status.config.options ?? []).map((o) => [o.group!, o.id]));
    P.estimate = (await svc.addProperty(userId, dbId, { name: "Estimate", type: "NUMBER" })).id;
    P.due = (await svc.addProperty(userId, dbId, { name: "Due", type: "DATE" })).id;
    P.done = (await svc.addProperty(userId, dbId, { name: "Done", type: "CHECKBOX" })).id;
    P.tags = (await svc.addProperty(userId, dbId, { name: "Tags", type: "MULTI_SELECT", config: { options: [{ id: "ui", name: "UI", color: "blue" }, { id: "api", name: "API", color: "green" }] } })).id;
    P.note = (await svc.addProperty(userId, dbId, { name: "Note", type: "TEXT" })).id;

    // 5,000 rows, deterministic values.
    const { workspaceId } = await svc.getWorkspace(userId);
    const pri = ["hi", "md", "lo"];
    const st = [opts.todo, opts.in_progress, opts.complete];
    const rows = Array.from({ length: 5000 }, (_, i) => ({
      workspaceId,
      databaseId: dbId,
      title: `Task ${String(i).padStart(4, "0")}`,
      position: `a${String(i).padStart(5, "0")}`,
      values: {
        [P.priority!]: pri[i % 3],
        [P.status!]: st[i % 3],
        [P.estimate!]: i % 10,
        [P.due!]: { start: `2026-${String((i % 12) + 1).padStart(2, "0")}-15` },
        [P.done!]: i % 2 === 0,
        [P.tags!]: i % 4 === 0 ? ["ui", "api"] : i % 4 === 1 ? ["ui"] : [],
        ...(i % 5 === 0 ? { [P.note!]: `Note ${i}` } : {}),
      },
      searchText: `Task ${i}`,
      createdById: userId,
      lastEditedById: userId,
    }));
    await db.page.createMany({ data: rows });
  }, 60_000);

  afterAll(async () => {
    if (!userId) return;
    const ws = await db.workspace.findMany({ where: { ownerId: userId }, select: { id: true } });
    await db.workspace.deleteMany({ where: { id: { in: ws.map((w) => w.id) } } });
    await db.user.delete({ where: { id: userId } });
  });

  const rule = (propertyId: string, operator: string, value?: unknown) => ({ kind: "rule" as const, id: Math.random().toString(36).slice(2, 8), propertyId, operator: operator as never, value: value as never });
  const and = (...children: ReturnType<typeof rule>[]) => ({ kind: "group" as const, id: "g", op: "and" as const, children });

  it("filters: select, number, checkbox, multi-select (AND)", async () => {
    const r = await svc.queryRows(userId, dbId, { today, filter: and(rule(P.priority!, "is", "hi"), rule(P.estimate!, "gte", 5), rule(P.done!, "checked"), rule(P.tags!, "contains", "api")) });
    // i % 3 == 0, i % 10 >= 5, i even, i % 4 == 0  → i % 12 == 0 and i % 10 in {6, 8}
    const expected = Array.from({ length: 5000 }, (_, i) => i).filter((i) => i % 3 === 0 && i % 10 >= 5 && i % 2 === 0 && i % 4 === 0).length;
    expect(r.total).toBe(expected);
    expect(r.rows.every((x) => x.values[P.priority!] === "hi" && (x.values[P.estimate!] as number) >= 5)).toBe(true);
  });

  it("OR groups, nested", async () => {
    const filter = { kind: "group" as const, id: "g", op: "or" as const, children: [rule(P.status!, "group_is", "complete"), { kind: "group" as const, id: "h", op: "and" as const, children: [rule(P.priority!, "is", "lo"), rule(P.note!, "is_not_empty")] }] };
    const r = await svc.queryRows(userId, dbId, { today, filter });
    const expected = Array.from({ length: 5000 }, (_, i) => i).filter((i) => i % 3 === 2 || (i % 3 === 2 && i % 5 === 0)).length;
    expect(r.total).toBe(expected);
  });

  it("dates: before / within relative ranges", async () => {
    const before = await svc.queryRows(userId, dbId, { today, filter: and(rule(P.due!, "before", { date: "2026-03-01" })) });
    expect(before.total).toBe(Array.from({ length: 5000 }, (_, i) => i).filter((i) => i % 12 < 2).length);
    const within = await svc.queryRows(userId, dbId, { today, filter: and(rule(P.due!, "within", { range: "past_month" })) });
    // 2026-08-29 .. 2026-09-29 → the 15th of September.
    expect(within.total).toBe(Array.from({ length: 5000 }, (_, i) => i).filter((i) => i % 12 === 8).length);
  });

  it("sorts: select by option order, then number desc", async () => {
    const r = await svc.queryRows(userId, dbId, { today, sorts: [{ propertyId: P.priority!, direction: "asc" }, { propertyId: P.estimate!, direction: "desc" }], limit: 50 });
    expect(r.rows[0]!.values[P.priority!]).toBe("hi");
    expect(r.rows[0]!.values[P.estimate!]).toBe(9);
    expect(r.total).toBe(5000);
  });

  it("search matches titles and values", async () => {
    const r = await svc.queryRows(userId, dbId, { today, search: "Task 0042" });
    expect(r.rows.map((x) => x.title)).toContain("Task 0042");
  });

  it("injection attempts are just values", async () => {
    const evil = "' OR 1=1; DROP TABLE pages; --";
    const r = await svc.queryRows(userId, dbId, { today, filter: and(rule(P.note!, "contains", evil)), search: evil });
    expect(r.total).toBe(0);
    const n = await db.page.count({ where: { databaseId: dbId } });
    expect(n).toBe(5000);
    // Unknown property / operator: ignored, not an error.
    const r2 = await svc.queryRows(userId, dbId, { today, filter: and(rule("nope\"; --", "equals", "x"), rule(P.done!, "gt" as never, 1)) });
    expect(r2.total).toBe(5000);
  });

  it("a filtered, sorted page of 5,000 rows is fast", async () => {
    const t0 = performance.now();
    await svc.queryRows(userId, dbId, { today, filter: and(rule(P.priority!, "is_not", "lo"), rule(P.note!, "contains", "Note")), sorts: [{ propertyId: P.due!, direction: "desc" }, { propertyId: P.estimate!, direction: "asc" }] });
    expect(performance.now() - t0).toBeLessThan(300);
  });

  it("changing Text → Select creates options from the values", async () => {
    const { LIMITS } = await import("@/lib/db-properties");
    const def = await svc.changePropertyType(userId, P.note!, "SELECT");
    // 1,000 distinct notes, capped at the option limit; values beyond it can't be kept.
    expect(def.config.options?.length).toBe(Math.min(1000, LIMITS.options));
    const r = await svc.queryRows(userId, dbId, { today, filter: and(rule(P.note!, "is_not_empty")) });
    expect(r.total).toBe(Math.min(1000, LIMITS.options));
    expect(def.config.options?.some((o) => o.id === r.rows[0]!.values[P.note!])).toBe(true);
  }, 60_000);

  it("rows: create with defaults, update, move, archive", async () => {
    await svc.updateProperty(userId, P.done!, { config: { default: true } });
    const row = await svc.createRow(userId, dbId, { title: "Fresh" });
    expect(row.values[P.done!]).toBe(true);
    const upd = await svc.updateRow(userId, row.id, { values: { [P.estimate!]: "42", [P.done!]: null } });
    expect(upd.values[P.estimate!]).toBe(42);
    expect(P.done! in upd.values).toBe(false);
    await expect(svc.updateRow(userId, row.id, { values: { [P.priority!]: "not-an-option" } })).rejects.toThrow(/unknown option/);
    await svc.setRowsArchived(userId, dbId, [row.id], true);
    const archived = await svc.queryRows(userId, dbId, { today, archived: true });
    expect(archived.rows.map((x) => x.id)).toContain(row.id);
  });

  it("every template applies: properties, views, sample rows with valid values", async () => {
    const { TEMPLATES } = await import("@/lib/db-templates");
    const { createFromTemplate } = await import("@/server/databases/templates");
    const { validateValue } = await import("@/lib/db-properties");
    for (const t of TEMPLATES) {
      const d = await createFromTemplate(userId, t.key, today);
      const full = await svc.getDatabase(userId, d.id);
      expect(full.properties.filter((p) => p.isTitle)).toHaveLength(1);
      expect(full.properties).toHaveLength(t.properties.length + 1);
      expect(full.views.map((v) => v.name)).toEqual(t.views.map((v) => v.name));
      for (const v of full.views) if (v.type === "BOARD") expect(full.properties.some((p) => p.id === v.config.groupBy)).toBe(true);
      const rows = await svc.queryRows(userId, d.id, { today });
      expect(rows.total).toBe(t.rows.length);
      for (const r of rows.rows) for (const p of full.properties) if (r.values[p.id] !== undefined) expect(validateValue(p, r.values[p.id])).toEqual(r.values[p.id]);
      // Views with filters return a subset without errors.
      for (const v of full.views) await svc.queryRows(userId, d.id, { today, filter: v.config.filter ?? null, sorts: v.config.sorts });
    }
  });

  it("other users can't read or write", async () => {
    const other = await db.user.create({ data: { name: "Other", email: `other-${Date.now()}@example.test`, passwordHash: "x" } });
    try {
      await expect(svc.queryRows(other.id, dbId, { today })).rejects.toThrow(/access/);
      await expect(svc.createRow(other.id, dbId, {})).rejects.toThrow(/access/);
    } finally {
      await db.workspace.deleteMany({ where: { ownerId: other.id } });
      await db.user.delete({ where: { id: other.id } });
    }
  });
});
