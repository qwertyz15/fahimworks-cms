"use server";

import { updateTag } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { PROPERTY_TYPES, type PropertyDef } from "@/lib/db-properties";
import { VIEW_TYPES, dateWindowSchema, filterNodeSchema, viewConfigSchema, type FilterGroup, type ViewConfig } from "@/lib/db-views";
import { NOTEBOOK_MAX_BYTES } from "@/lib/validation";
import * as svc from "@/server/databases/service";
import { createFromTemplate } from "@/server/databases/templates";
import { deleteArticlesOf, publishPage, publishState, unpublishPage, updateLive, type PublishState } from "@/server/databases/publish";
import { TIMELINE_TAG } from "@/server/queries/public";
import { adminAction, type ActionResult } from "./result";

/*
 * Workspace database actions. Each re-checks the session (adminAction) and
 * the workspace membership (service layer), validates input with zod and
 * returns plain data. Dashboard pages load fresh data on navigation.
 */

const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const ids = z.array(id).min(1).max(1000);
const today = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const values = z.record(id, z.unknown());
const nullableId = id.nullable().optional();

type Res<T> = Promise<ActionResult<T>>;

// ── Databases ──
export async function createDatabaseAction(payload: unknown): Res<{ id: string }> {
  return adminAction(async (user) => {
    const input = z.object({ templateKey: z.string().max(40).nullable().optional(), title: z.string().max(200).optional(), today }).parse(payload);
    const d = input.templateKey ? await createFromTemplate(user.id, input.templateKey, input.today) : await svc.createDatabase(user.id, { title: input.title });
    return { ok: true, data: { id: d.id } };
  });
}

export async function updateDatabaseAction(payload: unknown): Res<undefined> {
  return adminAction(async (user) => {
    const input = z.object({ id, title: z.string().max(200).optional(), description: z.string().max(2000).nullable().optional(), icon: z.string().max(16).nullable().optional(), coverImage: z.string().max(2048).nullable().optional() }).parse(payload);
    await svc.updateDatabase(user.id, input.id, input);
    return { ok: true };
  });
}

export async function duplicateDatabaseAction(payload: unknown): Res<{ id: string }> {
  return adminAction(async (user) => {
    const input = z.object({ id, withRows: z.boolean().default(true) }).parse(payload);
    const d = await svc.duplicateDatabase(user.id, input.id, input.withRows);
    return { ok: true, data: { id: d.id } };
  });
}

export async function archiveDatabaseAction(payload: unknown): Res<undefined> {
  return adminAction(async (user) => {
    const input = z.object({ id, archived: z.boolean() }).parse(payload);
    await svc.setDatabaseArchived(user.id, input.id, input.archived);
    return { ok: true, message: input.archived ? "Database archived." : "Database restored." };
  });
}

export async function deleteDatabaseAction(payload: unknown): Res<undefined> {
  return adminAction(async (user) => {
    const dbId = z.object({ id }).parse(payload).id;
    await svc.requireDatabase(user.id, dbId, "OWNER");
    // Articles published from its pages go too.
    if (await deleteArticlesOf(user.id, { databaseId: dbId })) updateTag(TIMELINE_TAG);
    await svc.deleteDatabase(user.id, dbId);
    return { ok: true, message: "Database deleted." };
  });
}

// ── Properties ──
export async function addPropertyAction(payload: unknown): Res<PropertyDef> {
  return adminAction(async (user) => {
    const input = z
      .object({
        databaseId: id,
        name: z.string().max(100),
        type: z.enum(PROPERTY_TYPES),
        afterId: nullableId,
        config: z.record(z.string(), z.unknown()).optional(),
        relation: z.object({ databaseId: id, limit: z.enum(["one", "many"]), twoWay: z.boolean(), pairedName: z.string().max(100).optional() }).optional(),
      })
      .parse(payload);
    return { ok: true, data: await svc.addProperty(user.id, input.databaseId, input) };
  });
}

export async function updatePropertyAction(payload: unknown): Res<PropertyDef> {
  return adminAction(async (user) => {
    const input = z.object({ id, name: z.string().max(100).optional(), config: z.record(z.string(), z.unknown()).optional(), twoWay: z.boolean().optional(), pairedName: z.string().max(100).optional() }).parse(payload);
    return { ok: true, data: await svc.updateProperty(user.id, input.id, input) };
  });
}

export async function changePropertyTypeAction(payload: unknown): Res<PropertyDef> {
  return adminAction(async (user) => {
    const input = z.object({ id, type: z.enum(PROPERTY_TYPES) }).parse(payload);
    return { ok: true, data: await svc.changePropertyType(user.id, input.id, input.type) };
  });
}

