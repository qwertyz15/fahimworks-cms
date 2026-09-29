/**
 * Workspace database property types: value shapes, validation, conversion
 * between types and display text. Shared by the server (validates every
 * write) and the UI (editors, cells). Values live in Page.values, keyed by
 * property id; the Title property is stored in Page.title instead.
 */

export const PROPERTY_TYPES = [
  "TITLE",
  "TEXT",
  "NUMBER",
  "SELECT",
  "MULTI_SELECT",
  "STATUS",
  "DATE",
  "CHECKBOX",
  "URL",
  "EMAIL",
  "PHONE",
  "PERSON",
  "FILES",
  "CREATED_TIME",
  "LAST_EDITED_TIME",
  "RELATION",
  "ROLLUP",
  "FORMULA",
] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

/** Types the user can pick when adding a property (Title is always there, exactly once). */
export const ADDABLE_TYPES = PROPERTY_TYPES.filter((t) => t !== "TITLE");

/** Not editable by hand: page timestamps, and results the server calculates (cached in values). */
export const COMPUTED_TYPES: readonly PropertyType[] = ["CREATED_TIME", "LAST_EDITED_TIME", "ROLLUP", "FORMULA"];

/** Rollup and formula results: what they behave like in filters, sorts and cells. */
export const RESULT_TYPES = ["number", "text", "boolean", "date", "list"] as const;
export type ResultType = (typeof RESULT_TYPES)[number];
const RESULT_AS: Record<ResultType, PropertyType> = { number: "NUMBER", text: "TEXT", boolean: "CHECKBOX", date: "DATE", list: "MULTI_SELECT" };

/** The type a property acts as: rollups and formulas act as their result type. */
export function behavesAs(def: Pick<PropertyDef, "type" | "config">): PropertyType {
  if (def.type === "ROLLUP" || def.type === "FORMULA") return RESULT_AS[def.config.resultType ?? "text"] ?? "TEXT";
  return def.type;
}
export const isResultProp = (def: Pick<PropertyDef, "type">) => def.type === "ROLLUP" || def.type === "FORMULA";

export const OPTION_COLORS = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"] as const;
export type OptionColor = (typeof OPTION_COLORS)[number];

export type StatusGroup = "todo" | "in_progress" | "complete";
export const STATUS_GROUPS: { id: StatusGroup; label: string }[] = [
  { id: "todo", label: "To-do" },
  { id: "in_progress", label: "In progress" },
  { id: "complete", label: "Complete" },
];

export interface SelectOption {
  id: string;
  name: string;
  color: OptionColor;
  /** Status only. */
  group?: StatusGroup;
}

export const NUMBER_FORMATS = ["number", "comma", "percent", "usd", "eur", "gbp", "bdt"] as const;
export type NumberFormat = (typeof NUMBER_FORMATS)[number];

export interface RelationConfig {
  databaseId: string;
  limit: "one" | "many";
  /** Two-way: the property on the other database showing the same links in reverse. */
  pairedId?: string | null;
  /** The side that owns the PageRelation rows (the one created first). */
  primary?: boolean;
}
export interface RollupConfig {
  relationId: string;
  /** Property of the related database to aggregate. */
  targetId: string;
  fn: string;
}

export interface PropertyConfig {
  options?: SelectOption[];
  relation?: RelationConfig;
  rollup?: RollupConfig;
  formula?: { expression: string };
  /** Rollup / formula: the result's type (set by the server). */
  resultType?: ResultType;
  numberFormat?: NumberFormat;
  /** Date: also store an end date (date range). */
  range?: boolean;
  /** Value given to new rows. */
  default?: PropertyValue;
}

export interface DateValue {
  /** YYYY-MM-DD */
  start: string;
  end?: string | null;
}
export interface FileValue {
  url: string;
  name: string;
  size?: number;
  mime?: string;
}
/** A formula / rollup that couldn't be calculated. */
export interface ComputedError {
  error: string;
}
export type PropertyValue = string | number | boolean | string[] | DateValue | FileValue[] | ComputedError | null;

export const isComputedError = (v: unknown): v is ComputedError => typeof v === "object" && v !== null && !Array.isArray(v) && typeof (v as ComputedError).error === "string";

export interface PropertyDef {
  id: string;
  name: string;
  type: PropertyType;
  config: PropertyConfig;
  isTitle?: boolean;
}

