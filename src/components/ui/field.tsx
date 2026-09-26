import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Label({ htmlFor, children, className }: { htmlFor?: string; children: ReactNode; className?: string }) {
  return (
    <label htmlFor={htmlFor} className={cn("text-[13px] font-medium text-foreground", className)}>
      {children}
    </label>
  );
}

/** Label + control + hint/error, wired for accessibility. */
export function Field({ id, label, hint, error, children, className }: { id: string; label: ReactNode; hint?: ReactNode; error?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function FormAlert({ message, tone = "error" }: { message?: string; tone?: "error" | "success" | "info" }) {
  if (!message) return null;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-lg border px-3 py-2.5 text-sm",
        tone === "error" && "border-destructive/30 bg-destructive/8 text-destructive",
        tone === "success" && "border-success/30 bg-success/10 text-success",
        tone === "info" && "border-primary/25 bg-accent text-accent-foreground",
      )}
    >
      {message}
    </div>
  );
}
