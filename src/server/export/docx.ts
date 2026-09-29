import "server-only";
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IParagraphOptions,
  type ParagraphChild,
} from "docx";
import { CALLOUT_LABELS, boardColumns, safeHref, str, textOf, videoUrl, type DocNode, type ExportContext, type ExportMeta } from "@/lib/export/document";
import { storagePublicOrigin } from "@/lib/storage";

/**
 * Editor document → Word (.docx): real headings, lists, tables and code, with
 * text colours, highlights and font styles kept. Images are embedded only
 * when they come from our own media bucket (never an arbitrary URL);
 * anything else is linked.
 */

const TEXT_HEX: Record<string, string> = { gray: "71717A", red: "DC2626", orange: "EA580C", yellow: "CA8A04", green: "16A34A", teal: "0D9488", blue: "2563EB", indigo: "4F46E5", purple: "9333EA", pink: "DB2777", brown: "92400E" };
const HIGHLIGHT_HEX: Record<string, string> = { yellow: "FEF08A", green: "BBF7D0", blue: "BFDBFE", pink: "FBCFE8", purple: "E9D5FF", orange: "FED7AA" };
/** Half-points. */
const SIZE: Record<string, number> = { small: 18, large: 28, xlarge: 32, huge: 40 };
const FONT: Record<string, string> = { serif: "Georgia", mono: "Consolas", handwriting: "Comic Sans MS", rounded: "Arial Rounded MT Bold", condensed: "Arial Narrow", book: "Book Antiqua", display: "Impact" };
const CALLOUT_FILL: Record<string, string> = { note: "EFF6FF", tip: "F0FDF4", warning: "FFFBEB", danger: "FEF2F2" };
const CALLOUT_LINE: Record<string, string> = { note: "3B82F6", tip: "22C55E", warning: "F59E0B", danger: "EF4444" };
const MONO = "Consolas";
/** Page text width at 96 dpi (6.5 in). */
const MAX_IMAGE_WIDTH = 624;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

type Img = { data: Buffer; type: "png" | "jpg" | "gif"; width: number; height: number };

/** Pixel size of a PNG / JPEG / GIF, or null. */
export function imageInfo(b: Buffer): Omit<Img, "data"> | null {
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { type: "png", width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b.length > 10 && b.toString("ascii", 0, 3) === "GIF") return { type: "gif", width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1]!;
      const len = b.readUInt16BE(i + 2);
      // SOF0–SOF15, except DHT (C4), JPG (C8), DAC (CC).
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { type: "jpg", height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      i += 2 + len;
    }
  }
  return null;
}

/** Download an image from our media bucket (anything else: null). */
async function fetchImage(src: string): Promise<Img | null> {
  const origin = storagePublicOrigin();
  const base = process.env.S3_PUBLIC_URL?.replace(/\/+$/, "");
  if (!origin || !base) return null;
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return null;
  }
  if (url.origin !== origin || !url.href.startsWith(`${base}/`)) return null;
  try {
    const res = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_IMAGE_BYTES) return null;
    const data = Buffer.from(await res.arrayBuffer());
    if (data.length > MAX_IMAGE_BYTES) return null;
    const info = imageInfo(data);
    return info && info.width > 0 && info.height > 0 ? { data, ...info } : null;
  } catch {
    return null;
  }
}

interface Ctx extends ExportContext {
  images: Map<string, Img | null>;
  /** Fresh numbering instance per ordered list (restarts at 1). */
  listInstance: number;
  /** Left rule / shading for everything inside a quote or callout. */
  deco?: { border: IParagraphOptions["border"]; shading?: IParagraphOptions["shading"] };
}

/** A paragraph, framed like its quote / callout when inside one. */
const P = (c: Ctx, o: IParagraphOptions) => new Paragraph(c.deco ? { ...o, border: c.deco.border, ...(c.deco.shading ? { shading: c.deco.shading } : {}) } : o);

type Style = { bold?: boolean; italics?: boolean; strike?: boolean; underline?: boolean; mono?: boolean; color?: string; fill?: string; size?: number; font?: string };

function run(text: string, s: Style, extra: { break?: number } = {}) {
  return new TextRun({
    text,
    ...extra,
    bold: s.bold,
    italics: s.italics,
    strike: s.strike,
    ...(s.underline ? { underline: {} } : {}),
    ...(s.color ? { color: s.color } : {}),
    ...(s.fill ? { shading: { type: ShadingType.CLEAR, fill: s.fill, color: "auto" } } : {}),
    ...(s.size ? { size: s.size } : {}),
    ...(s.mono ? { font: MONO } : s.font ? { font: s.font } : {}),
  });
}

