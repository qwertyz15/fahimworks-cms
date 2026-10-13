"use client";

import { useMemo, useState } from "react";
import { Folder, FolderOpen, Home } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { EmojiPicker } from "@/components/database/emoji-picker";
import { flatten, moveProblem, subtreeIds } from "@/lib/notebook-folders";
import type { EntryItem, FolderItem } from "./types";

/** Pick a destination folder. `moving` (a folder) can't go inside itself. */
export function MoveDialog({
  folders,
  title,
  current,
  moving,
  onMove,
  onClose,
}: {
  folders: FolderItem[];
  title: string;
  current: string | null;
  moving?: string | null;
  onMove: (folderId: string | null) => Promise<unknown>;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [pick, setPick] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => flatten(folders), [folders]);
  const shown = q.trim() ? rows.filter((r) => r.folder.name.toLowerCase().includes(q.trim().toLowerCase())) : rows;
  const blocked = useMemo(() => (moving ? subtreeIds(folders, moving) : new Set<string>()), [folders, moving]);
  const problem = (id: string | null) => (moving ? moveProblem(folders, moving, id) : null);
  const choose = (id: string | null) => !problem(id) && id !== current && setPick(id);
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      description="Choose where it goes."
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={pick === undefined}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              await onMove(pick ?? null);
              setBusy(false);
              onClose();
            }}
          >
            Move here
          </Button>
        </>
      }
    >
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search folders…" aria-label="Search folders" autoFocus className="mb-2" />
      <div className="max-h-72 overflow-y-auto rounded-md border p-1" role="listbox" aria-label="Folders">
        {!q.trim() && (
          <button type="button" role="option" aria-selected={pick === null} disabled={current === null} onClick={() => choose(null)} className={cn("flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] hover:bg-muted disabled:opacity-50", pick === null && "bg-primary/10 font-medium")}>
            <Home className="size-3.5 text-muted-foreground" /> Notebook (top level){current === null && <span className="ml-auto text-xs text-muted-foreground">current</span>}
          </button>
        )}
        {shown.map(({ folder, depth }) => {
          const off = blocked.has(folder.id) || !!problem(folder.id);
          return (
            <button
              key={folder.id}
              type="button"
              role="option"
              aria-selected={pick === folder.id}
              disabled={off || folder.id === current}
              onClick={() => choose(folder.id)}
              title={off ? (problem(folder.id) ?? undefined) : undefined}
              className={cn("flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] hover:bg-muted disabled:opacity-40", pick === folder.id && "bg-primary/10 font-medium")}
              style={{ paddingLeft: `${0.5 + (q.trim() ? 0 : depth + 1) * 0.9}rem` }}
            >
              <span className="w-4 shrink-0 text-center">{folder.icon ?? <Folder className="size-3.5 text-muted-foreground" />}</span>
              <span className="truncate">{folder.name}</span>
              {folder.id === current && <span className="ml-auto text-xs text-muted-foreground">current</span>}
            </button>
          );
        })}
        {!shown.length && q.trim() && <p className="px-2 py-3 text-center text-xs text-muted-foreground">No folder matches.</p>}
      </div>
    </Dialog>
  );
}

/** Name, icon, description and public address of a folder. */
export function FolderDialog({
  folder,
  title,
  onSave,
  onClose,
  folderPageBase,
}: {
  folder: Partial<FolderItem> | null;
  title: string;
  onSave: (v: { name: string; icon: string | null; description: string | null; slug?: string }) => Promise<boolean>;
  onClose: () => void;
  folderPageBase?: string;
}) {
  const [name, setName] = useState(folder?.name ?? "");
  const [icon, setIcon] = useState<string | null>(folder?.icon ?? null);
  const [description, setDescription] = useState(folder?.description ?? "");
  const [slug, setSlug] = useState(folder?.slug ?? "");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const ok = await onSave({ name: name.trim() || "Untitled folder", icon, description: description.trim() || null, ...(folder?.id && slug && slug !== folder.slug ? { slug } : {}) });
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" loading={busy} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <EmojiPicker value={icon} onChange={setIcon} size="md" />
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void save()}
            placeholder="Folder name"
            aria-label="Folder name"
            maxLength={120}
            autoFocus
          />
        </div>
        <label className="block text-[13px]">
          <span className="text-muted-foreground">Description (optional, shown on the folder page)</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={500} aria-label="Folder description" className="mt-1 w-full resize-none rounded-md border bg-background px-2 py-1.5 text-[13px] outline-none focus:border-ring" />
        </label>
        {folder?.id && folderPageBase && (
          <label className="block text-[13px]">
            <span className="text-muted-foreground">Public address</span>
            <span className="mt-1 flex items-center gap-1">
              <span className="shrink-0 text-xs text-muted-foreground">{folderPageBase.replace(/^https?:\/\//, "")}</span>
              <Input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-"))} aria-label="Folder address" className="h-8 font-mono text-[13px]" maxLength={60} />
            </span>
            {folder.isPublic && slug !== folder.slug && <span className="mt-1 block text-xs text-warning">Changing it breaks links to the old address.</span>}
          </label>
        )}
      </div>
    </Dialog>
  );
}

export interface PublishOutcome {
  published: number;
  alreadyLive: number;
  skipped: { id: string; title: string; reason: string }[];
}

