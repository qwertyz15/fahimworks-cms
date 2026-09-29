import { addDays, addMonths, daysBetween } from "@/lib/dates";
import { FormulaError, tokenize, type Token } from "./tokenize";
import { isVolatile, parse, referencedProps, type Node } from "./parse";

/*
 * Formula types, function library, type checker and evaluator. Pure and
 * shared by the server (cached results) and the browser (live preview).
 * No eval: only the syntax tree is walked, properties are reached only via
 * prop("Name"), and evaluation is capped at MAX_STEPS.
 */

export type FType = "number" | "text" | "boolean" | "date" | "list" | "any";
export interface FDate {
  date: string;
  time?: string;
}
export type FValue = number | string | boolean | FDate | FValue[] | null;

export const MAX_STEPS = 10_000;

export const isDate = (v: FValue): v is FDate => typeof v === "object" && v !== null && !Array.isArray(v) && typeof (v as FDate).date === "string";

export interface EvalContext {
  getProp: (name: string) => FValue;
  /** Viewer's date, YYYY-MM-DD. */
  today: string;
  /** Current time, HH:MM (UTC). */
  time: string;
}

// ── Formatting ────────────────────────────────────────────────────────────

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function formatDate(d: FDate, fmt = "MMM D, YYYY"): string {
  const [y, m, day] = d.date.split("-").map(Number) as [number, number, number];
  const wd = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
  const [hh, mm] = (d.time ?? "00:00").split(":");
  const map: Record<string, string> = {
    YYYY: String(y),
    YY: String(y).slice(-2),
    MMMM: MONTHS[m - 1]!,
    MMM: MONTHS[m - 1]!.slice(0, 3),
    MM: String(m).padStart(2, "0"),
    M: String(m),
    DD: String(day).padStart(2, "0"),
    D: String(day),
    dddd: DAYS[wd]!,
    ddd: DAYS[wd]!.slice(0, 3),
    HH: hh ?? "00",
    mm: mm ?? "00",
  };
  return fmt.replace(/YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|mm/g, (t) => map[t]!);
}

export function formatValue(v: FValue): string {
  if (v === null) return "";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (isDate(v)) return formatDate(v) + (v.time ? ` ${v.time}` : "");
  if (Array.isArray(v)) return v.map(formatValue).join(", ");
  return v;
}

// ── Function library ──────────────────────────────────────────────────────

type ArgSpec = FType | FType[];
interface FnDef {
  args: ArgSpec[];
  /** Extra trailing arguments allowed, of this type. */
  rest?: ArgSpec;
  optional?: number;
  returns: FType | ((args: FType[]) => FType);
  help: string;
  example: string;
  impl: (a: FValue[], ctx: EvalContext) => FValue;
}

const num = (v: FValue) => (typeof v === "number" ? v : null);
const str = (v: FValue) => (v === null ? "" : typeof v === "string" ? v : formatValue(v));
const unitOf = (u: FValue) => {
  const s = str(u).toLowerCase().replace(/s$/, "");
  if (!["day", "week", "month", "year"].includes(s)) throw new FormulaError(`Unknown unit “${str(u)}”. Use "days", "weeks", "months" or "years".`, 0);
  return s as "day" | "week" | "month" | "year";
};
const shift = (d: FDate, n: number, unit: ReturnType<typeof unitOf>): FDate => {
  const k = Math.trunc(n);
  const date = unit === "day" ? addDays(d.date, k) : unit === "week" ? addDays(d.date, 7 * k) : unit === "month" ? addMonths(d.date, k) : addMonths(d.date, 12 * k);
  return { ...d, date };
};

function monthsBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number) as [number, number, number];
  const [by, bm, bd] = b.split("-").map(Number) as [number, number, number];
  let m = (ay - by) * 12 + (am - bm);
  if (m > 0 && ad < bd) m -= 1;
  if (m < 0 && ad > bd) m += 1;
  return m;
}

