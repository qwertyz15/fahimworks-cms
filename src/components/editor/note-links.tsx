"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Extension, Node, mergeAttributes } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion, { type SuggestionProps } from "@tiptap/suggestion";
import { TYPE_META } from "@/components/dashboard/content-types";
import { cn } from "@/lib/utils";
import { NOTE_REF_RE } from "@/lib/editor-shared";
import { searchLinkTargetsAction } from "@/server/actions/notebook";
import type { LinkTarget } from "@/server/services/notebook";
import { suggestionPopup, type MenuHandle } from "./slash-menu";

/**
 * Internal links: type "[[" to link any of your items (Notebook entries and
 * imported projects/articles). Stored as <a data-ref="<id>">title</a>; the
 * public page turns the id into the item's current address, or plain text
 * while the item isn't published.
 */
export const NoteLink = Node.create({
  name: "noteLink",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { id: { default: null }, label: { default: "" } };
  },
  parseHTML() {
    return [
      {
        tag: "a[data-ref]",
        // Rule priority: match before the Link mark, which also parses <a>.
        priority: 100,
        getAttrs: (el: HTMLElement) => {
          const id = el.getAttribute("data-ref") ?? "";
          return NOTE_REF_RE.test(id) ? { id, label: el.textContent ?? "" } : false;
        },
      },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["a", mergeAttributes(HTMLAttributes, { "data-ref": node.attrs.id as string, class: "note-link" }), node.attrs.label as string];
  },
  renderText({ node }) {
    return node.attrs.label as string;
  },
});

/** Client-side cache so retyping the same query doesn't hit the server again. */
const cache = new Map<string, LinkTarget[]>();

function currentEntryId(): string | null {
  const last = window.location.pathname.split("/").pop() ?? "";
  return last && last !== "new" ? last : null;
}

async function findTargets(query: string): Promise<LinkTarget[]> {
  const key = query.trim().toLowerCase();
  const hit = cache.get(key);
  if (hit) return hit;
  const res = await searchLinkTargetsAction({ query: key, excludeId: currentEntryId() });
  const items = res.ok ? (res.data ?? []) : [];
  cache.set(key, items);
  if (cache.size > 50) cache.delete(cache.keys().next().value!);
  return items;
}

const LinkMenuList = forwardRef<MenuHandle, SuggestionProps<LinkTarget>>(function LinkMenuList({ items, command, query }, ref) {
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => setSelected(0), [items]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  useImperativeHandle(ref, () => ({
    onKeyDown: (event) => {
      if (!items.length) return false;
      if (event.key === "ArrowDown") {
        setSelected((s) => (s + 1) % items.length);
        return true;
      }
      if (event.key === "ArrowUp") {
        setSelected((s) => (s - 1 + items.length) % items.length);
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const item = items[selected];
        if (item) command(item);
        return true;
      }
      return false;
    },
  }));

  return (
    <div ref={listRef} role="listbox" aria-label="Link to an item" className="max-h-80 w-80 overflow-y-auto rounded-xl border bg-surface p-1 shadow-pop">
      <p className="px-2 pt-1 pb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Link to…</p>
      {items.length === 0 ? (
        <p className="px-2 pb-2 text-[13px] text-muted-foreground">{query.trim() ? `Nothing called “${query.trim()}”` : "No items yet"}</p>
      ) : (
        items.map((item, i) => {
          const meta = TYPE_META[item.type];
          return (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={i === selected}
              data-index={i}
              onMouseEnter={() => setSelected(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => command(item)}
              className={cn("flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left", i === selected && "bg-muted")}
            >
              <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-md", meta.tile)}>
                <meta.icon className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{item.title}</span>
                <span className="block text-xs text-muted-foreground">
                  {meta.label} · {item.source === "WRITTEN" ? "Notebook" : "Imported"}
                  {!item.published && " · not public yet"}
                </span>
              </span>
            </button>
          );
        })
      )}
    </div>
  );
});

export const NoteLinkSuggestion = Extension.create({
  name: "noteLinkSuggestion",
  addProseMirrorPlugins() {
    return [
      Suggestion<LinkTarget>({
        pluginKey: new PluginKey("noteLinkSuggestion"),
        editor: this.editor,
        char: "[[",
        allowSpaces: true,
        allow: ({ state, range }) => state.doc.resolve(range.from).parent.type.name !== "codeBlock",
        items: ({ query }) => findTargets(query),
        command: ({ editor, range, props }) => {
          editor
            .chain()
            .focus()
            .insertContentAt(range, [{ type: "noteLink", attrs: { id: props.id, label: props.title } }, { type: "text", text: " " }])
            .run();
        },
        render: () => suggestionPopup(LinkMenuList),
      }),
    ];
  },
});
