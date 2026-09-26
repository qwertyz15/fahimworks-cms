"use client";

import { AlertCircle, Clock, FileCode2, FileText, RefreshCw, ShieldCheck } from "lucide-react";
import { issueTokenAction, verifyOwnershipAction } from "@/server/actions/content";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { useRunAction } from "@/components/use-action-toast";
import { cn, formatDateTime } from "@/lib/utils";

export interface VerificationPanelProps {
  contentId: string;
  url: string;
  status: "DRAFT" | "VERIFICATION_PENDING";
  token: null | {
    method: "META_TAG" | "FILE";
    token: string;
    snippet: string;
    fileName: string;
    fileUrl: string;
    expiresAt: string;
    expired: boolean;
    attempts: number;
    lastCheckedAt: string | null;
    lastError: string | null;
  };
}

function CodeBlock({ value, copy = value }: { value: string; copy?: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border bg-surface-2 p-2.5">
      <code className="min-w-0 flex-1 overflow-x-auto font-mono text-[12.5px] leading-relaxed break-all whitespace-pre-wrap">{value}</code>
      <CopyButton value={copy} />
    </div>
  );
}

export function VerificationPanel({ contentId, url, status, token }: VerificationPanelProps) {
  const verify = useRunAction();
  const issue = useRunAction();

  const switchMethod = (method: "META_TAG" | "FILE") => issue.run(() => issueTokenAction(contentId, method));

  return (
    <Card id="verification" className="scroll-mt-20 border-primary/30">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" /> Verify ownership
          </span>
        }
        description="Prove you control this page before it can be imported and published."
      />
      {!token ? (
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">Choose a verification method to generate a token.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" loading={issue.pending} onClick={() => switchMethod("META_TAG")}>
              <FileCode2 /> Use meta tag
            </Button>
            <Button variant="outline" loading={issue.pending} onClick={() => switchMethod("FILE")}>
              <FileText /> Use verification file
            </Button>
          </div>
        </CardContent>
      ) : (
        <>
          <CardContent className="space-y-4">
            <div role="tablist" aria-label="Verification method" className="inline-flex rounded-lg border bg-surface-2 p-0.5">
              {(["META_TAG", "FILE"] as const).map((m) => (
                <button
                  key={m}
                  role="tab"
                  type="button"
                  aria-selected={token.method === m}
                  disabled={issue.pending}
                  onClick={() => token.method !== m && switchMethod(m)}
                  className={cn(
                    "rounded-md px-3 py-1 text-[13px] font-medium text-muted-foreground transition-colors",
                    token.method === m && "bg-surface text-foreground shadow-card",
                  )}
                >
                  {m === "META_TAG" ? "Meta tag" : "File upload"}
                </button>
              ))}
            </div>

            {token.method === "META_TAG" ? (
              <ol className="space-y-3 text-sm">
                <li>
                  <p className="mb-1.5">
                    <span className="font-medium">1.</span> Add this tag inside the <code className="font-mono text-[12.5px]">&lt;head&gt;</code> of{" "}
                    <a href={url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">{url}</a>
                  </p>
                  <CodeBlock value={token.snippet} />
                </li>
                <li>
                  <span className="font-medium">2.</span> Publish the change, then click <em>Check verification</em>.
                  <p className="mt-1 text-xs text-muted-foreground">Tags in the page body are ignored for security. Most CMSs (WordPress, Ghost, Hugo, Next.js) let you add custom head tags per post or site-wide.</p>
                </li>
              </ol>
            ) : (
              <ol className="space-y-3 text-sm">
                <li>
                  <p className="mb-1.5"><span className="font-medium">1.</span> Create a file named</p>
                  <CodeBlock value={token.fileName} />
                </li>
                <li>
                  <p className="mb-1.5"><span className="font-medium">2.</span> Its only content must be the token:</p>
                  <CodeBlock value={token.token} />
                </li>
                <li>
                  <p className="mb-1.5"><span className="font-medium">3.</span> Upload it to your website root so it is reachable at</p>
                  <CodeBlock value={token.fileUrl} />
                </li>
              </ol>
            )}

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className={cn("flex items-center gap-1", token.expired && "text-destructive")}>
                <Clock className="size-3.5" /> {token.expired ? "Expired" : "Expires"} {formatDateTime(token.expiresAt)}
              </span>
              <span>{token.attempts} check{token.attempts === 1 ? "" : "s"}</span>
              {token.lastCheckedAt && <span>Last checked {formatDateTime(token.lastCheckedAt)}</span>}
            </div>

            {token.lastError && status === "VERIFICATION_PENDING" && (
              <div className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2.5 text-[13px] text-destructive" role="alert">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <span>{token.lastError}</span>
              </div>
            )}
          </CardContent>
          <CardFooter className="justify-between">
            <Button variant="ghost" size="sm" loading={issue.pending} onClick={() => switchMethod(token.method)}>
              <RefreshCw /> New token
            </Button>
            <Button loading={verify.pending} disabled={token.expired} onClick={() => verify.run(() => verifyOwnershipAction(contentId))}>
              {verify.pending ? "Checking & extracting…" : "Check verification"}
            </Button>
          </CardFooter>
        </>
      )}
    </Card>
  );
}