function inline(nodes: DocNode[] | undefined, ctx: Ctx, base: Style = {}): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const n of nodes ?? []) {
    if (n.type === "hardBreak") {
      out.push(run("", base, { break: 1 }));
      continue;
    }
    if (n.type === "inlineMath") {
      out.push(run(str(n.attrs?.latex), { ...base, font: "Cambria Math", italics: true }));
      continue;
    }
    if (n.type === "noteLink") {
      const label = str(n.attrs?.label) || "Untitled";
      const url = ctx.linkFor(str(n.attrs?.id));
      out.push(url ? new ExternalHyperlink({ link: url, children: [new TextRun({ text: label, style: "Hyperlink" })] }) : run(label, base));
      continue;
    }
    if (n.type !== "text") {
      out.push(run(textOf(n), base));
      continue;
    }
    const s: Style = { ...base };
    let href: string | null = null;
    for (const m of n.marks ?? []) {
      const v = str(m.attrs?.color) || str(m.attrs?.value);
      if (m.type === "bold") s.bold = true;
      else if (m.type === "italic") s.italics = true;
      else if (m.type === "strike") s.strike = true;
      else if (m.type === "underline") s.underline = true;
      else if (m.type === "code") s.mono = true;
      else if (m.type === "textColor") s.color = TEXT_HEX[v];
      else if (m.type === "highlight") s.fill = HIGHLIGHT_HEX[str(m.attrs?.color) || "yellow"];
      else if (m.type === "fontSize") s.size = SIZE[v];
      else if (m.type === "fontFamily") s.font = FONT[v];
      else if (m.type === "link") href = safeHref(m.attrs?.href);
    }
    const r = href ? new TextRun({ text: n.text ?? "", style: "Hyperlink", bold: s.bold, italics: s.italics }) : run(n.text ?? "", s);
    out.push(href ? new ExternalHyperlink({ link: href, children: [r] }) : r);
  }
  return out;
}

const ALIGN = { center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED } as const;
const align = (n: DocNode) => ALIGN[str(n.attrs?.textAlign) as keyof typeof ALIGN];

const linkParagraph = (c: Ctx, label: string, href: string, opts: { indent?: number } = {}) =>
  P(c, { children: [new ExternalHyperlink({ link: href, children: [new TextRun({ text: label, style: "Hyperlink" })] })], ...(opts.indent ? { indent: { left: opts.indent } } : {}) });

function codeParagraphs(c: Ctx, text: string, indentLeft = 0): Paragraph[] {
  const lines = text.split("\n");
  return lines.map(
    (line, i) =>
      P(c, {
        children: [new TextRun({ text: line || " ", font: MONO, size: 19 })],
        shading: { type: ShadingType.CLEAR, fill: "F4F4F5", color: "auto" },
        spacing: { before: i === 0 ? 120 : 0, after: i === lines.length - 1 ? 120 : 0, line: 260 },
        indent: { left: indentLeft + 120, right: 120 },
      }),
  );
}

type Block = Paragraph | Table;

function listBlocks(node: DocNode, ctx: Ctx, level: number, indentLeft: number): Block[] {
  const out: Block[] = [];
  const instance = ++ctx.listInstance;
  for (const item of node.content ?? []) {
    const [first, ...rest] = item.content ?? [];
    const para = first?.type === "paragraph" ? first : null;
    const children = para ? inline(para.content, ctx) : [];
    if (node.type === "taskList") {
      const checked = Boolean(item.attrs?.checked);
      out.push(P(ctx, { children: [new TextRun({ text: checked ? "☑ " : "☐ " }), ...inline(para?.content, ctx, checked ? { strike: false } : {})], indent: { left: indentLeft + 360 * (level + 1), hanging: 280 } }));
    } else if (node.type === "orderedList") {
      out.push(P(ctx, { children, numbering: { reference: "ordered", level: Math.min(level, 8), instance } }));
    } else {
      out.push(P(ctx, { children, bullet: { level: Math.min(level, 8) } }));
    }
    for (const b of para ? rest : item.content ?? []) {
      if (b.type === "bulletList" || b.type === "orderedList" || b.type === "taskList") out.push(...listBlocks(b, ctx, level + 1, indentLeft));
      else out.push(...blocks([b], ctx, indentLeft + 360 * (level + 1)));
    }
  }
  return out;
}

