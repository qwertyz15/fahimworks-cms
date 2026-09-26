import { diceCoefficient, hammingDistance, normalizeTitle } from "@/lib/similarity";

/** Pure duplicate comparison — unit tested in tests/duplicates.test.ts. */

export type DuplicateKind = "URL" | "TITLE" | "CONTENT";

export interface DuplicateWarning {
  kind: DuplicateKind;
  contentId: string;
  title: string;
  url: string;
  /** 0..1 similarity. */
  score: number;
  detail: string;
}

export interface DuplicateCandidate {
  id: string;
  title: string;
  url: string;
  contentHash: string | null;
  simhash: string | null;
}

export interface DuplicateProbe {
  title?: string | null;
  contentHash?: string | null;
  simhash?: string | null;
}

export const TITLE_THRESHOLD = 0.85;
export const SIMHASH_MAX_DISTANCE = 6;

export function compareCandidates(probe: DuplicateProbe, candidates: DuplicateCandidate[]): DuplicateWarning[] {
  const warnings: DuplicateWarning[] = [];
  const probeTitle = probe.title ? normalizeTitle(probe.title) : "";

  for (const c of candidates) {
    if (probeTitle.length >= 4) {
      const other = normalizeTitle(c.title);
      const score = probeTitle === other ? 1 : diceCoefficient(probeTitle, other);
      if (score >= TITLE_THRESHOLD) {
        warnings.push({
          kind: "TITLE",
          contentId: c.id,
          title: c.title,
          url: c.url,
          score,
          detail: score === 1 ? "Identical title" : `Title ${Math.round(score * 100)}% similar`,
        });
      }
    }
    if (probe.contentHash && c.contentHash && probe.contentHash === c.contentHash) {
      warnings.push({ kind: "CONTENT", contentId: c.id, title: c.title, url: c.url, score: 1, detail: "Identical content" });
    } else if (probe.simhash && c.simhash) {
      const distance = hammingDistance(probe.simhash, c.simhash);
      if (distance <= SIMHASH_MAX_DISTANCE) {
        const score = 1 - distance / 64;
        warnings.push({
          kind: "CONTENT",
          contentId: c.id,
          title: c.title,
          url: c.url,
          score,
          detail: `Content ~${Math.round(score * 100)}% similar`,
        });
      }
    }
  }
  return warnings.sort((a, b) => b.score - a.score).slice(0, 10);
}
