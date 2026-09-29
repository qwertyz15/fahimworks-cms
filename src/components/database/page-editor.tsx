"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { JSONContent } from "@tiptap/react";
import { AlertCircle, ArrowLeft, ArrowUpRight, Check, EyeOff, ImagePlus, Loader2, Maximize2, RefreshCw, Send, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { COMPUTED_TYPES, type PropertyValue, type SelectOption } from "@/lib/db-properties";
import { publishPageAction, savePageAction, unpublishPageAction, updateLiveAction, updatePropertyAction, updateRowAction } from "@/server/actions/databases";
import type { PublishState } from "@/server/databases/publish";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useRichEditor, type EditorUploadConfig } from "@/components/editor/rich-editor";
import { ValueDisplay, ValueEditor } from "./cells";
import { EmojiPicker } from "./emoji-picker";
import { Popover } from "./popover";
import { TYPE_ICONS } from "./property-menu";
import type { Person, PropertyDef, Row } from "./types";
import { RelatedProvider, useRelated, type RelatedPage } from "./relation-editor";

/** Saves this long after the last edit (Ctrl+S saves immediately). */
const AUTOSAVE_MS = 1500;
const timeFmt = new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit" });

export interface PageEditorData {
  page: { id: string; title: string; icon: string | null; coverImage: string | null; body: JSONContent | null; updatedAt: string; createdAt: string; values: Row["values"] };
  database: { id: string; title: string; icon: string | null } | null;
  properties: PropertyDef[];
  people: Person[];
  publish: PublishState | null;
  /** Pages this page's relations link to. */
  related: Record<string, RelatedPage>;
}

/**
 * A database row as a page: icon, cover, title, properties, block editor
 * (autosaved) and publishing. Used full-page and in the peek panel.
 */
