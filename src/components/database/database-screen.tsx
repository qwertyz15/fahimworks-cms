"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDownUp, ArrowLeft, Archive, ArchiveRestore, CalendarDays, Copy, Filter, GanttChart, ImagePlus, Kanban, LayoutGrid, LayoutTemplate, List, MoreHorizontal, Plus, Search, Settings2, Table2, Trash2, X, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { localToday } from "@/lib/dates";
import { COMPUTED_TYPES, type PropertyConfig, type PropertyType, type PropertyValue } from "@/lib/db-properties";
import { ENABLED_VIEW_TYPES, type DateWindow, type FilterGroup, type SortRule, type ViewConfig, type ViewType } from "@/lib/db-views";
import {
  addPropertyAction,
  archiveDatabaseAction,
  archiveRowsAction,
  bulkUpdateAction,
  changePropertyTypeAction,
  createRowAction,
  createViewAction,
  deleteDatabaseAction,
  deletePropertyAction,
  deleteRowsAction,
  deleteViewAction,
  duplicateDatabaseAction,
  duplicateRowAction,
  moveRowAction,
  queryRowsAction,
  updateDatabaseAction,
  updatePropertyAction,
  updateRowAction,
  updateViewAction,
} from "@/server/actions/databases";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { uploadImage } from "@/components/editor/upload";
import type { EditorUploadConfig } from "@/components/editor/rich-editor";
import { Popover, PopoverButton } from "./popover";
import { AddPropertyMenu, PropertyMenu } from "./property-menu";
import { FilterMenu, PropertiesMenu, SortMenu, countRules } from "./toolbar-menus";
import { ValueEditor } from "./cells";
import { TableView } from "./table-view";
import { BoardView } from "./board-view";
import { ListView } from "./list-view";
import { GalleryView } from "./gallery-view";
import { CalendarView } from "./calendar-view";
import { TimelineView } from "./timeline-view";
import { LayoutMenu } from "./layout-menu";
import { PeekPanel } from "./peek-panel";
import { EmojiPicker } from "./emoji-picker";
import type { DbMeta, Person, PropertyDef, Row, ViewDef } from "./types";
import type { ViewProps } from "./view-props";

export const VIEW_ICONS: Record<ViewType, LucideIcon> = { TABLE: Table2, BOARD: Kanban, LIST: List, CALENDAR: CalendarDays, TIMELINE: GanttChart, GALLERY: LayoutGrid };
const VIEW_LABELS: Record<ViewType, string> = { TABLE: "Table", BOARD: "Board", LIST: "List", CALENDAR: "Calendar", TIMELINE: "Timeline", GALLERY: "Gallery" };


const byPosition = (a: Row, b: Row) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0);

/** Run an action; errors become a toast. Resolves to { data } on success, null on failure. */
async function act<T>(p: Promise<{ ok: true; data?: T; message?: string } | { ok: false; error: string }>, fallback = "Something went wrong."): Promise<{ data: T } | null> {
  const r = await p;
  if (!r.ok) {
    toast.error(r.error || fallback);
    return null;
  }
  return { data: r.data as T };
}

