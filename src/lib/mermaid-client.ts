"use client";

import { useSyncExternalStore } from "react";

/**
 * Mermaid, loaded on demand (a separate chunk: only the editor and articles
 * with diagrams download it). securityLevel "strict" sanitises the SVG and
 * disables click handlers / links; Mermaid ignores %%{init}%% attempts to
 * change it.
 */
type Mermaid = typeof import("mermaid").default;

let loading: Promise<Mermaid> | null = null;
let counter = 0;
let queue: Promise<unknown> = Promise.resolve();

function load(): Promise<Mermaid> {
  loading ??= import("mermaid").then((m) => m.default);
  return loading;
}

export type MermaidResult = { svg: string; error?: undefined } | { svg?: undefined; error: string };

/** Render one diagram. Calls are queued: Mermaid's config is global. */
export function renderMermaid(source: string, dark: boolean): Promise<MermaidResult> {
  const run = async (): Promise<MermaidResult> => {
    const mermaid = await load();
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: dark ? "dark" : "default",
      fontFamily: "var(--font-sans), ui-sans-serif, system-ui, sans-serif",
      suppressErrorRendering: true,
      // The site's palette for pie slices (Mermaid's dark theme makes some nearly black).
      themeVariables: {
        pie1: "#6366f1",
        pie2: "#ec4899",
        pie3: "#f59e0b",
        pie4: "#10b981",
        pie5: "#0ea5e9",
        pie6: "#a855f7",
        pie7: "#ef4444",
        pie8: "#64748b",
        pieSectionTextColor: "#ffffff",
        pieStrokeColor: dark ? "#18181b" : "#ffffff",
        pieOuterStrokeColor: dark ? "#3f3f46" : "#e4e4e7",
      },
    });
    try {
      const { svg } = await mermaid.render(`mermaid-${++counter}`, source);
      return { svg };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "This diagram has an error." };
    } finally {
      // Mermaid can leave its scratch element behind after an error.
      document.getElementById(`dmermaid-${counter}`)?.remove();
    }
  };
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}

export const isDarkTheme = () => document.documentElement.classList.contains("dark");

function subscribeTheme(onChange: () => void) {
  const obs = new MutationObserver(onChange);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => obs.disconnect();
}

/** true while the page is in dark mode; re-renders on theme switches. */
export function useDarkTheme() {
  return useSyncExternalStore(subscribeTheme, isDarkTheme, () => false);
}
