/**
 * Integration tests for relations, rollups and formulas against the local
 * Postgres. Skipped when it isn't reachable.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

process.env.DATABASE_URL ??= "postgresql://portfolio:portfolio@localhost:55432/portfolio?schema=public";

async function reachable() {
  const c = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 1500 });
  try {
    await c.connect();
    const r = await c.query("select to_regclass('public.page_relations') as t");
    return Boolean(r.rows[0]?.t);
  } catch {
    return false;
  } finally {
    await c.end().catch(() => {});
  }
}
const up = await reachable();

describe.skipIf(!up)("relations, rollups, formulas (Postgres)", async () => {
  const { db } = await import("@/lib/db");
  const svc = await import("@/server/databases/service");
  const today = "2026-09-29";
  let userId = "";
  let projects = "";
  let tasks = "";
  const P: Record<string, string> = {};
  let done = "";
  let todo = "";

  const row = async (id: string) => (await db.page.findUniqueOrThrow({ where: { id } })).values as Record<string, unknown>;

  beforeAll(async () => {
    const user = await db.user.create({ data: { name: "Rel Test", email: `rel-${Date.now()}@example.test`, passwordHash: "x" } });
    userId = user.id;
    projects = (await svc.createDatabase(userId, { title: "Projects" })).id;
    tasks = (await svc.createDatabase(userId, { title: "Tasks" })).id;
    const status = await svc.addProperty(userId, tasks, { name: "Status", type: "STATUS" });
    P.status = status.id;
    done = status.config.options!.find((o) => o.group === "complete")!.id;
    todo = status.config.options!.find((o) => o.group === "todo")!.id;
    P.hours = (await svc.addProperty(userId, tasks, { name: "Hours", type: "NUMBER" })).id;
    P.taskDue = (await svc.addProperty(userId, tasks, { name: "Due", type: "DATE" })).id;
    const rel = await svc.addProperty(userId, projects, { name: "Tasks", type: "RELATION", relation: { databaseId: tasks, limit: "many", twoWay: true, pairedName: "Project" } });
    P.rel = rel.id;
    P.paired = rel.config.relation!.pairedId!;
    P.due = (await svc.addProperty(userId, projects, { name: "Due", type: "DATE" })).id;
  });

  it("two-way relation: both sides and the links table agree", async () => {
    const p = await svc.createRow(userId, projects, { title: "Website" });
    const t1 = await svc.createRow(userId, tasks, { title: "Design" });
    const t2 = await svc.createRow(userId, tasks, { title: "Build" });
    const w = await svc.updateRow(userId, p.id, { values: { [P.rel!]: [t1.id, t2.id] } });
    expect(w.values[P.rel!]).toEqual([t1.id, t2.id]);
    expect(w.touched.sort()).toEqual([t1.id, t2.id].sort());
    expect(w.related[t1.id]?.title).toBe("Design");
    expect((await row(t1.id))[P.paired!]).toEqual([p.id]);
    expect(await db.pageRelation.count({ where: { propertyId: P.rel!, fromPageId: p.id } })).toBe(2);

    // Unlink from the other side.
    await svc.updateRow(userId, t2.id, { values: { [P.paired!]: [] } });
    expect((await row(p.id))[P.rel!]).toEqual([t1.id]);
    expect(await db.pageRelation.count({ where: { propertyId: P.rel!, fromPageId: p.id } })).toBe(1);

    // Ids from another database are ignored.
    const other = await svc.createRow(userId, projects, { title: "Not a task" });
    await svc.updateRow(userId, p.id, { values: { [P.rel!]: [t1.id, other.id] } });
    expect((await row(p.id))[P.rel!]).toEqual([t1.id]);
  });

  it("rollups follow both relation and value changes; formulas follow rollups", async () => {
    const progress = await svc.addProperty(userId, projects, { name: "Progress", type: "ROLLUP", config: { rollup: { relationId: P.rel, targetId: P.status, fn: "percent_complete" } } });
    expect(progress.config.resultType).toBe("number");
    expect(progress.config.numberFormat).toBe("percent");
    const hours = await svc.addProperty(userId, projects, { name: "Total hours", type: "ROLLUP", config: { rollup: { relationId: P.rel, targetId: P.hours, fn: "sum" } } });
    const label = await svc.addProperty(userId, projects, { name: "Label", type: "FORMULA", config: { formula: { expression: 'if(prop("Progress") >= 0.5, "On track", "Behind") + " · " + format(prop("Total hours")) + "h"' } } });
    expect(label.config.resultType).toBe("text");

    const p = await svc.createRow(userId, projects, { title: "App" });
    const a = await svc.createRow(userId, tasks, { title: "A", values: { [P.status!]: todo, [P.hours!]: 3 } });
    const b = await svc.createRow(userId, tasks, { title: "B", values: { [P.status!]: todo, [P.hours!]: 5 } });
    // Link from the task side: the project's rollups recalculate.
    await svc.updateRow(userId, a.id, { values: { [P.paired!]: [p.id] } });
    await svc.updateRow(userId, b.id, { values: { [P.paired!]: [p.id] } });
    let v = await row(p.id);
    expect(v[progress.id]).toBe(0);
    expect(v[hours.id]).toBe(8);
    expect(v[label.id]).toBe("Behind · 8h");

    // A value change on a task reaches the project and its formula.
    const w = await svc.updateRow(userId, a.id, { values: { [P.status!]: done, [P.hours!]: 4 } });
    expect(w.touched).toContain(p.id);
    v = await row(p.id);
    expect(v[progress.id]).toBe(0.5);
    expect(v[hours.id]).toBe(9);
    expect(v[label.id]).toBe("On track · 9h");

    // Archive leaves the row out; delete unlinks it.
    await svc.setRowsArchived(userId, tasks, [b.id], true);
    v = await row(p.id);
    expect(v[progress.id]).toBe(1);
    expect(v[P.rel!]).toEqual([a.id, b.id]);
    await svc.setRowsArchived(userId, tasks, [b.id], false);
    await svc.deleteRows(userId, tasks, [b.id]);
    v = await row(p.id);
    expect(v[P.rel!]).toEqual([a.id]);
    expect(v[hours.id]).toBe(4);
  });

  it("filters and sorts on rollup and formula results", async () => {
    const defs = (await svc.getDatabase(userId, projects)).properties;
    const progress = defs.find((d) => d.name === "Progress")!;
    const label = defs.find((d) => d.name === "Label")!;
    const q = await svc.queryRows(userId, projects, {
      today,
      filter: { kind: "group", id: "g", op: "and", children: [{ kind: "rule", id: "r", propertyId: progress.id, operator: "gte", value: 0.5 }] },
      sorts: [{ propertyId: label.id, direction: "asc" }],
    });
    expect(q.rows.map((r) => r.title)).toEqual(["App"]);
    const text = await svc.queryRows(userId, projects, { today, filter: { kind: "group", id: "g", op: "and", children: [{ kind: "rule", id: "r", propertyId: label.id, operator: "contains", value: "track" }] } });
    expect(text.rows.map((r) => r.title)).toEqual(["App"]);
    const rel = await svc.queryRows(userId, projects, { today, filter: { kind: "group", id: "g", op: "and", children: [{ kind: "rule", id: "r", propertyId: P.rel!, operator: "is_not_empty" }] } });
    expect(rel.rows.map((r) => r.title).sort()).toEqual(["App", "Website"]);
    expect(Object.keys(rel.related).length).toBeGreaterThan(0);
  });

  it("formula errors: syntax and types are rejected, cycles too, runtime errors are stored", async () => {
    await expect(svc.addProperty(userId, projects, { name: "Bad", type: "FORMULA", config: { formula: { expression: "1 +" } } })).rejects.toThrow();
    await expect(svc.addProperty(userId, projects, { name: "Bad", type: "FORMULA", config: { formula: { expression: 'prop("Due") * 2' } } })).rejects.toThrow(/dateBetween/);
    const f1 = await svc.addProperty(userId, projects, { name: "F1", type: "FORMULA", config: { formula: { expression: "1" } } });
    const f2 = await svc.addProperty(userId, projects, { name: "F2", type: "FORMULA", config: { formula: { expression: 'prop("F1") + 1' } } });
    await expect(svc.updateProperty(userId, f1.id, { config: { formula: { expression: 'prop("F2") + 1' } } })).rejects.toThrow(/Circular reference: F1 → F2 → F1/);
    const div = await svc.addProperty(userId, projects, { name: "Div", type: "FORMULA", config: { formula: { expression: '10 / (prop("F2") - 2)' } } });
    const p = await svc.createRow(userId, projects, { title: "Z" });
    expect((await row(p.id))[f2.id]).toBe(2);
    expect((await row(p.id))[div.id]).toEqual({ error: "Division by zero." });
    // Errors never match filters.
    const q = await svc.queryRows(userId, projects, { today, filter: { kind: "group", id: "g", op: "and", children: [{ kind: "rule", id: "r", propertyId: div.id, operator: "is_not_empty" }] } });
    expect(q.rows.find((r) => r.id === p.id)).toBeUndefined();
    // Renaming a property rewrites formulas that use it.
    await svc.updateProperty(userId, f1.id, { name: "Base" });
    const f2after = (await svc.getDatabase(userId, projects)).properties.find((d) => d.id === f2.id)!;
    expect(f2after.config.formula?.expression).toBe('prop("Base") + 1');
    expect((await row(p.id))[f2.id]).toBe(2);
    // Deleting it: dependants show an error.
    await svc.deleteProperty(userId, f1.id);
    expect((await row(p.id))[f2.id]).toEqual({ error: "No property called “Base”." });
    for (const id of [f2.id, div.id]) await svc.deleteProperty(userId, id);
  });

  it("volatile formulas refresh once a day", async () => {
    const left = await svc.addProperty(userId, projects, { name: "Days left", type: "FORMULA", config: { formula: { expression: 'dateBetween(prop("Due"), today(), "days")' } } });
    const p = await svc.createRow(userId, projects, { title: "Dated", values: { [P.due!]: { start: "2026-10-09" } } });
    await db.database.update({ where: { id: projects }, data: { computedOn: new Date("2026-09-29T00:00:00Z") } });
    await svc.updateRow(userId, p.id, { values: { [P.due!]: { start: "2026-10-09" } } });
    expect((await row(p.id))[left.id]).toBe(10);
    await svc.queryRows(userId, projects, { today: "2026-10-01" });
    expect((await row(p.id))[left.id]).toBe(8);
    const d = await db.database.findUniqueOrThrow({ where: { id: projects } });
    expect(d.computedOn?.toISOString().slice(0, 10)).toBe("2026-10-01");
    await svc.deleteProperty(userId, left.id);
  });

  it("limit one, turning two-way off and on, deleting the relation", async () => {
    const owners = (await svc.createDatabase(userId, { title: "Owners" })).id;
    const rel = await svc.addProperty(userId, tasks, { name: "Owner", type: "RELATION", relation: { databaseId: owners, limit: "one", twoWay: true, pairedName: "Owns" } });
    const pairedId = rel.config.relation!.pairedId!;
    const o1 = await svc.createRow(userId, owners, { title: "Ana" });
    const o2 = await svc.createRow(userId, owners, { title: "Bo" });
    const t = await svc.createRow(userId, tasks, { title: "T", values: { [rel.id]: [o1.id, o2.id] } });
    expect((await row(t.id))[rel.id]).toEqual([o1.id]);
    // From the "many" side, linking a task already owned by Ana moves it to Bo.
    await svc.updateRow(userId, o2.id, { values: { [pairedId]: [t.id] } });
    expect((await row(t.id))[rel.id]).toEqual([o2.id]);
    expect((await row(o1.id))[pairedId]).toBeUndefined();

    // Two-way off: the paired property goes, links stay; back on: refilled.
    await svc.updateProperty(userId, rel.id, { twoWay: false });
    expect(await db.databaseProperty.findUnique({ where: { id: pairedId } })).toBeNull();
    expect((await row(t.id))[rel.id]).toEqual([o2.id]);
    const on = await svc.updateProperty(userId, rel.id, { twoWay: true, pairedName: "Tasks" });
    const newPaired = on.config.relation!.pairedId!;
    expect((await row(o2.id))[newPaired]).toEqual([t.id]);

    await svc.deleteProperty(userId, rel.id);
    expect(await db.databaseProperty.findUnique({ where: { id: newPaired } })).toBeNull();
    expect((await row(t.id))[rel.id]).toBeUndefined();
    expect(await db.pageRelation.count({ where: { propertyId: rel.id } })).toBe(0);
  });

  it("self-relations and duplicating a database", async () => {
    const docs = (await svc.createDatabase(userId, { title: "Docs" })).id;
    const see = await svc.addProperty(userId, docs, { name: "See also", type: "RELATION", relation: { databaseId: docs, limit: "many", twoWay: true, pairedName: "Referenced by" } });
    const back = see.config.relation!.pairedId!;
    const count = await svc.addProperty(userId, docs, { name: "Refs", type: "ROLLUP", config: { rollup: { relationId: back, targetId: see.id, fn: "count_all" } } });
    const a = await svc.createRow(userId, docs, { title: "A" });
    const b = await svc.createRow(userId, docs, { title: "B" });
    await svc.updateRow(userId, a.id, { values: { [see.id]: [b.id] } });
    expect((await row(b.id))[back]).toEqual([a.id]);
    expect((await row(b.id))[count.id]).toBe(1);

    const copy = await svc.duplicateDatabase(userId, docs, true);
    const cdefs = (await svc.getDatabase(userId, copy.id)).properties;
    const csee = cdefs.find((d) => d.name === "See also")!;
    expect(csee.config.relation?.databaseId).toBe(copy.id);
    const crows = await db.page.findMany({ where: { databaseId: copy.id } });
    const ca = crows.find((r) => r.title === "A")!;
    const cb = crows.find((r) => r.title === "B")!;
    expect((ca.values as Record<string, unknown>)[csee.id]).toEqual([cb.id]);
    expect((cb.values as Record<string, unknown>)[cdefs.find((d) => d.name === "Refs")!.id]).toBe(1);

    // Deleting the target database drops relations into it.
    const tagDb = (await svc.createDatabase(userId, { title: "Tags" })).id;
    const tagRel = await svc.addProperty(userId, docs, { name: "Tags", type: "RELATION", relation: { databaseId: tagDb, limit: "many", twoWay: false } });
    await svc.deleteDatabase(userId, tagDb);
    expect(await db.databaseProperty.findUnique({ where: { id: tagRel.id } })).toBeNull();
  });

  it("template packs: linked databases, sample links, rollups and formulas calculated", async () => {
    const { PACKS, TEMPLATES } = await import("@/lib/db-templates");
    const { createFromTemplate } = await import("@/server/databases/templates");
    const { workspaceId } = await svc.getWorkspace(userId);
    const byName = async (databaseId: string) => {
      const d = await svc.getDatabase(userId, databaseId);
      const rows = await db.page.findMany({ where: { databaseId } });
      const prop = (n: string) => d.properties.find((p) => p.name === n)!;
      const val = (title: string, n: string) => (rows.find((r) => r.title === title)!.values as Record<string, unknown>)[prop(n).id];
      return { d, rows, prop, val };
    };
    for (const pack of PACKS) {
      const first = await createFromTemplate(userId, pack.key, today);
      const dbs = await db.database.findMany({ where: { workspaceId, templateKey: pack.key }, orderBy: { createdAt: "desc" }, take: pack.databases.length });
      expect(dbs.length).toBe(pack.databases.length);
      expect(dbs.map((d) => d.id)).toContain(first.id);
      for (const d of dbs) {
        const { d: info, rows } = await byName(d.id);
        const t = pack.databases.find((x) => x.name === d.title)!;
        expect(info.views.length).toBe(t.views.length);
        expect(rows.length).toBe(t.rows.length);
        // No result is an error.
        for (const r of rows) for (const p of info.properties.filter((x) => x.type === "FORMULA" || x.type === "ROLLUP")) expect(JSON.stringify((r.values as Record<string, unknown>)[p.id] ?? null), `${d.title}/${r.title}/${p.name}`).not.toContain('"error"');
      }
    }
    const find = async (title: string, key: string) => (await db.database.findFirstOrThrow({ where: { workspaceId, title, templateKey: key }, orderBy: { createdAt: "desc" } })).id;
    const projects = await byName(await find("Projects", "projects-tasks"));
    expect(projects.val("Website relaunch", "Progress")).toBeCloseTo(1 / 3, 4);
    expect(projects.val("Website relaunch", "Open tasks")).toBe(2);
    expect(projects.val("Q3 report", "Progress")).toBe(1);
    expect(projects.val("Website relaunch", "Days left")).toBe(21);
    const tasksDb = await byName(await find("Tasks", "projects-tasks"));
    expect(tasksDb.val("Write copy", "Project")).toEqual([projects.rows.find((r) => r.title === "Website relaunch")!.id]);
    const companies = await byName(await find("Companies", "sales-pipeline"));
    expect(companies.val("Northwind", "Pipeline total")).toBe(30000);
    expect(companies.val("Northwind", "Weighted total")).toBe(20400);
    expect(companies.prop("Pipeline total").config.numberFormat).toBe("usd");
    const customers = await byName(await find("Customers", "customer-management"));
    expect(customers.val("Ada Lovelace", "Lifetime value")).toBe(500);
    expect(customers.val("Ada Lovelace", "Days since last order")).toBe(12);
    const products = await byName(await find("Products", "inventory"));
    expect(products.val("Laptop stand", "Reorder?")).toBe(true);
    expect(products.val("USB-C cable", "Reorder?")).toBe(false);
    const suppliers = await byName(await find("Suppliers", "inventory"));
    expect(suppliers.val("DeskWorks", "Stock value")).toBe(8 * 34 + 22 * 79);

    for (const key of ["document-hub", "engineering-docs", "knowledge-base", "brainstorm"]) {
      const d = await createFromTemplate(userId, key, today);
      const t = TEMPLATES.find((x) => x.key === key)!;
      const { rows, d: info } = await byName(d.id);
      expect(rows.length).toBe(t.rows.length);
      expect(info.views.length).toBe(t.views.length);
    }
    const eng = await byName((await db.database.findFirstOrThrow({ where: { workspaceId, templateKey: "engineering-docs" }, orderBy: { createdAt: "desc" } })).id);
    expect(eng.val("Spec: Relations and rollups", "Dependencies")).toBe(2);
    expect((eng.val("RFC: Workspace databases", "Needed by") as string[]).length).toBe(2);
    const ideas = await byName((await db.database.findFirstOrThrow({ where: { workspaceId, templateKey: "brainstorm" }, orderBy: { createdAt: "desc" } })).id);
    expect(ideas.val("Weekly demo day", "Score")).toBe(3.5);
    // Relations keep their place in the property order.
    expect(projects.d.properties.map((p) => p.name).slice(0, 4)).toEqual(["Project", "Status", "Due", "Tasks"]);
  });

  it("recalculating 1,000 linked rows is quick", async () => {
    const { workspaceId } = await svc.getWorkspace(userId);
    const big = await svc.createRow(userId, projects, { title: "Big" });
    await db.page.createMany({
      data: Array.from({ length: 1000 }, (_, i) => ({ id: `bulk-${Date.now()}-${i}`, workspaceId, databaseId: tasks, title: `T${i}`, position: `b${String(i).padStart(5, "0")}`, values: { [P.hours!]: 1, [P.status!]: i % 2 ? done : todo }, createdById: userId, lastEditedById: userId })),
    });
    const ids = (await db.page.findMany({ where: { databaseId: tasks, title: { startsWith: "T" }, NOT: { title: "T" } }, select: { id: true } })).map((r) => r.id).slice(0, 500);
    let t = performance.now();
    await svc.updateRow(userId, big.id, { values: { [P.rel!]: ids } });
    const linkMs = performance.now() - t;
    const defs = (await svc.getDatabase(userId, projects)).properties;
    const hours = defs.find((d) => d.name === "Total hours")!;
    expect((await row(big.id))[hours.id]).toBe(500);
    t = performance.now();
    await svc.updateRow(userId, ids[0]!, { values: { [P.hours!]: 3 } });
    const valueMs = performance.now() - t;
    expect((await row(big.id))[hours.id]).toBe(502);
    // Recalculating the whole tasks database (1,000+ rows) after a config change.
    t = performance.now();
    const { recomputeDatabase } = await import("@/server/databases/compute");
    await recomputeDatabase(db, projects);
    const allMs = performance.now() - t;
    console.log(`link 500: ${linkMs.toFixed(0)}ms, value change: ${valueMs.toFixed(0)}ms, recompute: ${allMs.toFixed(0)}ms`);
    expect(valueMs).toBeLessThan(300);
  });
});
