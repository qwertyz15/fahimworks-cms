"use client";

import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { CODE_LANGUAGES } from "./languages";

/** Code block with a language picker in the top-right corner. */
export function CodeBlockView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const language = (node.attrs.language as string | null) ?? "plaintext";
  return (
    <NodeViewWrapper className="code-block group relative">
      <select
        contentEditable={false}
        value={language}
        disabled={!editor.isEditable}
        onChange={(e) => updateAttributes({ language: e.target.value })}
        aria-label="Code language"
        className="absolute top-2 right-2 z-10 rounded-md border bg-surface px-1.5 py-0.5 text-[11px] text-muted-foreground opacity-60 transition-opacity focus:opacity-100 group-hover:opacity-100"
      >
        {CODE_LANGUAGES.map((l) => (
          <option key={l.value} value={l.value}>
            {l.label}
          </option>
        ))}
      </select>
      <pre>
        <NodeViewContent<"code"> as="code" className={`language-${language}`} />
      </pre>
    </NodeViewWrapper>
  );
}
