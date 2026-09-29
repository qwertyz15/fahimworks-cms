"use client";

import { useEffect, useState } from "react";
import {
  AlignLeft,
  ArrowDownAZ,
  ArrowUpAZ,
  AtSign,
  Calendar,
  CheckSquare,
  CircleDot,
  Clock,
  EyeOff,
  Hash,
  Heading,
  Link2,
  List,
  ListChecks,
  Paperclip,
  Phone,
  Plus,
  Trash2,
  User,
  type LucideIcon,
  ArrowUpRight,
  Layers,
  Sigma,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  ADDABLE_TYPES,
  COMPUTED_TYPES,
  NUMBER_FORMATS,
  OPTION_COLORS,
  STATUS_GROUPS,
  TYPE_LABELS,
  newId,
  type NumberFormat,
  type OptionColor,
  type PropertyConfig,
  type PropertyDef,
  type PropertyType,
  type PropertyValue,
  type SelectOption,
  type StatusGroup,
} from "@/lib/db-properties";
import { OPTION_DOT } from "./colors";
import { ROLLUP_LABELS, rollupFnsFor, type RollupFn } from "@/lib/db-rollup";
import { databasePropertiesAction, listDatabasesAction } from "@/server/actions/databases";
import { ValueDisplay, ValueEditor } from "./cells";
import type { Person } from "./types";
import type { EditorUploadConfig } from "@/components/editor/rich-editor";

export const TYPE_ICONS: Record<PropertyType, LucideIcon> = {
  TITLE: Heading,
  TEXT: AlignLeft,
  NUMBER: Hash,
  SELECT: CircleDot,
  MULTI_SELECT: List,
  STATUS: ListChecks,
  DATE: Calendar,
  CHECKBOX: CheckSquare,
  URL: Link2,
  EMAIL: AtSign,
  PHONE: Phone,
  PERSON: User,
  FILES: Paperclip,
  CREATED_TIME: Clock,
  LAST_EDITED_TIME: Clock,
  RELATION: ArrowUpRight,
  ROLLUP: Layers,
  FORMULA: Sigma,
};

const FORMAT_LABELS: Record<NumberFormat, string> = { number: "Number", comma: "Number with commas", percent: "Percent", usd: "US dollar", eur: "Euro", gbp: "Pound", bdt: "Taka" };

/** Pick a type for a new property. */
export interface RelationSetup {
  databaseId: string;
  limit: "one" | "many";
  twoWay: boolean;
  pairedName?: string;
}

export function AddPropertyMenu({ onAdd, databaseId }: { onAdd: (type: PropertyType, name: string, relation?: RelationSetup) => void; databaseId: string }) {
  const [name, setName] = useState("");
  const [relation, setRelation] = useState(false);
  if (relation) return <RelationSetupForm databaseId={databaseId} onBack={() => setRelation(false)} onCreate={(r) => onAdd("RELATION", name.trim() || "Related", r)} />;
  return (
    <div className="w-60">
      <input
        data-autofocus
        value={name}
        maxLength={100}
        onChange={(e) => setName(e.target.value)}
        placeholder="Property name"
        aria-label="Property name"
        className="mb-1 w-full rounded-md border bg-background px-2 py-1 text-[13px] outline-none focus:border-ring"
      />
      <p className="px-2 pt-1 pb-0.5 text-[11px] font-medium text-muted-foreground">Type</p>
      {ADDABLE_TYPES.map((t) => {
        const Icon = TYPE_ICONS[t];
        return (
          <button key={t} type="button" onClick={() => (t === "RELATION" ? setRelation(true) : onAdd(t, name.trim() || TYPE_LABELS[t]))} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted">
            <Icon className="size-3.5 text-muted-foreground" /> {TYPE_LABELS[t]}
          </button>
        );
      })}
    </div>
  );
}

export interface PropertyMenuActions {
  rename: (name: string) => void;
  updateConfig: (config: PropertyConfig) => Promise<unknown>;
  changeType: (type: PropertyType) => void;
  hide?: () => void;
  remove: () => void;
  sort?: (direction: "asc" | "desc") => void;
  /** Formula: open the formula editor. */
  editFormula?: () => void;
  /** Relation: turn the reverse property on / off. */
  setTwoWay?: (on: boolean, pairedName?: string) => Promise<unknown>;
}

