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

/**
 * Workspace databases: every database row is a Page (Page.databaseId), with
 * its property values in Page.values (JSONB, keyed by property id). All
 * access goes through requireDatabase / requirePage (workspace membership).
 */

export class DatabaseError extends Error {}

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
  for (const d of defs) if (values[d.id] !== undefined) parts.push(valueText(d, values[d.id]!));
  if (contentText) parts.push(contentText);
  return parts.filter(Boolean).join(" • ").slice(0, 20_000);
}

function cleanValues(defs: PropertyDef[], raw: Record<string, unknown>): Record<string, PropertyValue> {
  const out: Record<string, PropertyValue> = {};
  for (const [id, v] of Object.entries(raw)) {
    const def = defs.find((d) => d.id === id);
    if (!def || def.isTitle || COMPUTED_TYPES.includes(def.type)) continue;
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
  for (const d of defs) if (d.config.default !== undefined && d.config.default !== null) out[d.id] = d.config.default;
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
  });
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
  await requireDatabase(userId, id, "OWNER");
  await db.database.delete({ where: { id } });
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
    for (const pg of pages) {
      const values = Object.fromEntries(Object.entries((pg.values ?? {}) as Record<string, unknown>).map(([k, val]) => [remap(k), val]));
      await tx.page.create({
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
      });
    }
    return copy;
  });
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

export async function addProperty(userId: string, databaseId: string, input: { name: string; type: PropertyType; config?: unknown; afterId?: string | null }) {
  await requireDatabase(userId, databaseId);
  if (input.type === "TITLE") throw new DatabaseError("A database has exactly one Title property.");
  const count = await db.databaseProperty.count({ where: { databaseId } });
  if (count >= LIMITS.properties) throw new DatabaseError(`A database can have up to ${LIMITS.properties} properties.`);
  const props = sortByPosition(await db.databaseProperty.findMany({ where: { databaseId }, select: { id: true, position: true } }));
  const at = input.afterId ? props.findIndex((p) => p.id === input.afterId) : props.length - 1;
  const position = generateKeyBetween(props[at]?.position ?? null, props[at + 1]?.position ?? null);
  const config = input.config ? validateConfig(input.type, input.config) : defaultConfig(input.type);
  const p = await db.databaseProperty.create({
    data: { databaseId, name: input.name.trim().slice(0, LIMITS.propertyName) || "Property", type: input.type, config: config as Prisma.InputJsonValue, position },
  });
  return toDef(p);
}

export async function updateProperty(userId: string, propertyId: string, patch: { name?: string; config?: unknown }) {
  const prop = await db.databaseProperty.findUniqueOrThrow({ where: { id: propertyId } });
  await requireDatabase(userId, prop.databaseId);
  const type = prop.type as PropertyType;
  const config = patch.config !== undefined ? validateConfig(type, patch.config) : undefined;
  // Options removed from a select: drop them from rows too.
  if (config?.options && (type === "SELECT" || type === "STATUS" || type === "MULTI_SELECT")) {
    const keep = config.options.map((o) => o.id);
    if (type === "MULTI_SELECT") {
      await db.$executeRaw`UPDATE "pages" SET "values" = jsonb_set("values", ARRAY[${prop.id}::text], COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements_text("values" -> ${prop.id}::text) e WHERE e = ANY(${keep}::text[])), '[]'::jsonb)) WHERE "database_id" = ${prop.databaseId} AND jsonb_typeof("values" -> ${prop.id}::text) = 'array'`;
    } else {
      await db.$executeRaw`UPDATE "pages" SET "values" = "values" - ${prop.id}::text WHERE "database_id" = ${prop.databaseId} AND NOT (("values" ->> ${prop.id}::text) = ANY(${keep}::text[])) AND "values" ? ${prop.id}::text`;
    }
  }
  const updated = await db.databaseProperty.update({
    where: { id: propertyId },
    data: {
      ...(patch.name !== undefined ? { name: patch.name.trim().slice(0, LIMITS.propertyName) || prop.name } : {}),
      ...(config ? { config: config as Prisma.InputJsonValue } : {}),
    },
  });
  return toDef(updated);
}

/** Change a property's type, converting every row's value. */
export async function changePropertyType(userId: string, propertyId: string, type: PropertyType) {
  const prop = await db.databaseProperty.findUniqueOrThrow({ where: { id: propertyId } });
  await requireDatabase(userId, prop.databaseId);
  if (prop.isTitle || type === "TITLE") throw new DatabaseError("The Title property can't change type.");
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
  const to: PropertyDef = { ...from, type, config };
  await db.$transaction(async (tx) => {
    for (const r of rows) {
      const v = current(r);
      if (v === null) continue;
      const next = convertValue(from, to, v);
      const values = { ...((r.values ?? {}) as Record<string, PropertyValue>) };
      if (next === null) delete values[prop.id];
      else values[prop.id] = next;
      await tx.page.update({ where: { id: r.id }, data: { values: values as Prisma.InputJsonValue } });
    }
    await tx.databaseProperty.update({ where: { id: propertyId }, data: { type: type as DbPropertyType, config: config as Prisma.InputJsonValue } });
  });
  return to;
}

