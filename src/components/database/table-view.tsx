"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, horizontalListSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Maximize2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { COMPUTED_TYPES, type PropertyValue } from "@/lib/db-properties";
import { ValueDisplay, ValueEditor } from "./cells";
import { Popover } from "./popover";
import { TYPE_ICONS } from "./property-menu";
import type { PropertyDef } from "./types";
import type { ViewProps } from "./view-props";

const ROW_H = 36;
const DEFAULT_W = 180;
const TITLE_W = 280;
const CHECK_W = 36;

type Cell = { row: number; col: number };

export function TableView(p: ViewProps) {
  const { props, rows } = p;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [widths, setWidths] = useState<Record<string, number>>(p.view.config.widths ?? {});
  const [shownWidths, setShownWidths] = useState(p.view.config.widths);
  if (shownWidths !== p.view.config.widths) {
    setShownWidths(p.view.config.widths);
    setWidths(p.view.config.widths ?? {});
  }
  const [active, setActive] = useState<Cell | null>(null);
  const [editing, setEditing] = useState<{ cell: Cell; anchor: HTMLElement } | null>(null);
  const [titleEdit, setTitleEdit] = useState<string | null>(null);
  // A row created from the toolbar: edit its title (adjusted during render, not in an effect).
  const [seenAutoEdit, setSeenAutoEdit] = useState(p.autoEditRowId);
  if (p.autoEditRowId !== seenAutoEdit) {
    setSeenAutoEdit(p.autoEditRowId);
    if (p.autoEditRowId) setTitleEdit(p.autoEditRowId);
  }

  const columnIds = useMemo(() => props.map((d) => d.id), [props]);
  const width = (d: PropertyDef) => widths[d.id] ?? (d.isTitle ? TITLE_W : DEFAULT_W);
  const gridCols = `${CHECK_W}px ${props.map((d) => `${width(d)}px`).join(" ")} 48px`;

  // TanStack Virtual returns fresh functions each render, so the React Compiler skips this component — expected.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virt = useVirtualizer({ count: rows.length, getScrollElement: () => scrollRef.current, estimateSize: () => ROW_H, overscan: 12 });

  // Bring a row whose title is being edited into view (e.g. one just added at the end).
  useEffect(() => {
    if (!titleEdit) return;
    const i = rows.findIndex((r) => r.id === titleEdit);
    if (i >= 0) virt.scrollToIndex(i, { align: "auto" });
  }, [titleEdit, rows, virt]);

  // Infinite scroll: fetch the next page near the bottom.
  const items = virt.getVirtualItems();
  const last = items.at(-1)?.index ?? 0;
  useEffect(() => {
    if (!p.loading && rows.length < p.total && last >= rows.length - 20) p.onLoadMore();
  }, [last, rows.length, p]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onColumnDrop = ({ active: a, over }: DragEndEvent) => {
    if (!over || a.id === over.id) return;
    const ids = p.allProps.map((d) => d.id);
    const order = (p.view.config.order?.length ? [...p.view.config.order, ...ids.filter((id) => !p.view.config.order!.includes(id))] : ids).filter((id) => ids.includes(id));
    p.onUpdateView({ order: arrayMove(order, order.indexOf(String(a.id)), order.indexOf(String(over.id))) });
  };

  const cellEl = useCallback((c: Cell) => scrollRef.current?.querySelector<HTMLElement>(`[data-cell="${c.row}:${c.col}"]`) ?? null, []);

  const openCell = (c: Cell) => {
    const row = rows[c.row];
    const def = props[c.col];
    if (!row || !def) return;
    if (def.isTitle) {
      setTitleEdit(row.id);
      return;
    }
    if (COMPUTED_TYPES.includes(def.type)) return;
    if (def.type === "CHECKBOX") {
      p.onUpdateRow(row.id, { values: { [def.id]: !row.values[def.id] } });
      return;
    }
    const anchor = cellEl(c);
    if (anchor) setEditing({ cell: c, anchor });
  };

  const move = (dr: number, dc: number) => {
    setActive((a) => {
      const cur = a ?? { row: 0, col: 0 };
      const next = { row: Math.max(0, Math.min(rows.length - 1, cur.row + dr)), col: Math.max(0, Math.min(props.length - 1, cur.col + dc)) };
      virt.scrollToIndex(next.row, { align: "auto" });
      requestAnimationFrame(() => cellEl(next)?.focus());
      return next;
    });
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (editing || titleEdit || !active) return;
    const keys: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], Tab: [0, e.shiftKey ? -1 : 1] };
    if (keys[e.key]) {
      e.preventDefault();
      move(...keys[e.key]!);
    } else if (e.key === "Enter") {
      e.preventDefault();
      openCell(active);
    } else if (e.key === " " && props[active.col]?.type === "CHECKBOX") {
      e.preventDefault();
      openCell(active);
    } else if ((e.key === "Backspace" || e.key === "Delete") && rows[active.row] && props[active.col] && !props[active.col]!.isTitle && !COMPUTED_TYPES.includes(props[active.col]!.type)) {
      e.preventDefault();
      p.onUpdateRow(rows[active.row]!.id, { values: { [props[active.col]!.id]: null } });
    }
  };

  const allSelected = rows.length > 0 && rows.every((r) => p.selection.has(r.id));
  const editRow = editing ? rows[editing.cell.row] : undefined;
  const editDef = editing ? props[editing.cell.col] : undefined;

  return (
    <div className="rounded-lg border bg-surface" data-testid="table-view">
      <div ref={scrollRef} className="relative h-[calc(100dvh-19rem)] min-h-72 overflow-auto" onKeyDown={onKeyDown} role="grid" aria-rowcount={p.total + 1} aria-colcount={props.length}>
        {/* Header */}
        <div className="sticky top-0 z-10 grid w-max min-w-full border-b bg-surface-2/95 backdrop-blur" style={{ gridTemplateColumns: gridCols }} role="row">
          <div className="flex items-center justify-center border-r" role="columnheader">
            <input type="checkbox" aria-label="Select all rows" checked={allSelected} onChange={(e) => p.onSelect(rows.map((r) => r.id), e.target.checked)} />
          </div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onColumnDrop}>
            <SortableContext items={columnIds} strategy={horizontalListSortingStrategy}>
              {props.map((d) => (
                <HeaderCell
                  key={d.id}
                  def={d}
                  onMenu={(el) => p.onPropertyMenu(d, el)}
                  onResize={(w) => setWidths((cur) => ({ ...cur, [d.id]: w }))}
                  onResizeEnd={(w) => p.onUpdateView({ widths: { ...widths, [d.id]: w } })}
                  width={width(d)}
                />
              ))}
            </SortableContext>
          </DndContext>
          <button type="button" aria-label="Add a property" title="Add a property" onClick={(e) => p.onAddProperty(e.currentTarget)} className="flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground">
            <Plus className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="relative w-max min-w-full" style={{ height: virt.getTotalSize() }}>
          {items.map((vr) => {
            const row = rows[vr.index]!;
            const selected = p.selection.has(row.id);
            return (
              <div
                key={row.id}
                data-row-id={row.id}
                role="row"
                aria-rowindex={vr.index + 2}
                className={cn("group/row absolute left-0 grid w-full border-b", selected ? "bg-primary/5" : "hover:bg-muted/40")}
                style={{ transform: `translateY(${vr.start}px)`, height: ROW_H, gridTemplateColumns: gridCols }}
              >
                <div className="flex items-center justify-center border-r" role="gridcell">
                  <input type="checkbox" aria-label={`Select ${row.title || "row"}`} checked={selected} onChange={(e) => p.onSelect([row.id], e.target.checked)} className={cn(!selected && "opacity-0 group-hover/row:opacity-100 focus:opacity-100")} />
                </div>
                {props.map((d, ci) => {
                  const cell = { row: vr.index, col: ci };
                  const isActive = active?.row === vr.index && active.col === ci;
                  return (
                    <div
                      key={d.id}
                      data-cell={`${vr.index}:${ci}`}
                      role="gridcell"
                      tabIndex={isActive || (!active && vr.index === 0 && ci === 0) ? 0 : -1}
                      aria-label={d.name}
                      onFocus={() => setActive(cell)}
                      onClick={() => {
                        setActive(cell);
                        if (!d.isTitle) openCell(cell);
                      }}
                      onDoubleClick={() => d.isTitle && setTitleEdit(row.id)}
                      className={cn(
                        "relative flex min-w-0 items-center overflow-hidden border-r px-2 text-[13px] outline-none",
                        isActive && "ring-2 ring-ring ring-inset",
                        d.type === "CHECKBOX" && "justify-center",
                        !d.isTitle && !COMPUTED_TYPES.includes(d.type) && "cursor-pointer",
                      )}
                    >
                      {d.isTitle ? (
                        titleEdit === row.id ? (
                          <TitleInput
                            initial={row.title}
                            onDone={(t) => {
                              setTitleEdit(null);
                              if (t !== null && t !== row.title) p.onUpdateRow(row.id, { title: t });
                              requestAnimationFrame(() => cellEl(cell)?.focus());
                            }}
                          />
                        ) : (
                          <>
                            <span className="min-w-0 flex-1 truncate font-medium" onClick={() => setTitleEdit(row.id)}>
                              {row.icon && <span className="mr-1">{row.icon}</span>}
                              {row.title || <span className="text-muted-foreground/60">Untitled</span>}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                p.onOpenRow(row.id);
                              }}
                              aria-label={`Open ${row.title || "row"}`}
                              className="ml-1 inline-flex shrink-0 items-center gap-1 rounded border bg-surface px-1.5 py-0.5 text-[11px] text-muted-foreground opacity-0 shadow-xs group-hover/row:opacity-100 hover:text-foreground focus:opacity-100"
                            >
                              <Maximize2 className="size-3" /> Open
                            </button>
                          </>
                        )
                      ) : (
                        <ValueDisplay def={d} value={row.values[d.id]} row={row} people={p.people} />
                      )}
                    </div>
                  );
                })}
                <div />
              </div>
            );
          })}
        </div>
        <button
          type="button"
          onClick={async () => {
            const r = await p.onCreateRow();
            if (r) setTitleEdit(r.id);
          }}
          className="sticky left-0 flex h-9 w-full items-center gap-1.5 px-3 text-[13px] text-muted-foreground hover:bg-muted/50 hover:text-foreground"
        >
          <Plus className="size-3.5" /> New
        </button>
      </div>
      <div className="flex items-center justify-between border-t px-3 py-1.5 text-xs text-muted-foreground">
        <span>
          {p.total.toLocaleString()} {p.total === 1 ? "row" : "rows"}
          {rows.length < p.total && ` · showing ${rows.length.toLocaleString()}`}
        </span>
        {p.loading && <span>Loading…</span>}
      </div>

      {editing && editRow && editDef && (
        <Popover anchor={editing.anchor} open onClose={() => (setEditing(null), editing.anchor.focus())} label={`Edit ${editDef.name}`} matchWidth>
          <ValueEditor
            def={editDef}
            value={editRow.values[editDef.id]}
            people={p.people}
            uploads={p.uploads}
            rowId={editRow.id}
            onChange={(v: PropertyValue) => p.onUpdateRow(editRow.id, { values: { [editDef.id]: v } })}
            onClose={() => (setEditing(null), editing.anchor.focus())}
            onUpdateOptions={(o) => p.onUpdateOptions(editDef.id, o)}
          />
        </Popover>
      )}
    </div>
  );
}

