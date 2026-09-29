"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import type { JSONContent } from "@tiptap/react";
import { AlertCircle, ArrowLeft, Check, ImagePlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { COMPUTED_TYPES, type PropertyValue, type SelectOption } from "@/lib/db-properties";
import { savePageAction, updatePropertyAction, updateRowAction } from "@/server/actions/databases";
import { Button } from "@/components/ui/button";
import { useRichEditor, type EditorUploadConfig } from "@/components/editor/rich-editor";
import { ValueDisplay, ValueEditor } from "./cells";
import { EmojiPicker } from "./emoji-picker";
import { Popover } from "./popover";
import { TYPE_ICONS } from "./property-menu";
import type { Person, PropertyDef, Row } from "./types";

/** Saves this long after the last edit (Ctrl+S saves immediately). */
const AUTOSAVE_MS = 1500;
const timeFmt = new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit" });

export function PageScreen(init: {
  page: { id: string; title: string; icon: string | null; coverImage: string | null; body: JSONContent | null; updatedAt: string; createdAt: string; values: Row["values"] };
  database: { id: string; title: string; icon: string | null } | null;
  properties: PropertyDef[];
  people: Person[];
  uploads: EditorUploadConfig;
}) {
  const pageId = init.page.id;
  const [title, setTitle] = useState(init.page.title);
  const [icon, setIcon] = useState(init.page.icon);
  const [cover, setCover] = useState(init.page.coverImage);
  const [row, setRow] = useState<Row>({ id: pageId, title: init.page.title, icon: init.page.icon, values: init.page.values, position: "", createdAt: init.page.createdAt, updatedAt: init.page.updatedAt });
  const [props, setProps] = useState(init.properties);
  const [editing, setEditing] = useState<{ def: PropertyDef; anchor: HTMLElement } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [tick, setTick] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(init.page.updatedAt);
  const changes = useRef(0);
  const inFlight = useRef(false);
  const queued = useRef(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);

  const markDirty = useCallback(() => {
    changes.current += 1;
    setDirty(true);
    setTick((t) => t + 1);
  }, []);

  const rich = useRichEditor({ initialBody: init.page.body, uploads: init.uploads, uploadTarget: () => ({ pageId }), onChange: markDirty, ariaLabel: "Page content" });
  const { editor, uploading } = rich;
  const coverRef = useRef(cover);
  useLayoutEffect(() => {
    coverRef.current = cover;
  });

  const save = useCallback(async () => {
    if (!editor) return;
    if (inFlight.current) {
      queued.current = true;
      return;
    }
    inFlight.current = true;
    setSaving(true);
    do {
      queued.current = false;
      const marker = changes.current;
      setError(null);
      const res = await savePageAction({ id: pageId, bodyJson: JSON.stringify(editor.getJSON()), html: editor.getHTML(), coverImage: coverRef.current });
      if (res.ok && res.data) {
        setSavedAt(res.data.updatedAt);
        if (changes.current === marker) setDirty(false);
      } else if (!res.ok) {
        setError(res.error || "Could not save.");
        queued.current = false;
      }
    } while (queued.current);
    inFlight.current = false;
    setSaving(false);
  }, [editor, pageId]);

  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => void save(), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [dirty, tick, save]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    };
    const onLeave = (e: BeforeUnloadEvent) => {
      if (dirty || inFlight.current) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onLeave);
    };
  }, [dirty, save]);

  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [title]);

  const saveRow = async (patch: { title?: string; icon?: string | null; values?: Record<string, PropertyValue> }) => {
    const res = await updateRowAction({ id: pageId, ...patch });
    if (!res.ok || !res.data) return void toast.error(res.ok ? "Could not save." : res.error);
    setRow(res.data);
    setSavedAt(res.data.updatedAt);
  };

  const setValue = (def: PropertyDef, v: PropertyValue) => {
    setRow((r) => {
      const values = { ...r.values };
      if (v === null) delete values[def.id];
      else values[def.id] = v;
      return { ...r, values };
    });
    void saveRow({ values: { [def.id]: v } });
  };

  const updateOptions = async (def: PropertyDef, options: SelectOption[]) => {
    const res = await updatePropertyAction({ id: def.id, config: { ...def.config, options } as Record<string, unknown> });
    if (!res.ok || !res.data) return void toast.error(res.ok ? "Could not save the option." : res.error), null;
    const saved = res.data;
    setProps((cur) => cur.map((p) => (p.id === saved.id ? saved : p)));
    return saved.config.options ?? null;
  };

  const uploadCover = async (file: File) => {
    const url = await rich.uploadCoverImage(file);
    if (url) {
      setCover(url);
      markDirty();
    }
  };

  const saveState = error ? (
    <span className="inline-flex items-center gap-1.5 text-destructive" role="alert">
      <AlertCircle className="size-3.5" /> {error}
    </span>
  ) : saving ? (
    <span className="inline-flex items-center gap-1.5">
      <Loader2 className="size-3.5 animate-spin" /> Saving…
    </span>
  ) : dirty ? (
    <span className="inline-flex items-center gap-1.5 text-warning">
      <span className="size-2 rounded-full bg-warning" aria-hidden /> Unsaved changes
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-success">
      <Check className="size-3.5" /> Saved{savedAt ? ` · ${timeFmt.format(new Date(savedAt))}` : ""}
    </span>
  );

  const fields = props.filter((p) => !p.isTitle);

  return (
    <div className="-mx-4 -mt-6 sm:-mx-6 lg:-mx-8 lg:-mt-8">
      <div className="sticky top-14 z-20 flex flex-wrap items-center gap-3 border-b bg-background/85 px-4 py-2.5 backdrop-blur sm:px-6 lg:top-0 lg:px-8">
        {init.database ? (
          <Link href={`/dashboard/databases/${init.database.id}`} className="inline-flex min-w-0 items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5 shrink-0" /> <span className="truncate">{init.database.icon} {init.database.title}</span>
          </Link>
        ) : (
          <Link href="/dashboard/databases" className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" /> Databases
          </Link>
        )}
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {saveState}
        </span>
        {uploading && (
          <span className="inline-flex items-center gap-1.5 text-xs text-primary" role="status">
            <Loader2 className="size-3.5 animate-spin" /> Uploading… {uploading.pct}%
          </span>
        )}
        <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">{rich.words.toLocaleString()} words</span>
      </div>

      {cover && (
        <div className="group/cover relative h-40 w-full bg-muted sm:h-56">
          {/* eslint-disable-next-line @next/next/no-img-element -- media bucket image */}
          <img src={cover} alt="" className="size-full object-cover" />
          <div className="absolute right-4 bottom-3 flex gap-1 opacity-0 transition-opacity group-hover/cover:opacity-100 focus-within:opacity-100">
            <Button size="sm" variant="outline" onClick={() => coverInput.current?.click()}>
              Change cover
            </Button>
            <Button size="sm" variant="outline" onClick={() => (setCover(null), markDirty())}>
              Remove
            </Button>
          </div>
        </div>
      )}
      <input ref={coverInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" hidden onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (f) void uploadCover(f);
      }} />

      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <div className="flex items-center gap-2">
          <EmojiPicker value={icon} onChange={(v) => (setIcon(v), void saveRow({ icon: v }))} size="md" />
          {!cover && (
            <Button size="sm" variant="ghost" onClick={() => coverInput.current?.click()}>
              <ImagePlus /> Add cover
            </Button>
          )}
        </div>
        <textarea
          ref={titleRef}
          rows={1}
          value={title}
          maxLength={300}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title !== row.title && void saveRow({ title })}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              editor?.commands.focus("start");
            }
          }}
          placeholder="Untitled"
          aria-label="Title"
          className="mt-3 w-full resize-none overflow-hidden bg-transparent text-3xl leading-tight font-semibold tracking-tight outline-none placeholder:text-muted-foreground/50 sm:text-4xl"
        />

        {fields.length > 0 && (
          <dl className="mt-5 space-y-0.5 border-b pb-5" aria-label="Properties">
            {fields.map((def) => {
              const Icon = TYPE_ICONS[def.type];
              const readOnly = COMPUTED_TYPES.includes(def.type);
              return (
                <div key={def.id} className="grid grid-cols-[9rem_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[11rem_minmax(0,1fr)]" data-testid="page-property">
                  <dt className="flex items-center gap-1.5 truncate text-[13px] text-muted-foreground">
                    <Icon className="size-3.5 shrink-0" /> <span className="truncate">{def.name}</span>
                  </dt>
                  <dd>
                    <button
                      type="button"
                      disabled={readOnly}
                      aria-label={`${def.name} value`}
                      onClick={(e) => (def.type === "CHECKBOX" ? setValue(def, !row.values[def.id]) : setEditing({ def, anchor: e.currentTarget }))}
                      className={cn("flex min-h-8 w-full items-center rounded-md px-2 py-1 text-left text-[13px]", !readOnly && "hover:bg-muted")}
                    >
                      <ValueDisplay def={def} value={row.values[def.id]} row={row} people={init.people} wrap />
                    </button>
                  </dd>
                </div>
              );
            })}
          </dl>
        )}

        <div className="mt-6">{rich.surface}</div>
      </div>

      {rich.extras}

      {editing && (
        <Popover anchor={editing.anchor} open onClose={() => setEditing(null)} label={`Edit ${editing.def.name}`} matchWidth>
          <ValueEditor
            def={props.find((p) => p.id === editing.def.id) ?? editing.def}
            value={row.values[editing.def.id]}
            people={init.people}
            uploads={init.uploads}
            rowId={pageId}
            onChange={(v) => setValue(editing.def, v)}
            onClose={() => setEditing(null)}
            onUpdateOptions={(o) => updateOptions(props.find((p) => p.id === editing.def.id) ?? editing.def, o)}
          />
        </Popover>
      )}
    </div>
  );
}
