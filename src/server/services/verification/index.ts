import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { SafeFetchError, safeFetch } from "@/lib/http/safe-fetch";
import { sameSite } from "@/lib/url";
import type { VerificationMethod } from "@/generated/prisma/enums";
import { transition, WorkflowError } from "../workflow";
import { getSettings } from "../settings";
import { audit } from "../audit";
import { fileBodyMatches, findMetaToken, verificationFileUrl } from "./match";

export * from "./match";

export function generateToken(): string {
  return randomBytes(20).toString("hex");
}

/**
 * Issue a fresh verification token for a content item (revoking earlier ones)
 * and move it to VERIFICATION_PENDING.
 */
export async function issueVerificationToken(contentId: string, method: VerificationMethod, actorId: string) {
  const settings = await getSettings();
  const content = await db.content.findUnique({ where: { id: contentId }, select: { id: true, status: true } });
  if (!content) throw new WorkflowError("Content not found.");
  if (content.status !== "DRAFT" && content.status !== "VERIFICATION_PENDING") {
    throw new WorkflowError("Ownership of this item is already verified.");
  }

  const token = generateToken();
  const expiresAt = new Date(Date.now() + settings.tokenTtlHours * 3_600_000);

  const created = await db.$transaction(async (tx) => {
    await tx.verificationToken.updateMany({
      where: { contentId, revokedAt: null, verifiedAt: null },
      data: { revokedAt: new Date() },
    });
    const row = await tx.verificationToken.create({ data: { contentId, method, token, expiresAt } });
    await transition(contentId, content.status, "VERIFICATION_PENDING", {}, tx);
    return row;
  });

  await audit({ actorId, action: "content.verification_issued", targetType: "content", targetId: contentId, metadata: { method } });
  return created;
}

export interface VerificationOutcome {
  ok: boolean;
  message: string;
}

function failureMessage(err: unknown): string {
  if (err instanceof SafeFetchError) {
    if (err.code === "CROSS_SITE_REDIRECT") return err.message;
    return `Could not fetch the page: ${err.message}`;
  }
  return "Unexpected error while checking the page.";
}

async function checkMeta(pageUrl: string, token: string): Promise<VerificationOutcome> {
  const res = await safeFetch(pageUrl, {
    accept: ["text/html", "application/xhtml+xml"],
    onRedirect: (from, to) => {
      if (!sameSite(new URL(pageUrl), to)) {
        throw new SafeFetchError("CROSS_SITE_REDIRECT", `The page redirects to a different site (${to.hostname}); verification must happen on the submitted domain.`);
      }
    },
  });
  const match = findMetaToken(res.body, token);
  if (!match.found) {
    return { ok: false, message: 'The page is reachable, but no <meta name="portfolio-verification"> tag was found in its <head>.' };
  }
  if (!match.matches) {
    return { ok: false, message: "A portfolio-verification meta tag was found, but its token does not match. Copy the current token again." };
  }
  return { ok: true, message: "Meta tag found and token matches." };
}

async function checkFile(pageUrl: string, token: string): Promise<VerificationOutcome> {
  const fileUrl = verificationFileUrl(pageUrl, token);
  const res = await safeFetch(fileUrl, {
    accept: ["text/", "application/octet-stream"],
    maxBytes: 4096,
    onRedirect: (_from, to) => {
      if (!sameSite(new URL(pageUrl), to)) {
        throw new SafeFetchError("CROSS_SITE_REDIRECT", `The verification file redirects to a different site (${to.hostname}).`);
      }
    },
  });
  if (!fileBodyMatches(res.body, token)) {
    return { ok: false, message: "The verification file exists, but its contents do not match the token." };
  }
  return { ok: true, message: "Verification file found and token matches." };
}

/**
 * Run the ownership check for the active token. On success the item moves to
 * VERIFIED; on failure it stays pending with the error recorded (the owner can
 * fix the page and retry).
 */
export async function runVerification(contentId: string, actorId: string): Promise<VerificationOutcome> {
  const content = await db.content.findUnique({
    where: { id: contentId },
    select: {
      id: true,
      url: true,
      status: true,
      verificationTokens: { where: { revokedAt: null, verifiedAt: null }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!content) throw new WorkflowError("Content not found.");
  if (content.status !== "VERIFICATION_PENDING") {
    throw new WorkflowError(content.status === "DRAFT" ? "Generate a verification token first." : "Ownership of this item is already verified.");
  }
  const token = content.verificationTokens[0];
  if (!token) throw new WorkflowError("No active verification token. Generate a new one.");
  if (token.expiresAt < new Date()) {
    return { ok: false, message: "This verification token has expired. Generate a new token and update your page." };
  }

  let outcome: VerificationOutcome;
  try {
    outcome = token.method === "META_TAG" ? await checkMeta(content.url, token.token) : await checkFile(content.url, token.token);
  } catch (err) {
    if (!(err instanceof SafeFetchError)) console.error("[verification] unexpected error", err);
    outcome = { ok: false, message: failureMessage(err) };
  }

  const now = new Date();
  if (outcome.ok) {
    await db.$transaction(async (tx) => {
      await tx.verificationToken.update({
        where: { id: token.id },
        data: { attempts: { increment: 1 }, lastCheckedAt: now, lastError: null, verifiedAt: now },
      });
      await transition(contentId, "VERIFICATION_PENDING", "VERIFIED", {}, tx);
    });
    await audit({ actorId, action: "content.verification_succeeded", targetType: "content", targetId: contentId, metadata: { method: token.method } });
  } else {
    await db.$transaction(async (tx) => {
      await tx.verificationToken.update({
        where: { id: token.id },
        data: { attempts: { increment: 1 }, lastCheckedAt: now, lastError: outcome.message },
      });
      await transition(contentId, "VERIFICATION_PENDING", "VERIFICATION_PENDING", { verificationFailed: true }, tx);
    });
    await audit({ actorId, action: "content.verification_failed", targetType: "content", targetId: contentId, metadata: { method: token.method, reason: outcome.message } });
  }
  return outcome;
}
