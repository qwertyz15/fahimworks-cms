"use client";

import { FileText, Plus } from "lucide-react";
import { ValueDisplay } from "./cells";
import type { ViewProps } from "./view-props";

/** Minimal list: title plus the view's visible properties (non-empty ones). */
export function ListView(p: ViewProps) {
  const extra = p.props.filter((d) => !d.isTitle);
  return (
    <div className="rounded-lg border bg-surface" data-testid="list-view">
      <ul className="divide-y">
        {p.rows.map((row) => (
          <li key={row.id}>
            <button type="button" onClick={() => p.onOpenRow(row.id)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/40" data-testid="list-row">
              <span className="shrink-0 text-muted-foreground">{row.icon ?? <FileText className="size-4" />}</span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{row.title || <span className="text-muted-foreground/60">Untitled</span>}</span>
              <span className="hidden max-w-[60%] shrink-0 items-center gap-3 overflow-hidden text-xs sm:flex">
                {extra
                  .filter((d) => d.type === "CREATED_TIME" || d.type === "LAST_EDITED_TIME" || d.type === "CHECKBOX" || (row.values[d.id] !== undefined && row.values[d.id] !== null))
                  .slice(0, 4)
                  .map((d) => (
                    <span key={d.id} className="flex min-w-0 items-center">
                      <ValueDisplay def={d} value={row.values[d.id]} row={row} people={p.people} />
                    </span>
                  ))}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {p.rows.length < p.total && (
        <button type="button" onClick={p.onLoadMore} disabled={p.loading} className="w-full border-t px-3 py-2 text-xs text-muted-foreground hover:bg-muted/40">
          {p.loading ? "Loading…" : `Load more (${(p.total - p.rows.length).toLocaleString()} more)`}
        </button>
      )}
      <button type="button" onClick={async () => { const r = await p.onCreateRow(); if (r) p.onOpenRow(r.id); }} className="flex w-full items-center gap-1.5 border-t px-3 py-2 text-[13px] text-muted-foreground hover:bg-muted/40 hover:text-foreground">
        <Plus className="size-3.5" /> New
      </button>
    </div>
  );
}
