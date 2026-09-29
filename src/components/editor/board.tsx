"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, horizontalListSortingStrategy, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, Tag, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { BOARD_CARD_MAX, BOARD_MAX_CARDS, BOARD_MAX_COLUMNS, BOARD_TITLE_MAX, HIGHLIGHT_COLORS, type HighlightColor } from "@/lib/editor-shared";

/**
 * Kanban board inside a post. Stored as plain, readable HTML:
 *   <div data-type="board">
 *     <div data-board-column><span class="board-title">To do</span><span class="board-count">2</span>
 *       <ul><li data-label="yellow">Card</li>…</ul></div>…</div>
 * The editor shows an interactive board (drag cards/columns with mouse, touch
 * or keyboard); the public article shows it read-only, no JavaScript needed.
 */

export interface BoardCard {
  id: string;
  text: string;
  label: HighlightColor | null;
}
export interface BoardColumn {
  id: string;
  title: string;
  cards: BoardCard[];
}

const uid = () => Math.random().toString(36).slice(2, 10);
/** No layout animation after a drop: dnd-kit's derived-transform animation can loop when a card changes column. */
const noLayoutAnimation = () => false;
const LABELS = HIGHLIGHT_COLORS as readonly string[];

export function newBoard(): BoardColumn[] {
  return [
    { id: uid(), title: "To do", cards: [{ id: uid(), text: "First task", label: null }] },
    { id: uid(), title: "Doing", cards: [] },
    { id: uid(), title: "Done", cards: [] },
  ];
}

/** Enforce the limits on anything parsed or edited. */
function clampBoard(columns: BoardColumn[]): BoardColumn[] {
  let budget = BOARD_MAX_CARDS;
  return columns.slice(0, BOARD_MAX_COLUMNS).map((c) => {
    const cards = c.cards.slice(0, Math.max(0, budget)).map((card) => ({
      id: card.id || uid(),
      text: card.text.slice(0, BOARD_CARD_MAX),
      label: LABELS.includes(card.label ?? "") ? card.label : null,
    }));
    budget -= cards.length;
    return { id: c.id || uid(), title: c.title.slice(0, BOARD_TITLE_MAX), cards };
  });
}

export const Board = Node.create({
  name: "board",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    // Parsed from the column markup by the rule below (an attribute-level parseHTML would override it).
    return { columns: { default: [], renderHTML: () => ({}) } };
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-type="board"]',
        getAttrs: (el: HTMLElement) => ({
          columns: clampBoard(
            [...el.querySelectorAll(":scope > [data-board-column]")].map((col) => ({
              id: uid(),
              title: col.querySelector(".board-title")?.textContent?.trim() ?? "",
              cards: [...col.querySelectorAll(":scope > ul > li")].map((li) => ({ id: uid(), text: li.textContent?.trim() ?? "", label: (li.getAttribute("data-label") as HighlightColor | null) ?? null })),
            })),
          ),
        }),
      },
    ];
  },
  renderHTML({ node }) {
    const columns = (node.attrs.columns as BoardColumn[]) ?? [];
    return [
      "div",
      { "data-type": "board" },
      ...columns.map((c) => [
        "div",
        { "data-board-column": "" },
        ["span", { class: "board-title" }, c.title || "Untitled"],
        ["span", { class: "board-count" }, String(c.cards.length)],
        ["ul", {}, ...c.cards.map((card) => ["li", card.label ? { "data-label": card.label } : {}, card.text])],
      ]),
    ] as unknown as [string, Record<string, string>, ...unknown[]];
  },
  addNodeView() {
    // The board handles every event itself (typing, dragging), not ProseMirror.
    return ReactNodeViewRenderer(BoardView, { stopEvent: () => true });
  },
});

// ── Editor view ────────────────────────────────────────────────────────────