export function DatabaseScreen(init: {
  database: DbMeta;
  properties: PropertyDef[];
  views: ViewDef[];
  people: Person[];
  rows: Row[];
  total: number;
  activeViewId: string;
  uploads: EditorUploadConfig;
  articleBaseUrl: string;
  /** Row open in the peek panel (?p=). */
  peekId?: string | null;
}) {
  const router = useRouter();
  const dbId = init.database.id;
  const [meta, setMeta] = useState(init.database);
  const [props, setProps] = useState(init.properties);
  const [views, setViews] = useState(init.views);
  const [activeId, setActiveId] = useState(init.activeViewId);
  const [rows, setRows] = useState(init.rows);
  const [total, setTotal] = useState(init.total);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ def: PropertyDef; anchor: HTMLElement } | null>(null);
  const [adding, setAdding] = useState<HTMLElement | null>(null);
  const [confirm, setConfirm] = useState<null | "database" | "rows">(null);
  /** A row created from the toolbar: the table starts editing its title. */
  const [autoEdit, setAutoEdit] = useState<string | null>(null);
  const view = views.find((v) => v.id === activeId) ?? views[0]!;
  const req = useRef(0);
  /** Calendar / timeline date window (reported by those views). */
  const windowRef = useRef<DateWindow | null>(null);
  const [peekId, setPeekId] = useState<string | null>(init.peekId ?? null);
  const today = useMemo(() => localToday(), []);

  // ── Rows ────────────────────────────────────────────────────────────────
  const query = useCallback(
    async (v: ViewDef, q: string, offset = 0) => {
      const n = ++req.current;
      setLoading(true);
      const res = await queryRowsAction({ databaseId: dbId, filter: v.config.filter ?? null, sorts: v.config.sorts ?? [], search: q, today: localToday(), offset, window: windowRef.current });
      if (n !== req.current) return;
      setLoading(false);
      if (!res.ok || !res.data) return void toast.error(res.ok ? "Could not load rows." : res.error);
      const data = res.data;
      setRows((cur) => (offset ? [...cur, ...data.rows.filter((r) => !cur.some((c) => c.id === r.id))] : data.rows));
      setTotal(data.total);
    },
    [dbId],
  );

  // Re-query when the search text changes (debounced).
  const firstSearch = useRef(true);
  useEffect(() => {
    if (firstSearch.current) {
      firstSearch.current = false;
      return;
    }
    const t = setTimeout(() => void query(view, search), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on search changes
  }, [search]);

  const updateRow: ViewProps["onUpdateRow"] = async (id, patch) => {
    const before = rows.find((r) => r.id === id);
    if (!before) {
      // A row not in the list (e.g. from a "No date" tray): save, then show it.
      const res = await act(updateRowAction({ id, ...patch }));
      if (res?.data) setRows((cur) => [...cur.filter((r) => r.id !== id), res.data]);
      return;
    }
    const optimistic = { ...before, ...(patch.title !== undefined ? { title: patch.title } : {}), values: { ...before.values } };
    for (const [k, v] of Object.entries(patch.values ?? {})) {
      if (v === null) delete optimistic.values[k];
      else optimistic.values[k] = v;
    }
    setRows((cur) => cur.map((r) => (r.id === id ? optimistic : r)));
    const res = await act(updateRowAction({ id, ...patch }));
    setRows((cur) => cur.map((r) => (r.id === id ? (res?.data ?? before) : r)));
  };

  const createRow: ViewProps["onCreateRow"] = async (initRow) => {
    // New rows match the view's simple "is" filters, so they don't vanish.
    const values: Record<string, PropertyValue> = { ...(initRow?.values ?? {}) };
    for (const c of view.config.filter?.op === "and" ? view.config.filter.children : []) {
      if (c.kind === "rule" && c.operator === "is" && typeof c.value === "string" && !(c.propertyId in values)) values[c.propertyId] = c.value;
      if (c.kind === "rule" && c.operator === "checked" && !(c.propertyId in values)) values[c.propertyId] = true;
    }
    const row = (await act(createRowAction({ databaseId: dbId, title: initRow?.title, values, afterId: initRow?.afterId ?? null })))?.data;
    if (!row) return null;
    setRows((cur) => [...cur, row]);
    setTotal((t) => t + 1);
    return row;
  };

  const moveRow: ViewProps["onMoveRow"] = async (id, input) => {
    const before = rows.find((r) => r.id === id);
    if (!before) return;
    if (input.set) {
      const values = { ...before.values };
      for (const [k, v] of Object.entries(input.set)) {
        if (v === null) delete values[k];
        else values[k] = v;
      }
      setRows((cur) => cur.map((r) => (r.id === id ? { ...r, values } : r)));
    }
    const saved = (await act(moveRowAction({ id, ...input })))?.data;
    setRows((cur) => {
      const next = cur.map((r) => (r.id === id ? (saved ?? before) : r));
      return view.config.sorts?.length ? next : [...next].sort(byPosition);
    });
  };

  const urlFor = (viewId: string, peek: string | null) => `/dashboard/databases/${dbId}?view=${viewId}${peek ? `&p=${peek}` : ""}`;
  const openRow = (id: string) => {
    if (view.config.openIn === "page") return router.push(`/dashboard/pages/${id}`);
    setPeekId(id);
    window.history.replaceState(null, "", urlFor(view.id, id));
  };
  const closePeek = useCallback(() => {
    setPeekId(null);
    window.history.replaceState(null, "", urlFor(activeId, null));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- urlFor only uses dbId
  }, [activeId, dbId]);
  const onPeekRowChange = useCallback((row: Row) => setRows((cur) => cur.map((r) => (r.id === row.id ? { ...row, position: r.position } : r))), []);

  // Calendar / timeline report their visible range; reload when it changes.
  const viewRef = useRef(view);
  const searchRef = useRef(search);
  useEffect(() => {
    viewRef.current = view;
    searchRef.current = search;
  });
  const onWindowChange = useCallback(
    (w: DateWindow | null) => {
      const same = JSON.stringify(w) === JSON.stringify(windowRef.current);
      windowRef.current = w;
      if (!same && w) void query(viewRef.current, searchRef.current);
    },
    [query],
  );
  const queryUndated = useCallback(
    async (propertyId: string) => {
      const v = viewRef.current;
      const res = await queryRowsAction({ databaseId: dbId, filter: v.config.filter ?? null, sorts: v.config.sorts ?? [], search: searchRef.current, today: localToday(), undatedBy: propertyId });
      return res.ok && res.data ? res.data.rows : [];
    },
    [dbId],
  );

  // ── Views ───────────────────────────────────────────────────────────────
  // View settings save shortly after the last change; anything still pending is
  // flushed when leaving the page (client navigation unmounts this screen).
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pendingConfigs = useRef<Record<string, ViewConfig>>({});
  const flushView = useCallback((id: string) => {
    clearTimeout(saveTimers.current[id]);
    const config = pendingConfigs.current[id];
    if (!config) return;
    delete pendingConfigs.current[id];
    void act(updateViewAction({ id, config }));
  }, []);
  useEffect(() => {
    const flushAll = () => Object.keys(pendingConfigs.current).forEach(flushView);
    window.addEventListener("pagehide", flushAll);
    return () => {
      window.removeEventListener("pagehide", flushAll);
      flushAll();
    };
  }, [flushView]);
  const updateView = (patch: Partial<ViewConfig>, target = view) => {
    const next: ViewDef = { ...target, config: { ...target.config, ...patch } };
    setViews((cur) => cur.map((v) => (v.id === target.id ? next : v)));
    pendingConfigs.current[target.id] = next.config;
    clearTimeout(saveTimers.current[target.id]);
    saveTimers.current[target.id] = setTimeout(() => flushView(target.id), 400);
    if ("filter" in patch || "sorts" in patch) void query(next, search);
  };

  const switchView = (id: string) => {
    const v = views.find((x) => x.id === id);
    if (!v || id === activeId) return;
    setActiveId(id);
    setSelection(new Set());
    windowRef.current = null;
    window.history.replaceState(null, "", urlFor(id, null));
    setPeekId(null);
    if (v.type !== "CALENDAR" && v.type !== "TIMELINE") void query(v, search);
  };

  const addView = async (type: ViewType) => {
    const v = (await act(createViewAction({ databaseId: dbId, type })))?.data;
    if (!v) return;
    setViews((cur) => [...cur, v]);
    setActiveId(v.id);
    windowRef.current = null;
    window.history.replaceState(null, "", urlFor(v.id, null));
    if (v.type !== "CALENDAR" && v.type !== "TIMELINE") void query(v, search);
  };

  const removeView = async (id: string) => {
    if (views.length <= 1) return;
    if (!(await act(deleteViewAction({ id })))) return;
    const rest = views.filter((v) => v.id !== id);
    setViews(rest);
    if (id === activeId) switchView(rest[0]!.id);
  };

  // ── Properties ──────────────────────────────────────────────────────────
  const setProp = (def: PropertyDef) => setProps((cur) => cur.map((p) => (p.id === def.id ? def : p)));
  const updateConfig = async (def: PropertyDef, config: PropertyConfig) => {
    const saved = (await act(updatePropertyAction({ id: def.id, config: config as Record<string, unknown> })))?.data;
    if (saved) setProp(saved);
    return saved ?? null;
  };
  const updateOptions: ViewProps["onUpdateOptions"] = async (propertyId, options) => {
    const def = props.find((p) => p.id === propertyId);
    if (!def) return null;
    const saved = await updateConfig(def, { ...def.config, options });
    if (saved && options.length < (def.config.options?.length ?? 0)) void query(view, search);
    return saved?.config.options ?? null;
  };
  const addProperty = async (type: PropertyType, name: string) => {
    setAdding(null);
    const def = (await act(addPropertyAction({ databaseId: dbId, name, type })))?.data;
    if (!def) return;
    setProps((cur) => [...cur, def]);
    if (view.config.order?.length) updateView({ order: [...view.config.order, def.id] });
  };
  const changeType = async (def: PropertyDef, type: PropertyType) => {
    const saved = (await act(changePropertyTypeAction({ id: def.id, type })))?.data;
    if (!saved) return;
    setProp(saved);
    toast.success(`${def.name} is now a ${type.replace("_", "-").toLowerCase()} property.`);
    void query(view, search);
  };
  const removeProperty = async (def: PropertyDef) => {
    if (!(await act(deletePropertyAction({ id: def.id })))) return;
    setProps((cur) => cur.filter((p) => p.id !== def.id));
    setRows((cur) => cur.map((r) => {
      const values = { ...r.values };
      delete values[def.id];
      return { ...r, values };
    }));
  };

  // Visible properties in the view's order; Title first.
  const ordered = useMemo(() => {
    const order = view.config.order ?? [];
    const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length + props.findIndex((p) => p.id === id));
    return [...props].sort((a, b) => (a.isTitle ? -1 : b.isTitle ? 1 : rank(a.id) - rank(b.id)));
  }, [props, view.config.order]);
  const hidden = useMemo(() => new Set(view.config.hidden ?? []), [view.config.hidden]);
  const visible = useMemo(() => ordered.filter((p) => p.isTitle || !hidden.has(p.id)), [ordered, hidden]);

  // ── Database meta ───────────────────────────────────────────────────────
  const saveMeta = (patch: Partial<DbMeta>) => {
    setMeta((m) => ({ ...m, ...patch }));
    void act(updateDatabaseAction({ id: dbId, ...patch }));
  };
  const coverInput = useRef<HTMLInputElement>(null);
  const uploadCover = async (file: File) => {
    if (!init.uploads.enabled) return void toast.error("Uploads aren't set up yet.");
    try {
      const url = await uploadImage(file, { maxBytes: init.uploads.maxBytes });
      saveMeta({ coverImage: url });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed.");
    }
  };

  // ── Selection / bulk ────────────────────────────────────────────────────
  const onSelect = (ids: string[], on: boolean) =>
    setSelection((cur) => {
      const next = new Set(cur);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  const selected = [...selection];
  const [bulkProp, setBulkProp] = useState<{ def: PropertyDef; anchor: HTMLElement } | null>(null);
  const bulkSet = async (def: PropertyDef, value: PropertyValue) => {
    const n = (await act(bulkUpdateAction({ databaseId: dbId, ids: selected, propertyId: def.id, value })))?.data;
    if (n === undefined) return;
    toast.success(`Updated ${n} ${n === 1 ? "row" : "rows"}.`);
    void query(view, search);
  };
  const bulkArchive = async () => {
    const n = (await act(archiveRowsAction({ databaseId: dbId, ids: selected, archived: true })))?.data;
    if (n === undefined) return;
    setRows((cur) => cur.filter((r) => !selection.has(r.id)));
    setTotal((t) => t - n);
    setSelection(new Set());
    toast.success(`Archived ${n} ${n === 1 ? "row" : "rows"}.`, {
      action: {
        label: "Undo",
        onClick: () => void act(archiveRowsAction({ databaseId: dbId, ids: selected, archived: false })).then(() => query(view, search)),
      },
    });
  };
  const bulkDelete = async () => {
    setConfirm(null);
    const n = (await act(deleteRowsAction({ databaseId: dbId, ids: selected })))?.data;
    if (n === undefined) return;
    setRows((cur) => cur.filter((r) => !selection.has(r.id)));
    setTotal((t) => t - n);
    setSelection(new Set());
    toast.success(`Deleted ${n} ${n === 1 ? "row" : "rows"}.`);
  };
  const duplicateOne = async () => {
    if (!(await act(duplicateRowAction({ id: selected[0] })))) return;
    setSelection(new Set());
    void query(view, search);
  };

  const viewProps: ViewProps = {
    view,
    props: visible,
    allProps: ordered,
    rows,
    total,
    people: init.people,
    uploads: init.uploads,
    selection,
    onSelect,
    onUpdateRow: updateRow,
    onCreateRow: createRow,
    onOpenRow: openRow,
    onMoveRow: moveRow,
    onUpdateOptions: updateOptions,
    onUpdateView: (patch) => updateView(patch),
    onPropertyMenu: (def, anchor) => setMenu({ def, anchor }),
    onAddProperty: (anchor) => setAdding(anchor),
    onLoadMore: () => void query(view, search, rows.length),
    loading,
    canReorder: !view.config.sorts?.length,
    autoEditRowId: autoEdit,
    onWindowChange,
    queryUndated,
    today,
  };

  const filterCount = countRules(view.config.filter);
  const sortCount = view.config.sorts?.length ?? 0;
  const groupable = ordered.filter((p) => p.type === "SELECT" || p.type === "STATUS");

  return (
    <div className="-mx-4 -mt-6 sm:-mx-6 lg:-mx-8 lg:-mt-8">
      {/* Cover */}
      {meta.coverImage ? (
        <div className="group/cover relative h-40 w-full bg-muted sm:h-52">
          {/* eslint-disable-next-line @next/next/no-img-element -- media bucket image */}
          <img src={meta.coverImage} alt="" className="size-full object-cover" />
          <div className="absolute right-4 bottom-3 flex gap-1 opacity-0 transition-opacity group-hover/cover:opacity-100 focus-within:opacity-100">
            <Button size="sm" variant="outline" onClick={() => coverInput.current?.click()}>
              Change cover
            </Button>
            <Button size="sm" variant="outline" onClick={() => saveMeta({ coverImage: null })}>
              Remove
            </Button>
          </div>
        </div>
      ) : null}
      <input ref={coverInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" hidden onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (f) void uploadCover(f);
      }} />

      <div className="px-4 pt-6 pb-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-2">
          <Link href="/dashboard/databases" className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" /> Databases
          </Link>
          <div className="flex items-center gap-1">
            {!meta.coverImage && (
              <Button size="sm" variant="ghost" onClick={() => coverInput.current?.click()}>
                <ImagePlus /> Add cover
              </Button>
            )}
            <PopoverButton label="Database menu" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" placement="bottom-end" content={(close) => (
              <div className="w-52">
                <MenuItem icon={Copy} onClick={async () => { close(); const d = (await act(duplicateDatabaseAction({ id: dbId, withRows: true })))?.data; if (d) router.push(`/dashboard/databases/${d.id}`); }}>Duplicate</MenuItem>
                {meta.archived ? (
                  <MenuItem icon={ArchiveRestore} onClick={async () => { close(); if (await act(archiveDatabaseAction({ id: dbId, archived: false }))) setMeta((m) => ({ ...m, archived: false })); }}>Restore</MenuItem>
                ) : (
                  <MenuItem icon={Archive} onClick={async () => { close(); if (await act(archiveDatabaseAction({ id: dbId, archived: true }))) router.push("/dashboard/databases"); }}>Archive</MenuItem>
                )}
                <MenuItem icon={Trash2} destructive onClick={() => (close(), setConfirm("database"))}>Delete…</MenuItem>
              </div>
            )}>
              <MoreHorizontal className="size-4" />
            </PopoverButton>
          </div>
        </div>

        {meta.archived && (
          <p className="mt-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[13px]">This database is archived. Restore it from the ⋯ menu to use it again.</p>
        )}

        <div className="mt-4 flex items-start gap-3">
          <EmojiPicker value={meta.icon} onChange={(icon) => saveMeta({ icon })} />
          <div className="min-w-0 flex-1">
            <input
              defaultValue={meta.title}
              key={`t-${meta.id}`}
              maxLength={200}
              onBlur={(e) => e.target.value.trim() !== meta.title && saveMeta({ title: e.target.value.trim() || "Untitled database" })}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              aria-label="Database title"
              className="w-full bg-transparent text-3xl font-semibold tracking-tight outline-none"
            />
            <input
              defaultValue={meta.description ?? ""}
              key={`d-${meta.id}`}
              maxLength={2000}
              placeholder="Add a description…"
              onBlur={(e) => e.target.value !== (meta.description ?? "") && saveMeta({ description: e.target.value || null })}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              aria-label="Database description"
              className="mt-1 w-full bg-transparent text-sm text-muted-foreground outline-none placeholder:text-muted-foreground/50"
            />
          </div>
        </div>

        {/* View tabs + toolbar */}
        <div className="mt-5 flex flex-wrap items-center gap-2 border-b">
          <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto" role="tablist" aria-label="Views">
            {views.map((v) => {
              const Icon = VIEW_ICONS[v.type];
              const on = v.id === view.id;
              return (
                <ViewTab key={v.id} view={v} active={on} icon={Icon} onSelect={() => switchView(v.id)} onRename={(name) => { setViews((cur) => cur.map((x) => (x.id === v.id ? { ...x, name } : x))); void act(updateViewAction({ id: v.id, name })); }} onDelete={views.length > 1 ? () => void removeView(v.id) : undefined} />
              );
            })}
            <PopoverButton label="Add a view" className="ml-1 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" content={(close) => (
              <div className="w-44">
                {ENABLED_VIEW_TYPES.map((t) => {
                  const Icon = VIEW_ICONS[t];
                  return <MenuItem key={t} icon={Icon} onClick={() => (close(), void addView(t))}>{VIEW_LABELS[t]}</MenuItem>;
                })}
              </div>
            )}>
              <Plus className="size-4" />
            </PopoverButton>
          </div>

          <div className="flex w-full flex-wrap items-center gap-1 pb-1.5 sm:w-auto">
            {view.type === "BOARD" && groupable.length > 0 && (
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                Group by
                <select value={view.config.groupBy ?? ""} onChange={(e) => updateView({ groupBy: e.target.value || null })} aria-label="Group by" className="rounded-md border bg-background px-1.5 py-0.5 text-xs text-foreground">
                  {groupable.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </label>
            )}
            <PopoverButton label="Filter" className={cn("inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] whitespace-nowrap hover:bg-muted", filterCount ? "text-primary" : "text-muted-foreground")} placement="bottom-end" content={() => (
              <FilterMenu props={ordered} filter={view.config.filter} onChange={(f: FilterGroup | null) => updateView({ filter: f })} />
            )}>
              <Filter className="size-3.5" /> Filter{filterCount ? ` · ${filterCount}` : ""}
            </PopoverButton>
            <PopoverButton label="Sort" className={cn("inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] whitespace-nowrap hover:bg-muted", sortCount ? "text-primary" : "text-muted-foreground")} placement="bottom-end" content={() => (
              <SortMenu props={ordered} sorts={view.config.sorts ?? []} onChange={(s: SortRule[]) => updateView({ sorts: s })} />
            )}>
              <ArrowDownUp className="size-3.5" /> Sort{sortCount ? ` · ${sortCount}` : ""}
            </PopoverButton>
            <PopoverButton label="Layout" className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] whitespace-nowrap text-muted-foreground hover:bg-muted" placement="bottom-end" content={() => (
              <LayoutMenu view={view} props={ordered} onChange={(patch) => updateView(patch)} />
            )}>
              <LayoutTemplate className="size-3.5" /> Layout
            </PopoverButton>
            <PopoverButton label="Properties" className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] whitespace-nowrap text-muted-foreground hover:bg-muted" placement="bottom-end" content={() => (
              <PropertiesMenu
                props={ordered}
                hidden={hidden}
                onToggle={(id) => updateView({ hidden: hidden.has(id) ? [...hidden].filter((x) => x !== id) : [...hidden, id] })}
                onReorder={(ids) => updateView({ order: ids })}
                onAdd={() => setAdding(document.querySelector<HTMLElement>('[aria-label="Properties"]'))}
                onEdit={(def, anchor) => setMenu({ def, anchor })}
              />
            )}>
              <Settings2 className="size-3.5" /> Properties
            </PopoverButton>
            <label className="relative order-last basis-full sm:order-none sm:basis-auto">
              <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" aria-label="Search rows" className="h-8 w-full rounded-md border bg-background pr-2 pl-7 text-[13px] outline-none focus:border-ring sm:w-44 sm:focus:w-52" />
            </label>
            <Button size="sm" onClick={async () => { const r = await createRow(); if (r && view.type === "TABLE") setAutoEdit(r.id); else if (r) openRow(r.id); }}>
              <Plus /> New
            </Button>
          </div>
        </div>
      </div>

      {/* Bulk actions */}
      {selection.size > 0 && (
        <div className="sticky top-14 z-20 mx-4 mb-2 flex flex-wrap items-center gap-2 rounded-lg border bg-surface px-3 py-2 text-[13px] shadow-pop sm:mx-6 lg:top-2 lg:mx-8" role="toolbar" aria-label="Selected rows">
          <span className="font-medium">{selection.size} selected</span>
          <PopoverButton label="Set property" className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-muted" content={(close) => (
            <div className="w-52">
              {ordered.filter((p) => !p.isTitle && !COMPUTED_TYPES.includes(p.type) && p.type !== "FILES").map((p) => (
                <MenuItem key={p.id} onClick={(e) => { const anchor = (e.currentTarget as HTMLElement).closest("[data-popover]") as HTMLElement; close(); setBulkProp({ def: p, anchor: anchor ?? document.body }); }}>{p.name}</MenuItem>
              ))}
            </div>
          )}>
            Set property…
          </PopoverButton>
          {selection.size === 1 && (
            <button type="button" onClick={() => void duplicateOne()} className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-muted"><Copy className="size-3.5" /> Duplicate</button>
          )}
          <button type="button" onClick={() => void bulkArchive()} className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-muted"><Archive className="size-3.5" /> Archive</button>
          <button type="button" onClick={() => setConfirm("rows")} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-destructive hover:bg-muted"><Trash2 className="size-3.5" /> Delete</button>
          <button type="button" aria-label="Clear selection" onClick={() => setSelection(new Set())} className="ml-auto rounded p-1 text-muted-foreground hover:text-foreground"><X className="size-3.5" /></button>
        </div>
      )}

      <div className="px-4 pb-10 sm:px-6 lg:px-8">
        {view.type === "BOARD" ? (
          <BoardView {...viewProps} />
        ) : view.type === "LIST" ? (
          <ListView {...viewProps} />
        ) : view.type === "GALLERY" ? (
          <GalleryView {...viewProps} />
        ) : view.type === "CALENDAR" ? (
          <CalendarView key={view.id} {...viewProps} />
        ) : view.type === "TIMELINE" ? (
          <TimelineView key={view.id} {...viewProps} />
        ) : (
          <TableView {...viewProps} />
        )}
      </div>

      {peekId && (
        <PeekPanel
          key={peekId}
          pageId={peekId}
          uploads={init.uploads}
          articleBaseUrl={init.articleBaseUrl}
          onClose={closePeek}
          onOpenFull={() => router.push(`/dashboard/pages/${peekId}`)}
          onRowChange={onPeekRowChange}
        />
      )}

      {menu && (
        <Popover anchor={menu.anchor} open onClose={() => setMenu(null)} label={`${menu.def.name} property`}>
          <PropertyMenu
            def={props.find((p) => p.id === menu.def.id) ?? menu.def}
            people={init.people}
            uploads={init.uploads}
            onClose={() => setMenu(null)}
            actions={{
              rename: (name) => { setProp({ ...menu.def, name }); void act(updatePropertyAction({ id: menu.def.id, name })); },
              updateConfig: (config) => updateConfig(props.find((p) => p.id === menu.def.id) ?? menu.def, config),
              changeType: (type) => void changeType(menu.def, type),
              hide: () => updateView({ hidden: [...hidden, menu.def.id] }),
              remove: () => void removeProperty(menu.def),
              sort: (direction) => updateView({ sorts: [{ propertyId: menu.def.id, direction }, ...(view.config.sorts ?? []).filter((s) => s.propertyId !== menu.def.id)] }),
            }}
          />
        </Popover>
      )}
      {adding && (
        <Popover anchor={adding} open onClose={() => setAdding(null)} label="New property" placement="bottom-end">
          <AddPropertyMenu onAdd={(type, name) => void addProperty(type, name)} />
        </Popover>
      )}
      {bulkProp && (
        <Popover anchor={bulkProp.anchor} open onClose={() => setBulkProp(null)} label={`Set ${bulkProp.def.name}`}>
          <p className="px-2 pb-1 text-xs text-muted-foreground">Set {bulkProp.def.name} on {selection.size} rows</p>
          <ValueEditor
            def={bulkProp.def}
            value={null}
            people={init.people}
            uploads={init.uploads}
            rowId=""
            onChange={(v) => { void bulkSet(bulkProp.def, v); if (bulkProp.def.type !== "MULTI_SELECT" && bulkProp.def.type !== "PERSON") setBulkProp(null); }}
            onClose={() => setBulkProp(null)}
            onUpdateOptions={(o) => updateOptions(bulkProp.def.id, o)}
          />
        </Popover>
      )}

      <Dialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm === "database" ? "Delete this database?" : `Delete ${selection.size} ${selection.size === 1 ? "row" : "rows"}?`}
        description={confirm === "database" ? `“${meta.title}” and all its rows and pages will be permanently deleted.` : "The rows and their pages will be permanently deleted. Archive instead to keep them."}
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button variant="destructive" size="sm" onClick={async () => {
              if (confirm === "rows") return void bulkDelete();
              setConfirm(null);
              if (await act(deleteDatabaseAction({ id: dbId }))) router.push("/dashboard/databases");
            }}>
              Delete permanently
            </Button>
          </>
        }
      />
    </div>
  );
}

