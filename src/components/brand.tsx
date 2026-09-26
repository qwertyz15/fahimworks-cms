import { cn } from "@/lib/utils";

export function Brand({ name, className }: { name: string; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="flex size-7 items-center justify-center rounded-lg bg-primary text-[13px] font-bold text-primary-foreground shadow-sm">
        {name.trim().charAt(0).toUpperCase() || "P"}
      </div>
      <span className="truncate text-sm font-semibold tracking-tight">{name}</span>
    </div>
  );
}
