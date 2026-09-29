import { behavesAs, displayItems, isComputedError, type DateValue, type NumberFormat, type PropertyDef, type PropertyType, type PropertyValue, type ResultType } from "./db-properties";

/**
 * Rollups: aggregate one property of the pages a Relation links to. Pure, so
 * the server (cached results) and the property menu (previews) share it.
 */

export const ROLLUP_FNS = [
  "show_original",
  "count_all",
  "count_values",
  "count_unique",
  "count_empty",
  "count_not_empty",
  "percent_empty",
  "percent_not_empty",
  "sum",
  "average",
  "median",
  "min",
  "max",
  "range",
  "earliest",
  "latest",
  "date_range",
  "checked",
  "unchecked",
  "percent_checked",
  "percent_unchecked",
  "percent_complete",
] as const;
export type RollupFn = (typeof ROLLUP_FNS)[number];

export const ROLLUP_LABELS: Record<RollupFn, string> = {
  show_original: "Show original",
  count_all: "Count all",
  count_values: "Count values",
  count_unique: "Count unique values",
  count_empty: "Count empty",
  count_not_empty: "Count not empty",
  percent_empty: "Percent empty",
  percent_not_empty: "Percent not empty",
  sum: "Sum",
  average: "Average",
  median: "Median",
  min: "Min",
  max: "Max",
  range: "Range",
  earliest: "Earliest date",
  latest: "Latest date",
  date_range: "Date range",
  checked: "Checked",
  unchecked: "Unchecked",
  percent_checked: "Percent checked",
  percent_unchecked: "Percent unchecked",
  percent_complete: "Percent complete",
};

const ANY: RollupFn[] = ["show_original", "count_all", "count_values", "count_unique", "count_empty", "count_not_empty", "percent_empty", "percent_not_empty"];
const PERCENT = new Set<RollupFn>(["percent_empty", "percent_not_empty", "percent_checked", "percent_unchecked", "percent_complete"]);

/** Functions that make sense for a target property. */
export function rollupFnsFor(target: Pick<PropertyDef, "type" | "config">): RollupFn[] {
  const t = behavesAs(target);
  if (t === "RELATION") return ANY.filter((f) => f !== "show_original");
  switch (t) {
    case "NUMBER":
      return [...ANY, "sum", "average", "median", "min", "max", "range"];
    case "DATE":
    case "CREATED_TIME":
    case "LAST_EDITED_TIME":
      return [...ANY, "earliest", "latest", "date_range"];
    case "CHECKBOX":
      return ["show_original", "count_all", "checked", "unchecked", "percent_checked", "percent_unchecked"];
    case "STATUS":
      return [...ANY, "percent_complete"];
    default:
      return ANY;
  }
}

export function rollupResultType(fn: RollupFn): ResultType {
  if (fn === "show_original") return "list";
  if (fn === "earliest" || fn === "latest" || fn === "date_range") return "date";
  return "number";
}

/** Percent results are fractions (0–1), shown with the percent format. */
export const isPercentRollup = (fn: RollupFn) => PERCENT.has(fn);

const SUMS = new Set<RollupFn>(["sum", "average", "median", "min", "max", "range"]);

/** Result type and a sensible number format for a rollup (sums keep the target's currency). */
export function rollupResult(fn: RollupFn, target: Pick<PropertyDef, "type" | "config">): { resultType: ResultType; numberFormat?: NumberFormat } {
  const resultType = rollupResultType(fn);
  if (isPercentRollup(fn)) return { resultType, numberFormat: "percent" };
  if (SUMS.has(fn) && behavesAs(target) === "NUMBER" && target.config.numberFormat) return { resultType, numberFormat: target.config.numberFormat };
  return { resultType };
}

const isEmpty = (v: PropertyValue | undefined) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0) || isComputedError(v);
const round = (n: number) => Math.round(n * 1e6) / 1e6;

function dateStart(t: PropertyType, v: PropertyValue): string | null {
  if (isEmpty(v)) return null;
  if (typeof v === "string" && (t === "CREATED_TIME" || t === "LAST_EDITED_TIME")) return v.slice(0, 10);
  const d = v as DateValue;
  return typeof d?.start === "string" ? d.start : null;
}

/**
 * Aggregate the target values of the related pages. `values` holds one entry
 * per related (non-archived) page: its value for the target property (the
 * title for Title, an ISO timestamp for created / edited time).
 */
export function computeRollup(fn: RollupFn, target: Pick<PropertyDef, "type" | "config">, values: PropertyValue[]): PropertyValue {
  const t = behavesAs(target);
  const n = values.length;
  const filled = values.filter((v) => !isEmpty(v));
  const pct = (k: number) => (n ? round(k / n) : 0);
  switch (fn) {
    case "show_original": {
      const items = values.flatMap((v) => displayItems(target, v));
      return items.length ? items.slice(0, 500) : null;
    }
    case "count_all":
      return n;
    case "count_values":
      return filled.reduce<number>((s, v) => s + (Array.isArray(v) ? v.length : 1), 0);
    case "count_unique":
      return new Set(values.flatMap((v) => displayItems(target, v)).filter(Boolean)).size;
    case "count_empty":
      return n - filled.length;
    case "count_not_empty":
      return filled.length;
    case "percent_empty":
      return pct(n - filled.length);
    case "percent_not_empty":
      return pct(filled.length);
    case "sum":
    case "average":
    case "median":
    case "min":
    case "max":
    case "range": {
      const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
      if (fn === "sum") return round(nums.reduce((s, x) => s + x, 0));
      if (!nums.length) return null;
      const sorted = [...nums].sort((a, b) => a - b);
      if (fn === "average") return round(nums.reduce((s, x) => s + x, 0) / nums.length);
      if (fn === "median") {
        const m = sorted.length >> 1;
        return round(sorted.length % 2 ? sorted[m]! : (sorted[m - 1]! + sorted[m]!) / 2);
      }
      if (fn === "min") return sorted[0]!;
      if (fn === "max") return sorted.at(-1)!;
      return round(sorted.at(-1)! - sorted[0]!);
    }
    case "earliest":
    case "latest":
    case "date_range": {
      const starts = values.map((v) => dateStart(t, v)).filter((d): d is string => d !== null).sort();
      if (!starts.length) return null;
      const ends = values
        .map((v) => (t === "DATE" && !isEmpty(v) ? ((v as DateValue).end ?? (v as DateValue).start) : dateStart(t, v)))
        .filter((d): d is string => !!d)
        .sort();
      if (fn === "earliest") return { start: starts[0]! };
      if (fn === "latest") return { start: ends.at(-1)! };
      return starts[0] === ends.at(-1) ? { start: starts[0]! } : { start: starts[0]!, end: ends.at(-1)! };
    }
    case "checked":
      return values.filter((v) => v === true).length;
    case "unchecked":
      return values.filter((v) => v !== true).length;
    case "percent_checked":
      return pct(values.filter((v) => v === true).length);
    case "percent_unchecked":
      return pct(values.filter((v) => v !== true).length);
    case "percent_complete": {
      const done = new Set((target.config.options ?? []).filter((o) => o.group === "complete").map((o) => o.id));
      return pct(values.filter((v) => typeof v === "string" && done.has(v)).length);
    }
  }
}
