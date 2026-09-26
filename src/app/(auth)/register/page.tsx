import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { RegisterForm } from "@/components/auth/register-form";
import { Brand } from "@/components/brand";
import { Card, CardContent } from "@/components/ui/card";
import { getSettings, registrationState } from "@/server/services/settings";

export const metadata: Metadata = { title: "Create account" };

export default async function RegisterPage() {
  const [{ allowed, isFirstUser }, settings] = await Promise.all([registrationState(), getSettings()]);
  // Registration closes automatically once the first admin exists.
  if (!allowed) redirect("/login");

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <Brand name={settings.siteName} />
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{isFirstUser ? "Create the admin account" : "Create an account"}</h1>
          <p className="text-sm text-muted-foreground">
            {isFirstUser ? "This is a one-time setup. Registration closes automatically afterwards." : "New accounts are created with the Editor role."}
          </p>
        </div>
      </div>
      {isFirstUser && (
        <div className="flex gap-2.5 rounded-lg border border-primary/25 bg-accent px-3 py-2.5 text-[13px] text-accent-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" />
          The first account becomes the <strong className="font-semibold">administrator</strong> with full control over content and settings.
        </div>
      )}
      <Card>
        <CardContent className="p-6">
          <RegisterForm />
        </CardContent>
      </Card>
      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
