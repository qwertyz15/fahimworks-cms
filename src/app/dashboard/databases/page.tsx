import type { Metadata } from "next";
import Link from "next/link";
import { Archive, Database } from "lucide-react";
import { NewDatabaseButton } from "@/components/database/template-gallery";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { cn, formatDate } from "@/lib/utils";
import { requireAdmin } from "@/server/auth/guards";
import { listDatabases } from "@/server/databases/service";

export const metadata: Metadata = { title: "Databases" };

export default async function DatabasesPage({ searchParams }: PageProps<"/dashboard/databases">) {
  const user = await requireAdmin();
  const sp = await searchParams;
  const archived = sp.archived === "1";
  const databases = await listDatabases(user.id, { archived });

  return (
    <div className="space-y-6">
      <PageHeader title="Databases" description="Tables, boards and lists where every row is a page. Private to your workspace." actions={<NewDatabaseButton />} />
      <div className="flex gap-1 text-[13px]" role="tablist" aria-label="Databases">
        <Link href="/dashboard/databases" role="tab" aria-selected={!archived} className={cn("rounded-md px-2.5 py-1", !archived ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60")}>
          Active
        </Link>
        <Link href="/dashboard/databases?archived=1" role="tab" aria-selected={archived} className={cn("inline-flex items-center gap-1 rounded-md px-2.5 py-1", archived ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60")}>
          <Archive className="size-3.5" /> Archived
        </Link>
      </div>
      {databases.length === 0 ? (
        <EmptyState icon={<Database className="size-5" />} title={archived ? "No archived databases" : "No databases yet"} description={archived ? "Archived databases appear here and can be restored." : "Create one from a template — Tasks, Projects, CRM, Blog planner… — or start empty."} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="database-list">
          {databases.map((d) => (
            <li key={d.id}>
              <Link href={`/dashboard/databases/${d.id}`} className="flex h-full flex-col overflow-hidden rounded-xl border bg-surface shadow-card transition-colors hover:border-primary/40">
                {d.coverImage ? (
                  // eslint-disable-next-line @next/next/no-img-element -- media bucket image
                  <img src={d.coverImage} alt="" className="h-20 w-full object-cover" />
                ) : (
                  <div className="h-2 bg-gradient-to-r from-primary/30 to-primary/5" aria-hidden />
                )}
                <div className="flex flex-1 flex-col gap-1 p-4">
                  <p className="flex items-center gap-2 font-medium">
                    <span className="text-xl">{d.icon ?? "🗂️"}</span> {d.title}
                  </p>
                  {d.description && <p className="line-clamp-2 text-xs text-muted-foreground">{d.description}</p>}
                  <p className="mt-auto pt-2 text-xs text-muted-foreground">
                    {d.rowCount} {d.rowCount === 1 ? "row" : "rows"} · updated {formatDate(d.updatedAt)}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
