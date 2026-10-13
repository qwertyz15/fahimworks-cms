"use client";

import { useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover } from "@/components/database/popover";

/** A ⋯ button with a menu (portal, so it's never clipped by a scrolling tree). */
export function ActionMenu({ label, children, className, trigger }: { label: string; children: (close: () => void) => ReactNode; className?: string; trigger?: ReactNode }) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        ref={setAnchor}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className={cn("inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground", className ?? "size-7")}
      >
        {trigger ?? <MoreHorizontal className="size-4" />}
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} label={label} placement="bottom-end">
        <div className="w-56" role="menu" aria-label={label}>
          {children(() => setOpen(false))}
        </div>
      </Popover>
    </>
  );
}

export function Item({ icon: Icon, children, onSelect, destructive, disabled, href, download, newTab }: { icon?: React.ComponentType<{ className?: string }>; children: ReactNode; onSelect?: () => void; destructive?: boolean; disabled?: boolean; href?: string; download?: boolean; newTab?: boolean }) {
  const cls = cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted disabled:opacity-50", destructive && "text-destructive");
  const inner = (
    <>
      {Icon && <Icon className={cn("size-3.5 shrink-0", destructive ? "text-destructive" : "text-muted-foreground")} />}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </>
  );
  if (href)
    return (
      <a role="menuitem" href={href} onClick={onSelect} {...(download ? { download: "" } : {})} {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})} className={cls}>
        {inner}
      </a>
    );
  return (
    <button type="button" role="menuitem" onClick={onSelect} disabled={disabled} className={cls}>
      {inner}
    </button>
  );
}

export const Separator = () => <div className="my-1 h-px bg-border" role="separator" />;
