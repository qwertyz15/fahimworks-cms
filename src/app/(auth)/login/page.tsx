import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "@/components/auth/login-form";
import { Brand } from "@/components/brand";
import { Card, CardContent } from "@/components/ui/card";
import { registrationState, getSettings } from "@/server/services/settings";

export const metadata: Metadata = { title: "Sign in" };

const NOTICES: Record<string, string> = {
  "password-changed": "Password changed. Please sign in with your new password.",
  "signed-out-everywhere": "All sessions were signed out.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const [{ allowed, isFirstUser }, settings] = await Promise.all([registrationState(), getSettings()]);
  const reason = typeof params.reason === "string" ? params.reason : undefined;
  const error = typeof params.error === "string" ? params.error : undefined;
  const callbackUrl = typeof params.callbackUrl === "string" ? params.callbackUrl : undefined;
  const notice = (reason && NOTICES[reason]) || (error === "AccessDenied" ? "Your account does not have access to the dashboard." : undefined);

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <Brand name={settings.siteName} />
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Sign in to your dashboard</h1>
          <p className="text-sm text-muted-foreground">Private area — authorised access only.</p>
        </div>
      </div>
      <Card>
        <CardContent className="p-6">
          <LoginForm callbackUrl={callbackUrl} notice={notice} />
        </CardContent>
      </Card>
      {allowed && (
        <p className="text-center text-sm text-muted-foreground">
          {isFirstUser ? "No administrator exists yet. " : "Need an account? "}
          <Link href="/register" className="font-medium text-primary hover:underline">
            {isFirstUser ? "Set up the admin account" : "Register"}
          </Link>
        </p>
      )}
    </div>
  );
}
