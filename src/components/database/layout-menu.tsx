"use client";

import { cn } from "@/lib/utils";
import { PAGE_COVER, type ViewConfig } from "@/lib/db-views";
import { isDateLike } from "./row-dates";
import type { PropertyDef, ViewDef } from "./types";

function Seg<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 px-2 py-1.5 text-[13px]">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex rounded-md border p-0.5 text-xs" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)} className={cn("rounded px-2 py-0.5 whitespace-nowrap", value === o.value ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground")}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Pick({ label, value, options, onChange, allowNone }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string | null) => void; allowNone?: string }) {
  return (
    <label className="flex items-center justify-between gap-3 px-2 py-1.5 text-[13px]">
      <span className="text-muted-foreground">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value || null)} aria-label={label} className="max-w-40 rounded-md border bg-background px-1.5 py-0.5 text-[13px]">
        {allowNone !== undefined && <option value="">{allowNone}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Per-view layout: card cover/size, calendar & timeline dates, how rows open. */
export function LayoutMenu({ view, props, onChange }: { view: ViewDef; props: PropertyDef[]; onChange: (patch: Partial<ViewConfig>) => void }) {
  const c = view.config;
  const cards = view.type === "BOARD" || view.type === "GALLERY";
  const dates = props.filter(isDateLike).map((d) => ({ value: d.id, label: d.name }));
  const files = props.filter((d) => d.type === "FILES").map((d) => ({ value: d.id, label: d.name }));
  return (
    <div className="w-80 divide-y">
      {cards && (
        <div className="py-1">
          <Pick
            label="Card cover"
            value={c.cover ?? (view.type === "GALLERY" && c.cover === undefined ? PAGE_COVER : "")}
            allowNone="None"
            options={[{ value: PAGE_COVER, label: "Page cover" }, ...files]}
            onChange={(v) => onChange({ cover: v })}
          />
          <Seg label="Card size" value={c.cardSize ?? "medium"} options={[{ value: "small", label: "Small" }, { value: "medium", label: "Medium" }, { value: "large", label: "Large" }]} onChange={(v) => onChange({ cardSize: v })} />
          {view.type === "GALLERY" && <Seg label="Fit image" value={c.coverFit ?? "cover"} options={[{ value: "cover", label: "Fill" }, { value: "contain", label: "Fit" }]} onChange={(v) => onChange({ coverFit: v })} />}
          {view.type === "BOARD" && (
            <label className="flex items-center justify-between px-2 py-1.5 text-[13px]">
              <span className="text-muted-foreground">Show “No value” column</span>
              <input type="checkbox" checked={!c.hideEmptyGroup} onChange={(e) => onChange({ hideEmptyGroup: !e.target.checked })} />
            </label>
          )}
        </div>
      )}
      {view.type === "CALENDAR" && (
        <div className="py-1">
          <Pick label="Calendar by" value={c.dateBy ?? ""} options={dates} onChange={(v) => onChange({ dateBy: v })} />
          <Seg label="Week starts" value={c.weekStart ?? "mon"} options={[{ value: "mon", label: "Monday" }, { value: "sun", label: "Sunday" }]} onChange={(v) => onChange({ weekStart: v })} />
        </div>
      )}
      {view.type === "TIMELINE" && (
        <div className="py-1">
          <Pick label="Start date" value={c.dateBy ?? ""} options={dates} onChange={(v) => onChange({ dateBy: v })} />
          <Pick label="End date" value={c.endBy ?? ""} allowNone="Same as start (range)" options={props.filter((d) => d.type === "DATE" && d.id !== c.dateBy).map((d) => ({ value: d.id, label: d.name }))} onChange={(v) => onChange({ endBy: v })} />
          <Seg label="Scale" value={c.scale ?? "week"} options={[{ value: "day", label: "Day" }, { value: "week", label: "Week" }, { value: "month", label: "Month" }]} onChange={(v) => onChange({ scale: v })} />
        </div>
      )}
      <div className="py-1">
        <Seg label="Open pages in" value={c.openIn ?? "peek"} options={[{ value: "peek", label: "Side peek" }, { value: "page", label: "Full page" }]} onChange={(v) => onChange({ openIn: v })} />
      </div>
    </div>
  );
}
