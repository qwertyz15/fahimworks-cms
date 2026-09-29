"use client";

import { useRef, useState } from "react";
import { AlertTriangle, Check, FileText, Link2, Loader2, Mail, Phone, Plus, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { STATUS_GROUPS, behavesAs, formatNumber, isComputedError, isResultProp, newId, type DateValue, type FileValue, type OptionColor, type PropertyDef, type PropertyValue, type SelectOption } from "@/lib/db-properties";
import { uploadFile, kindOf } from "@/components/editor/upload";
import type { EditorUploadConfig } from "@/components/editor/rich-editor";
import { OPTION_CHIP, OPTION_DOT } from "./colors";
import type { Person, Row } from "./types";
import { RelationChips, RelationEditor } from "./relation-editor";

const dateFmt = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
export const fmtDate = (d: string) => dateFmt.format(new Date(`${d}T00:00:00`));

export function OptionChip({ option, className }: { option: SelectOption; className?: string }) {
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1 truncate rounded px-1.5 py-px text-xs font-medium", OPTION_CHIP[option.color], className)} data-option={option.name}>
      {option.group && <span className={cn("size-1.5 shrink-0 rounded-full", OPTION_DOT[option.color])} aria-hidden />}
      <span className="truncate">{option.name}</span>
    </span>
  );
}

/** Read-only rendering of one value (cells, cards, list, page properties). */
export function ValueDisplay({ def, value, row, people, wrap }: { def: PropertyDef; value: PropertyValue | undefined; row?: Row; people: Person[]; wrap?: boolean }) {
  const empty = <span className="text-muted-foreground/40">—</span>;
  if (def.type === "CREATED_TIME") return row ? <span className="text-muted-foreground">{timeFmt.format(new Date(row.createdAt))}</span> : empty;
  if (def.type === "LAST_EDITED_TIME") return row ? <span className="text-muted-foreground">{timeFmt.format(new Date(row.updatedAt))}</span> : empty;
  if (isResultProp(def)) return <ResultDisplay def={def} value={value} wrap={wrap} />;
  if (def.type === "CHECKBOX")
    return (
      <span className={cn("inline-flex size-4 items-center justify-center rounded border", value ? "border-primary bg-primary text-primary-foreground" : "border-input bg-surface")} aria-label={value ? "Checked" : "Not checked"} role="img">
        {value ? <Check className="size-3" strokeWidth={3} /> : null}
      </span>
    );
  if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) return empty;
  const opts = def.config.options ?? [];
  switch (def.type) {
    case "SELECT":
    case "STATUS": {
      const o = opts.find((x) => x.id === value);
      return o ? <OptionChip option={o} /> : empty;
    }
    case "MULTI_SELECT":
      return (
        <span className={cn("flex gap-1", wrap ? "flex-wrap" : "overflow-hidden")}>
          {(value as string[]).map((id) => opts.find((o) => o.id === id)).filter(Boolean).map((o) => <OptionChip key={o!.id} option={o!} />)}
        </span>
      );
    case "NUMBER":
      return <span className="tabular-nums">{formatNumber(value as number, def.config.numberFormat)}</span>;
    case "DATE": {
      const d = value as DateValue;
      return <span>{d.end ? `${fmtDate(d.start)} → ${fmtDate(d.end)}` : fmtDate(d.start)}</span>;
    }
    case "URL":
      return (
        <a href={value as string} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="truncate text-primary underline-offset-2 hover:underline">
          {(value as string).replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
        </a>
      );
    case "EMAIL":
      return (
        <a href={`mailto:${value as string}`} onClick={(e) => e.stopPropagation()} className="truncate text-primary underline-offset-2 hover:underline">
          {value as string}
        </a>
      );
    case "PERSON":
      return (
        <span className="flex gap-1 overflow-hidden">
          {(value as string[]).map((id) => people.find((p) => p.id === id)).filter(Boolean).map((p) => (
            <span key={p!.id} className="inline-flex items-center gap-1 truncate text-xs">
              <span className="flex size-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">{p!.name.slice(0, 1).toUpperCase()}</span>
              {p!.name}
            </span>
          ))}
        </span>
      );
    case "RELATION":
      return <RelationChips ids={value as string[]} wrap={wrap} />;
    case "FILES":
      return (
        <span className="flex gap-1 overflow-hidden">
          {(value as FileValue[]).map((f) => (
            <a key={f.url} href={f.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex max-w-40 items-center gap-1 truncate rounded bg-muted px-1.5 py-px text-xs hover:text-primary">
              <FileText className="size-3 shrink-0" /> <span className="truncate">{f.name}</span>
            </a>
          ))}
        </span>
      );
    default:
      return <span className={wrap ? "whitespace-pre-wrap" : "truncate"}>{String(value)}</span>;
  }
}

/** A rollup / formula result, shown as its result type; errors show ⚠ with the message. */
function ResultDisplay({ def, value, wrap }: { def: PropertyDef; value: PropertyValue | undefined; wrap?: boolean }) {
  if (isComputedError(value))
    return (
      <span className="inline-flex items-center gap-1 truncate text-xs text-amber-600 dark:text-amber-400" title={value.error} data-formula-error>
        <AlertTriangle className="size-3.5 shrink-0" /> <span className="truncate">{value.error}</span>
      </span>
    );
  const type = behavesAs(def);
  if (type === "CHECKBOX")
    return (
      <span className={cn("inline-flex size-4 items-center justify-center rounded border opacity-80", value ? "border-primary bg-primary text-primary-foreground" : "border-input bg-surface")} aria-label={value ? "Checked" : "Not checked"} role="img">
        {value ? <Check className="size-3" strokeWidth={3} /> : null}
      </span>
    );
  if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) return <span className="text-muted-foreground/40">—</span>;
  if (type === "NUMBER" && typeof value === "number") {
    if (def.config.numberFormat === "percent" && def.type === "ROLLUP")
      return (
        <span className="flex w-full items-center gap-2" data-result>
          <span className="tabular-nums">{formatNumber(value, "percent")}</span>
          <span className="h-1.5 min-w-8 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
            <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
          </span>
        </span>
      );
    return <span className="tabular-nums" data-result>{formatNumber(value, def.config.numberFormat)}</span>;
  }
  if (type === "DATE" && typeof value === "object" && !Array.isArray(value) && "start" in value) {
    const d = value as DateValue;
    return <span data-result>{d.end ? `${fmtDate(d.start)} → ${fmtDate(d.end)}` : fmtDate(d.start)}</span>;
  }
  if (Array.isArray(value))
    return (
      <span className={cn("flex gap-1", wrap ? "flex-wrap" : "overflow-hidden")} data-result>
        {(value as string[]).map((t, i) => (
          <span key={i} className="shrink-0 truncate rounded bg-muted px-1.5 py-px text-xs">
            {t}
          </span>
        ))}
      </span>
    );
  return <span className={wrap ? "whitespace-pre-wrap" : "truncate"} data-result>{String(value)}</span>;
}

