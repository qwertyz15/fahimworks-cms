import "server-only";
import { generateKeyBetween } from "fractional-indexing";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import type { PropertyType as DbPropertyType, ViewType as DbViewType, WorkspaceRole } from "@/generated/prisma/enums";
import {
  COMPUTED_TYPES,
  LIMITS,
  PropertyValueError,
  convertValue,
  defaultConfig,
  isResultProp,
  optionsFromTexts,
  validateConfig,
  validateValue,
  valueText,
  type PropertyConfig,
  type PropertyDef,
  type PropertyType,
  type PropertyValue,
} from "@/lib/db-properties";
import { filterWithinLimits, type DateWindow, type FilterGroup, type SortRule, type ViewConfig, type ViewType } from "@/lib/db-views";
import { deriveFields, mediaSources, renderNotebookHtml } from "@/server/services/notebook-html";
import { storagePublicOrigin } from "@/lib/storage";
import { compileFilter, compileSearch, compileSorts, compileUndated, compileWindow, type CompileContext } from "./query";
import { ROLLUP_FNS, rollupFnsFor, rollupResult, type RollupFn } from "@/lib/db-rollup";
import { renameProp } from "@/lib/formula/engine";
import { afterChange, patchValues, planFormulas, recomputeDatabase, refreshIfStale, toResultType } from "./compute";
import { RelationError, createRelationProperty, deleteRelationProperty, detachPages, dropRelationsInto, relatedPages, setRelation, setTwoWay, type RelatedPage } from "./relations";

/**
 * Workspace databases: every database row is a Page (Page.databaseId), with
 * its property values in Page.values (JSONB, keyed by property id). All
 * access goes through requireDatabase / requirePage (workspace membership).
 */

export class DatabaseError extends Error {}

/** Relation / formula problems surface as DatabaseError (shown to the user). */
async function friendly<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof RelationError) throw new DatabaseError(err.message);
    throw err;
  }
}

/** Long enough for recalculating a few thousand rows. */
const TX = { timeout: 30_000, maxWait: 10_000 } as const;

const ROLE_RANK: Record<WorkspaceRole, number> = { VIEWER: 0, EDITOR: 1, OWNER: 2 };

// ── Workspace + access ─────────────────────────────────────────────────────

/** The user's workspace (created on first use). */
export async function getWorkspace(userId: string) {
  const member = await db.workspaceMember.findFirst({ where: { userId }, orderBy: { createdAt: "asc" }, select: { workspaceId: true, role: true } });
  if (member) return member;
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });
  const ws = await db.workspace.create({
    data: { name: `${user.name.split(" ")[0] || "My"}'s workspace`, ownerId: userId, members: { create: { userId, role: "OWNER" } } },
  });
  return { workspaceId: ws.id, role: "OWNER" as WorkspaceRole };
}

async function roleIn(userId: string, workspaceId: string): Promise<WorkspaceRole | null> {
  const m = await db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } }, select: { role: true } });
  return m?.role ?? null;
}

function assertRole(role: WorkspaceRole | null, min: WorkspaceRole) {
  if (!role || ROLE_RANK[role] < ROLE_RANK[min]) throw new DatabaseError("You don't have access to this database.");
}

export async function requireDatabase(userId: string, databaseId: string, min: WorkspaceRole = "EDITOR") {
  const database = await db.database.findUnique({ where: { id: databaseId } });
  if (!database) throw new DatabaseError("Database not found.");
  assertRole(await roleIn(userId, database.workspaceId), min);
  return database;
}

export async function requirePage(userId: string, pageId: string, min: WorkspaceRole = "EDITOR") {
  const page = await db.page.findUnique({ where: { id: pageId } });
  if (!page) throw new DatabaseError("Page not found.");
  assertRole(await roleIn(userId, page.workspaceId), min);
  return page;
}

// ── Helpers ────────────────────────────────────────────────────────────────

type PropRow = { id: string; name: string; type: DbPropertyType; config: Prisma.JsonValue; isTitle: boolean; position: string };

export function toDef(p: PropRow): PropertyDef {
  return { id: p.id, name: p.name, type: p.type as PropertyType, config: (p.config ?? {}) as PropertyConfig, isTitle: p.isTitle };
}

async function propertiesOf(databaseId: string): Promise<PropertyDef[]> {
  const rows = await db.databaseProperty.findMany({ where: { databaseId }, orderBy: { position: "asc" } });
  return sortByPosition(rows).map(toDef);
}

/** Byte-wise order for fractional keys (the DB's collation may differ). */
export function sortByPosition<T extends { position: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));
}

async function lastPosition(model: "property" | "view" | "page", where: { databaseId: string }): Promise<string | null> {
  const rows =
    model === "property"
      ? await db.databaseProperty.findMany({ where, select: { position: true } })
      : model === "view"
        ? await db.databaseView.findMany({ where, select: { position: true } })
        : await db.page.findMany({ where, select: { position: true } });
  return sortByPosition(rows).at(-1)?.position ?? null;
}

/** Title + property values + page text, for the search box. */
export function buildSearchText(title: string, values: Record<string, PropertyValue>, defs: PropertyDef[], contentText?: string | null): string {
  const parts = [title];
  // Results change without an edit, so they're not indexed.
  for (const d of defs) if (values[d.id] !== undefined && !isResultProp(d)) parts.push(valueText(d, values[d.id]!));
  if (contentText) parts.push(contentText);
  return parts.filter(Boolean).join(" • ").slice(0, 20_000);
}

function cleanValues(defs: PropertyDef[], raw: Record<string, unknown>): Record<string, PropertyValue> {
  const out: Record<string, PropertyValue> = {};
  for (const [id, v] of Object.entries(raw)) {
    const def = defs.find((d) => d.id === id);
    if (!def || def.isTitle || COMPUTED_TYPES.includes(def.type) || def.type === "RELATION") continue;
    try {
      const clean = validateValue(def, v);
      if (clean !== null) out[id] = clean;
    } catch (err) {
      if (err instanceof PropertyValueError) throw new DatabaseError(err.message);
      throw err;
    }
  }
  return out;
}

