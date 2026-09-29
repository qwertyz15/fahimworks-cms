"use client";

import { useEffect, useMemo, useState } from "react";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { ChevronLeft, ChevronRight, Inbox, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { addDays, addMonths, daysBetween, monthGrid, monthLabel, monthStart } from "@/lib/dates";
import { datesPatch, isDateLike, rowRange } from "./row-dates";
import { Popover } from "./popover";
import type { PropertyDef, Row } from "./types";
import type { ViewProps } from "./view-props";

const WEEKDAYS = { mon: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], sun: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] };
const MAX_PER_DAY = 3;

export function CalendarView(p: ViewProps) {
  const dateDef = p.allProps.find((d) => d.id === p.view.config.dateBy && isDateLike(d));
  const choices = p.allProps.filter(isDateLike);
  if (!dateDef) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground" data-testid="calendar-view">
        {choices.length ? (
          <>
            Show the calendar by:{" "}
            <select onChange={(e) => p.onUpdateView({ dateBy: e.target.value })} defaultValue="" aria-label="Calendar by" className="ml-1 rounded-md border bg-background px-2 py-1 text-sm">
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
          "A calendar places rows by a date. Add a Date property to this database first."
        )}
      </div>
    );
  }
  return <Calendar {...p} dateDef={dateDef} />;
}

function Calendar(p: ViewProps & { dateDef: PropertyDef }) {
  const { dateDef } = p;
  const weekStart = p.view.config.weekStart ?? "mon";
  const [month, setMonth] = useState(() => monthStart(p.today));
  const days = useMemo(() => monthGrid(month, weekStart), [month, weekStart]);
  const editable = dateDef.type === "DATE";
  const [tray, setTray] = useState<Row[] | null>(null);
  const [trayOpen, setTrayOpen] = useState(false);
  const [more, setMore] = useState<{ day: string; anchor: HTMLElement } | null>(null);
  const [dragging, setDragging] = useState<Row | null>(null);

  // Load just the visible weeks.
  const { onWindowChange } = p;
  useEffect(() => {
    onWindowChange({ propertyId: dateDef.id, from: days[0]!, to: days[41]! });
  }, [days, dateDef.id, onWindowChange]);
  useEffect(() => () => onWindowChange(null), [onWindowChange]);

  const loadTray = async () => setTray(editable ? await p.queryUndated(dateDef.id) : []);
  // Tray rows with their latest title/values; rows in the view without a date join it.
  const trayRows = useMemo(() => {
    if (tray === null) return null;
    const live = new Map(p.rows.map((r) => [r.id, r]));
    const out = new Map<string, Row>();
    for (const r of tray) out.set(r.id, live.get(r.id) ?? r);
    for (const r of p.rows) if (!rowRange(r, dateDef)) out.set(r.id, r);
    return [...out.values()].filter((r) => !rowRange(r, dateDef));
  }, [tray, p.rows, dateDef]);

  // Items per day (a range repeats on each day it covers).
  const byDay = useMemo(() => {
    const map = new Map<string, { row: Row; start: string; end: string }[]>();
    for (const row of p.rows) {
      const r = rowRange(row, dateDef);
      if (!r || r.end < days[0]! || r.start > days[41]!) continue;
      for (let d = r.start < days[0]! ? days[0]! : r.start; d <= r.end && d <= days[41]!; d = addDays(d, 1)) {
        map.set(d, [...(map.get(d) ?? []), { row, ...r }]);
      }
    }
    return map;
  }, [p.rows, dateDef, days]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor));
  const onStart = (e: DragStartEvent) => setDragging((e.active.data.current?.row as Row) ?? null);
  // Moves happen on drop only (no live reflow while dragging).
  const onEnd = ({ active, over }: DragEndEvent) => {
    setDragging(null);
    if (!over || !editable) return;
    const row = active.data.current?.row as Row | undefined;
    const fromDay = active.data.current?.day as string | null;
    const toDay = String(over.id).replace(/^day:/, "");
    if (!row) return;
    const r = rowRange(row, dateDef);
    if (!r || fromDay === null) {
      // From the "No date" tray.
      p.onUpdateRow(row.id, { values: datesPatch(dateDef, null, toDay, toDay) });
      setTray((t) => t?.filter((x) => x.id !== row.id) ?? t);
      return;
    }
    const delta = daysBetween(fromDay, toDay);
    if (!delta) return;
    p.onUpdateRow(row.id, { values: datesPatch(dateDef, null, addDays(r.start, delta), addDays(r.end, delta)) });
  };

  const thisMonth = month.slice(0, 7);
  return (
    <div className="space-y-2" data-testid="calendar-view">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="min-w-40 text-base font-semibold" aria-live="polite">
          {monthLabel(month)}
        </h2>
        <div className="flex items-center gap-0.5">
          <button type="button" aria-label="Previous month" onClick={() => setMonth((m) => addMonths(m, -1))} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <ChevronLeft className="size-4" />
          </button>
          <button type="button" onClick={() => setMonth(monthStart(p.today))} className="rounded-md px-2 py-1 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground">
            Today
          </button>
          <button type="button" aria-label="Next month" onClick={() => setMonth((m) => addMonths(m, 1))} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <ChevronRight className="size-4" />
          </button>
        </div>
        {editable && (
          <button
            type="button"
            onClick={() => {
              setTrayOpen((o) => !o);
              if (!trayOpen) void loadTray();
            }}
            aria-pressed={trayOpen}
            className={cn("ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] hover:bg-muted", trayOpen ? "text-foreground" : "text-muted-foreground")}
          >
            <Inbox className="size-3.5" /> No date{trayRows ? ` · ${trayRows.length}` : ""}
          </button>
        )}
      </div>

      <DndContext sensors={sensors} onDragStart={onStart} onDragEnd={onEnd} onDragCancel={() => setDragging(null)}>
        <div className="flex gap-3">
          <div className="min-w-0 flex-1 overflow-x-auto rounded-lg border bg-surface">
            <div className="grid min-w-[42rem] grid-cols-7 border-b bg-surface-2 text-center text-[11px] font-medium text-muted-foreground">
              {WEEKDAYS[weekStart].map((w) => (
                <div key={w} className="py-1.5">
                  {w}
                </div>
              ))}
            </div>
            <div className="grid min-w-[42rem] grid-cols-7" role="grid" aria-label={monthLabel(month)}>
              {days.map((day) => {
                const items = byDay.get(day) ?? [];
                return (
                  <Day
                    key={day}
                    day={day}
                    today={day === p.today}
                    outside={day.slice(0, 7) !== thisMonth}
                    count={items.length}
                    onAdd={editable ? () => void p.onCreateRow({ values: datesPatch(dateDef, null, day, day) }) : undefined}
                    onMore={(anchor) => setMore({ day, anchor })}
                  >
                    {items.slice(0, MAX_PER_DAY).map((it) => (
                      <Item key={it.row.id} row={it.row} day={day} continued={it.start < day} continues={it.end > day} editable={editable} onOpen={() => p.onOpenRow(it.row.id)} />
                    ))}
                  </Day>
                );
              })}
            </div>
          </div>
          {trayOpen && (
            <aside className="w-56 shrink-0 space-y-1.5 rounded-lg border bg-surface p-2" aria-label="Rows without a date" data-testid="no-date-tray">
              <p className="px-1 text-[11px] font-medium text-muted-foreground">No {dateDef.name} — drag onto a day</p>
              {trayRows === null ? (
                <p className="px-1 text-xs text-muted-foreground">Loading…</p>
              ) : trayRows.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">Every row has a date.</p>
              ) : (
                trayRows.map((row) => <Item key={row.id} row={row} day={null} editable onOpen={() => p.onOpenRow(row.id)} />)
              )}
            </aside>
          )}
        </div>
        <DragOverlay>{dragging ? <div className="rounded-md border bg-surface px-2 py-1 text-xs font-medium shadow-pop">{dragging.title || "Untitled"}</div> : null}</DragOverlay>
      </DndContext>

      {more && (
        <Popover anchor={more.anchor} open onClose={() => setMore(null)} label={`Rows on ${more.day}`}>
          <div className="w-56 space-y-1 p-1">
            <p className="px-1 pb-1 text-xs font-medium text-muted-foreground">{new Date(`${more.day}T00:00:00`).toLocaleDateString("en", { weekday: "long", month: "long", day: "numeric" })}</p>
            {(byDay.get(more.day) ?? []).map((it) => (
              <button key={it.row.id} type="button" onClick={() => (setMore(null), p.onOpenRow(it.row.id))} className="block w-full truncate rounded-md px-2 py-1 text-left text-[13px] hover:bg-muted">
                {it.row.icon} {it.row.title || "Untitled"}
              </button>
            ))}
          </div>
        </Popover>
      )}
    </div>
  );
}

