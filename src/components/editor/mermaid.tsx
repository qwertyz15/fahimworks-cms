"use client";

import { useEffect, useState } from "react";
import { Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import { AlertCircle, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { MERMAID_MAX } from "@/lib/editor-shared";
import { renderMermaid, useDarkTheme } from "@/lib/mermaid-client";

/**
 * Mermaid diagram. Stored as <pre data-mermaid><code>source</code></pre> —
 * only the source; the SVG is drawn in the browser (editor preview, article).
 * "/diagram" or clicking one fires MERMAID_EDIT_EVENT → MermaidDialog.
 */
export const MERMAID_EDIT_EVENT = "notebook:edit-mermaid";

export interface MermaidEditDetail {
  /** Position of the existing node, or null to insert a new one. */
  pos: number | null;
  source: string;
}

export const editMermaid = (detail: MermaidEditDetail) => window.dispatchEvent(new CustomEvent<MermaidEditDetail>(MERMAID_EDIT_EVENT, { detail }));

/** Live SVG for a source string (null while rendering). */
export function useMermaidSvg(source: string, delayMs = 0) {
  const dark = useDarkTheme();
  const [result, setResult] = useState<{ svg?: string; error?: string } | null>(null);
  useEffect(() => {
    if (!source.trim()) return;
    let cancelled = false;
    const t = setTimeout(() => {
      void renderMermaid(source, dark).then((r) => !cancelled && setResult(r));
    }, delayMs);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [source, dark, delayMs]);
  return source.trim() ? result : null;
}

export const MermaidDiagram = Node.create({
  name: "mermaidDiagram",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { source: { default: "" } };
  },
  parseHTML() {
    // Rule priority (not extension priority, which would make this the schema's
    // default block): match before the code block, which also parses <pre>.
    return [{ tag: "pre[data-mermaid]", priority: 100, getAttrs: (el: HTMLElement) => ({ source: (el.textContent ?? "").slice(0, MERMAID_MAX) }) }];
  },
  renderHTML({ node }) {
    return ["pre", { "data-mermaid": "" }, ["code", {}, node.attrs.source as string]];
  },
  addNodeView() {
    return ReactNodeViewRenderer(MermaidView);
  },
});

function MermaidView({ node, getPos, deleteNode, selected, editor }: ReactNodeViewProps) {
  const source = node.attrs.source as string;
  const result = useMermaidSvg(source);
  const open = () => {
    const pos = getPos();
    if (editor.isEditable && typeof pos === "number") editMermaid({ pos, source });
  };
  return (
    <NodeViewWrapper className={cn("notebook-block relative", selected && "is-selected")} data-drag-handle contentEditable={false}>
      <div
        role="button"
        tabIndex={0}
        onClick={open}
        onKeyDown={(e) => e.key === "Enter" && open()}
        title="Click to edit the diagram"
        aria-label="Mermaid diagram — click to edit"
        className="mermaid-block cursor-pointer overflow-x-auto rounded-lg border bg-surface p-4 hover:border-primary/40"
      >
        {result?.error ? (
          <p className="flex items-start gap-2 text-left text-xs text-destructive">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> {result.error}
          </p>
        ) : result?.svg ? (
          <div className="mermaid-svg" dangerouslySetInnerHTML={{ __html: result.svg }} />
        ) : (
          <div className="h-24 animate-pulse rounded bg-muted/60" aria-hidden />
        )}
      </div>
      {editor.isEditable && selected && (
        <button type="button" onClick={() => deleteNode()} aria-label="Remove" title="Remove" className="absolute top-2 right-2 z-10 rounded-md bg-background/90 p-1.5 text-muted-foreground shadow-sm hover:text-destructive">
          <Trash2 className="size-4" />
        </button>
      )}
    </NodeViewWrapper>
  );
}