export const FUNCTIONS: Record<string, FnDef> = {
  if: { args: ["boolean", "any", "any"], returns: (t) => (t[1] === t[2] ? t[1]! : t[1] === "any" ? t[2]! : t[2] === "any" ? t[1]! : "any"), help: "Chooses between two values.", example: 'if(prop("Done"), "✓", "…")', impl: (a) => (a[0] ? a[1]! : a[2]!) },
  abs: { args: ["number"], returns: "number", help: "Absolute value.", example: "abs(-3)", impl: (a) => (num(a[0]!) === null ? null : Math.abs(a[0] as number)) },
  round: {
    args: ["number", "number"],
    optional: 1,
    returns: "number",
    help: "Rounds to a number of decimal places (default 0).",
    example: 'round(prop("Price") * 1.15, 2)',
    impl: (a) => {
      const n = num(a[0]!);
      if (n === null) return null;
      const f = 10 ** Math.max(0, Math.min(10, num(a[1] ?? 0) ?? 0));
      return Math.round(n * f) / f;
    },
  },
  floor: { args: ["number"], returns: "number", help: "Rounds down.", example: "floor(4.7)", impl: (a) => (num(a[0]!) === null ? null : Math.floor(a[0] as number)) },
  ceil: { args: ["number"], returns: "number", help: "Rounds up.", example: "ceil(4.2)", impl: (a) => (num(a[0]!) === null ? null : Math.ceil(a[0] as number)) },
  sqrt: { args: ["number"], returns: "number", help: "Square root.", example: "sqrt(16)", impl: (a) => (num(a[0]!) === null ? null : Math.sqrt(a[0] as number)) },
  pow: { args: ["number", "number"], returns: "number", help: "Raises to a power.", example: "pow(2, 10)", impl: (a) => (num(a[0]!) === null || num(a[1]!) === null ? null : (a[0] as number) ** (a[1] as number)) },
  min: { args: [["number", "list"]], rest: "number", returns: "number", help: "Smallest of the numbers (or of a list).", example: 'min(prop("A"), prop("B"))', impl: (a) => minmax(a, Math.min) },
  max: { args: [["number", "list"]], rest: "number", returns: "number", help: "Largest of the numbers (or of a list).", example: 'max(prop("A"), 0)', impl: (a) => minmax(a, Math.max) },
  length: { args: [["text", "list"]], returns: "number", help: "Characters in text, or items in a list.", example: 'length(prop("Tags"))', impl: (a) => (Array.isArray(a[0]) ? a[0].length : str(a[0]!).length) },
  concat: { args: ["any"], rest: "any", returns: "text", help: "Joins values into one text.", example: 'concat(prop("First"), " ", prop("Last"))', impl: (a) => a.map(str).join("") },
  join: { args: ["list", "text"], optional: 1, returns: "text", help: "Joins a list with a separator.", example: 'join(prop("Tags"), " · ")', impl: (a) => (Array.isArray(a[0]) ? a[0].map(formatValue).join(a[1] === undefined ? ", " : str(a[1]!)) : str(a[0]!)) },
  lower: { args: ["text"], returns: "text", help: "Lowercase.", example: 'lower("ABC")', impl: (a) => str(a[0]!).toLowerCase() },
  upper: { args: ["text"], returns: "text", help: "Uppercase.", example: 'upper("abc")', impl: (a) => str(a[0]!).toUpperCase() },
  contains: {
    args: [["text", "list"], "text"],
    returns: "boolean",
    help: "Whether text (or a list) contains a value.",
    example: 'contains(prop("Tags"), "AI")',
    impl: (a) => (Array.isArray(a[0]) ? a[0].some((x) => formatValue(x) === str(a[1]!)) : str(a[0]!).includes(str(a[1]!))),
  },
  replace: { args: ["text", "text", "text"], returns: "text", help: "Replaces every occurrence of some text.", example: 'replace(prop("Name"), "-", " ")', impl: (a) => (str(a[1]!) ? str(a[0]!).split(str(a[1]!)).join(str(a[2]!)) : str(a[0]!)) },
  format: { args: ["any"], returns: "text", help: "Turns any value into text.", example: 'format(prop("Price"))', impl: (a) => formatValue(a[0]!) },
  toNumber: {
    args: ["any"],
    returns: "number",
    help: "Turns text (or true/false) into a number.",
    example: 'toNumber("42")',
    impl: (a) => {
      const v = a[0]!;
      if (typeof v === "number") return v;
      if (typeof v === "boolean") return v ? 1 : 0;
      const n = parseFloat(str(v).replace(/,/g, ""));
      return Number.isFinite(n) ? n : null;
    },
  },
  empty: { args: ["any"], returns: "boolean", help: "Whether a value is empty.", example: 'empty(prop("Due"))', impl: (a) => a[0] === null || a[0] === "" || (Array.isArray(a[0]) && a[0].length === 0) },
  now: { args: [], returns: "date", help: "The current date and time.", example: "now()", impl: (_a, c) => ({ date: c.today, time: c.time }) },
  today: { args: [], returns: "date", help: "Today's date.", example: "today()", impl: (_a, c) => ({ date: c.today }) },
  dateAdd: {
    args: ["date", "number", "text"],
    returns: "date",
    help: 'Adds time to a date. Units: "days", "weeks", "months", "years".',
    example: 'dateAdd(prop("Start"), 2, "weeks")',
    impl: (a) => (isDate(a[0]!) && num(a[1]!) !== null ? shift(a[0] as FDate, a[1] as number, unitOf(a[2]!)) : null),
  },
  dateSubtract: {
    args: ["date", "number", "text"],
    returns: "date",
    help: "Subtracts time from a date.",
    example: 'dateSubtract(prop("Due"), 3, "days")',
    impl: (a) => (isDate(a[0]!) && num(a[1]!) !== null ? shift(a[0] as FDate, -(a[1] as number), unitOf(a[2]!)) : null),
  },
  dateBetween: {
    args: ["date", "date", "text"],
    returns: "number",
    help: "Time from the second date to the first, in a unit.",
    example: 'dateBetween(prop("Due"), today(), "days")',
    impl: (a) => {
      if (!isDate(a[0]!) || !isDate(a[1]!)) return null;
      const u = unitOf(a[2]!);
      const x = (a[0] as FDate).date;
      const y = (a[1] as FDate).date;
      if (u === "day") return daysBetween(y, x);
      if (u === "week") return Math.trunc(daysBetween(y, x) / 7);
      const m = monthsBetween(x, y);
      return u === "month" ? m : Math.trunc(m / 12);
    },
  },
  formatDate: { args: ["date", "text"], optional: 1, returns: "text", help: 'Formats a date, e.g. "YYYY-MM-DD" or "MMM D".', example: 'formatDate(prop("Due"), "MMM D")', impl: (a) => (isDate(a[0]!) ? formatDate(a[0] as FDate, a[1] === undefined ? undefined : str(a[1]!)) : "") },
  year: { args: ["date"], returns: "number", help: "The year of a date.", example: 'year(prop("Due"))', impl: (a) => (isDate(a[0]!) ? Number((a[0] as FDate).date.slice(0, 4)) : null) },
  month: { args: ["date"], returns: "number", help: "The month (1–12).", example: 'month(prop("Due"))', impl: (a) => (isDate(a[0]!) ? Number((a[0] as FDate).date.slice(5, 7)) : null) },
  day: { args: ["date"], returns: "number", help: "The day of the month.", example: 'day(prop("Due"))', impl: (a) => (isDate(a[0]!) ? Number((a[0] as FDate).date.slice(8, 10)) : null) },
};

