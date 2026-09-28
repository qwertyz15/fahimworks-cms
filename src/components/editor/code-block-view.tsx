"use client";

import { useState } from "react";
import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { Check, Copy } from "lucide-react";
import { CODE_LANGUAGES } from "./languages";

/** Code block with a copy button and a language picker in the top-right corner. */
export function CodeBlockView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const language = (node.attrs.language as string | null) ?? "plaintext";
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(node.textContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — nothing to do */
    }
  };
  return (
    <NodeViewWrapper className="code-block group relative">
      <div contentEditable={false} className="absolute top-2 right-2 z-10 flex items-center gap-1 opacity-60 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={copy}
          aria-label={copied ? "Copied" : "Copy code"}
          title={copied ? "Copied" : "Copy code"}
          className="flex items-center gap-1 rounded-md border bg-surface px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
        <select
        contentEditable={false}
        value={language}
        disabled={!editor.isEditable}
        onChange={(e) => updateAttributes({ language: e.target.value })}
        aria-label="Code language"
        className="rounded-md border bg-surface px-1.5 py-0.5 text-[11px] text-muted-foreground"
      >
        {CODE_LANGUAGES.map((l) => (
          <option key={l.value} value={l.value}>
            {l.label}
          </option>
        ))}
        </select>
      </div>
      <pre>
        <NodeViewContent<"code"> as="code" className={`language-${language}`} />
      </pre>
    </NodeViewWrapper>
  );
}
