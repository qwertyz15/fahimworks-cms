import "server-only";
import type { ApprovalStatus, ContentStatus, VerificationStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

/**
 * Content workflow state machine. This module is the ONLY writer of
 * `status`, `verificationStatus` and `approvalStatus`.
 *
 *   DRAFT → VERIFICATION_PENDING → VERIFIED → AWAITING_APPROVAL → PUBLISHED
 *                                                    ↓↑               ↓
 *                                                 REJECTED    (unpublish → AWAITING_APPROVAL)
 */

export const TRANSITIONS: Record<ContentStatus, readonly ContentStatus[]> = {
  DRAFT: ["VERIFICATION_PENDING"],
  VERIFICATION_PENDING: ["VERIFICATION_PENDING", "VERIFIED", "DRAFT"],
  VERIFIED: ["AWAITING_APPROVAL", "DRAFT", "REJECTED"],
  AWAITING_APPROVAL: ["PUBLISHED", "REJECTED", "DRAFT", "AWAITING_APPROVAL"],
  PUBLISHED: ["AWAITING_APPROVAL", "DRAFT", "PUBLISHED"],
  REJECTED: ["AWAITING_APPROVAL", "VERIFIED", "DRAFT"],
};

export class WorkflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowError";
  }
}

export function canTransition(from: ContentStatus, to: ContentStatus) {
  return TRANSITIONS[from].includes(to);
}

type Derived = { verificationStatus?: VerificationStatus; approvalStatus: ApprovalStatus };

function derived(to: ContentStatus, opts: { verificationFailed?: boolean }): Derived {
  switch (to) {
    case "DRAFT":
      return { verificationStatus: "UNVERIFIED", approvalStatus: "NOT_SUBMITTED" };
    case "VERIFICATION_PENDING":
      return { verificationStatus: opts.verificationFailed ? "FAILED" : "PENDING", approvalStatus: "NOT_SUBMITTED" };
    case "VERIFIED":
      return { verificationStatus: "VERIFIED", approvalStatus: "NOT_SUBMITTED" };
    case "AWAITING_APPROVAL":
      return { verificationStatus: "VERIFIED", approvalStatus: "PENDING" };
    case "PUBLISHED":
      return { verificationStatus: "VERIFIED", approvalStatus: "APPROVED" };
    case "REJECTED":
      // Verification state is preserved: rejecting is an editorial decision.
      return { approvalStatus: "REJECTED" };
  }
}

type Tx = Prisma.TransactionClient | typeof db;

export interface TransitionOptions {
  verificationFailed?: boolean;
  rejectionReason?: string | null;
  /** Additional columns to write atomically with the transition. */
  data?: Omit<Prisma.ContentUpdateManyMutationInput, "status" | "verificationStatus" | "approvalStatus">;
}

type PublishHook = (contentId: string) => Promise<void> | void;
const publishHooks: PublishHook[] = [];

/** Register side effects for publication (newsletters, webhooks, cache purge…). */
export function onPublished(hook: PublishHook) {
  publishHooks.push(hook);
}

/**
 * Move a content item from `from` to `to`. Uses a conditional update on the
 * current status (optimistic concurrency) so concurrent requests cannot both
 * succeed from the same starting state.
 */
export async function transition(
  contentId: string,
  from: ContentStatus,
  to: ContentStatus,
  opts: TransitionOptions = {},
  tx: Tx = db,
) {
  if (!canTransition(from, to)) {
    throw new WorkflowError(`Cannot move content from ${label(from)} to ${label(to)}.`);
  }
  const now = new Date();
  const timestamps: Prisma.ContentUpdateManyMutationInput = {};
  if (to === "DRAFT") Object.assign(timestamps, { verifiedAt: null, approvedAt: null, publishedAt: null, rejectedAt: null, rejectionReason: null });
  if (to === "VERIFIED" && from !== "REJECTED") timestamps.verifiedAt = now;
  if (to === "AWAITING_APPROVAL") Object.assign(timestamps, { rejectedAt: null, rejectionReason: null });
  if (to === "PUBLISHED" && from !== "PUBLISHED") Object.assign(timestamps, { approvedAt: now, publishedAt: now });
  if (to === "AWAITING_APPROVAL" && from === "PUBLISHED") Object.assign(timestamps, { publishedAt: null, approvedAt: null });
  if (to === "REJECTED") Object.assign(timestamps, { rejectedAt: now, rejectionReason: opts.rejectionReason ?? null, publishedAt: null, approvedAt: null });

  const result = await tx.content.updateMany({
    where: { id: contentId, status: from },
    data: { ...opts.data, ...timestamps, status: to, ...derived(to, opts) },
  });
  if (result.count !== 1) {
    throw new WorkflowError("This item was changed by another request. Refresh and try again.");
  }

  if (to === "PUBLISHED" && from !== "PUBLISHED") {
    for (const hook of publishHooks) {
      Promise.resolve(hook(contentId)).catch((err) => console.error("[workflow] publish hook failed", err));
    }
  }
}

export const STATUS_LABELS: Record<ContentStatus, string> = {
  DRAFT: "Draft",
  VERIFICATION_PENDING: "Verification pending",
  VERIFIED: "Ownership verified",
  AWAITING_APPROVAL: "Waiting for approval",
  PUBLISHED: "Published",
  REJECTED: "Rejected",
};

function label(s: ContentStatus) {
  return STATUS_LABELS[s];
}