/** Publish every entry in a folder (subfolders too), optionally with its public page. */
export function PublishFolderDialog({
  folder,
  entries,
  folderPageBase,
  onPublish,
  onClose,
}: {
  folder: FolderItem;
  entries: EntryItem[];
  folderPageBase: string;
  onPublish: (opts: { folderPage: boolean; slug?: string }) => Promise<PublishOutcome | null>;
  onClose: () => void;
}) {
  const drafts = entries.filter((e) => e.status !== "PUBLISHED").length;
  const [page, setPage] = useState(true);
  const [slug, setSlug] = useState(folder.slug);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PublishOutcome | null>(null);
  return (
    <Dialog
      open
      onClose={onClose}
      title={result ? "Folder published" : `Publish “${folder.name}”`}
      description={result ? undefined : `${entries.length} ${entries.length === 1 ? "entry" : "entries"} inside (with subfolders): ${drafts} to publish, ${entries.length - drafts} already live.`}
      footer={
        result ? (
          <>
            {page && (
              <a href={`${folderPageBase}${slug}`} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center rounded-md px-3 text-[13px] font-medium text-primary hover:underline">
                View folder page ↗
              </a>
            )}
            <Button size="sm" onClick={onClose}>
              Done
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              loading={busy}
              disabled={!entries.length && !page}
              onClick={async () => {
                setBusy(true);
                const r = await onPublish({ folderPage: page, ...(slug !== folder.slug ? { slug } : {}) });
                setBusy(false);
                if (r) setResult(r);
              }}
            >
              Publish {drafts ? `${drafts} ${drafts === 1 ? "entry" : "entries"}` : "folder"}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-2 text-[13px]" data-testid="publish-result">
          <p>
            Published <strong>{result.published}</strong> {result.published === 1 ? "entry" : "entries"}
            {result.alreadyLive ? ` (${result.alreadyLive} already live)` : ""}.
          </p>
          {result.skipped.length > 0 && (
            <div className="rounded-md border border-warning/40 bg-warning/10 p-2">
              <p className="font-medium">Not published ({result.skipped.length}):</p>
              <ul className="mt-1 list-disc pl-5">
                {result.skipped.map((s) => (
                  <li key={s.id}>
                    {s.title}: <span className="text-muted-foreground">{s.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3 text-[13px]">
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={page} onChange={(e) => setPage(e.target.checked)} className="mt-0.5" />
            <span>
              <span className="font-medium">Show a folder page on the timeline</span>
              <span className="block text-xs text-muted-foreground">Lists its articles in order (subfolders as sections). Each article shows “Part of {folder.name}” with previous / next links.</span>
            </span>
          </label>
          {page && (
            <label className="block">
              <span className="text-muted-foreground">Address</span>
              <span className="mt-1 flex items-center gap-1">
                <span className="shrink-0 text-xs text-muted-foreground">{folderPageBase.replace(/^https?:\/\//, "")}</span>
                <Input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-"))} aria-label="Folder address" className="h-8 font-mono text-[13px]" maxLength={60} />
              </span>
            </label>
          )}
        </div>
      )}
    </Dialog>
  );
}

/** Delete a folder: move its contents up, or delete everything inside. */
export function DeleteFolderDialog({ folder, parentName, entries, folders, onDelete, onClose }: { folder: FolderItem; parentName: string; entries: number; folders: number; onDelete: (mode: "move-up" | "delete-all") => Promise<unknown>; onClose: () => void }) {
  const empty = !entries && !folders;
  const [mode, setMode] = useState<"move-up" | "delete-all">("move-up");
  const [busy, setBusy] = useState(false);
  const what = [entries ? `${entries} ${entries === 1 ? "entry" : "entries"}` : "", folders ? `${folders} ${folders === 1 ? "folder" : "folders"}` : ""].filter(Boolean).join(" and ");
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Delete “${folder.name}”?`}
      description={empty ? "This empty folder goes to the trash (restorable for 30 days)." : `It contains ${what}.`}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              await onDelete(empty ? "move-up" : mode);
              setBusy(false);
              onClose();
            }}
          >
            {mode === "delete-all" && !empty ? "Move all to trash" : "Move folder to trash"}
          </Button>
        </>
      }
    >
      {!empty && (
        <div className="space-y-2 text-[13px]" role="radiogroup" aria-label="What happens to its contents">
          <label className={cn("flex items-start gap-2 rounded-md border p-2.5", mode === "move-up" && "border-primary/50 bg-primary/5")}>
            <input type="radio" name="mode" checked={mode === "move-up"} onChange={() => setMode("move-up")} className="mt-0.5" />
            <span>
              <span className="flex items-center gap-1 font-medium">
                <FolderOpen className="size-3.5" /> Keep the contents
              </span>
              <span className="block text-xs text-muted-foreground">Move them up into {parentName}.</span>
            </span>
          </label>
          <label className={cn("flex items-start gap-2 rounded-md border p-2.5", mode === "delete-all" && "border-destructive/50 bg-destructive/5")}>
            <input type="radio" name="mode" checked={mode === "delete-all"} onChange={() => setMode("delete-all")} className="mt-0.5" />
            <span>
              <span className="font-medium text-destructive">Move everything inside to the trash</span>
              <span className="block text-xs text-muted-foreground">Trashes {what} together — restorable for 30 days. Published ones leave your timeline.</span>
            </span>
          </label>
        </div>
      )}
    </Dialog>
  );
}

/** A simple "are you sure" for destructive actions. */
export function ConfirmDialog({ title, description, confirm, onConfirm, onClose, destructive = true }: { title: string; description?: string; confirm: string; onConfirm: () => Promise<unknown>; onClose: () => void; destructive?: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "destructive" : "primary"}
            size="sm"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              await onConfirm();
              setBusy(false);
              onClose();
            }}
          >
            {confirm}
          </Button>
        </>
      }
    />
  );
}
