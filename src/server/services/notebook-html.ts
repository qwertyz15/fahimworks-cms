import * as cheerio from "cheerio";
import { common, createLowlight } from "lowlight";
import katex from "katex";
import sanitizeHtml from "sanitize-html";
import { countWords } from "./extraction/parse";
import { ALIGNMENTS, CALLOUT_VARIANTS, FONT_FAMILIES, FONT_SIZES, NOTE_REF_RE, EMBED_HOSTS, EMBED_SRC_RE, HIGHLIGHT_COLORS, IMAGE_WIDTHS, KATEX_OPTIONS, MAX_LATEX, TEXT_COLORS } from "@/lib/editor-shared";

/**
 * Server-side processing of Notebook (Tiptap) HTML. Pure functions — no
 * network or database — so they are unit tested directly.
 *
 * The editor sends HTML, but it is never trusted: every save is re-sanitised
 * against this allowlist, so scripts, event handlers, inline styles and
 * javascript: URLs cannot reach the public article page.
 */
const TEXT_COLOR_SET = new Set<string>(TEXT_COLORS);
const HIGHLIGHT_SET = new Set<string>(HIGHLIGHT_COLORS);
const ALIGN_SET = new Set<string>(ALIGNMENTS.filter((a) => a !== "left"));
const WIDTH_SET = new Set<string>(IMAGE_WIDTHS);
const SIZE_SET = new Set<string>(FONT_SIZES);
const FONT_SET = new Set<string>(FONT_FAMILIES);
const ALIGNABLE = ["p", "h1", "h2", "h3", "h4"] as const;
const CALLOUT_SET = new Set<string>(CALLOUT_VARIANTS);
const DIV_TYPES = new Set(["block-math", "detailsContent", "board"]);

/**
 * MathML produced by KaTeX. Only allowed in the final pass, after renderMath()
 * has replaced every equation with KaTeX's own output — MathML sent by the
 * browser is removed in the first pass. No annotation-xml / mglyph / links.
 */
const MATHML_TAGS = [
  "math", "semantics", "annotation", "mrow", "mi", "mn", "mo", "ms", "mtext", "mspace", "msup", "msub", "msubsup",
  "mfrac", "msqrt", "mroot", "mover", "munder", "munderover", "mtable", "mtr", "mtd", "mlabeledtr", "mstyle",
  "mpadded", "mphantom", "menclose", "mmultiscripts", "mprescripts", "none",
];
const MATHML_ATTRS = [
  "display", "mathvariant", "stretchy", "fence", "separator", "lspace", "rspace", "minsize", "maxsize", "symmetric",
  "largeop", "movablelimits", "accent", "accentunder", "width", "height", "depth", "voffset", "linethickness",
  "notation", "encoding", "columnalign", "rowalign", "columnspacing", "rowspacing", "columnlines", "rowlines",
  "frame", "framespacing", "displaystyle", "scriptlevel", "form",
];
const MATHML_VALUE = /^[\w\s./%+-]{0,80}$/;
const MATHML_OPTIONS: Partial<sanitizeHtml.IOptions> = {
  allowedAttributes: Object.fromEntries(MATHML_TAGS.map((t) => [t, MATHML_ATTRS])),
};
const SPAN_CLASSES = [/^hljs(-[\w-]+)?$/, /^attachment-(name|meta)$/, /^card-(text|title|desc|site)$/, /^board-(title|count)$/];

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "hr", "h1", "h2", "h3", "h4",
    "strong", "b", "em", "i", "u", "s", "del", "code", "pre", "span", "mark", "sub", "sup",
    "a", "ul", "ol", "li", "blockquote", "label", "input", "div",
    "table", "colgroup", "col", "thead", "tbody", "tr", "th", "td",
    "img", "figure", "figcaption", "video", "audio", "iframe",
    "aside", "details", "summary",
  ],
  allowedAttributes: {
    a: ["href", "title", "target", "rel", "download", "data-attachment", "data-size", "data-mime", "data-ref", "data-link-card"],
    img: ["src", "alt", "title", "width", "height", "loading", "referrerpolicy"],
    video: ["src", "controls", "preload", "playsinline"],
    audio: ["src", "controls", "preload"],
    iframe: ["src", "title", "allow", "allowfullscreen", "loading", "referrerpolicy"],
    figure: ["data-video", "data-audio", "data-width"],
    ...Object.fromEntries(ALIGNABLE.map((t) => [t, ["data-align"]])),
    figcaption: [],
    code: ["class"],
    pre: ["class", "data-mermaid"],
    span: ["class", "data-text-color", "data-size", "data-font", "data-type", "data-latex"],
    aside: ["data-callout"],
    details: [],
    summary: [],
    mark: ["data-color"],
    ul: ["data-type"],
    li: ["data-type", "data-checked", "data-label"],
    input: ["type", "checked", "disabled"],
    div: ["data-video-embed", "data-type", "data-latex", "data-board-column"],
    th: ["colspan", "rowspan"],
    td: ["colspan", "rowspan"],
    ol: ["start"],
  },
  allowedClasses: {
    code: [/^language-[\w-]+$/],
    pre: [/^language-[\w-]+$/],
    // Syntax-highlighting tokens (lowlight) + attachment card parts.
    span: SPAN_CLASSES,
  },
  allowedSchemes: ["https", "http", "mailto"],
  // http is allowed for img/video only so the transforms below can keep media from
  // the configured storage origin (local MinIO); every other http source is dropped.
  allowedSchemesByTag: { img: ["https", "http"], video: ["https", "http"], audio: ["https", "http"], iframe: ["https"] },
  allowedIframeHostnames: EMBED_HOSTS,
  allowIframeRelativeUrls: false,
  allowProtocolRelative: false,
};

