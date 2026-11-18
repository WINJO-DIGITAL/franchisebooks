import { LogOut } from "lucide-react";
import { signOut } from "@/lib/actions/auth";
import { brandInitials } from "@/lib/brand";

/** A driver's own space: no business navigation, just their pay. */
export default function DriverLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-lg bg-accent text-sm font-semibold tracking-tight text-white" aria-hidden>{brandInitials("Franchise Books")}</span>
            <span className="leading-tight">
              <span className="block text-[0.9375rem] font-semibold">Franchise Books</span>
              <span className="block text-[0.6875rem] font-medium uppercase tracking-wider text-muted">Your pay</span>
            </span>
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
