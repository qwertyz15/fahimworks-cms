import "server-only";
import type { ExportMeta } from "@/lib/export/document";

/**
 * A standalone .html file: the entry's sanitised HTML (the same the public
 * article shows) with a built-in stylesheet, so it opens offline in any
 * browser. Maths is MathML (native in browsers). Mermaid diagrams show as
 * code offline and are drawn when the file is opened online.
 */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const CSS = `
:root { color-scheme: light dark; --fg: #18181b; --muted: #71717a; --border: #e4e4e7; --surface: #fafafa; --code: #f4f4f5; --link: #4f46e5; }
@media (prefers-color-scheme: dark) { :root { --fg: #f4f4f5; --muted: #a1a1aa; --border: #3f3f46; --surface: #18181b; --code: #27272a; --link: #a5b4fc; } body { background: #09090b; } }
* { box-sizing: border-box; }
body { margin: 0; color: var(--fg); background: #fff; font: 17px/1.7 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 46rem; margin: 0 auto; padding: 3rem 1.25rem 5rem; }
header h1 { margin: 0 0 .4rem; font-size: 2.3rem; line-height: 1.2; letter-spacing: -.02em; }
header .subtitle { margin: 0 0 .8rem; color: var(--muted); font-size: 1.2rem; }
header .meta { color: var(--muted); font-size: .9rem; }
header .props { margin: 1rem 0 0; display: grid; grid-template-columns: max-content 1fr; gap: .25rem 1rem; font-size: .9rem; }
header .props dt { color: var(--muted); }
header .props dd { margin: 0; }
header .cover { width: 100%; margin: 1.5rem 0 0; border-radius: .75rem; }
article { margin-top: 2rem; overflow-wrap: anywhere; }
article > * + * { margin-top: 1em; }
h1, h2, h3, h4 { line-height: 1.3; margin: 1.8em 0 .5em; }
a { color: var(--link); }
img, video { max-width: 100%; height: auto; border-radius: .5rem; }
figure { margin: 1.5em 0; text-align: center; }
figure[data-width="small"] img { max-width: 50%; } figure[data-width="medium"] img { max-width: 75%; }
figcaption { color: var(--muted); font-size: .88rem; margin-top: .4rem; }
blockquote { margin-left: 0; padding-left: 1rem; border-left: 3px solid var(--border); color: var(--muted); }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .88em; background: var(--code); padding: .1em .35em; border-radius: .3rem; }
pre { background: var(--code); padding: 1rem; border-radius: .6rem; overflow-x: auto; line-height: 1.5; }
pre code { background: none; padding: 0; }
table { width: 100%; border-collapse: collapse; font-size: .95rem; }
th, td { border: 1px solid var(--border); padding: .45rem .6rem; text-align: left; vertical-align: top; }
th { background: var(--surface); }
hr { border: 0; border-top: 1px solid var(--border); margin: 2rem 0; }
ul[data-type="taskList"] { list-style: none; padding-left: .2rem; }
ul[data-type="taskList"] li { display: flex; gap: .5rem; }
ul[data-type="taskList"] li > label { flex: none; }
ul[data-type="taskList"] li[data-checked="true"] > div { color: var(--muted); text-decoration: line-through; }
aside[data-callout] { padding: .8rem 1rem; border-radius: .6rem; border-left: 4px solid #3b82f6; background: color-mix(in srgb, #3b82f6 10%, transparent); }
aside[data-callout="tip"] { border-color: #22c55e; background: color-mix(in srgb, #22c55e 10%, transparent); }
aside[data-callout="warning"] { border-color: #f59e0b; background: color-mix(in srgb, #f59e0b 12%, transparent); }
aside[data-callout="danger"] { border-color: #ef4444; background: color-mix(in srgb, #ef4444 10%, transparent); }
aside[data-callout] > :first-child { margin-top: 0; } aside[data-callout] > :last-child { margin-bottom: 0; }
details { border: 1px solid var(--border); border-radius: .6rem; padding: .5rem .9rem; }
summary { cursor: pointer; font-weight: 600; }
div[data-type="board"] { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(12rem, 1fr); gap: .75rem; overflow-x: auto; }
div[data-board-column] { border: 1px solid var(--border); border-radius: .7rem; padding: .7rem; background: var(--surface); }
div[data-board-column] .board-title { font-weight: 600; font-size: .9rem; }
div[data-board-column] .board-count { color: var(--muted); font-size: .75rem; margin-left: .4rem; }
div[data-board-column] ul { list-style: none; padding: 0; margin: .5rem 0 0; display: grid; gap: .4rem; }
div[data-board-column] li { border: 1px solid var(--border); border-radius: .45rem; padding: .45rem .6rem; background: var(--bg, transparent); font-size: .9rem; }
a[data-link-card] { display: block; border: 1px solid var(--border); border-radius: .6rem; padding: .8rem 1rem; text-decoration: none; color: inherit; }
a[data-attachment] { display: inline-block; border: 1px solid var(--border); border-radius: .5rem; padding: .4rem .7rem; text-decoration: none; }
div[data-video-embed] iframe { width: 100%; aspect-ratio: 16 / 9; border: 0; border-radius: .6rem; }
math[display="block"] { display: block; overflow-x: auto; margin: 1em 0; }
pre[data-mermaid].drawn { display: none; }
.mermaid-rendered { text-align: center; }
[data-align="center"] { text-align: center; } [data-align="right"] { text-align: right; } [data-align="justify"] { text-align: justify; }
mark { border-radius: .2em; padding: 0 .1em; color: inherit; background: #fef08a; }
mark[data-color="green"] { background: #bbf7d0; } mark[data-color="blue"] { background: #bfdbfe; } mark[data-color="pink"] { background: #fbcfe8; } mark[data-color="purple"] { background: #e9d5ff; } mark[data-color="orange"] { background: #fed7aa; }
@media (prefers-color-scheme: dark) { mark { background: #854d0e; } mark[data-color="green"] { background: #166534; } mark[data-color="blue"] { background: #1e40af; } mark[data-color="pink"] { background: #9d174d; } mark[data-color="purple"] { background: #6b21a8; } mark[data-color="orange"] { background: #9a3412; } }
[data-text-color="gray"] { color: #71717a; } [data-text-color="red"] { color: #dc2626; } [data-text-color="orange"] { color: #ea580c; } [data-text-color="yellow"] { color: #ca8a04; } [data-text-color="green"] { color: #16a34a; } [data-text-color="teal"] { color: #0d9488; } [data-text-color="blue"] { color: #2563eb; } [data-text-color="indigo"] { color: #4f46e5; } [data-text-color="purple"] { color: #9333ea; } [data-text-color="pink"] { color: #db2777; } [data-text-color="brown"] { color: #92400e; }
[data-size="small"] { font-size: .85em; } [data-size="large"] { font-size: 1.25em; } [data-size="xlarge"] { font-size: 1.5em; } [data-size="huge"] { font-size: 1.9em; }
[data-font="serif"] { font-family: Georgia, serif; } [data-font="mono"] { font-family: ui-monospace, Consolas, monospace; } [data-font="handwriting"] { font-family: "Comic Sans MS", cursive; } [data-font="book"] { font-family: "Book Antiqua", Palatino, serif; } [data-font="condensed"] { font-family: "Arial Narrow", sans-serif; } [data-font="display"] { font-family: Impact, sans-serif; }
.hljs-keyword, .hljs-selector-tag, .hljs-built_in { color: #7c3aed; } .hljs-string, .hljs-attr { color: #059669; } .hljs-number, .hljs-literal { color: #d97706; } .hljs-comment { color: var(--muted); font-style: italic; } .hljs-title, .hljs-function { color: #2563eb; }
@media print { body { background: #fff; color: #000; } main { padding: 0; } a { color: inherit; } pre, figure, table, aside, details, div[data-board-column] { break-inside: avoid; } }
`;

