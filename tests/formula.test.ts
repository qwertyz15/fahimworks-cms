import { describe, expect, it } from "vitest";
import { compileFormula, evaluate, formatDate, MAX_STEPS, type FType, type FValue } from "@/lib/formula/engine";
import { parse } from "@/lib/formula/parse";
import { MAX_FORMULA_LENGTH } from "@/lib/formula/tokenize";

const PROPS = new Map<string, FType>([
  ["Quantity", "number"],
  ["Price", "number"],
  ["Name", "text"],
  ["Done", "boolean"],
  ["Due", "date"],
  ["Tags", "list"],
]);
const VALUES: Record<string, FValue> = {
  Quantity: 3,
  Price: 2.5,
  Name: "Alpha Beta",
  Done: true,
  Due: { date: "2026-10-09" },
  Tags: ["AI", "Web"],
};

function run(expr: string, values: Record<string, FValue> = VALUES) {
  const c = compileFormula(expr, PROPS);
  if (c.issues.length) throw new Error(c.issues.map((i) => `${i.message}@${i.pos}`).join("; "));
  return evaluate(c.ast!, { getProp: (n) => values[n] ?? null, today: "2026-09-29", time: "10:30" });
}
const issues = (expr: string) => compileFormula(expr, PROPS).issues;

describe("formula parser", () => {
  it("respects precedence and associativity", () => {
    expect(run("1 + 2 * 3")).toBe(7);
    expect(run("(1 + 2) * 3")).toBe(9);
    expect(run("2 ^ 3 ^ 2")).toBe(512);
    expect(run("-2 ^ 2")).toBe(4);
    expect(run("10 - 4 - 3")).toBe(3);
    expect(run("1 < 2 and 3 > 4 or true")).toBe(true);
    expect(run("not 1 == 2")).toBe(true);
  });
  it("reads strings with escapes and unicode operators", () => {
    expect(run('"a\\"b"')).toBe('a"b');
    expect(run('"line\\nbreak"')).toBe("line\nbreak");
    expect(run("6 × 7")).toBe(42);
    expect(run("7 ÷ 2")).toBe(3.5);
    expect(run("3 ≥ 3")).toBe(true);
  });
  it("reports errors with positions", () => {
    expect(issues("1 +")[0]!.pos).toBeGreaterThanOrEqual(2);
    expect(issues("(1 + 2")[0]!.message).toMatch(/\)/);
    expect(issues("foo")[0]!.message).toMatch(/prop\("foo"\)/);
    expect(issues('prop("Nope")')[0]).toEqual({ message: "No property called “Nope”.", pos: 0 });
    expect(issues('1 + prop("Due")')[0]!.pos).toBe(2);
  });
  it("enforces length and depth limits", () => {
    expect(issues("1+".repeat(MAX_FORMULA_LENGTH) + "1")[0]!.message).toMatch(/up to 1000/);
    expect(issues("(".repeat(60) + "1" + ")".repeat(60))[0]!.message).toMatch(/nested/i);
  });
  it("can't reach anything but properties and the function table", () => {
    expect(issues("constructor(1)")[0]!.message).toMatch(/Unknown function/);
    expect(issues("__proto__(1)")[0]!.message).toMatch(/Unknown function/);
    expect(issues("toString()")[0]!.message).toMatch(/Unknown function/);
    expect(() => parse("process.exit()")).toThrow();
    expect(() => parse("a[0]")).toThrow();
  });
});

describe("formula types", () => {
  const typeOf = (e: string) => compileFormula(e, PROPS).type;
  it("infers result types", () => {
    expect(typeOf('prop("Quantity") * prop("Price")')).toBe("number");
    expect(typeOf('prop("Name") + "!"')).toBe("text");
    expect(typeOf('prop("Quantity") > 2')).toBe("boolean");
    expect(typeOf('dateAdd(prop("Due"), 1, "days")')).toBe("date");
    expect(typeOf('if(prop("Done"), 1, 2)')).toBe("number");
    expect(typeOf('if(prop("Done"), 1, "x")')).toBe("any");
  });
  it("rejects mismatched arguments", () => {
    expect(issues('prop("Due") - 1')[0]!.message).toMatch(/dateBetween/);
    expect(issues('round("x")')[0]!.message).toMatch(/Argument 1 of round\(\) should be number/);
    expect(issues("abs()")[0]!.message).toMatch(/takes 1 argument/);
    expect(issues("today(1)")[0]!.message).toMatch(/takes 0/);
    expect(issues('prop("Tags") < 1')[0]!.message).toMatch(/compare/);
  });
  it("tracks references and volatility", () => {
    const c = compileFormula('dateBetween(prop("Due"), today(), "days") + prop("Quantity")', PROPS);
    expect(c.refs.sort()).toEqual(["Due", "Quantity"]);
    expect(c.volatile).toBe(true);
    expect(compileFormula('prop("Price")', PROPS).volatile).toBe(false);
  });
});

