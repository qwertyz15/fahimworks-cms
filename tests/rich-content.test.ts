import { describe, expect, it } from "vitest";
import { EMBED_SRC_RE, embedSrc, parseVideoUrl } from "@/lib/editor-shared";
import { sanitizeNotebookHtml as clean } from "@/server/services/notebook-html";

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
