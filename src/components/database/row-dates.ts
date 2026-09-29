import type { DateValue, PropertyValue } from "@/lib/db-properties";
import type { PropertyDef, Row } from "./types";

const localDate = (iso: string) => {
  const t = new Date(iso);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
};

/** A row's [start, end] for a date-like property (end = start for single dates). */
export function rowRange(row: Row, def: PropertyDef, endDef?: PropertyDef | null): { start: string; end: string } | null {
  let start: string | null = null;
  let end: string | null = null;
  if (def.type === "CREATED_TIME") start = localDate(row.createdAt);
  else if (def.type === "LAST_EDITED_TIME") start = localDate(row.updatedAt);
  else if (def.type === "DATE") {
    const v = row.values[def.id] as DateValue | undefined;
    start = v?.start ?? null;
    end = v?.end ?? null;
  }
  if (!start) return null;
  if (endDef?.type === "DATE") end = (row.values[endDef.id] as DateValue | undefined)?.start ?? null;
  return { start, end: end && end >= start ? end : start };
}

/** New values for moving / resizing a row's dates. */
export function datesPatch(def: PropertyDef, endDef: PropertyDef | null | undefined, start: string, end: string): Record<string, PropertyValue> {
  if (endDef?.type === "DATE") return { [def.id]: { start }, [endDef.id]: { start: end } };
  return { [def.id]: def.config.range && end !== start ? { start, end } : { start } };
}

/** Date-like properties a calendar / timeline can use. */
export const isDateLike = (d: PropertyDef) => d.type === "DATE" || d.type === "CREATED_TIME" || d.type === "LAST_EDITED_TIME";
