import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";

/**
 * Where to put a block image for a given position: never inside a paragraph
 * (that would split the sentence) — before the block when at its start,
 * otherwise right after it.
 */
export function blockBoundary(doc: PMNode, pos: number): number | { from: number; to: number } {
  const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
  if (!$pos.parent.isTextblock || $pos.depth === 0) return $pos.pos;
  // An empty line is replaced by the block (no blank gaps left behind).
  if ($pos.parent.content.size === 0) return { from: $pos.before(), to: $pos.after() };
  return $pos.parentOffset === 0 ? $pos.before() : $pos.after();
}

/**
 * Insert a media block and put the caret on a fresh line below it. Without
 * this the new block stays selected, and the next keystroke would replace it.
 */
export function insertBlock(editor: Editor, at: number | { from: number; to: number }, node: Record<string, unknown>) {
  editor.chain().focus().insertContentAt(at, [node, { type: "paragraph" }]).run();
}
