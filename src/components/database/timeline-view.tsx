"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { addDays, addMonths, daysBetween, monthLabel, monthStart, shortDate, startOfWeek, weekday } from "@/lib/dates";
import { datesPatch, isDateLike, rowRange } from "./row-dates";
import type { PropertyDef, Row } from "./types";
import type { ViewProps } from "./view-props";

/** Pixels per day, and how many days are shown, per scale. */
const SCALES = { day: { px: 40, days: 42 }, week: { px: 16, days: 120 }, month: { px: 6, days: 365 } } as const;
const ROW_H = 36;

/** Narrower title column on phones, so the bars get the room. */
const narrowQuery = "(max-width: 640px)";
const subscribeNarrow = (cb: () => void) => {
  const m = window.matchMedia(narrowQuery);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
const useTitleWidth = () => (useSyncExternalStore(subscribeNarrow, () => window.matchMedia(narrowQuery).matches, () => false) ? 140 : 240);

export function TimelineView(p: ViewProps) {
  const startDef = p.allProps.find((d) => d.id === p.view.config.dateBy && isDateLike(d));
  const choices = p.allProps.filter(isDateLike);
  if (!startDef) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground" data-testid="timeline-view">
        {choices.length ? (
          <>
            Show the timeline by:{" "}
            <select onChange={(e) => p.onUpdateView({ dateBy: e.target.value })} defaultValue="" aria-label="Timeline by" className="ml-1 rounded-md border bg-background px-2 py-1 text-sm">
              <option value="" disabled>
                Select…
              </option>
              {choices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </>
        ) : (
          "A timeline places rows by their dates. Add a Date property (a date range works best) first."
        )}
      </div>
    );
  }
  const endDef = p.allProps.find((d) => d.id === p.view.config.endBy && d.type === "DATE" && d.id !== startDef.id) ?? null;
  return <Timeline {...p} startDef={startDef} endDef={endDef} />;
}

type Drag = { id: string; mode: "move" | "start" | "end"; x0: number; start: string; end: string };

