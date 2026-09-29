import "server-only";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import type { PropertyConfig, PropertyDef, PropertyType, PropertyValue } from "@/lib/db-properties";
import { ROLLUP_FNS, computeRollup, rollupFnsFor, type RollupFn } from "@/lib/db-rollup";
import { evaluate } from "@/lib/formula/engine";
import { FormulaError } from "@/lib/formula/tokenize";
import { formulaInput, planFormulas, storeResult, toResultType } from "@/lib/formula/plan";

export { planFormulas, toResultType };

/**
 * Rollups and formulas: results are calculated on the server and cached in
 * pages.values, so views filter and sort them in SQL like any other value.
 * Every write that can change a result calls afterChange(), which
 * recalculates the written pages and then follows relations to the pages
 * whose rollups read what changed (bounded depth).
 */

export type Client = Prisma.TransactionClient | typeof db;

type PageRow = { id: string; title: string; values: Record<string, PropertyValue>; createdAt: Date; updatedAt: Date };
const PAGE_SELECT = { id: true, title: true, values: true, createdAt: true, updatedAt: true } as const;

const MAX_CASCADE_DEPTH = 4;
const WRITE_CHUNK = 1000;

function toDef(p: { id: string; name: string; type: string; config: Prisma.JsonValue; isTitle: boolean }): PropertyDef {
  return { id: p.id, name: p.name, type: p.type as PropertyType, config: (p.config ?? {}) as PropertyConfig, isTitle: p.isTitle };
}

export async function defsOf(c: Client, databaseId: string): Promise<PropertyDef[]> {
  const rows = await c.databaseProperty.findMany({ where: { databaseId }, select: { id: true, name: true, type: true, config: true, isTitle: true, position: true } });
  return rows.sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0)).map(toDef);
}

// ── Recalculate pages ─────────────────────────────────────────────────────

interface Patch {
  id: string;
  set: Record<string, PropertyValue>;
  del: string[];
}

/** Write value changes in one statement per chunk (updated_at is left alone: a recalculation isn't an edit). */
async function writePatches(c: Client, patches: Patch[]) {
  for (let i = 0; i < patches.length; i += WRITE_CHUNK) {
    const chunk = patches.slice(i, i + WRITE_CHUNK);
    await c.$executeRaw`
      UPDATE "pages" AS p SET "values" = (COALESCE(p."values", '{}'::jsonb) || u."set") - u."del"
      FROM jsonb_to_recordset(${JSON.stringify(chunk)}::jsonb) AS u("id" text, "set" jsonb, "del" text[])
      WHERE p."id" = u."id"`;
  }
}

