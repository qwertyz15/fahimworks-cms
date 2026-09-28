"use client";

import { useEffect } from "react";

/**
 * Adds a "Copy" button to every code block inside `selector`. Done in the
 * browser so the stored (sanitised) article HTML stays free of controls.
 */
export function CodeCopy({ selector }: { selector: string }) {
  useEffect(() => {
    const blocks = document.querySelectorAll<HTMLPreElement>(`${selector} pre:not([data-mermaid])`);
    const cleanups: (() => void)[] = [];
    blocks.forEach((pre) => {
      if (pre.parentElement?.classList.contains("code-wrap")) return;
      const wrap = document.createElement("div");
      wrap.className = "code-wrap";
      pre.replaceWith(wrap);
      wrap.appendChild(pre);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "code-copy";
      btn.textContent = "Copy";
      btn.setAttribute("aria-label", "Copy code");
      let timer: ReturnType<typeof setTimeout> | undefined;
      const onClick = async () => {
        try {
          await navigator.clipboard.writeText(pre.innerText.replace(/\n$/, ""));
          btn.textContent = "Copied";
        } catch {
          btn.textContent = "Press Ctrl+C";
        }
        clearTimeout(timer);
        timer = setTimeout(() => (btn.textContent = "Copy"), 1500);
      };
      btn.addEventListener("click", onClick);
      wrap.appendChild(btn);
      cleanups.push(() => {
        clearTimeout(timer);
        btn.removeEventListener("click", onClick);
      });
    });
    return () => cleanups.forEach((c) => c());
  }, [selector]);
  return null;
}