export function PageEditor({
  data,
  uploads,
  articleBaseUrl,
  variant,
  onRowChange,
  onClose,
  onOpenFull,
}: {
  data: PageEditorData;
  uploads: EditorUploadConfig;
  /** e.g. https://timeline.fahimworks.dev/p/ */
  articleBaseUrl: string;
  variant: "page" | "peek";
  /** Title / icon / values changed (peek: keep the view in sync). */
  onRowChange?: (row: Row) => void;
  onClose?: () => void;
  onOpenFull?: () => void;
}) {
  const init = data;
  const pageId = init.page.id;
  const [title, setTitle] = useState(init.page.title);
  const [icon, setIcon] = useState(init.page.icon);
  const [cover, setCover] = useState(init.page.coverImage);
  const [row, setRow] = useState<Row>({ id: pageId, title: init.page.title, icon: init.page.icon, thumbnail: init.page.coverImage, values: init.page.values, position: "", createdAt: init.page.createdAt, updatedAt: init.page.updatedAt });
  const [props, setProps] = useState(init.properties);
  const [publish, setPublish] = useState(init.publish);
  const router = useRouter();
  const parent = useRelated();
  const [related, setRelated] = useState(init.related);
  const remember = useCallback(
    (more: Record<string, RelatedPage>) => {
      setRelated((cur) => ({ ...cur, ...more }));
      parent.remember(more);
    },
    [parent],
  );
  // Linked pages open in the database's peek panel, or as a page.
  const openLinked = parent.open ?? ((id: string) => router.push(`/dashboard/pages/${id}`));
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
  const onRowChangeRef = useRef(onRowChange);
  useLayoutEffect(() => {
    onRowChangeRef.current = onRowChange;
  });

  const markDirty = useCallback(() => {
    changes.current += 1;
    setDirty(true);
    setTick((t) => t + 1);
  }, []);

  const rich = useRichEditor({ initialBody: init.page.body, uploads, uploadTarget: () => ({ pageId }), onChange: markDirty, ariaLabel: "Page content" });
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
        setPublish((p) => (p ? { ...p, outdated: true } : p));
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

  // Leaving the peek panel (or the page) with unsaved edits: save them now.
  const saveRef = useRef(save);
  const dirtyRef = useRef(dirty);
  useLayoutEffect(() => {
    saveRef.current = save;
    dirtyRef.current = dirty;
  });
  useEffect(
    () => () => {
      if (dirtyRef.current) void saveRef.current();
    },
    [],
  );

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
    remember(res.data.related);
    setSavedAt(res.data.updatedAt);
    if (patch.title !== undefined) setPublish((p) => (p ? { ...p, outdated: true } : p));
    onRowChangeRef.current?.(res.data);
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
    if (!res.ok || !res.data) {
      toast.error(res.ok ? "Could not save the option." : res.error);
      return null;
    }
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
  const peek = variant === "peek";

  return (
    <RelatedProvider value={{ related, remember, open: openLinked }}>
    <div className={cn(!peek && "-mx-4 -mt-6 sm:-mx-6 lg:-mx-8 lg:-mt-8")}>
      <div className={cn("z-20 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b bg-background/85 px-4 py-2.5 backdrop-blur", peek ? "sticky top-0" : "sticky top-14 sm:px-6 lg:top-0 lg:px-8")}>
        {peek ? (
          <>
            <button type="button" onClick={onClose} aria-label="Close" title="Close (Esc)" className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
              <X className="size-4" />
            </button>
            <button type="button" onClick={onOpenFull} aria-label="Open as full page" title="Open as full page" className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
              <Maximize2 className="size-4" />
            </button>
          </>
        ) : init.database ? (
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
        <div className="ml-auto flex items-center gap-2">
          {!peek && <span className="hidden text-xs text-muted-foreground sm:inline">{rich.words.toLocaleString()} words</span>}
          <PublishControls
            pageId={pageId}
            title={title}
            state={publish}
            articleBaseUrl={articleBaseUrl}
            multiSelects={props.filter((p) => p.type === "MULTI_SELECT")}
            beforePublish={async () => {
              if (dirty || inFlight.current) await save();
            }}
            onChange={setPublish}
          />
        </div>
      </div>

      {cover && (
        <div className="group/cover relative h-40 w-full bg-muted sm:h-52">
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
      <input
        ref={coverInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void uploadCover(f);
        }}
      />

      <div className={cn("mx-auto w-full max-w-3xl px-4 py-8", !peek && "sm:px-6")}>
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
            uploads={uploads}
            rowId={pageId}
            onChange={(v) => setValue(editing.def, v)}
            onClose={() => setEditing(null)}
            onUpdateOptions={(o) => updateOptions(props.find((p) => p.id === editing.def.id) ?? editing.def, o)}
          />
        </Popover>
      )}
    </div>
    </RelatedProvider>
  );
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .slice(0, 80);

/** Publish / View live / Update live / Unpublish for a row page. */
function PublishControls({
  pageId,
  title,
  state,
  articleBaseUrl,
  multiSelects,
  beforePublish,
  onChange,
}: {
  pageId: string;
  title: string;
  state: PublishState | null;
  articleBaseUrl: string;
  multiSelects: PropertyDef[];
  beforePublish: () => Promise<void>;
  onChange: (s: PublishState | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState("");
  const [tagsFrom, setTagsFrom] = useState("");
  const [busy, setBusy] = useState<null | "publish" | "update" | "unpublish">(null);
  const live = state?.status === "PUBLISHED";
  const run = async (kind: "publish" | "update" | "unpublish", fn: () => Promise<{ ok: true; data?: PublishState | null; message?: string } | { ok: false; error: string }>) => {
    setBusy(kind);
    await beforePublish();
    const res = await fn();
    setBusy(null);
    if (!res.ok) return void toast.error(res.error);
    onChange(res.data ?? null);
    if (res.message) toast.success(res.message);
    return true;
  };

  if (live && state) {
    return (
      <>
        <a href={`${articleBaseUrl}${state.slug}`} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[13px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
          View live <ArrowUpRight className="size-3.5" />
        </a>
        <Button size="sm" variant={state.outdated ? "primary" : "outline"} loading={busy === "update"} onClick={() => void run("update", () => updateLiveAction({ id: pageId }))} title="Copy this page to the live article">
          <RefreshCw /> Update live
          {state.outdated && <span className="size-1.5 rounded-full bg-current" aria-label="(changed since publishing)" />}
        </Button>
        <Button size="sm" variant="ghost" loading={busy === "unpublish"} onClick={() => void run("unpublish", () => unpublishPageAction({ id: pageId }))} title="Remove from the timeline">
          <EyeOff /> Unpublish
        </Button>
      </>
    );
  }
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setSlug(state?.slug ?? slugify(title));
          setOpen(true);
        }}
      >
        <Send /> Publish
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Publish as an article"
        description="The page becomes a Notebook article on your public timeline. Later edits go live when you press Update live."
        footer={
          <Button
            size="sm"
            loading={busy === "publish"}
            onClick={async () => {
              if (await run("publish", () => publishPageAction({ id: pageId, slug: slug || null, tagsFrom: tagsFrom || null }))) setOpen(false);
            }}
          >
            <Send /> Publish
          </Button>
        }
      >
        <div className="space-y-3">
          <label className="block text-[13px]">
            <span className="text-muted-foreground">Address</span>
            <span className="mt-1 flex items-center gap-1">
              <span className="shrink-0 text-xs text-muted-foreground">{articleBaseUrl.replace(/^https?:\/\//, "")}</span>
              <Input value={slug} onChange={(e) => setSlug(slugify(e.target.value))} aria-label="Slug" className="h-8 font-mono text-[13px]" />
            </span>
          </label>
          {multiSelects.length > 0 && (
            <label className="block text-[13px]">
              <span className="text-muted-foreground">Take tags from</span>
              <select value={tagsFrom} onChange={(e) => setTagsFrom(e.target.value)} aria-label="Take tags from" className="mt-1 block h-8 w-full rounded-md border bg-background px-2 text-[13px]">
                <option value="">No tags</option>
                {multiSelects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </Dialog>
    </>
  );
}
