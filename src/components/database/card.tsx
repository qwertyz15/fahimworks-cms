"use client";

/* eslint-disable @next/next/no-img-element -- covers from the media bucket */
import { FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { PAGE_COVER, type ViewConfig } from "@/lib/db-views";
import type { FileValue } from "@/lib/db-properties";
import { ValueDisplay } from "./cells";
import type { Person, PropertyDef, Row } from "./types";

const IMAGE_RE = /\.(png|jpe?g|webp|gif|avif)(\?|$)/i;

/** The cover image for a card, per the view's `cover` setting. */
export function cardCover(row: Row, config: ViewConfig): string | null {
  const c = config.cover;
  if (!c) return null;
  if (c === PAGE_COVER) return row.thumbnail;
  const files = row.values[c];
  if (!Array.isArray(files)) return null;
  return (files as FileValue[]).find((f) => f.mime?.startsWith("image/") || IMAGE_RE.test(f.url))?.url ?? null;
}

/** Properties with something to show on a card (checkbox and computed times always show). */
export function cardProperties(row: Row, props: PropertyDef[]): PropertyDef[] {
  return props.filter((d) => {
    if (d.isTitle) return false;
    const v = row.values[d.id];
    return d.type === "CREATED_TIME" || d.type === "LAST_EDITED_TIME" || d.type === "CHECKBOX" || (v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0));
  });
}

/** A row as a card (board, gallery): optional cover, title, the view's visible properties. */
export function RowCard({
  row,
  props,
  people,
  config,
  onOpen,
  className,
  coverAspect = "aspect-[16/9]",
  showEmptyCover,
}: {
  row: Row;
  props: PropertyDef[];
  people: Person[];
  config: ViewConfig;
  onOpen?: () => void;
  className?: string;
  coverAspect?: string;
  /** Gallery: keep a placeholder when there's no image, so cards line up. */
  showEmptyCover?: boolean;
}) {
  const cover = cardCover(row, config);
  const shown = cardProperties(row, props);
  const small = config.cardSize === "small";
  return (
    <div
      role="button"
      tabIndex={-1}
      onClick={onOpen}
      data-testid="board-card"
      className={cn("cursor-pointer overflow-hidden rounded-lg border bg-surface text-[13px] shadow-xs transition-colors hover:border-primary/40", className)}
    >
      {cover ? (
        <div className={cn("overflow-hidden border-b bg-muted", coverAspect)}>
          <img src={cover} alt="" loading="lazy" referrerPolicy="no-referrer" className={cn("size-full", config.coverFit === "contain" ? "object-contain" : "object-cover")} data-testid="card-cover" />
        </div>
      ) : showEmptyCover && config.cover ? (
        <div className={cn("flex items-center justify-center border-b bg-muted/60 text-3xl", coverAspect)} aria-hidden>
          {row.icon ?? <FileText className="size-6 text-muted-foreground/40" />}
        </div>
      ) : null}
      <div className={cn("space-y-1.5", small ? "p-2" : "p-2.5")}>
        <p className="font-medium">
          {row.icon && !(showEmptyCover && config.cover && !cover) && <span className="mr-1">{row.icon}</span>}
          {row.title || <span className="text-muted-foreground/60">Untitled</span>}
        </p>
        {!small &&
          shown.map((d) => (
            <div key={d.id} className="flex min-w-0 items-center gap-1 text-xs">
              <ValueDisplay def={d} value={row.values[d.id]} row={row} people={people} />
            </div>
          ))}
      </div>
    </div>
  );
}
