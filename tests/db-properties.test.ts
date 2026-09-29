import { describe, expect, it } from "vitest";
import { PropertyValueError, convertValue, optionsFromTexts, safeUrl, validateConfig, validateValue, type PropertyDef } from "@/lib/db-properties";
import { compileFilter, compileSorts, compileUndated, compileWindow } from "@/server/databases/query";

const def = (type: PropertyDef["type"], config: PropertyDef["config"] = {}): PropertyDef => ({ id: "p1", name: "Prop", type, config });
const opts = { options: [{ id: "a", name: "Alpha", color: "blue" as const }, { id: "b", name: "Beta", color: "red" as const }] };

describe("validateValue", () => {
  it.each([
    ["NUMBER", "1,250.5", 1250.5],
    ["CHECKBOX", true, true],
    ["URL", "example.com/x", "https://example.com/x"],
    ["EMAIL", " Me@Example.COM ", "me@example.com"],
    ["PHONE", "+880 1711-000000", "+880 1711-000000"],
    ["TEXT", "   ", null],
  ] as const)("%s %j → %j", (type, input, out) => {
    expect(validateValue(def(type), input)).toEqual(out);
  });

  it("rejects bad values with a clear error", () => {
    expect(() => validateValue(def("NUMBER"), "abc")).toThrow(PropertyValueError);
    expect(() => validateValue(def("URL"), "javascript:alert(1)")).toThrow(/http/);
    expect(() => validateValue(def("SELECT", opts), "zzz")).toThrow(/unknown option/);
    expect(() => validateValue(def("DATE"), { start: "2026-02-30" })).toThrow(/date/);
    expect(() => validateValue(def("CHECKBOX"), "yes")).toThrow();
  });

  it("multi-select keeps known, unique options only", () => {
    expect(validateValue(def("MULTI_SELECT", opts), ["a", "a", "zzz", "b"])).toEqual(["a", "b"]);
  });

  it("dates: end only for ranges, never before the start", () => {
    expect(validateValue(def("DATE"), { start: "2026-01-02", end: "2026-01-05" })).toEqual({ start: "2026-01-02" });
    expect(validateValue(def("DATE", { range: true }), { start: "2026-01-02", end: "2026-01-05" })).toEqual({ start: "2026-01-02", end: "2026-01-05" });
    expect(validateValue(def("DATE", { range: true }), { start: "2026-01-05", end: "2026-01-02" })).toEqual({ start: "2026-01-05" });
  });

  it("files: only http(s) links", () => {
    expect(validateValue(def("FILES"), [{ url: "javascript:x", name: "a" }, { url: "https://m.example/a.pdf", name: "a.pdf", size: 3 }])).toEqual([{ url: "https://m.example/a.pdf", name: "a.pdf", size: 3 }]);
  });

  it("safeUrl refuses other schemes", () => {
    expect(safeUrl("data:text/html,x")).toBeNull();
    expect(safeUrl("ftp://x.example")).toBeNull();
  });
});

describe("convertValue (changing a property's type)", () => {
  it("select → text → select round-trips by option name", () => {
    const text = convertValue(def("SELECT", opts), def("TEXT"), "b");
    expect(text).toBe("Beta");
    expect(convertValue(def("TEXT"), def("SELECT", opts), "beta")).toBe("b");
  });
  it("text → number / checkbox / multi-select", () => {
    expect(convertValue(def("TEXT"), def("NUMBER"), "42")).toBe(42);
    expect(convertValue(def("TEXT"), def("NUMBER"), "n/a")).toBeNull();
    expect(convertValue(def("TEXT"), def("CHECKBOX"), "Done")).toBe(true);
    expect(convertValue(def("TEXT"), def("MULTI_SELECT", opts), "Alpha, Beta")).toEqual(["a", "b"]);
  });
  it("options are created from distinct texts", () => {
    const o = optionsFromTexts(["x", "X", " y ", ""]);
    expect(o.map((x) => x.name)).toEqual(["x", "y"]);
  });
});

describe("validateConfig", () => {
  it("drops bad option data and keeps status groups", () => {
    const c = validateConfig("STATUS", { options: [{ id: "ok1", name: " Todo ", color: "neon", group: "nope" }, { id: "../../x", name: "Done", color: "green", group: "complete" }, { name: "" }] });
    expect(c.options).toHaveLength(2);
    expect(c.options![0]).toMatchObject({ id: "ok1", name: "Todo", color: "gray", group: "todo" });
    expect(c.options![1]!.id).not.toBe("../../x");
    expect(c.options![1]!.group).toBe("complete");
  });
  it("keeps a valid default value only", () => {
    expect(validateConfig("CHECKBOX", { default: true }).default).toBe(true);
    expect(validateConfig("NUMBER", { default: "x" }).default).toBeUndefined();
  });
});

describe("filter compiler", () => {
  const props = new Map([["p1", def("TEXT")], ["n1", { ...def("NUMBER"), id: "n1" }]]);
  const ctx = { props, today: "2026-09-29" };
  it("binds user values as parameters (never inlined)", () => {
    const evil = "x'); DROP TABLE pages; --";
    const q = compileFilter({ kind: "group", id: "g", op: "and", children: [{ kind: "rule", id: "r", propertyId: "p1", operator: "contains", value: evil }] }, ctx);
    expect(q.sql).not.toContain("DROP TABLE");
    expect(q.values.some((v) => typeof v === "string" && v.includes("DROP TABLE"))).toBe(true);
  });
  it("escapes LIKE wildcards in contains", () => {
    const q = compileFilter({ kind: "group", id: "g", op: "and", children: [{ kind: "rule", id: "r", propertyId: "p1", operator: "contains", value: "50%_off" }] }, ctx);
    expect(q.values).toContain("%50\\%\\_off%");
  });
  it("ignores unknown properties and operators", () => {
    const q = compileFilter({ kind: "group", id: "g", op: "or", children: [{ kind: "rule", id: "r", propertyId: "nope", operator: "equals", value: "x" }, { kind: "rule", id: "s", propertyId: "n1", operator: "contains" as never, value: "1" }] }, ctx);
    expect(q.sql).toBe("TRUE");
  });
  it("sorts end with a byte-wise position tiebreak", () => {
    expect(compileSorts([{ propertyId: "n1", direction: "desc" }], ctx).sql).toMatch(/DESC NULLS LAST, p\."position" COLLATE "C" ASC, p\."id" ASC$/);
  });
});

describe("date window compiler", () => {
  const props = new Map([["d1", { id: "d1", name: "Due", type: "DATE" as const, config: {} }], ["t1", { id: "t1", name: "Note", type: "TEXT" as const, config: {} }]]);
  const ctx = { props, today: "2026-09-29" };
  it("binds the range as parameters and tests overlap", () => {
    const q = compileWindow({ propertyId: "d1", from: "2026-09-01", to: "2026-09-30" }, ctx)!;
    expect(q.sql).toMatch(/<= (\?|\$\d+) AND COALESCE/);
    expect(q.values).toEqual(expect.arrayContaining(["2026-09-01", "2026-09-30"]));
  });
  it("ignores non-date properties", () => {
    expect(compileWindow({ propertyId: "t1", from: "2026-09-01", to: "2026-09-30" }, ctx)).toBeNull();
    expect(compileUndated("t1", ctx)).toBeNull();
    expect(compileUndated("d1", ctx)!.sql).toMatch(/IS NULL/);
  });
});
