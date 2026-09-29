"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Database, FileText, LayoutDashboard, Menu, NotebookPen, PlusCircle, Settings, X } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/dashboard/content", label: "Content", icon: FileText },
  { href: "/dashboard/add", label: "Add content", icon: PlusCircle },
  { href: "/dashboard/notebook", label: "Notebook", icon: NotebookPen },
  { href: "/dashboard/databases", label: "Databases", icon: Database },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

export function NavLinks({ pendingCount, onNavigate }: { pendingCount: number; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="space-y-0.5" aria-label="Main">
      {ITEMS.map(({ href, label, icon: Icon, exact }) => {
        const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors",
              active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            <span className="flex-1">{label}</span>
            {href === "/dashboard/content" && pendingCount > 0 && (
              <span className="rounded-full bg-primary px-1.5 text-[11px] leading-5 font-semibold text-primary-foreground" title={`${pendingCount} waiting for approval`}>
                {pendingCount}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export function MobileNav({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  // eslint-disable-next-line react-hooks/set-state-in-effect -- close drawer on navigation
  useEffect(() => setOpen(false), [pathname]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted lg:hidden" aria-label="Open navigation">
        <Menu className="size-5" />
      </button>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 flex-col border-r bg-surface p-4 shadow-pop">
            <button type="button" onClick={() => setOpen(false)} className="mb-2 self-end rounded-md p-1.5 text-muted-foreground hover:bg-muted" aria-label="Close navigation">
              <X className="size-4" />
            </button>
            {children}
          </div>
        </div>
      )}
    </>
  );
}
