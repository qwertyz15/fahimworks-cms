import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, Clock, PlusCircle, ShieldCheck, XCircle } from "lucide-react";
import { VIEW_COOKIE, parseType } from "@/components/dashboard/content-types";
import { Library } from "@/components/dashboard/library";
import { TypeBadge } from "@/components/content/badges";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { cn, displayHost, formatDate, formatDateTime } from "@/lib/utils";
import { getDashboardStats, listLibrary } from "@/server/queries/content";

export const metadata: Metadata = { title: "Overview" };

const ACTIVITY_LABELS: Record<string, string> = {
  "auth.register": "Account created",
  "auth.login": "Signed in",
  "auth.password_changed": "Password changed",
  "auth.sessions_revoked": "All sessions signed out",
  "content.created": "Content added",
  "content.updated": "Content edited",
  "content.deleted": "Content deleted",
  "content.verification_issued": "Verification token issued",
  "content.verification_succeeded": "Ownership verified",
  "content.verification_failed": "Verification failed",
  "content.extracted": "Content extracted",
  "content.extraction_failed": "Extraction failed",
  "content.approved": "Published",
  "content.rejected": "Rejected",
  "content.unpublished": "Unpublished",
  "content.reopened": "Reopened",
  "settings.updated": "Settings updated",
};

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const sp = await searchParams;
  const active = parseType(sp.type);
  const view = (await cookies()).get(VIEW_COOKIE)?.value === "list" ? "list" : "grid";
  const [stats, library] = await Promise.all([getDashboardStats(), listLibrary()]);

  const statusStrip = [
    { label: "Published", value: stats.published, icon: CheckCircle2, href: "/dashboard/content?status=PUBLISHED", tone: "text-success" },
    { label: "Waiting for approval", value: stats.pendingApprovals, icon: Clock, href: "/dashboard/content?status=AWAITING_APPROVAL", tone: "text-violet-500" },
    { label: "Awaiting verification", value: stats.pendingVerification, icon: ShieldCheck, href: "/dashboard/content?status=VERIFICATION_PENDING", tone: "text-warning" },
    { label: "Rejected", value: stats.rejected, icon: XCircle, href: "/dashboard/content?status=REJECTED", tone: "text-destructive" },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Overview"
        description={`${stats.total} item${stats.total === 1 ? "" : "s"} in your portfolio library · ${stats.verified} verified URL${stats.verified === 1 ? "" : "s"}`}
        actions={
          <Link href="/dashboard/add" className={buttonVariants()}>
            <PlusCircle /> Add content
          </Link>
        }
      />

      <Card className="grid grid-cols-2 divide-border max-lg:[&>*:nth-child(-n+2)]:border-b lg:grid-cols-4 lg:divide-x">
        {statusStrip.map((s) => (
          <Link key={s.label} href={s.href} className="flex items-center gap-3 px-4 py-3 transition-colors first:rounded-l-xl last:rounded-r-xl hover:bg-surface-2/60">
            <s.icon className={cn("size-4 shrink-0", s.tone)} />
            <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">{s.label}</span>
            <span className="text-sm font-semibold tabular-nums">{s.value}</span>
          </Link>
        ))}
      </Card>

      {stats.pending.length > 0 && (
        <Card>
          <CardHeader
            title="Needs your review"
            description="Verified and extracted — review, then publish."
            action={
              <Link href="/dashboard/content?status=AWAITING_APPROVAL" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                View all <ArrowRight />
              </Link>
            }
          />
          <ul className="divide-y">
            {stats.pending.map((item) => {
              const dupes = Array.isArray(item.duplicateWarnings) ? item.duplicateWarnings.length : 0;
              return (
                <li key={item.id}>
                  <Link href={`/dashboard/content/${item.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-2/60">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{item.title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {displayHost(item.url)} · updated {formatDate(item.updatedAt)}
                      </p>
                    </div>
                    {dupes > 0 && (
                      <span className="flex items-center gap-1 text-xs text-warning" title="Possible duplicates">
                        <AlertTriangle className="size-3.5" /> {dupes}
                      </span>
                    )}
                    <TypeBadge type={item.type} />
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Library items={library.items} total={library.total} perType={stats.perType} initialType={active} initialView={view} />

      <Card>
        <CardHeader title="Recent activity" />
        {stats.activity.length === 0 ? (
          <EmptyState title="No activity yet" />
        ) : (
          <ol className="grid gap-x-6 gap-y-3 px-5 py-4 sm:grid-cols-2">
            {stats.activity.map((a) => (
              <li key={a.id} className="flex gap-3 text-[13px]">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary/60" aria-hidden />
                <div className="min-w-0">
                  {a.targetType === "content" && a.targetId && a.action !== "content.deleted" ? (
                    <Link href={`/dashboard/content/${a.targetId}`} className="font-medium hover:underline">
                      {ACTIVITY_LABELS[a.action] ?? a.action}
                    </Link>
                  ) : (
                    <span className="font-medium">{ACTIVITY_LABELS[a.action] ?? a.action}</span>
                  )}
                  <p className="text-xs text-muted-foreground">{formatDateTime(a.createdAt)}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
