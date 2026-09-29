import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { PropertyDef } from "@/lib/db-properties";
import {
  MAX_FILTER_DEPTH,
  MAX_FILTER_RULES,
  operatorsFor,
  resolveDate,
  resolveRange,
  type DateFilterValue,
  type FilterNode,
  type FilterRule,
  type SortRule,
  type DateWindow,
} from "@/lib/db-views";

/**
 * Filter / sort compiler: a view's filter tree and sorts → parameterised SQL
 * over pages.values (JSONB). Every user value is a bound parameter; property
 * ids are validated tokens and are bound too. Unknown properties/operators
 * are ignored (the rule simply doesn't apply).
 */

const { sql, join, empty, raw } = Prisma;
const TRUE = sql`TRUE`;
const FALSE = sql`FALSE`;

export interface CompileContext {
  props: Map<string, PropertyDef>;
  /** Viewer's local date, YYYY-MM-DD (relative dates resolve against it). */
  today: string;
}

const json = (id: string) => sql`(p."values" -> ${id}::text)`;
const text = (id: string) => sql`(p."values" ->> ${id}::text)`;
const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

function textExpr(def: PropertyDef) {
  return def.isTitle || def.type === "TITLE" ? sql`p."title"` : text(def.id);
}

/** A date expression (YYYY-MM-DD text) for date-like properties. */
function dateExpr(def: PropertyDef) {
  if (def.type === "CREATED_TIME") return sql`to_char(p."created_at", 'YYYY-MM-DD')`;
  if (def.type === "LAST_EDITED_TIME") return sql`to_char(p."updated_at", 'YYYY-MM-DD')`;
  return sql`(p."values" -> ${def.id}::text ->> 'start')`;
}

function numberExpr(id: string) {
  return sql`(CASE WHEN jsonb_typeof(${json(id)}) = 'number' THEN (${text(id)})::numeric END)`;
}

function isEmpty(def: PropertyDef) {
  if (def.isTitle || def.type === "TITLE") return sql`(p."title" = '')`;
  return sql`(${json(def.id)} IS NULL OR ${json(def.id)} = 'null'::jsonb OR ${json(def.id)} = '[]'::jsonb OR ${json(def.id)} = '""'::jsonb)`;
}

