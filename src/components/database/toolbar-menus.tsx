"use client";

import { useMemo } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Eye, EyeOff, GripVertical, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { newId, type PropertyDef } from "@/lib/db-properties";
import {
  OPERATOR_LABELS,
  RELATIVE_DATES,
  VALUELESS,
  WITHIN_RANGES,
  operatorsFor,
  type DateFilterValue,
  type FilterGroup,
  type FilterNode,
  type FilterRule,
  type Operator,
  type SortRule,
} from "@/lib/db-views";
import { TYPE_ICONS } from "./property-menu";

const RELATIVE_LABELS: Record<(typeof RELATIVE_DATES)[number], string> = {
  today: "Today",
  tomorrow: "Tomorrow",
  yesterday: "Yesterday",
  one_week_ago: "One week ago",
  one_week_from_now: "One week from now",
  one_month_ago: "One month ago",
  one_month_from_now: "One month from now",
};
const RANGE_LABELS: Record<(typeof WITHIN_RANGES)[number], string> = {
  past_week: "the past week",
  past_month: "the past month",
  past_year: "the past year",
  next_week: "the next week",
  next_month: "the next month",
  next_year: "the next year",
};

const sel = "rounded-md border bg-background px-1.5 py-1 text-[13px] outline-none focus:border-ring";

export function countRules(node: FilterNode | null | undefined): number {
  if (!node) return 0;
  return node.kind === "rule" ? 1 : node.children.reduce((n, c) => n + countRules(c), 0);
}

function newRule(props: PropertyDef[]): FilterRule {
  const p = props[0]!;
  return { kind: "rule", id: newId(), propertyId: p.id, operator: operatorsFor(p.type)[0]! };
}

/** Filter builder: AND/OR at the top, plus groups one level deep. */
export function FilterMenu({ props, filter, onChange }: { props: PropertyDef[]; filter: FilterGroup | null | undefined; onChange: (f: FilterGroup | null) => void }) {
  const root: FilterGroup = filter ?? { kind: "group", id: newId(), op: "and", children: [] };
  const set = (g: FilterGroup) => onChange(g.children.length ? g : null);
  return (
    <div className="w-[34rem] max-w-[90vw] space-y-2 p-1">
      <GroupEditor group={root} props={props} depth={0} onChange={set} />
      {root.children.length === 0 && <p className="px-1 text-xs text-muted-foreground">No filters. Add one to narrow down the rows in this view.</p>}
    </div>
  );
}

function GroupEditor({ group, props, depth, onChange, onRemove }: { group: FilterGroup; props: PropertyDef[]; depth: number; onChange: (g: FilterGroup) => void; onRemove?: () => void }) {
  const replace = (id: string, node: FilterNode | null) => onChange({ ...group, children: node ? group.children.map((c) => (c.id === id ? node : c)) : group.children.filter((c) => c.id !== id) });
  return (
    <div className={cn("space-y-1.5", depth > 0 && "rounded-lg border bg-muted/30 p-2")} role="group" aria-label={depth ? "Filter group" : "Filters"}>
      {group.children.map((c, i) => (
        <div key={c.id} className="flex items-start gap-1.5">
          <span className="w-14 shrink-0 pt-1 text-right text-xs text-muted-foreground">
            {i === 0 ? (
              "Where"
            ) : i === 1 ? (
              <select value={group.op} onChange={(e) => onChange({ ...group, op: e.target.value as "and" | "or" })} aria-label="Combine with" className={cn(sel, "w-14 px-1")}>
                <option value="and">and</option>
                <option value="or">or</option>
              </select>
            ) : (
              group.op
            )}
          </span>
          <div className="min-w-0 flex-1">
            {c.kind === "rule" ? (
              <RuleEditor rule={c} props={props} onChange={(r) => replace(c.id, r)} onRemove={() => replace(c.id, null)} />
            ) : (
              <GroupEditor group={c} props={props} depth={depth + 1} onChange={(g) => replace(c.id, g.children.length ? g : null)} onRemove={() => replace(c.id, null)} />
            )}
          </div>
        </div>
      ))}
      <div className="flex items-center gap-1 pl-[3.875rem]">
        <button type="button" onClick={() => onChange({ ...group, children: [...group.children, newRule(props)] })} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
          <Plus className="size-3" /> Add filter
        </button>
        {depth === 0 && (
          <button
            type="button"
            onClick={() => onChange({ ...group, children: [...group.children, { kind: "group", id: newId(), op: group.op === "and" ? "or" : "and", children: [newRule(props)] }] })}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Plus className="size-3" /> Add filter group
          </button>
        )}
        {onRemove && (
          <button type="button" onClick={onRemove} className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:text-destructive">
            <Trash2 className="size-3" /> Remove group
          </button>
        )}
      </div>
    </div>
  );
}