function MenuItem({ icon: Icon, children, onClick, destructive }: { icon?: LucideIcon; children: React.ReactNode; onClick: (e: React.MouseEvent) => void; destructive?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted", destructive && "text-destructive")}>
      {Icon && <Icon className="size-3.5" />} {children}
    </button>
  );
}

function ViewTab({ view, active, icon: Icon, onSelect, onRename, onDelete }: { view: ViewDef; active: boolean; icon: LucideIcon; onSelect: () => void; onRename: (name: string) => void; onDelete?: () => void }) {
  const [editing, setEditing] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [menu, setMenu] = useState(false);
  return (
    <div className={cn("-mb-px flex items-center border-b-2", active ? "border-foreground" : "border-transparent")}>
      {editing ? (
        <input
          autoFocus
          defaultValue={view.name}
          maxLength={100}
          onBlur={(e) => (setEditing(false), e.target.value.trim() && e.target.value.trim() !== view.name && onRename(e.target.value.trim()))}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          aria-label="View name"
          className="h-8 w-32 bg-transparent px-2 text-[13px] outline-none"
        />
      ) : (
        <button
          ref={setAnchor}
          type="button"
          role="tab"
          aria-selected={active}
          onClick={() => (active ? setMenu(true) : onSelect())}
          onDoubleClick={() => setEditing(true)}
          className={cn("flex h-8 items-center gap-1.5 px-2 text-[13px] whitespace-nowrap", active ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}
        >
          <Icon className="size-3.5" /> {view.name}
        </button>
      )}
      <Popover anchor={anchor} open={menu} onClose={() => setMenu(false)} label={`${view.name} view`}>
        <div className="w-44">
          <MenuItem onClick={() => (setMenu(false), setEditing(true))}>Rename</MenuItem>
          {onDelete && <MenuItem destructive icon={Trash2} onClick={() => (setMenu(false), onDelete())}>Delete view</MenuItem>}
        </div>
      </Popover>
    </div>
  );
}