function compileRule(rule: FilterRule, ctx: CompileContext): Prisma.Sql | null {
  const def = ctx.props.get(rule.propertyId);
  if (!def || !operatorsFor(def.type).includes(rule.operator)) return null;
  const op = rule.operator;
  const v = rule.value;
  if (op === "is_empty") return isEmpty(def);
  if (op === "is_not_empty") return sql`NOT ${isEmpty(def)}`;

  switch (def.type) {
    case "TITLE":
    case "TEXT":
    case "URL":
    case "EMAIL":
    case "PHONE": {
      if (typeof v !== "string") return null;
      const e = sql`COALESCE(${textExpr(def)}, '')`;
      const like = (pattern: string) => sql`${e} ILIKE ${pattern} ESCAPE '\\'`;
      switch (op) {
        case "contains":
          return like(`%${escapeLike(v)}%`);
        case "not_contains":
          return sql`NOT ${like(`%${escapeLike(v)}%`)}`;
        case "starts_with":
          return like(`${escapeLike(v)}%`);
        case "ends_with":
          return like(`%${escapeLike(v)}`);
        case "equals":
          return sql`lower(${e}) = lower(${v})`;
        case "not_equals":
          return sql`lower(${e}) <> lower(${v})`;
      }
      return null;
    }
    case "NUMBER": {
      const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
      if (!Number.isFinite(n)) return null;
      const e = numberExpr(def.id);
      const cmp = { equals: "=", not_equals: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" }[op as "equals"];
      if (!cmp) return null;
      // Operator comes from a fixed map, never from input.
      return op === "not_equals" ? sql`(${e} IS NULL OR ${e} <> ${n})` : sql`${e} ${raw(cmp)} ${n}`;
    }
    case "SELECT":
    case "STATUS": {
      if (op === "group_is") {
        const ids = (def.config.options ?? []).filter((o) => o.group === v).map((o) => o.id);
        return ids.length ? sql`${text(def.id)} = ANY(${ids}::text[])` : FALSE;
      }
      if (typeof v !== "string") return null;
      return op === "is" ? sql`${text(def.id)} = ${v}` : sql`(${text(def.id)} IS NULL OR ${text(def.id)} <> ${v})`;
    }
    case "MULTI_SELECT":
    case "PERSON": {
      if (typeof v !== "string") return null;
      const has = sql`COALESCE(${json(def.id)}, '[]'::jsonb) @> ${JSON.stringify([v])}::jsonb`;
      return op === "contains" ? has : sql`NOT ${has}`;
    }
    case "CHECKBOX": {
      const checked = sql`(${json(def.id)} = 'true'::jsonb)`;
      return op === "checked" ? checked : sql`NOT ${checked}`;
    }
    case "DATE":
    case "CREATED_TIME":
    case "LAST_EDITED_TIME": {
      const e = dateExpr(def);
      const dv = (typeof v === "object" && v !== null ? v : undefined) as DateFilterValue | undefined;
      if (op === "within") {
        const r = resolveRange(dv?.range, ctx.today);
        return r ? sql`(${e} >= ${r[0]} AND ${e} <= ${r[1]})` : null;
      }
      const d = resolveDate(dv, ctx.today);
      if (!d) return null;
      const cmp = { is: "=", before: "<", after: ">", on_or_before: "<=", on_or_after: ">=" }[op as "is"];
      return cmp ? sql`${e} ${raw(cmp)} ${d}` : null;
    }
    case "FILES":
      return null;
  }
}

/** Compile a filter tree to a WHERE fragment (TRUE when there's nothing to filter). */
export function compileFilter(node: FilterNode | null | undefined, ctx: CompileContext): Prisma.Sql {
  let rules = 0;
  const walk = (n: FilterNode, depth: number): Prisma.Sql | null => {
    if (n.kind === "rule") return ++rules > MAX_FILTER_RULES ? null : compileRule(n, ctx);
    if (depth > MAX_FILTER_DEPTH) return null;
    const parts = n.children.map((c) => walk(c, depth + 1)).filter((p): p is Prisma.Sql => p !== null);
    if (!parts.length) return null;
    return sql`(${join(parts, n.op === "or" ? " OR " : " AND ")})`;
  };
  return (node && walk(node, 1)) ?? TRUE;
}

/** ORDER BY fragment: the view's sorts, then manual order. */
export function compileSorts(sorts: SortRule[] | undefined, ctx: CompileContext): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  for (const s of sorts ?? []) {
    const def = ctx.props.get(s.propertyId);
    if (!def) continue;
    const dir = raw(s.direction === "desc" ? "DESC" : "ASC");
    let e: Prisma.Sql;
    switch (def.type) {
      case "NUMBER":
        e = numberExpr(def.id);
        break;
      case "SELECT":
      case "STATUS":
        // Option order, not alphabetical.
        e = sql`array_position(${(def.config.options ?? []).map((o) => o.id)}::text[], ${text(def.id)})`;
        break;
      case "DATE":
        e = sql`(p."values" -> ${def.id}::text ->> 'start')`;
        break;
      case "CREATED_TIME":
        e = sql`p."created_at"`;
        break;
      case "LAST_EDITED_TIME":
        e = sql`p."updated_at"`;
        break;
      case "CHECKBOX":
        e = sql`(${json(def.id)} = 'true'::jsonb)`;
        break;
      case "MULTI_SELECT":
      case "PERSON":
      case "FILES":
        e = sql`jsonb_array_length(COALESCE(${json(def.id)}, '[]'::jsonb))`;
        break;
      default:
        e = sql`lower(${textExpr(def)})`;
    }
    parts.push(sql`${e} ${dir} NULLS LAST`);
  }
  // Fractional keys compare byte-wise (mixed case): never by the locale collation.
  parts.push(sql`p."position" COLLATE "C" ASC`, sql`p."id" ASC`);
  return join(parts, ", ");
}

/** WHERE fragment for the search box (title, property values, page text). */
export function compileSearch(q: string | undefined): Prisma.Sql {
  const t = q?.trim();
  if (!t) return empty;
  const pattern = `%${escapeLike(t.slice(0, 200))}%`;
  return sql`AND (p."title" ILIKE ${pattern} ESCAPE '\\' OR COALESCE(p."search_text", '') ILIKE ${pattern} ESCAPE '\\')`;
}

/** Start / end date expressions for a date-like property (range end falls back to start). */
function dateRangeExprs(def: PropertyDef, endDef?: PropertyDef) {
  const start = dateExpr(def);
  const end = endDef ? dateExpr(endDef) : def.type === "DATE" ? sql`(p."values" -> ${def.id}::text ->> 'end')` : start;
  return { start, end: sql`COALESCE(${end}, ${start})` };
}

const DATE_LIKE = new Set(["DATE", "CREATED_TIME", "LAST_EDITED_TIME"]);

/**
 * Rows overlapping [from, to] (calendar month, timeline span): start <= to AND end >= from.
 * Returns null when the property isn't a date.
 */
export function compileWindow(w: DateWindow, ctx: CompileContext): Prisma.Sql | null {
  const def = ctx.props.get(w.propertyId);
  if (!def || !DATE_LIKE.has(def.type)) return null;
  const endDef = w.endPropertyId ? ctx.props.get(w.endPropertyId) : undefined;
  const { start, end } = dateRangeExprs(def, endDef && endDef.type === "DATE" ? endDef : undefined);
  return sql`(${start} IS NOT NULL AND ${start} <= ${w.to} AND ${end} >= ${w.from})`;
}

/** Rows with no value for a date property (the "No date" tray). */
export function compileUndated(propertyId: string, ctx: CompileContext): Prisma.Sql | null {
  const def = ctx.props.get(propertyId);
  if (!def || def.type !== "DATE") return null;
  return sql`(${dateExpr(def)} IS NULL)`;
}