function minmax(a: FValue[], f: (...n: number[]) => number): FValue {
  const flat = (a.length === 1 && Array.isArray(a[0]) ? a[0] : a).filter((x): x is number => typeof x === "number");
  return flat.length ? f(...flat) : null;
}

// ── Type checker ──────────────────────────────────────────────────────────

export interface TypeIssue {
  message: string;
  pos: number;
}

const fits = (actual: FType, spec: ArgSpec) => actual === "any" || (Array.isArray(spec) ? spec.includes(actual) || spec.includes("any") : spec === "any" || spec === actual);
const specName = (s: ArgSpec) => (Array.isArray(s) ? s.join(" or ") : s);

export function typeOf(n: Node, props: Map<string, FType>, issues: TypeIssue[]): FType {
  switch (n.k) {
    case "num":
      return "number";
    case "str":
      return "text";
    case "bool":
      return "boolean";
    case "prop": {
      const t = props.get(n.name);
      if (!t) issues.push({ message: `No property called “${n.name}”.`, pos: n.pos });
      return t ?? "any";
    }
    case "un": {
      const t = typeOf(n.a, props, issues);
      if (n.op === "-" && !fits(t, "number")) issues.push({ message: "Minus needs a number.", pos: n.pos });
      if (n.op === "not" && !fits(t, "boolean")) issues.push({ message: "not needs true/false.", pos: n.pos });
      return n.op === "-" ? "number" : "boolean";
    }
    case "bin": {
      const a = typeOf(n.a, props, issues);
      const b = typeOf(n.b, props, issues);
      if (n.op === "+") {
        if (a === "text" || b === "text") return "text";
        if (fits(a, "number") && fits(b, "number")) return a === "any" && b === "any" ? "any" : "number";
        issues.push({ message: "+ adds numbers or joins text.", pos: n.pos });
        return "any";
      }
      if (["-", "*", "/", "%", "^"].includes(n.op)) {
        if (!fits(a, "number") || !fits(b, "number")) issues.push({ message: `${n.op} needs numbers${a === "date" || b === "date" ? ' (for dates use dateBetween or dateAdd)' : ""}.`, pos: n.pos });
        return "number";
      }
      if (n.op === "and" || n.op === "or") {
        if (!fits(a, "boolean") || !fits(b, "boolean")) issues.push({ message: `${n.op} needs true/false on both sides.`, pos: n.pos });
        return "boolean";
      }
      // comparisons
      if (["<", "<=", ">", ">="].includes(n.op) && a !== "any" && b !== "any" && (a !== b || a === "list" || a === "boolean")) issues.push({ message: `Can't compare ${a} with ${b} using ${n.op}.`, pos: n.pos });
      return "boolean";
    }
    case "call": {
      const f = Object.prototype.hasOwnProperty.call(FUNCTIONS, n.fn) ? FUNCTIONS[n.fn] : undefined;
      if (!f) {
        issues.push({ message: `Unknown function “${n.fn}”.`, pos: n.pos });
        n.args.forEach((x) => typeOf(x, props, issues));
        return "any";
      }
      const types = n.args.map((x) => typeOf(x, props, issues));
      const min = f.args.length - (f.optional ?? 0);
      if (types.length < min || (!f.rest && types.length > f.args.length)) {
        issues.push({ message: `${n.fn}() takes ${f.rest ? `at least ${min}` : min === f.args.length ? min : `${min}–${f.args.length}`} argument${f.args.length === 1 ? "" : "s"}.`, pos: n.pos });
      }
      types.forEach((t, i) => {
        const spec = i < f.args.length ? f.args[i]! : f.rest;
        if (spec && !fits(t, spec)) issues.push({ message: `Argument ${i + 1} of ${n.fn}() should be ${specName(spec)}, not ${t}.`, pos: n.args[i]!.pos });
      });
      return typeof f.returns === "function" ? f.returns(types) : f.returns;
    }
  }
}

