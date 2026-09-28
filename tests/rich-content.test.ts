import { describe, expect, it } from "vitest";
import { EMBED_SRC_RE, embedSrc, parseVideoUrl } from "@/lib/editor-shared";
import { applyNoteLinks, deriveFields, mediaSources, noteRefIds, renderNotebookHtml, sanitizeNotebookHtml as clean } from "@/server/services/notebook-html";

describe("text colour + highlight", () => {
  it("keeps palette colours", () => {
    const out = clean('<p><span data-text-color="red">r</span> <mark data-color="yellow">h</mark></p>');
    expect(out).toContain('<span data-text-color="red">r</span>');
    expect(out).toContain('<mark data-color="yellow">h</mark>');
  });
  it("drops unknown colours and inline styles", () => {
    const out = clean('<p><span data-text-color="url(evil)" style="color:red">x</span><mark data-color="#fff" style="background:red">y</mark></p>');
    expect(out).not.toContain("data-text-color");
    expect(out).not.toContain("data-color");
    expect(out).not.toContain("style");
  });
});

describe("checklists", () => {
  const html = '<ul data-type="taskList"><li data-checked="true" data-type="taskItem"><label><input type="checkbox" checked="checked"><span></span></label><div><p>Done</p></div></li><li data-checked="false" data-type="taskItem"><label><input type="checkbox"></label><div><p>Todo</p></div></li></ul>';
  it("keeps the task-list structure with read-only ticks", () => {
    const out = clean(html);
    expect(out).toContain('<ul data-type="taskList">');
    expect(out).toContain('data-checked="true"');
    expect(out).toMatch(/<input type="checkbox" checked="checked" disabled="disabled" \/>/);
    expect(out).toMatch(/<input type="checkbox" disabled="disabled" \/>/);
  });
  it("removes non-checkbox inputs and bogus values", () => {
    const out = clean('<ul data-type="evil"><li data-checked="maybe"><input type="text" value="x"><input type="password"></li></ul>');
    expect(out).not.toContain("data-type");
    expect(out).not.toContain("data-checked");
    expect(out).not.toContain("<input");
  });
});

describe("video embeds", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?t=42", "youtube", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ"],
    ["https://m.youtube.com/watch?v=dQw4w9WgXcQ&list=x", "youtube", "dQw4w9WgXcQ"],
    ["https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ"],
    ["https://vimeo.com/76979871", "vimeo", "76979871"],
    ["https://player.vimeo.com/video/76979871?h=abc", "vimeo", "76979871"],
  ])("parses %s", (url, provider, id) => {
    expect(parseVideoUrl(url)).toEqual({ provider, id });
  });
  it.each(["https://example.com/watch?v=dQw4w9WgXcQ", "https://www.youtube.com/watch?v=short", "javascript:alert(1)", "not a url"])("rejects %s", (url) => {
    expect(parseVideoUrl(url)).toBeNull();
  });
  it("builds privacy-friendly player URLs that pass the allowlist", () => {
    expect(EMBED_SRC_RE.test(embedSrc("youtube", "dQw4w9WgXcQ"))).toBe(true);
    expect(EMBED_SRC_RE.test(embedSrc("vimeo", "76979871"))).toBe(true);
  });
  it("keeps only YouTube-nocookie / Vimeo player iframes, with our own allow list", () => {
    const ok = clean('<div data-video-embed="youtube"><iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0" allow="camera; microphone" onload="x()"></iframe></div>');
    expect(ok).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0"');
    expect(ok).not.toContain("camera");
    expect(ok).not.toContain("onload");
    for (const bad of [
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
      "https://evil.example/embed/dQw4w9WgXcQ",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ/../../evil",
      "https://player.vimeo.com.evil.example/video/76979871",
      "javascript:alert(1)",
    ]) {
      expect(clean(`<iframe src="${bad}"></iframe>`)).not.toContain("<iframe");
    }
  });
});

