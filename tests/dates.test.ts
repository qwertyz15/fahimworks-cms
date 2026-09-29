import { describe, expect, it } from "vitest";
import { addDays, addMonths, daysBetween, isoWeek, monthGrid, startOfWeek, weekday } from "@/lib/dates";
import { dateWindowSchema, viewConfigSchema } from "@/lib/db-views";

describe("date helpers", () => {
  it("adds days across months, years and DST changes", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30"); // EU DST switch
    expect(addDays("2026-11-01", -1)).toBe("2026-10-31"); // US DST switch
  });
  it("adds months, clamping to the month's last day", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
  });
  it("counts days between dates", () => {
    expect(daysBetween("2026-09-29", "2026-10-02")).toBe(3);
    expect(daysBetween("2026-10-02", "2026-09-29")).toBe(-3);
  });
  it("weeks start on Monday or Sunday", () => {
    expect(weekday("2026-09-29")).toBe(2); // Tuesday
    expect(startOfWeek("2026-09-29", "mon")).toBe("2026-09-28");
    expect(startOfWeek("2026-09-29", "sun")).toBe("2026-09-27");
    expect(isoWeek("2026-01-01")).toBe(1);
    expect(isoWeek("2027-01-01")).toBe(53);
  });
  it("month grid: 42 days, whole weeks, covering the month", () => {
    const g = monthGrid("2026-02-10", "mon");
    expect(g).toHaveLength(42);
    expect(weekday(g[0]!)).toBe(1);
    expect(g).toContain("2026-02-01");
    expect(g).toContain("2026-02-28");
    const s = monthGrid("2027-01-05", "sun");
    expect(weekday(s[0]!)).toBe(0);
    expect(s[0]).toBe("2026-12-27");
  });
});

describe("view settings", () => {
  it("accepts the new layout options and rejects bad ones", () => {
    expect(viewConfigSchema.safeParse({ dateBy: "p1", endBy: null, scale: "week", weekStart: "sun", cover: "page", cardSize: "large", coverFit: "contain", openIn: "page" }).success).toBe(true);
    expect(viewConfigSchema.safeParse({ scale: "year" }).success).toBe(false);
    expect(viewConfigSchema.safeParse({ cover: "../x" }).success).toBe(false);
    expect(dateWindowSchema.safeParse({ propertyId: "p1", from: "2026-01-01", to: "2026-01-31" }).success).toBe(true);
    expect(dateWindowSchema.safeParse({ propertyId: "p1", from: "2026-1-1", to: "x" }).success).toBe(false);
  });
});