function Timeline(p: ViewProps & { startDef: PropertyDef; endDef: PropertyDef | null }) {
  const { startDef, endDef } = p;
  const TITLE_W = useTitleWidth();
  const scale = p.view.config.scale ?? "week";
  const { px, days: span } = SCALES[scale];
  const [from, setFrom] = useState(() => addDays(startOfWeek(p.today), -7));
  const to = addDays(from, span - 1);
  const editable = startDef.type === "DATE";
  const resizable = editable && (Boolean(endDef) || Boolean(startDef.config.range));
  const [drag, setDrag] = useState<Drag | null>(null);
  const [preview, setPreview] = useState<{ id: string; start: string; end: string } | null>(null);
  const [undated, setUndated] = useState<Row[]>([]);
  const scroller = useRef<HTMLDivElement>(null);

  const { onWindowChange, queryUndated } = p;
  useEffect(() => {
    onWindowChange({ propertyId: startDef.id, endPropertyId: endDef?.id ?? null, from, to });
  }, [from, to, startDef.id, endDef?.id, onWindowChange]);
  useEffect(() => () => onWindowChange(null), [onWindowChange]);
  const rowsKey = p.rows.map((r) => r.id).join();
  useEffect(() => {
    if (!editable) return;
    let alive = true;
    void queryUndated(startDef.id).then((r) => alive && setUndated(r));
    return () => {
      alive = false;
    };
  }, [editable, startDef.id, queryUndated, rowsKey]);

  // Scroll so today is visible.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = Math.max(0, daysBetween(from, p.today) * px - 120);
  }, [from, px, p.today]);

  // Undated rows: the loaded tray plus rows in the view without dates (e.g. just created),
  // always with their latest title/values from the view.
  const undatedRows = useMemo(() => {
    const live = new Map(p.rows.map((r) => [r.id, r]));
    const out = new Map<string, Row>();
    for (const r of undated) out.set(r.id, live.get(r.id) ?? r);
    for (const r of p.rows) if (!rowRange(r, startDef, endDef)) out.set(r.id, r);
    return [...out.values()].filter((r) => !rowRange(r, startDef, endDef));
  }, [undated, p.rows, startDef, endDef]);

  const dated = useMemo(
    () =>
      p.rows
        .map((row) => ({ row, r: rowRange(row, startDef, endDef) }))
        .filter((x): x is { row: Row; r: { start: string; end: string } } => x.r !== null && x.r.end >= from && x.r.start <= to),
    [p.rows, startDef, endDef, from, to],
  );

  // Header: months on top, days/weeks below.
  const dayList = useMemo(() => Array.from({ length: span }, (_, i) => addDays(from, i)), [from, span]);
  const months = useMemo(() => {
    const out: { label: string; left: number; width: number }[] = [];
    for (const d of dayList) {
      const m = monthStart(d);
      const last = out.at(-1);
      if (last && last.label === monthLabel(m)) last.width += px;
      else out.push({ label: monthLabel(m), left: daysBetween(from, d) * px, width: px });
    }
    return out;
  }, [dayList, from, px]);

  const onPointerDown = (e: React.PointerEvent, row: Row, mode: Drag["mode"], range: { start: string; end: string }) => {
    if (!editable || (mode !== "move" && !resizable)) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDrag({ id: row.id, mode, x0: e.clientX, ...range });
    setPreview({ id: row.id, ...range });
  };
  const shifted = (d: Drag, x: number) => {
    const delta = Math.round((x - d.x0) / px);
    if (d.mode === "move") return { start: addDays(d.start, delta), end: addDays(d.end, delta) };
    if (d.mode === "start") {
      const s = addDays(d.start, delta);
      return { start: s > d.end ? d.end : s, end: d.end };
    }
    const en = addDays(d.end, delta);
    return { start: d.start, end: en < d.start ? d.start : en };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    setPreview({ id: drag.id, ...shifted(drag, e.clientX) });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!drag) return;
    const next = shifted(drag, e.clientX);
    setDrag(null);
    setPreview(null);
    if (next.start !== drag.start || next.end !== drag.end) p.onUpdateRow(drag.id, { values: datesPatch(startDef, endDef, next.start, next.end) });
    else if (drag.mode === "move") p.onOpenRow(drag.id);
  };

  const shift = (dir: 1 | -1) => setFrom((f) => (scale === "day" ? addDays(f, dir * 28) : addMonths(f, dir * (scale === "week" ? 1 : 3))));
  const width = span * px;
  const todayLeft = daysBetween(from, p.today) * px;

  const bar = (row: Row, r: { start: string; end: string }) => {
    const shown = preview?.id === row.id ? preview : r;
    const left = daysBetween(from, shown.start) * px;
    const w = (daysBetween(shown.start, shown.end) + 1) * px;
    return (
      <div
        key="bar"
        data-testid="timeline-bar"
        data-row={row.id}
        onPointerDown={(e) => onPointerDown(e, row, "move", r)}
        title={`${row.title || "Untitled"} · ${shortDate(shown.start)}${shown.end !== shown.start ? ` → ${shortDate(shown.end)}` : ""}`}
        className={cn("absolute top-1.5 flex h-6 items-center overflow-hidden rounded-md border border-primary/40 bg-primary/15 text-xs font-medium text-foreground select-none", editable && "cursor-grab active:cursor-grabbing", preview?.id === row.id && "ring-2 ring-primary")}
        style={{ left, width: Math.max(w, 6) }}
      >
        {resizable && <span onPointerDown={(e) => onPointerDown(e, row, "start", r)} className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize hover:bg-primary/40" aria-label="Change start" data-edge="start" />}
        <span className="truncate px-2">{row.title || "Untitled"}</span>
        {resizable && <span onPointerDown={(e) => onPointerDown(e, row, "end", r)} className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize hover:bg-primary/40" aria-label="Change end" data-edge="end" />}
      </div>
    );
  };

  return (
    <div className="space-y-2" data-testid="timeline-view">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-0.5">
          <button type="button" aria-label="Earlier" onClick={() => shift(-1)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <ChevronLeft className="size-4" />
          </button>
          <button type="button" onClick={() => setFrom(addDays(startOfWeek(p.today), -7))} className="rounded-md px-2 py-1 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground">
            Today
          </button>
          <button type="button" aria-label="Later" onClick={() => shift(1)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <ChevronRight className="size-4" />
          </button>
        </div>
        <div className="ml-auto flex rounded-md border p-0.5 text-xs" role="group" aria-label="Scale">
          {(["day", "week", "month"] as const).map((s) => (
            <button key={s} type="button" aria-pressed={scale === s} onClick={() => p.onUpdateView({ scale: s })} className={cn("rounded px-2 py-0.5 capitalize", scale === s ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground")}>
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border bg-surface">
        <div ref={scroller} className="relative max-h-[calc(100dvh-20rem)] min-h-64 overflow-auto" onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => (setDrag(null), setPreview(null))}>
          <div className="relative" style={{ width: TITLE_W + width }}>
            {/* Header */}
            <div className="sticky top-0 z-20 flex border-b bg-surface-2/95 backdrop-blur" style={{ height: 44 }}>
              <div className="sticky left-0 z-10 flex shrink-0 items-end border-r bg-surface-2 px-3 pb-1.5 text-[13px] font-medium text-muted-foreground" style={{ width: TITLE_W }}>
                {startDef.name}
                {endDef ? ` → ${endDef.name}` : ""}
              </div>
              <div className="relative" style={{ width }}>
                {months.map((m) => (
                  <div key={m.label} className="absolute top-0.5 truncate border-l pl-1.5 text-[11px] font-medium text-muted-foreground" style={{ left: m.left, width: m.width }}>
                    {m.label}
                  </div>
                ))}
                {dayList.map((d, i) =>
                  scale === "day" || (scale === "week" && weekday(d) === 1) || (scale === "month" && d.endsWith("-01")) ? (
                    <div key={d} className={cn("absolute bottom-1 text-[10px] text-muted-foreground", d === p.today && "font-semibold text-primary")} style={{ left: i * px + 2 }}>
                      {scale === "day" ? Number(d.slice(8)) : shortDate(d)}
                    </div>
                  ) : null,
                )}
              </div>
            </div>

            {/* Today line */}
            {todayLeft >= 0 && todayLeft <= width && <div className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-primary/70" style={{ left: TITLE_W + todayLeft + px / 2 }} aria-hidden />}

            {/* Rows */}
            {dated.map(({ row, r }) => (
              <div key={row.id} className="flex border-b hover:bg-muted/30" style={{ height: ROW_H }}>
                <button type="button" onClick={() => p.onOpenRow(row.id)} className="sticky left-0 z-10 flex shrink-0 items-center gap-1 truncate border-r bg-surface px-3 text-left text-[13px] font-medium hover:text-primary" style={{ width: TITLE_W }}>
                  {row.icon} <span className="truncate">{row.title || "Untitled"}</span>
                </button>
                <div className="relative" style={{ width }}>
                  {bar(row, r)}
                </div>
              </div>
            ))}
            {dated.length === 0 && <p className="sticky left-0 px-3 py-6 text-[13px] text-muted-foreground">Nothing scheduled in this range.</p>}

            {/* No date: click a day to schedule */}
            {editable && undatedRows.length > 0 && (
              <>
                <div className="sticky left-0 border-b bg-surface-2/60 px-3 py-1 text-[11px] font-medium text-muted-foreground" style={{ width: TITLE_W }}>
                  No {startDef.name} — click a day to schedule
                </div>
                {undatedRows.map((row) => (
                  <div key={row.id} className="flex border-b" style={{ height: ROW_H }} data-testid="timeline-undated">
                    <button type="button" onClick={() => p.onOpenRow(row.id)} className="sticky left-0 z-10 flex shrink-0 items-center truncate border-r bg-surface px-3 text-left text-[13px] text-muted-foreground hover:text-foreground" style={{ width: TITLE_W }}>
                      {row.title || "Untitled"}
                    </button>
                    <div
                      className="relative cursor-copy"
                      style={{ width }}
                      role="button"
                      aria-label={`Schedule ${row.title || "row"}`}
                      onClick={(e) => {
                        const x = e.clientX - (e.currentTarget as HTMLElement).getBoundingClientRect().left;
                        const day = addDays(from, Math.floor(x / px));
                        p.onUpdateRow(row.id, { values: datesPatch(startDef, endDef, day, day) });
                        setUndated((u) => u.filter((x2) => x2.id !== row.id));
                      }}
                    />
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