describe("uploaded videos + attachments", () => {
  it("forces controls and removes autoplay/muted/loop", () => {
    const out = clean('<figure data-video=""><video src="https://media.example/v.mp4" autoplay muted loop></video></figure>');
    expect(out).toContain('src="https://media.example/v.mp4"');
    expect(out).toContain('controls="true"');
    expect(out).not.toMatch(/autoplay|muted|loop/);
  });
  it("drops http videos not from the storage origin", () => {
    expect(clean('<video src="http://evil.example/v.mp4"></video>')).not.toContain("<video");
    expect(clean('<video src="http://localhost:9000/b/v.mp4"></video>', { imageOrigins: ["http://localhost:9000"] })).toContain("<video");
  });
  it("keeps attachment cards and validates their data", () => {
    const out = clean('<a href="https://media.example/f.pdf" data-attachment="" data-size="2048" data-mime="application/pdf" download="report.pdf"><span class="attachment-name">report.pdf</span><span class="attachment-meta">PDF · 2 KB</span></a>');
    expect(out).toContain("data-attachment");
    expect(out).toContain('data-size="2048"');
    expect(out).toContain('class="attachment-name"');
    const bad = clean('<a href="https://x.example/f" data-attachment="" data-size="1e9; x" data-mime="text/html\\"><script>" onclick="x()">f</a>');
    expect(bad).not.toContain("data-size");
    expect(bad).not.toContain("onclick");
  });
});

describe("headings, alignment and image sizes", () => {
  it("keeps H4 and valid alignments; left and bogus values are dropped", () => {
    const out = clean('<h4 data-align="center">T</h4><p data-align="justify">J</p><p data-align="left">L</p><p data-align="evil" style="text-align:center">X</p>');
    expect(out).toContain('<h4 data-align="center">T</h4>');
    expect(out).toContain('<p data-align="justify">J</p>');
    expect(out).toContain("<p>L</p>");
    expect(out).toContain("<p>X</p>");
    expect(out).not.toContain("style");
  });
  it("keeps image width presets only", () => {
    expect(clean('<figure data-width="small"><img src="https://m.example/a.png"></figure>')).toContain('<figure data-width="small">');
    expect(clean('<figure data-width="999px"><img src="https://m.example/a.png"></figure>')).not.toContain("data-width");
  });
});

describe("uploaded audio", () => {
  it("keeps audio with forced controls and no autoplay", () => {
    const out = clean('<figure data-audio=""><audio src="https://m.example/a.mp3" autoplay loop onplay="x()"></audio><figcaption>Talk</figcaption></figure>');
    expect(out).toMatch(/<figure data-audio(="")?>/);
    expect(out).toMatch(/<audio src="https:\/\/m\.example\/a\.mp3" controls="true" preload="metadata"><\/audio>/);
    expect(out).not.toMatch(/autoplay|loop|onplay/);
  });
  it("drops audio from plain http / javascript: sources", () => {
    expect(clean('<audio src="http://evil.example/a.mp3"></audio>')).not.toContain("<audio");
    expect(clean('<audio src="javascript:alert(1)"></audio>')).not.toContain("<audio");
    expect(clean('<audio src="http://localhost:9000/b/a.mp3"></audio>', { imageOrigins: ["http://localhost:9000"] })).toContain("<audio");
  });
  it("counts audio as uploaded media", () => {
    expect(mediaSources('<figure data-audio=""><audio src="https://m.example/a.mp3" controls="true"></audio></figure>')).toEqual(["https://m.example/a.mp3"]);
  });
});

describe("callouts and toggles", () => {
  it("keeps callout variants; unknown ones fall back to note", () => {
    expect(clean('<aside data-callout="warning"><p>Careful</p></aside>')).toBe('<aside data-callout="warning"><p>Careful</p></aside>');
    expect(clean('<aside data-callout="evil" onclick="x()" style="color:red"><p>x</p></aside>')).toBe('<aside data-callout="note"><p>x</p></aside>');
  });
  it("keeps native details/summary toggles", () => {
    const html = '<details><summary>More</summary><div data-type="detailsContent"><p>Hidden</p></div></details>';
    expect(clean(html)).toBe(html);
    expect(clean('<details open ontoggle="x()"><summary onclick="y()">S</summary></details>')).toBe("<details><summary>S</summary></details>");
  });
  it("drops unknown div types", () => {
    expect(clean('<div data-type="evil"><p>x</p></div>')).toBe("<div><p>x</p></div>");
  });
});

