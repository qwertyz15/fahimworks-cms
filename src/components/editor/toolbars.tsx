"use client";

import { useState, type ReactNode } from "react";
import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { PluginKey } from "@tiptap/pm/state";
import {
  Bold,
  Check,
  Code,
  Columns3,
  Italic,
  Link2,
  Link2Off,
  Rows3,
  Strikethrough,
  Trash2,
  Underline,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

function ToolButton({ active, label, onClick, children, danger }: { active?: boolean; label: string; onClick: () => void; children: ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&_svg]:size-4",
        active && "bg-muted text-foreground",
        danger && "hover:text-destructive",
      )}
    >
      {children}
    </button>
  );
}

const SAFE_LINK = /^(https?:\/\/|mailto:)/i;

/** Floating toolbar shown when text is selected (not in code blocks). */
export function SelectionToolbar({ editor }: { editor: Editor }) {
  const [linkMode, setLinkMode] = useState(false);
  const [href, setHref] = useState("");
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      link: e.isActive("link"),
      linkHref: (e.getAttributes("link").href as string | undefined) ?? "",
    }),
  });

  const applyLink = () => {
    const value = href.trim();
    if (!value) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      const url = SAFE_LINK.test(value) ? value : `https://${value}`;
      editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    }
    setLinkMode(false);
  };

  return (
    <BubbleMenu
      editor={editor}
      pluginKey={new PluginKey("selectionToolbar")}
      shouldShow={({ editor: e, state: s }) => !s.selection.empty && e.isEditable && !e.isActive("codeBlock")}
      options={{ placement: "top", offset: 8, onHide: () => setLinkMode(false) }}
      className="z-40 flex items-center gap-0.5 rounded-xl border bg-surface p-1 shadow-pop"
    >
      {linkMode ? (
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            applyLink();
          }}
        >
          <input
            autoFocus
            value={href}
            onChange={(e) => setHref(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setLinkMode(false)}
            placeholder="Paste a link…"
            aria-label="Link URL"
            className="h-8 w-64 rounded-md bg-transparent px-2 text-sm outline-none"
          />
          <ToolButton label="Apply link" onClick={applyLink}>
            <Check />
          </ToolButton>
          <ToolButton label="Cancel" onClick={() => setLinkMode(false)}>
            <X />
          </ToolButton>
        </form>
      ) : (
        <>
          <ToolButton label="Bold (Ctrl+B)" active={state.bold} onClick={() => editor.chain().focus().toggleBold().run()}>
            <Bold />
          </ToolButton>
          <ToolButton label="Italic (Ctrl+I)" active={state.italic} onClick={() => editor.chain().focus().toggleItalic().run()}>
            <Italic />
          </ToolButton>
          <ToolButton label="Underline (Ctrl+U)" active={state.underline} onClick={() => editor.chain().focus().toggleUnderline().run()}>
            <Underline />
          </ToolButton>
          <ToolButton label="Strikethrough" active={state.strike} onClick={() => editor.chain().focus().toggleStrike().run()}>
            <Strikethrough />
          </ToolButton>
          <ToolButton label="Inline code (Ctrl+E)" active={state.code} onClick={() => editor.chain().focus().toggleCode().run()}>
            <Code />
          </ToolButton>
          <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
          <ToolButton
            label={state.link ? "Edit link" : "Add link (Ctrl+K)"}
            active={state.link}
            onClick={() => {
              setHref(state.linkHref);
              setLinkMode(true);
            }}
          >
            <Link2 />
          </ToolButton>
          {state.link && (
            <ToolButton label="Remove link" onClick={() => editor.chain().focus().extendMarkRange("link").unsetLink().run()}>
              <Link2Off />
            </ToolButton>
          )}
        </>
      )}
    </BubbleMenu>
  );
}

/** Row / column controls shown while the cursor is inside a table. */
export function TableToolbar({ editor }: { editor: Editor }) {
  return (
    <BubbleMenu
      editor={editor}
      pluginKey={new PluginKey("tableToolbar")}
      shouldShow={({ editor: e, state: s }) => s.selection.empty && e.isEditable && e.isActive("table")}
      options={{ placement: "top-start", offset: 12 }}
      className="z-30 flex items-center gap-0.5 rounded-xl border bg-surface p-1 text-xs shadow-pop"
    >
      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().addRowAfter().run()} className="flex h-8 items-center gap-1 rounded-md px-2 text-muted-foreground hover:bg-muted hover:text-foreground">
        <Rows3 className="size-3.5" /> + Row
      </button>
      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().addColumnAfter().run()} className="flex h-8 items-center gap-1 rounded-md px-2 text-muted-foreground hover:bg-muted hover:text-foreground">
        <Columns3 className="size-3.5" /> + Column
      </button>
      <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().deleteRow().run()} className="flex h-8 items-center rounded-md px-2 text-muted-foreground hover:bg-muted hover:text-foreground">
        − Row
      </button>
      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().deleteColumn().run()} className="flex h-8 items-center rounded-md px-2 text-muted-foreground hover:bg-muted hover:text-foreground">
        − Column
      </button>
      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().toggleHeaderRow().run()} className="flex h-8 items-center rounded-md px-2 text-muted-foreground hover:bg-muted hover:text-foreground">
        Header row
      </button>
      <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
      <ToolButton label="Delete table" danger onClick={() => editor.chain().focus().deleteTable().run()}>
        <Trash2 />
      </ToolButton>
    </BubbleMenu>
  );
}