function BoardView({ node, updateAttributes, deleteNode, editor }: ReactNodeViewProps) {
  const editable = editor.isEditable;
  const [cols, setCols] = useState<BoardColumn[]>(() => clampBoard((node.attrs.columns as BoardColumn[]) ?? []));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editingCard, setEditingCard] = useState<string | null>(null);
  const dragging = useRef(false);

  // Follow outside changes (undo/redo, reload) — not while a drag is in progress.
  useEffect(() => {
    if (!dragging.current) setCols(clampBoard((node.attrs.columns as BoardColumn[]) ?? []));
  }, [node.attrs.columns]);

  const commit = (next: BoardColumn[]) => {
    const clean = clampBoard(next);
    setCols(clean);
    updateAttributes({ columns: clean });
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const columnOf = (id: string, list = cols) => list.find((c) => c.id === id) ?? list.find((c) => c.cards.some((card) => card.id === id));
  const totalCards = cols.reduce((n, c) => n + c.cards.length, 0);

  const onDragStart = (e: DragStartEvent) => {
    dragging.current = true;
    setActiveId(String(e.active.id));
  };

  /*
   * Cards move on drop only. Moving them between columns during the drag reflows the
   * columns, which changes what's under the pointer and moves the card back — an update
   * loop. The column under the pointer is highlighted instead.
   */
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    dragging.current = false;
    setActiveId(null);
    if (!over) return;
    if (active.data.current?.type === "column") {
      const a = cols.findIndex((c) => c.id === active.id);
      const b = cols.findIndex((c) => c.id === (columnOf(String(over.id))?.id ?? over.id));
      if (a >= 0 && b >= 0 && a !== b) commit(arrayMove(cols, a, b));
      return;
    }
    const from = columnOf(String(active.id));
    const to = columnOf(String(over.id));
    if (!from || !to) return;
    const card = from.cards.find((c) => c.id === active.id)!;
    if (from.id === to.id) {
      const a = from.cards.findIndex((c) => c.id === active.id);
      const b = from.cards.findIndex((c) => c.id === over.id);
      if (a >= 0 && b >= 0 && a !== b) commit(cols.map((c) => (c.id === from.id ? { ...c, cards: arrayMove(c.cards, a, b) } : c)));
      return;
    }
    const overIndex = to.cards.findIndex((c) => c.id === over.id);
    const at = overIndex >= 0 ? overIndex : to.cards.length;
    commit(
      cols.map((c) =>
        c.id === from.id ? { ...c, cards: c.cards.filter((x) => x.id !== card.id) } : c.id === to.id ? { ...c, cards: [...c.cards.slice(0, at), card, ...c.cards.slice(at)] } : c,
      ),
    );
  };

  const setCard = (colId: string, cardId: string, patch: Partial<BoardCard> | null) =>
    commit(cols.map((c) => (c.id !== colId ? c : { ...c, cards: patch === null ? c.cards.filter((x) => x.id !== cardId) : c.cards.map((x) => (x.id === cardId ? { ...x, ...patch } : x)) })));

  const addCard = (colId: string) => {
    if (totalCards >= BOARD_MAX_CARDS) return;
    const id = uid();
    commit(cols.map((c) => (c.id === colId ? { ...c, cards: [...c.cards, { id, text: "", label: null }] } : c)));
    setEditingCard(id);
  };

  // Stable id lists for SortableContext (new arrays each render make it re-measure in a loop).
  const columnIds = useMemo(() => cols.map((c) => c.id), [cols]);
  const cardIds = useMemo(() => new Map(cols.map((c) => [c.id, c.cards.map((x) => x.id)])), [cols]);

  const activeCard = activeId ? cols.flatMap((c) => c.cards).find((c) => c.id === activeId) : undefined;
  const activeColumn = activeId ? cols.find((c) => c.id === activeId) : undefined;

  return (
    <NodeViewWrapper className="notebook-block notebook-board group/board relative" contentEditable={false} data-testid="board">
      <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
        <span className="font-medium">Board · {totalCards} {totalCards === 1 ? "card" : "cards"}</span>
        {editable && (
          <button type="button" onClick={() => deleteNode()} className="flex items-center gap-1 rounded-md px-1.5 py-0.5 opacity-0 transition-opacity group-hover/board:opacity-100 hover:text-destructive focus:opacity-100" aria-label="Delete board">
            <Trash2 className="size-3.5" /> Delete board
          </button>
        )}
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => ((dragging.current = false), setActiveId(null), setCols(clampBoard(node.attrs.columns as BoardColumn[])))}>
        <div className="flex gap-3 overflow-x-auto pb-2">
          <SortableContext items={columnIds} strategy={horizontalListSortingStrategy}>
            {cols.map((col) => (
              <ColumnView
                key={col.id}
                col={col}
                editable={editable}
                canDelete={cols.length > 1}
                onRename={(title) => commit(cols.map((c) => (c.id === col.id ? { ...c, title } : c)))}
                onDelete={() => commit(cols.filter((c) => c.id !== col.id))}
                onAddCard={() => addCard(col.id)}
                canAddCard={totalCards < BOARD_MAX_CARDS}
              >
                <SortableContext items={cardIds.get(col.id) ?? []} strategy={verticalListSortingStrategy}>
                  {col.cards.map((card) => (
                    <CardView
                      key={card.id}
                      card={card}
                      editable={editable}
                      editing={editingCard === card.id}
                      onEdit={() => setEditingCard(card.id)}
                      onDone={(text) => {
                        setEditingCard(null);
                        setCard(col.id, card.id, text.trim() ? { text: text.trim() } : null);
                      }}
                      onLabel={(label) => setCard(col.id, card.id, { label })}
                      onDelete={() => setCard(col.id, card.id, null)}
                    />
                  ))}
                </SortableContext>
              </ColumnView>
            ))}
          </SortableContext>
          {editable && cols.length < BOARD_MAX_COLUMNS && (
            <button
              type="button"
              onClick={() => commit([...cols, { id: uid(), title: "New column", cards: [] }])}
              className="flex h-10 w-40 shrink-0 items-center justify-center gap-1 rounded-lg border border-dashed text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground"
            >
              <Plus className="size-3.5" /> Add column
            </button>
          )}
        </div>
        <DragOverlay>
          {activeCard ? <div className="board-card rotate-2 shadow-pop" {...(activeCard.label ? { "data-swatch": activeCard.label } : {})}>{activeCard.text}</div> : null}
          {activeColumn ? <div className="board-column opacity-90 shadow-pop"><span className="text-[13px] font-semibold">{activeColumn.title}</span></div> : null}
        </DragOverlay>
      </DndContext>
    </NodeViewWrapper>
  );
}

