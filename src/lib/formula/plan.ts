import { isComputedError, type DateValue, type PropertyDef, type PropertyType, type PropertyValue, type ResultType } from "@/lib/db-properties";
import { compileFormula, isDate, type CompiledFormula, type FType, type FValue } from "./engine";
import { FormulaError } from "./tokenize";
import { parse, referencedProps } from "./parse";

/*
 * A database's formulas as a whole: evaluation order, types, cycles, and
 * how property values become formula inputs / results become values.
 * Pure: the server caches results with it, the formula dialog previews.
 */

/** What formula inputs need from a page. */
export interface FormulaPage {
  title: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}


export const F_TYPE: Partial<Record<PropertyType, FType>> = {
  TITLE: "text",
  TEXT: "text",
  URL: "text",
  EMAIL: "text",
  PHONE: "text",
  SELECT: "text",
  STATUS: "text",
  NUMBER: "number",
  CHECKBOX: "boolean",
  DATE: "date",
  CREATED_TIME: "date",
  LAST_EDITED_TIME: "date",
  MULTI_SELECT: "list",
  PERSON: "list",
  FILES: "list",
  RELATION: "list",
};
const asFType = (r: ResultType | undefined): FType => r ?? "any";
export const toResultType = (t: FType): ResultType => (t === "any" ? "text" : t);

export interface FormulaPlan {
  /** Formulas in evaluation order (dependencies first). */
  order: PropertyDef[];
  compiled: Map<string, CompiledFormula>;
  /** Formula ids caught in (or depending on) a circular reference, with the cycle's names. */
  cyclic: Map<string, string>;
  byName: Map<string, PropertyDef>;
}

/** Work out the order to evaluate a database's formulas in, their types, and any cycles. */
export function planFormulas(defs: PropertyDef[]): FormulaPlan {
  const byName = new Map<string, PropertyDef>();
  for (const d of defs) if (!byName.has(d.name)) byName.set(d.name, d);
  const formulas = defs.filter((d) => d.type === "FORMULA");
  const deps = new Map<string, string[]>();
  for (const f of formulas) {
    let refs: string[] = [];
    try {
      refs = [...referencedProps(parse(f.config.formula?.expression ?? ""))];
    } catch {
      /* parse errors are reported by compileFormula below */
    }
    deps.set(
      f.id,
      refs.map((n) => byName.get(n)).filter((d): d is PropertyDef => d?.type === "FORMULA").map((d) => d.id),
    );
  }
  // Kahn's algorithm; whatever's left over is in (or behind) a cycle.
  const order: PropertyDef[] = [];
  const done = new Set<string>();
  let progress = true;
  while (progress) {
    progress = false;
    for (const f of formulas) {
      if (done.has(f.id) || !deps.get(f.id)!.every((d) => done.has(d))) continue;
      done.add(f.id);
      order.push(f);
      progress = true;
    }
  }
  const cyclic = new Map<string, string>();
  for (const f of formulas) {
    if (done.has(f.id)) continue;
    // Walk dependencies until we come back round: that's the loop to name.
    const path: string[] = [];
    let at: string | undefined = f.id;
    while (at && !path.includes(at)) {
      path.push(at);
      at = deps.get(at)!.find((d) => !done.has(d));
    }
    const loop = at ? path.slice(path.indexOf(at)).concat(at) : path;
    cyclic.set(f.id, loop.map((id) => defs.find((d) => d.id === id)?.name ?? "?").join(" → "));
  }
  // Types: dependencies were typed before their dependants.
  const types = new Map<string, FType>();
  for (const [name, d] of byName) {
    if (d.type === "FORMULA") continue;
    types.set(name, d.type === "ROLLUP" ? asFType(d.config.resultType) : (F_TYPE[d.type] ?? "any"));
  }
  const compiled = new Map<string, CompiledFormula>();
  for (const f of formulas) if (cyclic.has(f.id)) types.set(f.name, "any");
  for (const f of order) {
    const c = compileFormula(f.config.formula?.expression ?? "", types);
    compiled.set(f.id, c);
    if (byName.get(f.name)?.id === f.id) types.set(f.name, c.issues.length ? "any" : c.type);
  }
  return { order, compiled, cyclic, byName };
}

// ── Values as formula inputs ──────────────────────────────────────────────

const iso = (d: Date | string) => {
  const s = typeof d === "string" ? new Date(d).toISOString() : d.toISOString();
  return { date: s.slice(0, 10), time: s.slice(11, 16) };
};

export function formulaInput(def: PropertyDef, page: FormulaPage, v: PropertyValue | undefined, titles: Map<string, string>): FValue {
  if (def.isTitle || def.type === "TITLE") return page.title;
  if (def.type === "CREATED_TIME") return iso(page.createdAt);
  if (def.type === "LAST_EDITED_TIME") return iso(page.updatedAt);
  if (isComputedError(v)) throw new FormulaError(`“${def.name}” has an error.`, 0);
  if (v === null || v === undefined) return def.type === "CHECKBOX" ? false : null;
  switch (def.type) {
    case "SELECT":
    case "STATUS":
      return def.config.options?.find((o) => o.id === v)?.name ?? null;
    case "MULTI_SELECT":
      return (v as string[]).map((id) => def.config.options?.find((o) => o.id === id)?.name ?? "").filter(Boolean);
    case "FILES":
      return (v as { name: string }[]).map((f) => f.name);
    case "RELATION":
      return (v as string[]).map((id) => titles.get(id) ?? "");
    default:
      break;
  }
  if (typeof v === "object" && !Array.isArray(v) && "start" in v) return { date: (v as DateValue).start };
  if (Array.isArray(v)) return (v as unknown[]).filter((x): x is string => typeof x === "string");
  return v as FValue;
}

/** A formula result → the shape stored in values (dates as {start}). */
export function storeResult(v: FValue, type: ResultType): PropertyValue {
  if (v === null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return type === "boolean" ? v : String(v);
  if (typeof v === "string") return v === "" ? null : v.slice(0, 2000);
  if (isDate(v)) return { start: v.date };
  if (Array.isArray(v)) {
    const items = v.map((x) => (x === null ? "" : isDate(x) ? x.date : typeof x === "object" ? "" : String(x))).filter(Boolean);
    return items.length ? items.slice(0, 500) : null;
  }
  return null;
}
