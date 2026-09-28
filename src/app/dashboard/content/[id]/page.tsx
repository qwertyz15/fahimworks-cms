import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, ExternalLink, Info } from "lucide-react";
import { ApprovalBadge, StatusBadge, TypeBadge } from "@/components/content/badges";
import { DecisionBar } from "@/components/content/decision-bar";
import { DuplicateWarnings } from "@/components/content/duplicate-warnings";
import { PreviewPanel } from "@/components/content/preview-panel";
import { WorkflowStepper } from "@/components/content/workflow-stepper";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { FormAlert } from "@/components/ui/field";
import { MetaRow } from "@/components/ui/misc";
import { formatDate, formatDateTime } from "@/lib/utils";
import { getContentDetail, getContentHistory } from "@/server/queries/content";
import type { DuplicateWarning } from "@/server/services/duplicates-core";
import { screenshotUrl } from "@/server/services/screenshot";

export const metadata: Metadata = { title: "Content" };

const HISTORY_LABELS: Record<string, string> = {
  "content.created": "Added",
  "content.updated": "Edited",
  // Entries from the removed ownership-verification flow (older items only).
  "content.verification_issued": "Verification token issued",
  "content.verification_succeeded": "Ownership verified",
  "content.verification_failed": "Verification check failed",
  "content.extracted": "Content extracted",
  "content.extraction_failed": "Extraction failed",
  "content.approved": "Approved & published",
  "content.rejected": "Rejected",
  "content.unpublished": "Unpublished",
  "content.reopened": "Reopened",
};

export default async function ContentDetailPage({ params, searchParams }: PageProps<"/dashboard/content/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const [content, history] = await Promise.all([getContentDetail(id), getContentHistory(id)]);
  if (!content) notFound();

  const warnings = (Array.isArray(content.duplicateWarnings) ? content.duplicateWarnings : []) as unknown as DuplicateWarning[];

  const NOTICES: Record<string, { tone: "success" | "info" | "error"; text: string }> = {
    published: { tone: "success", text: "Added and published to your portfolio." },
    review: { tone: "success", text: "Added. It's waiting for your approval — publish it when you're ready." },
    failed: { tone: "error", text: "Added, but the page could not be extracted. Fix the problem shown below, then click Extract content." },
  };
  const added = typeof sp.added === "string" ? NOTICES[sp.added] : undefined;
  const notice =
    added ??
    (sp.saved
      ? { tone: "success" as const, text: "Changes saved." }
      : sp.urlChanged
        ? { tone: "info" as const, text: "URL changed — click Extract content to import the new page, then publish it again." }
        : undefined);

  return (
    <div className="space-y-6">
      <Link href="/dashboard/content" className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> All content
      </Link>

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <TypeBadge type={content.type} />
          <StatusBadge status={content.status} />
          {content.featured && <span className="text-xs text-muted-foreground">★ Featured</span>}
        </div>
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight text-balance">{content.title}</h1>
          <a href={content.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[13px] break-all text-muted-foreground hover:text-foreground">
            {content.url} <ExternalLink className="size-3 shrink-0" />
          </a>
        </div>
        <DecisionBar id={content.id} title={content.title} status={content.status} extractionStatus={content.extractionStatus} hasDuplicates={warnings.length > 0} />
      </div>

      {notice && <FormAlert tone={notice.tone} message={notice.text} />}

      <Card>
        <CardContent className="py-5">
          <WorkflowStepper status={content.status} extracted={content.extractionStatus === "SUCCEEDED"} />
          {content.status === "REJECTED" && content.rejectionReason && (
            <p className="mt-4 flex items-start gap-2 text-[13px] text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" /> Rejection reason: {content.rejectionReason}
            </p>
          )}
          {content.status === "PUBLISHED" && (
            <p className="mt-4 flex items-center gap-2 text-[13px] text-success">
              <CheckCircle2 className="size-3.5" /> Live on your portfolio since {formatDateTime(content.publishedAt)} · slug <code className="font-mono text-xs">{content.slug}</code>
            </p>
          )}
        </CardContent>
      </Card>

      <DuplicateWarnings warnings={warnings} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <PreviewPanel content={content} screenshot={screenshotUrl(content.url)} />
        </div>

        <aside className="space-y-6">
          <Card>
            <CardHeader title="Status" />
            <CardContent className="py-2">
              <dl className="divide-y">
                <MetaRow label="Approval"><ApprovalBadge status={content.approvalStatus} /></MetaRow>
                <MetaRow label="Published">{content.publishedAt ? formatDate(content.publishedAt) : null}</MetaRow>
                <MetaRow label="Created">{formatDate(content.createdAt)}</MetaRow>
                <MetaRow label="Updated">{formatDate(content.updatedAt)}</MetaRow>
                <MetaRow label="Added by">{content.authorRef.name}</MetaRow>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="History" />
            <CardContent>
              {history.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">No history yet.</p>
              ) : (
                <ol className="relative space-y-3 border-l pl-4">
                  {history.map((h) => (
                    <li key={h.id} className="text-[13px]">
                      <span className="absolute -left-[4.5px] mt-1.5 size-2 rounded-full border-2 border-surface bg-primary/60" aria-hidden />
                      <p className="font-medium">{HISTORY_LABELS[h.action] ?? h.action}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(h.createdAt)}
                        {h.actor && ` · ${h.actor.name}`}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
