import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

export type AuditAction =
  | "auth.register"
  | "auth.login"
  | "auth.login_failed"
  | "auth.password_changed"
  | "auth.sessions_revoked"
  | "content.created"
  | "content.updated"
  | "content.deleted"
  | "content.verification_issued"
  | "content.verification_succeeded"
  | "content.verification_failed"
  | "content.extracted"
  | "content.extraction_failed"
  | "content.approved"
  | "content.rejected"
  | "content.unpublished"
  | "content.reopened"
  | "settings.updated";

interface AuditInput {
  actorId?: string | null;
  action: AuditAction;
  targetType?: "content" | "user" | "settings";
  targetId?: string;
  metadata?: Prisma.InputJsonValue;
  ip?: string;
}

/** Append-only audit trail. Never throws — auditing must not break the action. */
export async function audit(input: AuditInput, client: Pick<typeof db, "auditLog"> = db) {
  try {
    await client.auditLog.create({ data: input });
  } catch (err) {
    console.error("[audit] failed to write audit log", err);
  }
}