// ── Evaluator ─────────────────────────────────────────────────────────────

export function evaluate(root: Node, ctx: EvalContext): FValue {
  let steps = 0;
  const cmp = (a: FValue, b: FValue): number | null => {
    if (typeof a === "number" && typeof b === "number") return a - b;
    if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
    if (isDate(a) && isDate(b)) {
      const x = a.date + (a.time ?? "");
      const y = b.date + (b.time ?? "");
      return x < y ? -1 : x > y ? 1 : 0;
    }
    return null;
  };
  const eq = (a: FValue, b: FValue): boolean => {
    if (isDate(a) && isDate(b)) return a.date === b.date && (a.time ?? "") === (b.time ?? "");
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => eq(x, b[i]!));
    return a === b;
  };
  const run = (n: Node): FValue => {
    if (++steps > MAX_STEPS) throw new FormulaError("This formula takes too long to calculate.", n.pos);
    switch (n.k) {
      case "num":
      case "str":
      case "bool":
        return n.v;
      case "prop":
        return ctx.getProp(n.name);
      case "un": {
        const v = run(n.a);
        if (n.op === "-") return typeof v === "number" ? -v : null;
        return !v;
      }
      case "bin": {
        if (n.op === "and") return Boolean(run(n.a)) && Boolean(run(n.b));
        if (n.op === "or") return Boolean(run(n.a)) || Boolean(run(n.b));
        const a = run(n.a);
        const b = run(n.b);
        switch (n.op) {
          case "+":
            if (typeof a === "number" && typeof b === "number") return a + b;
            if (typeof a === "string" || typeof b === "string") return str(a) + str(b);
            return null;
          case "-":
          case "*":
          case "/":
          case "%":
          case "^": {
            if (typeof a !== "number" || typeof b !== "number") return null;
            if ((n.op === "/" || n.op === "%") && b === 0) throw new FormulaError("Division by zero.", n.pos);
            const r = n.op === "-" ? a - b : n.op === "*" ? a * b : n.op === "/" ? a / b : n.op === "%" ? a % b : a ** b;
            return Number.isFinite(r) ? r : null;
          }
          case "==":
            return eq(a, b);
          case "!=":
            return !eq(a, b);
          default: {
            const c = cmp(a, b);
            if (c === null) return false;
            return n.op === "<" ? c < 0 : n.op === "<=" ? c <= 0 : n.op === ">" ? c > 0 : c >= 0;
          }
        }
      }
      case "call": {
        const f = FUNCTIONS[n.fn];
        if (!f || !Object.prototype.hasOwnProperty.call(FUNCTIONS, n.fn)) throw new FormulaError(`Unknown function “${n.fn}”.`, n.pos);
        if (n.fn === "if") {
          // Only evaluate the branch that's taken.
          return run(n.args[0]!) ? run(n.args[1]!) : run(n.args[2]!);
        }
        try {
          return f.impl(n.args.map(run), ctx);
        } catch (err) {
          if (err instanceof FormulaError && err.pos === 0) throw new FormulaError(err.message, n.pos);
          throw err;
        }
      }
    }
  };
  return run(root);
}