export const TYPE_LABELS: Record<PropertyType, string> = {
  TITLE: "Title",
  TEXT: "Text",
  NUMBER: "Number",
  SELECT: "Select",
  MULTI_SELECT: "Multi-select",
  STATUS: "Status",
  DATE: "Date",
  CHECKBOX: "Checkbox",
  URL: "URL",
  EMAIL: "Email",
  PHONE: "Phone",
  PERSON: "Person",
  FILES: "Files & media",
  CREATED_TIME: "Created time",
  LAST_EDITED_TIME: "Last edited time",
  RELATION: "Relation",
  ROLLUP: "Rollup",
  FORMULA: "Formula",
};

export const LIMITS = {
  text: 2000,
  title: 300,
  url: 2048,
  options: 500,
  optionName: 100,
  files: 20,
  people: 20,
  propertyName: 100,
  properties: 60,
  relations: 500,
} as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+()\d\s.-]{3,40}$/;

export const newId = () => Math.random().toString(36).slice(2, 10);

function validDate(v: unknown): v is string {
  if (typeof v !== "string" || !DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function safeUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s || s.length > LIMITS.url) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

const optionIds = (config: PropertyConfig) => new Set((config.options ?? []).map((o) => o.id));

/**
 * Clean a value for a property; returns null for "empty" and throws
 * PropertyValueError when the value can't belong to this property.
 */
export class PropertyValueError extends Error {}

export function validateValue(def: Pick<PropertyDef, "type" | "config" | "name">, raw: unknown): PropertyValue {
  if (raw === null || raw === undefined || raw === "") return null;
  const fail = (msg: string): never => {
    throw new PropertyValueError(`${def.name}: ${msg}`);
  };
  switch (def.type) {
    case "TITLE":
    case "TEXT": {
      if (typeof raw !== "string") fail("expected text");
      const t = (raw as string).slice(0, def.type === "TITLE" ? LIMITS.title : LIMITS.text);
      return t.trim() ? t : null;
    }
    case "NUMBER": {
      const n = typeof raw === "string" ? Number(raw.replace(/,/g, "")) : raw;
      if (typeof n !== "number" || !Number.isFinite(n)) fail("expected a number");
      return n as number;
    }
    case "SELECT":
    case "STATUS": {
      if (typeof raw !== "string" || !optionIds(def.config).has(raw)) fail("unknown option");
      return raw as string;
    }
    case "MULTI_SELECT": {
      if (!Array.isArray(raw)) fail("expected a list");
      const ids = optionIds(def.config);
      const out = [...new Set(raw as unknown[])].filter((v): v is string => typeof v === "string" && ids.has(v));
      return out.length ? out.slice(0, LIMITS.options) : null;
    }
    case "DATE": {
      const v = raw as Partial<DateValue>;
      if (typeof v !== "object" || !validDate(v.start)) fail("expected a date (YYYY-MM-DD)");
      const end = def.config.range && v.end && validDate(v.end) && v.end >= v.start! ? v.end : null;
      return { start: v.start!, ...(end ? { end } : {}) };
    }
    case "CHECKBOX":
      if (typeof raw !== "boolean") fail("expected true or false");
      return raw as boolean;
    case "URL": {
      const u = safeUrl(raw);
      if (!u) fail("expected an http(s) link");
      return u;
    }
    case "EMAIL": {
      const e = typeof raw === "string" ? raw.trim().toLowerCase() : "";
      if (!EMAIL_RE.test(e) || e.length > 254) fail("expected an email address");
      return e;
    }
    case "PHONE": {
      const ph = typeof raw === "string" ? raw.trim() : "";
      if (!PHONE_RE.test(ph)) fail("expected a phone number");
      return ph;
    }
    case "PERSON": {
      if (!Array.isArray(raw)) fail("expected a list of people");
      const out = [...new Set(raw as unknown[])].filter((v): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v));
      return out.length ? out.slice(0, LIMITS.people) : null;
    }
    case "FILES": {
      if (!Array.isArray(raw)) fail("expected a list of files");
      const out: FileValue[] = [];
      for (const f of raw as Partial<FileValue>[]) {
        const url = safeUrl(f?.url);
        if (!url || out.length >= LIMITS.files) continue;
        out.push({
          url,
          name: typeof f?.name === "string" ? f.name.slice(0, 200) : "file",
          ...(typeof f?.size === "number" ? { size: f.size } : {}),
          ...(typeof f?.mime === "string" ? { mime: f.mime.slice(0, 100) } : {}),
        });
      }
      return out.length ? out : null;
    }
    case "RELATION": {
      if (!Array.isArray(raw)) fail("expected a list of pages");
      const out = [...new Set(raw as unknown[])].filter((v): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v));
      const max = def.config.relation?.limit === "one" ? 1 : LIMITS.relations;
      return out.length ? out.slice(0, max) : null;
    }
    case "CREATED_TIME":
    case "LAST_EDITED_TIME":
    case "ROLLUP":
    case "FORMULA":
      return null;
  }
}

