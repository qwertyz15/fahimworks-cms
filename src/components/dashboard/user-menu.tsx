import { LogOut } from "lucide-react";
import { logoutAction } from "@/server/actions/auth";

export function UserMenu({ name, email, role }: { name: string; email: string; role: string }) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <div className="flex items-center gap-2.5 rounded-lg p-1.5">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">{initials}</div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium">{name}</p>
        <p className="truncate text-xs text-muted-foreground" title={email}>
          {role.toLowerCase()} · {email}
        </p>
      </div>
      <form action={logoutAction}>
        <button type="submit" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Sign out" title="Sign out">
          <LogOut className="size-4" />
        </button>
      </form>
    </div>
  );
}
