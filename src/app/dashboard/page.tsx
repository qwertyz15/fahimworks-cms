import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowRight, BookOpen, CheckCircle2, Clock, FileText, GraduationCap, PlusCircle, ShieldCheck } from "lucide-react";
import { StatusBadge, TypeBadge } from "@/components/content/badges";
import { Thumb } from "@/components/content/thumb";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { displayHost, formatDate, formatDateTime } from "@/lib/utils";
import { getDashboardStats } from "@/server/queries/content";

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

function Stat({ label, value, icon: Icon, hint, href }: { label: string; value: number; icon: typeof FileText; hint?: string; href?: string }) {
  const body = (
    <Card className="h-full p-4 transition-colors hover:bg-surface-2/60">
      <div className="flex items-center justify-between text-muted-foreground">
        <span className="text-[13px] font-medium">{label}</span>
        <Icon className="size-4" />
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}

export default async function DashboardPage() {
  const stats = await getDashboardStats();

  return (
    <div className="space-y-8">
      <PageHeader
        title="Overview"
        description="Your portfolio content at a glance."
        actions={
          <Link href="/dashboard/add" className={buttonVariants()}>
            <PlusCircle /> Add content
          </Link>
        }
      />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Statistics">
        <Stat label="Total blogs" value={stats.blogs} icon={BookOpen} hint={`${stats.total} items in total`} href="/dashboard/content?type=BLOG" />
        <Stat label="Tutorials" value={stats.tutorials} icon={GraduationCap} hint={`${stats.articles} articles · ${stats.projects} projects`} href="/dashboard/content?type=TUTORIAL" />
        <Stat label="Verified URLs" value={stats.verified} icon={ShieldCheck} hint={`${stats.pendingVerification} awaiting verification`} href="/dashboard/content?status=VERIFICATION_PENDING" />
        <Stat label="Pending approvals" value={stats.pendingApprovals} icon={Clock} hint={`${stats.published} published`} href="/dashboard/content?status=AWAITING_APPROVAL" />
      </section>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader
            title="Waiting for approval"
            description="Verified and extracted — review, then publish."
            action={
              <Link href="/dashboard/content?status=AWAITING_APPROVAL" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                View all <ArrowRight />
              </Link>
            }
          />
          {stats.pending.length === 0 ? (
            <EmptyState icon={<CheckCircle2 />} title="You're all caught up" description="Nothing is waiting for review right now." />
          ) : (
            <ul className="divide-y">
              {stats.pending.map((item) => {
                const dupes = Array.isArray(item.duplicateWarnings) ? item.duplicateWarnings.length : 0;
                return (
                  <li key={item.id}>
                    <Link href={`/dashboard/content/${item.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-2/60">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{item.title}</p>
                        <p className="truncate text-xs text-muted-foreground">{displayHost(item.url)} · updated {formatDate(item.updatedAt)}</p>
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
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Recent activity" />
          {stats.activity.length === 0 ? (
            <EmptyState title="No activity yet" />
          ) : (
            <ol className="space-y-3 px-5 py-4">
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

      <Card>
        <CardHeader
          title="Recently updated"
          action={
            <Link href="/dashboard/content" className={buttonVariants({ variant: "ghost", size: "sm" })}>
              All content <ArrowRight />
            </Link>
          }
        />
        {stats.recent.length === 0 ? (
          <EmptyState
            icon={<FileText />}
            title="No content yet"
            description="Add the URL of a blog post or tutorial you wrote. You'll prove you own it, then publish it to your portfolio."
            action={
              <Link href="/dashboard/add" className={buttonVariants({ size: "sm" })}>
                <PlusCircle /> Add your first item
              </Link>
            }
          />
        ) : (
          <ul className="divide-y">
            {stats.recent.map((item) => (
              <li key={item.id}>
                <Link href={`/dashboard/content/${item.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-2/60">
                  <Thumb src={item.thumbnail} className="size-9 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{displayHost(item.url)}</p>
                  </div>
                  <div className="hidden sm:block">
                    <StatusBadge status={item.status} />
                  </div>
                  <span className="hidden w-24 text-right text-xs text-muted-foreground md:block">{formatDate(item.updatedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
