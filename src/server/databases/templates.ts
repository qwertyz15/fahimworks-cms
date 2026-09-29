import "server-only";
import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";
import type { Prisma } from "@/generated/prisma/client";
import type { PropertyType as DbPropertyType, ViewType as DbViewType } from "@/generated/prisma/enums";
import { newId, validateConfig, validateValue, type PropertyConfig, type PropertyDef, type PropertyValue } from "@/lib/db-properties";
import type { FilterGroup, ViewConfig } from "@/lib/db-views";
import { TEMPLATES, type DatabaseTemplate, type TemplateValue } from "@/lib/db-templates";
import { buildSearchText, createDatabase, DatabaseError } from "./service";

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

/** Create a database from a template: properties, views and sample rows, in one transaction. */
export async function createFromTemplate(userId: string, key: string, today: string) {
  const t: DatabaseTemplate | undefined = TEMPLATES.find((x) => x.key === key);
  if (!t) throw new DatabaseError("Unknown template.");
  return createDatabase(userId, { title: t.name, description: t.description, icon: t.icon, templateKey: t.key }, async (tx, ctx) => {
    await tx.databaseProperty.update({ where: { id: ctx.titleId }, data: { name: t.titleName ?? "Name" } });
    const defs = new Map<string, PropertyDef>();
    const keys = generateNKeysBetween(generateKeyBetween(null, null), null, t.properties.length);
    for (const [i, p] of t.properties.entries()) {
      const options = p.options?.map(([name, color, group]) => ({ id: newId(), name, color, ...(group ? { group } : {}) }));
      const base: PropertyConfig = validateConfig(p.type, { options, numberFormat: p.numberFormat, range: p.range });
      if (p.default !== undefined) {
        const d = typeof p.default === "string" && options ? options.find((o) => o.name === p.default)?.id : p.default;
        if (d !== undefined) base.default = d as PropertyValue;
      }
      const config = validateConfig(p.type, base);
      const row = await tx.databaseProperty.create({ data: { databaseId: ctx.databaseId, name: p.name, type: p.type as DbPropertyType, config: config as Prisma.InputJsonValue, position: keys[i]! } });
      defs.set(p.key, { id: row.id, name: p.name, type: p.type, config });
    }
    const idOf = (k: string) => defs.get(k)?.id;
    const viewKeys = generateNKeysBetween(null, null, t.views.length);
    for (const [i, v] of t.views.entries()) {
      const filter: FilterGroup | null = v.filter?.length
        ? {
            kind: "group",
            id: newId(),
            op: "and",
            children: v.filter.flatMap(([k, operator, value]) => {
              const def = defs.get(k);
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
      };
      await tx.databaseView.create({ data: { databaseId: ctx.databaseId, name: v.name, type: v.type as DbViewType, position: viewKeys[i]!, config: config as Prisma.InputJsonValue } });
    }
    const rowKeys = generateNKeysBetween(null, null, t.rows.length);
    const allDefs = [...defs.values()];
    for (const [i, r] of t.rows.entries()) {
      const values: Record<string, PropertyValue> = {};
      for (const p of t.properties) if (p.default !== undefined) {
        const def = defs.get(p.key)!;
        if (def.config.default !== undefined) values[def.id] = def.config.default;
      }
      for (const [k, raw] of Object.entries(r.values ?? {})) {
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
      if (defs.get("assignee") || defs.get("owner") || defs.get("attendees")) {
        for (const k of ["assignee", "owner", "attendees"]) if (defs.get(k) && i % 2 === 0) values[defs.get(k)!.id] = [userId];
      }
      const body = r.body ? bodyFrom(r.body) : null;
      await tx.page.create({
        data: {
          workspaceId: ctx.workspaceId,
          databaseId: ctx.databaseId,
          title: r.title,
          icon: r.icon ?? null,
          values: values as Prisma.InputJsonValue,
          ...(body ? { body: body.doc, contentHtml: body.html, contentText: body.text } : {}),
          searchText: buildSearchText(r.title, values, allDefs, body?.text),
          position: rowKeys[i]!,
          createdById: userId,
          lastEditedById: userId,
        },
      });
    }
  });
}