export async function deleteProperty(userId: string, propertyId: string) {
  const prop = await db.databaseProperty.findUniqueOrThrow({ where: { id: propertyId } });
  await requireDatabase(userId, prop.databaseId);
  if (prop.isTitle) throw new DatabaseError("The Title property can't be deleted.");
  await db.$transaction([
    db.$executeRaw`UPDATE "pages" SET "values" = "values" - ${prop.id}::text WHERE "database_id" = ${prop.databaseId}`,
    db.databaseProperty.delete({ where: { id: propertyId } }),
  ]);
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
): Promise<{ rows: RowData[]; total: number }> {
  await requireDatabase(userId, databaseId, "VIEWER");
  if (!filterWithinLimits(opts.filter)) throw new DatabaseError("That filter is too large.");
  const props = await propertiesOf(databaseId);
  const ctx: CompileContext = { props: new Map(props.map((p) => [p.id, p])), today: /^\d{4}-\d{2}-\d{2}$/.test(opts.today) ? opts.today : new Date().toISOString().slice(0, 10) };
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
  return {
    rows: rows.map((r) => ({ id: r.id, title: r.title, icon: r.icon, thumbnail: r.thumbnail, values: r.values ?? {}, position: r.position, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString() })),
    total: Number(count[0]?.n ?? 0),
  };
}

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
  const page = await db.page.create({
    data: { workspaceId: database.workspaceId, databaseId, title, values: values as Prisma.InputJsonValue, searchText: buildSearchText(title, values, defs), position, createdById: userId, lastEditedById: userId },
  });
  await db.database.update({ where: { id: databaseId }, data: { updatedAt: new Date() } });
  return toRow(page);
}

/** Set property values (and/or the title) on one row. `null` clears a value. */
export async function updateRow(userId: string, pageId: string, patch: { title?: string; icon?: string | null; values?: Record<string, unknown> }) {
  const page = await requirePage(userId, pageId);
  if (!page.databaseId) throw new DatabaseError("Not a database row.");
  const defs = await propertiesOf(page.databaseId);
  const values = { ...((page.values ?? {}) as Record<string, PropertyValue>) };
  for (const [id, v] of Object.entries(patch.values ?? {})) {
    const def = defs.find((d) => d.id === id);
    if (!def || def.isTitle || COMPUTED_TYPES.includes(def.type)) continue;
    const clean = cleanValues(defs, { [id]: v })[id];
    if (clean === undefined) delete values[id];
    else values[id] = clean;
  }
  const title = patch.title !== undefined ? patch.title.slice(0, LIMITS.title) : page.title;
  const updated = await db.page.update({
    where: { id: pageId },
    data: {
      title,
      ...(patch.icon !== undefined ? { icon: patch.icon?.slice(0, 16) || null } : {}),
      values: values as Prisma.InputJsonValue,
      searchText: buildSearchText(title, values, defs, page.contentText),
      lastEditedById: userId,
    },
  });
  return toRow(updated);
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
  await requireDatabase(userId, databaseId);
  const r = await db.page.updateMany({ where: { id: { in: pageIds.slice(0, 1000) }, databaseId }, data: { archivedAt: archived ? new Date() : null } });
  return r.count;
}

export async function deleteRows(userId: string, databaseId: string, pageIds: string[]) {
  await requireDatabase(userId, databaseId);
  const r = await db.page.deleteMany({ where: { id: { in: pageIds.slice(0, 1000) }, databaseId } });
  return r.count;
}

export async function duplicateRow(userId: string, pageId: string) {
  const page = await requirePage(userId, pageId);
  if (!page.databaseId) throw new DatabaseError("Not a database row.");
  const next = await db.page.findMany({ where: { databaseId: page.databaseId, archivedAt: null }, select: { position: true } });
  const after = sortByPosition(next).find((n) => n.position > page.position)?.position ?? null;
  const copy = await db.page.create({
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
      values: page.values ?? {},
      searchText: page.searchText,
      position: generateKeyBetween(page.position, after),
      createdById: userId,
      lastEditedById: userId,
    },
  });
  return toRow(copy);
}

// ── Row pages ──────────────────────────────────────────────────────────────

export async function getPage(userId: string, pageId: string) {
  const page = await requirePage(userId, pageId, "VIEWER");
  const database = page.databaseId ? await getDatabase(userId, page.databaseId) : null;
  return { page, database };
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