/** Edit a property: name, type, options, format, default, hide, delete. */
export function PropertyMenu({
  def,
  actions,
  onClose,
  people,
  uploads,
  allProps = [],
}: {
  def: PropertyDef;
  actions: PropertyMenuActions;
  onClose: () => void;
  people: Person[];
  uploads: EditorUploadConfig;
  /** Every property of the database (rollups pick a relation). */
  allProps?: PropertyDef[];
}) {
  const [name, setName] = useState(def.name);
  const [typePicker, setTypePicker] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const hasOptions = def.type === "SELECT" || def.type === "MULTI_SELECT" || def.type === "STATUS";
  const options = def.config.options ?? [];
  const saveOptions = (next: SelectOption[]) => actions.updateConfig({ ...def.config, options: next });

  return (
    <div className="w-72 space-y-1">
      <input
        data-autofocus
        value={name}
        maxLength={100}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() && name !== def.name && actions.rename(name.trim())}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        aria-label="Property name"
        className="w-full rounded-md border bg-background px-2 py-1 text-[13px] font-medium outline-none focus:border-ring"
      />

      {!def.isTitle && (
        <div>
          <button type="button" disabled={def.type === "RELATION"} onClick={() => setTypePicker((v) => !v)} aria-expanded={typePicker} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted">
            <span className="text-muted-foreground">Type</span>
            <span className="flex-1" />
            {(() => {
              const Icon = TYPE_ICONS[def.type];
              return <Icon className="size-3.5 text-muted-foreground" />;
            })()}
            {TYPE_LABELS[def.type]}
          </button>
          {typePicker && (
            <div className="ml-2 border-l pl-1" role="group" aria-label="Change type">
              {ADDABLE_TYPES.filter((t) => t !== def.type && t !== "RELATION").map((t) => {
                const Icon = TYPE_ICONS[t];
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      actions.changeType(t);
                      onClose();
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] hover:bg-muted"
                  >
                    <Icon className="size-3.5 text-muted-foreground" /> {TYPE_LABELS[t]}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {def.type === "RELATION" && <RelationSettings def={def} actions={actions} />}
      {def.type === "ROLLUP" && <RollupSettings def={def} allProps={allProps} onSave={(config) => actions.updateConfig(config)} />}
      {def.type === "FORMULA" && (
        <div className="px-2 py-1">
          <button type="button" onClick={() => (actions.editFormula?.(), onClose())} className="flex w-full items-center gap-2 rounded-md border bg-muted/40 px-2 py-1.5 text-left hover:bg-muted" aria-label="Edit formula">
            <Sigma className="size-3.5 shrink-0 text-muted-foreground" />
            <code className="min-w-0 flex-1 truncate font-mono text-xs">{def.config.formula?.expression || "Write a formula…"}</code>
          </button>
        </div>
      )}

      {(def.type === "NUMBER" || ((def.type === "ROLLUP" || def.type === "FORMULA") && def.config.resultType === "number")) && (
        <label className="flex items-center gap-2 px-2 py-1 text-[13px]">
          <span className="text-muted-foreground">Format</span>
          <select
            value={def.config.numberFormat ?? "number"}
            onChange={(e) => void actions.updateConfig({ ...def.config, numberFormat: e.target.value as NumberFormat })}
            aria-label="Number format"
            className="ml-auto rounded-md border bg-background px-1.5 py-0.5 text-[13px]"
          >
            {NUMBER_FORMATS.map((f) => (
              <option key={f} value={f}>
                {FORMAT_LABELS[f]}
              </option>
            ))}
          </select>
        </label>
      )}

      {def.type === "DATE" && (
        <label className="flex items-center gap-2 px-2 py-1 text-[13px]">
          <input type="checkbox" checked={Boolean(def.config.range)} onChange={(e) => void actions.updateConfig({ ...def.config, range: e.target.checked })} />
          End date (date range)
        </label>
      )}

      {hasOptions && <OptionsList def={def} options={options} onSave={saveOptions} />}

      {!def.isTitle && !COMPUTED_TYPES.includes(def.type) && def.type !== "FILES" && (
        <DefaultValue def={def} people={people} uploads={uploads} onSave={(v) => void actions.updateConfig({ ...def.config, default: v })} onUpdateOptions={async (o) => ((await saveOptions(o)) ? o : null)} />
      )}

      <div className="border-t pt-1">
        {actions.sort && (
          <>
            <MenuButton icon={ArrowUpAZ} onClick={() => (actions.sort!("asc"), onClose())}>
              Sort ascending
            </MenuButton>
            <MenuButton icon={ArrowDownAZ} onClick={() => (actions.sort!("desc"), onClose())}>
              Sort descending
            </MenuButton>
          </>
        )}
        {actions.hide && !def.isTitle && (
          <MenuButton icon={EyeOff} onClick={() => (actions.hide!(), onClose())}>
            Hide in view
          </MenuButton>
        )}
        {!def.isTitle &&
          (confirmDelete ? (
            <div className="flex items-center gap-1 px-2 py-1 text-[13px]">
              <span className="flex-1 text-destructive">Delete for every row?</span>
              <button type="button" onClick={() => (actions.remove(), onClose())} className="rounded-md bg-destructive px-2 py-0.5 text-xs text-destructive-foreground">
                Delete
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="rounded-md px-2 py-0.5 text-xs hover:bg-muted">
                Cancel
              </button>
            </div>
          ) : (
            <MenuButton icon={Trash2} destructive onClick={() => setConfirmDelete(true)}>
              Delete property
            </MenuButton>
          ))}
      </div>
    </div>
  );
}

function MenuButton({ icon: Icon, children, onClick, destructive }: { icon: LucideIcon; children: React.ReactNode; onClick: () => void; destructive?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted", destructive && "text-destructive")}>
      <Icon className="size-3.5" /> {children}
    </button>
  );
}

function OptionsList({ def, options, onSave }: { def: PropertyDef; options: SelectOption[]; onSave: (o: SelectOption[]) => Promise<unknown> }) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const status = def.type === "STATUS";
  const update = (id: string, patch: Partial<SelectOption>) => void onSave(options.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  const add = () => {
    const name = draft.trim();
    if (!name || options.some((o) => o.name.toLowerCase() === name.toLowerCase())) return;
    void onSave([...options, { id: newId(), name, color: OPTION_COLORS[(options.length + 5) % OPTION_COLORS.length]!, ...(status ? { group: "todo" as StatusGroup } : {}) }]);
    setDraft("");
  };
  return (
    <div className="border-t pt-1">
      <p className="px-2 pb-0.5 text-[11px] font-medium text-muted-foreground">Options</p>
      {options.map((o) => (
        <div key={o.id} className="group/opt rounded-md px-2 py-0.5 hover:bg-muted/60">
          <div className="flex items-center gap-1.5">
            <button type="button" aria-label={`Colour of ${o.name}`} onClick={() => setEditing(editing === o.id ? null : o.id)} className={cn("size-3 shrink-0 rounded-full", OPTION_DOT[o.color])} />
            <input
              defaultValue={o.name}
              maxLength={100}
              onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== o.name && update(o.id, { name: e.target.value.trim() })}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              aria-label="Option name"
              className="min-w-0 flex-1 bg-transparent py-0.5 text-[13px] outline-none"
            />
            {status && (
              <select value={o.group ?? "todo"} onChange={(e) => update(o.id, { group: e.target.value as StatusGroup })} aria-label={`Group of ${o.name}`} className="rounded border bg-background px-1 text-[11px]">
                {STATUS_GROUPS.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.label}
                  </option>
                ))}
              </select>
            )}
            <button type="button" aria-label={`Delete option ${o.name}`} onClick={() => void onSave(options.filter((x) => x.id !== o.id))} className="rounded p-0.5 text-muted-foreground opacity-0 group-hover/opt:opacity-100 hover:text-destructive focus:opacity-100">
              <Trash2 className="size-3" />
            </button>
          </div>
          {editing === o.id && (
            <div className="flex flex-wrap gap-1 py-1 pl-4" role="group" aria-label="Option colour">
              {OPTION_COLORS.map((c: OptionColor) => (
                <button key={c} type="button" aria-label={c} onClick={() => (update(o.id, { color: c }), setEditing(null))} className={cn("size-4 rounded-full", OPTION_DOT[c], o.color === c && "ring-2 ring-ring ring-offset-1")} />
              ))}
            </div>
          )}
        </div>
      ))}
      <div className="flex items-center gap-1 px-2 py-0.5">
        <Plus className="size-3 text-muted-foreground" />
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="Add an option" aria-label="Add an option" className="min-w-0 flex-1 bg-transparent py-0.5 text-[13px] outline-none" />
      </div>
    </div>
  );
}

function DefaultValue({
  def,
  people,
  uploads,
  onSave,
  onUpdateOptions,
}: {
  def: PropertyDef;
  people: Person[];
  uploads: EditorUploadConfig;
  onSave: (v: PropertyValue) => void;
  onUpdateOptions: (o: SelectOption[]) => Promise<SelectOption[] | null>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t pt-1">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted">
        <span className="text-muted-foreground">Default</span>
        <span className="flex-1" />
        <span className="max-w-36 truncate">
          <ValueDisplay def={def} value={def.config.default ?? null} people={people} />
        </span>
      </button>
      {open && (
        <div className="ml-2 border-l pl-1">
          <ValueEditor def={def} value={def.config.default ?? null} people={people} onChange={onSave} onClose={() => setOpen(false)} onUpdateOptions={onUpdateOptions} uploads={uploads} rowId="" />
        </div>
      )}
    </div>
  );
}

function useDatabases() {
  const [list, setList] = useState<{ id: string; title: string; icon: string | null }[] | null>(null);
  useEffect(() => {
    let live = true;
    void listDatabasesAction().then((r) => live && setList(r.ok ? (r.data ?? []) : []));
    return () => {
      live = false;
    };
  }, []);
  return list;
}

const field = "w-full rounded-md border bg-background px-1.5 py-1 text-[13px]";

/** New relation: which database, one or many, and the reverse property. */
function RelationSetupForm({ databaseId, onBack, onCreate }: { databaseId: string; onBack: () => void; onCreate: (r: RelationSetup) => void }) {
  const dbs = useDatabases();
  const [target, setTarget] = useState("");
  const [limit, setLimit] = useState<"one" | "many">("many");
  const [twoWay, setTwoWay] = useState(true);
  const [pairedName, setPairedName] = useState("");
  const chosen = target || dbs?.[0]?.id || "";
  return (
    <div className="w-64 space-y-2 p-1 text-[13px]">
      <button type="button" onClick={onBack} className="text-xs text-muted-foreground hover:text-foreground">
        ← Back
      </button>
      <label className="block">
        <span className="text-xs text-muted-foreground">Link to</span>
        <select value={chosen} onChange={(e) => setTarget(e.target.value)} aria-label="Related database" className={cn(field, "mt-0.5")} disabled={!dbs}>
          {dbs?.map((d) => (
            <option key={d.id} value={d.id}>
              {d.icon ? `${d.icon} ` : ""}
              {d.title}
              {d.id === databaseId ? " (this database)" : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-xs text-muted-foreground">Each row links to</span>
        <select value={limit} onChange={(e) => setLimit(e.target.value as "one" | "many")} aria-label="Limit" className={cn(field, "mt-0.5")}>
          <option value="many">Any number of pages</option>
          <option value="one">One page</option>
        </select>
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={twoWay} onChange={(e) => setTwoWay(e.target.checked)} /> Show on the other database too
      </label>
      {twoWay && <input value={pairedName} onChange={(e) => setPairedName(e.target.value)} maxLength={100} placeholder="Name there (optional)" aria-label="Related property name" className={field} />}
      <Button size="sm" className="w-full" disabled={!chosen} onClick={() => onCreate({ databaseId: chosen, limit, twoWay, pairedName: pairedName.trim() || undefined })}>
        Add relation
      </Button>
    </div>
  );
}

function RelationSettings({ def, actions }: { def: PropertyDef; actions: PropertyMenuActions }) {
  const dbs = useDatabases();
  const cfg = def.config.relation;
  const [busy, setBusy] = useState(false);
  if (!cfg) return null;
  const target = dbs?.find((d) => d.id === cfg.databaseId);
  return (
    <div className="space-y-1 px-2 py-1 text-[13px]">
      <p className="flex items-center gap-1.5 text-muted-foreground">
        <ArrowUpRight className="size-3.5" /> Links to <span className="truncate font-medium text-foreground">{target ? `${target.icon ?? ""} ${target.title}` : "…"}</span>
      </p>
      <label className="flex items-center gap-2">
        <span className="text-muted-foreground">Limit</span>
        <select value={cfg.limit} onChange={(e) => void actions.updateConfig({ ...def.config, relation: { ...cfg, limit: e.target.value as "one" | "many" } })} aria-label="Limit" className="ml-auto rounded-md border bg-background px-1.5 py-0.5 text-[13px]">
          <option value="many">No limit</option>
          <option value="one">One page</option>
        </select>
      </label>
      {actions.setTwoWay && (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={Boolean(cfg.pairedId)}
            disabled={busy}
            onChange={async (e) => {
              setBusy(true);
              await actions.setTwoWay!(e.target.checked);
              setBusy(false);
            }}
          />
          Show on {target?.title ?? "the other database"}
        </label>
      )}
    </div>
  );
}

/** Rollup: relation → property → calculation. Saved once a property is picked. */
function RollupSettings({ def, allProps, onSave }: { def: PropertyDef; allProps: PropertyDef[]; onSave: (c: PropertyConfig) => Promise<unknown> }) {
  const relations = allProps.filter((p) => p.type === "RELATION");
  const cfg = def.config.rollup;
  const [relId, setRelId] = useState(cfg?.relationId ?? "");
  const relation = relations.find((r) => r.id === relId) ?? null;
  const targetDb = relation?.config.relation?.databaseId ?? null;
  const [target, setTarget] = useState<{ databaseId: string; props: PropertyDef[] } | null>(null);
  useEffect(() => {
    if (!targetDb) return;
    let live = true;
    void databasePropertiesAction({ id: targetDb }).then((r) => live && setTarget({ databaseId: targetDb, props: r.ok && r.data ? r.data.properties : [] }));
    return () => {
      live = false;
    };
  }, [targetDb]);
  const targetProps = target?.databaseId === targetDb ? target.props : null;
  const sameRelation = cfg?.relationId === relId;
  const targetDef = (sameRelation && targetProps?.find((p) => p.id === cfg?.targetId)) || null;
  const fns = targetDef ? rollupFnsFor(targetDef) : [];
  const save = (targetId: string, fn: string) => void onSave({ ...def.config, rollup: { relationId: relId, targetId, fn }, numberFormat: undefined });
  if (!relations.length) return <p className="px-2 py-1 text-xs text-muted-foreground">Add a Relation property first — a rollup calculates over the pages it links to.</p>;
  return (
    <div className="space-y-1.5 px-2 py-1 text-[13px]">
      <label className="block">
        <span className="text-xs text-muted-foreground">Relation</span>
        <select value={relId} onChange={(e) => setRelId(e.target.value)} aria-label="Rollup relation" className={cn(field, "mt-0.5")}>
          <option value="" disabled>
            Choose…
          </option>
          {relations.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      {relation && (
        <label className="block">
          <span className="text-xs text-muted-foreground">Property</span>
          <select
            value={targetDef?.id ?? ""}
            onChange={(e) => {
              const t = targetProps?.find((p) => p.id === e.target.value);
              if (!t) return;
              const ok = rollupFnsFor(t);
              save(t.id, ok.includes(cfg?.fn as RollupFn) ? cfg!.fn : ok.includes("show_original") ? "show_original" : ok[0]!);
            }}
            aria-label="Rollup property"
            className={cn(field, "mt-0.5")}
            disabled={!targetProps}
          >
            <option value="" disabled>
              {targetProps ? "Choose…" : "Loading…"}
            </option>
            {targetProps?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {targetDef && (
        <label className="block">
          <span className="text-xs text-muted-foreground">Calculate</span>
          <select value={fns.includes(cfg?.fn as RollupFn) ? cfg!.fn : ""} onChange={(e) => save(targetDef.id, e.target.value)} aria-label="Rollup calculation" className={cn(field, "mt-0.5")}>
            {fns.map((f) => (
              <option key={f} value={f}>
                {ROLLUP_LABELS[f]}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
