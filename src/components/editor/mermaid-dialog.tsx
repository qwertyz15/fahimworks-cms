"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { MERMAID_MAX } from "@/lib/editor-shared";
import { blockBoundary, insertBlock } from "./blocks";
import { MERMAID_EDIT_EVENT, useMermaidSvg, type MermaidEditDetail } from "./mermaid";

const TEMPLATES: { label: string; source: string }[] = [
  { label: "Flowchart", source: "flowchart TD\n  A[Idea] --> B{Worth writing?}\n  B -- Yes --> C[Draft]\n  B -- No --> D[Archive]\n  C --> E[Publish]" },
  { label: "Sequence", source: "sequenceDiagram\n  participant U as User\n  participant A as App\n  participant DB as Database\n  U->>A: Request\n  A->>DB: Query\n  DB-->>A: Rows\n  A-->>U: Response" },
  { label: "Class", source: "classDiagram\n  class Agent {\n    +plan()\n    +act()\n  }\n  class Tool {\n    +run()\n  }\n  Agent --> Tool : uses" },
  { label: "Gantt", source: "gantt\n  title Project plan\n  dateFormat YYYY-MM-DD\n  section Build\n  Design  :a1, 2026-10-01, 5d\n  Develop :after a1, 10d\n  section Ship\n  Launch  :2026-10-20, 2d" },
  { label: "Mind map", source: "mindmap\n  root((AI Systems))\n    Agents\n      Planning\n      Tools\n    RAG\n      Retrieval\n      Ranking" },
  { label: "Pie", source: 'pie title Time spent\n  "Writing" : 45\n  "Coding" : 35\n  "Reading" : 20' },
];

/** Write or edit a Mermaid diagram, with templates and a live preview. */
export function MermaidDialog({ editor }: { editor: Editor | null }) {
  const [target, setTarget] = useState<MermaidEditDetail | null>(null);
  const [source, setSource] = useState("");
  const pending = useRef<(() => void) | null>(null);
  const preview = useMermaidSvg(target ? source : "", 250);

  useEffect(() => {
    const open = (e: Event) => {
      const d = (e as CustomEvent<MermaidEditDetail>).detail;
      setTarget(d);
      setSource(d.source || TEMPLATES[0]!.source);
    };
    window.addEventListener(MERMAID_EDIT_EVENT, open);
    return () => window.removeEventListener(MERMAID_EDIT_EVENT, open);
  }, []);

  const close = () => setTarget(null);
  const editing = target !== null && target.pos !== null;
  const invalid = !source.trim() || Boolean(preview?.error);

  const save = () => {
    if (!editor || !target || invalid) return;
    const value = source.slice(0, MERMAID_MAX);
    const pos = target.pos;
    pending.current = () => {
      if (pos !== null) {
        editor
          .chain()
          .focus()
          .command(({ tr }) => {
            if (tr.doc.nodeAt(pos)?.type.name !== "mermaidDiagram") return false;
            tr.setNodeMarkup(pos, undefined, { source: value });
            return true;
          })
          .run();
      } else {
        insertBlock(editor, blockBoundary(editor.state.doc, editor.state.selection.from), { type: "mermaidDiagram", attrs: { source: value } });
      }
    };
    close();
  };

  return (
    <Dialog
      open={target !== null}
      onClose={close}
      afterClose={() => {
        const run = pending.current;
        pending.current = null;
        if (run) run();
        else editor?.commands.focus();
      }}
      className="max-w-3xl"
      title={editing ? "Edit diagram" : "Add a diagram"}
      description="Write Mermaid — flowcharts, sequence, class, Gantt, mind maps, pie charts…"
      footer={
        <>
          {editing && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const pos = target!.pos!;
                pending.current = () => {
                  editor
                    ?.chain()
                    .focus()
                    .command(({ tr }) => {
                      const n = tr.doc.nodeAt(pos);
                      if (n?.type.name !== "mermaidDiagram") return false;
                      tr.delete(pos, pos + n.nodeSize);
                      return true;
                    })
                    .run();
                };
                close();
              }}
            >
              Remove
            </Button>
          )}
          <Button size="sm" onClick={save} disabled={invalid}>
            {editing ? "Update" : "Insert"}
          </Button>
        </>
      }
    >
      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Templates">
        {TEMPLATES.map((t) => (
          <button
            key={t.label}
            type="button"
            onClick={() => setSource(t.source)}
            className={cn("rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground", source === t.source && "border-primary text-foreground")}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Textarea
          value={source}
          onChange={(e) => setSource(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              save();
            }
          }}
          maxLength={MERMAID_MAX}
          rows={12}
          spellCheck={false}
          aria-label="Mermaid code"
          className="font-mono text-[13px] leading-relaxed"
          autoFocus
        />
        <div className="flex min-h-48 items-center justify-center overflow-auto rounded-lg border bg-background p-3" aria-live="polite" data-testid="mermaid-preview">
          {preview?.error ? (
            <p className="flex items-start gap-2 self-start text-xs text-destructive">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> {preview.error}
            </p>
          ) : preview?.svg ? (
            <div className="mermaid-svg w-full" dangerouslySetInnerHTML={{ __html: preview.svg }} />
          ) : (
            <p className="text-xs text-muted-foreground">Preview appears here</p>
          )}
        </div>
      </div>
    </Dialog>
  );
}
