"use client";

/* eslint-disable @next/next/no-img-element -- video thumbnails from YouTube */
import { Extension, Mark, Node, mergeAttributes } from "@tiptap/core";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import { AlertTriangle, FileText, Globe, Info, Lightbulb, Music, OctagonAlert, Play, Trash2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ALIGNMENTS, CALLOUT_VARIANTS, HIGHLIGHT_COLORS, type CalloutVariant, TEXT_COLORS, embedSrc, parseVideoUrl, type TextColor, type VideoProvider } from "@/lib/editor-shared";

/*
 * Rich blocks and marks for the Notebook editor. Everything renders to plain,
 * sanitiser-friendly HTML using data-* attributes (no inline styles), so the
 * server allowlist (services/notebook-html.ts) can validate every value.
 */

// ── Colours: named, theme-aware (see globals.css) ──────────────────────────

export { TEXT_COLORS, HIGHLIGHT_COLORS, parseVideoUrl, embedSrc } from "@/lib/editor-shared";
export type { TextColor, HighlightColor, VideoProvider } from "@/lib/editor-shared";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    textColor: {
      setTextColor: (color: TextColor) => ReturnType;
      unsetTextColor: () => ReturnType;
    };
  }
}

/** Text colour mark: <span data-text-color="red">…</span>. */
export const TextColorMark = Mark.create({
  name: "textColor",
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (el: HTMLElement) => {
          const c = el.getAttribute("data-text-color");
          return (TEXT_COLORS as readonly string[]).includes(c ?? "") ? c : null;
        },
        renderHTML: (attrs: { color?: string | null }) => (attrs.color ? { "data-text-color": attrs.color } : {}),
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-text-color]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0];
  },
  addCommands() {
    return {
      setTextColor:
        (color) =>
        ({ commands }) =>
          commands.setMark(this.name, { color }),
      unsetTextColor:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});

/** Highlight with a named colour: <mark data-color="yellow">…</mark>. */
export const NamedHighlight = Highlight.extend({
  addAttributes() {
    return {
      color: {
        default: "yellow",
        parseHTML: (el: HTMLElement) => {
          const c = el.getAttribute("data-color");
          return (HIGHLIGHT_COLORS as readonly string[]).includes(c ?? "") ? c : "yellow";
        },
        renderHTML: (attrs: { color?: string | null }) => ({ "data-color": attrs.color ?? "yellow" }),
      },
    };
  },
}).configure({ multicolor: true });

// ── Text alignment: data-align="center" (no inline style) ──────────────────

export const DataTextAlign = TextAlign.extend({
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          textAlign: {
            default: null,
            parseHTML: (el: HTMLElement) => {
              const v = el.getAttribute("data-align") ?? el.style.textAlign;
              return (ALIGNMENTS as readonly string[]).includes(v) && v !== "left" ? v : null;
            },
            renderHTML: (attrs: { textAlign?: string | null }) => (attrs.textAlign && attrs.textAlign !== "left" ? { "data-align": attrs.textAlign } : {}),
          },
        },
      },
    ];
  },
}).configure({ types: ["heading", "paragraph"], alignments: [...ALIGNMENTS], defaultAlignment: null });

// ── Callouts ──────────────────────────────────────────────────────────────

export const CALLOUT_META: Record<CalloutVariant, { label: string; icon: LucideIcon }> = {
  note: { label: "Note", icon: Info },
  tip: { label: "Tip", icon: Lightbulb },
  warning: { label: "Warning", icon: AlertTriangle },
  danger: { label: "Danger", icon: OctagonAlert },
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    callout: { setCallout: (variant?: CalloutVariant) => ReturnType };
  }
}

