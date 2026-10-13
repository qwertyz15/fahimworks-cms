"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { generateKeyBetween } from "fractional-indexing";
import {
  ArrowUpRight,
  ChevronRight,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileText,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Globe,
  GripVertical,
  Home,
  NotebookPen,
  PenLine,
  Pencil,
  Printer,
  Search,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn, formatDate } from "@/lib/utils";
import { childrenOf, moveProblem, pathOf, subtreeIds } from "@/lib/notebook-folders";
import { Button, buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/content/badges";
import type { ActionResult } from "@/server/actions/result";
import {
  bulkEntriesAction,
  createFolderAction,
  deleteFolderAction,
  duplicateEntryAction,
  duplicateFolderAction,
  moveEntriesAction,
  moveFolderAction,
  publishFolderAction,
  renameEntryAction,
  setFolderPageAction,
  unpublishFolderAction,
  updateFolderAction,
} from "@/server/actions/folders";
import { ActionMenu, Item, Separator } from "./menu";
import { ConfirmDialog, DeleteFolderDialog, FolderDialog, MoveDialog, PublishFolderDialog } from "./dialogs";
import { byEntryPosition, type EntryItem, type FolderItem } from "./types";

type DialogState =
  | { kind: "new-folder"; parentId: string | null }
  | { kind: "edit-folder"; folder: FolderItem }
  | { kind: "move-folder"; folder: FolderItem }
  | { kind: "move-entries"; ids: string[] }
  | { kind: "publish-folder"; folder: FolderItem }
  | { kind: "unpublish-folder"; folder: FolderItem }
  | { kind: "delete-folder"; folder: FolderItem }
  | { kind: "delete-entries"; ids: string[] }
  | null;

const EXPANDED_KEY = "notebook:expanded";
const EXPANDED_EVENT = "notebook:expanded-change";
const folderParam = () => new URLSearchParams(window.location.search).get("folder");

/** Expanded folders, remembered in this browser (empty on the server and when storage is blocked). */
function readExpanded(): string {
  try {
    return localStorage.getItem(EXPANDED_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}
function subscribeExpanded(cb: () => void) {
  window.addEventListener(EXPANDED_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EXPANDED_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}
function writeExpanded(ids: Set<string>) {
  try {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify([...ids]));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(EXPANDED_EVENT));
}

export function NotebookBrowser(init: { folders: FolderItem[]; entries: EntryItem[]; initialFolderId: string | null; articleBase: string; folderPageBase: string }) {
  const router = useRouter();
  // Server data, with optimistic changes on top until the next refresh.
  const [srcFolders, setSrcFolders] = useState(init.folders);
  const [folders, setFolders] = useState(init.folders);
  if (srcFolders !== init.folders) {
    setSrcFolders(init.folders);
    setFolders(init.folders);
  }
  const [srcEntries, setSrcEntries] = useState(init.entries);
  const [entries, setEntries] = useState(init.entries);
  if (srcEntries !== init.entries) {
    setSrcEntries(init.entries);
    setEntries(init.entries);
  }

  const [cur, setCur] = useState<string | null>(init.initialFolderId && init.folders.some((f) => f.id === init.initialFolderId) ? init.initialFolderId : null);
  const current = cur ? (folders.find((f) => f.id === cur) ?? null) : null;
  // The folder vanished (deleted elsewhere): back to the top.
  if (cur && !current) setCur(null);

  const expandedRaw = useSyncExternalStore(subscribeExpanded, readExpanded, () => "[]");
  const expanded = useMemo(() => {
    try {
      const v = JSON.parse(expandedRaw) as unknown;
      return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    } catch {
      return new Set<string>();
    }
  }, [expandedRaw]);
  const setExpanded = (fn: (s: Set<string>) => Set<string>) => writeExpanded(fn(expanded));
  const [q, setQ] = useState("");
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [treeOpen, setTreeOpen] = useState(false);
  const [dragging, setDragging] = useState<{ id: string; label: string; count: number } | null>(null);

  // Back / forward between folders.
  useEffect(() => {
    const onPop = () => setCur(folderParam());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const openFolder = (id: string | null) => {
    setCur(id);
    setSelection(new Set());
    setQ("");
    setTreeOpen(false);
    const url = id ? `/dashboard/notebook?folder=${id}` : "/dashboard/notebook";
    if (folderParam() !== id) window.history.pushState(null, "", url);
    // Show where it is in the tree.
    if (id) setExpanded((s) => new Set([...s, ...pathOf(folders, id).slice(0, -1).map((f) => f.id)]));
  };

  /** Run an action, toast the outcome, then reload the page's data. */
  const act = async <T,>(p: Promise<ActionResult<T>>, ok?: string): Promise<T | true | null> => {
    const r = await p;
    if (!r.ok) {
      toast.error(r.error || "Something went wrong.");
      router.refresh();
      return null;
    }
    if (r.message || ok) toast.success(r.message ?? ok!);
    router.refresh();
    return r.data ?? true;
  };

  // ── Derived ──
  const counts = useMemo(() => {
    const m = new Map<string, { entries: number; drafts: number; published: number }>();
    for (const f of folders) {
      const ids = subtreeIds(folders, f.id);
      const inside = entries.filter((e) => e.folderId && ids.has(e.folderId));
      const published = inside.filter((e) => e.status === "PUBLISHED").length;
      m.set(f.id, { entries: inside.length, drafts: inside.length - published, published });
    }
    return m;
  }, [folders, entries]);
  const subfolders = useMemo(() => childrenOf(folders, cur), [folders, cur]);
  const here = useMemo(() => entries.filter((e) => e.folderId === cur).sort(byEntryPosition), [entries, cur]);
  const path = useMemo(() => pathOf(folders, cur), [folders, cur]);
  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return null;
    return entries.filter((e) => [e.title, e.subtitle, e.summary].some((s) => s?.toLowerCase().includes(t))).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [entries, q]);
  const shown = results ?? here;
  const folderIds = useMemo(() => subfolders.map((f) => `f:${f.id}`), [subfolders]);
  const entryIds = useMemo(() => here.map((e) => `e:${e.id}`), [here]);
  const entriesOf = (folderId: string) => {
    const ids = subtreeIds(folders, folderId);
    return entries.filter((e) => e.folderId && ids.has(e.folderId));
  };
  const nameOf = (id: string | null) => (id ? (folders.find((f) => f.id === id)?.name ?? "Notebook") : "Notebook");

  // ── Mutations ──
  const moveEntriesTo = async (ids: string[], folderId: string | null) => {
    setEntries((list) => list.map((e) => (ids.includes(e.id) ? { ...e, folderId, folderPosition: "~" } : e)));
    setSelection(new Set());
    await act(moveEntriesAction({ ids, folderId }), `Moved ${ids.length === 1 ? "1 entry" : `${ids.length} entries`} to ${nameOf(folderId)}.`);
  };
  const moveFolderTo = async (folder: FolderItem, parentId: string | null) => {
    const problem = moveProblem(folders, folder.id, parentId);
    if (problem) return void toast.error(problem);
    setFolders((list) => list.map((f) => (f.id === folder.id ? { ...f, parentId, position: "~" } : f)));
    await act(moveFolderAction({ id: folder.id, parentId }), `Moved “${folder.name}” to ${nameOf(parentId)}.`);
  };
  const bulk = async (ids: string[], op: "publish" | "unpublish" | "delete") => {
    const r = await act(bulkEntriesAction({ ids, op }));
    if (r && r !== true) {
      const verb = op === "publish" ? "Published" : op === "unpublish" ? "Unpublished" : "Deleted";
      if (r.done) toast.success(`${verb} ${r.done} ${r.done === 1 ? "entry" : "entries"}.`);
      if (r.failed.length) toast.error(`${r.failed.length} not ${op === "delete" ? "deleted" : `${op}ed`}: ${r.failed[0]!.reason}`);
      setSelection(new Set());
    }
  };

  // ── Drag and drop: only on drop (never while dragging) ──
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const collision: CollisionDetection = useCallback((args) => {
    const hits = pointerWithin(args);
    const tree = hits.find((c) => String(c.id).startsWith("drop:"));
    if (tree) return [tree];
    const kind = String(args.active.id)[0];
    // An entry over a folder row: into that folder.
    if (kind === "e") {
      const f = hits.find((c) => String(c.id).startsWith("f:"));
      if (f) return [f];
    }
    return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((c) => String(c.id)[0] === kind) });
  }, []);
  const onDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id);
    if (id.startsWith("e:")) {
      const entry = entries.find((x) => x.id === id.slice(2));
      const count = selection.has(id.slice(2)) ? selection.size : 1;
      setDragging({ id, label: entry?.title ?? "Entry", count });
    } else setDragging({ id, label: folders.find((x) => x.id === id.slice(2))?.name ?? "Folder", count: 1 });
  };
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const a = String(e.active.id);
    const o = e.over ? String(e.over.id) : null;
    if (!o || a === o) return;
    const target = o.startsWith("drop:") ? (o === "drop:root" ? null : o.slice(5)) : o.startsWith("f:") ? o.slice(2) : undefined;
    if (a.startsWith("e:")) {
      const id = a.slice(2);
      const ids = selection.has(id) ? [...selection] : [id];
      if (target !== undefined) {
        if (target !== cur) void moveEntriesTo(ids, target);
        return;
      }
      if (!o.startsWith("e:")) return;
      const order = here.map((x) => x.id);
      const next = arrayMove(order, order.indexOf(id), order.indexOf(o.slice(2)));
      const i = next.indexOf(id);
      const afterId = next[i - 1] ?? null;
      const beforeId = next[i + 1] ?? null;
      const pos = (x: string | null) => (x ? (here.find((h) => h.id === x)?.folderPosition ?? null) : null);
      let key: string;
      try {
        key = generateKeyBetween(pos(afterId), pos(beforeId));
      } catch {
        key = "~";
      }
      setEntries((list) => list.map((x) => (x.id === id ? { ...x, folderPosition: key } : x)));
      void act(moveEntriesAction({ ids: [id], folderId: cur, afterId, beforeId }));
      return;
    }
    if (a.startsWith("f:")) {
      const folder = folders.find((f) => f.id === a.slice(2));
      if (!folder) return;
      if (o.startsWith("drop:")) {
        if (target !== folder.parentId) void moveFolderTo(folder, target ?? null);
        return;
      }
      // Reorder among this folder's subfolders.
      const order = subfolders.map((f) => f.id);
      const next = arrayMove(order, order.indexOf(folder.id), order.indexOf(o.slice(2)));
      const i = next.indexOf(folder.id);
      const afterId = next[i - 1] ?? null;
      const beforeId = next[i + 1] ?? null;
      const pos = (x: string | null) => (x ? (subfolders.find((f) => f.id === x)?.position ?? null) : null);
      let key: string;
      try {
        key = generateKeyBetween(pos(afterId), pos(beforeId));
      } catch {
        key = "~";
      }
      setFolders((list) => list.map((f) => (f.id === folder.id ? { ...f, position: key } : f)));
      void act(moveFolderAction({ id: folder.id, parentId: cur, afterId, beforeId }));
    }
  };

  // ── Menus ──
  function folderMenuItems(f: FolderItem, close: () => void) {
    const c = counts.get(f.id);
    const run = (fn: () => void) => () => {
      close();
      fn();
    };
    return (
      <>
        <Item icon={PenLine} href={`/dashboard/notebook/new?folder=${f.id}`} onSelect={close}>
          New entry here
        </Item>
        <Item icon={FolderPlus} onSelect={run(() => setDialog({ kind: "new-folder", parentId: f.id }))}>
          New folder inside
        </Item>
        <Item icon={Pencil} onSelect={run(() => setDialog({ kind: "edit-folder", folder: f }))}>
          Rename & details…
        </Item>
        <Item icon={FolderInput} onSelect={run(() => setDialog({ kind: "move-folder", folder: f }))}>
          Move to…
        </Item>
        <Item icon={Copy} onSelect={run(() => void act(duplicateFolderAction({ id: f.id })))}>
          Duplicate
        </Item>
        <Item icon={Download} href={`/api/export/folder/${f.id}?format=md`} download onSelect={close}>
          Export as Markdown (.zip)
        </Item>
        <Separator />
        <Item icon={Send} onSelect={run(() => setDialog({ kind: "publish-folder", folder: f }))}>
          Publish folder…
        </Item>
        {(c?.published || f.isPublic) && (
          <Item icon={EyeOff} onSelect={run(() => setDialog({ kind: "unpublish-folder", folder: f }))}>
            Unpublish folder…
          </Item>
        )}
        {f.isPublic ? (
          <>
            <Item icon={Globe} href={`${init.folderPageBase}${f.slug}`} newTab onSelect={close}>
              View folder page ↗
            </Item>
            <Item icon={EyeOff} onSelect={run(() => void act(setFolderPageAction({ id: f.id, isPublic: false })))}>
              Hide folder page
            </Item>
          </>
        ) : (
          <Item icon={Eye} onSelect={run(() => void act(setFolderPageAction({ id: f.id, isPublic: true })))}>
            Show folder page
          </Item>
        )}
        <Separator />
        <Item icon={Trash2} destructive onSelect={run(() => setDialog({ kind: "delete-folder", folder: f }))}>
          Delete folder…
        </Item>
      </>
    );
  }

  function entryMenuItems(e: EntryItem, close: () => void) {
    const run = (fn: () => void) => () => {
      close();
      fn();
    };
    const live = e.status === "PUBLISHED";
    return (
      <>
        <Item icon={FileText} href={`/dashboard/notebook/${e.id}`} onSelect={close}>
          Open
        </Item>
        <Item icon={Pencil} onSelect={run(() => setRenaming(e.id))}>
          Rename
        </Item>
        <Item icon={FolderInput} onSelect={run(() => setDialog({ kind: "move-entries", ids: [e.id] }))}>
          Move to…
        </Item>
        <Item icon={Copy} onSelect={run(() => void act(duplicateEntryAction({ id: e.id })))}>
          Duplicate
        </Item>
        <Separator />
        {live ? (
          <>
            <Item icon={ArrowUpRight} href={`${init.articleBase}${e.slug}`} newTab onSelect={close}>
              View live ↗
            </Item>
            <Item icon={EyeOff} onSelect={run(() => void bulk([e.id], "unpublish"))}>
              Unpublish
            </Item>
          </>
        ) : (
          <Item icon={Send} onSelect={run(() => void bulk([e.id], "publish"))}>
            Publish
          </Item>
        )}
        <Separator />
        <Item icon={Printer} href={`/print/notebook/${e.id}?auto=1`} newTab onSelect={close}>
          Export PDF
        </Item>
        <Item icon={Download} href={`/api/export/notebook/${e.id}?format=md`} download onSelect={close}>
          Export Markdown
        </Item>
        <Item icon={Download} href={`/api/export/notebook/${e.id}?format=docx`} download onSelect={close}>
          Export Word
        </Item>
        <Item icon={Download} href={`/api/export/notebook/${e.id}?format=html`} download onSelect={close}>
          Export HTML
        </Item>
        <Separator />
        <Item icon={Trash2} destructive onSelect={run(() => setDialog({ kind: "delete-entries", ids: [e.id] }))}>
          Delete…
        </Item>
      </>
    );
  }

  // ── Tree ──
  const Tree = (
    <nav aria-label="Folders" className="space-y-0.5 text-[13px]" data-testid="folder-tree">
      <TreeRow id={null} label="Notebook" icon={<Home className="size-3.5" />} depth={0} active={cur === null} count={entries.filter((e) => !e.folderId).length} onOpen={() => openFolder(null)} />
      {renderTree(null, 1)}
      <button type="button" onClick={() => setDialog({ kind: "new-folder", parentId: null })} className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
        <FolderPlus className="size-3.5" /> New folder
      </button>
    </nav>
  );
  function renderTree(parentId: string | null, depth: number): React.ReactNode {
    return childrenOf(folders, parentId).map((f) => {
      const kids = folders.some((x) => x.parentId === f.id);
      const open = expanded.has(f.id);
      return (
        <div key={f.id}>
          <TreeRow
            id={f.id}
            label={f.name}
            icon={f.icon ? <span className="text-sm leading-none">{f.icon}</span> : open && kids ? <FolderOpen className="size-3.5" /> : <Folder className="size-3.5" />}
            depth={depth}
            active={cur === f.id}
            count={counts.get(f.id)?.entries ?? 0}
            isPublic={f.isPublic}
            expandable={kids}
            expanded={open}
            onToggle={() => setExpanded((s) => (s.has(f.id) ? new Set([...s].filter((x) => x !== f.id)) : new Set([...s, f.id])))}
            onOpen={() => openFolder(f.id)}
            menu={<ActionMenu label={`${f.name} menu`} className="size-6 opacity-0 group-hover/row:opacity-100 focus:opacity-100 aria-expanded:opacity-100">{(close) => folderMenuItems(f, close)}</ActionMenu>}
          />
          {kids && open && renderTree(f.id, depth + 1)}
        </div>
      );
    });
  }

  const allSelected = shown.length > 0 && shown.every((e) => selection.has(e.id));
  const sel = [...selection];

  return (
    <DndContext sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
      <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
        {/* Folder tree */}
        <aside className={cn("lg:block", treeOpen ? "block" : "hidden")}>
          <div className="rounded-xl border bg-surface p-2 lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto">{Tree}</div>
        </aside>

        <section className="min-w-0 space-y-4" aria-label={current ? current.name : "Notebook"}>
          {/* Breadcrumb + header */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" className="lg:hidden" onClick={() => setTreeOpen((o) => !o)} aria-expanded={treeOpen}>
                <Folder /> Folders
              </Button>
              <ol className="flex min-w-0 flex-wrap items-center gap-1 text-[13px] text-muted-foreground" aria-label="Folder path" data-testid="breadcrumb">
                <li>
                  <Crumb id={null} label="Notebook" onOpen={() => openFolder(null)} />
                </li>
                {path.map((f) => (
                  <li key={f.id} className="flex items-center gap-1">
                    <ChevronRight className="size-3" />
                    <Crumb id={f.id} label={`${f.icon ? `${f.icon} ` : ""}${f.name}`} onOpen={() => openFolder(f.id)} />
                  </li>
                ))}
              </ol>
            </div>
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
                  {current?.icon && <span aria-hidden>{current.icon}</span>}
                  <span className="truncate">{current ? current.name : "Notebook"}</span>
                  {current?.isPublic && (
                    <a href={`${init.folderPageBase}${current.slug}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success hover:underline" data-testid="folder-public">
                      <Globe className="size-3" /> Public page
                    </a>
                  )}
                </h1>
                <p className="mt-0.5 text-[13px] text-muted-foreground">
                  {current?.description ? `${current.description} · ` : ""}
                  {current ? `${counts.get(current.id)?.entries ?? 0} entries · ${counts.get(current.id)?.drafts ?? 0} drafts (with subfolders)` : `${entries.length} entries in total · ${entries.filter((e) => e.status !== "PUBLISHED").length} drafts`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "new-folder", parentId: cur })}>
                  <FolderPlus /> New folder
                </Button>
                <Link href={cur ? `/dashboard/notebook/new?folder=${cur}` : "/dashboard/notebook/new"} className={buttonVariants({ size: "sm" })}>
                  <PenLine /> New entry
                </Link>
                {current && <ActionMenu label="Folder menu" className="size-8 border">{(close) => folderMenuItems(current, close)}</ActionMenu>}
              </div>
            </div>
          </div>

          {/* Search */}
          <label className="relative block">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search all entries…" aria-label="Search all entries" className="h-9 w-full rounded-lg border bg-surface pr-8 pl-8 text-[13px] outline-none focus:border-ring" />
            {q && (
              <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground">
                <X className="size-3.5" />
              </button>
            )}
          </label>

          {/* Bulk bar */}
          {selection.size > 0 && (
            <div className="sticky top-14 z-20 flex flex-wrap items-center gap-2 rounded-lg border bg-surface px-3 py-2 text-[13px] shadow-pop lg:top-2" role="toolbar" aria-label="Selected entries">
              <span className="font-medium">{selection.size} selected</span>
              <button type="button" onClick={() => setDialog({ kind: "move-entries", ids: sel })} className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-muted">
                <FolderInput className="size-3.5" /> Move to…
              </button>
              <button type="button" onClick={() => void bulk(sel, "publish")} className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-muted">
                <Send className="size-3.5" /> Publish
              </button>
              <button type="button" onClick={() => void bulk(sel, "unpublish")} className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-muted">
                <EyeOff className="size-3.5" /> Unpublish
              </button>
              <button type="button" onClick={() => setDialog({ kind: "delete-entries", ids: sel })} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-destructive hover:bg-muted">
                <Trash2 className="size-3.5" /> Delete
              </button>
              <button type="button" onClick={() => setSelection(new Set())} className="ml-auto rounded-md px-2 py-1 text-muted-foreground hover:bg-muted">
                Clear
              </button>
            </div>
          )}

          <div className="overflow-hidden rounded-xl border bg-surface">
            {/* Subfolders */}
            {!results && subfolders.length > 0 && (
              <SortableContext items={folderIds} strategy={verticalListSortingStrategy}>
                <ul className="divide-y border-b" aria-label="Folders" data-testid="subfolders">
                  {subfolders.map((f) => (
                    <FolderRow key={f.id} folder={f} counts={counts.get(f.id)} onOpen={() => openFolder(f.id)} menu={<ActionMenu label={`${f.name} menu`}>{(close) => folderMenuItems(f, close)}</ActionMenu>} />
                  ))}
                </ul>
              </SortableContext>
            )}

            {/* Entries */}
            {shown.length > 0 && (
              <div className="flex items-center gap-3 border-b bg-surface-2/40 px-4 py-1.5 text-xs text-muted-foreground">
                <input type="checkbox" aria-label="Select all entries" checked={allSelected} onChange={(e) => setSelection(e.target.checked ? new Set(shown.map((x) => x.id)) : new Set())} />
                <span>{results ? `${results.length} ${results.length === 1 ? "result" : "results"} in all folders` : `${here.length} ${here.length === 1 ? "entry" : "entries"} · drag to reorder or onto a folder`}</span>
              </div>
            )}
            <SortableContext items={entryIds} strategy={verticalListSortingStrategy} disabled={!!results}>
              <ul className="divide-y" aria-label="Entries" data-testid="entries">
                {shown.map((e) => (
                  <EntryRow
                    key={e.id}
                    entry={e}
                    folderPath={results && e.folderId ? pathOf(folders, e.folderId).map((f) => f.name).join(" / ") : null}
                    selected={selection.has(e.id)}
                    sortable={!results}
                    renaming={renaming === e.id}
                    onSelect={(on) => setSelection((s) => (on ? new Set([...s, e.id]) : new Set([...s].filter((x) => x !== e.id))))}
                    onRename={async (title) => {
                      setRenaming(null);
                      if (!title.trim() || title === e.title) return;
                      setEntries((list) => list.map((x) => (x.id === e.id ? { ...x, title } : x)));
                      await act(renameEntryAction({ id: e.id, title }));
                    }}
                    onCancelRename={() => setRenaming(null)}
                    menu={<ActionMenu label={`${e.title || "Entry"} menu`}>{(close) => entryMenuItems(e, close)}</ActionMenu>}
                  />
                ))}
              </ul>
            </SortableContext>

            {!shown.length && (results || !subfolders.length) && (
              <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
                <NotebookPen className="size-8 text-muted-foreground/50" />
                <p className="font-medium">{results ? "No entries match" : current ? "This folder is empty" : "Your notebook is empty"}</p>
                <p className="max-w-sm text-[13px] text-muted-foreground">{results ? "Try other words — search looks at titles, subtitles and summaries in every folder." : "Write an entry here, add a folder, or drag entries in from another folder."}</p>
                {!results && (
                  <Link href={cur ? `/dashboard/notebook/new?folder=${cur}` : "/dashboard/notebook/new"} className={buttonVariants({ size: "sm" })}>
                    <PenLine /> New entry
                  </Link>
                )}
              </div>
            )}
          </div>
        </section>
      </div>

      <DragOverlay dropAnimation={null}>
        {dragging && (
          <div className="inline-flex max-w-64 items-center gap-2 rounded-lg border bg-surface px-3 py-2 text-[13px] font-medium shadow-pop">
            {dragging.id.startsWith("f:") ? <Folder className="size-3.5" /> : <FileText className="size-3.5" />}
            <span className="truncate">{dragging.label}</span>
            {dragging.count > 1 && <span className="rounded-full bg-primary px-1.5 text-[11px] text-primary-foreground">{dragging.count}</span>}
          </div>
        )}
      </DragOverlay>

      {/* Dialogs */}
      {dialog?.kind === "new-folder" && (
        <FolderDialog
          folder={null}
          title={dialog.parentId ? `New folder in ${nameOf(dialog.parentId)}` : "New folder"}
          onClose={() => setDialog(null)}
          onSave={async (v) => {
            const made = await act(createFolderAction({ ...v, parentId: dialog.parentId }));
            if (made && made !== true) {
              if (dialog.parentId) setExpanded((s) => new Set([...s, dialog.parentId!]));
              setFolders((list) => [...list, made]);
            }
            return !!made;
          }}
        />
      )}
      {dialog?.kind === "edit-folder" && (
        <FolderDialog
          folder={dialog.folder}
          title="Folder details"
          folderPageBase={init.folderPageBase}
          onClose={() => setDialog(null)}
          onSave={async (v) => !!(await act(updateFolderAction({ id: dialog.folder.id, ...v })))}
        />
      )}
      {dialog?.kind === "move-folder" && (
        <MoveDialog folders={folders} title={`Move “${dialog.folder.name}”`} current={dialog.folder.parentId} moving={dialog.folder.id} onClose={() => setDialog(null)} onMove={(to) => moveFolderTo(dialog.folder, to)} />
      )}
      {dialog?.kind === "move-entries" && (
        <MoveDialog
          folders={folders}
          title={dialog.ids.length === 1 ? `Move “${entries.find((e) => e.id === dialog.ids[0])?.title ?? "entry"}”` : `Move ${dialog.ids.length} entries`}
          current={dialog.ids.length === 1 ? (entries.find((e) => e.id === dialog.ids[0])?.folderId ?? null) : null}
          onClose={() => setDialog(null)}
          onMove={(to) => moveEntriesTo(dialog.ids, to)}
        />
      )}
      {dialog?.kind === "publish-folder" && (
        <PublishFolderDialog
          folder={dialog.folder}
          entries={entriesOf(dialog.folder.id)}
          folderPageBase={init.folderPageBase}
          onClose={() => setDialog(null)}
          onPublish={async (opts) => {
            const r = await act(publishFolderAction({ id: dialog.folder.id, ...opts }));
            return r && r !== true ? r : null;
          }}
        />
      )}
      {dialog?.kind === "unpublish-folder" && (
        <ConfirmDialog
          title={`Unpublish “${dialog.folder.name}”?`}
          description={`Its ${counts.get(dialog.folder.id)?.published ?? 0} published ${counts.get(dialog.folder.id)?.published === 1 ? "entry goes" : "entries go"} back to drafts (subfolders too), and the folder page is hidden.`}
          confirm="Unpublish"
          onClose={() => setDialog(null)}
          onConfirm={() => act(unpublishFolderAction({ id: dialog.folder.id }))}
        />
      )}
      {dialog?.kind === "delete-folder" && (
        <DeleteFolderDialog
          folder={dialog.folder}
          parentName={nameOf(dialog.folder.parentId)}
          entries={counts.get(dialog.folder.id)?.entries ?? 0}
          folders={subtreeIds(folders, dialog.folder.id).size - 1}
          onClose={() => setDialog(null)}
          onDelete={async (mode) => {
            if (cur && subtreeIds(folders, dialog.folder.id).has(cur)) openFolder(dialog.folder.parentId);
            await act(deleteFolderAction({ id: dialog.folder.id, mode }));
          }}
        />
      )}
      {dialog?.kind === "delete-entries" && (
        <ConfirmDialog
          title={dialog.ids.length === 1 ? `Delete “${entries.find((e) => e.id === dialog.ids[0])?.title ?? "entry"}”?` : `Delete ${dialog.ids.length} entries?`}
          description="This can't be undone. Published entries leave your timeline."
          confirm="Delete permanently"
          onClose={() => setDialog(null)}
          onConfirm={() => bulk(dialog.ids, "delete")}
        />
      )}
    </DndContext>
  );
}

// ── Rows ───────────────────────────────────────────────────────────────────

function Crumb({ id, label, onOpen }: { id: string | null; label: string; onOpen: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: `drop:${id ?? "root"}:crumb` });
  return (
    <button ref={setNodeRef} type="button" onClick={onOpen} className={cn("truncate rounded px-1 hover:bg-muted hover:text-foreground", isOver && "bg-primary/15 text-foreground")}>
      {label}
    </button>
  );
}

function TreeRow(p: {
  id: string | null;
  label: string;
  icon: React.ReactNode;
  depth: number;
  active: boolean;
  count: number;
  isPublic?: boolean;
  expandable?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  onOpen: () => void;
  menu?: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `drop:${p.id ?? "root"}` });
  return (
    <div
      ref={setNodeRef}
      className={cn("group/row flex items-center gap-1 rounded-md pr-1", p.active ? "bg-primary/10 font-medium text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground", isOver && "ring-2 ring-primary/50")}
      style={{ paddingLeft: `${0.25 + Math.max(0, p.depth - 1) * 0.85}rem` }}
      data-folder-row={p.id ?? "root"}
    >
      {p.expandable ? (
        <button type="button" onClick={p.onToggle} aria-label={p.expanded ? `Collapse ${p.label}` : `Expand ${p.label}`} aria-expanded={p.expanded} className="rounded p-0.5 hover:bg-background">
          <ChevronRight className={cn("size-3 transition-transform", p.expanded && "rotate-90")} />
        </button>
      ) : (
        <span className="w-4" />
      )}
      <button type="button" onClick={p.onOpen} aria-current={p.active ? "page" : undefined} className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left">
        <span className="flex w-4 shrink-0 justify-center">{p.icon}</span>
        <span className="truncate">{p.label}</span>
        {p.isPublic && <Globe className="size-3 shrink-0 text-success" aria-label="Public" />}
      </button>
      <span className="text-[11px] text-muted-foreground tabular-nums group-hover/row:hidden">{p.count || ""}</span>
      {p.menu}
    </div>
  );
}

function FolderRow({ folder, counts, onOpen, menu }: { folder: FolderItem; counts?: { entries: number; drafts: number }; onOpen: () => void; menu: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({ id: `f:${folder.id}`, animateLayoutChanges: () => false });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} className={cn("group flex items-center gap-2 px-3 py-2.5", isDragging && "opacity-40", isOver && !isDragging && "bg-primary/10")} data-testid="folder-row">
      <button type="button" {...attributes} {...listeners} aria-label={`Drag ${folder.name}`} className="cursor-grab rounded p-0.5 text-muted-foreground/60 opacity-0 group-hover:opacity-100 focus:opacity-100 active:cursor-grabbing">
        <GripVertical className="size-3.5" />
      </button>
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-base">{folder.icon ?? <Folder className="size-4 text-muted-foreground" />}</span>
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 font-medium">
            <span className="truncate">{folder.name}</span>
            {folder.isPublic && <Globe className="size-3 text-success" aria-label="Public" />}
          </span>
          <span className="block text-xs text-muted-foreground">
            {counts?.entries ?? 0} {counts?.entries === 1 ? "entry" : "entries"}
            {counts?.drafts ? ` · ${counts.drafts} draft${counts.drafts === 1 ? "" : "s"}` : ""}
          </span>
        </span>
      </button>
      {menu}
    </li>
  );
}

function EntryRow(p: {
  entry: EntryItem;
  folderPath: string | null;
  selected: boolean;
  sortable: boolean;
  renaming: boolean;
  onSelect: (on: boolean) => void;
  onRename: (title: string) => void;
  onCancelRename: () => void;
  menu: React.ReactNode;
}) {
  const e = p.entry;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `e:${e.id}`, disabled: !p.sortable, animateLayoutChanges: () => false });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} className={cn("group flex items-start gap-3 px-4 py-3", isDragging && "opacity-40", p.selected && "bg-primary/5")} data-entry-id={e.id}>
      <span className="flex items-center gap-1.5 pt-0.5">
        {p.sortable && (
          <button type="button" {...attributes} {...listeners} aria-label={`Drag ${e.title}`} className="-ml-2 cursor-grab rounded p-0.5 text-muted-foreground/60 opacity-0 group-hover:opacity-100 focus:opacity-100 active:cursor-grabbing">
            <GripVertical className="size-3.5" />
          </button>
        )}
        <input type="checkbox" aria-label={`Select ${e.title}`} checked={p.selected} onChange={(ev) => p.onSelect(ev.target.checked)} className={cn(!p.selected && "opacity-0 group-hover:opacity-100 focus:opacity-100")} />
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        {p.renaming ? (
          <input
            autoFocus
            defaultValue={e.title}
            maxLength={300}
            aria-label="Entry title"
            onBlur={(ev) => p.onRename(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === "Enter") (ev.target as HTMLInputElement).blur();
              if (ev.key === "Escape") p.onCancelRename();
            }}
            className="w-full rounded-md border bg-background px-2 py-0.5 font-medium outline-none focus:border-ring"
          />
        ) : (
          <Link href={`/dashboard/notebook/${e.id}`} className="block truncate font-medium hover:underline">
            {e.title}
          </Link>
        )}
        {(e.subtitle ?? e.summary) && <p className="line-clamp-1 text-[13px] text-muted-foreground">{e.subtitle ?? e.summary}</p>}
        <p className="text-xs text-muted-foreground">
          {p.folderPath && (
            <span className="mr-1 inline-flex items-center gap-1">
              <Folder className="size-3" /> {p.folderPath} ·
            </span>
          )}
          Edited {formatDate(e.updatedAt)} · {(e.wordCount ?? 0).toLocaleString()} words
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <StatusBadge status={e.status as never} />
        {p.menu}
      </div>
    </li>
  );
}
