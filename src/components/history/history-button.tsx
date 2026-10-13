"use client";

import { useEffect, useMemo, useState } from "react";
import { History, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { diffText } from "@/lib/revisions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { getRevisionAction, listRevisionsAction, restoreRevisionAction } from "@/server/actions/history";
import type { RevisionSummary } from "@/server/services/revisions";

type Detail = { id: string; title: string; contentHtml: string | null; text: string; savedAt: string };

const REASONS: Record<string, string> = { auto: "Autosaved", save: "Saved", publish: "Published", restore: "Restored" };
const dayFmt = new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" });

/**
 * Version history for a Notebook entry or a database page. `prepare` saves
 * pending edits first (so the newest version is what's on screen) and returns
 * the id (null: nothing saved yet).
 */
export function HistoryButton({ kind, prepare }: { kind: "notebook" | "page"; prepare: () => Promise<string | null> }) {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState<string | null>(null);
  const [list, setList] = useState<RevisionSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, Detail>>({});
  const [mode, setMode] = useState<"changes" | "preview">("changes");
  const [restoring, setRestoring] = useState(false);

  const show = async () => {
    const target = await prepare();
    if (!target) return void toast.error("Nothing saved yet — write something first.");
    setId(target);
    setList(null);
    setDetails({});
    setOpen(true);
    const r = await listRevisionsAction({ kind, id: target });
    if (!r.ok || !r.data) return void toast.error(r.ok ? "Could not load the history." : r.error);
    setList(r.data);
    setSelected(r.data[1]?.id ?? r.data[0]?.id ?? null);
  };

  // Load the selected version and the current one (for the diff).
  const current = list?.[0]?.id ?? null;
  useEffect(() => {
    if (!open || !id) return;
    let live = true;
    for (const rid of [selected, current]) {
      if (!rid || details[rid]) continue;
      void getRevisionAction({ kind, id, revisionId: rid }).then((r) => {
        if (live && r.ok && r.data) setDetails((d) => ({ ...d, [rid]: r.data! }));
      });
    }
    return () => {
      live = false;
    };
  }, [open, id, kind, selected, current, details]);

  const sel = selected ? details[selected] : undefined;
  const cur = current ? details[current] : undefined;
  const isCurrent = selected === current;
  const diff = useMemo(() => (sel && cur && !isCurrent ? diffText(sel.text, cur.text) : null), [sel, cur, isCurrent]);
  const changed = diff?.some((p) => p.some((x) => x.kind !== "same")) ?? false;

  const restore = async () => {
    if (!id || !selected) return;
    setRestoring(true);
    const r = await restoreRevisionAction({ kind, id, revisionId: selected });
    if (!r.ok) {
      setRestoring(false);
      return void toast.error(r.error);
    }
    toast.success(r.message ?? "Version restored.");
    // The editor holds its own copy of the document: reload it.
    window.location.reload();
  };

  // Group the list by day.
  const groups = useMemo(() => {
    const g: { day: string; items: RevisionSummary[] }[] = [];
    for (const r of list ?? []) {
      const day = dayFmt.format(new Date(r.savedAt));
      if (g.at(-1)?.day !== day) g.push({ day, items: [] });
      g.at(-1)!.items.push(r);
    }
    return g;
  }, [list]);

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => void show()} title="Version history">
        <History /> History
      </Button>
      {open && (
        <Dialog
          open
          onClose={() => setOpen(false)}
          title="Version history"
          description="Every published version is kept; recent ones are kept in detail, older ones one a day."
          className="max-w-5xl"
          footer={
            <>
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
                Close
              </Button>
              <Button size="sm" loading={restoring} disabled={!selected || isCurrent || !sel} onClick={() => void restore()}>
                <RotateCcw /> Restore this version
              </Button>
            </>
          }
        >
          <div className="grid h-[min(65vh,36rem)] gap-3 sm:grid-cols-[15rem_minmax(0,1fr)]">
            <div className="overflow-y-auto rounded-lg border" role="listbox" aria-label="Versions" data-testid="versions">
              {!list && <Loader2 className="mx-auto my-6 size-5 animate-spin text-muted-foreground" />}
              {list?.length === 0 && <p className="p-4 text-[13px] text-muted-foreground">No versions yet.</p>}
              {groups.map((g) => (
                <div key={g.day}>
                  <p className="sticky top-0 bg-surface-2 px-3 py-1 text-[11px] font-medium text-muted-foreground">{g.day}</p>
                  {g.items.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      role="option"
                      aria-selected={selected === r.id}
                      onClick={() => setSelected(r.id)}
                      className={cn("flex w-full flex-col items-start gap-0.5 border-b px-3 py-2 text-left text-[13px] last:border-b-0 hover:bg-muted", selected === r.id && "bg-primary/10")}
                    >
                      <span className="flex w-full items-center gap-1.5">
                        <span className="font-medium">{timeFmt.format(new Date(r.savedAt))}</span>
                        {r.current && <span className="rounded bg-primary/15 px-1 text-[10px] font-medium text-primary">Current</span>}
                        {r.published && <span className="rounded bg-success/15 px-1 text-[10px] font-medium text-success">Published</span>}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {REASONS[r.reason] ?? r.reason} · {r.wordCount.toLocaleString()} words
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
            <div className="flex min-h-0 flex-col rounded-lg border">
              <div className="flex items-center gap-2 border-b px-3 py-2 text-[13px]">
                <span className="min-w-0 flex-1 truncate font-medium">{sel?.title ?? "…"}</span>
                {!isCurrent && (
                  <span className="flex rounded-md border p-0.5 text-xs" role="tablist">
                    {(["changes", "preview"] as const).map((m) => (
                      <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={cn("rounded px-2 py-0.5", mode === m ? "bg-muted font-medium" : "text-muted-foreground")}>
                        {m === "changes" ? "Changes vs now" : "Preview"}
                      </button>
                    ))}
                  </span>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-4" data-testid="version-view">
                {!sel ? (
                  <Loader2 className="mx-auto my-6 size-5 animate-spin text-muted-foreground" />
                ) : isCurrent || mode === "preview" ? (
                  // contentHtml was sanitised when it was saved (services/notebook-html.ts).
                  <article className="prose-content prose-article text-[15px]" dangerouslySetInnerHTML={{ __html: sel.contentHtml ?? "" }} />
                ) : !diff ? (
                  <Loader2 className="mx-auto my-6 size-5 animate-spin text-muted-foreground" />
                ) : !changed && sel.title === cur?.title ? (
                  <p className="text-[13px] text-muted-foreground">Same as the current version.</p>
                ) : (
                  <div className="space-y-2 text-[14px] leading-relaxed" data-testid="diff">
                    <p className="text-xs text-muted-foreground">
                      <span className="rounded bg-destructive/15 px-1 text-destructive line-through">Removed</span> since this version · <span className="rounded bg-success/15 px-1 text-success">added</span> since this version
                      {sel.title !== cur?.title && ` · Title: “${sel.title}” → “${cur?.title}”`}
                    </p>
                    {diff.map((para, i) => (
                      <p key={i} className={cn(para.every((x) => x.kind === "same") && "text-muted-foreground")}>
                        {para.map((part, j) =>
                          part.kind === "same" ? (
                            <span key={j}>{part.text}</span>
                          ) : part.kind === "del" ? (
                            <del key={j} className="rounded bg-destructive/15 px-0.5 text-destructive">
                              {part.text}
                            </del>
                          ) : (
                            <ins key={j} className="rounded bg-success/15 px-0.5 text-success no-underline">
                              {part.text}
                            </ins>
                          ),
                        )}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