function tableBlock(node: DocNode, ctx: Ctx): Table {
  const rows = (node.content ?? []).map(
    (r) =>
      new TableRow({
        tableHeader: r.content?.every((c) => c.type === "tableHeader"),
        children: (r.content ?? []).map(
          (c) =>
            new TableCell({
              ...(c.type === "tableHeader" ? { shading: { type: ShadingType.CLEAR, fill: "F4F4F5", color: "auto" } } : {}),
              children: (c.content?.length ? c.content : [{ type: "paragraph" }]).map((p) => new Paragraph({ children: inline(p.content, ctx, c.type === "tableHeader" ? { bold: true } : {}) })),
            }),
        ),
      }),
  );
  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
}

function blocks(nodes: DocNode[] | undefined, ctx: Ctx, indentLeft = 0): Block[] {
  const out: Block[] = [];
  const ind = indentLeft ? { indent: { left: indentLeft } } : {};
  for (const n of nodes ?? []) {
    const a = n.attrs ?? {};
    switch (n.type) {
      case "paragraph":
        out.push(P(ctx, { children: inline(n.content, ctx), alignment: align(n), ...ind }));
        break;
      case "heading": {
        const level = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4][Math.min(4, Math.max(1, Number(a.level) || 1)) - 1];
        out.push(P(ctx, { heading: level, children: inline(n.content, ctx), alignment: align(n), ...ind }));
        break;
      }
      case "bulletList":
      case "orderedList":
      case "taskList":
        out.push(...listBlocks(n, ctx, 0, indentLeft));
        break;
      case "blockquote":
        out.push(...blocks(n.content, { ...ctx, deco: { border: { left: { style: BorderStyle.SINGLE, size: 18, color: "A1A1AA", space: 8 } } } }, indentLeft + 360));
        break;
      case "codeBlock":
        out.push(...codeParagraphs(ctx, textOf(n), indentLeft));
        break;
      case "horizontalRule":
        out.push(P(ctx, { children: [], border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "D4D4D8", space: 1 } }, ...ind }));
        break;
      case "image": {
        const src = safeHref(a.src);
        if (!src) break;
        const img = ctx.images.get(src);
        if (img) {
          const w = Math.min(MAX_IMAGE_WIDTH, img.width);
          const h = Math.round((img.height * w) / img.width);
          out.push(P(ctx, { alignment: AlignmentType.CENTER, children: [new ImageRun({ type: img.type, data: img.data, transformation: { width: w, height: h }, altText: { name: "Image", description: str(a.alt) || "Image", title: str(a.alt) || "Image" } })] }));
        } else out.push(linkParagraph(ctx, `🖼 ${str(a.alt) || "Image"}`, src, { indent: indentLeft }));
        const caption = str(a.caption);
        if (caption) out.push(P(ctx, { alignment: AlignmentType.CENTER, children: [new TextRun({ text: caption, italics: true, color: "71717A", size: 20 })] }));
        break;
      }
      case "table":
        out.push(tableBlock(n, ctx));
        break;
      case "callout": {
        const variant = str(a.variant) in CALLOUT_LABELS ? str(a.variant) : "note";
        const framed: Ctx = { ...ctx, deco: { border: { left: { style: BorderStyle.SINGLE, size: 18, color: CALLOUT_LINE[variant]!, space: 8 } }, shading: { type: ShadingType.CLEAR, fill: CALLOUT_FILL[variant]!, color: "auto" } } };
        out.push(P(framed, { children: [new TextRun({ text: CALLOUT_LABELS[variant]!, bold: true })], indent: { left: indentLeft + 200 } }));
        out.push(...blocks(n.content, framed, indentLeft + 200));
        break;
      }
      case "details": {
        const summary = n.content?.find((c) => c.type === "detailsSummary");
        const content = n.content?.find((c) => c.type === "detailsContent");
        out.push(P(ctx, { children: [new TextRun({ text: `▸ ${summary ? textOf(summary) : "Details"}`, bold: true })], ...ind }));
        out.push(...blocks(content?.content, ctx, indentLeft + 360));
        break;
      }
      case "blockMath":
        out.push(P(ctx, { alignment: AlignmentType.CENTER, children: [new TextRun({ text: str(a.latex), font: "Cambria Math", italics: true })] }));
        break;
      case "mermaidDiagram":
        out.push(P(ctx, { children: [new TextRun({ text: "Diagram (Mermaid)", bold: true, color: "71717A", size: 18 })], ...ind }));
        out.push(...codeParagraphs(ctx, str(a.source), indentLeft));
        break;
      case "board":
        for (const c of boardColumns(n)) {
          out.push(P(ctx, { children: [new TextRun({ text: c.title, bold: true })], spacing: { before: 160 }, ...ind }));
          if (!c.cards.length) out.push(P(ctx, { children: [new TextRun({ text: "No cards", italics: true, color: "71717A" })], ...ind }));
          for (const k of c.cards) out.push(P(ctx, { bullet: { level: 0 }, children: [new TextRun(k.text), ...(k.label ? [new TextRun({ text: `  (${k.label})`, color: "71717A" })] : [])] }));
        }
        break;
      case "videoEmbed": {
        const id = str(a.id);
        if (id) out.push(linkParagraph(ctx, `▶ ${a.provider === "vimeo" ? "Vimeo" : "YouTube"} video`, videoUrl(str(a.provider), id), { indent: indentLeft }));
        break;
      }
      case "videoFile":
      case "audioFile": {
        const src = safeHref(a.src);
        const caption = str(a.caption);
        if (src) out.push(linkParagraph(ctx, `${n.type === "videoFile" ? "▶ Video" : "🔊 Audio"}${caption ? `: ${caption}` : ""}`, src, { indent: indentLeft }));
        break;
      }
      case "attachment": {
        const href = safeHref(a.href);
        if (href) out.push(linkParagraph(ctx, `📎 ${str(a.name) || "File"}`, href, { indent: indentLeft }));
        break;
      }
      case "linkCard": {
        const url = safeHref(a.url);
        if (!url) break;
        out.push(linkParagraph(ctx, str(a.title) || url, url, { indent: indentLeft }));
        if (str(a.description)) out.push(P(ctx, { children: [new TextRun({ text: str(a.description), color: "71717A", size: 20 })], ...ind }));
        break;
      }
      default:
        if (n.content) out.push(...blocks(n.content, ctx, indentLeft));
    }
  }
  return out;
}