/** Plain text of a value (search, conversion, list view). */
export function valueText(def: Pick<PropertyDef, "type" | "config">, v: PropertyValue): string {
  if (v === null || v === undefined) return "";
  if (isComputedError(v)) return "";
  if (isResultProp(def)) return resultText(def, v);
  const opt = (id: string) => def.config.options?.find((o) => o.id === id)?.name ?? "";
  switch (def.type) {
    case "SELECT":
    case "STATUS":
      return opt(v as string);
    case "MULTI_SELECT":
      return (v as string[]).map(opt).filter(Boolean).join(", ");
    case "DATE": {
      const d = v as DateValue;
      return d.end ? `${d.start} → ${d.end}` : d.start;
    }
    case "CHECKBOX":
      return v ? "Yes" : "No";
    case "FILES":
      return (v as FileValue[]).map((f) => f.name).join(", ");
    case "PERSON":
    case "RELATION":
      return "";
    case "NUMBER":
      return String(v);
    default:
      return typeof v === "string" ? v : "";
  }
}

/** A rollup / formula result as text. */
function resultText(def: Pick<PropertyDef, "config">, v: PropertyValue): string {
  if (typeof v === "number") return formatNumber(v, def.config.numberFormat);
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string").join(", ");
  if (typeof v === "object" && v && "start" in v) return v.end ? `${v.start} → ${v.end}` : v.start;
  return typeof v === "string" ? v : "";
}

/** A value as separate display items (rollup "show original", unique counts). */
export function displayItems(def: Pick<PropertyDef, "type" | "config">, v: PropertyValue | undefined): string[] {
  if (v === null || v === undefined || isComputedError(v)) return [];
  if (Array.isArray(v)) {
    if (def.type === "MULTI_SELECT") return v.map((id) => def.config.options?.find((o) => o.id === id)?.name ?? "").filter(Boolean);
    if (def.type === "FILES") return (v as FileValue[]).map((f) => f.name);
    if (def.type === "RELATION" || def.type === "PERSON") return v as string[];
    return v.filter((x): x is string => typeof x === "string");
  }
  if (def.type === "CREATED_TIME" || def.type === "LAST_EDITED_TIME") return typeof v === "string" ? [v.slice(0, 10)] : [];
  const t = valueText(def, v);
  return t ? [t] : [];
}

const COLOR_CYCLE: OptionColor[] = ["blue", "green", "orange", "purple", "pink", "yellow", "red", "brown", "gray"];

/** Options for a Select made from text values (changing a type to Select). */
export function optionsFromTexts(texts: string[], existing: SelectOption[] = []): SelectOption[] {
  const out = [...existing];
  for (const raw of texts) {
    const name = raw.trim().slice(0, LIMITS.optionName);
    if (!name || out.some((o) => o.name.toLowerCase() === name.toLowerCase())) continue;
    if (out.length >= LIMITS.options) break;
    out.push({ id: newId(), name, color: COLOR_CYCLE[out.length % COLOR_CYCLE.length]! });
  }
  return out;
}

/**
 * Convert a value when a property changes type. `to.config` must already hold
 * the options the new values can refer to (see optionsFromTexts).
 */
export function convertValue(from: Pick<PropertyDef, "type" | "config">, to: Pick<PropertyDef, "type" | "config" | "name">, v: PropertyValue): PropertyValue {
  if (v === null || v === undefined) return null;
  const texts = from.type === "MULTI_SELECT" ? (v as string[]).map((id) => from.config.options?.find((o) => o.id === id)?.name ?? "") : [valueText(from, v)];
  const byName = (name: string) => to.config.options?.find((o) => o.name.toLowerCase() === name.trim().toLowerCase())?.id;
  const attempt = (): unknown => {
    switch (to.type) {
      case "TEXT":
      case "TITLE":
        return texts.filter(Boolean).join(", ");
      case "NUMBER":
        return typeof v === "number" ? v : Number(texts[0]?.replace(/,/g, ""));
      case "SELECT":
      case "STATUS":
        return byName(texts[0] ?? "");
      case "MULTI_SELECT":
        return texts.flatMap((t) => t.split(",")).map(byName).filter(Boolean);
      case "CHECKBOX":
        return typeof v === "boolean" ? v : /^(yes|true|1|x|done)$/i.test(texts[0] ?? "");
      case "DATE":
        return from.type === "DATE" ? v : { start: (texts[0] ?? "").slice(0, 10) };
      case "URL":
      case "EMAIL":
      case "PHONE":
        return texts[0];
      default:
        return null;
    }
  };
  try {
    return validateValue(to, attempt());
  } catch {
    return null;
  }
}

