import { describe, expect, it } from "vitest";
import { fileBodyMatches, findMetaToken, metaTagSnippet, verificationFileName, verificationFileUrl } from "@/server/services/verification/match";

const TOKEN = "abc123xyz789abc123xyz789abc123xyz789abcd";
const page = (head: string, body = "") => `<!doctype html><html><head><title>t</title>${head}</head><body>${body}</body></html>`;

describe("meta tag verification", () => {
  it("matches the token in <head>", () => {
    expect(findMetaToken(page(metaTagSnippet(TOKEN)), TOKEN)).toEqual({ found: true, matches: true, count: 1 });
  });

  it("is tolerant of attribute case and whitespace", () => {
    expect(findMetaToken(page(`<META NAME=" Portfolio-Verification " CONTENT="  ${TOKEN} ">`), TOKEN)).toMatchObject({ matches: true });
  });

  it("accepts when one of several tags matches", () => {
    expect(findMetaToken(page(`<meta name="portfolio-verification" content="old"><meta name="portfolio-verification" content="${TOKEN}">`), TOKEN)).toMatchObject({ matches: true, count: 2 });
  });

  it("reports a mismatch", () => {
    expect(findMetaToken(page(`<meta name="portfolio-verification" content="wrong">`), TOKEN)).toEqual({ found: true, matches: false, count: 1 });
  });

  it("reports missing tag", () => {
    expect(findMetaToken(page(""), TOKEN)).toEqual({ found: false });
  });

  it("ignores tags injected in <body> (e.g. via comments)", () => {
    expect(findMetaToken(page("", `<div class="comment">${metaTagSnippet(TOKEN)}</div>`), TOKEN)).toEqual({ found: false });
  });

  it("does not accept a prefix or substring of the token", () => {
    expect(findMetaToken(page(`<meta name="portfolio-verification" content="${TOKEN.slice(0, 10)}">`), TOKEN)).toMatchObject({ matches: false });
    expect(findMetaToken(page(`<meta name="portfolio-verification" content="${TOKEN}extra">`), TOKEN)).toMatchObject({ matches: false });
  });
});

describe("file verification", () => {
  it("builds the file URL at the site root", () => {
    expect(verificationFileName(TOKEN)).toBe(`portfolio-verification-${TOKEN}.txt`);
    expect(verificationFileUrl("https://example.com/blog/post?x=1", TOKEN)).toBe(`https://example.com/portfolio-verification-${TOKEN}.txt`);
  });

  it("matches exact contents allowing trailing newline and BOM", () => {
    expect(fileBodyMatches(TOKEN, TOKEN)).toBe(true);
    expect(fileBodyMatches(`${TOKEN}\n`, TOKEN)).toBe(true);
    expect(fileBodyMatches(`﻿${TOKEN}\r\n`, TOKEN)).toBe(true);
  });

  it("rejects other contents", () => {
    expect(fileBodyMatches("", TOKEN)).toBe(false);
    expect(fileBodyMatches(`${TOKEN} ${TOKEN}`, TOKEN)).toBe(false);
    expect(fileBodyMatches("<html>404 not found</html>", TOKEN)).toBe(false);
  });
});