function ColumnView({
  col,
  editable,
  canDelete,
  canAddCard,
  onRename,
  onDelete,
  onAddCard,
  children,
}: {
  col: BoardColumn;
  editable: boolean;
  canDelete: boolean;
  canAddCard: boolean;
  onRename: (title: string) => void;
  onDelete: () => void;
  onAddCard: () => void;
  children: ReactNode;
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging, isOver } = useSortable({ id: col.id, data: { type: "column" }, disabled: !editable, animateLayoutChanges: noLayoutAnimation });
  const [title, setTitle] = useState(col.title);
  // Follow renames from outside (undo, reload) — adjusted during render, not in an effect.
  const [shownTitle, setShownTitle] = useState(col.title);
  if (col.title !== shownTitle) {
    setShownTitle(col.title);
    setTitle(col.title);
  }
  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("board-column group/col", isDragging && "opacity-40", isOver && !isDragging && "ring-2 ring-primary/40")}
      aria-label={`Column ${col.title}`}
      data-testid="board-column"
    >
      <header className="mb-2 flex items-center gap-1">
        {editable && (
          <button type="button" {...attributes} {...listeners} aria-label={`Move column ${col.title}`} className="cursor-grab rounded p-0.5 text-muted-foreground opacity-50 hover:opacity-100 active:cursor-grabbing">
            <GripVertical className="size-3.5" />
          </button>
        )}
        <input
          value={title}
          readOnly={!editable}
          maxLength={BOARD_TITLE_MAX}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() !== col.title && onRename(title.trim() || "Untitled")}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          aria-label="Column title"
          className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-[13px] font-semibold outline-none focus:bg-background"
        />
        <span className="rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground tabular-nums">{col.cards.length}</span>
        {editable && canDelete && (
          <button type="button" onClick={onDelete} aria-label={`Delete column ${col.title}`} className="rounded p-0.5 text-muted-foreground opacity-0 group-hover/col:opacity-100 hover:text-destructive focus:opacity-100">
            <X className="size-3.5" />
          </button>
        )}
      </header>
      <div className="flex min-h-12 flex-col gap-2">{children}</div>
      {editable && canAddCard && (
        <button type="button" onClick={onAddCard} className="mt-2 flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-background hover:text-foreground">
          <Plus className="size-3.5" /> Add card
        </button>
      )}
    </section>
  );
}

