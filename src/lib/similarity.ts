import { createHash } from "node:crypto";

/** Lower-case, strip punctuation/diacritics and collapse whitespace. */
export function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip common site-name suffixes like "My Post | Blog" or "My Post - Medium". */
export function normalizeTitle(title: string): string {
  const main = title.split(/\s+[|–—·-]\s+/)[0] ?? title;
  return normalizeText(main.length >= 8 ? main : title);
}

function bigrams(value: string): Map<string, number> {
  const s = value.replace(/\s+/g, " ");
  const map = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const bg = s.slice(i, i + 2);
    map.set(bg, (map.get(bg) ?? 0) + 1);
  }
  return map;
}

/** Sørensen–Dice coefficient on character bigrams, 0..1. */
export function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let overlap = 0;
  for (const [bg, count] of A) overlap += Math.min(count, B.get(bg) ?? 0);
  return (2 * overlap) / (a.length - 1 + (b.length - 1));
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hash64(token: string): bigint {
  // First 8 bytes of SHA-1 — well distributed and fast enough for SimHash.
  return createHash("sha1").update(token).digest().readBigUInt64BE(0);
}

/**
 * 64-bit SimHash over word 3-shingles. Near-duplicate documents produce
 * hashes with a small Hamming distance. Returned as 16 hex chars.
 */
export function simhash(text: string): string {
  const words = normalizeText(text).split(" ").filter(Boolean);
  const weights = new Array<number>(64).fill(0);
  const shingles = words.length < 3 ? [words.join(" ")] : words.slice(0, -2).map((_, i) => words.slice(i, i + 3).join(" "));

  for (const shingle of shingles) {
    if (!shingle) continue;
    const h = hash64(shingle);
    for (let bit = 0; bit < 64; bit++) {
      weights[bit]! += (h >> BigInt(bit)) & 1n ? 1 : -1;
    }
  }
  let out = 0n;
  for (let bit = 0; bit < 64; bit++) if (weights[bit]! > 0) out |= 1n << BigInt(bit);
  return out.toString(16).padStart(16, "0");
}

export function hammingDistance(aHex: string, bHex: string): number {
  let x = BigInt(`0x${aHex}`) ^ BigInt(`0x${bHex}`);
  let count = 0;
  while (x) {
    x &= x - 1n;
    count++;
  }
  return count;
}
