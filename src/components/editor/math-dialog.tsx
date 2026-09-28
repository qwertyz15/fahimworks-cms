"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import katex from "katex";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { KATEX_OPTIONS, MAX_LATEX } from "@/lib/editor-shared";
import { blockBoundary, insertBlock } from "./blocks";
import { MATH_EDIT_EVENT, type MathEditDetail } from "./math";

/** Write or edit a LaTeX equation, with a live preview. */
export function MathDialog({ editor }: { editor: Editor | null }) {
  const [target, setTarget] = useState<MathEditDetail | null>(null);
  const [latex, setLatex] = useState("");
  /** Editor command to run once the dialog has closed (see Dialog's afterClose). */
  const pending = useRef<(() => void) | null>(null);

  useEffect(() => {
    const open = (e: Event) => {
      const d = (e as CustomEvent<MathEditDetail>).detail;
      setTarget(d);
      setLatex(d.latex);
    };
    window.addEventListener(MATH_EDIT_EVENT, open);
    return () => window.removeEventListener(MATH_EDIT_EVENT, open);
  }, []);

  const display = target?.kind === "block";
  const preview = useMemo(() => {
    if (!latex.trim()) return { html: "", error: null as string | null };
    try {
      return { html: katex.renderToString(latex, { ...KATEX_OPTIONS, displayMode: display }), error: null };
    } catch (err) {
      return { html: "", error: err instanceof Error ? err.message.replace(/^KaTeX parse error: /, "") : "Invalid LaTeX" };
    }
  }, [latex, display]);

  const close = () => setTarget(null);

  const save = () => {
    if (!editor || !target) return close();
    const value = latex.trim().slice(0, MAX_LATEX);
    const inline = target.kind === "inline";
    const pos = target.pos;
    pending.current = () => {
      if (pos !== null) {
        if (!value) editor.chain().focus()[inline ? "deleteInlineMath" : "deleteBlockMath"]({ pos }).run();
        else editor.chain().focus()[inline ? "updateInlineMath" : "updateBlockMath"]({ latex: value, pos }).run();
      } else if (value) {
        if (inline) editor.chain().focus().insertInlineMath({ latex: value }).run();
        else insertBlock(editor, blockBoundary(editor.state.doc, editor.state.selection.from), { type: "blockMath", attrs: { latex: value } });
      } else editor.commands.focus();
    };
    close();
  };

  const editing = target?.pos !== null && target !== null;
  return (
    <Dialog
      open={target !== null}
      onClose={close}
      afterClose={() => {
        const run = pending.current;
        pending.current = null;
        run?.();
      }}
      title={`${editing ? "Edit" : "Add"} ${target?.kind === "inline" ? "inline equation" : "equation"}`}
      description="Write LaTeX, e.g. \frac{a}{b}, x^2, \sum_{i=1}^{n} x_i"
      footer={
        <>
          {editing && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const t = target;
                pending.current = () => {
                  if (editor && t?.pos != null) editor.chain().focus()[t.kind === "inline" ? "deleteInlineMath" : "deleteBlockMath"]({ pos: t.pos }).run();
                };
                close();
              }}
            >
              Remove
            </Button>
          )}
          <Button size="sm" onClick={save} disabled={Boolean(preview.error)}>
            {editing ? "Update" : "Insert"}
          </Button>
        </>
      }
    >
      <Textarea
        value={latex}
        onChange={(e) => setLatex(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (!preview.error) save();
          }
        }}
        maxLength={MAX_LATEX}
        rows={3}
        spellCheck={false}
        placeholder="E = mc^2"
        aria-label="LaTeX"
        className="font-mono text-sm"
        autoFocus
      />
      <div className="mt-3 min-h-14 rounded-lg border bg-background px-3 py-3 text-center" aria-live="polite" data-testid="math-preview">
        {preview.error ? (
          <p className="text-left text-xs text-destructive">{preview.error}</p>
        ) : preview.html ? (
          <div className="overflow-x-auto text-lg" dangerouslySetInnerHTML={{ __html: preview.html }} />
        ) : (
          <p className="text-xs text-muted-foreground">Preview appears here</p>
        )}
      </div>
    </Dialog>
  );
}
