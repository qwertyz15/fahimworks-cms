"use client";

import { BlockMath, InlineMath } from "@tiptap/extension-mathematics";
import { KATEX_OPTIONS } from "@/lib/editor-shared";

/**
 * LaTeX equations (KaTeX, MathML output — the same as the public article).
 * Clicking one, or "/math", fires MATH_EDIT_EVENT; EntryEditor opens the
 * equation dialog. Typing $$E=mc^2$$ makes an inline one, $$$…$$$ a block.
 */
export const MATH_EDIT_EVENT = "notebook:edit-math";

export interface MathEditDetail {
  kind: "inline" | "block";
  /** Position of the existing node, or null to insert a new one. */
  pos: number | null;
  latex: string;
}

export const editMath = (detail: MathEditDetail) => window.dispatchEvent(new CustomEvent<MathEditDetail>(MATH_EDIT_EVENT, { detail }));

export const mathExtensions = [
  InlineMath.configure({
    katexOptions: { ...KATEX_OPTIONS, displayMode: false },
    onClick: (node, pos) => editMath({ kind: "inline", pos, latex: node.attrs.latex as string }),
  }),
  BlockMath.configure({
    katexOptions: { ...KATEX_OPTIONS, displayMode: true },
    onClick: (node, pos) => editMath({ kind: "block", pos, latex: node.attrs.latex as string }),
  }),
];
