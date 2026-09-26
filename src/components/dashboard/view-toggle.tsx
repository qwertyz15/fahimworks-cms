"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { LayoutGrid, List } from "lucide-react";
import { cn } from "@/lib/utils";
import { VIEW_COOKIE, type LibraryView } from "./content-types";

function persistView(view: LibraryView) {
  document.cookie = `${VIEW_COOKIE}=${view}; path=/dashboard; max-age=31536000; samesite=lax`;
}

/** Grid ⇄ list switch. The choice is remembered in a cookie so the server renders it directly. */
export function ViewToggle({ view }: { view: LibraryView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const set = (next: LibraryView) => {
    if (next === view) return;
    persistView(next);
    startTransition(() => router.refresh());
  };

  return (
    <div role="radiogroup" aria-label="Layout" className={cn("inline-flex rounded-lg border bg-surface-2 p-0.5", pending && "opacity-70")}>
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
          onClick={() => set(value)}
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
