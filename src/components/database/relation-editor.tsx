"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { ArrowUpRight, Check, FileText, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { PropertyDef, PropertyValue } from "@/lib/db-properties";
import { createRowAction, searchRelationTargetsAction } from "@/server/actions/databases";

/*
 * Relations in the UI: chips for linked pages, the link picker, and a page
 * picker for relation filters. Titles of linked pages come from a context
 * fed by queries and writes (the server's `related` map).
 */

export interface RelatedPage {
  title: string;
  icon: string | null;
  databaseId: string | null;
  archived: boolean;
}

interface RelatedCtx {
  related: Record<string, RelatedPage>;
  /** Merge more related pages (after a write or a pick). */
  remember: (more: Record<string, RelatedPage>) => void;
  /** Open a linked page (peek panel). */
  open?: (pageId: string) => void;
}

const Ctx = createContext<RelatedCtx>({ related: {}, remember: () => {} });
export const RelatedProvider = Ctx.Provider;
export const useRelated = () => useContext(Ctx);

/** Linked pages as chips (display only: cells and property rows open the link editor, which opens pages). */
export function RelationChips({ ids, wrap }: { ids: string[]; wrap?: boolean }) {
  const { related } = useRelated();
  return (
    <span className={cn("flex gap-1", wrap ? "flex-wrap" : "overflow-hidden")}>
      {ids.map((id) => {
        const p = related[id];
        return (
          <span
            key={id}
            data-relation-chip
            title={p?.archived ? "Archived" : undefined}
            className={cn("inline-flex max-w-48 shrink-0 items-center gap-1 truncate rounded px-1 text-[13px] underline decoration-muted-foreground/40 underline-offset-2", p?.archived && "opacity-50")}
          >
            <span className="shrink-0 text-xs" aria-hidden>
              {p?.icon ?? <FileText className="size-3 text-muted-foreground" />}
            </span>
            <span className="truncate">{p ? p.title || "Untitled" : "…"}</span>
          </span>
        );
      })}
    </span>
  );
}

type Hit = { id: string; title: string; icon: string | null };

function useSearch(databaseId: string, q: string) {
  const [hits, setHits] = useState<Hit[] | null>(null);
  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      const r = await searchRelationTargetsAction({ databaseId, q });
      if (!live) return;
      if (!r.ok) {
        toast.error(r.error);
        setHits([]);
      } else setHits(r.data ?? []);
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [databaseId, q]);
  return hits;
}