/** Editing UI for one value (inside a popover). `onChange(null)` clears it. */
export function ValueEditor({
  def,
  value,
  people,
  onChange,
  onClose,
  onUpdateOptions,
  uploads,
  rowId,
}: {
  def: PropertyDef;
  value: PropertyValue | undefined;
  people: Person[];
  onChange: (v: PropertyValue) => void;
  onClose: () => void;
  /** Save a property's new options (creating an option from the editor). */
  onUpdateOptions: (options: SelectOption[]) => Promise<SelectOption[] | null>;
  uploads: EditorUploadConfig;
  rowId: string;
}) {
  switch (def.type) {
    case "TEXT":
    case "URL":
    case "EMAIL":
    case "PHONE":
    case "NUMBER":
      return <TextEditor def={def} value={value} onChange={onChange} onClose={onClose} />;
    case "SELECT":
    case "STATUS":
    case "MULTI_SELECT":
      return <OptionsEditor def={def} value={value} onChange={onChange} onClose={onClose} onUpdateOptions={onUpdateOptions} />;
    case "DATE":
      return <DateEditor def={def} value={value as DateValue | null} onChange={onChange} />;
    case "PERSON":
      return (
        <div className="w-56 space-y-0.5" role="listbox" aria-label={def.name} aria-multiselectable>
          {people.map((p) => {
            const on = Array.isArray(value) && (value as string[]).includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => onChange(on ? (value as string[]).filter((x) => x !== p.id) : [...((value as string[]) ?? []), p.id])}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted"
              >
                <span className="flex size-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">{p.name.slice(0, 1).toUpperCase()}</span>
                <span className="flex-1 truncate">{p.name}</span>
                {on && <Check className="size-3.5 text-primary" />}
              </button>
            );
          })}
        </div>
      );
    case "RELATION":
      return <RelationEditor def={def} value={value} onChange={onChange} onClose={onClose} />;
    case "ROLLUP":
    case "FORMULA":
      return <p className="px-2 py-1.5 text-xs text-muted-foreground">Calculated automatically.</p>;
    case "FILES":
      return <FilesEditor value={(value as FileValue[] | null) ?? []} onChange={onChange} uploads={uploads} rowId={rowId} />;
    default:
      return <p className="px-2 py-1.5 text-xs text-muted-foreground">This value is set automatically.</p>;
  }
}

