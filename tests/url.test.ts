import { describe, expect, it } from "vitest";
import { normalizeUrl, parseSubmittedUrl, sameSite } from "@/lib/url";

describe("normalizeUrl", () => {
  it("treats cosmetic variations as the same URL", () => {
    const variants = [
      "https://www.Example.com/blog/post/",
      "http://example.com/blog/post",
      "https://example.com:443/blog/post#section",
      "https://example.com/blog/post?utm_source=twitter&utm_medium=social",
      "https://example.com//blog//post/",
    ];
    const normalized = new Set(variants.map((v) => normalizeUrl(v)));
    expect([...normalized]).toEqual(["example.com/blog/post"]);
  });

  it("keeps meaningful query params, sorted", () => {
    expect(normalizeUrl("https://example.com/p?b=2&a=1&fbclid=x")).toBe("example.com/p?a=1&b=2");
  });

  it("strips index documents", () => {
    expect(normalizeUrl("https://example.com/docs/index.html")).toBe(normalizeUrl("https://example.com/docs/"));
  });

  it("distinguishes different paths and hosts", () => {
    expect(normalizeUrl("https://a.example.com/x")).not.toBe(normalizeUrl("https://b.example.com/x"));
    expect(normalizeUrl("https://example.com/x")).not.toBe(normalizeUrl("https://example.com/y"));
  });
});

describe("parseSubmittedUrl", () => {
  it("accepts http(s) URLs", () => {
    expect(parseSubmittedUrl("https://blog.example.com/post").ok).toBe(true);
  });

  it.each([
    ["", "required"],
    ["not a url", "valid"],
    ["ftp://example.com/file", "http"],
    ["javascript:alert(1)", "http"],
    ["https://user:pass@example.com/", "credentials"],
    ["https://intranet/", "fully-qualified"],
    ["https://example.com:8080/", "ports"],
  ])("rejects %j", (input, message) => {
    const res = parseSubmittedUrl(input);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.toLowerCase()).toContain(message);
  });
});

describe("sameSite", () => {
  it("ignores www. but not other subdomains", () => {
    expect(sameSite(new URL("https://www.example.com"), new URL("https://example.com/x"))).toBe(true);
    expect(sameSite(new URL("https://example.com"), new URL("https://evil.com"))).toBe(false);
    expect(sameSite(new URL("https://blog.example.com"), new URL("https://example.com"))).toBe(false);
  });
});
