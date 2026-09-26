import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const tones = {
  neutral: "bg-muted text-muted-foreground ring-border",
  blue: "bg-sky-500/10 text-sky-700 ring-sky-500/20 dark:text-sky-300",
  indigo: "bg-indigo-500/10 text-indigo-700 ring-indigo-500/20 dark:text-indigo-300",
  green: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300",
  amber: "bg-amber-500/12 text-amber-700 ring-amber-500/25 dark:text-amber-300",
  red: "bg-red-500/10 text-red-700 ring-red-500/20 dark:text-red-300",
  purple: "bg-violet-500/10 text-violet-700 ring-violet-500/20 dark:text-violet-300",
  pink: "bg-pink-500/10 text-pink-700 ring-pink-500/20 dark:text-pink-300",
} as const;

export type BadgeTone = keyof typeof tones;

export function Badge({ tone = "neutral", dot, children, className }: { tone?: BadgeTone; dot?: boolean; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset", tones[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}