function TextEditor({ def, value, onChange, onClose }: { def: PropertyDef; value: PropertyValue | undefined; onChange: (v: PropertyValue) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(value === null || value === undefined ? "" : String(value));
  const commit = () => {
    const v = draft.trim();
    if (def.type === "NUMBER") onChange(v === "" ? null : Number(v.replace(/,/g, "")));
    else onChange(def.type === "TEXT" ? draft : v || null);
  };
  const Icon = def.type === "URL" ? Link2 : def.type === "EMAIL" ? Mail : def.type === "PHONE" ? Phone : null;
  const multiline = def.type === "TEXT";
  return (
    <div className="flex w-72 items-start gap-1.5 p-0.5">
      {Icon && <Icon className="mt-2 size-3.5 shrink-0 text-muted-foreground" />}
      {multiline ? (
        <textarea
          data-autofocus
          value={draft}
          rows={3}
          maxLength={2000}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              commit();
              onClose();
            }
          }}
          aria-label={def.name}
          className="w-full resize-none rounded-md bg-transparent px-1.5 py-1 text-[13px] outline-none"
        />
      ) : (
        <input
          data-autofocus
          value={draft}
          inputMode={def.type === "NUMBER" ? "decimal" : def.type === "PHONE" ? "tel" : def.type === "EMAIL" ? "email" : "url"}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
              onClose();
            }
          }}
          aria-label={def.name}
          placeholder={def.type === "URL" ? "https://…" : def.type === "EMAIL" ? "name@example.com" : ""}
          className="w-full rounded-md bg-transparent px-1.5 py-1 text-[13px] outline-none"
        />
      )}
    </div>
  );
}

const CYCLE: OptionColor[] = ["blue", "green", "orange", "purple", "pink", "yellow", "red", "brown", "gray"];

function OptionsEditor({
  def,
  value,
  onChange,
  onClose,
  onUpdateOptions,
}: {
  def: PropertyDef;
  value: PropertyValue | undefined;
  onChange: (v: PropertyValue) => void;
  onClose: () => void;
  onUpdateOptions: (options: SelectOption[]) => Promise<SelectOption[] | null>;
}) {
  const multi = def.type === "MULTI_SELECT";
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const options = def.config.options ?? [];
  const selected = multi ? ((value as string[] | null) ?? []) : value ? [value as string] : [];
  const shown = options.filter((o) => o.name.toLowerCase().includes(q.trim().toLowerCase()));
  const exact = options.find((o) => o.name.toLowerCase() === q.trim().toLowerCase());
  const toggle = (id: string) => {
    if (multi) onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
    else {
      onChange(selected[0] === id ? null : id);
      onClose();
    }
  };
  const create = async () => {
    const name = q.trim();
    if (!name || exact || busy) return;
    setBusy(true);
    const option: SelectOption = { id: newId(), name, color: CYCLE[options.length % CYCLE.length]!, ...(def.type === "STATUS" ? { group: "todo" as const } : {}) };
    const saved = await onUpdateOptions([...options, option]);
    setBusy(false);
    const created = saved?.find((o) => o.name === name);
    if (created) {
      setQ("");
      toggle(created.id);
    }
  };
  const groups = def.type === "STATUS" ? STATUS_GROUPS : [{ id: null, label: null }];
  return (
    <div className="w-64">
      <input
        data-autofocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (exact) toggle(exact.id);
            else if (shown.length === 1 && q.trim()) toggle(shown[0]!.id);
            else void create();
          }
        }}
        placeholder={def.type === "STATUS" ? "Search status…" : "Search or create…"}
        aria-label={`Search ${def.name}`}
        className="mb-1 w-full rounded-md border bg-background px-2 py-1 text-[13px] outline-none focus:border-ring"
      />
      <div role="listbox" aria-label={def.name} aria-multiselectable={multi}>
        {groups.map((g) => {
          const list = shown.filter((o) => g.id === null || o.group === g.id);
          if (!list.length) return null;
          return (
            <div key={g.id ?? "all"}>
              {g.label && <p className="px-2 pt-1.5 pb-0.5 text-[11px] font-medium text-muted-foreground">{g.label}</p>}
              {list.map((o) => (
                <button key={o.id} type="button" role="option" aria-selected={selected.includes(o.id)} onClick={() => toggle(o.id)} className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-muted">
                  <OptionChip option={o} className="max-w-48" />
                  <span className="flex-1" />
                  {selected.includes(o.id) && <Check className="size-3.5 text-primary" />}
                </button>
              ))}
            </div>
          );
        })}
        {q.trim() && !exact && (
          <button type="button" onClick={() => void create()} disabled={busy} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted">
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Create <OptionChip option={{ id: "new", name: q.trim(), color: CYCLE[options.length % CYCLE.length]! }} />
          </button>
        )}
        {!shown.length && !q.trim() && <p className="px-2 py-1.5 text-xs text-muted-foreground">No options yet — type to create one.</p>}
      </div>
      {selected.length > 0 && (
        <button type="button" onClick={() => onChange(null)} className="mt-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted">
          <X className="size-3" /> Clear
        </button>
      )}
    </div>
  );
}

