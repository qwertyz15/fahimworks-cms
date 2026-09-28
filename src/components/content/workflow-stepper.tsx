import { Check, X } from "lucide-react";
import type { ContentStatus } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

const STEPS = ["Added", "Waiting for approval", "Published"] as const;

/** Index of the step an item is currently at (legacy verification stages count as "Added"). */
function currentStep(status: ContentStatus, extracted: boolean): number {
  switch (status) {
    case "PUBLISHED":
      return 2;
    case "AWAITING_APPROVAL":
      return 1;
    case "REJECTED":
      return extracted ? 1 : 0;
    default:
      return 0;
  }
}

export function WorkflowStepper({ status, extracted }: { status: ContentStatus; extracted: boolean }) {
  const rejected = status === "REJECTED";
  const current = currentStep(status, extracted);

  return (
    <ol className="grid grid-cols-3 gap-1.5" aria-label="Workflow progress">
      {STEPS.map((label, i) => {
        const done = i < current || status === "PUBLISHED";
        const isCurrent = i === current && status !== "PUBLISHED";
        const failed = rejected && i === current;
        return (
          <li key={label} className="min-w-0" aria-current={isCurrent ? "step" : undefined}>
            <div className={cn("h-1 rounded-full bg-border", done && "bg-success", isCurrent && !failed && "bg-primary", failed && "bg-destructive")} />
            <div className="mt-2 flex items-center gap-1.5">
              <span
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded-full border text-[9px] font-semibold",
                  done && "border-success bg-success text-white",
                  isCurrent && !failed && "border-primary text-primary",
                  failed && "border-destructive bg-destructive text-white",
                )}
              >
                {done ? <Check className="size-2.5" /> : failed ? <X className="size-2.5" /> : i + 1}
              </span>
              <span className={cn("truncate text-xs", isCurrent || done ? "text-foreground" : "text-muted-foreground", failed && "text-destructive")}>
                {failed ? "Rejected" : label}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