export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return {
      variant: {
        default: "note",
        parseHTML: (el: HTMLElement) => {
          const v = el.getAttribute("data-callout") ?? "";
          return (CALLOUT_VARIANTS as readonly string[]).includes(v) ? v : "note";
        },
        renderHTML: (attrs: { variant?: string }) => ({ "data-callout": attrs.variant ?? "note" }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "aside[data-callout]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["aside", mergeAttributes(HTMLAttributes), 0];
  },
  addCommands() {
    return {
      setCallout:
        (variant = "note") =>
        ({ commands }) =>
          commands.wrapIn(this.name, { variant }),
    };
  },
  addKeyboardShortcuts() {
    return {
      // Enter on an empty last line leaves the callout (like lists).
      Enter: ({ editor }) => {
        const { $from, empty } = editor.state.selection;
        if (!empty || $from.depth < 2) return false;
        const wrapper = $from.node(-1);
        const isLastEmpty = $from.parent.type.name === "paragraph" && $from.parent.content.size === 0 && $from.index(-1) === wrapper.childCount - 1;
        if (wrapper.type.name !== this.name || !isLastEmpty || wrapper.childCount < 2) return false;
        return editor.commands.lift("paragraph");
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(CalloutView);
  },
});

function CalloutView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const variant = node.attrs.variant as CalloutVariant;
  const Icon = CALLOUT_META[variant].icon;
  return (
    <NodeViewWrapper as="aside" data-callout={variant} className="notebook-callout group/callout">
      <span contentEditable={false} className="callout-icon" aria-hidden>
        <Icon className="size-4" />
      </span>
      {editor.isEditable && (
        <select
          contentEditable={false}
          value={variant}
          onChange={(e) => updateAttributes({ variant: e.target.value })}
          aria-label="Callout type"
          className="absolute top-2 right-2 rounded-md border bg-surface px-1.5 py-0.5 text-[11px] text-muted-foreground opacity-0 transition-opacity group-focus-within/callout:opacity-100 group-hover/callout:opacity-100 focus:opacity-100"
        >
          {CALLOUT_VARIANTS.map((v) => (
            <option key={v} value={v}>
              {CALLOUT_META[v].label}
            </option>
          ))}
        </select>
      )}
      <NodeViewContent className="callout-body" />
    </NodeViewWrapper>
  );
}

// ── Toggles ───────────────────────────────────────────────────────────────

/**
 * Enter in a toggle's title goes into its (empty) first line and opens it.
 * The extension's default adds a second empty line instead, which then
 * stops "Enter on an empty last line" from leaving the toggle.
 */
export const DetailsTitleEnter = Extension.create({
  name: "detailsTitleEnter",
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { $head, empty } = editor.state.selection;
        if (!empty || $head.parent.type.name !== "detailsSummary") return false;
        const contentPos = $head.after();
        const content = editor.state.doc.nodeAt(contentPos);
        const first = content?.firstChild;
        if (content?.type.name !== "detailsContent" || first?.type.name !== "paragraph" || first.content.size > 0) return false;
        const dom = editor.view.nodeDOM($head.before(-1)) as HTMLElement | null;
        if (dom && !dom.classList.contains("is-open")) dom.querySelector<HTMLButtonElement>(":scope > button")?.click();
        return editor.commands.setTextSelection(contentPos + 2);
      },
    };
  },
});

// ── Video embeds (YouTube / Vimeo) ────────────────────────────────────────


declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    videoEmbed: { insertVideoEmbed: (attrs: { provider: VideoProvider; id: string }) => ReturnType };
    videoFile: { insertVideoFile: (attrs: { src: string; caption?: string | null }) => ReturnType };
    audioFile: { insertAudioFile: (attrs: { src: string; caption?: string | null }) => ReturnType };
    attachment: { insertAttachment: (attrs: { href: string; name: string; size: number; mime: string }) => ReturnType };
  }
}

export const VideoEmbed = Node.create({
  name: "videoEmbed",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { provider: { default: "youtube" }, id: { default: null } };
  },
  parseHTML() {
    return [
      {
        tag: "div[data-video-embed]",
        getAttrs: (el: HTMLElement) => {
          const src = el.querySelector("iframe")?.getAttribute("src") ?? "";
          const parsed = parseVideoUrl(src);
          return parsed ? { provider: parsed.provider, id: parsed.id } : false;
        },
      },
    ];
  },
  renderHTML({ node }) {
    const provider = node.attrs.provider as VideoProvider;
    return [
      "div",
      { "data-video-embed": provider },
      [
        "iframe",
        {
          src: embedSrc(provider, node.attrs.id as string),
          title: provider === "youtube" ? "YouTube video" : "Vimeo video",
          allow: "accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen",
          allowfullscreen: "true",
          loading: "lazy",
          referrerpolicy: "strict-origin-when-cross-origin",
        },
      ],
    ];
  },
  addCommands() {
    return {
      insertVideoEmbed:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(VideoEmbedView);
  },
});

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label="Remove" title="Remove" className="absolute top-2 right-2 z-10 rounded-md bg-background/90 p-1.5 text-muted-foreground shadow-sm hover:text-destructive">
      <Trash2 className="size-4" />
    </button>
  );
}

