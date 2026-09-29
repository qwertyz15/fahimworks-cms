/** Today's date in the local time zone, YYYY-MM-DD (relative date filters use it). */
export function localToday(): string {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

/*
 * Date-only helpers on YYYY-MM-DD strings, computed in UTC so daylight-saving
 * changes never shift a day.
 */
const toUtc = (d: string) => new Date(`${d}T00:00:00Z`);
const fromUtc = (t: Date) => t.toISOString().slice(0, 10);

export function addDays(d: string, n: number): string {
  const t = toUtc(d);
  t.setUTCDate(t.getUTCDate() + n);
  return fromUtc(t);
}

export function addMonths(d: string, n: number): string {
  const t = toUtc(d);
  const day = t.getUTCDate();
  t.setUTCDate(1);
  t.setUTCMonth(t.getUTCMonth() + n);
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(day, last));
  return fromUtc(t);
}

/** Whole days from a to b (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday. */
export const weekday = (d: string) => toUtc(d).getUTCDay();

export const monthStart = (d: string) => `${d.slice(0, 7)}-01`;

/** The first day of the week containing d. */
export function startOfWeek(d: string, weekStart: "mon" | "sun" = "mon"): string {
  const offset = (weekday(d) - (weekStart === "mon" ? 1 : 0) + 7) % 7;
  return addDays(d, -offset);
}

/** The 6×7 calendar grid for the month of `d`: 42 dates, whole weeks. */
export function monthGrid(d: string, weekStart: "mon" | "sun" = "mon"): string[] {
  const first = startOfWeek(monthStart(d), weekStart);
  return Array.from({ length: 42 }, (_, i) => addDays(first, i));
}

/** ISO 8601 week number. */
export function isoWeek(d: string): number {
  const t = toUtc(d);
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  return Math.ceil(((t.getTime() - yearStart) / 86_400_000 + 1) / 7);
}

const monthFmt = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" });
export const monthLabel = (d: string) => monthFmt.format(toUtc(d));
const shortFmt = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });
export const shortDate = (d: string) => shortFmt.format(toUtc(d));
