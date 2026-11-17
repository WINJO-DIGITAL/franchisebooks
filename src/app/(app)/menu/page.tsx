import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, FileText, LogOut, RefreshCw, Settings, SlidersHorizontal, Bell } from "lucide-react";
import { signOut } from "@/lib/actions/auth";
import { getContext } from "@/lib/context";
import { PageHeader } from "@/components/ui/bits";

export const metadata: Metadata = { title: "More" };

const items = [
  { href: "/adjustments", label: "Adjustments", icon: SlidersHorizontal },
  { href: "/reports", label: "Reports", icon: FileText },
  { href: "/alerts", label: "Alerts", icon: Bell },
  { href: "/data", label: "Data & Integrations", icon: RefreshCw },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default async function MenuPage() {
  const ctx = await getContext();
  return (
    <>
      <PageHeader title="More" description={`${ctx.fullName || ctx.email} · ${ctx.accountName}`} />
      <ul className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
        {items.map(({ href, label, icon: Icon }) => (
          <li key={href} className="border-b border-line last:border-0">
            <Link href={href} className="flex items-center gap-3 px-4 py-4 text-base font-medium">
              <Icon className="size-5 text-muted" aria-hidden />
              <span className="flex-1">{label}</span>
              <ChevronRight className="size-4 text-muted" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
      <form action={signOut} className="mt-6">
        <button type="submit" className="flex w-full items-center justify-center gap-2 rounded-lg border border-line-strong bg-surface px-4 py-3 font-medium">
          <LogOut className="size-4" aria-hidden />
          Sign out
        </button>
      </form>
    </>
  );
}
