"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Minimal accessible menu: click to toggle, closes on outside click / Esc. */
export function Dropdown({ trigger, children, align = "end", label }: { trigger: ReactNode; children: (close: () => void) => ReactNode; align?: "start" | "end"; label: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        {trigger}
      </button>
      {open && (
        <div
          id={id}
          role="menu"
          className={cn("absolute z-30 mt-1 min-w-44 rounded-lg border bg-surface p-1 shadow-pop", align === "end" ? "right-0" : "left-0")}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ onSelect, children, destructive, disabled }: { onSelect: () => void; children: ReactNode; destructive?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:text-muted-foreground",
        destructive && "text-destructive [&_svg]:text-destructive",
      )}
    >
      {children}
    </button>
  );
}

export function MenuSeparator() {
  return <div className="my-1 h-px bg-border" role="separator" />;
}
