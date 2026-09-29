"use client";

import { useState } from "react";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
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
};

const FORMAT_LABELS: Record<NumberFormat, string> = { number: "Number", comma: "Number with commas", percent: "Percent", usd: "US dollar", eur: "Euro", gbp: "Pound", bdt: "Taka" };

/** Pick a type for a new property. */
export function AddPropertyMenu({ onAdd }: { onAdd: (type: PropertyType, name: string) => void }) {
  const [name, setName] = useState("");
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
          <button key={t} type="button" onClick={() => onAdd(t, name.trim() || TYPE_LABELS[t])} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted">
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
}

/** Edit a property: name, type, options, format, default, hide, delete. */
export function PropertyMenu({ def, actions, onClose, people, uploads }: { def: PropertyDef; actions: PropertyMenuActions; onClose: () => void; people: Person[]; uploads: EditorUploadConfig }) {
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
          <button type="button" onClick={() => setTypePicker((v) => !v)} aria-expanded={typePicker} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted">
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
              {ADDABLE_TYPES.filter((t) => t !== def.type).map((t) => {
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

      {def.type === "NUMBER" && (
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
