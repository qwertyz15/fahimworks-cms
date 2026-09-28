import { describe, expect, it } from "vitest";
import { deriveFields, highlightCodeBlocks, renderNotebookHtml, sanitizeNotebookHtml } from "@/server/services/notebook-html";

describe("sanitizeNotebookHtml (XSS)", () => {
  it.each([
    ['<p>Hi<script>alert(1)</script></p>', "<script"],
    ['<p onclick="steal()">x</p>', "onclick"],
    ['<a href="javascript:alert(1)">x</a>', "javascript:"],
    ['<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>', "data:"],
    ['<img src="x" onerror="alert(1)">', "onerror"],
    ['<img src="http://insecure.example/x.png">', "http://insecure"],
    ['<img src="data:image/png;base64,AAAA">', "data:image"],
    ['<iframe src="https://evil.example"></iframe>', "<iframe"],
    ['<svg><script>alert(1)</script></svg>', "<svg"],
    ['<p style="background:url(javascript:alert(1))">x</p>', "style="],
    ['<form action="https://evil.example"><input name="p"></form>', "<form"],
    ['<span class="evil hljs-keyword">x</span>', "evil"],
  ])("removes dangerous markup from %s", (input, forbidden) => {
    expect(sanitizeNotebookHtml(input)).not.toContain(forbidden);
  });

  it("keeps editor formatting", () => {
    const html =
      '<h2>Title</h2><p><strong>b</strong> <em>i</em> <u>u</u> <s>s</s> <code>c</code></p>' +
      '<ul><li><p>one</p></li></ul><ol start="3"><li><p>three</p></li></ol><blockquote><p>q</p></blockquote><hr>' +
      '<pre><code class="language-ts"><span class="hljs-keyword">const</span> x = 1;</code></pre>' +
      '<table><tbody><tr><th colspan="1" rowspan="1"><p>H</p></th></tr><tr><td colspan="1" rowspan="1"><p>C</p></td></tr></tbody></table>';
    const out = sanitizeNotebookHtml(html);
    for (const piece of ["<h2>", "<strong>", "<em>", "<u>", "<s>", "<code>", '<ol start="3">', "<blockquote>", "<hr />", 'class="language-ts"', 'class="hljs-keyword"', "<th", "<td"]) {
      expect(out).toContain(piece);
    }
  });

  it("forces safe link attributes", () => {
    const out = sanitizeNotebookHtml('<a href="https://example.com" target="_self" rel="opener">x</a>');
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
  });

  it("keeps https images and makes them lazy", () => {
    const out = sanitizeNotebookHtml('<img src="https://media.fahimworks.dev/posts/a.png" alt="diagram">');
    expect(out).toContain('src="https://media.fahimworks.dev/posts/a.png"');
    expect(out).toContain('loading="lazy"');
  });
});

describe("deriveFields", () => {
  it("counts words across blocks without gluing them together", () => {
    const d = deriveFields("<h2>Intro</h2><p>one two three</p><ul><li><p>four</p></li><li><p>five</p></li></ul>");
    expect(d.wordCount).toBe(6);
    expect(d.contentText).toBe("Intro one two three four five");
  });

  it("uses the first substantial paragraph as the summary", () => {
    const d = deriveFields("<p>Short.</p><p>This paragraph is long enough to be used as the automatic summary text.</p>");
    expect(d.autoSummary).toBe("This paragraph is long enough to be used as the automatic summary text.");
  });

  it("truncates long summaries on a word boundary", () => {
    const long = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ");
    const d = deriveFields(`<p>${long}</p>`);
    expect(d.autoSummary!.length).toBeLessThanOrEqual(281);
    expect(d.autoSummary!.endsWith("…")).toBe(true);
  });

  it("reports reading time and first image", () => {
    const words = Array.from({ length: 460 }, () => "w").join(" ");
    const d = deriveFields(`<p>${words}</p><img src="https://x.example/a.png">`);
    expect(d.readingMinutes).toBe(2);
    expect(d.firstImage).toBe("https://x.example/a.png");
  });

  it("handles an empty document", () => {
    expect(deriveFields("")).toMatchObject({ wordCount: 0, readingMinutes: 0, autoSummary: null, firstImage: null });
  });
});

describe("server-side code highlighting", () => {
  it("adds hljs token spans to known languages", () => {
    const out = renderNotebookHtml('<pre><code class="language-python">def retry(fn):\n    return fn()</code></pre>');
    expect(out).toContain('<span class="hljs-keyword">def</span>');
    expect(out).toContain('class="language-python"');
  });

  it("keeps code text escaped (no markup injection through code)", () => {
    const out = renderNotebookHtml('<pre><code class="language-javascript">const a = "&lt;img src=x onerror=alert(1)&gt;";</code></pre>');
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
  });

  it("leaves plain text and unknown languages untouched", () => {
    expect(highlightCodeBlocks('<pre><code class="language-plaintext">x = 1</code></pre>')).not.toContain("hljs");
    expect(highlightCodeBlocks('<pre><code class="language-nope">x = 1</code></pre>')).not.toContain("hljs");
  });
});