// ── Compile (parse + typecheck) ───────────────────────────────────────────

export interface CompiledFormula {
  ast: Node | null;
  type: FType;
  issues: TypeIssue[];
  refs: string[];
  volatile: boolean;
}

export function compileFormula(expression: string, props: Map<string, FType>): CompiledFormula {
  try {
    const ast = parse(expression);
    const issues: TypeIssue[] = [];
    const type = typeOf(ast, props, issues);
    return { ast, type, issues, refs: [...referencedProps(ast)], volatile: isVolatile(ast) };
  } catch (err) {
    if (err instanceof FormulaError) return { ast: null, type: "any", issues: [{ message: err.message, pos: err.pos }], refs: [], volatile: false };
    throw err;
  }
}

/** Quote a property name for prop("…"). */
export const quoteName = (name: string) => `"${name.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;

/** Rewrite prop("from") → prop("to") (a property was renamed). Other text is kept as typed. */
export function renameProp(src: string, from: string, to: string): string {
  let toks: Token[];
  try {
    toks = tokenize(src);
  } catch {
    return src;
  }
  const edits: [number, number][] = [];
  for (let i = 0; i + 3 < toks.length; i++) {
    const [a, b, c, d] = [toks[i]!, toks[i + 1]!, toks[i + 2]!, toks[i + 3]!];
    if (a.t === "id" && a.v === "prop" && b.t === "op" && b.v === "(" && c.t === "str" && c.v === from && d.t === "op" && d.v === ")") edits.push([c.pos, d.pos]);
  }
  let out = src;
  for (const [start, end] of edits.reverse()) out = out.slice(0, start) + quoteName(to) + out.slice(end);
  return out;
}