describe("formula evaluation", () => {
  it("does the spec's examples", () => {
    expect(run('prop("Quantity") * prop("Price")')).toBe(7.5);
    expect(run('dateBetween(prop("Due"), today(), "days")')).toBe(10);
  });
  it("number functions", () => {
    expect(run("abs(-3)")).toBe(3);
    expect(run("round(2.345, 2)")).toBe(2.35);
    expect(run("round(2.5)")).toBe(3);
    expect(run("floor(2.7) + ceil(2.1)")).toBe(5);
    expect(run("sqrt(16) + pow(2, 3)")).toBe(12);
    expect(run("min(3, 1, 2)")).toBe(1);
    expect(run("max(3, 1, 2)")).toBe(3);
    expect(run("10 % 4")).toBe(2);
  });
  it("text functions", () => {
    expect(run('length(prop("Name"))')).toBe(10);
    expect(run('length(prop("Tags"))')).toBe(2);
    expect(run('concat(prop("Name"), " #", prop("Quantity"))')).toBe("Alpha Beta #3");
    expect(run('join(prop("Tags"), " · ")')).toBe("AI · Web");
    expect(run('lower("AbC") + upper("x")')).toBe("abcX");
    expect(run('contains(prop("Name"), "Beta")')).toBe(true);
    expect(run('contains(prop("Tags"), "ML")')).toBe(false);
    expect(run('replace("a-b-c", "-", " ")')).toBe("a b c");
    expect(run("format(1.5) + format(true)")).toBe("1.5true");
    expect(run('toNumber("1,234.5") + 1')).toBe(1235.5);
    expect(run('empty(prop("Tags"))')).toBe(false);
    expect(run('empty(prop("Due"))', {})).toBe(true);
  });
  it("date functions", () => {
    expect(run("today()")).toEqual({ date: "2026-09-29" });
    expect(run("now()")).toEqual({ date: "2026-09-29", time: "10:30" });
    expect(run('dateAdd(prop("Due"), 1, "month")')).toEqual({ date: "2026-11-09" });
    expect(run('dateAdd(prop("Due"), 2, "weeks")')).toEqual({ date: "2026-10-23" });
    expect(run('dateSubtract(prop("Due"), 1, "years")')).toEqual({ date: "2025-10-09" });
    expect(run('dateBetween(prop("Due"), dateSubtract(prop("Due"), 13, "months"), "years")')).toBe(1);
    expect(run('dateBetween(today(), prop("Due"), "weeks")')).toBe(-1);
    expect(run('formatDate(prop("Due"), "dddd, MMMM D YYYY")')).toBe("Friday, October 9 2026");
    expect(run('year(prop("Due")) * 100 + month(prop("Due"))')).toBe(202610);
    expect(run('day(prop("Due"))')).toBe(9);
    expect(run('prop("Due") > today()')).toBe(true);
    expect(() => run('dateAdd(prop("Due"), 1, "fortnights")')).toThrow(/Unknown unit/);
  });
  it("empty values propagate instead of crashing", () => {
    expect(run('prop("Quantity") * 2', {})).toBe(null);
    expect(run('prop("Name") + "!"', {})).toBe("!");
    expect(run('dateBetween(prop("Due"), today(), "days")', {})).toBe(null);
  });
  it("only evaluates the taken if() branch", () => {
    expect(run("if(true, 1, 1 / 0)")).toBe(1);
    expect(() => run("1 / 0")).toThrow(/Division by zero/);
  });
  it("stops runaway evaluation", () => {
    // Nesting is capped, so build breadth: a long chain of additions within the length limit.
    const expr = Array.from({ length: 400 }, () => "1").join("+");
    expect(run(expr)).toBe(400);
    expect(MAX_STEPS).toBeGreaterThan(800);
  });
  it("formats dates", () => {
    expect(formatDate({ date: "2026-01-05" }, "YY-MM-DD ddd")).toBe("26-01-05 Mon");
  });
});

describe("renameProp", () => {
  it("rewrites references, not other strings", async () => {
    const { renameProp } = await import("@/lib/formula/engine");
    expect(renameProp('prop("Price") * 2 + length("Price")', "Price", "Unit price")).toBe('prop("Unit price") * 2 + length("Price")');
    expect(renameProp('prop( "A" ) + prop("B")', "A", 'Say "hi"')).toBe('prop( "Say \\"hi\\"") + prop("B")');
    expect(renameProp("prop(", "A", "B")).toBe("prop(");
  });
});
