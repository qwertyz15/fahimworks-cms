import { boardColumns, safeHref, str, textOf, videoUrl, type DocNode, type ExportContext, type ExportMeta } from "./document";

/**
 * Editor document → GitHub-flavoured Markdown. Built from the stored JSON
 * (not the HTML), so every block has a deliberate Markdown form: task
 * lists, tables, callouts as > [!NOTE], toggles as <details>, maths as $…$,
 * Mermaid as a ```mermaid block, boards as one list per column. Colours and
 * font styles have no Markdown equivalent and are dropped.
 */

const CALLOUT_KIND: Record<string, string> = { note: "NOTE", tip: "TIP", warning: "WARNING", danger: "CAUTION" };

const escapeText = (t: string) => t.replace(/([\\`*_[\]<>|~])/g, "\\$1");

/** Escape what would start a block at the beginning of a line. */
const escapeLineStart = (line: string) => line.replace(/^(\s*)([#>+-]|\d+[.)])(?=\s|$)/, (_m, sp: string, mk: string) => `${sp}${mk.replace(/([#>+\-.)])/, "\\$1")}`);

function codeSpan(text: string) {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((m) => m.length));
  const fence = "`".repeat(longest + 1);
  return text.startsWith("`") || text.endsWith("`") ? `${fence} ${text} ${fence}` : `${fence}${text}${fence}`;
}

function fence(text: string, info = "") {
  const longest = Math.max(2, ...(text.match(/`{3,}/g) ?? []).map((m) => m.length));
  const f = "`".repeat(longest + 1);
  return `${f}${info}\n${text}\n${f}`;
}

type Mark = NonNullable<DocNode["marks"]>[number];
const markKey = (marks: Mark[] = []) =>
  marks
    .filter((m) => ["bold", "italic", "strike", "code", "link"].includes(m.type))
    .map((m) => (m.type === "link" ? `link:${str(m.attrs?.href)}` : m.type))
    .sort()
    .join("|");

/** Inline content → Markdown. Neighbouring text with the same marks is merged first. */
function inline(nodes: DocNode[] | undefined, ctx: ExportContext): string {
  const merged: DocNode[] = [];
  for (const n of nodes ?? []) {
    const prev = merged.at(-1);
    if (n.type === "text" && prev?.type === "text" && markKey(prev.marks) === markKey(n.marks)) prev.text = (prev.text ?? "") + (n.text ?? "");
    else merged.push(n.type === "text" ? { ...n } : n);
  }
  return merged
    .map((n) => {
      switch (n.type) {
        case "text": {
          const marks = n.marks ?? [];
          const has = (t: string) => marks.some((m) => m.type === t);
          const raw = n.text ?? "";
          if (!raw) return "";
          if (has("code")) {
            const href = safeHref(marks.find((m) => m.type === "link")?.attrs?.href);
            return href ? `[${codeSpan(raw)}](${href})` : codeSpan(raw);
          }
          // Emphasis can't start or end on whitespace: keep it outside the markers.
          const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(raw)!;
          if (!core) return raw;
          let t = escapeText(core);
          if (has("strike")) t = `~~${t}~~`;
          if (has("italic")) t = `_${t}_`;
          if (has("bold")) t = `**${t}**`;
          const href = safeHref(marks.find((m) => m.type === "link")?.attrs?.href);
          if (href) t = `[${t}](${href.replace(/[()\s]/g, encodeURIComponent)})`;
          return lead + t + trail;
        }
        case "hardBreak":
          return "\\\n";
        case "inlineMath":
          return `$${str(n.attrs?.latex)}$`;
        case "noteLink": {
          const label = escapeText(str(n.attrs?.label) || "Untitled");
          const url = ctx.linkFor(str(n.attrs?.id));
          return url ? `[${label}](${url})` : label;
        }
        default:
          return escapeText(textOf(n));
      }
    })
    .join("");
}

const indent = (text: string, pad: string) =>
  text
    .split("\n")
    .map((l) => (l ? pad + l : l))
    .join("\n");

function list(node: DocNode, ctx: ExportContext): string {
  const ordered = node.type === "orderedList";
  let n = typeof node.attrs?.start === "number" ? (node.attrs.start as number) : 1;
  return (node.content ?? [])
    .map((item) => {
      const marker = node.type === "taskList" ? `- [${item.attrs?.checked ? "x" : " "}] ` : ordered ? `${n++}. ` : "- ";
      const [first, ...rest] = item.content ?? [];
      const head = first ? (first.type === "paragraph" ? escapeLineStart(inline(first.content, ctx)) : blocks([first], ctx)) : "";
      const body = rest.length ? "\n" + indent(blocks(rest, ctx), " ".repeat(Math.min(marker.length, 4))) : "";
      return marker + head.replace(/\n/g, "\n" + " ".repeat(Math.min(marker.length, 4))) + body;
    })
    .join("\n");
}

function table(node: DocNode, ctx: ExportContext): string {
  const rows = (node.content ?? []).map((r) => (r.content ?? []).map((c) => (c.content ?? []).map((p) => inline(p.content, ctx)).join("<br>").replace(/\n/g, "<br>").replace(/(?<!\\)\|/g, "\\|") || " "));
  if (!rows.length) return "";
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) => [...r, ...Array(width - r.length).fill(" ")];
  const [head, ...body] = rows.map(pad);
  return [`| ${head!.join(" | ")} |`, `| ${head!.map(() => "---").join(" | ")} |`, ...body.map((r) => `| ${r.join(" | ")} |`)].join("\n");
}

function block(node: DocNode, ctx: ExportContext): string {
  const a = node.attrs ?? {};
  switch (node.type) {
    case "paragraph":
      return escapeLineStart(inline(node.content, ctx));
    case "heading":
      return `${"#".repeat(Math.min(6, Math.max(1, Number(a.level) || 1)))} ${inline(node.content, ctx)}`;
    case "bulletList":
    case "orderedList":
    case "taskList":
      return list(node, ctx);
    case "blockquote":
      return indent(blocks(node.content, ctx), "> ").replace(/^$/gm, ">");
    case "codeBlock": {
      const lang = str(a.language);
      return fence(textOf(node), lang && lang !== "plaintext" ? lang : "");
    }
    case "horizontalRule":
      return "---";
    case "image": {
      const src = safeHref(a.src);
      if (!src) return "";
      const alt = escapeText(str(a.alt));
      const caption = str(a.caption);
      return `![${alt}](${src})${caption ? `\n\n_${escapeText(caption)}_` : ""}`;
    }
    case "table":
      return table(node, ctx);
    case "callout": {
      const inner = blocks(node.content, ctx);
      return `> [!${CALLOUT_KIND[str(a.variant)] ?? "NOTE"}]\n` + indent(inner, "> ").replace(/^$/gm, ">");
    }
    case "details": {
      const summary = node.content?.find((c) => c.type === "detailsSummary");
      const content = node.content?.find((c) => c.type === "detailsContent");
      return `<details>\n<summary>${escapeText(summary ? textOf(summary) : "Details")}</summary>\n\n${blocks(content?.content, ctx)}\n\n</details>`;
    }
    case "blockMath":
      return `$$\n${str(a.latex)}\n$$`;
    case "mermaidDiagram":
      return fence(str(a.source), "mermaid");
    case "board":
      return boardColumns(node)
        .map((c) => `**${escapeText(c.title)}**\n\n${c.cards.length ? c.cards.map((k) => `- ${escapeText(k.text)}${k.label ? ` _(${k.label})_` : ""}`).join("\n") : "_No cards_"}`)
        .join("\n\n");
    case "videoEmbed": {
      const id = str(a.id);
      return id ? `[▶ ${a.provider === "vimeo" ? "Vimeo" : "YouTube"} video](${videoUrl(str(a.provider), id)})` : "";
    }
    case "videoFile":
    case "audioFile": {
      const src = safeHref(a.src);
      const caption = str(a.caption);
      return src ? `[${node.type === "videoFile" ? "▶ Video" : "🔊 Audio"}${caption ? `: ${escapeText(caption)}` : ""}](${src})` : "";
    }
    case "attachment": {
      const href = safeHref(a.href);
      return href ? `[📎 ${escapeText(str(a.name) || "File")}](${href})` : "";
    }
    case "linkCard": {
      const url = safeHref(a.url);
      if (!url) return "";
      const desc = str(a.description);
      return `[${escapeText(str(a.title) || url)}](${url})${desc ? `\\\n${escapeText(desc)}` : ""}`;
    }
    default:
      return node.content ? blocks(node.content, ctx) : "";
  }
}

function blocks(nodes: DocNode[] | undefined, ctx: ExportContext): string {
  return (nodes ?? [])
    .map((n) => block(n, ctx))
    .filter((s) => s.trim() !== "")
    .join("\n\n");
}

const yaml = (v: string) => JSON.stringify(v);

/** The whole document, with YAML front matter and a title heading. */
export function toMarkdown(doc: DocNode | null, meta: ExportMeta, ctx: ExportContext): string {
  const front = [
    "---",
    `title: ${yaml(meta.title || "Untitled")}`,
    ...(meta.subtitle ? [`subtitle: ${yaml(meta.subtitle)}`] : []),
    ...(meta.date ? [`date: ${meta.date}`] : []),
    ...(meta.tags?.length ? [`tags: [${meta.tags.map(yaml).join(", ")}]`] : []),
    ...(meta.properties ?? []).map((p) => `${yaml(p.name)}: ${yaml(p.value)}`),
    "---",
  ].join("\n");
  const head = [`# ${escapeText(meta.title || "Untitled")}`, meta.subtitle ? `_${escapeText(meta.subtitle)}_` : "", meta.coverImage && safeHref(meta.coverImage) ? `![](${meta.coverImage})` : ""].filter(Boolean).join("\n\n");
  const body = blocks(doc?.content, ctx);
  return `${front}\n\n${head}${body ? `\n\n${body}` : ""}\n`;
}