function Day({ day, today, outside, count, onAdd, onMore, children }: { day: string; today: boolean; outside: boolean; count: number; onAdd?: () => void; onMore: (anchor: HTMLElement) => void; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${day}` });
  return (
    <div ref={setNodeRef} role="gridcell" aria-label={day} data-day={day} className={cn("group/day relative min-h-28 border-r border-b p-1 [&:nth-child(7n)]:border-r-0", outside && "bg-muted/30", isOver && "bg-primary/10")}>
      <div className="mb-1 flex items-center justify-between">
        <span className={cn("inline-flex size-6 items-center justify-center rounded-full text-xs", today ? "bg-primary font-semibold text-primary-foreground" : outside ? "text-muted-foreground/60" : "text-muted-foreground")}>{Number(day.slice(8))}</span>
        {onAdd && (
          <button type="button" aria-label={`New on ${day}`} onClick={onAdd} className="rounded p-0.5 text-muted-foreground opacity-0 group-hover/day:opacity-100 hover:bg-muted hover:text-foreground focus:opacity-100">
            <Plus className="size-3.5" />
          </button>
        )}
      </div>
      <div className="space-y-0.5">{children}</div>
      {count > MAX_PER_DAY && (
        <button type="button" onClick={(e) => onMore(e.currentTarget)} className="mt-0.5 w-full rounded px-1 text-left text-[11px] text-muted-foreground hover:bg-muted">
          +{count - MAX_PER_DAY} more
        </button>
      )}
    </div>
  );
}

function Item({ row, day, continued, continues, editable, onOpen }: { row: Row; day: string | null; continued?: boolean; continues?: boolean; editable: boolean; onOpen: () => void }) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: `item:${row.id}:${day ?? "tray"}`, data: { row, day }, disabled: !editable });
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      onClick={onOpen}
      data-testid="calendar-item"
      data-row={row.id}
      className={cn(
        "block w-full truncate border bg-surface px-1.5 py-0.5 text-left text-xs font-medium shadow-xs hover:border-primary/40",
        continued ? "rounded-l-none border-l-0" : "rounded-l-md",
        continues ? "rounded-r-none border-r-0" : "rounded-r-md",
        isDragging && "opacity-40",
      )}
    >
      {row.icon && <span className="mr-0.5">{row.icon}</span>}
      {row.title || "Untitled"}
    </button>
  );
}
