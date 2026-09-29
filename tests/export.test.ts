import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { fileNameFor, type DocNode } from "@/lib/export/document";
import { toMarkdown } from "@/lib/export/markdown";
import { imageInfo, toDocx } from "@/server/export/docx";
import { toHtml } from "@/server/export/html";

const t = (text: string, ...marks: (string | { type: string; attrs?: Record<string, unknown> })[]): DocNode => ({ type: "text", text, marks: marks.map((m) => (typeof m === "string" ? { type: m } : m)) });
const p = (...content: DocNode[]): DocNode => ({ type: "paragraph", content });
const li = (...content: DocNode[]): DocNode => ({ type: "listItem", content });

const DOC: DocNode = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [t("Section")] },
    p(t("Plain, "), t("bold", "bold"), t(" and "), t("italic", "italic"), t(", "), t("gone", "strike"), t(", "), t("x < y", "code"), t(", "), t("a link", { type: "link", attrs: { href: "https://example.com/a b" } }), t(" and "), t("red", { type: "textColor", attrs: { color: "red" } }), t(".")),
    p(t("*not emphasis* and a | pipe")),
    p(t("# not a heading")),
    p(t("line one"), { type: "hardBreak" }, t("line two"), t(" inline "), { type: "inlineMath", attrs: { latex: "e^{i\\pi}" } }),
    p(t("See "), { type: "noteLink", attrs: { id: "pub1", label: "Published post" } }, t(" and "), { type: "noteLink", attrs: { id: "draft", label: "Draft post" } }),
    { type: "bulletList", content: [li(p(t("one"))), li(p(t("two")), { type: "bulletList", content: [li(p(t("nested")))] })] },
    { type: "orderedList", attrs: { start: 3 }, content: [li(p(t("third"))), li(p(t("fourth")))] },
    { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [p(t("done"))] }, { type: "taskItem", attrs: { checked: false }, content: [p(t("todo"))] }] },
    { type: "blockquote", content: [p(t("quoted")), p(t("two"))] },
    { type: "codeBlock", attrs: { language: "ts" }, content: [t("const a = 1;\n```\nnested fence")] },
    { type: "horizontalRule" },
    { type: "image", attrs: { src: "https://cdn.example/pic.png", alt: "A pic", caption: "The caption" } },
    { type: "image", attrs: { src: "javascript:alert(1)", alt: "evil" } },
    {
      type: "table",
      content: [
        { type: "tableRow", content: [{ type: "tableHeader", content: [p(t("Name"))] }, { type: "tableHeader", content: [p(t("Value"))] }] },
        { type: "tableRow", content: [{ type: "tableCell", content: [p(t("a|b"))] }, { type: "tableCell", content: [p(t("1"))] }] },
      ],
    },
    { type: "callout", attrs: { variant: "warning" }, content: [p(t("Careful"))] },
    { type: "details", content: [{ type: "detailsSummary", content: [t("More")] }, { type: "detailsContent", content: [p(t("Hidden text"))] }] },
    { type: "blockMath", attrs: { latex: "\\int_0^1 x\\,dx" } },
    { type: "mermaidDiagram", attrs: { source: "flowchart TD\n  A --> B" } },
    { type: "board", attrs: { columns: [{ id: "c1", title: "To do", cards: [{ id: "k1", text: "Write", label: "blue" }] }, { id: "c2", title: "Done", cards: [] }] } },
    { type: "videoEmbed", attrs: { provider: "youtube", id: "abc123" } },
    { type: "audioFile", attrs: { src: "https://cdn.example/a.mp3", caption: "Theme" } },
    { type: "attachment", attrs: { href: "https://cdn.example/f.pdf", name: "Report.pdf" } },
    { type: "linkCard", attrs: { url: "https://site.example", title: "Site", description: "About it" } },
  ],
};
const META = { title: 'My "Post"', subtitle: "Sub", date: "2026-09-30", tags: ["AI", "Web"] };
const CTX = { linkFor: (id: string) => (id === "pub1" ? "https://timeline.example/p/published" : null) };

