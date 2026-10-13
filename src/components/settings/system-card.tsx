"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, BellRing, Check, ChevronDown, CircleCheck, CircleX, Database, HardDrive } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { resolveErrorAction, testAlertAction } from "@/server/actions/system";

export interface SystemError {
  id: string;
  source: string;
  message: string;
  stack: string | null;
  route: string | null;
  count: number;
  firstSeen: string;
  lastSeen: string;
}

const when = (iso: string) => new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

function Status({ ok, label, detail, icon: Icon }: { ok: boolean | null; label: string; detail: string; icon: typeof Database }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px]">
      <Icon className="size-4 text-muted-foreground" />
      <span className="font-medium">{label}</span>
      <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
        {ok === null ? null : ok ? <CircleCheck className="size-3.5 text-success" /> : <CircleX className="size-3.5 text-destructive" />}
        {detail}
      </span>
    </div>
  );
}

/** Settings → System: health, alert set-up, and recent errors. */
export function SystemCard({ database, storage, alerts, cron, errors }: { database: boolean; storage: string; alerts: boolean; cron: boolean; errors: SystemError[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const run = async (key: string, p: Promise<{ ok: boolean; error?: string; message?: string }>) => {
    setBusy(key);
    const r = await p;
    setBusy(null);
    if (!r.ok) toast.error(r.error ?? "Something went wrong.");
    else if (r.message) toast.success(r.message);
    router.refresh();
  };
  return (
    <Card id="system">
      <CardHeader title="System" description="Health, error alerts to your phone, and recent errors." />
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-2">
          <Status ok={database} label="Database" detail={database ? "Connected" : "Unreachable"} icon={Database} />
          <Status ok={storage === "off" ? null : storage === "ok"} label="Media storage" detail={storage === "ok" ? "Connected" : storage === "off" ? "Not set up" : storage} icon={HardDrive} />
          <Status ok={alerts} label="Phone alerts (ntfy)" detail={alerts ? "On" : "Not set up"} icon={BellRing} />
          <Status ok={cron} label="Daily check" detail={cron ? "On" : "Not set up"} icon={Check} />
        </div>

        {(!alerts || !cron) && (
          <div className="space-y-1.5 rounded-lg border border-warning/40 bg-warning/10 p-3 text-[13px]" data-testid="alerts-setup">
            <p className="font-medium">Set up alerts (about 2 minutes)</p>
            <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
              {!alerts && (
                <>
                  <li>
                    Install <span className="font-medium text-foreground">ntfy</span> on your phone (App Store / Play Store) and subscribe to a hard-to-guess topic, e.g. <code className="rounded bg-muted px-1">fahim-cms-8f3k2q</code>.
                  </li>
                  <li>
                    In Vercel → Settings → Environment Variables add <code className="rounded bg-muted px-1">ALERT_NTFY_TOPIC</code> = that topic, then redeploy.
                  </li>
                </>
              )}
              {!cron && (
                <li>
                  Add <code className="rounded bg-muted px-1">CRON_SECRET</code> (any long random string) so the daily health check and trash cleanup can run.
                </li>
              )}
              <li>
                For “the whole site is down”, add a free monitor (e.g. UptimeRobot) for <code className="rounded bg-muted px-1">/api/health</code> every 5 minutes.
              </li>
            </ol>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" loading={busy === "test"} onClick={() => void run("test", testAlertAction())}>
            <BellRing /> Send test alert
          </Button>
          {errors.length > 0 && (
            <Button size="sm" variant="ghost" loading={busy === "all"} onClick={() => void run("all", resolveErrorAction({ all: true }))}>
              <Check /> Mark all resolved
            </Button>
          )}
        </div>

        <div>
          <p className="mb-2 text-[13px] font-medium">{errors.length ? `Open errors (${errors.length})` : "No open errors"}</p>
          {errors.length > 0 && (
            <ul className="divide-y rounded-lg border" data-testid="error-list">
              {errors.map((e) => (
                <li key={e.id} className="text-[13px]">
                  <div className="flex items-start gap-2 px-3 py-2">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
                    <button type="button" onClick={() => setOpen(open === e.id ? null : e.id)} aria-expanded={open === e.id} className="min-w-0 flex-1 text-left">
                      <span className="block truncate font-medium">{e.message}</span>
                      <span className="block text-xs text-muted-foreground">
                        {e.source} · {e.route ?? "—"} · {e.count}× · last {when(e.lastSeen)}
                      </span>
                    </button>
                    <ChevronDown className={cn("mt-0.5 size-3.5 text-muted-foreground transition-transform", open === e.id && "rotate-180")} />
                    <Button size="sm" variant="ghost" loading={busy === e.id} onClick={() => void run(e.id, resolveErrorAction({ id: e.id }))}>
                      Resolve
                    </Button>
                  </div>
                  {open === e.id && (
                    <div className="space-y-1 border-t bg-muted/30 px-3 py-2 text-xs">
                      <p className="text-muted-foreground">First seen {when(e.firstSeen)}</p>
                      {e.stack && <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-background p-2 font-mono text-[11px]">{e.stack}</pre>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
