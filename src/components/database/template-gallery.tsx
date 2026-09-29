"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Link2, Loader2, Plus, Table2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { PACKS, TEMPLATES, TEMPLATE_CATEGORIES, type TemplateCategory } from "@/lib/db-templates";
import { TYPE_LABELS } from "@/lib/db-properties";
import { createDatabaseAction } from "@/server/actions/databases";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { localToday } from "@/lib/dates";

/** "New database": empty, or from a template (structure, views and sample rows). */
export function NewDatabaseButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [category, setCategory] = useState<TemplateCategory | "All">("All");
  const create = async (templateKey: string | null) => {
    setBusy(templateKey ?? "empty");
    const r = await createDatabaseAction({ templateKey, today: localToday() });
    setBusy(null);
    if (!r.ok || !r.data) return void toast.error(r.ok ? "Could not create the database." : r.error);
    setOpen(false);
    router.push(`/dashboard/databases/${r.data.id}`);
  };
  const cats = TEMPLATE_CATEGORIES.filter((c) => TEMPLATES.some((t) => t.category === c) || PACKS.some((p) => p.category === c));
  const shown = TEMPLATES.filter((t) => category === "All" || t.category === category);
  const packs = PACKS.filter((p) => category === "All" || p.category === category);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus /> New database
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="New database" description="Start empty, or from a template with properties, views and sample rows." className="max-w-3xl">
        <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
          <nav className="flex gap-1 overflow-x-auto sm:flex-col" aria-label="Template categories">
            {(["All", ...cats] as const).map((c) => (
              <button key={c} type="button" onClick={() => setCategory(c)} aria-pressed={category === c} className={cn("rounded-md px-2 py-1 text-left text-[13px] whitespace-nowrap", category === c ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60")}>
                {c}
              </button>
            ))}
          </nav>
          <div className="grid max-h-[60vh] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
            <button type="button" onClick={() => void create(null)} disabled={busy !== null} className="flex items-start gap-3 rounded-lg border border-dashed p-3 text-left hover:border-primary/50" data-testid="template-empty">
              <span className="flex size-9 items-center justify-center rounded-lg bg-muted">{busy === "empty" ? <Loader2 className="size-4 animate-spin" /> : <Table2 className="size-4" />}</span>
              <span>
                <span className="block text-sm font-medium">Empty database</span>
                <span className="block text-xs text-muted-foreground">A table with a Name column.</span>
              </span>
            </button>
            {packs.map((p) => (
              <button key={p.key} type="button" onClick={() => void create(p.key)} disabled={busy !== null} className="flex items-start gap-3 rounded-lg border p-3 text-left hover:border-primary/50" data-testid={`template-${p.key}`}>
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-lg">{busy === p.key ? <Loader2 className="size-4 animate-spin" /> : p.icon}</span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    {p.name}
                    <span className="inline-flex items-center gap-0.5 rounded bg-primary/10 px-1 py-px text-[10px] font-medium text-primary">
                      <Link2 className="size-2.5" /> {p.databases.length} linked
                    </span>
                  </span>
                  <span className="block text-xs text-muted-foreground">{p.description}</span>
                  <span className="mt-1 block truncate text-[11px] text-muted-foreground/80">{p.databases.map((d) => `${d.icon} ${d.name}`).join(" ↔ ")}</span>
                </span>
              </button>
            ))}
            {shown.map((t) => (
              <button key={t.key} type="button" onClick={() => void create(t.key)} disabled={busy !== null} className="flex items-start gap-3 rounded-lg border p-3 text-left hover:border-primary/50" data-testid={`template-${t.key}`}>
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-lg">{busy === t.key ? <Loader2 className="size-4 animate-spin" /> : t.icon}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{t.name}</span>
                  <span className="block text-xs text-muted-foreground">{t.description}</span>
                  <span className="mt-1 block truncate text-[11px] text-muted-foreground/80">{t.properties.map((p) => `${p.name} (${TYPE_LABELS[p.type]})`).join(" · ")}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </Dialog>
    </>
  );
}
