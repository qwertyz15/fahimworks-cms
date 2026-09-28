import "server-only";
import type { ApprovalStatus, ContentStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

/**
 * Content workflow state machine. This module is the ONLY writer of `status`
 * and `approvalStatus`.
 *
 *   DRAFT ──extract──▶ AWAITING_APPROVAL ──approve──▶ PUBLISHED
 *                        ▲          │                     │
 *                        └─reopen─ REJECTED    unpublish ─┘ (→ DRAFT)
 *
 * Adding content normally runs extract + approve in one step ("Publish").
 * VERIFICATION_PENDING / VERIFIED are legacy stages from the removed
 * ownership-verification flow; rows still in them can only move forward.
 */

export const TRANSITIONS: Record<ContentStatus, readonly ContentStatus[]> = {
  // Any unpublished stage can be published directly (Publish button); imported items
  // additionally need a successful extraction (services/content.publishContent).
  DRAFT: ["AWAITING_APPROVAL", "PUBLISHED"],
  VERIFICATION_PENDING: ["AWAITING_APPROVAL", "DRAFT", "PUBLISHED"],
  VERIFIED: ["AWAITING_APPROVAL", "DRAFT", "REJECTED", "PUBLISHED"],
  AWAITING_APPROVAL: ["PUBLISHED", "REJECTED", "DRAFT", "AWAITING_APPROVAL"],
  PUBLISHED: ["AWAITING_APPROVAL", "DRAFT", "PUBLISHED"],
  REJECTED: ["AWAITING_APPROVAL", "DRAFT", "PUBLISHED"],
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

const APPROVAL: Record<ContentStatus, ApprovalStatus> = {
  DRAFT: "NOT_SUBMITTED",
  VERIFICATION_PENDING: "NOT_SUBMITTED",
  VERIFIED: "NOT_SUBMITTED",
  AWAITING_APPROVAL: "PENDING",
  PUBLISHED: "APPROVED",
  REJECTED: "REJECTED",
};

type Tx = Prisma.TransactionClient | typeof db;

export interface TransitionOptions {
  rejectionReason?: string | null;
  /** Additional columns to write atomically with the transition. */
  data?: Omit<Prisma.ContentUpdateManyMutationInput, "status" | "approvalStatus">;
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
  if (to === "DRAFT") Object.assign(timestamps, { approvedAt: null, publishedAt: null, rejectedAt: null, rejectionReason: null });
  if (to === "AWAITING_APPROVAL") Object.assign(timestamps, { rejectedAt: null, rejectionReason: null });
  if (to === "PUBLISHED" && from !== "PUBLISHED") Object.assign(timestamps, { approvedAt: now, publishedAt: now });
  if (to === "AWAITING_APPROVAL" && from === "PUBLISHED") Object.assign(timestamps, { publishedAt: null, approvedAt: null });
  if (to === "REJECTED") Object.assign(timestamps, { rejectedAt: now, rejectionReason: opts.rejectionReason ?? null, publishedAt: null, approvedAt: null });

  const result = await tx.content.updateMany({
    where: { id: contentId, status: from },
    data: { ...opts.data, ...timestamps, status: to, approvalStatus: APPROVAL[to] },
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
  VERIFICATION_PENDING: "Draft",
  VERIFIED: "Draft",
  AWAITING_APPROVAL: "Waiting for approval",
  PUBLISHED: "Published",
  REJECTED: "Rejected",
};

function label(s: ContentStatus) {
  return STATUS_LABELS[s];
}
