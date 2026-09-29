"use client";

import { ExportMenu } from "@/components/export/export-menu";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { JSONContent } from "@tiptap/react";
import { AlertCircle, ArrowLeft, ArrowUpRight, Check, EyeOff, ImagePlus, Loader2, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteEntryAction, publishEntryAction, saveEntryAction, unpublishEntryAction } from "@/server/actions/notebook";
import type { SavedEntry } from "@/server/services/notebook";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useRunAction } from "@/components/use-action-toast";
import { cn } from "@/lib/utils";
import { ACCEPTED_IMAGE_TYPES } from "./upload";
import { useRichEditor, type EditorUploadConfig } from "./rich-editor";

export type { EditorUploadConfig } from "./rich-editor";

export interface EditableEntry {
  id: string;
  title: string;
  subtitle: string | null;
  status: string;
  slug: string;
  summary: string | null;
  featured: boolean;
  coverImage: string | null;
  body: JSONContent | null;
  tags: string[];
  updatedAt: string;
  wordCount: number;
  readingMinutes: number;
}

/** Drafts autosave this long after the last change. Ctrl+S / Save saves immediately. */
const AUTOSAVE_MS = 10_000;
const timeFmt = new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit" });

/** `articleBaseUrl`: public address prefix for published entries, e.g. https://timeline.fahimworks.dev/p/ */
export function EntryEditor({ entry, articleBaseUrl, uploads }: { entry: EditableEntry | null; articleBaseUrl: string; uploads: EditorUploadConfig }) {
  const [id, setId] = useState(entry?.id);
  const [status, setStatus] = useState(entry?.status ?? "DRAFT");
  const [title, setTitle] = useState(entry && entry.title !== "Untitled" ? entry.title : "");
  const [subtitle, setSubtitle] = useState(entry?.subtitle ?? "");
  const [tags, setTags] = useState(entry?.tags.join(", ") ?? "");
  const [slug, setSlug] = useState(entry?.slug ?? "");
  const [summary, setSummary] = useState(entry?.summary ?? "");
  const [featured, setFeatured] = useState(entry?.featured ?? false);
  const [coverImage, setCoverImage] = useState<string | null>(entry?.coverImage ?? null);
  const coverPicker = useRef<HTMLInputElement>(null);
  const [dirty, setDirty] = useState(false);
  const [tick, setTick] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(entry?.updatedAt ?? null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const del = useRunAction();
  const unpub = useRunAction();

  const published = status === "PUBLISHED";
  const changeCount = useRef(0);
  const inFlight = useRef(false);
  const queued = useRef(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  const markDirty = useCallback(() => {
    changeCount.current += 1;
    setDirty(true);
    setTick((t) => t + 1);
  }, []);

  // The entry id for uploads (set once the first save creates the entry).
  const idRef = useRef(id);
  useLayoutEffect(() => {
    idRef.current = id;
  });
  const rich = useRichEditor({
    initialBody: entry?.body ?? null,
    uploads,
    uploadTarget: () => ({ contentId: idRef.current }),
    onChange: markDirty,
  });
  const { editor, words, uploading } = rich;

  // Latest form values for the save function (avoids stale closures).
  const values = useRef({ id, title, subtitle, tags, slug, summary, featured, coverImage });
  useLayoutEffect(() => {
    values.current = { id, title, subtitle, tags, slug, summary, featured, coverImage };
  });

  type Values = typeof values.current;

  const buildPayload = useCallback(
    (v: Values) => {
      if (!editor) throw new Error("Editor not ready");
      return {
        id: v.id,
        title: v.title,
        subtitle: v.subtitle,
        tags: v.tags,
        slug: v.slug,
        summary: v.summary,
        featured: v.featured,
        coverImage: v.coverImage,
        // Plain JSON only: ProseMirror builds some attrs with Object.create(null), which
        // Server Actions would otherwise send as opaque client references.
        body: JSON.parse(JSON.stringify(editor.getJSON())),
        html: editor.getHTML(),
      };
    },
    [editor],
  );

  /** Reflect a successful save (or publish) in local state. */
  const applySaved = useCallback((saved: SavedEntry, v: Values, marker: number) => {
    if (!v.id) {
      values.current = { ...values.current, id: saved.id };
      setId(saved.id);
      // Give the new entry its real address without remounting the editor.
      window.history.replaceState(null, "", `/dashboard/notebook/${saved.id}`);
    }
    setSlug(saved.slug);
    setStatus(saved.status);
    setSavedAt(saved.savedAt);
    if (changeCount.current === marker) setDirty(false);
  }, []);

  const save = useCallback(async () => {
    if (!editor) return;
    if (inFlight.current) {
      // A save is running — run one more when it finishes (picks up the latest changes).
      queued.current = true;
      return;
    }
    inFlight.current = true;
    setSaving(true);
    do {
      queued.current = false;
      const v = values.current;
      // Don't create an entry for a completely empty new page.
      if (!v.id && !v.title.trim() && editor.isEmpty) break;

      setError(null);
      const marker = changeCount.current;
      const res = await saveEntryAction(buildPayload(v));
      if (res.ok && res.data) {
        applySaved(res.data, v, marker);
      } else if (!res.ok) {
        setError(res.error || "Could not save.");
        queued.current = false;
      }
    } while (queued.current);
    inFlight.current = false;
    setSaving(false);
  }, [editor, buildPayload, applySaved]);

  /** Save the current state and publish it in one step. */
  const publish = useCallback(async () => {
    if (!editor) return;
    // Let any running autosave finish first so the two never overlap.
    while (inFlight.current) await new Promise((r) => setTimeout(r, 100));
    inFlight.current = true;
    setPublishing(true);
    setError(null);
    const v = values.current;
    const marker = changeCount.current;
    const res = await publishEntryAction(buildPayload(v));
    inFlight.current = false;
    setPublishing(false);
    if (res.ok && res.data) {
      applySaved(res.data, v, marker);
      const url = `${articleBaseUrl}${res.data.slug}`;
      toast.success("Published to your timeline.", { action: { label: "View", onClick: () => window.open(url, "_blank", "noopener") } });
    } else if (!res.ok) {
      toast.error(res.error || "Could not publish.");
    }
  }, [editor, buildPayload, applySaved, articleBaseUrl]);

  const uploadCover = async (file: File) => {
    const url = await rich.uploadCoverImage(file);
    if (url) {
      setCoverImage(url);
      markDirty();
    }
  };

  // Autosave drafts shortly after typing stops. Published entries save only on demand.
  useEffect(() => {
    if (!dirty || published) return;
    const t = setTimeout(() => void save(), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [dirty, published, tick, save]);

  // Ctrl/Cmd+S saves; warn before leaving with unsaved changes.
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

  // Auto-grow the title textarea.
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [title]);

  const field =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      markDirty();
    };

  const saveState = error ? (
    <span className="inline-flex items-center gap-1.5 text-destructive" role="alert">
      <AlertCircle className="size-3.5" /> {error}
    </span>
  ) : saving ? (
    <span className="inline-flex items-center gap-1.5">
      <Loader2 className="size-3.5 animate-spin" /> Saving…
    </span>
  ) : !dirty && !id ? (
    <span>Not saved yet</span>
  ) : dirty ? (
    <span className="inline-flex items-center gap-1.5 font-medium text-warning">
      <span className="size-2 rounded-full bg-warning" aria-hidden />
      {published ? "Unsaved changes — not live yet" : "Unsaved changes"}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 font-medium text-success">
      <Check className="size-3.5" /> Saved{savedAt ? ` · ${timeFmt.format(new Date(savedAt))}` : ""}
    </span>
  );
  const isSaved = !dirty && !saving && !error && Boolean(id);

  /** Export the saved version: save pending edits first. */
  const prepareExport = async () => {
    const idle = async () => {
      while (inFlight.current) await new Promise((r) => setTimeout(r, 100));
    };
    await idle();
    if (dirty || !values.current.id) await save();
    await idle();
    return values.current.id ?? null;
  };

  return (
    <div className="-mx-4 -mt-6 sm:-mx-6 lg:-mx-8 lg:-mt-8">
      {/* Top bar */}
      <div className="sticky top-14 z-20 flex flex-wrap items-center gap-3 border-b bg-background/85 px-4 py-2.5 backdrop-blur sm:px-6 lg:top-0 lg:px-8">
        <Link href="/dashboard/notebook" className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Notebook
        </Link>
        <Badge tone={published ? "green" : "neutral"} dot>
          {published ? "Published" : "Draft"}
        </Badge>
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {saveState}
        </span>
        {uploading && (
          <span className="inline-flex items-center gap-1.5 text-xs text-primary" role="status">
            <Loader2 className="size-3.5 animate-spin" /> Uploading{uploading.count > 1 ? ` ${uploading.count} images` : " image"}… {uploading.pct}%
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {words.toLocaleString()} words · {Math.max(words ? 1 : 0, Math.round(words / 230))} min read
          </span>
          {published && (
            <>
              <a
                href={`${articleBaseUrl}${slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-[13px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                View live <ArrowUpRight className="size-3.5" />
              </a>
              <Button
                size="sm"
                variant="ghost"
                loading={unpub.pending}
                onClick={() => id && unpub.run(() => unpublishEntryAction(id), { onSuccess: () => setStatus("DRAFT") })}
                title="Remove from the timeline (keeps it as a draft)"
              >
                <EyeOff /> Unpublish
              </Button>
            </>
          )}
          <ExportMenu kind="notebook" prepare={prepareExport} />
          <Button size="sm" variant={isSaved || !published ? "outline" : "primary"} loading={saving} disabled={isSaved} onClick={() => void save()} title="Save (Ctrl+S)">
            {isSaved ? (
              <>
                <Check /> Saved
              </>
            ) : published ? (
              "Save & update live"
            ) : (
              "Save"
            )}
          </Button>
          {!published && (
            <Button size="sm" loading={publishing} disabled={saving} onClick={() => void publish()} title="Save and publish to your timeline">
              <Send /> Publish
            </Button>
          )}
        </div>
      </div>

      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_17rem] lg:px-8">
        {/* Writing surface */}
        <div className="mx-auto w-full max-w-3xl">
          <textarea
            ref={titleRef}
            rows={1}
            value={title}
            onChange={(e) => field(setTitle)(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                editor?.commands.focus("start");
              }
            }}
            placeholder="Title"
            aria-label="Title"
            maxLength={300}
            className="w-full resize-none overflow-hidden bg-transparent text-3xl leading-tight font-semibold tracking-tight outline-none placeholder:text-muted-foreground/50 sm:text-4xl"
          />
          <input
            value={subtitle}
            onChange={(e) => field(setSubtitle)(e.target.value)}
            placeholder="Add a subtitle (optional)"
            aria-label="Subtitle"
            maxLength={300}
            className="mt-2 w-full bg-transparent text-lg text-muted-foreground outline-none placeholder:text-muted-foreground/45"
          />
          <div className="mt-8">
            {rich.surface}
          </div>
        </div>

        {/* Side panel */}
        <aside className="space-y-5 lg:sticky lg:top-20 lg:self-start">
          <input
            ref={coverPicker}
            type="file"
            accept={ACCEPTED_IMAGE_TYPES.join(",")}
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void uploadCover(file);
            }}
          />
          <div className="space-y-1.5">
            <span className="text-[13px] font-medium">Cover image</span>
            {coverImage ? (
              <div className="space-y-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- media bucket image */}
                <img data-zoomable src={coverImage} alt="Cover" className="aspect-[16/9] w-full rounded-lg border object-cover" />
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => coverPicker.current?.click()} disabled={!!uploading}>
                    Replace
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setCoverImage(null);
                      markDirty();
                    }}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => coverPicker.current?.click()}
                disabled={!!uploading}
                className="flex aspect-[16/9] w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:opacity-50"
              >
                <ImagePlus className="size-5" />
                {uploads.enabled ? "Upload cover image" : "Uploads not configured"}
              </button>
            )}
            <p className="text-xs text-muted-foreground">Shown on the timeline and at the top of the article. Without one, the first image is used on the timeline.</p>
          </div>
          <Field id="entry-tags" label="Tags" hint="Comma separated.">
            <Input id="entry-tags" value={tags} onChange={(e) => field(setTags)(e.target.value)} placeholder="ai, agents, rag" />
          </Field>
          <Field id="entry-slug" label="Slug" hint={published ? "Locked after publishing, so shared links keep working." : "Part of the article address. Filled in from the title."}>
            <Input id="entry-slug" value={slug} disabled={published} onChange={(e) => field(setSlug)(e.target.value)} placeholder="my-first-entry" className="font-mono text-[13px]" />
          </Field>
          <Field id="entry-summary" label="Summary" hint="Shown on the timeline. Leave empty to use your first paragraph.">
            <Textarea id="entry-summary" rows={4} value={summary} maxLength={1000} onChange={(e) => field(setSummary)(e.target.value)} />
          </Field>
          <label className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <span>
              <span className="block text-[13px] font-medium">Featured</span>
              <span className="block text-xs text-muted-foreground">Pin to the top of the timeline.</span>
            </span>
            <Switch checked={featured} onChange={(e) => field(setFeatured)(e.target.checked)} />
          </label>
          <p className="text-xs text-muted-foreground sm:hidden">
            {words.toLocaleString()} words · {Math.max(words ? 1 : 0, Math.round(words / 230))} min read
          </p>
          {id && (
            <Button variant="ghost" size="sm" className={cn("text-destructive hover:text-destructive")} onClick={() => setConfirmDelete(true)}>
              <Trash2 /> Delete entry
            </Button>
          )}
        </aside>
      </div>

      {rich.extras}

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this entry?"
        description={`“${title || "Untitled"}” will be permanently deleted${published ? " and removed from your timeline" : ""}.`}
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" loading={del.pending} onClick={() => id && del.run(() => deleteEntryAction(id))}>
              Delete permanently
            </Button>
          </>
        }
      />
    </div>
  );
}
