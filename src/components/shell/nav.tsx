"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardCheck, FileText, Fuel, Scale, LayoutDashboard, Menu, PoundSterling, RefreshCw, Settings, SlidersHorizontal, TrendingUp, Users } from "lucide-react";
import { cn } from "@/components/ui/cn";

type NavItem = { href: string; label: string; short?: string; icon: typeof LayoutDashboard };

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/drivers", label: "Drivers", icon: Users },
  { href: "/earnings", label: "Income", icon: PoundSterling },
  { href: "/expenses", label: "Expenses", icon: Fuel },
  { href: "/adjustments", label: "Adjustments", icon: SlidersHorizontal },
  { href: "/reports", label: "Reports", icon: FileText },
  { href: "/check", label: "Period Check", icon: ClipboardCheck },
  { href: "/insights", label: "Insights", icon: TrendingUp },
  { href: "/sliding-scale", label: "Sliding Scale", icon: Scale },
  { href: "/data", label: "Data & Integrations", icon: RefreshCw },
  { href: "/settings", label: "Settings", icon: Settings },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" || pathname.startsWith("/alerts") : pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNav({ attention }: { attention: number }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-[0.9375rem] font-medium",
              active ? "bg-accent-soft text-accent-strong" : "text-ink-soft hover:bg-sunken",
            )}
          >
            <Icon className="size-[18px] shrink-0" aria-hidden />
            <span className="flex-1">{label}</span>
            {href === "/data" && attention > 0 ? (
              <span className="num rounded-full bg-warn-soft px-1.5 text-xs font-semibold text-warn" aria-label={`${attention} need attention`}>{attention}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

// Adjustments are used rarely; costs are checked often, so costs get the tab and Adjustments sit under More.
const MOBILE_PRIMARY = ["/", "/drivers", "/earnings", "/expenses"];

export function BottomNav() {
  const pathname = usePathname();
  const primary = NAV_ITEMS.filter((item) => MOBILE_PRIMARY.includes(item.href));
  const moreActive = pathname === "/menu" || NAV_ITEMS.some((item) => !MOBILE_PRIMARY.includes(item.href) && isActive(pathname, item.href));
  const itemClass = (active: boolean) =>
    cn("flex flex-1 flex-col items-center gap-1 px-1 pb-2 pt-2.5 text-[0.6875rem] font-medium", active ? "text-accent" : "text-muted");
  return (
    <nav aria-label="Main" className="no-print fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
      {primary.map(({ href, label, short, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link key={href} href={href} aria-current={active ? "page" : undefined} className={itemClass(active)}>
            <Icon className="size-5" aria-hidden />
            {/* The visible word is short ("Costs"); the full name is added for screen readers, so the two never disagree. */}
            {short ? <>{short}<span className="sr-only"> ({label})</span></> : label}
          </Link>
        );
      })}
      <Link href="/menu" aria-current={moreActive ? "page" : undefined} className={itemClass(moreActive)}>
        <Menu className="size-5" aria-hidden />
        More
      </Link>
    </nav>
  );
}
