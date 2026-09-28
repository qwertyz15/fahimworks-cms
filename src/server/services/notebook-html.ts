import * as cheerio from "cheerio";
import { common, createLowlight } from "lowlight";
import sanitizeHtml from "sanitize-html";
import { countWords } from "./extraction/parse";

/**
 * Server-side processing of Notebook (Tiptap) HTML. Pure functions — no
 * network or database — so they are unit tested directly.
 *
 * The editor sends HTML, but it is never trusted: every save is re-sanitised
 * against this allowlist, so scripts, event handlers, inline styles and
 * javascript: URLs cannot reach the public article page.
 */
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "hr", "h1", "h2", "h3", "h4",
    "strong", "b", "em", "i", "u", "s", "del", "code", "pre", "span", "mark", "sub", "sup",
    "a", "ul", "ol", "li", "blockquote",
    "table", "colgroup", "col", "thead", "tbody", "tr", "th", "td",
    "img", "figure", "figcaption",
  ],
  allowedAttributes: {
    a: ["href", "title", "target", "rel"],
    img: ["src", "alt", "title", "width", "height", "loading", "referrerpolicy"],
    code: ["class"],
    pre: ["class"],
    span: ["class"],
    th: ["colspan", "rowspan"],
    td: ["colspan", "rowspan"],
    ol: ["start"],
  },
  allowedClasses: {
    code: [/^language-[\w-]+$/],
    pre: [/^language-[\w-]+$/],
    // Syntax-highlighting tokens produced by lowlight (highlight.js class names).
    span: [/^hljs(-[\w-]+)?$/],
  },
  allowedSchemes: ["https", "http", "mailto"],
  allowedSchemesByTag: { img: ["https"] },
  allowProtocolRelative: false,
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer nofollow" },
    }),
    img: (tagName, attribs) => ({ tagName, attribs: { ...attribs, loading: "lazy", referrerpolicy: "no-referrer" } }),
  },
  exclusiveFilter: (frame) => frame.tag === "img" && !frame.attribs.src,
};

export function sanitizeNotebookHtml(html: string): string {
  return sanitizeHtml(html, OPTIONS).trim();
}

// ── Server-side syntax highlighting ──
// The editor colours code only in its own view; its HTML output is plain. Highlight
// here so the public article page shows coloured code without shipping a highlighter.
const lowlight = createLowlight(common);

type HastNode = { type: string; value?: string; tagName?: string; properties?: { className?: unknown }; children?: HastNode[] };

const escapeHtml = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Minimal hast → HTML for lowlight output: text nodes and <span class="hljs-…"> only. */
function hastToHtml(node: HastNode): string {
  if (node.type === "text") return escapeHtml(node.value ?? "");
  const inner = (node.children ?? []).map(hastToHtml).join("");
  if (node.type === "element" && node.tagName === "span") {
    const classes = (Array.isArray(node.properties?.className) ? node.properties.className : [])
      .filter((c): c is string => typeof c === "string" && /^hljs(-[\w-]+)?$/.test(c));
    return classes.length ? `<span class="${classes.join(" ")}">${inner}</span>` : inner;
  }
  return inner;
}

export function highlightCodeBlocks(cleanHtml: string): string {
  const $ = cheerio.load(cleanHtml, null, false);
  $("pre > code").each((_, el) => {
    const code = $(el);
    const lang = (code.attr("class") ?? "").match(/language-([\w-]+)/)?.[1];
    if (!lang || lang === "plaintext" || !lowlight.registered(lang)) return;
    code.html(hastToHtml(lowlight.highlight(lang, code.text()) as unknown as HastNode));
  });
  return $.html();
}

/** Full pipeline for a save: sanitise → highlight → sanitise again (defence in depth). */
export function renderNotebookHtml(editorHtml: string): string {
  return sanitizeNotebookHtml(highlightCodeBlocks(sanitizeNotebookHtml(editorHtml)));
}

export interface DerivedFields {
  contentText: string;
  wordCount: number;
  readingMinutes: number;
  autoSummary: string | null;
  firstImage: string | null;
}

const SUMMARY_MAX = 280;

/** Plain text, reading stats, a summary from the first paragraph, and the first image. Input must already be sanitised. */
export function deriveFields(cleanHtml: string): DerivedFields {
  const $ = cheerio.load(cleanHtml);
  // Keep block boundaries as spaces so words don't run together.
  $("p, h1, h2, h3, h4, li, blockquote, pre, td, th, figcaption, br").after(" ");
  const contentText = $.root().text().replace(/\s+/g, " ").trim();
  const wordCount = countWords(contentText);

  let autoSummary: string | null = null;
  $("p").each((_, el) => {
    const t = $(el).text().replace(/\s+/g, " ").trim();
    if (!autoSummary && countWords(t) >= 8) autoSummary = t;
  });
  if (autoSummary && (autoSummary as string).length > SUMMARY_MAX) {
    const cut = (autoSummary as string).slice(0, SUMMARY_MAX);
    autoSummary = `${cut.slice(0, cut.lastIndexOf(" ") > 200 ? cut.lastIndexOf(" ") : SUMMARY_MAX).trimEnd()}…`;
  }

  return {
    contentText,
    wordCount,
    readingMinutes: wordCount ? Math.max(1, Math.round(wordCount / 230)) : 0,
    autoSummary,
    firstImage: $("img").first().attr("src") ?? null,
  };
}