export function defaultConfig(type: PropertyType): PropertyConfig {
  switch (type) {
    case "STATUS":
      return {
        options: [
          { id: newId(), name: "Not started", color: "gray", group: "todo" },
          { id: newId(), name: "In progress", color: "blue", group: "in_progress" },
          { id: newId(), name: "Done", color: "green", group: "complete" },
        ],
      };
    case "SELECT":
    case "MULTI_SELECT":
      return { options: [] };
    case "NUMBER":
      return { numberFormat: "number" };
    default:
      return {};
  }
}

/** Clean a config sent by the client. */
export function validateConfig(type: PropertyType, raw: unknown): PropertyConfig {
  const c = (raw && typeof raw === "object" ? raw : {}) as PropertyConfig;
  const out: PropertyConfig = {};
  if (type === "SELECT" || type === "MULTI_SELECT" || type === "STATUS") {
    const seen = new Set<string>();
    out.options = (Array.isArray(c.options) ? c.options : [])
      .map((o) => ({
        id: typeof o?.id === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(o.id) ? o.id : newId(),
        name: (typeof o?.name === "string" ? o.name : "").trim().slice(0, LIMITS.optionName),
        color: (OPTION_COLORS as readonly string[]).includes(o?.color) ? o.color : "gray",
        ...(type === "STATUS" ? { group: (["todo", "in_progress", "complete"] as const).includes(o?.group as StatusGroup) ? o.group : "todo" } : {}),
      }))
      .filter((o) => o.name && !seen.has(o.id) && seen.add(o.id))
      .slice(0, LIMITS.options);
  }
  if (type === "NUMBER" || type === "ROLLUP" || type === "FORMULA") {
    const f = (NUMBER_FORMATS as readonly string[]).includes(c.numberFormat ?? "") ? c.numberFormat : undefined;
    if (f || type === "NUMBER") out.numberFormat = f ?? "number";
  }
  const token = (v: unknown) => (typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : null);
  if (type === "RELATION") {
    const r = (c.relation ?? {}) as Partial<RelationConfig>;
    const databaseId = token(r.databaseId);
    if (databaseId) out.relation = { databaseId, limit: r.limit === "one" ? "one" : "many", pairedId: token(r.pairedId), primary: r.primary !== false };
  }
  if (type === "ROLLUP") {
    const r = (c.rollup ?? {}) as Partial<RollupConfig>;
    const relationId = token(r.relationId);
    const targetId = token(r.targetId);
    if (relationId && targetId) out.rollup = { relationId, targetId, fn: typeof r.fn === "string" ? r.fn.slice(0, 40) : "count_all" };
  }
  if (type === "FORMULA") out.formula = { expression: typeof c.formula?.expression === "string" ? c.formula.expression.slice(0, 1000) : "" };
  if ((type === "ROLLUP" || type === "FORMULA") && (RESULT_TYPES as readonly string[]).includes(c.resultType ?? "")) out.resultType = c.resultType;
  if (type === "DATE" && c.range) out.range = true;
  if (c.default !== undefined && c.default !== null && !COMPUTED_TYPES.includes(type) && type !== "TITLE") {
    try {
      const d = validateValue({ type, config: out, name: "Default" }, c.default);
      if (d !== null) out.default = d;
    } catch {
      /* invalid default: dropped */
    }
  }
  return out;
}

export function formatNumber(n: number, format: NumberFormat = "number"): string {
  switch (format) {
    case "comma":
      return n.toLocaleString("en-US");
    case "percent":
      return `${(n * 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
    case "usd":
    case "eur":
    case "gbp":
    case "bdt":
      return n.toLocaleString("en-US", { style: "currency", currency: format.toUpperCase() });
    default:
      return String(n);
  }
}