/** Set / clear values on pages (relation mirrors and results), skipping no-op writes. */
export async function patchValues(c: Client, patches: Patch[]) {
  const real = patches.filter((p) => Object.keys(p.set).length || p.del.length);
  if (real.length) await writePatches(c, real);
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const utcToday = () => new Date().toISOString().slice(0, 10);

/**
 * Recalculate every rollup and formula on some pages of a database ("all" for
 * every row). Returns, per page, the result properties whose value changed.
 */
export async function recomputePages(c: Client, databaseId: string, pageIds: string[] | "all"): Promise<Map<string, Set<string>>> {
  const changed = new Map<string, Set<string>>();
  const defs = await defsOf(c, databaseId);
  const rollups = defs.filter((d) => d.type === "ROLLUP");
  const formulas = defs.filter((d) => d.type === "FORMULA");
  if (!rollups.length && !formulas.length) return changed;
  if (pageIds !== "all" && !pageIds.length) return changed;

  const database = await c.database.findUnique({ where: { id: databaseId }, select: { computedOn: true } });
  const today = database?.computedOn ? database.computedOn.toISOString().slice(0, 10) : utcToday();
  const time = new Date().toISOString().slice(11, 16);
  const pages = (await c.page.findMany({ where: { databaseId, ...(pageIds === "all" ? {} : { id: { in: pageIds } }) }, select: PAGE_SELECT })) as unknown as PageRow[];
  if (!pages.length) return changed;

  // Related pages each rollup reads, loaded once per target database.
  const targetDefs = new Map<string, PropertyDef[]>();
  const targetPages = new Map<string, PageRow>();
  const relationOf = (r: PropertyDef) => defs.find((d) => d.id === r.config.rollup?.relationId && d.type === "RELATION");
  const wanted = new Map<string, Set<string>>();
  for (const r of rollups) {
    const rel = relationOf(r);
    const target = rel?.config.relation?.databaseId;
    if (!rel || !target) continue;
    const set = wanted.get(target) ?? new Set<string>();
    for (const p of pages) for (const id of (p.values[rel.id] as string[] | undefined) ?? []) set.add(id);
    wanted.set(target, set);
  }
  // Formulas that read a relation get the related pages' titles.
  const plan = planFormulas(defs);
  const relationRefs = defs.filter((d) => d.type === "RELATION" && formulas.some((f) => plan.compiled.get(f.id)?.refs.includes(d.name)));
  const titleIds = new Set<string>();
  for (const rel of relationRefs) for (const p of pages) for (const id of (p.values[rel.id] as string[] | undefined) ?? []) titleIds.add(id);
  for (const [target, set] of wanted) {
    targetDefs.set(target, await defsOf(c, target));
    const ids = [...set];
    for (let i = 0; i < ids.length; i += 5000) {
      const rows = (await c.page.findMany({ where: { id: { in: ids.slice(i, i + 5000) }, databaseId: target, archivedAt: null }, select: PAGE_SELECT })) as unknown as PageRow[];
      for (const row of rows) targetPages.set(row.id, row);
    }
  }
  const titles = new Map<string, string>([...targetPages.values()].map((p) => [p.id, p.title]));
  const missing = [...titleIds].filter((id) => !titles.has(id));
  if (missing.length) for (const p of await c.page.findMany({ where: { id: { in: missing } }, select: { id: true, title: true } })) titles.set(p.id, p.title);

  const patches: Patch[] = [];
  for (const page of pages) {
    const next: Record<string, PropertyValue> = {};
    for (const r of rollups) next[r.id] = rollupValue(r, page, relationOf(r), targetDefs, targetPages);
    const fresh = (d: PropertyDef): PropertyValue | undefined => (d.id in next ? next[d.id] : page.values[d.id]);
    for (const f of formulas) {
      const cycle = plan.cyclic.get(f.id);
      if (cycle) next[f.id] = { error: `Circular reference: ${cycle}` };
    }
    for (const f of plan.order) {
      const compiled = plan.compiled.get(f.id)!;
      if (!compiled.ast || !f.config.formula?.expression.trim()) {
        next[f.id] = compiled.issues.length && f.config.formula?.expression.trim() ? { error: compiled.issues[0]!.message } : null;
        continue;
      }
      if (compiled.issues.length) {
        next[f.id] = { error: compiled.issues[0]!.message };
        continue;
      }
      try {
        const v = evaluate(compiled.ast, {
          today,
          time,
          getProp: (name) => {
            const d = plan.byName.get(name);
            return d ? formulaInput(d, page, fresh(d), titles) : null;
          },
        });
        next[f.id] = storeResult(v, toResultType(compiled.type));
      } catch (err) {
        if (!(err instanceof FormulaError)) throw err;
        next[f.id] = { error: err.message };
      }
    }
    const patch: Patch = { id: page.id, set: {}, del: [] };
    for (const [k, v] of Object.entries(next)) {
      if (same(page.values[k], v)) continue;
      if (v === null) patch.del.push(k);
      else patch.set[k] = v;
      const s = changed.get(page.id) ?? new Set<string>();
      s.add(k);
      changed.set(page.id, s);
    }
    patches.push(patch);
  }
  await patchValues(c, patches);
  return changed;
}

function rollupValue(r: PropertyDef, page: PageRow, rel: PropertyDef | undefined, targetDefs: Map<string, PropertyDef[]>, targetPages: Map<string, PageRow>): PropertyValue {
  const cfg = r.config.rollup;
  if (!cfg) return null;
  if (!rel?.config.relation) return { error: "The relation this rollup uses was deleted." };
  const tdefs = targetDefs.get(rel.config.relation.databaseId) ?? [];
  const tdef = tdefs.find((d) => d.id === cfg.targetId);
  if (!tdef) return { error: "The property this rollup reads was deleted." };
  const fn = cfg.fn as RollupFn;
  if (!(ROLLUP_FNS as readonly string[]).includes(fn) || !rollupFnsFor(tdef).includes(fn)) return { error: `This calculation doesn't work with “${tdef.name}”.` };
  const vals: PropertyValue[] = [];
  for (const id of (page.values[rel.id] as string[] | undefined) ?? []) {
    const t = targetPages.get(id);
    if (!t) continue; // archived or gone
    if (tdef.isTitle || tdef.type === "TITLE") vals.push(t.title || null);
    else if (tdef.type === "CREATED_TIME") vals.push(t.createdAt.toISOString());
    else if (tdef.type === "LAST_EDITED_TIME") vals.push(t.updatedAt.toISOString());
    else vals.push(t.values[tdef.id] ?? null);
  }
  return computeRollup(fn, tdef, vals);
}

// ── Cascade ───────────────────────────────────────────────────────────────

/**
 * After pages of a database changed (`props`: what changed, "all" when
 * unknown): recalculate them, then every page elsewhere whose rollups read
 * one of the changed properties through a relation. Returns every page id
 * whose values changed (the written pages aren't included).
 */
export async function afterChange(c: Client, databaseId: string, pageIds: string[] | "all", props: Set<string> | "all", depth = 0): Promise<Set<string>> {
  const touched = new Set<string>();
  if (depth > MAX_CASCADE_DEPTH) return touched;
  const results = await recomputePages(c, databaseId, pageIds);
  for (const id of results.keys()) touched.add(id);
  const changedProps = props === "all" ? "all" : new Set([...props, ...[...results.values()].flatMap((s) => [...s])]);
  if (changedProps !== "all" && !changedProps.size) return touched;

  // Rollups (anywhere in the workspace) reading this database through a relation.
  const database = await c.database.findUnique({ where: { id: databaseId }, select: { workspaceId: true } });
  if (!database) return touched;
  const candidates = await c.databaseProperty.findMany({
    where: { type: { in: ["ROLLUP", "RELATION"] }, database: { workspaceId: database.workspaceId } },
    select: { id: true, name: true, type: true, config: true, isTitle: true, databaseId: true },
  });
  const relations = new Map(candidates.filter((p) => p.type === "RELATION").map((p) => [p.id, { ...toDef(p), databaseId: p.databaseId }]));
  const byDatabase = new Map<string, Set<string>>();
  for (const r of candidates) {
    if (r.type !== "ROLLUP") continue;
    const cfg = (r.config as PropertyConfig | null)?.rollup;
    const rel = cfg ? relations.get(cfg.relationId) : undefined;
    if (!cfg || !rel || rel.databaseId !== r.databaseId || rel.config.relation?.databaseId !== databaseId) continue;
    if (changedProps !== "all" && !changedProps.has(cfg.targetId)) continue;
    const set = byDatabase.get(r.databaseId) ?? new Set<string>();
    set.add(rel.id);
    byDatabase.set(r.databaseId, set);
  }
  if (!byDatabase.size) return touched;

  const sources = pageIds === "all" ? "all" : [...new Set([...pageIds, ...results.keys()])];
  for (const [otherDb, relIds] of byDatabase) {
    const hits = new Set<string>();
    for (const relId of relIds) {
      const rows =
        sources === "all"
          ? await c.$queryRaw<{ id: string }[]>`SELECT "id" FROM "pages" WHERE "database_id" = ${otherDb} AND jsonb_typeof("values" -> ${relId}::text) = 'array'`
          : await c.$queryRaw<{ id: string }[]>`SELECT "id" FROM "pages" WHERE "database_id" = ${otherDb} AND ("values" -> ${relId}::text) ?| ${sources}::text[]`;
      for (const r of rows) hits.add(r.id);
    }
    if (!hits.size) continue;
    for (const id of hits) touched.add(id);
    const more = await afterChange(c, otherDb, [...hits], new Set(), depth + 1);
    for (const id of more) touched.add(id);
  }
  return touched;
}

/** Recalculate a whole database (a result property was added or edited) and everything reading it. */
export async function recomputeDatabase(c: Client, databaseId: string) {
  await syncResultTypes(c, databaseId);
  return afterChange(c, databaseId, "all", "all");
}

/**
 * Formula result types depend on the properties they read (which can be other
 * formulas or rollups): keep config.resultType up to date.
 */
export async function syncResultTypes(c: Client, databaseId: string) {
  const defs = await defsOf(c, databaseId);
  const plan = planFormulas(defs);
  for (const f of defs.filter((d) => d.type === "FORMULA")) {
    const compiled = plan.compiled.get(f.id);
    const type = compiled && !compiled.issues.length ? toResultType(compiled.type) : "text";
    if (f.config.resultType !== type) await c.databaseProperty.update({ where: { id: f.id }, data: { config: { ...f.config, resultType: type } as unknown as Prisma.InputJsonValue } });
  }
}

/** Formulas using now() / today() are recalculated once a day (the first time the database is read that day). */
export async function refreshIfStale(databaseId: string, today: string) {
  const database = await db.database.findUnique({ where: { id: databaseId }, select: { computedOn: true } });
  if (!database || (database.computedOn && database.computedOn.toISOString().slice(0, 10) >= today)) return false;
  const defs = await defsOf(db, databaseId);
  const plan = planFormulas(defs);
  const volatile = [...plan.compiled.values()].some((c) => c.volatile);
  // Claim the day first, so concurrent reads don't all recalculate.
  const claimed = await db.database.updateMany({ where: { id: databaseId, OR: [{ computedOn: null }, { computedOn: { lt: new Date(`${today}T00:00:00Z`) } }] }, data: { computedOn: new Date(`${today}T00:00:00Z`) } });
  if (!claimed.count || !volatile) return false;
  const ids = new Set(defs.filter((d) => d.type === "FORMULA" && plan.compiled.get(d.id)?.volatile).map((d) => d.id));
  await afterChange(db, databaseId, "all", ids);
  return true;
}
