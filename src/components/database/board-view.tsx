"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { STATUS_GROUPS, type SelectOption } from "@/lib/db-properties";
import { OptionChip } from "./cells";
import { RowCard } from "./card";
import type { PropertyDef, Row } from "./types";
import type { ViewProps } from "./view-props";

const NONE = "__none__";
const EMPTY: string[] = [];
/** No layout animation after a drop: dnd-kit's derived-transform animation can loop when a card changes column. */
const noLayoutAnimation = () => false;

export function BoardView(p: ViewProps) {
  const group = p.allProps.find((d) => d.id === p.view.config.groupBy && (d.type === "SELECT" || d.type === "STATUS"));
  const choices = p.allProps.filter((d) => d.type === "SELECT" || d.type === "STATUS");

  if (!group) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground" data-testid="board-view">
        {choices.length ? (
          <>
            Choose a property to group by:{" "}
            <select onChange={(e) => p.onUpdateView({ groupBy: e.target.value })} defaultValue="" aria-label="Group by" className="ml-1 rounded-md border bg-background px-2 py-1 text-sm">
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
          "A board groups cards by a Select or Status property. Add one to this database first."
        )}
      </div>
    );
  }
  return <Board {...p} group={group} />;
}

function orderedOptions(def: PropertyDef): SelectOption[] {
  const opts = def.config.options ?? [];
  if (def.type !== "STATUS") return opts;
  return STATUS_GROUPS.flatMap((g) => opts.filter((o) => (o.group ?? "todo") === g.id));
}

function Board(p: ViewProps & { group: PropertyDef }) {
  const { group } = p;
  const options = orderedOptions(group);
  const columnKeys = [...options.map((o) => o.id), ...(p.view.config.hideEmptyGroup ? [] : [NONE])];
  const keyOf = (r: Row) => {
    const v = r.values[group.id];
    return typeof v === "string" && options.some((o) => o.id === v) ? v : NONE;
  };
  // Stable arrays: SortableContext re-measures whenever `items` changes identity, so
  // rebuilding them every render loops forever after a drop.
  const columnKeysKey = columnKeys.join("|");
  const base = useMemo(
    () => Object.fromEntries(columnKeysKey.split("|").map((k) => [k, p.rows.filter((r) => keyOf(r) === k).map((r) => r.id)])),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyOf depends only on group + options (in columnKeysKey)
    [p.rows, columnKeysKey, group.id],
  );
  const columns = base;
  const [activeId, setActiveId] = useState<string | null>(null);
  const byId = new Map(p.rows.map((r) => [r.id, r]));
  const cardProps = p.props.filter((d) => !d.isTitle && d.id !== group.id);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const colOf = (id: string) => (id in columns ? id : Object.keys(columns).find((k) => columns[k]!.includes(id)));

  /*
   * Cards only move on drop. Moving them between columns while dragging (onDragOver)
   * reflows the columns, which changes what's under the pointer, which moves the card
   * back — an update loop. The target column is highlighted instead.
   */
  const onEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    if (!over) return;
    const id = String(active.id);
    const from = colOf(id);
    const to = colOf(String(over.id));
    if (!from || !to) return;
    const moved = from !== to;
    const list = columns[to]!.filter((x) => x !== id);
    let at = list.length;
    if (over.id !== to) {
      const overIdx = list.indexOf(String(over.id));
      if (overIdx >= 0) {
        // Dropping on a card below the dragged one (same column) goes after it.
        const wasBefore = !moved && columns[to]!.indexOf(id) < columns[to]!.indexOf(String(over.id));
        at = overIdx + (wasBefore ? 1 : 0);
      }
    }
    if (!moved && (!p.canReorder || columns[to]!.indexOf(id) === at)) return;
    p.onMoveRow(id, {
      afterId: p.canReorder ? (list[at - 1] ?? null) : null,
      beforeId: p.canReorder ? (list[at] ?? null) : null,
      ...(moved ? { set: { [group.id]: to === NONE ? null : to } } : {}),
    });
  };

  const active = activeId ? byId.get(activeId) : undefined;
  return (
    <div className="space-y-2" data-testid="board-view">
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))} onDragEnd={onEnd} onDragCancel={() => setActiveId(null)}>
        <div className="flex gap-3 overflow-x-auto pb-3">
          {columnKeys.map((k) => {
            const option = options.find((o) => o.id === k);
            const ids = columns[k] ?? EMPTY;
            return (
              <Column key={k} id={k} width={p.view.config.cardSize === "large" ? "w-80" : p.view.config.cardSize === "small" ? "w-52" : "w-64"} label={option ? <OptionChip option={option} /> : <span className="text-xs font-medium text-muted-foreground">No {group.name}</span>} count={ids.length}>
                <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                  {ids.map((rid) => {
                    const row = byId.get(rid);
                    return row ? <Card key={rid} row={row} props={cardProps} p={p} /> : null;
                  })}
                </SortableContext>
                <button
                  type="button"
                  onClick={() => void p.onCreateRow({ values: k === NONE ? {} : { [group.id]: k } })}
                  className="flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-background hover:text-foreground"
                  aria-label={`New in ${option?.name ?? `No ${group.name}`}`}
                >
                  <Plus className="size-3.5" /> New
                </button>
              </Column>
            );
          })}
        </div>
        <DragOverlay>{active ? <RowCard row={active} props={cardProps} people={p.people} config={p.view.config} className="rotate-1 shadow-pop" /> : null}</DragOverlay>
      </DndContext>
      {!p.canReorder && <p className="text-xs text-muted-foreground">This view is sorted, so cards keep their sorted order within a column. Remove the sort to arrange cards by hand.</p>}
    </div>
  );
}

function Column({ id, label, count, children, width }: { id: string; label: React.ReactNode; count: number; children: React.ReactNode; width: string }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <section ref={setNodeRef} className={cn("flex shrink-0 flex-col gap-2 rounded-xl border bg-surface-2 p-2", width, isOver && "ring-2 ring-primary/40")} aria-label={`Column ${typeof label === "string" ? label : id}`} data-testid="board-column" data-column={id}>
      <header className="flex items-center gap-2 px-1">
        {label}
        <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
      </header>
      <div className="flex min-h-10 flex-col gap-2">{children}</div>
    </section>
  );
}

function Card({ row, props, p }: { row: Row; props: PropertyDef[]; p: ViewProps }) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: row.id, animateLayoutChanges: noLayoutAnimation });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} {...attributes} {...listeners} className={cn(isDragging && "opacity-40")}>
      <RowCard row={row} props={props} people={p.people} config={p.view.config} onOpen={() => p.onOpenRow(row.id)} />
    </div>
  );
}
