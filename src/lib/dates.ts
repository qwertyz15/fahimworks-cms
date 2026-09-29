/** Today's date in the local time zone, YYYY-MM-DD (relative date filters use it). */
export function localToday(): string {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}