function TitleInput({ initial, onDone }: { initial: string; onDone: (t: string | null) => void }) {
  const [v, setV] = useState(initial);
  return (
    <input
      autoFocus
      value={v}
      maxLength={300}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onDone(v)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") onDone(v);
        if (e.key === "Escape") onDone(null);
      }}
      aria-label="Title"
      className="h-full w-full bg-transparent font-medium outline-none"
    />
  );
}

function HeaderCell({ def, width, onMenu, onResize, onResizeEnd }: { def: PropertyDef; width: number; onMenu: (el: HTMLElement) => void; onResize: (w: number) => void; onResizeEnd: (w: number) => void }) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: def.id });
  const Icon = TYPE_ICONS[def.type];
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    let w = width;
    const moveH = (ev: PointerEvent) => {
      w = Math.max(80, Math.min(800, width + ev.clientX - x0));
      onResize(w);
    };
    const up = () => {
      window.removeEventListener("pointermove", moveH);
      window.removeEventListener("pointerup", up);
      onResizeEnd(Math.round(w));
    };
    window.addEventListener("pointermove", moveH);
    window.addEventListener("pointerup", up);
  };
  return (
    <div ref={setNodeRef} role="columnheader" style={{ transform: CSS.Translate.toString(transform), transition }} className={cn("relative flex min-w-0 items-center border-r", isDragging && "z-20 bg-muted opacity-80")}>
      <button
        type="button"
        {...attributes}
        {...listeners}
        onClick={(e) => onMenu(e.currentTarget)}
        aria-label={`${def.name} column`}
        className="flex h-9 min-w-0 flex-1 items-center gap-1.5 px-2 text-left text-[13px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Icon className="size-3.5 shrink-0" />
        <span className="truncate">{def.name}</span>
      </button>
      <span role="separator" aria-orientation="vertical" aria-label={`Resize ${def.name}`} onPointerDown={startResize} className="absolute top-0 right-0 z-10 h-full w-1.5 cursor-col-resize hover:bg-primary/40" />
    </div>
  );
}