function defaultsFor(defs: PropertyDef[]): Record<string, PropertyValue> {
  const out: Record<string, PropertyValue> = {};
  for (const d of defs) if (d.config.default !== undefined && d.config.default !== null && !isResultProp(d) && d.type !== "RELATION") out[d.id] = d.config.default;
  return out;
}

// ── Databases ──────────────────────────────────────────────────────────────

export async function listDatabases(userId: string, opts: { archived?: boolean } = {}) {
  const { workspaceId } = await getWorkspace(userId);
  const rows = await db.database.findMany({
    where: { workspaceId, archivedAt: opts.archived ? { not: null } : null },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, description: true, icon: true, coverImage: true, templateKey: true, archivedAt: true, updatedAt: true, _count: { select: { pages: { where: { archivedAt: null } } } } },
  });
  return rows.map((r) => ({ ...r, rowCount: r._count.pages }));
}

export interface NewProperty {
  key: string;
  name: string;
  type: PropertyType;
  config?: PropertyConfig;
}

/** Create a database with a Title property and a Table view (templates add more in the same transaction). */
export async function createDatabase(
  userId: string,
  input: { title?: string; description?: string | null; icon?: string | null; templateKey?: string | null },
  build?: (tx: Prisma.TransactionClient, ctx: { databaseId: string; workspaceId: string; titleId: string }) => Promise<void>,
) {
  const { workspaceId, role } = await getWorkspace(userId);
  assertRole(role, "EDITOR");
  return db.$transaction(async (tx) => {
    const database = await tx.database.create({
      data: {
        workspaceId,
        title: (input.title?.trim() || "Untitled database").slice(0, 200),
        description: input.description?.slice(0, 2000) || null,
        icon: input.icon?.slice(0, 16) || null,
        templateKey: input.templateKey ?? null,
        createdById: userId,
      },
    });
    const title = await tx.databaseProperty.create({ data: { databaseId: database.id, name: "Name", type: "TITLE", isTitle: true, position: generateKeyBetween(null, null) } });
    if (build) await build(tx, { databaseId: database.id, workspaceId, titleId: title.id });
    else await tx.databaseView.create({ data: { databaseId: database.id, name: "Table", type: "TABLE", position: generateKeyBetween(null, null), config: {} } });
    return database;
   }, TX);
}

export async function updateDatabase(userId: string, id: string, patch: { title?: string; description?: string | null; icon?: string | null; coverImage?: string | null }) {
  await requireDatabase(userId, id);
  return db.database.update({
    where: { id },
    data: {
      ...(patch.title !== undefined ? { title: patch.title.trim().slice(0, 200) || "Untitled database" } : {}),
      ...(patch.description !== undefined ? { description: patch.description?.slice(0, 2000) || null } : {}),
      ...(patch.icon !== undefined ? { icon: patch.icon?.slice(0, 16) || null } : {}),
      ...(patch.coverImage !== undefined ? { coverImage: patch.coverImage || null } : {}),
    },
  });
}

export async function setDatabaseArchived(userId: string, id: string, archived: boolean) {
  await requireDatabase(userId, id);
  return db.database.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
}

export async function deleteDatabase(userId: string, id: string) {
  const database = await requireDatabase(userId, id, "OWNER");
  await db.$transaction(async (tx) => {
    // Relations elsewhere that point here go with it (and the rollups over them recalculate).
    await dropRelationsInto(tx, id, database.workspaceId);
    await tx.database.delete({ where: { id } });
  }, TX);
}