/** Draws Mermaid blocks when online (the source stays visible otherwise). */
const MERMAID = `<script type="module">
const blocks = [...document.querySelectorAll("pre[data-mermaid]")];
if (blocks.length) {
  try {
    const { default: mermaid } = await import("https://cdn.jsdelivr.net/npm/mermaid@12.0.0/dist/mermaid.esm.min.mjs");
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "default" });
    for (const [i, pre] of blocks.entries()) {
      try {
        const { svg } = await mermaid.render("export-mermaid-" + i, pre.textContent);
        const fig = document.createElement("figure");
        fig.className = "mermaid-rendered";
        fig.innerHTML = svg;
        pre.after(fig);
        pre.classList.add("drawn");
      } catch {}
    }
  } catch {}
}
</script>`;

export function toHtml(contentHtml: string, meta: ExportMeta): string {
  const hasMermaid = contentHtml.includes("data-mermaid");
  const metaLine = [meta.date, ...(meta.tags ?? []).map((t) => `#${t}`)].filter(Boolean).map((s) => esc(String(s))).join(" · ");
  const props = meta.properties?.length ? `<dl class="props">${meta.properties.map((p) => `<dt>${esc(p.name)}</dt><dd>${esc(p.value)}</dd>`).join("")}</dl>` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(meta.title || "Untitled")}</title>
<style>${CSS}</style>
</head>
<body>
<main>
<header>
<h1>${esc(meta.title || "Untitled")}</h1>
${meta.subtitle ? `<p class="subtitle">${esc(meta.subtitle)}</p>` : ""}
${metaLine ? `<p class="meta">${metaLine}</p>` : ""}
${props}
${meta.coverImage && /^https?:/i.test(meta.coverImage) ? `<img class="cover" src="${esc(meta.coverImage)}" alt="">` : ""}
</header>
<article>
${contentHtml}
</article>
</main>
${hasMermaid ? MERMAID : ""}
</body>
</html>
`;
}
