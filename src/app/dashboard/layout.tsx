import Link from "next/link";
import { ArrowUpRight, Clock3 } from "lucide-react";
import { Brand } from "@/components/brand";
import { MobileNav, NavLinks } from "@/components/dashboard/nav";
import { UserMenu } from "@/components/dashboard/user-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { db } from "@/lib/db";
import { requireAdmin } from "@/server/auth/guards";
import { getSettings } from "@/server/services/settings";
import { timelineUrl } from "@/lib/timeline";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();
  const [settings, pendingCount] = await Promise.all([getSettings(), db.content.count({ where: { status: "AWAITING_APPROVAL" } })]);

  const sidebar = (
    <div className="flex h-full flex-col gap-6">
      <Link href="/dashboard" className="px-1.5">
        <Brand name={settings.siteName} />
      </Link>
      <div className="space-y-3">
        <NavLinks pendingCount={pendingCount} />
        {settings.timelineEnabled && (
          <a
            href={timelineUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            <Clock3 className="size-4" />
            <span className="flex-1">Public timeline</span>
            <ArrowUpRight className="size-3.5" />
          </a>
        )}
      </div>
      <div className="mt-auto space-y-3">
        <div className="flex items-center justify-between px-1.5">
          <span className="text-xs text-muted-foreground">Theme</span>
          <ThemeToggle />
        </div>
        <div className="border-t pt-3">
          <UserMenu name={user.name} email={user.email} role={user.role} />
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="sticky top-0 hidden h-dvh border-r bg-surface-2/50 px-3 py-4 lg:block">{sidebar}</aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur lg:hidden">
          <MobileNav>{sidebar}</MobileNav>
          <Brand name={settings.siteName} />
        </header>
        {/* Pages marked data-full-width (database views) use the whole width, like Notion's full-width mode. */}
        <main className="mx-auto w-full max-w-6xl px-4 py-6 has-[[data-full-width]]:max-w-none sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
