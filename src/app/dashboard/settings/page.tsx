import type { Metadata } from "next";
import { headers } from "next/headers";
import { ChangePasswordForm, SessionsCard } from "@/components/settings/account-forms";
import { SettingsForm } from "@/components/settings/settings-form";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { MetaRow, PageHeader } from "@/components/ui/misc";
import { formatDateTime } from "@/lib/utils";
import { db } from "@/lib/db";
import { requireAdmin } from "@/server/auth/guards";
import { getSettings } from "@/server/services/settings";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireAdmin();
  const [settings, account] = await Promise.all([
    getSettings(),
    db.user.findUniqueOrThrow({ where: { id: user.id }, select: { createdAt: true, lastLoginAt: true } }),
  ]);
  const h = await headers();
  const base = process.env.AUTH_URL ?? `https://${h.get("host")}`;
  const endpoints = [
    { label: "List published", url: `${base}/api/public/content` },
    { label: "Filter", url: `${base}/api/public/content?type=TUTORIAL&tag=nextjs&limit=10` },
    { label: "Single item", url: `${base}/api/public/content/{slug}` },
    { label: "RSS feed", url: `${base}/feed.xml` },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader title="Settings" description="Manage your dashboard, content rules, and account." />

      <SettingsForm
        values={{
          siteName: settings.siteName,
          portfolioUrl: settings.portfolioUrl,
          minWordCount: settings.minWordCount,
          allowRegistration: settings.allowRegistration,
          publicApiEnabled: settings.publicApiEnabled,
          allowedOrigins: settings.allowedOrigins,
        }}
      />

      <Card>
        <CardHeader title="Portfolio integration" description="Read-only endpoints your portfolio site can consume. Only published items are exposed." />
        <CardContent className="space-y-2">
          {endpoints.map((e) => (
            <div key={e.label} className="flex items-center gap-3">
              <span className="w-28 shrink-0 text-[13px] text-muted-foreground">{e.label}</span>
              <code className="min-w-0 flex-1 truncate rounded-md border bg-surface-2 px-2 py-1.5 font-mono text-xs">GET {e.url}</code>
              <CopyButton value={e.url} />
            </div>
          ))}
        </CardContent>
      </Card>

      <section className="space-y-6">
        <h2 className="text-sm font-semibold">Account</h2>
        <Card>
          <CardContent className="py-2">
            <dl className="divide-y">
              <MetaRow label="Name">{user.name}</MetaRow>
              <MetaRow label="Email">{user.email}</MetaRow>
              <MetaRow label="Role">{user.role}</MetaRow>
              <MetaRow label="Member since">{formatDateTime(account.createdAt)}</MetaRow>
              <MetaRow label="Last sign-in">{formatDateTime(account.lastLoginAt)}</MetaRow>
            </dl>
          </CardContent>
        </Card>
        <ChangePasswordForm />
        <SessionsCard />
      </section>
    </div>
  );
}