describe("equations", () => {
  it("renders inline and block LaTeX to MathML on the server", () => {
    const out = renderNotebookHtml('<p>Energy <span data-type="inline-math" data-latex="E=mc^2"></span> holds.</p><div data-type="block-math" data-latex="\\frac{a}{b}"></div>');
    expect(out).toMatch(/<span data-type="inline-math" data-latex="E=mc\^2"><span><math><semantics><mrow><mi>E<\/mi>/);
    expect(out).toContain('<math display="block">');
    expect(out).toContain("<mfrac><mi>a</mi><mi>b</mi></mfrac>");
    expect(out).toContain('<annotation encoding="application/x-tex">');
  });
  it("shows invalid LaTeX as source text", () => {
    const out = renderNotebookHtml('<p><span data-type="inline-math" data-latex="\\frac{"></span></p>');
    expect(out).toContain("<code>\\frac{</code>");
    expect(out).not.toContain("<math");
  });
  it("never lets MathML from the browser through", () => {
    const evil = '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)></style></mglyph></table></mtext><maction actiontype="statusline" href="javascript:alert(1)">x</maction></math>';
    const out = renderNotebookHtml(`<p>${evil}</p>`);
    expect(out).not.toMatch(/<math|<mglyph|<style|onerror|javascript:|href=/);
  });
  it("cannot smuggle markup through data-latex", () => {
    const out = renderNotebookHtml('<p><span data-type="inline-math" data-latex="\\text{<img src=x onerror=alert(1)>}"></span></p>');
    expect(out).not.toMatch(/<img\b/);
    // KaTeX turns the spaces inside \\text{} into non-breaking spaces.
    expect(out).toMatch(/<mtext>&lt;img.src=x.onerror=alert\(1\)&gt;<\/mtext>/);
  });
  it("ignores LaTeX commands that could load or link things", () => {
    const out = renderNotebookHtml('<div data-type="block-math" data-latex="\\href{javascript:alert(1)}{x} \\includegraphics{https://evil.example/a.png}"></div>');
    expect(out).not.toMatch(/<img\b|<a\b|\shref=|\ssrc=/);
    expect(out).toContain("<mtext>\\href</mtext>");
  });
  it("counts an equation's words once", () => {
    const html = renderNotebookHtml('<p>Energy is <span data-type="inline-math" data-latex="E=mc^2"></span> here.</p>');
    expect(deriveFields(html).contentText).toBe("Energy is E=mc^2 here.");
  });
});