/** Copy a database's properties and views (and optionally its rows). */
export async function duplicateDatabase(userId: string, id: string, withRows: boolean) {
  const src = await requireDatabase(userId, id);
  const [props, views, pages] = await Promise.all([
    db.databaseProperty.findMany({ where: { databaseId: id } }),
    db.databaseView.findMany({ where: { databaseId: id } }),
    withRows ? db.page.findMany({ where: { databaseId: id, archivedAt: null } }) : Promise.resolve([]),
  ]);
  return db.$transaction(async (tx) => {
    const copy = await tx.database.create({
      data: { workspaceId: src.workspaceId, title: `${src.title} (copy)`.slice(0, 200), description: src.description, icon: src.icon, coverImage: src.coverImage, templateKey: src.templateKey, createdById: userId },
    });
    const idMap = new Map<string, string>();
    for (const p of props) {
      const n = await tx.databaseProperty.create({ data: { databaseId: copy.id, name: p.name, type: p.type, config: p.config ?? {}, position: p.position, isTitle: p.isTitle } });
      idMap.set(p.id, n.id);
    }
    const remap = (s: string) => idMap.get(s) ?? s;
    // Relations: a self-relation points at the copy (pair kept); one to another database becomes one-way.
    const selfRel = new Set<string>();
    for (const p of props) {
      const cfg = (p.config ?? {}) as PropertyConfig;
      if (p.type === "RELATION" && cfg.relation) {
        const self = cfg.relation.databaseId === id;
        if (self) selfRel.add(p.id);
        const relation = self
          ? { ...cfg.relation, databaseId: copy.id, pairedId: cfg.relation.pairedId ? remap(cfg.relation.pairedId) : null }
          : { ...cfg.relation, pairedId: null, primary: true };
        await tx.databaseProperty.update({ where: { id: remap(p.id) }, data: { config: { ...cfg, relation } as unknown as Prisma.InputJsonValue } });
      }
      if (p.type === "ROLLUP" && cfg.rollup) {
        const rel = props.find((x) => x.id === cfg.rollup!.relationId);
        const self = rel && ((rel.config ?? {}) as PropertyConfig).relation?.databaseId === id;
        const rollup = { ...cfg.rollup, relationId: remap(cfg.rollup.relationId), targetId: self ? remap(cfg.rollup.targetId) : cfg.rollup.targetId };
        await tx.databaseProperty.update({ where: { id: remap(p.id) }, data: { config: { ...cfg, rollup } as unknown as Prisma.InputJsonValue } });
      }
    }
    for (const v of views) {
      const c = (v.config ?? {}) as ViewConfig;
      const cfg: ViewConfig = {
        ...c,
        order: c.order?.map(remap),
        hidden: c.hidden?.map(remap),
        widths: c.widths ? Object.fromEntries(Object.entries(c.widths).map(([k, w]) => [remap(k), w])) : undefined,
        groupBy: c.groupBy ? remap(c.groupBy) : c.groupBy,
        sorts: c.sorts?.map((s) => ({ ...s, propertyId: remap(s.propertyId) })),
        filter: c.filter ? (JSON.parse(JSON.stringify(c.filter).replace(/"propertyId":"([^"]+)"/g, (_m, pid: string) => `"propertyId":"${remap(pid)}"`)) as FilterGroup) : c.filter,
      };
      await tx.databaseView.create({ data: { databaseId: copy.id, name: v.name, type: v.type, position: v.position, config: cfg as Prisma.InputJsonValue } });
    }
    const pageMap = new Map<string, string>();
    const created: { id: string; values: Record<string, unknown> }[] = [];
    for (const pg of pages) {
      const values = Object.fromEntries(Object.entries((pg.values ?? {}) as Record<string, unknown>).map(([k, val]) => [remap(k), val]));
      const made = await tx.page.create({
        data: {
          workspaceId: src.workspaceId,
          databaseId: copy.id,
          title: pg.title,
          icon: pg.icon,
          coverImage: pg.coverImage,
          thumbnail: pg.thumbnail,
          body: pg.body ?? Prisma.JsonNull,
          contentHtml: pg.contentHtml,
          contentText: pg.contentText,
          values: values as Prisma.InputJsonValue,
          searchText: pg.searchText,
          position: pg.position,
          createdById: userId,
          lastEditedById: userId,
        },
        select: { id: true },
      });
      pageMap.set(pg.id, made.id);
      created.push({ id: made.id, values });
    }
    // Relation values: page ids of self-relations move to the copies; then the links table.
    const links: { propertyId: string; fromPageId: string; toPageId: string; position: number }[] = [];
    const patches: { id: string; set: Record<string, PropertyValue>; del: string[] }[] = [];
    for (const row of created) {
      const set: Record<string, PropertyValue> = {};
      for (const p of props.filter((x) => x.type === "RELATION")) {
        const list = row.values[remap(p.id)];
        if (!Array.isArray(list)) continue;
        const ids = selfRel.has(p.id) ? list.map((x) => pageMap.get(x as string)).filter((x): x is string => !!x) : (list as string[]);
        set[remap(p.id)] = ids;
        const cfg = ((p.config ?? {}) as PropertyConfig).relation;
        const primary = !selfRel.has(p.id) || cfg?.primary !== false;
        if (primary) ids.forEach((to, i) => links.push({ propertyId: remap(p.id), fromPageId: row.id, toPageId: to, position: i }));
      }
      if (Object.keys(set).length) patches.push({ id: row.id, set, del: [] });
    }
    await patchValues(tx, patches);
    if (links.length) await tx.pageRelation.createMany({ data: links, skipDuplicates: true });
    await recomputeDatabase(tx, copy.id);
    return copy;
  }, TX);
}

/** Everything a database page needs: the database, its properties and views. */
export async function getDatabase(userId: string, id: string) {
  const database = await requireDatabase(userId, id, "VIEWER");
  const [properties, views, people] = await Promise.all([
    propertiesOf(id),
    db.databaseView.findMany({ where: { databaseId: id } }),
    db.workspaceMember.findMany({ where: { workspaceId: database.workspaceId }, select: { user: { select: { id: true, name: true } } } }),
  ]);
  return {
    database,
    properties,
    views: sortByPosition(views).map((v) => ({ id: v.id, name: v.name, type: v.type as ViewType, config: (v.config ?? {}) as ViewConfig })),
    people: people.map((m) => m.user),
  };
}

// ── Properties ─────────────────────────────────────────────────────────────

export interface NewRelation {
  databaseId: string;
  limit: "one" | "many";
  twoWay: boolean;
  pairedName?: string;
}

/**
 * Check a rollup / formula config against the database and fill in its
 * result type. Throws DatabaseError with a message for the property menu.
 */
async function resolveResultConfig(databaseId: string, def: PropertyDef, config: PropertyConfig, defs: PropertyDef[]): Promise<PropertyConfig> {
  if (def.type === "ROLLUP") {
    const r = config.rollup;
    if (!r) return { ...config, resultType: "number" };
    const rel = defs.find((d) => d.id === r.relationId && d.type === "RELATION");
    if (!rel?.config.relation) throw new DatabaseError("Choose a relation for this rollup.");
    const target = (await propertiesOf(rel.config.relation.databaseId)).find((d) => d.id === r.targetId);
    if (!target) throw new DatabaseError("Choose a property to roll up.");
    const fns = rollupFnsFor(target);
    const fn = (ROLLUP_FNS as readonly string[]).includes(r.fn) && fns.includes(r.fn as RollupFn) ? (r.fn as RollupFn) : fns.includes("count_all") ? "count_all" : fns[0]!;
    const result = rollupResult(fn, target);
    const numberFormat = config.numberFormat ?? result.numberFormat;
    return { ...config, rollup: { ...r, fn }, resultType: result.resultType, ...(numberFormat ? { numberFormat } : {}) };
  }
  if (def.type === "FORMULA") {
    const expression = config.formula?.expression ?? "";
    const next = defs.map((d) => (d.id === def.id ? { ...d, config: { ...d.config, formula: { expression } } } : d));
    if (!next.some((d) => d.id === def.id)) next.push({ ...def, config: { formula: { expression } } });
    const plan = planFormulas(next);
    const cycle = plan.cyclic.get(def.id);
    if (cycle) throw new DatabaseError(`Circular reference: ${cycle}`);
    const compiled = plan.compiled.get(def.id);
    if (expression.trim() && compiled?.issues.length) throw new DatabaseError(compiled.issues[0]!.message);
    return { ...config, formula: { expression }, resultType: compiled && expression.trim() ? toResultType(compiled.type) : "text" };
  }
  return config;
}

export async function addProperty(userId: string, databaseId: string, input: { name: string; type: PropertyType; config?: unknown; afterId?: string | null; relation?: NewRelation }) {
  const database = await requireDatabase(userId, databaseId);
  if (input.type === "TITLE") throw new DatabaseError("A database has exactly one Title property.");
  const count = await db.databaseProperty.count({ where: { databaseId } });
  if (count >= LIMITS.properties) throw new DatabaseError(`A database can have up to ${LIMITS.properties} properties.`);
  const props = sortByPosition(await db.databaseProperty.findMany({ where: { databaseId }, select: { id: true, position: true } }));
  const at = input.afterId ? props.findIndex((p) => p.id === input.afterId) : props.length - 1;
  const position = generateKeyBetween(props[at]?.position ?? null, props[at + 1]?.position ?? null);
  const name = input.name.trim().slice(0, LIMITS.propertyName) || "Property";
  if (input.type === "RELATION") {
    if (!input.relation) throw new DatabaseError("Pick a database to link to.");
    const relation = input.relation;
    return friendly(() => db.$transaction((tx) => createRelationProperty(tx, { databaseId, workspaceId: database.workspaceId, name, position, relation }), TX));
  }
  let config = input.config ? validateConfig(input.type, input.config) : defaultConfig(input.type);
  if (isResultProp({ type: input.type })) config = await resolveResultConfig(databaseId, { id: "", name, type: input.type, config }, config, await propertiesOf(databaseId));
  return db.$transaction(async (tx) => {
    const p = await tx.databaseProperty.create({ data: { databaseId, name, type: input.type, config: config as Prisma.InputJsonValue, position } });
    if (isResultProp({ type: input.type })) await recomputeDatabase(tx, databaseId);
    return toDef(p);
  }, TX);
}

export async function updateProperty(userId: string, propertyId: string, patch: { name?: string; config?: unknown; twoWay?: boolean; pairedName?: string }) {
  const prop = await db.databaseProperty.findUniqueOrThrow({ where: { id: propertyId } });
  await requireDatabase(userId, prop.databaseId);
  const type = prop.type as PropertyType;
  const current = toDef(prop);
  const defs = await propertiesOf(prop.databaseId);
  let config = patch.config !== undefined ? validateConfig(type, patch.config) : undefined;
  if (type === "RELATION" && current.config.relation) {
    // Only the limit is the client's to change; the target and the pairing are the server's.
    config = { ...current.config, relation: { ...current.config.relation, limit: config?.relation?.limit ?? current.config.relation.limit } };
  }
  if (config && isResultProp(current)) config = await resolveResultConfig(prop.databaseId, current, config, defs);
  const newName = patch.name !== undefined ? patch.name.trim().slice(0, LIMITS.propertyName) || prop.name : undefined;
  return friendly(() =>
    db.$transaction(async (tx) => {
      // Options removed from a select: drop them from rows too.
      if (config?.options && (type === "SELECT" || type === "STATUS" || type === "MULTI_SELECT")) {
        const keep = config.options.map((o) => o.id);
        if (type === "MULTI_SELECT") {
          await tx.$executeRaw`UPDATE "pages" SET "values" = jsonb_set("values", ARRAY[${prop.id}::text], COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements_text("values" -> ${prop.id}::text) e WHERE e = ANY(${keep}::text[])), '[]'::jsonb)) WHERE "database_id" = ${prop.databaseId} AND jsonb_typeof("values" -> ${prop.id}::text) = 'array'`;
        } else {
          await tx.$executeRaw`UPDATE "pages" SET "values" = "values" - ${prop.id}::text WHERE "database_id" = ${prop.databaseId} AND NOT (("values" ->> ${prop.id}::text) = ANY(${keep}::text[])) AND "values" ? ${prop.id}::text`;
        }
      }
      if (type === "RELATION" && patch.twoWay !== undefined && current.config.relation) {
        const relation = await setTwoWay(tx, { ...current, config: config ?? current.config, databaseId: prop.databaseId }, patch.twoWay, patch.pairedName);
        config = { ...(config ?? current.config), relation };
      }
      // Formulas refer to properties by name: follow a rename.
      if (newName && newName !== prop.name) {
        for (const f of defs.filter((d) => d.type === "FORMULA" && d.config.formula?.expression.includes(prop.name))) {
          const expression = renameProp(f.config.formula!.expression, prop.name, newName);
          if (expression !== f.config.formula!.expression) {
            const fc = f.id === propertyId && config ? config : f.config;
            if (f.id === propertyId) config = { ...fc, formula: { expression } };
            else await tx.databaseProperty.update({ where: { id: f.id }, data: { config: { ...fc, formula: { expression } } as unknown as Prisma.InputJsonValue } });
          }
        }
      }
      const updated = await tx.databaseProperty.update({
        where: { id: propertyId },
        data: {
          ...(newName !== undefined ? { name: newName } : {}),
          ...(config ? { config: config as Prisma.InputJsonValue } : {}),
        },
      });
      const affectsResults = isResultProp(current) || (newName !== undefined && newName !== prop.name) || config?.options !== undefined || patch.twoWay !== undefined;
      if (affectsResults && (config || newName)) await recomputeDatabase(tx, prop.databaseId);
      return toDef(updated);
    }, TX),
  );
}

/** Change a property's type, converting every row's value. */
export async function changePropertyType(userId: string, propertyId: string, type: PropertyType) {
  const prop = await db.databaseProperty.findUniqueOrThrow({ where: { id: propertyId } });
  await requireDatabase(userId, prop.databaseId);
  if (prop.isTitle || type === "TITLE") throw new DatabaseError("The Title property can't change type.");
  if (prop.type === "RELATION" || type === "RELATION") throw new DatabaseError("Relations can't change type — add a new property instead.");
  const from = toDef(prop);
  if (from.type === type) return from;
  const rows = await db.page.findMany({ where: { databaseId: prop.databaseId }, select: { id: true, values: true } });
  const current = (r: { values: Prisma.JsonValue }) => ((r.values ?? {}) as Record<string, PropertyValue>)[prop.id] ?? null;

  let config = defaultConfig(type);
  if (type === "SELECT" || type === "MULTI_SELECT" || type === "STATUS") {
    const texts = rows.flatMap((r) => {
      const v = current(r);
      if (v === null) return [];
      if (from.type === "MULTI_SELECT") return (v as string[]).map((id) => from.config.options?.find((o) => o.id === id)?.name ?? "");
      return valueText(from, v).split(type === "MULTI_SELECT" ? "," : "\u0000");
    });
    const base = from.config.options?.length ? from.config.options.map((o) => ({ ...o, ...(type === "STATUS" ? { group: o.group ?? "todo" } : {}) })) : type === "STATUS" ? (config.options ?? []) : [];
    config = { options: optionsFromTexts(texts, base).map((o) => (type === "STATUS" ? { ...o, group: o.group ?? "todo" } : { id: o.id, name: o.name, color: o.color })) };
  }
  if (isResultProp({ type })) config = { ...(type === "FORMULA" ? { formula: { expression: "" } } : {}), resultType: type === "ROLLUP" ? "number" : "text" };
  const to: PropertyDef = { ...from, type, config };
  await db.$transaction(async (tx) => {
    for (const r of rows) {
      const v = current(r);
      if (v === null) continue;
      // Results are recalculated below; they start empty.
      const next = isResultProp(to) ? null : convertValue(from, to, v);
      const values = { ...((r.values ?? {}) as Record<string, PropertyValue>) };
      if (next === null) delete values[prop.id];
      else values[prop.id] = next;
      await tx.page.update({ where: { id: r.id }, data: { values: values as Prisma.InputJsonValue } });
    }
    await tx.databaseProperty.update({ where: { id: propertyId }, data: { type: type as DbPropertyType, config: config as Prisma.InputJsonValue } });
    await recomputeDatabase(tx, prop.databaseId);
  }, TX);
  return to;
}

export async function deleteProperty(userId: string, propertyId: string) {
  const prop = await db.databaseProperty.findUniqueOrThrow({ where: { id: propertyId } });
  await requireDatabase(userId, prop.databaseId);
  if (prop.isTitle) throw new DatabaseError("The Title property can't be deleted.");
  await db.$transaction(async (tx) => {
    if (prop.type === "RELATION") return deleteRelationProperty(tx, { ...toDef(prop), databaseId: prop.databaseId });
    await tx.$executeRaw`UPDATE "pages" SET "values" = "values" - ${prop.id}::text WHERE "database_id" = ${prop.databaseId}`;
    await tx.databaseProperty.delete({ where: { id: propertyId } });
    // Formulas reading it (here) and rollups reading it (elsewhere) now show an error.
    await recomputeDatabase(tx, prop.databaseId);
  }, TX);
}

/** Move a property between two neighbours (ids, or null for an end). */
export async function moveProperty(userId: string, propertyId: string, beforeId: string | null, afterId: string | null) {
  const prop = await db.databaseProperty.findUniqueOrThrow({ where: { id: propertyId } });
  await requireDatabase(userId, prop.databaseId);
  const props = await db.databaseProperty.findMany({ where: { databaseId: prop.databaseId, id: { in: [beforeId, afterId].filter(Boolean) as string[] } }, select: { id: true, position: true } });
  const pos = (id: string | null) => (id ? (props.find((p) => p.id === id)?.position ?? null) : null);
  const position = generateKeyBetween(pos(afterId), pos(beforeId));
  await db.databaseProperty.update({ where: { id: propertyId }, data: { position } });
}

// ── Views ──────────────────────────────────────────────────────────────────

export async function createView(userId: string, databaseId: string, input: { name?: string; type: ViewType; config?: ViewConfig }) {
  await requireDatabase(userId, databaseId);
  const count = await db.databaseView.count({ where: { databaseId } });
  if (count >= 30) throw new DatabaseError("A database can have up to 30 views.");
  const position = generateKeyBetween(await lastPosition("view", { databaseId }), null);
  const names: Record<string, string> = { TABLE: "Table", BOARD: "Board", LIST: "List", CALENDAR: "Calendar", TIMELINE: "Timeline", GALLERY: "Gallery" };
  let config = input.config ?? {};
  const props = await propertiesOf(databaseId);
  if (input.type === "BOARD" && !config.groupBy) {
    config = { ...config, groupBy: (props.find((p) => p.type === "STATUS") ?? props.find((p) => p.type === "SELECT"))?.id ?? null };
  }
  if ((input.type === "CALENDAR" || input.type === "TIMELINE") && !config.dateBy) {
    // Prefer a date range for timelines, any Date otherwise, then Created time.
    const dates = props.filter((p) => p.type === "DATE");
    const pick = (input.type === "TIMELINE" ? dates.find((d) => d.config.range) : undefined) ?? dates[0] ?? props.find((p) => p.type === "CREATED_TIME");
    config = { ...config, dateBy: pick?.id ?? null };
  }
  if (input.type === "GALLERY" && config.cover === undefined) config = { ...config, cover: "page" };
  const v = await db.databaseView.create({ data: { databaseId, name: (input.name?.trim() || names[input.type]!).slice(0, 100), type: input.type as DbViewType, position, config: config as Prisma.InputJsonValue } });
  return { id: v.id, name: v.name, type: v.type as ViewType, config: (v.config ?? {}) as ViewConfig };
}

export async function updateView(userId: string, viewId: string, patch: { name?: string; config?: ViewConfig }) {
  const view = await db.databaseView.findUniqueOrThrow({ where: { id: viewId } });
  await requireDatabase(userId, view.databaseId);
  if (patch.config && !filterWithinLimits(patch.config.filter)) throw new DatabaseError("That filter is too large.");
  await db.databaseView.update({
    where: { id: viewId },
    data: {
      ...(patch.name !== undefined ? { name: patch.name.trim().slice(0, 100) || view.name } : {}),
      ...(patch.config ? { config: patch.config as Prisma.InputJsonValue } : {}),
    },
  });
}

export async function deleteView(userId: string, viewId: string) {
  const view = await db.databaseView.findUniqueOrThrow({ where: { id: viewId } });
  await requireDatabase(userId, view.databaseId);
  if ((await db.databaseView.count({ where: { databaseId: view.databaseId } })) <= 1) throw new DatabaseError("A database needs at least one view.");
  await db.databaseView.delete({ where: { id: viewId } });
}

// ── Rows ───────────────────────────────────────────────────────────────────

export interface RowData {
  id: string;
  title: string;
  icon: string | null;
  /** Card cover (page cover or first image). */
  thumbnail: string | null;
  values: Record<string, PropertyValue>;
  position: string;
  createdAt: string;
  updatedAt: string;
}

/** A write's result: the row, plus other rows whose values changed (rollups, paired relations). */
export interface RowWrite extends RowData {
  touched: string[];
  related: Record<string, RelatedPage>;
}

export type { RelatedPage };

export const ROW_PAGE_SIZE = 500;

/** Rows for a view: filtered, sorted and searched in SQL. */
export async function queryRows(
  userId: string,
  databaseId: string,
  opts: {
    filter?: FilterGroup | null;
    sorts?: SortRule[];
    search?: string;
    today: string;
    offset?: number;
    limit?: number;
    archived?: boolean;
    /** Only rows overlapping this date range (calendar / timeline). */
    window?: DateWindow | null;
    /** Only rows without a value for this date property ("No date" tray). */
    undatedBy?: string | null;
  },
): Promise<{ rows: RowData[]; total: number; related: Record<string, RelatedPage> }> {
  await requireDatabase(userId, databaseId, "VIEWER");
  if (!filterWithinLimits(opts.filter)) throw new DatabaseError("That filter is too large.");
  const today = /^\d{4}-\d{2}-\d{2}$/.test(opts.today) ? opts.today : new Date().toISOString().slice(0, 10);
  // Formulas using today() / now(): recalculated on the first read of the day.
  await refreshIfStale(databaseId, today);
  const props = await propertiesOf(databaseId);
  const ctx: CompileContext = { props: new Map(props.map((p) => [p.id, p])), today };
  const windowSql = opts.window ? compileWindow(opts.window, ctx) : null;
  const undatedSql = opts.undatedBy ? compileUndated(opts.undatedBy, ctx) : null;
  const extra = [windowSql, undatedSql].filter((x): x is Prisma.Sql => x !== null);
  const where = Prisma.sql`p."database_id" = ${databaseId} AND p."archived_at" IS ${opts.archived ? Prisma.sql`NOT NULL` : Prisma.sql`NULL`} AND ${compileFilter(opts.filter, ctx)} ${compileSearch(opts.search)} ${extra.length ? Prisma.sql`AND ${Prisma.join(extra, " AND ")}` : Prisma.empty}`;
  const limit = Math.min(Math.max(opts.limit ?? ROW_PAGE_SIZE, 1), ROW_PAGE_SIZE);
  const offset = Math.max(opts.offset ?? 0, 0);
  const [rows, count] = await Promise.all([
    db.$queryRaw<{ id: string; title: string; icon: string | null; thumbnail: string | null; values: Record<string, PropertyValue>; position: string; created_at: Date; updated_at: Date }[]>`
      SELECT p."id", p."title", p."icon", p."thumbnail", p."values", p."position", p."created_at", p."updated_at"
      FROM "pages" p WHERE ${where}
      ORDER BY ${compileSorts(opts.sorts, ctx)}
      LIMIT ${limit} OFFSET ${offset}`,
    db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "pages" p WHERE ${where}`,
  ]);
  const out = rows.map((r) => ({ id: r.id, title: r.title, icon: r.icon, thumbnail: r.thumbnail, values: r.values ?? {}, position: r.position, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString() }));
  return { rows: out, total: Number(count[0]?.n ?? 0), related: await relatedPages(db, props, out) };
}

/** Re-read a row after a write (results and mirrors may have changed) with its related pages. */
async function rowWrite(pageId: string, defs: PropertyDef[], touched: Set<string>): Promise<RowWrite> {
  const page = await db.page.findUniqueOrThrow({ where: { id: pageId } });
  const row = toRow(page);
  touched.delete(pageId);
  return { ...row, touched: [...touched].slice(0, 2000), related: await relatedPages(db, defs, [row]) };
}

const relationPatch = (defs: PropertyDef[], values: Record<string, unknown>) =>
  Object.entries(values).flatMap(([id, v]) => {
    const def = defs.find((d) => d.id === id && d.type === "RELATION");
    if (!def) return [];
    return [{ def, ids: Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [] }];
  });

function toRow(p: { id: string; title: string; icon: string | null; thumbnail?: string | null; values: Prisma.JsonValue; position: string; createdAt: Date; updatedAt: Date }): RowData {
  return { id: p.id, title: p.title, icon: p.icon, thumbnail: p.thumbnail ?? null, values: (p.values ?? {}) as Record<string, PropertyValue>, position: p.position, createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString() };
}

/** New row (defaults applied), placed after `afterId` or at the end. */
export async function createRow(userId: string, databaseId: string, input: { title?: string; values?: Record<string, unknown>; afterId?: string | null; beforeId?: string | null } = {}) {
  const database = await requireDatabase(userId, databaseId);
  const defs = await propertiesOf(databaseId);
  const values = { ...defaultsFor(defs), ...cleanValues(defs, input.values ?? {}) };
  const title = (input.title ?? "").slice(0, LIMITS.title);
  const neighbours = await db.page.findMany({ where: { id: { in: [input.afterId, input.beforeId].filter(Boolean) as string[] } }, select: { id: true, position: true } });
  const pos = (id?: string | null) => (id ? (neighbours.find((n) => n.id === id)?.position ?? null) : null);
  const position =
    input.afterId || input.beforeId ? generateKeyBetween(pos(input.afterId), pos(input.beforeId)) : generateKeyBetween(await lastPosition("page", { databaseId }), null);
  const relations = relationPatch(defs, input.values ?? {});
  const touched = new Set<string>();
  const page = await friendly(() =>
    db.$transaction(async (tx) => {
      const page = await tx.page.create({
        data: { workspaceId: database.workspaceId, databaseId, title, values: values as Prisma.InputJsonValue, searchText: buildSearchText(title, values, defs), position, createdById: userId, lastEditedById: userId },
      });
      let current = page;
      for (const r of relations) {
        for (const id of await setRelation(tx, current, r.def, r.ids)) touched.add(id);
        current = await tx.page.findUniqueOrThrow({ where: { id: page.id } });
      }
      // Its formulas (and anything already reading it).
      for (const id of await afterChange(tx, databaseId, [page.id], new Set(Object.keys(values)))) touched.add(id);
      await tx.database.update({ where: { id: databaseId }, data: { updatedAt: new Date() } });
      return page;
    }, TX),
  );
  return rowWrite(page.id, defs, touched);
}

/** Set property values (and/or the title) on one row. `null` clears a value. */
export async function updateRow(userId: string, pageId: string, patch: { title?: string; icon?: string | null; values?: Record<string, unknown> }): Promise<RowWrite> {
  const page = await requirePage(userId, pageId);
  if (!page.databaseId) throw new DatabaseError("Not a database row.");
  const databaseId = page.databaseId;
  const defs = await propertiesOf(databaseId);
  const values = { ...((page.values ?? {}) as Record<string, PropertyValue>) };
  const changed = new Set<string>();
  for (const [id, v] of Object.entries(patch.values ?? {})) {
    const def = defs.find((d) => d.id === id);
    if (!def || def.isTitle || COMPUTED_TYPES.includes(def.type) || def.type === "RELATION") continue;
    const clean = cleanValues(defs, { [id]: v })[id];
    if (clean === undefined) delete values[id];
    else values[id] = clean;
    changed.add(id);
  }
  const title = patch.title !== undefined ? patch.title.slice(0, LIMITS.title) : page.title;
  if (title !== page.title) {
    const titleDef = defs.find((d) => d.isTitle);
    if (titleDef) changed.add(titleDef.id);
  }
  const relations = relationPatch(defs, patch.values ?? {});
  const touched = new Set<string>();
  await friendly(() =>
    db.$transaction(async (tx) => {
      const updated = await tx.page.update({
        where: { id: pageId },
        data: {
          title,
          ...(patch.icon !== undefined ? { icon: patch.icon?.slice(0, 16) || null } : {}),
          values: values as Prisma.InputJsonValue,
          searchText: buildSearchText(title, values, defs, page.contentText),
          lastEditedById: userId,
        },
      });
      let current = updated;
      for (const r of relations) {
        for (const id of await setRelation(tx, current, r.def, r.ids)) touched.add(id);
        current = await tx.page.findUniqueOrThrow({ where: { id: pageId } });
      }
      if (changed.size) for (const id of await afterChange(tx, databaseId, [pageId], changed)) touched.add(id);
      // An edit changes "last edited": formulas reading it too.
      else if (!relations.length) for (const id of await afterChange(tx, databaseId, [pageId], new Set())) touched.add(id);
    }, TX),
  );
  return rowWrite(pageId, defs, touched);
}

/** Set one property on many rows at once (bulk edit). */
export async function bulkUpdate(userId: string, databaseId: string, pageIds: string[], propertyId: string, value: unknown) {
  await requireDatabase(userId, databaseId);
  const ids = pageIds.slice(0, 1000);
  const pages = await db.page.findMany({ where: { id: { in: ids }, databaseId }, select: { id: true } });
  for (const p of pages) await updateRow(userId, p.id, { values: { [propertyId]: value } });
  return pages.length;
}

/** Move a row: new position between neighbours and, on a board, a new group value. */
export async function moveRow(userId: string, pageId: string, input: { beforeId?: string | null; afterId?: string | null; set?: Record<string, unknown> }) {
  const page = await requirePage(userId, pageId);
  const neighbours = await db.page.findMany({ where: { id: { in: [input.afterId, input.beforeId].filter(Boolean) as string[] }, databaseId: page.databaseId }, select: { id: true, position: true } });
  const pos = (id?: string | null) => (id ? (neighbours.find((n) => n.id === id)?.position ?? null) : null);
  let a = pos(input.afterId);
  let b = pos(input.beforeId);
  if (a !== null && b !== null && a >= b) b = null; // stale neighbours: just go after `a`
  if (a === null && b === null) a = page.position;
  const position = a !== null && b === null && a === page.position ? page.position : generateKeyBetween(a, b);
  await db.page.update({ where: { id: pageId }, data: { position } });
  return input.set ? updateRow(userId, pageId, { values: input.set }) : toRow({ ...page, position });
}

export async function setRowsArchived(userId: string, databaseId: string, pageIds: string[], archived: boolean) {
  const database = await requireDatabase(userId, databaseId);
  const ids = pageIds.slice(0, 1000);
  return db.$transaction(async (tx) => {
    const r = await tx.page.updateMany({ where: { id: { in: ids }, databaseId }, data: { archivedAt: archived ? new Date() : null } });
    // Rollups leave archived rows out.
    await detachPages(tx, databaseId, database.workspaceId, ids, "archive");
    return r.count;
  }, TX);
}

export async function deleteRows(userId: string, databaseId: string, pageIds: string[]) {
  const database = await requireDatabase(userId, databaseId);
  const ids = (await db.page.findMany({ where: { id: { in: pageIds.slice(0, 1000) }, databaseId }, select: { id: true } })).map((p) => p.id);
  return db.$transaction(async (tx) => {
    await detachPages(tx, databaseId, database.workspaceId, ids, "delete");
    const r = await tx.page.deleteMany({ where: { id: { in: ids }, databaseId } });
    return r.count;
  }, TX);
}

export async function duplicateRow(userId: string, pageId: string) {
  const page = await requirePage(userId, pageId);
  if (!page.databaseId) throw new DatabaseError("Not a database row.");
  const databaseId = page.databaseId;
  const next = await db.page.findMany({ where: { databaseId, archivedAt: null }, select: { position: true } });
  const after = sortByPosition(next).find((n) => n.position > page.position)?.position ?? null;
  const defs = await propertiesOf(databaseId);
  // Relations are re-made through setRelation, so both sides and the links agree.
  const values = { ...((page.values ?? {}) as Record<string, PropertyValue>) };
  const relations = defs.filter((d) => d.type === "RELATION" && Array.isArray(values[d.id])).map((d) => ({ def: d, ids: values[d.id] as string[] }));
  for (const r of relations) delete values[r.def.id];
  return db.$transaction(async (tx) => {
  const copy = await tx.page.create({
    data: {
      workspaceId: page.workspaceId,
      databaseId: page.databaseId,
      title: page.title ? `${page.title} (copy)`.slice(0, LIMITS.title) : "",
      icon: page.icon,
      coverImage: page.coverImage,
      thumbnail: page.thumbnail,
      body: page.body ?? Prisma.JsonNull,
      contentHtml: page.contentHtml,
      contentText: page.contentText,
      values: values as Prisma.InputJsonValue,
      searchText: page.searchText,
      position: generateKeyBetween(page.position, after),
      createdById: userId,
      lastEditedById: userId,
    },
  });
  let current = copy;
  for (const r of relations) {
    await setRelation(tx, current, r.def, r.ids);
    current = await tx.page.findUniqueOrThrow({ where: { id: copy.id } });
  }
  await afterChange(tx, databaseId, [copy.id], new Set());
  return toRow(await tx.page.findUniqueOrThrow({ where: { id: copy.id } }));
  }, TX);
}

/** Rows of a database by title (relation picker); `ids` fetches specific rows instead. */
export async function searchRows(userId: string, databaseId: string, q: string, ids?: string[]) {
  await requireDatabase(userId, databaseId, "VIEWER");
  const t = q.trim().slice(0, 200);
  const rows = await db.page.findMany({
    where: { databaseId, archivedAt: null, ...(ids ? { id: { in: ids } } : t ? { title: { contains: t, mode: "insensitive" } } : {}) },
    orderBy: ids ? undefined : { updatedAt: "desc" },
    take: ids ? 500 : 30,
    select: { id: true, title: true, icon: true },
  });
  return rows;
}

// ── Row pages ──────────────────────────────────────────────────────────────

export async function getPage(userId: string, pageId: string) {
  const page = await requirePage(userId, pageId, "VIEWER");
  const database = page.databaseId ? await getDatabase(userId, page.databaseId) : null;
  const related = database ? await relatedPages(db, database.properties, [{ values: (page.values ?? {}) as Record<string, PropertyValue> }]) : {};
  return { page, database, related };
}

/** Save a row page's body (same HTML pipeline as Notebook entries). */
export async function savePageBody(userId: string, pageId: string, input: { body: Prisma.InputJsonValue; html: string; coverImage?: string | null }) {
  const page = await requirePage(userId, pageId);
  const origin = storagePublicOrigin();
  const contentHtml = renderNotebookHtml(input.html, { imageOrigins: origin ? [origin] : [] });
  const derived = deriveFields(contentHtml);
  const defs = page.databaseId ? await propertiesOf(page.databaseId) : [];
  const values = (page.values ?? {}) as Record<string, PropertyValue>;
  const updated = await db.page.update({
    where: { id: pageId },
    data: {
      body: input.body,
      contentHtml,
      contentText: derived.contentText,
      searchText: buildSearchText(page.title, values, defs, derived.contentText),
      ...(input.coverImage !== undefined ? { coverImage: input.coverImage || null } : {}),
      thumbnail: (input.coverImage !== undefined ? input.coverImage : page.coverImage) || derived.firstImage || null,
      lastEditedById: userId,
    },
  });
  const urls = [...mediaSources(contentHtml), ...(updated.coverImage ? [updated.coverImage] : [])];
  if (urls.length) await db.asset.updateMany({ where: { url: { in: [...new Set(urls)] } }, data: { pageId } });
  return { id: updated.id, updatedAt: updated.updatedAt.toISOString(), words: derived.wordCount };
}
