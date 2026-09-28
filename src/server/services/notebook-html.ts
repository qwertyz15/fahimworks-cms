import * as cheerio from "cheerio";
import { common, createLowlight } from "lowlight";
import sanitizeHtml from "sanitize-html";
import { countWords } from "./extraction/parse";
import { EMBED_HOSTS, EMBED_SRC_RE, HIGHLIGHT_COLORS, TEXT_COLORS } from "@/lib/editor-shared";

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
const SPAN_CLASSES = [/^hljs(-[\w-]+)?$/, /^attachment-(name|meta)$/];

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "hr", "h1", "h2", "h3", "h4",
    "strong", "b", "em", "i", "u", "s", "del", "code", "pre", "span", "mark", "sub", "sup",
    "a", "ul", "ol", "li", "blockquote", "label", "input", "div",
    "table", "colgroup", "col", "thead", "tbody", "tr", "th", "td",
    "img", "figure", "figcaption", "video", "iframe",
  ],
  allowedAttributes: {
    a: ["href", "title", "target", "rel", "download", "data-attachment", "data-size", "data-mime"],
    img: ["src", "alt", "title", "width", "height", "loading", "referrerpolicy"],
    video: ["src", "controls", "preload", "playsinline"],
    iframe: ["src", "title", "allow", "allowfullscreen", "loading", "referrerpolicy"],
    figure: ["data-video"],
    figcaption: [],
    code: ["class"],
    pre: ["class"],
    span: ["class", "data-text-color"],
    mark: ["data-color"],
    ul: ["data-type"],
    li: ["data-type", "data-checked"],
    input: ["type", "checked", "disabled"],
    div: ["data-video-embed"],
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
  allowedSchemesByTag: { img: ["https", "http"], video: ["https", "http"], iframe: ["https"] },
  allowedIframeHostnames: EMBED_HOSTS,
  allowIframeRelativeUrls: false,
  allowProtocolRelative: false,
};

export interface SanitizeOptions {
  /** Extra origins allowed for <img>/<video> even over http (e.g. the local storage server). */
  imageOrigins?: string[];
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
  return sanitizeHtml(html, {
    ...OPTIONS,
    transformTags: {
      a: (tagName, attribs) => {
        keepIf(attribs, "data-size", (v) => /^\d{1,12}$/.test(v));
        keepIf(attribs, "data-mime", (v) => /^[\w.+-]+\/[\w.+-]+$/.test(v));
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
      span: (tagName, attribs) => ({ tagName, attribs: keepIf(attribs, "data-text-color", (v) => TEXT_COLOR_SET.has(v)) }),
      mark: (tagName, attribs) => ({ tagName, attribs: keepIf(attribs, "data-color", (v) => HIGHLIGHT_SET.has(v)) }),
      ul: (tagName, attribs) => ({ tagName, attribs: keepIf(attribs, "data-type", (v) => v === "taskList") }),
      li: (tagName, attribs) => {
        keepIf(attribs, "data-type", (v) => v === "taskItem");
        return { tagName, attribs: keepIf(attribs, "data-checked", (v) => v === "true" || v === "false") };
      },
      // Checklist ticks are read-only on the page.
      input: (tagName, attribs) => ({ tagName, attribs: { type: attribs.type === "checkbox" ? "checkbox" : "hidden-invalid", ...("checked" in attribs ? { checked: "checked" } : {}), disabled: "disabled" } }),
      div: (tagName, attribs) => ({ tagName, attribs: keepIf(attribs, "data-video-embed", (v) => v === "youtube" || v === "vimeo") }),
      figure: (tagName, attribs) => ({ tagName, attribs: keepIf(attribs, "data-video", (v) => v === "") }),
    },
    exclusiveFilter: (frame) =>
      ((frame.tag === "img" || frame.tag === "video" || frame.tag === "iframe") && !frame.attribs.src) ||
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

/** Full pipeline for a save: sanitise → highlight → sanitise again (defence in depth). */
export function renderNotebookHtml(editorHtml: string, opts: SanitizeOptions = {}): string {
  return sanitizeNotebookHtml(highlightCodeBlocks(sanitizeNotebookHtml(editorHtml, opts)), opts);
}

/** Every uploaded-media URL in (sanitised) HTML: images, videos and attachment links. */
export function mediaSources(cleanHtml: string): string[] {
  const $ = cheerio.load(cleanHtml, null, false);
  const urls = [
    ...$("img, video").map((_, el) => $(el).attr("src") ?? "").get(),
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
