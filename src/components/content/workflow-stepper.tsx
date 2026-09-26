import { Check, X } from "lucide-react";
import type { ContentStatus } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

const STEPS: { key: ContentStatus; label: string }[] = [
  { key: "DRAFT", label: "Draft" },
  { key: "VERIFICATION_PENDING", label: "Verification pending" },
  { key: "VERIFIED", label: "Ownership verified" },
  { key: "AWAITING_APPROVAL", label: "Waiting for approval" },
  { key: "PUBLISHED", label: "Published" },
];

export function WorkflowStepper({ status, verified }: { status: ContentStatus; verified: boolean }) {
  const rejected = status === "REJECTED";
  // A rejected item is shown as stopped at the approval step.
  const currentIndex = rejected ? (verified ? 3 : 1) : STEPS.findIndex((s) => s.key === status);

  return (
    <ol className="grid grid-cols-5 gap-1.5" aria-label="Workflow progress">
      {STEPS.map((step, i) => {
        const done = i < currentIndex || status === "PUBLISHED";
        const current = i === currentIndex && status !== "PUBLISHED";
        const failed = rejected && i === currentIndex;
        return (
          <li key={step.key} className="min-w-0" aria-current={current ? "step" : undefined}>
            <div className={cn("h-1 rounded-full bg-border", done && "bg-success", current && !failed && "bg-primary", failed && "bg-destructive")} />
            <div className="mt-2 flex items-center gap-1.5">
              <span
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded-full border text-[9px] font-semibold",
                  done && "border-success bg-success text-white",
                  current && !failed && "border-primary text-primary",
                  failed && "border-destructive bg-destructive text-white",
                )}
              >
                {done ? <Check className="size-2.5" /> : failed ? <X className="size-2.5" /> : i + 1}
              </span>
              <span className={cn("truncate text-xs", current || done ? "text-foreground" : "text-muted-foreground", failed && "text-destructive")}>
                {failed ? "Rejected" : step.label}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
