"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ForwardRefExoticComponent, type RefAttributes } from "react";
import { Extension, type Editor, type Range } from "@tiptap/core";
import { ReactRenderer } from "@tiptap/react";
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion";
import { computePosition, flip, offset, shift } from "@floating-ui/dom";
import { ChevronRight, Code2, Link2, Heading1, Heading2, Heading3, Heading4, ImagePlus, List, ListChecks, ListOrdered, MessageSquareWarning, Minus, Music, Paperclip, Sigma, SquareRadical, Pilcrow, Quote, Table, Video, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { editMath } from "./math";
import { requestLinkCard } from "./link-card-dialog";

/** The "/" command menu: type "/" in the editor to insert a block. */

/** Fired by "/image", "/video", "/audio" and "/file"; EntryEditor opens the matching picker / dialog. */
export const PICK_IMAGE_EVENT = "notebook:pick-image";
export const PICK_VIDEO_EVENT = "notebook:pick-video";
export const PICK_AUDIO_EVENT = "notebook:pick-audio";
export const PICK_FILE_EVENT = "notebook:pick-file";

export interface SlashItem {
  title: string;
  description: string;
  icon: LucideIcon;
  keywords: string[];
  run: (editor: Editor, range: Range) => void;
}

export const SLASH_ITEMS: SlashItem[] = [
  { title: "Text", description: "Plain paragraph", icon: Pilcrow, keywords: ["paragraph", "p"], run: (e, r) => e.chain().focus().deleteRange(r).setParagraph().run() },
  { title: "Heading 1", description: "Large section heading", icon: Heading1, keywords: ["h1", "title"], run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 1 }).run() },
  { title: "Heading 2", description: "Medium section heading", icon: Heading2, keywords: ["h2", "subtitle"], run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 2 }).run() },
  { title: "Heading 3", description: "Small section heading", icon: Heading3, keywords: ["h3"], run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 3 }).run() },
  { title: "Heading 4", description: "Minor heading", icon: Heading4, keywords: ["h4"], run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 4 }).run() },
  { title: "Bullet list", description: "Unordered list", icon: List, keywords: ["ul", "unordered", "points"], run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
  { title: "Numbered list", description: "Ordered list", icon: ListOrdered, keywords: ["ol", "ordered", "1."], run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
  { title: "Checklist", description: "List with tick boxes", icon: ListChecks, keywords: ["todo", "task", "checkbox", "[]"], run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run() },
  { title: "Quote", description: "Highlighted quotation", icon: Quote, keywords: ["blockquote", "cite"], run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run() },
  { title: "Callout", description: "Note, tip, warning or danger box", icon: MessageSquareWarning, keywords: ["note", "tip", "warning", "info", "alert", "admonition"], run: (e, r) => e.chain().focus().deleteRange(r).setCallout("note").run() },
  {
    title: "Toggle",
    description: "Collapsible section",
    icon: ChevronRight,
    keywords: ["details", "collapse", "accordion", "spoiler", "fold"],
    run: (e, r) => {
      e.chain().focus().deleteRange(r).setDetails().run();
      openDetailsAtSelection(e);
    },
  },
  {
    title: "Equation",
    description: "LaTeX block, e.g. E = mc^2",
    icon: Sigma,
    keywords: ["math", "latex", "formula", "katex", "tex"],
    run: (e, r) => {
      e.chain().focus().deleteRange(r).run();
      editMath({ kind: "block", pos: null, latex: "" });
    },
  },
  {
    title: "Inline equation",
    description: "Math inside a sentence (or type $$x^2$$)",
    icon: SquareRadical,
    keywords: ["math", "latex", "formula", "inline"],
    run: (e, r) => {
      e.chain().focus().deleteRange(r).run();
      editMath({ kind: "inline", pos: null, latex: "" });
    },
  },
  { title: "Code block", description: "Code with syntax highlighting", icon: Code2, keywords: ["code", "snippet", "pre"], run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run() },
  {
    title: "Table",
    description: "3 × 3 table with header row",
    icon: Table,
    keywords: ["grid", "columns", "rows"],
    run: (e, r) => e.chain().focus().deleteRange(r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    title: "Image",
    description: "Upload a picture (or paste / drop one)",
    icon: ImagePlus,
    keywords: ["img", "picture", "photo", "upload", "screenshot"],
    run: (e, r) => {
      e.chain().focus().deleteRange(r).run();
      // The editor page owns the file picker; ask it to open.
      window.dispatchEvent(new CustomEvent(PICK_IMAGE_EVENT));
    },
  },
  {
    title: "Video",
    description: "YouTube / Vimeo link or an MP4 / WebM file",
    icon: Video,
    keywords: ["youtube", "vimeo", "movie", "mp4", "embed"],
    run: (e, r) => {
      e.chain().focus().deleteRange(r).run();
      window.dispatchEvent(new CustomEvent(PICK_VIDEO_EVENT));
    },
  },
  {
    title: "Audio",
    description: "Upload an MP3, M4A, WAV or OGG file",
    icon: Music,
    keywords: ["sound", "music", "podcast", "mp3", "voice", "recording"],
    run: (e, r) => {
      e.chain().focus().deleteRange(r).run();
      window.dispatchEvent(new CustomEvent(PICK_AUDIO_EVENT));
    },
  },
  {
    title: "Link card",
    description: "Preview of a page — GitHub, website, article",
    icon: Link2,
    keywords: ["embed", "bookmark", "link", "preview", "github", "website", "card", "url"],
    run: (e, r) => {
      e.chain().focus().deleteRange(r).run();
      requestLinkCard({ url: "" });
    },
  },
  {
    title: "File",
    description: "Attach a PDF, ZIP, document… (download card)",
    icon: Paperclip,
    keywords: ["attachment", "pdf", "upload", "download", "document"],
    run: (e, r) => {
      e.chain().focus().deleteRange(r).run();
      window.dispatchEvent(new CustomEvent(PICK_FILE_EVENT));
    },
  },
  { title: "Divider", description: "Horizontal line", icon: Minus, keywords: ["hr", "line", "separator"], run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
];

/** A new toggle starts open, so Enter in its title moves into the content. */
function openDetailsAtSelection(editor: Editor) {
  const { $from } = editor.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name !== "details") continue;
    const dom = editor.view.nodeDOM($from.before(d)) as HTMLElement | null;
    if (dom && !dom.classList.contains("is-open")) dom.querySelector<HTMLButtonElement>(":scope > button")?.click();
    return;
  }
}

export function filterSlashItems(query: string): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_ITEMS;
  return SLASH_ITEMS.filter((i) => i.title.toLowerCase().includes(q) || i.keywords.some((k) => k.startsWith(q)));
}