describe("Markdown export", () => {
  const md = toMarkdown(DOC, META, CTX);
  it("front matter and title", () => {
    expect(md.startsWith('---\ntitle: "My \\"Post\\""\nsubtitle: "Sub"\ndate: 2026-09-30\ntags: ["AI", "Web"]\n---\n\n# My "Post"\n\n_Sub_')).toBe(true);
  });
  it("inline marks, escaping and links", () => {
    expect(md).toContain("## Section");
    expect(md).toContain("Plain, **bold** and _italic_, ~~gone~~, `x < y`, [a link](https://example.com/a%20b) and red.");
    expect(md).toContain("\\*not emphasis\\* and a \\| pipe");
    expect(md).toContain("\\# not a heading");
    expect(md).toContain("line one\\\nline two inline $e^{i\\pi}$");
    expect(md).toContain("See [Published post](https://timeline.example/p/published) and Draft post");
  });
  it("lists, tasks, quotes, code", () => {
    expect(md).toContain("- one\n- two\n  - nested");
    expect(md).toContain("3. third\n4. fourth");
    expect(md).toContain("- [x] done\n- [ ] todo");
    expect(md).toContain("> quoted\n>\n> two");
    expect(md).toContain("````ts\nconst a = 1;\n```\nnested fence\n````");
    expect(md).toContain("\n---\n");
  });
  it("images (unsafe URLs dropped), tables, callouts, toggles, maths, diagrams, boards, media", () => {
    expect(md).toContain("![A pic](https://cdn.example/pic.png)\n\n_The caption_");
    expect(md).not.toContain("javascript:");
    expect(md).toContain("| Name | Value |\n| --- | --- |\n| a\\|b | 1 |");
    expect(md).toContain("> [!WARNING]\n> Careful");
    expect(md).toContain("<details>\n<summary>More</summary>\n\nHidden text\n\n</details>");
    expect(md).toContain("$$\n\\int_0^1 x\\,dx\n$$");
    expect(md).toContain("```mermaid\nflowchart TD\n  A --> B\n```");
    expect(md).toContain("**To do**\n\n- Write _(blue)_\n\n**Done**\n\n_No cards_");
    expect(md).toContain("[▶ YouTube video](https://www.youtube.com/watch?v=abc123)");
    expect(md).toContain("[🔊 Audio: Theme](https://cdn.example/a.mp3)");
    expect(md).toContain("[📎 Report.pdf](https://cdn.example/f.pdf)");
    expect(md).toContain("[Site](https://site.example)\\\nAbout it");
  });
  it("an empty document still has its title", () => {
    expect(toMarkdown(null, { title: "" }, CTX)).toBe('---\ntitle: "Untitled"\n---\n\n# Untitled\n');
  });
  it("database page properties go in the front matter", () => {
    expect(toMarkdown(null, { title: "Task", properties: [{ name: "Status", value: "Done" }] }, CTX)).toContain('"Status": "Done"');
  });
});

describe("Word export", () => {
  it("builds a valid .docx with every block", async () => {
    const buf = await toDocx(DOC, { ...META, properties: [{ name: "Status", value: "Done" }] }, CTX);
    expect(buf.subarray(0, 2).toString()).toBe("PK");
    const zip = await JSZip.loadAsync(buf);
    const xml = await zip.file("word/document.xml")!.async("string");
    for (const text of ["My &quot;Post&quot;", "Section", "bold", "nested", "third", "☑ ", "☐ ", "quoted", "const a = 1;", "The caption", "Name", "a|b", "Warning", "Careful", "▸ More", "Hidden text", "Diagram (Mermaid)", "A --&gt; B", "To do", "Write", "YouTube video", "Report.pdf", "Site", "Published post", "Status: "]) {
      expect(xml, text).toContain(text);
    }
    expect(xml).toContain('w:color w:val="DC2626"'); // red text kept
    expect(xml).toContain("w:numPr"); // real numbered list
    expect(xml).toContain("<w:tbl>"); // real table
    expect(xml).toContain('w:val="Heading2"');
    const rels = await zip.file("word/_rels/document.xml.rels")!.async("string");
    expect(rels).toContain("https://timeline.example/p/published");
    expect(rels).not.toContain("javascript:");
  });
  it("reads image sizes", () => {
    const png = Buffer.alloc(33);
    png.writeUInt32BE(0x89504e47, 0);
    png.writeUInt32BE(640, 16);
    png.writeUInt32BE(480, 20);
    expect(imageInfo(png)).toEqual({ type: "png", width: 640, height: 480 });
    const gif = Buffer.from("GIF89a\x10\x00\x08\x00", "binary");
    expect(imageInfo(Buffer.concat([gif, Buffer.alloc(4)]))).toEqual({ type: "gif", width: 16, height: 8 });
    expect(imageInfo(Buffer.from("not an image"))).toBeNull();
  });
});

describe("HTML export", () => {
  it("is standalone and escapes the header", () => {
    const html = toHtml('<p>Hi</p><pre data-mermaid=""><code>flowchart TD</code></pre>', { title: "<b>T</b>", tags: ["x"] });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>&lt;b&gt;T&lt;/b&gt;</title>");
    expect(html).toContain("<style>");
    expect(html).toContain("mermaid@12.0.0");
    expect(toHtml("<p>Hi</p>", { title: "T" })).not.toContain("<script");
  });
  it("file names", () => {
    expect(fileNameFor("Héllo, World! 2026", "md")).toBe("hello-world-2026.md");
    expect(fileNameFor("   ", "docx")).toBe("untitled.docx");
  });
});
