"use client";

/* eslint-disable @next/next/no-img-element -- images from the media bucket */
import Image from "@tiptap/extension-image";
import { mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Image block rendered as <figure><img><figcaption></figure>, with editable
 * alt text and caption. Parses both <figure> and bare <img> (pasted HTML).
 */
export const Figure = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      caption: {
        default: null,
        parseHTML: (el: HTMLElement) => el.querySelector("figcaption")?.textContent?.trim() || null,
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "figure",
        getAttrs: (el: HTMLElement) => {
          const img = el.querySelector("img");
          if (!img?.getAttribute("src")) return false;
          return {
            src: img.getAttribute("src"),
            alt: img.getAttribute("alt"),
            title: img.getAttribute("title"),
            caption: el.querySelector("figcaption")?.textContent?.trim() || null,
          };
        },
      },
      { tag: "img[src]" },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    const img = ["img", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)] as const;
    const caption = node.attrs.caption as string | null;
    return caption ? ["figure", {}, img, ["figcaption", {}, caption]] : ["figure", {}, img];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FigureView);
  },
}).configure({ inline: false, allowBase64: false });

function FigureView({ node, updateAttributes, deleteNode, selected, editor }: ReactNodeViewProps) {
  const { src, alt, caption } = node.attrs as { src: string; alt: string | null; caption: string | null };
  const editable = editor.isEditable;
  return (
    <NodeViewWrapper as="figure" className={cn("notebook-figure", selected && "is-selected")} data-drag-handle>
      <img src={src} alt={alt ?? ""} draggable={false} className="rounded-lg" />
      {editable && selected ? (
        <div className="mt-2 space-y-2 rounded-lg border bg-surface p-2.5 text-sm" contentEditable={false}>
          <input
            value={caption ?? ""}
            onChange={(e) => updateAttributes({ caption: e.target.value || null })}
            placeholder="Caption (optional, shown under the image)"
            aria-label="Image caption"
            className="w-full rounded-md border bg-background px-2 py-1 text-[13px] outline-none focus:border-ring"
          />
          <div className="flex items-center gap-2">
            <input
              value={alt ?? ""}
              onChange={(e) => updateAttributes({ alt: e.target.value || null })}
              placeholder="Alt text — describe the image for screen readers"
              aria-label="Image alt text"
              className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1 text-[13px] outline-none focus:border-ring"
            />
            <button type="button" onClick={() => deleteNode()} aria-label="Remove image" title="Remove image" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive">
              <Trash2 className="size-4" />
            </button>
          </div>
        </div>
      ) : (
        caption && <figcaption>{caption}</figcaption>
      )}
    </NodeViewWrapper>
  );
}