export async function deletePropertyAction(payload: unknown): Res<undefined> {
  return adminAction(async (user) => {
    await svc.deleteProperty(user.id, z.object({ id }).parse(payload).id);
    return { ok: true };
  });
}

export async function movePropertyAction(payload: unknown): Res<undefined> {
  return adminAction(async (user) => {
    const input = z.object({ id, beforeId: nullableId, afterId: nullableId }).parse(payload);
    await svc.moveProperty(user.id, input.id, input.beforeId ?? null, input.afterId ?? null);
    return { ok: true };
  });
}

// ── Views ──
export async function createViewAction(payload: unknown): Res<{ id: string; name: string; type: (typeof VIEW_TYPES)[number]; config: ViewConfig }> {
  return adminAction(async (user) => {
    const input = z.object({ databaseId: id, type: z.enum(VIEW_TYPES), name: z.string().max(100).optional(), config: viewConfigSchema.optional() }).parse(payload);
    return { ok: true, data: await svc.createView(user.id, input.databaseId, { ...input, config: input.config as ViewConfig | undefined }) };
  });
}

export async function updateViewAction(payload: unknown): Res<undefined> {
  return adminAction(async (user) => {
    const input = z.object({ id, name: z.string().max(100).optional(), config: viewConfigSchema.optional() }).parse(payload);
    await svc.updateView(user.id, input.id, { name: input.name, config: input.config as ViewConfig | undefined });
    return { ok: true };
  });
}

export async function deleteViewAction(payload: unknown): Res<undefined> {
  return adminAction(async (user) => {
    await svc.deleteView(user.id, z.object({ id }).parse(payload).id);
    return { ok: true };
  });
}

// ── Rows ──
export async function queryRowsAction(payload: unknown): Res<{ rows: svc.RowData[]; total: number; related: Record<string, svc.RelatedPage> }> {
  return adminAction(async (user) => {
    const input = z
      .object({
        databaseId: id,
        filter: filterNodeSchema.nullable().optional(),
        sorts: z.array(z.object({ propertyId: id, direction: z.enum(["asc", "desc"]) })).max(10).optional(),
        search: z.string().max(200).optional(),
        today,
        offset: z.number().int().min(0).max(1_000_000).optional(),
        archived: z.boolean().optional(),
        window: dateWindowSchema.nullable().optional(),
        undatedBy: id.nullable().optional(),
      })
      .parse(payload);
    const filter = input.filter && input.filter.kind === "group" ? (input.filter as FilterGroup) : null;
    return { ok: true, data: await svc.queryRows(user.id, input.databaseId, { ...input, filter }) };
  });
}

export async function createRowAction(payload: unknown): Res<svc.RowWrite> {
  return adminAction(async (user) => {
    const input = z.object({ databaseId: id, title: z.string().max(300).optional(), values: values.optional(), afterId: nullableId, beforeId: nullableId }).parse(payload);
    return { ok: true, data: await svc.createRow(user.id, input.databaseId, input) };
  });
}

export async function updateRowAction(payload: unknown): Res<svc.RowWrite> {
  return adminAction(async (user) => {
    const input = z.object({ id, title: z.string().max(300).optional(), icon: z.string().max(16).nullable().optional(), values: values.optional() }).parse(payload);
    return { ok: true, data: await svc.updateRow(user.id, input.id, input) };
  });
}

export async function moveRowAction(payload: unknown): Res<svc.RowData> {
  return adminAction(async (user) => {
    const input = z.object({ id, beforeId: nullableId, afterId: nullableId, set: values.optional() }).parse(payload);
    return { ok: true, data: await svc.moveRow(user.id, input.id, input) };
  });
}

export async function duplicateRowAction(payload: unknown): Res<svc.RowData> {
  return adminAction(async (user) => ({ ok: true, data: await svc.duplicateRow(user.id, z.object({ id }).parse(payload).id) }));
}

export async function archiveRowsAction(payload: unknown): Res<number> {
  return adminAction(async (user) => {
    const input = z.object({ databaseId: id, ids, archived: z.boolean() }).parse(payload);
    return { ok: true, data: await svc.setRowsArchived(user.id, input.databaseId, input.ids, input.archived) };
  });
}

export async function deleteRowsAction(payload: unknown): Res<number> {
  return adminAction(async (user) => {
    const input = z.object({ databaseId: id, ids }).parse(payload);
    await svc.requireDatabase(user.id, input.databaseId);
    if (await deleteArticlesOf(user.id, { databaseId: input.databaseId, id: { in: input.ids } })) updateTag(TIMELINE_TAG);
    return { ok: true, data: await svc.deleteRows(user.id, input.databaseId, input.ids) };
  });
}

