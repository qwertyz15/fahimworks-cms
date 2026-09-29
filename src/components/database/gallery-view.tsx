"use client";

import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { RowCard } from "./card";
import type { ViewProps } from "./view-props";

const GRID: Record<string, string> = {
  small: "grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))]",
  medium: "grid-cols-[repeat(auto-fill,minmax(15rem,1fr))]",
  large: "grid-cols-[repeat(auto-fill,minmax(21rem,1fr))]",
};

/** Cards in a grid, with covers from the page or a Files property. */
export function GalleryView(p: ViewProps) {
  const size = p.view.config.cardSize ?? "medium";
  return (
    <div className="space-y-3" data-testid="gallery-view">
      <div className={cn("grid gap-3", GRID[size])}>
        {p.rows.map((row) => (
          <RowCard key={row.id} row={row} props={p.props} people={p.people} config={{ cover: "page", ...p.view.config }} onOpen={() => p.onOpenRow(row.id)} showEmptyCover coverAspect={size === "small" ? "aspect-[4/3]" : "aspect-[16/10]"} />
        ))}
        <button
          type="button"
          onClick={async () => {
            const r = await p.onCreateRow();
            if (r) p.onOpenRow(r.id);
          }}
          className="flex min-h-32 items-center justify-center gap-1.5 rounded-lg border border-dashed text-[13px] text-muted-foreground hover:border-primary/40 hover:text-foreground"
        >
          <Plus className="size-4" /> New
        </button>
      </div>
      {p.rows.length < p.total && (
        <button type="button" onClick={p.onLoadMore} disabled={p.loading} className="w-full rounded-lg border px-3 py-2 text-xs text-muted-foreground hover:bg-muted/40">
          {p.loading ? "Loading…" : `Load more (${(p.total - p.rows.length).toLocaleString()} more)`}
        </button>
      )}
    </div>
  );
}