function collectImages(nodes: DocNode[] | undefined, out: Set<string>) {
  for (const n of nodes ?? []) {
    if (n.type === "image") {
      const s = safeHref(n.attrs?.src);
      if (s) out.add(s);
    }
    collectImages(n.content, out);
  }
}

export async function toDocx(doc: DocNode | null, meta: ExportMeta, ctx: ExportContext): Promise<Buffer> {
  const srcs = new Set<string>();
  collectImages(doc?.content, srcs);
  if (meta.coverImage) srcs.add(meta.coverImage);
  const images = new Map<string, Img | null>();
  // A few at a time: an entry can have many images.
  const list = [...srcs].slice(0, 60);
  for (let i = 0; i < list.length; i += 6) {
    const chunk = list.slice(i, i + 6);
    const got = await Promise.all(chunk.map(fetchImage));
    chunk.forEach((s, j) => images.set(s, got[j] ?? null));
  }
  const c: Ctx = { ...ctx, images, listInstance: 0 };

  const head: Block[] = [new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(meta.title || "Untitled")] })];
  if (meta.subtitle) head.push(new Paragraph({ children: [new TextRun({ text: meta.subtitle, italics: true, color: "52525B", size: 26 })] }));
  const line = [meta.date, meta.tags?.length ? meta.tags.map((t) => `#${t}`).join("  ") : null].filter(Boolean).join("   ·   ");
  if (line) head.push(new Paragraph({ children: [new TextRun({ text: line, color: "71717A", size: 20 })] }));
  for (const p of meta.properties ?? []) head.push(new Paragraph({ children: [new TextRun({ text: `${p.name}: `, bold: true, color: "52525B", size: 20 }), new TextRun({ text: p.value, size: 20 })] }));
  const cover = meta.coverImage ? images.get(meta.coverImage) : null;
  if (cover) {
    const w = Math.min(MAX_IMAGE_WIDTH, cover.width);
    head.push(new Paragraph({ children: [new ImageRun({ type: cover.type, data: cover.data, transformation: { width: w, height: Math.round((cover.height * w) / cover.width) } })] }));
  }

  const document = new Document({
    title: meta.title || "Untitled",
    creator: "Portfolio CMS",
    styles: {
      default: { document: { run: { font: "Calibri", size: 22 }, paragraph: { spacing: { after: 120, line: 300 } } } },
      paragraphStyles: [],
    },
    numbering: {
      config: [
        {
          reference: "ordered",
          levels: Array.from({ length: 9 }, (_, level) => ({
            level,
            format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][level % 3],
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
          })),
        },
      ],
    },
    sections: [{ children: [...head, ...blocks(doc?.content, c)] }],
  });
  return Packer.toBuffer(document);
}
