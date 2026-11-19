import { LogOut } from "lucide-react";
import { signOut } from "@/lib/actions/auth";

/** A driver's own space: no business navigation, just their pay. */
export default function DriverLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="Franchise Books by WINJO Digital" className="h-12 w-auto" />
            <span className="hidden text-[0.6875rem] font-medium uppercase tracking-wider text-muted sm:block">Your pay</span>
          </div>
          <form action={signOut}>
            <button type="submit" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-ink-soft hover:bg-sunken">
              <LogOut className="size-4" aria-hidden /> Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-6 sm:px-6 sm:pt-8">{children}</main>
    </div>
  );
}