function DateEditor({ def, value, onChange }: { def: PropertyDef; value: DateValue | null; onChange: (v: PropertyValue) => void }) {
  const [start, setStart] = useState(value?.start ?? "");
  const [end, setEnd] = useState(value?.end ?? "");
  const commit = (s: string, e: string) => onChange(s ? { start: s, ...(def.config.range && e && e >= s ? { end: e } : {}) } : null);
  return (
    <div className="w-64 space-y-2 p-1">
      <label className="block text-xs text-muted-foreground">
        {def.config.range ? "Start" : "Date"}
        <input
          data-autofocus
          type="date"
          value={start}
          onChange={(e) => {
            setStart(e.target.value);
            commit(e.target.value, end);
          }}
          className="mt-0.5 block w-full rounded-md border bg-background px-2 py-1 text-[13px] text-foreground outline-none focus:border-ring"
        />
      </label>
      {def.config.range && (
        <label className="block text-xs text-muted-foreground">
          End
          <input
            type="date"
            value={end}
            min={start || undefined}
            onChange={(e) => {
              setEnd(e.target.value);
              commit(start, e.target.value);
            }}
            className="mt-0.5 block w-full rounded-md border bg-background px-2 py-1 text-[13px] text-foreground outline-none focus:border-ring"
          />
        </label>
      )}
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => {
            const t = new Date();
            const s = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
            setStart(s);
            commit(s, end);
          }}
          className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          Today
        </button>
        {start && (
          <button
            type="button"
            onClick={() => {
              setStart("");
              setEnd("");
              onChange(null);
            }}
            className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

function FilesEditor({ value, onChange, uploads, rowId }: { value: FileValue[]; onChange: (v: PropertyValue) => void; uploads: EditorUploadConfig; rowId: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const add = async (files: File[]) => {
    if (!uploads.enabled) {
      toast.error("Uploads aren't set up yet — add the S3_* variables in Vercel.");
      return;
    }
    let next = [...value];
    for (const file of files) {
      const kind = kindOf(file);
      if (!kind) {
        toast.error(`“${file.name}” can't be uploaded here.`);
        continue;
      }
      setBusy(0);
      try {
        const url = await uploadFile(file, kind, { pageId: rowId, maxBytes: kind === "image" ? uploads.maxBytes : uploads.maxMediaBytes, onProgress: setBusy });
        next = [...next, { url, name: file.name, size: file.size, mime: file.type }];
        onChange(next);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Upload failed.");
      }
    }
    setBusy(null);
  };
  return (
    <div className="w-72 space-y-1 p-0.5">
      {value.map((f) => (
        <div key={f.url} className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-muted">
          <FileText className="size-3.5 shrink-0 text-muted-foreground" />
          <a href={f.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-[13px] hover:text-primary">
            {f.name}
          </a>
          <button type="button" aria-label={`Remove ${f.name}`} onClick={() => onChange(value.filter((x) => x.url !== f.url))} className="rounded p-0.5 text-muted-foreground hover:text-destructive">
            <Trash2 className="size-3.5" />
          </button>
        </div>
      ))}
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length) void add(files);
        }}
      />
      <button type="button" data-autofocus onClick={() => input.current?.click()} disabled={busy !== null} className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60">
        {busy !== null ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
        {busy !== null ? `Uploading… ${busy}%` : "Upload a file"}
      </button>
    </div>
  );
}
