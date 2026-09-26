import { describe, expect, it } from "vitest";
import { diceCoefficient, hammingDistance, normalizeTitle, simhash } from "@/lib/similarity";
import { compareCandidates } from "@/server/services/duplicates-core";

const article =
  "Server components let you render parts of your application on the server. " +
  "They reduce the amount of JavaScript sent to the browser and can access the database directly. " +
  "In this tutorial we build a small dashboard with Next.js, Prisma and PostgreSQL, and deploy it with Docker. " +
  "We cover data fetching, caching, streaming, error handling and authentication in depth.";

describe("title similarity", () => {
  it("strips site suffixes", () => {
    expect(normalizeTitle("Building a CMS with Next.js | My Blog")).toBe("building a cms with next js");
    expect(normalizeTitle("Building a CMS with Next.js — Medium")).toBe("building a cms with next js");
  });

  it("scores near-identical titles highly and unrelated titles low", () => {
    expect(diceCoefficient("building a cms with nextjs", "building a cms with next js")).toBeGreaterThan(0.85);
    expect(diceCoefficient("building a cms with nextjs", "rust ownership explained")).toBeLessThan(0.3);
  });
});

describe("simhash", () => {
  it("is stable and near for lightly edited text", () => {
    const a = simhash(article);
    const b = simhash(article.replace("small dashboard", "tiny dashboard").replace("in depth", "thoroughly"));
    expect(a).toHaveLength(16);
    expect(simhash(article)).toBe(a);
    expect(hammingDistance(a, b)).toBeLessThanOrEqual(12);
  });

  it("is far for unrelated text", () => {
    const other = "Rust's ownership model guarantees memory safety without a garbage collector. Borrowing rules are checked at compile time by the borrow checker, which prevents data races.";
    expect(hammingDistance(simhash(article), simhash(other))).toBeGreaterThan(15);
  });
});

describe("compareCandidates", () => {
  const candidates = [
    { id: "1", title: "Building a CMS with Next.js | Blog", url: "https://a.com/1", contentHash: "abc", simhash: simhash(article) },
    { id: "2", title: "Completely different post", url: "https://a.com/2", contentHash: "zzz", simhash: "ffffffffffffffff" },
  ];

  it("flags similar titles and identical content", () => {
    const warnings = compareCandidates({ title: "Building a CMS with Next.js", contentHash: "abc", simhash: null }, candidates);
    expect(warnings.map((w) => [w.contentId, w.kind])).toEqual(
      expect.arrayContaining([
        ["1", "TITLE"],
        ["1", "CONTENT"],
      ]),
    );
    expect(warnings.some((w) => w.contentId === "2")).toBe(false);
  });

  it("returns nothing for novel content", () => {
    expect(compareCandidates({ title: "Rust ownership explained", contentHash: "new", simhash: "0000000000000000" }, candidates)).toEqual([]);
  });
});
