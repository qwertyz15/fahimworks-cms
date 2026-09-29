import { z } from "zod";
import type { PropertyType } from "./db-properties";

/**
 * Database views: filter trees (AND/OR, nested), sorts and layout settings.
 * Shared by the UI (menus) and the server (validation + SQL compiler).
 */

export const VIEW_TYPES = ["TABLE", "BOARD", "LIST", "CALENDAR", "TIMELINE", "GALLERY"] as const;
export type ViewType = (typeof VIEW_TYPES)[number];
/** Views available in this phase. */
export const ENABLED_VIEW_TYPES: ViewType[] = ["TABLE", "BOARD", "LIST"];

export const OPERATORS = [
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "starts_with",
  "ends_with",
  "is_empty",
  "is_not_empty",
  "gt",
  "gte",
  "lt",
  "lte",
  "is",
  "is_not",
  "before",
  "after",
  "on_or_before",
  "on_or_after",
  "within",
  "checked",
  "unchecked",
  "group_is",
] as const;
export type Operator = (typeof OPERATORS)[number];

export const OPERATOR_LABELS: Record<Operator, string> = {
  equals: "is",
  not_equals: "is not",
  contains: "contains",
  not_contains: "does not contain",
  starts_with: "starts with",
  ends_with: "ends with",
  is_empty: "is empty",
  is_not_empty: "is not empty",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  is: "is",
  is_not: "is not",
  before: "is before",
  after: "is after",
  on_or_before: "is on or before",
  on_or_after: "is on or after",
  within: "is within",
  checked: "is checked",
  unchecked: "is not checked",
  group_is: "is in group",
};

const TEXTISH: Operator[] = ["contains", "not_contains", "equals", "not_equals", "starts_with", "ends_with", "is_empty", "is_not_empty"];
const DATEISH: Operator[] = ["is", "before", "after", "on_or_before", "on_or_after", "within", "is_empty", "is_not_empty"];

export function operatorsFor(type: PropertyType): Operator[] {
  switch (type) {
    case "TITLE":
    case "TEXT":
    case "URL":
    case "EMAIL":
    case "PHONE":
      return TEXTISH;
    case "NUMBER":
      return ["equals", "not_equals", "gt", "gte", "lt", "lte", "is_empty", "is_not_empty"];
    case "SELECT":
      return ["is", "is_not", "is_empty", "is_not_empty"];
    case "STATUS":
      return ["is", "is_not", "group_is", "is_empty", "is_not_empty"];
    case "MULTI_SELECT":
    case "PERSON":
      return ["contains", "not_contains", "is_empty", "is_not_empty"];
    case "DATE":
      return DATEISH;
    case "CREATED_TIME":
    case "LAST_EDITED_TIME":
      return DATEISH.filter((o) => o !== "is_empty" && o !== "is_not_empty");
    case "CHECKBOX":
      return ["checked", "unchecked"];
    case "FILES":
      return ["is_empty", "is_not_empty"];
  }
}

/** Operators that take no value. */
export const VALUELESS: Operator[] = ["is_empty", "is_not_empty", "checked", "unchecked"];

export const RELATIVE_DATES = ["today", "tomorrow", "yesterday", "one_week_ago", "one_week_from_now", "one_month_ago", "one_month_from_now"] as const;
export const WITHIN_RANGES = ["past_week", "past_month", "past_year", "next_week", "next_month", "next_year"] as const;

/** Date filter value: an exact date or one relative to today. */
export interface DateFilterValue {
  date?: string;
  relative?: (typeof RELATIVE_DATES)[number];
  range?: (typeof WITHIN_RANGES)[number];
}
export type FilterValue = string | number | DateFilterValue | null;

export interface FilterRule {
  kind: "rule";
  id: string;
  propertyId: string;
  operator: Operator;
  value?: FilterValue;
}
export interface FilterGroup {
  kind: "group";
  id: string;
  op: "and" | "or";
  children: FilterNode[];
}
export type FilterNode = FilterRule | FilterGroup;

