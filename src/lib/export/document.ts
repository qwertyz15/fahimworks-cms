/**
 * Shared types for exporting a Notebook entry or a database page: the stored
 * editor document (Tiptap JSON) plus what goes above it.
 */

export interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
}

export interface ExportMeta {
  title: string;
  subtitle?: string | null;
  /** YYYY-MM-DD */
  date?: string | null;
  tags?: string[];
  coverImage?: string | null;
  /** Database page properties, already as display text. */
  properties?: { name: string; value: string }[];
}

export interface ExportContext {
  /** URL for a [[note link]] target (its published article), or null. */
  linkFor: (id: string) => string | null;
}

export const EXPORT_FORMATS = ["md", "docx", "html"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** A safe file name from a title. */
export function fileNameFor(title: string, ext: string) {
  const base =
    title
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "untitled";
  return `${base}.${ext}`;
}

export const str = (v: unknown) => (typeof v === "string" ? v : "");

export const CALLOUT_LABELS: Record<string, string> = { note: "Note", tip: "Tip", warning: "Warning", danger: "Danger" };

export const videoUrl = (provider: string, id: string) => (provider === "vimeo" ? `https://vimeo.com/${id}` : `https://www.youtube.com/watch?v=${id}`);

/** Only http(s) and mailto links survive an export. */
export function safeHref(v: unknown): string | null {
  const s = str(v).trim();
  return /^(https?:|mailto:)/i.test(s) ? s : null;
}

/** Board columns as stored on the node. */
export function boardColumns(node: DocNode): { title: string; cards: { text: string; label?: string | null }[] }[] {
  const cols = Array.isArray(node.attrs?.columns) ? (node.attrs!.columns as unknown[]) : [];
  return cols
    .filter((c): c is { title?: unknown; cards?: unknown } => !!c && typeof c === "object")
    .map((c) => ({
      title: str(c.title) || "Untitled",
      cards: (Array.isArray(c.cards) ? c.cards : [])
        .filter((k): k is { text?: unknown; label?: unknown } => !!k && typeof k === "object")
        .map((k) => ({ text: str(k.text), label: typeof k.label === "string" ? k.label : null })),
    }));
}

/** Plain text of a node (table cells, summaries). */
export function textOf(node: DocNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  if (node.type === "inlineMath") return str(node.attrs?.latex);
  if (node.type === "noteLink") return str(node.attrs?.label);
  return (node.content ?? []).map(textOf).join(node.type === "tableCell" || node.type === "tableHeader" ? " " : "");
}
