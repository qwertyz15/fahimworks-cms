"use client";

import { LayoutGrid, List } from "lucide-react";
import { cn } from "@/lib/utils";
import { VIEW_COOKIE, type LibraryView } from "./content-types";

/** Remember the layout so the server renders it directly on the next visit. */
export function persistView(view: LibraryView) {
  document.cookie = `${VIEW_COOKIE}=${view}; path=/dashboard; max-age=31536000; samesite=lax`;
}

/** Grid ⇄ list switch (controlled; switching is instant, no server round trip). */
export function ViewToggle({ view, onChange }: { view: LibraryView; onChange: (view: LibraryView) => void }) {
  return (
    <div role="radiogroup" aria-label="Layout" className="inline-flex rounded-lg border bg-surface-2 p-0.5">
      {([
        ["grid", LayoutGrid, "Grid view"],
        ["list", List, "List view"],
      ] as const).map(([value, Icon, label]) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={view === value}
          aria-label={label}
          title={label}
          onClick={() => onChange(value)}
          className={cn(
            "rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground",
            view === value && "bg-surface text-foreground shadow-card",
          )}
        >
          <Icon className="size-4" />
        </button>
      ))}
    </div>
  );
}
