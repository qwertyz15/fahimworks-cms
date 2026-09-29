"use client";

import { useState } from "react";
import { Download, FileCode2, FileText, FileType2, Loader2, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/database/popover";
import type { ExportFormat } from "@/lib/export/document";

const ITEMS: { format: ExportFormat | "pdf"; label: string; hint: string; icon: typeof FileText }[] = [
  { format: "pdf", label: "PDF", hint: "Print layout → Save as PDF", icon: Printer },
  { format: "md", label: "Markdown", hint: ".md for GitHub, Obsidian…", icon: FileCode2 },
  { format: "docx", label: "Word", hint: ".docx, editable in Word / Google Docs", icon: FileType2 },
  { format: "html", label: "HTML", hint: "One file that opens offline", icon: FileText },
];

function fileNameFrom(res: Response, fallback: string) {
  const cd = res.headers.get("content-disposition") ?? "";
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd)?.[1];
  if (star) return decodeURIComponent(star);
  return /filename="([^"]+)"/i.exec(cd)?.[1] ?? fallback;
}

/**
 * Export a Notebook entry or a database page. `prepare` saves any pending
 * edits first and resolves to the id to export (null: nothing to export yet).
 */
export function ExportMenu({ kind, prepare }: { kind: "notebook" | "page"; prepare: () => Promise<string | null> }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (format: ExportFormat | "pdf") => {
    // Open the print tab now, while this still counts as the user's click (pop-up blockers).
    const tab = format === "pdf" ? window.open("about:blank", "_blank") : null;
    setBusy(format);
    try {
      const id = await prepare();
      if (!id) {
        tab?.close();
        toast.error("Write something first — there's nothing to export yet.");
        return;
      }
      if (format === "pdf") {
        const url = `/print/${kind}/${id}?auto=1`;
        if (tab) tab.location.replace(url);
        else toast("Your browser blocked the new tab.", { action: { label: "Open print view", onClick: () => window.open(url, "_blank") } });
        setOpen(false);
        return;
      }
      const res = await fetch(`/api/export/${kind}/${id}?format=${format}`, { cache: "no-store" });
      if (!res.ok) {
        toast.error(res.status === 401 ? "Your session has expired. Sign in again." : "Could not export. Try again.");
        return;
      }
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = fileNameFrom(res, `export.${format}`);
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
      setOpen(false);
      toast.success(`Exported ${a.download}`);
    } catch {
      tab?.close();
      toast.error("Could not export. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Button ref={setAnchor} size="sm" variant="ghost" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} title="Export as PDF, Markdown, Word or HTML">
        <Download /> Export
      </Button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} label="Export" placement="bottom-end">
        <div className="w-64" role="menu" aria-label="Export as">
          {ITEMS.map(({ format, label, hint, icon: Icon }) => (
            <button
              key={format}
              type="button"
              role="menuitem"
              disabled={busy !== null}
              onClick={() => void run(format)}
              className="flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-muted disabled:opacity-60"
            >
              {busy === format ? <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" /> : <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
              <span>
                <span className="block text-[13px] font-medium">{label}</span>
                <span className="block text-xs text-muted-foreground">{hint}</span>
              </span>
            </button>
          ))}
        </div>
      </Popover>
    </>
  );
}
