"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Bell } from "lucide-react";

const KEY = "lastPageBeforeAlerts";

/**
 * The header bell. Pressing it opens the Alerts page; pressing it again goes back to the page you were on.
 * The page before is remembered in this browser tab only (sessionStorage); if there is none, it goes to the Dashboard.
 */
export function AlertsBell({ count }: { count: number }) {
  const pathname = usePathname();
  const router = useRouter();
  const onAlerts = pathname === "/alerts" || pathname.startsWith("/alerts/");

  useEffect(() => {
    if (onAlerts) return;
    try {
      sessionStorage.setItem(KEY, `${window.location.pathname}${window.location.search}`);
    } catch {
      /* private mode: the bell then returns to the Dashboard */
    }
  }, [pathname, onAlerts]);

  return (
    <Link
      href="/alerts"
      onClick={(event) => {
        if (!onAlerts) return;
        event.preventDefault();
        let back = "/";
        try {
          back = sessionStorage.getItem(KEY) || "/";
        } catch {
          /* use the Dashboard */
        }
        router.push(back.startsWith("/") && !back.startsWith("/alerts") ? back : "/");
      }}
      className={`relative ml-auto flex h-10 shrink-0 items-center gap-2 rounded-lg px-2 text-sm font-medium hover:bg-sunken sm:px-3 ${onAlerts ? "bg-sunken text-ink" : "text-ink-soft"}`}
      aria-label={onAlerts ? "Close alerts and go back" : count > 0 ? `${count} things need attention` : "Alerts"}
      aria-current={onAlerts ? "page" : undefined}
    >
      <Bell className="size-[18px]" aria-hidden />
      <span className="hidden sm:inline">Alerts</span>
      {count > 0 ? <span className="num rounded-full bg-bad px-1.5 text-xs font-semibold text-white">{count}</span> : null}
    </Link>
  );
}