export interface SanitizeOptions {
  /** Extra origins allowed for <img>/<video> even over http (e.g. the local storage server). */
  imageOrigins?: string[];
  /** Keep KaTeX MathML (internal: only for the pass after renderMath). */
  allowMathML?: boolean;
}

/** Equation placeholders: the LaTeX source stays in data-latex (capped). */
function mathAttrs(attribs: sanitizeHtml.Attributes, type: string) {
  if (attribs["data-type"] !== type) {
    delete attribs["data-latex"];
    return attribs;
  }
  if (attribs["data-latex"] !== undefined) attribs["data-latex"] = attribs["data-latex"].slice(0, MAX_LATEX);
  return attribs;
}

/** Keep an attribute only when its value passes `ok`. */
function keepIf(attribs: sanitizeHtml.Attributes, name: string, ok: (v: string) => boolean) {
  const v = attribs[name];
  if (v !== undefined && !ok(v)) delete attribs[name];
  return attribs;
}

export function sanitizeNotebookHtml(html: string, opts: SanitizeOptions = {}): string {
  const allowed = new Set(opts.imageOrigins ?? []);
  const safeMediaSrc = (src: string | undefined) => {
    try {
      const u = new URL(src ?? "");
      return u.protocol === "https:" || allowed.has(u.origin) ? u.href : "";
    } catch {
      return "";
    }
  };
  const math = opts.allowMathML ? MATHML_OPTIONS : null;
  return sanitizeHtml(html, {
    ...OPTIONS,
    ...(math
      ? {
          allowedTags: [...(OPTIONS.allowedTags as string[]), ...MATHML_TAGS],
          allowedAttributes: { ...(OPTIONS.allowedAttributes as Record<string, string[]>), ...(math.allowedAttributes as Record<string, string[]>) },
        }
      : {}),
    transformTags: {
      ...(math
        ? Object.fromEntries(
            MATHML_TAGS.map((t) => [
              t,
              (tagName: string, attribs: sanitizeHtml.Attributes) => {
                for (const k of Object.keys(attribs)) if (!MATHML_VALUE.test(attribs[k] ?? "")) delete attribs[k];
                return { tagName, attribs };
              },
            ]),
          )
        : {}),
      a: (tagName, attribs) => {
        keepIf(attribs, "data-size", (v) => /^\d{1,12}$/.test(v));
        keepIf(attribs, "data-mime", (v) => /^[\w.+-]+\/[\w.+-]+$/.test(v));
        keepIf(attribs, "data-ref", (v) => NOTE_REF_RE.test(v));
        keepIf(attribs, "data-link-card", (v) => v === "");
        // Internal links get their address when the page is rendered (applyNoteLinks).
        if (attribs["data-ref"]) delete attribs.href;
        return { tagName, attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer nofollow" } };
      },
      img: (tagName, attribs) => {
        const src = safeMediaSrc(attribs.src);
        const { src: _drop, ...rest } = attribs;
        void _drop;
        return { tagName, attribs: { ...rest, ...(src ? { src } : {}), loading: "lazy", referrerpolicy: "no-referrer" } };
      },
      video: (tagName, attribs) => {
        const src = safeMediaSrc(attribs.src);
        // Always user-controlled playback: controls on, never autoplay.
        return { tagName, attribs: { ...(src ? { src } : {}), controls: "true", preload: "metadata", playsinline: "true" } };
      },
      audio: (tagName, attribs) => {
        const src = safeMediaSrc(attribs.src);
        return { tagName, attribs: { ...(src ? { src } : {}), controls: "true", preload: "metadata" } };
      },
      ...Object.fromEntries(
        ALIGNABLE.map((t) => [t, (tagName: string, attribs: sanitizeHtml.Attributes) => ({ tagName, attribs: keepIf(attribs, "data-align", (v) => ALIGN_SET.has(v)) })]),
      ),
      iframe: (tagName, attribs) => {
        const src = EMBED_SRC_RE.test(attribs.src ?? "") ? attribs.src! : "";
        return {
          tagName,
          attribs: {
            ...(src ? { src } : {}),
            title: attribs.title?.slice(0, 100) || "Embedded video",
            allow: "accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen",
            allowfullscreen: "true",
            loading: "lazy",
            referrerpolicy: "strict-origin-when-cross-origin",
          },
        };
      },
      span: (tagName, attribs) => {
        keepIf(attribs, "data-type", (v) => v === "inline-math");
        mathAttrs(attribs, "inline-math");
        keepIf(attribs, "data-size", (v) => SIZE_SET.has(v));
        keepIf(attribs, "data-font", (v) => FONT_SET.has(v));
        return { tagName, attribs: keepIf(attribs, "data-text-color", (v) => TEXT_COLOR_SET.has(v)) };
      },
      pre: (tagName, attribs) => ({ tagName, attribs: keepIf(attribs, "data-mermaid", (v) => v === "") }),
      aside: (tagName, attribs) => ({ tagName, attribs: { "data-callout": CALLOUT_SET.has(attribs["data-callout"] ?? "") ? attribs["data-callout"]! : "note" } }),
      mark: (tagName, attribs) => ({ tagName, attribs: keepIf(attribs, "data-color", (v) => HIGHLIGHT_SET.has(v)) }),
      ul: (tagName, attribs) => ({ tagName, attribs: keepIf(attribs, "data-type", (v) => v === "taskList") }),
      li: (tagName, attribs) => {
        keepIf(attribs, "data-type", (v) => v === "taskItem");
        keepIf(attribs, "data-label", (v) => HIGHLIGHT_SET.has(v));
        return { tagName, attribs: keepIf(attribs, "data-checked", (v) => v === "true" || v === "false") };
      },
      // Checklist ticks are read-only on the page.
      input: (tagName, attribs) => ({ tagName, attribs: { type: attribs.type === "checkbox" ? "checkbox" : "hidden-invalid", ...("checked" in attribs ? { checked: "checked" } : {}), disabled: "disabled" } }),
      div: (tagName, attribs) => {
        keepIf(attribs, "data-type", (v) => DIV_TYPES.has(v));
        keepIf(attribs, "data-board-column", (v) => v === "");
        mathAttrs(attribs, "block-math");
        return { tagName, attribs: keepIf(attribs, "data-video-embed", (v) => v === "youtube" || v === "vimeo") };
      },
      figure: (tagName, attribs) => {
        keepIf(attribs, "data-video", (v) => v === "");
        keepIf(attribs, "data-audio", (v) => v === "");
        return { tagName, attribs: keepIf(attribs, "data-width", (v) => WIDTH_SET.has(v)) };
      },
    },
    exclusiveFilter: (frame) =>
      (["img", "video", "audio", "iframe"].includes(frame.tag) && !frame.attribs.src) ||
      (frame.tag === "input" && frame.attribs.type !== "checkbox"),
  }).trim();
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

// ── Server-side equations ──
// LaTeX → MathML with KaTeX, so the article needs no maths CSS, fonts or JS.
export function renderMath(cleanHtml: string): string {
  const $ = cheerio.load(cleanHtml, null, false);
  $('span[data-type="inline-math"], div[data-type="block-math"]').each((_, el) => {
    const node = $(el);
    const latex = (node.attr("data-latex") ?? "").slice(0, MAX_LATEX);
    try {
      node.html(katex.renderToString(latex, { ...KATEX_OPTIONS, displayMode: el.tagName === "div" }));
    } catch {
      // Invalid LaTeX: show the source instead of breaking the page.
      node.html(`<code>${escapeHtml(latex)}</code>`);
    }
  });
  return $.html();
}

/** Full pipeline for a save: sanitise → highlight → equations → sanitise again (defence in depth). */
export function renderNotebookHtml(editorHtml: string, opts: SanitizeOptions = {}): string {
  const base = { imageOrigins: opts.imageOrigins };
  return sanitizeNotebookHtml(renderMath(highlightCodeBlocks(sanitizeNotebookHtml(editorHtml, base))), { ...base, allowMathML: true });
}

// ── Internal links ──
export interface NoteLinkTarget {
  href: string;
  /** A Notebook article on the timeline (opens in the same tab). */
  internal: boolean;
}

/** Ids referenced by internal links in (sanitised) HTML. */
export function noteRefIds(cleanHtml: string): string[] {
  if (!cleanHtml.includes("data-ref")) return [];
  const $ = cheerio.load(cleanHtml, null, false);
  return [...new Set($("a[data-ref]").map((_, el) => $(el).attr("data-ref") ?? "").get().filter((id) => NOTE_REF_RE.test(id)))];
}

/**
 * Give each internal link the current address of its target; links to items
 * that aren't published (or no longer exist) become plain text.
 */
export function applyNoteLinks(cleanHtml: string, targets: Map<string, NoteLinkTarget>): string {
  if (!cleanHtml.includes("data-ref")) return cleanHtml;
  const $ = cheerio.load(cleanHtml, null, false);
  $("a[data-ref]").each((_, el) => {
    const a = $(el);
    const target = targets.get(a.attr("data-ref") ?? "");
    if (!target) {
      a.replaceWith(escapeHtml(a.text()));
      return;
    }
    a.attr("href", target.href);
    if (target.internal) a.removeAttr("target").removeAttr("rel");
    else a.attr({ target: "_blank", rel: "noopener noreferrer" });
  });
  return $.html();
}

/** Every uploaded-media URL in (sanitised) HTML: images, videos, audio and attachment links. */
export function mediaSources(cleanHtml: string): string[] {
  const $ = cheerio.load(cleanHtml, null, false);
  const urls = [
    ...$("img, video, audio").not("a[data-link-card] img").map((_, el) => $(el).attr("src") ?? "").get(),
    ...$("a[data-attachment]").map((_, el) => $(el).attr("href") ?? "").get(),
  ];
  return urls.filter(Boolean);
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
  // Equations count as their LaTeX source once (not the MathML twice over).
  $('[data-type="inline-math"], [data-type="block-math"]').each((_, el) => {
    $(el).text(` ${$(el).attr("data-latex") ?? ""} `);
  });
  // Link cards preview other pages, and diagram source is code: neither counts as the post's words.
  $("a[data-link-card], pre[data-mermaid]").remove();
  // Keep block boundaries as spaces so words don't run together.
  $("p, h1, h2, h3, h4, li, blockquote, pre, td, th, figcaption, summary, aside, br").after(" ");
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