export async function bulkUpdateAction(payload: unknown): Res<number> {
  return adminAction(async (user) => {
    const input = z.object({ databaseId: id, ids, propertyId: id, value: z.unknown() }).parse(payload);
    return { ok: true, data: await svc.bulkUpdate(user.id, input.databaseId, input.ids, input.propertyId, input.value) };
  });
}

// ── Relations ──
/** Databases a relation can point at (for the property menu). */
export async function listDatabasesAction(): Res<{ id: string; title: string; icon: string | null }[]> {
  return adminAction(async (user) => {
    const rows = await svc.listDatabases(user.id);
    return { ok: true, data: rows.map((r) => ({ id: r.id, title: r.title, icon: r.icon })) };
  });
}

/** Another database's properties (rollup set-up). */
export async function databasePropertiesAction(payload: unknown): Res<{ title: string; properties: PropertyDef[] }> {
  return adminAction(async (user) => {
    const d = await svc.getDatabase(user.id, z.object({ id }).parse(payload).id);
    return { ok: true, data: { title: d.database.title, properties: d.properties } };
  });
}

/** Rows of the relation's target database matching a search (the link picker). */
export async function searchRelationTargetsAction(payload: unknown): Res<{ id: string; title: string; icon: string | null }[]> {
  return adminAction(async (user) => {
    const input = z.object({ databaseId: id, q: z.string().max(200).default(""), ids: z.array(id).max(500).optional() }).parse(payload);
    return { ok: true, data: await svc.searchRows(user.id, input.databaseId, input.q, input.ids) };
  });
}

// ── Row pages ──
export async function savePageAction(payload: unknown): Res<{ id: string; updatedAt: string; words: number }> {
  return adminAction(async (user) => {
    const input = z
      .object({ id, bodyJson: z.string().max(NOTEBOOK_MAX_BYTES), html: z.string().max(NOTEBOOK_MAX_BYTES), coverImage: z.string().max(2048).nullable().optional() })
      .parse(payload);
    let body: Prisma.InputJsonValue;
    try {
      body = JSON.parse(input.bodyJson) as Prisma.InputJsonValue;
    } catch {
      return { ok: false, error: "The page could not be read. Reload and try again." };
    }
    if (!body || typeof body !== "object" || (body as { type?: string }).type !== "doc") return { ok: false, error: "Invalid page content." };
    return { ok: true, data: await svc.savePageBody(user.id, input.id, { body, html: input.html, coverImage: input.coverImage }) };
  });
}

// ── Peek / publish ──
export interface PageData {
  page: { id: string; title: string; icon: string | null; coverImage: string | null; body: unknown; values: Record<string, unknown>; createdAt: string; updatedAt: string };
  database: { id: string; title: string; icon: string | null } | null;
  properties: PropertyDef[];
  people: { id: string; name: string }[];
  publish: PublishState | null;
  related: Record<string, svc.RelatedPage>;
}

/** Everything the peek panel needs to show and edit a row page. */
export async function getPageAction(payload: unknown): Res<PageData> {
  return adminAction(async (user) => {
    const { page, database, related } = await svc.getPage(user.id, z.object({ id }).parse(payload).id);
    return {
      ok: true,
      data: {
        page: { id: page.id, title: page.title, icon: page.icon, coverImage: page.coverImage, body: page.body ?? null, values: (page.values ?? {}) as Record<string, unknown>, createdAt: page.createdAt.toISOString(), updatedAt: page.updatedAt.toISOString() },
        database: database ? { id: database.database.id, title: database.database.title, icon: database.database.icon } : null,
        properties: database?.properties ?? [],
        people: database?.people ?? [],
        publish: await publishState(page.id),
        related,
      },
    };
  });
}

export async function publishPageAction(payload: unknown): Res<PublishState | null> {
  return adminAction(async (user) => {
    const input = z.object({ id, slug: z.string().max(80).nullable().optional(), tagsFrom: id.nullable().optional() }).parse(payload);
    const state = await publishPage(user.id, input.id, input);
    updateTag(TIMELINE_TAG);
    return { ok: true, data: state, message: "Published to your timeline." };
  });
}

export async function updateLiveAction(payload: unknown): Res<PublishState | null> {
  return adminAction(async (user) => {
    const state = await updateLive(user.id, z.object({ id }).parse(payload).id);
    updateTag(TIMELINE_TAG);
    return { ok: true, data: state, message: "The live article is up to date." };
  });
}

export async function unpublishPageAction(payload: unknown): Res<PublishState | null> {
  return adminAction(async (user) => {
    const state = await unpublishPage(user.id, z.object({ id }).parse(payload).id);
    updateTag(TIMELINE_TAG);
    return { ok: true, data: state, message: "Removed from your timeline (kept as a draft)." };
  });
}