function CardView({
  card,
  editable,
  editing,
  onEdit,
  onDone,
  onLabel,
  onDelete,
}: {
  card: BoardCard;
  editable: boolean;
  editing: boolean;
  onEdit: () => void;
  onDone: (text: string) => void;
  onLabel: (label: HighlightColor | null) => void;
  onDelete: () => void;
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: card.id, data: { type: "card" }, disabled: !editable || editing, animateLayoutChanges: noLayoutAnimation });
  const [draft, setDraft] = useState(card.text);
  const [labels, setLabels] = useState(false);
  const [shownText, setShownText] = useState(card.text);
  if (card.text !== shownText) {
    setShownText(card.text);
    setDraft(card.text);
  }
  const swatch = card.label ? { "data-swatch": card.label } : {};

  if (editing) {
    return (
      <div ref={setNodeRef} className="board-card p-0" {...swatch}>
        <textarea
          autoFocus
          value={draft}
          maxLength={BOARD_CARD_MAX}
          rows={2}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => onDone(draft)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onDone(draft);
            }
            if (e.key === "Escape") onDone(card.text);
          }}
          placeholder="Card text (empty to delete)"
          aria-label="Card text"
          className="block w-full resize-none rounded-md bg-transparent px-2.5 py-2 text-[13px] outline-none"
        />
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      {...swatch}
      role="button"
      aria-label={`Card: ${card.text}`}
      data-testid="board-card"
      onClick={() => editable && onEdit()}
      className={cn("board-card group/card relative", editable && "cursor-grab active:cursor-grabbing", isDragging && "opacity-40")}
    >
      <span className="block pr-10 whitespace-pre-wrap">{card.text}</span>
      {editable && (
        <span className="absolute top-1 right-1 flex gap-0.5 opacity-0 transition-opacity group-hover/card:opacity-100" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => setLabels((v) => !v)} aria-label="Card label" className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground">
            <Tag className="size-3" />
          </button>
          <button type="button" onClick={onDelete} aria-label="Delete card" className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-destructive">
            <X className="size-3" />
          </button>
        </span>
      )}
      {labels && (
        <span className="mt-2 flex flex-wrap items-center gap-1" role="group" aria-label="Label colour" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          {HIGHLIGHT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              data-swatch={c}
              aria-label={`Label ${c}`}
              onClick={() => {
                onLabel(c);
                setLabels(false);
              }}
              className={cn("size-5 rounded border", card.label === c && "ring-2 ring-ring")}
            />
          ))}
          <button
            type="button"
            onClick={() => {
              onLabel(null);
              setLabels(false);
            }}
            className="rounded px-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            None
          </button>
        </span>
      )}
    </div>
  );
}
