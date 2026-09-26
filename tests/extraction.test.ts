import { describe, expect, it } from "vitest";
import { checkMeaningful, extractDocument } from "@/server/services/extraction/parse";

const paragraph = (n: number) =>
  Array.from({ length: n }, (_, i) => `<p>This is paragraph ${i + 1} of a detailed tutorial about building resilient web applications with modern tooling, careful testing and thoughtful architecture decisions.</p>`).join("");

const ARTICLE = `<!doctype html>
<html lang="en">
<head>
  <title>Fallback title | Site</title>
  <meta name="description" content="Learn how to build a CMS.">
  <meta property="og:title" content="Building a CMS with Next.js">
  <meta property="og:image" content="/images/cover.png">
  <meta property="og:site_name" content="Dev Notes">
  <meta property="article:published_time" content="2025-03-14T09:00:00Z">
  <meta property="article:tag" content="Next.js">
  <meta property="article:tag" content="Prisma">
  <link rel="canonical" href="https://blog.example.com/cms">
  <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite","name":"Dev Notes"},{"@type":"BlogPosting","headline":"Building a CMS with Next.js","author":{"@type":"Person","name":"Jane Doe"},"keywords":"cms, typescript"}]}</script>
</head>
<body>
  <nav><a href="/">Home</a><a href="/about">About</a></nav>
  <article>
    <h1>Building a CMS with Next.js</h1>
    ${paragraph(12)}
    <img src="/images/diagram.png" alt="diagram">
    <p><a href="/next">Relative link</a> and <a href="javascript:alert(1)">bad link</a>.</p>
    <script>alert("xss")</script>
    <p onclick="steal()">Handler paragraph with enough words to be kept in the readable output of the article body.</p>
  </article>
  <footer>© 2025</footer>
</body>
</html>`;

describe("extractDocument", async () => {
  const doc = await extractDocument(ARTICLE, "https://blog.example.com/cms");

  it("extracts metadata with the right precedence", () => {
    expect(doc.title).toBe("Building a CMS with Next.js");
    expect(doc.description).toBe("Learn how to build a CMS.");
    expect(doc.author).toBe("Jane Doe");
    expect(doc.siteName).toBe("Dev Notes");
    expect(doc.language).toBe("en");
    expect(doc.canonicalUrl).toBe("https://blog.example.com/cms");
    expect(doc.publishDate?.toISOString()).toBe("2025-03-14T09:00:00.000Z");
  });

  it("resolves images and collects tags", () => {
    expect(doc.thumbnail).toBe("https://blog.example.com/images/cover.png");
    expect(doc.images).toContain("https://blog.example.com/images/diagram.png");
    expect(doc.tags).toEqual(expect.arrayContaining(["Next.js", "Prisma", "cms", "typescript"]));
  });

  it("extracts main content and sanitises it", () => {
    expect(doc.wordCount).toBeGreaterThan(200);
    expect(doc.contentHtml).not.toMatch(/<script/i);
    expect(doc.contentHtml).not.toMatch(/onclick/i);
    expect(doc.contentHtml).not.toMatch(/javascript:/i);
    expect(doc.contentHtml).toContain('href="https://blog.example.com/next"');
    expect(doc.contentHtml).toContain('rel="noopener noreferrer nofollow ugc"');
    expect(doc.contentText).not.toContain("© 2025");
  });

  it("accepts the article as meaningful", () => {
    expect(checkMeaningful(doc, 150)).toEqual({ ok: true });
  });

  it("rejects thin pages", async () => {
    const thin = await extractDocument("<html><head><title>Hi</title></head><body><p>Coming soon.</p></body></html>", "https://example.com/");
    expect(checkMeaningful(thin, 150).ok).toBe(false);
  });

  it("rejects link-list index pages", async () => {
    const links = Array.from({ length: 80 }, (_, i) => `<li><a href="/p/${i}">Post number ${i} about something interesting</a></li>`).join("");
    const index = await extractDocument(`<html><head><title>Archive</title></head><body><article><h1>Archive</h1><ul>${links}</ul></article></body></html>`, "https://example.com/archive");
    const res = checkMeaningful(index, 150);
    expect(res.ok).toBe(false);
  });
});