function VideoEmbedView({ node, deleteNode, selected, editor }: ReactNodeViewProps) {
  const { provider, id } = node.attrs as { provider: VideoProvider; id: string };
  return (
    <NodeViewWrapper className={cn("notebook-block relative", selected && "is-selected")} data-drag-handle contentEditable={false}>
      <div className="relative aspect-video overflow-hidden rounded-lg border bg-muted">
        {provider === "youtube" && <img src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`} alt="" className="size-full object-cover" referrerPolicy="no-referrer" />}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/35 text-white">
          <span className="flex size-14 items-center justify-center rounded-full bg-white/90 text-black shadow">
            <Play className="size-6 translate-x-0.5" />
          </span>
          <span className="rounded bg-black/60 px-2 py-0.5 text-xs font-medium">{provider === "youtube" ? "YouTube" : "Vimeo"} video · plays on the published page</span>
        </div>
      </div>
      {editor.isEditable && selected && <RemoveButton onClick={() => deleteNode()} />}
    </NodeViewWrapper>
  );
}

// ── Uploaded video file ───────────────────────────────────────────────────

export const VideoFile = Node.create({
  name: "videoFile",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { src: { default: null }, caption: { default: null } };
  },
  parseHTML() {
    return [
      {
        tag: "figure[data-video]",
        getAttrs: (el: HTMLElement) => {
          const src = el.querySelector("video")?.getAttribute("src");
          return src ? { src, caption: el.querySelector("figcaption")?.textContent?.trim() || null } : false;
        },
      },
    ];
  },
  renderHTML({ node }) {
    const video = ["video", { src: node.attrs.src, controls: "true", preload: "metadata", playsinline: "true" }] as const;
    return node.attrs.caption ? ["figure", { "data-video": "" }, video, ["figcaption", {}, node.attrs.caption]] : ["figure", { "data-video": "" }, video];
  },
  addCommands() {
    return {
      insertVideoFile:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(VideoFileView);
  },
});

function VideoFileView({ node, updateAttributes, deleteNode, selected, editor }: ReactNodeViewProps) {
  const { src, caption } = node.attrs as { src: string; caption: string | null };
  return (
    <NodeViewWrapper as="figure" className={cn("notebook-block notebook-figure relative", selected && "is-selected")} data-drag-handle>
      <div contentEditable={false} className="relative">
        <video src={src} controls preload="metadata" playsInline className="w-full rounded-lg border bg-black" />
        {editor.isEditable && selected && <RemoveButton onClick={() => deleteNode()} />}
      </div>
      {editor.isEditable && selected ? (
        <input
          contentEditable={false}
          value={caption ?? ""}
          onChange={(e) => updateAttributes({ caption: e.target.value || null })}
          placeholder="Caption (optional)"
          aria-label="Video caption"
          className="mt-2 w-full rounded-md border bg-background px-2 py-1 text-[13px] outline-none focus:border-ring"
        />
      ) : (
        caption && <figcaption>{caption}</figcaption>
      )}
    </NodeViewWrapper>
  );
}

// ── Uploaded audio file ───────────────────────────────────────────────────

export const AudioFile = Node.create({
  name: "audioFile",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { src: { default: null }, caption: { default: null } };
  },
  parseHTML() {
    return [
      {
        tag: "figure[data-audio]",
        getAttrs: (el: HTMLElement) => {
          const src = el.querySelector("audio")?.getAttribute("src");
          return src ? { src, caption: el.querySelector("figcaption")?.textContent?.trim() || null } : false;
        },
      },
    ];
  },
  renderHTML({ node }) {
    const audio = ["audio", { src: node.attrs.src, controls: "true", preload: "metadata" }] as const;
    return node.attrs.caption ? ["figure", { "data-audio": "" }, audio, ["figcaption", {}, node.attrs.caption]] : ["figure", { "data-audio": "" }, audio];
  },
  addCommands() {
    return {
      insertAudioFile:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(AudioFileView);
  },
});

function AudioFileView({ node, updateAttributes, deleteNode, selected, editor }: ReactNodeViewProps) {
  const { src, caption } = node.attrs as { src: string; caption: string | null };
  return (
    <NodeViewWrapper as="figure" className={cn("notebook-block notebook-figure relative", selected && "is-selected")} data-drag-handle>
      <div contentEditable={false} className="relative flex items-center gap-3 rounded-lg border bg-surface p-3 pr-12">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <Music className="size-5" />
        </span>
        <audio src={src} controls preload="metadata" className="h-10 min-w-0 flex-1" />
        {editor.isEditable && selected && <RemoveButton onClick={() => deleteNode()} />}
      </div>
      {editor.isEditable && selected ? (
        <input
          contentEditable={false}
          value={caption ?? ""}
          onChange={(e) => updateAttributes({ caption: e.target.value || null })}
          placeholder="Caption (optional)"
          aria-label="Audio caption"
          className="mt-2 w-full rounded-md border bg-background px-2 py-1 text-[13px] outline-none focus:border-ring"
        />
      ) : (
        caption && <figcaption>{caption}</figcaption>
      )}
    </NodeViewWrapper>
  );
}

// ── Link preview card (bookmark) ──────────────────────────────────────────

export interface LinkCardAttrs {
  url: string;
  title: string;
  description: string | null;
  image: string | null;
  site: string;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    linkCard: { insertLinkCard: (attrs: LinkCardAttrs) => ReturnType };
  }
}

/** A clickable preview of a web page. Plain HTML — no third-party iframes or scripts. */
export const LinkCard = Node.create({
  name: "linkCard",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { url: { default: null }, title: { default: "" }, description: { default: null }, image: { default: null }, site: { default: "" } };
  },
  parseHTML() {
    return [
      {
        tag: "a[data-link-card]",
        getAttrs: (el: HTMLElement) => ({
          url: el.getAttribute("href"),
          title: el.querySelector(".card-title")?.textContent ?? "",
          description: el.querySelector(".card-desc")?.textContent || null,
          image: el.querySelector("img")?.getAttribute("src") || null,
          site: el.querySelector(".card-site")?.textContent ?? "",
        }),
      },
    ];
  },
  renderHTML({ node }) {
    const { url, title, description, image, site } = node.attrs as LinkCardAttrs;
    const text = ["span", { class: "card-text" }, ["span", { class: "card-title" }, title], ...(description ? [["span", { class: "card-desc" }, description]] : []), ["span", { class: "card-site" }, site]];
    return ["a", { href: url, "data-link-card": "" }, text, ...(image ? [["img", { src: image, alt: "" }]] : [])] as unknown as [string, Record<string, string>, ...unknown[]];
  },
  addCommands() {
    return {
      insertLinkCard:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(LinkCardView);
  },
});

function LinkCardView({ node, deleteNode, selected, editor }: ReactNodeViewProps) {
  const { url, title, description, image, site } = node.attrs as LinkCardAttrs;
  return (
    <NodeViewWrapper className={cn("notebook-block relative", selected && "is-selected")} data-drag-handle contentEditable={false}>
      <div className="link-card flex overflow-hidden rounded-lg border bg-surface" title={url}>
        <span className="min-w-0 flex-1 p-3">
          <span className="block truncate text-sm font-semibold">{title}</span>
          {description && <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{description}</span>}
          <span className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
            <Globe className="size-3" /> {site}
          </span>
        </span>
        {image && <img src={image} alt="" referrerPolicy="no-referrer" className="w-36 shrink-0 object-cover max-sm:hidden" />}
      </div>
      {editor.isEditable && selected && <RemoveButton onClick={() => deleteNode()} />}
    </NodeViewWrapper>
  );
}

// ── File attachment (download card) ───────────────────────────────────────

export function formatBytes(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function extOf(name: string) {
  return (name.split(".").pop() ?? "file").toUpperCase().slice(0, 5);
}

export const Attachment = Node.create({
  name: "attachment",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { href: { default: null }, name: { default: "file" }, size: { default: 0 }, mime: { default: "" } };
  },
  parseHTML() {
    return [
      {
        tag: "a[data-attachment]",
        getAttrs: (el: HTMLElement) => ({
          href: el.getAttribute("href"),
          name: el.querySelector(".attachment-name")?.textContent ?? el.getAttribute("download") ?? "file",
          size: Number(el.getAttribute("data-size") ?? 0),
          mime: el.getAttribute("data-mime") ?? "",
        }),
      },
    ];
  },
  renderHTML({ node }) {
    const { href, name, size, mime } = node.attrs as { href: string; name: string; size: number; mime: string };
    return [
      "a",
      { href, "data-attachment": "", "data-size": String(size), "data-mime": mime, download: name },
      ["span", { class: "attachment-name" }, name],
      ["span", { class: "attachment-meta" }, [extOf(name), formatBytes(size)].filter(Boolean).join(" · ")],
    ];
  },
  addCommands() {
    return {
      insertAttachment:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(AttachmentView);
  },
});

function AttachmentView({ node, deleteNode, selected, editor }: ReactNodeViewProps) {
  const { name, size } = node.attrs as { name: string; size: number };
  return (
    <NodeViewWrapper className={cn("notebook-block relative", selected && "is-selected")} data-drag-handle contentEditable={false}>
      <div className="flex items-center gap-3 rounded-lg border bg-surface p-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <FileText className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{name}</span>
          <span className="block text-xs text-muted-foreground">
            {extOf(name)} · {formatBytes(size)} · download
          </span>
        </span>
      </div>
      {editor.isEditable && selected && <RemoveButton onClick={() => deleteNode()} />}
    </NodeViewWrapper>
  );
}