export interface SortRule {
  propertyId: string;
  direction: "asc" | "desc";
}

export interface ViewConfig {
  filter?: FilterGroup | null;
  sorts?: SortRule[];
  /** Property ids in display order; missing = default order. */
  order?: string[];
  /** Hidden property ids. */
  hidden?: string[];
  /** Column widths (table), px. */
  widths?: Record<string, number>;
  /** Board: property to group by (Select or Status). */
  groupBy?: string | null;
  /** Board: hide the "No value" column. */
  hideEmptyGroup?: boolean;
}

export const MAX_FILTER_DEPTH = 3;
export const MAX_FILTER_RULES = 50;
export const MAX_SORTS = 10;

const idStr = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const dateValue = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  relative: z.enum(RELATIVE_DATES).optional(),
  range: z.enum(WITHIN_RANGES).optional(),
});
const ruleSchema = z.object({
  kind: z.literal("rule"),
  id: idStr,
  propertyId: idStr,
  operator: z.enum(OPERATORS),
  value: z.union([z.string().max(500), z.number().finite(), dateValue, z.null()]).optional(),
});
type FilterInput = z.infer<typeof ruleSchema> | { kind: "group"; id: string; op: "and" | "or"; children: FilterInput[] };
export const filterNodeSchema: z.ZodType<FilterInput> = z.lazy(() =>
  z.union([ruleSchema, z.object({ kind: z.literal("group"), id: idStr, op: z.enum(["and", "or"]), children: z.array(filterNodeSchema).max(MAX_FILTER_RULES) })]),
);

export const viewConfigSchema = z.object({
  filter: filterNodeSchema.nullable().optional(),
  sorts: z.array(z.object({ propertyId: idStr, direction: z.enum(["asc", "desc"]) })).max(MAX_SORTS).optional(),
  order: z.array(idStr).max(100).optional(),
  hidden: z.array(idStr).max(100).optional(),
  widths: z.record(idStr, z.number().int().min(60).max(1000)).optional(),
  groupBy: idStr.nullable().optional(),
  hideEmptyGroup: z.boolean().optional(),
});

/** Depth and size limits (also enforced by the compiler). */
export function filterWithinLimits(node: FilterNode | null | undefined): boolean {
  let rules = 0;
  const walk = (n: FilterNode, depth: number): boolean => {
    if (n.kind === "rule") return ++rules <= MAX_FILTER_RULES;
    if (depth > MAX_FILTER_DEPTH) return false;
    return n.children.every((c) => walk(c, depth + 1));
  };
  return !node || walk(node, 1);
}

/** Resolve a relative date against the viewer's "today" (YYYY-MM-DD). */
export function resolveDate(v: DateFilterValue | undefined, today: string): string | null {
  if (!v) return null;
  if (v.date) return v.date;
  if (!v.relative) return null;
  const d = new Date(`${today}T00:00:00Z`);
  const shift: Record<(typeof RELATIVE_DATES)[number], [number, number]> = {
    today: [0, 0],
    tomorrow: [1, 0],
    yesterday: [-1, 0],
    one_week_ago: [-7, 0],
    one_week_from_now: [7, 0],
    one_month_ago: [0, -1],
    one_month_from_now: [0, 1],
  };
  const [days, months] = shift[v.relative];
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** [from, to] (inclusive) for "is within". */
export function resolveRange(range: DateFilterValue["range"], today: string): [string, string] | null {
  if (!range) return null;
  const at = (days: number, months = 0, years = 0) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCFullYear(d.getUTCFullYear() + years);
    d.setUTCMonth(d.getUTCMonth() + months);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  switch (range) {
    case "past_week":
      return [at(-7), today];
    case "past_month":
      return [at(0, -1), today];
    case "past_year":
      return [at(0, 0, -1), today];
    case "next_week":
      return [today, at(7)];
    case "next_month":
      return [today, at(0, 1)];
    case "next_year":
      return [today, at(0, 0, 1)];
  }
}
