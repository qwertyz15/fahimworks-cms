import { describe, expect, it } from "vitest";
import { ROLLUP_FNS, computeRollup, rollupFnsFor, rollupResultType } from "@/lib/db-rollup";
import type { PropertyDef } from "@/lib/db-properties";

const num: Pick<PropertyDef, "type" | "config"> = { type: "NUMBER", config: {} };
const date: Pick<PropertyDef, "type" | "config"> = { type: "DATE", config: { range: true } };
const check: Pick<PropertyDef, "type" | "config"> = { type: "CHECKBOX", config: {} };
const tags: Pick<PropertyDef, "type" | "config"> = { type: "MULTI_SELECT", config: { options: [{ id: "a", name: "AI", color: "blue" }, { id: "w", name: "Web", color: "green" }] } };
const status: Pick<PropertyDef, "type" | "config"> = {
  type: "STATUS",
  config: { options: [{ id: "t", name: "Todo", color: "gray", group: "todo" }, { id: "d", name: "Done", color: "green", group: "complete" }, { id: "s", name: "Shipped", color: "blue", group: "complete" }] },
};
const formulaNum: Pick<PropertyDef, "type" | "config"> = { type: "FORMULA", config: { resultType: "number" } };

describe("rollups", () => {
  it("numbers", () => {
    const v = [3, null, 1, 4, { error: "x" }];
    expect(computeRollup("sum", num, v)).toBe(8);
    expect(computeRollup("average", num, v)).toBeCloseTo(8 / 3);
    expect(computeRollup("median", num, v)).toBe(3);
    expect(computeRollup("median", num, [1, 2, 3, 4])).toBe(2.5);
    expect(computeRollup("min", num, v)).toBe(1);
    expect(computeRollup("max", num, v)).toBe(4);
    expect(computeRollup("range", num, v)).toBe(3);
    expect(computeRollup("count_all", num, v)).toBe(5);
    expect(computeRollup("count_values", num, v)).toBe(3);
    expect(computeRollup("count_empty", num, v)).toBe(2);
    expect(computeRollup("percent_not_empty", num, v)).toBe(0.6);
  });
  it("empty input", () => {
    for (const fn of ROLLUP_FNS) expect(() => computeRollup(fn, num, [])).not.toThrow();
    expect(computeRollup("sum", num, [])).toBe(0);
    expect(computeRollup("average", num, [])).toBe(null);
    expect(computeRollup("percent_empty", num, [])).toBe(0);
    expect(computeRollup("show_original", num, [])).toBe(null);
  });
  it("dates", () => {
    const v = [{ start: "2026-10-05" }, { start: "2026-09-01", end: "2026-12-24" }, null];
    expect(computeRollup("earliest", date, v)).toEqual({ start: "2026-09-01" });
    expect(computeRollup("latest", date, v)).toEqual({ start: "2026-12-24" });
    expect(computeRollup("date_range", date, v)).toEqual({ start: "2026-09-01", end: "2026-12-24" });
    const created: Pick<PropertyDef, "type" | "config"> = { type: "CREATED_TIME", config: {} };
    expect(computeRollup("latest", created, ["2026-09-29T10:00:00.000Z", "2026-01-02T00:00:00.000Z"])).toEqual({ start: "2026-09-29" });
  });
  it("checkboxes and status", () => {
    expect(computeRollup("checked", check, [true, false, null, true])).toBe(2);
    expect(computeRollup("percent_unchecked", check, [true, false, null, true])).toBe(0.5);
    expect(computeRollup("percent_complete", status, ["t", "d", "s", null])).toBe(0.5);
  });
  it("show original and unique values use display names", () => {
    expect(computeRollup("show_original", tags, [["a", "w"], ["a"], null])).toEqual(["AI", "Web", "AI"]);
    expect(computeRollup("count_unique", tags, [["a", "w"], ["a"]])).toBe(2);
    expect(computeRollup("count_values", tags, [["a", "w"], ["a"], []])).toBe(3);
  });
  it("offers functions by target type and results follow the function", () => {
    expect(rollupFnsFor(num)).toContain("sum");
    expect(rollupFnsFor(formulaNum)).toContain("median");
    expect(rollupFnsFor(tags)).not.toContain("sum");
    expect(rollupFnsFor(status)).toContain("percent_complete");
    expect(rollupFnsFor({ type: "RELATION", config: {} })).not.toContain("show_original");
    expect(rollupResultType("show_original")).toBe("list");
    expect(rollupResultType("date_range")).toBe("date");
    expect(rollupResultType("percent_complete")).toBe("number");
  });
});
