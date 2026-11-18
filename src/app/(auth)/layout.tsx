import { brandInitials } from "@/lib/brand";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[26rem] bg-[radial-gradient(55%_60%_at_50%_0%,rgb(220_0_50/0.07),transparent)]" />
      <div className="relative w-full max-w-md">
        <div className="mb-7 flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-accent text-base font-semibold tracking-tight text-white" aria-hidden>{brandInitials("Franchise Books")}</span>
          <div className="leading-tight">
            <p className="text-lg font-semibold tracking-tight">Franchise Books</p>
            <p className="text-xs font-medium uppercase tracking-wider text-muted">by Winjo Digital</p>
          </div>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-6 shadow-[0_1px_2px_rgb(22_25_29/0.05),0_20px_48px_-20px_rgb(22_25_29/0.25)] sm:p-8">{children}</div>
      </div>
    </main>
  );
}
