import "server-only";
import { db } from "@/lib/db";
import { compareCandidates, type DuplicateProbe, type DuplicateWarning } from "./duplicates-core";

export * from "./duplicates-core";

/** Exact URL duplicate (blocking) by normalised URL. */
export async function findUrlDuplicate(normalizedUrl: string, excludeId?: string) {
  const existing = await db.content.findUnique({ where: { normalizedUrl }, select: { id: true, title: true, url: true } });
  return existing && existing.id !== excludeId ? existing : null;
}

/**
 * Title / content similarity (non-blocking warnings). Compares against every
 * item — fine for a personal corpus (thousands of rows). For larger datasets
 * replace with pg_trgm similarity() and a SimHash band index.
 */
export async function findSimilar(probe: DuplicateProbe, excludeId?: string): Promise<DuplicateWarning[]> {
  const candidates = await db.content.findMany({
    where: excludeId ? { id: { not: excludeId } } : undefined,
    select: { id: true, title: true, url: true, contentHash: true, simhash: true },
  });
  return compareCandidates(probe, candidates);
}