describe("internal links", () => {
  const ID = "cmabc123def456ghi789";
  it("keeps a valid data-ref and drops any href (the address is filled in at render time)", () => {
    const out = clean(`<p>See <a data-ref="${ID}" href="javascript:alert(1)" class="note-link">My project</a></p>`);
    expect(out).toContain(`data-ref="${ID}"`);
    expect(out).not.toMatch(/href=|javascript:|class=/);
    expect(noteRefIds(out)).toEqual([ID]);
  });
  it("drops malformed ids", () => {
    expect(clean('<p><a data-ref="../../etc" href="https://x.example">x</a></p>')).not.toContain("data-ref");
  });
  it("resolves published targets and turns the rest into plain text", () => {
    const html = clean(`<p><a data-ref="${ID}">Notebook post</a>, <a data-ref="cmimported00000000001">Repo</a> and <a data-ref="cmgone000000000000001">Draft &lt;b&gt;</a>.</p>`);
    const out = applyNoteLinks(
      html,
      new Map([
        [ID, { href: "https://timeline.example/p/notebook-post", internal: true }],
        ["cmimported00000000001", { href: "https://github.com/me/repo", internal: false }],
      ]),
    );
    expect(out).toMatch(/<a data-ref="cmabc123def456ghi789" href="https:\/\/timeline\.example\/p\/notebook-post">Notebook post<\/a>/);
    expect(out).not.toMatch(/notebook-post" target/);
    const repo = out.match(/<a [^>]*>Repo<\/a>/)?.[0] ?? "";
    expect(repo).toContain('href="https://github.com/me/repo"');
    expect(repo).toContain('target="_blank"');
    expect(repo).toContain('rel="noopener noreferrer"');
    expect(out).toContain("and Draft &lt;b&gt;.");
    expect(out).not.toContain("cmgone");
  });
});

describe("link cards", () => {
  const card = '<a href="https://github.com/me/repo" data-link-card=""><span class="card-text"><span class="card-title">me/repo</span><span class="card-desc">A thing</span><span class="card-site">GitHub</span></span><img src="https://opengraph.githubassets.com/x/me/repo" alt=""></a>';
  it("keeps the card structure", () => {
    const out = clean(card);
    expect(out).toMatch(/<a href="https:\/\/github\.com\/me\/repo" data-link-card(="")? target="_blank" rel="noopener noreferrer nofollow">/);
    expect(out).toContain('<span class="card-title">me/repo</span>');
    expect(out).toContain('src="https://opengraph.githubassets.com/x/me/repo"');
  });
  it("drops javascript: links and unknown classes", () => {
    const out = clean('<a href="javascript:alert(1)" data-link-card=""><span class="card-title evil">x</span></a>');
    expect(out).not.toMatch(/javascript:|evil/);
  });
  it("card images are not uploads, thumbnails or words of the post", () => {
    const html = clean(`<p>Short intro text for this post goes right here.</p>${card}`);
    expect(mediaSources(html)).toEqual([]);
    const d = deriveFields(html);
    expect(d.firstImage).toBeNull();
    expect(d.contentText).toBe("Short intro text for this post goes right here.");
  });
});

describe("font size, font family and the wider colour palette", () => {
  it("keeps the named sizes, fonts and new colours", () => {
    const out = clean('<p><span data-size="huge">Big</span> <span data-font="handwriting">note</span> <span data-text-color="teal">teal</span> <span data-text-color="brown" data-font="serif" data-size="large">all three</span></p>');
    expect(out).toContain('<span data-size="huge">Big</span>');
    expect(out).toContain('<span data-font="handwriting">note</span>');
    expect(out).toContain('<span data-text-color="teal">teal</span>');
    expect(out).toMatch(/<span (?=[^>]*data-text-color="brown")(?=[^>]*data-font="serif")(?=[^>]*data-size="large")[^>]*>all three<\/span>/);
  });
  it("drops raw sizes, font stacks and styles", () => {
    const out = clean('<p><span data-size="72px" data-font="Comic Sans MS" style="font-size:72px;font-family:x" data-text-color="#ff0000">x</span></p>');
    expect(out).toBe("<p><span>x</span></p>");
  });
});

describe("mermaid diagrams", () => {
  it("keeps the source as plain code", () => {
    const html = '<pre data-mermaid=""><code>flowchart TD\n  A[Start] --&gt; B{OK?}</code></pre>';
    const out = clean(html);
    expect(out).toMatch(/<pre data-mermaid(="")?><code>flowchart TD\n {2}A\[Start\] --&gt; B\{OK\?\}<\/code><\/pre>/);
  });
  it("strips markup smuggled into a diagram", () => {
    const out = renderNotebookHtml('<pre data-mermaid="x" onclick="y()"><code><svg onload="alert(1)"><script>alert(2)</script></svg>graph TD; A--&gt;B</code></pre>');
    expect(out).not.toMatch(/<svg|<script|onload|onclick|alert\(2\)|data-mermaid="x"/);
    expect(out).toContain("graph TD; A--&gt;B");
  });
  it("diagram source isn't counted as words", () => {
    const html = clean('<p>One two three four five six seven eight.</p><pre data-mermaid=""><code>flowchart TD; Alpha --&gt; Beta --&gt; Gamma</code></pre>');
    expect(deriveFields(html).contentText).toBe("One two three four five six seven eight.");
  });
});

describe("kanban boards", () => {
  const board =
    '<div data-type="board"><div data-board-column=""><span class="board-title">To do</span><span class="board-count">2</span><ul><li data-label="yellow">Write intro</li><li>Add diagram</li></ul></div><div data-board-column=""><span class="board-title">Done</span><span class="board-count">0</span><ul></ul></div></div>';
  it("keeps the board structure", () => {
    const out = clean(board);
    expect(out).toContain('<div data-type="board">');
    expect(out).toMatch(/<div data-board-column(="")?><span class="board-title">To do<\/span><span class="board-count">2<\/span><ul><li data-label="yellow">Write intro<\/li><li>Add diagram<\/li><\/ul><\/div>/);
  });
  it("drops unknown labels, styles and handlers", () => {
    const out = clean('<div data-type="board" style="x"><div data-board-column="evil" onclick="x()"><span class="board-title evil">T</span><ul><li data-label="#f00" style="color:red">c</li></ul></div></div>');
    expect(out).not.toMatch(/style=|onclick|data-label|data-board-column="evil"|evil/);
  });
  it("card text counts as the post's words", () => {
    expect(deriveFields(clean(board)).contentText).toContain("Write intro");
  });
});