function RuleEditor({ rule, props, onChange, onRemove }: { rule: FilterRule; props: PropertyDef[]; onChange: (r: FilterRule) => void; onRemove: () => void }) {
  const def = props.find((p) => p.id === rule.propertyId) ?? props[0]!;
  const ops = operatorsFor(def.type);
  return (
    <div className="flex flex-wrap items-center gap-1" data-testid="filter-rule">
      <select
        value={def.id}
        onChange={(e) => {
          const p = props.find((x) => x.id === e.target.value)!;
          onChange({ kind: "rule", id: rule.id, propertyId: p.id, operator: operatorsFor(p.type)[0]! });
        }}
        aria-label="Filter property"
        className={cn(sel, "max-w-40")}
      >
        {props.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <select value={rule.operator} onChange={(e) => onChange({ ...rule, operator: e.target.value as Operator, value: undefined })} aria-label="Condition" className={sel}>
        {ops.map((o) => (
          <option key={o} value={o}>
            {OPERATOR_LABELS[o]}
          </option>
        ))}
      </select>
      {!VALUELESS.includes(rule.operator) && <RuleValue def={def} rule={rule} onChange={onChange} />}
      <button type="button" aria-label="Remove filter" onClick={onRemove} className="rounded p-1 text-muted-foreground hover:text-destructive">
        <X className="size-3.5" />
      </button>
    </div>
  );
}

function RuleValue({ def, rule, onChange }: { def: PropertyDef; rule: FilterRule; onChange: (r: FilterRule) => void }) {
  const set = (value: FilterRule["value"]) => onChange({ ...rule, value });
  switch (def.type) {
    case "SELECT":
    case "STATUS":
    case "MULTI_SELECT":
      if (rule.operator === "group_is")
        return (
          <select value={(rule.value as string) ?? ""} onChange={(e) => set(e.target.value)} aria-label="Value" className={sel}>
            <option value="">Choose…</option>
            <option value="todo">To-do</option>
            <option value="in_progress">In progress</option>
            <option value="complete">Complete</option>
          </select>
        );
      return (
        <select value={(rule.value as string) ?? ""} onChange={(e) => set(e.target.value || null)} aria-label="Value" className={cn(sel, "max-w-40")}>
          <option value="">Choose…</option>
          {(def.config.options ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      );
    case "DATE":
    case "CREATED_TIME":
    case "LAST_EDITED_TIME": {
      const v = (rule.value ?? {}) as DateFilterValue;
      if (rule.operator === "within")
        return (
          <select value={v.range ?? ""} onChange={(e) => set(e.target.value ? { range: e.target.value as DateFilterValue["range"] } : null)} aria-label="Range" className={sel}>
            <option value="">Choose…</option>
            {WITHIN_RANGES.map((r) => (
              <option key={r} value={r}>
                {RANGE_LABELS[r]}
              </option>
            ))}
          </select>
        );
      return (
        <>
          <select value={v.relative ?? (v.date ? "exact" : "")} onChange={(e) => set(e.target.value === "exact" ? { date: v.date ?? new Date().toISOString().slice(0, 10) } : e.target.value ? { relative: e.target.value as DateFilterValue["relative"] } : null)} aria-label="Date" className={sel}>
            <option value="">Choose…</option>
            {RELATIVE_DATES.map((r) => (
              <option key={r} value={r}>
                {RELATIVE_LABELS[r]}
              </option>
            ))}
            <option value="exact">Exact date…</option>
          </select>
          {v.date !== undefined && <input type="date" value={v.date} onChange={(e) => set({ date: e.target.value })} aria-label="Exact date" className={sel} />}
        </>
      );
    }
    case "NUMBER":
      return <input type="number" value={(rule.value as number | undefined) ?? ""} onChange={(e) => set(e.target.value === "" ? null : Number(e.target.value))} aria-label="Value" className={cn(sel, "w-24")} />;
    case "PERSON":
      return <input value={(rule.value as string) ?? ""} onChange={(e) => set(e.target.value)} aria-label="Person id" className={cn(sel, "w-32")} />;
    default:
      return <input value={(rule.value as string) ?? ""} onChange={(e) => set(e.target.value)} placeholder="Value" aria-label="Value" className={cn(sel, "w-40")} />;
  }
}

/** Sort rules, applied in order. */
export function SortMenu({ props, sorts, onChange }: { props: PropertyDef[]; sorts: SortRule[]; onChange: (s: SortRule[]) => void }) {
  const used = new Set(sorts.map((s) => s.propertyId));
  const free = props.filter((p) => !used.has(p.id));
  return (
    <div className="w-80 space-y-1.5 p-1">
      {sorts.map((s, i) => (
        <div key={s.propertyId} className="flex items-center gap-1" data-testid="sort-rule">
          <span className="w-10 text-xs text-muted-foreground">{i === 0 ? "Sort" : "then"}</span>
          <select value={s.propertyId} onChange={(e) => onChange(sorts.map((x, j) => (j === i ? { ...x, propertyId: e.target.value } : x)))} aria-label="Sort property" className={cn(sel, "min-w-0 flex-1")}>
            {props.filter((p) => p.id === s.propertyId || !used.has(p.id)).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select value={s.direction} onChange={(e) => onChange(sorts.map((x, j) => (j === i ? { ...x, direction: e.target.value as "asc" | "desc" } : x)))} aria-label="Direction" className={sel}>
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
          <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => onChange(arrayMove(sorts, i, i - 1))} className="rounded px-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-30">
            ↑
          </button>
          <button type="button" aria-label="Remove sort" onClick={() => onChange(sorts.filter((_, j) => j !== i))} className="rounded p-1 text-muted-foreground hover:text-destructive">
            <X className="size-3.5" />
          </button>
        </div>
      ))}
      {free.length > 0 && (
        <button type="button" onClick={() => onChange([...sorts, { propertyId: free[0]!.id, direction: "asc" }])} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
          <Plus className="size-3" /> Add sort
        </button>
      )}
    </div>
  );
}

/** Show/hide and reorder properties in a view. */
export function PropertiesMenu({
  props,
  hidden,
  onToggle,
  onReorder,
  onAdd,
  onEdit,
}: {
  props: PropertyDef[];
  hidden: Set<string>;
  onToggle: (id: string) => void;
  onReorder: (ids: string[]) => void;
  onAdd: () => void;
  onEdit: (def: PropertyDef, anchor: HTMLElement) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const itemIds = useMemo(() => props.map((p) => p.id), [props]);
  const onEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const ids = itemIds;
    onReorder(arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))));
  };
  return (
    <div className="w-64">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onEnd}>
        <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
          {props.map((p) => (
            <PropertyRow key={p.id} def={p} hidden={hidden.has(p.id)} onToggle={() => onToggle(p.id)} onEdit={onEdit} />
          ))}
        </SortableContext>
      </DndContext>
      <button type="button" onClick={onAdd} className="mt-1 flex w-full items-center gap-1.5 rounded-md border-t px-2 py-1.5 text-left text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground">
        <Plus className="size-3.5" /> New property
      </button>
    </div>
  );
}

function PropertyRow({ def, hidden, onToggle, onEdit }: { def: PropertyDef; hidden: boolean; onToggle: () => void; onEdit: (def: PropertyDef, anchor: HTMLElement) => void }) {
  const { setNodeRef, attributes, listeners, transform, transition } = useSortable({ id: def.id });
  const Icon = TYPE_ICONS[def.type];
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className="flex items-center gap-1.5 rounded-md px-1 py-1 hover:bg-muted" data-testid="property-row">
      <button type="button" {...attributes} {...listeners} aria-label={`Move ${def.name}`} className="cursor-grab rounded p-0.5 text-muted-foreground active:cursor-grabbing">
        <GripVertical className="size-3.5" />
      </button>
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <button type="button" onClick={(e) => onEdit(def, e.currentTarget)} className="min-w-0 flex-1 truncate text-left text-[13px]">
        {def.name}
      </button>
      {!def.isTitle && (
        <button type="button" aria-label={hidden ? `Show ${def.name}` : `Hide ${def.name}`} aria-pressed={!hidden} onClick={onToggle} className="rounded p-0.5 text-muted-foreground hover:text-foreground">
          {hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </button>
      )}
    </div>
  );
}
