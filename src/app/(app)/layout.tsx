import Link from "next/link";
import { LogOut } from "lucide-react";
import { AlertsBell } from "@/components/shell/alerts-bell";
import { loadAttentionCount } from "@/lib/data/attention";
import { BottomNav, SidebarNav } from "@/components/shell/nav";
import { FranchiseSwitcher } from "@/components/shell/franchise-switcher";
import { signOut } from "@/lib/actions/auth";
import { brandInitials } from "@/lib/brand";
import { franchiseLabel, getContext } from "@/lib/context";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getContext();
  const attention = await loadAttentionCount(ctx.supabase, ctx.accountId, ctx.today);
  const reviewCount = attention.reviews;
  const initials = brandInitials(ctx.accountName);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15.5rem_1fr]">
      <aside className="no-print hidden border-r border-line bg-surface lg:flex lg:flex-col">
        <div className="sticky top-0 flex h-dvh flex-col p-4">
          <Link href="/" className="mb-6 flex items-center gap-2.5 px-2 pt-1">
            <span className="grid size-8 shrink-0 place-items-center rounded-md bg-accent text-[0.8125rem] font-semibold tracking-tight text-white" aria-hidden>{initials}</span>
            <span className="min-w-0">
              <span className="block truncate text-[0.9375rem] font-semibold leading-tight">{ctx.accountName || "Franchise Manager"}</span>
              <span className="block text-xs text-muted">Franchise Manager</span>
            </span>
          </Link>
          <SidebarNav attention={reviewCount} />
          <div className="mt-auto border-t border-line pt-3">
            <p className="truncate px-3 text-sm font-medium">{ctx.fullName || ctx.email}</p>
            <p className="truncate px-3 text-xs capitalize text-muted">{ctx.role}</p>
            <form action={signOut}>
              <button type="submit" className="mt-2 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-ink-soft hover:bg-sunken">
                <LogOut className="size-4" aria-hidden />
                Sign out
              </button>
            </form>
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="no-print sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-line bg-paper/95 px-4 backdrop-blur sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2 lg:hidden">
            <span className="grid size-8 shrink-0 place-items-center rounded-md bg-accent text-[0.8125rem] font-semibold tracking-tight text-white" aria-hidden>{initials}</span>
            <span className="sr-only">Franchise Manager</span>
          </Link>
          <FranchiseSwitcher
            franchises={ctx.franchises.filter((f) => f.isActive || f.id === ctx.franchiseId).map((f) => ({ id: f.id, label: franchiseLabel(f) }))}
            selected={ctx.franchiseId}
          />
          <AlertsBell count={attention.total} />
        </header>
        <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-6 sm:px-6 sm:pt-8 lg:px-8 lg:pb-16">{children}</main>
      </div>
      <BottomNav />
    </div>
  );
}
