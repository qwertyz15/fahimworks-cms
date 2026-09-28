import { Badge, type BadgeTone } from "@/components/ui/badge";
import type { ApprovalStatus, ContentStatus, ContentType } from "@/generated/prisma/enums";

const STATUS: Record<ContentStatus, { label: string; tone: BadgeTone }> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  // Legacy stages from the removed ownership-verification flow.
  VERIFICATION_PENDING: { label: "Draft", tone: "neutral" },
  VERIFIED: { label: "Draft", tone: "neutral" },
  AWAITING_APPROVAL: { label: "Awaiting approval", tone: "purple" },
  PUBLISHED: { label: "Published", tone: "green" },
  REJECTED: { label: "Rejected", tone: "red" },
};

const APPROVAL: Record<ApprovalStatus, { label: string; tone: BadgeTone }> = {
  NOT_SUBMITTED: { label: "Not submitted", tone: "neutral" },
  PENDING: { label: "Pending", tone: "purple" },
  APPROVED: { label: "Approved", tone: "green" },
  REJECTED: { label: "Rejected", tone: "red" },
};

const TYPE: Record<ContentType, { label: string; tone: BadgeTone }> = {
  BLOG: { label: "Blog", tone: "indigo" },
  TUTORIAL: { label: "Tutorial", tone: "blue" },
  ARTICLE: { label: "Article", tone: "pink" },
  PROJECT: { label: "Project", tone: "amber" },
};

export const TYPE_LABELS = Object.fromEntries(Object.entries(TYPE).map(([k, v]) => [k, v.label])) as Record<ContentType, string>;
export const STATUS_OPTIONS = Object.entries(STATUS)
  .filter(([value]) => value !== "VERIFICATION_PENDING" && value !== "VERIFIED")
  .map(([value, v]) => ({ value, label: v.label }));

export function StatusBadge({ status }: { status: ContentStatus }) {
  const s = STATUS[status];
  return <Badge tone={s.tone} dot>{s.label}</Badge>;
}

export function ApprovalBadge({ status }: { status: ApprovalStatus }) {
  const s = APPROVAL[status];
  return <Badge tone={s.tone} dot>{s.label}</Badge>;
}

export function TypeBadge({ type }: { type: ContentType }) {
  const t = TYPE[type];
  return <Badge tone={t.tone}>{t.label}</Badge>;
}
