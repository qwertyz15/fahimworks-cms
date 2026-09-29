import "server-only";
import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";
import type { Prisma } from "@/generated/prisma/client";
import type { PropertyType as DbPropertyType, ViewType as DbViewType } from "@/generated/prisma/enums";
import { newId, validateConfig, validateValue, type PropertyConfig, type PropertyDef, type PropertyValue } from "@/lib/db-properties";
import type { FilterGroup, ViewConfig } from "@/lib/db-views";
import { PACKS, TEMPLATES, type DatabaseTemplate, type TemplatePack, type TemplateValue } from "@/lib/db-templates";
import { rollupResult } from "@/lib/db-rollup";
import { buildSearchText, createDatabase, DatabaseError } from "./service";
import { recomputeDatabase, syncResultTypes } from "./compute";
import { createRelationProperty, setRelation } from "./relations";

/** Turn simple body lines into a Tiptap document + HTML. */
function bodyFrom(lines: string[]): { doc: Prisma.InputJsonValue; html: string; text: string } {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const content: unknown[] = [];
  let html = "";
  let list: { type: "bullet" | "task"; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    if (list.type === "bullet") {
      content.push({ type: "bulletList", content: list.items.map((t) => ({ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] })) });
      html += `<ul>${list.items.map((t) => `<li><p>${esc(t)}</p></li>`).join("")}</ul>`;
    } else {
      content.push({ type: "taskList", content: list.items.map((t) => ({ type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] })) });
      html += `<ul data-type="taskList">${list.items.map((t) => `<li data-checked="false" data-type="taskItem"><label><input type="checkbox"><span></span></label><div><p>${esc(t)}</p></div></li>`).join("")}</ul>`;
    }
    list = null;
  };
  for (const line of lines) {
    const kind = line.startsWith("- ") ? "bullet" : line.startsWith("[ ] ") ? "task" : null;
    if (kind) {
      if (list && list.type !== kind) flush();
      list ??= { type: kind, items: [] };
      list.items.push(line.slice(kind === "bullet" ? 2 : 4));
      continue;
    }
    flush();
    if (line.startsWith("# ")) {
      content.push({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: line.slice(2) }] });
      html += `<h2>${esc(line.slice(2))}</h2>`;
    } else {
      content.push({ type: "paragraph", content: [{ type: "text", text: line }] });
      html += `<p>${esc(line)}</p>`;
    }
  }
  flush();
  return { doc: { type: "doc", content } as Prisma.InputJsonValue, html, text: lines.map((l) => l.replace(/^(# |- |\[ \] )/, "")).join(" ") };
}

function dateAt(today: string, days: number) {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

type Tx = Prisma.TransactionClient;

interface Built {
  databaseId: string;
  template: DatabaseTemplate;
  /** Property key → definition (the title is "title"; paired relations join under their pairedKey). */
  defs: Map<string, PropertyDef>;
  /** Row title → page id. */
  rows: Map<string, string>;
  /** Pages to create relation links on, once every row exists. */
  links: { pageId: string; key: string; titles: string[] }[];
  /** Views are made last: they can refer to any property. */
  views: { name: string; type: DbViewType; position: string; view: DatabaseTemplate["views"][number] }[];
  /** Where each relation goes in the property order. */
  relationPositions: Map<string, string>;
}

const RESULT_TYPES = new Set(["RELATION", "ROLLUP", "FORMULA"]);

/** Plain properties, views and rows of one template (relations, rollups and formulas come after). */
async function buildOne(tx: Tx, t: DatabaseTemplate, ctx: { databaseId: string; workspaceId: string; titleId: string }, userId: string, today: string): Promise<Built> {
  await tx.databaseProperty.update({ where: { id: ctx.titleId }, data: { name: t.titleName ?? "Name" } });
  const defs = new Map<string, PropertyDef>([["title", { id: ctx.titleId, name: t.titleName ?? "Name", type: "TITLE", config: {}, isTitle: true }]]);
  const keys = generateNKeysBetween(generateKeyBetween(null, null), null, t.properties.length);
  const relationPositions = new Map<string, string>();
  for (const [i, p] of t.properties.entries()) {
    const options = p.options?.map(([name, color, group]) => ({ id: newId(), name, color, ...(group ? { group } : {}) }));
    const base: PropertyConfig = validateConfig(p.type, { options, numberFormat: p.numberFormat, range: p.range });
    if (p.default !== undefined) {
      const d = typeof p.default === "string" && options ? options.find((o) => o.name === p.default)?.id : p.default;
      if (d !== undefined) base.default = d as PropertyValue;
    }
    // Relations are made in the second pass; rollups / formulas get their config then.
    if (p.type === "RELATION") {
      relationPositions.set(p.key, keys[i]!);
      continue;
    }
    const config = RESULT_TYPES.has(p.type) ? { ...(p.numberFormat ? { numberFormat: p.numberFormat } : {}), ...(p.formula !== undefined ? { formula: { expression: p.formula } } : {}) } : validateConfig(p.type, base);
    const row = await tx.databaseProperty.create({ data: { databaseId: ctx.databaseId, name: p.name, type: p.type as DbPropertyType, config: config as Prisma.InputJsonValue, position: keys[i]! } });
    defs.set(p.key, { id: row.id, name: p.name, type: p.type, config });
  }
  const viewKeys = generateNKeysBetween(null, null, t.views.length);
  const views: Built["views"] = t.views.map((v, i) => ({ name: v.name, type: v.type as DbViewType, position: viewKeys[i]!, view: v }));
  const rowKeys = generateNKeysBetween(null, null, t.rows.length);
  const rows = new Map<string, string>();
  const links: Built["links"] = [];
  for (const [i, r] of t.rows.entries()) {
    const values: Record<string, PropertyValue> = {};
    for (const p of t.properties) {
      const def = defs.get(p.key);
      if (p.default !== undefined && def?.config.default !== undefined) values[def.id] = def.config.default;
    }
    for (const [k, raw] of Object.entries(r.values ?? {})) {
      const prop = t.properties.find((p) => p.key === k);
      if (prop?.type === "RELATION") {
        if (Array.isArray(raw)) links.push({ pageId: "", key: k, titles: raw as string[] });
        continue;
      }
      const def = defs.get(k);
      if (!def) continue;
      const v = raw as TemplateValue;
      const conv =
        typeof v === "object" && !Array.isArray(v)
          ? { start: dateAt(today, v.days), ...(v.endDays !== undefined ? { end: dateAt(today, v.endDays) } : {}) }
          : typeof v === "string" && def.config.options
            ? def.config.options.find((o) => o.name === v)?.id
            : Array.isArray(v) && def.config.options
              ? v.map((n) => def.config.options!.find((o) => o.name === n)?.id).filter(Boolean)
              : v;
      const clean = validateValue(def, conv);
      if (clean !== null) values[def.id] = clean;
    }
    for (const k of ["assignee", "owner", "attendees", "by"]) if (defs.get(k)?.type === "PERSON" && i % 2 === 0) values[defs.get(k)!.id] = [userId];
    const body = r.body ? bodyFrom(r.body) : null;
    const page = await tx.page.create({
      data: {
        workspaceId: ctx.workspaceId,
        databaseId: ctx.databaseId,
        title: r.title,
        icon: r.icon ?? null,
        values: values as Prisma.InputJsonValue,
        ...(body ? { body: body.doc, contentHtml: body.html, contentText: body.text } : {}),
        searchText: buildSearchText(r.title, values, [...defs.values()], body?.text),
        position: rowKeys[i]!,
        createdById: userId,
        lastEditedById: userId,
      },
      select: { id: true },
    });
    rows.set(r.title, page.id);
    for (const l of links) if (!l.pageId) l.pageId = page.id;
  }
  return { databaseId: ctx.databaseId, template: t, defs, rows, links, views, relationPositions };
}

async function createViews(tx: Tx, b: Built) {
  const idOf = (k: string) => b.defs.get(k)?.id;
  for (const { name, type, position, view: v } of b.views) {
    const filter: FilterGroup | null = v.filter?.length
      ? {
          kind: "group",
          id: newId(),
          op: "and",
          children: v.filter.flatMap(([k, operator, value]) => {
            const def = b.defs.get(k);
            if (!def) return [];
            const optId = typeof value === "string" ? def.config.options?.find((o) => o.name === value)?.id : undefined;
            return [{ kind: "rule" as const, id: newId(), propertyId: def.id, operator: operator as never, ...(value !== undefined ? { value: optId ?? value } : {}) }];
          }),
        }
      : null;
    const config: ViewConfig = {
      ...(filter ? { filter } : {}),
      ...(v.sorts ? { sorts: v.sorts.flatMap(([k, direction]) => (idOf(k) ? [{ propertyId: idOf(k)!, direction }] : [])) } : {}),
      ...(v.groupBy ? { groupBy: idOf(v.groupBy) ?? null } : {}),
      ...(v.hidden ? { hidden: v.hidden.map(idOf).filter(Boolean) as string[] } : {}),
      ...(v.dateBy ? { dateBy: idOf(v.dateBy) ?? null } : {}),
      ...(v.endBy ? { endBy: idOf(v.endBy) ?? null } : {}),
      ...(v.scale ? { scale: v.scale } : {}),
      ...(v.cover ? { cover: v.cover === "page" ? "page" : (idOf(v.cover) ?? null) } : {}),
      ...(v.cardSize ? { cardSize: v.cardSize } : {}),
    };
    await tx.databaseView.create({ data: { databaseId: b.databaseId, name, type, position, config: config as Prisma.InputJsonValue } });
  }
}

/** Relations (with their paired side), then rollups, links between sample rows, formulas, views; then calculate. */
async function linkUp(tx: Tx, built: Built[], workspaceId: string) {
  const byRef = new Map(built.map((b) => [b.template.ref ?? b.template.key, b]));
  const target = (b: Built, to: string) => (to === "self" ? b : byRef.get(to));
  for (const b of built) {
    for (const p of b.template.properties.filter((x) => x.type === "RELATION" && x.relation)) {
      const other = target(b, p.relation!.to);
      if (!other) throw new DatabaseError(`Template relation to unknown database “${p.relation!.to}”.`);
      const def = await createRelationProperty(tx, {
        databaseId: b.databaseId,
        workspaceId,
        name: p.name,
        position: b.relationPositions.get(p.key)!,
        relation: { databaseId: other.databaseId, limit: p.relation!.limit ?? "many", twoWay: Boolean(p.relation!.pairedKey), pairedName: p.relation!.pairedName },
      });
      b.defs.set(p.key, def);
      const pairedId = def.config.relation?.pairedId;
      if (pairedId && p.relation!.pairedKey) {
        const paired = await tx.databaseProperty.findUniqueOrThrow({ where: { id: pairedId } });
        other.defs.set(p.relation!.pairedKey, { id: paired.id, name: paired.name, type: "RELATION", config: (paired.config ?? {}) as PropertyConfig });
      }
    }
  }
  for (const b of built) {
    for (const p of b.template.properties.filter((x) => x.type === "ROLLUP" && x.rollup)) {
      const def = b.defs.get(p.key)!;
      const rel = b.defs.get(p.rollup!.relation);
      const other = rel?.config.relation ? built.find((x) => x.databaseId === rel.config.relation!.databaseId) : undefined;
      const targetDef = other?.defs.get(p.rollup!.target);
      if (!rel || !targetDef) throw new DatabaseError(`Template rollup “${p.name}” can't find its relation or property.`);
      const config: PropertyConfig = { ...def.config, rollup: { relationId: rel.id, targetId: targetDef.id, fn: p.rollup!.fn }, ...rollupResult(p.rollup!.fn, targetDef), ...(p.numberFormat ? { numberFormat: p.numberFormat } : {}) };
      await tx.databaseProperty.update({ where: { id: def.id }, data: { config: config as unknown as Prisma.InputJsonValue } });
      b.defs.set(p.key, { ...def, config });
    }
  }
  for (const b of built) {
    for (const l of b.links) {
      const def = b.defs.get(l.key);
      const other = def?.config.relation ? built.find((x) => x.databaseId === def.config.relation!.databaseId) : undefined;
      if (!def || !other) continue;
      const ids = l.titles.map((t) => other.rows.get(t)).filter((x): x is string => !!x);
      const page = await tx.page.findUniqueOrThrow({ where: { id: l.pageId } });
      await setRelation(tx, page, def, ids);
    }
  }
  for (const b of built) {
    await createViews(tx, b);
    await syncResultTypes(tx, b.databaseId);
  }
  for (const b of built) await recomputeDatabase(tx, b.databaseId);
}

/** Create a database (or a pack of linked ones) from a template: properties, views and sample rows, in one transaction. */
export async function createFromTemplate(userId: string, key: string, today: string) {
  const pack: TemplatePack | undefined = PACKS.find((x) => x.key === key);
  const single: DatabaseTemplate | undefined = TEMPLATES.find((x) => x.key === key);
  const list = pack ? pack.databases : single ? [single] : null;
  if (!list) throw new DatabaseError("Unknown template.");
  const [first, ...rest] = list;
  return createDatabase(userId, { title: first!.name, description: first!.description, icon: first!.icon, templateKey: pack ? pack.key : first!.key }, async (tx, ctx) => {
    const built = [await buildOne(tx, first!, ctx, userId, today)];
    for (const t of rest) {
      const database = await tx.database.create({ data: { workspaceId: ctx.workspaceId, title: t.name, description: t.description, icon: t.icon, templateKey: pack!.key, createdById: userId } });
      const title = await tx.databaseProperty.create({ data: { databaseId: database.id, name: t.titleName ?? "Name", type: "TITLE", isTitle: true, position: generateKeyBetween(null, null) } });
      built.push(await buildOne(tx, t, { databaseId: database.id, workspaceId: ctx.workspaceId, titleId: title.id }, userId, today));
    }
    await linkUp(tx, built, ctx.workspaceId);
  });
}
