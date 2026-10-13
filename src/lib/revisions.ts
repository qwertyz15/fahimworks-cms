/**
 * Version history rules, shared by the server (what to keep) and tests.
 *
 *  - Autosaves are coalesced: one version per 10-minute window (the latest
 *    state in that window). Manual saves within a minute merge too.
 *  - Kept: every published version, the newest one, everything from the last
 *    7 days, then one a day up to 90 days, at most 200 in all (published ones
 *    don't count towards the cap).
 */

export type RevisionReason = "auto" | "save" | "publish" | "restore";

export const AUTO_WINDOW_MS = 10 * 60 * 1000;
export const SAVE_WINDOW_MS = 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
export const KEEP_ALL_DAYS = 7;
export const KEEP_DAILY_DAYS = 90;
export const MAX_REVISIONS = 200;

export interface RevisionMeta {
  id: string;
  updatedAt: Date;
  reason: string;
  published: boolean;
}

/** Can a new save update the latest version instead of adding one? */
export function mergesInto(latest: RevisionMeta | null, reason: RevisionReason, now: Date): boolean {
  if (!latest || latest.published || reason === "publish" || reason === "restore") return false;
  if (latest.reason === "restore") return false;
  const age = now.getTime() - latest.updatedAt.getTime();
  if (reason === "auto") return latest.reason === "auto" && age < AUTO_WINDOW_MS;
  return (latest.reason === "auto" || latest.reason === "save") && age < SAVE_WINDOW_MS;
}

/** Versions to delete, given all of one entry's versions. */
export function prunable(revisions: RevisionMeta[], now: Date): string[] {
  const sorted = [...revisions].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  const keep = new Set<string>();
  const seenDays = new Set<string>();
  const drop: string[] = [];
  for (const [i, r] of sorted.entries()) {
    const age = now.getTime() - r.updatedAt.getTime();
    if (r.published || i === 0 || age < KEEP_ALL_DAYS * DAY) {
      keep.add(r.id);
      continue;
    }
    if (age < KEEP_DAILY_DAYS * DAY) {
      const day = r.updatedAt.toISOString().slice(0, 10);
      if (!seenDays.has(day)) {
        seenDays.add(day);
        keep.add(r.id);
        continue;
      }
    }
    drop.push(r.id);
  }
  // Cap (published versions don't count).
  const unpublished = sorted.filter((r) => keep.has(r.id) && !r.published);
  for (const r of unpublished.slice(MAX_REVISIONS)) drop.push(r.id);
  return drop;
}

// ── Text diff (the history panel's "what changed") ─────────────────────────

export type DiffPart = { kind: "same" | "add" | "del"; text: string };

/** Longest-common-subsequence diff of two token lists (fine for paragraphs / words). */
function lcs<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): ("same" | "add" | "del")[][] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i]![j] = eq(a[i]!, b[j]!) ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const ops: ("same" | "add" | "del")[][] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && eq(a[i]!, b[j]!)) {
      ops.push(["same"]);
      i++;
      j++;
    } else if (i < n && (j === m || dp[i + 1]![j]! >= dp[i]![j + 1]!)) {
      // Removed before added: reads "brown → red".
      ops.push(["del"]);
      i++;
    } else {
      ops.push(["add"]);
      j++;
    }
  }
  return ops;
}

const words = (s: string) => s.split(/(\s+)/).filter((w) => w !== "");

/**
 * Changes from `before` to `after`, paragraph by paragraph; within a changed
 * paragraph, word by word. Large documents fall back to whole paragraphs.
 */
export function diffText(before: string, after: string): DiffPart[][] {
  const pa = before.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  const pb = after.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  if (pa.length * pb.length > 4_000_000) return [[{ kind: "del", text: before }], [{ kind: "add", text: after }]];
  const ops = lcs(pa, pb, (x, y) => x === y);
  const out: DiffPart[][] = [];
  let i = 0;
  let j = 0;
  const pendingDel: string[] = [];
  const pendingAdd: string[] = [];
  const flush = () => {
    // Pair up removed / added paragraphs and diff them word by word.
    while (pendingDel.length || pendingAdd.length) {
      const d = pendingDel.shift();
      const a = pendingAdd.shift();
      if (d !== undefined && a !== undefined) {
        const wa = words(d);
        const wb = words(a);
        if (wa.length * wb.length > 250_000) {
          out.push([{ kind: "del", text: d }]);
          out.push([{ kind: "add", text: a }]);
          continue;
        }
        const wops = lcs(wa, wb, (x, y) => x === y);
        // Only a rewrite of the same paragraph is shown word by word; unrelated ones as a whole.
        const shared = wops.filter(([op]) => op === "same").length;
        if (shared / Math.max(wa.length, wb.length) < 0.4) {
          out.push([{ kind: "del", text: d }]);
          out.push([{ kind: "add", text: a }]);
          continue;
        }
        const parts: DiffPart[] = [];
        let x = 0;
        let y = 0;
        for (const [op] of wops) {
          let text: string;
          if (op === "same") {
            text = wa[x]!;
            x++;
            y++;
          } else if (op === "del") text = wa[x++]!;
          else text = wb[y++]!;
          const last = parts.at(-1);
          if (last && last.kind === op) last.text += text;
          else parts.push({ kind: op!, text });
        }
        out.push(parts);
      } else if (d !== undefined) out.push([{ kind: "del", text: d }]);
      else if (a !== undefined) out.push([{ kind: "add", text: a }]);
    }
  };
  for (const [op] of ops) {
    if (op === "same") {
      flush();
      out.push([{ kind: "same", text: pa[i]! }]);
      i++;
      j++;
    } else if (op === "del") pendingDel.push(pa[i++]!);
    else pendingAdd.push(pb[j++]!);
  }
  flush();
  return out;
}
