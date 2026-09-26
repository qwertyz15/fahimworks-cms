import Link from "next/link";
import { Brand } from "@/components/brand";
import { MobileNav, NavLinks } from "@/components/dashboard/nav";
import { UserMenu } from "@/components/dashboard/user-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { db } from "@/lib/db";
import { requireAdmin } from "@/server/auth/guards";
import { getSettings } from "@/server/services/settings";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();
  const [settings, pendingCount] = await Promise.all([getSettings(), db.content.count({ where: { status: "AWAITING_APPROVAL" } })]);

  const sidebar = (
    <div className="flex h-full flex-col gap-6">
      <Link href="/dashboard" className="px-1.5">
        <Brand name={settings.siteName} />
      </Link>
      <NavLinks pendingCount={pendingCount} />
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
        <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
