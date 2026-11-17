import { brandInitials } from "@/lib/brand";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-lg bg-accent text-base font-semibold tracking-tight text-white" aria-hidden>{brandInitials()}</span>
          <div>
            <p className="text-lg font-semibold leading-tight">Franchise Manager</p>
            <p className="text-sm text-muted">Daily management for delivery franchises</p>
          </div>
        </div>
        <div className="rounded-xl border border-line bg-surface p-6 sm:p-8">{children}</div>
      </div>
    </main>
  );
}
