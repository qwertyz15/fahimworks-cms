import { Badge, type BadgeTone } from "@/components/ui/badge";
import type { ApprovalStatus, ContentStatus, ContentType, VerificationStatus } from "@/generated/prisma/enums";

const STATUS: Record<ContentStatus, { label: string; tone: BadgeTone }> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  VERIFICATION_PENDING: { label: "Verification pending", tone: "amber" },
  VERIFIED: { label: "Verified", tone: "blue" },
  AWAITING_APPROVAL: { label: "Awaiting approval", tone: "purple" },
  PUBLISHED: { label: "Published", tone: "green" },
  REJECTED: { label: "Rejected", tone: "red" },
};

const VERIFICATION: Record<VerificationStatus, { label: string; tone: BadgeTone }> = {
  UNVERIFIED: { label: "Unverified", tone: "neutral" },
  PENDING: { label: "Pending", tone: "amber" },
  VERIFIED: { label: "Verified", tone: "green" },
  FAILED: { label: "Failed", tone: "red" },
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
export const STATUS_OPTIONS = Object.entries(STATUS).map(([value, v]) => ({ value, label: v.label }));

export function StatusBadge({ status }: { status: ContentStatus }) {
  const s = STATUS[status];
  return <Badge tone={s.tone} dot>{s.label}</Badge>;
}

export function VerificationBadge({ status }: { status: VerificationStatus }) {
  const s = VERIFICATION[status];
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
