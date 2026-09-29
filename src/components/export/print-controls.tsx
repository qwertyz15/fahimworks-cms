"use client";

import { useEffect, useState } from "react";
import { Printer, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The print view's bar (hidden when printing). Prints in light mode, and
 * opens the print dialog once images, fonts and diagrams are ready, so
 * "Save as PDF" captures the finished page.
 */
export function PrintControls({ selector }: { selector: string }) {
  const [ready, setReady] = useState(false);

  // Paper is white: keep this page light (the theme provider re-applies "dark", so watch for it).
  useEffect(() => {
    const html = document.documentElement;
    const wasDark = html.classList.contains("dark");
    const light = () => {
      if (html.classList.contains("dark")) html.classList.remove("dark");
      html.style.colorScheme = "light";
    };
    light();
    const obs = new MutationObserver(light);
    obs.observe(html, { attributes: true, attributeFilter: ["class", "style"] });
    return () => {
      obs.disconnect();
      if (wasDark) html.classList.add("dark");
      html.style.colorScheme = "";
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const root = document.querySelector(selector);
    const images = [...(root?.querySelectorAll("img") ?? []), ...document.querySelectorAll<HTMLImageElement>("img[data-print-cover]")];
    const loaded = Promise.all(images.map((img) => (img.complete ? Promise.resolve() : new Promise<void>((r) => ((img.onload = () => r()), (img.onerror = () => r()))))));
    const diagrams = new Promise<void>((resolve) => {
      const blocks = [...(root?.querySelectorAll("pre[data-mermaid]") ?? [])];
      if (!blocks.length) return resolve();
      const check = () => (blocks.every((b) => b.classList.contains("mermaid-source-hidden")) ? resolve() : undefined);
      const obs = new MutationObserver(check);
      obs.observe(root!, { subtree: true, attributes: true, attributeFilter: ["class"] });
      check();
    });
    const timeout = new Promise<void>((r) => setTimeout(r, 8000));
    void Promise.race([Promise.all([loaded, diagrams, document.fonts.ready]), timeout]).then(() => {
      if (cancelled) return;
      setReady(true);
      if (new URLSearchParams(location.search).get("auto") === "1") setTimeout(() => window.print(), 150);
    });
    return () => {
      cancelled = true;
    };
  }, [selector]);

  return (
    <div className="print-hidden sticky top-0 z-10 flex items-center gap-2 border-b bg-background/90 px-4 py-2.5 backdrop-blur" role="toolbar" aria-label="Print">
      <p className="mr-auto text-[13px] text-muted-foreground">
        In the print dialog choose <span className="font-medium text-foreground">Save as PDF</span>. Turn off “Headers and footers” for a clean page.
      </p>
      <Button size="sm" onClick={() => window.print()} loading={!ready} data-testid="print-now">
        <Printer /> Print / Save as PDF
      </Button>
      <Button size="sm" variant="ghost" onClick={() => window.close()} aria-label="Close">
        <X />
      </Button>
    </div>
  );
}
