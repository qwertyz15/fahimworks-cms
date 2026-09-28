"use client";

import { useEffect } from "react";
import { renderMermaid, useDarkTheme } from "@/lib/mermaid-client";

/**
 * Draws the Mermaid diagrams (<pre data-mermaid>) inside `selector`. Mermaid
 * is only downloaded when the article has a diagram; if it fails or JS is
 * off, the source stays visible as a code block.
 */
export function MermaidBlocks({ selector }: { selector: string }) {
  const dark = useDarkTheme();
  useEffect(() => {
    const blocks = [...document.querySelectorAll<HTMLPreElement>(`${selector} pre[data-mermaid]`)];
    if (!blocks.length) return;
    let cancelled = false;
    for (const pre of blocks) {
      void renderMermaid(pre.textContent ?? "", dark).then((r) => {
        if (cancelled || !r.svg) return;
        let out = pre.nextElementSibling;
        if (!out?.classList.contains("mermaid-rendered")) {
          out = document.createElement("figure");
          out.className = "mermaid-rendered";
          out.setAttribute("role", "img");
          out.setAttribute("aria-label", "Diagram");
          pre.after(out);
        }
        out.innerHTML = r.svg;
        pre.classList.add("mermaid-source-hidden");
      });
    }
    return () => {
      cancelled = true;
    };
  }, [selector, dark]);
  return null;
}