export interface MenuHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

const SlashMenuList = forwardRef<MenuHandle, SuggestionProps<SlashItem>>(function SlashMenuList({ items, command }, ref) {
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset the highlight when the filtered list changes.
  useEffect(() => setSelected(0), [items]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  useImperativeHandle(ref, () => ({
    onKeyDown: (event) => {
      if (!items.length) return false;
      if (event.key === "ArrowDown") {
        setSelected((s) => (s + 1) % items.length);
        return true;
      }
      if (event.key === "ArrowUp") {
        setSelected((s) => (s - 1 + items.length) % items.length);
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const item = items[selected];
        if (item) command(item);
        return true;
      }
      return false;
    },
  }));

  return (
    <div ref={listRef} role="listbox" aria-label="Insert block" className="max-h-80 w-72 overflow-y-auto rounded-xl border bg-surface p-1 shadow-pop">
      {items.length === 0 ? (
        <p className="px-3 py-2 text-[13px] text-muted-foreground">No matching blocks</p>
      ) : (
        items.map((item, i) => (
          <button
            key={item.title}
            type="button"
            role="option"
            aria-selected={i === selected}
            data-index={i}
            onMouseEnter={() => setSelected(i)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => command(item)}
            className={cn("flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left", i === selected && "bg-muted")}
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-background">
              <item.icon className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-medium">{item.title}</span>
              <span className="block truncate text-xs text-muted-foreground">{item.description}</span>
            </span>
          </button>
        ))
      )}
    </div>
  );
});

/** Floating popup for a Suggestion list (the "/" menu, the "[[" link picker). */
export function suggestionPopup<T>(Component: ForwardRefExoticComponent<SuggestionProps<T> & RefAttributes<MenuHandle>>) {
  let renderer: ReactRenderer<MenuHandle, SuggestionProps<T>> | null = null;

  const place = (props: SuggestionProps<T>) => {
    const el = renderer?.element as HTMLElement | undefined;
    const rect = props.clientRect?.();
    if (!el || !rect) return;
    computePosition({ getBoundingClientRect: () => rect }, el, {
      placement: "bottom-start",
      strategy: "fixed",
      middleware: [offset(6), flip(), shift({ padding: 8 })],
    }).then(({ x, y }) => Object.assign(el.style, { left: `${x}px`, top: `${y}px` }));
  };

  return {
    onStart: (props: SuggestionProps<T>) => {
      renderer = new ReactRenderer(Component, { props, editor: props.editor });
      const el = renderer.element as HTMLElement;
      Object.assign(el.style, { position: "fixed", zIndex: "50", left: "0px", top: "0px" });
      document.body.appendChild(el);
      place(props);
    },
    onUpdate: (props: SuggestionProps<T>) => {
      renderer?.updateProps(props);
      place(props);
    },
    onKeyDown: ({ event }: SuggestionKeyDownProps) => {
      if (event.key === "Escape") {
        renderer?.destroy();
        renderer?.element.remove();
        renderer = null;
        return true;
      }
      return renderer?.ref?.onKeyDown(event) ?? false;
    },
    onExit: () => {
      renderer?.element.remove();
      renderer?.destroy();
      renderer = null;
    },
  };
}

export const SlashCommand = Extension.create({
  name: "slashCommand",
  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem>({
        editor: this.editor,
        char: "/",
        allowSpaces: false,
        // No "/" menu inside code blocks, where "/" is just a character.
        allow: ({ state, range }) => state.doc.resolve(range.from).parent.type.name !== "codeBlock",
        items: ({ query }) => filterSlashItems(query),
        command: ({ editor, range, props }) => props.run(editor, range),
        render: () => suggestionPopup(SlashMenuList),
      }),
    ];
  },
});