/** Link picker: search the target database, toggle links, create a row by name. */
export function RelationEditor({ def, value, onChange, onClose }: { def: PropertyDef; value: PropertyValue | undefined; onChange: (v: PropertyValue) => void; onClose?: () => void }) {
  const cfg = def.config.relation;
  const { related, remember, open } = useRelated();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const hits = useSearch(cfg?.databaseId ?? "", q);
  if (!cfg) return <p className="px-2 py-1.5 text-xs text-muted-foreground">Choose a database for this relation first.</p>;
  const one = cfg.limit === "one";
  const selected = Array.isArray(value) ? (value as string[]) : [];
  const set = (ids: string[]) => onChange(ids.length ? ids : null);
  const toggle = (h: Hit) => {
    remember({ [h.id]: { title: h.title, icon: h.icon, databaseId: cfg.databaseId, archived: false } });
    if (selected.includes(h.id)) set(selected.filter((x) => x !== h.id));
    else set(one ? [h.id] : [...selected, h.id]);
  };
  const exact = hits?.find((h) => h.title.toLowerCase() === q.trim().toLowerCase());
  const create = async () => {
    const title = q.trim();
    if (!title || busy) return;
    setBusy(true);
    const r = await createRowAction({ databaseId: cfg.databaseId, title });
    setBusy(false);
    if (!r.ok || !r.data) return void toast.error(r.ok ? "Could not create the page." : r.error);
    setQ("");
    toggle({ id: r.data.id, title: r.data.title, icon: r.data.icon });
  };
  return (
    <div className="w-72">
      {selected.length > 0 && (
        <div className="mb-1 flex flex-wrap gap-1 border-b pb-1.5" aria-label="Linked pages">
          {selected.map((id) => (
            <span key={id} className={cn("inline-flex max-w-full items-center gap-1 rounded bg-muted px-1.5 py-px text-xs", related[id]?.archived && "opacity-60")}>
              <span className="truncate">{related[id]?.title || "Untitled"}</span>
              {open && (
                <button type="button" aria-label={`Open ${related[id]?.title || "page"}`} title="Open" onClick={() => (onClose?.(), open(id))} className="text-muted-foreground hover:text-foreground">
                  <ArrowUpRight className="size-3" />
                </button>
              )}
              <button type="button" aria-label={`Unlink ${related[id]?.title || "page"}`} onClick={() => set(selected.filter((x) => x !== id))} className="text-muted-foreground hover:text-foreground">
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        data-autofocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          if (exact) toggle(exact);
          else if (hits?.length === 1 && q.trim()) toggle(hits[0]!);
          else void create();
        }}
        placeholder={one ? "Link a page…" : "Search or create a page…"}
        aria-label={`Search ${def.name}`}
        className="mb-1 w-full rounded-md border bg-background px-2 py-1 text-[13px] outline-none focus:border-ring"
      />
      <div role="listbox" aria-label={def.name} aria-multiselectable={!one} className="max-h-64 overflow-y-auto">
        {hits === null && <Loader2 className="mx-auto my-2 size-4 animate-spin text-muted-foreground" />}
        {hits?.map((h) => (
          <button key={h.id} type="button" role="option" aria-selected={selected.includes(h.id)} onClick={() => toggle(h)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted">
            <span className="w-4 shrink-0 text-center text-xs">{h.icon ?? <FileText className="size-3.5 text-muted-foreground" />}</span>
            <span className="flex-1 truncate">{h.title || "Untitled"}</span>
            {selected.includes(h.id) && <Check className="size-3.5 text-primary" />}
          </button>
        ))}
        {hits?.length === 0 && !q.trim() && <p className="px-2 py-1.5 text-xs text-muted-foreground">That database has no pages yet — type to create one.</p>}
        {q.trim() && !exact && (
          <button type="button" onClick={() => void create()} disabled={busy} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted">
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} New page “{q.trim()}”
          </button>
        )}
      </div>
    </div>
  );
}

/** One page of a database (relation filter value). */
export function RelationTargetPicker({ databaseId, value, onChange }: { databaseId: string; value: string | null; onChange: (id: string | null) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const { related, remember } = useRelated();
  const hits = useSearch(databaseId, open ? q : "");
  const current = value ? (related[value]?.title ?? hits?.find((h) => h.id === value)?.title) : null;
  return (
    <span className="relative inline-block">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-label="Page" aria-expanded={open} className="inline-flex max-w-40 items-center gap-1 truncate rounded-md border bg-background px-2 py-1 text-xs">
        <ArrowUpRight className="size-3 shrink-0 text-muted-foreground" />
        <span className="truncate">{value ? current || "Untitled" : "Choose…"}</span>
      </button>
      {open && (
        <span className="absolute top-full left-0 z-50 mt-1 block w-60 rounded-md border bg-popover p-1 shadow-md">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" aria-label="Search pages" className="mb-1 w-full rounded border bg-background px-2 py-1 text-xs outline-none" />
          <span className="block max-h-48 overflow-y-auto">
            {hits?.map((h) => (
              <button
                key={h.id}
                type="button"
                onClick={() => {
                  remember({ [h.id]: { title: h.title, icon: h.icon, databaseId, archived: false } });
                  onChange(h.id);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs hover:bg-muted"
              >
                <span className="flex-1 truncate">{h.title || "Untitled"}</span>
                {h.id === value && <Check className="size-3 text-primary" />}
              </button>
            ))}
          </span>
        </span>
      )}
    </span>
  );
}
